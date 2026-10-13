import logging
import datetime
import re
import uuid
import zlib
import hashlib
import time
import urllib.parse
import httpx
import xml.etree.ElementTree as ET
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Body, Request, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, desc, func, or_, cast, String
from .database import get_db
from .models import FeedSource, Article, ReaderPreference, DigestRecord, ArticleImage, ArticleHighlight
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
    ForwardTelegramInput,
    ImportOpmlResponse,
    DeleteSourceInput,
    ArticleHighlightSchema,
    CreateHighlightInput,
    UpdateHighlightInput,
    DeleteHighlightInput,
    ListHighlightsInput,
    ExplainSelectionInput,
    ExplainSelectionResponse,
)
from .feed_crawler import refresh_all_feeds, parse_date, clean_html, enrich_new_articles, run_daily_brief_job, debuzz_title
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

# ── Smart Image Anti-Hotlinking Proxy (防盗链智能伪造与强缓存代理) ──
@public_router.get("/proxy/image")
async def proxy_image(url: str = Query(...)):
    if not url or not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid image URL")

    parsed = urllib.parse.urlparse(url)
    hostname = (parsed.hostname or "").lower()

    # SSRF protection: block local and private networks
    if hostname in ["localhost", "127.0.0.1", "0.0.0.0"] or hostname.startswith(("10.", "192.168.", "172.16.", "172.17.", "172.18.", "172.19.", "172.2", "172.3")):
        raise HTTPException(status_code=403, detail="Access denied")

    # Determine spoofed Referer based on image origin
    referer = f"{parsed.scheme}://{parsed.netloc}/"
    if "bohaishibei.com" in hostname:
        referer = "https://www.bohaishibei.com/"
    elif "qpic.cn" in hostname or "weixin.qq.com" in hostname:
        referer = "https://mp.weixin.qq.com/"
    elif "sinaimg.cn" in hostname or "weibo.com" in hostname:
        referer = "https://weibo.com/"
    elif "sspai.com" in hostname:
        referer = "https://sspai.com/"
    elif "zhimg.com" in hostname or "zhihu.com" in hostname:
        referer = "https://www.zhihu.com/"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": referer,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, verify=False) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed to fetch image from upstream")

            content_type = resp.headers.get("content-type") or "image/jpeg"
            return Response(
                content=resp.content,
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=2592000",
                    "Access-Control-Allow-Origin": "*",
                }
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Image proxy error for {url}: {e}")
        raise HTTPException(status_code=502, detail="Error fetching image")

def str_to_fever_id(s: str) -> int:
    return zlib.crc32(s.encode()) & 0x7FFFFFFF

