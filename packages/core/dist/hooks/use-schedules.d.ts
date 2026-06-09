import type { CreateScheduleInput, UpdateScheduleInput } from "../types/schedule";
export declare function useSchedulesQuery(): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ListSchedulesResponse>, Error>;
export declare function useScheduleQuery(id: string): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").Schedule>, Error>;
export declare function useCreateScheduleMutation(): import("@tanstack/react-query").UseMutationResult<import("..").Schedule, Error, CreateScheduleInput, unknown>;
export declare function useUpdateScheduleMutation(): import("@tanstack/react-query").UseMutationResult<import("..").Schedule, Error, {
    id: string;
    params: UpdateScheduleInput;
}, unknown>;
export declare function useDeleteScheduleMutation(): import("@tanstack/react-query").UseMutationResult<void, Error, string, unknown>;
export declare function useToggleScheduleMutation(): import("@tanstack/react-query").UseMutationResult<import("..").Schedule, Error, string, unknown>;
export declare function useTriggerScheduleMutation(): import("@tanstack/react-query").UseMutationResult<{
    message: string;
}, Error, string, unknown>;
export declare function useScheduleRunsQuery(id: string): import("@tanstack/react-query").UseQueryResult<NoInfer<import("..").ScheduleRun[]>, Error>;
//# sourceMappingURL=use-schedules.d.ts.map