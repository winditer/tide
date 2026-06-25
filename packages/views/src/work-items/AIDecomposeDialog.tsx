"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
} from "@tide/ui";
import {
  useAIDecompose,
  useAgents,
  useBatchCreateWorkItems,
  type AIDecomposedItem,
  type BatchCreateWorkItemsResponse,
} from "@tide/core";
import {
  Sparkles,
  Plus,
  X,
  Upload,
  FileText,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

export interface AIDecomposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 用于创建工作项时所归属的项目 id（项目组模式下应为该组的 primary 项目 id）。 */
  projectId: string;
  /** 项目组 id（可选）；存在时跨仓库工作项会附加 group_id。 */
  groupId?: string;
}

/** 三步交互状态：输入 -> 分析结果 -> 创建确认。 */
type Step = "input" | "result" | "creating";

/** 内存中保存的可编辑候选条目，附带 UI 选择/展开等状态。 */
interface DraftItem {
  /** 用于 React key、checkbox 选择稳定性。 */
  id: string;
  title: string;
  description: string;
  priority: number;
  tags: string[];
  selected: boolean;
}

const PRIORITY_OPTIONS = [
  { value: "0", label: "无优先级" },
  { value: "1", label: "低" },
  { value: "2", label: "中" },
  { value: "3", label: "高" },
  { value: "4", label: "紧急" },
];

const PRIORITY_BADGE: Record<number, { label: string; className: string }> = {
  0: { label: "—", className: "bg-muted text-muted-foreground" },
  1: { label: "低", className: "bg-blue-100 text-blue-700 border-blue-200" },
  2: { label: "中", className: "bg-amber-100 text-amber-700 border-amber-200" },
  3: { label: "高", className: "bg-orange-100 text-orange-700 border-orange-200" },
  4: { label: "紧急", className: "bg-rose-100 text-rose-700 border-rose-200" },
};

/** 支持的扩展名（与后端 ai-decompose endpoint 对齐）。 */
const ACCEPT_EXTENSIONS = ".md,.txt,.docx,.pdf";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function makeDraftId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function toDraft(item: AIDecomposedItem): DraftItem {
  return {
    id: makeDraftId(),
    title: item.title || "",
    description: item.description || "",
    priority: typeof item.priority === "number" ? item.priority : 0,
    tags: Array.isArray(item.tags) ? item.tags : [],
    selected: true,
  };
}

function emptyDraft(): DraftItem {
  return {
    id: makeDraftId(),
    title: "",
    description: "",
    priority: 0,
    tags: [],
    selected: true,
  };
}

