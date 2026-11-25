import { randomUUID, createHash } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalHqJson } from "./management-hq-engine";
import { createHqLiveConfig } from "./management-hq-live-config";
import * as cooperation from "./management-hq-cooperative";
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
} from "./management-hq-live-store";
import * as codec from "./management-hq-storage-v2";
import {
  offlineHqV2Pool,
  type HqV2OfflineRow,
} from "./management-hq-storage-v2-pool";
import { validateHqWireEntity } from "./management-hq-wire-contract";

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
  version = 1
): HqV2OfflineRow => ({
  datasetId,
  state,
  mode: "live",
  ownerUserId: 0,
  stateVersion: version,
  updatedAt: "2026-11-22T12:00:00.000Z",
});
let small: HqImplementedSyncState;
let staged: HqImplementedSyncState;
beforeAll(async () => {
  const memory = createHqImplementedMemoryStore();
  await createHqImplementedEngine(
    createHqImplementedSampleReader("initial"),
    memory
  ).sync();
  small = { ...(await memory.readSync())!, version: 1 };
  const stageMemory = createHqImplementedMemoryStore();
  let calls = 0;
  await createHqImplementedEngine(
    createHqImplementedSampleReader("initial"),
    stageMemory,
    { shouldContinue: () => ++calls <= 3 }
  ).backfill();
  staged = { ...(await stageMemory.readSync())!, version: 1 };
});
afterEach(() => vi.restoreAllMocks());

async function seededStore(
  options: Parameters<typeof createHqLiveStore>[2] = {},
  state = small
) {
  const fixture = offlineHqV2Pool();
  // A mutable capability wrapper models configuration revocation without
  // altering the actual environment or the frozen production config object.
  const config = { ...configuration() };
  const store = createHqLiveStore(fixture.pool, config, options);
  const acquired = await store.acquire();
  if (acquired.status !== "acquired") throw new Error("offline lease required");
  // Explicit V2 rows: ordinary CAS deliberately keeps this small fixture V1.
  const encoded = codec.encodeHqLiveV2Sync(
    state,
    acquired.lease.sourceFingerprint
  );
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
  expect(
    JSON.parse(fixture.rows.get(HQ_LIVE_SYNC_DATASET_ID)!.state).format
  ).toBe("hq-live-sync-manifest-v2");
  expect(encoded.chunks.length).toBeGreaterThan(0);
  return {
    fixture,
    config,
    store,
    lease: acquired.lease,
    fenced: store.fencedSyncStore(acquired.lease),
    encoded,
  };
}
const decodeSpy = () => vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
const rootRow = (f: ReturnType<typeof offlineHqV2Pool>) =>
  f.rows.get(HQ_LIVE_SYNC_DATASET_ID)!;
const savedRows = (f: ReturnType<typeof offlineHqV2Pool>) => clone([...f.rows]);
const changed = () => {
  const next = clone(small);
  next.version++;
  const record = next.published!.entities["booking:1"];
  Object.assign(record.entity.payload, { offlineAmendment: "new-owned-bytes" });
  record.canonicalPayload = canonicalHqJson(record.entity);
  return next;
};

