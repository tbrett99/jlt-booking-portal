export type RefundChaseTiming = "overdue" | "today" | "upcoming" | "unscheduled";

const UK_DATE_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function ukDateKey(date: Date): string {
  const parts = UK_DATE_PARTS.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) throw new Error("Could not format UK calendar date");
  return `${year}-${month}-${day}`;
}

/** Keeps a date-only staff input stable regardless of the browser's local timezone. */
export function expectedRefundDateFromInput(value: string): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Expected refund date must be a calendar date");
  return new Date(`${value}T12:00:00.000Z`);
}

export function expectedRefundDateInputValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : ukDateKey(date);
}

export function refundChaseTiming(
  expectedRefundDate: Date | string | null | undefined,
  now = new Date(),
): RefundChaseTiming {
  const expectedKey = expectedRefundDateInputValue(expectedRefundDate);
  if (!expectedKey) return "unscheduled";
  const todayKey = ukDateKey(now);
  if (expectedKey < todayKey) return "overdue";
  if (expectedKey === todayKey) return "today";
  return "upcoming";
}

export function formatExpectedRefundDate(value: Date | string | null | undefined): string | null {
  const input = expectedRefundDateInputValue(value);
  if (!input) return null;
  const [year, month, day] = input.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}
