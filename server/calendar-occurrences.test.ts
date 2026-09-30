import { describe, expect, it } from "vitest";
import { calendarDayWindow, expandCalendarOccurrences } from "../shared/calendar-occurrences";

describe("shared calendar occurrences", () => {
  it("includes the Wednesday Crew Call recurrence in the same UK calendar window", () => {
    const { start, end } = calendarDayWindow(new Date("2026-09-30T09:00:00.000Z"));
    const occurrences = expandCalendarOccurrences({
      id: 330001,
      startDate: new Date("2026-06-03T12:00:00.000Z"),
      endDate: new Date("2026-06-03T13:00:00.000Z"),
      recurrenceRule: "weekly",
      recurrenceEndDate: null,
    }, start, end);

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].occurrenceStart.toISOString()).toBe("2026-09-30T12:00:00.000Z");
  });

  it("does not include a rota which belongs to another weekday", () => {
    const { start, end } = calendarDayWindow(new Date("2026-09-30T09:00:00.000Z"));
    const occurrences = expandCalendarOccurrences({
      id: 123,
      startDate: new Date("2026-06-03T23:00:00.000Z"),
      endDate: new Date("2026-06-04T22:59:59.000Z"),
      recurrenceRule: "weekly",
      recurrenceEndDate: null,
    }, start, end);

    expect(occurrences).toHaveLength(0);
  });

  it("includes an all-day London calendar record that spans today", () => {
    const { start, end } = calendarDayWindow(new Date("2026-09-30T09:00:00.000Z"));
    const occurrences = expandCalendarOccurrences({
      id: 9,
      startDate: new Date("2026-09-29T23:00:00.000Z"),
      endDate: new Date("2026-09-30T22:59:59.000Z"),
      recurrenceRule: "none",
      recurrenceEndDate: null,
    }, start, end);

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].isRecurring).toBe(false);
  });
});
