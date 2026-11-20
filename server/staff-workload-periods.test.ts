import { describe, expect, it } from "vitest";
import { addStaffWorkDays, createPreviousStaffWorkPeriod, createStaffWorkPeriod, staffWorkLondonDate, staffWorkLondonMidnight, validateStaffWorkRange } from "../shared/staff-workload-periods";
const now = new Date("2026-11-20T12:00:00Z");
describe("safe London report periods", () => {
  it("persists UTC boundaries across spring and autumn DST", () => {
    expect(staffWorkLondonMidnight("2026-03-29").toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(staffWorkLondonMidnight("2026-03-30").toISOString()).toBe("2026-03-29T23:00:00.000Z");
    expect(staffWorkLondonMidnight("2026-10-25").toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(staffWorkLondonMidnight("2026-10-26").toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(staffWorkLondonDate(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
  });
  it("accepts a leap year and 366 calendar days, not fixed UTC duration", () => {
    expect(addStaffWorkDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(validateStaffWorkRange({ rangeStart: "2024-01-01", rangeEnd: "2025-01-01" }, now).dates).toHaveLength(366);
    expect(validateStaffWorkRange({ rangeStart: "2026-03-29", rangeEnd: "2026-03-30" }, now).end.getTime() - staffWorkLondonMidnight("2026-03-29").getTime()).toBe(23 * 3_600_000);
  });
  it.each(["2026-02-29", "2024-02-30", "2026-04-31", "2026-00-01", "2026-13-01", "2026-1-01", "2026-11-20T00:00:00Z", "0000-01-01"])("rejects invalid date %s", value => {
    expect(() => staffWorkLondonMidnight(value)).toThrow();
  });
  it("rejects empty/reversed/oversized/future ranges, allows tomorrow UK end", () => {
    for (const range of [{ rangeStart: "2026-11-20", rangeEnd: "2026-11-20" }, { rangeStart: "2026-11-21", rangeEnd: "2026-11-20" }, { rangeStart: "2024-01-01", rangeEnd: "2025-01-02" }, { rangeStart: "2026-11-20", rangeEnd: "2026-11-22" }]) expect(() => validateStaffWorkRange(range, now)).toThrow();
    expect(validateStaffWorkRange({ rangeStart: "2026-11-20", rangeEnd: "2026-11-21" }, now).dates).toEqual(["2026-11-20"]);
  });
  it("builds Monday weeks and current partial month/year without future ends", () => {
    expect(createStaffWorkPeriod("week", now)).toEqual({ rangeStart: "2026-11-16", rangeEnd: "2026-11-21" });
    expect(createStaffWorkPeriod("month", now)).toEqual({ rangeStart: "2026-11-01", rangeEnd: "2026-11-21" });
    expect(createStaffWorkPeriod("year", now)).toEqual({ rangeStart: "2026-01-01", rangeEnd: "2026-11-21" });
    expect(createPreviousStaffWorkPeriod("month", new Date("2026-01-04T00:00:00Z"))).toEqual({ rangeStart: "2025-12-01", rangeEnd: "2026-01-01" });
    expect(createPreviousStaffWorkPeriod("year", now)).toEqual({ rangeStart: "2025-01-01", rangeEnd: "2026-01-01" });
  });
});
