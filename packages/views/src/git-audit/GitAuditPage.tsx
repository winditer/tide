"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import {
  GitCommit as GitCommitIcon,
  FileText,
  Plus,
  Minus,
  Users,
  GitBranch,
  Calendar,
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Trash2,
  Ban,
  Upload,
  CheckCircle2,
  ArrowLeft,
  Tag,
} from "lucide-react";
import {
  useGitCommits,
  useGitChanges,
  useGitBranches,
  useGitUncommitted,
  useGitCommitMutation,
  useGitDiscardMutation,
  useGitIgnoreMutation,
} from "@tide/core";
import type { GitChangeGroup, GitUncommittedFile, GitCommit } from "@tide/core";
import { CommitList } from "./CommitList";
import { FileChangeList } from "./FileChangeList";
import { DiffPanel } from "./DiffPanel";
import { DiffFileList } from "./DiffFileList";
import type { DiffFileItem } from "./DiffFileList";

type TabType = "commits" | "files" | "work_item" | "session" | "version";
type TimeRange = "today" | "3d" | "7d" | "30d" | "all";

interface GitAuditPageProps {
  projectId: string;
}

interface DiffViewState {
  active: boolean;
  mode: "uncommitted" | "commit";
  commitHash?: string;
  commitMessage?: string;
  files: DiffFileItem[];
  selectedFile: string | null;
}

