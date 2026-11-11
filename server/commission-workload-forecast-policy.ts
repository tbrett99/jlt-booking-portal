import {
  addForecastDays,
  forecastMonday,
  forecastUtcDate,
  parseForecastCalendarDate,
  type CommissionForecastBucket,
  type CommissionForecastFile,
  type CommissionForecastInput,
  type CommissionForecastResponse,
} from "../shared/commission-workload-forecast";
import {
  COMMISSION_REVIEW_ELIGIBLE_STAGES,
  isBookingReadyForCommissionReview,
} from "./commission-workflow-utils";

const DAY_MS = 86_400_000;
export const COMMISSION_FORECAST_MAX_DAYS = 730;
export const COMMISSION_FORECAST_MAX_FILES = 50_000;

/** Only this fixed, non-sensitive validation message may be shown to staff. */
export class CommissionForecastValidationError extends Error {
  readonly code = "BAD_REQUEST";

  constructor(message: string) {
    super(message);
    this.name = "CommissionForecastValidationError";
  }
}

export function validateCommissionForecastInput(
  input: unknown
): CommissionForecastInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CommissionForecastValidationError(
      "Choose a valid forecast date range and grouping."
    );
  }
  const { startDate, endDate, groupBy } = input as Record<string, unknown>;
  const start =
    typeof startDate === "string" ? parseForecastCalendarDate(startDate) : null;
  const end =
    typeof endDate === "string" ? parseForecastCalendarDate(endDate) : null;
  if (!start || !end) {
    throw new CommissionForecastValidationError(
      "Start and end dates must be valid YYYY-MM-DD calendar dates."
    );
  }
  if (start.getTime() > end.getTime()) {
    throw new CommissionForecastValidationError(
      "Start date must be on or before end date."
    );
  }
  if (
    (end.getTime() - start.getTime()) / DAY_MS + 1 >
    COMMISSION_FORECAST_MAX_DAYS
  ) {
    throw new CommissionForecastValidationError(
      "Choose a date range of at most 730 days, including both dates."
    );
  }
  if (groupBy !== "week" && groupBy !== "month") {
    throw new CommissionForecastValidationError(
      "Group the forecast by week or month."
    );
  }
  return {
    startDate: startDate as string,
    endDate: endDate as string,
    groupBy,
  };
}

type RawFlag = boolean | number | string | null | undefined;
type RawDate = Date | string | null | undefined;

/** Minimal read model: no commission values, customer emails, or bank details. */
export interface CommissionForecastRow {
  id: number;
  agentId: number;
  clientName?: string | null;
  agentName?: string | null;
  ptsRef?: string | null;
  crmRef?: string | null;
  currentStage: string | null;
  finalSupplierPaymentDate?: RawDate;
  departureDate?: RawDate;
  isPersonalBooking?: RawFlag;
  commissionPreAuthorised?: RawFlag;
  inContract?: RawFlag;
  hasOutstandingRefund?: RawFlag;
  hasOutstandingAmendment?: RawFlag;
  hasOutstandingReimbursement?: RawFlag;
  /** Defensive exclusion for callers with an already-computed claim flag. */
  hasCommissionClaim?: RawFlag;
}

/** MySQL EXISTS may return 0/1 as strings; Boolean("0") is unsafe. */
export function commissionForecastFlag(value: RawFlag): boolean {
  return value === true || (value != null && Number(value) === 1);
}

function readUtcDate(value: RawDate): { date: Date | null; missing: boolean } {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return { date: null, missing: true };
  }
  if (value instanceof Date) {
    return {
      date: Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null,
      missing: false,
    };
  }
  if (typeof value !== "string") return { date: null, missing: false };
  // Reject rollover dates instead of letting JS silently turn 30 February into March.
  if (!parseForecastCalendarDate(value.slice(0, 10)))
    return { date: null, missing: false };
  if (value.length === 10)
    return { date: parseForecastCalendarDate(value), missing: false };
  const timestamp =
    /^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,6})?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(
      value
    );
  if (!timestamp) return { date: null, missing: false };
  // A timezone-less SQL timestamp is explicitly interpreted as UTC, never local time.
  const date = new Date(
    `${timestamp[1]}T${timestamp[2]}:${timestamp[3]}:${timestamp[4]}${timestamp[5] ?? ""}${timestamp[6] ?? "Z"}`
  );
  return {
    date: Number.isFinite(date.getTime()) ? date : null,
    missing: false,
  };
}

function bucketKey(
  date: string,
  groupBy: CommissionForecastInput["groupBy"]
): string {
  return groupBy === "week" ? forecastMonday(date) : date.slice(0, 7);
}

function nextMonth(first: string): string {
  const date = parseForecastCalendarDate(first)!;
  date.setUTCMonth(date.getUTCMonth() + 1);
  return forecastUtcDate(date);
}

