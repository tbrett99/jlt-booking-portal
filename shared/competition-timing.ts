export type CompetitionDateInput = Date | string;

const UK_TIME_ZONE = "Europe/London";
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function formatPartsInTimeZone(value: Date, timeZone = UK_TIME_ZONE): DateParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);

  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? NaN);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function competitionDateParts(value: CompetitionDateInput): Pick<DateParts, "year" | "month" | "day"> | null {
  if (typeof value === "string") {
    const dateOnly = value.match(DATE_ONLY_PATTERN);
    if (dateOnly) {
      return { year: Number(dateOnly[1]), month: Number(dateOnly[2]), day: Number(dateOnly[3]) };
    }
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Competition dates are selected as calendar dates, not as instants. The
  // database's timestamp representation must therefore not allow a browser's
  // current timezone to move a 30 September end date onto 1 October.
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function timeZoneOffsetMs(value: Date, timeZone = UK_TIME_ZONE) {
  // Intl format parts are second-precision, so calculate the offset from a
  // whole-second instant and preserve milliseconds in the final deadline.
  const wholeSecondValue = new Date(value.getTime() - value.getMilliseconds());
  const parts = formatPartsInTimeZone(wholeSecondValue, timeZone);
  const interpretedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return interpretedAsUtc - wholeSecondValue.getTime();
}

function ukDateTimeToUtc(parts: Pick<DateParts, "year" | "month" | "day">, hour: number, minute: number, second: number, millisecond = 0) {
  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, second, millisecond));
  return new Date(utcGuess.getTime() - timeZoneOffsetMs(utcGuess));
}

/** Store the selected calendar date in a timezone-neutral representation. */
export function competitionCalendarStart(value: CompetitionDateInput): Date {
  const parts = competitionDateParts(value);
  if (!parts) return new Date(Number.NaN);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0));
}

/** Store the selected final calendar date in a timezone-neutral representation. */
export function competitionCalendarEnd(value: CompetitionDateInput): Date {
  const parts = competitionDateParts(value);
  if (!parts) return new Date(Number.NaN);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 23, 59, 59, 999));
}

/** The opening instant for a competition's stated UK calendar date. */
export function competitionStartsAt(value: CompetitionDateInput): Date {
  const parts = competitionDateParts(value);
  if (!parts) return new Date(Number.NaN);
  return ukDateTimeToUtc(parts, 0, 0, 0, 0);
}

/** The final instant (23:59:59.999 UK time) for a competition's stated end date. */
export function competitionClosesAt(value: CompetitionDateInput): Date {
  const parts = competitionDateParts(value);
  if (!parts) return new Date(Number.NaN);
  return ukDateTimeToUtc(parts, 23, 59, 59, 999);
}

export function isCompetitionOpen(value: CompetitionDateInput, now = new Date()) {
  const closesAt = competitionClosesAt(value);
  return !Number.isNaN(closesAt.getTime()) && now.getTime() <= closesAt.getTime();
}

/** A human-friendly UK-local deadline label for the agent competition views. */
export function competitionClosingLabel(value: CompetitionDateInput, now = new Date()) {
  if (!isCompetitionOpen(value, now)) return "Competition closed";

  const endDate = competitionDateParts(value);
  if (!endDate) return "Competition closed";
  const currentDate = formatPartsInTimeZone(now);
  if (
    currentDate.year === endDate.year
    && currentDate.month === endDate.month
    && currentDate.day === endDate.day
  ) {
    return "Closes tonight";
  }

  const currentUtcDate = Date.UTC(currentDate.year, currentDate.month - 1, currentDate.day);
  const endUtcDate = Date.UTC(endDate.year, endDate.month - 1, endDate.day);
  const days = Math.max(1, Math.round((endUtcDate - currentUtcDate) / 86_400_000));
  return `${days} day${days === 1 ? "" : "s"} remaining`;
}
