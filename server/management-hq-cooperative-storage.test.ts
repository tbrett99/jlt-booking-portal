import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createHqCpuCheckpoint } from "./management-hq-cooperative";
import { canonicalHqJson } from "./management-hq-engine";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  type HqImplementedSyncState,
} from "./management-hq-ingestion";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
import { createHqLargeSyntheticReader } from "./management-hq-large-fixtures";
import {
  decodeHqLiveV2Sync,
  decodeHqLiveV2SyncAsync,
  encodeHqLiveV2Sync,
  encodeHqLiveV2SyncAsync,
  hqJsonUtf8Bytes,
  hqJsonUtf8BytesAsync,
  HQ_LIVE_V2_ASYNC_VALIDATION_OPTIONS,
  HQ_LIVE_V2_CHUNK_BYTES,
  HQ_LIVE_V2_COMPACT_BYTES,
  HQ_LIVE_V2_EXPANDED_BYTES,
  validateHqV2Chunk,
  type HqV2Manifest,
} from "./management-hq-storage-v2";
const FP = "a".repeat(64);
const OTHER = "b".repeat(64);
const copy = <T>(value: T): T => structuredClone(value);
const digest = (raw: Buffer | string) =>
  createHash("sha256").update(raw).digest("hex");
type Encoded = ReturnType<typeof encodeHqLiveV2Sync>;
const map = (encoded: Encoded) =>
  new Map(encoded.chunks.map(c => [c.id, c.serialized]));
let seed: HqImplementedSyncState;
beforeAll(async () => {
  const store = createHqImplementedMemoryStore();
  expect(
    (
      await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        store
      ).backfill()
    ).status
  ).toBe("applied");
  seed = (await store.readSync())!;
});
function withStage(): HqImplementedSyncState {
  const state = copy(seed);
  state.version++;
  state.stage = {
    kind: "catchup",
    phase: "changes",
    basePublishedVersion: state.published!.version,
    metadata: copy(state.published!.metadata),
    cursor: "offline-working",
    pendingResumeCursor: "offline-next",
    entities: copy(state.published!.entities),
    seqProofs: {},
    feedKeys: { booking: [], business: [] },
    catalogueKeys: { booking: [], business: [] },
    cursors: [],
    pages: 1,
    recordsRead: 0,
    lastSeq: null,
  };
  return state;
}
function rawGroup(encoded: Encoded, index: number) {
  const chunks = map(encoded);
  return Buffer.concat(
    encoded.manifest.groups[index].chunks.map(ref =>
      validateHqV2Chunk(chunks.get(ref.id)!, ref, FP)
    )
  );
}
/** Rehash physical AND logical content. A decoder rejecting these cannot be
 * relying only on the manifest/chunk hashes instead of exact JSON/record checks. */
function replaceGroup(encoded: Encoded, index: number, raw: Buffer) {
  const result = { manifest: copy(encoded.manifest), chunks: map(encoded) };
  const group = result.manifest.groups[index];
  result.manifest.compactBytes += raw.length - group.byteCount;
  group.byteCount = raw.length;
  group.sha256 = digest(raw);
  group.chunks = [];
  for (let offset = 0; offset < raw.length; offset += HQ_LIVE_V2_CHUNK_BYTES) {
    const bytes = raw.subarray(offset, offset + HQ_LIVE_V2_CHUNK_BYTES);
    const sha256 = digest(bytes);
    const id = "live:company:orbit:v2:chunk:" + digest(FP + ":" + sha256);
    group.chunks.push({ id, sha256, byteCount: bytes.length });
    result.chunks.set(
      id,
      canonicalHqJson({
        format: "hq-live-sync-chunk-v2",
        sourceFingerprint: FP,
        sha256,
        byteCount: bytes.length,
        data: bytes.toString("base64"),
      })
    );
  }
  const expected = new Set(
    result.manifest.groups.flatMap(g => g.chunks.map(r => r.id))
  );
  for (const id of result.chunks.keys())
    if (!expected.has(id)) result.chunks.delete(id);
  try {
    const logical = copy(result.manifest.sync) as Record<string, any>;
    const expanded = copy(result.manifest.sync) as Record<string, any>;
    for (const part of ["published", "stage"] as const)
      if (logical[part]) {
        logical[part].entities = {};
        expanded[part].entities = {};
      }
    for (const current of result.manifest.groups) {
      const bytes = Buffer.concat(
        current.chunks.map(ref =>
          validateHqV2Chunk(result.chunks.get(ref.id)!, ref, FP)
        )
      );
      const value = JSON.parse(bytes.toString("utf8"));
      if (current.kind === "aux") {
        Object.assign(logical[current.part], value);
        Object.assign(expanded[current.part], value);
      } else {
        Object.assign(logical[current.part].entities, value);
        for (const [key, rec] of Object.entries(value)) {
          const record = rec as { canonicalPayload: string; absent: boolean };
          expanded[current.part].entities[key] = {
            ...record,
            entity: JSON.parse(record.canonicalPayload),
          };
        }
      }
    }
    result.manifest.sha256 = digest(canonicalHqJson(logical));
    result.manifest.expandedBytes = hqJsonUtf8Bytes(expanded);
  } catch {
    /* Deliberately malformed UTF-8/JSON keeps physical sums only. */
  }
  return result;
}
async function denied(manifest: HqV2Manifest, chunks: Map<string, string>) {
  expect(() => decodeHqLiveV2Sync(manifest, chunks, FP)).toThrow(
    /^HQ_V2_INVALID_STATE$/
  );
  await expect(
    decodeHqLiveV2SyncAsync(manifest, chunks, FP, createHqCpuCheckpoint())
  ).rejects.toThrow(/^HQ_V2_INVALID_STATE$/);
}

