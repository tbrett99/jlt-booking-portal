import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalHqJson } from "./management-hq-engine";
import {
  validateHqImplementedSyncState,
  validateHqImplementedSyncStateAsync,
  type HqImplementedRecord,
  type HqImplementedState,
  type HqImplementedStage,
  type HqImplementedSyncState,
} from "./management-hq-ingestion";
import {
  validateHqWireEntity,
  validateHqWireStatus,
} from "./management-hq-wire-contract";

/** Live-only storage profile. Actual production capacity and RSS/latency are unknown. */
export const HQ_LIVE_V2_COMPACT_BYTES = 64 * 1024 * 1024;
export const HQ_LIVE_V2_EXPANDED_BYTES = 128 * 1024 * 1024;
export const HQ_LIVE_V2_CHUNK_BYTES = 512 * 1024;
export const HQ_LIVE_V2_CHUNK_ROW_BYTES = 1024 * 1024;
export const HQ_LIVE_V2_ROOT_BYTES = 16 * 1024 * 1024;
export const HQ_LIVE_V2_MAX_REFS = 256;

export interface HqV2ChunkRef {
  id: string;
  sha256: string;
  byteCount: number;
}
export interface HqV2Group {
  part: "published" | "stage";
  kind: "entities" | "aux";
  /** Present only for entity groups. */
  bucket?: number;
  byteCount: number;
  sha256: string;
  chunks: HqV2ChunkRef[];
}
type PublishedSkeleton = Omit<HqImplementedState, "entities" | "seqProofs">;
type StageSkeleton = Omit<
  HqImplementedStage,
  "entities" | "seqProofs" | "feedKeys" | "catalogueKeys" | "cursors"
>;
type SyncSkeleton = {
  version: number;
  published: PublishedSkeleton | null;
  stage: StageSkeleton | null;
};
export interface HqV2Manifest {
  format: "hq-live-sync-manifest-v2";
  codec: "canonical-record-v1";
  sourceFingerprint: string;
  syncVersion: number;
  compactBytes: number;
  expandedBytes: number;
  sha256: string;
  sync: SyncSkeleton;
  groups: HqV2Group[];
}
export interface HqV2Chunk {
  id: string;
  serialized: string;
}
type CompactRecord = Pick<HqImplementedRecord, "canonicalPayload" | "absent">;
type CompactPart = Record<string, unknown> & {
  entities: Record<string, CompactRecord>;
};
type CompactSync = {
  version: number;
  published: CompactPart | null;
  stage: CompactPart | null;
};
const HEX = /^[a-f0-9]{64}$/;
const CHUNK_PREFIX = "live:company:orbit:v2:chunk:";
const ROOT_KEYS = ["version", "published", "stage"];
const PUBLISHED_KEYS = [
  "wireVersion",
  "version",
  "scope",
  "resumeCursor",
  "metadata",
];
const STAGE_KEYS = [
  "kind",
  "phase",
  "basePublishedVersion",
  "metadata",
  "cursor",
  "pendingResumeCursor",
  "pages",
  "recordsRead",
  "lastSeq",
];
const GROUPED_STAGE_KEYS = [
  "seqProofs",
  "feedKeys",
  "catalogueKeys",
  "cursors",
];
const fail: (code: string) => never = code => {
  throw new Error(code);
};
const invalid: () => never = () => fail("HQ_V2_INVALID_JSON");
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype ||
    Object.getPrototypeOf(v) === null);
function exactKeys(
  value: unknown,
  keys: readonly string[]
): asserts value is Record<string, unknown> {
  if (
    !object(value) ||
    Object.getOwnPropertySymbols(value).length ||
    Object.keys(value).length !== keys.length ||
    keys.some(k => !Object.hasOwn(value, k))
  )
    invalid();
}
const integer = (n: unknown, minimum: number, maximum: number): n is number =>
  typeof n === "number" &&
  Number.isSafeInteger(n) &&
  n >= minimum &&
  n <= maximum;
const hash = (v: unknown): v is string => typeof v === "string" && HEX.test(v);
function chunkId(sourceFingerprint: string, sha256: string) {
  return (
    CHUNK_PREFIX +
    createHash("sha256")
      .update(sourceFingerprint + ":" + sha256)
      .digest("hex")
  );
}

/** Emit JSON string escapes in bounded pieces, including lone-surrogate escapes.
 * Never stringify an unbounded canonicalPayload or the whole state. */
function* stringFragments(value: string): Generator<string> {
  yield '"';
  for (let start = 0; start < value.length; ) {
    let end = Math.min(start + 8192, value.length);
    // Never split a valid surrogate pair; native stringify must see both units.
    if (end < value.length) {
      const last = value.charCodeAt(end - 1);
      const next = value.charCodeAt(end);
      if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
        end--;
    }
    const escaped = JSON.stringify(value.slice(start, end));
    yield escaped.slice(1, -1);
    start = end;
  }
  yield '"';
}

/** Sorted object keys, array order preserved. In measurement mode undefined,
 * functions and symbols follow JSON.stringify's omission/null rules. Strict
 * storage mode rejects non-JSON data instead of silently dropping extensions. */
