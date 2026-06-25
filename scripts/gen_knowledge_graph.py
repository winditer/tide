#!/usr/bin/env python3
"""Tide 仓库知识图谱生成脚本。

扫描给定仓库目录，生成 4 类知识图谱：
1. 模块依赖图 (module/module_graph.json + .md)
2. API 接口图谱 (api/api_graph.json + .md)
3. 数据库 Schema 图谱 (db/schema_graph.json + .md + er_diagram.md)
4. 业务概念图 (concept/concept_graph.json + .md)

产物存放于 ``<repo>/.knowledge/``，每类图谱同时输出机器可读 JSON 与
人可读 Markdown（含 Mermaid 图）。

仅依赖 Python 标准库（ast / re / json / pathlib / subprocess / argparse）。
"""

from __future__ import annotations

import argparse
import ast
import json
import logging
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

logger = logging.getLogger("tide.gen_knowledge_graph")

SCHEMA_VERSION = "1.0"

# ── 通用工具 ────────────────────────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _get_git_info(repo: Path) -> dict[str, Optional[str]]:
    """获取仓库当前 commit 与 branch。失败时返回 None。"""
    out: dict[str, Optional[str]] = {"commit": None, "branch": None}
    if not (repo / ".git").exists():
        return out
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=str(repo), stderr=subprocess.DEVNULL
        )
        out["commit"] = commit.decode().strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    try:
        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(repo),
            stderr=subprocess.DEVNULL,
        )
        out["branch"] = branch.decode().strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    return out


def _safe_read(path: Path, encoding: str = "utf-8") -> str:
    try:
        return path.read_text(encoding=encoding)
    except (OSError, UnicodeDecodeError):
        return ""


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _detect_python_root(repo: Path) -> Optional[Path]:
    """探测 Python 源代码根目录。优先 backend/，否则取首个含 __init__.py 的子目录。"""
    candidates = ["backend", "app", "src"]
    for c in candidates:
        p = repo / c
        if p.is_dir():
            return p
    # 回退：搜索仓库根下含 __init__.py 的目录
    for child in repo.iterdir():
        if child.is_dir() and (child / "__init__.py").exists():
            return child
    return None


# ── 模块依赖解析 ────────────────────────────────────────────────────────────


class ModuleGraphParser:
    """基于 AST 解析 Python 模块依赖关系。"""

    LAYER_HINTS: dict[str, str] = {
        "api": "API 路由层",
        "services": "业务服务层",
        "runtime": "底层执行层",
        "db": "数据库引擎",
        "core": "核心依赖与安全",
        "models": "数据模型",
        "scripts": "脚本工具",
        "tests": "测试",
    }

    def __init__(self, repo: Path, root: Path) -> None:
        self.repo = repo
        self.root = root
        # 内部 import 前缀（顶层包名）
        self.internal_prefix = root.name

    def parse(self) -> dict[str, Any]:
        modules: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []
        py_files = sorted(self.root.rglob("*.py"))

        for py in py_files:
            if "__pycache__" in py.parts:
                continue
            mod_info = self._parse_file(py)
            if mod_info:
                modules.append(mod_info)

        # 第二遍构建 imported_by 反向链 + edges
        mod_index = {m["id"]: m for m in modules}
        for m in modules:
            for dep in m["imports_internal"]:
                if dep in mod_index:
                    mod_index[dep].setdefault("imported_by", []).append(m["id"])
                    edges.append({"from": m["id"], "to": dep, "type": "import"})

        # 统计
        layer_stats: dict[str, int] = {}
        for m in modules:
            layer_stats[m["layer"]] = layer_stats.get(m["layer"], 0) + 1

        layers = [
            {"name": name, "path": f"{self.internal_prefix}/{name}", "description": desc}
            for name, desc in self.LAYER_HINTS.items()
            if name in layer_stats
        ]

        return {
            "schema_version": SCHEMA_VERSION,
            "generated_at": _now_iso(),
            "root": str(self.root.relative_to(self.repo)),
            "internal_prefix": self.internal_prefix,
            "layers": layers,
            "modules": modules,
            "edges": edges,
            "stats": {
                "total_modules": len(modules),
                "total_edges": len(edges),
                "layers": layer_stats,
            },
        }

    def _parse_file(self, py: Path) -> Optional[dict[str, Any]]:
        source = _safe_read(py)
        if not source:
            return None
        try:
            tree = ast.parse(source, filename=str(py))
        except SyntaxError as exc:
            logger.warning("AST parse failed for %s: %s", py, exc)
            return None

        rel = py.relative_to(self.repo)
        mod_id = self._file_to_module_id(py)
        layer = self._classify_layer(py)
        imports_internal, imports_external = self._extract_imports(tree)
        classes, functions = self._extract_symbols(tree)
        docstring = ast.get_docstring(tree) or ""
        description = docstring.strip().splitlines()[0] if docstring else ""

        return {
            "id": mod_id,
            "name": py.stem,
            "layer": layer,
            "file": str(rel),
            "lines": len(source.splitlines()),
            "description": description,
            "classes": classes,
            "functions": functions,
            "imports_internal": imports_internal,
            "imports_external": imports_external,
            "imported_by": [],
        }

    def _file_to_module_id(self, py: Path) -> str:
        rel = py.relative_to(self.root.parent)  # 让 root 的父目录作为根，保留 root 包名
        parts = list(rel.with_suffix("").parts)
        if parts and parts[-1] == "__init__":
            parts = parts[:-1]
        return ".".join(parts)

    def _classify_layer(self, py: Path) -> str:
        try:
            rel = py.relative_to(self.root)
        except ValueError:
            return "other"
        parts = rel.parts
        if not parts:
            return "root"
        return parts[0] if parts[0] in self.LAYER_HINTS else "other"

    def _extract_imports(self, tree: ast.Module) -> tuple[list[str], list[str]]:
        internal: set[str] = set()
        external: set[str] = set()
        prefix = self.internal_prefix + "."

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == self.internal_prefix or alias.name.startswith(prefix):
                        internal.add(alias.name)
                    else:
                        external.add(alias.name.split(".")[0])
            elif isinstance(node, ast.ImportFrom):
                if node.module is None:
                    continue
                full = node.module
                if full == self.internal_prefix or full.startswith(prefix):
                    internal.add(full)
                else:
                    external.add(full.split(".")[0])

        return sorted(internal), sorted(external)

    def _extract_symbols(self, tree: ast.Module) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        classes: list[dict[str, Any]] = []
        functions: list[dict[str, Any]] = []
        for node in tree.body:
            if isinstance(node, ast.ClassDef):
                methods = [
                    n.name
                    for n in node.body
                    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                ]
                classes.append(
                    {
                        "name": node.name,
                        "line": node.lineno,
                        "methods": methods[:20],
                        "doc": (ast.get_docstring(node) or "").splitlines()[0:1],
                    }
                )
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                functions.append(
                    {
                        "name": node.name,
                        "line": node.lineno,
                        "is_async": isinstance(node, ast.AsyncFunctionDef),
                        "doc": (ast.get_docstring(node) or "").splitlines()[0:1],
                    }
                )
        return classes, functions


