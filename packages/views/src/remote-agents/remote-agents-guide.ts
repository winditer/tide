// Remote agent registration & A2A Bridge deployment guide content.
export const REMOTE_AGENTS_GUIDE = `# 远程 Agent 注册与 A2A Bridge 部署指南

## 概述

远程 Agent 是通过 A2A（Agent-to-Agent）协议与 Tide 通信的外部 AI Agent 服务。
支持两种连接模式：
- **HTTP 模式（默认）**：Tide 主动调用 Agent 端点，适合有公网入口的服务
- **WebSocket 推模式（Daemon）**：Agent 主动连接 Tide，适合 NAT/防火墙后的服务

## 快速开始：HTTP 模式

### 1. 安装 A2A Bridge

A2A Bridge 是 Tide 官方提供的 Agent 适配层，将本地 CLI Agent 暴露为 A2A 协议端点。

**方式 A：npx 直接运行（推荐，无需安装）**

\`\`\`bash
npx @tide-ai/a2a-bridge setup
npx @tide-ai/a2a-bridge start
\`\`\`

**方式 B：全局安装**

\`\`\`bash
npm install -g @tide-ai/a2a-bridge
\`\`\`

> 如果遇到 EACCES 权限错误：
> \`\`\`bash
> npm config set prefix ~/.local
> export PATH="$HOME/.local/bin:$PATH"  # 添加到 ~/.zshrc
> npm install -g @tide-ai/a2a-bridge
> \`\`\`

**方式 C：Python 直接安装**

\`\`\`bash
pip install -e /path/to/a2a-bridge
python3 -m a2a_bridge start
\`\`\`

安装完成后运行交互式配置向导：
\`\`\`bash
a2a-bridge setup
\`\`\`

向导会引导你完成：
- 检测并安装 CLI Agent（codex/claude/qoder）
- 配置服务端口和 API 密钥
- 选择连接模式（HTTP 或 WebSocket）
- 生成配置文件（~/.a2a-bridge/.env）

### 2. 启动服务

\`\`\`bash
a2a-bridge start
\`\`\`

验证服务状态：
\`\`\`bash
a2a-bridge status
\`\`\`

环境诊断：
\`\`\`bash
a2a-bridge doctor
\`\`\`

### 3. 在 Tide 中注册

1. 点击「注册 Agent」按钮
2. 输入 Agent Card URL：\`http://your-host:9100/.well-known/agent.json\`
3. 点击「发现」自动填充 Agent 信息
4. 配置认证方式（如 Bearer Token）
5. 测试连通性，确认可用

## WebSocket 推模式（Daemon）

适用于 Bridge 部署在 NAT/防火墙后、无法被 Tide 主动访问的场景。

### 1. 后端配置

在 Tide 后端 \`.env\` 中设置共享密钥：
\`\`\`bash
DAEMON_TOKEN=your-shared-secret
\`\`\`

### 2. Bridge 配置

运行 Daemon 模式配置向导：
\`\`\`bash
a2a-bridge setup --daemon
\`\`\`

向导将交互式引导你完成：
- 是否启用 Daemon 推模式
- 输入 Tide 后端 WebSocket 地址（默认 ws://localhost:8000/ws/daemon）
- 自动生成或输入共享 Token
- 配置 Daemon ID、心跳间隔、能力标签

所有配置写入 \`~/.a2a-bridge/.env\`，重启后生效。

或手动编辑 \`~/.a2a-bridge/.env\`：
\`\`\`bash
DAEMON_ENABLED=true
TIDE_WS_URL=ws://tide-backend:8000/ws/daemon
DAEMON_TOKEN=your-shared-secret

# 可选配置
DAEMON_ID=my-bridge-01
HEARTBEAT_INTERVAL=15
CAPABILITY_TAGS=code,review,docs
\`\`\`

### 3. 启动 Bridge

启动后 Bridge 将自动：
- 连接到 Tide 后端 WebSocket 端点
- 注册本地 Agent 能力
- 维持心跳保活（默认 15 秒）
- 接收并执行 Tide 下发的任务
- 断线时自动重连（指数退避）

注册成功后，Agent 会自动出现在远程 Agent 列表中，\`connection_mode\` 标记为 \`ws\`。

## 连接模式对比

| 特性 | HTTP 模式 | WebSocket 推模式 |
|------|----------|----------------|
| 网络要求 | Bridge 需有公网入口 | Bridge 只需能出网 |
| 延迟 | 每次调用建立新连接 | 长连接，低延迟 |
| 状态感知 | 定期健康检查 | 实时心跳监测 |
| 适用场景 | 云端部署 | NAT/内网/开发环境 |
| 配置复杂度 | 低 | 中（需配置 Token） |

## Docker 部署

\`\`\`bash
docker run -d \\
  --name a2a-bridge \\
  -e BRIDGE_HOST=0.0.0.0 \\
  -e BRIDGE_PORT=9100 \\
  -e DAEMON_ENABLED=true \\
  -e TIDE_WS_URL=ws://tide-backend:8000/ws/daemon \\
  -e DAEMON_TOKEN=your-secret \\
  -e CODEX_BIN=codex \\
  -p 9100:9100 \\
  tide-a2a-bridge:latest
\`\`\`

## 故障排除

**连通性测试失败**
- 确认 Bridge 服务已启动且端口可达
- 检查防火墙/安全组规则
- 验证 Agent Card URL 可正常访问

**WebSocket 连接失败**
- 确认 \`TIDE_WS_URL\` 格式正确（ws:// 或 wss://）
- 确认后端和 Bridge 的 \`DAEMON_TOKEN\` 一致
- 检查后端日志中是否有 \`Invalid daemon token\` 错误

**Agent 注册后不执行任务**
- 检查 Agent 的 \`enabled\` 状态
- 确认 \`scope\` 配置正确（全局/项目/个人）
- 验证 CLI Agent（如 codex）已正确安装

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | \`/api/remote-agents\` | 列出所有远程 Agent |
| POST | \`/api/remote-agents\` | 注册新 Agent |
| PUT | \`/api/remote-agents/{id}\` | 更新 Agent 配置 |
| DELETE | \`/api/remote-agents/{id}\` | 删除 Agent |
| POST | \`/api/remote-agents/{id}/test\` | 测试连通性 |
| POST | \`/api/remote-agents/discover\` | 通过 Card URL 发现 |
`;
