interface SidebarProps {
    open: boolean;
    onClose: () => void;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
    /**
     * Whether the user can access /settings (currently admin-only).
     * When false the entry is hidden. Defaults to true to keep behaviour
     * backward compatible for unauthenticated/local-only setups.
     */
    showSettings?: boolean;
}
export declare function Sidebar({ open, onClose, collapsed, onToggleCollapse, showSettings }: SidebarProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Sidebar.d.ts.map