# ── API 路由解析 ────────────────────────────────────────────────────────────


HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


class ApiGraphParser:
    """解析 FastAPI 路由。"""

    def __init__(self, repo: Path, root: Path) -> None:
        self.repo = repo
        self.root = root
        self.api_dir = root / "api"

    def parse(self) -> dict[str, Any]:
        routers: list[dict[str, Any]] = []
        if not self.api_dir.is_dir():
            return self._empty(routers)

        for py in sorted(self.api_dir.glob("*.py")):
            if py.name == "__init__.py":
                continue
            info = self._parse_router_file(py)
            if info:
                routers.append(info)

        method_stats: dict[str, int] = {}
        total_endpoints = 0
        for r in routers:
            for ep in r["endpoints"]:
                m = ep["method"].upper()
                method_stats[m] = method_stats.get(m, 0) + 1
                total_endpoints += 1

        return {
            "schema_version": SCHEMA_VERSION,
            "generated_at": _now_iso(),
            "routers": routers,
            "stats": {
                "total_routers": len(routers),
                "total_endpoints": total_endpoints,
                "methods": method_stats,
            },
        }

    def _empty(self, routers: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "schema_version": SCHEMA_VERSION,
            "generated_at": _now_iso(),
            "routers": routers,
            "stats": {"total_routers": 0, "total_endpoints": 0, "methods": {}},
        }

    def _parse_router_file(self, py: Path) -> Optional[dict[str, Any]]:
        source = _safe_read(py)
        if not source:
            return None
        try:
            tree = ast.parse(source, filename=str(py))
        except SyntaxError:
            return None

        prefix, tags = self._extract_router_info(tree)
        endpoints = self._extract_endpoints(tree)
        if not endpoints and not prefix:
            return None

        rel = py.relative_to(self.repo)
        service = self._infer_service(tree)

        return {
            "id": py.stem,
            "prefix": prefix,
            "tags": tags,
            "file": str(rel),
            "service": service,
            "endpoints": endpoints,
        }

    @staticmethod
    def _ast_literal(node: ast.AST) -> Any:
        try:
            return ast.literal_eval(node)
        except (ValueError, SyntaxError):
            return None

    def _extract_router_info(self, tree: ast.Module) -> tuple[str, list[str]]:
        prefix = ""
        tags: list[str] = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Assign):
                continue
            if not isinstance(node.value, ast.Call):
                continue
            func = node.value.func
            name = (
                func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
            )
            if name != "APIRouter":
                continue
            for kw in node.value.keywords:
                if kw.arg == "prefix":
                    val = self._ast_literal(kw.value)
                    if isinstance(val, str):
                        prefix = val
                elif kw.arg == "tags":
                    val = self._ast_literal(kw.value)
                    if isinstance(val, list):
                        tags = [str(x) for x in val]
            break
        return prefix, tags

    def _extract_endpoints(self, tree: ast.Module) -> list[dict[str, Any]]:
        endpoints: list[dict[str, Any]] = []
        for node in tree.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for deco in node.decorator_list:
                method, path = self._match_route_decorator(deco)
                if not method:
                    continue
                params = self._extract_params(node)
                response_model = self._extract_response_model(deco)
                doc = ast.get_docstring(node) or ""
                summary = doc.strip().splitlines()[0] if doc else ""
                endpoints.append(
                    {
                        "method": method.upper(),
                        "path": path or "",
                        "function": node.name,
                        "is_async": isinstance(node, ast.AsyncFunctionDef),
                        "params": params,
                        "response_model": response_model,
                        "description": summary,
                    }
                )
                break
        return endpoints

    def _match_route_decorator(self, deco: ast.AST) -> tuple[Optional[str], Optional[str]]:
        # @router.get("/path") / @router.post(...)
        if isinstance(deco, ast.Call) and isinstance(deco.func, ast.Attribute):
            method = deco.func.attr
            if method in HTTP_METHODS:
                path = None
                if deco.args:
                    val = self._ast_literal(deco.args[0])
                    if isinstance(val, str):
                        path = val
                return method, path
        return None, None

    def _extract_params(self, func: ast.AST) -> list[dict[str, Any]]:
        params: list[dict[str, Any]] = []
        args = func.args  # type: ignore[attr-defined]
        defaults_offset = len(args.args) - len(args.defaults)
        for idx, arg in enumerate(args.args):
            name = arg.arg
            if name in ("self", "cls"):
                continue
            annotation = ast.unparse(arg.annotation) if arg.annotation else None
            default = None
            if idx >= defaults_offset:
                d = args.defaults[idx - defaults_offset]
                default = self._summarize_default(d)
            params.append({"name": name, "type": annotation, "default": default})
        return params

    def _summarize_default(self, node: ast.AST) -> Any:
        # Depends(...) / Query(...) / Body(...) — 保留函数名
        if isinstance(node, ast.Call):
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
            inner = self._ast_literal(node.args[0]) if node.args else None
            return f"{name}({inner!r})" if name else str(name)
        lit = self._ast_literal(node)
        if lit is not None:
            return lit
        try:
            return ast.unparse(node)
        except Exception:  # noqa: BLE001
            return None

    def _extract_response_model(self, deco: ast.AST) -> Optional[str]:
        if isinstance(deco, ast.Call):
            for kw in deco.keywords:
                if kw.arg == "response_model":
                    try:
                        return ast.unparse(kw.value)
                    except Exception:  # noqa: BLE001
                        return None
        return None

    def _infer_service(self, tree: ast.Module) -> Optional[str]:
        # 查找 from backend.services.* import ...
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                if ".services." in f".{node.module}." or node.module.endswith(".services"):
                    return node.module
                if node.module.startswith(f"{self.root.name}.services."):
                    return node.module
        return None


