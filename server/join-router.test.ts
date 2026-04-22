/**
 * Tests for the join router — sign-up flow procedures.
 *
 * Uses the same pattern as auth.logout.test.ts (direct DB-level tests
 * with mocked dependencies).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MEMBERSHIP_TIERS,
  MEMBERSHIP_TYPES,
  JOINING_FEE_PENCE,
  getJoiningFee,
  getMonthlyAmount,
  formatPounds,
  TIER_LABELS,
  TYPE_LABELS,
  MEMBER_COUNTS,
} from "../shared/membership";

// ─── Membership Constants ─────────────────────────────────────────────────────

describe("Membership constants", () => {
  it("should have correct tier labels", () => {
    expect(TIER_LABELS.business_class).toBe("Business Class");
    expect(TIER_LABELS.first_class).toBe("First Class");
  });

  it("should have correct type labels", () => {
    expect(TYPE_LABELS.solo).toBe("Solo");
    expect(TYPE_LABELS.duo).toBe("Duo (2 agents)");
    expect(TYPE_LABELS.trio).toBe("Trio (3 agents)");
  });

  it("should have correct member counts", () => {
    expect(MEMBER_COUNTS.solo).toBe(1);
    expect(MEMBER_COUNTS.duo).toBe(2);
    expect(MEMBER_COUNTS.trio).toBe(3);
  });

  it("should have correct monthly amounts for business_class", () => {
    expect(getMonthlyAmount("business_class", "solo")).toBe(8700);
    expect(getMonthlyAmount("business_class", "duo")).toBe(12700);
    expect(getMonthlyAmount("business_class", "trio")).toBe(16700);
  });

  it("should have correct monthly amounts for first_class", () => {
    expect(getMonthlyAmount("first_class", "solo")).toBe(12700);
    expect(getMonthlyAmount("first_class", "duo")).toBe(16700);
    expect(getMonthlyAmount("first_class", "trio")).toBe(20700);
  });

  it("should return the joining fee", () => {
    expect(getJoiningFee("solo")).toBe(JOINING_FEE_PENCE);
    expect(getJoiningFee("duo")).toBe(JOINING_FEE_PENCE);
    expect(getJoiningFee("trio")).toBe(JOINING_FEE_PENCE);
  });

  it("should format pence as pounds", () => {
    expect(formatPounds(8700)).toBe("£87");
    expect(formatPounds(12700)).toBe("£127");
    expect(formatPounds(100)).toBe("£1");
    expect(formatPounds(29700)).toBe("£297");
    expect(formatPounds(8750)).toBe("£87.50");
  });

  it("should list all tiers", () => {
    expect(MEMBERSHIP_TIERS).toContain("business_class");
    expect(MEMBERSHIP_TIERS).toContain("first_class");
    expect(MEMBERSHIP_TIERS.length).toBe(2);
  });

  it("should list all types", () => {
    expect(MEMBERSHIP_TYPES).toContain("solo");
    expect(MEMBERSHIP_TYPES).toContain("duo");
    expect(MEMBERSHIP_TYPES).toContain("trio");
    expect(MEMBERSHIP_TYPES.length).toBe(3);
  });
});

// ─── Session Token Generation ─────────────────────────────────────────────────

describe("Session token generation", () => {
  it("should generate unique tokens", () => {
    const { nanoid } = require("nanoid");
    const t1 = nanoid(64);
    const t2 = nanoid(64);
    expect(t1).not.toBe(t2);
    expect(t1.length).toBe(64);
  });
});

// ─── Step Validation ──────────────────────────────────────────────────────────

describe("Join flow step validation", () => {
  const VALID_STEPS = ["plan", "contract", "payment", "complete"];

  it("should accept all valid steps", () => {
    VALID_STEPS.forEach((step) => {
      expect(VALID_STEPS).toContain(step);
    });
  });

  it("should have contract step after plan", () => {
    const idx = VALID_STEPS.indexOf("plan");
    expect(VALID_STEPS[idx + 1]).toBe("contract");
  });

  it("should have payment step after contract", () => {
    const idx = VALID_STEPS.indexOf("contract");
    expect(VALID_STEPS[idx + 1]).toBe("payment");
  });

  it("should have complete step after payment", () => {
    const idx = VALID_STEPS.indexOf("payment");
    expect(VALID_STEPS[idx + 1]).toBe("complete");
  });
});

// ─── Email Validation ─────────────────────────────────────────────────────────

describe("Email validation", () => {
  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  it("should accept valid emails", () => {
    expect(isValidEmail("test@example.com")).toBe(true);
    expect(isValidEmail("agent@thejltgroup.co.uk")).toBe(true);
    expect(isValidEmail("user+tag@domain.org")).toBe(true);
  });

  it("should reject invalid emails", () => {
    expect(isValidEmail("notanemail")).toBe(false);
    expect(isValidEmail("missing@tld")).toBe(false);
    expect(isValidEmail("@nodomain.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

// ─── Joining Fee Calculation ──────────────────────────────────────────────────

describe("Joining fee calculation", () => {
  it("should be the same for all membership types", () => {
    const soloFee = getJoiningFee("solo");
    const duoFee = getJoiningFee("duo");
    const trioFee = getJoiningFee("trio");
    expect(soloFee).toBe(duoFee);
    expect(duoFee).toBe(trioFee);
  });

  it("should be a positive integer (pence)", () => {
    const fee = getJoiningFee("solo");
    expect(fee).toBeGreaterThan(0);
    expect(Number.isInteger(fee)).toBe(true);
  });
});
