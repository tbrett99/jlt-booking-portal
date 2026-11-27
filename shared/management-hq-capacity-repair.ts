export type HqInitialCapacityRepairStatus =
  | "repaired"
  | "notdue"
  | "busy"
  | "not_repairable"
  | "invalid_settings"
  | "needs_attention";

export interface HqInitialCapacityRepairResult {
  status: HqInitialCapacityRepairStatus;
  checkedAt: string;
  message: string;
  errorCode: string | null;
}

export const HQ_INITIAL_CAPACITY_REPAIR_MESSAGES: Record<
  HqInitialCapacityRepairStatus,
  string
> = {
  repaired:
    "Saved import validated and ready to continue. All saved records and failure history were preserved. No import batch was started. Use Finish first import when ready.",
  notdue:
    "The saved import is not due for repair yet. No records or reporting state were changed.",
  busy: "A reporting request is still running. Let it finish before repairing the saved import. No repair was made.",
  not_repairable:
    "This saved import is not eligible for the one-use capacity repair, or repair has already been used. No reporting state was changed.",
  invalid_settings:
    "Repair requires valid first-import settings, with ordinary report reading still off. No reporting state was changed.",
  needs_attention:
    "The saved import could not be fully validated for repair. No records were reset or discarded. Stop and investigate before another import action.",
};