# ── Fever API Endpoint (兼容 Reeder / NetNewsWire 原生客户端) ──
@public_router.api_route("/fever", methods=["GET", "POST"])
async def fever_endpoint(request: Request, db: AsyncSession = Depends(get_db)):
    form_data = {}
    try:
        form_data = await request.form()
    except Exception:
        pass

    params = {**request.query_params, **form_data}

    # Authenticate via api_key: md5(username:password) or md5(password)
    api_key = params.get("api_key", "").strip()
    authed = False
    if not settings.READER_PASSWORD:
        authed = True
    elif api_key:
        expected1 = hashlib.md5(f"admin:{settings.READER_PASSWORD}".encode()).hexdigest()
        expected2 = hashlib.md5(settings.READER_PASSWORD.encode()).hexdigest()
        if api_key.lower() in [expected1.lower(), expected2.lower()]:
            authed = True

    resp_data = {
        "api_version": 3,
        "auth": 1 if authed else 0,
        "last_refreshed_on_time": int(time.time()),
    }

    if not authed:
        return resp_data

    # Write Actions
    if "mark" in params:
        mark_target = params.get("mark")
        mark_as = params.get("as")
        target_id = params.get("id")
        if mark_target == "item" and target_id:
            try:
                target_int = int(target_id)
                art_res = await db.execute(select(Article))
                for a in art_res.scalars().all():
                    if str_to_fever_id(a.id) == target_int:
                        if mark_as == "read":
                            a.is_read = True
                        elif mark_as == "unread":
                            a.is_read = False
                        elif mark_as == "saved":
                            a.is_starred = True
                        elif mark_as == "unsaved":
                            a.is_starred = False
                        await db.commit()
                        break
            except Exception as e:
                logger.warning(f"Fever mark item error: {e}")

    # Groups
    if "groups" in params:
        src_res = await db.execute(select(FeedSource))
        all_sources = src_res.scalars().all()
        unique_groups = sorted(list(set(s.group_name for s in all_sources)))

        fever_groups = []
        feeds_groups = []
        for grp in unique_groups:
            grp_id = str_to_fever_id(f"group:{grp}")
            fever_groups.append({"id": grp_id, "title": grp})
            group_feed_ids = [str(str_to_fever_id(s.id)) for s in all_sources if s.group_name == grp]
            feeds_groups.append({"group_id": grp_id, "feed_ids": ",".join(group_feed_ids)})

        resp_data["groups"] = fever_groups
        resp_data["feeds_groups"] = feeds_groups

    # Feeds
    if "feeds" in params:
        src_res = await db.execute(select(FeedSource))
        all_sources = src_res.scalars().all()

        fever_feeds = []
        for s in all_sources:
            fever_feeds.append({
                "id": str_to_fever_id(s.id),
                "favicon_id": 0,
                "title": s.title,
                "url": s.feed_url,
                "site_url": s.site_url or "",
                "is_spark": 0,
                "last_updated_on_time": int(s.last_checked_at.timestamp()) if s.last_checked_at else int(time.time()),
            })
        resp_data["feeds"] = fever_feeds

    # Items
    if "items" in params:
        stmt = select(Article).order_by(desc(Article.published_at)).limit(150)
        art_res = await db.execute(stmt)
        articles = art_res.scalars().all()

        fever_items = []
        for a in articles:
            content_html = a.content or a.summary or ""
            if a.summary and a.content:
                content_html = f"<blockquote><b>[AI 深度摘要]</b><br/>{a.summary}</blockquote><hr/>{a.content}"
            fever_items.append({
                "id": str_to_fever_id(a.id),
                "feed_id": str_to_fever_id(a.source_id),
                "title": a.clean_title or a.title,
                "author": a.source_title,
                "html": content_html,
                "url": a.url,
                "is_saved": 1 if a.is_starred else 0,
                "is_read": 1 if a.is_read else 0,
                "created_on_time": int(a.published_at.timestamp()),
            })
        resp_data["items"] = fever_items
        resp_data["total_items"] = len(articles)

    # Unread Item IDs
    if "unread_item_ids" in params:
        stmt = select(Article.id).where(Article.is_read == False).limit(300)
        unr_res = await db.execute(stmt)
        unr_ids = [str(str_to_fever_id(r[0])) for r in unr_res.fetchall()]
        resp_data["unread_item_ids"] = ",".join(unr_ids)

    # Saved Item IDs
    if "saved_item_ids" in params:
        stmt = select(Article.id).where(Article.is_starred == True).limit(200)
        saved_res = await db.execute(stmt)
        s_ids = [str(str_to_fever_id(r[0])) for r in saved_res.fetchall()]
        resp_data["saved_item_ids"] = ",".join(s_ids)

    return resp_data


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
        stmt = stmt.where(
            or_(
                Article.title.ilike(kw),
                Article.summary.ilike(kw),
                Article.content.ilike(kw),
                cast(Article.discussion_posts, String).ilike(kw)
            )
        )

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

    now_dt = datetime.datetime.utcnow()
    article_schemas = []

    for a in articles:
        schema = ArticleSchema.model_validate(a)
        if not schema.clean_title:
            schema.clean_title = debuzz_title(schema.title)
        signals = list(schema.triage_signals or [])

        haystack = f"{a.title} {a.summary or ''}".lower()

        # 1. Check Mute Keywords
        matched_mute = None
        if muted_kws:
            for kw in muted_kws:
                if kw in haystack:
                    matched_mute = kw
                    break

        if matched_mute:
            schema.value_tier = "hidden"
            schema.rank_score = max(0.0, round(schema.rank_score - 0.5, 2))
            signals.append({
                "dimension": "quality",
                "effect": -0.5,
                "evidence": f"触发静音关键词: {matched_mute}",
                "label": "关键词静音"
            })
        else:
            # 2. Check Commercial Ad Pattern (纯商业广告/商品导购过滤，严防误杀)
            is_ad_pattern = False
            ad_match_reason = ""
            is_protected = any(k in haystack for k in [
                "github.com/", "docker", "python", "linux", "kernel", "commit", "api", "sqlite", "nginx", "systemd",
                "微语录精选", "博海拾贝", "段子", "知乎高赞", "每周精选", "财报", "反垄断", "芯片架构", "漏洞分析", "安全研究"
            ])
            if not is_protected:
                if re.search(r"(?:\d+(?:\.\d+)?元包邮|券后(?:实付)?\d+(?:\.\d+)?元|折\d+(?:\.\d+)?元(?:/|[，,\s]|\)|）)|新低\d+(?:\.\d+)?元|到手(?:仅|只要)?\d+(?:\.\d+)?元|包邮[（\(]折\d+)", a.title):
                    is_ad_pattern = True
                    ad_match_reason = "商品促销包邮价格"
                elif re.search(r"^(?:断码[，,]|白菜[!！]|好价[：:]|神价[!！]|手慢无[!！]|【(?:广告|推广|商务推广)】|（(?:推广|广告)）|特惠[：:])", a.title.strip()):
                    is_ad_pattern = True
                    ad_match_reason = "促销导购专属前缀"
                elif re.search(r"百货\s*\d+\s*条|超值商品推荐|好物清单推荐|超值好物汇总|每日超值汇总", a.title):
                    is_ad_pattern = True
                    ad_match_reason = "纯商品推荐清单"

            if is_ad_pattern:
                schema.value_tier = "hidden"
                schema.rank_score = 0.05
                signals.append({"dimension": "promotion", "effect": -0.9, "evidence": f"命中{ad_match_reason}", "label": "商业推广"})
            else:
                # 3. Check Promotion Preferences Switches
                is_promo_hidden = False
                if not pref.show_affiliate and (schema.promotion_score >= 0.6 or any(w in haystack for w in ["返利", "佣金", "推广码", "aff"])):
                    schema.value_tier = "hidden"
                    signals.append({"dimension": "promotion", "effect": -0.4, "evidence": "偏好设置已过滤返利推广", "label": "返利过滤"})
                    is_promo_hidden = True
                elif not pref.show_sponsored and (schema.content_type == "sponsored" or any(w in haystack for w in ["软文", "商业推广", "厂商赞助", "特约赞助"])):
                    schema.value_tier = "hidden"
                    signals.append({"dimension": "promotion", "effect": -0.4, "evidence": "偏好设置已过滤品牌软文", "label": "软文过滤"})
                    is_promo_hidden = True
                elif not pref.show_big_sales and any(w in haystack for w in ["618", "双十一", "双11", "黑五", "大促"]):
                    schema.value_tier = "hidden"
                    signals.append({"dimension": "promotion", "effect": -0.3, "evidence": "偏好设置已过滤电商大促", "label": "大促过滤"})
                    is_promo_hidden = True
                elif not pref.show_deal_alerts and (schema.group_name == "羊毛福利" or any(w in haystack for w in ["线报", "立减", "限免", "领券"])):
                    schema.value_tier = "hidden"
                    signals.append({"dimension": "promotion", "effect": -0.3, "evidence": "偏好设置已过滤实时线报", "label": "线报过滤"})
                    is_promo_hidden = True

                # 4. Dynamic Feedback Bias
                bias = source_bias.get(a.source_id, 0.0) + group_bias.get(a.group_name, 0.0)
                if bias != 0:
                    schema.rank_score = max(0.0, min(1.0, round(schema.rank_score + bias, 2)))

                # 5. Temporal Decay & Star/Read Adjustment
                pub_dt = a.published_at.replace(tzinfo=None) if hasattr(a.published_at, 'tzinfo') and a.published_at.tzinfo else a.published_at
                age_hours = max(0.0, (now_dt - pub_dt).total_seconds() / 3600.0)
                decay = 1.0 / (1.0 + (age_hours / 96.0)) # 96-hour half-life

                # High-tier articles stay high, while stale items decay gracefully
                current_rank = schema.rank_score * (0.68 + 0.32 * decay)

                if a.is_starred:
                    current_rank = min(1.0, current_rank + 0.2)
                if a.is_read:
                    current_rank = max(0.0, current_rank - 0.1)

                schema.rank_score = round(current_rank, 2)

        schema.triage_signals = signals
        article_schemas.append(schema)

    # Re-sort by effective rank_score DESC, published_at DESC
    article_schemas.sort(key=lambda x: (x.rank_score, x.published_at), reverse=True)

    # Calculate real-time counts across value tiers
    tier_counts = {
        "normal": sum(1 for a in article_schemas if a.value_tier != "hidden"),
        "featured": sum(1 for a in article_schemas if a.value_tier == "featured"),
        "hidden": sum(1 for a in article_schemas if a.value_tier == "hidden"),
    }

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
        "tier_counts": tier_counts,
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
    if body.article_ids:
        stmt = stmt.where(Article.id.in_(body.article_ids))
    else:
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

