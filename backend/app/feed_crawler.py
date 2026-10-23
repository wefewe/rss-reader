import logging
import datetime
import asyncio
import re
import urllib.parse
from typing import Any, Optional, List, Dict
import feedparser
import httpx
import trafilatura
from bs4 import BeautifulSoup
from dateutil import parser as date_parser
from sqlalchemy import select, delete, func, desc, update, or_, and_
from .database import async_session
from .models import FeedSource, Article, ReaderPreference, DigestRecord, ForumStagingTopic, ArticleHighlight
from .default_feeds import DEFAULT_FEED_SOURCES
from .ai_service import ai_service
from .config import settings

logger = logging.getLogger("rss_reader.crawler")

# Concurrency guards (R6 audit)
_refresh_all_lock = asyncio.Lock()
_enrich_semaphore = asyncio.Semaphore(2)

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

def normalize_url(url: str) -> str:
    """
    Normalizes article URL for deduplication:
    - Strips utm_* and other common tracking parameters (spm, fbclid, gclid, etc.)
    - Normalizes trailing slashes (strips trailing slash for non-root paths)
    - Lowercases scheme and hostname
    - Strips fragment (#...)
    """
    if not url:
        return ""
    try:
        parts = urllib.parse.urlsplit(url.strip())
        if not parts.scheme or not parts.netloc:
            return url.strip()

        query_pairs = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
        filtered_pairs = [
            (k, v) for k, v in query_pairs
            if not k.lower().startswith("utm_") and k.lower() not in ("spm", "fbclid", "gclid", "ref", "from_source")
        ]
        new_query = urllib.parse.urlencode(filtered_pairs)

        path = parts.path
        if len(path) > 1 and path.endswith("/"):
            path = path.rstrip("/")

        scheme = parts.scheme.lower()
        netloc = parts.netloc.lower()

        clean_url = urllib.parse.urlunsplit((scheme, netloc, path, new_query, ""))
        return clean_url
    except Exception:
        return url.strip()

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

def _sync_parse_feed(content: bytes) -> tuple[list, Optional[str]]:
    """
    Synchronous CPU-bound parsing of RSS/Atom feed XML and entry content.
    Executed in a thread pool to avoid blocking the event loop.
    Returns: (parsed_items, bozo_error)
    """
    feed = feedparser.parse(content)
    if feed.bozo and not feed.entries:
        return [], str(feed.bozo_exception)

    parsed_items = []
    for entry in feed.entries[:50]:
        url = entry.get("link", "").strip()
        if not url:
            continue

        title = entry.get("title", "无标题").strip()
        raw_summary = entry.get("summary") or entry.get("description") or ""
        summary = clean_html(raw_summary)[:1000]

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

        guid = (entry.get("id") or entry.get("guid") or "").strip()
        if guid.startswith(("http://", "https://")):
            guid = normalize_url(guid)
        norm_url = normalize_url(url)

        parsed_items.append({
            "url": norm_url,
            "raw_url": url,
            "guid": guid,
            "title": title,
            "clean_title": debuzz_title(title),
            "summary": summary,
            "content": content_md,
            "image_url": entry_img,
            "published_at": published_at,
        })

    return parsed_items, None

