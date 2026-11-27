import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalHqJson } from "./management-hq-engine";
import { createHqLargeSyntheticReader } from "./management-hq-large-fixtures";
import type { HqImplementedSyncState } from "./management-hq-ingestion";
import {
  createHqLiveConfig,
  type HqLiveConfig,
} from "./management-hq-live-config";
import {
  createHqLiveStore,
  HqLiveError,
  HQ_LIVE_CONTROL_DATASET_ID as CONTROL,
  HQ_LIVE_SYNC_DATASET_ID as SYNC,
  parseHqLiveControlRow,
  type HqLiveControl,
  type HqLiveInitialCapacityRepair,
} from "./management-hq-live-store";
import * as codec from "./management-hq-storage-v2";
import {
  offlineHqV2Pool,
  type HqV2OfflineRow,
} from "./management-hq-storage-v2-pool";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const MAX_VERSION = 2147483646;
const configFor = (overrides: Record<string, string> = {}) =>
  createHqLiveConfig({
    HQ_LIVE_SYNC_ENABLED: "true",
    HQ_LIVE_READ_ENABLED: "false",
    HQ_ORBIT_REPORTING_BASE_URL:
      "https://offline-synthetic.probe.tld/api/management-hq",
    HQ_ORBIT_REPORTING_API_KEY: "synthetic-key-" + "a".repeat(40),
    HQ_PORTAL_SYNC_TOKEN: "synthetic-token-" + "b".repeat(40),
    ...overrides,
  });
const row = (id: string, state: string, version = 1): HqV2OfflineRow => ({
  datasetId: id,
  state,
  stateVersion: version,
  mode: "live",
  ownerUserId: 0,
  updatedAt: "2026-11-22T11:55:00.000Z",
});
let near: HqImplementedSyncState;
let small: HqImplementedSyncState;
let nearEncoded: ReturnType<typeof codec.encodeHqLiveV2Sync>;
let smallEncoded: ReturnType<typeof codec.encodeHqLiveV2Sync>;
beforeAll(async () => {
  const reader = createHqLargeSyntheticReader({
    bookingCount: 1,
    paddingBytes: 0,
  });
  const { ready: _ready, ...metadata } = await reader.status();
  const entity = (await reader.bookings()).items[0];
  small = {
    version: 66,
    published: null,
    stage: {
      kind: "backfill",
      phase: "bookings",
      basePublishedVersion: null,
      metadata: {
        ...metadata,
        counts: { bookingCount: 100, businessCount: 1 },
      },
      cursor: "offline-page-66",
      pendingResumeCursor: "offline-checkpoint",
      entities: {},
      seqProofs: {},
      feedKeys: { booking: [], business: [] },
      catalogueKeys: { booking: [], business: [] },
      cursors: ["bookings:offline-page-65"],
      pages: 66,
      recordsRead: 80,
      lastSeq: null,
    },
  };
  small.stage!.entities[`booking:${entity.entityId}`] = {
    entity,
    absent: false,
    canonicalPayload: canonicalHqJson(entity),
  };
  small.stage!.feedKeys.booking.push(`booking:${entity.entityId}`);
  smallEncoded = codec.encodeHqLiveV2Sync(
    small,
    configFor().sourceFingerprint()!
  );
  near = clone(small);
  near.stage!.entities = {};
  near.stage!.feedKeys.booking = [];
  // Real strict source entities with bounded 4096-unit strings. This is NOT a
  // lowered-cap profile or a forged manifest count. Encode once, reuse immutable
  // serialized fixture strings across independent offline transaction models.
  const padding = Array(180).fill("S".repeat(4096));
  for (let i = 0; i < 80; i++) {
    const id = 910000001 + i;
    const entity = {
      entityType: "booking" as const,
      entityId: id,
      revision: 1,
      payload: {
        deleted: true as const,
        reason: "source_absent_or_now_explicit_demo" as const,
        entityType: "booking" as const,
        entityId: id,
        syntheticCapacityExtension: padding,
      },
    };
    near.stage!.entities[`booking:${id}`] = {
      entity,
      absent: false,
      canonicalPayload: canonicalHqJson(entity),
    };
    near.stage!.feedKeys.booking.push(`booking:${id}`);
  }
  nearEncoded = codec.encodeHqLiveV2Sync(
    near,
    configFor().sourceFingerprint()!
  );
  expect(nearEncoded.manifest.compactBytes).toBeGreaterThanOrEqual(
    56 * 1024 * 1024
  );
  expect(nearEncoded.manifest.compactBytes).toBeLessThanOrEqual(
    codec.HQ_LIVE_V2_OLD_COMPACT_BYTES
  );
  expect(nearEncoded.manifest.expandedBytes).toBeLessThanOrEqual(
    codec.HQ_LIVE_V2_OLD_EXPANDED_BYTES
  );
}, 120000);
afterEach(() => vi.restoreAllMocks());

