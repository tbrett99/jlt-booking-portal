import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalHqJson } from "./management-hq-engine";
import { createHqLiveConfig } from "./management-hq-live-config";
import * as cooperation from "./management-hq-cooperative";
import * as ingestion from "./management-hq-ingestion";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  type HqImplementedSyncState,
} from "./management-hq-ingestion";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
import {
  createHqLiveStore,
  HqLiveError,
  HQ_LIVE_CONTROL_DATASET_ID,
  HQ_LIVE_SYNC_DATASET_ID,
  type HqLiveLease,
  type HqLiveControl,
} from "./management-hq-live-store";
import * as codec from "./management-hq-storage-v2";
import {
  offlineHqV2Pool,
  type HqV2OfflineRow,
} from "./management-hq-storage-v2-pool";
import { validateHqWireEntity } from "./management-hq-wire-contract";

// Genuine small engine states and codec bytes; offline SQL model only. No cap,
// wire/semantic validator, lease deadline, environment or service override.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const configuration = () =>
  createHqLiveConfig({
    HQ_LIVE_SYNC_ENABLED: "true",
    HQ_LIVE_READ_ENABLED: "false",
    HQ_ORBIT_REPORTING_BASE_URL:
      "https://offline-synthetic.probe.tld/api/management-hq",
    HQ_ORBIT_REPORTING_API_KEY: "synthetic-only-key-" + "a".repeat(40),
    HQ_PORTAL_SYNC_TOKEN: "synthetic-only-token-" + "b".repeat(40),
  });
const row = (
  datasetId: string,
  state: string,
  stateVersion = 1
): HqV2OfflineRow => ({
  datasetId,
  state,
  stateVersion,
  mode: "live",
  ownerUserId: 0,
  updatedAt: "2026-11-22T12:00:00.000Z",
});
type Options = NonNullable<Parameters<typeof createHqLiveStore>[2]>;
let pages: HqImplementedSyncState[];
let published: HqImplementedSyncState;
beforeAll(async () => {
  const memory = createHqImplementedMemoryStore();
  pages = [];
  const observed = {
    readSync: () => memory.readSync(),
    async compareAndSwapSync(
      expected: number | null,
      next: HqImplementedSyncState
    ) {
      const result = await memory.compareAndSwapSync(expected, next);
      if (result) pages.push(clone(next));
      return result;
    },
  };
  expect(
    (
      await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        observed
      ).backfill()
    ).status
  ).toBe("applied");
  published = pages.pop()!;
  expect(pages).toHaveLength(4);
  expect(published.stage).toBeNull();
  expect(published.published).not.toBeNull();
});
afterEach(() => vi.restoreAllMocks());

async function seed(state = pages[3], options: Options = {}) {
  const fixture = offlineHqV2Pool();
  const config = { ...configuration() };
  const scope = digest("offline-raw-settings-and-db-url:" + randomUUID());
  const acquired = await createHqLiveStore(fixture.pool, config).acquire();
  if (acquired.status !== "acquired") throw new Error("offline lease required");
  const lease = acquired.lease;
  const encoded = codec.encodeHqLiveV2Sync(state, lease.sourceFingerprint);
  fixture.rows.set(
    HQ_LIVE_SYNC_DATASET_ID,
    row(
      HQ_LIVE_SYNC_DATASET_ID,
      JSON.stringify(encoded.manifest),
      state.version
    )
  );
  for (const chunk of encoded.chunks)
    fixture.rows.set(chunk.id, row(chunk.id, chunk.serialized));
  const request = (overrides: Options = {}) =>
    createHqLiveStore(fixture.pool, config, {
      validatedInitialReuseScope: scope,
      ...options,
      ...overrides,
    });
  const store = request();
  return {
    fixture,
    config,
    scope,
    lease,
    encoded,
    request,
    store,
    fenced: store.fencedSyncStore(lease),
  };
}
type Seed = Awaited<ReturnType<typeof seed>>;
const root = (seeded: Seed) =>
  seeded.fixture.rows.get(HQ_LIVE_SYNC_DATASET_ID)!;
