"use client";

import { use, useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ChevronRight,
  FileCode,
  PanelLeftClose,
  PanelLeft,
  Save,
  Sun,
  Moon,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useProject, useFileContent, useSaveFile } from "@tide/core";
import {
  FileTree,
  CodeEditor,
  FileTabs,
  type FileTab,
} from "@tide/views/code-editor";

export default function FilesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: project } = useProject(id);
  const cwd = project?.cwd ?? "";

  // File tabs state
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [modifiedFiles, setModifiedFiles] = useState<Record<string, string>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Theme state
  const [editorTheme, setEditorTheme] = useState<"light" | "vs-dark">("light");

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Track pending content for the active file
  const pendingContentRef = useRef<string | null>(null);

  // Load file content
  const { data: fileContent, isLoading: isLoadingContent } = useFileContent(
    id,
    activeFilePath,
  );

  const saveMutation = useSaveFile();

  // Handle file selection from tree
  const handleFileSelect = useCallback(
    (path: string) => {
      setTabs((prev) => {
        if (prev.some((t) => t.path === path)) return prev;
        const name = path.split("/").pop() ?? path;
        return [...prev, { path, name }];
      });
      setActiveFilePath(path);
    },
    [],
  );

  // Handle tab selection
  const handleTabSelect = useCallback((path: string) => {
    setActiveFilePath(path);
  }, []);

  // Handle tab close
  const handleTabClose = useCallback(
    (path: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.path !== path);
        if (path === activeFilePath) {
          setActiveFilePath(next.length > 0 ? next[next.length - 1].path : null);
        }
        return next;
      });
      setModifiedFiles((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
    },
    [activeFilePath],
  );

  // Handle editor content change
  const handleContentChange = useCallback(
    (value: string) => {
      if (!activeFilePath) return;
      pendingContentRef.current = value;
      setModifiedFiles((prev) => ({ ...prev, [activeFilePath]: value }));
      setTabs((prev) =>
        prev.map((t) =>
          t.path === activeFilePath ? { ...t, modified: true } : t,
        ),
      );
    },
    [activeFilePath],
  );

  // Save file
  const handleSave = useCallback(() => {
    if (!activeFilePath || !modifiedFiles[activeFilePath]) return;
    saveMutation.mutate(
      { projectId: id, path: activeFilePath, content: modifiedFiles[activeFilePath] },
      {
        onSuccess: () => {
          setModifiedFiles((prev) => {
            const next = { ...prev };
            delete next[activeFilePath];
            return next;
          });
          setTabs((prev) =>
            prev.map((t) =>
              t.path === activeFilePath ? { ...t, modified: false } : t,
            ),
          );
        },
      },
    );
  }, [activeFilePath, modifiedFiles, saveMutation, id]);

  // Ctrl+S / Cmd+S keyboard shortcut & Escape for fullscreen
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, isFullscreen]);

  // Current display content
  const displayContent =
    (activeFilePath && modifiedFiles[activeFilePath]) ??
    (typeof fileContent === "string" ? fileContent : "") ??
    "";

  // Theme-dependent styles
  const isDark = editorTheme === "vs-dark";
  const containerBg = isDark ? "bg-zinc-950" : "bg-white";
  const toolbarBg = isDark ? "bg-zinc-900/80 border-zinc-800" : "bg-zinc-100 border-zinc-200";
  const toolbarText = isDark ? "text-zinc-400" : "text-zinc-600";
  const toolbarHover = isDark ? "hover:bg-zinc-800 hover:text-zinc-200" : "hover:bg-zinc-200 hover:text-zinc-900";
  const sidebarBg = isDark ? "bg-zinc-900/50 border-zinc-800" : "bg-zinc-50 border-zinc-200";
  const sidebarHeaderText = isDark ? "text-zinc-500" : "text-zinc-500";
  const emptyBg = isDark ? "bg-zinc-900" : "bg-zinc-50";
  const emptyText = isDark ? "text-zinc-500" : "text-zinc-400";

  // Editor area content (shared between normal and fullscreen modes)
  const editorArea = (
    <div className={`flex flex-1 flex-col min-h-0 ${containerBg} rounded-lg border ${isDark ? "border-zinc-800" : "border-zinc-200"} overflow-hidden`}>
      {/* Toolbar */}
      <div className={`flex items-center gap-2 border-b px-3 py-1.5 ${toolbarBg}`}>
        <button
          onClick={() => setSidebarOpen((prev) => !prev)}
          className={`rounded p-1 ${toolbarText} ${toolbarHover} transition-colors`}
          title={sidebarOpen ? "隐藏侧栏" : "显示侧栏"}
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeft className="h-4 w-4" />
          )}
        </button>
        <span className={`text-xs truncate ${isDark ? "text-zinc-500" : "text-zinc-500"}`}>
          {activeFilePath ?? (project?.name ?? "Project Files")}
        </span>
        <div className="flex-1" />

        {/* Save button */}
        {activeFilePath && modifiedFiles[activeFilePath] && (
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            <Save className="h-3.5 w-3.5" />
            {saveMutation.isPending ? "保存中..." : "保存"}
          </button>
        )}

        {/* Theme toggle */}
        <button
          onClick={() => setEditorTheme((prev) => (prev === "light" ? "vs-dark" : "light"))}
          className={`rounded p-1 ${toolbarText} ${toolbarHover} transition-colors`}
          title={isDark ? "切换为亮色主题" : "切换为暗色主题"}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* Fullscreen toggle */}
        <button
          onClick={() => setIsFullscreen((prev) => !prev)}
          className={`rounded p-1 ${toolbarText} ${toolbarHover} transition-colors`}
          title={isFullscreen ? "退出全屏" : "全屏"}
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar - File tree */}
        {sidebarOpen && cwd && (
          <div className={`w-64 shrink-0 overflow-y-auto border-r ${sidebarBg}`}>
            <div className={`border-b px-3 py-2 ${isDark ? "border-zinc-800" : "border-zinc-200"}`}>
              <span className={`text-xs font-medium uppercase tracking-wider ${sidebarHeaderText}`}>
                Files
              </span>
            </div>
            <FileTree
              projectId={id}
              rootPath={cwd}
              onFileSelect={handleFileSelect}
              theme={editorTheme}
            />
          </div>
        )}

        {/* Editor area */}
        <div className="flex flex-1 min-w-0 flex-col">
          {/* Tabs */}
          <FileTabs
            tabs={tabs}
            activeTab={activeFilePath ?? ""}
            onTabSelect={handleTabSelect}
            onTabClose={handleTabClose}
            theme={editorTheme}
          />

          {/* Editor */}
          <div className="flex-1 min-h-0">
            {activeFilePath ? (
              isLoadingContent && !modifiedFiles[activeFilePath] ? (
                <div className={`flex h-full items-center justify-center ${emptyBg} text-xs ${emptyText}`}>
                  Loading file...
                </div>
              ) : (
                <CodeEditor
                  content={displayContent}
                  path={activeFilePath}
                  onChange={handleContentChange}
                  theme={editorTheme}
                />
              )
            ) : (
              <div className={`flex h-full flex-col items-center justify-center ${emptyBg} ${emptyText}`}>
                <span className="text-sm">选择文件以开始编辑</span>
                <span className={`mt-1 text-xs ${isDark ? "text-zinc-600" : "text-zinc-400"}`}>
                  使用左侧文件树浏览文件
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6 p-6 h-[calc(100vh-64px)]">
      {/* Breadcrumb - separated at top like audit page */}
      <nav className="flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
        <Link
          href="/projects"
          className="hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          项目
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link
          href={`/projects/${id}`}
          className="hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          项目详情
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="flex items-center gap-1 text-zinc-900 dark:text-zinc-100 font-medium">
          <FileCode className="h-3.5 w-3.5" />
          文件
        </span>
      </nav>

      {/* Editor content area */}
      {editorArea}

      {/* Fullscreen overlay */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background p-4">
          {editorArea}
        </div>
      )}
    </div>
  );
}