describe("cooperative exact UTF-8 measurement", () => {
  it.each([
    undefined,
    null,
    NaN,
    Infinity,
    -0,
    [undefined, Symbol("x"), () => 1],
    new Array(3),
    new Date("2026-01-01T00:00:00Z"),
    new Number(3),
    new String("é"),
    {
      toJSON() {
        return { z: "😀", a: 1 };
      },
    },
    {
      z: undefined,
      a: {
        toJSON() {
          return undefined;
        },
      },
      b: [undefined],
    },
    "a".repeat(8191) + "😀" + "\ud800\udfff" + '"\\\n\u0000英語'.repeat(9000),
  ])("retains legacy JSON.stringify rules %#", async value => {
    expect(
      await hqJsonUtf8BytesAsync(
        value,
        Number.MAX_SAFE_INTEGER,
        createHqCpuCheckpoint()
      )
    ).toBe(hqJsonUtf8Bytes(value));
  });
  it("retains exact caps, safe errors, cycles, bigint and depth", async () => {
    const value = { text: "😀".repeat(9000) + "\ud800" };
    const bytes = hqJsonUtf8Bytes(value);
    expect(
      await hqJsonUtf8BytesAsync(value, bytes, createHqCpuCheckpoint())
    ).toBe(bytes);
    await expect(
      hqJsonUtf8BytesAsync(value, bytes - 1, createHqCpuCheckpoint())
    ).rejects.toThrow(/^HQ_V2_JSON_BYTE_CAP_EXCEEDED$/);
    const cycle: any = {};
    cycle.secret = cycle;
    let deep: unknown = 1;
    for (let i = 0; i < 258; i++) deep = [deep];
    for (const invalid of [
      cycle,
      deep,
      BigInt(1),
      {
        toJSON() {
          throw new Error("SECRET-PAYLOAD");
        },
      },
    ])
      await expect(
        hqJsonUtf8BytesAsync(invalid, bytes, createHqCpuCheckpoint())
      ).rejects.toThrow(/^HQ_V2_INVALID_JSON$/);
    for (const cap of [-1, 0.5, NaN, Infinity])
      await expect(
        hqJsonUtf8BytesAsync(null, cap, createHqCpuCheckpoint())
      ).rejects.toThrow(/^HQ_V2_INVALID_JSON$/);
    const capBeforeInvalidChild = { a: "prefix", z: BigInt(1) };
    expect(() => hqJsonUtf8Bytes(capBeforeInvalidChild, 1)).toThrow(
      /^HQ_V2_JSON_BYTE_CAP_EXCEEDED$/
    );
    await expect(
      hqJsonUtf8BytesAsync(capBeforeInvalidChild, 1, createHqCpuCheckpoint())
    ).rejects.toThrow(/^HQ_V2_JSON_BYTE_CAP_EXCEEDED$/);
    expect(Object.isFrozen(HQ_LIVE_V2_ASYNC_VALIDATION_OPTIONS)).toBe(true);
  });
});

