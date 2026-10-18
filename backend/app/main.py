import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from .config import settings
from .database import init_db
from .feed_crawler import init_default_sources, refresh_all_feeds, run_daily_brief_job, generate_forum_digest_job
from .api import router as api_router, public_router

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s in %(name)s: %(message)s"
)
logger = logging.getLogger("rss_reader")

scheduler = AsyncIOScheduler(timezone=settings.TZ)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing RSS Reader Backend...")
    await init_db()
    await init_default_sources()

    # Schedule tasks
    scheduler.add_job(
        refresh_all_feeds,
        trigger=IntervalTrigger(minutes=settings.FEED_REFRESH_INTERVAL_MINUTES),
        id="refresh_feeds_job",
        replace_existing=True,
    )
    scheduler.add_job(
        run_daily_brief_job,
        trigger=CronTrigger(hour=settings.DAILY_BRIEF_CRON_HOUR, minute=settings.DAILY_BRIEF_CRON_MINUTE),
        id="daily_brief_job",
        replace_existing=True,
    )
    # LINUX DO 社区内参每日三刊制 (08:30 晨报 / 12:30 午报 / 21:00 晚报)
    scheduler.add_job(
        generate_forum_digest_job,
        trigger=CronTrigger(hour=8, minute=30),
        id="forum_digest_morning",
        replace_existing=True,
    )
    scheduler.add_job(
        generate_forum_digest_job,
        trigger=CronTrigger(hour=12, minute=30),
        id="forum_digest_noon",
        replace_existing=True,
    )
    scheduler.add_job(
        generate_forum_digest_job,
        trigger=CronTrigger(hour=21, minute=0),
        id="forum_digest_evening",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(f"Schedulers started. Feeds every {settings.FEED_REFRESH_INTERVAL_MINUTES}m, Daily Brief at {settings.DAILY_BRIEF_CRON_HOUR}:{settings.DAILY_BRIEF_CRON_MINUTE:02d}, LINUX DO Digest at 08:30, 12:30, 21:00.")

    # Run an initial background check non-blocking
    import asyncio
    asyncio.create_task(refresh_all_feeds())

    yield

    logger.info("Shutting down schedulers...")
    scheduler.shutdown()

app = FastAPI(title="RSS Reader", version="1.0.0", lifespan=lifespan)

# Allow CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public_router)
app.include_router(api_router)

# Mount Static Frontend if built
static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
if not os.path.exists(static_dir):
    # Try frontend/dist
    frontend_dist = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "frontend", "dist")
    if os.path.exists(frontend_dist):
        static_dir = frontend_dist

if os.path.exists(static_dir):
    logger.info(f"Mounting static files from {static_dir}")
    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
    async def serve_spa(full_path: str):
        file_path = os.path.join(static_dir, full_path)
        if full_path and os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(static_dir, "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
