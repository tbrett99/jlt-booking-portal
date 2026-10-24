export const ACCELERATOR_JOURNEY_WEEKS = 8;
export const ACCELERATOR_RELEASE_HOUR_LONDON = 9;

export type LondonDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const LONDON_TIME_ZONE = "Europe/London";

function londonParts(date: Date): LondonDateParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function localLondonDateTimeToUtc(parts: Pick<LondonDateParts, "year" | "month" | "day"> & Partial<Pick<LondonDateParts, "hour" | "minute" | "second">>) {
  const wantedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
  let candidate = new Date(wantedAsUtc);

  // London changes between GMT and BST. Re-read the proposed instant in London
  // and correct it until its local wall-clock time matches the requested one.
  for (let attempt = 0; attempt < 3; attempt++) {
    const actual = londonParts(candidate);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const difference = wantedAsUtc - actualAsUtc;
    if (difference === 0) break;
    candidate = new Date(candidate.getTime() + difference);
  }
  return candidate;
}

function addLocalCalendarDays(parts: Pick<LondonDateParts, "year" | "month" | "day">, days: number) {
  const calendar = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  calendar.setUTCDate(calendar.getUTCDate() + days);
  return {
    year: calendar.getUTCFullYear(),
    month: calendar.getUTCMonth() + 1,
    day: calendar.getUTCDate(),
  };
}

/**
 * Week 1 is the next available Friday at 09:00 Europe/London. If an agent is
 * moved to Accelerator before 09:00 on a Friday, that Friday is available; once
 * 09:00 has passed, their first weekly module starts the following Friday.
 */
export function firstAcceleratorFridayReleaseAt(startedAt: Date) {
  const start = londonParts(startedAt);
  const startCalendar = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const weekday = startCalendar.getUTCDay(); // Sunday 0, Friday 5 — valid for a London calendar date.
  let daysUntilFriday = (5 - weekday + 7) % 7;
  if (daysUntilFriday === 0 && (start.hour > ACCELERATOR_RELEASE_HOUR_LONDON || (start.hour === ACCELERATOR_RELEASE_HOUR_LONDON && (start.minute > 0 || start.second > 0)))) {
    daysUntilFriday = 7;
  }
  const friday = addLocalCalendarDays(start, daysUntilFriday);
  return localLondonDateTimeToUtc({ ...friday, hour: ACCELERATOR_RELEASE_HOUR_LONDON, minute: 0, second: 0 });
}

/** Returns the individual release time for a course week (1–8). Week 0 is the immediate introduction. */
export function acceleratorWeekReleaseAt(startedAt: Date, releaseWeek: number) {
  if (releaseWeek <= 0) return startedAt;
  if (releaseWeek > ACCELERATOR_JOURNEY_WEEKS) throw new Error(`Accelerator release week must be between 0 and ${ACCELERATOR_JOURNEY_WEEKS}`);
  const firstFriday = firstAcceleratorFridayReleaseAt(startedAt);
  const localFriday = londonParts(firstFriday);
  const date = addLocalCalendarDays(localFriday, (releaseWeek - 1) * 7);
  return localLondonDateTimeToUtc({ ...date, hour: ACCELERATOR_RELEASE_HOUR_LONDON, minute: 0, second: 0 });
}

export function isAcceleratorWeekAvailable(startedAt: Date | null | undefined, releaseWeek: number | null | undefined, now = new Date()) {
  if (!releaseWeek || releaseWeek <= 0 || !startedAt) return true;
  return acceleratorWeekReleaseAt(new Date(startedAt), Number(releaseWeek)).getTime() <= now.getTime();
}

export function acceleratorWeekReleaseLabel(startedAt: Date | null | undefined, releaseWeek: number | null | undefined) {
  if (!releaseWeek || releaseWeek <= 0) return "Available immediately";
  if (!startedAt) return `Week ${releaseWeek}`;
  return acceleratorWeekReleaseAt(new Date(startedAt), Number(releaseWeek)).toLocaleString("en-GB", {
    timeZone: LONDON_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function nextAcceleratorWeekAt(startedAt: Date, now = new Date()) {
  for (let week = 1; week <= ACCELERATOR_JOURNEY_WEEKS; week++) {
    const releaseAt = acceleratorWeekReleaseAt(startedAt, week);
    if (releaseAt.getTime() > now.getTime()) return { week, releaseAt };
  }
  return null;
}

/** A course-week action has the agent's full release-to-next-release cycle, ending Thursday 20:00 UK time. */
export function acceleratorWeekActionDueAt(startedAt: Date, releaseWeek: number) {
  const releaseAt = acceleratorWeekReleaseAt(startedAt, releaseWeek);
  const localRelease = londonParts(releaseAt);
  const thursday = addLocalCalendarDays(localRelease, 6);
  return localLondonDateTimeToUtc({ ...thursday, hour: 20, minute: 0, second: 0 });
}
