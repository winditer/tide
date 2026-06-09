import { type ReactNode } from "react";
import type { TaskEvent } from "../types/task";
type WsStatus = "connecting" | "connected" | "disconnected";
interface WsContextValue {
    status: WsStatus;
    lastEvent: TaskEvent | null;
    subscribe: (handler: (event: TaskEvent) => void) => () => void;
}
declare const WsContext: import("react").Context<WsContextValue | null>;
export declare function useWs(): WsContextValue;
export { WsContext };
export declare function WsProvider({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
//# sourceMappingURL=ws-provider.d.ts.map