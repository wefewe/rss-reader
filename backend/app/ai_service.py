import logging
import json
import re
import html
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

        candidate_models = [model]
        # Robust fallback sequence prioritized by latency & reliability on AxonHub
        for fb in ["gemini-3.8-flash", "glm-5.2", "kimi-k3"]:
            if fb not in candidate_models:
                candidate_models.append(fb)

        for current_model in candidate_models:
            payload = {
                "model": current_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            try:
                # 25s timeout per candidate model for agile failover
                async with httpx.AsyncClient(timeout=25.0) as client:
                    resp = await client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
                    if resp.status_code == 200:
                        data = resp.json()
                        choices = data.get("choices", [])
                        if choices:
                            msg = choices[0].get("message", {})
                            content = (msg.get("content") or "").strip()
                            if not content and msg.get("reasoning_content"):
                                content = msg.get("reasoning_content", "").strip()
                            if content:
                                # Strip accidental reasoning chain prefix if present
                                if "💡" in content and not content.startswith("💡"):
                                    content = "💡" + content.split("💡", 1)[1].strip()
                                return content
                    else:
                        logger.warning(f"LLM call {current_model} failed HTTP {resp.status_code}: {resp.text[:150]}")
            except Exception as e:
                logger.warning(f"LLM call {current_model} failed or timed out: {e}")

        return None

    async def summarize_article(
        self,
        title: str,
        text: str,
        model_override: Optional[str] = None,
        discussion_posts: Optional[List[Dict[str, Any]]] = None
    ) -> str:
        """
        Generates high-value Chinese summary with TL;DR, 3 bullet takeaways and target audience.
        If discussion_posts are present (forum topic), incorporates community replies & consensus.
        """
        model = model_override or self.summary_model
        content_snippet = text[:3500] if text else "无正文"

        disc_context = ""
        if discussion_posts:
            disc_lines = []
            for p in discussion_posts[:12]:
                author = p.get("author", "匿名")
                num = p.get("post_number", 0)
                body = (p.get("content") or "")[:250].strip()
                if body:
                    disc_lines.append(f"#{num} {author}: {body}")
            if disc_lines:
                disc_context = "\n\n【社区热议回帖与讨论汇总】:\n" + "\n".join(disc_lines)

        prompt = f"""你是一个高效专业的数字图书馆阅读顾问与社区情报分析师。请为以下{'论坛讨论主题' if disc_context else '文章'}生成简洁、高信息密度的中文结构化摘要。

标题：{title}
主帖正文：
{content_snippet}{disc_context}

请按以下格式输出，避免冗余废话：
💡 **一句话速览**：[用1句话概括核心事实、主旨或社区讨论焦点，35字以内]
📌 **核心要点**：
- [要点1：楼主核心发现/分享/求助细节]
- [要点2：{'社区关键方案/共识建议/争议分歧' if disc_context else '具体技术/事实/细节'}]
- [要点3：{'避坑提醒/后续跟进/实用反馈' if disc_context else '具体技术/事实/细节'}]
🎯 **适合读者**：[一句话说明谁最值得精读]
"""
        messages = [{"role": "user", "content": prompt}]
        res = await self._call_llm(model, messages, temperature=0.2, max_tokens=700)
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

    async def explain_selection(
        self,
        selected_text: str,
        article_title: Optional[str] = None,
        surrounding_context: Optional[str] = None,
        model: Optional[str] = None
    ) -> str:
        """
        Provides a concise 2~3 sentence contextual explanation for highlighted text or term.
        """
        model = model or self.summary_model or "deepseek-v4.1-flash"
        ctx = f"\n上下文环境：\n{surrounding_context[:800]}" if surrounding_context else ""
        art = f"《{article_title}》" if article_title else "当前文章"

        prompt = f"""你是一位博学敏锐的技术与知识百科智囊。用户在阅读{art}时划选了以下内容：
「{selected_text}」{ctx}

请在 3 句话以内（100 字左右）给出精辟准确的即席科普解释：
1. 本质定义或核心含义；
2. 在当前语境下的具体所指或技术背景；
直接输出解释文本，避免任何前缀与客套话。"""

        messages = [{"role": "user", "content": prompt}]
        res = await self._call_llm(model, messages, temperature=0.2, max_tokens=250)
        return (res or "未能获取解析，请稍后重试。").strip()

    async def bilingual_translate(
        self,
        title: str,
        text: str,
        model: Optional[str] = None
    ) -> str:
        """
        Translates foreign/English text into high-quality paragraph-by-paragraph bilingual flow.
        """
        model = model or self.summary_model or "deepseek-v4.1-flash"
        if isinstance(text, dict):
            text = text.get("content", "")
        snippet = str(text)[:5000] if text else "No content"

        prompt = f"""你是一位精通全球前沿科技与开源生态的技术双语专家。请为以下外文文章生成优雅通顺的【逐段双语对照】阅读流。

文章标题：{title}
原文正文内容：
{snippet}

排版规范：
1. 保持原文的自然段落结构，对每个段落：
   - 第一行/块输出原始英文段落；
   - 紧接着在其下方输出高质量、地道准确的中文翻译（格式采用引用块或斜体，如：`> 中文译文`）；
2. 专有名词（如 API、方法名、包名、公司名、架构名）、代码块（```代码```）与内联代码（`code`）一律保留原文不翻；
3. 输出 Markdown 格式，直接输出正文内容，绝不添加多余的前缀与客套话。"""

        messages = [{"role": "user", "content": prompt}]
        res = await self._call_llm(model, messages, temperature=0.2, max_tokens=2000)
        return (res or "双语翻译超时，请稍后重试。").strip()

    async def synthesize_speech(
        self,
        text: str,
        voice: str = "zh-CN-YunxiNeural",
        rate: str = "+0%"
    ) -> bytes:
        """
        Synthesizes text into high-quality MP3 audio using edge-tts with Google TTS fallback.
        """
        clean_text = re.sub(r'[*_#`>\[\]\(\)]', '', text)
        clean_text = re.sub(r'https?://[^\s]+', '', clean_text)
        clean_text = re.sub(r'\s+', ' ', clean_text).strip()[:1000]
        if not clean_text:
            clean_text = "暂无朗读内容。"

        # 1. Try edge-tts
        try:
            import edge_tts
            communicate = edge_tts.Communicate(clean_text, voice, rate=rate)
            audio_chunks = []
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_chunks.append(chunk["data"])
            if audio_chunks:
                return b"".join(audio_chunks)
        except Exception as e:
            logger.warning(f"Edge-TTS stream unavailable ({e}), trying Google TTS stream")

        # 2. Robust Google TTS fallback (chunked MP3 stream)
        try:
            import urllib.parse
            # Split into ~140 character chunks at punctuation boundaries
            chunks = re.findall(r'.{1,140}(?:[，。！？\s\n]|$)', clean_text, re.DOTALL)
            if not chunks:
                chunks = [clean_text[:140]]

            audio_parts = []
            async with httpx.AsyncClient(headers={"User-Agent": "Mozilla/5.0"}, timeout=15.0) as client:
                for c in chunks[:12]:
                    c_clean = c.strip()
                    if not c_clean:
                        continue
                    encoded = urllib.parse.quote(c_clean)
                    url = f"https://translate.google.com/translate_tts?ie=UTF-8&q={encoded}&tl=zh-CN&client=tw-ob"
                    resp = await client.get(url)
                    if resp.status_code == 200:
                        audio_parts.append(resp.content)
            if audio_parts:
                return b"".join(audio_parts)
        except Exception as e:
            logger.error(f"Google TTS fallback error: {e}")

        return b""

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

        # ── Layer 1.5: Pure Commercial Product Ads & Affiliate Spam (纯广告商品带货过滤，严防误杀) ──
        # Check white-list first to guarantee 0 false-positives
        is_protected = any(k in combined_lower for k in [
            "github.com/", "docker", "python", "linux", "kernel", "commit", "api", "sqlite", "nginx", "systemd",
            "微语录精选", "博海拾贝", "段子", "知乎高赞", "每周精选", "财报", "反垄断", "芯片架构", "漏洞分析", "安全研究"
        ])
        if not is_protected:
            has_price_deal = bool(re.search(
                r"(?:\d+(?:\.\d+)?元包邮|券后(?:实付)?\d+(?:\.\d+)?元|折\d+(?:\.\d+)?元(?:/|[，,\s]|\)|）)|新低\d+(?:\.\d+)?元|到手(?:仅|只要)?\d+(?:\.\d+)?元|包邮[（\(]折\d+)",
                title
            ))
            promo_prefix = bool(re.search(
                r"^(?:断码[，,]|白菜[!！]|好价[：:]|神价[!！]|手慢无[!！]|【(?:广告|推广|商务推广)】|（(?:推广|广告)）|特惠[：:])",
                title.strip()
            ))
            is_shopping_roundup = bool(re.search(
                r"百货\s*\d+\s*条|超值商品推荐|好物清单推荐|超值好物汇总|每日超值汇总",
                title
            ))
            has_deal_body = bool(re.search(
                r"售价\s*\d+\s*元[，,]\s*领取\s*\d+\s*元|券后实付\s*\d+\s*元|领券下单|复制淘口令|点击购买",
                (text or "")[:400]
            ))

            is_ad = False
            ad_evidence = ""
            if has_price_deal:
                is_ad = True
                ad_evidence = "标题包含明确商品促销/包邮价格"
            elif promo_prefix and (has_deal_body or "包邮" in title or "元" in title):
                is_ad = True
                ad_evidence = "命中促销导购专属前缀且含商品信息"
            elif is_shopping_roundup:
                is_ad = True
                ad_evidence = "纯商品清单与导购专栏"
            elif has_deal_body and len((text or "").strip()) < 800:
                is_ad = True
                ad_evidence = "正文包含纯电商优惠券转化文案"

            if is_ad:
                return {
                    "value_tier": "hidden",
                    "value_score": 0.1,
                    "quality_score": 0.2,
                    "promotion_score": 0.95,
                    "expiry_score": 0.5,
                    "content_type": "sponsored",
                    "content_type_label": "推广",
                    "reason": f"商业推广：{ad_evidence}",
                    "signals": [
                        {"dimension": "promotion", "effect": -0.9, "evidence": ad_evidence, "label": "商业推广"}
                    ],
                    "rank_score": 0.05
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

    def markdown_to_telegram_html(self, md_text: str) -> str:
        """
        Safely converts standard Markdown to Telegram HTML format.
        Handles links, bold, italic, inline code, code blocks, bullet lists, blockquotes.
        """
        if not md_text:
            return ""

        text = md_text.strip()
        text = html.escape(text, quote=False)

        # Markdown links [title](url)
        text = re.sub(r'\[([^\]]+)\]\((https?://[^\s\)]+)\)', r'<a href="\2">\1</a>', text)
        # Code blocks ```lang\ncode```
        text = re.sub(r'```([a-zA-Z0-9_-]*)\n([\s\S]*?)```', r'<pre><code>\2</code></pre>', text)
        # Inline code `code`
        text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
        # Headers (# ~ ######)
        text = re.sub(r'^(?:#{1,6})\s+(.+)$', r'<b>\1</b>', text, flags=re.MULTILINE)
        # Bold **text** or __text__
        text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
        text = re.sub(r'__(.+?)__', r'<b>\1</b>', text)
        # Italic *text* or _text_
        text = re.sub(r'(?<![a-zA-Z0-9])\*([^\*\n]+)\*(?![a-zA-Z0-9])', r'<i>\1</i>', text)
        text = re.sub(r'(?<![a-zA-Z0-9])_([^_\n]+)_(?![a-zA-Z0-9])', r'<i>\1</i>', text)
        # Markdown bullets - or * at line start to •
        text = re.sub(r'^\s*[-*]\s+', '• ', text, flags=re.MULTILINE)
        # Blockquotes > text
        text = re.sub(r'^(?:&gt;|>)\s*(.+)$', r'<blockquote>\1</blockquote>', text, flags=re.MULTILINE)
        # Clean redundant blank lines
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    def format_article_telegram_card(
        self,
        title: str,
        source_title: str,
        group_name: str,
        summary: str,
        url: str,
        reader_url: str,
        discussion_count: int = 0
    ) -> Dict[str, Any]:
        """
        Builds a beautifully styled Telegram HTML card with:
        - Escaped Title & Source & Category tags
        - One-line TL;DR (if present) prominently visible outside the fold
        - Detailed bullet points inside an expandable blockquote
        - Clean inline keyboard buttons (original link + web reader)
        """
        clean_title = html.escape(title.strip())
        clean_src = html.escape(source_title.strip())
        clean_grp = html.escape(group_name.strip())

        summary = (summary or "").strip()
        tldr_part = ""
        detail_lines = []

        if summary:
            lines = summary.split("\n")
            for line in lines:
                if not tldr_part and any(k in line for k in ["速览", "一句话", "💡"]):
                    tldr_part = self.markdown_to_telegram_html(line)
                else:
                    detail_lines.append(line)

        detail_html = self.markdown_to_telegram_html("\n".join(detail_lines))

        card_parts = [
            f"📖 <b>{clean_title}</b>",
            f"🏷️ <code>{clean_src}</code> · <code>{clean_grp}</code>",
            "━━━━━━━━━━━━━━━━━━━━━━"
        ]

        if tldr_part:
            card_parts.append(tldr_part)
            card_parts.append("")

        if detail_html:
            card_parts.append(f"<blockquote expandable>\n{detail_html}\n</blockquote>")

        if discussion_count > 0:
            card_parts.append(f"💬 <i>包含 {discussion_count} 条社区楼层讨论</i>")

        text = "\n".join(card_parts)

        # Truncate if exceeds safe length
        if len(text) > 3900:
            text = text[:3850] + "..."
            if "<blockquote" in text and "</blockquote>" not in text:
                text += "</blockquote>"

        reply_markup = {
            "inline_keyboard": [
                [
                    {"text": "🌐 查看原文", "url": url},
                    {"text": "📖 站内精读", "url": reader_url}
                ]
            ]
        }

        return {"text": text, "reply_markup": reply_markup}

    async def push_telegram_notification(
        self,
        text: str,
        parse_mode: Optional[str] = "HTML",
        reply_markup: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Pushes notification to configured Telegram Chat ID with HTML formatting
        and automatic plaintext fallback on parse errors.
        """
        if not settings.TG_BOT_TOKEN or not settings.TG_CHAT_ID:
            return False

        url = f"https://api.telegram.org/bot{settings.TG_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": settings.TG_CHAT_ID,
            "text": text[:3950],
            "disable_web_page_preview": True,
        }
        if parse_mode:
            payload["parse_mode"] = parse_mode
        if reply_markup:
            payload["reply_markup"] = reply_markup

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    return True
                
                logger.warning(f"Telegram push failed ({resp.status_code}): {resp.text}, falling back to plain text")
                # Fallback to plain text if HTML parsing failed
                plain_text = re.sub(r'<[^>]+>', '', text)[:3950]
                payload["text"] = plain_text
                payload.pop("parse_mode", None)
                fb_resp = await client.post(url, json=payload)
                return fb_resp.status_code == 200
        except Exception as e:
            logger.warning(f"Telegram push failed: {e}")
            return False

ai_service = AIService()
