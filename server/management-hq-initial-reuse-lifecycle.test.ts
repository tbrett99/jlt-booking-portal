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
} from "./management-hq-live-store";
import * as codec from "./management-hq-storage-v2";
import {
  offlineHqV2Pool,
  type HqV2OfflineRow,
} from "./management-hq-storage-v2-pool";
import { validateHqWireEntity } from "./management-hq-wire-contract";

// Real engine-produced two-record fixture and genuine seeded V2 rows only.
// No imported test modules, provider, live DB, environment changes or benchmark.
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
  expect(pages.every(p => p.published === null && p.stage)).toBe(true);
  expect(Object.keys(pages[1].stage!.entities)).toHaveLength(2);
});
afterEach(() => vi.restoreAllMocks());

async function seed(state = pages[0], options: Options = {}) {
  const fixture = offlineHqV2Pool();
  const config = { ...configuration() };
  const scope = digest("offline-settings-and-db-url:" + randomUUID());
  const acquire = await createHqLiveStore(fixture.pool, config).acquire();
  if (acquire.status !== "acquired") throw new Error("offline lease required");
  const lease = acquire.lease;
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
  const request = (
    overrides: Options = {},
    requestLease: HqLiveLease = lease
  ) => {
    const store = createHqLiveStore(fixture.pool, config, {
      validatedInitialReuseScope: scope,
      ...options,
      ...overrides,
    });
    return { store, fenced: store.fencedSyncStore(requestLease) };
  };
  return { fixture, config, scope, lease, encoded, request };
}
const savedRows = (fixture: ReturnType<typeof offlineHqV2Pool>) =>
  clone([...fixture.rows]);
const root = (fixture: ReturnType<typeof offlineHqV2Pool>) =>
  fixture.rows.get(HQ_LIVE_SYNC_DATASET_ID)!;
const decodeSpy = () => vi.spyOn(codec, "decodeHqLiveV2SyncAsync");
const exactCpuSeam = () =>
  vi
    .spyOn(cooperation, "createHqCpuCheckpoint")
    .mockImplementation(guard => async () => {
      await guard?.();
    });
const rootUpdate = (sql: string, args: any[]) =>
  sql.startsWith("UPDATE") && args[2] === HQ_LIVE_SYNC_DATASET_ID;

function invalidateSemantics(seeded: Awaited<ReturnType<typeof seed>>) {
  // Rehash all physical/logical layers at the SAME version. Hashes, manifest
  // grammar and wrappers pass; only the actual wire entity semantics fail.
  const { fixture, lease } = seeded;
  const manifest = JSON.parse(root(fixture).state) as codec.HqV2Manifest;
  const expanded = clone(pages[0]);
  const record = expanded.stage!.entities["booking:1"];
  Object.assign(record.entity.payload, { orbitBookingId: "not-an-integer" });
  record.canonicalPayload = canonicalHqJson(record.entity);
  expect(() => validateHqWireEntity(record.entity)).toThrow();
  const compact = clone(expanded) as any;
  for (const current of Object.values(compact.stage.entities) as any[])
    delete current.entity;
  const group = manifest.groups.find(
    g => g.part === "stage" && g.kind === "entities" && g.bucket === 1
  )!;
  const contents = JSON.parse(
    Buffer.concat(
      group.chunks.map(ref =>
        codec.validateHqV2Chunk(
          fixture.rows.get(ref.id)!.state,
          ref,
          lease.sourceFingerprint
        )
      )
    ).toString("utf8")
  );
  contents["booking:1"].canonicalPayload = record.canonicalPayload;
  const bytes = Buffer.from(canonicalHqJson(contents));
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
  codec.validateHqV2Manifest(
    manifest,
    expanded.version,
    lease.sourceFingerprint
  );
  for (const ref of codec.manifestChunkRefs(manifest))
    expect(
      codec.validateHqV2Chunk(
        fixture.rows.get(ref.id)!.state,
        ref,
        lease.sourceFingerprint
      ).length
    ).toBe(ref.byteCount);
  root(fixture).state = JSON.stringify(manifest);
}

