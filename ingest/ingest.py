#!/usr/bin/env python3
"""
LINUX DO Ingestion Worker for AI RSS Reader
- Crawls 3 categories: gossip (11), welfare (36), resource (14)
- Uses Playwright Chromium with persistent _t cookie session
- Extracts topics within 7 days, loads {url}.json for posts
- Tracks watermark to only ingest new/updated floor discussions
- Jitter delays to protect Cloudflare reputation
- Telegram alert on session expiry
- Ingests into Reader API: http://rss-reader:8000/api/reader/ingestexternalfeed
"""

import os
import sys
import json
import time
import random
import asyncio
import logging
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from bs4 import BeautifulSoup
import httpx
from playwright.async_api import async_playwright

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s [linuxdo-ingest]: %(message)s"
)
logger = logging.getLogger("linuxdo-ingest")

DATA_DIR = "/data"
STORAGE_STATE_FILE = os.path.join(DATA_DIR, "storage_state.json")
WATERMARK_FILE = os.path.join(DATA_DIR, "watermark.json")
COOKIE_FILE = os.path.join(DATA_DIR, "linuxdo_cookie.txt")

READER_API_URL = os.getenv("READER_API_URL", "http://rss-reader:8000/api/reader/ingestexternalfeed")
READER_API_KEY = os.getenv("READER_API_KEY", "")
INTERVAL_MINUTES = int(os.getenv("INGEST_INTERVAL_MINUTES", "30"))

TG_BOT_TOKEN = os.getenv("TG_BOT_TOKEN", "")
TG_CHAT_ID = os.getenv("TG_CHAT_ID", "")

FEEDS = [
    {
        "id": "linuxdo-gossip",
        "title": "搞七捻三-LINUX DO",
        "rss_url": "https://linux.do/c/gossip/11.rss",
    },
    {
        "id": "linuxdo-welfare",
        "title": "福利羊毛-LINUX DO",
        "rss_url": "https://linux.do/c/welfare/36.rss",
    },
    {
        "id": "linuxdo-resource",
        "title": "资源荟萃-LINUX DO",
        "rss_url": "https://linux.do/c/resource/14.rss",
    },
]

async def send_telegram_alert(text: str):
    if not TG_BOT_TOKEN or not TG_CHAT_ID:
        return
    url = f"https://api.telegram.org/bot{TG_BOT_TOKEN}/sendMessage"
    payload = {"chat_id": TG_CHAT_ID, "text": text}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(url, json=payload)
    except Exception as e:
        logger.warning(f"Telegram notification failed: {e}")

