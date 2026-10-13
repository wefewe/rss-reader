import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import text
from .config import settings

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



async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
