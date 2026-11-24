import { beforeAll, describe, expect, it } from "vitest";
import { canonicalHqJson } from "./management-hq-engine";
import {
  createHqLiveConfig,
  type HqLiveConfig,
} from "./management-hq-live-config";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  type HqImplementedSyncState,
} from "./management-hq-ingestion";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
import { createHqLargeSyntheticReader } from "./management-hq-large-fixtures";
import {
  createHqLiveStore,
  HQ_LIVE_CONTROL_DATASET_ID,
  HQ_LIVE_SYNC_DATASET_ID,
  type HqLiveLease,
} from "./management-hq-live-store";
import {
  encodeHqLiveV2Sync,
  hqJsonUtf8Bytes,
  manifestChunkRefs,
  HQ_LIVE_V2_VALIDATION_OPTIONS,
  type HqV2Manifest,
} from "./management-hq-storage-v2";
import {
  offlineHqV2Pool,
  type HqV2OfflineRow,
} from "./management-hq-storage-v2-pool";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const CHUNK_PREFIX = "live:company:orbit:v2:chunk:";
const config = () =>
  createHqLiveConfig({
    HQ_LIVE_SYNC_ENABLED: "true",
    HQ_LIVE_READ_ENABLED: "true",
    HQ_ORBIT_REPORTING_BASE_URL:
      "https://reporting.orbittravel.co.uk/api/management-hq",
    HQ_ORBIT_REPORTING_API_KEY: "orbit-test-key-not-live-" + "a".repeat(32),
    HQ_PORTAL_SYNC_TOKEN: "portal-test-token-not-live-" + "b".repeat(32),
  });
let small: HqImplementedSyncState;
let large: HqImplementedSyncState;
let staged: HqImplementedSyncState;
beforeAll(async () => {
  const memory = createHqImplementedMemoryStore();
  await createHqImplementedEngine(
    createHqImplementedSampleReader("initial"),
    memory
  ).sync();
  small = { ...(await memory.readSync())!, version: 1 };
  large = clone(small);
  const original = large.published!.entities["booking:1"];
  large.published!.entities = {};
  for (let index = 1; index <= 128; index++) {
    const record = clone(original);
    record.entity.entityId = index;
    Object.assign(record.entity.payload, { orbitBookingId: index });
    Object.assign(record.entity.payload, {
      offlineExtension: {
        unicode: '雪😀é\\"\n',
        array: [true, null, "keep-order", 3],
        padding: Array.from({ length: 8 }, () => "S".repeat(4096)),
      },
    });
    if (index === 7)
      record.entity.payload = {
        deleted: true,
        entityType: "booking",
        entityId: index,
        reason: "source_absent_or_now_explicit_demo",
      };
    record.canonicalPayload = canonicalHqJson(record.entity);
    record.absent = index === 9;
    large.published!.entities[`booking:${index}`] = record;
  }
  const stageMemory = createHqImplementedMemoryStore();
  let calls = 0;
  await createHqImplementedEngine(
    createHqImplementedSampleReader("initial"),
    stageMemory,
    { shouldContinue: () => ++calls <= 3 }
  ).backfill();
  staged = { ...(await stageMemory.readSync())!, version: 1 };
}, 30000);
async function setup(binding: HqLiveConfig = config()) {
  const f = offlineHqV2Pool(),
    store = createHqLiveStore(f.pool, binding);
  const acquired = await store.acquire();
  if (acquired.status !== "acquired") throw new Error("offline lease required");
  return {
    f,
    store,
    lease: acquired.lease,
    fenced: store.fencedSyncStore(acquired.lease),
    binding,
  };
}
const stateAt = (state: HqImplementedSyncState, version: number) => ({
  ...clone(state),
  version,
});
const manifest = (f: ReturnType<typeof offlineHqV2Pool>) =>
  JSON.parse(f.rows.get(HQ_LIVE_SYNC_DATASET_ID)!.state) as HqV2Manifest;
