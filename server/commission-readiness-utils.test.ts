import { describe, expect, it } from "vitest";
import {
  commissionReadinessTargetWindow,
  isCommissionReadinessEligible,
  isPreAuthorisedCommissionEligibleAfterDeparture,
} from "./commission-readiness-utils";

describe("commission readiness reminder eligibility", () => {
  const now = new Date("2026-09-11T08:00:00.000Z");

  it("targets exactly 12 calendar weeks before departure", () => {
    const target = commissionReadinessTargetWindow(now);
    expect(target.start.toISOString()).toBe("2026-12-04T00:00:00.000Z");
    expect(target.end.toISOString()).toBe("2026-12-05T00:00:00.000Z");
  });

  it("includes active commission bookings on the target date only", () => {
    expect(isCommissionReadinessEligible({
      departureDate: new Date("2026-12-04T00:00:00.000Z"), currentStage: "Added to PTS", isPersonalBooking: false,
    }, now)).toBe(true);
    expect(isCommissionReadinessEligible({
      departureDate: new Date("2026-12-05T00:00:00.000Z"), currentStage: "Added to PTS", isPersonalBooking: false,
    }, now)).toBe(false);
  });

  it("excludes cancelled and personal bookings", () => {
    const departureDate = new Date("2026-12-04T00:00:00.000Z");
    expect(isCommissionReadinessEligible({ departureDate, currentStage: "Cancelled", isPersonalBooking: false }, now)).toBe(false);
    expect(isCommissionReadinessEligible({ departureDate, currentStage: "Added to PTS", isPersonalBooking: true }, now)).toBe(false);
  });

  it("holds pre-authorised commission until seven complete calendar days after departure", () => {
    const departure = new Date("2026-09-10T00:00:00.000Z");
    expect(isPreAuthorisedCommissionEligibleAfterDeparture(departure, new Date("2026-09-16T23:59:59.999Z"))).toBe(false);
    expect(isPreAuthorisedCommissionEligibleAfterDeparture(departure, new Date("2026-09-17T00:00:00.000Z"))).toBe(true);
  });

  it("does not allow a pre-authorised claim without a valid departure date", () => {
    expect(isPreAuthorisedCommissionEligibleAfterDeparture(null, now)).toBe(false);
    expect(isPreAuthorisedCommissionEligibleAfterDeparture("not-a-date", now)).toBe(false);
  });
});
