import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const selectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: vi.fn(async () => selectResults.shift() ?? []),
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(selectResults.shift() ?? []).then(resolve, reject),
    };
    return chain;
  };
  return {
    selectResults,
    db: {
      select: vi.fn(() => selectChain()),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    },
    getBookingById: vi.fn(),
    getCommissionClaimByBooking: vi.fn(),
    updateBookingAdminFields: vi.fn(),
    applyOrbitFinancialSnapshot: vi.fn(),
  };
});

vi.mock("./db", () => ({
  getDb: vi.fn(async () => mocks.db),
  createBooking: vi.fn(),
  updateBookingAdminFields: mocks.updateBookingAdminFields,
  getBookingById: mocks.getBookingById,
  getCommissionClaimByBooking: mocks.getCommissionClaimByBooking,
  applyOrbitFinancialSnapshot: mocks.applyOrbitFinancialSnapshot,
}));

import { externalApiRouter } from "./external-api";

const snapshot = {
  crmRef: "JLT-1234",
  bookingId: 702,
  currency: "GBP",
  grossBookingValue: 1500,
  totalNetCost: 1240,
  netCostSubtotal: 1240,
  netCostStatus: "complete",
  missingNetCostProducts: 0,
  grossMargin: 260,
  marginPct: 17.33,
  expectedCommission: 178.45,
  financialRevision: "a".repeat(64),
  financialSnapshotAt: "2026-09-17T10:45:00.000Z",
};

function intakeHandler() {
  const layer = (externalApiRouter as any).stack.find((item: any) => item.route?.path === "/update-commission");
  if (!layer) throw new Error("update-commission route was not registered");
  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

function response() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((statusCode: number) => { res.statusCode = statusCode; return res; });
  res.json = vi.fn((body: unknown) => { res.body = body; return res; });
  return res;
}

describe("POST /api/external/update-commission financial snapshots", () => {
  beforeEach(() => {
    mocks.selectResults.splice(0, mocks.selectResults.length);
    vi.clearAllMocks();
    mocks.selectResults.push([{ id: 4, keyHash: "hash", isActive: true }]);
    mocks.getBookingById.mockResolvedValue({ id: 702, crmRef: "JLT-1234", currentStage: "Added to PTS" });
    mocks.getCommissionClaimByBooking.mockResolvedValue(undefined);
    mocks.applyOrbitFinancialSnapshot.mockResolvedValue({
      bookingId: 702,
      financialRevision: snapshot.financialRevision,
      idempotent: false,
      stale: false,
      outcome: "applied",
      reason: null,
      valuesChanged: true,
    });
  });

  it("stores a complete snapshot containing a valid £0.00 total net cost", async () => {
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: { ...snapshot, totalNetCost: 0, netCostSubtotal: 0, grossMargin: 1500, marginPct: 100, expectedCommission: 1200 } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ success: true, bookingId: 702, outcome: "applied", valuesChanged: true }));
    expect(mocks.applyOrbitFinancialSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 702,
      snapshot: expect.objectContaining({ totalNetCost: 0, netCostStatus: "complete", missingNetCostProducts: 0 }),
    }));
  });

  it("treats a repeated revision as idempotent without storing another history record", async () => {
    mocks.applyOrbitFinancialSnapshot.mockResolvedValue({
      bookingId: 702,
      financialRevision: snapshot.financialRevision,
      idempotent: true,
      stale: false,
      outcome: null,
      valuesChanged: false,
    });
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: snapshot }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ success: true, idempotent: true, bookingId: 702, valuesChanged: false }));
  });

  it("replaces a stored snapshot only when Orbit sends a newer revision", async () => {
    mocks.applyOrbitFinancialSnapshot.mockResolvedValue({
      bookingId: 702,
      financialRevision: snapshot.financialRevision,
      idempotent: false,
      stale: false,
      outcome: "applied",
      reason: null,
      valuesChanged: true,
    });
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: snapshot }, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.applyOrbitFinancialSnapshot).toHaveBeenCalledWith({ bookingId: 702, snapshot });
  });

  it("does not roll the displayed values backwards when an older snapshot arrives", async () => {
    mocks.applyOrbitFinancialSnapshot.mockResolvedValue({
      bookingId: 702,
      financialRevision: "b".repeat(64),
      idempotent: false,
      stale: true,
      outcome: null,
      valuesChanged: false,
    });
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: snapshot }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ success: true, stale: true, bookingId: 702, valuesChanged: false }));
  });

  it("reports a protected claim lifecycle as a held staff-review exception", async () => {
    mocks.applyOrbitFinancialSnapshot.mockResolvedValue({
      bookingId: 702,
      financialRevision: snapshot.financialRevision,
      idempotent: false,
      stale: false,
      outcome: "held_for_claim_review",
      reason: "A commission claim already exists for this booking.",
      valuesChanged: false,
    });
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: snapshot }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      success: true,
      outcome: "held_for_claim_review",
      valuesChanged: false,
    }));
  });

  it("preserves the legacy commission update shape during the staged rollout", async () => {
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: { bookingId: 702, expectedCommission: 178.45, marginPct: 17.33 } }, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.updateBookingAdminFields).toHaveBeenCalledWith(702, { expectedCommission: 178.45, orbitMarginPct: 17.33 });
  });

  it("does not let the legacy commission-only payload rewrite a claimed booking", async () => {
    mocks.getCommissionClaimByBooking.mockResolvedValue({ id: 99, status: "awaiting_payment" });
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: { bookingId: 702, expectedCommission: 178.45 } }, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual(expect.objectContaining({ outcome: "held_for_claim_review" }));
    expect(mocks.updateBookingAdminFields).not.toHaveBeenCalled();
  });
});
