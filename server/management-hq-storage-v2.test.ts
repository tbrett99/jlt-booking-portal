import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalHqJson } from "./management-hq-engine";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  type HqImplementedSyncState,
} from "./management-hq-ingestion";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
import { createHqLargeSyntheticReader } from "./management-hq-large-fixtures";
import {
  HQ_LIVE_V2_COMPACT_BYTES,
  HQ_LIVE_V2_EXPANDED_BYTES,
  HQ_LIVE_V2_CHUNK_BYTES,
  HQ_LIVE_V2_CHUNK_ROW_BYTES,
  HQ_LIVE_V2_ROOT_BYTES,
  HQ_LIVE_V2_MAX_REFS,
  HQ_LIVE_V2_VALIDATION_OPTIONS,
  encodeHqLiveV2Sync,
  decodeHqLiveV2Sync,
  validateHqV2Manifest,
  validateHqV2Chunk,
  manifestChunkRefs,
  hqJsonUtf8Bytes,
  type HqV2Manifest,
  type HqV2ChunkRef,
} from "./management-hq-storage-v2";
const FP = "a".repeat(64);
const OTHER_FP = "b".repeat(64);
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const digest = (raw: Buffer | string) =>
  createHash("sha256").update(raw).digest("hex");
const idFor = (hash: string, fp = FP) =>
  "live:company:orbit:v2:chunk:" + digest(fp + ":" + hash);