const row = (id: string, state: string, version = 1): HqV2OfflineRow => ({
  datasetId: id,
  mode: "live",
  ownerUserId: 0,
  stateVersion: version,
  state,
  updatedAt: "2026-11-22T12:00:00.000Z",
});
function seedV2(
  f: ReturnType<typeof offlineHqV2Pool>,
  state: HqImplementedSyncState,
  fingerprint: string
) {
  const encoded = encodeHqLiveV2Sync(state, fingerprint);
  f.rows.set(
    HQ_LIVE_SYNC_DATASET_ID,
    row(
      HQ_LIVE_SYNC_DATASET_ID,
      JSON.stringify(encoded.manifest),
      state.version
    )
  );
  for (const chunk of encoded.chunks)
    f.rows.set(chunk.id, row(chunk.id, chunk.serialized));
  return encoded;
}
function changed(state: HqImplementedSyncState, version = state.version + 1) {
  const next = stateAt(state, version);
  const records = next.published?.entities ?? next.stage!.entities;
  const record = records[Object.keys(records)[0]];
  Object.assign(record.entity.payload, {
    offlineAmendment: ["exact-new-value", false],
  });
  record.canonicalPayload = canonicalHqJson(record.entity);
  return next;
}
function mutation(sql: string, args: any[]) {
  if (sql.startsWith("INSERT"))
    return args[0].startsWith(CHUNK_PREFIX) ? "chunkINSERT" : "rootINSERT";
  if (sql.startsWith("DELETE")) return "chunkDELETE";
  if (sql.startsWith("UPDATE"))
    return args[2] === HQ_LIVE_CONTROL_DATASET_ID
      ? "controlUPDATE"
      : "rootUPDATE";
  return null;
}
type MysqlChunkRepresentation = "reordered-string" | "parsed-object";
function mysqlChunkResults(
  f: ReturnType<typeof offlineHqV2Pool>,
  representation: MysqlChunkRepresentation
) {
  const observed = { strings: 0, objects: 0 };
  f.setRowHook((_sql, _args, selected) =>
    selected.map(current => {
      if (!current.datasetId.startsWith(CHUNK_PREFIX)) return current;
      const reordered = Object.fromEntries(
        Object.entries(JSON.parse(current.state)).reverse()
      );
      const state = " \n" + JSON.stringify(reordered, null, 2) + "\n\t ";
      expect(state).not.toBe(current.state);
      observed.strings++;
      return { ...current, state };
    })
  );
  if (representation === "parsed-object") {
    // The fixture measures string response bytes before returning rows. Model
    // mysql2's JSON object decoding at that return boundary, without changing it.
    const getConnection = f.pool.getConnection.bind(f.pool);
    f.pool.getConnection = async () => {
      const connection = await getConnection();
      const execute = connection.execute.bind(connection);
      connection.execute = (async (sql: string, args?: any[]) => {
        const result = await execute(sql, args);
        if (Array.isArray(result[0])) {
          for (const current of result[0] as any[]) {
            if (!current.datasetId?.startsWith(CHUNK_PREFIX)) continue;
            current.state = JSON.parse(current.state);
            observed.objects++;
          }
        }
        return result;
      }) as typeof connection.execute;
      return connection;
    };
  }
  return observed;
}
function corruptChunkData(state: string) {
  const value = JSON.parse(state);
  const raw = Buffer.from(value.data, "base64");
  raw[0] ^= 1;
  value.data = raw.toString("base64");
  return canonicalHqJson(value);
}
describe("offline actual live-store storage v2", () => {
  it("keeps deterministic small v1 roots and exact 16 MiB legacy read bounds", async () => {
    const { f, store, fenced, lease } = await setup();
    expect(await fenced.compareAndSwapSync(null, small)).toBe(true);
    expect(JSON.parse(f.rows.get(HQ_LIVE_SYNC_DATASET_ID)!.state).format).toBe(
      "hq-live-sync-v1"
    );
    const envelope = JSON.stringify({
      format: "hq-live-sync-v1",
      sourceFingerprint: lease.sourceFingerprint,
      sync: small,
    });
    f.rows.get(HQ_LIVE_SYNC_DATASET_ID)!.state =
      envelope + " ".repeat(16 * 1024 * 1024 - Buffer.byteLength(envelope));
    expect((await store.readSnapshot()).sync).toEqual(small);
    f.rows.get(HQ_LIVE_SYNC_DATASET_ID)!.state += " ";
    await expect(store.readSnapshot()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_STATE",
    });
  });
  it("roundtrips exact Unicode/extensions/tombstones, reloads cleanly, and reads control first in <=4 MiB batches", async () => {
    const { f, store, fenced, binding } = await setup();
    expect(hqJsonUtf8Bytes(large)).toBeGreaterThan(8 * 1024 * 1024);
    expect(await fenced.compareAndSwapSync(null, large)).toBe(true);
    expect(manifest(f).format).toBe("hq-live-sync-manifest-v2");
    const start = f.trace.length;
    const reloaded = await createHqLiveStore(f.pool, binding).readSnapshot();
    expect(reloaded.sync).toEqual(large);
    expect(reloaded.sync!.published!.entities["booking:9"].absent).toBe(true);
    expect(
      reloaded.sync!.published!.entities["booking:7"].entity.payload
    ).toMatchObject({ deleted: true });
    const reads = f.trace.slice(start);
    expect(reads[0].args).toEqual([HQ_LIVE_CONTROL_DATASET_ID]);
    expect(reads[0].sql).toContain("FOR UPDATE");
    for (const t of reads.filter(t => t.sql.includes("datasetId IN"))) {
      expect(t.args.length).toBeLessThanOrEqual(4);
      expect(t.responseBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    }
    expect(await store.readPublished()).toEqual(large.published);
  }, 30000);
  it.each(["reordered-string", "parsed-object"] as const)(
    "roundtrips and reuses exact chunk bytes from MySQL-style %s wrappers",
    async representation => {
      const { f, store, fenced, binding } = await setup();
      expect(await fenced.compareAndSwapSync(null, large)).toBe(true);
      expect(manifest(f).format).toBe("hq-live-sync-manifest-v2");
      const observed = mysqlChunkResults(f, representation);
      expect(
        (await createHqLiveStore(f.pool, binding).readSnapshot()).sync
      ).toEqual(large);
      expect(await store.readPublished()).toEqual(large.published);
      const before = clone(
          [...f.rows].filter(([id]) => id.startsWith(CHUNK_PREFIX))
        ),
        refs = manifestChunkRefs(manifest(f)),
        start = f.trace.length,
        next = stateAt(large, 2);
      expect(await fenced.compareAndSwapSync(1, next)).toBe(true);
      expect(manifestChunkRefs(manifest(f))).toEqual(refs);
      expect(
        f.trace.slice(start).filter(t => /^(?:INSERT|DELETE)/.test(t.sql))
      ).toHaveLength(0);
      expect([...f.rows].filter(([id]) => id.startsWith(CHUNK_PREFIX))).toEqual(
        before
      );
      expect((await store.readSnapshot()).sync).toEqual(next);
      expect(observed.strings).toBeGreaterThan(0);
      expect(observed.objects).toBe(
        representation === "parsed-object" ? observed.strings : 0
      );
    },
    30000
  );
  it("migrates a legacy nine-page stage only on successful next CAS without publication or due changes", async () => {
    const { f, store, fenced, lease } = await setup();
    const memory = createHqImplementedMemoryStore();
    let calls = 0;
    await createHqImplementedEngine(
      createHqLargeSyntheticReader({ bookingCount: 1200, paddingBytes: 3000 }),
      memory,
      { ...HQ_LIVE_V2_VALIDATION_OPTIONS, shouldContinue: () => ++calls <= 11 }
    ).backfill();
    const legacyStage = (await memory.readSync())!;
    expect(legacyStage.stage).toMatchObject({ pages: 9, recordsRead: 900 });
    const envelope = JSON.stringify({
      format: "hq-live-sync-v1",
      sourceFingerprint: lease.sourceFingerprint,
      sync: legacyStage,
    });
    expect(Buffer.byteLength(envelope)).toBeGreaterThan(8 * 1024 * 1024);
    expect(Buffer.byteLength(envelope)).toBeLessThan(16 * 1024 * 1024);
    f.rows.set(
      HQ_LIVE_SYNC_DATASET_ID,
      row(HQ_LIVE_SYNC_DATASET_ID, envelope, legacyStage.version)
    );
    const controlBefore = f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.state;
    expect((await store.readSnapshot()).sync).toEqual(legacyStage);
    const next = stateAt(legacyStage, legacyStage.version + 1);
    expect(
      await fenced.compareAndSwapSync(
        legacyStage.version - 1,
        stateAt(legacyStage, legacyStage.version)
      )
    ).toBe(false);
    expect(f.rows.get(HQ_LIVE_SYNC_DATASET_ID)!.state).toBe(envelope);
    expect(await fenced.compareAndSwapSync(legacyStage.version, next)).toBe(
      true
    );
    expect(manifest(f).format).toBe("hq-live-sync-manifest-v2");
    expect(
      (await createHqLiveStore(f.pool, config()).readSnapshot()).sync
    ).toEqual(next);
    expect(await store.readPublished()).toBeNull();
    expect(f.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.state).toBe(controlBefore);
  }, 60000);
  it("once v2 always v2, even after a small cleanup state", async () => {
    const { f, fenced, store } = await setup();
    expect(await fenced.compareAndSwapSync(null, large)).toBe(true);
    expect(await fenced.compareAndSwapSync(1, stateAt(small, 2))).toBe(true);
    expect(manifest(f).format).toBe("hq-live-sync-manifest-v2");
    expect((await store.readSnapshot()).sync).toEqual(stateAt(small, 2));
  }, 30000);
  it("rejects stale expected versions before all mutations and rejects corrupt current state rather than bypassing validation", async () => {
    const { f, fenced, lease } = await setup();
    seedV2(f, small, lease.sourceFingerprint);
    const before = clone([...f.rows]),
      start = f.trace.length;
    expect(await fenced.compareAndSwapSync(null, small)).toBe(false);
    expect(f.trace.slice(start).some(t => mutation(t.sql, t.args))).toBe(false);
    expect([...f.rows]).toEqual(before);
    const first = manifestChunkRefs(manifest(f))[0];
    f.rows.delete(first.id);
    await expect(fenced.compareAndSwapSync(null, small)).rejects.toMatchObject({
      code: "INVALID_PERSISTED_STATE",
    });
  });
  it.each([
    "root-format",
    "root-version",
    "root-owner",
    "root-mode",
    "root-hash",
    "root-binding",
    "manifest-field",
    "order",
    "namespace",
    "missing",
    "chunk-hash",
    "chunk-length",
    "chunk-binding",
    "chunk-version",
    "chunk-owner",
    "chunk-mode",
    "chunk-data",
    "chunk-format",
    "chunk-scalar",
    "chunk-base64",
    "chunk-missing-field",
    "invalid-json",
    "duplicate-envelope",
    "escaped-duplicate-envelope",
    "extra-envelope",
  ])("fails closed on persisted %s for read and acquisition", async kind => {
    const { f, store, lease } = await setup();
    seedV2(f, small, lease.sourceFingerprint);
    const root = f.rows.get(HQ_LIVE_SYNC_DATASET_ID)!,
      m = manifest(f);
    const ref = manifestChunkRefs(m)[0],
      chunk = f.rows.get(ref.id)!;
    if (kind === "root-format") m.format = "wrong" as any;
    if (kind === "root-version") root.stateVersion++;
    if (kind === "root-owner") root.ownerUserId = 47;
    if (kind === "root-mode") root.mode = "sample";
    if (kind === "root-hash") m.sha256 = "0".repeat(64);
    if (kind === "root-binding") m.sourceFingerprint = "a".repeat(64);
    if (kind === "manifest-field") Object.assign(m, { unapproved: true });
    if (kind === "order") m.groups.reverse();
    if (kind === "namespace") m.groups[0].chunks[0].id = "sample-sync:47";
    if (kind === "missing") f.rows.delete(ref.id);
    if (kind === "chunk-version") chunk.stateVersion = 2;
    if (kind === "chunk-owner") chunk.ownerUserId = 47;
    if (kind === "chunk-mode") chunk.mode = "sample";
    if (
      [
        "chunk-hash",
        "chunk-length",
        "chunk-binding",
        "chunk-format",
        "chunk-scalar",
        "chunk-base64",
        "chunk-missing-field",
        "extra-envelope",
      ].includes(kind)
    ) {
      const value = JSON.parse(chunk.state);
      if (kind === "chunk-hash") value.sha256 = "0".repeat(64);
      if (kind === "chunk-length") value.byteCount++;
      if (kind === "chunk-binding") value.sourceFingerprint = "a".repeat(64);
      if (kind === "chunk-format") value.format = "wrong";
      if (kind === "chunk-scalar") value.byteCount = String(value.byteCount);
      if (kind === "chunk-base64") value.data = "!" + value.data.slice(1);
      if (kind === "chunk-missing-field") delete value.format;
      if (kind === "extra-envelope") value.unapproved = true;
      chunk.state = canonicalHqJson(value);
    }
    if (kind === "chunk-data") chunk.state = corruptChunkData(chunk.state);
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
    const before = clone([...f.rows]);
    const code =
      kind === "root-binding"
        ? "SOURCE_BINDING_CHANGED"
        : "INVALID_PERSISTED_STATE";
    await expect(store.readSnapshot()).rejects.toMatchObject({ code });
    await expect(store.acquire()).rejects.toMatchObject({ code });
    expect([...f.rows]).toEqual(before);
  });
  it.each(["extra", "multiple", "foreign-id"])(
    "denies %s returned chunk rows without prefix scans",
    async kind => {
      const { f, store, lease } = await setup();
      seedV2(f, small, lease.sourceFingerprint);
      f.setRowHook((sql, _args, selected) => {
        if (!sql.includes("datasetId IN")) return selected;
        if (kind === "multiple") return [...selected, clone(selected[0])];
        const foreign = { ...clone(selected[0]), datasetId: "sample-sync:47" };
        return kind === "extra"
          ? [...selected, foreign]
          : [foreign, ...selected.slice(1)];
      });
      await expect(store.readSnapshot()).rejects.toMatchObject({
        code: "INVALID_PERSISTED_STATE",
      });
      expect(f.trace.some(t => /LIKE|REGEXP/.test(t.sql))).toBe(false);
    }
  );
  it("rechecks source binding after the full chunk read and immediately before exposing state", async () => {
    let actual = config();
    const dynamic: HqLiveConfig = {
      status: () => actual.status(),
      sourceFingerprint: () => actual.sourceFingerprint(),
      authorizeTrigger: t => actual.authorizeTrigger(t),
      createReader: () => actual.createReader(),
    };
    const { f, store, lease } = await setup(dynamic);
    seedV2(f, small, lease.sourceFingerprint);
    f.setAfterHook(sql => {
      if (sql.includes("datasetId IN"))
        actual = createHqLiveConfig({
          HQ_LIVE_SYNC_ENABLED: "true",
          HQ_LIVE_READ_ENABLED: "true",
          HQ_ORBIT_REPORTING_BASE_URL:
            "https://different.orbittravel.co.uk/api/management-hq",
          HQ_ORBIT_REPORTING_API_KEY:
            "orbit-test-key-not-live-" + "a".repeat(32),
          HQ_PORTAL_SYNC_TOKEN: "portal-test-token-not-live-" + "b".repeat(32),
        });
    });
    await expect(store.readSnapshot()).rejects.toMatchObject({
      code: "SOURCE_BINDING_CHANGED",
    });
  });
  it.each(["valid", "corrupt", "foreign", "wrong-version"])(
    "exactly validates immutable preexisting %s chunk collisions and never overwrites them",
    async kind => {
      const { f, fenced, lease } = await setup();
      const encoded = encodeHqLiveV2Sync(large, lease.sourceFingerprint),
        first = encoded.chunks[0];
      const collision = row(first.id, first.serialized);
      if (kind === "corrupt")
        collision.state = corruptChunkData(collision.state);
      if (kind === "foreign") {
        collision.mode = "sample";
        collision.ownerUserId = 47;
      }
      if (kind === "wrong-version") collision.stateVersion = 2;
      f.rows.set(first.id, collision);
      const saved = clone(collision),
        before = clone([...f.rows]);
      if (kind === "valid")
        expect(await fenced.compareAndSwapSync(null, large)).toBe(true);
      else {
        await expect(
          fenced.compareAndSwapSync(null, large)
        ).rejects.toMatchObject({ code: "INVALID_PERSISTED_STATE" });
        expect([...f.rows]).toEqual(before);
      }
      expect(f.rows.get(first.id)).toEqual(saved);
      expect(
        f.trace.some(t => t.sql.startsWith("UPDATE") && t.args[2] === first.id)
      ).toBe(false);
    },
    30000
  );
  it.each([
    ["preexisting", "reordered-string"],
    ["preexisting", "parsed-object"],
    ["insert-ignore", "reordered-string"],
    ["insert-ignore", "parsed-object"],
  ] as const)(
    "accepts immutable %s collisions with MySQL-style %s wrappers without overwriting",
    async (path, representation) => {
      const { f, fenced, lease, store } = await setup();
      const first = encodeHqLiveV2Sync(large, lease.sourceFingerprint)
        .chunks[0];
      const collision = row(first.id, first.serialized),
        saved = clone(collision);
      let injected = false;
      if (path === "preexisting") f.rows.set(first.id, collision);
      else
        f.setHook((sql, args, draft) => {
          if (sql.startsWith("INSERT") && args[0] === first.id) {
            expect(draft.has(first.id)).toBe(false);
            draft.set(first.id, clone(collision));
            injected = true;
          }
        });
      const observed = mysqlChunkResults(f, representation),
        start = f.trace.length;
      expect(await fenced.compareAndSwapSync(null, large)).toBe(true);
      expect(f.rows.get(first.id)).toEqual(saved);
      const operations = f.trace.slice(start);
      expect(
        operations.filter(
          t => t.sql.startsWith("INSERT") && t.args[0] === first.id
        )
      ).toHaveLength(path === "insert-ignore" ? 1 : 0);
      expect(injected).toBe(path === "insert-ignore");
      if (path === "insert-ignore")
        expect(
          operations.some(
            t =>
              t.sql.includes("datasetId = ? FOR UPDATE") &&
              t.args[0] === first.id
          )
        ).toBe(true);
      expect(
        operations.some(
          t => t.sql.startsWith("UPDATE") && t.args[2] === first.id
        )
      ).toBe(false);
      expect((await store.readSnapshot()).sync).toEqual(large);
      expect(observed.strings).toBeGreaterThan(0);
      expect(observed.objects).toBe(
        representation === "parsed-object" ? observed.strings : 0
      );
    },
    30000
  );
  it.each([
    "corrupt",
    "foreign",
    "wrong-version",
    "invalid-json",
    "duplicate-envelope",
    "extra-envelope",
  ])(
    "validates INSERT IGNORE collisions and rolls back %s concurrent rows",
    async kind => {
      const { f, fenced, lease } = await setup();
      const first = encodeHqLiveV2Sync(large, lease.sourceFingerprint)
        .chunks[0];
      const collision = row(first.id, first.serialized);
      if (kind === "corrupt")
        collision.state = corruptChunkData(collision.state);
      if (kind === "foreign") {
        collision.mode = "sample";
        collision.ownerUserId = 47;
      }
      if (kind === "wrong-version") collision.stateVersion = 2;
      if (kind === "invalid-json") collision.state += " trailing-non-json";
      if (kind === "duplicate-envelope")
        collision.state = collision.state.replace(
          "{",
          '{"format":"hq-live-sync-chunk-v2",'
        );
      if (kind === "extra-envelope")
        collision.state = canonicalHqJson({
          ...JSON.parse(collision.state),
          unapproved: true,
        });
      const before = clone([...f.rows]),
        commits = f.commits.mock.calls.length;
      let injected = false;
      f.setHook((sql, args, draft) => {
        if (sql.startsWith("INSERT") && args[0] === first.id) {
          draft.set(first.id, clone(collision));
          injected = true;
        }
      });
      await expect(
        fenced.compareAndSwapSync(null, large)
      ).rejects.toMatchObject({
        code: "INVALID_PERSISTED_STATE",
      });
      expect(injected).toBe(true);
      expect([...f.rows]).toEqual(before);
      expect(f.commits.mock.calls.length).toBe(commits);
      expect(f.rollbacks.mock.calls.length).toBe(1);
      expect(
        f.trace.some(
          t =>
            t.sql.includes("datasetId = ? FOR UPDATE") && t.args[0] === first.id
        )
      ).toBe(true);
    },
    30000
  );
  it.each([
    "chunkINSERT",
    "rootINSERT",
    "rootUPDATE",
    "chunkDELETE",
    "controlUPDATE",
  ])(
    "rolls back every mutation when %s crosses lease expiry",
    async target => {
      const { f, fenced, lease } = await setup();
      const current =
        target === "rootINSERT" || target === "chunkINSERT" ? null : small;
      if (current) seedV2(f, current, lease.sourceFingerprint);
      const next = current ? changed(current) : large;
      if (target === "controlUPDATE") next.published!.version = 2;
      const before = clone([...f.rows]),
        commits = f.commits.mock.calls.length;
      let crossed = false;
      f.setAfterHook((sql, args) => {
        if (!crossed && mutation(sql, args) === target) {
          crossed = true;
          f.advance(30001);
        }
      });
      await expect(
        fenced.compareAndSwapSync(current?.version ?? null, next)
      ).rejects.toMatchObject({ code: "LEASE_LOST" });
      expect(crossed).toBe(true);
      expect([...f.rows]).toEqual(before);
      expect(f.commits.mock.calls.length).toBe(commits);
      expect(f.rollbacks.mock.calls.length).toBe(1);
    },
    30000
  );
  it.each(["chunkINSERT", "rootUPDATE", "chunkDELETE", "controlUPDATE"])(
    "rolls back %s if the control fencing number is stolen post-write",
    async target => {
      const { f, fenced, lease } = await setup();
      seedV2(f, small, lease.sourceFingerprint);
      const next = changed(small);
      if (target === "controlUPDATE") next.published!.version = 2;
      const before = clone([...f.rows]);
      let stolen = false;
      f.setAfterHook((sql, args, draft) => {
        if (!stolen && mutation(sql, args) === target) {
          stolen = true;
          const c = draft.get(HQ_LIVE_CONTROL_DATASET_ID)!,
            value = JSON.parse(c.state);
          value.fencingNumber++;
          c.state = JSON.stringify(value);
        }
      });
      await expect(fenced.compareAndSwapSync(1, next)).rejects.toMatchObject({
        code: "LEASE_LOST",
      });
      expect(stolen).toBe(true);
      expect([...f.rows]).toEqual(before);
    }
  );
  it.each([
    "chunkINSERT",
    "rootINSERT",
    "rootUPDATE",
    "chunkDELETE",
    "controlUPDATE",
  ])(
    "rolls back %s when live configuration is disabled after the mutation",
    async target => {
      let enabled = true;
      const original = config();
      const dynamic: HqLiveConfig = {
        status: () => ({ ...original.status(), syncEnabled: enabled }),
        sourceFingerprint: () => original.sourceFingerprint(),
        authorizeTrigger: t => original.authorizeTrigger(t),
        createReader: () => original.createReader(),
      };
      const { f, fenced, lease } = await setup(dynamic);
      const current = target === "rootINSERT" ? null : small;
      if (current) seedV2(f, current, lease.sourceFingerprint);
      const next = current ? changed(current) : large;
      if (target === "controlUPDATE") next.published!.version = 2;
      const before = clone([...f.rows]);
      let disabled = false;
      f.setAfterHook((sql, args) => {
        if (!disabled && mutation(sql, args) === target) {
          disabled = true;
          enabled = false;
        }
      });
      await expect(
        fenced.compareAndSwapSync(current?.version ?? null, next)
      ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(disabled).toBe(true);
      expect([...f.rows]).toEqual(before);
    },
    30000
  );
  it("checks a fresh final database clock before commit after control publication", async () => {
    const { f, fenced, lease } = await setup();
    seedV2(f, small, lease.sourceFingerprint);
    const next = changed(small);
    next.published!.version = 2;
    const before = clone([...f.rows]);
    let afterPublication = false,
      clocks = 0;
    f.setAfterHook((sql, args) => {
      if (mutation(sql, args) === "controlUPDATE") afterPublication = true;
    });
    f.setHook(sql => {
      if (afterPublication && sql.startsWith("SELECT CAST") && ++clocks === 2)
        f.advance(30001);
    });
    await expect(fenced.compareAndSwapSync(1, next)).rejects.toMatchObject({
      code: "LEASE_LOST",
    });
    expect(afterPublication).toBe(true);
    expect(clocks).toBe(2);
    expect([...f.rows]).toEqual(before);
  });
  it("a failed root CAS after chunk inserts throws and rolls back instead of committing false", async () => {
    const { f, fenced, lease } = await setup();
    seedV2(f, small, lease.sourceFingerprint);
    const before = clone([...f.rows]);
    f.setHook((sql, args, draft) => {
      if (mutation(sql, args) === "rootUPDATE")
        draft.get(HQ_LIVE_SYNC_DATASET_ID)!.stateVersion++;
    });
    await expect(
      fenced.compareAndSwapSync(1, changed(small))
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(f.trace.some(t => mutation(t.sql, t.args) === "chunkINSERT")).toBe(
      true
    );
    expect([...f.rows]).toEqual(before);
  });
  it("counter-only root changes reuse all chunks with no INSERT or DELETE", async () => {
    const { f, fenced, lease, store } = await setup();
    seedV2(f, staged, lease.sourceFingerprint);
    const next = stateAt(staged, 2);
    next.stage!.pages++;
    next.stage!.recordsRead++;
    const before = new Map(
        [...f.rows].filter(([id]) => id.startsWith(CHUNK_PREFIX))
      ),
      start = f.trace.length;
    expect(await fenced.compareAndSwapSync(1, next)).toBe(true);
    expect(
      f.trace.slice(start).filter(t => /^(?:INSERT|DELETE)/.test(t.sql))
    ).toHaveLength(0);
    expect(
      new Map([...f.rows].filter(([id]) => id.startsWith(CHUNK_PREFIX)))
    ).toEqual(before);
    expect((await store.readSnapshot()).sync).toEqual(next);
  });
  it("preserves all shared references, deletes only old-known refs minus new refs, and never writes other namespaces", async () => {
    const { f, fenced, lease, store } = await setup();
    const current = stateAt(small, 1);
    current.stage = clone(staged.stage);
    current.stage!.basePublishedVersion = current.published!.version;
    current.stage!.entities = clone(current.published!.entities);
    current.stage!.feedKeys = {
      booking: ["booking:1"],
      business: ["business:90052"],
    };
    seedV2(f, current, lease.sourceFingerprint);
    const oldManifest = manifest(f),
      oldRefs = manifestChunkRefs(oldManifest);
    const repeated = oldManifest.groups.flatMap(g => g.chunks);
    expect(repeated.length).toBeGreaterThan(oldRefs.length);
    const unrelated = row("sample-sync:47", '{"synthetic":true}');
    unrelated.ownerUserId = 47;
    unrelated.mode = "sample";
    f.rows.set(unrelated.datasetId, unrelated);
    const orphan = encodeHqLiveV2Sync(
      changed(small),
      lease.sourceFingerprint
    ).chunks.find(c => !oldRefs.some(r => r.id === c.id))!;
    f.rows.set(orphan.id, row(orphan.id, orphan.serialized));
    const saved = clone(f.rows.get(orphan.id));
    const next = stateAt(current, 2);
    next.stage = null;
    const start = f.trace.length;
    expect(await fenced.compareAndSwapSync(1, next)).toBe(true);
    const newRefs = manifestChunkRefs(manifest(f)),
      keep = new Set(newRefs.map(r => r.id));
    const deletes = f.trace
      .slice(start)
      .filter(t => t.sql.startsWith("DELETE"))
      .map(t => t.args[0]);
    expect(deletes.sort()).toEqual(
      oldRefs
        .filter(r => !keep.has(r.id))
        .map(r => r.id)
        .sort()
    );
    for (const ref of oldRefs.filter(r => keep.has(r.id)))
      expect(f.rows.has(ref.id)).toBe(true);
    expect(f.rows.get(orphan.id)).toEqual(saved);
    expect(f.rows.get(unrelated.datasetId)).toEqual(unrelated);
    expect((await store.readSnapshot()).sync).toEqual(next);
    for (const t of f.trace.slice(start).filter(t => mutation(t.sql, t.args))) {
      const id = t.sql.startsWith("UPDATE") ? t.args[2] : t.args[0];
      expect(
        id === HQ_LIVE_SYNC_DATASET_ID ||
          id === HQ_LIVE_CONTROL_DATASET_ID ||
          id.startsWith(CHUNK_PREFIX)
      ).toBe(true);
      expect(t.sql).not.toMatch(/\b(?:users|bookings|payments|commissions)\b/);
    }
  });
  it("delete conflicts fail closed and roll back root/chunks", async () => {
    const { f, fenced, lease } = await setup();
    seedV2(f, small, lease.sourceFingerprint);
    const before = clone([...f.rows]);
    f.setHook((sql, args, draft) => {
      if (sql.startsWith("DELETE")) draft.get(args[0])!.stateVersion = 2;
    });
    await expect(
      fenced.compareAndSwapSync(1, changed(small))
    ).rejects.toMatchObject({ code: "INVALID_PERSISTED_STATE" });
    expect([...f.rows]).toEqual(before);
  });
  it("v2 attention retains stage and refuses native acquisition without recovery/reset", async () => {
    const { f, store, lease } = await setup();
    seedV2(f, staged, lease.sourceFingerprint);
    await store.complete(lease, {
      status: "needs_attention",
      delaySeconds: 0,
      errorCode: "STATE_BYTE_CAP_EXCEEDED",
    });
    const before = clone([...f.rows]);
    expect(await store.acquire()).toEqual({ status: "needs_attention" });
    expect((await store.readSnapshot()).sync).toEqual(staged);
    expect([...f.rows]).toEqual(before);
  });
});
