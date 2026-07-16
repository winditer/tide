export { appPath } from "./lib/paths";

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
  continueTask,
  uploadTaskAttachments,
} from "./api/tasks";
export type {
  CreateTaskParams,
  ContinueTaskParams,
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

export { useChat, buildContextPrompt, extractArtifactsFromContent } from "./hooks/use-chat";
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
  ChatArtifact,
  ChatArtifactType,
  ChatAttachment,
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
  useMyWorkItems,
  useProjectProgress,
  useGroupProgress,
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
  getMyWorkItems,
  getProjectProgress,
  getGroupProgress,
} from "./api/dashboard";
export type {
  DashboardStats,
  RecentTask,
  RecentTasksResponse,
  AgentInfo,
  AgentsResponse,
  AgentSkill,
  ProjectInfo,
  ProjectsResponse,
  SessionInfo,
  SessionsResponse,
  GetSessionsParams,
  ActiveProject,
  ActivityEvent,
  TaskStatusDistribution,
  UpcomingSchedule,
  MyWorkItem,
  ProjectProgress,
  ProjectGroupProgress,
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
  duplicateWorkflow,
  setDefaultWorkflow,
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
  useDuplicateWorkflow,
  useSetDefaultWorkflow,
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
  getProjectRoots,
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
  ProjectRootsResponse,
  ArchiveProjectResult,
} from "./api/projects";
export {
  useProject,
  useProjectSessions,
  useProjectChats,
  useProjectTasks,
  useProjectRoots,
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
  WorkItemPlanTask,
  WorkItemTriggerType,
  WorkItemSourceType,
  WorkItemPriority,
  WorkItemStatus,
  WorkItemFlowMode,
  WorkItemAssignment,
  WorkItemContextEntry,
  WorkItemComment,
  MentionItem,
  CommentTaskStatus,
  ProjectSettings,
  WorkItemBoardColumn,
  WorkItemBoard,
  WorkItemArtifact,
  WorkItemAttachment,
  CrossRepoResultItem,
  CrossRepoResultsResponse,
} from "./types/work-item";
export {
  getWorkItems,
  getWorkItem,
  createWorkItem,
  updateWorkItem,
  deleteWorkItem,
  transitionWorkItem,
  getWorkItemTransitions,
  getWorkItemCrossRepoResults,
  getWorkItemBoard,
  moveWorkItem,
  getProjectWorkflow,
  bindProjectWorkflow,
  unbindProjectWorkflow,
  getFreeformStatusList,
  setFreeformStatusList,
  getGlobalFreeformStatus,
  setGlobalFreeformStatus,
  addArtifact,
  removeArtifact,
  uploadWorkItemAttachments,
  deleteWorkItemAttachment,
  aiDecomposeWorkItems,
  batchCreateWorkItems,
  resolveMerge,
  optimizeDescription,
  getWorkItemAssignments,
  assignWorkItem,
  updateWorkItemAssignment,
  getWorkItemContext,
  addWorkItemContext,
  getWorkItemComments,
  createWorkItemComment,
  archiveWorkItem,
  unarchiveWorkItem,
  type WorkItemFilters,
  type AIDecomposedItem,
  type AIDecomposeResponse,
  type BatchCreateWorkItemsPayload,
  type BatchCreateWorkItemsResponse,
  type ResolveMergeParams,
  type ResolveMergeResponse,
  type OptimizeDescriptionParams,
  type OptimizeDescriptionResponse,
  type UploadWorkItemAttachmentsResponse,
  type AssignWorkItemParams,
  type FreeformStatusItem,
} from "./api/work-items";
export {
  useWorkItemBoard,
  useWorkItems,
  useWorkItem,
  useWorkItemTransitions,
  useWorkItemCrossRepoResults,
  useCreateWorkItem,
  useUpdateWorkItem,
  useUpdateWorkItemStatus,
  useDeleteWorkItem,
  useMoveWorkItem,
  useProjectWorkflow,
  useBindProjectWorkflow,
  useUnbindProjectWorkflow,
  useFreeformStatusList,
  useSetFreeformStatusList,
  useGlobalFreeformStatusList,
  useSetGlobalFreeformStatusList,
  useAddArtifact,
  useRemoveArtifact,
  useDeleteWorkItemAttachment,
  useAIDecompose,
  useBatchCreateWorkItems,
  useResolveMerge,
  useOptimizeDescription,
  useWorkItemAssignments,
  useWorkItemContext,
  useAssignWorkItem,
  useUpdateWorkItemAssignment,
  useAddWorkItemContext,
  useWorkItemComments,
  useCreateWorkItemComment,
  useArchiveWorkItem,
  useUnarchiveWorkItem,
} from "./hooks/use-work-items";