type JsonFragment = string | Generator<JsonFragment>;
function* jsonTree(
  value: unknown,
  strict = false,
  own?: (value: unknown) => void
): Generator<JsonFragment> {
  const active = new Set<object>();
  function prepare(v: unknown, key: string): unknown {
    if (
      !strict &&
      v !== null &&
      (typeof v === "object" || typeof v === "bigint")
    ) {
      const toJSON = (v as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === "function") v = toJSON.call(v, key);
      if (v instanceof Number || v instanceof String || v instanceof Boolean)
        v = v.valueOf();
    }
    return v;
  }
  function* visit(
    v: unknown,
    depth: number,
    key: string,
    inArray = false,
    prepared = false,
    capture?: (value: unknown) => void
  ): Generator<JsonFragment> {
    if (depth > 256) invalid();
    if (!prepared) v = prepare(v, key);
    if (v === null) {
      capture?.(null);
      yield "null";
      return;
    }
    switch (typeof v) {
      case "string":
        capture?.(v);
        yield stringFragments(v);
        return;
      case "number":
        if (strict && !Number.isFinite(v)) invalid();
        capture?.(v === 0 ? 0 : v);
        yield JSON.stringify(v);
        return;
      case "boolean":
        capture?.(v);
        yield v ? "true" : "false";
        return;
      case "undefined":
      case "function":
      case "symbol":
        if (strict) invalid();
        if (inArray) yield "null";
        return;
      case "bigint":
        invalid();
      case "object":
        break;
      default:
        invalid();
    }
    const obj = v as object;
    if (active.has(obj)) invalid();
    if (strict && !Array.isArray(obj) && !object(obj)) invalid();
    if (strict && Object.getOwnPropertySymbols(obj).length) invalid();
    if (strict)
      for (const name of Object.getOwnPropertyNames(obj)) {
        if (Array.isArray(obj) && name === "length") continue;
        const descriptor = Object.getOwnPropertyDescriptor(obj, name)!;
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
          invalid();
        if (
          Array.isArray(obj) &&
          (!/^(?:0|[1-9][0-9]*)$/.test(name) || Number(name) >= obj.length)
        )
          invalid();
        yield "";
      }
    active.add(obj);
    if (Array.isArray(obj)) {
      if (strict && Object.keys(obj).length !== obj.length) invalid();
      const owned = capture ? ([] as unknown[]) : undefined;
      yield "[";
      for (let i = 0; i < obj.length; i++) {
        if (i) yield ",";
        yield visit(
          obj[i],
          depth + 1,
          String(i),
          true,
          false,
          owned
            ? child => {
                owned.push(child);
              }
            : undefined
        );
      }
      yield "]";
      if (owned) capture!(owned);
    } else {
      const owned = capture
        ? (Object.create(null) as Record<string, unknown>)
        : undefined;
      const keys = Object.keys(obj);
      // Canonical bytes traverse sorted keys, but the original manifest/legacy
      // encoding preserves skeleton insertion order. Capture both facts without
      // retaining any caller values or rereading the caller after capture.
      if (owned) for (const k of keys) owned[k] = undefined;
      yield "{";
      let first = true;
      for (const k of keys.sort()) {
        const child = prepare((obj as Record<string, unknown>)[k], k);
        if (
          !strict &&
          (child === undefined ||
            typeof child === "function" ||
            typeof child === "symbol")
        ) {
          yield "";
          continue;
        }
        if (!first) yield ",";
        first = false;
        yield stringFragments(k);
        yield ":";
        yield visit(
          child,
          depth + 1,
          k,
          false,
          true,
          owned
            ? value => {
                owned[k] = value;
              }
            : undefined
        );
      }
      yield "}";
      if (owned) capture!(owned);
    }
    active.delete(obj);
  }
  yield visit(value, 0, "", false, false, own);
}

/** Flatten nested JSON iterators without target-dependent delegation. */
function* jsonFragments(
  value: unknown,
  strict = false,
  coalesce = true,
  own?: (value: unknown) => void
): Generator<string> {
  const stack: Generator<JsonFragment>[] = [jsonTree(value, strict, own)];
  let pieces: string[] = [],
    units = 0,
    steps = 0;
  try {
    while (stack.length) {
      const next = stack[stack.length - 1].next();
      if (next.done) stack.pop();
      else if (typeof next.value === "string") {
        if (!coalesce) {
          yield next.value;
          continue;
        }
        pieces.push(next.value);
        units += next.value.length;
      } else stack.push(next.value);
      // Bound both output and structural work, including omitted descriptors.
      // Individual escaped slices remain <=8192 source UTF-16 units; never
      // split a valid pair or alter native JSON escaping at a join boundary.
      if (units >= 8192 || ++steps >= 1024) {
        yield pieces.join("");
        pieces = [];
        units = 0;
        steps = 0;
      }
    }
    if (pieces.length) yield pieces.join("");
  } catch (error) {
    // Deliver already emitted bytes before an invalid later child, preserving
    // the cap error's precedence over a later JSON error in measurement mode.
    if (pieces.length) yield pieces.join("");
    throw error;
  } finally {
    while (stack.length) stack.pop()!.return(undefined);
  }
}
/** The sync driver is deliberately kept for all legacy exports. */
function writeJson(
  value: unknown,
  emit: (text: string) => void,
  strict = false
) {
  const iterator = jsonFragments(value, strict, false);
  for (;;) {
    const next = iterator.next();
    if (next.done) break;
    emit(next.value);
  }
}
type CodecStep =
  | void
  | { work: CodecWork<unknown> }
  | {
      validateState: HqImplementedSyncState;
      measuredBytes: number;
    };