describe("cooperative exact-byte storage", () => {
  it("matches sync manifest and serialized chunks including Unicode/escapes/large extensions and both parts", async () => {
    const state = withStage();
    for (const part of [state.published!, state.stage!]) {
      Object.assign(part.metadata!, {
        offlineExtension: {
          text: "英語 😀 \ud800 \udfff",
          flags: [false, null],
        },
      });
      const record = Object.values(part.entities)[0];
      Object.assign(record.entity.payload, {
        offlineExtension: Array(150).fill('英語😀\ud800"\\\n'.repeat(100)),
      });
      record.canonicalPayload = canonicalHqJson(record.entity);
      record.absent = true;
    }
    const old = encodeHqLiveV2Sync(state, FP);
    const actual = await encodeHqLiveV2SyncAsync(
      state,
      FP,
      createHqCpuCheckpoint()
    );
    expect(actual).toEqual(old);
    expect(actual.chunks.map(c => c.serialized)).toEqual(
      old.chunks.map(c => c.serialized)
    );
    const restored = await decodeHqLiveV2SyncAsync(
      actual.manifest,
      map(actual),
      FP,
      createHqCpuCheckpoint()
    );
    expect(restored).toEqual(state);
    const key = Object.keys(state.published!.entities)[0];
    expect(restored.stage!.entities[key].entity).not.toBe(
      restored.published!.entities[key].entity
    );
    expect(restored.published!.metadata).not.toBe(
      actual.manifest.sync.published!.metadata
    );
  });
  it("matches null parts and initial skeleton exactly", async () => {
    const initial = withStage();
    Object.assign(initial.stage!, {
      kind: "backfill",
      phase: "bookings",
      metadata: null,
      cursor: null,
      pendingResumeCursor: null,
      pages: 0,
    });
    for (const state of [
      { version: 1, published: null, stage: null },
      initial,
      withStage(),
    ] as HqImplementedSyncState[]) {
      const old = encodeHqLiveV2Sync(state, FP);
      expect(
        await encodeHqLiveV2SyncAsync(state, FP, createHqCpuCheckpoint())
      ).toEqual(old);
      expect(
        await decodeHqLiveV2SyncAsync(
          old.manifest,
          map(old),
          FP,
          createHqCpuCheckpoint()
        )
      ).toEqual(state);
    }
  });
  it.each([
    "canonical",
    "key",
    "absent",
    "extra",
    "hidden",
    "getter",
    "array-extra",
    "undefined",
    "symbol",
    "cycle",
  ])("rejects original input %s exactly like sync", async damage => {
    const state = copy(seed);
    const key = Object.keys(state.published!.entities)[0];
    const record = state.published!.entities[key];
    if (damage === "canonical")
      record.canonicalPayload = " " + record.canonicalPayload;
    if (damage === "key") {
      state.published!.entities["booking:999"] = record;
      delete state.published!.entities[key];
    }
    if (damage === "absent") record.absent = "secret" as never;
    if (damage === "extra") Object.assign(record, { extra: "SECRET-PAYLOAD" });
    if (damage === "hidden")
      Object.defineProperty(state.published!.metadata, "hidden", {
        value: "secret",
      });
    if (damage === "getter")
      Object.defineProperty(state.published!.metadata, "getter", {
        enumerable: true,
        get() {
          throw new Error("secret");
        },
      });
    if (damage === "array-extra")
      Object.assign(state.published!.metadata, {
        extension: Object.assign([1], { extra: 2 }),
      });
    if (damage === "undefined")
      Object.assign(record.entity.payload, { extra: undefined });
    if (damage === "symbol")
      Object.assign(record.entity.payload, { [Symbol("secret")]: "secret" });
    if (damage === "cycle")
      Object.assign(record.entity.payload, { extra: record.entity.payload });
    expect(() => encodeHqLiveV2Sync(state, FP)).toThrow(
      /^HQ_V2_INVALID_STATE$/
    );
    await expect(
      encodeHqLiveV2SyncAsync(state, FP, createHqCpuCheckpoint())
    ).rejects.toThrow(/^HQ_V2_INVALID_STATE$/);
  });
});

