"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { loader } from "@monaco-editor/react";
import { Maximize2, Minimize2 } from "lucide-react";

interface DiffViewerProps {
  original: string;
  modified: string;
  language?: string;
  renderSideBySide?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export function DiffViewer({ original, modified, language, renderSideBySide: propSideBySide, isFullscreen, onToggleFullscreen }: DiffViewerProps) {
  const [sideBySide, setSideBySide] = useState(propSideBySide ?? false);
  const [internalFullscreen, setInternalFullscreen] = useState(false);

  // If parent controls fullscreen, use its state; otherwise use internal state
  const effectiveFullscreen = onToggleFullscreen ? (isFullscreen ?? false) : internalFullscreen;
  const handleFullscreen = onToggleFullscreen || (() => setInternalFullscreen(!internalFullscreen));
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const originalModelRef = useRef<any>(null);
  const modifiedModelRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const [monacoReady, setMonacoReady] = useState(false);

  // Keep latest content/language in refs so async/layout callbacks always read current values
  const originalRef = useRef(original);
  const modifiedRef = useRef(modified);
  const languageRef = useRef(language);
  originalRef.current = original;
  modifiedRef.current = modified;
  languageRef.current = language;

  // Step 1: Load Monaco (one-time, async)
  useEffect(() => {
    let cancelled = false;
    loader.init().then((monaco) => {
      if (cancelled) return;
      monacoRef.current = monaco;
      setMonacoReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Step 2: Create/recreate DiffEditor when Monaco is ready or sideBySide changes.
  // Uses useLayoutEffect so destroy+recreate happens synchronously before paint → no flash.
  // Models are created once and reused across editor recreations.
  useLayoutEffect(() => {
    const monaco = monacoRef.current;
    const container = containerRef.current;
    if (!monacoReady || !monaco || !container) return;

    // Create text models once (they survive editor widget recreation)
    if (!originalModelRef.current) {
      const lang = languageRef.current || "plaintext";
      originalModelRef.current = monaco.editor.createModel(originalRef.current, lang);
      modifiedModelRef.current = monaco.editor.createModel(modifiedRef.current, lang);
    }

    // Create diff editor widget with the current sideBySide setting
    const diffEditor = monaco.editor.createDiffEditor(container, {
      readOnly: true,
      renderSideBySide: sideBySide,
      // Prevent Monaco from overriding our mode choice when container is narrow
      useInlineViewWhenSpaceIsLimited: false,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      automaticLayout: true,
    });

    diffEditor.setModel({
      original: originalModelRef.current,
      modified: modifiedModelRef.current,
    });

    editorRef.current = diffEditor;

    // Ensure layout is correct after creation
    requestAnimationFrame(() => {
      if (editorRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          editorRef.current.layout({ width: rect.width, height: rect.height });
        }
      }
    });

    // Cleanup: dispose only the editor widget, keep models alive for reuse
    return () => {
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
    };
  }, [monacoReady, sideBySide]);

  // Step 3: Dispose models when component truly unmounts
  useEffect(() => {
    return () => {
      if (originalModelRef.current) {
        originalModelRef.current.dispose();
        originalModelRef.current = null;
      }
      if (modifiedModelRef.current) {
        modifiedModelRef.current.dispose();
        modifiedModelRef.current = null;
      }
    };
  }, []);

  // Step 4: Update model content when props change (editor already exists)
  useEffect(() => {
    if (originalModelRef.current && original !== undefined) {
      originalModelRef.current.setValue(original);
    }
  }, [original]);

  useEffect(() => {
    if (modifiedModelRef.current && modified !== undefined) {
      modifiedModelRef.current.setValue(modified);
    }
  }, [modified]);

  // Step 5: Update language when prop changes
  useEffect(() => {
    const monaco = monacoRef.current;
    if (monaco && originalModelRef.current && language) {
      monaco.editor.setModelLanguage(originalModelRef.current, language);
    }
    if (monaco && modifiedModelRef.current && language) {
      monaco.editor.setModelLanguage(modifiedModelRef.current, language);
    }
  }, [language]);

  // Step 6: Escape key to exit fullscreen (only when self-managed)
  useEffect(() => {
    if (onToggleFullscreen) return; // parent handles Escape
    if (!internalFullscreen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInternalFullscreen(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [internalFullscreen, onToggleFullscreen]);

  // Step 7: Re-layout editor when fullscreen changes
  useEffect(() => {
    if (editorRef.current && containerRef.current) {
      requestAnimationFrame(() => {
        if (editorRef.current && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            editorRef.current.layout({ width: rect.width, height: rect.height });
          }
        }
      });
    }
  }, [effectiveFullscreen]);

  // When parent controls fullscreen, DiffViewer should not apply fixed positioning itself
  const selfFullscreen = !onToggleFullscreen && internalFullscreen;

  return (
    <div className={`flex flex-col ${selfFullscreen ? "fixed inset-0 z-50 bg-white" : "h-full w-full"}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50 shrink-0">
        <span className="text-xs text-gray-500 mr-2">显示模式:</span>
        <button
          type="button"
          onClick={() => setSideBySide(false)}
          className={`px-2.5 py-1 text-xs rounded transition-colors ${
            !sideBySide
              ? "bg-blue-600 text-white"
              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
          }`}
        >
          Inline
        </button>
        <button
          type="button"
          onClick={() => setSideBySide(true)}
          className={`px-2.5 py-1 text-xs rounded transition-colors ${
            sideBySide
              ? "bg-blue-600 text-white"
              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
          }`}
        >
          Side by Side
        </button>
        <div className="ml-auto">
          <button
            type="button"
            onClick={handleFullscreen}
            className="p-1.5 rounded hover:bg-gray-200 text-gray-500 transition-colors"
            title={effectiveFullscreen ? "退出全屏" : "全屏查看"}
          >
            {effectiveFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 w-full" ref={containerRef} />
    </div>
  );
}
