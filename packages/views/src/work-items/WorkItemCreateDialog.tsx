"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { Button, Input, Select, type SelectOptionGroup } from "@tide/ui";
import {
  useCreateWorkItem,
  useVersions,
  useProjectMembers,
  useProjects,
  useProjectGroups,
  useProjectGroup,
  uploadWorkItemAttachments,
} from "@tide/core";
import { AIOptimizeButton } from "./AIOptimizeButton";
import { ImagePlus, X } from "lucide-react";

interface WorkItemCreateDialogProps {
  /**
   * 调用方传入的默认项目 id（项目组模式下可能被该组 primary 项目覆盖）。
   * 当 ``initialScopeValue`` 为 ``project:<id>`` 时与 id 应一致。
   */
  projectId: string;
  /**
   * 默认归属，与列表页筛选器同构。
   *
   * - ``"project:<id>"`` -> 默认选中具体项目
   * - ``"group:<id>"``   -> 默认选中具体项目组
   * - ``""`` / 缺省      -> 使用 ``projectId`` 作为单仓库默认
   */
  initialScopeValue?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const PRIORITY_OPTIONS = [
  { value: "0", label: "无优先级" },
  { value: "1", label: "低" },
  { value: "2", label: "中" },
  { value: "3", label: "高" },
  { value: "4", label: "紧急" },
];

const SCOPE_PROJECT_PREFIX = "project:";
const SCOPE_GROUP_PREFIX = "group:";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const MAX_WI_IMAGES = 10;
const MAX_WI_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_RE.test(file.name);
}

function genAttachmentId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 把传入的初始 scope 与 projectId 归一化为统一 selectValue。 */
function buildInitialScopeValue(
  initial: string | undefined,
  projectId: string,
): string {
  if (initial && initial.startsWith(SCOPE_GROUP_PREFIX)) return initial;
  if (initial && initial.startsWith(SCOPE_PROJECT_PREFIX)) return initial;
  if (projectId) return `${SCOPE_PROJECT_PREFIX}${projectId}`;
  return "";
}

