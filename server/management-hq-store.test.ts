import { afterEach, describe, expect, it, vi } from "vitest";
import { createHqSampleStore, hqSampleEnabled, requireFreshHqSuperAdmin } from "./management-hq-store";
const actor = { id: 47, role: "super_admin" };
function db(rows: any[]) { const query: any = { from: () => query, where: () => query, limit: async () => rows }; return { select: () => query }; }
afterEach(() => vi.unstubAllEnvs());
describe("Management HQ fresh authority and isolation", () => {
  it.each(["agent", "admin", "instructor", "engagement", "user", "business_staff"])("denies %s", async role => { await expect(requireFreshHqSuperAdmin(db([]), { ...actor, role })).rejects.toMatchObject({ code: "FORBIDDEN" }); });
  it("denies no database", async () => { await expect(requireFreshHqSuperAdmin(null, actor)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); });
  it.each([{ id: 47, role: "admin", isActive: true, portalStatus: "active" }, { id: 47, role: "super_admin", isActive: false, portalStatus: "active" }, { id: 47, role: "super_admin", isActive: true, portalStatus: "suspended" }, { id: 48, role: "super_admin", isActive: true, portalStatus: "active" }])("rejects changed authority %j", async row => { await expect(requireFreshHqSuperAdmin(db([row]), actor)).rejects.toMatchObject({ code: "FORBIDDEN" }); });
  it("allows one freshly verified active super admin", async () => { await expect(requireFreshHqSuperAdmin(db([{ ...actor, isActive: true, portalStatus: "active" }]), actor)).resolves.toBeUndefined(); });
  it("keeps sample pilot off in production regardless of flags", () => { vi.stubEnv("NODE_ENV", "production"); expect(hqSampleEnabled()).toBe(false); });
  it("supports explicit sample disable in development", () => { vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("HQ_SAMPLE_PILOT_DISABLED", "1"); expect(hqSampleEnabled()).toBe(false); });
  it("publishes only own synthetic namespace and locks fresh actor before writes", async () => {
    vi.stubEnv("NODE_ENV", "test"); const sqls: { sql: string; args: any[] }[] = [];
    const connection: any = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn(async (sql: string, args: any[]) => { sqls.push({ sql, args }); return sql.startsWith("SELECT") ? [[{ ...actor, isActive: 1, portalStatus: "active" }]] : [{ affectedRows: 1 }]; }) };
    const store = createHqSampleStore({ getConnection: async () => connection } as any, actor);
    expect(await store.publish(null, { version: 1 } as any)).toBe(true);
    expect(sqls[0].sql).toContain("users WHERE id = ? FOR UPDATE");
    expect(sqls[1].sql).toContain("INSERT IGNORE INTO management_hq_datasets");
    expect(sqls[1].args.slice(0, 2)).toEqual(["sample:47", 47]);
    expect(sqls.every(x => !/bookings|payments|commissions|agent_crm_profiles|UPDATE users/.test(x.sql))).toBe(true);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it("rolls back when fresh actor revoked before publish", async () => {
    vi.stubEnv("NODE_ENV", "test"); const connection: any = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn(async () => [[{ ...actor, isActive: 0, portalStatus: "active" }]]) };
    await expect(createHqSampleStore({ getConnection: async () => connection } as any, actor).publish(null, {} as any)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(connection.execute).toHaveBeenCalledOnce(); expect(connection.rollback).toHaveBeenCalledOnce(); expect(connection.commit).not.toHaveBeenCalled(); expect(connection.release).toHaveBeenCalledOnce();
  });
  it("returns lost compare-and-swap without replacing newer generation", async () => {
    vi.stubEnv("NODE_ENV", "test"); const connection: any = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn(async (sql: string) => sql.startsWith("SELECT") ? [[{ ...actor, isActive: 1, portalStatus: "active" }]] : [{ affectedRows: 0 }]) };
    expect(await createHqSampleStore({ getConnection: async () => connection } as any, actor).publish(1, {} as any)).toBe(false);
    expect(connection.execute.mock.calls[1][0]).toContain("AND stateVersion = ?");
  });
});
