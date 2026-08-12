import { afterEach, describe, expect, it, vi } from "vitest";
import { getStageAgeGuidance } from "../client/src/pages/admin/AdminKanban";

describe("getStageAgeGuidance", () => {
  afterEach(() => vi.useRealTimers());

  it("marks a booking new today when it entered the stage less than one day ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T12:00:00Z"));

    expect(getStageAgeGuidance("2026-08-12T08:00:00Z").label).toBe("New today");
  });

  it("escalates bookings at five days or older as needing attention", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T12:00:00Z"));

    const guidance = getStageAgeGuidance("2026-08-07T12:00:00Z");
    expect(guidance.urgent).toBe(true);
    expect(guidance.label).toBe("5d in stage · Needs attention");
  });
});