function fixture(
  encoded = nearEncoded,
  options: Parameters<typeof createHqLiveStore>[2] = {}
) {
  const db = offlineHqV2Pool();
  let current = configFor();
  const config: HqLiveConfig = {
    status: () => current.status(),
    sourceFingerprint: () => current.sourceFingerprint(),
    authorizeTrigger: token => current.authorizeTrigger(token),
    createReader: vi.fn(() => {
      throw new Error("no source work");
    }),
  };
  const initial: HqLiveControl = {
    format: "hq-live-control-v1",
    version: 71,
    sourceFingerprint: current.sourceFingerprint()!,
    fencingNumber: 9,
    leaseToken: null,
    leaseExpiresAtMs: null,
    leaseHardExpiresAtMs: null,
    nextDueAtMs: db.now() - 1000,
    consecutiveFailures: 3,
    lastAttemptAtMs: db.now() - 10000,
    lastSuccessAtMs: null,
    lastPublishAtMs: null,
    lastErrorCode: "INVALID_PERSISTED_STATE",
    stageStatus: "needs_attention",
    initialRecovery: {
      format: "empty-initial-recovery-v1",
      atMs: db.now() - 50000,
      fromControlVersion: 3,
      previousErrorCode: "INVALID_SEMANTICS",
      previousAttemptAtMs: db.now() - 60000,
    },
    initialStagedResume: {
      format: "staged-initial-resume-v1",
      atMs: db.now() - 20000,
      fromControlVersion: 5,
      syncVersion: 8,
      previousErrorCode: "STATE_BYTE_CAP_EXCEEDED",
      previousAttemptAtMs: db.now() - 30000,
      previousConsecutiveFailures: 1,
      pages: 1,
      recordsRead: 1,
    },
  };
  db.rows.set(CONTROL, row(CONTROL, JSON.stringify(initial), initial.version));
  db.rows.set(
    SYNC,
    row(
      SYNC,
      " \n" + JSON.stringify(encoded.manifest) + "\n ",
      encoded.manifest.syncVersion
    )
  );
  for (const chunk of encoded.chunks)
    db.rows.set(chunk.id, row(chunk.id, chunk.serialized));
  db.rows.set("sample-sync:47", {
    ...row("sample-sync:47", "unrelated sample bytes"),
    mode: "sample",
    ownerUserId: 47,
  });
  const orphan = "live:company:orbit:v2:chunk:" + "f".repeat(64);
  db.rows.set(orphan, row(orphan, "unreferenced orphan bytes"));
  const store = createHqLiveStore(db.pool, config, options);
  const authority = vi.fn(async () => {});
  return {
    ...db,
    initial,
    config,
    store,
    authority,
    repair: (cv = 71, sv = 66, guard = authority) =>
      store.repairInitialCapacity!(cv, sv, guard),
    control: (): HqLiveControl => JSON.parse(db.rows.get(CONTROL)!.state),
    patchControl: (patch: Partial<HqLiveControl>) => {
      const r = db.rows.get(CONTROL)!;
      const c = { ...JSON.parse(r.state), ...patch };
      r.stateVersion = c.version;
      r.state = JSON.stringify(c);
    },
    changeConfig: (replacement: HqLiveConfig) => {
      current = replacement;
    },
  };
}
function saved(f: ReturnType<typeof fixture>) {
  return [...f.rows].map(([id, r]) => [id, { ...r }] as const);
}
function writes(f: ReturnType<typeof fixture>) {
  return f.trace.filter(t => /^(INSERT|UPDATE|DELETE)/.test(t.sql));
}
function onlyRepair(f: ReturnType<typeof fixture>) {
  expect(f.config.createReader).not.toHaveBeenCalled();
  for (const t of f.trace) {
    expect(t.sql).not.toMatch(
      /\b(?:INSERT|DELETE|REPLACE|LIKE|REGEXP|CREATE|ALTER|DROP|TRUNCATE)\b/
    );
    if (t.sql.startsWith("UPDATE")) expect(t.args[2]).toBe(CONTROL);
    if (t.sql.includes("datasetId IN"))
      expect(t.args.length).toBeLessThanOrEqual(4);
  }
}
async function unchanged(
  f: ReturnType<typeof fixture>,
  result: string,
  cv = 71,
  sv = 66
) {
  const before = saved(f);
  expect(await f.repair(cv, sv)).toBe(result);
  expect(saved(f)).toEqual(before);
  expect(writes(f)).toHaveLength(0);
  onlyRepair(f);
}
async function errorUnchanged(
  f: ReturnType<typeof fixture>,
  code: string,
  cv = 71
) {
  const before = saved(f);
  const commits = f.commits.mock.calls.length;
  await expect(f.repair(cv)).rejects.toMatchObject({ code });
  expect(saved(f)).toEqual(before);
  expect(f.commits.mock.calls.length).toBe(commits);
  onlyRepair(f);
}
function marker(f: ReturnType<typeof fixture>): HqLiveInitialCapacityRepair {
  return {
    format: "staged-initial-capacity-repair-v1",
    atMs: f.now(),
    fromControlVersion: 71,
    syncVersion: 66,
    previousErrorCode: f.initial.lastErrorCode as "INVALID_PERSISTED_STATE",
    previousAttemptAtMs: f.initial.lastAttemptAtMs!,
    previousConsecutiveFailures: 3,
    pages: 66,
    recordsRead: 80,
  };
}

