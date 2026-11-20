import type { StaffWorkRange } from "./staff-workload";

export const STAFF_WORK_TIMEZONE = "Europe/London" as const;
const DAY = 86_400_000;
const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: STAFF_WORK_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Calendar date in the reporting timezone, not the browser's local timezone. */
export function staffWorkLondonDate(date: Date = new Date()): string {
  if (!Number.isFinite(date.getTime())) throw new Error("Choose a valid report date.");
  const parts = formatter.formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function calendarMillis(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose ISO calendar dates (YYYY-MM-DD).");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || +value.slice(0, 4) < 1900) {
    throw new Error("Choose a valid calendar date.");
  }
  return date.getTime();
}
export function addStaffWorkDays(value: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error("Calendar day offset must be an integer.");
  return new Date(calendarMillis(value) + days * DAY).toISOString().slice(0, 10);
}
/** Resolve UK midnight using Intl's UTC offset; handles both DST transitions. */
export function staffWorkLondonMidnight(value: string): Date {
  const utc = calendarMillis(value);
  const offsetFormat = new Intl.DateTimeFormat("en-GB", { timeZone: STAFF_WORK_TIMEZONE, timeZoneName: "longOffset" });
  let result = utc;
  for (let i = 0; i < 3; i++) {
    const offset = offsetFormat.formatToParts(new Date(result)).find(p => p.type === "timeZoneName")!.value;
    const match = offset.match(/^GMT([+-])(\d{2}):(\d{2})$/);
    const minutes = match ? (match[1] === "+" ? 1 : -1) * (+match[2] * 60 + +match[3]) : 0;
    result = utc - minutes * 60_000;
  }
  return new Date(result);
}
export function validateStaffWorkRange(range: StaffWorkRange, now: Date = new Date()): StaffWorkRange & { start: Date; end: Date; dates: string[] } {
  const startCalendar = calendarMillis(range.rangeStart);
  const endCalendar = calendarMillis(range.rangeEnd);
  const days = (endCalendar - startCalendar) / DAY;
  if (days < 1 || days > 366) throw new Error("Choose a report range of 1 to 366 calendar days; the end date is exclusive.");
  if (range.rangeEnd > addStaffWorkDays(staffWorkLondonDate(now), 1)) throw new Error("The report end cannot be later than tomorrow in Europe/London.");
  return { ...range, start: staffWorkLondonMidnight(range.rangeStart), end: staffWorkLondonMidnight(range.rangeEnd), dates: Array.from({ length: days }, (_, i) => addStaffWorkDays(range.rangeStart, i)) };
}
/** Current day/week/month/YTD; partial periods stop at tomorrow UK, inclusive of today. */
export function createStaffWorkPeriod(kind: "day" | "week" | "month" | "year", now: Date = new Date()): StaffWorkRange {
  const today = staffWorkLondonDate(now);
  const weekday = new Date(calendarMillis(today)).getUTCDay();
  const rangeStart = kind === "day" ? today : kind === "week" ? addStaffWorkDays(today, -(weekday + 6) % 7) : kind === "month" ? `${today.slice(0, 7)}-01` : `${today.slice(0, 4)}-01-01`;
  return { rangeStart, rangeEnd: addStaffWorkDays(today, 1) };
}
/** Completed previous calendar period, with the same exclusive end convention. */
export function createPreviousStaffWorkPeriod(kind: "day" | "week" | "month" | "year", now: Date = new Date()): StaffWorkRange {
  const current = createStaffWorkPeriod(kind, now);
  let start: string;
  if (kind === "day" || kind === "week") start = addStaffWorkDays(current.rangeStart, kind === "day" ? -1 : -7);
  else {
    const d = new Date(calendarMillis(current.rangeStart));
    if (kind === "month") d.setUTCMonth(d.getUTCMonth() - 1); else d.setUTCFullYear(d.getUTCFullYear() - 1);
    start = d.toISOString().slice(0, 10);
  }
  return { rangeStart: start, rangeEnd: current.rangeStart };
}
