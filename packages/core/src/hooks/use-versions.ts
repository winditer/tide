import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createVersion,
  deleteVersion,
  getVersions,
  updateVersion,
  type CreateVersionInput,
  type UpdateVersionInput,
} from "../api/versions";

const VERSIONS_KEY = "versions" as const;

export function useVersions(projectId: string | undefined) {
  return useQuery({
    queryKey: [VERSIONS_KEY, "list", projectId ?? null],
    queryFn: () => getVersions(projectId),
    enabled: !!projectId,
  });
}

export function useCreateVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateVersionInput) => createVersion(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [VERSIONS_KEY] });
    },
  });
}

export function useUpdateVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateVersionInput }) =>
      updateVersion(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [VERSIONS_KEY] });
    },
  });
}

export function useDeleteVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteVersion(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [VERSIONS_KEY] });
      // \u5220\u9664\u540e\u5de5\u4f5c\u9879\u7684 version_id \u4f1a\u88ab\u540e\u7aef\u7f6e\u4e3a NULL\uff0c\u540c\u6b65\u8ba9\u5de5\u4f5c\u9879\u5217\u8868/\u770b\u677f\u91cd\u67e5
      qc.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}