describe("one-shot initial capacity repair: real strict V2 offline store", () => {
  it("one control CAS preserves every root/chunk/sample/orphan byte and original due/history/audits", async () => {
    const f = fixture();
    const before = saved(f);
    expect(await f.repair()).toBe("repaired");
    expect(f.control()).toEqual({
      ...f.initial,
      version: 72,
      fencingNumber: 10,
      stageStatus: "progress",
      lastErrorCode: null,
      initialCapacityRepair: marker(f),
    });
    expect(saved(f).filter(([id]) => id !== CONTROL)).toEqual(
      before.filter(([id]) => id !== CONTROL)
    );
    expect(writes(f)).toHaveLength(1);
    expect(writes(f)[0].args[3]).toBe(71);
    expect(f.commits.mock.calls).toHaveLength(1);
    onlyRepair(f);
  }, 120000);
  it("concurrent one winner; stale/replayed attention error cannot repeat the audit", async () => {
    const f = fixture();
    expect((await Promise.all([f.repair(), f.repair()])).sort()).toEqual([
      "not_repairable",
      "repaired",
    ]);
    const audit = f.control().initialCapacityRepair;
    f.patchControl({
      version: 73,
      stageStatus: "needs_attention",
      lastErrorCode: "STATE_BYTE_CAP_EXCEEDED",
    });
    const start = f.trace.length;
    await unchanged(
      { ...f, trace: f.trace.slice(start) },
      "not_repairable",
      73
    );
    expect(f.control().initialCapacityRepair).toEqual(audit);
    expect(writes(f)).toHaveLength(1);
  }, 120000);
  it("cold independent full decode is mandatory despite a populated cooperative cache", async () => {
    const f = fixture(nearEncoded, {
      validatedInitialReuseScope: "d".repeat(64),
    });
    await f.store.readSnapshot();
    const decode = vi.spyOn(codec, "decodeHqLiveV2Sync");
    const asyncDecode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
    expect(await f.repair()).toBe("repaired");
    expect(decode).toHaveBeenCalledOnce();
    expect(asyncDecode).not.toHaveBeenCalled();
  }, 120000);
  it("uses the fresh full-read clock for due and expiry and accepts original zero due", async () => {
    const future = fixture();
    future.patchControl({ nextDueAtMs: future.now() + 1 });
    await unchanged(future, "notdue");
    const waited = fixture();
    const due = waited.now() + 10000;
    waited.patchControl({ nextDueAtMs: due });
    let moved = false;
    waited.setAfterHook(sql => {
      if (!moved && sql.includes("datasetId IN")) {
        moved = true;
        waited.advance(10000);
      }
    });
    expect(await waited.repair()).toBe("repaired");
    expect(waited.control().nextDueAtMs).toBe(due);
    expect(waited.control().initialCapacityRepair!.atMs).toBe(waited.now());
    const expired = fixture();
    expired.setAfterHook(sql => {
      if (sql.includes("datasetId IN"))
        expired.advance(Date.parse("2100-01-01") - expired.now());
    });
    await unchanged(expired, "not_repairable");
    const zero = fixture();
    zero.patchControl({ nextDueAtMs: 0 });
    expect(await zero.repair()).toBe("repaired");
    expect(zero.control().nextDueAtMs).toBe(0);
  }, 120000);
  it.each(["active", "expired", "equal"])(
    "never clears a %s nonnull lease",
    async kind => {
      const f = fixture(smallEncoded);
      f.patchControl({
        leaseToken: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        lastAttemptAtMs: f.now() - 1000,
        leaseExpiresAtMs:
          f.now() + (kind === "active" ? 1000 : kind === "equal" ? 0 : -1),
        leaseHardExpiresAtMs: f.now() + 90000,
      });
      await unchanged(f, kind === "active" ? "busy" : "not_repairable");
    }
  );
  it.each([
    { stageStatus: "progress" },
    { lastErrorCode: "INVALID_SEMANTICS" },
    { lastErrorCode: null },
    { consecutiveFailures: 0 },
    { lastAttemptAtMs: null },
    { lastSuccessAtMs: 1 },
    { lastPublishAtMs: 1 },
  ] satisfies Partial<HqLiveControl>[])(
    "denies noninitial attention predicate %j",
    async patch => {
      const f = fixture(smallEncoded);
      f.patchControl(patch);
      await unchanged(f, "not_repairable");
    }
  );
  it("denies mismatched observations/missing root or control, valid small/not-near, and valid legacy V1", async () => {
    for (const [cv, sv] of [
      [70, 66],
      [71, 65],
      [0, 66],
      [71, 0],
      [NaN, 66],
    ])
      await unchanged(fixture(smallEncoded), "not_repairable", cv, sv);
    for (const id of [CONTROL, SYNC]) {
      const f = fixture(smallEncoded);
      f.rows.delete(id);
      await unchanged(f, "not_repairable");
    }
    await unchanged(fixture(smallEncoded), "not_repairable");
    const legacy = fixture(smallEncoded);
    legacy.rows.set(
      SYNC,
      row(
        SYNC,
        JSON.stringify({
          format: "hq-live-sync-v1",
          sourceFingerprint: legacy.initial.sourceFingerprint,
          sync: small,
        }),
        66
      )
    );
    await unchanged(legacy, "not_repairable");
  });
  it.each([
    "unknown-counts",
    "unsafe-counts",
    "empty-counts",
    "feed-over-count",
    "no-page-room",
    "no-record-room",
    "published",
  ])(
    "denies actual valid near-threshold %s state without changing any row",
    async kind => {
      const state = {
        ...near,
        stage: { ...near.stage!, metadata: { ...near.stage!.metadata! } },
      };
      if (kind === "unknown-counts") state.stage.metadata.counts = {};
      if (kind === "unsafe-counts")
        state.stage.metadata.counts = { bookingCount: "100", businessCount: 1 };
      if (kind === "empty-counts")
        state.stage.metadata.counts = { bookingCount: 0, businessCount: 0 };
      if (kind === "feed-over-count")
        state.stage.metadata.counts = { bookingCount: 79, businessCount: 1 };
      if (kind === "no-page-room") state.stage.pages = 1000;
      if (kind === "no-record-room") state.stage.recordsRead = 100000;
      if (kind === "published") {
        state.published = {
          wireVersion: "1.0.0",
          version: 65,
          scope: state.stage.metadata.scope,
          metadata: state.stage.metadata,
          resumeCursor: "offline-published",
          entities: {},
          seqProofs: {},
        };
        state.stage.basePublishedVersion = 65;
      }
      const encoded = codec.encodeHqLiveV2Sync(
        state,
        configFor().sourceFingerprint()!
      );
      expect(encoded.manifest.compactBytes).toBeGreaterThanOrEqual(
        56 * 1024 * 1024
      );
      await unchanged(fixture(encoded), "not_repairable");
    },
    120000
  );
  it("accepts the explicit capacity error and preserves missing previous audits", async () => {
    const f = fixture();
    f.patchControl({
      lastErrorCode: "STATE_BYTE_CAP_EXCEEDED",
      consecutiveFailures: 1,
      initialRecovery: undefined,
      initialStagedResume: undefined,
    });
    expect(await f.repair()).toBe("repaired");
    expect(f.control().initialCapacityRepair).toMatchObject({
      previousErrorCode: "STATE_BYTE_CAP_EXCEEDED",
      previousConsecutiveFailures: 1,
    });
    expect(f.control()).not.toHaveProperty("initialRecovery");
    expect(f.control()).not.toHaveProperty("initialStagedResume");
  }, 120000);
  it.each(["version", "fence"])(
    "fencing/version %s exhaustion rolls back without an UPDATE",
    async kind => {
      const f = fixture();
      f.patchControl(
        kind === "version"
          ? { version: MAX_VERSION }
          : { fencingNumber: MAX_VERSION }
      );
      await errorUnchanged(
        f,
        "VERSION_EXHAUSTED",
        kind === "version" ? MAX_VERSION : 71
      );
      expect(writes(f)).toHaveLength(0);
      expect(f.rollbacks.mock.calls).toHaveLength(1);
    },
    120000
  );
  it.each([
    "root-json",
    "root-hash",
    "root-version",
    "root-binding",
    "ref-namespace",
    "missing-chunk",
    "chunk-hash",
    "ref-cap",
    "root-byte-cap",
  ])(
    "corrupt %s remains INVALID_PERSISTED_STATE, never masked as repairable",
    async kind => {
      const f = fixture(smallEncoded);
      const root = f.rows.get(SYNC)!;
      const m = JSON.parse(root.state) as codec.HqV2Manifest;
      const ref = m.groups[0].chunks[0];
      if (kind === "root-json") root.state = "{broken";
      if (kind === "root-hash") m.sha256 = "0".repeat(64);
      if (kind === "root-version") root.stateVersion++;
      if (kind === "root-binding") m.sourceFingerprint = "b".repeat(64);
      if (kind === "ref-namespace") ref.id = "sample-sync:47";
      if (kind === "missing-chunk") f.rows.delete(ref.id);
      if (kind === "chunk-hash") {
        const c = f.rows.get(ref.id)!;
        const value = JSON.parse(c.state);
        value.sha256 = "0".repeat(64);
        c.state = JSON.stringify(value);
      }
      if (kind === "ref-cap") m.groups[0].chunks = Array(257).fill(ref);
      if (kind === "root-byte-cap")
        m.compactBytes = codec.HQ_LIVE_V2_COMPACT_BYTES + 1;
      if (kind !== "root-json") root.state = JSON.stringify(m);
      await errorUnchanged(
        f,
        kind === "root-binding"
          ? "SOURCE_BINDING_CHANGED"
          : "INVALID_PERSISTED_STATE"
      );
    }
  );
  it("strictly validates exact capacity audit keys, types and bounds inside the existing 4096-byte control cap", () => {
    const f = fixture(smallEncoded);
    const valid = { ...marker(f), fromControlVersion: 70 };
    const invalid: unknown[] = [
      null,
      {},
      [],
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
    ]) {
      for (const value of [0, -1, 1.5, "1", null, Number.MAX_SAFE_INTEGER + 1])
        invalid.push({ ...valid, [key]: value });
    }
    invalid.push(
      { ...valid, fromControlVersion: 71 },
      { ...valid, syncVersion: MAX_VERSION + 1 },
      { ...valid, previousConsecutiveFailures: 1000001 },
      { ...valid, pages: 1001 },
      { ...valid, recordsRead: 100001 }
    );
    for (const value of invalid)
      expect(() =>
        parseHqLiveControlRow(
          row(
            CONTROL,
            JSON.stringify({ ...f.initial, initialCapacityRepair: value }),
            71
          ) as any
        )
      ).toThrow("INVALID_PERSISTED_STATE");
    expect(
      parseHqLiveControlRow(
        row(
          CONTROL,
          JSON.stringify({ ...f.initial, initialCapacityRepair: valid }),
          71
        ) as any
      ).initialCapacityRepair
    ).toEqual(valid);
    expect(() =>
      parseHqLiveControlRow(
        row(
          CONTROL,
          JSON.stringify({ ...f.initial, initialCapacityRepair: valid }) +
            " ".repeat(4097),
          71
        ) as any
      )
    ).toThrow("INVALID_PERSISTED_STATE");
  });
  it("zero control CAS and SQL failure rollback all bytes without promoting an audit", async () => {
    const zero = fixture();
    zero.setHook((sql, args, draft) => {
      if (sql.startsWith("UPDATE")) draft.get(args[2])!.stateVersion++;
    });
    await errorUnchanged(zero, "LEASE_LOST");
    expect(writes(zero)).toHaveLength(1);
    expect(zero.rollbacks.mock.calls).toHaveLength(1);
    const failed = fixture();
    failed.setAfterHook(sql => {
      if (sql.startsWith("UPDATE")) throw new Error("unsafe SQL text");
    });
    await errorUnchanged(failed, "STORE_UNAVAILABLE");
    expect(failed.rollbacks.mock.calls).toHaveLength(1);
  }, 120000);
  it.each(["authority", "read-enable", "binding"])(
    "post-UPDATE %s denial rolls back every row and audit",
    async kind => {
      const f = fixture();
      let updated = false;
      f.setAfterHook(sql => {
        if (!sql.startsWith("UPDATE")) return;
        updated = true;
        if (kind !== "authority")
          f.changeConfig(
            configFor(
              kind === "binding"
                ? {
                    HQ_ORBIT_REPORTING_API_KEY: "changed-key-" + "z".repeat(40),
                  }
                : { HQ_LIVE_READ_ENABLED: "true" }
            )
          );
      });
      f.authority.mockImplementation(async () => {
        if (updated && kind === "authority")
          throw new HqLiveError("AUTH_DENIED");
      });
      await errorUnchanged(
        f,
        kind === "authority"
          ? "AUTH_DENIED"
          : kind === "binding"
            ? "SOURCE_BINDING_CHANGED"
            : "CONFIG_INVALID"
      );
      expect(writes(f)).toHaveLength(1);
      expect(f.rollbacks.mock.calls).toHaveLength(1);
    },
    120000
  );
  it.each(["connection", "begin"])(
    "opening %s rejected await still refreshes authority and cannot hide drift restoration",
    async point => {
      const f = fixture(smallEncoded);
      let drift = false;
      const original = f.pool.getConnection.bind(f.pool);
      vi.spyOn(f.pool, "getConnection").mockImplementation(async () => {
        if (point === "connection") {
          drift = true;
          f.changeConfig(configFor({ HQ_LIVE_READ_ENABLED: "true" }));
          throw new Error("opening failure");
        }
        const c = await original();
        const begin = c.beginTransaction.bind(c);
        c.beginTransaction = async () => {
          await begin();
          drift = true;
          f.changeConfig(configFor({ HQ_LIVE_READ_ENABLED: "true" }));
          throw new Error("begin failure");
        };
        return c;
      });
      f.authority.mockImplementation(async () => {
        if (drift) {
          f.changeConfig(configFor());
          drift = false;
        }
      });
      await errorUnchanged(f, "CONFIG_INVALID");
      expect(f.trace).toHaveLength(0);
      expect(f.rollbacks.mock.calls).toHaveLength(point === "begin" ? 1 : 0);
    }
  );
  it("requires strict sync-on/read-off and mandatory authority before SQL", async () => {
    for (const overrides of [
      { HQ_LIVE_READ_ENABLED: "true" },
      { HQ_LIVE_SYNC_ENABLED: "false" },
      { HQ_LIVE_INTERVAL_SECONDS: "1" },
    ]) {
      const f = fixture(smallEncoded);
      f.changeConfig(configFor(overrides));
      await errorUnchanged(f, "CONFIG_INVALID");
      expect(f.trace).toHaveLength(0);
      expect(f.authority).toHaveBeenCalledOnce();
    }
    const f = fixture(smallEncoded);
    await expect(
      f.store.repairInitialCapacity!(71, 66, undefined as any)
    ).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(f.trace).toHaveLength(0);
  });
});
