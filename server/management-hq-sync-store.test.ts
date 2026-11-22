import { afterEach, describe, expect, it, vi } from "vitest";
import { createHqImplementedSampleSyncStore } from "./management-hq-store";
import {
  createHqImplementedEngine,
  type HqImplementedSyncState,
} from "./management-hq-ingestion";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
const actor = { id: 47, role: "super_admin" };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function offlinePool() {
  const rows = new Map<
    string,
    { owner: number; version: number; state: string }
  >();
  const trace: { sql: string; args: unknown[] }[] = [];
  let active = true;
  const pool: any = {
    execute: vi.fn(async (sql: string, args: any[]) => {
      trace.push({ sql, args });
      const row = rows.get(args[0]);
      return [
        row && row.owner === args[1]
          ? [
              {
                state: row.state,
                stateVersion: row.version,
                updatedAt: "2026-11-22T12:00:00Z",
              },
            ]
          : [],
      ];
    }),
    async getConnection() {
      let draft: Map<string, { owner: number; version: number; state: string }>;
      return {
        async beginTransaction() {
          draft = new Map(
            Array.from(rows.entries()).map(([k, v]) => [k, clone(v)])
          );
        },
        async execute(sql: string, args: any[]) {
          trace.push({ sql, args });
          if (sql.startsWith("SELECT id,role"))
            return [
              [
                {
                  id: args[0],
                  role: "super_admin",
                  isActive: active ? 1 : 0,
                  portalStatus: "active",
                },
              ],
            ];
          if (sql.startsWith("INSERT IGNORE")) {
            if (draft.has(args[0])) return [{ affectedRows: 0 }];
            draft.set(args[0], { owner: args[1], version: 1, state: args[2] });
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith("UPDATE management_hq_datasets")) {
            const row = draft.get(args[1]);
            if (!row || row.owner !== args[2] || row.version !== args[3])
              return [{ affectedRows: 0 }];
            draft.set(args[1], {
              ...row,
              version: row.version + 1,
              state: args[0],
            });
            return [{ affectedRows: 1 }];
          }
          throw new Error("Unexpected offline SQL");
        },
        async commit() {
          rows.clear();
          for (const [k, v] of Array.from(draft.entries()))
            rows.set(k, clone(v));
        },
        async rollback() {},
        release() {},
      };
    },
  };
  return {
    pool,
    rows,
    trace,
    revoke() {
      active = false;
    },
  };
}
afterEach(() => vi.unstubAllEnvs());
describe("implemented adapter durable staging through offline SQL CAS", () => {
  it("stores staging and publication atomically in a separate actor-owned sample-sync dataset", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const fixture = offlinePool(),
      store = createHqImplementedSampleSyncStore(fixture.pool, actor);
    const result = await createHqImplementedEngine(
      createHqImplementedSampleReader("initial"),
      store
    ).backfill();
    expect(result.status).toBe("applied");
    const saved = (await store.readSync())!;
    expect(saved.version).toBe(5);
    expect(saved.published?.version).toBe(1);
    expect(saved.stage).toBeNull();
    expect(Array.from(fixture.rows.keys())).toEqual(["sample-sync:47"]);
    expect(
      fixture.trace.every(
        t =>
          !/bookings|payments|commissions|agent_crm_profiles|UPDATE users/.test(
            t.sql
          )
      )
    ).toBe(true);
    expect(
      fixture.trace.filter(
        t => t.sql.startsWith("INSERT") || t.sql.startsWith("UPDATE")
      )
    ).toHaveLength(5);
  });
  it("reconstructs the durable store after interruption and does not refetch already applied bookings", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const fixture = offlinePool(),
      store = createHqImplementedSampleSyncStore(fixture.pool, actor);
    await createHqImplementedEngine(
      createHqImplementedSampleReader("initial"),
      store
    ).backfill();
    const before = (await store.readSync())!.published;
    const reader = createHqImplementedSampleReader("amended");
    const interrupted = {
      ...reader,
      async businessMappings() {
        throw Object.assign(new Error("offline temporary failure"), {
          code: "UNAVAILABLE",
        });
      },
    };
    expect(
      (await createHqImplementedEngine(interrupted, store).backfill()).status
    ).toBe("unavailable");
    const staged = (await store.readSync())!;
    expect(staged.published).toEqual(before);
    expect(staged.stage?.phase).toBe("business");
    expect(staged.stage?.pendingResumeCursor).not.toBe(before!.resumeCursor);
    const recreated = createHqImplementedSampleSyncStore(fixture.pool, actor),
      bookings = vi.spyOn(reader, "bookings");
    expect(
      (await createHqImplementedEngine(reader, recreated).backfill()).status
    ).toBe("applied");
    expect(bookings).not.toHaveBeenCalled();
    expect((await recreated.readSync())!.published!.metadata.generationId).toBe(
      2
    );
  });
  it("keeps another actor unable to read this actor’s staged or published dataset", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const fixture = offlinePool(),
      first = createHqImplementedSampleSyncStore(fixture.pool, actor);
    await createHqImplementedEngine(
      createHqImplementedSampleReader("initial"),
      first
    ).backfill();
    expect(
      await createHqImplementedSampleSyncStore(fixture.pool, {
        ...actor,
        id: 48,
      }).readSync()
    ).toBeNull();
    expect(fixture.trace.at(-1)?.args).toEqual(["sample-sync:48", 48]);
  });
  it("checks the fresh locked actor before each persisted stage and rolls back revoked authority", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const fixture = offlinePool();
    fixture.revoke();
    const result = await createHqImplementedEngine(
      createHqImplementedSampleReader("initial"),
      createHqImplementedSampleSyncStore(fixture.pool, actor)
    ).backfill();
    expect(result.status).toBe("unavailable");
    expect(fixture.rows.size).toBe(0);
    expect(fixture.trace.some(t => t.sql.startsWith("INSERT"))).toBe(false);
    expect(fixture.trace.some(t => t.sql.includes("FOR UPDATE"))).toBe(true);
  });
  it("refuses production writes even if the sample environment flag is enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fixture = offlinePool();
    const result = await createHqImplementedEngine(
      createHqImplementedSampleReader("initial"),
      createHqImplementedSampleSyncStore(fixture.pool, actor)
    ).backfill();
    expect(result.status).toBe("unavailable");
    expect(fixture.rows.size).toBe(0);
    expect(fixture.trace.some(t => t.sql.startsWith("INSERT"))).toBe(false);
  });
  it("rejects an inner/container version mismatch and stale CAS without overwriting a newer checkpoint", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const fixture = offlinePool(),
      store = createHqImplementedSampleSyncStore(fixture.pool, actor);
    await createHqImplementedEngine(
      createHqImplementedSampleReader("initial"),
      store
    ).backfill();
    const current = (await store.readSync())!;
    await expect(
      store.compareAndSwapSync(current.version, {
        ...current,
        version: current.version + 2,
      })
    ).rejects.toThrow("CAS version");
    expect(await store.compareAndSwapSync(1, { ...current, version: 2 })).toBe(
      false
    );
    expect(await store.readSync()).toEqual(current);
    const row = fixture.rows.get("sample-sync:47")!;
    row.state = JSON.stringify({ ...current, version: 99 });
    await expect(store.readSync()).rejects.toThrow("sync version");
  });
  it("bounds a pending container before any SQL write and does not publish truncation", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const fixture = offlinePool();
    const result = await createHqImplementedEngine(
      createHqImplementedSampleReader("initial"),
      createHqImplementedSampleSyncStore(fixture.pool, actor),
      { maxStateBytes: 100 }
    ).backfill();
    expect(result).toMatchObject({ code: "STATE_BYTE_CAP_EXCEEDED" });
    expect(fixture.rows.size).toBe(0);
    expect(fixture.trace.some(t => t.sql.startsWith("INSERT"))).toBe(false);
  });
});
