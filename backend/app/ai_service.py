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

    async def ask_article(
        self,
        title: str,
        text: str,
        question: str,
        history: List[Dict[str, str]] = None,
        discussion_posts: List[Dict[str, Any]] = None,
        model: Optional[str] = None
    ) -> str:
        """
        Answers a user question based on the article content, summary, and community discussions.
        """
        model = model or self.summary_model or "deepseek-v4.1-flash"
        history = history or []
        discussion_posts = discussion_posts or []

        disc_text = ""
        if discussion_posts:
            disc_lines = []
            for p in discussion_posts[:15]:
                disc_lines.append(f"#{p.get('post_number', 0)} {p.get('author', '匿名')}: {p.get('content', '')[:200]}")
            disc_text = "\n\n【社区高赞/热门回帖讨论】:\n" + "\n".join(disc_lines)

        content_snippet = text[:6000] if text else "无正文"

        system_prompt = f"""你是一位敏锐、实事求是且精通技术的私人数字阅读助理。
用户正在阅读以下文章：
《{title}》

【文章全文与背景内容】：
{content_snippet}
{disc_text}

【你的职责与回答规范】：
1. 紧密基于上述文章和楼层讨论回答，不编造不存在的事实；
2. 若用户要求“提取行动清单”或“落地步骤”，请以 Markdown 任务列表（如 - [ ] 或有序列表）给出具体、可执行的操作；
3. 若用户提问关于“核心争议/讨论风向/大家怎么看”，请综合整理文中观点与楼层回复；
4. 若文章未包含相关内容，请实事求是说明“文章中未明确提及”，并基于常识简短补充；
5. 回答精炼、排版清晰，使用中文 Markdown 输出。"""

        messages = [{"role": "system", "content": system_prompt}]
        for h in history[-6:]:
            messages.append({"role": h.get("role", "user"), "content": h.get("content", "")})

        messages.append({"role": "user", "content": question})
        res = await self._call_llm(model, messages, temperature=0.3, max_tokens=1000)
        return res or "AI 问答服务响应超时，请稍后重试。"

    async def triage_article(
        self,
        title: str,
        text: str,
        source_title: str,
        group_name: str = "",
        discussion_posts: list = None,
        extra_meta: dict = None
    ) -> Dict[str, Any]:
        """
        Evaluates article value, quality, promotion tendency, and assigns triage tier.
        Multi-layered funnel:
        1. Deterministic rule pre-filtering (0 Token):
           - Expired welfare/deals detection -> hidden
           - Pure water / begging / referral invitation begging -> hidden
           - Substantive open source / code / tutorial detection -> boost
        2. Discourse community engagement weighting (posts count & sentiment)
        3. LLM semantic triage for nuance
        4. Fail-Open safety net
        """
        discussion_posts = discussion_posts or []
        extra_meta = extra_meta or {}
        post_count = len(discussion_posts)
        combined_text = f"{title}\n{text or ''}"
        combined_lower = combined_text.lower()

        # ── Layer 1: Expired Welfare & Deals Detection (羊毛时效门控) ──
        is_welfare = (
            group_name == "羊毛福利" or 
            "福利" in source_title or 
            "welfare" in extra_meta.get("source_id", "")
        )
        if is_welfare:
            expired_keywords = [
                "已失效", "已领完", "活动结束", "领光了", "优惠结束",
                "翻车", "车翻了", "已结束", "已下架", "已封车", "无了", "被薅秃了"
            ]
            for kw in expired_keywords:
                if kw in title or kw in (text or "")[:300]:
                    return {
                        "value_tier": "hidden",
                        "value_score": 0.15,
                        "quality_score": 0.4,
                        "promotion_score": 0.5,
                        "expiry_score": 1.0,
                        "reason": f"时效检测：命中失效关键词「{kw}」",
                        "signals": [
                            {"dimension": "expiry", "effect": -0.85, "evidence": f"包含「{kw}」", "label": "活动失效"}
                        ],
                        "rank_score": 0.1
                    }

            # Check replies consensus (舆情反馈)
            if post_count >= 2:
                neg_replies = 0
                for p in discussion_posts:
                    content_p = p.get("content", "")
                    if any(w in content_p for w in ["失效", "领完", "用不了", "黄了", "没了", "封了", "寄了"]):
                        neg_replies += 1
                if neg_replies >= 2:
                    return {
                        "value_tier": "hidden",
                        "value_score": 0.2,
                        "quality_score": 0.4,
                        "promotion_score": 0.5,
                        "expiry_score": 0.9,
                        "reason": "舆情检测：多位楼层用户反馈优惠已失效",
                        "signals": [
                            {"dimension": "expiry", "effect": -0.8, "evidence": f"{neg_replies}条回帖反馈失效", "label": "回帖失效"}
                        ],
                        "rank_score": 0.15
                    }

        # ── Layer 2: Low-Quality / Spam / Referral Begging (纯求码与极短灌水) ──
        begging_keywords = [
            "求个邀请码", "求邀请码", "求个码", "求码", "求邀请",
            "互点", "互助助力", "互点助力", "填我的邀请码", "帮点一下",
            "帮我点下", "互赞", "互刷", "求带", "前排围观", "mark一下", "插眼"
        ]
        for bkw in begging_keywords:
            if bkw in title or bkw in (text or "")[:200]:
                return {
                    "value_tier": "hidden",
                    "value_score": 0.2,
                    "quality_score": 0.2,
                    "promotion_score": 0.8,
                    "expiry_score": 0.0,
                    "reason": f"低质过滤：纯求助/求码/互助帖「{bkw}」",
                    "signals": [
                        {"dimension": "quality", "effect": -0.8, "evidence": f"包含求助求码「{bkw}」", "label": "灌水求码"}
                    ],
                    "rank_score": 0.1
                }

        # Pure water short post (< 30 chars, no code, no links, 0 replies)
        if len((text or "").strip()) < 30 and post_count <= 1:
            if "http" not in combined_lower and "```" not in combined_text:
                return {
                    "value_tier": "hidden",
                    "value_score": 0.3,
                    "quality_score": 0.3,
                    "promotion_score": 0.0,
                    "expiry_score": 0.0,
                    "reason": "低质过滤：内容过短且无实质信息",
                    "signals": [
                        {"dimension": "quality", "effect": -0.5, "evidence": "正文字数过少且无外链", "label": "短文本水贴"}
                    ],
                    "rank_score": 0.2
                }

        # ── Layer 3: High-Value Technical & Engagement Signals ──
        pre_signals = []
        is_substantive_tech = False
        if any(w in combined_lower for w in ["github.com/", "docker-compose", "systemctl", "curl ", "git clone"]):
            is_substantive_tech = True
            pre_signals.append({"dimension": "quality", "effect": 0.25, "evidence": "包含开源代码库或部署配置", "label": "硬核配置"})

        if post_count >= 15:
            pre_signals.append({"dimension": "quality", "effect": 0.2, "evidence": f"社区热烈讨论({post_count}楼)", "label": "社区热议"})
        elif post_count >= 8:
            pre_signals.append({"dimension": "quality", "effect": 0.1, "evidence": f"社区讨论活跃({post_count}楼)", "label": "活跃互动"})

        # ── Layer 4: LLM Semantic Evaluation ──
        model = self.summary_model
        snippet = (text or "")[:1500]

        prompt = f"""你是一个专业的高效信息审核顾问。请对以下内容进行深度质量评估与价值分流。
文章来源：{source_title}
文章标题：{title}
所属分组：{group_name or '综合'}
楼层讨论数：{post_count}
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
    {{"dimension": "quality", "effect": 0.2, "evidence": "详细教程且含代码", "label": "深度干货"}}
  ]
}}

判定准则：
1. featured（精选）：高信息密度、硬核技术/开源教程、高赞深度讨论、实用首发工具；
2. general（一般）：常规问答讨论、普通资讯、日常分享；
3. hidden（折叠）：纯营销砍价、纯情绪灌水、已失效活动；
4. 不确定时一律放行（fail-open 归为 general）。"""

        messages = [{"role": "user", "content": prompt}]
        raw = await self._call_llm(model, messages, temperature=0.1, max_tokens=400)
        
        fallback = {
            "value_tier": "featured" if is_substantive_tech or post_count >= 15 else "general",
            "value_score": 0.75 if is_substantive_tech else 0.6,
            "quality_score": 0.7 if is_substantive_tech else 0.6,
            "promotion_score": 0.0,
            "expiry_score": 0.0,
            "reason": "规则默认分流" if not is_substantive_tech else "硬核开源/技术教程推荐",
            "signals": pre_signals,
            "rank_score": 0.75 if is_substantive_tech else 0.6
        }

        if not raw:
            return fallback

        try:
            clean_str = raw.strip()
            if clean_str.startswith("```"):
                clean_str = clean_str.split("\n", 1)[1]
            if clean_str.endswith("```"):
                clean_str = clean_str.rsplit("```", 1)[0]
            clean_str = clean_str.strip()
            parsed = json.loads(clean_str)
            
            # Combine pre-signals and LLM signals
            all_signals = pre_signals + parsed.get("signals", [])
            parsed["signals"] = all_signals

            val = float(parsed.get("value_score", 0.6))
            promo = float(parsed.get("promotion_score", 0.0))
            
            # Boost rank score if substantive tech or high engagement
            engagement_boost = 0.15 if post_count >= 15 else (0.08 if post_count >= 8 else 0.0)
            tech_boost = 0.1 if is_substantive_tech else 0.0
            
            rank = round(max(0.0, min(1.0, val - promo * 0.3 + engagement_boost + tech_boost)), 2)
            parsed["rank_score"] = rank

            # If substantive tech and high engagement, ensure featured
            if (is_substantive_tech and rank >= 0.7) or (post_count >= 20 and parsed.get("value_tier") != "hidden"):
                parsed["value_tier"] = "featured"

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
