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
  { label: string; chip: string; glyph: string }
> = {
  pending: {
    label: "PENDING",
    chip: "bg-zinc-100 text-zinc-700 border-zinc-400",
    glyph: "◇",
  },
  running: {
    label: "RUNNING",
    chip: "bg-sky-100 text-sky-800 border-sky-500",
    glyph: "▲",
  },
  completed: {
    label: "DONE",
    chip: "bg-emerald-100 text-emerald-800 border-emerald-600",
    glyph: "■",
  },
  failed: {
    label: "FAILED",
    chip: "bg-rose-100 text-rose-800 border-rose-600",
    glyph: "✕",
  },
  cancelled: {
    label: "CANCELLED",
    chip: "bg-zinc-100 text-zinc-700 border-zinc-400",
    glyph: "□",
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
        <div className="font-mono text-xs tracking-widest text-zinc-500">
          ◐ LOADING RUN…
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
      <div className="flex items-center justify-between border-2 border-zinc-900 bg-white px-4 py-3 shadow-[5px_5px_0_0_rgba(24,24,27,0.92)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/workflows")}
              className="font-mono text-[11px] tracking-widest text-zinc-500 hover:text-zinc-900"
            >
              ◀ WORKFLOWS
            </button>
            <span className="font-mono text-[11px] text-zinc-300">/</span>
            <button
              onClick={() => router.push(`/workflows/${id}`)}
              className="font-mono text-[11px] tracking-widest text-zinc-500 hover:text-zinc-900"
            >
              {workflow.name.toUpperCase()}
            </button>
            <span className="font-mono text-[11px] text-zinc-300">/</span>
            <span className="font-mono text-[11px] tracking-widest text-zinc-700">
              RUN
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <h1 className="truncate text-xl font-black tracking-tight text-zinc-900">
              Run {rid.slice(0, 12)}
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 border px-2 py-[2px] font-mono text-[10px] tracking-[0.2em] ${tone.chip}`}
            >
              <span>{tone.glyph}</span>
              <span>{tone.label}</span>
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-zinc-600">
            <span>▸ {formatTime(runDetail.started_at)}</span>
            <span>◂ {formatTime(runDetail.finished_at)}</span>
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
          <div className="mt-4 overflow-hidden border-2 border-zinc-900 bg-white shadow-[6px_6px_0_0_rgba(24,24,27,0.92)]">
            <div className="border-b-2 border-zinc-900 bg-zinc-950 px-4 py-2.5 text-white">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 bg-violet-400" />
                <span className="font-mono text-[11px] tracking-[0.3em]">
                  ◴ INPUT CONTEXT
                </span>
              </div>
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-emerald-200">
              {JSON.stringify(runDetail.input_context ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
