import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:////data/reader.db")
    SECRET_KEY: str = os.getenv("SECRET_KEY", "rss_reader_secret_key")
    
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
