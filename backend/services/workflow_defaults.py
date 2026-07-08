"""
内建系统默认工作流定义。

提供一个线性 DAG（React Flow 格式的 {nodes, edges}），用于在无任何用户工作流的
新项目中自动兜底：分诊 → 执行 → 评审 → 合并。
"""

DEFAULT_WORKFLOW_NAME = "System Default Workflow"
DEFAULT_WORKFLOW_DESCRIPTION = (
    "Built-in default workflow: triage → execute → review → merge"
)

DEFAULT_WORKFLOW_DEFINITION = {
    "nodes": [
        {
            "id": "start_1",
            "type": "start",
            "position": {"x": 0, "y": 200},
            "data": {"label": "Start"},
        },
        {
            "id": "agent_triage",
            "type": "agent",
            "position": {"x": 220, "y": 200},
            "data": {
                "label": "Triage",
                "agentId": "codex",
                "promptTemplate": (
                    "分诊并分析当前工作项：理解需求、拆解范围、识别涉及的模块与"
                    "关键文件，并给出清晰的实施方案。"
                ),
            },
        },
        {
            "id": "agent_execute",
            "type": "agent",
            "position": {"x": 440, "y": 200},
            "data": {
                "label": "Execute",
                "agentId": "codex",
                "promptTemplate": (
                    "根据上一步的分诊方案执行任务：完成代码实现与必要的修改，"
                    "确保逻辑正确、风格与现有代码一致。"
                ),
            },
        },
        {
            "id": "approval_review",
            "type": "approval",
            "position": {"x": 660, "y": 200},
            "data": {
                "label": "Review",
                "autoApprove": True,
            },
        },
        {
            "id": "git_merge",
            "type": "git_merge",
            "position": {"x": 880, "y": 200},
            "data": {
                "label": "Merge",
                "strategy": "merge",
            },
        },
        {
            "id": "end_1",
            "type": "end",
            "position": {"x": 1100, "y": 200},
            "data": {"label": "End"},
        },
    ],
    "edges": [
        {"id": "e_start_triage", "source": "start_1", "target": "agent_triage"},
        {"id": "e_triage_execute", "source": "agent_triage", "target": "agent_execute"},
        {"id": "e_execute_review", "source": "agent_execute", "target": "approval_review"},
        {"id": "e_review_merge", "source": "approval_review", "target": "git_merge"},
        {"id": "e_merge_end", "source": "git_merge", "target": "end_1"},
    ],
}
