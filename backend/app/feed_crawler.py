import logging
import datetime
import asyncio
from typing import Any
import feedparser
import httpx
from bs4 import BeautifulSoup
from dateutil import parser as date_parser
from sqlalchemy import select, delete, func, desc
from .database import async_session
from .models import FeedSource, Article, ReaderPreference, DigestRecord
from .default_feeds import DEFAULT_FEED_SOURCES
from .ai_service import ai_service
from .config import settings

logger = logging.getLogger("rss_reader.crawler")

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
                        url=url,
                        summary=summary,
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
                    # Update summary if empty
                    if not existing_article.summary and summary:
                        existing_article.summary = summary

            # Rule 8.3: 50-article retention protection
            # Find all articles for this source ordered by published_at DESC
            stmt = select(Article.id).where(Article.source_id == source_id).order_by(desc(Article.published_at))
            res = await session.execute(stmt)
            all_ids = [row[0] for row in res.fetchall()]

            if len(all_ids) > 50:
                # Articles eligible for pruning: those beyond top 50 AND not in current_batch_ids
                candidates = all_ids[50:]
                to_delete = [aid for aid in candidates if aid not in current_batch_ids]
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
    Asynchronously runs AI triage and summary pre-computation for new articles.
    Ensures 0 latency when the user views the articles!
    """
    for a in articles[:10]: # Batch up to 10 to avoid bursting
        try:
            async with async_session() as session:
                pref = await session.get(ReaderPreference, 1)
                if pref and pref.pure_rule_mode:
                    break # Skip AI in pure rule mode

                # 1. AI Triage with multi-layer filtering
                triage = await ai_service.triage_article(
                    a.title,
                    a.summary or "",
                    a.source_title,
                    group_name=a.group_name,
                    discussion_posts=a.discussion_posts or [],
                    extra_meta={"source_id": a.source_id}
                )
                
                # 2. AI Summary
                ai_sum = await ai_service.summarize_article(a.title, a.summary or "", pref.summary_model if pref else None)

                # Re-fetch article to update
                db_a = await session.get(Article, a.id)
                if db_a:
                    db_a.value_tier = triage.get("value_tier", "general")
                    db_a.value_score = triage.get("value_score", 0.5)
                    db_a.quality_score = triage.get("quality_score", 0.5)
                    db_a.promotion_score = triage.get("promotion_score", 0.0)
                    db_a.expiry_score = triage.get("expiry_score", 0.0)
                    db_a.triage_reason = triage.get("reason", "")
                    db_a.triage_signals = triage.get("signals", [])
                    db_a.rank_score = triage.get("rank_score", 0.5)
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
        brief_html = ai_service.markdown_to_telegram_html(brief["content"])

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