type CodecWork<T> = Generator<CodecStep, T, any>;
/** Iterative composition preserves child return values without delegation or a
 * target/compiler-option change. The same operation stack drives both paths. */
function runSync<T>(work: CodecWork<T>): T {
  const stack: CodecWork<unknown>[] = [work];
  let returned: unknown;
  try {
    while (stack.length) {
      const next = stack[stack.length - 1].next(returned);
      returned = undefined;
      if (next.done) {
        stack.pop();
        returned = next.value;
      } else if (next.value && "work" in next.value)
        stack.push(next.value.work);
      else if (next.value)
        validateHqImplementedSyncState(
          next.value.validateState,
          HQ_LIVE_V2_VALIDATION_OPTIONS
        );
    }
    return returned as T;
  } finally {
    while (stack.length) stack.pop()!.return(undefined);
  }
}
async function runAsync<T>(
  work: CodecWork<T>,
  checkpoint: () => Promise<void>
): Promise<T> {
  const stack: CodecWork<unknown>[] = [work];
  let returned: unknown;
  try {
    while (stack.length) {
      const next = stack[stack.length - 1].next(returned);
      returned = undefined;
      if (next.done) {
        stack.pop();
        returned = next.value;
        continue;
      }
      await checkpoint();
      if (next.value && "work" in next.value) stack.push(next.value.work);
      else if (next.value) {
        // Reuse only the strictly measured exact local immutable input fact.
        // Record/progress/raw canonical/equality validation is still performed.
        const { validateState, measuredBytes } = next.value;
        await validateHqImplementedSyncStateAsync(
          validateState,
          {
            maxStateBytes: HQ_LIVE_V2_EXPANDED_BYTES,
            measureStateBytesAsync: async () => measuredBytes,
          },
          checkpoint
        );
      }
    }
    return returned as T;
  } finally {
    while (stack.length) stack.pop()!.return(undefined);
  }
}
/** Exact UTF-8 JSON size without building a full JSON string. Root undefined
 * has zero serialized bytes; object undefined is omitted and array holes null.
 * The cap is checked on each bounded output piece. Error text never has data. */
