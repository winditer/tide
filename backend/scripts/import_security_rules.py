"""导入预置安全规则到指定 workspace。

用法：
    python -m backend.scripts.import_security_rules --workspace default
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import uuid

from sqlalchemy import text

from backend.db.engine import async_session_factory, init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("tide.import_security_rules")

# 预置安全规则
DEFAULT_RULES = [
    {
        "category": "secret_detection",
        "name": "Hardcoded API Key",
        "pattern": r"(?i)(api[_-]?key|apikey)\s*[=:]\s*['\"][A-Za-z0-9_\-]{20,}['\"]",
        "severity": "critical",
        "description": "检测到硬编码的 API Key，可能导致凭据泄露。",
        "remediation": "将 API Key 移至环境变量或密钥管理系统（如 Vault），不要在代码中硬编码。",
    },
    {
        "category": "secret_detection",
        "name": "Hardcoded Password",
        "pattern": r"(?i)(password|passwd|pwd)\s*[=:]\s*['\"][^'\"]{8,}['\"]",
        "severity": "critical",
        "description": "检测到硬编码的密码，存在凭据泄露风险。",
        "remediation": "使用环境变量或密钥管理服务存储密码，禁止在代码中明文存储。",
    },
    {
        "category": "secret_detection",
        "name": "AWS Access Key",
        "pattern": r"AKIA[0-9A-Z]{16}",
        "severity": "critical",
        "description": "检测到 AWS Access Key ID，可能导致云资源未授权访问。",
        "remediation": "立即轮换该 Key，使用 IAM Role 或 AWS Secrets Manager 代替硬编码凭据。",
    },
    {
        "category": "secret_detection",
        "name": "Private Key",
        "pattern": r"-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----",
        "severity": "critical",
        "description": "检测到私钥内容，可能导致加密体系被破坏。",
        "remediation": "将私钥存储在安全的密钥管理系统中，不要在代码或输出中包含私钥。",
    },
    {
        "category": "code_injection",
        "name": "SQL Injection (f-string)",
        "pattern": r"f['\"].*?(SELECT|INSERT|UPDATE|DELETE|DROP).*?\{",
        "severity": "critical",
        "description": "检测到使用 f-string 拼接 SQL 语句，存在 SQL 注入风险。",
        "remediation": "使用参数化查询（如 SQLAlchemy text() 的绑定变量）代替字符串拼接。",
    },
    {
        "category": "code_injection",
        "name": "Shell Injection",
        "pattern": r"(?i)os\.system\s*\(|subprocess\.call\s*\(.*shell\s*=\s*True",
        "severity": "critical",
        "description": "检测到不安全的 Shell 命令执行方式，存在命令注入风险。",
        "remediation": "使用 subprocess.run() 并传入列表参数，避免 shell=True；对用户输入进行严格校验。",
    },
    {
        "category": "code_injection",
        "name": "Eval/Exec Usage",
        "pattern": r"(?i)\b(eval|exec)\s*\(",
        "severity": "high",
        "description": "检测到 eval/exec 调用，可能导致任意代码执行。",
        "remediation": "避免使用 eval/exec，使用更安全的替代方案如 ast.literal_eval() 或专用解析器。",
    },
    {
        "category": "path_traversal",
        "name": "Path Traversal",
        "pattern": r"\.\./\.\./|\.\.\\\\\.\.\\\\",
        "severity": "high",
        "description": "检测到路径遍历模式，可能导致未授权文件访问。",
        "remediation": "使用 os.path.realpath() 规范化路径，并验证最终路径在允许的目录范围内。",
    },
    {
        "category": "dangerous_command",
        "name": "Destructive rm",
        "pattern": r"rm\s+(-rf?|--recursive).*(/|~|\$)",
        "severity": "high",
        "description": "检测到危险的 rm 命令，可能导致重要文件或目录被删除。",
        "remediation": "使用更安全的删除方式，添加交互确认，或使用 trash-cli 等工具代替直接删除。",
    },
    {
        "category": "dangerous_command",
        "name": "DROP TABLE",
        "pattern": r"(?i)DROP\s+(TABLE|DATABASE)",
        "severity": "high",
        "description": "检测到 DROP TABLE/DATABASE 语句，可能导致数据永久丢失。",
        "remediation": "确保 DROP 操作经过审批流程，并在执行前有完整备份。生产环境应禁止直接执行。",
    },
    {
        "category": "weak_crypto",
        "name": "Weak Hash (MD5/SHA1)",
        "pattern": r"(?i)(hashlib\.(md5|sha1)|MD5\(|SHA1\()",
        "severity": "medium",
        "description": "检测到使用 MD5 或 SHA1 等弱哈希算法，不适用于安全场景。",
        "remediation": "使用 SHA-256 或更强的哈希算法；密码场景使用 bcrypt/scrypt/argon2。",
    },
    {
        "category": "weak_crypto",
        "name": "Insecure Random",
        "pattern": r"(?i)random\.(random|randint|choice)\s*\(",
        "severity": "low",
        "description": "检测到使用非密码学安全的随机数生成器，不适用于安全敏感场景。",
        "remediation": "安全敏感场景（如 token 生成）使用 secrets 模块代替 random 模块。",
    },
]


async def import_rules(workspace_id: str):
    """将预置安全规则导入到指定 workspace。"""
    await init_db()

    async with async_session_factory() as session:
        # 检查已有规则，避免重复导入
        existing = (
            await session.execute(
                text("SELECT name FROM security_rules WHERE workspace_id = :ws"),
                {"ws": workspace_id},
            )
        ).fetchall()
        existing_names = {r._mapping["name"] for r in existing}

        imported = 0
        skipped = 0
        for rule in DEFAULT_RULES:
            if rule["name"] in existing_names:
                logger.info("Skipping existing rule: %s", rule["name"])
                skipped += 1
                continue

            await session.execute(
                text(
                    """INSERT INTO security_rules
                        (id, workspace_id, name, category, pattern, severity, description, remediation, enabled)
                        VALUES (:id, :ws, :name, :category, :pattern, :severity, :description, :remediation, 1)"""
                ),
                {
                    "id": str(uuid.uuid4()),
                    "ws": workspace_id,
                    "name": rule["name"],
                    "category": rule["category"],
                    "pattern": rule["pattern"],
                    "severity": rule["severity"],
                    "description": rule["description"],
                    "remediation": rule["remediation"],
                },
            )
            imported += 1
            logger.info("Imported rule: %s [%s]", rule["name"], rule["severity"])

        await session.commit()

    logger.info(
        "Import complete: %d imported, %d skipped (already exist)",
        imported,
        skipped,
    )


def main():
    parser = argparse.ArgumentParser(description="Import default security rules")
    parser.add_argument(
        "--workspace", default="default", help="Target workspace ID (default: 'default')"
    )
    args = parser.parse_args()

    asyncio.run(import_rules(args.workspace))


if __name__ == "__main__":
    main()
