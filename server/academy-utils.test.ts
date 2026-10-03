import { describe, expect, it } from "vitest";
import { ACADEMY_ACCELERATOR_WAIT_DAYS, getAccreditationEligibility, safeHttpsUrl, summariseAcademyProgress } from "../shared/academy-utils";

describe("JLT Academy progress utilities", () => {
  it("counts required lessons only and never treats an empty pathway as complete", () => {
    expect(summariseAcademyProgress([10, 11, 12], [10, 12, 99])).toEqual({
      requiredLessons: 3,
      completedRequiredLessons: 2,
      percentage: 67,
      isComplete: false,
    });
    expect(summariseAcademyProgress([], [])).toEqual({
      requiredLessons: 0,
      completedRequiredLessons: 0,
      percentage: 0,
      isComplete: false,
    });
  });

  it("enforces the full eight-week Accelerator wait before accreditation", () => {
    const started = new Date("2026-01-01T12:00:00.000Z");
    const oneMinuteEarly = new Date(started.getTime() + ACADEMY_ACCELERATOR_WAIT_DAYS * 24 * 60 * 60 * 1000 - 60_000);
    const onTime = new Date(started.getTime() + ACADEMY_ACCELERATOR_WAIT_DAYS * 24 * 60 * 60 * 1000);
    expect(getAccreditationEligibility(started, oneMinuteEarly).eligible).toBe(false);
    expect(getAccreditationEligibility(started, onTime)).toMatchObject({ eligible: true, daysRemaining: 0 });
    expect(getAccreditationEligibility(null, onTime)).toMatchObject({ eligible: false, eligibleAt: null, daysRemaining: null });
  });

  it("only accepts HTTPS video and resource URLs", () => {
    expect(safeHttpsUrl("https://www.loom.com/share/example")).toBe("https://www.loom.com/share/example");
    expect(safeHttpsUrl("http://example.com/video")).toBeNull();
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
  });
});
