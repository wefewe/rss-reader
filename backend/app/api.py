import logging
import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Body, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, desc, func, or_
from .database import get_db
from .models import FeedSource, Article, ReaderPreference, DigestRecord, ArticleImage
from .schemas import (
    ListReaderResponse,
    ArticleSchema,
    FeedSourceSchema,
    ReaderPreferencesSchema,
    GetArticleInput,
    IngestExternalFeedInput,
    ActionIDInput,
    SetArticleReadInput,
    SetArticleStarredInput,
    SetArticleFeedbackInput,
    MarkAllReadInput,
    UpdateReaderPreferencesInput,
    DigestRecordSchema,
    LoginInput,
    AskArticleInput,
    AskArticleResponse,
)
from .feed_crawler import refresh_all_feeds, parse_date, clean_html, enrich_new_articles, run_daily_brief_job
from .content_extractor import extract_fulltext_from_url
from .ai_service import ai_service
from .auth import require_auth, create_auth_token, verify_auth_token, TOKEN_VALIDITY_SECONDS
from .config import settings
import asyncio

logger = logging.getLogger("rss_reader.api")

# Public Router (no auth required)
public_router = APIRouter(prefix="/api/reader", tags=["public"])

# Protected Router (auth required)
router = APIRouter(prefix="/api/reader", tags=["reader"], dependencies=[Depends(require_auth)])

# --- Authentication Endpoints (Public) ---
@public_router.post("/auth/login")
async def auth_login(body: LoginInput):
    if not settings.READER_PASSWORD:
        return {"status": "ok", "token": "no_auth_required", "expires_in": TOKEN_VALIDITY_SECONDS}
    
    if body.password == settings.READER_PASSWORD:
        token = create_auth_token()
        return {"status": "ok", "token": token, "expires_in": TOKEN_VALIDITY_SECONDS}
    
    raise HTTPException(status_code=401, detail="密码错误，请重新输入")

@public_router.get("/auth/check")
async def auth_check(request: Request):
    if not settings.READER_PASSWORD:
        return {"status": "ok", "authed": True, "auth_required": False}
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.replace("Bearer ", "").strip()
        if verify_auth_token(token):
            return {"status": "ok", "authed": True, "auth_required": True}
    return {"status": "ok", "authed": False, "auth_required": True}

@public_router.post("/auth/logout")
async def auth_logout():
    return {"status": "ok", "message": "已退出登录"}

@public_router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "rss-reader", "timestamp": datetime.datetime.utcnow().isoformat()}

# Helper: recalculate unread counts
async def update_source_counters(session: AsyncSession, source_id: str):
    source = await session.get(FeedSource, source_id)
    if not source:
        return
    tot = await session.scalar(select(func.count(Article.id)).where(Article.source_id == source_id))
    unr = await session.scalar(
        select(func.count(Article.id)).where(Article.source_id == source_id, Article.is_read == False)
    )
    source.article_count = tot or 0
    source.unread_count = unr or 0