function buildBuckets(
  period: CommissionForecastInput
): CommissionForecastBucket[] {
  const buckets: CommissionForecastBucket[] = [];
  let first =
    period.groupBy === "week"
      ? forecastMonday(period.startDate)
      : `${period.startDate.slice(0, 7)}-01`;
  while (first <= period.endDate) {
    const next =
      period.groupBy === "week" ? addForecastDays(first, 7) : nextMonth(first);
    const last = addForecastDays(next, -1);
    const key = period.groupBy === "week" ? first : first.slice(0, 7);
    buckets.push({
      key,
      startDate: first < period.startDate ? period.startDate : first,
      endDate: last > period.endDate ? period.endDate : last,
      label:
        period.groupBy === "week"
          ? `Week of ${first}`
          : parseForecastCalendarDate(first)!.toLocaleDateString("en-GB", {
              timeZone: "UTC",
              month: "long",
              year: "numeric",
            }),
      fileCount: 0,
      preAuthorisedCount: 0,
      attentionCount: 0,
    });
    first = next;
  }
  return buckets;
}

/** Read-only workload, not a claim/payment forecast or a workflow transition. */
export function buildCommissionWorkloadForecast(
  rows: readonly CommissionForecastRow[],
  input: CommissionForecastInput,
  now = new Date()
): CommissionForecastResponse {
  const period = validateCommissionForecastInput(input);
  if (!Number.isFinite(now.getTime()))
    throw new Error("A valid forecast reference date is required.");
  const today = forecastUtcDate(now);
  const buckets = buildBuckets(period);
  const byKey = new Map(buckets.map(bucket => [bucket.key, bucket]));
  const result: CommissionForecastResponse = {
    asOf: now.toISOString(),
    today,
    period,
    buckets,
    upcomingCount: 0,
    dueNowCount: 0,
    unscheduledCount: 0,
    outsideRangeCount: 0,
    files: [],
  };

  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    if (
      !row.currentStage ||
      !COMMISSION_REVIEW_ELIGIBLE_STAGES.has(row.currentStage) ||
      commissionForecastFlag(row.hasCommissionClaim)
    )
      continue;
    const payment = readUtcDate(row.finalSupplierPaymentDate);
    const departure = readUtcDate(row.departureDate);
    const preAuthorised = commissionForecastFlag(row.commissionPreAuthorised);
    let unscheduledReason: CommissionForecastFile["unscheduledReason"] =
      !payment.date
        ? payment.missing
          ? "missing_payment_date"
          : "invalid_payment_date"
        : preAuthorised && !departure.date
          ? departure.missing
            ? "missing_departure_date"
            : "invalid_departure_date"
          : null;
    const paymentDay = payment.date ? forecastUtcDate(payment.date) : null;
    const departureDay = departure.date
      ? forecastUtcDate(departure.date)
      : null;
    let reviewDate: string | null = unscheduledReason ? null : paymentDay;
    if (reviewDate && preAuthorised && departureDay) {
      const departureEligible = addForecastDays(departureDay, 7);
      if (departureEligible > reviewDate) reviewDate = departureEligible;
    }
    const file: CommissionForecastFile = {
      bookingId: row.id,
      agentId: row.agentId,
      clientName: row.clientName ?? null,
      agentName: row.agentName ?? null,
      ptsRef: row.ptsRef ?? null,
      orbitRef: row.crmRef ?? null,
      stage: row.currentStage,
      finalSupplierPaymentDate: paymentDay,
      departureDate: departureDay,
      reviewDate,
      preAuthorised,
      inContract: commissionForecastFlag(row.inContract),
      hasOutstandingRefund: commissionForecastFlag(row.hasOutstandingRefund),
      hasOutstandingAmendment: commissionForecastFlag(
        row.hasOutstandingAmendment
      ),
      hasOutstandingReimbursement: commissionForecastFlag(
        row.hasOutstandingReimbursement
      ),
      unscheduledReason,
      bucketKey: null,
      category: "unscheduled",
    };
    if (unscheduledReason) {
      result.unscheduledCount++;
      result.files.push(file);
      continue;
    }
    // Share the actual queue's readiness gate, including today's dates and pre-authorisation.
    if (
      isBookingReadyForCommissionReview(
        {
          currentStage: row.currentStage,
          finalSupplierPaymentDate: payment.date,
          departureDate: departure.date,
          isPersonalBooking: commissionForecastFlag(row.isPersonalBooking),
          commissionPreAuthorised: preAuthorised,
        },
        now
      )
    ) {
      file.category = "due_now";
      result.dueNowCount++;
      result.files.push(file);
      continue;
    }
    if (
      !reviewDate ||
      reviewDate <= today ||
      reviewDate < period.startDate ||
      reviewDate > period.endDate
    ) {
      result.outsideRangeCount++;
      continue;
    }
    file.category = "upcoming";
    file.bucketKey = bucketKey(reviewDate, period.groupBy);
    const bucket = byKey.get(file.bucketKey)!;
    bucket.fileCount++;
    if (file.preAuthorised) bucket.preAuthorisedCount++;
    if (
      file.inContract ||
      file.hasOutstandingRefund ||
      file.hasOutstandingAmendment ||
      file.hasOutstandingReimbursement
    )
      bucket.attentionCount++;
    result.upcomingCount++;
    result.files.push(file);
  }
  return result;
}
