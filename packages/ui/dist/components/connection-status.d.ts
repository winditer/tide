type WsStatus = "connecting" | "connected" | "disconnected";
export interface ConnectionStatusProps {
    status: WsStatus;
    className?: string;
}
export declare function ConnectionStatus({ status, className }: ConnectionStatusProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=connection-status.d.ts.map