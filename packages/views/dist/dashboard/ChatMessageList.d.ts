import type { ChatMessage } from "@tide/core";
interface ChatMessageListProps {
    messages: ChatMessage[];
    emptyHint?: string;
    onApprove?: (approvalId: string, comment?: string) => void;
    onReject?: (approvalId: string, comment?: string) => void;
}
export declare function ChatMessageList({ messages, emptyHint, onApprove, onReject }: ChatMessageListProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ChatMessageList.d.ts.map