import logging
import re
import asyncio
from urllib.parse import urljoin
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

LAZY_SRC_ATTRS = ("data-lazy-src", "data-src", "data-original", "data-lazy", "data-url", "data-ci-src")
LAZY_SRCSET_ATTRS = ("data-lazy-srcset", "data-srcset")


def _normalize_lazy_images(html: str, base_url: str) -> str:
    """
    WordPress/各类主题常使用懒加载：真实图片地址藏在 data-lazy-src / data-src 中，
    src 属性为 1x1 SVG 占位符，同时 <noscript> 里放一份真实 <img> 兜底。
    trafilatura 无法识别这些占位符，会导致正文插图全部丢失；且 noscript 兜底图会造成重复。
    这里统一把懒加载地址提升为主 src，并移除冗余的 noscript 兜底图。
    """
    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception:
        return html

    promoted_srcs = set()

    # 1. 提升懒加载属性为真实 src / srcset
    for img in soup.find_all("img"):
        lazy_src = None
        for attr in LAZY_SRC_ATTRS:
            if img.get(attr):
                lazy_src = img.get(attr)
                break
        cur_src = img.get("src") or ""

        if lazy_src:
            img["src"] = lazy_src
            promoted_srcs.add(lazy_src)
        elif cur_src.startswith("data:image/svg") or cur_src.startswith("data:image/gif"):
            # 纯占位符且无懒加载地址，删除避免脏数据
            img.decompose()
            continue

        for attr in LAZY_SRCSET_ATTRS:
            if img.get(attr):
                img["srcset"] = img.get(attr)
                break

        # 解析相对路径
        src = img.get("src")
        if src and not src.startswith(("http://", "https://", "data:")):
            img["src"] = urljoin(base_url, src)

    # 2. 移除与已提升图片重复的 noscript 兜底图
    for ns in soup.find_all("noscript"):
        ns_imgs = ns.find_all("img")
        if not ns_imgs:
            continue
        ns_srcs = [im.get("src") for im in ns_imgs if im.get("src")]
        if ns_srcs and all(s in promoted_srcs for s in ns_srcs):
            ns.decompose()

    return str(soup)


def _dedupe_markdown_images(md: str) -> str:
    """移除连续或重复的相同插图 markdown，避免 noscript 兜底造成的重复图片。"""
    seen = set()
    out_lines = []
    for line in md.split("\n"):
        m = re.match(r'^\s*!\[[^\]]*\]\((\S+?)\)\s*$', line)
        if m:
            url = m.group(1)
            if url in seen:
                continue
            seen.add(url)
        out_lines.append(line)
    return "\n".join(out_lines)


def _sync_parse_and_extract(html: str, url: str) -> dict:
    """
    CPU-bound HTML normalization, trafilatura extraction, and BeautifulSoup parsing.
    Executed in a thread pool to avoid blocking the asyncio event loop.
    """
    # 预处理：修复懒加载图片 + 去除 noscript 兜底重复
    normalized_html = _normalize_lazy_images(html, url)

    # 1. Try trafilatura (best-in-class extraction)
    extracted = trafilatura.extract(
        normalized_html,
        include_comments=False,
        include_tables=True,
        include_images=True,
        output_format="markdown",
        favor_precision=True
    )
    if extracted:
        extracted = _dedupe_markdown_images(extracted)

    # 2. Extract leading image if available
    img_url = None
    if extracted:
        img_match = re.search(r'!\[.*?\]\((https?://[^\s\)]+)\)', extracted)
        if img_match:
            img_url = img_match.group(1)

    soup = BeautifulSoup(normalized_html, "html.parser")
    if not img_url:
        og_img = soup.find("meta", property="og:image")
        if og_img and og_img.get("content"):
            img_url = og_img["content"]

    if not img_url:
        content_area = (
            soup.find("article")
            or soup.find("div", class_=re.compile(r"entry-content|post-content|article-content"))
            or soup.find("main")
        )
        if content_area:
            for img in content_area.find_all("img"):
                src = img.get("src") or img.get("data-lazy-src") or img.get("data-src") or img.get("data-original")
                if src and not re.search(r'logo|avatar|icon|qrcode|wechat|alipay|flag', src, re.I):
                    img_url = src
                    break

    if extracted and len(extracted.strip()) > 50:
        return {
            "content": extracted.strip(),
            "image_url": img_url,
            "error": None,
        }

    # Fallback to simple soup extraction (retain images as markdown)
    body = soup.find("article") or soup.find("main") or soup.find("body")
    if body:
        for tag in body(["script", "style", "noscript", "nav", "footer", "header"]):
            tag.decompose()
        for img in body.find_all("img"):
            src = img.get("src")
            if src:
                alt = img.get("alt") or "image"
                img.replace_with(f"\n\n![{alt}]({src})\n\n")
        for br in body.find_all("br"):
            br.replace_with("\n")
        text = body.get_text(separator="\n").strip()
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = _dedupe_markdown_images(text)
        return {
            "content": text[:50000] if text else None,
            "image_url": img_url,
            "error": None,
        }

    return {"content": None, "error": "未能提取有效正文内容"}


async def extract_fulltext_from_url(url: str, timeout: float = 20.0) -> dict:
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

        return await asyncio.to_thread(_sync_parse_and_extract, html, url)
    except Exception as e:
        logger.warning(f"Failed to fetch fulltext for {url}: {e}")
        return {"content": None, "error": str(e)}
