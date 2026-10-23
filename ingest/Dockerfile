FROM mcr.microsoft.com/playwright/python:v1.48.0-noble

WORKDIR /app

# 安装 Python 运行依赖
COPY requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

# 拷贝抓取投喂脚本
COPY ingest.py .

# 默认环境变量配置
ENV INGEST_INTERVAL_MINUTES=30 \
    PYTHONUNBUFFERED=1

# 数据持久化目录（存放 watermark.json、storage_state.json、linuxdo_cookie.txt 等）
VOLUME ["/data"]

# 启动即运行脚本，轮询间隔由 INGEST_INTERVAL_MINUTES 环境变量控制
CMD ["python3", "-u", "/app/ingest.py"]
