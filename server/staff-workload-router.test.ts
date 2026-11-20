import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), summary: vi.fn(), details: vi.fn(), authority: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./staff-workload-report", () => ({ getStaffWorkloadSummary: mocks.summary, getStaffWorkloadDetails: mocks.details }));
vi.mock("./business-staff-access", async original => ({ ...await original<typeof import("./business-staff-access")>(), getBusinessStaffAuthority: mocks.authority }));
import { staffWorkloadRouter, staffWorkloadProcedures } from "./staff-workload-router";
const range = { rangeStart: "2026-11-01", rangeEnd: "2026-11-20" };
function dbFor(fresh: any) {
  const calls: any[] = [];
  return { calls, select: (fields: any) => ({ from: (table: any) => ({ where: (condition: any) => ({ limit: async (size: number) => { calls.push({ fields: Object.keys(fields), table: getTableName(table), condition, size }); return fresh == null ? [] : [fresh]; } }) }) }) };
}
const active = { id: 10, role: "super_admin", isActive: true, portalStatus: "active" };
function caller(patch: any = {}) { return staffWorkloadRouter.createCaller({ user: { ...active, ...patch }, req: {}, res: {} } as unknown as TrpcContext); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.getDb.mockResolvedValue(dbFor(active));
  mocks.authority.mockResolvedValue({ managed: false, active: false, orbitReady: false, owner: null, membership: null });
  mocks.summary.mockResolvedValue({ marker: "summary" }); mocks.details.mockResolvedValue({ marker: "details" });
});
describe("fresh super-admin workload router access", () => {
  it("exports exactly parent-compatible procedures and queries enforce minimal fresh DB user lookup", async () => {
    expect(Object.keys(staffWorkloadProcedures)).toEqual(["workloadSummary", "workloadDetails"]);
    const db = dbFor(active); mocks.getDb.mockResolvedValue(db);
    await expect(caller().workloadSummary(range)).resolves.toMatchObject({ marker: "summary" });
    expect(db.calls).toMatchObject([{ table: "users", fields: ["id", "role", "isActive", "portalStatus"], size: 2 }]);
    expect(mocks.summary).toHaveBeenCalledWith(db, range);
    await expect(caller().workloadDetails({ ...range, domain: "flight", metric: "completed", actorId: null, page: 2, pageSize: 5 })).resolves.toMatchObject({ marker: "details" });
    expect(mocks.details).toHaveBeenCalledWith(db, expect.objectContaining({ actorId: null, page: 2, pageSize: 5 }));
  });
  it.each(["admin", "agent", "employee"])("denies role %s even if database identity is super_admin", async role => {
    await expect(caller({ role }).workloadSummary(range)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.summary).not.toHaveBeenCalled();
  });
  it.each([{ role: "admin" }, { isActive: false }, { isActive: 1 }, { portalStatus: "onboarding" }, { portalStatus: "paused" }, { portalStatus: "suspended" }, { portalStatus: "cancelled" }, { portalStatus: "in_notice" }, { id: 11 }])("denies stale revoked/restricted session using exact fresh role/active/status %j", async patch => {
    mocks.getDb.mockResolvedValue(dbFor({ ...active, ...patch }));
    await expect(caller().workloadSummary(range)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.summary).not.toHaveBeenCalled();
  });
  it("denies absent users, synthetic identities, unavailable DB, and anonymous access", async () => {
    mocks.getDb.mockResolvedValue(dbFor(null)); await expect(caller().workloadSummary(range)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller({ id: -1 }).workloadSummary(range)).rejects.toMatchObject({ code: "FORBIDDEN" });
    mocks.getDb.mockResolvedValue(null); await expect(caller().workloadSummary(range)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    const anonymous = staffWorkloadRouter.createCaller({ user: null, req: {}, res: {} } as unknown as TrpcContext);
    await expect(anonymous.workloadSummary(range)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.summary).not.toHaveBeenCalled();
  });
  it("preserves existing managed business-staff boundary before report access", async () => {
    mocks.authority.mockResolvedValue({ managed: true, active: true, membership: { permissions: { viewBookings: true } } });
    await expect(caller({ role: "agent" }).workloadSummary(range)).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("restricted Business staff") });
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.summary).not.toHaveBeenCalled();
  });
  it("validates leap/day/DST range limits and drill pagination inputs before any report execution", async () => {
    for (const bad of [{ rangeStart: "2026-02-29", rangeEnd: "2026-03-02" }, { rangeStart: "2026-11-20", rangeEnd: "2026-11-20" }, { rangeStart: "2024-01-01", rangeEnd: "2025-01-02" }, { rangeStart: "2099-01-01", rangeEnd: "2099-02-01" }]) await expect(caller().workloadSummary(bad)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().workloadDetails({ ...range, domain: "flight", metric: "completed", pageSize: 101 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().workloadDetails({ ...range, domain: "flight", metric: "completed", actorId: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.summary).not.toHaveBeenCalled(); expect(mocks.details).not.toHaveBeenCalled();
  });
  it("never translates query/cap failures to empty totals and hides raw DB/private error text", async () => {
    mocks.summary.mockRejectedValue(new Error("Staff workload exceeds the safe history limit. No partial totals are shown."));
    await expect(caller().workloadSummary(range)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("No partial totals") });
    mocks.summary.mockRejectedValue(new Error("private database user password failed"));
    await expect(caller().workloadSummary(range)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Staff workload history could not be verified. No partial totals are shown; please retry." });
  });
});