describe("cooperative fail-closed reconstruction", () => {
  const mutations: [string, (m: HqV2Manifest) => void][] = [
    ["field", m => Object.assign(m, { extra: "secret" })],
    ["format", m => (m.format = "wrong" as never)],
    ["codec", m => (m.codec = "wrong" as never)],
    ["source", m => (m.sourceFingerprint = OTHER)],
    ["version", m => m.syncVersion++],
    ["root-version", m => m.sync.version++],
    ["compact-cap", m => (m.compactBytes = HQ_LIVE_V2_COMPACT_BYTES + 1)],
    ["expanded-cap", m => (m.expandedBytes = HQ_LIVE_V2_EXPANDED_BYTES + 1)],
    ["compact-count", m => m.compactBytes++],
    ["expanded-count", m => m.expandedBytes++],
    ["full-hash", m => (m.sha256 = OTHER)],
    ["metadata", m => (m.sync.published!.metadata.scope = "wrong" as never)],
    ["skeleton", m => Object.assign(m.sync.published!, { entities: {} })],
    ["part", m => (m.groups[0].part = "wrong" as never)],
    ["kind", m => (m.groups[0].kind = "wrong" as never)],
    ["bucket", m => (m.groups[0].bucket = 16)],
    ["bucket-fraction", m => (m.groups[0].bucket = 0.5)],
    ["order", m => m.groups.reverse()],
    ["duplicate-group", m => m.groups.splice(1, 0, copy(m.groups[0]))],
    ["aux", m => m.groups.pop()],
    ["group-hash", m => (m.groups[0].sha256 = OTHER)],
    ["group-size", m => m.groups[0].byteCount++],
    ["chunk-size", m => m.groups[0].chunks[0].byteCount++],
    ["chunk-id", m => (m.groups[0].chunks[0].id = "foreign:secret")],
    ["chunk-hash", m => (m.groups[0].chunks[0].sha256 = OTHER)],
    ["chunk-field", m => Object.assign(m.groups[0].chunks[0], { index: 1 })],
    ["empty-refs", m => (m.groups[0].chunks = [])],
    [
      "too-many-refs",
      m => (m.groups[0].chunks = Array(257).fill(m.groups[0].chunks[0])),
    ],
  ];
  it.each(mutations)("denies manifest %s", async (_name, mutate) => {
    const encoded = encodeHqLiveV2Sync(seed, FP);
    const manifest = copy(encoded.manifest);
    mutate(manifest);
    await denied(manifest, map(encoded));
  });
  it.each([
    "missing",
    "extra",
    "field",
    "format",
    "binding",
    "hash",
    "count",
    "data",
    "padding",
    "duplicate-key",
    "pad-bits",
  ])("denies chunk %s", async damage => {
    const encoded = encodeHqLiveV2Sync(seed, FP);
    const chunks = map(encoded);
    const ref = encoded.manifest.groups[0].chunks[0];
    const original = chunks.get(ref.id)!;
    const env = JSON.parse(original);
    if (damage === "missing") chunks.delete(ref.id);
    else if (damage === "extra") chunks.set("foreign", "secret");
    else {
      if (damage === "field") env.extra = "secret";
      if (damage === "format") env.format = "wrong";
      if (damage === "binding") env.sourceFingerprint = OTHER;
      if (damage === "hash") env.sha256 = OTHER;
      if (damage === "count") env.byteCount++;
      if (damage === "data") env.data = "!" + env.data.slice(1);
      if (damage === "padding") env.data += "===";
      if (damage === "pad-bits") env.data = "YR==";
      chunks.set(
        ref.id,
        damage === "duplicate-key"
          ? original.replace("{", '{"format":"hq-live-sync-chunk-v2",')
          : canonicalHqJson(env)
      );
    }
    await denied(encoded.manifest, chunks);
  });
  it.each([
    "whitespace",
    "key-order",
    "duplicate-key",
    "canonical-payload",
    "record-extra",
    "absent",
    "wrong-key",
    "wrong-bucket",
    "owner",
    "invalid-utf8",
    "bom",
    "aux-extra",
  ])("denies fully rehashed %s, not just hash conflicts", async damage => {
    const encoded = encodeHqLiveV2Sync(seed, FP);
    const index =
      damage === "aux-extra" ? encoded.manifest.groups.length - 1 : 0;
    let raw = rawGroup(encoded, index);
    const value = JSON.parse(raw.toString("utf8"));
    const key = Object.keys(value)[0];
    const record = value[key];
    if (damage === "whitespace") raw = Buffer.concat([Buffer.from(" "), raw]);
    if (damage === "key-order") {
      value[key] = {
        canonicalPayload: record.canonicalPayload,
        absent: record.absent,
      };
      raw = Buffer.from(JSON.stringify(value));
    }
    if (damage === "duplicate-key")
      raw = Buffer.from(raw.toString().replace("{", '{"secret":0,"secret":1,'));
    if (damage === "canonical-payload") {
      record.canonicalPayload = " " + record.canonicalPayload;
      raw = Buffer.from(canonicalHqJson(value));
    }
    if (damage === "record-extra") {
      record.extra = "secret";
      raw = Buffer.from(canonicalHqJson(value));
    }
    if (damage === "absent") {
      record.absent = null;
      raw = Buffer.from(canonicalHqJson(value));
    }
    if (damage === "wrong-key") {
      value["booking:999"] = record;
      delete value[key];
      raw = Buffer.from(canonicalHqJson(value));
    }
    if (damage === "wrong-bucket") {
      const entity = JSON.parse(record.canonicalPayload);
      entity.entityId++;
      if (entity.entityType === "booking")
        entity.payload.orbitBookingId = entity.entityId;
      else entity.payload.orbitTenantId = entity.entityId;
      record.canonicalPayload = canonicalHqJson(entity);
      value[`${entity.entityType}:${entity.entityId}`] = record;
      delete value[key];
      raw = Buffer.from(canonicalHqJson(value));
    }
    if (damage === "owner") {
      const entity = JSON.parse(record.canonicalPayload);
      entity.payload.identity.orbitTenantId = 999;
      record.canonicalPayload = canonicalHqJson(entity);
      raw = Buffer.from(canonicalHqJson(value));
    }
    if (damage === "invalid-utf8")
      raw = Buffer.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x3a, 0x30, 0x7d]);
    if (damage === "bom")
      raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), raw]);
    if (damage === "aux-extra") {
      value.extra = "secret";
      raw = Buffer.from(canonicalHqJson(value));
    }
    const changed = replaceGroup(encoded, index, raw);
    await denied(changed.manifest, changed.chunks);
  });
  it("accepts reordered whitespace database wrappers while retaining exact decoded state", async () => {
    const encoded = encodeHqLiveV2Sync(seed, FP);
    const chunks = map(encoded);
    for (const [id, text] of chunks)
      chunks.set(
        id,
        JSON.stringify(
          Object.fromEntries(Object.entries(JSON.parse(text)).reverse()),
          null,
          2
        )
      );
    expect(
      await decodeHqLiveV2SyncAsync(
        encoded.manifest,
        chunks,
        FP,
        createHqCpuCheckpoint()
      )
    ).toEqual(seed);
  });
});

