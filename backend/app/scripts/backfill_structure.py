"""
WO-20261024-11: 存量文章批量补救（代码与标题结构重建）工具
运行在 reader 容器内或宿主机维护环境，支持 dry-run、幂等重跑与单条 UPDATE 事务隔离。
"""

import os
import sys
import re
import random
import asyncio
import sqlite3
import argparse
import logging
from typing import List, Dict, Any, Optional

# Ensure backend package can be imported
current_dir = os.path.dirname(os.path.abspath(__file__))
app_dir = os.path.dirname(current_dir)
backend_dir = os.path.dirname(app_dir)
for p in [backend_dir, app_dir]:
    if p not in sys.path:
        sys.path.insert(0, p)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("backfill_structure")

# 筛选口径中的代码特征词
CODE_KEYWORDS = [
    "curl", "docker", "npm", "git", "pip", "bash", "install",
    "config", "python", "apt", "yarn", "pnpm", "sudo", "import", "export"
]
CODE_KEYWORD_REGEX = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in CODE_KEYWORDS) + r")\b",
    re.IGNORECASE
)

# 技术类分组与源定义
TECH_GROUPS = {"折腾搞机", "全球前沿", "科技资讯", "工具效率", "tech", "dev"}
TECH_SOURCE_IDS = {"landian", "appinn", "sspai", "wzfou", "zhujiwiki", "iwanlab", "hackernews", "arstechnica"}