const map = (encoded: ReturnType<typeof encodeHqLiveV2Sync>) =>
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
    cursor: "resume-working",
    pendingResumeCursor: "resume-next",
    entities: copy(state.published!.entities),
    seqProofs: {},
    feedKeys: { booking: [], business: [] },
    catalogueKeys: { booking: [], business: [] },
    cursors: ["changes:cursor-one"],
    pages: 1,
    recordsRead: 0,
    lastSeq: null,
  };
  return state;
}
function replaceGroup(
  encoded: ReturnType<typeof encodeHqLiveV2Sync>,
  index: number,
  raw: Buffer
) {
  const result = { manifest: copy(encoded.manifest), chunks: map(encoded) };
  const group = result.manifest.groups[index];
  group.byteCount = raw.length;
  group.sha256 = digest(raw);
  group.chunks = [];
  for (let offset = 0; offset < raw.length; offset += HQ_LIVE_V2_CHUNK_BYTES) {
    const bytes = raw.subarray(offset, offset + HQ_LIVE_V2_CHUNK_BYTES);
    const sha256 = digest(bytes),
      id = idFor(sha256);
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
  const originalBytes = encoded.manifest.groups[index].byteCount;
  result.manifest.compactBytes += raw.length - originalBytes;
  const logical: Record<string, unknown> = copy(result.manifest.sync);
  const expanded: Record<string, unknown> = copy(result.manifest.sync);
  try {
    for (const part of ["published", "stage"] as const) {
      if (logical[part] !== null) {
        (logical[part] as Record<string, unknown>).entities = {};
        (expanded[part] as Record<string, unknown>).entities = {};
      }
    }
    for (const current of result.manifest.groups) {
      const bytes = Buffer.concat(
        current.chunks.map(ref =>
          validateHqV2Chunk(result.chunks.get(ref.id)!, ref, FP)
        )
      );
      const value = JSON.parse(bytes.toString("utf8"));
      const part = logical[current.part] as Record<string, unknown>;
      const restored = expanded[current.part] as Record<string, unknown>;
      if (current.kind === "aux") {
        Object.assign(part, value);
        Object.assign(restored, value);
      } else {
        Object.assign(part.entities as object, value);
        for (const [key, rec] of Object.entries(value)) {
          const record = rec as { canonicalPayload: string; absent: boolean };
          (restored.entities as Record<string, unknown>)[key] = {
            ...record,
            entity: JSON.parse(record.canonicalPayload),
          };
        }
      }
    }
    result.manifest.sha256 = digest(canonicalHqJson(logical));
    result.manifest.expandedBytes = hqJsonUtf8Bytes(expanded);
  } catch {
    /* Invalid UTF-8/JSON still receives correct physical byte sums. */
  }
  validateHqV2Manifest(result.manifest, result.manifest.syncVersion, FP);
  return result;
}
function rawGroup(
  encoded: ReturnType<typeof encodeHqLiveV2Sync>,
  index: number
) {
  const chunks = map(encoded);
  return Buffer.concat(
    encoded.manifest.groups[index].chunks.map(ref =>
      validateHqV2Chunk(chunks.get(ref.id)!, ref, FP)
    )
  );
}

describe("streaming exact UTF-8 JSON measurement", () => {
  it.each([
    null,
    true,
    false,
    0,
    -0,
    1e30,
    NaN,
    Infinity,
    'plain " \\ \b\t\n\f\r\u0000 英語 😀 \ud800 \udfff',
    [undefined, () => 1, Symbol("no"), "😀"],
    { z: undefined, b: "英語", a: [1, 2], f: () => 1 },
    new Date("2026-01-01T00:00:00Z"),
    new Number(3),
    new String("é"),
    {
      toJSON() {
        return { z: "😀", a: 1 };
      },
    },
    {
      omitted: {
        toJSON() {
          return undefined;
        },
      },
      retained: [undefined],
    },
    {
      box: {
        toJSON() {
          return new Number(3);
        },
      },
    },
  ])("matches JSON.stringify byte count for %#", value => {
    expect(hqJsonUtf8Bytes(value)).toBe(
      Buffer.byteLength(JSON.stringify(value))
    );
  });
  it("handles root undefined, sparse arrays and bounded streaming strings", () => {
    expect(hqJsonUtf8Bytes(undefined)).toBe(0);
    expect(hqJsonUtf8Bytes(new Array(3))).toBe(16);
    const text = "😀".repeat(9000) + "\ud800" + '"\\'.repeat(9000);
    expect(hqJsonUtf8Bytes(text)).toBe(Buffer.byteLength(JSON.stringify(text)));
    const bytes = hqJsonUtf8Bytes({ text });
    expect(hqJsonUtf8Bytes({ text }, bytes)).toBe(bytes);
    expect(() => hqJsonUtf8Bytes({ text }, bytes - 1)).toThrow(
      "HQ_V2_JSON_BYTE_CAP_EXCEEDED"
    );
  });
  it.each([
    "a".repeat(8191) + "😀" + "b",
    "a".repeat(8191) + "\ud800" + "b",
    "a".repeat(8191) + "\udfff" + "b",
    "a".repeat(8191) + '"\\\n\t\u0000' + "😀",
    "a".repeat(8190) + "😀" + "\ud800\udfff",
    "a".repeat(8191) + "😀".repeat(9000),
  ])(
    "preserves exact native JSON bytes at bounded escape/surrogate boundary %#",
    text => {
      const bytes = Buffer.byteLength(JSON.stringify({ text }));
      expect(hqJsonUtf8Bytes({ text }, bytes)).toBe(bytes);
      expect(() => hqJsonUtf8Bytes({ text }, bytes - 1)).toThrow(
        "HQ_V2_JSON_BYTE_CAP_EXCEEDED"
      );
    }
  );
  it("never stringifies a full object or a giant string", () => {
    const value = {
      canonicalPayload: "😀".repeat(200000),
      nested: { z: 2, a: 1 },
    };
    const expected = Buffer.byteLength(JSON.stringify(value));
    const original = JSON.stringify;
    JSON.stringify = ((input: unknown, ...args: unknown[]) => {
      if (
        typeof input === "object" ||
        (typeof input === "string" && input.length > 8192)
      )
        throw new Error("full-stringify forbidden");
      return original(input, ...(args as []));
    }) as typeof JSON.stringify;
    try {
      expect(hqJsonUtf8Bytes(value)).toBe(expected);
    } finally {
      JSON.stringify = original;
    }
  });
  it("rejects cycles, bigints, excessive depth, invalid caps without payloads", () => {
    const cycle: Record<string, unknown> = {};
    cycle.secret = cycle;
    for (const value of [
      cycle,
      BigInt(1),
      {
        toJSON() {
          throw new Error("SECRET-PAYLOAD");
        },
      },
      {
        toJSON() {
          throw new Error("HQ_V2_JSON_BYTE_CAP_EXCEEDED");
        },
      },
    ])
      expect(() => hqJsonUtf8Bytes(value)).toThrow(/^HQ_V2_INVALID_JSON$/);
    for (const maximum of [-1, 0.5, NaN, Infinity])
      expect(() => hqJsonUtf8Bytes(null, maximum)).toThrow(
        /^HQ_V2_INVALID_JSON$/
      );
    let deep: unknown = 1;
    for (let i = 0; i < 258; i++) deep = [deep];
    expect(() => hqJsonUtf8Bytes(deep)).toThrow(/^HQ_V2_INVALID_JSON$/);
  });
});

describe("offline exact storage codec", () => {
  it("exports the explicit profile and frozen streaming live options (actual production capacity unknown)", () => {
    expect([
      HQ_LIVE_V2_COMPACT_BYTES,
      HQ_LIVE_V2_EXPANDED_BYTES,
      HQ_LIVE_V2_CHUNK_BYTES,
      HQ_LIVE_V2_CHUNK_ROW_BYTES,
      HQ_LIVE_V2_ROOT_BYTES,
      HQ_LIVE_V2_MAX_REFS,
    ]).toEqual([
      64 * 1024 * 1024,
      128 * 1024 * 1024,
      512 * 1024,
      1024 * 1024,
      16 * 1024 * 1024,
      256,
    ]);
    expect(Object.isFrozen(HQ_LIVE_V2_VALIDATION_OPTIONS)).toBe(true);
    expect(HQ_LIVE_V2_VALIDATION_OPTIONS).toEqual({
      maxStateBytes: HQ_LIVE_V2_EXPANDED_BYTES,
      measureStateBytes: hqJsonUtf8Bytes,
    });
  });
  it("roundtrips exact Unicode, escapes, raw extensions, absent markers, tombstones, proofs and all progress", () => {
    const state = withStage();
    const keys = Object.keys(state.stage!.entities);
    const record = state.stage!.entities[keys[0]];
    Object.assign(state.stage!.metadata!, {
      syntheticRawStatus: { flags: [false, "unknown", null] },
    });
    Object.assign(record.entity.payload, {
      syntheticExtension: {
        z: ["英語 😀", '"\\\n\ud800', null, 0, false],
        a: { sourceUnknown: "retained" },
      },
    });
    record.canonicalPayload = canonicalHqJson(record.entity);
    record.absent = true;
    const other = state.stage!.entities[keys[1]];
    other.entity.payload = {
      deleted: true,
      entityType: other.entity.entityType,
      entityId: other.entity.entityId,
      reason: "source_absent_or_now_explicit_demo",
    };
    other.canonicalPayload = canonicalHqJson(other.entity);
    state.stage!.metadata!.changeUpper = Math.max(
      1,
      state.stage!.metadata!.changeUpper
    );
    state.stage!.seqProofs["1"] = "c".repeat(64);
    state.stage!.lastSeq = 1;
    state.stage!.feedKeys.booking = keys.filter(k => k.startsWith("booking:"));
    state.stage!.catalogueKeys.booking = [
      ...state.stage!.feedKeys.booking,
    ].reverse();
    const encoded = encodeHqLiveV2Sync(state, FP);
    const restored = decodeHqLiveV2Sync(encoded.manifest, map(encoded), FP);
    expect(restored).toEqual(state);
    expect(restored.stage!.entities[keys[0]]).not.toBe(
      restored.published!.entities[keys[0]]
    );
    expect(restored.stage!.entities[keys[0]].entity).not.toBe(
      restored.published!.entities[keys[0]].entity
    );
    expect(encoded.manifest.expandedBytes).toBe(
      Buffer.byteLength(canonicalHqJson(state))
    );
    const compact = copy(state);
    for (const part of [compact.published, compact.stage])
      if (part)
        for (const record of Object.values(part.entities))
          delete (record as Partial<typeof record>).entity;
    expect(encoded.manifest.compactBytes).toBe(
      Buffer.byteLength(canonicalHqJson(compact))
    );
    expect(encoded.manifest.sha256).toBe(digest(canonicalHqJson(compact)));
  });
  it("preserves null parts and initial backfill skeleton", () => {
    for (const state of [
      { version: 1, published: null, stage: null },
      {
        version: 1,
        published: null,
        stage: {
          kind: "backfill",
          phase: "bookings",
          basePublishedVersion: null,
          metadata: null,
          cursor: null,
          pendingResumeCursor: null,
          entities: {},
          seqProofs: {},
          feedKeys: { booking: [], business: [] },
          catalogueKeys: { booking: [], business: [] },
          cursors: [],
          pages: 0,
          recordsRead: 0,
          lastSeq: null,
        },
      },
    ] as HqImplementedSyncState[]) {
      const encoded = encodeHqLiveV2Sync(state, FP);
      expect(decodeHqLiveV2Sync(encoded.manifest, map(encoded), FP)).toEqual(
        state
      );
    }
  });
  it("is deterministic, omits empty stable buckets, and reuses exact shared references", () => {
    const state = withStage();
    const a = encodeHqLiveV2Sync(state, FP),
      b = encodeHqLiveV2Sync(copy(state), FP);
    expect(a).toEqual(b);
    expect(
      a.manifest.groups
        .filter(g => g.kind === "entities")
        .every(g => g.bucket! >= 0 && g.bucket! < 16)
    ).toBe(true);
    expect(manifestChunkRefs(a.manifest).length).toBe(a.chunks.length);
    expect(a.manifest.groups.flatMap(g => g.chunks).length).toBeGreaterThan(
      a.chunks.length
    );
    expect(new Set(a.chunks.map(c => c.id)).size).toBe(a.chunks.length);
    expect(
      a.chunks.every(
        c => Buffer.byteLength(c.serialized) < HQ_LIVE_V2_CHUNK_ROW_BYTES
      )
    ).toBe(true);
  });
  it.each([
    "payload",
    "canonical",
    "key",
    "absent",
    "record-extra",
    "extension-undefined",
  ])("denies original state %s conflicts rather than recomputing", damage => {
    const state = copy(seed),
      key = Object.keys(state.published!.entities)[0],
      record = state.published!.entities[key];
    if (damage === "payload")
      (
        record.entity.payload as unknown as Record<string, unknown>
      ).rawNewExtension = "SECRET-PAYLOAD";
    if (damage === "canonical")
      record.canonicalPayload = " " + record.canonicalPayload;
    if (damage === "key") {
      state.published!.entities["booking:999"] = record;
      delete state.published!.entities[key];
    }
    if (damage === "absent")
      (record as unknown as Record<string, unknown>).absent = "SECRET-PAYLOAD";
    if (damage === "record-extra")
      (record as unknown as Record<string, unknown>).extra = "SECRET-PAYLOAD";
    if (damage === "extension-undefined") {
      (
        record.entity.payload as unknown as Record<string, unknown>
      ).rawExtension = undefined;
      record.canonicalPayload = canonicalHqJson(record.entity);
    }
    expect(() => encodeHqLiveV2Sync(state, FP)).toThrow(
      /^HQ_V2_INVALID_STATE$/
    );
  });
  it("does not silently drop hidden or getter-based metadata and container extensions", () => {
    for (const target of ["container", "metadata", "getter", "array-extra"]) {
      const state = copy(seed);
      if (target === "container")
        Object.defineProperty(state, "secret", { value: "SECRET-PAYLOAD" });
      if (target === "metadata")
        Object.defineProperty(state.published!.metadata, "secret", {
          value: "SECRET-PAYLOAD",
        });
      if (target === "getter")
        Object.defineProperty(state.published!.metadata, "secret", {
          enumerable: true,
          get() {
            throw new Error("SECRET-PAYLOAD");
          },
        });
      if (target === "array-extra") {
        const extension = ["retained"];
        Object.assign(extension, { extra: "SECRET-PAYLOAD" });
        Object.assign(state.published!.metadata, {
          syntheticExtension: extension,
        });
      }
      expect(() => encodeHqLiveV2Sync(state, FP)).toThrow(
        /^HQ_V2_INVALID_STATE$/
      );
    }
  });
  it("retains original same-revision conflict semantics after decoding", async () => {
    const encoded = encodeHqLiveV2Sync(seed, FP);
    const store = createHqImplementedMemoryStore(
      decodeHqLiveV2Sync(encoded.manifest, map(encoded), FP)
    );
    const reader = createHqImplementedSampleReader("amended");
    const page = await reader.changes(seed.published!.resumeCursor);
    const change = copy(page.items[0]);
    change.revision =
      seed.published!.entities[
        `${change.entityType}:${change.entityId}`
      ].entity.revision;
    const result = await createHqImplementedEngine(
      { ...reader, changes: async () => ({ ...copy(page), items: [change] }) },
      store
    ).catchup();
    expect(result).toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await store.readSync())!.published).toEqual(seed.published);
  });
  it("retains sequence proofs for exact historical replay and denies same-seq changed extensions", async () => {
    const reader = createHqImplementedSampleReader("amended");
    const page = await reader.changes(seed.published!.resumeCursor);
    const store = createHqImplementedMemoryStore(copy(seed));
    expect(
      (await createHqImplementedEngine(reader, store).catchup()).status
    ).toBe("applied");
    const state = (await store.readSync())!;
    const encoded = encodeHqLiveV2Sync(state, FP);
    const restored = createHqImplementedMemoryStore(
      decodeHqLiveV2Sync(encoded.manifest, map(encoded), FP)
    );
    const replayReader = { ...reader, changes: async () => copy(page) };
    expect(
      (await createHqImplementedEngine(replayReader, restored).catchup()).status
    ).toBe("applied");
    const before = (await restored.readSync())!.published;
    const changed = copy(page);
    Object.assign(changed.items[0].payload, {
      syntheticUnknownRawExtension: "SECRET-PAYLOAD",
    });
    const result = await createHqImplementedEngine(
      { ...reader, changes: async () => copy(changed) },
      restored
    ).catchup();
    expect(result).toMatchObject({ code: "SEQUENCE_CONFLICT" });
    expect((await restored.readSync())!.published).toEqual(before);
  });
});