// Notifications
export {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "./api/notifications";
export type {
  Notification,
  NotificationType,
  NotificationListResponse,
  UnreadCountResponse,
} from "./api/notifications";
export {
  useNotifications,
  useUnreadCount,
  useMarkNotificationRead,
  useMarkAllRead,
} from "./hooks/use-notifications";

// Versions
export type {
  Version,
  VersionStatus,
  CreateVersionInput,
  UpdateVersionInput,
} from "./api/versions";
export {
  getVersions,
  createVersion,
  updateVersion,
  deleteVersion,
} from "./api/versions";
export {
  useVersions,
  useCreateVersion,
  useUpdateVersion,
  useDeleteVersion,
} from "./hooks/use-versions";

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

// API Tokens
export {
  listApiTokens,
  createApiToken,
  revokeApiToken,
} from "./api/api-tokens";
export type {
  ApiTokenInfo,
  CreateApiTokenResponse,
} from "./api/api-tokens";

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
  listAvailableUsers,
  batchAddProjectMembers,
} from "./api/project-members";
export type {
  ProjectMember,
  BasicUser,
  ListProjectMembersResponse,
  AddMemberInput,
  UpdateMemberInput,
  AvailableUser,
  ListAvailableUsersResponse,
  BatchAddMembersResponse,
} from "./api/project-members";
export {
  useProjectMembers,
  useAddProjectMember,
  useUpdateProjectMember,
  useRemoveProjectMember,
  useAvailableUsers,
  useBatchAddProjectMembers,
} from "./hooks/use-project-members";

// Project groups (cross-repo project grouping)
export {
  listProjectGroups,
  getProjectGroup,
  createProjectGroup,
  updateProjectGroup,
  deleteProjectGroup,
  addGroupMember,
  removeGroupMember,
  getGroupConversations,
  getGroupTasks,
  getGroupVersions,
  getGroupWorkflow,
  setGroupWorkflow,
  deleteGroupWorkflow,
  getGroupBranches,
  getGroupCommits,
  getGroupChanges,
  getGroupCommitDiff,
  createGroupBranch,
  createGroupVersion,
  listGroupAvailableUsers,
} from "./api/project-groups";
export type {
  ProjectGroupSummary,
  ProjectGroupDetail,
  ProjectGroupMember,
  ListProjectGroupsResponse,
  CreateProjectGroupInput,
  UpdateProjectGroupInput,
  AddGroupMemberInput,
  GroupConversationItem,
  GroupTaskItem,
  GroupVersionItem,
  GroupWorkflowBinding,
  PaginatedResponse,
  GroupBranchProject,
  GroupBranchCreateResult,
  GroupVersionCreateResult,
  GroupCommitItem,
  GroupChangeProject,
  GroupAvailableUser,
  ListGroupAvailableUsersResponse,
} from "./api/project-groups";
export {
  useProjectGroups,
  useProjectGroup,
  useCreateProjectGroup,
  useUpdateProjectGroup,
  useDeleteProjectGroup,
  useAddGroupMember,
  useRemoveGroupMember,
  useGroupConversations,
  useGroupTasks,
  useGroupVersions,
  useGroupWorkflow,
  useSetGroupWorkflow,
  useDeleteGroupWorkflow,
  useGroupBranches,
  useCreateGroupBranch,
  useCreateGroupVersion,
  useGroupCommits,
  useGroupChanges,
  useGroupAvailableUsers,
} from "./hooks/use-project-groups";