# 15. Forward to Telegram
@router.post("/article/forward_telegram")
async def forward_telegram_endpoint(body: ForwardTelegramInput, db: AsyncSession = Depends(get_db)):
    art_id = body.id
    article = await db.get(Article, art_id)
    if not article:
        stmt = select(Article).where(Article.url == art_id).limit(1)
        res = await db.execute(stmt)
        article = res.scalars().first()

    if not article:
        raise HTTPException(status_code=404, detail="文章未找到")

    if not settings.TG_BOT_TOKEN or not settings.TG_CHAT_ID:
        raise HTTPException(status_code=500, detail="服务器未配置 Telegram 推送凭据")

    reader_url = settings.PUBLIC_URL or "https://reader.cwsub.indevs.in"
    discussion_count = len(article.discussion_posts) if article.discussion_posts else 0

    card = ai_service.format_article_telegram_card(
        title=article.title,
        source_title=article.source_title,
        group_name=article.group_name,
        summary=article.summary or "暂无 AI 摘要",
        url=article.url,
        reader_url=reader_url,
        discussion_count=discussion_count
    )

    ok = await ai_service.push_telegram_notification(
        card["text"],
        parse_mode="HTML",
        reply_markup=card["reply_markup"]
    )
    if not ok:
        raise HTTPException(status_code=502, detail="Telegram 消息推送失败，请检查网络或机器人配置")

    return {"status": "ok", "message": "已成功推送到 Telegram 个人收藏夹"}

