import { type CreateVersionInput, type UpdateVersionInput } from "../api/versions";
export declare function useVersions(projectId: string | undefined): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").Version[]>, Error>;
export declare function useCreateVersion(): import("@tanstack/react-query").UseMutationResult<import("..").Version, Error, CreateVersionInput, unknown>;
export declare function useUpdateVersion(): import("@tanstack/react-query").UseMutationResult<import("..").Version, Error, {
    id: string;
    data: UpdateVersionInput;
}, unknown>;
export declare function useDeleteVersion(): import("@tanstack/react-query").UseMutationResult<void, Error, string, unknown>;
//# sourceMappingURL=use-versions.d.ts.map