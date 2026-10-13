import logging
import httpx
import trafilatura
from bs4 import BeautifulSoup

logger = logging.getLogger("rss_reader.extractor")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

async def extract_fulltext_from_url(url: str, timeout: float = 15.0) -> dict:
    """
    Fetches URL, extracts clean readable full text and title/images.
    Returns: {"content": str, "title": str, "image_url": str, "error": str}
    """
    try:
        async with httpx.AsyncClient(
            headers=HEADERS,
            timeout=timeout,
            follow_redirects=True,
            verify=False
        ) as client:
            resp = await client.get(url)
            if resp.status_code >= 400:
                return {
                    "content": None,
                    "error": f"HTTP {resp.status_code} {resp.reason_phrase}",
                }
            html = resp.text

        # 1. Try trafilatura (best-in-class extraction)
        extracted = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=True,
            include_images=True,
            output_format="markdown",
            favor_precision=True
        )

        # 2. Extract leading image if available
        import re
        img_url = None
        # Check markdown image tags first (cleanest extracted content image)
        if extracted:
            img_match = re.search(r'!\[.*?\]\((https?://[^\s\)]+)\)', extracted)
            if img_match:
                img_url = img_match.group(1)

        soup = BeautifulSoup(html, "html.parser")
        if not img_url:
            og_img = soup.find("meta", property="og:image")
            if og_img and og_img.get("content"):
                img_url = og_img["content"]

        if not img_url:
            # Look inside article or main content, skipping logos/avatars
            content_area = soup.find("article") or soup.find("div", class_=re.compile(r"entry-content|post-content|article-content")) or soup.find("main")
            if content_area:
                for img in content_area.find_all("img"):
                    src = img.get("src") or img.get("data-src") or img.get("data-original")
                    if src and not re.search(r'logo|avatar|icon|qrcode|wechat|alipay', src, re.I):
                        img_url = src
                        break

        if extracted and len(extracted.strip()) > 50:
            return {
                "content": extracted.strip(),
                "image_url": img_url,
                "error": None,
            }

        # Fallback to simple soup extraction
        body = soup.find("article") or soup.find("main") or soup.find("body")
        if body:
            # remove scripts, styles, iframes
            for tag in body(["script", "style", "noscript", "nav", "footer", "header"]):
                tag.decompose()
            text = body.get_text(separator="\n\n").strip()
            return {
                "content": text[:50000] if text else None,
                "image_url": img_url,
                "error": None,
            }

        return {"content": None, "error": "未能提取有效正文内容"}
    except Exception as e:
        logger.warning(f"Failed to fetch fulltext for {url}: {e}")
        return {"content": None, "error": str(e)}
