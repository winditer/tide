export type { Task, TaskStatus, TaskEvent } from "./types/task";
export { TaskStatusEnum } from "./types/task";

export type {
  Schedule,
  ScheduleRun,
  CreateScheduleInput,
  UpdateScheduleInput,
  TriggerType,
  ScheduleTaskType,
} from "./types/schedule";
export type {
  KanbanColumn,
  KanbanCard,
  KanbanBoard,
  AgentSwimlane,
  MoveCardInput,
} from "./types/kanban";

export { apiClient, ApiError, installAuthBridge, API_BASE_URL } from "./api/client";
export {
  createTask,
  listTasks,
  getTask,
  stopTask,
  approveTask,
  rejectTask,
  retryTask,
  uploadTaskAttachments,
} from "./api/tasks";
export type {
  CreateTaskParams,
  ListTasksParams,
  ListTasksResponse,
  ApprovalAction,
  UploadAttachmentsResponse,
} from "./api/tasks";

export {
  useTasksQuery,
  useTaskQuery,
  useCreateTaskMutation,
  useStopTaskMutation,
  useApproveTaskMutation,
  useRejectTaskMutation,
  useRetryTaskMutation,
} from "./hooks/use-tasks";

export { useChat, buildContextPrompt } from "./hooks/use-chat";
export type {
  ChatMessage,
  ChatMessageRole,
  ChatMessageStatus,
  ChatInteractiveType,
  ChatInteractiveStatus,
  ChatInteractive,
  UseChatOptions,
  UseChatResult,
  SendMessageOverrides,
} from "./hooks/use-chat";

export {
  useDashboardStats,
  useRecentTasks,
  useAgents,
  useProjects,
  useSessions,
  useActiveProjects,
  useActivityTimeline,
  useTaskStatusDistribution,
  useUpcomingSchedules,
} from "./hooks/use-dashboard";

export {
  getDashboardStats,
  getRecentTasks,
  getAgents,
  getProjects,
  getSessions,
  fetchActiveProjects,
  fetchActivityTimeline,
  fetchTaskStatusDistribution,
  fetchUpcomingSchedules,
} from "./api/dashboard";
export type {
  DashboardStats,
  RecentTask,
  RecentTasksResponse,
  AgentInfo,
  AgentsResponse,
  ProjectInfo,
  ProjectsResponse,
  SessionInfo,
  SessionsResponse,
  GetSessionsParams,
  ActiveProject,
  ActivityEvent,
  TaskStatusDistribution,
  UpcomingSchedule,
} from "./api/dashboard";

export {
  fetchProjectBoard,
  fetchSessionBoard,
  fetchAgentBoard,
  fetchWorkflowBoard,
  moveCard,
} from "./api/kanban";
export type { KanbanQueryParams } from "./api/kanban";

export {
  useProjectBoard,
  useSessionBoard,
  useAgentBoard,
  useWorkflowBoard,
  useMoveCard,
} from "./hooks/use-kanban";

export {
  fetchSchedules,
  fetchSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  toggleSchedule,
  triggerSchedule,
  fetchScheduleRuns,
} from "./api/schedules";
export type { ListSchedulesResponse } from "./api/schedules";

export {
  useSchedulesQuery,
  useScheduleQuery,
  useCreateScheduleMutation,
  useUpdateScheduleMutation,
  useDeleteScheduleMutation,
  useToggleScheduleMutation,
  useTriggerScheduleMutation,
  useScheduleRunsQuery,
} from "./hooks/use-schedules";

// Plan
export type {
  Plan,
  PlanTaskDef,
  PlanDefinition,
  PlanTaskStatus,
  PlanDAGNode,
  PlanDAGEdge,
  PlanDAGResponse,
  PlanDAGNodeData,
  PlanTask,
  GanttItem,
} from "./types/plan";

export {
  getPlans,
  getPlan,
  getPlanDAG,
  getPlanTasks,
  getPlanTimeline,
  createPlan,
  stopPlan,
  retryPlanTask,
} from "./api/plans";
export type { ListPlansParams, CreatePlanParams } from "./api/plans";

export {
  usePlans,
  usePlan,
  usePlanDAG,
  usePlanTasks,
  usePlanTimeline,
  useCreatePlan,
  useStopPlan,
  useRetryPlanTask,
} from "./hooks/use-plans";

// Workflow
export type {
  WorkflowNodeType,
  WorkflowNodeData,
  WorkflowNode,
  WorkflowEdge,
  WorkflowDefinition,
  Workflow,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowNodeRun,
  WorkflowNodeRunStatus,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  RunWorkflowInput,
} from "./types/workflow";

export {
  fetchWorkflows,
  fetchWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  toggleWorkflow,
  runWorkflow,
  fetchWorkflowRuns,
  fetchWorkflowRun,
  cancelRun,
  approveNode,
  rejectNode,
} from "./api/workflows";
export type {
  ListWorkflowsResponse,
  ListWorkflowRunsResponse,
} from "./api/workflows";

