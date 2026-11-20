export const STAFF_WORK_DOMAINS = ["amendment", "flight", "reimbursement"] as const;
export type StaffWorkDomain = (typeof STAFF_WORK_DOMAINS)[number];
export const STAFF_WORK_METRICS = ["received", "completed", "reprocessed", "paid", "rejected", "touched", "outstanding", "waiting"] as const;
export type StaffWorkMetric = (typeof STAFF_WORK_METRICS)[number];
export interface StaffWorkRange {
  /** ISO calendar dates; rangeEnd is exclusive. All boundaries are Europe/London. */
  rangeStart: string;
  rangeEnd: string;
}
export interface StaffWorkSummary {
  domain: StaffWorkDomain;
  received: number;
  completed: number;
  reprocessed: number;
  paid: number;
  rejected: number;
  touched: number;
  outstanding: number;
  waiting: number;
  unassigned: number | null;
  urgent: number;
  overdueFollowUps: number;
  oldestDays: number | null;
  medianTurnaroundHours: number | null;
  turnaroundSampleCount: number;
}
export interface StaffWorkDay {
  date: string;
  received: number;
  completed: number;
  reprocessed: number;
}
export interface StaffWorkStaffRow {
  actorId: number | null;
  actorName: string;
  amendmentsCompleted: number;
  flightsCompleted: number;
  reimbursementsProcessed: number;
  reprocessed: number;
  touched: number;
  recordedPaid: number;
}
export interface StaffWorkCoverage {
  domain: StaffWorkDomain;
  earliestRecordedAction: string | null;
  unknownCompletionDate: number;
  unknownCompletionActor: number;
  warnings: string[];
}
export interface StaffWorkloadReport extends StaffWorkRange {
  timezone: "Europe/London";
  asOf: string;
  summaries: StaffWorkSummary[];
  daily: StaffWorkDay[];
  staff: StaffWorkStaffRow[];
  coverage: StaffWorkCoverage[];
  historyTrackingReady: boolean;
  warnings: string[];
}
export interface StaffWorkloadDrillInput extends StaffWorkRange {
  domain: StaffWorkDomain;
  metric: StaffWorkMetric;
  /** undefined = all staff; null = attribution unknown. */
  actorId?: number | null;
  page?: number;
  pageSize?: number;
}
export interface StaffWorkloadDetail {
  requestId: number;
  bookingId: number | null;
  domain: StaffWorkDomain;
  title: string;
  clientName: string | null;
  reference: string | null;
  receivedAt: string | null;
  actionAt: string | null;
  actorId: number | null;
  actorName: string;
  currentStatus: string;
  evidence: "recorded_history" | "legacy_record";
  eventLabel: string;
  isDeleted: boolean;
}
export interface StaffWorkloadDetails {
  rows: StaffWorkloadDetail[];
  total: number;
  page: number;
  pageSize: number;
  asOf: string;
  warnings: string[];
}
