# RSS Ingestion Worker (LINUX DO)

本目录包含 LINUX DO 社区话题抓取与自动化投喂 Worker 的脚本、依赖与容器构建定义。

## 架构与服务定位

Worker 基于 Playwright 驱动 Chromium 浏览器，保持持久化 Session 与 Turnstile 绕过能力，抓取 LINUX DO 社区精选板块（如搞七捻三、福利羊毛、资源荟萃等），提取 7 天内活跃话题与最新楼层讨论，调用 RSS Reader 后端 `/api/reader/ingestexternalfeed` 接口进行数据暂存与投喂。

## 与现行 Docker Swarm 服务的对应关系

- **Swarm 服务名**：`rss-reader_rss-ingest`
- **运行节点约束**：`node.labels.node == us-oracle`
- **持久化数据卷**：
  - 宿主机源路径：`/opt/rss-reader/data`
  - 容器内目标路径：`/data`
  - 数据卷内部文件：
    - `linuxdo_cookie.txt`: 初始/备选登录 `_t` Cookie
    - `storage_state.json`: Playwright 导出的浏览器 Cookie 与 LocalStorage 状态
    - `watermark.json`: 各话题已处理的最高楼层水印，防止重复抓取
- **环境变量配置**：
  | 变量名 | 说明 | 默认值 / 线上参考值 |
  |---|---|---|
  | `READER_API_URL` | 后端外部投喂接口地址 | `http://rss-reader:8000/api/reader/ingestexternalfeed` |
  | `READER_API_KEY` | 后端 API 通信密钥 | `reader_...` |
  | `INGEST_INTERVAL_MINUTES` | 两次抓取周期间隔（分钟） | `30` |
  | `TG_BOT_TOKEN` | Telegram 通知机器人 Token（可选） | - |
  | `TG_CHAT_ID` | Telegram 通知 Chat ID（可选） | - |
  | `TZ` | 容器时区 | `Asia/Shanghai` |

## 镜像收编与切换演进

1. **历史状态**：直接使用 `mcr.microsoft.com/playwright/python:v1.48.0-noble` 镜像，启动时通过 Command 执行 `pip install` 并挂载 `/opt/rss-reader/data/ingest.py` 执行。
2. **收编后状态**：代码与依赖固化进镜像 `ghcr.io/wefewe/rss-ingest:latest`，支持 amd64 / arm64 多架构构建，容器启动即运行 `/app/ingest.py`。
3. **切换操作（后续由 muse-spark 执行）**：
   - 更新 Swarm 服务镜像为 `ghcr.io/wefewe/rss-ingest:latest`；
   - 移除原 `TaskTemplate.ContainerSpec.Args` 中的动态 pip 安装与脚本运行指令；
   - 保留原挂载 `/opt/rss-reader/data:/data` 与网络配置。