# ── DB Schema 解析 ──────────────────────────────────────────────────────────


class DbSchemaParser:
    """正则解析 SQLite DDL 提取表结构。"""

    CREATE_TABLE_RE = re.compile(
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\((.*?)\)\s*;",
        re.IGNORECASE | re.DOTALL,
    )
    CREATE_INDEX_RE = re.compile(
        r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*\((.*?)\)",
        re.IGNORECASE | re.DOTALL,
    )
    ALTER_ADD_COLUMN_RE = re.compile(
        r"ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)\s+([A-Z]+)(.*?)(?:[\"\)]|$)",
        re.IGNORECASE,
    )
    SECTION_HEADER_RE = re.compile(r"--\s*={5,}\s*$")
    COMMENT_TITLE_RE = re.compile(r"^--\s*(.+?)\s*$")

    def __init__(self, repo: Path, root: Path) -> None:
        self.repo = repo
        self.root = root

    def parse(self) -> dict[str, Any]:
        sql_path = self.root / "db" / "init.sql"
        engine_path = self.root / "db" / "engine.py"
        if not sql_path.exists():
            # 回退到仓库根扫描
            candidates = list(self.repo.rglob("init.sql"))
            if candidates:
                sql_path = candidates[0]
            else:
                return self._empty()

        sql = _safe_read(sql_path)
        tables, table_descriptions = self._parse_tables(sql)
        indexes = self._parse_indexes(sql)
        self._merge_alter_columns(tables, _safe_read(engine_path))
        self._attach_indexes(tables, indexes)
        fks = self._collect_foreign_keys(tables)
        entity_groups = self._group_entities(tables, table_descriptions, sql)

        return {
            "schema_version": SCHEMA_VERSION,
            "generated_at": _now_iso(),
            "source_file": str(sql_path.relative_to(self.repo)),
            "tables": tables,
            "foreign_keys": fks,
            "entity_groups": entity_groups,
            "stats": {
                "total_tables": len(tables),
                "total_columns": sum(len(t["columns"]) for t in tables),
                "total_foreign_keys": len(fks),
                "total_indexes": sum(len(t["indexes"]) for t in tables),
            },
        }

    def _empty(self) -> dict[str, Any]:
        return {
            "schema_version": SCHEMA_VERSION,
            "generated_at": _now_iso(),
            "source_file": None,
            "tables": [],
            "foreign_keys": [],
            "entity_groups": [],
            "stats": {
                "total_tables": 0,
                "total_columns": 0,
                "total_foreign_keys": 0,
                "total_indexes": 0,
            },
        }

    def _parse_tables(self, sql: str) -> tuple[list[dict[str, Any]], dict[str, str]]:
        tables: list[dict[str, Any]] = []
        # 提取每张表前的注释作为 description
        descriptions = self._scan_table_descriptions(sql)

        for m in self.CREATE_TABLE_RE.finditer(sql):
            name = m.group(1)
            body = m.group(2)
            cols, fks = self._parse_columns(body)
            tables.append(
                {
                    "name": name,
                    "description": descriptions.get(name, ""),
                    "columns": cols,
                    "indexes": [],
                    "fks": fks,
                }
            )
        return tables, descriptions

    def _scan_table_descriptions(self, sql: str) -> dict[str, str]:
        result: dict[str, str] = {}
        lines = sql.splitlines()
        pending_comment: Optional[str] = None
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("--"):
                comment = stripped.lstrip("- ").strip()
                if comment and not comment.startswith("="):
                    pending_comment = comment
                continue
            m = re.match(
                r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)",
                stripped,
                re.IGNORECASE,
            )
            if m:
                if pending_comment:
                    result[m.group(1)] = pending_comment
                pending_comment = None
            elif stripped:
                pending_comment = None
        return result

    def _parse_columns(self, body: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        cols: list[dict[str, Any]] = []
        fks: list[dict[str, Any]] = []
        # 按逗号切，但需忽略括号内逗号
        parts = self._split_top_level_commas(body)
        for raw in parts:
            line = raw.strip().rstrip(",").strip()
            if not line:
                continue
            upper = line.upper()
            if upper.startswith("PRIMARY KEY") or upper.startswith("UNIQUE") or upper.startswith("CHECK"):
                continue
            if upper.startswith("FOREIGN KEY"):
                # FOREIGN KEY (col) REFERENCES table(col)
                m = re.match(
                    r"FOREIGN\s+KEY\s*\(\s*(\w+)\s*\)\s+REFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)",
                    line,
                    re.IGNORECASE,
                )
                if m:
                    fks.append({"column": m.group(1), "ref_table": m.group(2), "ref_column": m.group(3)})
                continue

            tokens = line.split(None, 2)
            if len(tokens) < 2:
                continue
            col_name = tokens[0]
            col_type = tokens[1]
            rest = tokens[2] if len(tokens) > 2 else ""
            rest_upper = rest.upper()
            pk = "PRIMARY KEY" in rest_upper
            not_null = "NOT NULL" in rest_upper
            default_match = re.search(r"DEFAULT\s+([^,]+?)(?:\s+(?:NOT\s+NULL|REFERENCES|CHECK)|$)", rest, re.IGNORECASE)
            default_val = default_match.group(1).strip() if default_match else None
            ref_match = re.search(r"REFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)", rest, re.IGNORECASE)
            fk_target: Optional[str] = None
            if ref_match:
                fk_target = f"{ref_match.group(1)}({ref_match.group(2)})"
                fks.append(
                    {
                        "column": col_name,
                        "ref_table": ref_match.group(1),
                        "ref_column": ref_match.group(2),
                    }
                )
            check_match = re.search(r"CHECK\s*\((.*?)\)", rest, re.IGNORECASE | re.DOTALL)
            check_clause = check_match.group(1).strip() if check_match else None

            cols.append(
                {
                    "name": col_name,
                    "type": col_type,
                    "pk": pk,
                    "not_null": not_null,
                    "default": default_val,
                    "fk": fk_target,
                    "check": check_clause,
                }
            )
        return cols, fks

    @staticmethod
    def _split_top_level_commas(body: str) -> list[str]:
        result: list[str] = []
        buf: list[str] = []
        depth = 0
        for ch in body:
            if ch == "(":
                depth += 1
                buf.append(ch)
            elif ch == ")":
                depth -= 1
                buf.append(ch)
            elif ch == "," and depth == 0:
                result.append("".join(buf))
                buf = []
            else:
                buf.append(ch)
        if buf:
            result.append("".join(buf))
        return result

    def _parse_indexes(self, sql: str) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for m in self.CREATE_INDEX_RE.finditer(sql):
            cols = [c.strip() for c in m.group(3).split(",") if c.strip()]
            result.append({"name": m.group(1), "table": m.group(2), "columns": cols})
        return result

    def _attach_indexes(self, tables: list[dict[str, Any]], indexes: list[dict[str, Any]]) -> None:
        by_table: dict[str, list[dict[str, Any]]] = {}
        for idx in indexes:
            by_table.setdefault(idx["table"], []).append({"name": idx["name"], "columns": idx["columns"]})
        for t in tables:
            t["indexes"] = by_table.get(t["name"], [])

    def _merge_alter_columns(self, tables: list[dict[str, Any]], engine_src: str) -> None:
        """扫描 engine.py 中的运行时 ALTER TABLE 语句，补全列。"""
        if not engine_src:
            return
        existing = {t["name"]: {c["name"] for c in t["columns"]} for t in tables}
        idx = {t["name"]: t for t in tables}
        # 匹配 ALTER TABLE x ADD COLUMN y TYPE ...
        for m in re.finditer(
            r"ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)\s+([A-Z]+)",
            engine_src,
            re.IGNORECASE,
        ):
            table_name, col_name, col_type = m.group(1), m.group(2), m.group(3).upper()
            if table_name not in idx:
                continue
            if col_name in existing[table_name]:
                continue
            idx[table_name]["columns"].append(
                {
                    "name": col_name,
                    "type": col_type,
                    "pk": False,
                    "not_null": False,
                    "default": None,
                    "fk": None,
                    "check": None,
                    "source": "engine.py:ALTER",
                }
            )
            existing[table_name].add(col_name)

    def _collect_foreign_keys(self, tables: list[dict[str, Any]]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for t in tables:
            for fk in t["fks"]:
                result.append(
                    {
                        "from_table": t["name"],
                        "from_column": fk["column"],
                        "to_table": fk["ref_table"],
                        "to_column": fk["ref_column"],
                        "relationship": "many-to-one",
                    }
                )
        return result

    def _group_entities(
        self,
        tables: list[dict[str, Any]],
        descriptions: dict[str, str],
        sql: str,
    ) -> list[dict[str, Any]]:
        """按 init.sql 中 ``-- =====`` 章节自动分组。"""
        groups: list[dict[str, Any]] = []
        current_title: Optional[str] = None
        current_tables: list[str] = []
        lines = sql.splitlines()
        for i, line in enumerate(lines):
            if self.SECTION_HEADER_RE.match(line):
                # 上一行可能是标题
                title = None
                for j in (i - 1, i + 1, i + 2):
                    if 0 <= j < len(lines):
                        m = self.COMMENT_TITLE_RE.match(lines[j].strip())
                        if m and "=" not in m.group(1):
                            title = m.group(1)
                            break
                if title:
                    if current_title and current_tables:
                        groups.append({"name": current_title, "tables": current_tables})
                    current_title = title
                    current_tables = []
                continue
            m = re.match(
                r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)",
                line.strip(),
                re.IGNORECASE,
            )
            if m and current_title:
                current_tables.append(m.group(1))
        if current_title and current_tables:
            groups.append({"name": current_title, "tables": current_tables})

        # 兜底：未分组的表归入"其他"
        grouped: set[str] = {t for g in groups for t in g["tables"]}
        leftover = [t["name"] for t in tables if t["name"] not in grouped]
        if leftover:
            groups.insert(0, {"name": "核心实体", "tables": leftover})
        return groups


# ── 业务概念图 ─────────────────────────────────────────────────────────────


class ConceptGraphParser:
    """从模块/API/Schema 推导业务概念。"""

    # 表名 → 概念名（常用业务名词）
    CONCEPT_NAME_MAP = {
        "tasks": "任务 (Task)",
        "plans": "计划 (Plan)",
        "workflows": "工作流 (Workflow)",
        "work_items": "工作项 (Work Item)",
        "versions": "版本 (Version)",
        "approvals": "审批 (Approval)",
        "schedules": "定时任务 (Schedule)",
        "conversations": "会话 (Conversation)",
        "users": "用户 (User)",
        "actors": "执行者 (Actor)",
        "workspaces": "工作空间 (Workspace)",
        "project_groups": "项目组 (Project Group)",
        "skills": "技能 (Skill)",
        "rules": "规则 (Rule)",
        "hooks": "钩子 (Hook)",
        "security_rules": "安全规则 (Security Rule)",
        "remote_agents": "远程 Agent (Remote Agent)",
    }

    def parse(self, module_graph: dict, api_graph: dict, schema_graph: dict) -> dict[str, Any]:
        tables = schema_graph.get("tables", [])
        concepts: list[dict[str, Any]] = []
        table_to_concept: dict[str, str] = {}

        for table in tables:
            name = table["name"]
            if name not in self.CONCEPT_NAME_MAP:
                continue
            concept_id = name
            table_to_concept[name] = concept_id
            related_tables = [name]
            # 同前缀表归入同概念（如 task_events、plan_tasks）
            for t in tables:
                tn = t["name"]
                if tn != name and tn.startswith(f"{name.rstrip('s')}_"):
                    related_tables.append(tn)
                    table_to_concept[tn] = concept_id
            concepts.append(
                {
                    "id": concept_id,
                    "name": self.CONCEPT_NAME_MAP[name],
                    "description": table.get("description") or "",
                    "db_tables": related_tables,
                    "api_routers": self._match_routers(name, api_graph),
                    "services": self._match_services(name, module_graph),
                    "status_flow": self._extract_status_flow(table),
                    "related_concepts": [],
                }
            )

        # 通过外键推导概念间关系
        relationships: list[dict[str, Any]] = []
        for fk in schema_graph.get("foreign_keys", []):
            src = table_to_concept.get(fk["from_table"])
            dst = table_to_concept.get(fk["to_table"])
            if not src or not dst or src == dst:
                continue
            rel_type = self._infer_relationship_type(fk)
            relationships.append(
                {
                    "from": src,
                    "to": dst,
                    "type": rel_type,
                    "description": f"{fk['from_table']}.{fk['from_column']} → {fk['to_table']}.{fk['to_column']}",
                    "cardinality": fk.get("relationship", "many-to-one"),
                }
            )

        # 填充每个概念的 related_concepts
        rel_index: dict[str, set[str]] = {}
        for r in relationships:
            rel_index.setdefault(r["from"], set()).add(r["to"])
            rel_index.setdefault(r["to"], set()).add(r["from"])
        for c in concepts:
            c["related_concepts"] = sorted(rel_index.get(c["id"], []))

        # 按 entity_groups 简单分领域
        domains: list[dict[str, Any]] = []
        for group in schema_graph.get("entity_groups", []):
            domain_concepts = sorted(
                {table_to_concept[t] for t in group["tables"] if t in table_to_concept}
            )
            if domain_concepts:
                domains.append({"name": group["name"], "concepts": domain_concepts})

        return {
            "schema_version": SCHEMA_VERSION,
            "generated_at": _now_iso(),
            "concepts": concepts,
            "relationships": relationships,
            "domains": domains,
            "stats": {
                "total_concepts": len(concepts),
                "total_relationships": len(relationships),
                "total_domains": len(domains),
            },
        }

    def _match_routers(self, table_name: str, api_graph: dict) -> list[str]:
        result: list[str] = []
        candidates = {table_name, table_name.rstrip("s"), table_name.replace("_", "-")}
        for r in api_graph.get("routers", []):
            rid = r.get("id", "")
            prefix = r.get("prefix", "")
            if rid in candidates or any(c in prefix for c in candidates):
                result.append(r.get("prefix") or rid)
        return result

    def _match_services(self, table_name: str, module_graph: dict) -> list[str]:
        result: list[str] = []
        keyword = table_name.rstrip("s")
        for m in module_graph.get("modules", []):
            if m.get("layer") != "services":
                continue
            mid = m.get("id", "")
            if keyword in mid:
                result.append(mid)
        return result

    def _extract_status_flow(self, table: dict[str, Any]) -> list[str]:
        for col in table.get("columns", []):
            if col["name"] != "status":
                continue
            check = col.get("check")
            if check:
                # status IN ('a', 'b', ...)
                m = re.search(r"IN\s*\((.*?)\)", check, re.IGNORECASE)
                if m:
                    return [s.strip().strip("'\"") for s in m.group(1).split(",")]
        return []

    def _infer_relationship_type(self, fk: dict[str, Any]) -> str:
        col = fk["from_column"]
        if col.endswith("_id"):
            ref = col[:-3]
            if ref in {"parent", "from", "source"}:
                return "derives-from"
        # 默认 references
        return "references"


# ── Markdown 渲染 ───────────────────────────────────────────────────────────


class MarkdownRenderer:
    """将 JSON 图谱渲染为 Markdown（含 Mermaid）。"""

    MAX_MERMAID_NODES = 80

    def render_index(self, meta: dict[str, Any], sections: list[str]) -> str:
        lines: list[str] = []
        lines.append("# 仓库知识图谱")
        lines.append("")
        lines.append(
            f"> 仓库: **{meta.get('repo_name', '')}** | "
            f"版本: **v{meta.get('version', 1)}** | "
            f"分支: `{meta.get('git_branch') or '—'}` | "
            f"Commit: `{(meta.get('git_commit') or '')[:8] or '—'}` | "
            f"生成时间: {meta.get('generated_at', '')}"
        )
        lines.append("")
        lines.append("## 图谱目录")
        lines.append("")
        catalog = {
            "module": ("模块依赖", "module/module_graph.md"),
            "api": ("API 接口", "api/api_graph.md"),
            "db": ("数据库 Schema", "db/schema_graph.md"),
            "concept": ("业务概念", "concept/concept_graph.md"),
        }
        for s in sections:
            if s in catalog:
                title, path = catalog[s]
                lines.append(f"- [{title}](./{path})")
        lines.append("")
        lines.append("## 更新方式")
        lines.append("")
        lines.append("```bash")
        lines.append("python scripts/gen_knowledge_graph.py --type all --repo-path .")
        lines.append("```")
        lines.append("")
        return "\n".join(lines)

    def render_module_graph(self, data: dict[str, Any]) -> str:
        modules = data.get("modules", [])
        edges = data.get("edges", [])
        stats = data.get("stats", {})

        out: list[str] = []
        out.append("# 模块依赖图")
        out.append("")
        out.append(f"> 生成时间: {data.get('generated_at', '')} | 模块数: {stats.get('total_modules', 0)} | 依赖边数: {stats.get('total_edges', 0)}")
        out.append("")
        out.append("## 分层概览")
        out.append("")
        out.append("| 层 | 模块数 | 说明 |")
        out.append("|----|-------|------|")
        layer_stats = stats.get("layers", {})
        for layer in data.get("layers", []):
            out.append(f"| {layer['name']} | {layer_stats.get(layer['name'], 0)} | {layer.get('description', '')} |")
        out.append("")

        # Mermaid 图（节点过多时简化为按层聚合）
        if len(modules) <= self.MAX_MERMAID_NODES:
            out.append("## 依赖关系图")
            out.append("")
            out.append("```mermaid")
            out.append("graph TD")
            for m in modules:
                node_id = self._safe_mermaid_id(m["id"])
                out.append(f"    {node_id}[{m['name']}]")
            for e in edges[: self.MAX_MERMAID_NODES * 3]:
                out.append(f"    {self._safe_mermaid_id(e['from'])} --> {self._safe_mermaid_id(e['to'])}")
            out.append("```")
        else:
            out.append("## 跨层依赖统计")
            out.append("")
            cross: dict[tuple[str, str], int] = {}
            id_to_layer = {m["id"]: m["layer"] for m in modules}
            for e in edges:
                a = id_to_layer.get(e["from"], "other")
                b = id_to_layer.get(e["to"], "other")
                cross[(a, b)] = cross.get((a, b), 0) + 1
            out.append("```mermaid")
            out.append("graph LR")
            seen: set[str] = set()
            for (a, b), n in cross.items():
                if a not in seen:
                    out.append(f"    {a}([{a}])")
                    seen.add(a)
                if b not in seen:
                    out.append(f"    {b}([{b}])")
                    seen.add(b)
                out.append(f"    {a} -->|{n}| {b}")
            out.append("```")
        out.append("")

        # 详细模块列表（按层分组）
        out.append("## 模块详情")
        out.append("")
        by_layer: dict[str, list[dict[str, Any]]] = {}
        for m in modules:
            by_layer.setdefault(m["layer"], []).append(m)
        for layer in sorted(by_layer.keys()):
            out.append(f"### {layer}")
            out.append("")
            out.append("| 模块 | 文件 | 行数 | 内部依赖 | 被依赖 | 说明 |")
            out.append("|------|------|------|---------|--------|------|")
            for m in sorted(by_layer[layer], key=lambda x: x["id"]):
                desc = (m.get("description") or "").replace("|", "\\|")
                out.append(
                    f"| `{m['name']}` | `{m['file']}` | {m['lines']} | "
                    f"{len(m['imports_internal'])} | {len(m.get('imported_by', []))} | {desc} |"
                )
            out.append("")
        return "\n".join(out)

    def render_api_graph(self, data: dict[str, Any]) -> str:
        stats = data.get("stats", {})
        out: list[str] = []
        out.append("# API 接口图谱")
        out.append("")
        out.append(
            f"> 生成时间: {data.get('generated_at', '')} | Router: {stats.get('total_routers', 0)} | Endpoint: {stats.get('total_endpoints', 0)}"
        )
        out.append("")
        method_stats = stats.get("methods", {})
        if method_stats:
            badges = " | ".join(f"`{m}`: {n}" for m, n in sorted(method_stats.items()))
            out.append(f"> 方法分布: {badges}")
            out.append("")

        for router in data.get("routers", []):
            tag_str = ", ".join(router.get("tags", []))
            out.append(f"## {router['id']}")
            out.append("")
            out.append(f"- **prefix**: `{router.get('prefix', '')}`")
            out.append(f"- **tags**: {tag_str or '—'}")
            out.append(f"- **file**: `{router.get('file', '')}`")
            if router.get("service"):
                out.append(f"- **service**: `{router['service']}`")
            out.append("")
            out.append("| 方法 | 路径 | 函数 | 描述 |")
            out.append("|------|------|------|------|")
            prefix = router.get("prefix", "")
            for ep in router.get("endpoints", []):
                full_path = f"{prefix}{ep.get('path', '')}" or "/"
                desc = (ep.get("description") or "").replace("|", "\\|")
                out.append(
                    f"| **{ep['method']}** | `{full_path}` | `{ep['function']}` | {desc} |"
                )
            out.append("")
        return "\n".join(out)

    def render_schema_graph(self, data: dict[str, Any]) -> str:
        stats = data.get("stats", {})
        tables = data.get("tables", [])
        out: list[str] = []
        out.append("# 数据库 Schema 图谱")
        out.append("")
        out.append(
            f"> 生成时间: {data.get('generated_at', '')} | "
            f"表: {stats.get('total_tables', 0)} | "
            f"列: {stats.get('total_columns', 0)} | "
            f"外键: {stats.get('total_foreign_keys', 0)} | "
            f"索引: {stats.get('total_indexes', 0)}"
        )
        out.append("")
        out.append(self.render_er_diagram(data, with_heading=True))
        out.append("")

        out.append("## 实体分组")
        out.append("")
        for group in data.get("entity_groups", []):
            out.append(f"### {group['name']}")
            out.append("")
            for tname in group["tables"]:
                table = next((t for t in tables if t["name"] == tname), None)
                if not table:
                    continue
                out.append(f"#### `{table['name']}`")
                desc = table.get("description")
                if desc:
                    out.append(f"> {desc}")
                out.append("")
                out.append("| 列 | 类型 | 约束 | 默认 | 外键 |")
                out.append("|----|------|------|------|------|")
                for col in table["columns"]:
                    constraints = []
                    if col.get("pk"):
                        constraints.append("PK")
                    if col.get("not_null"):
                        constraints.append("NOT NULL")
                    if col.get("source"):
                        constraints.append(f"via {col['source']}")
                    out.append(
                        f"| `{col['name']}` | `{col['type']}` | {', '.join(constraints) or '—'} | "
                        f"{col.get('default') or '—'} | {col.get('fk') or '—'} |"
                    )
                if table["indexes"]:
                    out.append("")
                    out.append("**索引**：")
                    for idx in table["indexes"]:
                        out.append(f"- `{idx['name']}` ({', '.join(idx['columns'])})")
                out.append("")
        return "\n".join(out)

    def render_er_diagram(self, data: dict[str, Any], with_heading: bool = False) -> str:
        tables = data.get("tables", [])
        fks = data.get("foreign_keys", [])
        out: list[str] = []
        if with_heading:
            out.append("## ER 关系图")
            out.append("")
        out.append("```mermaid")
        out.append("erDiagram")
        # 限制节点数以避免 Mermaid 超载
        shown = {t["name"] for t in tables[: self.MAX_MERMAID_NODES]}
        for t in tables:
            if t["name"] not in shown:
                continue
            out.append(f"    {t['name']} {{")
            for col in t["columns"][:8]:
                col_type = re.sub(r"\W", "_", col["type"])
                hint = "PK" if col.get("pk") else ("FK" if col.get("fk") else "")
                out.append(f"        {col_type} {col['name']} {hint}".rstrip())
            out.append("    }")
        for fk in fks:
            if fk["from_table"] in shown and fk["to_table"] in shown:
                out.append(f"    {fk['to_table']} ||--o{{ {fk['from_table']} : has")
        out.append("```")
        return "\n".join(out)

    def render_concept_graph(self, data: dict[str, Any]) -> str:
        out: list[str] = []
        out.append("# 业务概念图")
        out.append("")
        stats = data.get("stats", {})
        out.append(
            f"> 生成时间: {data.get('generated_at', '')} | 概念: {stats.get('total_concepts', 0)} | 关系: {stats.get('total_relationships', 0)}"
        )
        out.append("")
        out.append("## 领域概览")
        out.append("")
        for domain in data.get("domains", []):
            out.append(f"### {domain['name']}")
            out.append("")
            for cid in domain["concepts"]:
                out.append(f"- `{cid}`")
            out.append("")

        # Mermaid 概念关系图
        concepts = data.get("concepts", [])
        relationships = data.get("relationships", [])
        if concepts:
            out.append("## 概念关系图")
            out.append("")
            out.append("```mermaid")
            out.append("graph LR")
            for c in concepts:
                nid = self._safe_mermaid_id(c["id"])
                out.append(f"    {nid}([{c['name']}])")
            for r in relationships:
                a = self._safe_mermaid_id(r["from"])
                b = self._safe_mermaid_id(r["to"])
                out.append(f"    {a} -->|{r['type']}| {b}")
            out.append("```")
            out.append("")

        out.append("## 概念详情")
        out.append("")
        for c in concepts:
            out.append(f"### {c['name']}")
            out.append("")
            if c.get("description"):
                out.append(f"> {c['description']}")
                out.append("")
            out.append(f"- **DB 表**: {', '.join(f'`{t}`' for t in c.get('db_tables', [])) or '—'}")
            out.append(f"- **API**: {', '.join(f'`{r}`' for r in c.get('api_routers', [])) or '—'}")
            out.append(f"- **Service**: {', '.join(f'`{s}`' for s in c.get('services', [])) or '—'}")
            flow = c.get("status_flow")
            if flow:
                out.append(f"- **状态流**: {' → '.join(f'`{s}`' for s in flow)}")
            related = c.get("related_concepts") or []
            if related:
                out.append(f"- **相关概念**: {', '.join(f'`{r}`' for r in related)}")
            out.append("")
        return "\n".join(out)

    @staticmethod
    def _safe_mermaid_id(raw: str) -> str:
        return re.sub(r"\W", "_", raw)


# ── 编排器 ────────────────────────────────────────────────────────────────


class KnowledgeGraphGenerator:
    def __init__(
        self,
        repo_path: Path,
        output_dir: Path,
        repo_name: Optional[str] = None,
        formats: Iterable[str] = ("json", "md"),
    ) -> None:
        """
        Args:
            repo_path: 仓库根目录
            output_dir: 输出目录
            repo_name: 仓库名（默认取目录名）
            formats: 输出格式 ("json", "md")
        """
        self.repo = repo_path.resolve()
        self.output_dir = output_dir
        self.repo_name = repo_name or self.repo.name
        self.formats = set(formats)
        self.renderer = MarkdownRenderer()

    def generate(self, graph_type: str = "all") -> dict[str, Any]:
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # 读取旧版本号并递增
        prev_version = 0
        meta_path = self.output_dir / "_meta.json"
        if meta_path.exists():
            try:
                old_meta = json.loads(meta_path.read_text(encoding="utf-8"))
                prev_version = int(old_meta.get("version", 0))
            except (json.JSONDecodeError, ValueError, OSError):
                pass
        new_version = prev_version + 1

        # Python 静态分析路径
        python_root = _detect_python_root(self.repo)
        if python_root is None:
            raise RuntimeError(
                f"未在 {self.repo} 下检测到 Python 源代码根目录。\n"
                "对于非 Python 项目，请在 UI 中选择一个 Agent（如 Codex/Claude/Qoder）\n"
                "进行 LLM 驱动的知识图谱生成。"
            )

        return self._generate_static(graph_type, new_version, python_root)

    def _generate_static(
        self,
        graph_type: str,
        version: int,
        python_root: Path,
    ) -> dict[str, Any]:
        """使用静态分析生成知识图谱（原有逻辑）。"""
        wanted = {"module", "api", "db", "concept"} if graph_type == "all" else {graph_type}
        sections: list[str] = []
        module_graph = api_graph = schema_graph = None

        if "module" in wanted:
            logger.info("解析模块依赖图…")
            module_graph = ModuleGraphParser(self.repo, python_root).parse()
            self._dump("module/module_graph", module_graph, self.renderer.render_module_graph)
            sections.append("module")

        if "api" in wanted:
            logger.info("解析 API 接口图谱…")
            api_graph = ApiGraphParser(self.repo, python_root).parse()
            self._dump("api/api_graph", api_graph, self.renderer.render_api_graph)
            sections.append("api")

        if "db" in wanted:
            logger.info("解析 DB Schema 图谱…")
            schema_graph = DbSchemaParser(self.repo, python_root).parse()
            self._dump("db/schema_graph", schema_graph, self.renderer.render_schema_graph)
            # 单独 ER 图
            if "md" in self.formats:
                _write_text(
                    self.output_dir / "db" / "er_diagram.md",
                    "# ER 关系图\n\n" + self.renderer.render_er_diagram(schema_graph),
                )
            sections.append("db")

        if "concept" in wanted:
            logger.info("推导业务概念图…")
            # 概念图需要依赖前三类结果；缺失时空兜底
            module_graph = module_graph or {"modules": []}
            api_graph = api_graph or {"routers": []}
            schema_graph = schema_graph or {"tables": [], "foreign_keys": [], "entity_groups": []}
            concept_graph = ConceptGraphParser().parse(module_graph, api_graph, schema_graph)
            self._dump("concept/concept_graph", concept_graph, self.renderer.render_concept_graph)
            sections.append("concept")

        # 元数据 + 索引
        git_info = _get_git_info(self.repo)
        meta = {
            "schema_version": SCHEMA_VERSION,
            "version": version,
            "repo_name": self.repo_name,
            "repo_path": str(self.repo),
            "git_commit": git_info.get("commit"),
            "git_branch": git_info.get("branch"),
            "generated_at": _now_iso(),
            "generator": "gen_knowledge_graph.py v1.0 (static)",
            "sections": sections,
        }
        _write_json(self.output_dir / "_meta.json", meta)
        if "md" in self.formats:
            _write_text(self.output_dir / "_index.md", self.renderer.render_index(meta, sections))

        logger.info("知识图谱生成完成 → %s", self.output_dir)
        return {"meta": meta, "sections": sections, "output_dir": str(self.output_dir)}

    def _dump(self, rel: str, data: dict, md_renderer) -> None:
        if "json" in self.formats:
            _write_json(self.output_dir / f"{rel}.json", data)
        if "md" in self.formats:
            _write_text(self.output_dir / f"{rel}.md", md_renderer(data))


# ── CLI 入口 ───────────────────────────────────────────────────────────────


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="gen_knowledge_graph",
        description="生成 Tide 风格仓库知识图谱（模块/API/DB/概念）。\n\n"
        "支持 Python 项目静态分析。非 Python 项目请使用 Agent 生成。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--type",
        choices=["all", "module", "api", "db", "concept"],
        default="all",
        help="图谱类型（默认 all）",
    )
    p.add_argument("--repo-path", default=".", help="仓库根目录（默认当前目录）")
    p.add_argument(
        "--output-dir",
        default=None,
        help="输出目录（默认 <repo>/.knowledge）",
    )
    p.add_argument(
        "--format",
        choices=["json", "md", "both"],
        default="both",
        help="输出格式（默认 both）",
    )
    p.add_argument("--repo-name", default=None, help="仓库名（默认取目录名）")

    p.add_argument("--log-level", default="INFO")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    repo = Path(args.repo_path).expanduser().resolve()
    if not repo.exists():
        logger.error("仓库路径不存在: %s", repo)
        return 1
    out_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else repo / ".knowledge"
    fmt = ("json", "md") if args.format == "both" else (args.format,)

    gen = KnowledgeGraphGenerator(repo, out_dir, args.repo_name, fmt)
    try:
        result = gen.generate(args.type)
    except Exception as exc:  # noqa: BLE001
        logger.exception("生成失败: %s", exc)
        return 2
    print(json.dumps({"ok": True, "sections": result["sections"], "output_dir": result["output_dir"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
