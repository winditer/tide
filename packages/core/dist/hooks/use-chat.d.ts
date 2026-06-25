export type ChatMessageStatus = "pending" | "running" | "completed" | "failed";
export type ChatMessageRole = "user" | "assistant";
export type ChatInteractiveType = "approval" | "info" | "action";
export type ChatInteractiveStatus = "pending" | "approved" | "rejected";
export interface ChatInteractive {
    type: ChatInteractiveType;
    approvalId?: string;
    taskId?: string;
    status?: ChatInteractiveStatus;
}
export interface ChatMessage {
    id: string;
    role: ChatMessageRole;
    content: string;
    /** ISO string for serialization safety; rendered components should parse */
    timestamp: string;
    taskId?: string;
    status?: ChatMessageStatus;
    interactive?: ChatInteractive;
}
export interface UseChatOptions {
    projectId?: string;
    sessionId?: string;
    agentId?: string;
}
export declare function buildContextPrompt(messages: ChatMessage[], newContent: string): string;
export interface SendMessageOverrides {
    projectCwd?: string;
    sessionId?: string;
    agentId?: string;
    groupId?: string;
}
export interface UseChatResult {
    messages: ChatMessage[];
    isSending: boolean;
    hasUnread: boolean;
    markRead: () => void;
    sendMessage: (content: string, overrides?: SendMessageOverrides) => Promise<void>;
    clearHistory: () => void;
    approveTask: (approvalId: string, comment?: string) => Promise<void>;
    rejectTask: (approvalId: string, comment?: string) => Promise<void>;
}
export declare function useChat(options?: UseChatOptions): UseChatResult;
//# sourceMappingURL=use-chat.d.ts.map