# 16. Export OPML
@router.get("/opml/export")
async def export_opml(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(FeedSource))
    sources = res.scalars().all()

    opml = ET.Element("opml", version="2.0")
    head = ET.SubElement(opml, "head")
    title = ET.SubElement(head, "title")
    title.text = "AI RSS Reader Subscriptions"
    date_created = ET.SubElement(head, "dateCreated")
    date_created.text = datetime.datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S GMT")

    body = ET.SubElement(opml, "body")

    # Group sources by group_name
    grouped: Dict[str, List[FeedSource]] = {}
    for s in sources:
        grp = s.group_name or "未分组"
        grouped.setdefault(grp, []).append(s)

    for grp, srcs in sorted(grouped.items()):
        grp_outline = ET.SubElement(body, "outline", text=grp, title=grp)
        for s in srcs:
            attrs = {
                "type": "rss",
                "text": s.title,
                "title": s.title,
                "xmlUrl": s.feed_url,
                "htmlUrl": s.site_url or "",
            }
            if s.description:
                attrs["description"] = s.description
            ET.SubElement(grp_outline, "outline", **attrs)

    xml_bytes = ET.tostring(opml, encoding="utf-8", xml_declaration=True)
    return Response(
        content=xml_bytes,
        media_type="text/xml; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="subscriptions.opml"'}
    )