export function WorkItemCreateDialog({
  projectId,
  initialScopeValue,
  onClose,
  onSuccess,
}: WorkItemCreateDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("0");
  const [assignee, setAssignee] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [versionId, setVersionId] = useState("");
  /**
   * 归属选择：与列表页统一编码。
   * - ``"project:<id>"`` -> 单仓库（创建时 project_id=<id>，group_id=null）
   * - ``"group:<id>"``   -> 项目组（project_id=组 primary，group_id=<id>）
   */
  const [scopeValue, setScopeValue] = useState<string>(() =>
    buildInitialScopeValue(initialScopeValue, projectId),
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const createMutation = useCreateWorkItem();
  const { data: projectsData } = useProjects();
  const { data: groupsData } = useProjectGroups();
  const projects = projectsData?.projects ?? [];
  const groups = groupsData?.groups ?? [];

  const selectedGroupId = scopeValue.startsWith(SCOPE_GROUP_PREFIX)
    ? scopeValue.slice(SCOPE_GROUP_PREFIX.length)
    : undefined;
  const selectedProjectId = scopeValue.startsWith(SCOPE_PROJECT_PREFIX)
    ? scopeValue.slice(SCOPE_PROJECT_PREFIX.length)
    : undefined;

  const { data: groupDetail } = useProjectGroup(selectedGroupId);

  // 项目组模式下使用 primary 项目作为 project_id、拉取成员与版本；
  // 项目模式下使用所选项目 id；fallback 至 props.projectId 以兼容旧调用方。
  const primaryProjectId = useMemo(() => {
    if (!groupDetail) return undefined;
    const primary = groupDetail.members.find((m) => m.role === "primary");
    return primary?.project_id ?? groupDetail.members[0]?.project_id;
  }, [groupDetail]);

  const effectiveProjectId = selectedGroupId
    ? (primaryProjectId ?? projectId)
    : (selectedProjectId ?? projectId);

  const { data: versions = [] } = useVersions(effectiveProjectId);
  const { data: membersData } = useProjectMembers(effectiveProjectId);

  // 归属变更时重置下拉选择，避免跨项目残留选项
  useEffect(() => {
    setVersionId("");
    setAssignee("");
  }, [scopeValue]);

  // 归属下拉：项目分组 + 项目组分组
  const scopeFlatOptions = useMemo(() => {
    // 当 props.projectId 不在项目列表中时（例如调用方传入了非法 id 或项目列表尚未加载完成），
    // 提供一个隐藏 fallback 选项保证 <select> 受控值能匹配。
    const inProjects = projects.some((p) => p.id === projectId);
    if (!projectId || inProjects) return [] as { value: string; label: string }[];
    return [
      {
        value: `${SCOPE_PROJECT_PREFIX}${projectId}`,
        label: "当前项目",
      },
    ];
  }, [projects, projectId]);

  const scopeGroups = useMemo<SelectOptionGroup[]>(() => {
    const res: SelectOptionGroup[] = [];
    if (projects.length > 0) {
      res.push({
        label: "项目",
        options: projects.map((p) => ({
          value: `${SCOPE_PROJECT_PREFIX}${p.id}`,
          label: p.name,
        })),
      });
    }
    if (groups.length > 0) {
      res.push({
        label: "项目组",
        options: groups.map((g) => ({
          value: `${SCOPE_GROUP_PREFIX}${g.id}`,
          label: `${g.name} (${g.member_count})`,
        })),
      });
    }
    return res;
  }, [projects, groups]);

  const assigneeOptions = useMemo(() => {
    const opts = [{ value: "", label: "未指定" }];
    for (const m of membersData?.members ?? []) {
      const name = m.display_name || m.username;
      opts.push({ value: name, label: name });
    }
    return opts;
  }, [membersData]);

  const addPendingFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return;
      const incoming = Array.from(files).filter(isImageFile);
      if (!incoming.length) {
        setImageError("仅支持图片文件");
        return;
      }
      const oversized = incoming.find((f) => f.size > MAX_WI_IMAGE_SIZE);
      if (oversized) {
        setImageError(`图片 ${oversized.name} 超过 10MB 上限`);
        return;
      }
      if (pendingAttachments.length + incoming.length > MAX_WI_IMAGES) {
        setImageError(`最多上传 ${MAX_WI_IMAGES} 张图片`);
        return;
      }
      setImageError(null);
      const newItems: PendingAttachment[] = incoming.map((file) => ({
        id: genAttachmentId(),
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      setPendingAttachments((prev) => [...prev, ...newItems]);
    },
    [pendingAttachments.length],
  );

  const removePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const handleImagePick = (e: ChangeEvent<HTMLInputElement>) => {
    addPendingFiles(e.target.files);
    e.target.value = "";
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    addPendingFiles(e.dataTransfer.files);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement | HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      const images = Array.from(files).filter(isImageFile);
      if (images.length > 0) {
        e.preventDefault();
        addPendingFiles(files);
      }
    }
  };

  // 组件卸载时清理未使用的 object URL
  useEffect(() => {
    return () => {
      pendingAttachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const versionOptions = useMemo(() => {
    const opts = [{ value: "", label: "不关联版本" }];
    for (const v of versions) {
      const suffix =
        v.status === "released"
          ? " · 已发布"
          : v.status === "archived"
            ? " · 已归档"
            : "";
      opts.push({ value: v.id, label: `${v.name}${suffix}` });
    }
    return opts;
  }, [versions]);

  const handleSubmit = async () => {
    setError(null);
    setImageError(null);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("标题不能为空");
      return;
    }
    if (selectedGroupId && !primaryProjectId) {
      setError("项目组成员为空，请先为该组添加项目");
      return;
    }
    if (!effectiveProjectId) {
      setError("请先选择项目或项目组");
      return;
    }

    try {
      const item = await createMutation.mutateAsync({
        project_id: effectiveProjectId,
        title: trimmedTitle,
        description: description.trim() || undefined,
        priority: Number(priority),
        assignee: assignee.trim() || undefined,
        tags: tagsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        version_id: versionId || null,
        group_id: selectedGroupId ?? null,
      });

      if (pendingAttachments.length > 0 && item?.id) {
        setIsUploadingImages(true);
        try {
          await uploadWorkItemAttachments(
            item.id,
            pendingAttachments.map((a) => a.file),
          );
          pendingAttachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
          setPendingAttachments([]);
        } catch (e) {
          setImageError(e instanceof Error ? e.message : "图片上传失败");
          setIsUploadingImages(false);
          // 工作项已创建，仍触发 onSuccess 但保留弹窗让用户看到错误
          onSuccess?.();
          return;
        } finally {
          setIsUploadingImages(false);
        }
      }

      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in-0"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border/50 bg-card shadow-2xl animate-in zoom-in-95 fade-in-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              新建工作项
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              在所选项目或项目组中创建一个新的工作项
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <Field label="归属" required>
            <Select
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
              options={scopeFlatOptions}
              groups={scopeGroups}
              className="h-10 rounded-lg border-0 bg-muted/50 focus:ring-2 focus:ring-ring"
              aria-label="选择项目或项目组"
            />
            {selectedGroupId && groupDetail && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                将在 primary 项目{" "}
                <span className="font-mono text-foreground">
                  {groupDetail.members.find((m) => m.role === "primary")
                    ?.name ??
                    groupDetail.members[0]?.name ??
                    "—"}
                </span>{" "}
                中创建，后端会为 Agent 节点注入跨仓库上下文。
              </p>
            )}
          </Field>

          <Field label="标题" required>
            <Input
              autoFocus
              placeholder="输入工作项标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-10 rounded-lg border-0 bg-muted/50 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
            />
          </Field>

          <Field label="描述">
            <div className="relative">
              <textarea
                placeholder="可选的详细描述（可粘贴图片）"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onPaste={handlePaste}
                rows={3}
                className="w-full rounded-lg border-0 bg-muted/50 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <AIOptimizeButton
                description={description}
                onOptimized={setDescription}
                disabled={!description.trim()}
                inline
              />
            </div>

            {/* 图片附件上传紧靠描述区域 */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImagePick}
            />
            <div
              tabIndex={0}
              role="button"
              aria-label="图片上传区域，支持点击、拖拽或粘贴"
              onClick={() => imageInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onPaste={handlePaste}
              className={
                "mt-2 cursor-pointer rounded-lg border border-dashed p-3 text-center transition-colors focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/30 " +
                (dragActive
                  ? "border-primary bg-primary/5"
                  : "border-border/60 bg-muted/30 hover:bg-muted/50")
              }
            >
              <ImagePlus className="mx-auto h-4 w-4 text-muted-foreground" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                点击、拖拽或粘贴上传图片，最多 {MAX_WI_IMAGES} 张，单张 ≤10MB
              </p>
            </div>

            {pendingAttachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {pendingAttachments.map((att) => (
                  <div
                    key={att.id}
                    className="group relative h-8 w-8 overflow-hidden rounded border border-border/50 bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={att.previewUrl}
                      alt={att.file.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePendingAttachment(att.id)}
                      className="absolute right-0 top-0 flex h-3 w-3 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="移除"
                    >
                      <X className="h-2 w-2" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {imageError && (
              <p className="mt-2 text-xs text-destructive">{imageError}</p>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="优先级">
              <Select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="h-10 rounded-lg border-0 bg-muted/50 focus:ring-2 focus:ring-ring"
                options={PRIORITY_OPTIONS}
              />
            </Field>

            <Field label="负责人">
              <Select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                options={assigneeOptions}
                className="h-10 rounded-lg border-0 bg-muted/50 focus:ring-2 focus:ring-ring"
              />
            </Field>
          </div>

          <Field label="标签（逗号分隔）">
            <Input
              placeholder="bug, feature, urgent"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              className="h-10 rounded-lg border-0 bg-muted/50 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
            />
          </Field>

          <Field label="版本（可选）">
            <Select
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
              options={versionOptions}
              className="h-10 rounded-lg border-0 bg-muted/50 focus:ring-2 focus:ring-ring"
            />
          </Field>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border/60 bg-muted/20 px-6 py-3">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={createMutation.isPending || isUploadingImages}
            onClick={handleSubmit}
          >
            {createMutation.isPending || isUploadingImages
              ? "创建中…"
              : "创建工作项"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}