# 1. listreader
@router.post("/listreader")
@router.get("/listreader")
async def list_reader(
    group_name: Optional[str] = Query(None),
    source_id: Optional[str] = Query(None),
    view: Optional[str] = Query("all"), # all, unread, starred, featured
    search: Optional[str] = Query(None),
    limit: int = Query(200),
    db: AsyncSession = Depends(get_db)
):
    # Get preferences
    pref = await db.get(ReaderPreference, 1)
    if not pref:
        pref = ReaderPreference(id=1)
        db.add(pref)
        await db.commit()
        await db.refresh(pref)

    # Query articles
    stmt = select(Article)
    if group_name and group_name != "全部":
        stmt = stmt.where(Article.group_name == group_name)
    if source_id:
        stmt = stmt.where(Article.source_id == source_id)
    if view == "unread":
        stmt = stmt.where(Article.is_read == False)
    elif view == "starred":
        stmt = stmt.where(Article.is_starred == True)
    elif view == "featured":
        stmt = stmt.where(Article.value_tier == "featured")

    if search:
        kw = f"%{search.strip()}%"
        stmt = stmt.where(or_(Article.title.ilike(kw), Article.summary.ilike(kw)))

    # Order by rank_score DESC, published_at DESC
    stmt = stmt.order_by(desc(Article.rank_score), desc(Article.published_at)).limit(limit)
    res = await db.execute(stmt)
    articles = res.scalars().all()

    # Dynamic feedback bias (赞踩增量学习与偏好加权)
    fb_res = await db.execute(
        select(Article.source_id, Article.group_name, Article.feedback)
        .where(Article.feedback.is_not(None))
    )
    feedbacks = fb_res.all()
    source_bias = {}
    group_bias = {}
    for src_id, grp, fb in feedbacks:
        val = 0.08 if fb == "like" else (-0.15 if fb == "dislike" else 0.0)
        source_bias[src_id] = source_bias.get(src_id, 0.0) + val
        group_bias[grp] = group_bias.get(grp, 0.0) + (val * 0.5)

    for k in source_bias:
        source_bias[k] = max(-0.25, min(0.25, source_bias[k]))
    for k in group_bias:
        group_bias[k] = max(-0.2, min(0.2, group_bias[k]))

    # Muted keywords (静音规则过滤)
    muted_kws = [k.lower().strip() for k in (pref.muted_keywords or []) if k and k.strip()]

    article_schemas = []
    for a in articles:
        schema = ArticleSchema.model_validate(a)

        matched_mute = None
        if muted_kws:
            haystack = f"{a.title} {a.summary or ''}".lower()
            for kw in muted_kws:
                if kw in haystack:
                    matched_mute = kw
                    break

        if matched_mute:
            schema.value_tier = "hidden"
            schema.rank_score = max(0.0, round(schema.rank_score - 0.5, 2))
            signals = list(schema.triage_signals or [])
            signals.append({
                "dimension": "quality",
                "effect": -0.5,
                "evidence": f"触发静音关键词: {matched_mute}",
                "label": "关键词静音"
            })
            schema.triage_signals = signals
        else:
            bias = source_bias.get(a.source_id, 0.0) + group_bias.get(a.group_name, 0.0)
            if bias != 0:
                schema.rank_score = max(0.0, min(1.0, round(schema.rank_score + bias, 2)))

        article_schemas.append(schema)

    # Re-sort after applying feedback bias & mute penalty
    article_schemas.sort(key=lambda x: (x.rank_score, x.published_at), reverse=True)

    # Query sources
    src_res = await db.execute(select(FeedSource))
    sources = src_res.scalars().all()

    # Last checked at
    last_checked = max(
        [s.last_checked_at for s in sources if s.last_checked_at] or [datetime.datetime.utcnow()]
    ).isoformat()

    return {
        "articles": article_schemas,
        "sources": [FeedSourceSchema.model_validate(s) for s in sources],
        "preferences": ReaderPreferencesSchema.model_validate(pref),
        "last_checked_at": last_checked,
    }

# 2. getarticle (handles both composite key and bare url per Rule 13.4)
@router.post("/getarticle")
async def get_article(body: GetArticleInput, db: AsyncSession = Depends(get_db)):
    art_id = body.id
    article = await db.get(Article, art_id)
    if not article:
        # Try matching by bare URL
        stmt = select(Article).where(Article.url == art_id).limit(1)
        res = await db.execute(stmt)
        article = res.scalars().first()

    if not article:
        return {"article": None}
    return {"article": ArticleSchema.model_validate(article)}

# 3. refreshfeeds
@router.post("/refreshfeeds")
async def refresh_feeds():
    asyncio.create_task(refresh_all_feeds())
    return {"status": "ok", "message": "全量订阅源刷新任务已在后台启动"}