export function AIDecomposeDialog({
  open,
  onOpenChange,
  projectId,
  groupId,
}: AIDecomposeDialogProps) {
  const [step, setStep] = useState<Step>("input");

  // ---- Step 1 状态 ----
  const [text, setText] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: agentsData } = useAgents();
  const agents = agentsData?.agents ?? [];

  // ---- Step 2 状态 ----
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [skippedFiles, setSkippedFiles] = useState<string[]>([]);

  // ---- Step 3 状态 ----
  const [createResult, setCreateResult] =
    useState<BatchCreateWorkItemsResponse | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const decomposeMutation = useAIDecompose();
  const batchCreateMutation = useBatchCreateWorkItems();

  // 关闭时重置全部状态，避免下次打开残留旧数据
  const resetAll = useCallback(() => {
    setStep("input");
    setText("");
    setLinkInput("");
    setLinks([]);
    setFiles([]);
    setAgentId("");
    setAnalyzeError(null);
    setDrafts([]);
    setEditingId(null);
    setExpandedIds(new Set());
    setSkippedFiles([]);
    setCreateResult(null);
    setCreateError(null);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        // 创建中阶段不允许通过 ESC/点击遮罩关闭，避免误中断
        if (batchCreateMutation.isPending) return;
        resetAll();
      }
      onOpenChange(next);
    },
    [batchCreateMutation.isPending, onOpenChange, resetAll],
  );

  // ---- 链接管理 ----
  const handleAddLink = () => {
    const url = linkInput.trim();
    if (!url) return;
    if (links.includes(url)) {
      setLinkInput("");
      return;
    }
    setLinks((prev) => [...prev, url]);
    setLinkInput("");
  };

  const handleRemoveLink = (url: string) => {
    setLinks((prev) => prev.filter((l) => l !== url));
  };

  // ---- 文件管理 ----
  const handleFilesAdd = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming);
    if (arr.length === 0) return;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}::${f.size}`));
      const merged = [...prev];
      for (const f of arr) {
        const key = `${f.name}::${f.size}`;
        if (!seen.has(key)) {
          merged.push(f);
          seen.add(key);
        }
      }
      return merged;
    });
  };

  const handleRemoveFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    handleFilesAdd(e.dataTransfer.files);
  };

  // ---- AI 分析 ----
  const canAnalyze = useMemo(() => {
    if (decomposeMutation.isPending) return false;
    return text.trim().length > 0 || links.length > 0 || files.length > 0;
  }, [text, links, files, decomposeMutation.isPending]);

  const handleAnalyze = async () => {
    setAnalyzeError(null);
    if (!canAnalyze) return;
    if (!projectId) {
      setAnalyzeError("缺少项目上下文，无法发起分析");
      return;
    }
    const fd = new FormData();
    if (text.trim()) fd.append("text", text.trim());
    if (links.length > 0) fd.append("links", JSON.stringify(links));
    fd.append("project_id", projectId);
    if (groupId) fd.append("group_id", groupId);
    if (agentId) fd.append("agent_id", agentId);
    for (const f of files) fd.append("files", f, f.name);

    setStep("result");
    try {
      const resp = await decomposeMutation.mutateAsync(fd);
      const items = Array.isArray(resp.items) ? resp.items : [];
      setDrafts(items.map(toDraft));
      setSkippedFiles(resp.skipped_files ?? []);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : String(e));
      // 失败时保持在 result step 上由 UI 显示错误并允许返回 / 重试
    }
  };

  // ---- 候选条目编辑 ----
  const updateDraft = (id: string, patch: Partial<DraftItem>) => {
    setDrafts((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    );
  };

  const removeDraft = (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    if (editingId === id) setEditingId(null);
    setExpandedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const addManualDraft = () => {
    const draft = emptyDraft();
    setDrafts((prev) => [...prev, draft]);
    setEditingId(draft.id);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    setDrafts((prev) => prev.map((d) => ({ ...d, selected: checked })));
  };

  const selectedCount = useMemo(
    () => drafts.filter((d) => d.selected).length,
    [drafts],
  );

  // ---- 批量创建 ----
  const handleConfirmCreate = async () => {
    setCreateError(null);
    const selected = drafts.filter(
      (d) => d.selected && d.title.trim().length > 0,
    );
    if (selected.length === 0) {
      setCreateError("请至少选择一项含标题的工作项");
      return;
    }
    if (!projectId) {
      setCreateError("缺少项目上下文，无法创建");
      return;
    }
    setStep("creating");
    try {
      const resp = await batchCreateMutation.mutateAsync({
        items: selected.map((d) => ({
          title: d.title.trim(),
          description: d.description,
          priority: d.priority,
          tags: d.tags,
        })),
        project_id: projectId,
        group_id: groupId,
      });
      setCreateResult(resp);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleBackToInput = () => {
    setStep("input");
    setDrafts([]);
    setSkippedFiles([]);
    setAnalyzeError(null);
    setEditingId(null);
    setExpandedIds(new Set());
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
        <div className="px-6 pt-6">
          <DialogHeader className="border-b-0 pb-2 text-left">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI 分解需求
            </DialogTitle>
            <DialogDescription>
              粘贴需求文档、上传文件或提供链接，AI 将拆解为多个可创建的工作项。
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Step indicator */}
        <StepIndicator step={step} />

        {step === "input" && (
          <InputStep
            text={text}
            onTextChange={setText}
            linkInput={linkInput}
            onLinkInputChange={setLinkInput}
            links={links}
            onAddLink={handleAddLink}
            onRemoveLink={handleRemoveLink}
            files={files}
            dragOver={dragOver}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onPickFiles={() => fileInputRef.current?.click()}
            onRemoveFile={handleRemoveFile}
            fileInputRef={fileInputRef}
            onFilesPicked={handleFilesAdd}
            agentId={agentId}
            onAgentIdChange={setAgentId}
            agentOptions={agents.map((a) => ({ id: a.id, name: a.name }))}
            error={analyzeError}
          />
        )}

        {step === "result" && (
          <ResultStep
            isLoading={decomposeMutation.isPending}
            error={analyzeError}
            drafts={drafts}
            skippedFiles={skippedFiles}
            editingId={editingId}
            expandedIds={expandedIds}
            onSetEditing={setEditingId}
            onToggleExpand={toggleExpand}
            onUpdate={updateDraft}
            onRemove={removeDraft}
            onAddManual={addManualDraft}
            onToggleSelectAll={toggleSelectAll}
          />
        )}

        {step === "creating" && (
          <CreatingStep
            isLoading={batchCreateMutation.isPending}
            error={createError}
            result={createResult}
          />
        )}

        {/* Footer */}
        <DialogFooter className="px-6 pb-6 pt-2 border-t-0 sm:justify-between sm:items-center gap-3">
          {step === "input" && (
            <>
              <p className="text-xs text-muted-foreground">
                支持 Markdown、TXT、DOCX、PDF；可叠加文本、链接与文件作为分析输入。
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                >
                  取消
                </Button>
                <Button
                  onClick={handleAnalyze}
                  disabled={!canAnalyze}
                  className="gap-1.5"
                >
                  <Sparkles className="h-4 w-4" />
                  {decomposeMutation.isPending ? "分析中…" : "AI 分析"}
                </Button>
              </div>
            </>
          )}

          {step === "result" && (
            <>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  已选 <span className="font-semibold text-foreground">
                    {selectedCount}
                  </span>{" "}
                  / 共{" "}
                  <span className="font-semibold text-foreground">
                    {drafts.length}
                  </span>{" "}
                  项
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={addManualDraft}
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={decomposeMutation.isPending}
                >
                  <Plus className="h-3 w-3" />
                  手动添加
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBackToInput}
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={decomposeMutation.isPending}
                >
                  <RefreshCw className="h-3 w-3" />
                  重新分析
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                >
                  取消
                </Button>
                <Button
                  onClick={handleConfirmCreate}
                  disabled={
                    decomposeMutation.isPending ||
                    selectedCount === 0 ||
                    !!analyzeError
                  }
                >
                  确认创建（{selectedCount}）
                </Button>
              </div>
            </>
          )}

          {step === "creating" && (
            <>
              <span className="text-xs text-muted-foreground">
                {batchCreateMutation.isPending
                  ? "正在写入数据库…"
                  : createResult
                    ? "完成"
                    : ""}
              </span>
              <div className="flex gap-2">
                {!batchCreateMutation.isPending && createResult && (
                  <Button onClick={() => handleOpenChange(false)}>完成</Button>
                )}
                {!batchCreateMutation.isPending && !createResult && createError && (
                  <Button
                    variant="outline"
                    onClick={() => setStep("result")}
                  >
                    返回上一步
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Step indicator
// ============================================================

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "input", label: "1. 输入需求" },
    { key: "result", label: "2. 校对结果" },
    { key: "creating", label: "3. 创建" },
  ];
  const activeIdx = steps.findIndex((s) => s.key === step);
  return (
    <div className="flex items-center gap-2 px-6 py-3 text-xs">
      {steps.map((s, idx) => {
        const isActive = idx === activeIdx;
        const isDone = idx < activeIdx;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span
              className={`flex h-5 items-center rounded-full px-2 font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : isDone
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {s.label}
            </span>
            {idx < steps.length - 1 && (
              <span className="h-px w-6 bg-border" aria-hidden />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Step 1 - Input
// ============================================================

interface InputStepProps {
  text: string;
  onTextChange: (v: string) => void;
  linkInput: string;
  onLinkInputChange: (v: string) => void;
  links: string[];
  onAddLink: () => void;
  onRemoveLink: (url: string) => void;
  files: File[];
  dragOver: boolean;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPickFiles: () => void;
  onRemoveFile: (idx: number) => void;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  onFilesPicked: (files: FileList | null) => void;
  agentId: string;
  onAgentIdChange: (v: string) => void;
  agentOptions: { id: string; name: string }[];
  error: string | null;
}

function InputStep(props: InputStepProps) {
  const {
    text,
    onTextChange,
    linkInput,
    onLinkInputChange,
    links,
    onAddLink,
    onRemoveLink,
    files,
    dragOver,
    onDragOver,
    onDragLeave,
    onDrop,
    onPickFiles,
    onRemoveFile,
    fileInputRef,
    onFilesPicked,
    agentId,
    onAgentIdChange,
    agentOptions,
    error,
  } = props;
  return (
    <div className="space-y-5 px-6 pb-2">
      {/* AI 引擎选择 */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          AI 引擎
        </label>
        <select
          value={agentId}
          onChange={(e) => onAgentIdChange(e.target.value)}
          className="h-9 w-full rounded-md border border-border/60 bg-muted/30 px-2 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
        >
          <option value="">自动（使用默认 Agent）</option>
          {agentOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {/* 文本输入 */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          需求文本
        </label>
        <textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="粘贴需求文档、PRD 内容或需求描述…"
          className="min-h-[200px] w-full rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* 链接 */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          参考链接
        </label>
        <div className="flex gap-2">
          <Input
            value={linkInput}
            onChange={(e) => onLinkInputChange(e.target.value)}
            placeholder="https://…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAddLink();
              }
            }}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            onClick={onAddLink}
            className="gap-1"
          >
            <Plus className="h-4 w-4" />
            添加
          </Button>
        </div>
        {links.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {links.map((url) => (
              <span
                key={url}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs"
                title={url}
              >
                <span className="truncate max-w-[280px]">{url}</span>
                <button
                  type="button"
                  onClick={() => onRemoveLink(url)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="移除链接"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 文件上传 */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          附件
        </label>
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={onPickFiles}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onPickFiles();
            }
          }}
          className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border/60 bg-muted/20 hover:bg-muted/30"
          }`}
        >
          <Upload className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            点击或拖拽文件到此处上传
          </p>
          <p className="text-[11px] text-muted-foreground">
            支持 .md / .txt / .docx / .pdf
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_EXTENSIONS}
            className="hidden"
            onChange={(e) => {
              onFilesPicked(e.target.files);
              // 允许同名文件再次选择
              e.target.value = "";
            }}
          />
        </div>
        {files.length > 0 && (
          <ul className="mt-2 space-y-1">
            {files.map((f, idx) => (
              <li
                key={`${f.name}-${idx}`}
                className="flex items-center justify-between rounded-md border border-border/40 bg-card px-2.5 py-1.5 text-xs"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate" title={f.name}>
                    {f.name}
                  </span>
                  <span className="text-muted-foreground">
                    {formatFileSize(f.size)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveFile(idx)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="移除文件"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Step 2 - Result
// ============================================================

interface ResultStepProps {
  isLoading: boolean;
  error: string | null;
  drafts: DraftItem[];
  skippedFiles: string[];
  editingId: string | null;
  expandedIds: Set<string>;
  onSetEditing: (id: string | null) => void;
  onToggleExpand: (id: string) => void;
  onUpdate: (id: string, patch: Partial<DraftItem>) => void;
  onRemove: (id: string) => void;
  onAddManual: () => void;
  onToggleSelectAll: (checked: boolean) => void;
}

function ResultStep(props: ResultStepProps) {
  const {
    isLoading,
    error,
    drafts,
    skippedFiles,
    editingId,
    expandedIds,
    onSetEditing,
    onToggleExpand,
    onUpdate,
    onRemove,
    onAddManual,
    onToggleSelectAll,
  } = props;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16">
        <Sparkles className="h-6 w-6 animate-pulse text-primary" />
        <p className="text-sm text-muted-foreground">AI 正在分析需求…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-4 space-y-3">
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>分析失败：{error}</span>
        </div>
      </div>
    );
  }

  const allSelected = drafts.length > 0 && drafts.every((d) => d.selected);
  const someSelected = drafts.some((d) => d.selected);

  return (
    <div className="px-6 pb-2 space-y-3 max-h-[55vh] overflow-y-auto">
      {/* 顶部工具栏：全选 + skipped 文件提示 */}
      <div className="flex items-center justify-between text-xs">
        <label className="flex items-center gap-2 cursor-pointer text-muted-foreground">
          <input
            type="checkbox"
            checked={allSelected}
            // 半选状态：使用 ref 设置 indeterminate
            ref={(el) => {
              if (el) el.indeterminate = !allSelected && someSelected;
            }}
            onChange={(e) => onToggleSelectAll(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border/60"
          />
          <span>全选</span>
        </label>
      </div>

      {skippedFiles.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
          以下文件未被解析：
          <ul className="ml-4 mt-1 list-disc">
            {skippedFiles.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {drafts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            AI 未能识别出可拆分的工作项
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={onAddManual}
            className="mt-3 gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            手动添加一条
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {drafts.map((d, idx) => (
            <DraftCard
              key={d.id}
              draft={d}
              index={idx + 1}
              editing={editingId === d.id}
              expanded={expandedIds.has(d.id)}
              onSetEditing={onSetEditing}
              onToggleExpand={() => onToggleExpand(d.id)}
              onUpdate={(patch) => onUpdate(d.id, patch)}
              onRemove={() => onRemove(d.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface DraftCardProps {
  draft: DraftItem;
  index: number;
  editing: boolean;
  expanded: boolean;
  onSetEditing: (id: string | null) => void;
  onToggleExpand: () => void;
  onUpdate: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
}

function DraftCard({
  draft,
  index,
  editing,
  expanded,
  onSetEditing,
  onToggleExpand,
  onUpdate,
  onRemove,
}: DraftCardProps) {
  const [tagInput, setTagInput] = useState("");
  const priorityCfg = PRIORITY_BADGE[draft.priority] ?? PRIORITY_BADGE[0];

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag) return;
    if (draft.tags.includes(tag)) {
      setTagInput("");
      return;
    }
    onUpdate({ tags: [...draft.tags, tag] });
    setTagInput("");
  };
  const removeTag = (tag: string) => {
    onUpdate({ tags: draft.tags.filter((t) => t !== tag) });
  };

  return (
    <li
      className={`rounded-lg border bg-card transition-colors ${
        draft.selected ? "border-border/70" : "border-border/30 opacity-60"
      }`}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <input
          type="checkbox"
          checked={draft.selected}
          onChange={(e) => onUpdate({ selected: e.target.checked })}
          className="mt-1 h-3.5 w-3.5 rounded border-border/60"
          aria-label="选择此项"
        />
        <span className="mt-0.5 text-xs font-mono text-muted-foreground tabular-nums">
          #{index}
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          {/* 标题（可直接编辑） */}
          {editing ? (
            <Input
              value={draft.title}
              onChange={(e) => onUpdate({ title: e.target.value })}
              placeholder="标题"
              className="h-8 text-sm"
            />
          ) : (
            <div className="flex items-center gap-2">
              <h4 className="truncate text-sm font-medium text-foreground">
                {draft.title || (
                  <span className="text-muted-foreground">(无标题)</span>
                )}
              </h4>
            </div>
          )}

          {/* 描述 */}
          {editing ? (
            <textarea
              value={draft.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
              placeholder="描述"
              rows={4}
              className="w-full rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
          ) : (
            draft.description && (
              <p
                className={`text-xs text-muted-foreground whitespace-pre-wrap ${
                  expanded ? "" : "line-clamp-2"
                }`}
              >
                {draft.description}
              </p>
            )
          )}

          {/* 优先级 + 标签 */}
          {editing ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  优先级
                </span>
                <Select
                  value={String(draft.priority)}
                  onChange={(e) =>
                    onUpdate({ priority: Number(e.target.value) })
                  }
                  options={PRIORITY_OPTIONS}
                  className="h-8"
                />
              </div>
              <div>
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  标签
                </span>
                <div className="flex gap-1">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="新标签"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    className="h-8 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addTag}
                    className="h-8 px-2"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {draft.tags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {draft.tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px]"
                      >
                        {t}
                        <button
                          type="button"
                          onClick={() => removeTag(t)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`移除标签 ${t}`}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className={`border ${priorityCfg.className}`}
              >
                {priorityCfg.label}
              </Badge>
              {draft.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex shrink-0 flex-col gap-1">
          {editing ? (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => onSetEditing(null)}
              className="h-7 px-2"
            >
              完成
            </Button>
          ) : (
            <>
              {draft.description && (
                <button
                  type="button"
                  onClick={onToggleExpand}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={expanded ? "收起描述" : "展开描述"}
                >
                  {expanded ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => onSetEditing(draft.id)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="编辑"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onRemove}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="删除"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

// ============================================================
// Step 3 - Creating
// ============================================================

interface CreatingStepProps {
  isLoading: boolean;
  error: string | null;
  result: BatchCreateWorkItemsResponse | null;
}

function CreatingStep({ isLoading, error, result }: CreatingStepProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16">
        <Sparkles className="h-6 w-6 animate-pulse text-primary" />
        <p className="text-sm text-muted-foreground">正在创建工作项…</p>
      </div>
    );
  }

  if (error && !result) {
    return (
      <div className="px-6 py-4">
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>创建失败：{error}</span>
        </div>
      </div>
    );
  }

  if (!result) return null;

  const createdCount = result.created?.length ?? 0;
  const failedCount = result.failed?.length ?? 0;
  return (
    <div className="px-6 pb-2 space-y-3 max-h-[55vh] overflow-y-auto">
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4" />
        <span>
          成功创建 <span className="font-semibold">{createdCount}</span> 项
          {failedCount > 0 ? (
            <>
              ，失败 <span className="font-semibold">{failedCount}</span> 项
            </>
          ) : null}
        </span>
      </div>

      {failedCount > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="mb-2 text-xs font-medium text-destructive">
            以下条目创建失败：
          </p>
          <ul className="space-y-1.5 text-xs">
            {result.failed.map((f) => (
              <li
                key={`${f.index}-${f.title}`}
                className="rounded border border-destructive/20 bg-background/80 px-2 py-1.5"
              >
                <div className="font-medium text-foreground">
                  #{f.index + 1} {f.title || "(无标题)"}
                </div>
                <div className="mt-0.5 text-muted-foreground">{f.error}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
