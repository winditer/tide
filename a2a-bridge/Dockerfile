# ============================================================================
# Tide A2A Bridge 容器镜像
# 多阶段构建：第一阶段安装 Node CLI，第二阶段安装 Python 依赖并打包应用
# ============================================================================
FROM node:20-bookworm-slim AS cli-builder

ENV DEBIAN_FRONTEND=noninteractive \
    NPM_CONFIG_LOGLEVEL=warn

# 安装 codex / claude / qoder CLI（npm 全局安装）
# 网络受限环境可在 build 时通过 --build-arg NPM_REGISTRY 替换镜像源
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN npm config set registry "$NPM_REGISTRY" \
 && npm install -g --omit=optional --force \
        @openai/codex \
        @anthropic-ai/claude-code \
        @qoder-ai/qodercli \
 || (echo "WARN: some CLI packages failed to install; runtime will still start but those skills may be unavailable" && true)


FROM python:3.11-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    BRIDGE_HOST=0.0.0.0 \
    BRIDGE_PORT=8720 \
    BRIDGE_WORK_DIR=/workspace

# 安装 Node 运行时（CLI 需要）和 git（部分 CLI 行为依赖）
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        curl ca-certificates git tini \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# 复制 npm 全局安装产物，并按 package.json 的 bin 字段重建符号链接
COPY --from=cli-builder /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN set -eux; \
    mkdir -p /usr/local/bin; \
    if [ -f /usr/local/lib/node_modules/@openai/codex/bin/codex.js ]; then \
        ln -sf /usr/local/lib/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex; \
    fi; \
    if [ -f /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js ]; then \
        ln -sf /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js /usr/local/bin/claude; \
    elif [ -f /usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe ]; then \
        ln -sf /usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe /usr/local/bin/claude; \
    fi; \
    if [ -f /usr/local/lib/node_modules/@qoder-ai/qodercli/bundle/qodercli.js ]; then \
        ln -sf /usr/local/lib/node_modules/@qoder-ai/qodercli/bundle/qodercli.js /usr/local/bin/qoder; \
    fi

# 应用代码
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app/

# 创建工作目录
RUN mkdir -p /workspace

EXPOSE 8720

# tini 作为 PID 1，确保子进程信号能正确传递
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8720"]
