import logging
import datetime
import asyncio
import re
from typing import Any, Optional, List, Dict
import feedparser
import httpx
import trafilatura
from bs4 import BeautifulSoup
from dateutil import parser as date_parser
from sqlalchemy import select, delete, func, desc, update, or_
from .database import async_session
from .models import FeedSource, Article, ReaderPreference, DigestRecord, ForumStagingTopic, ArticleHighlight
from .default_feeds import DEFAULT_FEED_SOURCES
from .ai_service import ai_service
from .config import settings

logger = logging.getLogger("rss_reader.crawler")

CLICKBAIT_PATTERNS = [
    r"^【(?:突发|重磅|震惊|速看|提醒|重磅推荐|独家|大事件|官宣)】\s*",
    r"^\[(?:突发|重磅|震惊|速看|提醒|独家|官宣)\]\s*",
    r"^(?:突发|重磅|震惊|速看|彻底告别|绝了|惊呆|终于来了|紧急提醒|重大通知)[!！：:\s]+",
    r"^(?:不可思议|彻底颠覆|太强了|居然这么简单|炸裂)[!！：:\s]+",
    r"[，,\s]*(?:快上车|建议收藏|速度领|太炸裂了|赶紧看|千万别错过)[!！]*$",
]

def debuzz_title(raw_title: str) -> str:
    if not raw_title:
        return ""
    cleaned = raw_title.strip()
    for pat in CLICKBAIT_PATTERNS:
        cleaned = re.sub(pat, "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip()
    return cleaned if cleaned else raw_title

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 RSSReader/1.0",
    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
}

def clean_html(raw_html: str) -> str:
    if not raw_html:
        return ""
    soup = BeautifulSoup(raw_html, "html.parser")
    for s in soup(["script", "style"]):
        s.decompose()
    return soup.get_text(separator=" ").strip()

def extract_rich_content_and_image(raw_html: str):
    """
    Converts HTML content from RSS to clean markdown with images preserved,
    and extracts the first meaningful content image.
    Handles lazy-loaded images (data-lazy-src / data-src) and dedupes noscript fallbacks.
    """
    if not raw_html:
        return "", None

    soup = BeautifulSoup(raw_html, "html.parser")
    for s in soup(["script", "style"]):
        s.decompose()

    # Promote lazy-loaded image attributes to real src
    then_remove = []
    for img in soup.find_all("img"):
        lazy_src = None
        for attr in ("data-lazy-src", "data-src", "data-original", "data-lazy", "data-url"):
            if img.get(attr):
                lazy_src = img.get(attr)
                break
        if lazy_src:
            img["src"] = lazy_src
        src = img.get("src") or ""
        if src.startswith("data:image/svg") or src.startswith("data:image/gif"):
            then_remove.append(img)
    for img in then_remove:
        img.decompose()
    for s in soup(["noscript"]):
        s.decompose()

    first_img = None
    seen_img_urls = set()
    for img in soup.find_all("img"):
        src = img.get("src") or ""
        alt = img.get("alt") or "image"
        if src and not first_img and not re.search(r'logo|avatar|icon|qrcode|wechat|alipay|flag', src, re.I):
            first_img = src
        if src and src not in seen_img_urls:
            seen_img_urls.add(src)
            img.replace_with(f"\n\n![{alt}]({src})\n\n")
        else:
            img.decompose()

    for br in soup.find_all("br"):
        br.replace_with("\n")
    for p in soup.find_all("p"):
        p.insert_before("\n\n")
        p.insert_after("\n\n")

    text = soup.get_text()
    cleaned = re.sub(r'\n{3,}', '\n\n', text).strip()
    return cleaned, first_img

