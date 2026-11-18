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
export type IncomeVatBreakdown = {
  grossMinor: number;
  vatMinor: number;
  excludingVatMinor: number;
};
/** Management estimate only: assumes the entire verified gross contains VAT at 20%.
 * Round VAT per payment to the nearest minor unit, halves up; net is the remainder.
 * BigInt avoids intermediate overflow and floating-point errors. No tax eligibility
 * is inferred from the payment's category, payer, currency or current status.
 */
export function incomeVatBreakdown(
  grossMinor: number | null,
  currency: string | null
): IncomeVatBreakdown | null {
  if (grossMinor === null || !Number.isSafeInteger(grossMinor) || grossMinor < 0 ||
      !currency || !/^[A-Z]{3}$/.test(currency)) return null;
  const vatMinor = Number((BigInt(grossMinor) + BigInt(3)) / BigInt(6));
  return { grossMinor, vatMinor, excludingVatMinor: grossMinor - vatMinor };
}
/** Sum the same rounded payment figures used in the table and CSV, independently
 * per currency. Unknown/conflicting amounts remain unavailable, never zeroed.
 */
export function incomeVatSummary(rows: PaidOutIncomeRow[], currency: string) {
  const zero = (): IncomeVatBreakdown => ({ grossMinor: 0, vatMinor: 0, excludingVatMinor: 0 });
  const result = { joining: zero(), membership: zero(), other: zero(), unclassified: zero(), total: zero() };
  for (const row of rows) {
    if (row.currency !== currency) continue;
    const amount = incomeVatBreakdown(row.amountMinor, row.currency);
    if (!amount) continue;
    const category = row.category === "joining_fee" ? "joining" : row.category;
    for (const bucket of [result[category], result.total]) {
      bucket.grossMinor += amount.grossMinor;
      bucket.vatMinor += amount.vatMinor;
      bucket.excludingVatMinor += amount.excludingVatMinor;
      if (!Number.isSafeInteger(bucket.grossMinor)) {
        throw new Error("Income VAT estimate exceeds the supported exact arithmetic range");
      }
    }
  }
  return result;
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
    "VAT amount (20% estimate)",
    "Income excluding VAT (20% estimate)",
    "VAT estimate basis",
  ];
  return (
    "\uFEFF" +
    [
      header,
      ...report.rows.map(row => {
        const vat = incomeVatBreakdown(row.amountMinor, row.currency);
        return [
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
        vat ? (vat.vatMinor / 100).toFixed(2) : "",
        vat ? (vat.excludingVatMinor / 100).toFixed(2) : "",
        vat ? "Assumes gross includes 20% VAT; VAT = gross / 6 rounded per payment; excludes no fees/refunds/chargebacks; not a tax return or net bank payout" : "VAT estimate unavailable: gross amount or currency unknown/invalid",
      ];
      }),
    ]
      .map(row => row.map(cell).join(","))
      .join("\r\n") +
    "\r\n"
  );
}
