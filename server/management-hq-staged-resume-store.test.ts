import { beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalHqJson } from "./management-hq-engine";
import {
  createHqLiveConfig,
  type HqLiveConfig,
} from "./management-hq-live-config";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  type HqImplementedSyncState,
  validateHqImplementedSyncState,
} from "./management-hq-ingestion";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
import {
  createHqLiveStore,
  HqLiveError,
  HQ_LIVE_CONTROL_DATASET_ID,
  HQ_LIVE_SYNC_DATASET_ID,
  type HqLiveControl,
  type HqLiveInitialStagedResume,
} from "./management-hq-live-store";
import {
  encodeHqLiveV2Sync,
  manifestChunkRefs,
  type HqV2Manifest,
} from "./management-hq-storage-v2";
import {
  offlineHqV2Pool,
  type HqV2OfflineRow,
} from "./management-hq-storage-v2-pool";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const MAX_VERSION = 2_147_483_646;
const CHUNK_PREFIX = "live:company:orbit:v2:chunk:";
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
const row = (id: string, state: string, version = 1): HqV2OfflineRow => ({
  datasetId: id,
  mode: "live",
  ownerUserId: 0,
  stateVersion: version,
  state,
  updatedAt: "2026-11-22T11:55:00.000Z",
});
let staged: HqImplementedSyncState;
let multiBatch: HqImplementedSyncState;
let published: HqImplementedSyncState;
beforeAll(async () => {
  const memory = createHqImplementedMemoryStore();
  let calls = 0;
  await createHqImplementedEngine(
    createHqImplementedSampleReader("initial"),
    memory,
    { shouldContinue: () => ++calls <= 3 }
  ).backfill();
  staged = { ...(await memory.readSync())!, version: 9 };
  expect(staged.published).toBeNull();
  expect(staged.stage!.metadata).not.toBeNull();
  expect(staged.stage!.pages).toBeGreaterThan(0);
  expect(staged.stage!.recordsRead).toBeGreaterThan(0);
  const record = staged.stage!.entities["booking:1"];
  Object.assign(record.entity.payload, {
    offlineExtension: { unicode: '雪😀é\\"\n', ordered: [true, null, 3] },
  });
  record.canonicalPayload = canonicalHqJson(record.entity);
  validateHqImplementedSyncState(staged);
  multiBatch = clone(staged);
  for (let index = 10; index <= 73; index++) {
    const extra = clone(record);
    extra.entity.entityId = index;
    Object.assign(extra.entity.payload, {
      orbitBookingId: index,
      offlinePadding: "s".repeat(2048),
    });
    extra.canonicalPayload = canonicalHqJson(extra.entity);
    multiBatch.stage!.entities[`booking:${index}`] = extra;
  }
  validateHqImplementedSyncState(multiBatch);
  const complete = createHqImplementedMemoryStore();
  await createHqImplementedEngine(
    createHqImplementedSampleReader("initial"),
    complete
  ).backfill();
  published = { ...(await complete.readSync())!, version: 9 };
});