function getTimeRangeDate(range: TimeRange): string | undefined {
  if (range === "all") return undefined;
  const now = new Date();
  let days: number;
  switch (range) {
    case "today":
      days = 0;
      break;
    case "3d":
      days = 3;
      break;
    case "7d":
      days = 7;
      break;
    case "30d":
      days = 30;
      break;
    default:
      return undefined;
  }
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} 天前`;
  return date.toLocaleDateString();
}

export function GitAuditPage({ projectId }: GitAuditPageProps) {
  const [activeTab, setActiveTab] = useState<TabType>("commits");
  const [timeRange, setTimeRange] = useState<TimeRange>("today");
  const [branch, setBranch] = useState<string>("");
  const [diffView, setDiffView] = useState<DiffViewState>({
    active: false,
    mode: "uncommitted",
    files: [],
    selectedFile: null,
  });

  const since = getTimeRangeDate(timeRange);

  const { data: branchData } = useGitBranches(projectId);
  const branches = branchData?.branches ?? [];
  const currentBranch = branchData?.current ?? null;

  const { data: commits = [], isLoading: commitsLoading } = useGitCommits(
    projectId,
    {
      branch: branch || undefined,
      since,
      limit: 100,
    },
  );

  const { data: uncommittedData } = useGitUncommitted(projectId);
  const uncommittedFiles = uncommittedData?.files ?? [];
  const uncommittedBranch = uncommittedData?.current_branch ?? currentBranch;

  const { data: changesByWorkItem = [], isLoading: workItemLoading } = useGitChanges(projectId, {
    group_by: "work_item",
    since,
  });

  const { data: changesBySession = [], isLoading: sessionLoading } = useGitChanges(projectId, {
    group_by: "session",
    since,
  });

  const { data: changesByVersion = [], isLoading: versionLoading } = useGitChanges(projectId, {
    group_by: "version",
    since,
  });

  const commitMutation = useGitCommitMutation(projectId);
  const discardMutation = useGitDiscardMutation(projectId);
  const ignoreMutation = useGitIgnoreMutation(projectId);

  // Determine if the uncommitted section should be visible based on filters
  const showUncommitted = useMemo(() => {
    if (uncommittedFiles.length === 0) return false;
    // If a specific branch is selected, only show when it matches current branch
    if (branch && uncommittedBranch && uncommittedBranch !== branch) return false;
    return true;
  }, [uncommittedFiles.length, branch, uncommittedBranch]);

  // Compute stats from commits
  const stats = useMemo(() => {
    if (!commits.length) {
      return { totalCommits: 0, filesChanged: 0, additions: 0, deletions: 0 };
    }
    const fileSet = new Set<string>();
    let additions = 0;
    let deletions = 0;
    for (const commit of commits) {
      for (const file of commit.files ?? []) {
        fileSet.add(file.path);
        additions += file.additions || 0;
        deletions += file.deletions || 0;
      }
    }
    return {
      totalCommits: commits.length,
      filesChanged: fileSet.size,
      additions,
      deletions,
    };
  }, [commits]);

  // Enter diff view for a specific commit file
  const handleViewCommitDiff = useCallback(
    (hash: string, filePath?: string) => {
      const commit = commits.find((c) => c.hash === hash);
      const files: DiffFileItem[] = (commit?.files ?? []).map((f) => ({
        path: f.path,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      }));
      setDiffView({
        active: true,
        mode: "commit",
        commitHash: hash,
        commitMessage: commit?.message ?? hash.slice(0, 7),
        files,
        selectedFile: filePath ?? files[0]?.path ?? null,
      });
    },
    [commits],
  );

  // Enter diff view from a GitCommit object directly (used by session commits)
  const handleEnterCommitDiffView = useCallback(
    (commit: GitCommit, filePath?: string) => {
      const files: DiffFileItem[] = (commit.files ?? []).map((f) => ({
        path: f.path,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      }));
      setDiffView({
        active: true,
        mode: "commit",
        commitHash: commit.hash,
        commitMessage: commit.message ?? commit.hash.slice(0, 7),
        files,
        selectedFile: filePath ?? files[0]?.path ?? null,
      });
    },
    [],
  );

  // Enter diff view for uncommitted changes
  const handleViewUncommittedDiff = useCallback(
    (filePath: string) => {
      const files: DiffFileItem[] = uncommittedFiles.map((f) => ({
        path: f.path,
        status: f.status,
        staged: f.staged,
      }));
      setDiffView({
        active: true,
        mode: "uncommitted",
        files,
        selectedFile: filePath,
      });
    },
    [uncommittedFiles],
  );

  // Exit diff view
  const handleExitDiffView = useCallback(() => {
    setDiffView({ active: false, mode: "uncommitted", files: [], selectedFile: null });
  }, []);

  // Select a file within diff view
  const handleSelectFile = useCallback((path: string) => {
    setDiffView((prev) => ({ ...prev, selectedFile: path }));
  }, []);

  // ── Diff View Mode ──────────────────────────────────────────────────────────
  if (diffView.active) {
    return (
      <DiffViewMode
        projectId={projectId}
        diffView={diffView}
        onSelectFile={handleSelectFile}
        onExit={handleExitDiffView}
        onCommitFile={(path) => {
          commitMutation.mutate(
            { files: [path], message: "" },
            // Prompt needed — use batch flow instead
          );
        }}
        onDiscardFile={(path) => {
          discardMutation.mutate({ files: [path] });
        }}
        onIgnoreFile={(path) => {
          ignoreMutation.mutate({ files: [path] });
        }}
      />
    );
  }

  // ── Normal Audit View ───────────────────────────────────────────────────────
  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: "commits", label: "按提交", icon: <GitCommitIcon className="h-3.5 w-3.5" /> },
    { key: "files", label: "按文件", icon: <FileText className="h-3.5 w-3.5" /> },
    { key: "work_item", label: "按工作项", icon: <Users className="h-3.5 w-3.5" /> },
    { key: "session", label: "按会话", icon: <GitBranch className="h-3.5 w-3.5" /> },
    { key: "version", label: "按版本", icon: <Tag className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-zinc-400" />
          <select
            value={branch}
            onChange={(e) => {
              setBranch(e.target.value);
            }}
            className="h-8 w-44 rounded-md border border-zinc-200 bg-white px-2.5 text-xs text-zinc-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">全部分支</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}{b === currentBranch ? " (当前)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-zinc-400" />
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as TimeRange)}
            className="h-8 rounded-md border border-zinc-200 bg-white px-2.5 text-xs text-zinc-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="today">今天</option>
            <option value="3d">最近 3 天</option>
            <option value="7d">最近 7 天</option>
            <option value="30d">最近 30 天</option>
            <option value="all">全部</option>
          </select>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="总提交数"
          value={stats.totalCommits}
          icon={<GitCommitIcon className="h-5 w-5 text-blue-500" />}
        />
        <StatCard
          label="修改文件"
          value={stats.filesChanged}
          icon={<FileText className="h-5 w-5 text-purple-500" />}
        />
        <StatCard
          label="新增行"
          value={stats.additions}
          icon={<Plus className="h-5 w-5 text-green-500" />}
          valueClassName="text-green-600"
        />
        <StatCard
          label="删除行"
          value={stats.deletions}
          icon={<Minus className="h-5 w-5 text-red-500" />}
          valueClassName="text-red-600"
        />
      </div>

      {/* Uncommitted changes */}
      {showUncommitted && (
        <UncommittedSection
          projectId={projectId}
          files={uncommittedFiles}
          onViewDiff={handleViewUncommittedDiff}
        />
      )}

      {/* Tabs */}
      <div className="border-b border-zinc-200">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md transition-colors ${
                activeTab === tab.key
                  ? "bg-white border border-b-0 border-zinc-200 text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
        {commitsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500" />
            <span className="ml-2 text-sm text-zinc-500">加载中...</span>
          </div>
        ) : (
          <>
            {activeTab === "commits" && (
              <CommitList commits={commits} onViewDiff={handleViewCommitDiff} />
            )}
            {activeTab === "files" && (
              <FileChangeList commits={commits} onViewDiff={handleViewCommitDiff} />
            )}
            {activeTab === "work_item" && (
              workItemLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500" />
                  <span className="ml-2 text-sm text-zinc-500">加载中...</span>
                </div>
              ) : (
                <ChangeGroupList
                  groups={changesByWorkItem}
                  label="工作项"
                  emptyHint="当前项目没有以 tide/wi-* 开头的工作项分支，请先通过工作项创建分支后再查看"
                  projectId={projectId}
                  onEnterDiffView={handleEnterCommitDiffView}
                />
              )
            )}
            {activeTab === "session" && (
              sessionLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500" />
                  <span className="ml-2 text-sm text-zinc-500">加载中...</span>
                </div>
              ) : (
                <SessionGroupList
                  groups={changesBySession}
                  projectId={projectId}
                  onEnterDiffView={handleEnterCommitDiffView}
                />
              )
            )}
            {activeTab === "version" && (
              versionLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500" />
                  <span className="ml-2 text-sm text-zinc-500">加载中...</span>
                </div>
              ) : (
                <ChangeGroupList
                  groups={changesByVersion}
                  label="版本"
                  emptyHint="当前项目未设置版本或版本下无关联工作项"
                  projectId={projectId}
                  onEnterDiffView={handleEnterCommitDiffView}
                />
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Diff View Mode Component ────────────────────────────────────────────────

function DiffViewMode({
  projectId,
  diffView,
  onSelectFile,
  onExit,
  onCommitFile,
  onDiscardFile,
  onIgnoreFile,
}: {
  projectId: string;
  diffView: DiffViewState;
  onSelectFile: (path: string) => void;
  onExit: () => void;
  onCommitFile?: (path: string) => void;
  onDiscardFile?: (path: string) => void;
  onIgnoreFile?: (path: string) => void;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showBatchCommit, setShowBatchCommit] = useState(false);
  const [batchCommitMsg, setBatchCommitMsg] = useState("");
  const [showBatchDiscard, setShowBatchDiscard] = useState(false);

  const commitMutation = useGitCommitMutation(projectId);
  const discardMutation = useGitDiscardMutation(projectId);

  const handleToggleFullscreen = useCallback(() => {
    setFullscreen((prev) => {
      const next = !prev;
      if (next) setSidebarCollapsed(true); // collapse sidebar when entering fullscreen
      return next;
    });
  }, []);

  // Escape key to exit fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [fullscreen]);

  const title =
    diffView.mode === "uncommitted"
      ? "未提交变更"
      : diffView.commitMessage ?? diffView.commitHash?.slice(0, 7) ?? "Diff";

  const handleBatchCommit = () => {
    setShowBatchCommit(true);
    setBatchCommitMsg("");
  };

  const doBatchCommit = () => {
    if (!batchCommitMsg.trim()) return;
    commitMutation.mutate(
      { files: null, message: batchCommitMsg.trim() },
      {
        onSuccess: () => {
          setShowBatchCommit(false);
          setBatchCommitMsg("");
        },
      },
    );
  };

  const handleBatchDiscard = () => {
    setShowBatchDiscard(true);
  };

  const doBatchDiscard = () => {
    discardMutation.mutate(
      { files: null },
      { onSuccess: () => setShowBatchDiscard(false) },
    );
  };

  return (
    <div className={`flex flex-col ${fullscreen ? "fixed inset-0 z-50 bg-white" : "h-[calc(100vh-8rem)] min-h-[500px]"}`}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200 bg-white rounded-t-lg flex-shrink-0 min-w-0">
        <button
          onClick={onExit}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 transition-colors shrink-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回审计
        </button>
        <div className="h-4 w-px bg-zinc-200 shrink-0" />
        <span className="text-sm font-medium text-zinc-700 truncate min-w-0" title={title}>
          {diffView.mode === "commit" && (
            <code className="text-blue-600 mr-2">
              {diffView.commitHash?.slice(0, 7)}
            </code>
          )}
          {title}
        </span>
        {diffView.selectedFile && (
          <>
            <div className="h-4 w-px bg-zinc-200 shrink-0" />
            <span className="text-xs text-zinc-500 font-mono shrink-0 max-w-[200px] truncate" title={diffView.selectedFile}>
              {diffView.selectedFile}
            </span>
          </>
        )}
      </div>

      {/* Split pane */}
      <div className="flex flex-1 min-h-0 border border-t-0 border-zinc-200 overflow-hidden">
        {/* Left: file list (collapsible) */}
        <div
          className={`flex flex-col flex-shrink-0 border-r border-zinc-200 bg-white transition-all duration-200 ${
            sidebarCollapsed ? "w-10" : "w-[280px]"
          }`}
        >
          {sidebarCollapsed ? (
            <div className="flex flex-col items-center pt-2">
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="p-1 rounded hover:bg-zinc-200 text-zinc-500 transition-colors"
                title="展开文件列表"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 flex-shrink-0">
                <span className="text-sm font-medium text-zinc-700">文件列表</span>
                <button
                  onClick={() => setSidebarCollapsed(true)}
                  className="p-1 rounded hover:bg-zinc-200 text-zinc-500 transition-colors"
                  title="收起文件列表"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                <DiffFileList
                  files={diffView.files}
                  selectedFile={diffView.selectedFile}
                  onSelectFile={onSelectFile}
                  showActions={diffView.mode === "uncommitted"}
                  onCommitFile={diffView.mode === "uncommitted" ? onCommitFile : undefined}
                  onDiscardFile={diffView.mode === "uncommitted" ? onDiscardFile : undefined}
                  onIgnoreFile={diffView.mode === "uncommitted" ? onIgnoreFile : undefined}
                />
              </div>
            </>
          )}
        </div>

        {/* Right: diff content */}
        <div className="flex-1 min-w-0 bg-zinc-900">
          {diffView.selectedFile ? (
            <DiffPanel
              projectId={projectId}
              commitHash={diffView.mode === "commit" ? diffView.commitHash : undefined}
              filePath={diffView.selectedFile}
              isFullscreen={fullscreen}
              onToggleFullscreen={handleToggleFullscreen}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-400">
              <FileText className="h-6 w-6 mr-2 opacity-50" />
              <span className="text-sm">选择左侧文件查看 diff</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom action bar for uncommitted mode */}
      {diffView.mode === "uncommitted" && (
        <div className="flex items-center gap-3 px-4 py-3 border border-t-0 border-zinc-200 bg-white rounded-b-lg flex-shrink-0">
          <button
            onClick={handleBatchCommit}
            disabled={commitMutation.isPending}
            className="flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            全部提交
          </button>
          <button
            onClick={handleBatchDiscard}
            disabled={discardMutation.isPending}
            className="flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            全部撤销
          </button>
        </div>
      )}

      {/* Batch commit message dialog */}
      {showBatchCommit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-5 shadow-xl">
            <h3 className="text-sm font-medium text-zinc-900 mb-3">
              提交所有变更
            </h3>
            <p className="text-xs text-zinc-500 mb-3">
              将提交所有未提交的变更文件
            </p>
            <input
              type="text"
              value={batchCommitMsg}
              onChange={(e) => setBatchCommitMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doBatchCommit(); }}
              placeholder="输入 commit message..."
              autoFocus
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setShowBatchCommit(false)}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={doBatchCommit}
                disabled={!batchCommitMsg.trim() || commitMutation.isPending}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {commitMutation.isPending ? "提交中..." : "确认提交"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch discard confirm dialog */}
      {showBatchDiscard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-5 shadow-xl">
            <h3 className="text-sm font-medium text-red-600 mb-2">
              ⚠️ 确认撤销
            </h3>
            <p className="text-xs text-zinc-600 mb-4">
              确定撤销所有未提交的修改？
              <br />
              <span className="text-red-500 font-medium">此操作不可恢复！</span>
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowBatchDiscard(false)}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={doBatchDiscard}
                disabled={discardMutation.isPending}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {discardMutation.isPending ? "撤销中..." : "确认撤销"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Internal components ─────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  valueClassName,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <div className="flex-shrink-0">{icon}</div>
      <div>
        <p className={`text-xl font-semibold ${valueClassName ?? "text-zinc-900"}`}>
          {value.toLocaleString()}
        </p>
        <p className="text-xs text-zinc-500">{label}</p>
      </div>
    </div>
  );
}

function ChangeGroupList({
  groups,
  label,
  emptyHint,
  projectId,
  onEnterDiffView,
}: {
  groups: GitChangeGroup[];
  label: string;
  emptyHint?: string;
  projectId: string;
  onEnterDiffView: (commit: GitCommit, filePath?: string) => void;
}) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleItem = useCallback((id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
        <GitBranch className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm font-medium">暂无{label}分组数据</p>
        {emptyHint && (
          <p className="mt-1.5 text-xs text-zinc-400 max-w-xs text-center">
            {emptyHint}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="divide-y divide-zinc-200">
      {groups.map((group, idx) => {
        const itemId = group.id || group.branch || `group-${idx}`;
        const isExpanded = expandedItems.has(itemId);
        return (
          <div key={itemId}>
            {/* Work item header row */}
            <button
              onClick={() => toggleItem(itemId)}
              className="flex items-center gap-3 px-4 py-3 w-full text-left hover:bg-zinc-50 transition-colors"
            >
              <div className="flex-shrink-0 text-zinc-400">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-800 truncate">
                  {group.name || "(未关联)"}
                </p>
                <p className="text-xs text-zinc-500">
                  {group.branch && `分支: ${group.branch}`}
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs text-zinc-500 flex-shrink-0">
                <span className="flex items-center gap-1">
                  <GitCommitIcon className="h-3.5 w-3.5" />
                  {group.commit_count}
                </span>
                <span className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  {group.files_changed}
                </span>
                <span className="flex items-center gap-1 text-green-600">
                  <Plus className="h-3 w-3" />
                  {group.additions}
                </span>
                <span className="flex items-center gap-1 text-red-600">
                  <Minus className="h-3 w-3" />
                  {group.deletions}
                </span>
              </div>
            </button>

            {/* Expanded: commit list for this work item or version */}
            {isExpanded && (
              label === "版本" ? (
                <VersionCommitList
                  projectId={projectId}
                  versionId={group.id}
                  onViewDiff={onEnterDiffView}
                />
              ) : (
                <WorkItemCommitList
                  projectId={projectId}
                  workItemId={group.id}
                  branch={group.branch}
                  onViewDiff={onEnterDiffView}
                />
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Work Item Commit List (fetches commits for a work item) ─────────────────

function WorkItemCommitList({
  projectId,
  workItemId,
  branch,
  onViewDiff,
}: {
  projectId: string;
  workItemId?: string;
  branch?: string;
  onViewDiff: (commit: GitCommit, filePath?: string) => void;
}) {
  const { data: workItemCommits = [], isLoading } = useGitCommits(projectId, {
    work_item_id: workItemId || undefined,
    branch: !workItemId ? (branch || undefined) : undefined,
    limit: 100,
  });
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());

  const toggleCommit = useCallback((hash: string) => {
    setExpandedCommits((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 bg-zinc-50/50">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500" />
        <span className="ml-2 text-xs text-zinc-500">加载提交记录...</span>
      </div>
    );
  }

  if (workItemCommits.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-zinc-400 bg-zinc-50/50">
        该工作项暂无提交记录
      </div>
    );
  }

  return (
    <div className="bg-zinc-50/50 border-t border-zinc-100">
      {workItemCommits.map((commit) => {
        const isExpanded = expandedCommits.has(commit.hash);
        const fileCount = commit.files?.length ?? 0;

        return (
          <div key={commit.hash} className="border-b border-zinc-100 last:border-b-0">
            {/* Commit row */}
            <button
              onClick={() => toggleCommit(commit.hash)}
              className="flex items-center gap-3 w-full px-6 py-2.5 text-left hover:bg-zinc-100/50 transition-colors"
            >
              <div className="flex-shrink-0 text-zinc-400">
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </div>
              <GitCommitIcon className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
              <code className="text-xs text-blue-600 font-mono flex-shrink-0">
                {commit.hash.slice(0, 7)}
              </code>
              <span className="text-xs text-zinc-700 truncate flex-1 min-w-0">
                {commit.message}
              </span>
              <span className="text-[11px] text-zinc-400 flex-shrink-0">
                {formatRelativeTime(commit.date)}
              </span>
              {fileCount > 0 && (
                <span className="text-[11px] text-zinc-400 flex-shrink-0 flex items-center gap-0.5">
                  <FileText className="h-3 w-3" />
                  {fileCount}
                </span>
              )}
            </button>

            {/* Expanded file list for this commit */}
            {isExpanded && commit.files && commit.files.length > 0 && (
              <div className="pl-14 pr-4 pb-2 space-y-0.5">
                {commit.files.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => onViewDiff(commit, file.path)}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-left rounded hover:bg-zinc-200/50 transition-colors group"
                  >
                    <FileText className="h-3 w-3 text-zinc-400 flex-shrink-0" />
                    <span className="text-xs font-mono text-zinc-600 truncate flex-1 min-w-0 group-hover:text-blue-600">
                      {file.path}
                    </span>
                    <span className="flex items-center gap-1.5 text-[10px] flex-shrink-0">
                      {file.additions > 0 && (
                        <span className="text-green-600 flex items-center gap-0.5">
                          <Plus className="h-2.5 w-2.5" />
                          {file.additions}
                        </span>
                      )}
                      {file.deletions > 0 && (
                        <span className="text-red-600 flex items-center gap-0.5">
                          <Minus className="h-2.5 w-2.5" />
                          {file.deletions}
                        </span>
                      )}
                    </span>
                    <Eye className="h-3 w-3 text-zinc-300 group-hover:text-blue-500 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Version Commit List (fetches commits for a version) ────────────────────

function VersionCommitList({
  projectId,
  versionId,
  onViewDiff,
}: {
  projectId: string;
  versionId?: string;
  onViewDiff: (commit: GitCommit, filePath?: string) => void;
}) {
  const { data: versionCommits = [], isLoading } = useGitCommits(projectId, {
    version_id: versionId || undefined,
    limit: 100,
  });
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());

  const toggleCommit = useCallback((hash: string) => {
    setExpandedCommits((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 bg-zinc-50/50">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500" />
        <span className="ml-2 text-xs text-zinc-500">加载提交记录...</span>
      </div>
    );
  }

  if (versionCommits.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-zinc-400 bg-zinc-50/50">
        该版本暂无提交记录
      </div>
    );
  }

  return (
    <div className="bg-zinc-50/50 border-t border-zinc-100">
      {versionCommits.map((commit) => {
        const isExpanded = expandedCommits.has(commit.hash);
        const fileCount = commit.files?.length ?? 0;

        return (
          <div key={commit.hash} className="border-b border-zinc-100 last:border-b-0">
            <button
              onClick={() => toggleCommit(commit.hash)}
              className="flex items-center gap-3 w-full px-6 py-2.5 text-left hover:bg-zinc-100/50 transition-colors"
            >
              <div className="flex-shrink-0 text-zinc-400">
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </div>
              <GitCommitIcon className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
              <code className="text-xs text-blue-600 font-mono flex-shrink-0">
                {commit.hash.slice(0, 7)}
              </code>
              <span className="text-xs text-zinc-700 truncate flex-1 min-w-0">
                {commit.message}
              </span>
              <span className="text-[11px] text-zinc-400 flex-shrink-0">
                {formatRelativeTime(commit.date)}
              </span>
              {fileCount > 0 && (
                <span className="text-[11px] text-zinc-400 flex-shrink-0 flex items-center gap-0.5">
                  <FileText className="h-3 w-3" />
                  {fileCount}
                </span>
              )}
            </button>

            {isExpanded && commit.files && commit.files.length > 0 && (
              <div className="pl-14 pr-4 pb-2 space-y-0.5">
                {commit.files.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => onViewDiff(commit, file.path)}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-left rounded hover:bg-zinc-200/50 transition-colors group"
                  >
                    <FileText className="h-3 w-3 text-zinc-400 flex-shrink-0" />
                    <span className="text-xs font-mono text-zinc-600 truncate flex-1 min-w-0 group-hover:text-blue-600">
                      {file.path}
                    </span>
                    <span className="flex items-center gap-1.5 text-[10px] flex-shrink-0">
                      {file.additions > 0 && (
                        <span className="text-green-600 flex items-center gap-0.5">
                          <Plus className="h-2.5 w-2.5" />
                          {file.additions}
                        </span>
                      )}
                      {file.deletions > 0 && (
                        <span className="text-red-600 flex items-center gap-0.5">
                          <Minus className="h-2.5 w-2.5" />
                          {file.deletions}
                        </span>
                      )}
                    </span>
                    <Eye className="h-3 w-3 text-zinc-300 group-hover:text-blue-500 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Session Group List (expandable with commit drill-down) ──────────────────

function SessionGroupList({
  groups,
  projectId,
  onEnterDiffView,
}: {
  groups: GitChangeGroup[];
  projectId: string;
  onEnterDiffView: (commit: GitCommit, filePath?: string) => void;
}) {
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  const toggleSession = useCallback((id: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
        <GitBranch className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm font-medium">暂无会话分组数据</p>
        <p className="mt-1.5 text-xs text-zinc-400 max-w-xs text-center">
          当前项目暂无关联的会话记录
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-zinc-200">
      {groups.map((group, idx) => {
        const sessionId = group.id || `session-${idx}`;
        const isExpanded = expandedSessions.has(sessionId);
        return (
          <div key={sessionId}>
            {/* Session header row */}
            <button
              onClick={() => toggleSession(sessionId)}
              className="flex items-center gap-3 px-4 py-3 w-full text-left hover:bg-zinc-50 transition-colors"
            >
              <div className="flex-shrink-0 text-zinc-400">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-800 truncate">
                  {group.name || "(未关联)"}
                </p>
                {group.last_active && (
                  <p className="text-xs text-zinc-500">
                    最近活跃: {formatRelativeTime(group.last_active)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-zinc-500 flex-shrink-0">
                <span className="flex items-center gap-1">
                  <GitCommitIcon className="h-3.5 w-3.5" />
                  {group.commit_count}
                </span>
                <span className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  {group.files_changed}
                </span>
                <span className="flex items-center gap-1 text-green-600">
                  <Plus className="h-3 w-3" />
                  {group.additions}
                </span>
                <span className="flex items-center gap-1 text-red-600">
                  <Minus className="h-3 w-3" />
                  {group.deletions}
                </span>
              </div>
            </button>

            {/* Expanded: commit list for this session */}
            {isExpanded && (
              <SessionCommitList
                projectId={projectId}
                branch={group.branch || undefined}
                since={group.created_at}
                until={group.last_active}
                onViewDiff={onEnterDiffView}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Session Commit List (fetches commits for a session time range) ───────────

function SessionCommitList({
  projectId,
  branch,
  since,
  until,
  onViewDiff,
}: {
  projectId: string;
  branch?: string;
  since?: string;
  until?: string;
  onViewDiff: (commit: GitCommit, filePath?: string) => void;
}) {
  const { data: sessionCommits = [], isLoading } = useGitCommits(projectId, {
    branch: branch || undefined,
    since: since || undefined,
    until: until || undefined,
    limit: 100,
    all_branches: !branch,
  });
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());

  const toggleCommit = useCallback((hash: string) => {
    setExpandedCommits((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 bg-zinc-50/50">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500" />
        <span className="ml-2 text-xs text-zinc-500">加载提交记录...</span>
      </div>
    );
  }

  if (sessionCommits.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-zinc-400 bg-zinc-50/50">
        该时间段内无提交记录
      </div>
    );
  }

  return (
    <div className="bg-zinc-50/50 border-t border-zinc-100">
      {sessionCommits.map((commit) => {
        const isExpanded = expandedCommits.has(commit.hash);
        const fileCount = commit.files?.length ?? 0;

        return (
          <div key={commit.hash} className="border-b border-zinc-100 last:border-b-0">
            {/* Commit row */}
            <button
              onClick={() => toggleCommit(commit.hash)}
              className="flex items-center gap-3 w-full px-6 py-2.5 text-left hover:bg-zinc-100/50 transition-colors"
            >
              <div className="flex-shrink-0 text-zinc-400">
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </div>
              <GitCommitIcon className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
              <code className="text-xs text-blue-600 font-mono flex-shrink-0">
                {commit.hash.slice(0, 7)}
              </code>
              <span className="text-xs text-zinc-700 truncate flex-1 min-w-0">
                {commit.message}
              </span>
              <span className="text-[11px] text-zinc-400 flex-shrink-0">
                {formatRelativeTime(commit.date)}
              </span>
              {fileCount > 0 && (
                <span className="text-[11px] text-zinc-400 flex-shrink-0 flex items-center gap-0.5">
                  <FileText className="h-3 w-3" />
                  {fileCount}
                </span>
              )}
            </button>

            {/* Expanded file list for this commit */}
            {isExpanded && commit.files && commit.files.length > 0 && (
              <div className="pl-14 pr-4 pb-2 space-y-0.5">
                {commit.files.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => onViewDiff(commit, file.path)}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-left rounded hover:bg-zinc-200/50 transition-colors group"
                  >
                    <FileText className="h-3 w-3 text-zinc-400 flex-shrink-0" />
                    <span className="text-xs font-mono text-zinc-600 truncate flex-1 min-w-0 group-hover:text-blue-600">
                      {file.path}
                    </span>
                    <span className="flex items-center gap-1.5 text-[10px] flex-shrink-0">
                      {file.additions > 0 && (
                        <span className="text-green-600 flex items-center gap-0.5">
                          <Plus className="h-2.5 w-2.5" />
                          {file.additions}
                        </span>
                      )}
                      {file.deletions > 0 && (
                        <span className="text-red-600 flex items-center gap-0.5">
                          <Minus className="h-2.5 w-2.5" />
                          {file.deletions}
                        </span>
                      )}
                    </span>
                    <Eye className="h-3 w-3 text-zinc-300 group-hover:text-blue-500 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Uncommitted Section ─────────────────────────────────────────────────────

function UncommittedSection({
  projectId,
  files,
  onViewDiff,
}: {
  projectId: string;
  files: GitUncommittedFile[];
  onViewDiff: (filePath: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [showCommitInput, setShowCommitInput] = useState(false);
  const [commitFiles, setCommitFiles] = useState<string[] | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<string[] | null | undefined>(undefined);

  const commitMutation = useGitCommitMutation(projectId);
  const discardMutation = useGitDiscardMutation(projectId);
  const ignoreMutation = useGitIgnoreMutation(projectId);

  const stagedCount = files.filter((f) => f.staged).length;
  const unstagedCount = files.length - stagedCount;

  const handleCommit = (targetFiles: string[] | null) => {
    setCommitFiles(targetFiles);
    setShowCommitInput(true);
    setCommitMsg("");
  };

  const doCommit = () => {
    if (!commitMsg.trim()) return;
    commitMutation.mutate(
      { files: commitFiles, message: commitMsg.trim() },
      {
        onSuccess: () => {
          setShowCommitInput(false);
          setCommitMsg("");
          setCommitFiles(null);
        },
      },
    );
  };

  const handleDiscard = (targetFiles: string[] | null) => {
    setConfirmDiscard(targetFiles);
  };

  const doDiscard = () => {
    if (confirmDiscard === undefined) return;
    discardMutation.mutate(
      { files: confirmDiscard },
      { onSuccess: () => setConfirmDiscard(undefined) },
    );
  };

  const handleIgnore = (targetFiles: string[]) => {
    ignoreMutation.mutate({ files: targetFiles });
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-amber-100/50 transition-colors"
      >
        <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
        <span className="text-sm font-medium text-amber-800">
          未提交变更
        </span>
        <span className="text-xs text-amber-600">
          {files.length} 个文件
          {stagedCount > 0 && ` (已暂存 ${stagedCount})`}
          {unstagedCount > 0 && ` (未暂存 ${unstagedCount})`}
        </span>
        <div className="ml-auto">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-amber-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-amber-500" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-amber-200">
          {/* File list (flat) */}
          <div className="px-4 py-2 space-y-0">
            {files.map((file) => (
              <div
                key={file.path}
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-amber-100/50 group"
              >
                <FileText className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0" />
                <UncommittedStatusBadge status={file.status} staged={file.staged} />
                <span
                  onClick={() => onViewDiff(file.path)}
                  className="font-mono text-xs text-zinc-700 truncate flex-1 min-w-0 cursor-pointer hover:text-blue-600 hover:underline transition-colors"
                  title={file.path}
                >
                  {file.path}
                </span>
                {/* Per-file action buttons */}
                <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onViewDiff(file.path)}
                    className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-blue-600 hover:bg-blue-50"
                    title="查看 Diff"
                  >
                    <Eye className="h-3 w-3" />
                    Diff
                  </button>
                  <button
                    onClick={() => handleCommit([file.path])}
                    className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-green-600 hover:bg-green-50"
                    title="提交"
                  >
                    <Upload className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => handleDiscard([file.path])}
                    className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50"
                    title="撤销修改"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => handleIgnore([file.path])}
                    className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-100"
                    title="加入 .gitignore"
                  >
                    <Ban className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Batch actions */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-t border-amber-200 bg-amber-50/80">
            <button
              onClick={() => handleCommit(null)}
              disabled={commitMutation.isPending}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              全部提交
            </button>
            <button
              onClick={() => handleDiscard(null)}
              disabled={discardMutation.isPending}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              全部撤销
            </button>
          </div>
        </div>
      )}

      {/* Commit message dialog */}
      {showCommitInput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-5 shadow-xl">
            <h3 className="text-sm font-medium text-zinc-900 mb-3">
              提交变更
            </h3>
            <p className="text-xs text-zinc-500 mb-3">
              {commitFiles ? `提交 ${commitFiles.length} 个文件` : "提交所有变更文件"}
            </p>
            <input
              type="text"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doCommit(); }}
              placeholder="输入 commit message..."
              autoFocus
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setShowCommitInput(false)}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={doCommit}
                disabled={!commitMsg.trim() || commitMutation.isPending}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {commitMutation.isPending ? "提交中..." : "确认提交"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discard confirm dialog */}
      {confirmDiscard !== undefined && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-5 shadow-xl">
            <h3 className="text-sm font-medium text-red-600 mb-2">
              ⚠️ 确认撤销
            </h3>
            <p className="text-xs text-zinc-600 mb-4">
              {Array.isArray(confirmDiscard)
                ? `确定撤销 ${confirmDiscard.length} 个文件的修改？`
                : "确定撤销所有未提交的修改？"}
              <br />
              <span className="text-red-500 font-medium">此操作不可恢复！</span>
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDiscard(undefined)}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={doDiscard}
                disabled={discardMutation.isPending}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {discardMutation.isPending ? "撤销中..." : "确认撤销"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UncommittedStatusBadge({ status, staged }: { status: string; staged: boolean }) {
  const colors: Record<string, string> = {
    modified: "bg-yellow-100 text-yellow-700",
    added: "bg-green-100 text-green-700",
    deleted: "bg-red-100 text-red-700",
    untracked: "bg-blue-100 text-blue-700",
    renamed: "bg-purple-100 text-purple-700",
  };
  const colorClass = colors[status] ?? colors.modified;
  const label = staged ? `S:${status[0].toUpperCase()}` : status[0].toUpperCase();

  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${colorClass}`}>
      {label}
    </span>
  );
}
