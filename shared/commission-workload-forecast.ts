export type CommissionForecastGroup = "week" | "month";

export interface CommissionForecastInput {
  startDate: string;
  endDate: string;
  groupBy: CommissionForecastGroup;
}

export interface CommissionForecastFile {
  bookingId: number;
  clientName: string | null;
  agentId: number;
  agentName: string | null;
  ptsRef: string | null;
  orbitRef: string | null;
  stage: string;
  finalSupplierPaymentDate: string | null;
  departureDate: string | null;
  reviewDate: string | null;
  preAuthorised: boolean;
  inContract: boolean;
  hasOutstandingRefund: boolean;
  hasOutstandingAmendment: boolean;
  hasOutstandingReimbursement: boolean;
  unscheduledReason:
    | "missing_payment_date"
    | "invalid_payment_date"
    | "missing_departure_date"
    | "invalid_departure_date"
    | null;
  bucketKey: string | null;
  category: "due_now" | "upcoming" | "unscheduled";
}

export interface CommissionForecastBucket {
  key: string;
  startDate: string;
  endDate: string;
  label: string;
  fileCount: number;
  preAuthorisedCount: number;
  attentionCount: number;
}

export interface CommissionForecastResponse {
  asOf: string;
  today: string;
  period: CommissionForecastInput;
  buckets: CommissionForecastBucket[];
  upcomingCount: number;
  dueNowCount: number;
  unscheduledCount: number;
  outsideRangeCount: number;
  files: CommissionForecastFile[];
}

export function parseForecastCalendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? date
    : null;
}

export function forecastUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addForecastDays(value: string, days: number): string {
  const date = parseForecastCalendarDate(value);
  if (!date) throw new Error("Invalid calendar date");
  date.setUTCDate(date.getUTCDate() + days);
  return forecastUtcDate(date);
}

export function forecastMonday(value: string): string {
  const date = parseForecastCalendarDate(value);
  if (!date) throw new Error("Invalid calendar date");
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return forecastUtcDate(date);
}

export function defaultCommissionForecastPeriod(
  now = new Date()
): CommissionForecastInput {
  const today = forecastUtcDate(now);
  return {
    startDate: today,
    endDate: addForecastDays(forecastMonday(today), 83),
    groupBy: "week",
  };
}

export function formatForecastCalendarDate(value: string | null): string {
  if (!value) return "—";
  const date = parseForecastCalendarDate(value);
  return date
    ? date.toLocaleDateString("en-GB", {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
}