async def fetch_single_feed(
    source: FeedSource,
    client: Optional[httpx.AsyncClient] = None,
    sem: Optional[asyncio.Semaphore] = None,
):
    """
    Fetches and parses a single RSS feed with conditional requests (ETag / Last-Modified),
    semaphore concurrency throttling, and offloaded parsing to thread pool.
    Enforces 50-article retention with protection for the current batch.
    """
    # Exemption Rule 8.4: LINUX DO sources are managed exclusively by external browser worker
    if "linux.do" in source.feed_url:
        logger.info(f"Skipping direct HTTP fetch for {source.title} (managed exclusively by external Playwright worker)")
        return

    source_id = source.id
    source_title = source.title
    group_name = source.group_name

    # Conditional HTTP headers
    req_headers = dict(HEADERS)
    if source.etag:
        req_headers["If-None-Match"] = source.etag
    if source.last_modified:
        req_headers["If-Modified-Since"] = source.last_modified

    async def _do_http_get(http_client: httpx.AsyncClient) -> httpx.Response:
        logger.info(f"Checking feed: {source_title} ({source.feed_url})")
        return await http_client.get(source.feed_url, headers=req_headers)

    retry_delays = [30, 120]
    resp = None
    last_exc = None

    for attempt in range(len(retry_delays) + 1):
        try:
            if sem:
                async with sem:
                    if client:
                        resp = await _do_http_get(client)
                    else:
                        async with httpx.AsyncClient(headers=HEADERS, timeout=20.0, follow_redirects=True, verify=False) as c:
                            resp = await _do_http_get(c)
            else:
                if client:
                    resp = await _do_http_get(client)
                else:
                    async with httpx.AsyncClient(headers=HEADERS, timeout=20.0, follow_redirects=True, verify=False) as c:
                        resp = await _do_http_get(c)

            if resp.status_code >= 400:
                raise Exception(f"HTTP {resp.status_code} {resp.reason_phrase}")

            last_exc = None
            break
        except Exception as e:
            last_exc = e
            if attempt < len(retry_delays):
                delay = retry_delays[attempt]
                logger.warning(f"Fetch attempt {attempt + 1} failed for {source_title} ({source.feed_url}): {e}. Retrying in {delay}s...")
                await asyncio.sleep(delay)
            else:
                logger.error(f"All {len(retry_delays) + 1} attempts failed for {source_title} ({source.feed_url}): {e}")

    if last_exc is not None:
        async with async_session() as session:
            db_source = await session.get(FeedSource, source_id)
            if db_source:
                db_source.last_checked_at = datetime.datetime.utcnow()
                db_source.last_error = str(last_exc)
                db_source.consecutive_failures = (db_source.consecutive_failures or 0) + 1
                if db_source.consecutive_failures >= 10:
                    db_source.status = "disabled"
                    logger.warning(
                        f"Feed {source_title} reached {db_source.consecutive_failures} consecutive failures. Auto-disabling feed."
                    )
                else:
                    db_source.status = "error"
                await session.commit()
        return

    # Handle 304 Not Modified: skip parsing and enrichment entirely
    if resp.status_code == 304:
        logger.info(f"304 Not Modified for {source_title} ({source.feed_url}) - skipping parsing and enrichment")
        async with async_session() as session:
            db_source = await session.get(FeedSource, source_id)
            if db_source:
                db_source.last_checked_at = datetime.datetime.utcnow()
                db_source.last_success_at = datetime.datetime.utcnow()
                db_source.last_error = None
                db_source.consecutive_failures = 0
                db_source.status = "active"
                await session.commit()
        return

    try:
        content = resp.content
        new_etag = resp.headers.get("etag")
        new_last_modified = resp.headers.get("last-modified")

        # Parse XML and extract rich content in worker thread pool
        parsed_items, parse_err = await asyncio.to_thread(_sync_parse_feed, content)
        if parse_err:
            raise Exception(f"Invalid XML / Feed parse error: {parse_err}")

        current_batch_ids = set()
        new_articles = []

        async with async_session() as session:
            # Re-fetch source to update metadata inside transaction
            db_source = await session.get(FeedSource, source_id)
            if not db_source:
                return

            db_source.last_checked_at = datetime.datetime.utcnow()
            if new_etag:
                db_source.etag = new_etag
            if new_last_modified:
                db_source.last_modified = new_last_modified

            for item in parsed_items:
                norm_url = item["url"]
                raw_url = item.get("raw_url", norm_url)
                guid = item.get("guid")
                item_key = guid if guid else norm_url
                article_id = f"{source_id}\n{item_key}"

                # 既有文章不回溯改键，避免重复入库
                existing_article = await session.get(Article, article_id)
                if not existing_article and guid:
                    old_id_norm = f"{source_id}\n{norm_url}"
                    existing_article = await session.get(Article, old_id_norm)
                    if not existing_article and raw_url != norm_url:
                        old_id_raw = f"{source_id}\n{raw_url}"
                        existing_article = await session.get(Article, old_id_raw)
                if not existing_article:
                    stmt_match = select(Article).where(
                        Article.source_id == source_id,
                        or_(Article.url == norm_url, Article.url == raw_url)
                    ).limit(1)
                    res_match = await session.execute(stmt_match)
                    existing_article = res_match.scalars().first()

                if not existing_article:
                    current_batch_ids.add(article_id)
                    art = Article(
                        id=article_id,
                        source_id=source_id,
                        source_title=source_title,
                        group_name=group_name,
                        title=item["title"],
                        clean_title=item["clean_title"],
                        url=norm_url,
                        summary=item["summary"],
                        content=item["content"],
                        image_url=item["image_url"],
                        published_at=item["published_at"],
                        fetched_at=datetime.datetime.utcnow(),
                        is_read=False,
                        value_tier="general",
                        value_score=0.5,
                        rank_score=0.5,
                    )
                    session.add(art)
                    new_articles.append(art)
                else:
                    current_batch_ids.add(existing_article.id)
                    # Update summary/content/image if empty
                    if not existing_article.summary and item["summary"]:
                        existing_article.summary = item["summary"]
                    if not existing_article.content and item["content"]:
                        existing_article.content = item["content"]
                    if not existing_article.image_url and item["image_url"]:
                        existing_article.image_url = item["image_url"]

            # Rule 8.3: 50-article retention protection (excluding starred and highlighted articles)
            stmt = select(Article.id).where(Article.source_id == source_id).order_by(desc(Article.published_at))
            res = await session.execute(stmt)
            all_ids = [row[0] for row in res.fetchall()]

            if len(all_ids) > 50:
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
            db_source.consecutive_failures = 0
            db_source.status = "active"

            await session.commit()

        # Background AI enrichment for newly discovered articles
        if new_articles:
            asyncio.create_task(enrich_new_articles(new_articles))

    except Exception as e:
        logger.error(f"Error parsing/saving feed {source_title}: {e}")
        async with async_session() as session:
            db_source = await session.get(FeedSource, source_id)
            if db_source:
                db_source.last_checked_at = datetime.datetime.utcnow()
                db_source.last_error = str(e)
                db_source.consecutive_failures = (db_source.consecutive_failures or 0) + 1
                if db_source.consecutive_failures >= 10:
                    db_source.status = "disabled"
                    logger.warning(
                        f"Feed {source_title} reached {db_source.consecutive_failures} consecutive failures. Auto-disabling feed."
                    )
                else:
                    db_source.status = "error"
                await session.commit()

