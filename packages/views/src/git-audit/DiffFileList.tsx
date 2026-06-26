"use client";

import {
  FileText,
  Plus,
  Minus,
  Upload,
  Trash2,
  Ban,
} from "lucide-react";

export interface DiffFileItem {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
  staged?: boolean;
}

interface DiffFileListProps {
  files: DiffFileItem[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  /** Show per-file action buttons (for uncommitted mode) */
  showActions?: boolean;
  onCommitFile?: (path: string) => void;
  onDiscardFile?: (path: string) => void;
  onIgnoreFile?: (path: string) => void;
}

function getStatusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "a" || s === "added") return "text-green-600";
  if (s === "d" || s === "deleted") return "text-red-600";
  if (s === "u" || s === "untracked") return "text-zinc-500";
  // M / modified / renamed
  return "text-yellow-600";
}

function getStatusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === "a" || s === "added") return "A";
  if (s === "d" || s === "deleted") return "D";
  if (s === "u" || s === "untracked") return "U";
  if (s === "r" || s === "renamed") return "R";
  return "M";
}

function getStatusBgColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "a" || s === "added") return "bg-green-100";
  if (s === "d" || s === "deleted") return "bg-red-100";
  if (s === "u" || s === "untracked") return "bg-zinc-100";
  return "bg-yellow-100";
}

export function DiffFileList({
  files,
  selectedFile,
  onSelectFile,
  showActions,
  onCommitFile,
  onDiscardFile,
  onIgnoreFile,
}: DiffFileListProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-200 bg-zinc-50">
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          文件 ({files.length})
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {files.map((file) => {
          const isSelected = file.path === selectedFile;
          const fileName = file.path.split("/").pop() ?? file.path;
          const dirPath = file.path.includes("/")
            ? file.path.slice(0, file.path.lastIndexOf("/"))
            : "";

          return (
            <div
              key={file.path}
              onClick={() => onSelectFile(file.path)}
              className={`
                group flex items-center gap-2 px-3 py-2 cursor-pointer border-l-2 transition-colors
                ${
                  isSelected
                    ? "border-l-blue-500 bg-blue-50"
                    : "border-l-transparent hover:bg-zinc-50"
                }
              `}
            >
              <span
                className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold flex-shrink-0 ${getStatusColor(file.status)} ${getStatusBgColor(file.status)}`}
              >
                {getStatusLabel(file.status)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-zinc-800 truncate">
                  {fileName}
                </p>
                {dirPath && (
                  <p className="text-[10px] text-zinc-400 truncate">
                    {dirPath}
                  </p>
                )}
              </div>
              {(file.additions !== undefined || file.deletions !== undefined) && (
                <span className="flex items-center gap-1 text-[10px] flex-shrink-0">
                  {file.additions !== undefined && file.additions > 0 && (
                    <span className="text-green-600 flex items-center">
                      <Plus className="h-2.5 w-2.5" />
                      {file.additions}
                    </span>
                  )}
                  {file.deletions !== undefined && file.deletions > 0 && (
                    <span className="text-red-600 flex items-center">
                      <Minus className="h-2.5 w-2.5" />
                      {file.deletions}
                    </span>
                  )}
                </span>
              )}
              {showActions && (
                <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {onCommitFile && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onCommitFile(file.path); }}
                      className="rounded p-1 text-green-600 hover:bg-green-50"
                      title="提交"
                    >
                      <Upload className="h-3 w-3" />
                    </button>
                  )}
                  {onDiscardFile && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDiscardFile(file.path); }}
                      className="rounded p-1 text-red-600 hover:bg-red-50"
                      title="撤销修改"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                  {onIgnoreFile && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onIgnoreFile(file.path); }}
                      className="rounded p-1 text-zinc-600 hover:bg-zinc-100"
                      title="加入 .gitignore"
                    >
                      <Ban className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {files.length === 0 && (
        <div className="flex items-center justify-center py-8 text-zinc-400">
          <FileText className="h-5 w-5 mr-2 opacity-50" />
          <span className="text-xs">无文件</span>
        </div>
      )}
    </div>
  );
}
