import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi, afterEach } from "vitest";
import { canonicalHqJson } from "./management-hq-engine";
import { createHqLargeSyntheticReader } from "./management-hq-large-fixtures";
import type { HqImplementedSyncState } from "./management-hq-ingestion";
import * as codec from "./management-hq-storage-v2";
import * as cooperation from "./management-hq-cooperative";
import { createHqLiveConfig } from "./management-hq-live-config";
import { createHqLiveStore, HqLiveError } from "./management-hq-live-store";
import { offlineHqV2Pool } from "./management-hq-storage-v2-pool";

const FP = "a".repeat(64);
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
let seed: HqImplementedSyncState;
beforeAll(async () => {
  const reader = createHqLargeSyntheticReader({
    bookingCount: 1,
    paddingBytes: 0,
  });
  const { ready: _ready, ...metadata } = await reader.status();
  const page = await reader.bookings();
  const entity = page.items[0];
  seed = {
    version: 1,
    stage: null,
    published: {
      wireVersion: "1.0.0",
      version: 1,
      scope: metadata.scope,
      metadata,
      resumeCursor: page.resumeCursor,
      entities: {
        [`booking:${entity.entityId}`]: {
          entity,
          absent: false,
          canonicalPayload: canonicalHqJson(entity),
        },
      },
      seqProofs: {},
    },
  };
});
afterEach(() => vi.restoreAllMocks());

function capacityState(
  records: number,
  strings: number,
  character: string
): HqImplementedSyncState {
  const state = { ...seed, published: { ...seed.published!, entities: {} } };
  const padding = Array(strings).fill(character.repeat(4096));
  for (let i = 0; i < records; i++) {
    const entity = {
      entityType: "booking" as const,
      entityId: 910000001 + i,
      revision: 1,
      payload: {
        deleted: true as const,
        reason: "source_absent_or_now_explicit_demo" as const,
        entityType: "booking" as const,
        entityId: 910000001 + i,
        syntheticCapacityExtension: padding,
      },
    };
    state.published!.entities[`booking:${entity.entityId}`] = {
      entity,
      absent: false,
      canonicalPayload: canonicalHqJson(entity),
    };
  }
  return state;
}
function compact(state: HqImplementedSyncState) {
  return {
    ...state,
    published: {
      ...state.published!,
      entities: Object.fromEntries(
        Object.entries(state.published!.entities).map(
          ([key, { canonicalPayload, absent }]) => [
            key,
            { canonicalPayload, absent },
          ]
        )
      ),
    },
  };
}
function capture(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error("expected failure");
}