/** Rehash ALL physical and logical layers; only the entity semantics are invalid. */
function rehashedInvalidEntity(
  seeded: Awaited<ReturnType<typeof seededStore>>
) {
  const { encoded, fixture, lease } = seeded;
  const manifest = clone(encoded.manifest);
  const expanded = clone(small);
  const key = "booking:1";
  const record = expanded.published!.entities[key];
  Object.assign(record.entity.payload, { orbitBookingId: "not-an-integer" });
  record.canonicalPayload = canonicalHqJson(record.entity);
  expect(() => validateHqWireEntity(record.entity)).toThrow();
  const compact = clone(expanded) as any;
  for (const part of ["published", "stage"] as const)
    for (const current of Object.values(compact[part]?.entities ?? {}) as any[])
      delete current.entity;
  const group = manifest.groups.find(
    g => g.kind === "entities" && g.part === "published" && g.bucket === 1
  )!;
  const refs = group.chunks;
  const raw = Buffer.concat(
    refs.map(ref =>
      codec.validateHqV2Chunk(
        fixture.rows.get(ref.id)!.state,
        ref,
        lease.sourceFingerprint
      )
    )
  );
  const contents = JSON.parse(raw.toString("utf8"));
  contents[key].canonicalPayload = record.canonicalPayload;
  const bytes = Buffer.from(canonicalHqJson(contents));
  expect(bytes.length).toBeLessThan(codec.HQ_LIVE_V2_CHUNK_BYTES);
  const sha256 = digest(bytes);
  const id =
    "live:company:orbit:v2:chunk:" +
    digest(lease.sourceFingerprint + ":" + sha256);
  group.byteCount = bytes.length;
  group.sha256 = sha256;
  group.chunks = [{ id, sha256, byteCount: bytes.length }];
  fixture.rows.set(
    id,
    row(
      id,
      canonicalHqJson({
        format: "hq-live-sync-chunk-v2",
        sourceFingerprint: lease.sourceFingerprint,
        sha256,
        byteCount: bytes.length,
        data: bytes.toString("base64"),
      })
    )
  );
  manifest.compactBytes = codec.hqJsonUtf8Bytes(compact);
  manifest.expandedBytes = codec.hqJsonUtf8Bytes(expanded);
  manifest.sha256 = digest(canonicalHqJson(compact));
  codec.validateHqV2Manifest(manifest, 1, lease.sourceFingerprint);
  const chunks = new Map(
    codec
      .manifestChunkRefs(manifest)
      .map(ref => [ref.id, fixture.rows.get(ref.id)!.state])
  );
  for (const ref of codec.manifestChunkRefs(manifest))
    expect(
      codec.validateHqV2Chunk(chunks.get(ref.id)!, ref, lease.sourceFingerprint)
        .length
    ).toBe(ref.byteCount);
  rootRow(fixture).state = JSON.stringify(manifest);
}