describe("cooperative interruption and real event-loop handoff", () => {
  it("guards only genuine macrotasks and permanently latches observed failure", async () => {
    let heartbeat = false;
    const guard = vi.fn(async () => {});
    const checkpoint = createHqCpuCheckpoint(guard);
    const timer = setImmediate(() => {
      heartbeat = true;
    });
    const until = performance.now() + 9;
    while (performance.now() < until) {
      /* Force the primary time budget. */
    }
    await checkpoint();
    expect(heartbeat).toBe(true);
    expect(guard).toHaveBeenCalledTimes(2);
    clearImmediate(timer);
    const denial = new Error("AUTHORITY_REVOKED");
    let allow = false;
    const gated = createHqCpuCheckpoint(async () => {
      if (!allow) throw denial;
    });
    await expect(
      (async () => {
        for (let i = 0; i < 8192; i++) await gated();
      })()
    ).rejects.toBe(denial);
    allow = true;
    await expect(gated()).rejects.toBe(denial);
  });
  it.each(["encode", "decode"] as const)(
    "interrupts %s without exposing a partial result or changing inputs",
    async operation => {
      const state = withStage();
      const before = copy(state);
      const encoded = encodeHqLiveV2Sync(state, FP);
      const manifest = copy(encoded.manifest);
      const chunks = map(encoded);
      let calls = 0;
      let outcome: unknown;
      const checkpoint = async () => {
        if (++calls === 40) throw new Error("SECRET-DENIAL");
      };
      const pending =
        operation === "encode"
          ? encodeHqLiveV2SyncAsync(state, FP, checkpoint)
          : decodeHqLiveV2SyncAsync(manifest, chunks, FP, checkpoint);
      await expect(
        pending.then(value => {
          outcome = value;
        })
      ).rejects.toThrow(/^HQ_V2_INVALID_STATE$/);
      expect(calls).toBe(40);
      expect(outcome).toBeUndefined();
      expect(state).toEqual(before);
      expect(manifest).toEqual(encoded.manifest);
      expect(chunks).toEqual(map(encoded));
    }
  );
  it("demonstrates timer heartbeat during exact encode/decode of 4,000 retained synthetic records", async () => {
    // Fixture construction is outside the timed CPU phases. No engine/DB/provider is started.
    const reader = createHqLargeSyntheticReader({
      bookingCount: 4000,
      paddingBytes: 1024,
    });
    const { ready: _ready, ...metadata } = await reader.status();
    const state: HqImplementedSyncState = {
      version: 1,
      stage: null,
      published: {
        wireVersion: "1.0.0",
        version: 1,
        scope: metadata.scope,
        resumeCursor: "offline",
        metadata,
        entities: {},
        seqProofs: {},
      },
    };
    let cursor: string | undefined;
    do {
      const page = await reader.bookings(cursor ? { cursor } : undefined);
      state.published!.resumeCursor = page.resumeCursor;
      for (const entity of page.items)
        state.published!.entities[`booking:${entity.entityId}`] = {
          entity,
          canonicalPayload: canonicalHqJson(entity),
          absent: false,
        };
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(Object.keys(state.published!.entities)).toHaveLength(4000);
    const expected = encodeHqLiveV2Sync(state, FP);
    const metrics: Record<string, unknown> = {};
    async function timed<T>(
      phase: string,
      run: (checkpoint: () => Promise<void>) => Promise<T>
    ): Promise<T> {
      let ticks = 0;
      let maxGap = 0;
      let last = performance.now();
      let maxSegment = 0;
      let guardCalls = 0;
      let maxNativeParseMs = 0;
      let maxNativeParseUnits = 0;
      const nativeParse = JSON.parse;
      JSON.parse = ((
        text: string,
        reviver?: Parameters<typeof JSON.parse>[1]
      ) => {
        const started = performance.now();
        try {
          return nativeParse(text, reviver);
        } finally {
          maxNativeParseMs = Math.max(
            maxNativeParseMs,
            performance.now() - started
          );
          maxNativeParseUnits = Math.max(maxNativeParseUnits, text.length);
        }
      }) as typeof JSON.parse;
      const timer = setInterval(() => {
        const now = performance.now();
        maxGap = Math.max(maxGap, now - last);
        last = now;
        ticks++;
      }, 1);
      const bounded = createHqCpuCheckpoint(async () => {
        guardCalls++;
      });
      let callTime = performance.now();
      const checkpoint = async () => {
        const now = performance.now();
        maxSegment = Math.max(maxSegment, now - callTime);
        await bounded();
        callTime = performance.now();
      };
      const started = performance.now();
      try {
        const result = await run(checkpoint);
        metrics[phase] = {
          elapsedMs: performance.now() - started,
          ticks,
          maxHeartbeatGapMs: maxGap,
          maxBetweenCheckpointMs: maxSegment,
          guardCalls,
          maxNativeParseMs,
          maxNativeParseUnits,
        };
        expect(ticks).toBeGreaterThan(5);
        return result;
      } finally {
        clearInterval(timer);
        JSON.parse = nativeParse;
      }
    }
    const encoded = await timed("encode", checkpoint =>
      encodeHqLiveV2SyncAsync(state, FP, checkpoint)
    );
    expect(encoded).toEqual(expected);
    expect(
      await timed("decode", checkpoint =>
        decodeHqLiveV2SyncAsync(encoded.manifest, map(encoded), FP, checkpoint)
      )
    ).toEqual(state);
    console.info(
      "HQ_OFFLINE_COOPERATIVE_4000",
      JSON.stringify({
        expandedBytes: encoded.manifest.expandedBytes,
        maxGroupBytes: Math.max(
          ...encoded.manifest.groups.map(g => g.byteCount)
        ),
        ...metrics,
      })
    );
  }, 60000);
});
