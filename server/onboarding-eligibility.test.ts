import { describe, expect, it } from "vitest";
import { isOnboardingEligible } from "./onboarding-eligibility";

describe("isOnboardingEligible", () => {
  it("includes only agents that are genuinely in onboarding", () => {
    expect(isOnboardingEligible("agent", "onboarding")).toBe(true);
    expect(isOnboardingEligible("admin", "onboarding")).toBe(false);
    expect(isOnboardingEligible("super_admin", "onboarding")).toBe(false);
    expect(isOnboardingEligible("agent", "active")).toBe(false);
  });
});
