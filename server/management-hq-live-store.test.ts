import { describe, expect, it, vi } from "vitest";
import {
  createHqLiveConfig,
  type HqLiveConfig,
} from "./management-hq-live-config";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
} from "./management-hq-ingestion";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
import {
  createHqLiveStore,
  HQ_LIVE_CONTROL_DATASET_ID,
  HQ_LIVE_SYNC_DATASET_ID,
  type HqLiveLease,
} from "./management-hq-live-store";
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export function liveConfig(
  overrides: Record<string, string> = {}
): HqLiveConfig {
  return createHqLiveConfig({
    HQ_LIVE_SYNC_ENABLED: "true",
    HQ_LIVE_READ_ENABLED: "true",
    HQ_ORBIT_REPORTING_BASE_URL:
      "https://reporting.orbittravel.co.uk/api/management-hq",
    HQ_ORBIT_REPORTING_API_KEY: "orbit-test-key-not-live-" + "a".repeat(32),
    HQ_PORTAL_SYNC_TOKEN: "portal-test-token-not-live-" + "b".repeat(32),
    ...overrides,
  });
}
/** Model SQL transactions/row lock waits locally. This does NOT establish MySQL concurrency correctness. */
export function offlineLivePool() {
  type Row = {
    datasetId: string;
    mode: string;
    ownerUserId: number;
    stateVersion: number;
    state: string;
    updatedAt: string;
  };
  const rows = new Map<string, Row>();
  const trace: { sql: string; args: any[]; transaction: number }[] = [];
  let clock = Date.parse("2026-11-22T12:00:00Z"),
    tail = Promise.resolve(),
    number = 0;
  const commits = vi.fn(),
    rollbacks = vi.fn();
  let beforeExecute: ((sql: string, args: any[]) => void) | null = null;
  const pool: any = {
    execute: vi.fn(() => {
      throw new Error("queries must use explicit transaction");
    }),
    getConnection: vi.fn(async () => {
      const transaction = ++number;
      let draft: Map<string, Row>,
        unlock = () => {},
        started = false;
      return {
        async beginTransaction() {
          const previous = tail;
          tail = new Promise<void>(resolve => {
            unlock = resolve;
          });
          await previous;
          started = true;
          draft = new Map(Array.from(rows, ([k, v]) => [k, clone(v)]));
        },
        async execute(sql: string, args: any[] = []) {
          if (!started) throw new Error("transaction required");
          beforeExecute?.(sql, args);
          trace.push({ sql, args, transaction });
          if (sql.startsWith("SELECT CAST")) return [[{ nowMs: clock }]];
          if (sql.startsWith("SELECT datasetId"))
            return [draft.has(args[0]) ? [clone(draft.get(args[0]))] : []];
          if (sql.startsWith("INSERT IGNORE")) {
            if (draft.has(args[0])) return [{ affectedRows: 0 }];
            draft.set(args[0], {
              datasetId: args[0],
              mode: "live",
              ownerUserId: 0,
              stateVersion: 1,
              state: args[1],
              updatedAt: new Date(clock).toISOString(),
            });
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith("UPDATE management_hq_datasets")) {
            const row = draft.get(args[2]);
            if (
              !row ||
              row.mode !== "live" ||
              row.ownerUserId !== 0 ||
              row.stateVersion !== args[3]
            )
              return [{ affectedRows: 0 }];
            draft.set(args[2], {
              ...row,
              stateVersion: args[0],
              state: args[1],
              updatedAt: new Date(clock).toISOString(),
            });
            return [{ affectedRows: 1 }];
          }
          throw new Error("unexpected SQL");
        },
        async commit() {
          commits(transaction);
          rows.clear();
          for (const [id, row] of draft) rows.set(id, clone(row));
          started = false;
          unlock();
        },
        async rollback() {
          if (started) {
            rollbacks(transaction);
            started = false;
            unlock();
          }
        },
        release() {
          if (started) {
            started = false;
            unlock();
          }
        },
      };
    }),
  };
  return {
    pool,
    rows,
    trace,
    commits,
    rollbacks,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
    setHook: (hook: typeof beforeExecute) => {
      beforeExecute = hook;
    },
  };
}
async function acquire(
  store: ReturnType<typeof createHqLiveStore>
): Promise<HqLiveLease> {
  const result = await store.acquire();
  expect(result.status).toBe("acquired");
  if (result.status !== "acquired") throw new Error("no lease");
  return result.lease;
}
async function initialSync() {
  const memory = createHqImplementedMemoryStore();
  await createHqImplementedEngine(
    createHqImplementedSampleReader("initial"),
    memory
  ).sync();
  return (await memory.readSync())!;
}
describe("fixed company reporting namespace and SQL guards", () => {
  it("shares company reporting across service instances without user or sample writes", async () => {
    const f = offlineLivePool(),
      config = liveConfig(),
      a = createHqLiveStore(f.pool, config),
      b = createHqLiveStore(f.pool, config);
    f.rows.set("sample-sync:47", {
      datasetId: "sample-sync:47",
      mode: "sample",
      ownerUserId: 47,
      stateVersion: 1,
      state: '{"synthetic":true}',
      updatedAt: "2026-11-22T12:00:00Z",
    });
    const untouched = clone(f.rows.get("sample-sync:47"));
    const lease = await acquire(a);
    const result = await createHqImplementedEngine(
      createHqImplementedSampleReader("initial"),
      a.fencedSyncStore(lease)
    ).sync();
    expect(result.status).toBe("applied");
    await a.complete(lease, { status: "applied", delaySeconds: 300 });
    expect(await a.readPublished()).toEqual(await b.readPublished());
    expect(f.rows.get("sample-sync:47")).toEqual(untouched);
    expect([...f.rows.keys()]).toEqual([
      "sample-sync:47",
      HQ_LIVE_CONTROL_DATASET_ID,
      HQ_LIVE_SYNC_DATASET_ID,
    ]);
    expect(f.rows.get(HQ_LIVE_SYNC_DATASET_ID)).toMatchObject({
      ownerUserId: 0,
      mode: "live",
      stateVersion: 5,
    });
    for (const t of f.trace) {
      expect(t.sql).not.toMatch(
        /(?:\busers\b|\bbookings\b|\bpayments\b|\bcommissions\b)/
      );
      if (t.sql.startsWith("UPDATE"))
        expect(t.sql).toContain(
          "mode = 'live' AND ownerUserId = 0 AND stateVersion = ?"
        );
    }
    expect(f.pool.execute).not.toHaveBeenCalled();
  });
  it("concurrent acquisition serializes one winner and rejects the second as busy", async () => {
    const f = offlineLivePool(),
      a = createHqLiveStore(f.pool, liveConfig()),
      b = createHqLiveStore(f.pool, liveConfig());
    const results = await Promise.all([a.acquire(), b.acquire()]);
    expect(results.map(r => r.status).sort()).toEqual(["acquired", "busy"]);
    expect(
      JSON.parse(f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.state).fencingNumber
    ).toBe(1);
  });
  it("crash expiry grants a new token/fence and rejects every late holder write", async () => {
    const f = offlineLivePool(),
      store = createHqLiveStore(f.pool, liveConfig());
    const first = await acquire(store);
    f.advance(30001);
    const second = await acquire(store);
    expect(second.token).not.toBe(first.token);
    expect(second.fencingNumber).toBe(first.fencingNumber + 1);
    const next = { ...(await initialSync()), version: 1 };
    const before = clone(f.rows.get(HQ_LIVE_CONTROL_DATASET_ID));
    await expect(
      store.fencedSyncStore(first).compareAndSwapSync(null, next)
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
    await expect(store.renew(first)).rejects.toMatchObject({
      code: "LEASE_LOST",
    });
    await expect(
      store.complete(first, { status: "applied", delaySeconds: 300 })
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)).toEqual(before);
    expect(await store.readPublished()).toBeNull();
    expect(
      await store.fencedSyncStore(second).compareAndSwapSync(null, next)
    ).toBe(true);
  });
  it("rechecks database time after the lock and again just before a sync CAS", async () => {
    const f = offlineLivePool(),
      store = createHqLiveStore(f.pool, liveConfig()),
      lease = await acquire(store);
    let clocks = 0;
    f.setHook(sql => {
      if (sql.startsWith("SELECT CAST") && ++clocks === 2) f.advance(30001);
    });
    await expect(
      store
        .fencedSyncStore(lease)
        .compareAndSwapSync(null, { ...(await initialSync()), version: 1 })
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
    f.setHook(null);
    expect(f.rows.has(HQ_LIVE_SYNC_DATASET_ID)).toBe(false);
    const transaction = f.trace
      .filter(t => t.sql.includes("FOR UPDATE"))
      .at(-1)!.transaction;
    const statements = f.trace
      .filter(t => t.transaction === transaction)
      .map(t => t.sql);
    expect(statements[0]).toContain("FOR UPDATE");
    expect(statements.filter(s => s.startsWith("SELECT CAST"))).toHaveLength(2);
  });
  it.each([
    ["INSERT", "staging"],
    ["UPDATE", "staging"],
    ["INSERT", "backfill intent"],
    ["UPDATE", "backfill intent"],
    ["UPDATE", "410 cleanup"],
    ["UPDATE", "publication"],
  ])(
    "rolls back %s %s when the sync write crosses the hard deadline",
    async (sqlKind, kind) => {
      const f = offlineLivePool(),
        store = createHqLiveStore(f.pool, liveConfig()),
        lease = await acquire(store),
        fenced = store.fencedSyncStore(lease);
      const memory = createHqImplementedMemoryStore();
      let remaining = 3;
      await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        memory,
        { shouldContinue: () => remaining-- > 0 }
      ).backfill();
      const staged = (await memory.readSync())!;
      const current = sqlKind === "UPDATE" ? staged : null;
      if (current)
        expect(await fenced.compareAndSwapSync(null, current)).toBe(true);
      const next = clone(staged);
      next.version = (current?.version ?? 0) + 1;
      if (kind === "backfill intent") {
        next.stage = {
          ...next.stage!,
          phase: "bookings",
          metadata: null,
          pendingResumeCursor: null,
          entities: {},
          seqProofs: {},
          feedKeys: { booking: [], business: [] },
          catalogueKeys: { booking: [], business: [] },
          cursors: [],
          pages: 0,
          recordsRead: 0,
        };
      } else if (kind === "410 cleanup") next.stage = null;
      else if (kind === "publication") {
        next.published = (await initialSync()).published;
        next.stage = null;
      }
      const before = clone([...f.rows]),
        commits = f.commits.mock.calls.length;
      let writes = 0;
      f.setHook((sql, args) => {
        if (
          sql.startsWith(sqlKind) &&
          args[sqlKind === "INSERT" ? 0 : 2] === HQ_LIVE_SYNC_DATASET_ID
        ) {
          writes++;
          f.advance(95001);
        }
      });
      await expect(
        fenced.compareAndSwapSync(current?.version ?? null, next)
      ).rejects.toMatchObject({ code: "LEASE_LOST" });
      expect(writes).toBe(1);
      expect(clone([...f.rows])).toEqual(before);
      expect(f.commits).toHaveBeenCalledTimes(commits);
      expect(f.rollbacks).toHaveBeenCalledOnce();
    }
  );
  it("bounded renewal cannot extend a holder past its hard expiry", async () => {
    const f = offlineLivePool(),
      store = createHqLiveStore(f.pool, liveConfig()),
      lease = await acquire(store);
    for (let i = 0; i < 4; i++) {
      f.advance(20000);
      await store.renew(lease);
    }
    expect(
      JSON.parse(f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.state).leaseExpiresAtMs
    ).toBe(lease.hardExpiresAtMs);
    f.advance(15000);
    await expect(store.renew(lease)).rejects.toMatchObject({
      code: "LEASE_LOST",
    });
  });
  it("source key/origin binding drift fails closed without clearing existing cursors", async () => {
    const f = offlineLivePool(),
      first = createHqLiveStore(f.pool, liveConfig()),
      lease = await acquire(first);
    await createHqImplementedEngine(
      createHqImplementedSampleReader("initial"),
      first.fencedSyncStore(lease)
    ).sync();
    await first.complete(lease, { status: "applied", delaySeconds: 300 });
    const before = clone([...f.rows]);
    for (const config of [
      liveConfig({
        HQ_ORBIT_REPORTING_BASE_URL:
          "https://other.orbittravel.co.uk/reporting",
      }),
      liveConfig({
        HQ_ORBIT_REPORTING_API_KEY: "changed-key-" + "z".repeat(40),
      }),
    ]) {
      const changed = createHqLiveStore(f.pool, config);
      await expect(changed.acquire()).rejects.toMatchObject({
        code: "SOURCE_BINDING_CHANGED",
      });
      await expect(changed.readPublished()).rejects.toMatchObject({
        code: "SOURCE_BINDING_CHANGED",
      });
    }
    expect(clone([...f.rows])).toEqual(before);
  });
  it("rejects changed service binding, and DB stolen fence, even before lease expiry", async () => {
    const f = offlineLivePool();
    let config = liveConfig();
    const dynamic: HqLiveConfig = {
      status: () => config.status(),
      sourceFingerprint: () => config.sourceFingerprint(),
      authorizeTrigger: t => config.authorizeTrigger(t),
      createReader: () => config.createReader(),
    };
    const store = createHqLiveStore(f.pool, dynamic),
      lease = await acquire(store),
      next = { ...(await initialSync()), version: 1 };
    config = liveConfig({
      HQ_ORBIT_REPORTING_API_KEY: "changed-key-" + "z".repeat(40),
    });
    await expect(
      store.fencedSyncStore(lease).compareAndSwapSync(null, next)
    ).rejects.toMatchObject({ code: "SOURCE_BINDING_CHANGED" });
    config = liveConfig();
    const row = f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!,
      c = JSON.parse(row.state);
    c.fencingNumber++;
    row.state = JSON.stringify(c);
    await expect(
      store.complete(lease, { status: "progress", delaySeconds: 60 })
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
  });
  it("rejects sample-mode collision at a reserved ID without overwriting or granting authority", async () => {
    const f = offlineLivePool(),
      store = createHqLiveStore(f.pool, liveConfig());
    f.rows.set(HQ_LIVE_CONTROL_DATASET_ID, {
      datasetId: HQ_LIVE_CONTROL_DATASET_ID,
      mode: "sample",
      ownerUserId: 47,
      stateVersion: 1,
      state: "{}",
      updatedAt: "2026-11-22T12:00:00Z",
    });
    const before = clone([...f.rows]);
    await expect(store.acquire()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_STATE",
    });
    expect(clone([...f.rows])).toEqual(before);
  });
  it.each([
    "envelope",
    "version",
    "canonical",
    "metadata",
    "stage",
    "bytes",
    "control",
  ])(
    "corrupt %s fails closed on BOTH consumption and acquisition",
    async corruption => {
      const f = offlineLivePool(),
        store = createHqLiveStore(f.pool, liveConfig()),
        lease = await acquire(store);
      await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        store.fencedSyncStore(lease)
      ).sync();
      await store.complete(lease, { status: "applied", delaySeconds: 300 });
      const row = f.rows.get(HQ_LIVE_SYNC_DATASET_ID)!,
        envelope = JSON.parse(row.state);
      if (corruption === "envelope") envelope.format = "old";
      if (corruption === "version") envelope.sync.version++;
      if (corruption === "canonical")
        envelope.sync.published.entities["booking:1"].canonicalPayload = "{}";
      if (corruption === "metadata")
        envelope.sync.published.metadata.sourceObservationWindow.to = "garbage";
      if (corruption === "stage") envelope.sync.stage = { phase: "bookings" };
      row.state =
        corruption === "bytes"
          ? "x".repeat(16 * 1024 * 1024 + 1)
          : JSON.stringify(envelope);
      if (corruption === "control") {
        const c = f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!;
        c.state = c.state.replace('"fencingNumber":1', '"fencingNumber":-1');
      }
      await expect(store.readPublished()).rejects.toMatchObject({
        code: "INVALID_PERSISTED_STATE",
      });
      await expect(store.acquire()).rejects.toMatchObject({
        code: "INVALID_PERSISTED_STATE",
      });
    }
  );
  it("successful unchanged checks advance lastSuccess but not actual publication time", async () => {
    const f = offlineLivePool(),
      store = createHqLiveStore(f.pool, liveConfig());
    let lease = await acquire(store);
    await createHqImplementedEngine(
      createHqImplementedSampleReader("initial"),
      store.fencedSyncStore(lease)
    ).sync();
    await store.complete(lease, { status: "applied", delaySeconds: 300 });
    const before = await store.readSnapshot();
    f.advance(300000);
    lease = await acquire(store);
    const unchanged = await createHqImplementedEngine(
      createHqImplementedSampleReader("initial"),
      store.fencedSyncStore(lease)
    ).sync();
    expect(unchanged).toMatchObject({ status: "applied", unchanged: true });
    await store.complete(lease, { status: "applied", delaySeconds: 300 });
    const after = await store.readSnapshot();
    expect(after.control?.lastPublishAtMs).toBe(
      before.control?.lastPublishAtMs
    );
    expect(after.control?.lastSuccessAtMs).toBe(f.now());
  });
  it("orphaned sync cannot silently create fresh control authority or reset fences", async () => {
    const f = offlineLivePool(),
      store = createHqLiveStore(f.pool, liveConfig()),
      lease = await acquire(store);
    await createHqImplementedEngine(
      createHqImplementedSampleReader("initial"),
      store.fencedSyncStore(lease)
    ).sync();
    f.rows.delete(HQ_LIVE_CONTROL_DATASET_ID);
    const before = clone([...f.rows]);
    await expect(store.acquire()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_STATE",
    });
    await expect(store.readPublished()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_STATE",
    });
    expect(clone([...f.rows])).toEqual(before);
  });
  it("expired lease rejects final publication CAS, leaving complete staging resumable by successor", async () => {
    const f = offlineLivePool(),
      store = createHqLiveStore(f.pool, liveConfig()),
      lease = await acquire(store),
      base = store.fencedSyncStore(lease);
    const guarded = {
      ...base,
      async compareAndSwapSync(expected: number | null, next: any) {
        if (next.stage === null) f.advance(30001);
        return base.compareAndSwapSync(expected, next);
      },
    };
    expect(
      await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        guarded
      ).sync()
    ).toMatchObject({ status: "unavailable", code: "LEASE_LOST" });
    const staged = (await store.readSnapshot()).sync!;
    expect(staged.stage?.phase).toBe("finish");
    expect(staged.published).toBeNull();
    const successor = await acquire(store);
    expect(
      (
        await createHqImplementedEngine(
          createHqImplementedSampleReader("initial"),
          store.fencedSyncStore(successor)
        ).sync()
      ).status
    ).toBe("applied");
    expect((await store.readPublished())?.version).toBe(1);
  });
});