def parse_date(date_str: Any) -> datetime.datetime:
    if isinstance(date_str, datetime.datetime):
        return date_str
    if not date_str:
        return datetime.datetime.utcnow()
    try:
        dt = date_parser.parse(str(date_str))
        if dt.tzinfo:
            dt = dt.astimezone(datetime.timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return datetime.datetime.utcnow()

async def init_default_sources():
    """Seed the 14 default feed sources into the database if not present."""
    async with async_session() as session:
        for s in DEFAULT_FEED_SOURCES:
            existing = await session.get(FeedSource, s["id"])
            if not existing:
                src = FeedSource(
                    id=s["id"],
                    title=s["title"],
                    site_url=s["site_url"],
                    feed_url=s["feed_url"],
                    group_name=s["group_name"],
                    description=s["description"],
                    status="active",
                )
                session.add(src)
        
        # Also ensure reader_preferences exists
        pref = await session.get(ReaderPreference, 1)
        if not pref:
            session.add(ReaderPreference(id=1))
        await session.commit()

async def fetch_single_feed(source: FeedSource):
    """
    Fetches and parses a single RSS feed.
    Enforces 50-article retention with protection for the current batch.
    """
    # Exemption Rule 8.4: LINUX DO sources are managed exclusively by external browser worker
    if "linux.do" in source.feed_url:
        logger.info(f"Skipping direct HTTP fetch for {source.title} (managed exclusively by external Playwright worker)")
        return

    logger.info(f"Checking feed: {source.title} ({source.feed_url})")
    source_id = source.id
    source_title = source.title
    group_name = source.group_name

    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=20.0, follow_redirects=True, verify=False) as client:
            resp = await client.get(source.feed_url)
            if resp.status_code >= 400:
                raise Exception(f"HTTP {resp.status_code} {resp.reason_phrase}")
            content = resp.content

        feed = feedparser.parse(content)
        if feed.bozo and not feed.entries:
            raise Exception(f"Invalid XML / Feed parse error: {feed.bozo_exception}")

        current_batch_ids = set()
        new_articles = []

        async with async_session() as session:
            # Re-fetch source to update metadata inside transaction
            db_source = await session.get(FeedSource, source_id)
            if not db_source:
                return

            db_source.last_checked_at = datetime.datetime.utcnow()

            for entry in feed.entries[:50]:
                url = entry.get("link", "").strip()
                if not url:
                    continue

                article_id = f"{source_id}\n{url}"
                current_batch_ids.add(article_id)

                title = entry.get("title", "无标题").strip()
                raw_summary = entry.get("summary") or entry.get("description") or ""
                summary = clean_html(raw_summary)[:1000]

                # Check rich full content from RSS (e.g. content:encoded)
                raw_rich = ""
                content_list = entry.get("content") or []
                if content_list and isinstance(content_list, list):
                    for c_item in content_list:
                        if isinstance(c_item, dict) and c_item.get("value"):
                            raw_rich = c_item["value"]
                            break
                elif entry.get("content_encoded"):
                    raw_rich = entry.get("content_encoded")

                content_md, entry_img = extract_rich_content_and_image(raw_rich or raw_summary)
                if not content_md or len(content_md) < 50:
                    content_md = None

                pub_date = (
                    entry.get("published")
                    or entry.get("updated")
                    or entry.get("pubDate")
                )
                published_at = parse_date(pub_date)

                # Check if exists
                existing_article = await session.get(Article, article_id)
                if not existing_article:
                    art = Article(
                        id=article_id,
                        source_id=source_id,
                        source_title=source_title,
                        group_name=group_name,
                        title=title,
                        clean_title=debuzz_title(title),
                        url=url,
                        summary=summary,
                        content=content_md,
                        image_url=entry_img,
                        published_at=published_at,
                        fetched_at=datetime.datetime.utcnow(),
                        is_read=False,
                        value_tier="general",
                        value_score=0.5,
                        rank_score=0.5,
                    )
                    session.add(art)
                    new_articles.append(art)
                else:
                    # Update summary/content/image if empty
                    if not existing_article.summary and summary:
                        existing_article.summary = summary
                    if not existing_article.content and content_md:
                        existing_article.content = content_md
                    if not existing_article.image_url and entry_img:
                        existing_article.image_url = entry_img

            # Rule 8.3: 50-article retention protection (excluding starred and highlighted articles)
            # Find all articles for this source ordered by published_at DESC
            stmt = select(Article.id).where(Article.source_id == source_id).order_by(desc(Article.published_at))
            res = await session.execute(stmt)
            all_ids = [row[0] for row in res.fetchall()]

            if len(all_ids) > 50:
                # Articles eligible for pruning: those beyond top 50 AND not in current_batch_ids
                candidates = all_ids[50:]
                to_check = [aid for aid in candidates if aid not in current_batch_ids]
                if to_check:
                    protected_res = await session.execute(
                        select(Article.id).where(
                            Article.id.in_(to_check),
                            or_(
                                Article.is_starred == True,
                                Article.id.in_(select(ArticleHighlight.article_id))
                            )
                        )
                    )
                    protected_ids = set(protected_res.scalars().all())
                    to_delete = [aid for aid in to_check if aid not in protected_ids]
                    if to_delete:
                        await session.execute(delete(Article).where(Article.id.in_(to_delete)))

            # Update stats
            count_res = await session.execute(select(func.count(Article.id)).where(Article.source_id == source_id))
            db_source.article_count = count_res.scalar() or 0

            unread_res = await session.execute(
                select(func.count(Article.id)).where(
                    Article.source_id == source_id,
                    Article.is_read == False
                )
            )
            db_source.unread_count = unread_res.scalar() or 0
            db_source.last_success_at = datetime.datetime.utcnow()
            db_source.last_error = None
            db_source.status = "active"

            await session.commit()

        # Background AI enrichment for newly discovered articles (Pre-computation!)
        if new_articles:
            asyncio.create_task(enrich_new_articles(new_articles))

    except Exception as e:
        logger.error(f"Error fetching feed {source_title}: {e}")
        async with async_session() as session:
            db_source = await session.get(FeedSource, source_id)
            if db_source:
                db_source.last_checked_at = datetime.datetime.utcnow()
                db_source.last_error = str(e)
                db_source.status = "error"
                await session.commit()