# 17. Import OPML
@router.post("/opml/import", response_model=ImportOpmlResponse)
async def import_opml(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    content = await file.read()
    try:
        root = ET.fromstring(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无法解析 OPML XML 文件: {str(e)}")

    res = await db.execute(select(FeedSource.feed_url))
    existing_urls = set(res.scalars().all())

    body = root.find("body")
    if body is None:
        body = root

    imported = []
    skipped = 0

    def parse_outlines(parent_node, current_group="个人导入"):
        nonlocal skipped
        for outline in parent_node.findall("outline"):
            xml_url = outline.get("xmlUrl") or outline.get("xmlurl")
            if xml_url:
                title = outline.get("title") or outline.get("text") or "未命名订阅源"
                site_url = outline.get("htmlUrl") or outline.get("htmlurl") or ""
                desc = outline.get("description") or ""
                grp = current_group if current_group != "未分组" else (outline.get("group") or "个人导入")

                if xml_url in existing_urls:
                    skipped += 1
                    continue

                slug = re.sub(r'[^a-zA-Z0-9_\-]', '', title.lower()[:30]) or "feed"
                source_id = f"custom-{slug}-{len(existing_urls)+1}"

                src = FeedSource(
                    id=source_id,
                    title=title,
                    site_url=site_url,
                    feed_url=xml_url,
                    description=desc,
                    group_name=grp,
                    status="active"
                )
                db.add(src)
                existing_urls.add(xml_url)
                imported.append(title)
            else:
                grp_title = outline.get("title") or outline.get("text") or current_group
                parse_outlines(outline, grp_title)

    parse_outlines(body)
    await db.commit()

    if imported:
        asyncio.create_task(refresh_all_feeds())

    return {
        "status": "ok",
        "imported_count": len(imported),
        "skipped_count": skipped,
        "new_sources": imported
    }

# 18. deletesource
@router.post("/deletesource")
async def delete_source(body: DeleteSourceInput, db: AsyncSession = Depends(get_db)):
    source = await db.get(FeedSource, body.id)
    if not source:
        raise HTTPException(status_code=404, detail="订阅源未找到")

    # Delete all associated articles
    await db.execute(delete(Article).where(Article.source_id == body.id))
    # Delete the source
    await db.delete(source)
    await db.commit()

    return {"status": "ok", "message": f"已成功删除订阅源: {source.title}"}

# 19. Highlights & Annotations (Readwise 工作流)
@router.post("/highlights", response_model=ArticleHighlightSchema)
async def create_highlight(body: CreateHighlightInput, db: AsyncSession = Depends(get_db)):
    article = await db.get(Article, body.article_id)
    if not article:
        stmt = select(Article).where(Article.url == body.article_id).limit(1)
        res = await db.execute(stmt)
        article = res.scalars().first()

    hl_id = f"hl_{uuid.uuid4().hex[:12]}"
    highlight = ArticleHighlight(
        id=hl_id,
        article_id=article.id if article else body.article_id,
        article_title=article.title if article else "未知文章",
        article_url=article.url if article else "",
        text=body.text.strip(),
        note=body.note.strip() if body.note else None,
        color=body.color or "yellow",
        created_at=datetime.datetime.utcnow()
    )
    db.add(highlight)
    await db.commit()
    await db.refresh(highlight)
    return ArticleHighlightSchema.model_validate(highlight)

@router.post("/highlights/list")
async def list_highlights(body: ListHighlightsInput, db: AsyncSession = Depends(get_db)):
    stmt = select(ArticleHighlight)
    if body.article_id:
        stmt = stmt.where(ArticleHighlight.article_id == body.article_id)
    stmt = stmt.order_by(desc(ArticleHighlight.created_at)).limit(body.limit)
    res = await db.execute(stmt)
    items = res.scalars().all()
    return {"highlights": [ArticleHighlightSchema.model_validate(h) for h in items]}

@router.post("/highlights/update", response_model=ArticleHighlightSchema)
async def update_highlight(body: UpdateHighlightInput, db: AsyncSession = Depends(get_db)):
    hl = await db.get(ArticleHighlight, body.id)
    if not hl:
        raise HTTPException(status_code=404, detail="划线记录未找到")
    if body.note is not None:
        hl.note = body.note.strip() if body.note.strip() else None
    if body.color is not None:
        hl.color = body.color
    await db.commit()
    await db.refresh(hl)
    return ArticleHighlightSchema.model_validate(hl)

@router.post("/highlights/delete")
async def delete_highlight(body: DeleteHighlightInput, db: AsyncSession = Depends(get_db)):
    hl = await db.get(ArticleHighlight, body.id)
    if not hl:
        raise HTTPException(status_code=404, detail="划线记录未找到")
    await db.delete(hl)
    await db.commit()
    return {"status": "ok", "message": "划线与批注已移除"}

# 20. Contextual AI on Selection
@router.post("/explain_selection", response_model=ExplainSelectionResponse)
async def explain_selection_endpoint(body: ExplainSelectionInput, db: AsyncSession = Depends(get_db)):
    pref = await db.get(ReaderPreference, 1)
    model = pref.summary_model if pref else "deepseek-v4.1-flash"

    explanation = await ai_service.explain_selection(
        selected_text=body.selected_text,
        article_title=body.article_title,
        surrounding_context=body.surrounding_context,
        model=model
    )
    return {"status": "ok", "explanation": explanation}

# 21. AI Bilingual Translate (Follow 双语流)
@router.post("/article/bilingual_translate")
async def bilingual_translate_endpoint(body: ActionIDInput, db: AsyncSession = Depends(get_db)):
    art_id = body.id
    article = await db.get(Article, art_id)
    if not article:
        stmt = select(Article).where(Article.url == art_id).limit(1)
        res = await db.execute(stmt)
        article = res.scalars().first()

    if not article:
        raise HTTPException(status_code=404, detail="文章未找到")

    # If valid cache exists, return immediately
    if article.bilingual_content and not article.bilingual_content.startswith("双语翻译超时"):
        return {"status": "ok", "bilingual_content": article.bilingual_content}

    pref = await db.get(ReaderPreference, 1)
    model = pref.summary_model if pref else "deepseek-v4.1-flash"

    text_to_use = article.content
    if not text_to_use and article.url:
        try:
            fetched_res = await extract_fulltext_from_url(article.url)
            if fetched_res and fetched_res.get("content"):
                article.content = fetched_res["content"]
                text_to_use = fetched_res["content"]
        except Exception:
            pass

    if isinstance(text_to_use, dict):
        text_to_use = text_to_use.get("content", "")

    if not text_to_use or not isinstance(text_to_use, str):
        text_to_use = article.summary or ""

    bilingual = await ai_service.bilingual_translate(
        title=article.title,
        text=text_to_use,
        model=model
    )

    if bilingual and not bilingual.startswith("双语翻译超时"):
        article.bilingual_content = bilingual
        await db.commit()

    return {"status": "ok", "bilingual_content": bilingual}

# 24. Edge-TTS 语音听文播客
@router.get("/article/tts_audio")
async def tts_audio_endpoint(
    id: str = Query(...),
    voice: Optional[str] = Query("zh-CN-YunxiNeural"),
    db: AsyncSession = Depends(get_db)
):
    article = await db.get(Article, id)
    if not article:
        stmt = select(Article).where(Article.url == id).limit(1)
        res = await db.execute(stmt)
        article = res.scalars().first()

    if not article:
        raise HTTPException(status_code=404, detail="文章未找到")

    text_parts = [f"正在为你朗读文章：{article.clean_title or article.title}。来源：{article.source_title}。"]
    if article.summary:
        text_parts.append(f"AI 核心要点：{article.summary}")
    if article.content:
        text_parts.append(f"正文内容摘录：{article.content[:1500]}")

    speech_text = " ".join(text_parts)
    audio_bytes = await ai_service.synthesize_speech(speech_text, voice=voice or "zh-CN-YunxiNeural")
    if not audio_bytes:
        raise HTTPException(status_code=502, detail="语音合成失败，请稍后重试")

    safe_filename = f"article_{zlib.crc32(article.id.encode())}.mp3"
    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": f'inline; filename="{safe_filename}"',
            "Cache-Control": "public, max-age=86400"
        }
    )

@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "rss-reader", "timestamp": datetime.datetime.utcnow().isoformat()}
