import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveProject,
  createProject,
  deleteProject,
  getProject,
  getProjectChats,
  getProjectSessions,
  getProjectTasks,
  unarchiveProject,
  type CreateProjectInput,
} from "../api/projects";

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId as string),
    enabled: !!projectId,
  });
}

export function useProjectSessions(
  projectId: string | undefined,
  agentId?: string
) {
  return useQuery({
    queryKey: ["project-sessions", projectId, agentId ?? null],
    queryFn: () => getProjectSessions(projectId as string, agentId),
    enabled: !!projectId,
  });
}

export function useProjectChats(
  projectId: string | undefined,
  agentId?: string
) {
  return useQuery({
    queryKey: ["project-chats", projectId, agentId ?? null],
    queryFn: () => getProjectChats(projectId as string, agentId),
    enabled: !!projectId,
  });
}

export function useProjectTasks(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-tasks", projectId],
    queryFn: () => getProjectTasks(projectId as string),
    enabled: !!projectId,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectInput) => createProject(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => deleteProject(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useArchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => archiveProject(projectId),
    onSuccess: (_, projectId) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
}

export function useUnarchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => unarchiveProject(projectId),
    onSuccess: (_, projectId) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
}
