import type { ScheduleRun } from "@tide/core";
interface ScheduleRunHistoryProps {
    runs: ScheduleRun[] | {
        items: ScheduleRun[];
    } | null | undefined;
}
export declare function ScheduleRunHistory({ runs }: ScheduleRunHistoryProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=ScheduleRunHistory.d.ts.map