import { describe, expect, it } from "vitest";
import {
  buildOrbitBookingFinancialFields,
  decideOrbitFinancialSync,
  hasOrbitBookingFinancialChange,
} from "./orbit-financial-sync";

describe("Orbit financial synchronisation policy", () => {
  it("mirrors current Orbit financial values before a commission claim exists", () => {
    expect(decideOrbitFinancialSync({ currentStage: "Added to PTS", hasCommissionClaim: false })).toEqual({
      outcome: "applied",
      reason: null,
    });
    expect(buildOrbitBookingFinancialFields({
      grossBookingValue: 2500,
      marginPct: 12.5,
      expectedCommission: 312.4,
    })).toEqual({
      grossCost: "2500.00",
      orbitMarginPct: "12.500",
      expectedCommission: "312.40",
    });
  });

  it("clears derived live values when Orbit reports an incomplete financial result", () => {
    const next = buildOrbitBookingFinancialFields({
      grossBookingValue: 2500,
      marginPct: null,
      expectedCommission: null,
    });
    expect(next).toEqual({
      grossCost: "2500.00",
      orbitMarginPct: null,
      expectedCommission: null,
    });
    expect(hasOrbitBookingFinancialChange({
      grossCost: "2500.00",
      orbitMarginPct: "12.500",
      expectedCommission: "312.40",
    }, next)).toBe(true);
  });

  it("holds a later Orbit revision for staff review once a claim exists", () => {
    expect(decideOrbitFinancialSync({ currentStage: "Added to PTS", hasCommissionClaim: true })).toEqual({
      outcome: "held_for_claim_review",
      reason: "A commission claim already exists for this booking.",
    });
  });

  it("also protects a booking that is already in a payment stage even if claim data is temporarily unavailable", () => {
    expect(decideOrbitFinancialSync({ currentStage: "Commission Due for Payment", hasCommissionClaim: false })).toEqual({
      outcome: "held_for_claim_review",
      reason: "The booking is in the protected Commission Due for Payment stage.",
    });
  });
});
