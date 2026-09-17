import { describe, expect, it } from "vitest";
import { orbitFinancialSnapshotSchema } from "./orbit-financial-snapshot";

const completeSnapshot = {
  crmRef: "JLT-1234",
  bookingId: 702,
  currency: "GBP" as const,
  grossBookingValue: 1500,
  totalNetCost: 1240,
  netCostSubtotal: 1240,
  netCostStatus: "complete" as const,
  missingNetCostProducts: 0,
  grossMargin: 260,
  marginPct: 17.33,
  expectedCommission: 178.45,
  financialRevision: "a".repeat(64),
  financialSnapshotAt: "2026-09-17T10:45:00.000Z",
};

describe("Orbit financial snapshot contract", () => {
  it("accepts a complete snapshot with a valid £0.00 net cost", () => {
    const parsed = orbitFinancialSnapshotSchema.safeParse({
      ...completeSnapshot,
      totalNetCost: 0,
      netCostSubtotal: 0,
      grossMargin: 1500,
      marginPct: 100,
      expectedCommission: 1200,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.totalNetCost).toBe(0);
  });

  it("requires incomplete snapshots to retain only a clearly-labelled subtotal", () => {
    const parsed = orbitFinancialSnapshotSchema.safeParse({
      ...completeSnapshot,
      totalNetCost: null,
      netCostSubtotal: 940,
      netCostStatus: "incomplete",
      missingNetCostProducts: 1,
      grossMargin: null,
      marginPct: null,
      expectedCommission: null,
    });
    expect(parsed.success).toBe(true);

    const unsafe = orbitFinancialSnapshotSchema.safeParse({
      ...completeSnapshot,
      totalNetCost: 940,
      netCostSubtotal: 940,
      netCostStatus: "incomplete",
      missingNetCostProducts: 1,
      grossMargin: 560,
      marginPct: 37.33,
      expectedCommission: 100,
    });
    expect(unsafe.success).toBe(false);
  });

  it("does not accept a misleading unavailable financial state", () => {
    const parsed = orbitFinancialSnapshotSchema.safeParse({
      ...completeSnapshot,
      totalNetCost: null,
      netCostSubtotal: null,
      netCostStatus: "unavailable",
      missingNetCostProducts: 0,
      grossMargin: null,
      marginPct: null,
      expectedCommission: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts GBP values only to two decimal places", () => {
    const parsed = orbitFinancialSnapshotSchema.safeParse({
      ...completeSnapshot,
      totalNetCost: 1240.001,
    });
    expect(parsed.success).toBe(false);
  });
});