describe("strict manifest grammar and independent limits", () => {
  const corruptions: [string, (m: HqV2Manifest) => void][] = [
    ["unknown field", m => Object.assign(m, { secret: "SECRET-PAYLOAD" })],
    ["format", m => (m.format = "v1" as never)],
    ["codec", m => (m.codec = "other" as never)],
    ["binding", m => (m.sourceFingerprint = OTHER_FP)],
    [
      "unsafe version",
      m => {
        m.syncVersion = Number.MAX_SAFE_INTEGER + 1;
        m.sync.version = m.syncVersion;
      },
    ],
    ["root sync version", m => m.sync.version++],
    ["zero compact", m => (m.compactBytes = 0)],
    ["compact cap", m => (m.compactBytes = HQ_LIVE_V2_COMPACT_BYTES + 1)],
    ["expanded cap", m => (m.expandedBytes = HQ_LIVE_V2_EXPANDED_BYTES + 1)],
    ["noninteger count", m => (m.expandedBytes = 1.5)],
    ["full hash", m => (m.sha256 = "G".repeat(64))],
    [
      "metadata semantics",
      m => (m.sync.published!.metadata.scope = "wrong" as never),
    ],
    [
      "unknown skeleton field",
      m => Object.assign(m.sync.published!, { entities: {} }),
    ],
    [
      "missing skeleton field",
      m => delete (m.sync as Partial<typeof m.sync>).stage,
    ],
    ["wrong part", m => (m.groups[0].part = "other" as never)],
    ["nonexistent part", m => (m.groups[0].part = "stage")],
    ["wrong kind", m => (m.groups[0].kind = "other" as never)],
    ["bucket out of range", m => (m.groups[0].bucket = 16)],
    ["bucket fractional", m => (m.groups[0].bucket = 0.5)],
    ["aux bucket", m => (m.groups[m.groups.length - 1].bucket = 0)],
    ["duplicate groups", m => m.groups.splice(1, 0, copy(m.groups[0]))],
    ["group order", m => m.groups.reverse()],
    ["missing aux", m => m.groups.pop()],
    ["group hash", m => (m.groups[0].sha256 = "secret")],
    ["group length", m => m.groups[0].byteCount++],
    ["group cap", m => (m.groups[0].byteCount = HQ_LIVE_V2_COMPACT_BYTES + 1)],
    ["empty chunks", m => (m.groups[0].chunks = [])],
    [
      "chunk cap",
      m => (m.groups[0].chunks[0].byteCount = HQ_LIVE_V2_CHUNK_BYTES + 1),
    ],
    ["chunk empty", m => (m.groups[0].chunks[0].byteCount = 0)],
    [
      "namespace",
      m =>
        (m.groups[0].chunks[0].id =
          "live:company:foreign:v2:chunk:" + "a".repeat(64)),
    ],
    [
      "input-selected ID",
      m => (m.groups[0].chunks[0].id = idFor("b".repeat(64))),
    ],
    ["index extra", m => Object.assign(m.groups[0].chunks[0], { index: 0 })],
    ["hash uppercase", m => (m.groups[0].chunks[0].sha256 = "A".repeat(64))],
    [
      "unknown group field",
      m => Object.assign(m.groups[0], { data: "SECRET-PAYLOAD" }),
    ],
    ["compact below group sum", m => (m.compactBytes = 1)],
  ];
  it.each(corruptions)(
    "rejects %s without payload errors",
    (_name, corrupt) => {
      const encoded = encodeHqLiveV2Sync(seed, FP),
        manifest = copy(encoded.manifest);
      corrupt(manifest);
      expect(() =>
        validateHqV2Manifest(manifest, manifest.syncVersion, FP)
      ).toThrow(/^HQ_V2_INVALID_MANIFEST$/);
    }
  );
  it("checks expected version, repeated reference consistency, max references and short interior chunks", () => {
    const encoded = encodeHqLiveV2Sync(seed, FP),
      m = copy(encoded.manifest);
    expect(() => validateHqV2Manifest(m, m.syncVersion + 1, FP)).toThrow(
      /^HQ_V2_INVALID_MANIFEST$/
    );
    const ref = m.groups[0].chunks[0];
    m.groups[0].chunks = Array.from(
      { length: HQ_LIVE_V2_MAX_REFS + 1 },
      () => ({ ...ref })
    );
    expect(() => validateHqV2Manifest(m, m.syncVersion, FP)).toThrow(
      /^HQ_V2_INVALID_MANIFEST$/
    );
    const short = copy(encoded.manifest);
    short.groups[0].chunks.push(copy(ref));
    short.groups[0].byteCount += ref.byteCount;
    expect(() => validateHqV2Manifest(short, short.syncVersion, FP)).toThrow(
      /^HQ_V2_INVALID_MANIFEST$/
    );
    const shared = encodeHqLiveV2Sync(withStage(), FP).manifest;
    const all = shared.groups.flatMap(g => g.chunks);
    const duplicate = all.find((r, i) =>
      all.slice(0, i).some(other => other.id === r.id)
    )!;
    duplicate.byteCount--;
    expect(() => validateHqV2Manifest(shared, shared.syncVersion, FP)).toThrow(
      /^HQ_V2_INVALID_MANIFEST$/
    );
  });
  it("root cap is independently checked before decoding or large allocations", () => {
    const manifest = copy(encodeHqLiveV2Sync(seed, FP).manifest);
    (
      manifest.sync.published!.metadata as unknown as Record<string, unknown>
    ).syntheticRootPadding = "S".repeat(HQ_LIVE_V2_ROOT_BYTES);
    expect(() =>
      validateHqV2Manifest(manifest, manifest.syncVersion, FP)
    ).toThrow(/^HQ_V2_INVALID_MANIFEST$/);
  });
  it("both compact and expanded profiles independently reject without a 2:1 inference", () => {
    // Repeated escaped controls make compact exceed 64 MiB while expanded stays below 128 MiB.
    function capacityState(
      records: number,
      strings: number,
      character: string
    ) {
      const state = copy(seed);
      state.published!.entities = {};
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
            syntheticCapacityExtension: Array(strings).fill(
              character.repeat(4096)
            ),
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
    const state = capacityState(110, 22, "\u0000");
    expect(hqJsonUtf8Bytes(state)).toBeLessThan(HQ_LIVE_V2_EXPANDED_BYTES);
    const compact = {
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
    expect(hqJsonUtf8Bytes(compact)).toBeGreaterThan(HQ_LIVE_V2_COMPACT_BYTES);
    expect(() => encodeHqLiveV2Sync(state, FP)).toThrow(
      /^HQ_V2_INVALID_STATE$/
    );
    // Plain ASCII duplicated entity+canonical exceeds expanded first, while compact is smaller.
    const expanded = capacityState(100, 180, "S");
    expect(hqJsonUtf8Bytes(expanded)).toBeGreaterThan(
      HQ_LIVE_V2_EXPANDED_BYTES
    );
    expect(() => encodeHqLiveV2Sync(expanded, FP)).toThrow(
      /^HQ_V2_INVALID_STATE$/
    );
  }, 60000);
});

describe("strict chunk and logical reconstruction checks", () => {
  it.each([
    "field",
    "format",
    "binding",
    "hash",
    "count",
    "data",
    "padding",
    "duplicate-key",
    "namespace",
  ])("denies %s chunk corruption", damage => {
    const encoded = encodeHqLiveV2Sync(seed, FP),
      ref = manifestChunkRefs(encoded.manifest)[0];
    const original = map(encoded).get(ref.id)!;
    const env = JSON.parse(original);
    let serialized = original,
      changedRef = copy(ref);
    if (damage === "field") env.secret = "SECRET-PAYLOAD";
    if (damage === "format") env.format = "wrong";
    if (damage === "binding") env.sourceFingerprint = OTHER_FP;
    if (damage === "hash") env.sha256 = "b".repeat(64);
    if (damage === "count") env.byteCount++;
    if (damage === "data") env.data = "!" + env.data.slice(1);
    if (damage === "padding") env.data = env.data.replace(/=+$/, "") + "===";
    if (damage === "namespace") changedRef.id = "foreign:secret";
    serialized = canonicalHqJson(env);
    if (damage === "duplicate-key")
      serialized = original.replace("{", '{"format":"secret",');
    expect(() => validateHqV2Chunk(serialized, changedRef, FP)).toThrow(
      /^HQ_V2_INVALID_CHUNK$/
    );
  });
  it("accepts MySQL JSON wrapper key reordering and whitespace without changing content bytes", () => {
    const encoded = encodeHqLiveV2Sync(seed, FP);
    const ref = manifestChunkRefs(encoded.manifest)[0];
    const original = map(encoded).get(ref.id)!;
    const envelope = JSON.parse(original);
    const reordered = Object.fromEntries(Object.entries(envelope).reverse());
    expect(
      validateHqV2Chunk(JSON.stringify(reordered, null, 2), ref, FP)
    ).toEqual(validateHqV2Chunk(original, ref, FP));
  });
  it("denies duplicate wrapper keys even when the last value is the expected value", () => {
    const encoded = encodeHqLiveV2Sync(seed, FP);
    const ref = manifestChunkRefs(encoded.manifest)[0];
    const original = map(encoded).get(ref.id)!;
    const duplicate = original.replace(
      "{",
      '{"format":"hq-live-sync-chunk-v2",'
    );
    expect(() => validateHqV2Chunk(duplicate, ref, FP)).toThrow(
      /^HQ_V2_INVALID_CHUNK$/
    );
  });
  it("checks row cap, raw length, raw hash and canonical pad bits before returning bytes", () => {
    const ref: HqV2ChunkRef = {
      id: idFor(digest("a")),
      sha256: digest("a"),
      byteCount: 1,
    };
    const serialize = (data: string, byteCount = 1) =>
      canonicalHqJson({
        format: "hq-live-sync-chunk-v2",
        sourceFingerprint: FP,
        sha256: ref.sha256,
        byteCount,
        data,
      });
    expect(validateHqV2Chunk(serialize("YQ=="), ref, FP).toString()).toBe("a");
    for (const data of ["YR==", "Yg==", "YWE=", "YQ=", "YQ==\n"])
      expect(() => validateHqV2Chunk(serialize(data), ref, FP)).toThrow(
        /^HQ_V2_INVALID_CHUNK$/
      );
    expect(() =>
      validateHqV2Chunk(" ".repeat(HQ_LIVE_V2_CHUNK_ROW_BYTES), ref, FP)
    ).toThrow(/^HQ_V2_INVALID_CHUNK$/);
  });
  it("accepts an exact raw 512KiB chunk and rejects the independently oversized raw boundary", () => {
    const raw = Buffer.alloc(HQ_LIVE_V2_CHUNK_BYTES, 65),
      sha256 = digest(raw),
      id = idFor(sha256);
    const ref = { id, sha256, byteCount: raw.length };
    const serialized = canonicalHqJson({
      format: "hq-live-sync-chunk-v2",
      sourceFingerprint: FP,
      sha256,
      byteCount: raw.length,
      data: raw.toString("base64"),
    });
    expect(validateHqV2Chunk(serialized, ref, FP).equals(raw)).toBe(true);
    expect(() =>
      validateHqV2Chunk(serialized, { ...ref, byteCount: raw.length + 1 }, FP)
    ).toThrow(/^HQ_V2_INVALID_CHUNK$/);
  });
  it.each([
    "missing",
    "extra",
    "binding",
    "full-hash",
    "compact-count",
    "expanded-count",
    "group-hash",
  ])("rejects %s decode corruption", damage => {
    const encoded = encodeHqLiveV2Sync(seed, FP),
      chunks = map(encoded),
      manifest = copy(encoded.manifest);
    if (damage === "missing") chunks.delete(chunks.keys().next().value!);
    if (damage === "extra") chunks.set("secret-foreign", "SECRET-PAYLOAD");
    if (damage === "binding") manifest.sourceFingerprint = OTHER_FP;
    if (damage === "full-hash") manifest.sha256 = "c".repeat(64);
    if (damage === "compact-count") manifest.compactBytes++;
    if (damage === "expanded-count") manifest.expandedBytes++;
    if (damage === "group-hash") manifest.groups[0].sha256 = "c".repeat(64);
    expect(() => decodeHqLiveV2Sync(manifest, chunks, FP)).toThrow(
      /^HQ_V2_INVALID_STATE$/
    );
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
    "invalid-utf8",
    "bom",
    "aux-extra",
  ])("denies fully rehashed %s group corruption", damage => {
    const encoded = encodeHqLiveV2Sync(seed, FP);
    let index = damage === "aux-extra" ? encoded.manifest.groups.length - 1 : 0;
    let raw = rawGroup(encoded, index);
    const value = JSON.parse(raw.toString("utf8"));
    const key = Object.keys(value)[0],
      record = value[key];
    if (damage === "whitespace") raw = Buffer.concat([Buffer.from(" "), raw]);
    if (damage === "key-order") {
      value[key] = {
        canonicalPayload: record.canonicalPayload,
        absent: record.absent,
      };
      raw = Buffer.from(JSON.stringify(value));
      expect(raw.equals(rawGroup(encoded, index))).toBe(false);
    }
    if (damage === "duplicate-key")
      raw = Buffer.from(raw.toString().replace("{", '{"secret":0,"secret":1,'));
    if (damage === "canonical-payload") {
      record.canonicalPayload = " " + record.canonicalPayload;
      raw = Buffer.from(canonicalHqJson(value));
    }
    if (damage === "record-extra") {
      record.secret = "SECRET-PAYLOAD";
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
    if (damage === "invalid-utf8")
      raw = Buffer.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x3a, 0x30, 0x7d]);
    if (damage === "bom")
      raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), raw]);
    if (damage === "aux-extra") {
      value.extra = "SECRET-PAYLOAD";
      raw = Buffer.from(canonicalHqJson(value));
    }
    const changed = replaceGroup(encoded, index, raw);
    expect(() =>
      decodeHqLiveV2Sync(changed.manifest, changed.chunks, FP)
    ).toThrow(/^HQ_V2_INVALID_STATE$/);
  });
});

