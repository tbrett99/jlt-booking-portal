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
  HqLiveError,
  HQ_LIVE_CONTROL_DATASET_ID,
  HQ_LIVE_SYNC_DATASET_ID,
  type HqLiveControl,
} from "./management-hq-live-store";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const MAX_VERSION = 2_147_483_646;
function reportingConfig(overrides: Record<string, string> = {}) {
  return createHqLiveConfig({
    HQ_LIVE_SYNC_ENABLED: "true",
    HQ_LIVE_READ_ENABLED: "false",
    HQ_ORBIT_REPORTING_BASE_URL:
      "https://reporting.orbittravel.co.uk/api/management-hq",
    HQ_ORBIT_REPORTING_API_KEY: "offline-reporting-key-" + "a".repeat(40),
    HQ_PORTAL_SYNC_TOKEN: "offline-portal-token-" + "b".repeat(40),
    ...overrides,
  });
}
interface OfflineRow {
  datasetId: string;
  mode: string;
  ownerUserId: number;
  stateVersion: number;
  state: string;
  updatedAt: string;
}
/** Offline transactional drafts model rollback and lock waits, not MySQL concurrency correctness. */
function offlineRecoveryPool() {
  const rows = new Map<string, OfflineRow>();
  const trace: { sql: string; args: unknown[]; transaction: number }[] = [];
  const commits = vi.fn(),
    rollbacks = vi.fn();
  let clock = Date.parse("2026-11-24T19:00:00Z"),
    number = 0;
  let tail = Promise.resolve();
  let beforeExecute:
    | ((sql: string, args: any[]) => void | Promise<void>)
    | null = null;
  let afterExecute:
    | ((sql: string, args: any[]) => void | Promise<void>)
    | null = null;
  let onBegin: (() => void | Promise<void>) | null = null;
  let updateAffectedRows = 1;
  const pool: any = {
    execute: vi.fn(() => {
      throw new Error("explicit transaction required");
    }),
    getConnection: vi.fn(async () => {
      const transaction = ++number;
      let draft: Map<string, OfflineRow>,
        started = false;
      let unlock = () => {};
      return {
        async beginTransaction() {
          const previous = tail;
          tail = new Promise<void>(resolve => {
            unlock = resolve;
          });
          await previous;
          started = true;
          draft = new Map(Array.from(rows, ([key, row]) => [key, clone(row)]));
          await onBegin?.();
        },
        async execute(sql: string, args: any[] = []) {
          if (!started) throw new Error("transaction required");
          trace.push({ sql, args: clone(args), transaction });
          await beforeExecute?.(sql, args);
          let result: any;
          if (sql.startsWith("SELECT CAST")) result = [[{ nowMs: clock }]];
          else if (sql.startsWith("SELECT datasetId"))
            result = [draft.has(args[0]) ? [clone(draft.get(args[0]))] : []];
          else if (sql.startsWith("INSERT IGNORE")) {
            if (draft.has(args[0])) result = [{ affectedRows: 0 }];
            else {
              draft.set(args[0], {
                datasetId: args[0],
                mode: "live",
                ownerUserId: 0,
                stateVersion: 1,
                state: args[1],
                updatedAt: new Date(clock).toISOString(),
              });
              result = [{ affectedRows: 1 }];
            }
          } else if (sql.startsWith("UPDATE management_hq_datasets")) {
            const row = draft.get(args[2]);
            if (
              !row ||
              row.mode !== "live" ||
              row.ownerUserId !== 0 ||
              row.stateVersion !== args[3] ||
              updateAffectedRows !== 1
            )
              result = [{ affectedRows: 0 }];
            else {
              draft.set(args[2], {
                ...row,
                stateVersion: args[0],
                state: args[1],
                updatedAt: new Date(clock).toISOString(),
              });
              result = [{ affectedRows: 1 }];
            }
          } else throw new Error("unexpected SQL");
          await afterExecute?.(sql, args);
          return result;
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
    setClock: (ms: number) => {
      clock = ms;
    },
    before: (hook: typeof beforeExecute) => {
      beforeExecute = hook;
    },
    after: (hook: typeof afterExecute) => {
      afterExecute = hook;
    },
    onBegin: (hook: typeof onBegin) => {
      onBegin = hook;
    },
    setAffectedRows: (n: number) => {
      updateAffectedRows = n;
    },
  };
}
function fixture() {
  const db = offlineRecoveryPool();
  let current = reportingConfig();
  const config: HqLiveConfig = {
    status: () => current.status(),
    sourceFingerprint: () => current.sourceFingerprint(),
    authorizeTrigger: token => current.authorizeTrigger(token),
    createReader: () => {
      throw new Error("recovery must never construct a provider reader");
    },
  };
  const store = createHqLiveStore(db.pool, config);
  const initial: HqLiveControl = {
    format: "hq-live-control-v1",
    version: 3,
    sourceFingerprint: config.sourceFingerprint()!,
    fencingNumber: 1,
    leaseToken: null,
    leaseExpiresAtMs: null,
    leaseHardExpiresAtMs: null,
    nextDueAtMs: db.now(),
    consecutiveFailures: 1,
    lastAttemptAtMs: db.now() - 300000,
    lastSuccessAtMs: null,
    lastPublishAtMs: null,
    lastErrorCode: "INVALID_SEMANTICS",
    stageStatus: "needs_attention",
  };
  db.rows.set(HQ_LIVE_CONTROL_DATASET_ID, {
    datasetId: HQ_LIVE_CONTROL_DATASET_ID,
    mode: "live",
    ownerUserId: 0,
    stateVersion: initial.version,
    state: JSON.stringify(initial),
    updatedAt: "2026-11-24T18:55:00.000Z",
  });
  db.rows.set("sample-sync:47", {
    datasetId: "sample-sync:47",
    mode: "sample",
    ownerUserId: 47,
    stateVersion: 1,
    state: '{"synthetic":true}',
    updatedAt: "2026-11-24T18:00:00.000Z",
  });
  const authority = vi.fn(async () => {});
  return {
    ...db,
    store,
    config,
    initial,
    authority,
    recover: (version = 3, guard = authority) =>
      store.recoverEmptyInitialImport!(version, guard),
    changeConfig: (replacement: HqLiveConfig) => {
      current = replacement;
    },
    control: (): HqLiveControl =>
      JSON.parse(db.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.state),
    patchControl: (patch: Partial<HqLiveControl>) => {
      const row = db.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!;
      const control = { ...JSON.parse(row.state), ...patch };
      row.stateVersion = control.version;
      row.state = JSON.stringify(control);
    },
  };
}
function physicalSync(
  f: ReturnType<typeof fixture>,
  state: unknown,
  overrides: Partial<OfflineRow> = {}
) {
  f.rows.set(HQ_LIVE_SYNC_DATASET_ID, {
    datasetId: HQ_LIVE_SYNC_DATASET_ID,
    mode: "live",
    ownerUserId: 0,
    stateVersion: 1,
    state: typeof state === "string" ? state : JSON.stringify(state),
    updatedAt: "2026-11-24T18:55:00.000Z",
    ...overrides,
  });
}
function expectOnlyReportingSql(
  f: ReturnType<typeof fixture>,
  recoveryOnly = true
) {
  for (const entry of f.trace) {
    expect(entry.sql).not.toMatch(
      /\b(?:users|bookings|payments|commissions|amendments|invoices|departures)\b/i
    );
    expect(entry.sql).not.toMatch(
      /\b(?:DELETE|REPLACE|ALTER|DROP|TRUNCATE)\b/i
    );
    if (entry.sql.startsWith("SELECT CAST")) continue;
    expect(entry.sql).toContain("management_hq_datasets");
    if (entry.sql.startsWith("UPDATE")) {
      expect(entry.sql).toContain(
        "mode = 'live' AND ownerUserId = 0 AND stateVersion = ?"
      );
      if (recoveryOnly) expect(entry.args[2]).toBe(HQ_LIVE_CONTROL_DATASET_ID);
    } else if (recoveryOnly) {
      expect(entry.sql).toMatch(/^SELECT datasetId/);
      expect([HQ_LIVE_CONTROL_DATASET_ID, HQ_LIVE_SYNC_DATASET_ID]).toContain(
        entry.args[0]
      );
    }
  }
  expect(f.pool.execute).not.toHaveBeenCalled();
}
async function unchangedStatus(
  f: ReturnType<typeof fixture>,
  status: string,
  version = 3
) {
  const before = clone([...f.rows]);
  expect(await f.recover(version)).toBe(status);
  expect(clone([...f.rows])).toEqual(before);
  expect(f.trace.filter(t => t.sql.startsWith("UPDATE"))).toHaveLength(0);
  expectOnlyReportingSql(f);
}
async function unchangedError(f: ReturnType<typeof fixture>, code: string) {
  const before = clone([...f.rows]);
  await expect(f.recover()).rejects.toMatchObject({ code });
  expect(clone([...f.rows])).toEqual(before);
  expect(f.commits).not.toHaveBeenCalled();
  expectOnlyReportingSql(f);
}

describe("protected physical-empty initial import recovery: actual SQL store", () => {
  it("performs one control CAS, preserves failure history/source, fences holders, and uses DB time", async () => {
    const f = fixture(),
      sample = clone(f.rows.get("sample-sync:47"));
    expect(await f.recover()).toBe("recovered");
    expect(f.control()).toEqual({
      ...f.initial,
      version: 4,
      fencingNumber: 2,
      stageStatus: "idle",
      lastErrorCode: null,
      nextDueAtMs: f.now(),
      initialRecovery: {
        format: "empty-initial-recovery-v1",
        atMs: f.now(),
        fromControlVersion: 3,
        previousErrorCode: "INVALID_SEMANTICS",
        previousAttemptAtMs: f.initial.lastAttemptAtMs,
      },
    });
    expect(f.rows.get("sample-sync:47")).toEqual(sample);
    expect(f.rows.has(HQ_LIVE_SYNC_DATASET_ID)).toBe(false);
    expect(f.authority).toHaveBeenCalledTimes(7);
    expect(f.trace.filter(t => t.sql.startsWith("UPDATE"))).toHaveLength(1);
    expect(f.trace[0].sql).toContain("FOR UPDATE");
    expect(f.trace[1].sql).toMatch(/^SELECT CAST/);
    expect(f.commits).toHaveBeenCalledOnce();
    expect(f.rollbacks).not.toHaveBeenCalled();
    expectOnlyReportingSql(f);
    const oldLease = {
      token: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      fencingNumber: 1,
      sourceFingerprint: f.initial.sourceFingerprint,
      hardExpiresAtMs: f.now() + 95000,
    };
    await expect(f.store.renew(oldLease)).rejects.toMatchObject({
      code: "LEASE_LOST",
    });
    await expect(
      f.store.complete(oldLease, { status: "applied", delaySeconds: 300 })
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
  });

  it("is one-shot under repetition, concurrency, and a second identical attention failure", async () => {
    const f = fixture();
    const results = await Promise.all([f.recover(), f.recover()]);
    expect(results.sort()).toEqual(["not_recoverable", "recovered"]);
    const marker = clone(f.control().initialRecovery);
    expect(await f.recover(4)).toBe("not_recoverable");
    f.patchControl({
      version: 5,
      stageStatus: "needs_attention",
      lastErrorCode: "INVALID_SEMANTICS",
      consecutiveFailures: 1,
    });
    const before = clone([...f.rows]);
    expect(await f.recover(5)).toBe("not_recoverable");
    expect(clone([...f.rows])).toEqual(before);
    expect(f.control().initialRecovery).toEqual(marker);
    expect(f.trace.filter(t => t.sql.startsWith("UPDATE"))).toHaveLength(1);
    expectOnlyReportingSql(f);
  });

  it("does not alter native attention refusal and supports initial import after recovery without clearing marker", async () => {
    const f = fixture();
    expect(await f.store.acquire()).toEqual({ status: "needs_attention" });
    expect(await f.recover()).toBe("recovered");
    const marker = clone(f.control().initialRecovery);
    const acquisition = await f.store.acquire();
    expect(acquisition.status).toBe("acquired");
    if (acquisition.status !== "acquired") throw new Error("no lease");
    const result = await createHqImplementedEngine(
      createHqImplementedSampleReader("initial"),
      f.store.fencedSyncStore(acquisition.lease)
    ).sync();
    expect(result.status).toBe("applied");
    await f.store.complete(acquisition.lease, {
      status: "applied",
      delaySeconds: 300,
    });
    expect((await f.store.readPublished())?.version).toBe(1);
    expect(f.control().initialRecovery).toEqual(marker);
    expect(f.control().lastSuccessAtMs).toBe(f.now());
    expect(f.control().lastPublishAtMs).toBe(f.now());
    expect(f.control().consecutiveFailures).toBe(0);
    const before = clone([...f.rows]);
    expect(await f.recover(f.control().version)).toBe("not_recoverable");
    expect(clone([...f.rows])).toEqual(before);
    expectOnlyReportingSql(f, false);
  });

  it.each(["empty", "staged", "published", "corrupt", "foreign", "oversized"])(
    "refuses any physical %s sync row without parsing, deleting, or overwriting it",
    async kind => {
      const f = fixture();
      const memory = createHqImplementedMemoryStore();
      let remaining = kind === "staged" ? 2 : 100;
      await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        memory,
        { shouldContinue: () => remaining-- > 0 }
      ).sync();
      const sync = await memory.readSync();
      if (kind === "staged") expect(sync?.stage).not.toBeNull();
      if (kind === "published") expect(sync?.published).not.toBeNull();
      const state =
        kind === "corrupt"
          ? "{broken"
          : kind === "oversized"
            ? "x".repeat(16 * 1024 * 1024 + 1)
            : {
                format: "hq-live-sync-v1",
                sourceFingerprint: f.initial.sourceFingerprint,
                sync:
                  kind === "empty"
                    ? { version: 1, stage: null, published: null }
                    : sync,
              };
      physicalSync(
        f,
        state,
        kind === "foreign" ? { mode: "sample", ownerUserId: 47 } : {}
      );
      await unchangedStatus(f, "not_recoverable");
    }
  );

  it.each([
    { stageStatus: "idle" },
    { stageStatus: "backoff" },
    { stageStatus: "running" },
    { lastErrorCode: "INVALID_PAYLOAD" },
    { lastErrorCode: null },
    { consecutiveFailures: 0 },
    { consecutiveFailures: 2 },
    { lastAttemptAtMs: null },
    { lastSuccessAtMs: 1 },
    { lastPublishAtMs: 1 },
  ] satisfies Partial<HqLiveControl>[])(
    "refuses noninitial control predicate %j",
    async patch => {
      const f = fixture();
      f.patchControl(patch);
      await unchangedStatus(f, "not_recoverable");
    }
  );

  it.each([
    0,
    -1,
    2,
    4,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER,
    MAX_VERSION + 1,
  ])("refuses expected version %s without changing control", async version => {
    const f = fixture();
    await unchangedStatus(f, "not_recoverable", version);
    expect(f.authority).toHaveBeenCalled();
  });

  it("never initializes a missing control even if sync is absent or orphaned", async () => {
    for (const orphan of [false, true]) {
      const f = fixture();
      f.rows.delete(HQ_LIVE_CONTROL_DATASET_ID);
      if (orphan) physicalSync(f, "orphan");
      await unchangedStatus(f, "not_recoverable");
    }
  });

  it("uses clock sampled after a lock wait; future due is notdue and equal due is eligible", async () => {
    const future = fixture();
    future.patchControl({ nextDueAtMs: future.now() + 1 });
    await unchangedStatus(future, "notdue");
    const waiting = fixture();
    waiting.patchControl({ nextDueAtMs: waiting.now() + 10000 });
    waiting.before(sql => {
      if (sql.includes("FOR UPDATE")) waiting.advance(10000);
    });
    expect(await waiting.recover()).toBe("recovered");
    expect(waiting.control().initialRecovery?.atMs).toBe(waiting.now());
    expect(waiting.control().nextDueAtMs).toBe(waiting.now());
    expect(waiting.trace[0].sql).toContain("FOR UPDATE");
    expect(waiting.trace[1].sql).toMatch(/^SELECT CAST/);
    expectOnlyReportingSql(waiting);
  });

  it.each([0, NaN, -1, 1.5, Infinity])(
    "rejects unsafe DB clock %s with exact rollback",
    async now => {
      const f = fixture();
      f.setClock(now);
      await unchangedError(f, "STORE_UNAVAILABLE");
      expect(f.rollbacks).toHaveBeenCalledOnce();
    }
  );

  it.each(["active", "expired", "equal"])(
    "does not clean up a %s nonnull lease",
    async kind => {
      const f = fixture();
      f.patchControl({
        leaseToken: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        lastAttemptAtMs: f.now() - 1000,
        leaseExpiresAtMs:
          f.now() + (kind === "active" ? 1000 : kind === "equal" ? 0 : -1),
        leaseHardExpiresAtMs: f.now() + 90000,
      });
      await unchangedStatus(f, kind === "active" ? "busy" : "not_recoverable");
    }
  );

  it.each([
    "mode",
    "owner",
    "id",
    "json",
    "row-version",
    "control-version",
    "fence",
    "lease",
  ])("rejects foreign/corrupt %s control without repair", async kind => {
    const f = fixture(),
      row = f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!;
    if (kind === "mode") row.mode = "sample";
    if (kind === "owner") row.ownerUserId = 47;
    if (kind === "id") row.datasetId = "foreign";
    if (kind === "json") row.state = "{broken";
    if (kind === "row-version") row.stateVersion++;
    if (kind === "control-version") f.patchControl({ version: 0 });
    if (kind === "fence") f.patchControl({ fencingNumber: -1 });
    if (kind === "lease")
      f.patchControl({ leaseToken: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    await unchangedError(f, "INVALID_PERSISTED_STATE");
  });

  it.each([
    null,
    {},
    [],
    { format: "other" },
    {
      format: "empty-initial-recovery-v1",
      atMs: 1,
      fromControlVersion: 3,
      previousErrorCode: "INVALID_SEMANTICS",
      previousAttemptAtMs: 1,
    },
    {
      format: "empty-initial-recovery-v1",
      atMs: 1,
      fromControlVersion: 1,
      previousErrorCode: "INVALID_PAYLOAD",
      previousAttemptAtMs: 1,
    },
    {
      format: "empty-initial-recovery-v1",
      atMs: 0,
      fromControlVersion: 1,
      previousErrorCode: "INVALID_SEMANTICS",
      previousAttemptAtMs: 1,
    },
    {
      format: "empty-initial-recovery-v1",
      atMs: 1,
      fromControlVersion: 1,
      previousErrorCode: "INVALID_SEMANTICS",
      previousAttemptAtMs: null,
    },
  ])(
    "validates optional recovery marker only when present: %j",
    async marker => {
      const f = fixture();
      f.patchControl({ initialRecovery: marker as any });
      await unchangedError(f, "INVALID_PERSISTED_STATE");
      await expect(f.store.readSnapshot()).rejects.toMatchObject({
        code: "INVALID_PERSISTED_STATE",
      });
    }
  );

  it.each(["version", "fence"])(
    "retains native %s exhaustion bound",
    async kind => {
      const f = fixture();
      f.patchControl(
        kind === "version"
          ? { version: MAX_VERSION }
          : { fencingNumber: MAX_VERSION }
      );
      const before = clone([...f.rows]);
      await expect(
        f.recover(kind === "version" ? MAX_VERSION : 3)
      ).rejects.toMatchObject({ code: "VERSION_EXHAUSTED" });
      expect(clone([...f.rows])).toEqual(before);
      expect(f.commits).not.toHaveBeenCalled();
      expectOnlyReportingSql(f);
    }
  );

  it("keeps CAS predicate and rolls back failed control update", async () => {
    const f = fixture();
    f.setAffectedRows(0);
    await unchangedError(f, "LEASE_LOST");
    expect(f.rollbacks).toHaveBeenCalledOnce();
  });

  it.each([
    { HQ_LIVE_READ_ENABLED: "true" },
    { HQ_LIVE_SYNC_ENABLED: "false" },
    { HQ_LIVE_READ_ENABLED: "invalid" },
    { HQ_LIVE_INTERVAL_SECONDS: "1" },
    { HQ_LIVE_FRESHNESS_SECONDS: "invalid" },
    { HQ_ORBIT_REPORTING_BASE_URL: "" },
    { HQ_ORBIT_REPORTING_API_KEY: "" },
    { HQ_PORTAL_SYNC_TOKEN: "" },
  ])(
    "requires strict actual sync-on/read-off configured settings: %j",
    async overrides => {
      const f = fixture();
      f.changeConfig(reportingConfig(overrides));
      await unchangedError(f, "CONFIG_INVALID");
      expect(f.authority).toHaveBeenCalledOnce();
      expect(f.trace).toHaveLength(0);
      expect(f.pool.getConnection).not.toHaveBeenCalled();
    }
  );

  it("requires callback function before SQL and redacts arbitrary authority errors", async () => {
    for (const missing of [undefined, null, {}, "token"]) {
      const f = fixture(),
        before = clone([...f.rows]);
      await expect(
        f.store.recoverEmptyInitialImport!(3, missing as any)
      ).rejects.toMatchObject({ code: "AUTH_DENIED" });
      expect(clone([...f.rows])).toEqual(before);
      expect(f.pool.getConnection).not.toHaveBeenCalled();
    }
    const f = fixture();
    f.authority.mockImplementation(async () => {
      throw new Error("SECRET authority provider details");
    });
    await unchangedError(f, "AUTH_DENIED");
    expect(f.trace).toHaveLength(0);
  });

  it("rejects changed original persisted binding instead of rewriting it", async () => {
    const f = fixture();
    f.changeConfig(
      reportingConfig({
        HQ_ORBIT_REPORTING_API_KEY: "different-key-" + "z".repeat(40),
      })
    );
    await unchangedError(f, "SOURCE_BINDING_CHANGED");
  });

  it.each(["begin", "lock", "clock", "sync", "update"])(
    "always refreshes authority and exactly rolls back settings drift after %s await",
    async point => {
      const f = fixture();
      let drift = false,
        observedDriftCalls = 0;
      const changed = () => {
        drift = true;
        f.changeConfig(reportingConfig({ HQ_LIVE_READ_ENABLED: "true" }));
      };
      f.authority.mockImplementation(async () => {
        if (drift) observedDriftCalls++;
      });
      if (point === "begin") f.onBegin(changed);
      else
        f.after((sql, args) => {
          if (
            (point === "lock" && sql.includes("FOR UPDATE")) ||
            (point === "clock" && sql.startsWith("SELECT CAST")) ||
            (point === "sync" &&
              sql.startsWith("SELECT datasetId") &&
              args[0] === HQ_LIVE_SYNC_DATASET_ID) ||
            (point === "update" && sql.startsWith("UPDATE"))
          )
            changed();
        });
      await unchangedError(f, "CONFIG_INVALID");
      expect(observedDriftCalls).toBe(1);
      expect(f.rollbacks).toHaveBeenCalledOnce();
      expect(f.trace.filter(t => t.sql.startsWith("UPDATE"))).toHaveLength(
        point === "update" ? 1 : 0
      );
    }
  );

  it.each(["callback", "lock", "update"])(
    "rechecks source binding around authority and %s awaits with exact rollback",
    async point => {
      const f = fixture();
      let changed = false,
        callsAfterChange = 0;
      const drift = () => {
        changed = true;
        f.changeConfig(
          reportingConfig({
            HQ_ORBIT_REPORTING_API_KEY: "different-key-" + "z".repeat(40),
          })
        );
      };
      f.authority.mockImplementation(async () => {
        if (changed) callsAfterChange++;
        if (point === "callback" && f.authority.mock.calls.length === 1)
          drift();
      });
      f.after(sql => {
        if (
          (point === "lock" && sql.includes("FOR UPDATE")) ||
          (point === "update" && sql.startsWith("UPDATE"))
        )
          drift();
      });
      await unchangedError(f, "SOURCE_BINDING_CHANGED");
      expect(callsAfterChange).toBe(point === "callback" ? 0 : 1);
      expect(f.trace.filter(t => t.sql.startsWith("UPDATE"))).toHaveLength(
        point === "update" ? 1 : 0
      );
    }
  );

  it.each([2, 3, 4, 5, 6, 7])(
    "fresh authority denial at guard %s rolls back without cleanup",
    async deniedCall => {
      const f = fixture();
      f.authority.mockImplementation(async () => {
        if (f.authority.mock.calls.length === deniedCall)
          throw new HqLiveError("AUTH_DENIED");
      });
      await unchangedError(f, "AUTH_DENIED");
      expect(f.rollbacks).toHaveBeenCalledOnce();
      expect(f.trace.filter(t => t.sql.startsWith("UPDATE"))).toHaveLength(
        deniedCall === 7 ? 1 : 0
      );
    }
  );

  it("post-update parent seven-setting authority denial exactly restores every persisted byte", async () => {
    const f = fixture();
    let saved = false,
      calls = 0;
    f.after(sql => {
      if (sql.startsWith("UPDATE")) saved = true;
    });
    f.authority.mockImplementation(async () => {
      calls++;
      if (saved)
        throw Object.assign(new Error("private changed setting"), {
          code: "CONFIG_INVALID",
        });
    });
    await unchangedError(f, "AUTH_DENIED");
    expect(calls).toBe(7);
    expect(f.trace.filter(t => t.sql.startsWith("UPDATE"))).toHaveLength(1);
    expect(f.rollbacks).toHaveBeenCalledOnce();
  });
});
