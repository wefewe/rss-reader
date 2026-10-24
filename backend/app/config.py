import os
import secrets
from typing import List
from pydantic_settings import BaseSettings

_env_secret_key = os.getenv("SECRET_KEY", "").strip()
_is_secret_generated = False
if not _env_secret_key:
    _env_secret_key = secrets.token_urlsafe(32)
    _is_secret_generated = True

class Settings(BaseSettings):
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:////data/reader.db")
    SECRET_KEY: str = _env_secret_key
    IS_SECRET_KEY_GENERATED: bool = _is_secret_generated
    
    # CORS White-list
    READER_CORS_ORIGINS: str = os.getenv(
        "READER_CORS_ORIGINS",
        "https://reader.cwsub.indevs.in,http://localhost:5173,http://localhost:8000,http://127.0.0.1:5173,http://127.0.0.1:8000"
    )

    @property
    def cors_origins_list(self) -> List[str]:
        raw = self.READER_CORS_ORIGINS or ""
        return [item.strip() for item in raw.split(",") if item.strip()]

    # Authentication
    READER_PASSWORD: str = os.getenv("READER_PASSWORD", "")
    READER_API_KEY: str = os.getenv("READER_API_KEY", "")

    # LLM Settings (AxonHub OpenAI compatible)
    LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "http://axonhub:8090/v1")
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    LLM_SUMMARY_MODEL: str = os.getenv("LLM_SUMMARY_MODEL", "deepseek-v4.1-flash")
    LLM_BRIEF_MODEL: str = os.getenv("LLM_BRIEF_MODEL", "gpt-5.6-terra")
    
    # Crawler and Scheduling
    FEED_REFRESH_INTERVAL_MINUTES: int = int(os.getenv("FEED_REFRESH_INTERVAL_MINUTES", "30"))
    DAILY_BRIEF_CRON_HOUR: int = int(os.getenv("DAILY_BRIEF_CRON_HOUR", "9"))
    DAILY_BRIEF_CRON_MINUTE: int = int(os.getenv("DAILY_BRIEF_CRON_MINUTE", "0"))
    
    # Telegram Push
    TG_BOT_TOKEN: str = os.getenv("TG_BOT_TOKEN", "")
    TG_CHAT_ID: str = os.getenv("TG_CHAT_ID", "")
    PUBLIC_URL: str = os.getenv("PUBLIC_URL", "")
    TZ: str = os.getenv("TZ", "Asia/Shanghai")

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()

# WO-20261024-12: Backlog calculation rules (Rule 6)
# Articles older than BACKLOG_THRESHOLD_DAYS, unread, unstarred, and in BACKLOG_VALUE_TIERS are considered backlog.
BACKLOG_THRESHOLD_DAYS: int = 14
BACKLOG_VALUE_TIERS: tuple = ("general", "hidden")