const control = (seeded: Seed): HqLiveControl =>
  JSON.parse(seeded.fixture.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.state);
function setControl(seeded: Seed, changes: Partial<HqLiveControl>) {
  const current = seeded.fixture.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!;
  current.state = JSON.stringify({ ...control(seeded), ...changes });
}
const savedRows = (seeded: Seed) => clone(Array.from(seeded.fixture.rows));
function restoreRows(seeded: Seed, saved: ReturnType<typeof savedRows>) {
  seeded.fixture.rows.clear();
  for (const [id, current] of saved) seeded.fixture.rows.set(id, current);
}
const rootUpdate = (sql: string, args: unknown[]) =>
  sql.startsWith("UPDATE") && args[2] === HQ_LIVE_SYNC_DATASET_ID;
const exactCpuSeam = () =>
  vi
    .spyOn(cooperation, "createHqCpuCheckpoint")
    .mockImplementation(guard => async () => {
      await guard?.();
    });
async function publish(seeded: Seed, next = clone(published)) {
  expect(await seeded.fenced.compareAndSwapSync(pages[3].version, next)).toBe(
    true
  );
}
const applied = { status: "applied", delaySeconds: 0 } as const;

/** Rehash all layers at the same version: wrappers/hashes pass, entity fails. */
function rehashedInvalidEntity(seeded: Seed, state: HqImplementedSyncState) {
  const manifest = JSON.parse(root(seeded).state) as codec.HqV2Manifest;
  const expanded = clone(state);
  const partName = expanded.stage ? "stage" : "published";
  const part = expanded[partName]!;
  const record = part.entities["booking:1"];
  Object.assign(record.entity.payload, { orbitBookingId: "not-an-integer" });
  record.canonicalPayload = canonicalHqJson(record.entity);
  expect(() => validateHqWireEntity(record.entity)).toThrow();
  const compact = JSON.parse(JSON.stringify(expanded));
  for (const name of ["published", "stage"] as const)
    for (const current of Object.values(compact[name]?.entities ?? {}) as {
      entity?: unknown;
    }[])
      delete current.entity;
  const group = manifest.groups.find(
    g => g.part === partName && g.kind === "entities" && g.bucket === 1
  )!;
  const contents = JSON.parse(
    Buffer.concat(
      group.chunks.map(ref =>
        codec.validateHqV2Chunk(
          seeded.fixture.rows.get(ref.id)!.state,
          ref,
          seeded.lease.sourceFingerprint
        )
      )
    ).toString("utf8")
  );
  contents["booking:1"].canonicalPayload = record.canonicalPayload;
  const bytes = Buffer.from(canonicalHqJson(contents));
  const sha256 = digest(bytes);
  const id =
    "live:company:orbit:v2:chunk:" +
    digest(seeded.lease.sourceFingerprint + ":" + sha256);
  group.byteCount = bytes.length;
  group.sha256 = sha256;
  group.chunks = [{ id, sha256, byteCount: bytes.length }];
  seeded.fixture.rows.set(
    id,
    row(
      id,
      canonicalHqJson({
        format: "hq-live-sync-chunk-v2",
        sourceFingerprint: seeded.lease.sourceFingerprint,
        sha256,
        byteCount: bytes.length,
        data: bytes.toString("base64"),
      })
    )
  );
  manifest.compactBytes = codec.hqJsonUtf8Bytes(compact);
  manifest.expandedBytes = codec.hqJsonUtf8Bytes(expanded);
  manifest.sha256 = digest(canonicalHqJson(compact));
  codec.validateHqV2Manifest(
    manifest,
    state.version,
    seeded.lease.sourceFingerprint
  );
  for (const ref of codec.manifestChunkRefs(manifest))
    expect(
      codec.validateHqV2Chunk(
        seeded.fixture.rows.get(ref.id)!.state,
        ref,
        seeded.lease.sourceFingerprint
      ).length
    ).toBe(ref.byteCount);
  root(seeded).state = JSON.stringify(manifest);
}