describe("isolated HQ V2 capacity codec", () => {
  it("raises only live byte caps, retaining old audit limits and all independent limits", () => {
    expect([
      codec.HQ_LIVE_V2_COMPACT_BYTES,
      codec.HQ_LIVE_V2_EXPANDED_BYTES,
      codec.HQ_LIVE_V2_OLD_COMPACT_BYTES,
      codec.HQ_LIVE_V2_OLD_EXPANDED_BYTES,
      codec.HQ_LIVE_V2_ROOT_BYTES,
      codec.HQ_LIVE_V2_CHUNK_BYTES,
      codec.HQ_LIVE_V2_CHUNK_ROW_BYTES,
      codec.HQ_LIVE_V2_MAX_REFS,
    ]).toEqual([
      128 * 1024 * 1024,
      256 * 1024 * 1024,
      64 * 1024 * 1024,
      128 * 1024 * 1024,
      16 * 1024 * 1024,
      512 * 1024,
      1024 * 1024,
      256,
    ]);
  });
  it("small encoding is byte-exact with an independent canonical reference and all three encoders", async () => {
    const expected = codec.encodeHqLiveV2Sync(seed, FP);
    const logical = compact(seed);
    expect(expected.manifest.sha256).toBe(hash(canonicalHqJson(logical)));
    expect(expected.manifest.compactBytes).toBe(
      Buffer.byteLength(canonicalHqJson(logical))
    );
    expect(expected.manifest.expandedBytes).toBe(
      Buffer.byteLength(canonicalHqJson(seed))
    );
    for (const group of expected.manifest.groups) {
      const value =
        group.kind === "entities"
          ? logical.published!.entities
          : { seqProofs: {} };
      const raw = Buffer.from(canonicalHqJson(value));
      expect(group.sha256).toBe(hash(raw));
      expect(group.byteCount).toBe(raw.length);
      const sha256 = hash(raw);
      const id = "live:company:orbit:v2:chunk:" + hash(FP + ":" + sha256);
      expect(group.chunks).toEqual([{ id, sha256, byteCount: raw.length }]);
      expect(expected.chunks.find(chunk => chunk.id === id)!.serialized).toBe(
        canonicalHqJson({
          format: "hq-live-sync-chunk-v2",
          sourceFingerprint: FP,
          sha256,
          byteCount: raw.length,
          data: raw.toString("base64"),
        })
      );
    }
    expect(
      await codec.encodeHqLiveV2SyncAsync(seed, FP, async () => {})
    ).toEqual(expected);
    const owned = await codec.encodeHqLiveV2SyncOwnedAsync(
      seed,
      FP,
      async () => {}
    );
    expect({ manifest: owned.manifest, chunks: owned.chunks }).toEqual(
      expected
    );
    expect(owned.candidate.state).toEqual(seed);
    expect(
      codec.decodeHqLiveV2Sync(
        expected.manifest,
        new Map(expected.chunks.map(c => [c.id, c.serialized])),
        FP
      )
    ).toEqual(seed);
  });
  it("malformed semantic state and forged capacity-looking text remain invalid", async () => {
    const invalid = { ...seed, version: 0 };
    for (const encode of [
      () => codec.encodeHqLiveV2Sync(invalid, FP),
      () => codec.encodeHqLiveV2SyncAsync(invalid, FP, async () => {}),
      () => codec.encodeHqLiveV2SyncOwnedAsync(invalid, FP, async () => {}),
    ]) {
      await expect(Promise.resolve().then(encode)).rejects.toThrow(
        /^HQ_V2_INVALID_STATE$/
      );
    }
    expect(
      codec.isHqLiveV2CapacityError(new Error("HQ_V2_CAPACITY_EXCEEDED"))
    ).toBe(false);
    const getter = { ...seed };
    Object.defineProperty(getter, "published", {
      enumerable: true,
      get() {
        throw new Error("HQ_V2_CAPACITY_EXCEEDED");
      },
    });
    expect(() => codec.encodeHqLiveV2Sync(getter, FP)).toThrow(
      /^HQ_V2_INVALID_STATE$/
    );
  });
  it("actual strict compact overflow is typed independently of expanded capacity", () => {
    const state = capacityState(220, 22, "\u0000");
    expect(codec.hqJsonUtf8Bytes(state)).toBeLessThan(
      codec.HQ_LIVE_V2_EXPANDED_BYTES
    );
    expect(codec.hqJsonUtf8Bytes(compact(state))).toBeGreaterThan(
      codec.HQ_LIVE_V2_COMPACT_BYTES
    );
    const error = capture(() => codec.encodeHqLiveV2Sync(state, FP));
    expect(error).toBeInstanceOf(codec.HqV2CapacityError);
    expect(error).toMatchObject({
      code: "HQ_V2_CAPACITY_EXCEEDED",
      dimension: "compact",
    });
  }, 120000);
  it("actual strict expanded overflow survives all three encoder wrappers", async () => {
    const state = capacityState(150, 220, "S");
    expect(codec.hqJsonUtf8Bytes(state)).toBeGreaterThan(
      codec.HQ_LIVE_V2_EXPANDED_BYTES
    );
    for (const encode of [
      () => codec.encodeHqLiveV2Sync(state, FP),
      () => codec.encodeHqLiveV2SyncAsync(state, FP, async () => {}),
      () => codec.encodeHqLiveV2SyncOwnedAsync(state, FP, async () => {}),
    ])
      await expect(Promise.resolve().then(encode)).rejects.toMatchObject({
        code: "HQ_V2_CAPACITY_EXCEEDED",
        dimension: "expanded",
      });
  }, 120000);
  it("actual physical partial-group refs can exceed 256 before either byte cap", () => {
    const state = capacityState(160, 196, "S");
    expect(codec.hqJsonUtf8Bytes(state)).toBeLessThan(
      codec.HQ_LIVE_V2_EXPANDED_BYTES
    );
    expect(codec.hqJsonUtf8Bytes(compact(state))).toBeLessThan(
      codec.HQ_LIVE_V2_COMPACT_BYTES
    );
    const error = capture(() => codec.encodeHqLiveV2Sync(state, FP));
    expect(error).toMatchObject({
      code: "HQ_V2_CAPACITY_EXCEEDED",
      dimension: "refs",
    });
  }, 120000);
  it("candidate preparation maps real capacity, keeps malformed invalid, and gives latched CPU denial precedence", async () => {
    const config = createHqLiveConfig({
      HQ_LIVE_SYNC_ENABLED: "true",
      HQ_LIVE_READ_ENABLED: "false",
      HQ_ORBIT_REPORTING_BASE_URL:
        "https://offline-synthetic.probe.tld/api/management-hq",
      HQ_ORBIT_REPORTING_API_KEY: "synthetic-key-" + "a".repeat(40),
      HQ_PORTAL_SYNC_TOKEN: "synthetic-token-" + "b".repeat(40),
    });
    const db = offlineHqV2Pool();
    const store = createHqLiveStore(db.pool, config);
    const acquired = await store.acquire();
    if (acquired.status !== "acquired")
      throw new Error("offline lease required");
    const sync = store.fencedSyncStore(acquired.lease);
    const huge = capacityState(150, 220, "S");
    await expect(sync.compareAndSwapSync(null, huge)).rejects.toMatchObject({
      code: "STATE_BYTE_CAP_EXCEEDED",
    });
    await expect(
      sync.compareAndSwapSync(null, {
        ...seed,
        published: { ...seed.published!, scope: "wrong" as never },
      })
    ).rejects.toMatchObject({ code: "INVALID_PERSISTED_STATE" });
    vi.spyOn(cooperation, "createHqCpuCheckpoint").mockImplementation(
      guard => async () => {
        await guard?.();
      }
    );
    const denied = createHqLiveStore(db.pool, config, {
      cooperativeGuard: async () => {
        throw new HqLiveError("AUTH_DENIED");
      },
    });
    await expect(
      denied.fencedSyncStore(acquired.lease).compareAndSwapSync(null, huge)
    ).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(db.rows.size).toBe(1);
  }, 120000);
});
