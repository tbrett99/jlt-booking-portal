import { describe, expect, it } from "vitest";
import { getDigestPeriod } from "./community-db";

describe("community digest reporting periods", () => {
  it("covers exactly Monday through Sunday for a weekly update", () => {
    const { periodStart, periodEnd } = getDigestPeriod("weekly", new Date("2026-09-07T12:00:00Z"));

    expect(periodStart.toISOString()).toBe("2026-09-07T00:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });

  it("covers the complete calendar month for a monthly review", () => {
    const { periodStart, periodEnd } = getDigestPeriod("monthly", new Date("2026-08-01T12:00:00Z"));

    expect(periodStart.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});
