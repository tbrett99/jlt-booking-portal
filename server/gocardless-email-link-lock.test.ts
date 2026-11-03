import { describe, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ getRawDbPool: vi.fn(() => { throw new Error("No live database allowed"); }) }));
import { withGoCardlessEmailLinkLock } from "./gocardless-email-link-lock";
function setup(acquired: number | null = 1, release: number | Error = 1) {
  const sequence: string[] = [];
  const connection = { query: vi.fn(async (query: string, params: unknown[]) => {
    expect(params[0]).toBe("jlt-gc-email-links");
    if (query.includes("GET_LOCK")) { sequence.push("acquire"); return [[{ acquired }]]; }
    sequence.push("unlock"); if (release instanceof Error) throw release;
    return [[{ released: release }]];
  }), release: vi.fn(() => sequence.push("pool-release")), destroy: vi.fn(() => sequence.push("destroy")) };
  const pool = { getConnection: vi.fn(async () => connection) };
  const database = { transaction: true };
  const dependencies = { pool, makeDatabase: vi.fn((actual: unknown) => { expect(actual).toBe(connection); return database; }) };
  return { sequence, connection, database, dependencies };
}
describe("GoCardless email-link connection lease", () => {
  it("keeps the dedicated identity lock until the transaction commit has completed", async () => {
    const s = setup();
    const result = await withGoCardlessEmailLinkLock(async db => {
      expect(db).toBe(s.database); s.sequence.push("transaction"); await Promise.resolve(); s.sequence.push("commit"); return "linked";
    }, s.dependencies);
    expect(result).toBe("linked"); expect(s.sequence).toEqual(["acquire", "transaction", "commit", "unlock", "pool-release"]);
  });
  it.each([0, null])("performs no work when the shared identity lock is unavailable (%s)", async acquired => {
    const s = setup(acquired); const work = vi.fn();
    await expect(withGoCardlessEmailLinkLock(work, s.dependencies)).rejects.toThrow("Another GoCardless link");
    expect(work).not.toHaveBeenCalled(); expect(s.sequence).toEqual(["acquire", "pool-release"]);
  });
  it("releases its lock after transaction rollback while preserving the error", async () => {
    const s = setup();
    await expect(withGoCardlessEmailLinkLock(async () => { s.sequence.push("rollback"); throw new Error("ownership conflict"); }, s.dependencies)).rejects.toThrow("ownership conflict");
    expect(s.sequence).toEqual(["acquire", "rollback", "unlock", "pool-release"]);
  });
  it.each([0, new Error("release failed")])("destroys a session whose lock release is not acknowledged", async release => {
    const s = setup(1, release);
    await expect(withGoCardlessEmailLinkLock(async () => "committed", s.dependencies)).resolves.toBe("committed");
    expect(s.connection.destroy).toHaveBeenCalledOnce(); expect(s.connection.release).not.toHaveBeenCalled();
  });
  it("serialises competing staff actions using the same server-scoped lock", async () => {
    let held = false; let wake: () => void = () => undefined;
    let finishFirst: () => void = () => undefined;
    const firstWork = new Promise<void>(resolve => { finishFirst = resolve; });
    const sequence: string[] = [];
    const pool = { getConnection: async () => ({ query: async (query: string) => {
      if (query.includes("GET_LOCK")) {
        if (held) await new Promise<void>(resolve => { wake = resolve; });
        held = true; return [[{ acquired: 1 }]];
      }
      held = false; wake(); return [[{ released: 1 }]];
    }, release: () => undefined, destroy: () => undefined }) };
    const deps = { pool, makeDatabase: () => ({}) };
    const first = withGoCardlessEmailLinkLock(async () => { sequence.push("first-lock"); await firstWork; sequence.push("first-commit"); }, deps);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const second = withGoCardlessEmailLinkLock(async () => { sequence.push("second-check-owner"); }, deps);
    await Promise.resolve(); expect(sequence).not.toContain("second-check-owner");
    finishFirst(); await Promise.all([first, second]);
    expect(sequence).toEqual(["first-lock", "first-commit", "second-check-owner"]);
  });
});
