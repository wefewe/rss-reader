import logging
import json
import httpx
from typing import List, Dict, Any, Optional
from .config import settings

logger = logging.getLogger("rss_reader.ai")

class AIService:
    def __init__(self):
        self.base_url = settings.LLM_BASE_URL.rstrip("/")
        self.api_key = settings.LLM_API_KEY
        self.summary_model = settings.LLM_SUMMARY_MODEL
        self.brief_model = settings.LLM_BRIEF_MODEL

    async def _call_llm(self, model: str, messages: list, temperature: float = 0.3, max_tokens: int = 1500) -> Optional[str]:
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (RSSReader/1.0)",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    choices = data.get("choices", [])
                    if choices:
                        return choices[0].get("message", {}).get("content", "").strip()
                else:
                    logger.warning(f"LLM call failed HTTP {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            logger.error(f"Error calling LLM ({model}): {e}")
        return None

    async def summarize_article(self, title: str, text: str, model_override: Optional[str] = None) -> str:
        """
        Generates high-value Chinese summary with TL;DR, 3 bullet takeaways and target audience.
        """
        model = model_override or self.summary_model
        content_snippet = text[:4000] if text else "无正文"
        
        prompt = f"""你是一个高效专业的数字图书馆阅读顾问。请为以下文章生成简洁、高信息密度的中文结构化摘要。

文章标题：{title}
文章内容：
{content_snippet}

请按以下格式输出，避免冗余废话：
💡 **一句话速览**：[用1句话概括核心事实或主旨，30字以内]
📌 **核心要点**：
- [要点1：具体技术/事实/细节]
- [要点2：具体技术/事实/细节]
- [要点3：具体技术/事实/细节]
🎯 **适合读者**：[一句话说明谁最值得精读]
"""
        messages = [{"role": "user", "content": prompt}]
        res = await self._call_llm(model, messages, temperature=0.2, max_tokens=600)
        return res or "摘要生成失败或超时，请参考原文。"

    async def triage_article(self, title: str, text: str, source_title: str) -> Dict[str, Any]:
        """
        Evaluates article value, quality, promotion tendency, and assigns triage tier.
        """
        model = self.summary_model
        snippet = (text or "")[:1500]

        prompt = f"""你是一个信息筛选审核员。请对以下RSS文章进行价值分流与质量评估。
文章来源：{source_title}
文章标题：{title}
内容摘要：{snippet}

请严格按 JSON 格式回复，不要包含任何额外代码块标记或解释：
{{
  "value_tier": "featured | general | hidden",
  "value_score": 0.85,
  "quality_score": 0.8,
  "promotion_score": 0.1,
  "expiry_score": 0.0,
  "reason": "简短判定理由，20字以内",
  "signals": [
    {{"dimension": "quality", "effect": 0.2, "evidence": "内容充实，有代码和实操细节", "label": "深度干货"}},
    {{"dimension": "promotion", "effect": -0.1, "evidence": "带有一处活动推荐", "label": "轻微推广"}}
  ]
}}

判定准则：
1. featured（精选）：高信息密度、硬核干货、独家观点或重要科技动态；
2. general（一般）：普通资讯、常规讨论、教程、一般优惠；
3. hidden（折叠）：纯广告软文、纯砍价返利无营养帖、已过期活动或灌水废帖；
4. 不确定时放行（fail-open 归为 general）。"""

        messages = [{"role": "user", "content": prompt}]
        raw = await self._call_llm(model, messages, temperature=0.1, max_tokens=400)
        
        # Default fallback
        fallback = {
            "value_tier": "general",
            "value_score": 0.6,
            "quality_score": 0.6,
            "promotion_score": 0.0,
            "expiry_score": 0.0,
            "reason": "规则默认分流",
            "signals": [],
            "rank_score": 0.6
        }

        if not raw:
            return fallback

        try:
            # clean json
            clean_str = raw.strip()
            if clean_str.startswith("```"):
                clean_str = clean_str.split("\n", 1)[1]
            if clean_str.endswith("```"):
                clean_str = clean_str.rsplit("```", 1)[0]
            clean_str = clean_str.strip()
            parsed = json.loads(clean_str)
            
            # calculate rank_score
            val = float(parsed.get("value_score", 0.6))
            promo = float(parsed.get("promotion_score", 0.0))
            rank = round(max(0.0, min(1.0, val - promo * 0.3)), 2)
            parsed["rank_score"] = rank
            return parsed
        except Exception:
            return fallback

    async def generate_daily_brief(self, candidate_articles: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Generates 09:00 Daily Briefing. Supports fallback to excerpt if LLM fails.
        """
        if not candidate_articles:
            return {
                "title": "今日早报（暂无候选文章）",
                "content": "今日暂无满足筛选条件的精选文章。",
                "is_fallback": True
            }

        # Build candidates summary
        brief_items = []
        for i, a in enumerate(candidate_articles[:12], 1):
            brief_items.append(f"{i}. [{a['group_name']}] 《{a['title']}》 - 来源: {a['source_title']}\n摘要: {a.get('summary', '')[:120]}")

        candidates_text = "\n\n".join(brief_items)
        prompt = f"""你是用户的数字图书私人首席简报官。请从以下过去 24 小时的精选文章中，编写一份排版精美、结构清晰的《晨间数字早报》（约 500~800 字）。

候选文章列表：
{candidates_text}

编写要求：
1. 包含精美标题（如“☕ 晨间内参 | YYYY-MM-DD 数字精选”）；
2. 分板块归纳（例如：【科技与前沿】、【效率与开发】、【精选折腾与羊毛】）；
3. 提炼每件事的核心价值与观点，不要只是列出标题；
4. 结尾附带一句精炼的【今日思考】。
请使用 Markdown 格式输出。"""

        messages = [{"role": "user", "content": prompt}]
        res = await self._call_llm(self.brief_model, messages, temperature=0.5, max_tokens=1500)

        if res:
            return {
                "title": "☕ 晨间内参 | 每日精选早报",
                "content": res,
                "is_fallback": False
            }

        # Fallback: Excerpt Mode
        fallback_lines = ["# ☕ 晨间数字内参（原文摘录保底模式）\n", "> 注：AI 推理服务暂时超时，已自动降级为基于精选排行的事实摘录。\n"]
        for i, a in enumerate(candidate_articles[:8], 1):
            fallback_lines.append(f"### {i}. {a['title']}")
            fallback_lines.append(f"**分组**：{a['group_name']} | **来源**：{a['source_title']} | **链接**：[{a['url']}]({a['url']})")
            fallback_lines.append(f"{a.get('summary', '暂无内容')[:150]}...\n")

        return {
            "title": "☕ 晨间内参 | 事实摘录早报",
            "content": "\n".join(fallback_lines),
            "is_fallback": True
        }

    async def push_telegram_notification(self, text: str):
        """
        Pushes notification to configured Telegram Chat ID.
        """
        if not settings.TG_BOT_TOKEN or not settings.TG_CHAT_ID:
            return

        url = f"https://api.telegram.org/bot{settings.TG_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": settings.TG_CHAT_ID,
            "text": text,
            "parse_mode": "Markdown",
            "disable_web_page_preview": True,
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                await client.post(url, json=payload)
        except Exception as e:
            logger.warning(f"Telegram push failed: {e}")

ai_service = AIService()