export {
  useWorkflows,
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
  useDeleteWorkflow,
  useToggleWorkflow,
  useRunWorkflow,
  useWorkflowRuns,
  useWorkflowRun,
  useCancelRun,
  useApproveNode,
  useRejectNode,
} from "./hooks/use-workflows";

export { QueryProvider } from "./providers/query-provider";
export { WsProvider, useWs, WsContext } from "./providers/ws-provider";

// Sessions
export {
  listSessions,
  listChats,
  getSession,
  createSession,
  fetchSessionsForProject,
  archiveSession,
  unarchiveSession,
} from "./api/sessions";
export type {
  ListSessionsParams,
  ListChatsParams,
  SessionType,
  SessionMessage,
  SessionRelatedTask,
  SessionDetail,
  CreateSessionInput,
  CreateSessionResult,
  SessionItem,
  SessionsForProjectResponse,
  ArchiveSessionResult,
} from "./api/sessions";
export {
  useSessionsQuery,
  useChatsQuery,
  useSessionQuery,
  useCreateSessionMutation,
  useArchiveSessionMutation,
  useUnarchiveSessionMutation,
} from "./hooks/use-sessions";

// Projects (detail / sessions / register)
export {
  getProject,
  getProjectSessions,
  getProjectChats,
  getProjectTasks,
  createProject,
  deleteProject,
  archiveProject,
  unarchiveProject,
  encodeProjectId,
} from "./api/projects";
export type {
  ProjectDetail,
  ProjectSession,
  ProjectSessionsResponse,
  ProjectChatsResponse,
  ProjectTaskSummary,
  ProjectTasksResponse,
  CreateProjectInput,
  ArchiveProjectResult,
} from "./api/projects";
export {
  useProject,
  useProjectSessions,
  useProjectChats,
  useProjectTasks,
  useCreateProject,
  useDeleteProject,
  useArchiveProject,
  useUnarchiveProject,
} from "./hooks/use-projects";

// Work items
export type {
  WorkItem,
  WorkItemCreate,
  WorkItemUpdate,
  WorkItemTransition,
  WorkItemTriggerType,
  WorkItemSourceType,
  WorkItemPriority,
  ProjectSettings,
  WorkItemBoardColumn,
  WorkItemBoard,
} from "./types/work-item";
export {
  getWorkItems,
  getWorkItem,
  createWorkItem,
  updateWorkItem,
  deleteWorkItem,
  transitionWorkItem,
  getWorkItemTransitions,
  getWorkItemBoard,
  moveWorkItem,
  getProjectWorkflow,
  bindProjectWorkflow,
  unbindProjectWorkflow,
} from "./api/work-items";
export {
  useWorkItemBoard,
  useWorkItems,
  useWorkItem,
  useWorkItemTransitions,
  useCreateWorkItem,
  useUpdateWorkItem,
  useDeleteWorkItem,
  useMoveWorkItem,
  useProjectWorkflow,
  useBindProjectWorkflow,
  useUnbindProjectWorkflow,
} from "./hooks/use-work-items";

// Approvals
export {
  fetchApprovals,
  getApproval,
  approveApproval,
  rejectApproval,
  parseApprovalDetail,
} from "./api/approvals";
export type {
  Approval,
  ListApprovalsParams,
  ListApprovalsResponse,
  ApprovalActionResponse,
} from "./api/approvals";
export {
  useApprovals,
  useApproval,
  useApproveApproval,
  useRejectApproval,
} from "./hooks/use-approvals";

// Auth
export {
  useAuthStore,
  TIDE_AUTH_STORAGE_KEY,
  getAccessToken,
  getRefreshToken,
  setAuthTokens,
  clearAuthTokens,
} from "./stores/auth-store";
export type { AuthUser, AuthState } from "./stores/auth-store";
export {
  login,
  logout,
  refreshToken,
  getMe,
  getLarkAuthorizeUrl,
  changePassword,
} from "./api/auth";
export type {
  LoginResponse,
  RefreshResponse,
  ChangePasswordPayload,
} from "./api/auth";
export { useAuth, isAuthRequired } from "./hooks/useAuth";
export type { UseAuthResult } from "./hooks/useAuth";

// Admin (user management)
export {
  listUsers,
  getAdminUser,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  resetUserPassword,
  getUserProjects,
} from "./api/admin";
export type {
  AdminUser,
  ListUsersParams,
  ListUsersResponse,
  CreateUserInput,
  UpdateUserInput,
  UserProjectAssignment,
  ListUserProjectsResponse,
} from "./api/admin";
export {
  useAdminUsers,
  useAdminUser,
  useCreateAdminUser,
  useUpdateAdminUser,
  useDeleteAdminUser,
  useResetUserPassword,
  useUserProjects,
} from "./hooks/use-admin-users";

// Project members
export {
  listProjectMembers,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
} from "./api/project-members";
export type {
  ProjectMember,
  ListProjectMembersResponse,
  AddMemberInput,
  UpdateMemberInput,
} from "./api/project-members";
export {
  useProjectMembers,
  useAddProjectMember,
  useUpdateProjectMember,
  useRemoveProjectMember,
} from "./hooks/use-project-members";
