import type { StaffWorkRange } from "@shared/staff-workload";

export type WorkloadPreset = "today" | "thisWeek" | "lastWeek" | "thisMonth";
const DAY = 86_400_000;

/** Date-only arithmetic uses UTC as a calendar, never the browser's timezone. */
export function parseWorkloadDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return year >= 1000 &&
    year <= 9999 &&
    date.toISOString().slice(0, 10) === value
    ? date
    : null;
}

export function addWorkloadDays(value: string, days: number): string {
  const date = parseWorkloadDate(value);
  if (!date || !Number.isInteger(days))
    throw new Error("Invalid calendar date");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function workloadLondonToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function workloadMonday(value: string): string {
  const date = parseWorkloadDate(value);
  if (!date) throw new Error("Invalid calendar date");
  return addWorkloadDays(value, -((date.getUTCDay() + 6) % 7));
}

/** Current presets stop at today inclusive; no future days are presented as zero intake. */
export function workloadPresetRange(
  preset: WorkloadPreset,
  today = workloadLondonToday()
): StaffWorkRange {
  const monday = workloadMonday(today);
  if (preset === "lastWeek")
    return { rangeStart: addWorkloadDays(monday, -7), rangeEnd: monday };
  const rangeStart =
    preset === "today"
      ? today
      : preset === "thisWeek"
        ? monday
        : today.slice(0, 7) + "-01";
  return { rangeStart, rangeEnd: addWorkloadDays(today, 1) };
}

export function validateWorkloadCustom(
  from: string,
  to: string,
  today = workloadLondonToday()
): string | null {
  const start = parseWorkloadDate(from);
  const end = parseWorkloadDate(to);
  if (!start || !end)
    return "Choose valid From and To dates (including a valid day for the month).";
  if (from > to) return "To must be on or after From.";
  if ((end.getTime() - start.getTime()) / DAY + 1 > 366)
    return "Choose a period of no more than 366 days.";
  if (to > today)
    return "To must be today or earlier; future intake is not available.";
  return null;
}

export function workloadCustomRange(
  from: string,
  to: string,
  today = workloadLondonToday()
): StaffWorkRange {
  const error = validateWorkloadCustom(from, to, today);
  if (error) throw new Error(error);
  return { rangeStart: from, rangeEnd: addWorkloadDays(to, 1) };
}

export function formatWorkloadDate(value: string): string {
  const date = parseWorkloadDate(value);
  return date
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date)
    : "Not recorded";
}

export function formatWorkloadTimestamp(value: string | null): string {
  if (!value) return "Not recorded";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatWorkloadDate(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}
