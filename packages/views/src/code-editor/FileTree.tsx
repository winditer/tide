"use client";

import { useState, useCallback } from "react";
import {
  File,
  Folder,
  FolderOpen,
  FileCode,
  FileJson,
  FileText,
  FileImage,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useFileTree, type FileTreeNode } from "@tide/core";

interface FileTreeProps {
  projectId: string;
  onFileSelect: (path: string) => void;
  rootPath: string;
  theme?: "light" | "vs-dark";
}

/** 根据文件扩展名选择图标 */
function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const codeExts = ["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "c", "cpp", "h", "rb", "swift", "kt"];
  const jsonExts = ["json", "jsonc", "yaml", "yml", "toml"];
  const imageExts = ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"];

  if (codeExts.includes(ext)) return <FileCode className="h-4 w-4 text-blue-400" />;
  if (jsonExts.includes(ext)) return <FileJson className="h-4 w-4 text-yellow-400" />;
  if (imageExts.includes(ext)) return <FileImage className="h-4 w-4 text-green-400" />;
  if (ext === "md" || ext === "txt") return <FileText className="h-4 w-4 text-zinc-400" />;
  return <File className="h-4 w-4 text-zinc-400" />;
}

interface TreeNodeProps {
  node: FileTreeNode;
  projectId: string;
  onFileSelect: (path: string) => void;
  level: number;
  theme: "light" | "vs-dark";
}

function TreeNode({ node, projectId, onFileSelect, level, theme }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isDark = theme === "vs-dark";

  // Only fetch children when expanded and node is a directory
  const { data } = useFileTree(
    node.type === "dir" && expanded ? projectId : undefined,
    node.path,
  );

  const children = node.children ?? data?.children;

  const handleClick = useCallback(() => {
    if (node.type === "dir") {
      setExpanded((prev) => !prev);
    } else {
      onFileSelect(node.path);
    }
  }, [node, onFileSelect]);

  const hoverCls = isDark ? "hover:bg-zinc-800/50" : "hover:bg-zinc-200/70";
  const textCls = isDark ? "text-zinc-200" : "text-zinc-800";
  const chevronCls = isDark ? "text-zinc-500" : "text-zinc-400";

  return (
    <div>
      <button
        onClick={handleClick}
        className={`flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left text-sm ${hoverCls} transition-colors`}
        style={{ paddingLeft: `${level * 12 + 4}px` }}
      >
        {node.type === "dir" ? (
          <>
            {expanded ? (
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 ${chevronCls}`} />
            ) : (
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${chevronCls}`} />
            )}
            {expanded ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-amber-400" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-amber-400" />
            )}
          </>
        ) : (
          <>
            <span className="h-3.5 w-3.5 shrink-0" />
            {getFileIcon(node.name)}
          </>
        )}
        <span className={`truncate ${textCls}`}>{node.name}</span>
      </button>

      {node.type === "dir" && expanded && children && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              projectId={projectId}
              onFileSelect={onFileSelect}
              level={level + 1}
              theme={theme}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ projectId, onFileSelect, rootPath, theme = "vs-dark" }: FileTreeProps) {
  const { data, isLoading, error } = useFileTree(projectId, rootPath);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-zinc-500">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-4 text-xs text-red-400">
        Failed to load file tree
      </div>
    );
  }

  if (!data?.children?.length) {
    return (
      <div className="px-3 py-4 text-xs text-zinc-500">
        Empty directory
      </div>
    );
  }

  return (
    <div className="overflow-auto py-1 text-sm">
      {data.children.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          projectId={projectId}
          onFileSelect={onFileSelect}
          level={0}
          theme={theme}
        />
      ))}
    </div>
  );
}