async def enrich_new_articles(articles: list):
    """
    Asynchronously runs full-text extraction (for summary-only feeds),
    AI triage and summary pre-computation for new articles.
    Ensures 0 latency when the user views the articles!
    """
    from .content_extractor import extract_fulltext_from_url

    auto_fetch_budget = 6  # bound per-batch network fetches
    for a in articles[:10]: # Batch up to 10 to avoid bursting
        try:
            async with async_session() as session:
                pref = await session.get(ReaderPreference, 1)
                if pref and pref.pure_rule_mode:
                    break # Skip AI in pure rule mode

                is_forum = a.source_id.startswith("linuxdo") or bool(a.discussion_posts) or "linux.do" in (a.url or "")

                # 0. Auto-fetch full text for summary-only feeds (non-forum, no content yet)
                if not is_forum and not a.content and auto_fetch_budget > 0 and a.url:
                    short_summary = (a.summary or "").strip()
                    if len(short_summary) < 600:
                        auto_fetch_budget -= 1
                        try:
                            ft = await extract_fulltext_from_url(a.url)
                            if ft and ft.get("content"):
                                a.content = ft["content"]
                                if ft.get("image_url") and not a.image_url:
                                    a.image_url = ft["image_url"]
                        except Exception as fe:
                            logger.warning(f"Auto fulltext failed for {a.url}: {fe}")

                # Determine richest available text for AI enrichment
                enrich_text = a.content or a.summary or ""

                # 1. AI Triage with multi-layer filtering
                triage = await ai_service.triage_article(
                    a.title,
                    enrich_text,
                    a.source_title,
                    group_name=a.group_name,
                    discussion_posts=a.discussion_posts or [],
                    extra_meta={"source_id": a.source_id}
                )

                # 2. AI Summary
                ai_sum = await ai_service.summarize_article(
                    a.title,
                    enrich_text,
                    pref.summary_model if pref else None,
                    discussion_posts=a.discussion_posts or []
                )

                # Re-fetch article to update
                db_a = await session.get(Article, a.id)
                if db_a:
                    db_a.content = a.content or db_a.content
                    db_a.image_url = a.image_url or db_a.image_url
                    db_a.value_tier = triage.get("value_tier", "general")
                    db_a.value_score = triage.get("value_score", 0.5)
                    db_a.quality_score = triage.get("quality_score", 0.5)
                    db_a.promotion_score = triage.get("promotion_score", 0.0)
                    db_a.expiry_score = triage.get("expiry_score", 0.0)
                    db_a.triage_reason = triage.get("reason", "")
                    db_a.triage_signals = triage.get("signals", [])
                    db_a.rank_score = triage.get("rank_score", 0.5)
                    if ai_sum:
                        db_a.summary = ai_sum # Update with rich structured summary!
                    await session.commit()
        except Exception as e:
            logger.warning(f"Error enriching article {a.title}: {e}")

async def refresh_all_feeds():
    """Refreshes all 14 feeds asynchronously."""
    logger.info("Starting background refresh of all feeds...")
    async with async_session() as session:
        stmt = select(FeedSource)
        res = await session.execute(stmt)
        sources = res.scalars().all()

    # Parallelize fetch in worker batches
    tasks = [fetch_single_feed(s) for s in sources]
    await asyncio.gather(*tasks, return_exceptions=True)
    logger.info("All feeds refreshed.")