# 4. ingestexternalfeed (LINUX DO ingestion with Rule 8.1~8.4)
@router.post("/ingestexternalfeed")
async def ingest_external_feed(data: IngestExternalFeedInput, db: AsyncSession = Depends(get_db)):
    feed_url = data.feed_url.strip()
    if not feed_url:
        raise HTTPException(status_code=400, detail="feed_url is required")

    # Locate source by feed_url
    stmt = select(FeedSource).where(FeedSource.feed_url == feed_url)
    res = await db.execute(stmt)
    source = res.scalars().first()
    if not source:
        # Create dynamically if missing
        source_id = feed_url.split("/")[-1].replace(".rss", "") or "external"
        source = FeedSource(
            id=source_id,
            title="外部投喂-" + source_id,
            feed_url=feed_url,
            group_name="外部投喂",
            status="active"
        )
        db.add(source)
        await db.commit()
        await db.refresh(source)

    source_id = source.id
    source_title = source.title
    group_name = source.group_name
    current_batch_ids = set()
    newly_added = []

    for item in data.entries:
        url = item.url.strip()
        if not url:
            continue
        art_id = f"{source_id}\n{url}"
        current_batch_ids.add(art_id)

        pub_at = parse_date(item.published_at)
        existing = await db.get(Article, art_id)

        if not existing:
            art = Article(
                id=art_id,
                source_id=source_id,
                source_title=source_title,
                group_name=group_name,
                title=item.title.strip(),
                url=url,
                summary=item.summary or "",
                published_at=pub_at,
                image_url=item.image_url,
                discussion_posts=item.discussion_posts or [],
                value_tier="general",
                value_score=0.6,
                rank_score=0.6,
            )
            db.add(art)
            newly_added.append(art)
        else:
            # Rule 8.2: discussion_posts is full replacement if provided
            if item.discussion_posts is not None:
                existing.discussion_posts = item.discussion_posts
            if item.summary:
                existing.summary = item.summary
            if item.image_url:
                existing.image_url = item.image_url

    # Rule 8.3: 50-article retention protection
    stmt = select(Article.id).where(Article.source_id == source_id).order_by(desc(Article.published_at))
    res = await db.execute(stmt)
    all_ids = [row[0] for row in res.fetchall()]

    if len(all_ids) > 50:
        candidates = all_ids[50:]
        to_delete = [aid for aid in candidates if aid not in current_batch_ids]
        if to_delete:
            await db.execute(delete(Article).where(Article.id.in_(to_delete)))

    source.last_checked_at = datetime.datetime.utcnow()
    source.last_success_at = datetime.datetime.utcnow()
    source.status = "active"
    source.last_error = None
    await db.commit()
    await update_source_counters(db, source_id)
    await db.commit()

    if newly_added:
        asyncio.create_task(enrich_new_articles(newly_added))

    return {
        "status": "ok",
        "ingested_count": len(data.entries),
        "new_articles_count": len(newly_added),
        "source_id": source_id,
    }

# 5. fetcharticlefulltext
@router.post("/fetcharticlefulltext")
async def fetch_article_full_text(body: ActionIDInput, db: AsyncSession = Depends(get_db)):
    article = await db.get(Article, body.id)
    if not article:
        stmt = select(Article).where(Article.url == body.id).limit(1)
        res = await db.execute(stmt)
        article = res.scalars().first()

    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    res = await extract_fulltext_from_url(article.url)
    if res["content"]:
        article.content = res["content"]
        if res.get("image_url") and not article.image_url:
            article.image_url = res["image_url"]
        await db.commit()
        await db.refresh(article)
        return {"status": "ok", "article": ArticleSchema.model_validate(article)}
    else:
        return {"status": "error", "message": res.get("error", "正文抓取失败")}

# 6. summarizearticle
@router.post("/summarizearticle")
async def summarize_article_endpoint(body: ActionIDInput, db: AsyncSession = Depends(get_db)):
    article = await db.get(Article, body.id)
    if not article:
        stmt = select(Article).where(Article.url == body.id).limit(1)
        res = await db.execute(stmt)
        article = res.scalars().first()

    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    pref = await db.get(ReaderPreference, 1)
    text_to_summarize = article.content or article.summary or article.title
    ai_summary = await ai_service.summarize_article(
        article.title, text_to_summarize, pref.summary_model if pref else None
    )

    article.summary = ai_summary
    await db.commit()
    await db.refresh(article)
    return {"status": "ok", "summary": ai_summary, "article": ArticleSchema.model_validate(article)}

# 7. generatedailybrief
@router.post("/generatedailybrief")
async def generate_daily_brief_endpoint():
    await run_daily_brief_job()
    async with async_session() as db:
        res = await db.execute(select(DigestRecord).order_by(desc(DigestRecord.id)).limit(1))
        latest = res.scalars().first()
    return {"status": "ok", "brief": DigestRecordSchema.model_validate(latest) if latest else None}

# 8. analyzefeed
@router.post("/analyzefeed")
async def analyze_feed(body: ActionIDInput, db: AsyncSession = Depends(get_db)):
    source = await db.get(FeedSource, body.id)
    if not source:
        raise HTTPException(status_code=404, detail="订阅源未找到")

    avg_score = await db.scalar(
        select(func.avg(Article.value_score)).where(Article.source_id == body.id)
    )
    return {
        "id": source.id,
        "title": source.title,
        "article_count": source.article_count,
        "unread_count": source.unread_count,
        "average_value_score": round(avg_score or 0.5, 2),
        "status": source.status,
        "last_checked_at": source.last_checked_at.isoformat() if source.last_checked_at else None,
    }