describe("large offline synthetic groups", () => {
  it("roundtrips >16MiB expanded state and reuses every group chunk on counter-only changes", async () => {
    // Entirely invented data: no inference about whether the production feed fits this profile.
    const store = createHqImplementedMemoryStore();
    const result = await createHqImplementedEngine(
      createHqLargeSyntheticReader(),
      store,
      HQ_LIVE_V2_VALIDATION_OPTIONS
    ).backfill();
    expect(result.status).toBe("applied");
    const state = (await store.readSync())!;
    expect(hqJsonUtf8Bytes(state)).toBeGreaterThan(16 * 1024 * 1024);
    const staged = {
      ...state,
      version: state.version + 1,
      stage: {
        kind: "catchup",
        phase: "changes",
        basePublishedVersion: state.published!.version,
        metadata: state.published!.metadata,
        cursor: "large-resume",
        pendingResumeCursor: "large-next",
        entities: state.published!.entities,
        seqProofs: {},
        feedKeys: { booking: [], business: [] },
        catalogueKeys: { booking: [], business: [] },
        cursors: [],
        pages: 1,
        recordsRead: 0,
        lastSeq: null,
      },
    } as HqImplementedSyncState;
    const encoded = encodeHqLiveV2Sync(staged, FP);
    expect(decodeHqLiveV2Sync(encoded.manifest, map(encoded), FP)).toEqual(
      staged
    );
    const next = {
      ...staged,
      version: staged.version + 1,
      stage: { ...staged.stage!, pages: 2, recordsRead: 1 },
    };
    const changed = encodeHqLiveV2Sync(next, FP);
    expect(changed.manifest.groups).toEqual(encoded.manifest.groups);
    expect(changed.chunks).toEqual(encoded.chunks);
    expect(changed.manifest.sha256).not.toBe(encoded.manifest.sha256);
    expect(encoded.manifest.groups.some(g => g.chunks.length > 1)).toBe(true);
  }, 60000);
  it("decodes valid UTF-8 codepoints split across exact 512KiB raw chunk boundaries", async () => {
    const reader = createHqLargeSyntheticReader({
      bookingCount: 1,
      paddingBytes: 0,
    });
    const page = await reader.bookings();
    const { ready: _ready, ...metadata } = await reader.status();
    const entity = page.items[0];
    // Put a known prefix first in canonical payload, then adjust ASCII padding to
    // place the first emoji's byte 1 at offset 512KiB-1 in the compact group.
    const state: HqImplementedSyncState = {
      version: 1,
      stage: null,
      published: {
        wireVersion: "1.0.0",
        version: 1,
        scope: metadata.scope,
        metadata,
        resumeCursor: page.resumeCursor,
        entities: {},
        seqProofs: {},
      },
    };
    const key = `${entity.entityType}:${entity.entityId}`;
    const put = (padding: number) => {
      Object.assign(entity.payload, {
        aSyntheticSplit: [
          ...Array(Math.floor(padding / 4096)).fill("S".repeat(4096)),
          "S".repeat(padding % 4096),
          "😀".repeat(1000),
        ],
      });
      state.published!.entities[key] = {
        entity,
        canonicalPayload: canonicalHqJson(entity),
        absent: false,
      };
      return encodeHqLiveV2Sync(state, FP);
    };
    let encoded = put(0);
    const initialPosition = rawGroup(encoded, 0).indexOf(Buffer.from("😀"));
    let padding = HQ_LIVE_V2_CHUNK_BYTES - 1 - initialPosition;
    // Each additional padding string adds six escaped separator bytes in compact JSON.
    for (let i = 0; i < 6; i++) {
      encoded = put(padding);
      const position = rawGroup(encoded, 0).indexOf(Buffer.from("😀"));
      if (position === HQ_LIVE_V2_CHUNK_BYTES - 1) break;
      padding += HQ_LIVE_V2_CHUNK_BYTES - 1 - position;
    }
    const raw = rawGroup(encoded, 0);
    expect(raw.indexOf(Buffer.from("😀"))).toBe(HQ_LIVE_V2_CHUNK_BYTES - 1);
    expect(raw[HQ_LIVE_V2_CHUNK_BYTES - 1]).toBe(0xf0);
    expect(encoded.manifest.groups[0].chunks[0].byteCount).toBe(
      HQ_LIVE_V2_CHUNK_BYTES
    );
    expect(decodeHqLiveV2Sync(encoded.manifest, map(encoded), FP)).toEqual(
      state
    );
    const order = copy(encoded.manifest);
    order.groups[0].chunks.reverse();
    expect(() => decodeHqLiveV2Sync(order, map(encoded), FP)).toThrow(
      /^HQ_V2_INVALID_STATE$/
    );
  }, 60000);
  it("rejects reordering equal-sized interior chunks even when the manifest length grammar passes", () => {
    const raw = Buffer.concat([
      Buffer.alloc(HQ_LIVE_V2_CHUNK_BYTES, 65),
      Buffer.alloc(HQ_LIVE_V2_CHUNK_BYTES, 66),
    ]);
    const encoded = encodeHqLiveV2Sync(seed, FP);
    const changed = replaceGroup(encoded, 0, raw);
    changed.manifest.groups[0].chunks.reverse();
    validateHqV2Manifest(changed.manifest, changed.manifest.syncVersion, FP);
    expect(() =>
      decodeHqLiveV2Sync(changed.manifest, changed.chunks, FP)
    ).toThrow(/^HQ_V2_INVALID_STATE$/);
  });
});
