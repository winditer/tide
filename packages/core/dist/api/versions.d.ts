/** 版本状态：active（活跃）/ released（已发布）/ archived（已归档） */
export type VersionStatus = "active" | "released" | "archived";
export interface Version {
    id: string;
    project_id: string;
    name: string;
    description?: string;
    status: VersionStatus | string;
    created_at: string;
    updated_at: string;
}
export interface CreateVersionInput {
    project_id: string;
    name: string;
    description?: string;
    status?: VersionStatus | string;
}
export interface UpdateVersionInput {
    name?: string;
    description?: string;
    status?: VersionStatus | string;
}
export declare function getVersions(projectId?: string): Promise<Version[]>;
export declare function createVersion(data: CreateVersionInput): Promise<Version>;
export declare function updateVersion(id: string, data: UpdateVersionInput): Promise<Version>;
export declare function deleteVersion(id: string): Promise<void>;
//# sourceMappingURL=versions.d.ts.map