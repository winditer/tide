#!/usr/bin/env bash
#
# convert.sh — 需求转 Tide 工作项完整流程示例
#
# 演示如何通过 curl 调用 Tide API 完成：
#   1. 验证 API 连通性
#   2. AI 分解需求文本
#   3. 批量创建工作项
#
# 前置条件：
#   export TIDE_API_URL="http://localhost:8000"
#   export TIDE_API_TOKEN="your-api-token"
#
# 用法：
#   chmod +x convert.sh
#   ./convert.sh

set -euo pipefail

# ============================================================
# 环境变量检查
# ============================================================

if [ -z "${TIDE_API_URL:-}" ]; then
  echo "❌ 错误: 未设置 TIDE_API_URL 环境变量"
  echo "   示例: export TIDE_API_URL=\"http://localhost:8000\""
  exit 1
fi

if [ -z "${TIDE_API_TOKEN:-}" ]; then
  echo "❌ 错误: 未设置 TIDE_API_TOKEN 环境变量"
  echo "   示例: export TIDE_API_TOKEN=\"your-api-token\""
  exit 1
fi

# 通用请求头
AUTH_HEADER="Authorization: Bearer ${TIDE_API_TOKEN}"
CONTENT_TYPE="Content-Type: application/json"

# 步骤 2 使用的需求文本和项目 ID
DECOMPOSE_TEXT="开发一个用户管理系统，需要包含用户注册登录、个人资料编辑、头像上传、密码修改、邮箱验证等功能。后端使用 Python FastAPI，前端使用 React，数据库使用 PostgreSQL。需要编写完整的单元测试和集成测试，测试覆盖率不低于 80%。"
DECOMPOSE_PROJECT_ID="YOUR_PROJECT_ID"

# 检查 jq 是否可用，用于格式化 JSON 输出
format_json() {
  if command -v jq &>/dev/null; then
    jq .
  else
    cat
  fi
}

# HTTP 状态码检查辅助函数
check_response() {
  local step_name="$1"
  local http_code="$2"
  local response_body="$3"

  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    echo "✅ ${step_name} 成功 (HTTP ${http_code})"
  else
    echo "❌ ${step_name} 失败 (HTTP ${http_code})"
    echo "   响应内容:"
    echo "$response_body" | format_json
    exit 1
  fi
}

echo "============================================================"
echo "  Tide 需求转工作项流程"
echo "  API: ${TIDE_API_URL}"
echo "============================================================"
echo ""

# ============================================================
# 步骤 1: 验证 API 连通性
# ============================================================
# 调用项目列表接口确认 Token 有效且服务可达

echo "📡 步骤 1/3: 验证 API 连通性..."
echo "   GET ${TIDE_API_URL}/api/projects"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "${AUTH_HEADER}" \
  "${TIDE_API_URL}/api/projects")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

check_response "API 连通性验证" "$HTTP_CODE" "$BODY"

# 显示可用项目列表
echo "   可用项目:"
echo "$BODY" | format_json
echo ""

# ============================================================
# 步骤 2: AI 分解需求
# ============================================================
# 将自然语言需求文本发送给 AI 进行智能分解
# 返回结构化的工作项建议列表

echo "🤖 步骤 2/3: AI 分解需求..."
echo "   POST ${TIDE_API_URL}/api/work-items/ai-decompose"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "${AUTH_HEADER}" \
  -F "project_id=${DECOMPOSE_PROJECT_ID}" \
  -F "text=${DECOMPOSE_TEXT}" \
  "${TIDE_API_URL}/api/work-items/ai-decompose")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

check_response "AI 需求分解" "$HTTP_CODE" "$BODY"

echo "   AI 分解结果:"
echo "$BODY" | format_json
echo ""

# ============================================================
# 步骤 3: 批量创建工作项
# ============================================================
# 使用结构化数据批量创建工作项
# 实际使用时可将步骤 2 的输出结果直接作为输入

echo "📝 步骤 3/3: 批量创建工作项..."
echo "   POST ${TIDE_API_URL}/api/work-items/batch"
echo ""

BATCH_PAYLOAD=$(cat <<'EOF'
{
  "project_id": "YOUR_PROJECT_ID",
  "version_id": null,
  "items": [
    {
      "title": "用户注册与登录模块",
      "description": "实现用户注册、登录、登出功能，包含表单验证、错误处理和安全措施",
      "priority": 1,
      "tags": ["backend", "auth"],
      "source_type": "agent_skill",
      "metadata": {"module": "auth", "estimated_hours": 24}
    },
    {
      "title": "个人资料与头像管理",
      "description": "实现用户个人资料的查看与编辑，支持头像上传（限制大小和格式）",
      "priority": 2,
      "tags": ["backend", "frontend", "upload"],
      "source_type": "agent_skill",
      "metadata": {"module": "profile", "estimated_hours": 16}
    },
    {
      "title": "密码修改与邮箱验证",
      "description": "实现密码修改流程（需验证旧密码）和邮箱验证功能（发送验证链接）",
      "priority": 2,
      "tags": ["backend", "security", "email"],
      "source_type": "agent_skill",
      "metadata": {"module": "security", "estimated_hours": 20}
    },
    {
      "title": "数据库设计与迁移脚本",
      "description": "设计 PostgreSQL 数据表结构，编写 Alembic 迁移脚本",
      "priority": 1,
      "tags": ["database", "migration"],
      "source_type": "agent_skill",
      "metadata": {"module": "database", "estimated_hours": 12}
    },
    {
      "title": "测试套件搭建",
      "description": "搭建 pytest + httpx 测试框架，编写单元测试和集成测试，覆盖率目标 80%",
      "priority": 2,
      "tags": ["testing", "ci"],
      "source_type": "agent_skill",
      "metadata": {"coverage_target": "80%", "estimated_hours": 20}
    }
  ]
}
EOF
)

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "${AUTH_HEADER}" \
  -H "${CONTENT_TYPE}" \
  -d "${BATCH_PAYLOAD}" \
  "${TIDE_API_URL}/api/work-items/batch")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

check_response "批量创建工作项" "$HTTP_CODE" "$BODY"

echo "   创建结果:"
echo "$BODY" | format_json
echo ""

# ============================================================
# 完成
# ============================================================

echo "============================================================"
echo "  ✅ 全部步骤执行完毕！"
echo "============================================================"
echo ""
echo "后续操作："
echo "  - 在 Tide 界面中查看新创建的工作项"
echo "  - 使用 GET /api/work-items?project_id=YOUR_PROJECT_ID 查询"
echo "  - 通过工作流自动分配给 Agent 执行"