type SqlHook = (sql: string, args: any[]) => void | Promise<void>;
function fixture(format: "v1" | "v2" = "v1", state = staged) {
  const db = offlineHqV2Pool();
  let current = reportingConfig();
  const config: HqLiveConfig = {
    status: () => current.status(),
    sourceFingerprint: () => current.sourceFingerprint(),
    authorizeTrigger: token => current.authorizeTrigger(token),
    createReader: vi.fn(() => {
      throw new Error("Resume must never create a source reader");
    }),
  };
  let before: SqlHook | null = null;
  let after: SqlHook | null = null;
  let onConnection: (() => void | Promise<void>) | null = null;
  let onBegin: (() => void | Promise<void>) | null = null;
  const getConnection = db.pool.getConnection.bind(db.pool);
  const getConnectionSpy = vi.spyOn(db.pool, "getConnection");
  getConnectionSpy.mockImplementation(async () => {
    const c = await getConnection();
    await onConnection?.();
    const begin = c.beginTransaction.bind(c);
    c.beginTransaction = async () => {
      await begin();
      await onBegin?.();
    };
    const execute = c.execute.bind(c);
    c.execute = (async (sql: string, args: any[] = []) => {
      await before?.(sql, args);
      try {
        return await execute(sql, args);
      } finally {
        await after?.(sql, args);
      }
    }) as typeof c.execute;
    return c;
  });
  const store = createHqLiveStore(db.pool, config);
  const initial: HqLiveControl = {
    format: "hq-live-control-v1",
    version: 11,
    sourceFingerprint: config.sourceFingerprint()!,
    fencingNumber: 4,
    leaseToken: null,
    leaseExpiresAtMs: null,
    leaseHardExpiresAtMs: null,
    nextDueAtMs: db.now() - 1000,
    consecutiveFailures: 3,
    lastAttemptAtMs: db.now() - 300000,
    lastSuccessAtMs: null,
    lastPublishAtMs: null,
    lastErrorCode: "STATE_BYTE_CAP_EXCEEDED",
    stageStatus: "needs_attention",
    initialRecovery: {
      format: "empty-initial-recovery-v1",
      atMs: db.now() - 600000,
      fromControlVersion: 3,
      previousErrorCode: "INVALID_SEMANTICS",
      previousAttemptAtMs: db.now() - 900000,
    },
  };
  db.rows.set(
    HQ_LIVE_CONTROL_DATASET_ID,
    row(HQ_LIVE_CONTROL_DATASET_ID, JSON.stringify(initial), initial.version)
  );
  const authority = vi.fn(async () => {});
  const f = {
    ...db,
    store,
    config,
    initial,
    authority,
    getConnectionSpy,
    resume: (
      controlVersion = 11,
      syncVersion = state.version,
      guard = authority
    ) => store.resumeStagedInitialImport!(controlVersion, syncVersion, guard),
    changeConfig: (replacement: HqLiveConfig) => {
      current = replacement;
    },
    control: (): HqLiveControl =>
      JSON.parse(db.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.state),
    patchControl: (patch: Partial<HqLiveControl>) => {
      const r = db.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!;
      const control = { ...JSON.parse(r.state), ...patch };
      r.stateVersion = control.version;
      r.state = JSON.stringify(control);
    },
    before: (hook: SqlHook | null) => {
      before = hook;
    },
    after: (hook: SqlHook | null) => {
      after = hook;
    },
    onConnection: (hook: typeof onConnection) => {
      onConnection = hook;
    },
    onBegin: (hook: typeof onBegin) => {
      onBegin = hook;
    },
  };
  seedSync(f, format, state);
  const unrelated = row("sample-sync:47", ' { "synthetic": "雪" } \n');
  unrelated.ownerUserId = 47;
  unrelated.mode = "sample";
  db.rows.set(unrelated.datasetId, unrelated);
  db.rows.set(
    CHUNK_PREFIX + "f".repeat(64),
    row(CHUNK_PREFIX + "f".repeat(64), "unreferenced immutable orphan")
  );
  return f;
}
function seedSync(
  f: { rows: Map<string, HqV2OfflineRow>; initial: HqLiveControl },
  format: "v1" | "v2",
  state: HqImplementedSyncState
) {
  if (format === "v1") {
    f.rows.set(
      HQ_LIVE_SYNC_DATASET_ID,
      row(
        HQ_LIVE_SYNC_DATASET_ID,
        " \n" +
          JSON.stringify(
            {
              format: "hq-live-sync-v1",
              sourceFingerprint: f.initial.sourceFingerprint,
              sync: state,
            },
            null,
            2
          ) +
          "\n\t ",
        state.version
      )
    );
  } else {
    const encoded = encodeHqLiveV2Sync(state, f.initial.sourceFingerprint);
    f.rows.set(
      HQ_LIVE_SYNC_DATASET_ID,
      row(
        HQ_LIVE_SYNC_DATASET_ID,
        " \n" + JSON.stringify(encoded.manifest, null, 2) + "\n",
        state.version
      )
    );
    for (const chunk of encoded.chunks) {
      const reordered = Object.fromEntries(
        Object.entries(JSON.parse(chunk.serialized)).reverse()
      );
      f.rows.set(
        chunk.id,
        row(chunk.id, " \n" + JSON.stringify(reordered, null, 2) + "\n")
      );
    }
  }
}
const savedRows = (f: ReturnType<typeof fixture>) => clone([...f.rows]);
const mutations = (f: ReturnType<typeof fixture>) =>
  f.trace.filter(t => /^(INSERT|UPDATE|DELETE)/.test(t.sql));
function expectOnlyResumeSql(f: ReturnType<typeof fixture>) {
  for (const entry of f.trace) {
    expect(entry.sql).not.toMatch(
      /\b(?:INSERT|DELETE|REPLACE|LIKE|REGEXP|ALTER|CREATE|DROP|TRUNCATE|users|bookings|payments|commissions|amendments|invoices|departures)\b/i
    );
    if (entry.sql.startsWith("SELECT CAST")) continue;
    expect(entry.sql).toContain("management_hq_datasets");
    if (entry.sql.startsWith("UPDATE")) {
      expect(entry.args[2]).toBe(HQ_LIVE_CONTROL_DATASET_ID);
      expect(entry.sql).toContain(
        "mode = 'live' AND ownerUserId = 0 AND stateVersion = ?"
      );
    } else {
      expect(entry.sql).toMatch(/^SELECT datasetId/);
      expect(
        entry.args.every(
          id =>
            id === HQ_LIVE_CONTROL_DATASET_ID ||
            id === HQ_LIVE_SYNC_DATASET_ID ||
            id.startsWith(CHUNK_PREFIX)
        )
      ).toBe(true);
      if (entry.sql.includes("datasetId IN")) {
        expect(entry.args.length).toBeLessThanOrEqual(4);
        expect(entry.sql).toContain("FOR UPDATE");
      }
    }
  }
  expect(f.config.createReader).not.toHaveBeenCalled();
}
async function unchangedStatus(
  f: ReturnType<typeof fixture>,
  status: string,
  controlVersion = 11,
  syncVersion = 9
) {
  const before = savedRows(f),
    count = mutations(f).length;
  expect(await f.resume(controlVersion, syncVersion)).toBe(status);
  expect(savedRows(f)).toEqual(before);
  expect(mutations(f)).toHaveLength(count);
  expectOnlyResumeSql(f);
}
async function unchangedError(
  f: ReturnType<typeof fixture>,
  code: string,
  controlVersion = 11,
  syncVersion = 9
) {
  const before = savedRows(f),
    commits = f.commits.mock.calls.length;
  await expect(f.resume(controlVersion, syncVersion)).rejects.toMatchObject({
    code,
  });
  expect(savedRows(f)).toEqual(before);
  expect(f.commits.mock.calls.length).toBe(commits);
  expectOnlyResumeSql(f);
}
const marker = (f: ReturnType<typeof fixture>): HqLiveInitialStagedResume => ({
  format: "staged-initial-resume-v1",
  atMs: f.now(),
  fromControlVersion: 10,
  syncVersion: 9,
  previousErrorCode: "STATE_BYTE_CAP_EXCEEDED",
  previousAttemptAtMs: f.initial.lastAttemptAtMs!,
  previousConsecutiveFailures: 3,
  pages: staged.stage!.pages,
  recordsRead: staged.stage!.recordsRead,
});

