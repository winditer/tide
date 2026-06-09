"""
从 .lark2agent_state.json / .lark_codex_state.json 以及本地 Codex/Claude/Qoder
session 文件迁移历史会话到 conversations 表。

一次性脚本，幂等运行（已存在的 (workspace_id, chat_id, session_id) 组合不会重复插入）。

运行方式：
    cd /Users/haifeng/Documents/lark2codex
    python -m backend.scripts.migrate_conversations

可选环境变量：
    MIGRATE_WORKSPACE_ID   目标 workspace（默认 default）
    MIGRATE_DB_PATH        SQLite 文件路径（默认 lark2agent.db）
    MIGRATE_MAX_FILES      每个 Agent 扫描的最近 session 文件数量（默认 300）
    MIGRATE_DRY_RUN=1      只打印不写入
    CODEX_SESSIONS_DIR / CLAUDE_PROJECTS_DIR / QODER_PROJECTS_DIR
                           覆盖默认 session 目录
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("migrate_conversations")

PROJECT_ROOT = Path(__file__).resolve().parents[2]

WORKSPACE_ID = os.getenv("MIGRATE_WORKSPACE_ID", "default")
DB_PATH = Path(os.getenv("MIGRATE_DB_PATH", str(PROJECT_ROOT / "lark2agent.db")))
MAX_FILES = int(os.getenv("MIGRATE_MAX_FILES", "300"))
DRY_RUN = os.getenv("MIGRATE_DRY_RUN", "0") == "1"

STATE_FILES = [
    PROJECT_ROOT / ".lark2agent_state.json",
    PROJECT_ROOT / ".lark_codex_state.json",
]

CODEX_SESSIONS_DIR = Path(
    os.getenv("CODEX_SESSIONS_DIR", str(Path.home() / ".codex" / "sessions"))
).expanduser()
CLAUDE_PROJECTS_DIR = Path(
    os.getenv("CLAUDE_PROJECTS_DIR", str(Path.home() / ".claude" / "projects"))
).expanduser()
QODER_PROJECTS_DIR = Path(
    os.getenv("QODER_PROJECTS_DIR", str(Path.home() / ".qoder" / "projects"))
).expanduser()


# -------------------- 工具函数 --------------------


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _ts_to_iso(ts: float) -> str:
    if not ts:
        return _now_iso()
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).replace(tzinfo=None).isoformat()
    except (ValueError, OSError):
        return _now_iso()


def _normalize_agent_id(agent_id: str = "") -> str:
    value = str(agent_id or "").strip().lower()
    aliases = {
        "": "codex",
        "code": "codex",
        "codexcli": "codex",
        "codex-cli": "codex",
        "claude-code": "claude",
        "claudecode": "claude",
        "claudecli": "claude",
        "claude-cli": "claude",
        "qoder-cli": "qoder",
        "qodercli": "qoder",
    }
    value = aliases.get(value, value)
    return value if value in {"codex", "claude", "qoder"} else "codex"


def _split_session_key(value: str) -> tuple[str, str]:
    """与 lark2agent_ws.split_conversation_key 行为一致：
    - "claude:xxxx" -> ("claude", "xxxx")
    - "qoder:xxxx"  -> ("qoder", "xxxx")
    - 其它          -> ("codex", value)
    """
    text = str(value or "").strip()
    if not text:
        return "codex", ""
    if ":" in text:
        prefix, rest = text.split(":", 1)
        agent = _normalize_agent_id(prefix)
        if agent != "codex" and rest:
            return agent, rest
    return "codex", text


# -------------------- 状态文件解析 --------------------


def collect_state_records() -> list[dict]:
    """从状态文件中收集会话候选记录。
    每条记录包含：chat_id, agent_id, session_id, cwd, last_active_at(epoch), source。
    """
    records: list[dict] = []
    for state_file in STATE_FILES:
        if not state_file.exists():
            continue
        try:
            data = json.loads(state_file.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("无法解析状态文件 %s: %s", state_file, exc)
            continue

        chats = data.get("chats") or {}
        for chat_id, chat in chats.items():
            cwd = chat.get("cwd") or chat.get("task_cwd") or ""
            active_agent = _normalize_agent_id(
                chat.get("active_agent_id") or chat.get("task_agent_id") or "codex"
            )
            for sess_field, agent_hint in (
                ("active_session_id", active_agent),
                ("task_session_id", chat.get("task_agent_id") or active_agent),
            ):
                raw = chat.get(sess_field)
                if not raw:
                    continue
                agent_id, session_id = _split_session_key(str(raw))
                if not session_id:
                    continue
                # 优先使用 split 出的 agent；否则用 hint
                if agent_id == "codex" and ":" not in str(raw):
                    agent_id = _normalize_agent_id(agent_hint)
                records.append(
                    {
                        "chat_id": chat_id,
                        "agent_id": agent_id,
                        "session_id": session_id,
                        "cwd": cwd,
                        "last_active_at": float(chat.get("task_started_at") or 0),
                        "source": f"state:{state_file.name}:{sess_field}",
                    }
                )

        message_refs = data.get("message_refs") or {}
        for ref in message_refs.values():
            raw_session = ref.get("session_id")
            if not raw_session:
                continue
            chat_id = ref.get("chat_id") or _chat_id_from_ref_key(ref)
            agent_id, session_id = _split_session_key(str(raw_session))
            if not session_id:
                continue
            records.append(
                {
                    "chat_id": chat_id,
                    "agent_id": agent_id,
                    "session_id": session_id,
                    "cwd": ref.get("cwd") or "",
                    "last_active_at": float(ref.get("updated_at") or 0),
                    "source": f"state:{state_file.name}:message_refs",
                }
            )
    return records


def _chat_id_from_ref_key(ref: dict) -> Optional[str]:
    # 状态文件中 message_refs key 形如 "chat_id:message_id"，但条目内通常已含 chat_id 字段
    return ref.get("chat_id")


# -------------------- session 文件扫描 --------------------


def _iter_session_files(directory: Path, max_files: int) -> list[Path]:
    if not directory.exists():
        return []
    try:
        files = list(directory.glob("**/*.jsonl"))
    except OSError:
        return []
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return files[:max_files]


def _peek_codex_meta(path: Path) -> tuple[Optional[str], Optional[str]]:
    """Codex session 文件首行通常包含 session_meta，含 id 和 cwd。"""
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as fp:
            for line in fp:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if obj.get("type") == "session_meta":
                    payload = obj.get("payload") or {}
                    return payload.get("id"), payload.get("cwd")
                # 不是 session_meta 时不强求继续读，避免大文件全量扫描
                break
    except OSError:
        return None, None
    return None, None


def _peek_claude_meta(path: Path) -> tuple[Optional[str], Optional[str]]:
    """Claude/Qoder session 文件每行都可能带 sessionId、cwd。读前若干行即可。"""
    session_id: Optional[str] = None
    cwd: Optional[str] = None
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as fp:
            for idx, line in enumerate(fp):
                if idx > 30:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not session_id:
                    raw = obj.get("sessionId") or obj.get("session_id")
                    if raw:
                        session_id = str(raw)
                if not cwd and obj.get("cwd"):
                    cwd = str(obj.get("cwd"))
                if session_id and cwd:
                    break
    except OSError:
        return None, None
    return session_id, cwd


def collect_file_records() -> list[dict]:
    records: list[dict] = []

    for path in _iter_session_files(CODEX_SESSIONS_DIR, MAX_FILES):
        sid, cwd = _peek_codex_meta(path)
        if not sid:
            sid = path.stem.split("-")[-1]
        records.append(
            {
                "chat_id": None,
                "agent_id": "codex",
                "session_id": sid,
                "cwd": cwd or "",
                "last_active_at": path.stat().st_mtime,
                "source": "file:codex",
            }
        )

    for path in _iter_session_files(CLAUDE_PROJECTS_DIR, MAX_FILES):
        sid, cwd = _peek_claude_meta(path)
        if not sid:
            sid = path.stem
        records.append(
            {
                "chat_id": None,
                "agent_id": "claude",
                "session_id": sid,
                "cwd": cwd or "",
                "last_active_at": path.stat().st_mtime,
                "source": "file:claude",
            }
        )

    for path in _iter_session_files(QODER_PROJECTS_DIR, MAX_FILES):
        sid, cwd = _peek_claude_meta(path)  # 结构与 claude 一致
        if not sid:
            sid = path.stem
        records.append(
            {
                "chat_id": None,
                "agent_id": "qoder",
                "session_id": sid,
                "cwd": cwd or "",
                "last_active_at": path.stat().st_mtime,
                "source": "file:qoder",
            }
        )

    return records


# -------------------- 合并与写库 --------------------


def merge_records(*record_lists: list[dict]) -> list[dict]:
    """按 (agent_id, session_id) 合并，state 优先注入 chat_id；保留最新 last_active_at。"""
    merged: dict[tuple[str, str], dict] = {}
    for records in record_lists:
        for rec in records:
            key = (rec["agent_id"], rec["session_id"])
            current = merged.get(key)
            if current is None:
                merged[key] = dict(rec)
                continue
            # chat_id：state 优先（先来后到，第一份保留），但若现有 None 则补齐
            if not current.get("chat_id") and rec.get("chat_id"):
                current["chat_id"] = rec["chat_id"]
            # cwd：补齐
            if not current.get("cwd") and rec.get("cwd"):
                current["cwd"] = rec["cwd"]
            # last_active_at：取较大值
            if float(rec.get("last_active_at") or 0) > float(current.get("last_active_at") or 0):
                current["last_active_at"] = rec["last_active_at"]
            # source 合并（仅 debug 用）
            current["source"] = f"{current.get('source','')}|{rec.get('source','')}"
    return list(merged.values())


def upsert_conversations(conn: sqlite3.Connection, rows: list[dict]) -> tuple[int, int]:
    """幂等写入。返回 (created, updated) 数量。"""
    created = 0
    updated = 0
    cur = conn.cursor()

    for row in rows:
        chat_id = row.get("chat_id")
        agent_id = row["agent_id"]
        session_id = row["session_id"]
        cwd = row.get("cwd") or None
        last_active_iso = _ts_to_iso(row.get("last_active_at") or 0)

        # 查找已有记录：优先按 (workspace_id, agent_id, session_id) 唯一定位
        cur.execute(
            """
            SELECT id FROM conversations
            WHERE workspace_id = ?
              AND agent_id = ?
              AND COALESCE(session_id, '') = ?
            LIMIT 1
            """,
            (WORKSPACE_ID, agent_id, session_id),
        )
        existing = cur.fetchone()

        if existing:
            conv_id = existing[0]
            cur.execute(
                """
                UPDATE conversations
                SET chat_id = COALESCE(?, chat_id),
                    cwd = COALESCE(?, cwd),
                    last_active_at = MAX(COALESCE(last_active_at, ''), ?),
                    status = CASE WHEN status = 'closed' THEN status ELSE 'idle' END
                WHERE id = ?
                """,
                (chat_id, cwd, last_active_iso, conv_id),
            )
            updated += 1
            continue

        conv_id = str(uuid.uuid4())
        metadata = json.dumps(
            {"migrated_from": row.get("source", ""), "imported_at": _now_iso()},
            ensure_ascii=False,
        )
        cur.execute(
            """
            INSERT INTO conversations
                (id, workspace_id, chat_id, agent_id, model,
                 session_id, cwd, status, last_active_at, created_at, metadata)
            VALUES
                (?, ?, ?, ?, '', ?, ?, 'idle', ?, ?, ?)
            """,
            (
                conv_id,
                WORKSPACE_ID,
                chat_id,
                agent_id,
                session_id,
                cwd,
                last_active_iso,
                last_active_iso,
                metadata,
            ),
        )
        created += 1

    conn.commit()
    return created, updated


def main() -> int:
    logger.info("workspace=%s db=%s max_files=%d dry_run=%s",
                WORKSPACE_ID, DB_PATH, MAX_FILES, DRY_RUN)

    if not DB_PATH.exists():
        logger.error("数据库文件不存在: %s", DB_PATH)
        return 2

    state_records = collect_state_records()
    logger.info("state 记录: %d 条", len(state_records))

    file_records = collect_file_records()
    logger.info(
        "session 文件记录: %d 条 (codex=%s, claude=%s, qoder=%s)",
        len(file_records),
        sum(1 for r in file_records if r["agent_id"] == "codex"),
        sum(1 for r in file_records if r["agent_id"] == "claude"),
        sum(1 for r in file_records if r["agent_id"] == "qoder"),
    )

    # state 在前，便于 chat_id 优先注入
    merged = merge_records(state_records, file_records)
    logger.info("合并后唯一会话: %d 条", len(merged))

    chat_id_count = sum(1 for r in merged if r.get("chat_id"))
    logger.info("其中带 chat_id 的: %d 条", chat_id_count)

    if DRY_RUN:
        for rec in sorted(merged, key=lambda r: r.get("last_active_at") or 0, reverse=True)[:10]:
            logger.info(
                "DRY-RUN: chat=%s agent=%s session=%s cwd=%s last=%s src=%s",
                rec.get("chat_id"),
                rec.get("agent_id"),
                rec.get("session_id")[:12],
                rec.get("cwd") or "",
                _ts_to_iso(rec.get("last_active_at") or 0),
                rec.get("source"),
            )
        return 0

    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        created, updated = upsert_conversations(conn, merged)
    finally:
        conn.close()

    logger.info("迁移完成: 新增 %d 条, 更新 %d 条", created, updated)
    return 0


if __name__ == "__main__":
    sys.exit(main())