async def run_daily_brief_job():
    """Generates 09:00 morning brief and optionally pushes to Telegram."""
    logger.info("Running 09:00 Daily Briefing job...")
    async with async_session() as session:
        # Pick top featured/unread articles from past 24h
        cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=24)
        stmt = (
            select(Article)
            .where(Article.published_at >= cutoff)
            .order_by(desc(Article.rank_score))
            .limit(15)
        )
        res = await session.execute(stmt)
        articles = res.scalars().all()

        candidates = [
            {
                "title": a.title,
                "source_title": a.source_title,
                "group_name": a.group_name,
                "url": a.url,
                "summary": a.summary or "",
                "rank_score": a.rank_score,
            }
            for a in articles
        ]

        today_str = datetime.datetime.now().strftime("%Y-%m-%d")
        brief = await ai_service.generate_daily_brief(candidates)

        record = DigestRecord(
            date=today_str,
            title=brief["title"],
            content=brief["content"],
            is_fallback=brief.get("is_fallback", False),
            created_at=datetime.datetime.utcnow()
        )
        session.add(record)
        await session.commit()

        # Telegram Push
        import html as py_html
        clean_brief_title = py_html.escape(brief["title"])

        raw_content = (brief["content"] or "").strip()
        lines = raw_content.split("\n")
        if lines and lines[0].startswith("#") and any(k in lines[0] for k in ["晨间", "早报", "内参"]):
            raw_content = "\n".join(lines[1:]).strip()

        brief_html = ai_service.markdown_to_telegram_html(raw_content)

        tg_text = f"""☕ <b>{clean_brief_title}</b>
📅 <code>{today_str}</code> · <b>AI 晨间数字内参</b>
━━━━━━━━━━━━━━━━━━━━━━
<blockquote expandable>
{brief_html}
</blockquote>"""

        reader_url = settings.PUBLIC_URL or "https://reader.cwsub.indevs.in"
        reply_markup = {
            "inline_keyboard": [
                [
                    {"text": "📖 进入图书阅读器", "url": reader_url}
                ]
            ]
        }
        await ai_service.push_telegram_notification(tg_text, parse_mode="HTML", reply_markup=reply_markup)
        logger.info("09:00 Daily Briefing generated and stored.")