def load_watermark() -> dict:
    if os.path.exists(WATERMARK_FILE):
        try:
            with open(WATERMARK_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_watermark(wm: dict):
    try:
        with open(WATERMARK_FILE, "w", encoding="utf-8") as f:
            json.dump(wm, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Failed to save watermark: {e}")

def get_cookie_value() -> str:
    if os.path.exists(STORAGE_STATE_FILE):
        try:
            with open(STORAGE_STATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                for c in data.get("cookies", []):
                    if c.get("name") == "_t":
                        return c.get("value", "")
        except Exception:
            pass
    if os.path.exists(COOKIE_FILE):
        try:
            with open(COOKIE_FILE, "r", encoding="utf-8") as f:
                return f.read().strip()
        except Exception:
            pass
    return ""

def clean_html(cooked: str) -> str:
    if not cooked:
        return ""
    soup = BeautifulSoup(cooked, "html.parser")
    for s in soup(["script", "style"]):
        s.decompose()
    return soup.get_text(separator=" ").strip()

async def push_to_reader(feed_url: str, entries: list) -> bool:
    if not entries:
        return True
    headers = {
        "Content-Type": "application/json",
        "X-Api-Key": READER_API_KEY,
    }
    payload = {
        "feed_url": feed_url,
        "entries": entries,
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(READER_API_URL, headers=headers, json=payload)
            if resp.status_code == 200:
                logger.info(f"Successfully ingested {len(entries)} topics into {feed_url}")
                return True
            else:
                logger.error(f"Ingest failed {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        logger.error(f"Failed to push to reader API: {e}")
    return False

async def crawl_feed(context, feed_info: dict, watermark: dict) -> list:
    rss_url = feed_info["rss_url"]
    logger.info(f"Fetching RSS: {feed_info['title']} ({rss_url})")

    page = await context.new_page()
    entries_to_push = []

    try:
        resp = await page.goto(rss_url, wait_until="domcontentloaded", timeout=25000)
        if not resp or resp.status != 200:
            logger.warning(f"RSS fetch status {resp.status if resp else 'None'} for {rss_url}")
            return []

        pre_elem = page.locator("pre")
        if await pre_elem.count() > 0:
            raw_xml = await pre_elem.inner_text()
        else:
            raw_xml = await page.content()

        root = ET.fromstring(raw_xml)
        items = root.findall(".//item")
        logger.info(f"Found {len(items)} items in {feed_info['title']}")

        for it in items[:25]: # Process top 25 topics per cycle
            title = it.findtext("title", "").strip()
            link = it.findtext("link", "").strip()
            pub_date_str = it.findtext("pubDate", "")

            if not link:
                continue

            last_max_post = watermark.get(link, 0)
            clean_url = link.split("?")[0].rstrip("/")
            json_url = f"{clean_url}.json"

            try:
                # Jitter delay before fetching topic JSON
                await asyncio.sleep(random.uniform(1.2, 2.8))

                logger.info(f"Opening topic JSON: {clean_url}")
                j_resp = await page.goto(json_url, wait_until="domcontentloaded", timeout=15000)
                if not j_resp or j_resp.status != 200:
                    logger.warning(f"Failed to load {json_url} (HTTP {j_resp.status if j_resp else 'None'})")
                    continue

                j_pre = page.locator("pre")
                if await j_pre.count() > 0:
                    raw_json = await j_pre.inner_text()
                else:
                    raw_json = await page.content()

                topic_data = json.loads(raw_json)
                posts = topic_data.get("post_stream", {}).get("posts", [])

                if not posts:
                    continue

                current_max_post = max(p.get("post_number", 1) for p in posts)

                # Skip if already fully ingested
                if last_max_post >= current_max_post:
                    continue

                main_post = posts[0]
                cooked = main_post.get("cooked", "")
                main_text = clean_html(cooked)

                # Extract first image if present
                img_url = None
                soup = BeautifulSoup(cooked, "html.parser")
                img_tag = soup.find("img")
                if img_tag and img_tag.get("src"):
                    img_url = img_tag["src"]

                # Discussion floor posts
                discussion_posts = []
                for p in posts[1:]:
                    discussion_posts.append({
                        "post_number": p.get("post_number", 0),
                        "author": p.get("username", "匿名"),
                        "posted_at": p.get("created_at"),
                        "content": clean_html(p.get("cooked", ""))[:2000],
                        "content_html": p.get("cooked", ""),
                    })

                entries_to_push.append({
                    "title": title or topic_data.get("title", "无标题"),
                    "url": link,
                    "published_at": topic_data.get("created_at") or pub_date_str,
                    "summary": main_text[:1200],
                    "image_url": img_url,
                    "discussion_posts": discussion_posts,
                })

                watermark[link] = current_max_post

            except Exception as e:
                logger.warning(f"Error processing topic {link}: {e}")
                continue

    except Exception as e:
        logger.error(f"Error crawling feed {rss_url}: {e}")
    finally:
        await page.close()

    return entries_to_push

async def run_ingest_cycle():
    logger.info("=== Starting LINUX DO Ingestion Cycle ===")
    raw_cookie = get_cookie_value()
    if not raw_cookie:
        logger.error("No _t cookie found in storage_state.json or linuxdo_cookie.txt!")
        await send_telegram_alert("⚠️ [RSS Ingest] 未检测到 LINUX DO Cookie，无法启动投喂管线！")
        return

    unquoted_cookie = urllib.parse.unquote(raw_cookie)
    watermark = load_watermark()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
        )
        
        await context.add_cookies([
            {
                "name": "_t",
                "value": unquoted_cookie,
                "domain": "linux.do",
                "path": "/",
                "secure": True,
                "httpOnly": True,
                "sameSite": "Lax"
            }
        ])

        # Warmup and session validation
        page = await context.new_page()
        try:
            resp = await page.goto("https://linux.do", wait_until="domcontentloaded", timeout=20000)
            title = await page.title()
            logger.info(f"Connected to LINUX DO: {title}")

            # Check if session is expired (e.g. redirected to login or title is '登录')
            if "login" in page.url.lower() or "登录" in title or "LINUX DO" not in title:
                logger.error(f"Session expired or blocked! URL={page.url}, Title={title}")
                await send_telegram_alert(f"⚠️ [RSS Ingest] LINUX DO 登录会话已失效 (URL: {page.url})，请及时更新 Cookie 凭证！")
                await page.close()
                await browser.close()
                return

        except Exception as e:
            logger.warning(f"Warmup warning: {e}")
        finally:
            await page.close()

        for feed in FEEDS:
            entries = await crawl_feed(context, feed, watermark)
            if entries:
                ok = await push_to_reader(feed["rss_url"], entries)
                if ok:
                    save_watermark(watermark)

        await browser.close()

    logger.info("=== Ingestion Cycle Completed ===")

async def main_loop():
    if "--once" in sys.argv:
        await run_ingest_cycle()
        return

    while True:
        try:
            await run_ingest_cycle()
        except Exception as e:
            logger.error(f"Unexpected error in ingest cycle: {e}")
        
        logger.info(f"Sleeping for {INTERVAL_MINUTES} minutes until next cycle...")
        await asyncio.sleep(INTERVAL_MINUTES * 60)

if __name__ == "__main__":
    asyncio.run(main_loop())