describe("strong verification-only store consumers", () => {
  it("warm acquire/CAS/complete discard no full-tree clones; engine and public reads stay independently owned", async () => {
    const seeded = await seed(pages[0]);
    const decode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
    const copies = vi.spyOn(ingestion, "cloneHqJsonAsync");
    await seeded.fenced.readSync();
    expect(decode).toHaveBeenCalledTimes(1);
    expect(copies).toHaveBeenCalledTimes(1);
    copies.mockClear();
    expect(await seeded.store.acquireInitialPublication!()).toMatchObject({
      status: "busy",
    });
    expect(copies).not.toHaveBeenCalled();
    expect(await seeded.fenced.compareAndSwapSync(1, clone(pages[1]))).toBe(
      true
    );
    expect(copies).not.toHaveBeenCalled();
    await seeded.store.complete(seeded.lease, {
      status: "progress",
      delaySeconds: 0,
    });
    expect(copies).not.toHaveBeenCalled();
    expect(decode).toHaveBeenCalledTimes(1);
    const one = (await seeded.fenced.readSync())!;
    expect(copies).toHaveBeenCalledTimes(1);
    one.stage!.entities["booking:1"].canonicalPayload = "poison";
    one.stage = null;
    const two = (await seeded.store.readSnapshot()).sync!;
    expect(two).toEqual(pages[1]);
    expect(copies).toHaveBeenCalledTimes(2);
    two.stage!.entities["booking:1"].entity.payload = {
      poisoned: true,
    } as never;
    expect(await seeded.fenced.readSync()).toEqual(pages[1]);
    expect(copies).toHaveBeenCalledTimes(3);
  });

  it("cold verification retains an owned decode without a discarded clone; first consumer still clones", async () => {
    const seeded = await seed(pages[1]);
    setControl(seeded, {
      leaseToken: null,
      leaseExpiresAtMs: null,
      leaseHardExpiresAtMs: null,
      stageStatus: "progress",
    });
    const copies = vi.spyOn(ingestion, "cloneHqJsonAsync");
    const decode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
    const acquired = await seeded.store.acquireInitialPublication!();
    expect(acquired.status).toBe("acquired");
    if (acquired.status !== "acquired")
      throw new Error("offline lease required");
    expect(decode).toHaveBeenCalledTimes(1);
    expect(copies).not.toHaveBeenCalled();
    expect(
      await seeded.store.fencedSyncStore(acquired.lease).readSync()
    ).toEqual(pages[1]);
    expect(copies).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    "preserves genuine encoded root/chunk bytes and historical lastPublish with opt-in=%s",
    async enabled => {
      const seeded = await seed(pages[3], {
        validatedInitialReuseScope: enabled ? digest(randomUUID()) : undefined,
      });
      const expected = codec.encodeHqLiveV2Sync(
        published,
        seeded.lease.sourceFingerprint
      );
      await publish(seeded);
      expect(root(seeded).state).toBe(JSON.stringify(expected.manifest));
      for (const chunk of expected.chunks)
        expect(seeded.fixture.rows.get(chunk.id)!.state).toBe(chunk.serialized);
      const firstPublish = control(seeded).lastPublishAtMs;
      expect(firstPublish).toBe(seeded.fixture.now());
      seeded.fixture.advance(1000);
      const samePublication = clone(published);
      samePublication.version++;
      expect(
        await seeded.fenced.compareAndSwapSync(
          published.version,
          samePublication
        )
      ).toBe(true);
      expect(control(seeded).lastPublishAtMs).toBe(firstPublish);
      await seeded.store.complete(seeded.lease, applied);
      expect(control(seeded)).toMatchObject({
        stageStatus: "applied",
        leaseToken: null,
        consecutiveFailures: 0,
        lastErrorCode: null,
      });
      expect(await seeded.store.readPublished()).toEqual(published.published);
      expect(await seeded.store.acquireInitialPublication!()).toMatchObject({
        status: "already_complete",
      });
    }
  );

  it.each(["acquire", "cas", "complete"] as const)(
    "%s rejects fully rehashed warm semantic corruption, then restored bytes require cold validation",
    async operation => {
      const seeded = await seed(pages[0]);
      const decode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
      await seeded.fenced.readSync();
      const saved = savedRows(seeded);
      rehashedInvalidEntity(seeded, pages[0]);
      const op =
        operation === "acquire"
          ? seeded.store.acquire()
          : operation === "cas"
            ? seeded.fenced.compareAndSwapSync(1, clone(pages[1]))
            : seeded.store.complete(seeded.lease, {
                status: "progress",
                delaySeconds: 0,
              });
      await expect(op).rejects.toMatchObject({
        code: "INVALID_PERSISTED_STATE",
      });
      expect(decode).toHaveBeenCalledTimes(2);
      restoreRows(seeded, saved);
      expect(await seeded.fenced.readSync()).toEqual(pages[0]);
      expect(decode).toHaveBeenCalledTimes(3);
    }
  );

  it("verification-only V1 still accepts native depth-258 extras and does not initialize missing control", async () => {
    const seeded = await seed();
    let deep: unknown = "native-V1";
    for (let n = 0; n < 258; n++) deep = { x: deep };
    const legacy = { version: 4, published: null, stage: null, extra: deep };
    root(seeded).state = JSON.stringify({
      format: "hq-live-sync-v1",
      sourceFingerprint: seeded.lease.sourceFingerprint,
      sync: legacy,
    });
    expect(await seeded.store.acquire()).toMatchObject({ status: "busy" });
    expect(await seeded.fenced.readSync()).toEqual(legacy);
    await seeded.store.complete(seeded.lease, {
      status: "progress",
      delaySeconds: 0,
    });
    seeded.fixture.rows.delete(HQ_LIVE_CONTROL_DATASET_ID);
    const saved = savedRows(seeded);
    await expect(seeded.store.acquire()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_STATE",
    });
    expect(savedRows(seeded)).toEqual(saved);
  });
});

