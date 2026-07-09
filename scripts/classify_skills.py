#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Skills 分类迁移脚本。

将 skills 表中的 category 字段重新分类到 11 个语义明确的类别中。

用法:
    python3 scripts/classify_skills.py --dry-run      # 仅预览, 不写库
    python3 scripts/classify_skills.py                # 执行迁移
    python3 scripts/classify_skills.py --rollback     # 从备份恢复
    python3 scripts/classify_skills.py --db /path/to/tide.db

分类规则优先级: 精确 slug 列表 > slug 前缀匹配 > 保持 general
前缀匹配优先级(分类顺序):
    ai-agent > frontend > backend > mobile > devops
    > security > testing > data > media > business
"""

import argparse
import json
import os
import sqlite3
from collections import OrderedDict
from pathlib import Path

# 脚本所在目录 / 项目根目录
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DEFAULT_DB = PROJECT_ROOT / "tide.db"
BACKUP_FILE = SCRIPT_DIR / "skills_category_backup.json"


# ---------------------------------------------------------------------------
# 分类规则定义
# 注意: OrderedDict 的顺序即为前缀匹配的优先级顺序
# ---------------------------------------------------------------------------
def _build_rules():
    rules = OrderedDict()

    rules["ai-agent"] = {
        "exact": {
            "agent-architecture-audit", "agent-eval", "agent-harness-construction",
            "agent-introspection-debugging", "agent-payment-x402", "agent-self-evaluation",
            "agent-sort", "agentic-engineering", "agentic-os",
            "ai-first-engineering", "autonomous-agent-harness", "autonomous-loops",
            "continuous-agent-loop", "claude-devfleet", "council",
            "team-agent-orchestration", "plan-orchestrate",
            "prompt-optimizer", "token-budget-advisor", "cost-aware-llm-pipeline",
            "cost-tracking", "context-budget",
            "enrichment-agent", "enterprise-agent-ops", "parallel-execution-optimizer",
            "orch-pipeline", "orch-add-feature", "orch-build-mvp", "orch-change-feature",
            "orch-fix-defect", "orch-refine-code",
            "continuous-learning", "continuous-learning-v2", "mcp",
            "codehealth-mcp", "dynamic-workflow-mode",
        },
        "prefix": ("agent-", "agentic-", "autonomous-", "orch-", "ai-"),
    }

    rules["frontend"] = {
        "exact": {
            "angular-animations", "angular-aria", "angular-developer",
            "react-patterns", "react-performance", "react-testing",
            "vue-patterns", "nuxt4-patterns", "nextjs-turbopack", "vite-patterns",
            "component-harnesses", "component-styling", "components",
            "define-routes", "navigate-to-routes", "show-routes-with-outlets", "routing",
            "route-animations", "route-guards", "router-lifecycle", "router-testing",
            "reactive-forms", "signal-forms", "template-driven-forms",
            "signals-overview", "linked-signal",
            "effects", "inputs", "outputs", "resource",
            "rendering-strategies", "loading-strategies",
            "di-fundamentals", "defining-providers", "hierarchical-injectors",
            "injection-context", "host-elements",
            "tailwind-css", "html-template", "frontend-a11y", "frontend-design-direction",
            "frontend-patterns", "frontend-slides",
            "accessibility", "design-system", "make-interfaces-feel-better",
            "ui-demo", "ui-to-vue",
            "animation-patterns", "motion-advanced", "motion-foundations",
            "motion-patterns", "motion-ui",
        },
        "prefix": (
            "angular-", "react-", "vue-", "nextjs-", "nuxt4-", "vite-", "svelte-",
            "component-", "route-", "router-", "signal-", "frontend-",
        ),
    }

    rules["backend"] = {
        "exact": {
            "django-celery", "django-patterns", "django-security", "django-tdd",
            "django-verification",
            "laravel-patterns", "laravel-plugin-discovery", "laravel-security",
            "laravel-tdd", "laravel-verification",
            "springboot-patterns", "springboot-security", "springboot-tdd",
            "springboot-verification",
            "quarkus-patterns", "quarkus-security", "quarkus-tdd", "quarkus-verification",
            "fastapi-patterns", "nestjs-patterns", "golang-patterns", "golang-testing",
            "rust-patterns", "rust-testing", "perl-patterns", "perl-security",
            "perl-testing",
            "dotnet-patterns", "fsharp-testing", "csharp-testing", "python-patterns",
            "python-testing",
            "backend-patterns", "api-design", "api-connector-builder", "api-reference",
            "architecture", "hexagonal-architecture", "architecture-decision-records",
            "error-handling", "coding-standards", "java-coding-standards",
            "cpp-coding-standards", "cpp-testing",
            "jpa-patterns", "tinystruct-patterns", "prisma-patterns",
            "creating-services", "bun-runtime", "code-tour", "codebase-onboarding",
            "latency-critical-systems", "streaming",
            "hook-integration", "hookify-rules", "nodejs-keccak256",
        },
        "prefix": (
            "django-", "laravel-", "springboot-", "quarkus-", "fastapi-", "nestjs-",
            "golang-", "rust-", "perl-", "dotnet-",
        ),
    }

    rules["mobile"] = {
        "exact": {
            "android-clean-architecture", "compose-multiplatform-patterns",
            "dart-flutter-patterns", "flutter-dart-code-review",
            "ios-icon-gen", "kotlin-coroutines-flows", "kotlin-exposed-patterns",
            "kotlin-ktor-patterns",
            "kotlin-patterns", "kotlin-testing", "swift-actor-persistence",
            "swift-concurrency-6-2",
            "swift-protocol-di-testing", "swiftui-patterns",
        },
        "prefix": (
            "swift-", "kotlin-", "flutter-", "dart-", "android-", "ios-",
            "compose-multiplatform-", "swiftui-",
        ),
    }

    rules["devops"] = {
        "exact": {
            "docker-patterns", "kubernetes-patterns", "deployment-patterns",
            "homelab-network-readiness", "homelab-network-setup", "homelab-pihole-dns",
            "homelab-vlan-segmentation", "homelab-wireguard-vpn",
            "network-bgp-diagnostics", "network-config-validation",
            "network-interface-health", "netmiko-ssh-automation",
            "cisco-ios-patterns", "cloud-infrastructure-security", "canary-watch",
            "uncloud", "flox-environments",
            "git-workflow", "mcp-server-patterns",
        },
        "prefix": (
            "docker-", "kubernetes-", "deployment-", "homelab-", "network-",
            "netmiko-", "cisco-",
        ),
    }

    rules["security"] = {
        "exact": {
            "security-bounty-hunter", "security-review", "security-scan",
            "healthcare-cdss-patterns", "healthcare-emr-patterns",
            "healthcare-eval-harness", "healthcare-phi-compliance",
            "hipaa-compliance", "customs-trade-compliance",
            "defi-amm-security", "evm-token-decimals", "llm-trading-agent-security",
            "prediction-market-oracle-research", "prediction-market-risk-review",
            "gateguard", "safety-guard", "skill-comply", "production-audit",
        },
        "prefix": (
            "security-", "healthcare-", "hipaa-", "prediction-market-", "defi-",
        ),
    }

    rules["testing"] = {
        "exact": {
            "tdd-workflow", "testing", "testing-fundamentals",
            "e2e-testing", "browser-qa", "windows-desktop-e2e",
            "verification-loop", "benchmark", "benchmark-methodology",
            "benchmark-optimization-loop",
            "eval-harness", "evaluation-criteria", "evaluation-report",
            "ai-regression-testing", "plankton-code-quality", "repo-scan",
            "click-path-audit", "automation-audit-ops",
        },
        "prefix": ("tdd-", "benchmark-", "evaluation-"),
    }

    rules["data"] = {
        "exact": {
            "database", "database-migrations", "postgres-patterns", "mysql-patterns",
            "redis-patterns", "clickhouse-io",
            "data-handling", "data-resolvers", "data-throughput-accelerator",
            "data-scraper-agent",
            "pytorch-patterns", "ml-adoption-playbook", "mle-workflow",
            "recsys-pipeline-architect",
            "deep-research", "iterative-retrieval", "foundation-models-on-device",
            "gan-style-harness",
            "regex-vs-llm-structured-text", "pubmed-database", "uspto-database", "gget",
            "scholar-evaluation", "literature-review", "research-ops", "search-first",
            "content-hash-cache-pattern", "connections-optimizer",
        },
        "prefix": (
            "database-", "postgres-", "mysql-", "redis-", "clickhouse-", "data-",
            "pytorch-", "ml-", "mle-",
        ),
    }

    rules["media"] = {
        "exact": {
            "3d", "animations", "assets", "audio", "blender-motion-state-inspection",
            "calculate-metadata", "can-decode", "charts", "compositions",
            "display-captions",
            "extract-frames", "fonts", "get-audio-duration", "get-video-dimensions",
            "get-video-duration",
            "gif", "images", "import-srt-captions", "lottie", "manim-video",
            "measuring-dom-nodes", "measuring-text", "remotion-video-creation",
            "sequencing", "style-presets", "tailwind", "text-animations", "timing",
            "transcribe-captions", "transitions", "trimming", "video-editing",
            "videodb", "videos",
            "fal-ai-media",
        },
        "prefix": ("remotion-", "video-", "blender-"),
    }

    rules["business"] = {
        "exact": {
            "10-purpose-why", "20-positioning", "30-audience-niche",
            "40-personality-archetype",
            "50-voice-tone", "60-narrative-story", "70-founder-tension", "90-synthesis",
            "article-writing", "avatar-style", "boundary-rules", "brand-discovery",
            "brand-voice",
            "competitive-platform-analysis", "competitive-report-structure",
            "content-engine", "crosspost",
            "customer-billing-ops", "email-ops", "energy-procurement",
            "finance-billing-ops",
            "identity-tension", "intent-driven-development", "inventory-demand-planning",
            "investor-materials", "investor-outreach", "lead-intelligence",
            "market-research", "marketing-campaign", "mutual-mapper", "naming-system",
            "outreach-drafter", "output-template", "product-capability", "product-lens",
            "production-scheduling", "quality-nonconformance", "returns-reverse-logistics",
            "seo", "signal-scorer", "social-graph-ranker", "social-publisher",
            "strategic-compact", "taste", "genre-taxonomy", "voice-profile-schema",
            "carrier-relationship-management", "logistics-exception-management",
            "project-flow-ops", "team-builder", "blueprint",
            "github-ops", "google-workspace-ops", "jira-integration", "messages-ops",
            "terminal-ops",
            "unified-notifications-ops", "visa-doc-translate", "workspace-surface-audit",
            "knowledge-ops",
        },
        "prefix": (
            "brand-", "investor-", "lead-", "customer-", "finance-", "carrier-",
            "logistics-", "marketing-", "social-",
        ),
    }

    return rules


RULES = _build_rules()
# 分类顺序(含 general), 用于报告输出
CATEGORY_ORDER = list(RULES.keys()) + ["general"]


def classify(slug):
    """根据规则对单个 slug 进行分类。

    规则优先级: 精确 slug 列表 > slug 前缀匹配 > general
    """
    if slug is None:
        return "general"
    s = slug.strip()

    # 1. 精确 slug 列表匹配(按分类优先级顺序)
    for category, rule in RULES.items():
        if s in rule["exact"]:
            return category

    # 2. 前缀匹配(按分类优先级顺序)
    for category, rule in RULES.items():
        for prefix in rule["prefix"]:
            if s.startswith(prefix):
                return category

    # 3. 保持 general
    return "general"


def load_skills(conn):
    """读取所有 skills 的 id, slug, category。"""
    cur = conn.cursor()
    cur.execute("SELECT id, slug, category FROM skills")
    return cur.fetchall()


def backup_categories(conn):
    """将当前所有 skills 的 (slug, category) 备份为 JSON。"""
    rows = load_skills(conn)
    data = [{"slug": r[1], "category": r[2]} for r in rows]
    with open(BACKUP_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("已备份 {} 条 skills 分类到: {}".format(len(data), BACKUP_FILE))


def do_rollback(conn):
    """从备份 JSON 恢复 category 值。"""
    if not BACKUP_FILE.exists():
        print("错误: 备份文件不存在: {}".format(BACKUP_FILE))
        return
    with open(BACKUP_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    cur = conn.cursor()
    restored = 0
    for item in data:
        cur.execute(
            "UPDATE skills SET category = ? WHERE slug = ?",
            (item["category"], item["slug"]),
        )
        restored += cur.rowcount
    conn.commit()
    print("已从备份恢复 {} 条 skills 分类。".format(restored))


def print_report(distribution, updated, unchanged, total):
    """输出分类迁移报告。"""
    print()
    print("=== Skills 分类迁移报告 ===")
    print("总计: {} 条".format(total))
    print()
    print("按分类分布:")
    for category in CATEGORY_ORDER:
        count = distribution.get(category, 0)
        print("  {:<12}{:>4} 条".format(category + ":", count))
    print()
    print("已更新: {} 条".format(updated))
    print("未变更: {} 条".format(unchanged))
    print()


def do_classify(conn, dry_run):
    """执行分类逻辑, 更新数据库或仅预览。"""
    rows = load_skills(conn)
    total = len(rows)

    distribution = {}
    updated = 0
    unchanged = 0
    updates = []

    for skill_id, slug, current_category in rows:
        new_category = classify(slug)
        distribution[new_category] = distribution.get(new_category, 0) + 1
        if new_category != current_category:
            updated += 1
            updates.append((new_category, skill_id))
        else:
            unchanged += 1

    if not dry_run:
        cur = conn.cursor()
        cur.executemany(
            "UPDATE skills SET category = ? WHERE id = ?", updates
        )
        conn.commit()

    print_report(distribution, updated, unchanged, total)
    if dry_run:
        print("[dry-run] 未对数据库做任何修改。")
    else:
        print("已完成数据库更新。")


def main():
    parser = argparse.ArgumentParser(
        description="Skills 分类迁移脚本 - 将 skills 重新分类到 11 个语义类别"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="仅输出分类结果, 不实际更新数据库",
    )
    parser.add_argument(
        "--rollback", action="store_true",
        help="从备份 JSON 恢复 category 值",
    )
    parser.add_argument(
        "--db", default=str(DEFAULT_DB),
        help="数据库路径, 默认为项目根目录的 tide.db",
    )
    args = parser.parse_args()

    db_path = args.db
    if not os.path.exists(db_path):
        print("错误: 数据库文件不存在: {}".format(db_path))
        return

    conn = sqlite3.connect(db_path)
    try:
        if args.rollback:
            do_rollback(conn)
            return

        # 分类前始终备份当前状态
        backup_categories(conn)
        do_classify(conn, dry_run=args.dry_run)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
