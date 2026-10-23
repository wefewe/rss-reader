import os
import re
import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import text
from .config import settings

logger = logging.getLogger("rss_reader.db")

# If sqlite, ensure directory exists
if settings.DATABASE_URL.startswith("sqlite"):
    db_path = settings.DATABASE_URL.replace("sqlite+aiosqlite:///", "")
    if db_path.startswith("/"):
        dir_name = os.path.dirname(db_path)
        if dir_name:
            os.makedirs(dir_name, exist_ok=True)

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True,
    pool_pre_ping=True
)

async_session = async_sessionmaker(
    engine, expire_on_commit=False, class_=AsyncSession
)

Base = declarative_base()

async def init_db():
    from . import models  # Ensure all model schemas are registered to Base.metadata
    async with engine.begin() as conn:
        if settings.DATABASE_URL.startswith("sqlite"):
            # Enable WAL mode for high concurrency
            await conn.execute(text("PRAGMA journal_mode=WAL;"))
            await conn.execute(text("PRAGMA synchronous=NORMAL;"))
        await conn.run_sync(Base.metadata.create_all)
        # Migration: ensure default_sort column exists on reader_preferences
        try:
            await conn.execute(text("ALTER TABLE reader_preferences ADD COLUMN default_sort VARCHAR(20) DEFAULT 'rank';"))
        except Exception:
            pass
        # Migration: ensure muted_keywords column exists on reader_preferences
        try:
            await conn.execute(text("ALTER TABLE reader_preferences ADD COLUMN muted_keywords JSON DEFAULT '[]';"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE articles ADD COLUMN clean_title VARCHAR(500);"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE articles ADD COLUMN bilingual_content TEXT;"))
        except Exception:
            pass
        # Data migration for forum topics: populate content from summary if content is empty
        try:
            await conn.execute(text("UPDATE articles SET content = summary WHERE (content IS NULL OR content = '') AND source_id LIKE 'linuxdo%' AND summary IS NOT NULL AND summary != '';"))
        except Exception:
            pass
        # Upgrade default model to ultra-fast gemini-3.8-flash
        try:
            await conn.execute(text("UPDATE reader_preferences SET summary_model = 'gemini-3.8-flash' WHERE summary_model = 'deepseek-v4.1-flash';"))
        except Exception:
            pass
        # Clean up legacy raw LINUX DO individual flood articles to clear the stream
        try:
            await conn.execute(text("DELETE FROM articles WHERE source_id IN ('linuxdo-gossip', 'linuxdo-welfare', 'linuxdo-resource');"))
            await conn.execute(text("DELETE FROM feed_sources WHERE id IN ('linuxdo-gossip', 'linuxdo-welfare', 'linuxdo-resource');"))
        except Exception:
            pass
        # Migration: ensure etag and last_modified columns exist on feed_sources
        try:
            await conn.execute(text("ALTER TABLE feed_sources ADD COLUMN etag VARCHAR(255);"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE feed_sources ADD COLUMN last_modified VARCHAR(255);"))
        except Exception:
            pass
        # Migration: ensure consecutive_failures column exists on feed_sources
        try:
            await conn.execute(text("ALTER TABLE feed_sources ADD COLUMN consecutive_failures INTEGER DEFAULT 0;"))
        except Exception:
            pass
        # Migration: ensure source_kind column exists on feed_sources
        try:
            await conn.execute(text("ALTER TABLE feed_sources ADD COLUMN source_kind VARCHAR(50) DEFAULT 'rss';"))
        except Exception:
            pass
        # Idempotent backfill: mark external feeds (linux.do/c/*.rss or group_name='外部投喂') as source_kind='external'
        try:
            await conn.execute(text("""
                UPDATE feed_sources 
                SET source_kind = 'external' 
                WHERE id != 'linuxdo-digest' 
                  AND (feed_url LIKE '%linux.do/c/%.rss' OR group_name = '外部投喂' OR id IN ('11', '36', '14'));
            """))
        except Exception:
            pass
        # Migration: DROP dead table article_images (verified zero references across codebase)
        try:
            await conn.execute(text("DROP TABLE IF EXISTS article_images;"))
        except Exception:
            pass

        # Migration: WO-20261023-09 Idempotent deduplication cleanup for existing articles
        await _cleanup_duplicate_articles(conn)

        # SQLite FTS5 setup (external content table + triggers + backfill)
        if settings.DATABASE_URL.startswith("sqlite"):
            try:
                # WO-20261023-09: Check if articles_fts already exists and if it uses trigram tokenizer
                row = await conn.execute(text("SELECT sql FROM sqlite_master WHERE type='table' AND name='articles_fts';"))
                fts_sql = row.scalar()
                if fts_sql and "trigram" not in fts_sql.lower():
                    logger.info("Migrating articles_fts to trigram tokenizer (dropping old index)...")
                    await conn.execute(text("DROP TABLE IF EXISTS articles_fts;"))
                    await conn.execute(text("DROP TRIGGER IF EXISTS articles_ai;"))
                    await conn.execute(text("DROP TRIGGER IF EXISTS articles_ad;"))
                    await conn.execute(text("DROP TRIGGER IF EXISTS articles_au;"))

                await conn.execute(text("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
                        title,
                        summary,
                        content,
                        content='articles',
                        content_rowid='rowid',
                        tokenize='trigram'
                    );
                """))
                await conn.execute(text("""
                    CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
                        INSERT INTO articles_fts(rowid, title, summary, content) 
                        VALUES (new.rowid, new.title, coalesce(new.summary, ''), coalesce(new.content, ''));
                    END;
                """))
                await conn.execute(text("""
                    CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
                        INSERT INTO articles_fts(articles_fts, rowid, title, summary, content) 
                        VALUES ('delete', old.rowid, old.title, coalesce(old.summary, ''), coalesce(old.content, ''));
                    END;
                """))
                await conn.execute(text("""
                    CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE OF title, summary, content ON articles BEGIN
                        INSERT INTO articles_fts(articles_fts, rowid, title, summary, content) 
                        VALUES ('delete', old.rowid, old.title, coalesce(old.summary, ''), coalesce(old.content, ''));
                        INSERT INTO articles_fts(rowid, title, summary, content) 
                        VALUES (new.rowid, new.title, coalesce(new.summary, ''), coalesce(new.content, ''));
                    END;
                """))
                # Idempotent backfill: rebuild FTS index from articles
                await conn.execute(text("INSERT INTO articles_fts(articles_fts) VALUES('rebuild');"))
                logger.info("SQLite FTS5 trigram index verified/rebuilt successfully.")
            except Exception as e:
                logger.warning(f"SQLite FTS5 setup skipped or failed: {e}")


CLICKBAIT_PATTERNS = [
    r"^【(?:突发|重磅|震惊|速看|提醒|重磅推荐|独家|大事件|官宣)】\s*",
    r"^\[(?:突发|重磅|震惊|速看|提醒|独家|官宣)\]\s*",
    r"^(?:突发|重磅|震惊|速看|彻底告别|绝了|惊呆|终于来了|紧急提醒|重大通知)[!！：:\s]+",
    r"^(?:不可思议|彻底颠覆|太强了|居然这么简单|炸裂)[!！：:\s]+",
    r"[，,\s]*(?:快上车|建议收藏|速度领|太炸裂了|赶紧看|千万别错过)[!！]*$",
]

def normalize_article_title(raw_title: str) -> str:
    if not raw_title:
        return ""
    cleaned = raw_title.strip()
    for pat in CLICKBAIT_PATTERNS:
        cleaned = re.sub(pat, "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip()
    return cleaned if cleaned else raw_title.strip()

async def _cleanup_duplicate_articles(conn):
    """
    WO-20261023-09:
    按 (source_id, 归一化标题) 分组，每组只保留一份：
    优先 is_starred，其次 is_read，其次 content 最长，其次最早入库；
    被删行的 highlights 若存在需改挂到保留行。
    清理后 articles_fts 保持一致。
    幂等执行。
    """
    try:
        # Check if articles table exists first
        chk = await conn.execute(text("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='articles';"))
        if not chk.scalar():
            return

        res = await conn.execute(text("""
            SELECT id, source_id, title, clean_title, url, content, is_read, is_starred, fetched_at 
            FROM articles;
        """))
        rows = res.fetchall()
        if not rows:
            return

        groups = {}
        for r in rows:
            aid, s_id, title, clean_title, url, content, is_read, is_starred, fetched_at = r
            raw_t = clean_title or title or ""
            norm_t = normalize_article_title(raw_t)
            if not norm_t or not s_id:
                continue
            key = (s_id, norm_t)
            groups.setdefault(key, []).append({
                "id": aid,
                "source_id": s_id,
                "title": title,
                "url": url,
                "content": content,
                "is_read": bool(is_read),
                "is_starred": bool(is_starred),
                "fetched_at": str(fetched_at) if fetched_at else "9999-99-99",
            })

        dup_groups = {k: v for k, v in groups.items() if len(v) > 1}
        if not dup_groups:
            logger.info("Duplicate article check: 0 duplicate groups found.")
            return

        total_deleted = 0
        migrated_highlights = 0

        # Check if article_highlights table exists
        hl_table_chk = await conn.execute(text("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='article_highlights';"))
        has_highlights_table = bool(hl_table_chk.scalar())

        for (s_id, norm_t), items in dup_groups.items():
            # Retention priority:
            # 1. is_starred (True > False)
            # 2. is_read (True > False)
            # 3. len(content) (longest > shortest)
            # 4. earliest fetched_at
            def priority_tuple(item):
                starred = 1 if item["is_starred"] else 0
                read = 1 if item["is_read"] else 0
                cnt_len = len(item["content"] or "")
                fat = item["fetched_at"] or "9999-99-99"
                return (-starred, -read, -cnt_len, fat, item["id"])

            sorted_items = sorted(items, key=priority_tuple)
            winner = sorted_items[0]
            victims = sorted_items[1:]

            victim_ids = [v["id"] for v in victims]
            total_deleted += len(victim_ids)

            # Re-link any highlights from victim articles to the winner article
            if has_highlights_table:
                for v in victims:
                    hl_res = await conn.execute(
                        text("""
                            UPDATE article_highlights
                            SET article_id = :winner_id,
                                article_title = :winner_title,
                                article_url = :winner_url
                            WHERE article_id = :victim_id;
                        """),
                        {
                            "winner_id": winner["id"],
                            "winner_title": winner["title"],
                            "winner_url": winner["url"],
                            "victim_id": v["id"]
                        }
                    )
                    if hl_res.rowcount and hl_res.rowcount > 0:
                        migrated_highlights += hl_res.rowcount

            # Delete victim articles
            for v_id in victim_ids:
                await conn.execute(text("DELETE FROM articles WHERE id = :vid;"), {"vid": v_id})

        logger.info(
            f"WO-20261023-09 duplicate cleanup completed: deleted {total_deleted} duplicate articles "
            f"across {len(dup_groups)} groups (re-linked {migrated_highlights} highlights)."
        )
    except Exception as e:
        logger.warning(f"Duplicate article cleanup error (non-fatal): {e}")



async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