async def generate_forum_digest_job(edition: Optional[str] = None) -> Optional[Article]:
    """
    Synthesizes staged LINUX DO topics into a single periodic issue (晨报/午报/晚报/即席).
    Filters out noise/expired, calls LLM for structured sectional markdown, and publishes as 1 Article.
    """
    from zoneinfo import ZoneInfo
    import time
    tz = ZoneInfo(settings.TZ or "Asia/Shanghai")
    now_local = datetime.datetime.now(tz)
    today_str = now_local.strftime("%Y-%m-%d")
    hour = now_local.hour

    if not edition:
        if hour < 11:
            edition_name = "晨报版"
            edition_code = "morning"
            emoji = "☕"
        elif hour < 17:
            edition_name = "午报版"
            edition_code = "noon"
            emoji = "🍱"
        else:
            edition_name = "晚报版"
            edition_code = "evening"
            emoji = "🌙"
    else:
        edition_name = edition
        edition_code = f"adhoc_{int(time.time())}"
        emoji = "⚡"

    logger.info(f"Generating LINUX DO Forum Digest ({today_str} {edition_name})...")

    async with async_session() as session:
        # 1. Fetch candidate topics from staging buffer
        stmt = (
            select(ForumStagingTopic)
            .where(ForumStagingTopic.is_consumed == False)
            .order_by(desc(ForumStagingTopic.posts_count), desc(ForumStagingTopic.scraped_at))
            .limit(35)
        )
        res = await session.execute(stmt)
        topics = res.scalars().all()

        # If not enough unconsumed topics, look at last 16h to ensure full magazine substance
        if len(topics) < 4:
            cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=16)
            stmt_fallback = (
                select(ForumStagingTopic)
                .where(ForumStagingTopic.scraped_at >= cutoff)
                .order_by(desc(ForumStagingTopic.posts_count), desc(ForumStagingTopic.scraped_at))
                .limit(35)
            )
            res_fb = await session.execute(stmt_fallback)
            topics = res_fb.scalars().all()

        # 2. Filter noise & obvious expired deals
        valid_topics = []
        consumed_ids = []
        for t in topics:
            consumed_ids.append(t.id)
            title = t.title or ""
            content_sample = (t.content or t.summary or "").strip()
            # Skip if pure short water
            if len(content_sample) < 20 and t.posts_count <= 1:
                continue
            # Skip expired
            if any(k in title for k in ["已失效", "已领完", "活动结束", "优惠结束", "已下架"]):
                continue
            valid_topics.append({
                "id": t.id,
                "title": t.clean_title or t.title,
                "url": t.url,
                "group_name": t.group_name,
                "content": t.content,
                "summary": t.summary,
                "discussion_posts": t.discussion_posts,
                "posts_count": t.posts_count,
            })

        # 3. Call AI service for structured magazine issue
        pref = await session.get(ReaderPreference, 1)
        model = pref.summary_model if pref else "gemini-3.8-flash"

        digest_data = await ai_service.generate_forum_digest_content(
            topics=valid_topics,
            edition_name=edition_name,
            today_str=today_str,
            model=model
        )

        # 4. Save as Article in articles table (Upsert)
        source_id = "linuxdo-digest"
        source_title = "LINUX DO 社区内参"
        group_name = "社区内参"
        issue_title = f"{emoji} LINUX DO 社区热点内参 ({today_str} {edition_name})"
        article_url = f"https://linux.do/digest/{today_str}_{edition_code}"
        article_id = f"{source_id}\n{article_url}"

        existing_article = await session.get(Article, article_id)
        if existing_article:
            existing_article.title = issue_title
            existing_article.clean_title = issue_title
            existing_article.summary = digest_data.get("summary", "")
            existing_article.content = digest_data.get("content", "")
            existing_article.published_at = datetime.datetime.utcnow()
            existing_article.fetched_at = datetime.datetime.utcnow()
            existing_article.is_read = False
            existing_article.triage_signals = [
                {"dimension": "quality", "effect": 0.5, "evidence": f"聚合 {len(valid_topics)} 篇精选议题", "label": "社区内参"}
            ]
            existing_article.triage_reason = f"AI 精选期刊：涵盖全论坛过去数小时高频议题与楼层讨论 ({edition_name})"
            article = existing_article
        else:
            article = Article(
                id=article_id,
                source_id=source_id,
                source_title=source_title,
                group_name=group_name,
                title=issue_title,
                clean_title=issue_title,
                url=article_url,
                summary=digest_data.get("summary", ""),
                content=digest_data.get("content", ""),
                value_tier="featured",
                value_score=0.95,
                rank_score=0.95,
                published_at=datetime.datetime.utcnow(),
                fetched_at=datetime.datetime.utcnow(),
                is_read=False,
                triage_signals=[
                    {"dimension": "quality", "effect": 0.5, "evidence": f"聚合 {len(valid_topics)} 篇精选议题", "label": "社区内参"}
                ],
                triage_reason=f"AI 精选期刊：涵盖全论坛过去数小时高频议题与楼层讨论 ({edition_name})"
            )
            session.add(article)

        # 5. Mark consumed staging topics
        if consumed_ids:
            await session.execute(
                update(ForumStagingTopic)
                .where(ForumStagingTopic.id.in_(consumed_ids))
                .values(is_consumed=True)
            )

        # 6. Ensure linuxdo-digest exists in feed_sources and update unread count
        db_source = await session.get(FeedSource, source_id)
        if not db_source:
            db_source = FeedSource(
                id=source_id,
                title=source_title,
                site_url="https://linux.do",
                feed_url="https://linux.do/digest",
                group_name=group_name,
                description="每日早/中/晚三刊：AI 深度聚合社区热点、干货开源与在役福利",
                status="active"
            )
            session.add(db_source)

        await session.commit()
        await session.refresh(article)

        # Update counter
        tot = await session.scalar(select(func.count(Article.id)).where(Article.source_id == source_id))
        unr = await session.scalar(select(func.count(Article.id)).where(Article.source_id == source_id, Article.is_read == False))
        db_source.article_count = tot or 0
        db_source.unread_count = unr or 0
        db_source.last_checked_at = datetime.datetime.utcnow()
        db_source.last_success_at = datetime.datetime.utcnow()
        await session.commit()

        # 7. Push Telegram notification for the new magazine issue
        import html as py_html
        clean_title = py_html.escape(issue_title)
        clean_summary = ai_service.markdown_to_telegram_html(digest_data.get("summary", ""))

        tg_text = f"""{clean_title}
📅 <code>{today_str}</code> · <b>全景速报 · 扫描 {len(valid_topics)} 个热点议题</b>
━━━━━━━━━━━━━━━━━━━━━━
<blockquote expandable>
{clean_summary}
</blockquote>"""
        reader_url = settings.PUBLIC_URL or "https://reader.cwsub.indevs.in"
        reply_markup = {
            "inline_keyboard": [
                [
                    {"text": "📖 阅读本期完整内参", "url": reader_url},
                    {"text": "🌐 访问论坛", "url": "https://linux.do"}
                ]
            ]
        }
        await ai_service.push_telegram_notification(tg_text, parse_mode="HTML", reply_markup=reply_markup)
        logger.info(f"LINUX DO Forum Digest ({today_str} {edition_name}) published successfully.")
        return article

