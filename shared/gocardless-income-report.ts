export type IncomeCategory =
  | "joining_fee"
  | "membership"
  | "other"
  | "unclassified";
export type PaidOutIncomeRow = {
  paymentId: string;
  payoutId: string | null;
  paidOutAt: string;
  chargeDate: string | null;
  amountMinor: number | null;
  currency: string | null;
  category: IncomeCategory;
  categoryEvidence: string;
  agentId: number | null;
  agentName: string | null;
  identityStatus: "matched" | "unmatched" | "ambiguous";
  sources: string[];
  sourceEvidence: string;
  description: string | null;
  currentStatus: string | null;
  reviewReason: string | null;
};
export type IncomeCurrencySummary = {
  currency: string;
  joiningCount: number;
  joiningGrossMinor: number;
  membershipCount: number;
  membershipGrossMinor: number;
  otherCount: number;
  otherGrossMinor: number;
  unclassifiedCount: number;
  unclassifiedGrossMinor: number;
  totalCount: number;
  totalGrossMinor: number;
};
export type PaidOutIncomeReport = {
  rangeStart: string;
  rangeEnd: string;
  asOf: string;
  providerEnvironment: "live" | "sandbox";
  source: "gocardless_paid_out_events";
  rows: PaidOutIncomeRow[];
  currencies: IncomeCurrencySummary[];
  referralBreakdown: { source: string; joiningPaymentCount: number }[];
  uniqueMatchedJoiners: number;
  reviewCount: number;
  eventCount: number;
  earliestAvailableDate: string;
  complete: true;
};
export const INCOME_CATEGORY_LABELS: Record<IncomeCategory, string> = {
  joining_fee: "Joining fee",
  membership: "Membership fee",
  other: "Other payment",
  unclassified: "Needs classification",
};
export function londonDate(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function isCalendarDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function addIncomeDays(value: string, days: number): string {
  if (!isCalendarDate(value)) throw new Error("Choose valid calendar dates");
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function incomeMonday(value: string = londonDate()): string {
  const day = new Date(value + "T00:00:00Z").getUTCDay();
  return addIncomeDays(value, day === 0 ? -6 : 1 - day);
}
/** Convert a London calendar midnight to UTC, including BST transitions. */
export function londonMidnight(value: string): Date {
  if (!isCalendarDate(value)) throw new Error("Choose valid calendar dates");
  const utc = new Date(value + "T00:00:00Z");
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(utc)
  );
  return new Date(utc.getTime() - hour * 60 * 60 * 1000);
}
export function incomeHistoryFloor(now = new Date()): string {
  const date = new Date(now);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 18);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return addIncomeDays(londonDate(date), 1);
}
export function validateIncomeRange(
  start: string,
  end: string,
  now = new Date()
) {
  if (!isCalendarDate(start) || !isCalendarDate(end) || end < start)
    throw new Error(
      "Choose a valid date range, with the end on or after the start"
    );
  if (start < incomeHistoryFloor(now))
    throw new Error(
      `GoCardless API events older than 18 months are archived. Choose a start date on or after ${incomeHistoryFloor(now)}; older periods require archived reports from GoCardless.`
    );
  if (start > londonDate(now))
    throw new Error("The report cannot start in the future");
  const from = londonMidnight(start),
    to = londonMidnight(addIncomeDays(end, 1));
  if (to.getTime() - from.getTime() > 367 * 86400000)
    throw new Error(
      "Choose a range of at most one year; retrieve longer history in separate ranges"
    );
  return { from, to };
}
export function incomeMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}
export function incomeCsv(report: PaidOutIncomeReport): string {
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const header = [
    "Payment ID",
    "Payout ID",
    "Paid out at (UTC)",
    "Paid out date (Europe/London)",
    "Category",
    "Gross amount",
    "Currency",
    "Agent ID",
    "Joining-fee payer / member",
    "How they found us",
    "Source evidence",
    "Identity status",
    "Classification evidence",
    "Current payment status",
    "Review reason",
  ];
  return (
    "\uFEFF" +
    [
      header,
      ...report.rows.map(row => [
        row.paymentId,
        row.payoutId,
        row.paidOutAt,
        londonDate(new Date(row.paidOutAt)),
        INCOME_CATEGORY_LABELS[row.category],
        row.amountMinor === null ? "" : (row.amountMinor / 100).toFixed(2),
        row.currency,
        row.agentId,
        row.agentName,
        row.sources.join("; "),
        row.sourceEvidence,
        row.identityStatus,
        row.categoryEvidence,
        row.currentStatus,
        row.reviewReason,
      ]),
    ]
      .map(row => row.map(cell).join(","))
      .join("\r\n") +
    "\r\n"
  );
}
