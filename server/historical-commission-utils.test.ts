import { describe, expect, it } from "vitest";
import { canReconcileHistoricalCommissionClaim } from "./historical-commission-utils";

const prePaymentClaim = {
  status: "pending",
  grossAmount: null,
  paidAt: null,
  paidById: null,
  agentPaymentReceivedAt: null,
  agentPaymentReceivedById: null,
  remittanceLineId: null,
};

describe("historical commission claim reconciliation", () => {
  it("allows an unfinancialised pending top-up marker to be reconciled", () => {
    expect(canReconcileHistoricalCommissionClaim(prePaymentClaim)).toBe(true);
    expect(canReconcileHistoricalCommissionClaim({
      ...prePaymentClaim,
      status: "top_up_required",
    })).toBe(true);
  });

  it("does not overwrite a claim that has a financial payment or remittance history", () => {
    expect(canReconcileHistoricalCommissionClaim({
      ...prePaymentClaim,
      grossAmount: "250.00",
    })).toBe(false);
    expect(canReconcileHistoricalCommissionClaim({
      ...prePaymentClaim,
      paidAt: new Date("2026-05-01T00:00:00.000Z"),
    })).toBe(false);
    expect(canReconcileHistoricalCommissionClaim({
      ...prePaymentClaim,
      remittanceLineId: 42,
    })).toBe(false);
    expect(canReconcileHistoricalCommissionClaim({
      ...prePaymentClaim,
      status: "processing",
    })).toBe(false);
  });
});