async def enrich_new_articles(articles: list):
    """
    Asynchronously runs full-text extraction (for summary-only feeds),
    AI triage and summary pre-computation for new articles.
    Guarded by global _enrich_semaphore to avoid burst LLM / write conflicts.
    Ensures 0 latency when the user views the articles!
    """
    if not articles:
        return

    async with _enrich_semaphore:
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

async def cleanup_forum_staging_topics() -> int:
    """
    Cleans up expired forum staging topics:
    - is_consumed=True and scraped_at older than 7 days
    - unconsumed (is_consumed=False or NULL) and scraped_at older than 7 days (owner decided 2026-10-23)
    Logs the count before deletion.
    If count > 1000 in a single run, skips deletion and logs an alert.
    """
    now = datetime.datetime.utcnow()
    cutoff_consumed = now - datetime.timedelta(days=7)
    cutoff_unconsumed = now - datetime.timedelta(days=7)

    async with async_session() as session:
        cond = or_(
            and_(ForumStagingTopic.is_consumed == True, ForumStagingTopic.scraped_at < cutoff_consumed),
            and_(or_(ForumStagingTopic.is_consumed == False, ForumStagingTopic.is_consumed.is_(None)), ForumStagingTopic.scraped_at < cutoff_unconsumed)
        )
        count_stmt = select(func.count(ForumStagingTopic.id)).where(cond)
        count_res = await session.execute(count_stmt)
        to_delete_count = count_res.scalar() or 0

        logger.info(f"[StagingCleanup] Found {to_delete_count} expired forum staging topics to clean up.")
        if to_delete_count > 1000:
            logger.warning(
                f"[StagingCleanup] Abnormal staging topics cleanup count: {to_delete_count} > 1000. Skipping deletion for safety and logging alert."
            )
            return to_delete_count

        if to_delete_count > 0:
            del_stmt = delete(ForumStagingTopic).where(cond)
            await session.execute(del_stmt)
            await session.commit()
            logger.info(f"[StagingCleanup] Successfully deleted {to_delete_count} expired forum staging topics.")

        return to_delete_count


async def cleanup_digest_records(days: int = 90) -> int:
    """
    Purges digest records older than specified retention days (default 90 days).
    """
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    async with async_session() as session:
        count_stmt = select(func.count(DigestRecord.id)).where(DigestRecord.created_at < cutoff)
        count_res = await session.execute(count_stmt)
        to_delete_count = count_res.scalar() or 0

        logger.info(f"[DigestCleanup] Found {to_delete_count} digest records older than {days} days to clean up.")
        if to_delete_count > 0:
            del_stmt = delete(DigestRecord).where(DigestRecord.created_at < cutoff)
            await session.execute(del_stmt)
            await session.commit()
            logger.info(f"[DigestCleanup] Successfully purged {to_delete_count} digest records older than {days} days.")
        return to_delete_count