describe("store-local post-COMMIT publication completion proof", () => {
  it("same store completion re-reads and validates every byte but does no cold published decode or tree copy", async () => {
    const seeded = await seed();
    const decode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
    await seeded.fenced.readSync();
    await publish(seeded);
    const copies = vi.spyOn(ingestion, "cloneHqJsonAsync");
    const validate = vi.spyOn(codec, "validateHqV2Chunk");
    const encoded = codec.encodeHqLiveV2Sync(
      published,
      seeded.lease.sourceFingerprint
    );
    validate.mockClear();
    const from = seeded.fixture.trace.length;
    // Reordered wrappers remain exactly the same validated decoded bytes.
    for (const current of seeded.fixture.rows.values()) {
      if (current.datasetId !== HQ_LIVE_CONTROL_DATASET_ID)
        current.state =
          " \n" +
          JSON.stringify(
            Object.fromEntries(
              Object.entries(JSON.parse(current.state)).reverse()
            ),
            null,
            2
          );
    }
    await seeded.store.complete(seeded.lease, applied);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(copies).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalledTimes(2 * encoded.chunks.length);
    const trace = seeded.fixture.trace.slice(from);
    expect(
      trace.filter(
        t => t.sql.startsWith("SELECT") && t.args[0] === HQ_LIVE_SYNC_DATASET_ID
      )
    ).toHaveLength(1);
    const chunkReads = trace.filter(t => t.sql.includes("datasetId IN"));
    expect(chunkReads.flatMap(t => t.args).sort()).toEqual(
      encoded.chunks.map(c => c.id).sort()
    );
    expect(
      chunkReads.every(t => t.sql.endsWith("FOR UPDATE") && t.args.length <= 4)
    ).toBe(true);
    expect(control(seeded)).toMatchObject({
      stageStatus: "applied",
      leaseToken: null,
      leaseExpiresAtMs: null,
      leaseHardExpiresAtMs: null,
    });
    const first = (await seeded.store.readPublished())!;
    first.entities["booking:1"].canonicalPayload = "poison";
    expect(await seeded.store.readPublished()).toEqual(published.published);
    expect(decode).toHaveBeenCalledTimes(3);
  });

  it.each([
    "new-store",
    "new-scope",
    "default-store",
    "engine-read",
    "public-read",
  ] as const)(
    "%s never consumes or shares the publication completion proof",
    async consumer => {
      const seeded = await seed();
      const decode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
      await seeded.fenced.readSync();
      await publish(seeded);
      expect(decode).toHaveBeenCalledTimes(1);
      if (consumer === "engine-read")
        expect(await seeded.fenced.readSync()).toEqual(published);
      else if (consumer === "public-read")
        expect(await seeded.store.readPublished()).toEqual(published.published);
      else {
        const other = seeded.request(
          consumer === "new-scope"
            ? { validatedInitialReuseScope: digest(randomUUID()) }
            : consumer === "default-store"
              ? { validatedInitialReuseScope: undefined }
              : {}
        );
        await other.complete(seeded.lease, applied);
      }
      expect(decode).toHaveBeenCalledTimes(2);
      expect(
        await seeded.request().fencedSyncStore(seeded.lease).readSync()
      ).toEqual(published);
      expect(decode).toHaveBeenCalledTimes(3);
    }
  );

  it("owns publication facts and chunks despite post-encode caller/encoder/validator buffer mutation", async () => {
    const seeded = await seed();
    const decode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
    await seeded.fenced.readSync();
    const next = clone(published);
    const realOwned = codec.encodeHqLiveV2SyncOwnedAsync;
    let owned: Awaited<ReturnType<typeof realOwned>> | undefined;
    vi.spyOn(codec, "encodeHqLiveV2SyncOwnedAsync").mockImplementation(
      async (...args) => {
        owned = await realOwned(...args);
        return owned;
      }
    );
    const borrowed: Buffer[] = [];
    const realValidate = codec.validateHqV2Chunk;
    vi.spyOn(codec, "validateHqV2Chunk").mockImplementation((...args) => {
      const bytes = realValidate(...args);
      borrowed.push(bytes);
      return bytes;
    });
    let mutated = false;
    seeded.fixture.setHook((sql, args) => {
      if (
        sql.startsWith("SELECT") &&
        args[0] === HQ_LIVE_CONTROL_DATASET_ID &&
        !mutated
      ) {
        mutated = true;
        next.published = null;
        owned!.candidate.state.published = null;
        owned!.candidate.chunks.forEach(bytes => bytes.fill(0));
      }
    });
    await publish(seeded, next);
    seeded.fixture.setHook(null);
    expect(mutated).toBe(true);
    for (const bytes of borrowed) bytes.fill(0);
    await seeded.store.complete(seeded.lease, applied);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(await seeded.request().readPublished()).toEqual(published.published);
  });

  it.each([
    "root-json",
    "root-hash",
    "root-owner",
    "chunk-bytes",
    "chunk-owner",
    "chunk-mode",
    "chunk-version",
    "missing-chunk",
    "rehashed-semantic",
  ] as const)(
    "completion rejects %s and cannot reuse the proof after restoring bytes",
    async damage => {
      const seeded = await seed();
      const decode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
      await publish(seeded);
      const saved = savedRows(seeded);
      const manifest = JSON.parse(root(seeded).state) as codec.HqV2Manifest;
      const id = codec.manifestChunkRefs(manifest)[0].id;
      const current = seeded.fixture.rows.get(id)!;
      if (damage === "root-json") root(seeded).state = "{";
      if (damage === "root-hash") {
        manifest.sha256 = "0".repeat(64);
        root(seeded).state = JSON.stringify(manifest);
      }
      if (damage === "root-owner") root(seeded).ownerUserId = 1;
      if (damage === "chunk-owner") current.ownerUserId = 1;
      if (damage === "chunk-mode") current.mode = "sample";
      if (damage === "chunk-version") current.stateVersion = 2;
      if (damage === "missing-chunk") seeded.fixture.rows.delete(id);
      if (damage === "chunk-bytes") {
        const wrapper = JSON.parse(current.state);
        const raw = Buffer.from(wrapper.data, "base64");
        raw[0] ^= 1;
        wrapper.data = raw.toString("base64");
        current.state = JSON.stringify(wrapper);
      }
      if (damage === "rehashed-semantic")
        rehashedInvalidEntity(seeded, published);
      await expect(
        seeded.store.complete(seeded.lease, applied)
      ).rejects.toMatchObject({ code: "INVALID_PERSISTED_STATE" });
      restoreRows(seeded, saved);
      const count = decode.mock.calls.length;
      await seeded.store.complete(seeded.lease, applied);
      expect(decode.mock.calls.length).toBe(count + 1);
    }
  );

  it.each(["token", "fence", "source", "hard-expiry"] as const)(
    "wrong %s never grants authority and clears the proof",
    async mismatch => {
      const seeded = await seed();
      await publish(seeded);
      const wrong: HqLiveLease = { ...seeded.lease };
      if (mismatch === "token") wrong.token = randomUUID();
      if (mismatch === "fence") wrong.fencingNumber++;
      if (mismatch === "source") wrong.sourceFingerprint = "f".repeat(64);
      if (mismatch === "hard-expiry") wrong.hardExpiresAtMs++;
      const saved = savedRows(seeded);
      await expect(seeded.store.complete(wrong, applied)).rejects.toMatchObject(
        {
          code: mismatch === "source" ? "SOURCE_BINDING_CHANGED" : "LEASE_LOST",
        }
      );
      expect(savedRows(seeded)).toEqual(saved);
      const decode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
      await seeded.store.complete(seeded.lease, applied);
      expect(decode).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["before-use", "during-byte-checks"] as const)(
    "non-sliding 60s proof expiry %s falls back to full validation without changing the real lease",
    async moment => {
      const seeded = await seed();
      let clock = performance.now();
      vi.spyOn(performance, "now").mockImplementation(() => clock);
      const decode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
      await publish(seeded);
      expect(decode).toHaveBeenCalledTimes(1);
      if (moment === "before-use") clock += 60001;
      else {
        clock += 59000;
        seeded.fixture.setAfterHook(sql => {
          if (sql.includes("datasetId IN")) clock += 1001;
        });
      }
      await seeded.store.complete(seeded.lease, applied);
      expect(decode).toHaveBeenCalledTimes(2);
      expect(
        seeded.lease.hardExpiresAtMs - control(seeded).lastAttemptAtMs!
      ).toBe(95000);
    }
  );

  it("does not slide proof expiry on a warm non-completion access", async () => {
    const seeded = await seed();
    let clock = performance.now();
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    await publish(seeded);
    const decode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
    clock += 59000;
    await seeded.store.renewCooperative!(seeded.lease);
    clock += 1001;
    await seeded.store.complete(seeded.lease, applied);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("completion consumes the proof exactly once even if the same DB bytes are restored with a valid lease", async () => {
    const seeded = await seed();
    await publish(seeded);
    const saved = savedRows(seeded);
    const decode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
    await seeded.store.complete(seeded.lease, applied);
    expect(decode).not.toHaveBeenCalled();
    await expect(
      seeded.store.complete(seeded.lease, applied)
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
    restoreRows(seeded, saved);
    await seeded.store.complete(seeded.lease, applied);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it.each([
    "zero-cas",
    "sql-root-reject",
    "commit-reject",
    "post-update-authority",
    "final-authority",
    "post-update-expiry",
    "post-update-hard-expiry",
  ] as const)(
    "%s rolls back final publication and never promotes precommit bytes",
    async damage => {
      const seeded = await seed();
      const decode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
      await seeded.fenced.readSync();
      const saved = savedRows(seeded);
      let updated = false,
        denied = false;
      const store = seeded.request({
        cooperativeGuard: async () => {
          if (denied) throw new HqLiveError("AUTH_DENIED");
        },
        cooperativeYieldGuard: async () => {},
      });
      seeded.fixture.setHook((sql, args, draft) => {
        if (rootUpdate(sql, args)) {
          if (damage === "zero-cas")
            draft.get(HQ_LIVE_SYNC_DATASET_ID)!.stateVersion++;
          if (damage === "sql-root-reject")
            throw new Error("offline SQL rejection");
        }
      });
      seeded.fixture.setAfterHook((sql, args) => {
        if (rootUpdate(sql, args)) {
          updated = true;
          if (damage === "post-update-authority") denied = true;
          if (damage === "post-update-expiry") seeded.fixture.advance(30001);
          if (damage === "post-update-hard-expiry")
            seeded.fixture.advance(95001);
        }
        if (
          damage === "final-authority" &&
          updated &&
          sql.startsWith("UPDATE") &&
          args[2] === HQ_LIVE_CONTROL_DATASET_ID
        )
          denied = true;
      });
      let commitSpy: ReturnType<typeof vi.spyOn> | undefined;
      if (damage === "commit-reject") {
        const get = seeded.fixture.pool.getConnection.bind(seeded.fixture.pool);
        commitSpy = vi
          .spyOn(seeded.fixture.pool, "getConnection")
          .mockImplementation(async () => {
            const connection = await get();
            connection.commit = async () => {
              throw new Error("offline COMMIT rejection");
            };
            return connection;
          });
      }
      await expect(
        store
          .fencedSyncStore(seeded.lease)
          .compareAndSwapSync(4, clone(published))
      ).rejects.toMatchObject({
        code: damage.includes("reject")
          ? "STORE_UNAVAILABLE"
          : damage.includes("authority")
            ? "AUTH_DENIED"
            : "LEASE_LOST",
      });
      commitSpy?.mockRestore();
      seeded.fixture.setHook(null);
      seeded.fixture.setAfterHook(null);
      expect(savedRows(seeded)).toEqual(saved);
      expect(seeded.fixture.rollbacks.mock.calls.length).toBeGreaterThan(0);
      // Put only genuine final codec rows into the offline DB to detect whether a
      // failed write leaked a proof. The DB clock and lease remain unchanged;
      // expired cases below use only the existing read-only recovery semantics.
      const final = codec.encodeHqLiveV2Sync(
        published,
        seeded.lease.sourceFingerprint
      );
      root(seeded).state = JSON.stringify(final.manifest);
      root(seeded).stateVersion = published.version;
      for (const chunk of final.chunks)
        seeded.fixture.rows.set(chunk.id, row(chunk.id, chunk.serialized));
      // Expired lease cases only exercise read-only fallback, never expired completion.
      if (damage.includes("expiry")) {
        expect(await store.fencedSyncStore(seeded.lease).readSync()).toEqual(
          published
        );
      } else {
        denied = false;
        const count = decode.mock.calls.length;
        await store.complete(seeded.lease, applied);
        expect(decode.mock.calls.length).toBe(count + 1);
      }
    }
  );

  it.each([
    "authority",
    "db-expiry",
    "hard-expiry",
    "commit-reject",
    "config",
  ] as const)(
    "completion %s failure consumes proof and rolls back completion",
    async damage => {
      const seeded = await seed();
      let denied = false;
      const store = seeded.request({
        cooperativeGuard: async () => {
          if (denied) throw new HqLiveError("AUTH_DENIED");
        },
        cooperativeYieldGuard: async () => {},
      });
      await store
        .fencedSyncStore(seeded.lease)
        .compareAndSwapSync(4, clone(published));
      const saved = savedRows(seeded);
      const decode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
      seeded.fixture.setAfterHook((sql, args) => {
        if (
          sql.startsWith("UPDATE") &&
          args[2] === HQ_LIVE_CONTROL_DATASET_ID
        ) {
          if (damage === "authority") denied = true;
          if (damage === "db-expiry") seeded.fixture.advance(30001);
          if (damage === "hard-expiry") seeded.fixture.advance(95001);
        }
      });
      let restore: (() => void) | undefined;
      if (damage === "config") {
        const status = seeded.config.status();
        const spy = vi
          .spyOn(seeded.config, "status")
          .mockReturnValue({ ...status, configured: false });
        restore = () => spy.mockRestore();
      }
      if (damage === "commit-reject") {
        const get = seeded.fixture.pool.getConnection.bind(seeded.fixture.pool);
        const spy = vi
          .spyOn(seeded.fixture.pool, "getConnection")
          .mockImplementation(async () => {
            const connection = await get();
            connection.commit = async () => {
              throw new Error("offline COMMIT rejection");
            };
            return connection;
          });
        restore = () => spy.mockRestore();
      }
      await expect(store.complete(seeded.lease, applied)).rejects.toMatchObject(
        {
          code:
            damage === "authority"
              ? "AUTH_DENIED"
              : damage === "config"
                ? "CONFIG_INVALID"
                : damage === "commit-reject"
                  ? "STORE_UNAVAILABLE"
                  : "LEASE_LOST",
        }
      );
      expect(savedRows(seeded)).toEqual(saved);
      restore?.();
      seeded.fixture.setAfterHook(null);
      denied = false;
      if (damage.includes("expiry")) {
        await expect(
          store.complete(seeded.lease, applied)
        ).rejects.toMatchObject({ code: "LEASE_LOST" });
        expect(control(seeded).stageStatus).toBe("running");
      } else {
        const count = decode.mock.calls.length;
        await store.complete(seeded.lease, applied);
        expect(decode.mock.calls.length).toBe(count + 1);
      }
    }
  );

  it("wrong expected-version CAS is false, clears old proof, and leaves exact persisted bytes unchanged", async () => {
    const seeded = await seed();
    await publish(seeded);
    const saved = savedRows(seeded);
    const wrong = clone(published);
    wrong.version += 2;
    expect(
      await seeded.fenced.compareAndSwapSync(wrong.version - 1, wrong)
    ).toBe(false);
    expect(savedRows(seeded)).toEqual(saved);
    const decode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
    await seeded.store.complete(seeded.lease, applied);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("fresh authority denial during exact-byte CPU checks remains mandatory", async () => {
    exactCpuSeam();
    let deny = false;
    const seeded = await seed(pages[3], {
      cooperativeYieldGuard: async () => {
        if (deny) throw new HqLiveError("AUTH_DENIED");
      },
    });
    await publish(seeded);
    const saved = savedRows(seeded);
    seeded.fixture.setAfterHook(sql => {
      if (sql.includes("datasetId IN")) deny = true;
    });
    await expect(
      seeded.store.complete(seeded.lease, applied)
    ).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(savedRows(seeded)).toEqual(saved);
    seeded.fixture.setAfterHook(null);
    deny = false;
    const decode = vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
    await seeded.store.complete(seeded.lease, applied);
    expect(decode).toHaveBeenCalledTimes(1);
  });
});
