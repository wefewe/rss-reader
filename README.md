# AI Reader (数字图书馆 RSS 阅读器)

现代化的私人中文 AI RSS 阅读器与信息流中心。集成 14 个主流科技、工具、折腾与福利资讯源，支持全文精准提纯、大模型结构化中文摘要预计算、三态价值分流、09:00 晨间数字早报，以及 LINUX DO 社区楼层讨论投喂。

## 特色能力

- **沉浸式三栏工作台**：借鉴 Follow 与 Readwise Reader，支持左侧分组源树、中间卡片流、右侧深度阅读区；
- **全键盘极速流**：`J` 下一篇、`K` 上一篇、`M` 切换已读、`S` 星标收藏、`O` 跳转原文；
- **全量异步预处理（0秒即阅）**：文章入库时后台异步并发生成中文 TL;DR 与 3 点 Takeaways，阅读时零等待；
- **智能价值三态分流（AI Triage）**：自动评估信息质量与推广倾向，划分为“精选”、“一般”与“折叠”；
- **LINUX DO 社区楼层渲染**：保留 Discourse 多楼层结构化讨论，沉浸式浏览作者回帖；
- **每日 09:00 晨间早报**：多板块智能归纳与事实汇编，支持原文摘录降级保底，可选 Telegram 自动推送；
- **多模型灵活分工**：通过 OpenAI 兼容接口（如 AxonHub）无缝挂载 DeepSeek V4.1、GPT-5.6 等模型。

## 部署运行

### Docker Compose

```yaml
version: "3.8"

services:
  rss-reader:
    image: ghcr.io/wefewe/rss-reader:latest
    container_name: rss-reader
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - TZ=Asia/Shanghai
      - DATABASE_URL=sqlite+aiosqlite:////data/reader.db
      - LLM_BASE_URL=http://axonhub:8090/v1
      - LLM_API_KEY=your_api_key_here
      - LLM_SUMMARY_MODEL=deepseek-v4.1-flash
      - LLM_BRIEF_MODEL=gpt-5.6-terra
      - TG_BOT_TOKEN=
      - TG_CHAT_ID=
    volumes:
      - ./data:/data
```

## API 动作契约

后端暴露 13 个符合标准化契约的动作：

- `POST /api/reader/listreader`：获取文章流、分组与偏好
- `POST /api/reader/getarticle`：读取单篇文章（支持裸 URL 或复合 ID）
- `POST /api/reader/refreshfeeds`：手动触发全量源刷新
- `POST /api/reader/ingestexternalfeed`：外部论坛（如 LINUX DO）增量楼层投喂
- `POST /api/reader/fetcharticlefulltext`：正文抓取与提取
- `POST /api/reader/summarizearticle`：AI 结构化摘要生成
- `POST /api/reader/generatedailybrief`：手动触发早报生成
- `POST /api/reader/setarticleread`：标记已读状态
- `POST /api/reader/setarticlestarred`：标记收藏星标
- `POST /api/reader/setarticlefeedback`：点赞 / 踩反馈
- `POST /api/reader/markallread`：批量标读
- `POST /api/reader/updatereaderpreferences`：更新视图与过滤偏好
- `POST /api/reader/analyzefeed`：订阅源健康度与评分分析

## 开源协议

MIT License