async def refresh_all_feeds():
    """Refreshes all active feeds asynchronously with concurrency lock and reused AsyncClient."""
    if _refresh_all_lock.locked():
        logger.info("Feed refresh is already in progress, skipping duplicate trigger.")
        return

    async with _refresh_all_lock:
        logger.info("Starting background refresh of all feeds...")
        async with async_session() as session:
            # Exclude feeds that have been auto-disabled (consecutive_failures >= 10) or user-paused
            stmt = select(FeedSource).where(FeedSource.status.notin_(["disabled", "user_paused"]))
            res = await session.execute(stmt)
            sources = res.scalars().all()

        sem = asyncio.Semaphore(5)
        async with httpx.AsyncClient(headers=HEADERS, timeout=20.0, follow_redirects=True, verify=False) as client:
            tasks = [fetch_single_feed(s, client=client, sem=sem) for s in sources]
            await asyncio.gather(*tasks, return_exceptions=True)
        logger.info("All feeds refreshed.")

        # Lifecycle cleanup of staging topics
        try:
            await cleanup_forum_staging_topics()
        except Exception as e:
            logger.error(f"Error during forum staging topics cleanup: {e}")

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

        # Purge digest records older than 90 days
        try:
            await cleanup_digest_records(90)
        except Exception as e:
            logger.error(f"Error cleaning up old digest records: {e}")

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

async def discover_and_validate_feed(raw_url: str) -> Dict[str, Any]:
    """
    Validates a feed URL or discovers feeds from a website HTML page (link rel=alternate).
    Returns a dict with: feed_url, site_url, title, description.
    Raises ValueError if cannot reach or find valid feed.
    """
    url = raw_url.strip()
    if not url:
        raise ValueError("订阅地址不能为空")

    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    async with httpx.AsyncClient(headers=HEADERS, timeout=18.0, follow_redirects=True, verify=False) as client:
        try:
            resp = await client.get(url)
        except Exception as e:
            raise ValueError(f"无法连接到该地址 ({url}): {e}")

        if resp.status_code >= 400:
            raise ValueError(f"访问请求失败: HTTP {resp.status_code} {resp.reason_phrase}")

        content_bytes = resp.content
        final_url = str(resp.url)

        # 1. Try parsing directly as RSS/Atom
        parsed = await asyncio.to_thread(feedparser.parse, content_bytes)
        has_entries = len(parsed.entries) > 0
        feed_title = parsed.feed.get("title", "").strip() if hasattr(parsed, "feed") else ""

        if has_entries or (feed_title and getattr(parsed, "version", None)):
            site_link = parsed.feed.get("link", "").strip() or final_url
            return {
                "feed_url": final_url,
                "site_url": site_link,
                "title": feed_title or urllib.parse.urlsplit(final_url).netloc,
                "description": parsed.feed.get("description", "") or "",
            }

        # 2. Not directly a feed, try HTML page link rel="alternate" feed discovery
        html_text = resp.text
        soup = BeautifulSoup(html_text, "html.parser")
        candidate_feeds = []

        for link in soup.find_all("link", rel=lambda r: r and "alternate" in r.lower()):
            l_type = (link.get("type") or "").lower()
            href = (link.get("href") or "").strip()
            if not href:
                continue
            if any(t in l_type for t in ["application/rss+xml", "application/atom+xml", "application/xml", "text/xml", "application/json"]):
                abs_href = urllib.parse.urljoin(final_url, href)
                candidate_feeds.append((abs_href, link.get("title") or ""))

        # Fallback common feed paths if no link tag
        if not candidate_feeds:
            parsed_origin = urllib.parse.urlsplit(final_url)
            origin_base = f"{parsed_origin.scheme}://{parsed_origin.netloc}"
            for p in ["/feed", "/rss", "/rss.xml", "/atom.xml", "/feed.xml", "/index.xml"]:
                candidate_feeds.append((urllib.parse.urljoin(origin_base, p), ""))

        for cand_url, cand_title in candidate_feeds:
            try:
                cand_resp = await client.get(cand_url, timeout=12.0)
                if cand_resp.status_code == 200:
                    cand_parsed = await asyncio.to_thread(feedparser.parse, cand_resp.content)
                    if len(cand_parsed.entries) > 0 or (cand_parsed.feed.get("title") and getattr(cand_parsed, "version", None)):
                        detected_title = cand_title or cand_parsed.feed.get("title", "").strip()
                        if not detected_title and soup.title and soup.title.string:
                            detected_title = soup.title.string.strip()
                        return {
                            "feed_url": str(cand_resp.url),
                            "site_url": cand_parsed.feed.get("link", "").strip() or final_url,
                            "title": detected_title or urllib.parse.urlsplit(final_url).netloc,
                            "description": cand_parsed.feed.get("description", "") or "",
                        }
            except Exception:
                continue

        raise ValueError("未能从该 URL 解析出有效的 RSS/Atom 内容，且未能在网页中发现订阅链接")


