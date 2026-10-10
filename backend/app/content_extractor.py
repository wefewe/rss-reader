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
        soup = BeautifulSoup(html, "html.parser")
        img_url = None
        # og:image or first img inside article
        og_img = soup.find("meta", property="og:image")
        if og_img and og_img.get("content"):
            img_url = og_img["content"]
        else:
            first_img = soup.find("img")
            if first_img and first_img.get("src"):
                img_url = first_img["src"]

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