export function hqJsonUtf8Bytes(
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  let exceeded = false;
  try {
    if (!integer(maximum, 0, Number.MAX_SAFE_INTEGER)) invalid();
    let bytes = 0;
    writeJson(value, text => {
      bytes += Buffer.byteLength(text, "utf8");
      if (bytes > maximum) {
        exceeded = true;
        invalid();
      }
    });
    return bytes;
  } catch {
    if (exceeded) fail("HQ_V2_JSON_BYTE_CAP_EXCEEDED");
    return invalid();
  }
}
export async function hqJsonUtf8BytesAsync(
  value: unknown,
  maximum: number,
  checkpoint: () => Promise<void>
): Promise<number> {
  let exceeded = false;
  try {
    if (!integer(maximum, 0, Number.MAX_SAFE_INTEGER)) invalid();
    let bytes = 0;
    for (const iterator = jsonFragments(value); ; ) {
      const next = iterator.next();
      if (next.done) break;
      const text = next.value;
      bytes += Buffer.byteLength(text, "utf8");
      if (bytes > maximum) {
        exceeded = true;
        invalid();
      }
      await checkpoint();
    }
    return bytes;
  } catch {
    if (exceeded) fail("HQ_V2_JSON_BYTE_CAP_EXCEEDED");
    return invalid();
  }
}
export const HQ_LIVE_V2_ASYNC_VALIDATION_OPTIONS = Object.freeze({
  maxStateBytes: HQ_LIVE_V2_EXPANDED_BYTES,
  measureStateBytesAsync: hqJsonUtf8BytesAsync,
});
export const HQ_LIVE_V2_VALIDATION_OPTIONS = Object.freeze({
  maxStateBytes: HQ_LIVE_V2_EXPANDED_BYTES,
  measureStateBytes: hqJsonUtf8Bytes,
});
function* digestJsonWork(
  value: unknown,
  maximum: number,
  own?: (value: unknown) => void
): CodecWork<{ byteCount: number; sha256: string }> {
  let byteCount = 0;
  const digest = createHash("sha256");
  for (const iterator = jsonFragments(value, true, true, own); ; ) {
    const next = iterator.next();
    if (next.done) break;
    const text = next.value;
    const bytes = Buffer.from(text, "utf8");
    byteCount += bytes.length;
    if (byteCount > maximum) invalid();
    digest.update(bytes);
    yield;
  }
  return { byteCount, sha256: digest.digest("hex") };
}
function* canonicalBytesEqualWork(
  value: unknown,
  raw: Buffer
): CodecWork<void> {
  let offset = 0;
  for (const iterator = jsonFragments(value, true); ; ) {
    const next = iterator.next();
    if (next.done) break;
    const text = next.value;
    const bytes = Buffer.from(text, "utf8");
    if (
      offset + bytes.length > raw.length ||
      !raw.subarray(offset, offset + bytes.length).equals(bytes)
    )
      invalid();
    offset += bytes.length;
    yield;
  }
  if (offset !== raw.length) invalid();
}
function* digestBufferWork(raw: Buffer): CodecWork<string> {
  const digest = createHash("sha256");
  for (let offset = 0; offset < raw.length; offset += 8192) {
    digest.update(raw.subarray(offset, offset + 8192));
    yield;
  }
  return digest.digest("hex");
}
function validateSkeleton(
  sync: unknown,
  version: number
): asserts sync is SyncSkeleton {
  exactKeys(sync, ROOT_KEYS);
  if (sync.version !== version) invalid();
  if (sync.published !== null) {
    exactKeys(sync.published, PUBLISHED_KEYS);
    if (
      sync.published.wireVersion !== "1.0.0" ||
      sync.published.scope !== "company_all_real_and_unattributed" ||
      !integer(sync.published.version, 1, version) ||
      !object(sync.published.metadata) ||
      !token(sync.published.resumeCursor)
    )
      invalid();
    validateHqWireStatus({ ...sync.published.metadata, ready: true });
  }
  if (sync.stage !== null) {
    exactKeys(sync.stage, STAGE_KEYS);
    const stage = sync.stage;
    if (
      !["backfill", "catchup"].includes(stage.kind as string) ||
      ![
        "bookings",
        "business",
        "catalogue_booking",
        "catalogue_business",
        "changes",
        "finish",
      ].includes(stage.phase as string) ||
      stage.basePublishedVersion !==
        (sync.published === null
          ? null
          : (sync.published as Record<string, unknown>).version) ||
      (stage.metadata !== null && !object(stage.metadata)) ||
      (stage.cursor !== null && !token(stage.cursor)) ||
      (stage.pendingResumeCursor !== null &&
        !token(stage.pendingResumeCursor)) ||
      !integer(stage.pages, 0, 1000) ||
      !integer(stage.recordsRead, 0, 100000) ||
      (stage.lastSeq !== null &&
        !integer(stage.lastSeq, 1, Number.MAX_SAFE_INTEGER))
    )
      invalid();
    if (stage.kind === "backfill" && stage.phase === "changes") invalid();
    if (
      stage.kind === "catchup" &&
      stage.phase !== "changes" &&
      stage.phase !== "finish"
    )
      invalid();
    if (
      stage.metadata === null &&
      (stage.kind !== "backfill" ||
        stage.phase !== "bookings" ||
        stage.pages !== 0 ||
        stage.recordsRead !== 0 ||
        stage.cursor !== null ||
        stage.pendingResumeCursor !== null ||
        stage.lastSeq !== null)
    )
      invalid();
    if (
      stage.metadata !== null &&
      (stage.pages < 1 || !token(stage.pendingResumeCursor))
    )
      invalid();
    if (stage.metadata !== null)
      validateHqWireStatus({ ...(stage.metadata as object), ready: true });
  }
}
function token(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 2048 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
function validatedRefs(manifest: HqV2Manifest): HqV2ChunkRef[] {
  const unique = new Map<string, HqV2ChunkRef>();
  for (const group of manifest.groups)
    for (const ref of group.chunks) {
      const previous = unique.get(ref.id);
      if (
        previous &&
        (previous.sha256 !== ref.sha256 || previous.byteCount !== ref.byteCount)
      )
        invalid();
      unique.set(ref.id, ref);
    }
  return Array.from(unique.values());
}
function* validateManifestWork(
  value: unknown,
  expectedVersion: number,
  sourceFingerprint: string
): CodecWork<void> {
  // Count before any payload-sized buffer is allocated.
  yield { work: digestJsonWork(value, HQ_LIVE_V2_ROOT_BYTES) };
  exactKeys(value, [
    "format",
    "codec",
    "sourceFingerprint",
    "syncVersion",
    "compactBytes",
    "expandedBytes",
    "sha256",
    "sync",
    "groups",
  ]);
  if (
    !hash(sourceFingerprint) ||
    value.sourceFingerprint !== sourceFingerprint ||
    value.format !== "hq-live-sync-manifest-v2" ||
    value.codec !== "canonical-record-v1" ||
    !integer(expectedVersion, 1, Number.MAX_SAFE_INTEGER) ||
    value.syncVersion !== expectedVersion ||
    !integer(value.compactBytes, 1, HQ_LIVE_V2_COMPACT_BYTES) ||
    !integer(value.expandedBytes, 1, HQ_LIVE_V2_EXPANDED_BYTES) ||
    !hash(value.sha256)
  )
    invalid();
  validateSkeleton(value.sync, expectedVersion);
  if (!Array.isArray(value.groups) || value.groups.length > 34) invalid();
  let previousOrder = -1,
    refs = 0,
    total = 0;
  const auxParts = new Set<string>();
  for (const group of value.groups) {
    if (
      !object(group) ||
      !["published", "stage"].includes(group.part as string) ||
      !["entities", "aux"].includes(group.kind as string)
    )
      invalid();
    const part = group.part as "published" | "stage";
    if (value.sync[part] === null) invalid();
    exactKeys(
      group,
      group.kind === "entities"
        ? ["part", "kind", "bucket", "byteCount", "sha256", "chunks"]
        : ["part", "kind", "byteCount", "sha256", "chunks"]
    );
    if (group.kind === "entities" && !integer(group.bucket, 0, 15)) invalid();
    const order =
      (part === "published" ? 0 : 17) +
      (group.kind === "aux" ? 16 : (group.bucket as number));
    if (order <= previousOrder) invalid();
    previousOrder = order;
    if (group.kind === "aux") auxParts.add(part);
    if (
      !integer(group.byteCount, 1, HQ_LIVE_V2_COMPACT_BYTES) ||
      !hash(group.sha256) ||
      !Array.isArray(group.chunks) ||
      group.chunks.length === 0 ||
      (refs += group.chunks.length) > HQ_LIVE_V2_MAX_REFS
    )
      invalid();
    let sum = 0;
    for (let index = 0; index < group.chunks.length; index++) {
      const ref = group.chunks[index];
      exactKeys(ref, ["id", "sha256", "byteCount"]);
      if (
        !hash(ref.sha256) ||
        !integer(ref.byteCount, 1, HQ_LIVE_V2_CHUNK_BYTES) ||
        typeof ref.id !== "string" ||
        ref.id.length >= 120 ||
        ref.id !== chunkId(sourceFingerprint, ref.sha256) ||
        (index < group.chunks.length - 1 &&
          ref.byteCount !== HQ_LIVE_V2_CHUNK_BYTES)
      )
        invalid();
      sum += ref.byteCount;
    }
    if (sum !== group.byteCount || (total += sum) > HQ_LIVE_V2_COMPACT_BYTES)
      invalid();
  }
  if (total > value.compactBytes) invalid();
  for (const part of ["published", "stage"] as const)
    if ((value.sync[part] !== null) !== auxParts.has(part)) invalid();
  // Merge the physical map groups logically, not by materializing payloads.
  // Each bucket loses its braces and gains a separator; aux loses its braces
  // and gains a separator after the skeleton's existing fields.
  let compactBytes = (yield {
    work: digestJsonWork(value.sync, HQ_LIVE_V2_ROOT_BYTES),
  }).byteCount;
  for (const part of ["published", "stage"] as const) {
    if (value.sync[part] === null) continue;
    const entities = value.groups.filter(
      g => g.part === part && g.kind === "entities"
    );
    const aux = value.groups.find(g => g.part === part && g.kind === "aux")!;
    if (aux.byteCount < 3 || entities.some(g => g.byteCount < 3)) invalid();
    compactBytes +=
      Buffer.byteLength(',"entities":{}') +
      entities.reduce((sum, g) => sum + g.byteCount - 2, 0) +
      Math.max(0, entities.length - 1) +
      aux.byteCount -
      1;
  }
  if (compactBytes !== value.compactBytes) invalid();
  validatedRefs(value as unknown as HqV2Manifest);
}
export function validateHqV2Manifest(
  value: unknown,
  expectedVersion: number,
  sourceFingerprint: string
): asserts value is HqV2Manifest {
  try {
    runSync(validateManifestWork(value, expectedVersion, sourceFingerprint));
  } catch {
    fail("HQ_V2_INVALID_MANIFEST");
  }
}
export function manifestChunkRefs(manifest: HqV2Manifest): HqV2ChunkRef[] {
  validateHqV2Manifest(
    manifest,
    manifest?.syncVersion,
    manifest?.sourceFingerprint
  );
  return validatedRefs(manifest);
}
function* validateChunkWork(
  serialized: string,
  ref: HqV2ChunkRef,
  sourceFingerprint: string
): CodecWork<Buffer> {
  if (
    !hash(sourceFingerprint) ||
    typeof serialized !== "string" ||
    Buffer.byteLength(serialized, "utf8") >= HQ_LIVE_V2_CHUNK_ROW_BYTES
  )
    invalid();
  exactKeys(ref, ["id", "sha256", "byteCount"]);
  if (
    !hash(ref.sha256) ||
    !integer(ref.byteCount, 1, HQ_LIVE_V2_CHUNK_BYTES) ||
    ref.id !== chunkId(sourceFingerprint, ref.sha256)
  )
    invalid();
  const permittedKeys = [
    "format",
    "sourceFingerprint",
    "sha256",
    "byteCount",
    "data",
  ];
  const envelope: unknown = JSON.parse(serialized);
  exactKeys(envelope, permittedKeys);
  if (
    envelope.format !== "hq-live-sync-chunk-v2" ||
    envelope.sourceFingerprint !== sourceFingerprint ||
    envelope.sha256 !== ref.sha256 ||
    envelope.byteCount !== ref.byteCount ||
    typeof envelope.data !== "string" ||
    envelope.data.length !== 4 * Math.ceil(ref.byteCount / 3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      envelope.data
    )
  )
    invalid();
  const raw = Buffer.from(envelope.data, "base64");
  if (
    raw.length !== ref.byteCount ||
    raw.toString("base64") !== envelope.data ||
    (yield { work: digestBufferWork(raw) }) !== ref.sha256
  )
    invalid();
  // MySQL JSON legitimately reorders wrapper keys and adds whitespace. The
  // integrity hash covers decoded content, not the database wrapper spelling.
  // Every permitted wrapper value is scalar/base64, so this bounded key scan
  // also detects duplicate keys that JSON.parse would otherwise collapse.
  const keys = serialized.match(/"(?:\\.|[^"\\])*"\s*:/g) ?? [];
  const names = keys.map(key => JSON.parse(key.slice(0, key.lastIndexOf(":"))));
  if (
    names.length !== permittedKeys.length ||
    new Set(names).size !== permittedKeys.length
  )
    invalid();
  return raw;
}
export function validateHqV2Chunk(
  serialized: string,
  ref: HqV2ChunkRef,
  sourceFingerprint: string
): Buffer {
  try {
    return runSync(validateChunkWork(serialized, ref, sourceFingerprint));
  } catch {
    return fail("HQ_V2_INVALID_CHUNK");
  }
}
function* compactPartWork(
  part: HqImplementedState | HqImplementedStage
): CodecWork<CompactPart> {
  const records: Record<string, CompactRecord> = Object.create(null);
  for (const [key, record] of Object.entries(part.entities)) {
    exactKeys(record, ["entity", "canonicalPayload", "absent"]);
    const entity = validateHqWireEntity(record.entity);
    if (
      key !== `${entity.entityType}:${entity.entityId}` ||
      typeof record.absent !== "boolean" ||
      record.canonicalPayload !== canonicalHqJson(entity)
    )
      invalid();
    records[key] = {
      canonicalPayload: record.canonicalPayload,
      absent: record.absent,
    };
    yield;
  }
  return { ...part, entities: records };
}
function splitPart(part: CompactPart, kind: "published" | "stage") {
  const { entities, seqProofs, ...rest } = part;
  if (kind === "published") return { skeleton: rest, aux: { seqProofs } };
  const { feedKeys, catalogueKeys, cursors, ...skeleton } = rest;
  return { skeleton, aux: { seqProofs, feedKeys, catalogueKeys, cursors } };
}
function* encodeSyncWork(
  sync: HqImplementedSyncState,
  sourceFingerprint: string,
  captureOwned = false
): CodecWork<{
  manifest: HqV2Manifest;
  chunks: HqV2Chunk[];
  candidate?: { state: HqImplementedSyncState; chunks: Map<string, Buffer> };
}> {
  if (!hash(sourceFingerprint)) invalid();
  let owned: HqImplementedSyncState | undefined;
  const expanded = yield {
    // Capture exactly the values emitted by the strict byte traversal. Caller
    // mutation across checkpoints cannot change this owned tree afterwards.
    // All subsequent validation, compaction and encoding use ONLY that tree.
    work: digestJsonWork(
      sync,
      HQ_LIVE_V2_EXPANDED_BYTES,
      captureOwned
        ? value => {
            owned = value as HqImplementedSyncState;
          }
        : undefined
    ),
  };
  if (captureOwned) sync = owned!;
  yield { validateState: sync, measuredBytes: expanded.byteCount };
  exactKeys(sync, ROOT_KEYS);
  const compact: CompactSync = {
    version: sync.version,
    published:
      sync.published === null
        ? null
        : yield { work: compactPartWork(sync.published) },
    stage:
      sync.stage === null ? null : yield { work: compactPartWork(sync.stage) },
  };
  const full = yield {
    work: digestJsonWork(compact, HQ_LIVE_V2_COMPACT_BYTES),
  };
  const skeleton: SyncSkeleton = {
    version: sync.version,
    published: null,
    stage: null,
  };
  const groups: HqV2Group[] = [];
  const chunks = new Map<string, HqV2Chunk>();
  const ownedChunks = captureOwned ? new Map<string, Buffer>() : undefined;
  let refs = 0,
    groupTotal = 0;
  function* addGroup(
    part: "published" | "stage",
    kind: "entities" | "aux",
    value: unknown,
    bucket?: number
  ): CodecWork<void> {
    const chunkRefs: HqV2ChunkRef[] = [];
    const digest = createHash("sha256");
    let current = Buffer.allocUnsafe(HQ_LIVE_V2_CHUNK_BYTES),
      used = 0,
      byteCount = 0;
    function* flush(): CodecWork<void> {
      if (!used) return;
      if (++refs > HQ_LIVE_V2_MAX_REFS) invalid();
      const raw = current.subarray(0, used);
      const sha256 = yield { work: digestBufferWork(raw) };
      const id = chunkId(sourceFingerprint, sha256);
      chunkRefs.push({ id, sha256, byteCount: used });
      if (!chunks.has(id)) {
        const envelope = {
          format: "hq-live-sync-chunk-v2",
          sourceFingerprint,
          sha256,
          byteCount: used,
          data: raw.toString("base64"),
        };
        // Envelope is bounded to <1 MiB; never a full-state stringify.
        const fragments: string[] = [];
        for (const iterator = jsonFragments(envelope, true); ; ) {
          const next = iterator.next();
          if (next.done) break;
          const text = next.value;
          fragments.push(text);
          yield;
        }
        const serialized = fragments.join("");
        if (Buffer.byteLength(serialized) >= HQ_LIVE_V2_CHUNK_ROW_BYTES)
          invalid();
        chunks.set(id, { id, serialized });
        ownedChunks?.set(id, Buffer.from(raw));
      }
      current = Buffer.allocUnsafe(HQ_LIVE_V2_CHUNK_BYTES);
      used = 0;
    }
    for (const iterator = jsonFragments(value, true); ; ) {
      const next = iterator.next();
      if (next.done) break;
      const text = next.value;
      const raw = Buffer.from(text, "utf8");
      byteCount += raw.length;
      groupTotal += raw.length;
      if (groupTotal > HQ_LIVE_V2_COMPACT_BYTES) invalid();
      digest.update(raw);
      let offset = 0;
      while (offset < raw.length) {
        const count = Math.min(current.length - used, raw.length - offset);
        raw.copy(current, used, offset, offset + count);
        offset += count;
        used += count;
        if (used === current.length) yield { work: flush() };
      }
      yield;
    }
    yield { work: flush() };
    groups.push({
      part,
      kind,
      ...(kind === "entities" ? { bucket } : {}),
      byteCount,
      sha256: digest.digest("hex"),
      chunks: chunkRefs,
    });
  }
  for (const part of ["published", "stage"] as const) {
    const recordSet = compact[part];
    if (recordSet === null) continue;
    const pieces = splitPart(recordSet, part);
    skeleton[part] = pieces.skeleton as never;
    const buckets: Record<string, CompactRecord>[] = Array.from(
      { length: 16 },
      () => Object.create(null)
    );
    for (const [key, record] of Object.entries(recordSet.entities)) {
      const id = Number(key.slice(key.indexOf(":") + 1));
      buckets[id % 16][key] = record;
      yield;
    }
    for (let bucket = 0; bucket < 16; bucket++)
      if (Object.keys(buckets[bucket]).length)
        yield { work: addGroup(part, "entities", buckets[bucket], bucket) };
    yield { work: addGroup(part, "aux", pieces.aux) };
  }
  const manifest: HqV2Manifest = {
    format: "hq-live-sync-manifest-v2",
    codec: "canonical-record-v1",
    sourceFingerprint,
    syncVersion: sync.version,
    compactBytes: full.byteCount,
    expandedBytes: expanded.byteCount,
    sha256: full.sha256,
    sync: skeleton,
    groups,
  };
  yield {
    work: validateManifestWork(manifest, sync.version, sourceFingerprint),
  };
  return {
    manifest,
    chunks: Array.from(chunks.values()),
    ...(captureOwned
      ? { candidate: { state: sync, chunks: ownedChunks! } }
      : {}),
  };
}
export function encodeHqLiveV2Sync(
  sync: HqImplementedSyncState,
  sourceFingerprint: string
): { manifest: HqV2Manifest; chunks: HqV2Chunk[] } {
  try {
    return runSync(encodeSyncWork(sync, sourceFingerprint));
  } catch {
    return fail("HQ_V2_INVALID_STATE");
  }
}
export async function encodeHqLiveV2SyncAsync(
  sync: HqImplementedSyncState,
  sourceFingerprint: string,
  checkpoint: () => Promise<void>
): Promise<{ manifest: HqV2Manifest; chunks: HqV2Chunk[] }> {
  try {
    return await runAsync(encodeSyncWork(sync, sourceFingerprint), checkpoint);
  } catch {
    return fail("HQ_V2_INVALID_STATE");
  }
}
/** @internal Store-only capability. The candidate has no caller-input aliases:
 * it is captured during the capped strict expanded-byte traversal, then fully
 * validated and encoded by the same work. Chunk copies are the exact emitted
 * bytes, not a re-decode or hash-only assertion. Never expose this candidate. */
