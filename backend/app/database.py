import os
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
        # Migration: DROP dead table article_images (verified zero references across codebase)
        try:
            await conn.execute(text("DROP TABLE IF EXISTS article_images;"))
        except Exception:
            pass

        # SQLite FTS5 setup (external content table + triggers + backfill)
        if settings.DATABASE_URL.startswith("sqlite"):
            try:
                await conn.execute(text("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
                        title,
                        summary,
                        content,
                        content='articles',
                        content_rowid='rowid'
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
                logger.info("SQLite FTS5 index verified/rebuilt successfully.")
            except Exception as e:
                logger.warning(f"SQLite FTS5 setup skipped or failed: {e}")



async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