describe("protected staged initial Resume: actual store, offline SQL only", () => {
  it.each(["v1", "v2"] as const)(
    "one control CAS preserves every %s sync/root/chunk/orphan/sample byte, version and history",
    async format => {
      const f = fixture(format),
        before = savedRows(f);
      expect(await f.resume()).toBe("resumed");
      expect(f.control()).toEqual({
        ...f.initial,
        version: 12,
        fencingNumber: 5,
        stageStatus: "progress",
        lastErrorCode: null,
        initialStagedResume: { ...marker(f), fromControlVersion: 11 },
      });
      expect(
        savedRows(f).filter(([id]) => id !== HQ_LIVE_CONTROL_DATASET_ID)
      ).toEqual(before.filter(([id]) => id !== HQ_LIVE_CONTROL_DATASET_ID));
      expect(mutations(f)).toHaveLength(1);
      expect(mutations(f)[0].args[3]).toBe(11);
      expect(f.trace[0].args).toEqual([HQ_LIVE_CONTROL_DATASET_ID]);
      expect(f.trace[0].sql).toContain("FOR UPDATE");
      expect(f.trace[1].sql).toMatch(/^SELECT CAST/);
      expect(f.trace.at(-2)!.sql).toMatch(/^SELECT CAST/);
      expect(f.commits.mock.calls).toHaveLength(1);
      expect(f.rollbacks.mock.calls).toHaveLength(0);
      expectOnlyResumeSql(f);
      expect(
        (await createHqLiveStore(f.pool, f.config).readSnapshot()).sync
      ).toEqual(staged);
      expect(
        (await f.store.readSnapshot()).control!.initialStagedResume
      ).toEqual(f.control().initialStagedResume);
      expect(await f.store.readPublished()).toBeNull();
    }
  );

  it("preserves a >8 MiB legacy v1 row without writing or migrating it", async () => {
    const f = fixture(),
      root = f.rows.get(HQ_LIVE_SYNC_DATASET_ID)!;
    root.state += " ".repeat(8 * 1024 * 1024);
    const before = clone(root);
    expect(await f.resume()).toBe("resumed");
    expect(f.rows.get(HQ_LIVE_SYNC_DATASET_ID)).toEqual(before);
    expect(JSON.parse(root.state).format).toBe("hq-live-sync-v1");
    expectOnlyResumeSql(f);
  });

  it.each(["v1", "v2"] as const)(
    "one-shot concurrent %s winner, stale observation and later identical error replay cannot reset",
    async format => {
      const f = fixture(format);
      expect((await Promise.all([f.resume(), f.resume()])).sort()).toEqual([
        "not_resumable",
        "resumed",
      ]);
      const savedMarker = clone(f.control().initialStagedResume);
      await unchangedStatus(f, "not_resumable", 12);
      f.patchControl({
        version: 13,
        stageStatus: "needs_attention",
        lastErrorCode: "STATE_BYTE_CAP_EXCEEDED",
        consecutiveFailures: 4,
      });
      await unchangedStatus(f, "not_resumable", 13);
      expect(f.control().initialStagedResume).toEqual(savedMarker);
      expect(mutations(f)).toHaveLength(1);
    }
  );

  it("does not require initialRecovery or hardcoded counters and retains native attention acquisition gate", async () => {
    const f = fixture("v2");
    f.patchControl({ initialRecovery: undefined, consecutiveFailures: 1 });
    const before = savedRows(f);
    expect(await f.store.acquire()).toEqual({ status: "needs_attention" });
    expect(savedRows(f)).toEqual(before);
    f.trace.splice(0);
    expect(await f.resume()).toBe("resumed");
    expect(f.control().initialStagedResume!.previousConsecutiveFailures).toBe(
      1
    );
    expect(f.control()).not.toHaveProperty("initialRecovery");
    expectOnlyResumeSql(f);
  });

  it("preserves one-shot marker through existing native acquire/renew/complete and fences old holders", async () => {
    const f = fixture("v2");
    expect(await f.resume()).toBe("resumed");
    const savedMarker = clone(f.control().initialStagedResume);
    const oldLease = {
      token: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      fencingNumber: 4,
      sourceFingerprint: f.initial.sourceFingerprint,
      hardExpiresAtMs: f.now() + 95000,
    };
    await expect(f.store.renew(oldLease)).rejects.toMatchObject({
      code: "LEASE_LOST",
    });
    await expect(
      f.store.complete(oldLease, { status: "applied", delaySeconds: 300 })
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
    const acquired = await f.store.acquire();
    if (acquired.status !== "acquired")
      throw new Error("expected offline lease");
    await f.store.renew(acquired.lease);
    await f.store.complete(acquired.lease, {
      status: "needs_attention",
      delaySeconds: 0,
      errorCode: "STATE_BYTE_CAP_EXCEEDED",
    });
    expect(f.control().initialStagedResume).toEqual(savedMarker);
    const start = f.trace.length;
    await unchangedStatus(
      { ...f, trace: f.trace.slice(start) },
      "not_resumable",
      f.control().version
    );
  });

  it.each([
    { stageStatus: "idle" },
    { stageStatus: "backoff" },
    { stageStatus: "running" },
    { lastErrorCode: "INVALID_SEMANTICS" },
    { lastErrorCode: "STATE_RECORD_CAP_EXCEEDED" },
    { lastErrorCode: null },
    { consecutiveFailures: 0 },
    { lastAttemptAtMs: null },
    { lastSuccessAtMs: 1 },
    { lastPublishAtMs: 1 },
  ] satisfies Partial<HqLiveControl>[])(
    "refuses noninitial control predicate %j without mutation",
    async patch => {
      const f = fixture();
      f.patchControl(patch);
      await unchangedStatus(f, "not_resumable");
    }
  );

  it.each(["control", "sync"] as const)(
    "binds the exact server-observed %s version including invalid arguments",
    async field => {
      for (const version of [
        0,
        -1,
        1.5,
        NaN,
        Infinity,
        MAX_VERSION + 1,
        field === "control" ? 10 : 8,
        field === "control" ? 12 : 10,
      ]) {
        const f = fixture("v2");
        await unchangedStatus(
          f,
          "not_resumable",
          field === "control" ? version : 11,
          field === "sync" ? version : 9
        );
        if (!Number.isInteger(version) || version < 1 || version > MAX_VERSION)
          expect(f.getConnectionSpy).not.toHaveBeenCalled();
        expect(f.authority).toHaveBeenCalled();
      }
    }
  );

  it.each(["active", "expired", "equal"])(
    "never clears a %s nonnull lease",
    async kind => {
      const f = fixture();
      f.patchControl({
        leaseToken: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        lastAttemptAtMs: f.now() - 1000,
        leaseExpiresAtMs:
          f.now() + (kind === "active" ? 1000 : kind === "equal" ? 0 : -1),
        leaseHardExpiresAtMs: f.now() + 90000,
      });
      await unchangedStatus(f, kind === "active" ? "busy" : "not_resumable");
    }
  );

  it("checks due using fresh post-lock/full-read clock and preserves original due, including zero", async () => {
    const future = fixture("v2");
    future.patchControl({ nextDueAtMs: future.now() + 1 });
    await unchangedStatus(future, "notdue");
    for (const point of ["lock", "root", "chunk"] as const) {
      const f = fixture(point === "chunk" ? "v2" : "v1");
      const due = f.now() + 10000;
      f.patchControl({ nextDueAtMs: due });
      let waited = false;
      f.after((sql, args) => {
        if (
          !waited &&
          ((point === "lock" && args[0] === HQ_LIVE_CONTROL_DATASET_ID) ||
            (point === "root" && args[0] === HQ_LIVE_SYNC_DATASET_ID) ||
            (point === "chunk" && sql.includes("datasetId IN")))
        ) {
          waited = true;
          f.advance(10000);
        }
      });
      expect(await f.resume()).toBe("resumed");
      expect(f.control().nextDueAtMs).toBe(due);
      expect(f.control().initialStagedResume!.atMs).toBe(f.now());
      expect(waited).toBe(true);
    }
    const zero = fixture();
    zero.patchControl({ nextDueAtMs: 0 });
    expect(await zero.resume()).toBe("resumed");
    expect(zero.control().nextDueAtMs).toBe(0);
  });

  it.each(["control", "sync"])(
    "does not initialize missing %s rows",
    async kind => {
      const f = fixture("v2");
      f.rows.delete(
        kind === "control"
          ? HQ_LIVE_CONTROL_DATASET_ID
          : HQ_LIVE_SYNC_DATASET_ID
      );
      await unchangedStatus(f, "not_resumable");
    }
  );

  it.each(["v1", "v2"] as const)(
    "refuses %s empty, metadata-less, no-records, published and catchup state",
    async format => {
      const empty = { version: 9, stage: null, published: null };
      const noProgress = clone(staged);
      Object.assign(noProgress.stage!, {
        metadata: null,
        phase: "bookings",
        pages: 0,
        recordsRead: 0,
        cursor: null,
        pendingResumeCursor: null,
        lastSeq: null,
        cursors: [],
        feedKeys: { booking: [], business: [] },
        catalogueKeys: { booking: [], business: [] },
        entities: {},
        seqProofs: {},
      });
      const noRecords = clone(staged);
      noRecords.stage!.recordsRead = 0;
      const catchup = clone(staged);
      catchup.stage!.kind = "catchup";
      catchup.stage!.phase = "changes";
      for (const state of [empty, noProgress, noRecords, published, catchup]) {
        validateHqImplementedSyncState(state);
        const f = fixture(format, state);
        await unchangedStatus(f, "not_resumable");
      }
    }
  );

  it.each([
    "mode",
    "owner",
    "id",
    "json",
    "row-version",
    "version",
    "fence",
    "lease",
    "oversized",
  ])("fails closed on foreign/corrupt %s control", async kind => {
    const f = fixture(),
      r = f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!;
    if (kind === "mode") r.mode = "sample";
    if (kind === "owner") r.ownerUserId = 47;
    if (kind === "id") r.datasetId = "foreign";
    if (kind === "json") r.state = "{broken";
    if (kind === "row-version") r.stateVersion++;
    if (kind === "version") f.patchControl({ version: 0 });
    if (kind === "fence") f.patchControl({ fencingNumber: -1 });
    if (kind === "lease")
      f.patchControl({ leaseToken: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    if (kind === "oversized") r.state += " ".repeat(4097);
    await unchangedError(f, "INVALID_PERSISTED_STATE");
  });

  it.each([
    "mode",
    "owner",
    "id",
    "json",
    "row-version",
    "binding",
    "metadata",
    "checkpoint",
    "pages",
    "records",
    "canonical-payload",
    "oversized",
  ])("strictly validates legacy v1 %s without rewriting", async kind => {
    const f = fixture(),
      root = f.rows.get(HQ_LIVE_SYNC_DATASET_ID)!,
      value = JSON.parse(root.state);
    if (kind === "mode") root.mode = "sample";
    if (kind === "owner") root.ownerUserId = 47;
    if (kind === "id") root.datasetId = "foreign";
    if (kind === "row-version") root.stateVersion++;
    if (kind === "binding") value.sourceFingerprint = "a".repeat(64);
    if (kind === "metadata") value.sync.stage.metadata.scope = "foreign";
    if (kind === "checkpoint") value.sync.stage.basePublishedVersion = 1;
    if (kind === "pages") value.sync.stage.pages = 1001;
    if (kind === "records") value.sync.stage.recordsRead = 100001;
    if (kind === "canonical-payload")
      value.sync.stage.entities["booking:1"].canonicalPayload = "{}";
    root.state = kind === "json" ? "{broken" : JSON.stringify(value);
    if (kind === "oversized") root.state += " ".repeat(16 * 1024 * 1024);
    await unchangedError(
      f,
      kind === "binding" ? "SOURCE_BINDING_CHANGED" : "INVALID_PERSISTED_STATE"
    );
  });

  it.each([
    "root-format",
    "root-version",
    "root-owner",
    "root-mode",
    "root-hash",
    "root-binding",
    "manifest-field",
    "namespace",
    "missing",
    "chunk-version",
    "chunk-owner",
    "chunk-mode",
    "chunk-hash",
    "chunk-length",
    "chunk-binding",
    "chunk-data",
    "chunk-format",
    "chunk-scalar",
    "chunk-base64",
    "chunk-missing-field",
    "invalid-json",
    "duplicate-envelope",
    "escaped-duplicate-envelope",
    "extra-envelope",
  ])("strictly validates v2 %s without any mutation", async kind => {
    const f = fixture("v2"),
      root = f.rows.get(HQ_LIVE_SYNC_DATASET_ID)!,
      m = JSON.parse(root.state) as HqV2Manifest;
    const ref = manifestChunkRefs(m)[0],
      chunk = f.rows.get(ref.id)!;
    if (kind === "root-format") m.format = "wrong" as any;
    if (kind === "root-version") root.stateVersion++;
    if (kind === "root-owner") root.ownerUserId = 47;
    if (kind === "root-mode") root.mode = "sample";
    if (kind === "root-hash") m.sha256 = "0".repeat(64);
    if (kind === "root-binding") m.sourceFingerprint = "a".repeat(64);
    if (kind === "manifest-field") Object.assign(m, { unapproved: true });
    if (kind === "namespace") m.groups[0].chunks[0].id = "sample-sync:47";
    if (kind === "missing") f.rows.delete(ref.id);
    if (kind === "chunk-version") chunk.stateVersion = 2;
    if (kind === "chunk-owner") chunk.ownerUserId = 47;
    if (kind === "chunk-mode") chunk.mode = "sample";
    const value = JSON.parse(chunk.state);
    if (kind === "chunk-hash") value.sha256 = "0".repeat(64);
    if (kind === "chunk-length") value.byteCount++;
    if (kind === "chunk-binding") value.sourceFingerprint = "a".repeat(64);
    if (kind === "chunk-format") value.format = "wrong";
    if (kind === "chunk-scalar") value.byteCount = String(value.byteCount);
    if (kind === "chunk-base64") value.data = "!" + value.data.slice(1);
    if (kind === "chunk-missing-field") delete value.format;
    if (kind === "extra-envelope") value.unapproved = true;
    if (kind === "chunk-data") {
      const raw = Buffer.from(value.data, "base64");
      raw[0] ^= 1;
      value.data = raw.toString("base64");
    }
    chunk.state = JSON.stringify(value);
    if (kind === "invalid-json") chunk.state += " trailing-non-json";
    if (kind === "duplicate-envelope")
      chunk.state = chunk.state.replace(
        "{",
        '{"format":"hq-live-sync-chunk-v2",'
      );
    if (kind === "escaped-duplicate-envelope")
      chunk.state = chunk.state.replace(
        "{",
        '{"\\u0066ormat":"hq-live-sync-chunk-v2",'
      );
    root.state = JSON.stringify(m);
    await unchangedError(
      f,
      kind === "root-binding"
        ? "SOURCE_BINDING_CHANGED"
        : "INVALID_PERSISTED_STATE"
    );
  });

  it.each(["duplicate", "foreign-id", "extra"])(
    "rejects %s returned rows rather than scanning other namespaces",
    async kind => {
      const f = fixture("v2");
      f.setRowHook((sql, _args, selected) => {
        if (!sql.includes("datasetId IN")) return selected;
        if (kind === "duplicate") return [...selected, clone(selected[0])];
        const foreign = { ...clone(selected[0]), datasetId: "sample-sync:47" };
        return kind === "extra"
          ? [...selected, foreign]
          : [foreign, ...selected.slice(1)];
      });
      await unchangedError(f, "INVALID_PERSISTED_STATE");
    }
  );

  it("validates exact marker keys, types and all bounds on Resume and every future read", async () => {
    const f = fixture(),
      valid = marker(f);
    const invalid: unknown[] = [
      null,
      {},
      [],
      "marker",
      { ...valid, extra: true },
      { ...valid, format: "wrong" },
      { ...valid, previousErrorCode: "INVALID_SEMANTICS" },
    ];
    for (const key of Object.keys(valid)) {
      const missing = { ...valid } as any;
      delete missing[key];
      invalid.push(missing);
    }
    for (const key of [
      "atMs",
      "fromControlVersion",
      "syncVersion",
      "previousAttemptAtMs",
      "previousConsecutiveFailures",
      "pages",
      "recordsRead",
    ] as const) {
      for (const value of [0, -1, 1.5, "1", null, Number.MAX_SAFE_INTEGER + 1])
        invalid.push({ ...valid, [key]: value });
    }
    invalid.push(
      { ...valid, fromControlVersion: 11 },
      { ...valid, syncVersion: MAX_VERSION + 1 },
      { ...valid, previousConsecutiveFailures: 1000001 },
      { ...valid, pages: 1001 },
      { ...valid, recordsRead: 100001 }
    );
    for (const value of invalid) {
      const candidate = fixture("v2");
      candidate.patchControl({ initialStagedResume: value as any });
      await unchangedError(candidate, "INVALID_PERSISTED_STATE");
      await expect(candidate.store.readSnapshot()).rejects.toMatchObject({
        code: "INVALID_PERSISTED_STATE",
      });
      await expect(candidate.store.acquire()).rejects.toMatchObject({
        code: "INVALID_PERSISTED_STATE",
      });
    }
    for (const value of [
      valid,
      {
        ...valid,
        atMs: Number.MAX_SAFE_INTEGER,
        fromControlVersion: 1,
        syncVersion: MAX_VERSION,
        previousAttemptAtMs: Number.MAX_SAFE_INTEGER,
        previousConsecutiveFailures: 1000000,
        pages: 1000,
        recordsRead: 100000,
      },
    ]) {
      const candidate = fixture();
      candidate.patchControl({ initialStagedResume: value });
      await unchangedStatus(candidate, "not_resumable");
      expect(
        (await candidate.store.readSnapshot()).control!.initialStagedResume
      ).toEqual(value);
    }
  });

  it.each(["version", "fence"])(
    "retains native %s maximum and rollback semantics",
    async kind => {
      const f = fixture("v2");
      f.patchControl(
        kind === "version"
          ? { version: MAX_VERSION }
          : { fencingNumber: MAX_VERSION }
      );
      await unchangedError(
        f,
        "VERSION_EXHAUSTED",
        kind === "version" ? MAX_VERSION : 11
      );
      expect(mutations(f)).toHaveLength(0);
      expect(f.rollbacks.mock.calls).toHaveLength(1);
    }
  );

  it("permits last valid version and fence without overflow and preserves max sync version", async () => {
    const state = { ...clone(staged), version: MAX_VERSION },
      f = fixture("v2", state);
    f.patchControl({
      version: MAX_VERSION - 1,
      fencingNumber: MAX_VERSION - 1,
    });
    expect(await f.resume(MAX_VERSION - 1, MAX_VERSION)).toBe("resumed");
    expect(f.control().version).toBe(MAX_VERSION);
    expect(f.control().fencingNumber).toBe(MAX_VERSION);
    expect(f.control().initialStagedResume!.syncVersion).toBe(MAX_VERSION);
    expect((await f.store.readSnapshot()).sync).toEqual(state);
  });

  it("failed control CAS throws and exactly rolls back all rows", async () => {
    const f = fixture("v2");
    f.setHook((sql, args, draft) => {
      if (sql.startsWith("UPDATE")) draft.get(args[2])!.stateVersion++;
    });
    await unchangedError(f, "LEASE_LOST");
    expect(mutations(f)).toHaveLength(1);
    expect(f.rollbacks.mock.calls).toHaveLength(1);
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
    "requires mandatory strict configured sync-on/read-off settings %j before DB",
    async overrides => {
      const f = fixture();
      f.changeConfig(reportingConfig(overrides));
      await unchangedError(f, "CONFIG_INVALID");
      expect(f.authority).toHaveBeenCalledOnce();
      expect(f.getConnectionSpy).not.toHaveBeenCalled();
      expect(f.trace).toHaveLength(0);
    }
  );

  it("requires callback before SQL, redacts unsafe authority errors, rejects original foreign binding", async () => {
    for (const absent of [undefined, null, {}, "token"]) {
      const f = fixture(),
        before = savedRows(f);
      await expect(
        f.store.resumeStagedInitialImport!(11, 9, absent as any)
      ).rejects.toMatchObject({ code: "AUTH_DENIED" });
      expect(savedRows(f)).toEqual(before);
      expect(f.getConnectionSpy).not.toHaveBeenCalled();
    }
    const unsafe = fixture();
    unsafe.authority.mockImplementation(async () => {
      throw new Error("SECRET authority provider details");
    });
    await unchangedError(unsafe, "AUTH_DENIED");
    expect(unsafe.trace).toHaveLength(0);
    const foreign = fixture();
    foreign.changeConfig(
      reportingConfig({
        HQ_ORBIT_REPORTING_API_KEY: "different-key-" + "z".repeat(40),
      })
    );
    await unchangedError(foreign, "SOURCE_BINDING_CHANGED");
  });

  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])(
    "fresh authority denial at individual guard %s rolls back without cleanup",
    async deniedCall => {
      const f = fixture();
      f.authority.mockImplementation(async () => {
        if (f.authority.mock.calls.length === deniedCall)
          throw new HqLiveError("AUTH_DENIED");
      });
      await unchangedError(f, "AUTH_DENIED");
      expect(f.rollbacks.mock.calls).toHaveLength(deniedCall >= 5 ? 1 : 0);
      expect(mutations(f)).toHaveLength(deniedCall === 16 ? 1 : 0);
    }
  );

  it.each(["connection", "begin", "lock", "clock", "root", "chunk", "update"])(
    "always checks config and fresh authority after %s await; postUPDATE denial rolls back every byte",
    async point => {
      const f = fixture("v2"),
        replacement = reportingConfig({ HQ_LIVE_READ_ENABLED: "true" });
      let drift = false,
        callsAfterDrift = 0;
      const changed = () => {
        drift = true;
        f.changeConfig(replacement);
      };
      f.authority.mockImplementation(async () => {
        if (drift) callsAfterDrift++;
      });
      if (point === "connection") f.onConnection(changed);
      else if (point === "begin") f.onBegin(changed);
      else
        f.after((sql, args) => {
          if (
            (point === "lock" && args[0] === HQ_LIVE_CONTROL_DATASET_ID) ||
            (point === "clock" && sql.startsWith("SELECT CAST")) ||
            (point === "root" && args[0] === HQ_LIVE_SYNC_DATASET_ID) ||
            (point === "chunk" && sql.includes("datasetId IN")) ||
            (point === "update" && sql.startsWith("UPDATE"))
          )
            changed();
        });
      await unchangedError(f, "CONFIG_INVALID");
      expect(callsAfterDrift).toBe(1);
      expect(mutations(f)).toHaveLength(point === "update" ? 1 : 0);
      expect(f.rollbacks.mock.calls).toHaveLength(
        point === "connection" ? 0 : 1
      );
    }
  );

  it("connection drift cannot be hidden by restoration during beginTransaction", async () => {
    const f = fixture();
    const begin = vi.fn(() => {
      f.changeConfig(reportingConfig());
    });
    f.onConnection(() => {
      f.changeConfig(reportingConfig({ HQ_LIVE_READ_ENABLED: "true" }));
    });
    f.onBegin(begin);
    await unchangedError(f, "CONFIG_INVALID");
    expect(begin).not.toHaveBeenCalled();
    expect(f.trace).toHaveLength(0);
  });

  it.each(["connection", "begin"])(
    "rejected %s opening await still refreshes latched authority and configuration",
    async point => {
      const f = fixture();
      let failed = false,
        refreshed = 0;
      f.authority.mockImplementation(async () => {
        if (failed) refreshed++;
      });
      const rejected = () => {
        failed = true;
        f.changeConfig(reportingConfig({ HQ_LIVE_READ_ENABLED: "true" }));
        throw new Error("SECRET opening SQL failure");
      };
      if (point === "connection")
        f.getConnectionSpy.mockImplementation(async () => rejected());
      else f.onBegin(rejected);
      await unchangedError(f, "CONFIG_INVALID");
      expect(refreshed).toBe(1);
      expect(f.trace).toHaveLength(0);
      expect(f.rollbacks.mock.calls).toHaveLength(point === "begin" ? 1 : 0);
    }
  );

  it.each(["read-disabled", "binding", "authority"])(
    "multi-batch v2 %s drift then restoration cannot be hidden by a later chunk await",
    async kind => {
      const f = fixture("v2", multiBatch);
      const m = JSON.parse(
        f.rows.get(HQ_LIVE_SYNC_DATASET_ID)!.state
      ) as HqV2Manifest;
      expect(manifestChunkRefs(m).length).toBeGreaterThan(8);
      let batches = 0,
        drift = false,
        callsAfterDrift = 0;
      f.after(sql => {
        if (!sql.includes("datasetId IN")) return;
        batches++;
        if (batches === 1) {
          drift = true;
          if (kind !== "authority")
            f.changeConfig(
              reportingConfig(
                kind === "binding"
                  ? {
                      HQ_ORBIT_REPORTING_API_KEY:
                        "different-key-" + "z".repeat(40),
                    }
                  : { HQ_LIVE_READ_ENABLED: "true" }
              )
            );
        } else if (batches === 2) {
          drift = false;
          f.changeConfig(reportingConfig());
        }
      });
      f.authority.mockImplementation(async () => {
        if (!drift) return;
        callsAfterDrift++;
        // Restore during this awaited authority callback: pre-check failure must latch.
        f.changeConfig(reportingConfig());
        drift = false;
        if (kind === "authority") throw new HqLiveError("AUTH_DENIED");
      });
      await unchangedError(
        f,
        kind === "authority"
          ? "AUTH_DENIED"
          : kind === "binding"
            ? "SOURCE_BINDING_CHANGED"
            : "CONFIG_INVALID"
      );
      expect(batches).toBe(1);
      expect(callsAfterDrift).toBe(1);
      expect(mutations(f)).toHaveLength(0);
    }
  );

  it("valid multi-batch v2 reads all batches with pre/post checks and never writes root/chunks", async () => {
    const f = fixture("v2", multiBatch),
      before = savedRows(f);
    expect(await f.resume()).toBe("resumed");
    const batches = f.trace.filter(t => t.sql.includes("datasetId IN"));
    expect(batches.length).toBeGreaterThan(2);
    expect(f.authority.mock.calls.length).toBe(16 + 2 * batches.length);
    expect(
      savedRows(f).filter(([id]) => id !== HQ_LIVE_CONTROL_DATASET_ID)
    ).toEqual(before.filter(([id]) => id !== HQ_LIVE_CONTROL_DATASET_ID));
    expectOnlyResumeSql(f);
  });

  it.each(["root", "chunk", "update"])(
    "rejected %s SQL await still checks fresh authority/config and rolls back",
    async point => {
      const f = fixture("v2");
      let failed = false,
        checks = 0;
      f.authority.mockImplementation(async () => {
        if (failed) checks++;
      });
      f.before((sql, args) => {
        if (
          (point === "root" && args[0] === HQ_LIVE_SYNC_DATASET_ID) ||
          (point === "chunk" && sql.includes("datasetId IN")) ||
          (point === "update" && sql.startsWith("UPDATE"))
        ) {
          failed = true;
          f.changeConfig(reportingConfig({ HQ_LIVE_READ_ENABLED: "true" }));
          throw new Error("SECRET rejected SQL");
        }
      });
      await unchangedError(f, "CONFIG_INVALID");
      expect(checks).toBe(1);
      expect(f.rollbacks.mock.calls).toHaveLength(1);
    }
  );

  it("pre/post callback configuration and postUPDATE authority denial latch even after restoration", async () => {
    const f = fixture("v2");
    let updated = false;
    f.after(sql => {
      if (sql.startsWith("UPDATE")) {
        updated = true;
        f.changeConfig(reportingConfig({ HQ_LIVE_READ_ENABLED: "true" }));
      }
    });
    f.authority.mockImplementation(async () => {
      if (updated) f.changeConfig(reportingConfig());
    });
    await unchangedError(f, "CONFIG_INVALID");
    expect(mutations(f)).toHaveLength(1);
    const denied = fixture("v2");
    let saved = false;
    denied.after(sql => {
      if (sql.startsWith("UPDATE")) saved = true;
    });
    denied.authority.mockImplementation(async () => {
      if (saved) throw new HqLiveError("AUTH_DENIED");
    });
    await unchangedError(denied, "AUTH_DENIED");
    expect(mutations(denied)).toHaveLength(1);
    const during = fixture();
    during.authority.mockImplementation(async () => {
      during.changeConfig(reportingConfig({ HQ_LIVE_READ_ENABLED: "true" }));
    });
    await unchangedError(during, "CONFIG_INVALID");
    expect(during.getConnectionSpy).not.toHaveBeenCalled();
  });
});