// Project group user members (与项目成员对称的项目组用户成员)
export {
  listGroupUserMembers,
  addGroupUserMember,
  updateGroupUserMember,
  removeGroupUserMember,
} from "./api/project-group-members";
export type {
  GroupUserMember,
  ListGroupUserMembersResponse,
  AddGroupUserMemberInput,
  UpdateGroupUserMemberInput,
} from "./api/project-group-members";
export {
  useGroupUserMembers,
  useAddGroupUserMember,
  useUpdateGroupUserMember,
  useRemoveGroupUserMember,
} from "./hooks/use-project-group-members";

// Knowledge graph (repo knowledge base, scope = project | group)
export {
  listKnowledgeFiles,
  getKnowledgeFile,
  saveKnowledgeFile,
  deleteKnowledgeFile,
  triggerKnowledgeGenerate,
  getKnowledgeStatus,
  getKnowledgeExportUrl,
  downloadKnowledgeExport,
} from "./api/knowledge";
export type {
  KnowledgeScope,
  KnowledgeGraphType,
  KnowledgeJobStatus,
  KnowledgeFileEntry,
  KnowledgeMeta,
  KnowledgeRepoFiles,
  KnowledgeFilesResponse,
  KnowledgeFileDetail,
  KnowledgeJob,
  KnowledgeJobRepo,
  KnowledgeJobLog,
} from "./api/knowledge";
export {
  useKnowledgeFiles,
  useKnowledgeFile,
  useSaveKnowledgeFile,
  useDeleteKnowledgeFile,
  useTriggerKnowledgeGenerate,
  useKnowledgeStatus,
} from "./hooks/use-knowledge";

// Git audit
export {
  getGitCommits,
  getGitChanges,
  getGitBranches,
  getCommitDiff,
  getGitUncommitted,
  gitCommit,
  gitDiscard,
  gitIgnore,
  createBranch,
  deleteBranch,
  cleanupBranches,
  pushBranch,
  pullBranch,
  createMergeRequest,
  getRemoteBranches,
  localMergeBranches,
  fetchRemoteBranches,
  mergeInteractive,
  commitMerge,
  abortMerge,
} from "./api/git-audit";
export type {
  GitCommit,
  GitCommitFile,
  GitUncommittedFile,
  GitUncommittedResponse,
  GitChangeGroup,
  GitCommitsParams,
  GitChangesParams,
} from "./api/git-audit";
export {
  useGitCommits,
  useGitChanges,
  useGitBranches,
  useCommitDiff,
  useGitUncommitted,
  useGitCommitMutation,
  useGitDiscardMutation,
  useGitIgnoreMutation,
  useCreateBranch,
  useDeleteBranch,
  useCheckoutBranch,
  useCleanupBranches,
  usePushBranch,
  usePullBranch,
  useCreateMergeRequest,
  useRemoteBranches,
  useLocalMerge,
  useFetchRemote,
  useMergeInteractive,
  useCommitMerge,
  useAbortMerge,
} from "./hooks/use-git-audit";

// Files (code editor)
export {
  listDirectory,
  getFileContent,
  saveFileContent,
  getFileDiff,
  getConflictDetail,
  resolveFileConflict,
  aiResolveConflict,
} from "./api/files";
export type {
  FileTreeNode,
  FileTreeResponse,
  SaveFileResponse,
  ConflictDetail,
  ResolveConflictResponse,
  AIResolveConflictParams,
  AIResolveConflictResponse,
} from "./api/files";
export {
  useFileTree,
  useFileContent,
  useSaveFile,
  useFileDiff,
  useConflictDetail,
  useResolveConflict,
  useAIResolveConflict,
} from "./hooks/use-files";