describe("opt-in initial V2 committed validation lifecycle, tiny offline fixture", () => {
  it("owned codec preserves exact Unicode, financial/identity, extension and wrapper bytes without changing original encode shape", async () => {
    for (const snapshot of [pages[1], published]) {
      const state = clone(snapshot);
      const part = state.stage ?? state.published!;
      const record = part.entities["booking:1"];
      Object.assign(record.entity.payload, {
        tinyOfflineExtra: {
          z: ['漢字😀\\"\n', "\ud800", -0],
          a: { nested: true },
        },
      });
      record.canonicalPayload = canonicalHqJson(record.entity);
      const fingerprint = configuration().sourceFingerprint()!;
      const original = codec.encodeHqLiveV2Sync(state, fingerprint);
      expect(Object.keys(original)).toEqual(["manifest", "chunks"]);
      const owned = await codec.encodeHqLiveV2SyncOwnedAsync(
        state,
        fingerprint,
        async () => {}
      );
      expect(JSON.stringify(owned.manifest)).toBe(
        JSON.stringify(original.manifest)
      );
      expect(owned.chunks).toEqual(original.chunks);
      for (const ref of codec.manifestChunkRefs(owned.manifest)) {
        const chunk = owned.chunks.find(chunk => chunk.id === ref.id)!;
        expect(
          owned.candidate.chunks
            .get(ref.id)!
            .equals(codec.validateHqV2Chunk(chunk.serialized, ref, fingerprint))
        ).toBe(true);
      }
      expect(owned.candidate.state).toEqual(clone(state));
      const result = codec.decodeHqLiveV2Sync(
        original.manifest,
        new Map(original.chunks.map(chunk => [chunk.id, chunk.serialized])),
        fingerprint
      );
      expect(owned.candidate.state).toEqual(result);
      expect(
        (owned.candidate.state.stage ?? owned.candidate.state.published)!
          .entities["booking:1"].entity
      ).not.toBe(record.entity);
    }
  });

  it("a cold decoded initial read is not shared until its actual SQL commit succeeds", async () => {
    const seeded = await seed();
    const decode = decodeSpy();
    const before = savedRows(seeded.fixture);
    let denied = false;
    seeded.fixture.setAfterHook(sql => {
      if (sql.includes("datasetId IN")) denied = true;
    });
    await expect(
      seeded
        .request({
          cooperativeGuard: async () => {
            if (denied) throw new HqLiveError("AUTH_DENIED");
          },
          cooperativeYieldGuard: async () => {},
        })
        .fenced.readSync()
    ).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(decode).toHaveBeenCalledTimes(1);
    expect(savedRows(seeded.fixture)).toEqual(before);
    seeded.fixture.setAfterHook(null);
    expect(await seeded.request().fenced.readSync()).toEqual(pages[0]);
    expect(decode).toHaveBeenCalledTimes(2);
    expect(await seeded.request().fenced.readSync()).toEqual(pages[0]);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("saves redecodes across actual page commits and new stores vs unchanged default", async () => {
    const run = async (enabled: boolean) => {
      const seeded = await seed();
      const decode = decodeSpy();
      const counts: number[] = [];
      for (let n = 0; n < 3; n++) {
        const { fenced } = seeded.request(
          enabled ? {} : { validatedInitialReuseScope: undefined }
        );
        expect(await fenced.readSync()).toEqual(pages[n]);
        expect(await fenced.readSync()).toEqual(pages[n]);
        expect(
          await fenced.compareAndSwapSync(pages[n].version, pages[n + 1])
        ).toBe(true);
        counts.push(decode.mock.calls.length);
      }
      expect(
        await seeded
          .request(enabled ? {} : { validatedInitialReuseScope: undefined })
          .fenced.readSync()
      ).toEqual(pages[3]);
      const total = decode.mock.calls.length;
      decode.mockRestore();
      return { total, counts };
    };
    const normal = await run(false);
    const accelerated = await run(true);
    expect(normal).toEqual({ total: 4, counts: [1, 2, 3] });
    expect(accelerated).toEqual({ total: 1, counts: [1, 1, 1] });
  });

  it("every cross-request hit still reads control/root/all chunks and validates wrappers/exact bytes", async () => {
    const seeded = await seed(pages[1]);
    const decode = decodeSpy();
    const validate = vi.spyOn(codec, "validateHqV2Chunk");
    await seeded.request().fenced.readSync();
    const from = seeded.fixture.trace.length;
    validate.mockClear();
    // MySQL JSON wrapper key order is intentionally not the cache identity.
    for (const current of seeded.fixture.rows.values()) {
      if (current.datasetId === HQ_LIVE_CONTROL_DATASET_ID) continue;
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
    for (let n = 0; n < 3; n++)
      expect(await seeded.request().fenced.readSync()).toEqual(pages[1]);
    expect(decode).toHaveBeenCalledTimes(1);
    const trace = seeded.fixture.trace.slice(from);
    expect(
      trace.filter(t => t.args[0] === HQ_LIVE_CONTROL_DATASET_ID)
    ).toHaveLength(3);
    expect(
      trace.filter(t => t.args[0] === HQ_LIVE_SYNC_DATASET_ID)
    ).toHaveLength(3);
    const chunkReads = trace.filter(t => t.sql.includes("datasetId IN"));
    expect(chunkReads).toHaveLength(3);
    expect(
      chunkReads.every(t => t.sql.endsWith("FOR UPDATE") && t.args.length <= 4)
    ).toBe(true);
    expect(validate.mock.calls.length).toBe(6 * seeded.encoded.chunks.length);
  });

  it("reuses committed pages through progress completion and fresh new-store lease acquisition without retaining lease authority", async () => {
    const seeded = await seed();
    const decode = decodeSpy();
    let lease = seeded.lease;
    for (let n = 0; n < 3; n++) {
      const request = seeded.request({}, lease);
      expect(await request.fenced.readSync()).toEqual(pages[n]);
      expect(
        await request.fenced.compareAndSwapSync(pages[n].version, pages[n + 1])
      ).toBe(true);
      await request.store.complete(lease, {
        status: "progress",
        delaySeconds: 0,
      });
      const released = JSON.parse(
        seeded.fixture.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.state
      );
      expect(released.leaseToken).toBeNull();
      const freshStore = seeded.request().store;
      const acquired = await freshStore.acquireInitialPublication!();
      expect(acquired.status).toBe("acquired");
      if (acquired.status !== "acquired")
        throw new Error("offline new lease required");
      expect(acquired.lease.token).not.toBe(lease.token);
      expect(acquired.lease.fencingNumber).toBe(lease.fencingNumber + 1);
      lease = acquired.lease;
      expect(await freshStore.fencedSyncStore(lease).readSync()).toEqual(
        pages[n + 1]
      );
    }
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("retains no prior request guard/config/lease and authorizes the new request independently", async () => {
    exactCpuSeam();
    const seeded = await seed();
    const oldGuard = vi.fn(async () => {});
    const oldCpu = vi.fn(async () => {});
    const oldConfig = { ...seeded.config };
    const first = createHqLiveStore(seeded.fixture.pool, oldConfig, {
      validatedInitialReuseScope: seeded.scope,
      cooperativeGuard: oldGuard,
      cooperativeYieldGuard: oldCpu,
    });
    const decode = decodeSpy();
    await first.fencedSyncStore(seeded.lease).readSync();
    oldGuard.mockClear();
    oldCpu.mockClear();
    oldGuard.mockImplementation(async () => {
      throw new Error("old guard retained");
    });
    oldCpu.mockImplementation(async () => {
      throw new Error("old CPU guard retained");
    });
    vi.spyOn(oldConfig, "status").mockImplementation(() => {
      throw new Error("old config retained");
    });
    const freshGuard = vi.fn(async () => {});
    const freshCpu = vi.fn(async () => {});
    const wrongLease = {
      ...seeded.lease,
      token: randomUUID(),
      fencingNumber: seeded.lease.fencingNumber + 1,
    };
    const second = seeded.request(
      { cooperativeGuard: freshGuard, cooperativeYieldGuard: freshCpu },
      wrongLease
    );
    expect(await second.fenced.readSync()).toEqual(pages[0]);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(oldGuard).not.toHaveBeenCalled();
    expect(oldCpu).not.toHaveBeenCalled();
    expect(freshGuard).toHaveBeenCalled();
    expect(freshCpu).toHaveBeenCalled();
    const before = savedRows(seeded.fixture);
    await expect(
      second.fenced.compareAndSwapSync(1, pages[1])
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(savedRows(seeded.fixture)).toEqual(before);
    expect(await seeded.request().fenced.readSync()).toEqual(pages[0]);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("different scope/pool evicts the single slot, and switching back must decode again", async () => {
    const first = await seed();
    const decode = decodeSpy();
    await first.request().fenced.readSync();
    const otherScope = digest("other raw settings");
    await first
      .request({ validatedInitialReuseScope: otherScope })
      .fenced.readSync();
    expect(decode).toHaveBeenCalledTimes(2);
    await first.request().fenced.readSync();
    expect(decode).toHaveBeenCalledTimes(3);
    const other = await seed();
    await other
      .request({ validatedInitialReuseScope: first.scope })
      .fenced.readSync();
    expect(decode).toHaveBeenCalledTimes(4);
    await first.request().fenced.readSync();
    expect(decode).toHaveBeenCalledTimes(5);
  });

  it("promotes only the exact new committed candidate with unchanged codec bytes and no write-state decode", async () => {
    const seeded = await seed();
    const decode = decodeSpy();
    const owned = vi.spyOn(codec, "encodeHqLiveV2SyncOwnedAsync");
    await seeded.request().fenced.readSync();
    const expected = codec.encodeHqLiveV2Sync(
      pages[1],
      seeded.lease.sourceFingerprint
    );
    expect(await seeded.request().fenced.compareAndSwapSync(1, pages[1])).toBe(
      true
    );
    expect(owned).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(root(seeded.fixture).state).toBe(JSON.stringify(expected.manifest));
    for (const chunk of expected.chunks)
      expect(seeded.fixture.rows.get(chunk.id)!.state).toBe(chunk.serialized);
    const chunks = new Map(
      expected.chunks.map(chunk => [chunk.id, chunk.serialized])
    );
    expect(
      codec.decodeHqLiveV2Sync(
        expected.manifest,
        chunks,
        seeded.lease.sourceFingerprint
      )
    ).toEqual(pages[1]);
    expect(await seeded.request().fenced.readSync()).toEqual(pages[1]);
    expect(await seeded.request().fenced.readSync()).toEqual(pages[1]);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("candidate owns the exact captured encode values despite mutation during/after encoding and return mutation", async () => {
    exactCpuSeam();
    const seeded = await seed();
    const decode = decodeSpy();
    await seeded.request().fenced.readSync();
    const next = clone(pages[1]);
    const captured = clone(next);
    let mutated = false;
    const realValidate = codec.validateHqV2Chunk;
    seeded.fixture.setHook((sql, args) => {
      if (
        sql.startsWith("SELECT") &&
        args[0] === HQ_LIVE_CONTROL_DATASET_ID &&
        !mutated
      ) {
        // Encoding finished before this first CAS SQL; the mutable caller must
        // have no influence on the immutable owned candidate or commit bytes.
        mutated = true;
        next.stage!.entities["booking:1"].canonicalPayload = "poison";
        next.stage!.entities["booking:1"].entity.payload = {
          poison: true,
        } as never;
        next.stage!.metadata = null;
      }
    });
    const borrowed: Buffer[] = [];
    vi.spyOn(codec, "validateHqV2Chunk").mockImplementation((...args) => {
      const raw = realValidate(...args);
      borrowed.push(raw);
      return raw;
    });
    expect(await seeded.request().fenced.compareAndSwapSync(1, next)).toBe(
      true
    );
    seeded.fixture.setHook(null);
    expect(mutated).toBe(true);
    next.stage = null;
    for (const raw of borrowed) raw.fill(0);
    const returned = (await seeded.request().fenced.readSync())!;
    expect(returned).toEqual(captured);
    returned.stage!.entities["booking:1"].entity.payload = {
      poisoned: true,
    } as never;
    returned.stage!.metadata = null;
    expect(await seeded.request().fenced.readSync()).toEqual(captured);
    expect(decode).toHaveBeenCalledTimes(1);
    // Mutate a caller DURING codec awaits after owned capture has completed.
    const late = clone(pages[2]);
    const validate = ingestion.validateHqImplementedSyncStateAsync;
    const validationSpy = vi
      .spyOn(ingestion, "validateHqImplementedSyncStateAsync")
      .mockImplementation(async (...args) => {
        expect(args[0]).not.toBe(late);
        late.stage!.entities["booking:1"].canonicalPayload = "poisoned caller";
        await validate(...args);
      });
    const encoded = await codec.encodeHqLiveV2SyncOwnedAsync(
      late,
      seeded.lease.sourceFingerprint,
      async () => {}
    );
    expect(validationSpy).toHaveBeenCalledTimes(1);
    expect(encoded.candidate.state).toEqual(pages[2]);
    expect(encoded.candidate.state).not.toBe(late);
    expect(encoded.manifest).toEqual(
      codec.encodeHqLiveV2Sync(pages[2], seeded.lease.sourceFingerprint)
        .manifest
    );
  });

  it.each([
    "post-root-authority",
    "final-commit-denial",
    "post-root-expiry",
    "zero-cas",
    "sql-commit-reject",
  ] as const)(
    "%s rolls back exact rows and invalidates old and prepared candidates",
    async damage => {
      const seeded = await seed();
      const decode = decodeSpy();
      await seeded.request().fenced.readSync();
      const before = savedRows(seeded.fixture);
      let updated = false,
        denied = false;
      const options: Options = {
        cooperativeGuard: async () => {
          if (denied) throw new HqLiveError("AUTH_DENIED");
        },
        cooperativeYieldGuard: async () => {},
      };
      if (damage === "zero-cas")
        seeded.fixture.setHook((sql, args, draft) => {
          if (rootUpdate(sql, args))
            draft.get(HQ_LIVE_SYNC_DATASET_ID)!.stateVersion++;
        });
      seeded.fixture.setAfterHook((sql, args, draft) => {
        if (rootUpdate(sql, args)) {
          updated = true;
          if (damage !== "zero-cas")
            expect(draft.get(HQ_LIVE_SYNC_DATASET_ID)!.stateVersion).toBe(2);
          if (damage === "post-root-authority") denied = true;
          if (damage === "post-root-expiry") seeded.fixture.advance(30001);
        }
      });
      if (damage === "final-commit-denial")
        options.cooperativeGuard = async () => {
          if (updated) throw new HqLiveError("AUTH_DENIED");
        };
      let commitSpy: ReturnType<typeof vi.spyOn> | undefined;
      if (damage === "sql-commit-reject") {
        const get = seeded.fixture.pool.getConnection.bind(seeded.fixture.pool);
        commitSpy = vi
          .spyOn(seeded.fixture.pool, "getConnection")
          .mockImplementation(async () => {
            const connection = await get();
            connection.commit = async () => {
              throw new Error("offline rejected COMMIT");
            };
            return connection;
          });
      }
      await expect(
        seeded.request(options).fenced.compareAndSwapSync(1, pages[1])
      ).rejects.toMatchObject({
        code:
          damage === "sql-commit-reject"
            ? "STORE_UNAVAILABLE"
            : damage.includes("denial") || damage.includes("authority")
              ? "AUTH_DENIED"
              : "LEASE_LOST",
      });
      commitSpy?.mockRestore();
      expect(updated).toBe(true);
      expect(savedRows(seeded.fixture)).toEqual(before);
      expect(seeded.fixture.rollbacks.mock.calls.length).toBeGreaterThan(0);
      expect(
        seeded.fixture.trace.some(
          t =>
            t.sql.startsWith("INSERT") &&
            String(t.args[0]).startsWith("live:company:orbit:v2:chunk:")
        )
      ).toBe(true);
      seeded.fixture.setHook(null);
      seeded.fixture.setAfterHook(null);
      const count = decode.mock.calls.length;
      expect(await seeded.request().fenced.readSync()).toEqual(pages[0]);
      expect(decode.mock.calls.length).toBe(count + 1);
    }
  );

  it("false expected-version CAS rolls back and never promotes its old-root pending read", async () => {
    const seeded = await seed();
    const decode = decodeSpy();
    await seeded.request().fenced.readSync();
    const before = savedRows(seeded.fixture);
    const wrong = clone(pages[1]);
    wrong.version = 3;
    expect(await seeded.request().fenced.compareAndSwapSync(2, wrong)).toBe(
      false
    );
    expect(savedRows(seeded.fixture)).toEqual(before);
    expect(await seeded.request().fenced.readSync()).toEqual(pages[0]);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("same-version fully rehashed semantic corruption is denied and restoring bytes requires validation again", async () => {
    const seeded = await seed();
    const decode = decodeSpy();
    await seeded.request().fenced.readSync();
    const before = savedRows(seeded.fixture);
    invalidateSemantics(seeded);
    expect(root(seeded.fixture).stateVersion).toBe(1);
    await expect(seeded.request().fenced.readSync()).rejects.toMatchObject({
      code: "INVALID_PERSISTED_STATE",
    });
    expect(decode).toHaveBeenCalledTimes(2);
    seeded.fixture.rows.clear();
    for (const [id, current] of before) seeded.fixture.rows.set(id, current);
    expect(await seeded.request().fenced.readSync()).toEqual(pages[0]);
    expect(decode).toHaveBeenCalledTimes(3);
  });

  it.each(["root", "chunk", "control", "binding", "config", "encode"] as const)(
    "%s corruption/error clears shared reuse on the same pool",
    async damage => {
      const seeded = await seed();
      const decode = decodeSpy();
      await seeded.request().fenced.readSync();
      const before = savedRows(seeded.fixture);
      let restore: (() => void) | undefined;
      if (damage === "root") root(seeded.fixture).state = "{";
      if (damage === "chunk")
        seeded.fixture.rows.get(seeded.encoded.chunks[0].id)!.ownerUserId = 4;
      if (damage === "control")
        seeded.fixture.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!.mode = "sample";
      if (damage === "binding") {
        const manifest = JSON.parse(root(seeded.fixture).state);
        manifest.sourceFingerprint = "f".repeat(64);
        root(seeded.fixture).state = JSON.stringify(manifest);
      }
      if (damage === "config") {
        const current = seeded.config.status();
        const spy = vi
          .spyOn(seeded.config, "status")
          .mockReturnValue({ ...current, configured: false });
        restore = () => spy.mockRestore();
      }
      const op =
        damage === "encode"
          ? seeded.request().fenced.compareAndSwapSync(1, {
              ...clone(pages[1]),
              extra: true,
            } as HqImplementedSyncState)
          : seeded.request().fenced.readSync();
      await expect(op).rejects.toMatchObject({
        code:
          damage === "config"
            ? "CONFIG_INVALID"
            : damage === "binding"
              ? "SOURCE_BINDING_CHANGED"
              : "INVALID_PERSISTED_STATE",
      });
      restore?.();
      seeded.fixture.rows.clear();
      for (const [id, current] of before) seeded.fixture.rows.set(id, current);
      const count = decode.mock.calls.length;
      expect(await seeded.request().fenced.readSync()).toEqual(pages[0]);
      expect(decode.mock.calls.length).toBe(count + 1);
    }
  );

  it("non-sliding 60s TTL expires on access, no timers, then renews only after actual validation commit", async () => {
    const seeded = await seed();
    const origin = performance.now();
    let clock = origin;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const decode = decodeSpy();
    await seeded.request().fenced.readSync();
    clock += 59000;
    expect(await seeded.request().fenced.readSync()).toEqual(pages[0]);
    expect(decode).toHaveBeenCalledTimes(1);
    clock += 1001;
    expect(await seeded.request().fenced.readSync()).toEqual(pages[0]);
    expect(decode).toHaveBeenCalledTimes(2);
    clock += 59000;
    expect(await seeded.request().fenced.readSync()).toEqual(pages[0]);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("does not share published/no-stage states and publication clears the initial candidate", async () => {
    const seeded = await seed(pages[3]);
    const decode = decodeSpy();
    await seeded.request().fenced.readSync();
    expect(await seeded.request().fenced.compareAndSwapSync(4, published)).toBe(
      true
    );
    const count = decode.mock.calls.length;
    expect(await seeded.request().fenced.readSync()).toEqual(published);
    expect(await seeded.request().fenced.readSync()).toEqual(published);
    expect(decode.mock.calls.length).toBe(count + 2);
    const empty = await seed({ version: 1, published: null, stage: null });
    const from = decode.mock.calls.length;
    await empty.request().fenced.readSync();
    await empty.request().fenced.readSync();
    expect(decode.mock.calls.length).toBe(from + 2);
  });

  it("opt-in keeps V1 depth-258 acceptance and protected noncooperative Resume unchanged", async () => {
    const seeded = await seed();
    const decode = decodeSpy();
    await seeded.request().fenced.readSync();
    let deep: unknown = "retained";
    for (let n = 0; n < 258; n++) deep = { x: deep };
    const legacy = { version: 1, published: null, stage: null, extra: deep };
    root(seeded.fixture).state = JSON.stringify({
      format: "hq-live-sync-v1",
      sourceFingerprint: seeded.lease.sourceFingerprint,
      sync: legacy,
    });
    expect(await seeded.request().fenced.readSync()).toEqual(legacy);
    expect(await seeded.request().fenced.readSync()).toEqual(legacy);
    expect(decode).toHaveBeenCalledTimes(1);
    const staged = await seed();
    await staged.request().fenced.readSync();
    const current = staged.fixture.rows.get(HQ_LIVE_CONTROL_DATASET_ID)!;
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
    const syncDecode = vi.spyOn(codec, "decodeHqLiveV2Sync");
    expect(
      await staged.request().store.resumeStagedInitialImport!(
        control.version,
        1,
        async () => {}
      )
    ).toBe("resumed");
    expect(syncDecode).toHaveBeenCalledTimes(1);
  });
});