def find_db_path(explicit_path: Optional[str] = None) -> str:
    """Resolve sqlite database file path."""
    if explicit_path and os.path.exists(explicit_path):
        return explicit_path
    
    env_db = os.getenv("DATABASE_URL", "")
    if env_db.startswith("sqlite+aiosqlite:///"):
        p = env_db.replace("sqlite+aiosqlite:///", "")
        if os.path.exists(p):
            return p
    if env_db.startswith("sqlite:///"):
        p = env_db.replace("sqlite:///", "")
        if os.path.exists(p):
            return p

    candidates = [
        "/data/reader.db",
        "/opt/rss-reader/data/reader.db",
        os.path.join(backend_dir, "data", "reader.db"),
        "/tmp/reader_readonly_copy.db"
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    raise FileNotFoundError(f"Database file not found among candidates: {candidates}")


def scan_candidates(db_path: str, min_length: int = 800) -> List[Dict[str, Any]]:
    """
    按照工单筛选口径扫描候选文章：
    - content 不含 ``` 代码围栏
    - content 不含 '## ' 标题标记
    - 正文长度 >= min_length (默认 800)
    - 排除 source_id = 'linuxdo-digest'
    - 排除无有效 url 的短文
    - 且（正文含代码特征词 OR 来源为技术类源）
    """
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    query = """
    SELECT id, source_id, source_title, group_name, title, url, content, image_url
    FROM articles
    WHERE source_id != 'linuxdo-digest'
      AND url IS NOT NULL
      AND length(trim(url)) > 0
      AND content IS NOT NULL
      AND length(content) >= ?
      AND content NOT LIKE '%```%'
      AND content NOT LIKE '%## %'
    ORDER BY published_at DESC
    """
    cursor.execute(query, (min_length,))
    rows = cursor.fetchall()
    conn.close()

    candidates = []
    for r in rows:
        content = r["content"] or ""
        group_name = (r["group_name"] or "").strip()
        source_id = (r["source_id"] or "").strip()

        # 特征匹配
        is_tech_group = group_name in TECH_GROUPS or source_id in TECH_SOURCE_IDS
        matched_keywords = sorted(list(set(CODE_KEYWORD_REGEX.findall(content))))

        if is_tech_group or matched_keywords:
            candidates.append({
                "id": r["id"],
                "source_id": source_id,
                "source_title": r["source_title"],
                "group_name": group_name,
                "title": r["title"],
                "url": r["url"],
                "old_len": len(content),
                "has_old_image": bool(r["image_url"]),
                "is_tech_group": is_tech_group,
                "matched_keywords": matched_keywords,
            })

    return candidates


def calculate_estimated_time(candidate_count: int, batch_size: int = 20, concurrency: int = 2,
                             delay_avg: float = 2.0, net_time_avg: float = 2.0, batch_pause: float = 5.0) -> Dict[str, Any]:
    """
    预估全量执行耗时：
    并发为 2，每篇处理时间 = 网络耗时 (~2s) + 随机延迟 (1~3s，均值 2s) = 约 4s。
    由于 Semaphore(2)，每秒处理约 0.5 篇。
    分批 20 篇一批，每批处理时间约 20 * 4s / 2 = 40 秒，批间停顿 batch_pause (5s)。
    """
    if candidate_count == 0:
        return {"min_seconds": 0, "avg_seconds": 0, "max_seconds": 0}

    num_batches = (candidate_count + batch_size - 1) // batch_size
    total_pause = (num_batches - 1) * batch_pause if num_batches > 1 else 0

    # 最小耗时预估（网络快 1s + 延迟 1s = 2s / 2并发 = 1s/篇）
    min_sec = (candidate_count * 2.0 / concurrency) + total_pause
    # 平均耗时预估（网络 2s + 延迟 2s = 4s / 2并发 = 2s/篇）
    avg_sec = (candidate_count * (delay_avg + net_time_avg) / concurrency) + total_pause
    # 最大耗时预估（网络超时 10s + 延迟 3s = 13s / 2并发 = 6.5s/篇）
    max_sec = (candidate_count * 13.0 / concurrency) + total_pause

    return {
        "candidate_count": candidate_count,
        "num_batches": num_batches,
        "min_minutes": round(min_sec / 60, 1),
        "avg_minutes": round(avg_sec / 60, 1),
        "max_minutes": round(max_sec / 60, 1),
    }


async def process_single_article(
    article: Dict[str, Any],
    sem: asyncio.Semaphore,
    dry_run: bool,
    db_path: str,
    timeout: float = 20.0,
    delay_min: float = 1.0,
    delay_max: float = 3.0,
) -> Dict[str, Any]:
    """
    单篇抓取与准入判断：
    - Semaphore(2) 并发控制
    - 随机间隔 1~3 秒
    - 准入规则：提取成功、正文长度 >= 原文 60%、提取结果含结构标记 (``` 或 ## 或 ]()
    - 写入安全：单条 UPDATE 独立 commit，绝不开启长事务
    """
    from app.content_extractor import extract_fulltext_from_url

    async with sem:
        # 篇间随机抖动
        await asyncio.sleep(random.uniform(delay_min, delay_max))

        url = article["url"]
        art_id = article["id"]
        old_len = article["old_len"]

        try:
            ft = await extract_fulltext_from_url(url, timeout=timeout)
        except Exception as e:
            return {"id": art_id, "title": article["title"], "status": "failed_exception", "reason": str(e)}

        new_content = (ft.get("content") or "").strip() if ft else ""
        new_image = (ft.get("image_url") or "").strip() if ft else ""

        if not new_content:
            return {"id": art_id, "title": article["title"], "status": "failed_no_content", "reason": ft.get("error", "empty content")}

        # 准入规则 1: 长度不萎缩 (>= 原文 60%)
        if len(new_content) < old_len * 0.6:
            return {
                "id": art_id,
                "title": article["title"],
                "status": "failed_length_shrunk",
                "reason": f"new_len ({len(new_content)}) < 60% of old_len ({old_len})"
            }

        # 准入规则 2: 必须包含结构标记 (``` 或 ## 或 ]()
        has_code_block = "```" in new_content
        has_heading = "## " in new_content
        has_markdown_link = "](" in new_content
        if not (has_code_block or has_heading or has_markdown_link):
            return {
                "id": art_id,
                "title": article["title"],
                "status": "failed_no_structure",
                "reason": "extracted text contains no code block, heading or markdown link"
            }

        # 如果通过准入
        if dry_run:
            return {
                "id": art_id,
                "title": article["title"],
                "status": "dry_run_eligible",
                "new_len": len(new_content),
                "has_code": has_code_block,
                "has_heading": has_heading,
                "has_link": has_markdown_link,
                "new_image": new_image if not article["has_old_image"] else None
            }

        # 生产写入：单条 UPDATE 立即 commit，杜绝锁库
        try:
            conn = sqlite3.connect(db_path, timeout=10.0)
            cursor = conn.cursor()
            if new_image and not article["has_old_image"]:
                cursor.execute(
                    "UPDATE articles SET content = ?, image_url = coalesce(image_url, ?) WHERE id = ?",
                    (new_content, new_image, art_id)
                )
            else:
                cursor.execute(
                    "UPDATE articles SET content = ? WHERE id = ?",
                    (new_content, art_id)
                )
            conn.commit()
            conn.close()
            return {
                "id": art_id,
                "title": article["title"],
                "status": "success_overwritten",
                "new_len": len(new_content),
                "has_code": has_code_block,
                "has_heading": has_heading,
            }
        except Exception as db_err:
            return {"id": art_id, "title": article["title"], "status": "failed_db_error", "reason": str(db_err)}


async def run_backfill(
    db_path: str,
    dry_run: bool = True,
    sample_size: int = 10,
    batch_size: int = 20,
    concurrency: int = 2,
    limit: int = 0,
    delay_min: float = 1.0,
    delay_max: float = 3.0,
    batch_pause: float = 5.0,
    timeout: float = 20.0,
):
    """主执行函数"""
    logger.info(f"Target DB: {db_path} (dry_run={dry_run})")
    candidates = scan_candidates(db_path)
    total_candidates = len(candidates)
    logger.info(f"=== 候选文章扫描完成: 共命中 {total_candidates} 篇 ===")

    if total_candidates == 0:
        logger.info("库内无待补救候选文章（已全量具备结构或无符合特征文章）。")
        return {
            "total_candidates": 0,
            "samples": [],
            "estimate": {"min_minutes": 0, "avg_minutes": 0, "max_minutes": 0}
        }

    # 抽样展示筛选口径自检清单
    sample_pool = random.sample(candidates, min(sample_size, total_candidates))
    logger.info(f"--- 筛选口径自检抽样 ({len(sample_pool)} 篇) ---")
    for idx, c in enumerate(sample_pool, 1):
        feature_desc = []
        if c["is_tech_group"]:
            feature_desc.append(f"技术源:[{c['source_title']} / {c['group_name']}]")
        if c["matched_keywords"]:
            feature_desc.append(f"关键词:{c['matched_keywords'][:6]}")
        logger.info(f"[{idx:02d}] ID: {c['id'][:25]}... | 长度: {c['old_len']}字 | 特征: {' | '.join(feature_desc)}")
        logger.info(f"     标题: {c['title']}")

    # 耗时预估
    est = calculate_estimated_time(
        total_candidates,
        batch_size=batch_size,
        concurrency=concurrency,
        delay_avg=(delay_min + delay_max) / 2.0,
        net_time_avg=2.0,
        batch_pause=batch_pause
    )
    logger.info(
        f"--- 全量补救耗时预估 (共 {total_candidates} 篇，分 {est['num_batches']} 批，并发 {concurrency}) ---\n"
        f"     乐观: {est['min_minutes']} 分钟 | 平均: {est['avg_minutes']} 分钟 | 保守: {est['max_minutes']} 分钟"
    )

    if dry_run:
        logger.info("=== DRY-RUN 模式生效：未对数据库执行任何修改与网络全量覆盖 ===")
        return {
            "total_candidates": total_candidates,
            "samples": sample_pool,
            "estimate": est,
        }

    # 实际全量执行（后续工单阶段）
    logger.info(f"=== 开始全量批次覆写执行 (每批 {batch_size} 篇，并发 {concurrency}) ===")
    sem = asyncio.Semaphore(concurrency)
    to_process = candidates[:limit] if limit > 0 else candidates

    success_samples = []
    attempted = 0
    overwritten = 0
    failed_retained = 0

    for i in range(0, len(to_process), batch_size):
        batch = to_process[i:i + batch_size]
        batch_num = i // batch_size + 1
        logger.info(f"--- 正在处理第 {batch_num} 批 ({len(batch)} 篇) ---")

        tasks = [
            process_single_article(
                art,
                sem=sem,
                dry_run=False,
                db_path=db_path,
                timeout=timeout,
                delay_min=delay_min,
                delay_max=delay_max
            )
            for art in batch
        ]
        results = await asyncio.gather(*tasks)

        for res in results:
            attempted += 1
            if res.get("status") == "success_overwritten":
                overwritten += 1
                if len(success_samples) < 5:
                    success_samples.append(res["title"])
                logger.info(f"  ✅ 成功覆写: {res['title'][:40]} (新长度: {res.get('new_len')})")
            else:
                failed_retained += 1
                logger.info(f"  ⏭️ 保留原文: {res['title'][:40]} (原因: {res.get('reason')})")

        if i + batch_size < len(to_process):
            logger.info(f"批次间暂停 {batch_pause} 秒...")
            await asyncio.sleep(batch_pause)

    logger.info(
        f"=== 全量执行汇总 ===\n"
        f"候选总数: {total_candidates}\n"
        f"实际尝试: {attempted}\n"
        f"成功覆写: {overwritten}\n"
        f"失败保留: {failed_retained}\n"
        f"抽验样本: {success_samples}"
    )

    return {
        "total_candidates": total_candidates,
        "attempted": attempted,
        "overwritten": overwritten,
        "failed_retained": failed_retained,
        "success_samples": success_samples,
    }


def main():
    parser = argparse.ArgumentParser(description="存量文章批量补救（代码与标题结构重建）")
    parser.add_argument("--db-path", default=None, help="SQLite 数据库文件路径")
    parser.add_argument("--dry-run", action="store_true", default=False, help="仅扫描候选并预估，不覆写数据库")
    parser.add_argument("--sample-size", type=int, default=10, help="筛选口径自检抽样篇数 (默认 10)")
    parser.add_argument("--batch-size", type=int, default=20, help="批次大小 (默认 20)")
    parser.add_argument("--concurrency", type=int, default=2, help="最大并发抓取数 (默认 2)")
    parser.add_argument("--limit", type=int, default=0, help="限制处理篇数 (0 为不限)")
    parser.add_argument("--delay-min", type=float, default=1.0, help="篇间随机延迟下限秒数 (默认 1.0)")
    parser.add_argument("--delay-max", type=float, default=3.0, help="篇间随机延迟上限秒数 (默认 3.0)")
    parser.add_argument("--batch-pause", type=float, default=5.0, help="批次间暂停秒数 (默认 5.0)")
    parser.add_argument("--timeout", type=float, default=20.0, help="单篇抓取超时秒数 (默认 20.0)")

    args = parser.parse_args()
    db_path = find_db_path(args.db_path)

    asyncio.run(run_backfill(
        db_path=db_path,
        dry_run=args.dry_run,
        sample_size=args.sample_size,
        batch_size=args.batch_size,
        concurrency=args.concurrency,
        limit=args.limit,
        delay_min=args.delay_min,
        delay_max=args.delay_max,
        batch_pause=args.batch_pause,
        timeout=args.timeout,
    ))


if __name__ == "__main__":
    main()