describe("HQ live actual V2 validated reuse (no imported test modules)", () => {
  it("decodes once then reuses the actual V2 snapshot while rereading control/root/all chunks", async () => {
    const { fixture, fenced } = await seededStore();
    const decode = decodeSpy();
    expect(await fenced.readSync()).toEqual(small);
    const from = fixture.trace.length;
    for (let n = 0; n < 3; n++) expect(await fenced.readSync()).toEqual(small);
    expect(decode).toHaveBeenCalledTimes(1);
    const reads = fixture.trace.slice(from);
    expect(
      reads.filter(t => t.args[0] === HQ_LIVE_CONTROL_DATASET_ID)
    ).toHaveLength(3);
    expect(
      reads.filter(t => t.args[0] === HQ_LIVE_SYNC_DATASET_ID)
    ).toHaveLength(3);
    expect(reads.filter(t => t.sql.includes("datasetId IN"))).toHaveLength(3);
    expect(
      reads
        .filter(t => t.sql.includes("datasetId IN"))
        .every(t => t.sql.endsWith("FOR UPDATE"))
    ).toBe(true);
  });

  it("accepts root and chunk wrapper key reordering without redecoding unchanged bytes", async () => {
    const { fixture, fenced } = await seededStore();
    const decode = decodeSpy();
    await fenced.readSync();
    for (const current of fixture.rows.values()) {
      if (current.datasetId === HQ_LIVE_CONTROL_DATASET_ID) continue;
      current.state =
        " \n" +
        JSON.stringify(
          Object.fromEntries(
            Object.entries(JSON.parse(current.state)).reverse()
          ),
          null,
          2
        ) +
        "\n\t";
    }
    expect(await fenced.readSync()).toEqual(small);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it.each([
    "invalid-json",
    "root-hash",
    "source-binding",
    "row-owner",
  ] as const)(
    "rejects same-version %s root corruption after warming and clears the slot",
    async damage => {
      const { fixture, fenced } = await seededStore();
      const decode = decodeSpy();
      await fenced.readSync();
      const original = clone(rootRow(fixture));
      const root = JSON.parse(original.state);
      if (damage === "invalid-json") rootRow(fixture).state = "{";
      if (damage === "root-hash") {
        root.sha256 = "0".repeat(64);
        rootRow(fixture).state = JSON.stringify(root);
      }
      if (damage === "source-binding") {
        root.sourceFingerprint = "f".repeat(64);
        rootRow(fixture).state = JSON.stringify(root);
      }
      if (damage === "row-owner") rootRow(fixture).ownerUserId = 7;
      expect(rootRow(fixture).stateVersion).toBe(1);
      await expect(fenced.readSync()).rejects.toMatchObject({
        code:
          damage === "source-binding"
            ? "SOURCE_BINDING_CHANGED"
            : "INVALID_PERSISTED_STATE",
      });
      const afterDenial = decode.mock.calls.length;
      fixture.rows.set(HQ_LIVE_SYNC_DATASET_ID, original);
      expect(await fenced.readSync()).toEqual(small);
      expect(decode.mock.calls.length).toBe(afterDenial + 1);
    }
  );

  it.each(["bytes", "owner", "mode", "version", "missing"] as const)(
    "rejects same-version referenced chunk %s corruption after warming",
    async damage => {
      const { fixture, fenced, encoded } = await seededStore();
      const decode = decodeSpy();
      await fenced.readSync();
      const id = encoded.chunks[0].id;
      const current = fixture.rows.get(id)!;
      const original = clone(current);
      if (damage === "bytes") {
        const wrapper = JSON.parse(current.state);
        const bytes = Buffer.from(wrapper.data, "base64");
        bytes[0] ^= 1;
        wrapper.data = bytes.toString("base64");
        current.state = JSON.stringify(wrapper);
      }
      if (damage === "owner") current.ownerUserId = 1;
      if (damage === "mode") current.mode = "sample";
      if (damage === "version") current.stateVersion = 2;
      if (damage === "missing") fixture.rows.delete(id);
      expect(rootRow(fixture).stateVersion).toBe(1);
      await expect(fenced.readSync()).rejects.toMatchObject({
        code: "INVALID_PERSISTED_STATE",
      });
      fixture.rows.set(id, original);
      expect(await fenced.readSync()).toEqual(small);
      expect(decode).toHaveBeenCalledTimes(2);
    }
  );

  it("falls back to the strong decoder and rejects a same-version fully rehashed malformed semantic entity", async () => {
    const seeded = await seededStore();
    const decode = decodeSpy();
    await seeded.fenced.readSync();
    rehashedInvalidEntity(seeded);
    expect(rootRow(seeded.fixture).stateVersion).toBe(1);
    await expect(seeded.fenced.readSync()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_STATE",
    });
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("does not let mutations of cold or cached returned objects poison owned state", async () => {
    const { fenced } = await seededStore();
    const decode = decodeSpy();
    const first = (await fenced.readSync())!;
    first.published!.entities["booking:1"].entity.payload = {
      poisoned: true,
    } as never;
    first.published!.entities["booking:1"].canonicalPayload = "poisoned";
    first.published!.metadata = null as never;
    const second = (await fenced.readSync())!;
    expect(second).toEqual(small);
    second.published = null;
    expect(await fenced.readSync()).toEqual(small);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("invalidates the old slot after successful V2 CAS and caches only the newly persisted snapshot", async () => {
    const { fixture, fenced } = await seededStore();
    const decode = decodeSpy();
    await fenced.readSync();
    const next = changed();
    expect(await fenced.compareAndSwapSync(1, next)).toBe(true);
    expect(JSON.parse(rootRow(fixture).state).format).toBe(
      "hq-live-sync-manifest-v2"
    );
    expect(decode).toHaveBeenCalledTimes(1);
    expect(await fenced.readSync()).toEqual(next);
    expect(await fenced.readSync()).toEqual(next);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("does not bypass strong control-row validation on a warmed cache hit", async () => {
    const { fixture, fenced } = await seededStore();
    const decode = decodeSpy();
    await fenced.readSync();
    const original = clone(fixture.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!);
    fixture.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.mode = "sample";
    await expect(fenced.readSync()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_STATE",
    });
    expect(decode).toHaveBeenCalledTimes(1);
    fixture.rows.set(HQ_LIVE_CONTROL_DATASET_ID, original);
    expect(await fenced.readSync()).toEqual(small);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("owns Buffer copies rather than retaining validator-returned slice aliases", async () => {
    const { fixture, fenced } = await seededStore();
    const decode = decodeSpy();
    const realValidate = codec.validateHqV2Chunk;
    const borrowed: Buffer[] = [];
    vi.spyOn(codec, "validateHqV2Chunk").mockImplementation((...args) => {
      const bytes = realValidate(...args);
      borrowed.push(bytes);
      return bytes;
    });
    await fenced.readSync();
    expect(borrowed.length).toBeGreaterThan(0);
    for (const bytes of borrowed) bytes.fill(0);
    expect(await fenced.readSync()).toEqual(small);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("copies cache hits cooperatively through the CPU-only yield seam without whole-state native JSON cloning", async () => {
    // Deterministic handoffs independent of timing or host load; production
    // checkpoint implementation remains covered by existing cooperative suites.
    vi.spyOn(cooperation, "createHqCpuCheckpoint").mockImplementation(
      guard => async () => {
        await guard?.();
      }
    );
    const critical = vi.fn(async () => {});
    const cpuOnly = vi.fn(async () => {});
    const { fixture, fenced, encoded } = await seededStore({
      cooperativeGuard: critical,
      cooperativeYieldGuard: cpuOnly,
    });
    const decode = decodeSpy();
    await fenced.readSync();
    critical.mockClear();
    cpuOnly.mockClear();
    const nativeStringify = JSON.stringify;
    vi.spyOn(JSON, "stringify").mockImplementation(((
      value: any,
      ...args: any[]
    ) => {
      if (
        value &&
        typeof value === "object" &&
        "version" in value &&
        "published" in value &&
        "stage" in value
      )
        throw new Error("whole-state native clone forbidden");
      return (nativeStringify as any)(value, ...args);
    }) as typeof JSON.stringify);
    expect(await fenced.readSync()).toEqual(small);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(cpuOnly.mock.calls.length).toBeGreaterThan(
      20 + encoded.chunks.length
    );
    // Critical transaction authorization stays fresh, not replaced by the CPU seam.
    expect(critical).toHaveBeenCalledTimes(1);
    const before = savedRows(fixture);
    cpuOnly.mockClear();
    cpuOnly.mockImplementation(async () => {
      if (cpuOnly.mock.calls.length >= encoded.chunks.length + 20)
        throw new HqLiveError("AUTH_DENIED");
    });
    await expect(fenced.readSync()).rejects.toMatchObject({
      code: "AUTH_DENIED",
    });
    expect(decode).toHaveBeenCalledTimes(1);
    expect(savedRows(fixture)).toEqual(before);
  });

  it("keeps the original cooperativeGuard as the default CPU-yield guard when no seam is supplied", async () => {
    vi.spyOn(cooperation, "createHqCpuCheckpoint").mockImplementation(
      guard => async () => {
        await guard?.();
      }
    );
    const original = vi.fn(async () => {});
    const { fenced } = await seededStore({ cooperativeGuard: original });
    const decode = decodeSpy();
    await fenced.readSync();
    original.mockClear();
    expect(await fenced.readSync()).toEqual(small);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(original.mock.calls.length).toBeGreaterThan(20);
  });

  it("rolls back inserted chunks and the updated root when the post-root UPDATE crosses expiry; no candidate is promoted", async () => {
    const { fixture, fenced } = await seededStore();
    const decode = decodeSpy();
    await fenced.readSync();
    const before = savedRows(fixture);
    let updated = false;
    fixture.setAfterHook((sql, args, draft) => {
      if (sql.startsWith("UPDATE") && args[2] === HQ_LIVE_SYNC_DATASET_ID) {
        updated = true;
        expect(draft.get(HQ_LIVE_SYNC_DATASET_ID)!.stateVersion).toBe(2);
        fixture.advance(30001);
      }
    });
    await expect(fenced.compareAndSwapSync(1, changed())).rejects.toMatchObject(
      { code: "LEASE_LOST" }
    );
    fixture.setAfterHook(null);
    expect(updated).toBe(true);
    expect(
      fixture.trace.some(
        t =>
          t.sql.startsWith("INSERT") &&
          t.args[0].startsWith("live:company:orbit:v2:chunk:")
      )
    ).toBe(true);
    expect(savedRows(fixture)).toEqual(before);
    expect(fixture.rollbacks.mock.calls.length).toBeGreaterThan(0);
    const afterRollback = decode.mock.calls.length;
    // Existing read-only recovery semantics permit rereading after lease expiry.
    expect(await fenced.readSync()).toEqual(small);
    expect(decode.mock.calls.length).toBe(afterRollback + 1);
  });

  it("does not promote a freshly decoded candidate when the final transaction authority denies commit", async () => {
    let deny = false;
    const { fixture, fenced } = await seededStore({
      cooperativeGuard: async () => {
        if (deny) throw new HqLiveError("AUTH_DENIED");
      },
      cooperativeYieldGuard: async () => {},
    });
    const decode = decodeSpy();
    // CPU-only checks succeed; the latched critical denial is consumed only
    // after the decoder and owned copy complete, at the final commit boundary.
    fixture.setAfterHook(sql => {
      if (sql.includes("datasetId IN")) deny = true;
    });
    await expect(fenced.readSync()).rejects.toMatchObject({
      code: "AUTH_DENIED",
    });
    expect(decode).toHaveBeenCalledTimes(1);
    await expect(decode.mock.results[0].value).resolves.toEqual(small);
    fixture.setAfterHook(null);
    deny = false;
    const count = decode.mock.calls.length;
    expect(await fenced.readSync()).toEqual(small);
    expect(decode.mock.calls.length).toBe(count + 1);
  });

  it("shares only exact validated bytes across read-only lease identities but rejects a wrong lease write", async () => {
    const { store, fenced, lease, fixture } = await seededStore();
    const decode = decodeSpy();
    await fenced.readSync();
    const different = store.fencedSyncStore({
      ...lease,
      token: randomUUID(),
      fencingNumber: lease.fencingNumber + 1,
    });
    expect(await different.readSync()).toEqual(small);
    expect(decode).toHaveBeenCalledTimes(1);
    const before = savedRows(fixture);
    await expect(
      different.compareAndSwapSync(1, changed())
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(savedRows(fixture)).toEqual(before);
    expect(await fenced.readSync()).toEqual(small);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("reuses actual V2 acquisition validation on the first newly fenced read of the unchanged staged root", async () => {
    const { store, fixture } = await seededStore({}, staged);
    // Model a due, unleased initial stage. Acquisition must validate it before
    // granting the new lease; granting changes only control, not persisted sync.
    const current = fixture.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!;
    const control = JSON.parse(current.state);
    Object.assign(control, {
      leaseToken: null,
      leaseExpiresAtMs: null,
      leaseHardExpiresAtMs: null,
      stageStatus: "progress",
    });
    current.state = JSON.stringify(control);
    const decode = decodeSpy();
    const acquired = await store.acquireInitialPublication!();
    expect(acquired.status).toBe("acquired");
    if (acquired.status !== "acquired")
      throw new Error("offline lease required");
    expect(decode).toHaveBeenCalledTimes(1);
    expect(await store.fencedSyncStore(acquired.lease).readSync()).toEqual(
      staged
    );
    expect(decode).toHaveBeenCalledTimes(1);
    // All chunk bytes are reread even when the new fenced reader can reuse.
    const ref = codec.manifestChunkRefs(JSON.parse(rootRow(fixture).state))[0];
    const wrapper = JSON.parse(fixture.rows.get(ref.id)!.state);
    const bytes = Buffer.from(wrapper.data, "base64");
    bytes[0] ^= 1;
    wrapper.data = bytes.toString("base64");
    fixture.rows.get(ref.id)!.state = JSON.stringify(wrapper);
    await expect(
      store.fencedSyncStore(acquired.lease).readSync()
    ).rejects.toMatchObject({ code: "INVALID_PERSISTED_STATE" });
  });

  it("clears reuse on configuration denial before V2 validation", async () => {
    const { config, fenced } = await seededStore();
    const decode = decodeSpy();
    await fenced.readSync();
    const status = config.status();
    const spy = vi
      .spyOn(config, "status")
      .mockReturnValue({ ...status, configured: false });
    await expect(fenced.readSync()).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    spy.mockRestore();
    expect(await fenced.readSync()).toEqual(small);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("protected cooperative=false Resume always invokes its original strong synchronous decoder", async () => {
    const { fixture, store } = await seededStore({}, staged);
    const decode = decodeSpy();
    const syncDecode = vi.spyOn(codec, "decodeHqLiveV2Sync");
    await store.readSnapshot();
    const current = fixture.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!;
    const control = JSON.parse(current.state);
    Object.assign(control, {
      leaseToken: null,
      leaseExpiresAtMs: null,
      leaseHardExpiresAtMs: null,
      stageStatus: "needs_attention",
      lastErrorCode: "STATE_BYTE_CAP_EXCEEDED",
      consecutiveFailures: 1,
    });
    current.state = JSON.stringify(control);
    expect(
      await store.resumeStagedInitialImport!(control.version, 1, async () => {})
    ).toBe("resumed");
    expect(decode).toHaveBeenCalledTimes(1);
    expect(syncDecode).toHaveBeenCalledTimes(1);
  });

  it("keeps native legacy V1 depth-258 extras accepted and never caches V1", async () => {
    const { fixture, fenced, lease } = await seededStore();
    const decode = decodeSpy();
    await fenced.readSync();
    let deep: unknown = "retained";
    for (let n = 0; n < 258; n++) deep = { x: deep };
    const state = { version: 1, published: null, stage: null, extra: deep };
    rootRow(fixture).state = JSON.stringify({
      format: "hq-live-sync-v1",
      sourceFingerprint: lease.sourceFingerprint,
      sync: state,
    });
    expect(await fenced.readSync()).toEqual(state);
    expect(await fenced.readSync()).toEqual(state);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(() =>
      codec.encodeHqLiveV2Sync(state, lease.sourceFingerprint)
    ).toThrow();
  });
});
