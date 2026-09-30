export type CalendarRecurrenceRule = "none" | "daily" | "weekly" | "monthly" | "yearly";

export type CalendarEventForOccurrence = {
  id: number;
  startDate: Date | string;
  endDate: Date | string;
  recurrenceRule: CalendarRecurrenceRule | string | null;
  recurrenceEndDate?: Date | string | null;
};

export type CalendarOccurrence<T extends CalendarEventForOccurrence> = T & {
  occurrenceStart: Date;
  occurrenceEnd: Date;
  isRecurring: boolean;
};

const LONDON_TIME_ZONE = "Europe/London";

function localDateParts(date: Date, timeZone = LONDON_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function offsetAt(date: Date, timeZone = LONDON_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const renderedAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  ) + date.getUTCMilliseconds();
  return renderedAsUtc - date.getTime();
}

function londonLocalTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, millisecond: number) {
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let result = new Date(wallClockUtc - offsetAt(new Date(wallClockUtc)));
  const correctedOffset = offsetAt(result);
  result = new Date(wallClockUtc - correctedOffset);
  return result;
}

/** The exact UK calendar-day window used by the shared Team Calendar. */
export function calendarDayWindow(date = new Date(), timeZone = LONDON_TIME_ZONE) {
  const { year, month, day } = localDateParts(date, timeZone);
  const start = londonLocalTimeToUtc(year, month, day, 0, 0, 0, 0);
  const end = londonLocalTimeToUtc(year, month, day, 23, 59, 59, 999);
  return { start, end };
}

function addDaysUtc(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonthsUtc(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function addYearsUtc(date: Date, years: number) {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

/**
 * Expands a calendar record exactly as the Team Calendar does, producing only
 * occurrences which overlap the supplied window. Keeping this shared prevents
 * the dashboard from drifting from the source calendar's recurrence view.
 */
export function expandCalendarOccurrences<T extends CalendarEventForOccurrence>(event: T, rangeFrom: Date, rangeTo: Date): CalendarOccurrence<T>[] {
  const start = new Date(event.startDate);
  const end = new Date(event.endDate);
  const recurrence = (event.recurrenceRule ?? "none") as CalendarRecurrenceRule;

  if (recurrence === "none") {
    return end >= rangeFrom && start <= rangeTo
      ? [{ ...event, occurrenceStart: start, occurrenceEnd: end, isRecurring: false }]
      : [];
  }

  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const recurrenceEnd = event.recurrenceEndDate ? new Date(event.recurrenceEndDate) : addYearsUtc(start, 3);
  const occurrences: CalendarOccurrence<T>[] = [];
  let cursor = new Date(start);
  let safety = 0;

  while (cursor <= rangeTo && cursor <= recurrenceEnd && safety < 500) {
    safety += 1;
    const occurrenceEnd = new Date(cursor.getTime() + durationMs);
    if (occurrenceEnd >= rangeFrom && cursor <= rangeTo) {
      occurrences.push({ ...event, occurrenceStart: new Date(cursor), occurrenceEnd, isRecurring: true });
    }

    switch (recurrence) {
      case "daily":
        cursor = addDaysUtc(cursor, 1);
        break;
      case "weekly":
        cursor = addDaysUtc(cursor, 7);
        break;
      case "monthly":
        cursor = addMonthsUtc(cursor, 1);
        break;
      case "yearly":
        cursor = addYearsUtc(cursor, 1);
        break;
      default:
        return occurrences;
    }
  }

  return occurrences;
}
