"use client";

import { useParams, useRouter } from "next/navigation";
import { Button } from "@tide/ui";
import {
  useWorkflow,
  useWorkflowRun,
  useCancelRun,
  useApproveNode,
  useRejectNode,
} from "@tide/core";
import { WorkflowRunView, WorkflowNodeRunList } from "@tide/views";

const STATUS_TONE: Record<
  string,
  { label: string; dot: string }
> = {
  pending: {
    label: "等待",
    dot: "bg-zinc-400",
  },
  running: {
    label: "运行中",
    dot: "bg-sky-500",
  },
  completed: {
    label: "完成",
    dot: "bg-emerald-600",
  },
  failed: {
    label: "失败",
    dot: "bg-rose-600",
  },
  cancelled: {
    label: "已取消",
    dot: "bg-zinc-500",
  },
};

function formatTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN");
  } catch {
    return iso;
  }
}

export default function WorkflowRunDetailPage() {
  const params = useParams<{ id: string; rid: string }>();
  const id = String(params?.id ?? "");
  const rid = String(params?.rid ?? "");
  const router = useRouter();

  const { data: workflow } = useWorkflow(id);
  const { data: runDetail, isLoading } = useWorkflowRun(id, rid, 3000);
  const cancel = useCancelRun();
  const approveMut = useApproveNode();
  const rejectMut = useRejectNode();

  if (isLoading || !runDetail || !workflow) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-xs text-muted-foreground">
          加载运行详情中…
        </div>
      </div>
    );
  }

  const tone = STATUS_TONE[runDetail.status] ?? STATUS_TONE.pending;
  const isLive = runDetail.status === "running" || runDetail.status === "pending";

  const handleApprove = (nodeId: string) => {
    approveMut.mutate({ id, runId: rid, nodeId });
  };
  const handleReject = (nodeId: string) => {
    rejectMut.mutate({ id, runId: rid, nodeId });
  };

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between bg-card rounded-xl shadow-card px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <button
              onClick={() => router.push("/workflows")}
              className="hover:text-foreground transition-smooth"
            >
              工作流
            </button>
            <span>/</span>
            <button
              onClick={() => router.push(`/workflows/${id}`)}
              className="hover:text-foreground transition-smooth"
            >
              {workflow.name}
            </button>
            <span>/</span>
            <span className="text-foreground">
              运行
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              Run {rid.slice(0, 12)}
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] font-medium">
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
              {tone.label}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span>开始 {formatTime(runDetail.started_at)}</span>
            <span>结束 {formatTime(runDetail.finished_at)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <Button
              variant="destructive"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => {
                if (confirm("确定取消该运行？"))
                  cancel.mutate({ id, runId: rid });
              }}
            >
              ■ 取消运行
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/workflows/${id}`)}
          >
            返回编辑
          </Button>
        </div>
      </div>

      {/* Two-column main */}
      <div className="grid min-h-[600px] flex-1 grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-8">
          <WorkflowRunView
            definition={workflow.definition}
            run={runDetail}
            subtitle={`${workflow.name} · ${rid.slice(0, 8)}`}
          />
        </div>
        <div className="col-span-12 lg:col-span-4">
          <WorkflowNodeRunList
            run={runDetail}
            onApprove={handleApprove}
            onReject={handleReject}
            isPending={approveMut.isPending || rejectMut.isPending}
          />

          {/* Input context */}
          <div className="mt-4 overflow-hidden bg-card rounded-xl shadow-card border border-border/50">
            <div className="border-b border-border/50 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-violet-500" />
                <span className="text-xs font-medium text-foreground">
                  输入上下文
                </span>
              </div>
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-emerald-200 rounded-b-xl">
              {JSON.stringify(runDetail.input_context ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