# 9. setarticleread
@router.post("/setarticleread")
async def set_article_read(body: SetArticleReadInput, db: AsyncSession = Depends(get_db)):
    article = await db.get(Article, body.id)
    if not article:
        stmt = select(Article).where(Article.url == body.id).limit(1)
        res = await db.execute(stmt)
        article = res.scalars().first()

    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    article.is_read = body.is_read
    await db.commit()
    await update_source_counters(db, article.source_id)
    await db.commit()
    return {"status": "ok", "is_read": article.is_read}

# 10. setarticlestarred
@router.post("/setarticlestarred")
async def set_article_starred(body: SetArticleStarredInput, db: AsyncSession = Depends(get_db)):
    article = await db.get(Article, body.id)
    if not article:
        stmt = select(Article).where(Article.url == body.id).limit(1)
        res = await db.execute(stmt)
        article = res.scalars().first()

    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    article.is_starred = body.is_starred
    await db.commit()
    return {"status": "ok", "is_starred": article.is_starred}

# 11. setarticlefeedback
@router.post("/setarticlefeedback")
async def set_article_feedback(body: SetArticleFeedbackInput, db: AsyncSession = Depends(get_db)):
    article = await db.get(Article, body.id)
    if not article:
        stmt = select(Article).where(Article.url == body.id).limit(1)
        res = await db.execute(stmt)
        article = res.scalars().first()

    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    article.feedback = body.feedback
    await db.commit()
    return {"status": "ok", "feedback": article.feedback}

# 12. markallread
@router.post("/markallread")
async def mark_all_read(body: MarkAllReadInput, db: AsyncSession = Depends(get_db)):
    stmt = update(Article).values(is_read=True)
    if body.group_name and body.group_name != "全部":
        stmt = stmt.where(Article.group_name == body.group_name)
    if body.source_id:
        stmt = stmt.where(Article.source_id == body.source_id)

    await db.execute(stmt)
    await db.commit()

    # Refresh counters for all sources
    src_res = await db.execute(select(FeedSource))
    for s in src_res.scalars().all():
        await update_source_counters(db, s.id)
    await db.commit()

    return {"status": "ok", "message": "已全部标记为已读"}

# 13. updatereaderpreferences
@router.post("/updatereaderpreferences")
async def update_reader_preferences(body: UpdateReaderPreferencesInput, db: AsyncSession = Depends(get_db)):
    pref = await db.get(ReaderPreference, 1)
    if not pref:
        pref = ReaderPreference(id=1)
        db.add(pref)

    for k, v in body.preferences.items():
        if hasattr(pref, k):
            setattr(pref, k, v)

    await db.commit()
    await db.refresh(pref)
    return {"status": "ok", "preferences": ReaderPreferencesSchema.model_validate(pref)}

# Additional: Daily Brief History
@router.get("/dailybriefs")
async def get_daily_briefs(limit: int = 10, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(DigestRecord).order_by(desc(DigestRecord.id)).limit(limit))
    items = res.scalars().all()
    return {"briefs": [DigestRecordSchema.model_validate(b) for b in items]}

# 14. ask_article
@router.post("/article/ask", response_model=AskArticleResponse)
async def ask_article_endpoint(body: AskArticleInput, db: AsyncSession = Depends(get_db)):
    art_id = body.id
    article = await db.get(Article, art_id)
    if not article:
        stmt = select(Article).where(Article.url == art_id).limit(1)
        res = await db.execute(stmt)
        article = res.scalars().first()

    if not article:
        raise HTTPException(status_code=404, detail="文章未找到")

    pref = await db.get(ReaderPreference, 1)
    model = pref.summary_model if pref else "deepseek-v4.1-flash"

    text_to_use = article.content or article.summary or ""
    answer = await ai_service.ask_article(
        title=article.title,
        text=text_to_use,
        question=body.question,
        history=body.history or [],
        discussion_posts=article.discussion_posts or [],
        model=model
    )
    return {"status": "ok", "answer": answer}

@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "rss-reader", "timestamp": datetime.datetime.utcnow().isoformat()}
