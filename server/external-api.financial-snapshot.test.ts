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
    updateBookingAdminFields: vi.fn(),
    getOrbitFinancialSnapshotByBooking: vi.fn(),
    createOrbitFinancialSnapshot: vi.fn(),
    updateOrbitFinancialSnapshot: vi.fn(),
  };
});

vi.mock("./db", () => ({
  getDb: vi.fn(async () => mocks.db),
  createBooking: vi.fn(),
  updateBookingAdminFields: mocks.updateBookingAdminFields,
  getBookingById: mocks.getBookingById,
  getOrbitFinancialSnapshotByBooking: mocks.getOrbitFinancialSnapshotByBooking,
  createOrbitFinancialSnapshot: mocks.createOrbitFinancialSnapshot,
  updateOrbitFinancialSnapshot: mocks.updateOrbitFinancialSnapshot,
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
    mocks.getBookingById.mockResolvedValue({ id: 702, crmRef: "JLT-1234" });
  });

  it("stores a complete snapshot containing a valid £0.00 total net cost", async () => {
    mocks.getOrbitFinancialSnapshotByBooking.mockResolvedValue(undefined);
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: { ...snapshot, totalNetCost: 0, netCostSubtotal: 0, grossMargin: 1500, marginPct: 100, expectedCommission: 1200 } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, bookingId: 702, financialRevision: snapshot.financialRevision });
    expect(mocks.createOrbitFinancialSnapshot).toHaveBeenCalledWith(expect.objectContaining({ totalNetCost: "0", netCostStatus: "complete", missingNetCostProducts: 0 }));
  });

  it("treats a repeated revision as idempotent without storing another history record", async () => {
    mocks.getOrbitFinancialSnapshotByBooking.mockResolvedValue({ id: 91, financialRevision: snapshot.financialRevision, financialSnapshotAt: new Date(snapshot.financialSnapshotAt) });
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: snapshot }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, idempotent: true, bookingId: 702, financialRevision: snapshot.financialRevision });
    expect(mocks.createOrbitFinancialSnapshot).not.toHaveBeenCalled();
    expect(mocks.updateOrbitFinancialSnapshot).not.toHaveBeenCalled();
  });

  it("replaces a stored snapshot only when Orbit sends a newer revision", async () => {
    mocks.getOrbitFinancialSnapshotByBooking.mockResolvedValue({ id: 91, financialRevision: "b".repeat(64), financialSnapshotAt: new Date("2026-09-17T10:00:00.000Z") });
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: snapshot }, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.updateOrbitFinancialSnapshot).toHaveBeenCalledWith(91, expect.objectContaining({ financialRevision: snapshot.financialRevision, totalNetCost: "1240" }));
  });

  it("does not roll the displayed values backwards when an older snapshot arrives", async () => {
    mocks.getOrbitFinancialSnapshotByBooking.mockResolvedValue({ id: 91, financialRevision: "b".repeat(64), financialSnapshotAt: new Date("2026-09-17T11:00:00.000Z") });
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: snapshot }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, stale: true, bookingId: 702, financialRevision: "b".repeat(64) });
    expect(mocks.updateOrbitFinancialSnapshot).not.toHaveBeenCalled();
  });

  it("preserves the legacy commission update shape during the staged rollout", async () => {
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: { bookingId: 702, expectedCommission: 178.45, marginPct: 17.33 } }, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.updateBookingAdminFields).toHaveBeenCalledWith(702, { expectedCommission: 178.45, orbitMarginPct: 17.33 });
  });
});