export async function encodeHqLiveV2SyncOwnedAsync(
  sync: HqImplementedSyncState,
  sourceFingerprint: string,
  checkpoint: () => Promise<void>
): Promise<{
  manifest: HqV2Manifest;
  chunks: HqV2Chunk[];
  candidate: { state: HqImplementedSyncState; chunks: Map<string, Buffer> };
}> {
  try {
    return (await runAsync(
      encodeSyncWork(sync, sourceFingerprint, true),
      checkpoint
    )) as {
      manifest: HqV2Manifest;
      chunks: HqV2Chunk[];
      candidate: { state: HqImplementedSyncState; chunks: Map<string, Buffer> };
    };
  } catch {
    return fail("HQ_V2_INVALID_STATE");
  }
}
function* decodeSyncWork(
  manifest: HqV2Manifest,
  chunks: ReadonlyMap<string, string>,
  sourceFingerprint: string
): CodecWork<HqImplementedSyncState> {
  yield {
    work: validateManifestWork(
      manifest,
      manifest?.syncVersion,
      sourceFingerprint
    ),
  };
  const refs = validatedRefs(manifest);
  if (chunks.size !== refs.length || refs.some(ref => !chunks.has(ref.id)))
    invalid();
  const compact: CompactSync = {
    version: manifest.syncVersion,
    published: null,
    stage: null,
  };
  const restored: HqImplementedSyncState = {
    version: manifest.syncVersion,
    published: null,
    stage: null,
  };
  const recordCounts = { published: 0, stage: 0 };
  let expandedBytes = (yield {
    work: digestJsonWork(manifest.sync, HQ_LIVE_V2_EXPANDED_BYTES),
  }).byteCount;
  const addExpandedBytes = (bytes: number) => {
    expandedBytes += bytes;
    if (
      expandedBytes > HQ_LIVE_V2_EXPANDED_BYTES ||
      expandedBytes > manifest.expandedBytes
    )
      invalid();
  };
  for (const part of ["published", "stage"] as const) {
    if (manifest.sync[part] === null) continue;
    // Clone bounded skeleton metadata; no returned records alias the manifest or the other part.
    const skeleton = structuredClone(manifest.sync[part]);
    compact[part] = { ...skeleton, entities: Object.create(null) };
    restored[part] = {
      ...structuredClone(skeleton),
      entities: Object.create(null),
    } as never;
    addExpandedBytes(Buffer.byteLength(',"entities":{}'));
  }
  for (const group of manifest.groups) {
    const raw = Buffer.allocUnsafe(group.byteCount);
    let offset = 0;
    for (const ref of group.chunks) {
      const bytes = yield {
        work: validateChunkWork(chunks.get(ref.id)!, ref, sourceFingerprint),
      };
      bytes.copy(raw, offset);
      offset += bytes.length;
      yield;
    }
    if (
      offset !== raw.length ||
      (yield { work: digestBufferWork(raw) }) !== group.sha256
    )
      invalid();
    // Fatal UTF-8 decoding AFTER reassembly: raw chunks can divide a codepoint.
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(raw);
    const value: unknown = JSON.parse(text);
    yield { work: canonicalBytesEqualWork(value, raw) };
    const part = compact[group.part]!;
    const restoredPart = restored[group.part]!;
    if (group.kind === "aux") {
      exactKeys(
        value,
        group.part === "published" ? ["seqProofs"] : GROUPED_STAGE_KEYS
      );
      if (
        !object(value.seqProofs) ||
        Object.keys(value.seqProofs).length > 100000
      )
        invalid();
      addExpandedBytes(raw.length - 1);
      Object.assign(part, value);
      Object.assign(restoredPart, structuredClone(value));
    } else {
      if (
        !object(value) ||
        Object.keys(value).length === 0 ||
        Object.keys(value).length > 100000
      )
        invalid();
      for (const [key, record] of Object.entries(value)) {
        exactKeys(record, ["canonicalPayload", "absent"]);
        if (
          typeof record.canonicalPayload !== "string" ||
          typeof record.absent !== "boolean"
        )
          invalid();
        const entity = validateHqWireEntity(
          JSON.parse(record.canonicalPayload)
        );
        // Canonical equality is EXACT, deliberately not a hash substitute.
        if (
          record.canonicalPayload !== canonicalHqJson(entity) ||
          key !== `${entity.entityType}:${entity.entityId}` ||
          entity.entityId % 16 !== group.bucket ||
          Object.hasOwn(part.entities, key)
        )
          invalid();
        if (++recordCounts[group.part] > 100000) invalid();
        const restoredRecord = {
          entity,
          canonicalPayload: record.canonicalPayload,
          absent: record.absent,
        };
        // Count this exact map entry (minus its temporary wrapper braces),
        // independently from compact bytes, before retaining the entity.
        addExpandedBytes(
          (yield {
            work: digestJsonWork(
              { [key]: restoredRecord },
              HQ_LIVE_V2_EXPANDED_BYTES
            ),
          }).byteCount -
            2 +
            Number(recordCounts[group.part] > 1)
        );
        part.entities[key] = record as unknown as CompactRecord;
        restoredPart.entities[key] = restoredRecord;
        yield;
      }
    }
  }
  const full = yield {
    work: digestJsonWork(compact, HQ_LIVE_V2_COMPACT_BYTES),
  };
  const expanded = yield {
    work: digestJsonWork(restored, HQ_LIVE_V2_EXPANDED_BYTES),
  };
  if (
    full.byteCount !== manifest.compactBytes ||
    full.sha256 !== manifest.sha256 ||
    expandedBytes !== manifest.expandedBytes ||
    expanded.byteCount !== manifest.expandedBytes
  )
    invalid();
  yield { validateState: restored, measuredBytes: expanded.byteCount };
  return restored;
}
export function decodeHqLiveV2Sync(
  manifest: HqV2Manifest,
  chunks: ReadonlyMap<string, string>,
  sourceFingerprint: string
): HqImplementedSyncState {
  try {
    return runSync(decodeSyncWork(manifest, chunks, sourceFingerprint));
  } catch {
    return fail("HQ_V2_INVALID_STATE");
  }
}
export async function decodeHqLiveV2SyncAsync(
  manifest: HqV2Manifest,
  chunks: ReadonlyMap<string, string>,
  sourceFingerprint: string,
  checkpoint: () => Promise<void>
): Promise<HqImplementedSyncState> {
  try {
    return await runAsync(
      decodeSyncWork(manifest, chunks, sourceFingerprint),
      checkpoint
    );
  } catch {
    return fail("HQ_V2_INVALID_STATE");
  }
}
