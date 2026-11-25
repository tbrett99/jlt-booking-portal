import type {
  HqWireMetadata,
  HqWireEntity,
  HqWireChange,
  HqWireReader,
  HqWirePageQuery,
} from "../shared/management-hq-wire";
import {
  validateHqWireBookingPage,
  validateHqWireBusinessPage,
  validateHqWireCataloguePage,
  validateHqWireChangePage,
  validateHqWireStatus,
  validateHqWireCapabilities,
  validateHqWireEntity,
} from "./management-hq-wire-contract";
import { canonicalHqJson } from "./management-hq-engine";
import { createHash } from "node:crypto";

const SCOPE = "company_all_real_and_unattributed" as const;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
/** Shared CPU walks: legacy drains synchronously; opt-in awaits only caller checkpoints. */
function drain<T>(walk: Generator<void, T>): T {
  let step = walk.next();
  while (!step.done) step = walk.next();
  return step.value;
}
async function cooperate<T>(
  walk: Generator<void, T>,
  checkpoint: () => Promise<void>,
  invalidCode?: string
): Promise<T> {
  for (;;) {
    let step: IteratorResult<void, T>;
    try {
      step = walk.next();
    } catch (error) {
      if (invalidCode) fail(invalidCode);
      throw error;
    }
    if (step.done) return step.value;
    // Deliberately outside the validation catch: authority/lease denials are not bad JSON.
    await checkpoint();
  }
}
/** Exact canonical equality for JSON values, without allocating whole-state strings. */
function* canonicalEquality(
  left: unknown,
  right: unknown
): Generator<void, boolean> {
  const leftObject = left !== null && typeof left === "object";
  const rightObject = right !== null && typeof right === "object";
  if (!leftObject || !rightObject)
    return (
      leftObject === rightObject &&
      canonicalHqJson(left) === canonicalHqJson(right)
    );
  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length
    )
      return false;
    for (let index = 0; index < left.length; index++) {
      const child = canonicalEquality(left[index], right[index]);
      let step = child.next();
      while (!step.done) {
        yield;
        step = child.next();
      }
      if (!step.value) return false;
      yield;
    }
    return true;
  }
  const a = Object.keys(left as object).sort();
  const b = Object.keys(right as object).sort();
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const name = a[index];
    if (name !== b[index]) return false;
    const child = canonicalEquality(
      (left as Record<string, unknown>)[name],
      (right as Record<string, unknown>)[name]
    );
    let step = child.next();
    while (!step.done) {
      yield;
      step = child.next();
    }
    if (!step.value) return false;
    yield;
  }
  return true;
}
function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return drain(canonicalEquality(left, right));
}

const omittedJson = Symbol("omitted JSON value");
/** JSON.stringify/parse semantics for JSON snapshots, with bounded container walks.
 * Strings (including canonical payloads) are immutable and never reparsed as a stage.
 * Undefined object properties are omitted; array holes/undefined become null; -0 becomes 0.
 */
function* jsonCopy(
  input: unknown,
  ancestors = new Set<object>(),
  property = ""
): Generator<void, unknown> {
  let value = input;
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "bigint")
  ) {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") value = toJSON.call(value, property);
  }
  if (
    value instanceof Number ||
    value instanceof String ||
    value instanceof Boolean
  )
    value = value.valueOf();
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  if (typeof value === "bigint") return copy(value); // Native JSON error, not coercion.
  if (typeof value !== "object") return omittedJson;
  if (ancestors.has(value))
    throw new TypeError("Converting circular structure to JSON");
  ancestors.add(value);
  let out: unknown;
  if (property === "entities" && !Array.isArray(value)) {
    // Source entities already passed the bounded wire validator. Preserve native
    // JSON copying per record, never stringify/parse the whole retained entity map.
    const records: Record<string, unknown> = {};
    for (const name of Object.keys(value)) {
      const record = (value as Record<string, unknown>)[name];
      // The tiny wrapper preserves toJSON's property argument and native omission
      // semantics too, without serializing more than this one bounded record.
      const wrapper = JSON.parse(JSON.stringify({ [name]: record }));
      if (Object.hasOwn(wrapper, name))
        Object.defineProperty(records, name, {
          value: wrapper[name],
          enumerable: true,
          writable: true,
          configurable: true,
        });
      yield;
    }
    out = records;
  } else if (Array.isArray(value)) {
    const array: unknown[] = [];
    const length = value.length;
    for (let index = 0; index < length; index++) {
      const walk = jsonCopy(value[index], ancestors, String(index));
      let step = walk.next();
      while (!step.done) {
        yield;
        step = walk.next();
      }
      array.push(step.value === omittedJson ? null : step.value);
      yield;
    }
    out = array;
  } else {
    const object: Record<string, unknown> = {};
    for (const name of Object.keys(value)) {
      const walk = jsonCopy(
        (value as Record<string, unknown>)[name],
        ancestors,
        name
      );
      let step = walk.next();
      while (!step.done) {
        yield;
        step = walk.next();
      }
      if (step.value !== omittedJson)
        Object.defineProperty(object, name, {
          value: step.value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      yield;
    }
    out = object;
  }
  ancestors.delete(value);
  return out;
}
async function cooperativeJsonCopy<T>(
  value: T,
  checkpoint: () => Promise<void>,
  property = ""
): Promise<T> {
  await checkpoint();
  const result = await cooperate(
    jsonCopy(value, new Set(), property),
    checkpoint
  );
  if (result === omittedJson) return copy(value);
  await checkpoint();
  return result as T;
}
/** Pure cooperative JSON.parse(JSON.stringify(value)) copy for validated JSON snapshots.
 * No mutable subobjects are shared. Caller must hold the input stable across awaits;
 * this is not an atomic snapshot of a concurrently mutable caller-owned object.
 */
export async function cloneHqJsonAsync<T>(
  value: T,
  checkpoint: () => Promise<void>
): Promise<T> {
  return cooperativeJsonCopy(value, checkpoint);
}
type EntityType = "booking" | "business";
type Phase =
  | "bookings"
  | "business"
  | "catalogue_booking"
  | "catalogue_business"
  | "changes"
  | "finish";
export interface HqImplementedRecord {
  entity: HqWireEntity;
  canonicalPayload: string;
  absent: boolean;
}
export interface HqImplementedState {
  wireVersion: "1.0.0";
  version: number;
  scope: typeof SCOPE;
  /** Only a fully applied checkpoint. Never a traversal token or an inferred sequence cursor. */
  resumeCursor: string;
  metadata: HqWireMetadata;
  entities: Record<string, HqImplementedRecord>;
  /** Retained event conflict proofs; seq is independent of revision. */
  seqProofs: Record<string, string>;
}
export interface HqImplementedStage {
  kind: "backfill" | "catchup";
  phase: Phase;
  basePublishedVersion: number | null;
  metadata: HqWireMetadata | null;
  cursor: string | null;
  pendingResumeCursor: string | null;
  entities: Record<string, HqImplementedRecord>;
  seqProofs: Record<string, string>;
  feedKeys: Record<EntityType, string[]>;
  catalogueKeys: Record<EntityType, string[]>;
  cursors: string[];
  pages: number;
  recordsRead: number;
  lastSeq: number | null;
}
export interface HqImplementedSyncState {
  version: number;
  published: HqImplementedState | null;
  stage: HqImplementedStage | null;
}
export interface HqImplementedStore {
  /** Store this entire container durably; staging must never replace the visible published view. */
  readSync(): Promise<HqImplementedSyncState | null>;
  /** Atomic record/staging/checkpoint CAS, scoped to the reporting dataset. */
  compareAndSwapSync(
    expectedVersion: number | null,
    next: HqImplementedSyncState
  ): Promise<boolean>;
}
export type HqImplementedResult =
  | {
      status: "applied";
      state: HqImplementedState;
      pages: number;
      recordsRead: number;
      unchanged: boolean;
    }
  | {
      status: "yielded";
      code: "BATCH_YIELDED";
      state: HqImplementedState | null;
    }
  | { status: "unavailable"; code: string; state: HqImplementedState | null };
export interface HqImplementedOptions {
  maxPages?: number;
  maxRecords?: number;
  maxStateBytes?: number;
  /** Server-owned storage profile; counts exact UTF-8 JSON bytes without another giant string. */
  measureStateBytes?: (value: unknown, maximum: number) => number;
  /** Opt-in CPU handoff; caller owns macrotask yielding and fresh authority/config/lease fences. */
  cooperativeCheckpoint?: () => Promise<void>;
  /** Exact JSON UTF-8 byte profile for the cooperative path; rejection is not swallowed. */
  measureStateBytesAsync?: (value: unknown, maximum: number) => Promise<number>;
  /** Invocation budget, checked before EACH source method; generation caps remain cumulative. */
  shouldContinue?: () => boolean | Promise<boolean>;
}
class SyncError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const fail = (code: string): never => {
  throw new SyncError(code);
};
const key = (type: EntityType, id: number) => `${type}:${id}`;
function metadata(page: HqWireMetadata): HqWireMetadata {
  const {
    generationId,
    projectionVersion,
    scope,
    sourceObservationWindow,
    publishedAt,
    expiresAt,
    changeUpper,
    sourceAgeSeconds,
    freshnessTargetSeconds,
    stale,
    consistency,
    counts,
  } = page;
  return copy({
    generationId,
    projectionVersion,
    scope,
    sourceObservationWindow,
    publishedAt,
    expiresAt,
    changeUpper,
    sourceAgeSeconds,
    freshnessTargetSeconds,
    stale,
    consistency,
    counts,
  });
}
function stableMetadata(value: HqWireMetadata) {
  const { sourceAgeSeconds: _age, stale: _stale, ...stable } = value;
  return canonicalHqJson(stable);
}
function bind(stage: HqImplementedStage, page: HqWireMetadata) {
  const incoming = metadata(page);
  if (incoming.scope !== SCOPE) fail("SOURCE_SCOPE_MISMATCH");
  if (
    stage.metadata &&
    stableMetadata(stage.metadata) !== stableMetadata(incoming)
  )
    fail("GENERATION_METADATA_DRIFT");
  stage.metadata = incoming; // Age/stale are observation-health values, not generation identity.
}
function apply(stage: HqImplementedStage, entity: HqWireEntity) {
  const id = key(entity.entityType, entity.entityId),
    old = stage.entities[id];
  const canonicalPayload = canonicalHqJson(entity);
  if (old) {
    if (entity.revision < old.entity.revision) fail("STALE_REVISION");
    if (
      entity.revision === old.entity.revision &&
      canonicalPayload !== old.canonicalPayload
    )
      fail("REVISION_CONFLICT");
  }
  stage.entities[id] = {
    entity: copy(entity),
    canonicalPayload,
    absent: false,
  };
}
function isDeleted(entity: HqWireEntity) {
  return (entity.payload as { deleted?: unknown }).deleted === true;
}
function newStage(
  kind: "backfill" | "catchup",
  published: HqImplementedState | null
): HqImplementedStage {
  return {
    kind,
    phase: kind === "backfill" ? "bookings" : "changes",
    basePublishedVersion: published?.version ?? null,
    metadata: null,
    cursor: kind === "catchup" ? published!.resumeCursor : null,
    pendingResumeCursor: null,
    entities: copy(published?.entities ?? {}),
    seqProofs: kind === "backfill" ? {} : copy(published?.seqProofs ?? {}),
    feedKeys: { booking: [], business: [] },
    catalogueKeys: { booking: [], business: [] },
    cursors: [],
    pages: 0,
    recordsRead: 0,
    lastSeq: null,
  };
}
function* containerValidation(
  value: HqImplementedSyncState | null
): Generator<void, void> {
  if (!value) return;
  const object = (v: unknown) =>
    !!v && typeof v === "object" && !Array.isArray(v);
  if (
    !object(value) ||
    !Object.hasOwn(value, "published") ||
    !Object.hasOwn(value, "stage") ||
    (value.published !== null && !object(value.published)) ||
    (value.stage !== null && !object(value.stage))
  )
    fail("INVALID_PERSISTED_STATE");
  const validToken = (v: unknown): v is string =>
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= 2048 &&
    !/[\u0000-\u001f\u007f]/.test(v);
  if (!Number.isSafeInteger(value.version) || value.version < 1)
    fail("INVALID_PERSISTED_STATE");
  if (
    value.published &&
    (value.published.wireVersion !== "1.0.0" ||
      value.published.scope !== SCOPE ||
      !Number.isSafeInteger(value.published.version) ||
      value.published.version < 1 ||
      value.published.version > value.version ||
      !validToken(value.published.resumeCursor) ||
      value.published.metadata.scope !== SCOPE)
  )
    fail("INVALID_PERSISTED_STATE");
  if (
    value.stage &&
    value.stage.basePublishedVersion !== (value.published?.version ?? null)
  )
    fail("STAGED_CHECKPOINT_MISMATCH");
  const initialStage = value.stage?.metadata === null;
  if (initialStage) {
    const stage = value.stage!;
    if (
      stage.kind !== "backfill" ||
      stage.phase !== "bookings" ||
      stage.pages !== 0 ||
      stage.recordsRead !== 0 ||
      stage.cursor !== null ||
      stage.pendingResumeCursor !== null ||
      stage.lastSeq !== null ||
      JSON.stringify(stage.cursors) !== "[]" ||
      canonicalHqJson(stage.feedKeys) !==
        canonicalHqJson({ booking: [], business: [] }) ||
      canonicalHqJson(stage.catalogueKeys) !==
        canonicalHqJson({ booking: [], business: [] })
    )
      fail("INVALID_STAGED_PROGRESS");
    const equality = canonicalEquality(
      stage.entities,
      value.published?.entities ?? {}
    );
    let equalityStep = equality.next();
    while (!equalityStep.done) {
      yield;
      equalityStep = equality.next();
    }
    if (!equalityStep.value || canonicalHqJson(stage.seqProofs) !== "{}")
      fail("INVALID_STAGED_PROGRESS");
  }
  for (const recordSet of [value.published, value.stage]) {
    if (!recordSet) continue;
    if (recordSet === value.stage && initialStage) continue;
    if (!recordSet.metadata) fail("INVALID_PERSISTED_METADATA");
    validateHqWireStatus({ ...recordSet.metadata, ready: true });
    if (!object(recordSet.entities) || !object(recordSet.seqProofs))
      fail("INVALID_PERSISTED_STATE");
    for (const id of Object.keys(recordSet.entities)) {
      const record = recordSet.entities[id];
      const validated = validateHqWireEntity(record.entity);
      if (
        id !== key(validated.entityType, validated.entityId) ||
        typeof record.absent !== "boolean" ||
        record.canonicalPayload !== canonicalHqJson(validated)
      )
        fail("PERSISTED_RECORD_CONFLICT");
      yield;
    }
    for (const seq of Object.keys(recordSet.seqProofs)) {
      const proof = recordSet.seqProofs[seq];
      if (
        !/^[1-9][0-9]*$/.test(seq) ||
        !Number.isSafeInteger(Number(seq)) ||
        Number(seq) > recordSet.metadata!.changeUpper ||
        typeof proof !== "string" ||
        !/^[a-f0-9]{64}$/.test(proof)
      )
        fail("INVALID_REPLAY_PROOF");
      yield;
    }
    yield;
  }
  const stage = value.stage;
  if (stage && !initialStage) {
    if (
      !["backfill", "catchup"].includes(stage.kind) ||
      ![
        "bookings",
        "business",
        "catalogue_booking",
        "catalogue_business",
        "changes",
        "finish",
      ].includes(stage.phase) ||
      (stage.kind === "backfill" && stage.phase === "changes") ||
      (stage.kind === "catchup" &&
        stage.phase !== "changes" &&
        stage.phase !== "finish")
    )
      fail("INVALID_STAGED_PROGRESS");
    if (
      !Number.isSafeInteger(stage.pages) ||
      stage.pages < 1 ||
      !Number.isSafeInteger(stage.recordsRead) ||
      stage.recordsRead < 0 ||
      !validToken(stage.pendingResumeCursor) ||
      (stage.cursor !== null && !validToken(stage.cursor)) ||
      !Array.isArray(stage.cursors) ||
      stage.cursors.length > stage.pages ||
      !object(stage.feedKeys) ||
      !object(stage.catalogueKeys)
    )
      fail("INVALID_STAGED_PROGRESS");
    const cursorSet = new Set<unknown>();
    for (const cursor of stage.cursors) {
      cursorSet.add(cursor);
      yield;
    }
    if (cursorSet.size !== stage.cursors.length)
      fail("INVALID_STAGED_PROGRESS");
    for (let index = 0; index < stage.cursors.length; index++) {
      // Match Array.some's sparse-array semantics in the legacy validator exactly.
      if (index in stage.cursors) {
        const c = stage.cursors[index];
        if (
          typeof c !== "string" ||
          c.length > 2080 ||
          /[\u0000-\u001f\u007f]/.test(c)
        )
          fail("INVALID_STAGED_PROGRESS");
      }
      yield;
    }
    if (
      stage.lastSeq !== null &&
      (!Number.isSafeInteger(stage.lastSeq) ||
        stage.lastSeq < 1 ||
        stage.lastSeq > stage.metadata!.changeUpper ||
        !stage.seqProofs[String(stage.lastSeq)])
    )
      fail("INVALID_STAGED_SEQUENCE");
    for (const type of ["booking", "business"] as const)
      for (const list of [stage.feedKeys[type], stage.catalogueKeys[type]]) {
        if (!Array.isArray(list)) fail("INVALID_STAGED_MEMBERSHIP");
        const unique = new Set<unknown>();
        for (const id of list) {
          unique.add(id);
          yield;
        }
        if (unique.size !== list.length) fail("INVALID_STAGED_MEMBERSHIP");
        for (let index = 0; index < list.length; index++) {
          if (index in list) {
            const id = list[index];
            if (
              typeof id !== "string" ||
              !id.startsWith(`${type}:`) ||
              !stage.entities[id]
            )
              fail("INVALID_STAGED_MEMBERSHIP");
          }
          yield;
        }
      }
  }
}
function validContainer(value: HqImplementedSyncState | null) {
  drain(containerValidation(value));
}
type ValidationOptions = Pick<
  HqImplementedOptions,
  | "maxPages"
  | "maxRecords"
  | "maxStateBytes"
  | "measureStateBytes"
  | "measureStateBytesAsync"
>;
function validationCaps(options: ValidationOptions) {
  const maxPages = options.maxPages ?? 1000;
  const maxRecords = options.maxRecords ?? 100000;
  const maxBytes = options.maxStateBytes ?? 16 * 1024 * 1024;
  if (
    [maxPages, maxRecords, maxBytes].some(
      v => !Number.isSafeInteger(v) || v < 1
    )
  )
    fail("INVALID_PERSISTED_STATE");
  return { maxPages, maxRecords, maxBytes };
}
function* stateValidation(
  value: unknown,
  maxPages: number,
  maxRecords: number
): Generator<void, void> {
  if (value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("INVALID_PERSISTED_STATE");
  const state = value as HqImplementedSyncState;
  const container = containerValidation(state);
  let step = container.next();
  while (!step.done) {
    yield;
    step = container.next();
  }
  for (const part of [state.published, state.stage]) {
    if (!part) continue;
    for (const map of [part.entities, part.seqProofs]) {
      let count = 0;
      for (const name of Object.keys(map)) {
        if (++count > maxRecords) fail("INVALID_PERSISTED_STATE");
        yield;
      }
    }
  }
  if (
    state.stage &&
    (state.stage.pages > maxPages || state.stage.recordsRead > maxRecords)
  )
    fail("INVALID_PERSISTED_STATE");
}
/** Read/report boundary validator. No mutation, provider calls or partial-state salvage. */
export function validateHqImplementedSyncState(
  value: unknown,
  options: Pick<
    HqImplementedOptions,
    "maxPages" | "maxRecords" | "maxStateBytes" | "measureStateBytes"
  > = {}
): asserts value is HqImplementedSyncState | null {
  try {
    const { maxPages, maxRecords, maxBytes } = validationCaps(options);
    const bytes = options.measureStateBytes
      ? options.measureStateBytes(value, maxBytes)
      : Buffer.byteLength(JSON.stringify(value));
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxBytes)
      fail("INVALID_PERSISTED_STATE");
    drain(stateValidation(value, maxPages, maxRecords));
  } catch {
    fail("INVALID_PERSISTED_STATE");
  }
}
/** Same pure validation/byte acceptance as the synchronous export.
 * Checkpoint and async-measure rejection propagate unchanged, so the owner can latch denials.
 * Supply an exact cooperative byte measurer to avoid the legacy whole-state stringify fallback.
 */
export async function validateHqImplementedSyncStateAsync(
  value: unknown,
  options: ValidationOptions,
  checkpoint: () => Promise<void>
): Promise<void> {
  let caps: ReturnType<typeof validationCaps>;
  try {
    caps = validationCaps(options);
  } catch {
    return fail("INVALID_PERSISTED_STATE");
  }
  await checkpoint();
  let bytes: number;
  if (options.measureStateBytesAsync) {
    bytes = await options.measureStateBytesAsync(value, caps.maxBytes);
  } else {
    try {
      bytes = options.measureStateBytes
        ? options.measureStateBytes(value, caps.maxBytes)
        : Buffer.byteLength(JSON.stringify(value));
    } catch {
      return fail("INVALID_PERSISTED_STATE");
    }
  }
  await checkpoint();
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > caps.maxBytes)
    fail("INVALID_PERSISTED_STATE");
  await cooperate(
    stateValidation(value, caps.maxPages, caps.maxRecords),
    checkpoint,
    "INVALID_PERSISTED_STATE"
  );
}
export function createHqImplementedMemoryStore(
  initial: HqImplementedSyncState | null = null
): HqImplementedStore {
  let state = copy(initial);
  return {
    async readSync() {
      return copy(state);
    },
    async compareAndSwapSync(expected, next) {
      if ((state?.version ?? null) !== expected) return false;
      state = copy(next);
      return true;
    },
  };
}

/** No scheduling, database, credentials or operational writes. Callers supply a scoped durable store. */
export function createHqImplementedEngine(
  reader: HqWireReader,
  store: HqImplementedStore,
  options: HqImplementedOptions = {}
) {
  const maxPages = options.maxPages ?? 1000,
    maxRecords = options.maxRecords ?? 100000,
    maxStateBytes = options.maxStateBytes ?? 16 * 1024 * 1024;
  for (const value of [maxPages, maxRecords, maxStateBytes])
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error("Invalid HQ ingestion cap");
  const checkpoint = options.cooperativeCheckpoint;
  const clone = async <T>(value: T, property = ""): Promise<T> => {
    if (!checkpoint) return copy(value);
    return cooperativeJsonCopy(value, checkpoint, property);
  };
  const validate = async (value: HqImplementedSyncState | null) => {
    // Engine boundaries historically validate the container, then apply their own
    // named generation/record/byte caps. Keep those exact errors and ordering;
    // the exported report validator additionally applies its INVALID-state caps.
    if (checkpoint) await cooperate(containerValidation(value), checkpoint);
    else validContainer(value);
  };
  const createStage = async (
    kind: "backfill" | "catchup",
    published: HqImplementedState | null
  ) => {
    if (!checkpoint) return newStage(kind, published);
    return {
      ...newStage("backfill", null),
      kind,
      phase: kind === "backfill" ? "bookings" : "changes",
      basePublishedVersion: published?.version ?? null,
      cursor: kind === "catchup" ? published!.resumeCursor : null,
      entities: await clone(published?.entities ?? {}, "entities"),
      seqProofs:
        kind === "backfill" ? {} : await clone(published?.seqProofs ?? {}),
    } as HqImplementedStage;
  };
  function* bounds(next: HqImplementedSyncState): Generator<void, void> {
    const stage = next.stage;
    if (stage && (stage.pages > maxPages || stage.recordsRead > maxRecords))
      fail(
        stage.pages > maxPages ? "PAGE_CAP_EXCEEDED" : "RECORD_CAP_EXCEEDED"
      );
    for (const [map, code] of [
      [
        stage?.entities ?? next.published?.entities ?? {},
        "STATE_RECORD_CAP_EXCEEDED",
      ],
      [
        stage?.seqProofs ?? next.published?.seqProofs ?? {},
        "REPLAY_PROOF_CAP_EXCEEDED",
      ],
    ] as const) {
      let count = 0;
      for (const name of Object.keys(map)) {
        if (++count > maxRecords) fail(code);
        yield;
      }
    }
  }
  function bounded(next: HqImplementedSyncState) {
    drain(bounds(next));
    let bytes: number;
    try {
      bytes = options.measureStateBytes
        ? options.measureStateBytes(next, maxStateBytes)
        : Buffer.byteLength(JSON.stringify(next));
    } catch {
      return fail("STATE_BYTE_CAP_EXCEEDED");
    }
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxStateBytes)
      fail("STATE_BYTE_CAP_EXCEEDED");
  }
  async function boundedAsync(next: HqImplementedSyncState) {
    if (!checkpoint) return bounded(next);
    await cooperate(bounds(next), checkpoint);
    await checkpoint();
    let bytes: number;
    if (options.measureStateBytesAsync) {
      bytes = await options.measureStateBytesAsync(next, maxStateBytes);
    } else {
      try {
        bytes = options.measureStateBytes
          ? options.measureStateBytes(next, maxStateBytes)
          : Buffer.byteLength(JSON.stringify(next));
      } catch {
        return fail("STATE_BYTE_CAP_EXCEEDED");
      }
    }
    await checkpoint();
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxStateBytes)
      fail("STATE_BYTE_CAP_EXCEEDED");
  }
  async function write(
    current: HqImplementedSyncState | null,
    next: HqImplementedSyncState
  ) {
    await boundedAsync(next);
    if (!Number.isSafeInteger(next.version)) fail("STATE_VERSION_OVERFLOW");
    if (!(await store.compareAndSwapSync(current?.version ?? null, next)))
      fail("CAS_CONFLICT");
  }
  function query(stage: HqImplementedStage): HqWirePageQuery {
    return stage.cursor
      ? { cursor: stage.cursor, limit: 100 }
      : stage.metadata
        ? { generationId: stage.metadata.generationId, limit: 100 }
        : { limit: 100 };
  }
  function* reconciliation(stage: HqImplementedStage): Generator<void, void> {
    for (const type of ["booking", "business"] as const) {
      const feed = new Set<string>(),
        catalogue = new Set<string>();
      for (const id of stage.feedKeys[type]) {
        feed.add(id);
        yield;
      }
      for (const id of stage.catalogueKeys[type]) {
        catalogue.add(id);
        yield;
      }
      if (feed.size !== catalogue.size) fail("CATALOGUE_MEMBERSHIP_MISMATCH");
      const members = feed.values();
      for (let member = members.next(); !member.done; member = members.next()) {
        if (!catalogue.has(member.value)) fail("CATALOGUE_MEMBERSHIP_MISMATCH");
        yield;
      }
      for (const id of Object.keys(stage.entities)) {
        const record = stage.entities[id];
        if (record.entity.entityType === type && !feed.has(id))
          record.absent = true;
        yield;
      }
    }
    // Counts are diagnostics; only enforce supplied, explicitly understood current-live counts.
    for (const [type, countName] of [
      ["booking", "bookingCount"],
      ["business", "businessCount"],
    ] as const) {
      const expected = (stage.metadata!.counts as Record<string, unknown>)[
        countName
      ];
      if (expected !== undefined) {
        if (!Number.isSafeInteger(expected) || (expected as number) < 0)
          fail("INVALID_SOURCE_COUNTS");
        let actual = 0;
        for (let index = 0; index < stage.feedKeys[type].length; index++) {
          if (
            index in stage.feedKeys[type] &&
            !isDeleted(stage.entities[stage.feedKeys[type][index]].entity)
          )
            actual++;
          yield;
        }
        if (actual !== expected) fail("SOURCE_COUNT_MISMATCH");
      }
    }
  }
  async function ingest(
    requested: "backfill" | "catchup",
    controlledExpiry = false,
    initial?: { current: HqImplementedSyncState | null }
  ): Promise<HqImplementedResult> {
    let current: HqImplementedSyncState | null = null;
    try {
      current = initial ? initial.current : await store.readSync();
      if (current) await boundedAsync(current);
      if (!initial) await validate(current);
      const canContinue = async () =>
        !options.shouldContinue || (await options.shouldContinue());
      const yielded = async (): Promise<HqImplementedResult> => ({
        status: "yielded",
        code: "BATCH_YIELDED",
        state: await clone(current?.published ?? null),
      });
      if (!(await canContinue())) return await yielded();
      const status = validateHqWireStatus(await reader.status());
      if (!(await canContinue())) return await yielded();
      validateHqWireCapabilities(await reader.capabilities());
      if (!status.ready) fail("SOURCE_NOT_READY");
      if (current?.stage && current.stage.kind !== requested)
        fail("STAGED_MODE_MISMATCH");
      if (requested === "catchup" && !current?.published)
        fail("CHECKPOINT_REQUIRED");
      let stage = current?.stage
        ? await clone(current.stage)
        : await createStage(requested, current?.published ?? null);
      const published = current?.published ?? null;
      while (stage.phase !== "finish") {
        if (!(await canContinue())) return await yielded();
        if (stage.pages >= maxPages) fail("PAGE_CAP_EXCEEDED");
        let page: {
          nextCursor: string | null;
          resumeCursor: string;
          complete: boolean;
          items: unknown[];
        } & HqWireMetadata;
        const phase = stage.phase;
        if (phase === "bookings")
          page = validateHqWireBookingPage(await reader.bookings(query(stage)));
        else if (phase === "business")
          page = validateHqWireBusinessPage(
            await reader.businessMappings(query(stage))
          );
        else if (
          phase === "catalogue_booking" ||
          phase === "catalogue_business"
        )
          page = validateHqWireCataloguePage(
            await reader.catalogue(
              phase === "catalogue_booking" ? "booking" : "business",
              query(stage)
            )
          );
        else
          page = validateHqWireChangePage(
            await reader.changes(stage.cursor!, 100)
          );
        bind(stage, page);
        if (
          published &&
          (page.generationId < published.metadata.generationId ||
            page.changeUpper < published.metadata.changeUpper)
        )
          fail("GENERATION_REGRESSION");
        if (page.complete !== (page.nextCursor === null))
          fail("PAGINATION_INCONSISTENT");
        stage.pages++;
        stage.recordsRead += page.items.length;
        if (stage.recordsRead > maxRecords) fail("RECORD_CAP_EXCEEDED");
        const expectedType: EntityType | null =
          phase === "bookings" || phase === "catalogue_booking"
            ? "booking"
            : phase === "business" || phase === "catalogue_business"
              ? "business"
              : null;
        for (const raw of page.items) {
          const item = raw as HqWireEntity;
          if (expectedType && item.entityType !== expectedType)
            fail("ENDPOINT_ENTITY_MISMATCH");
          const id = key(item.entityType, item.entityId);
          if (phase === "catalogue_booking" || phase === "catalogue_business") {
            const existing = stage.entities[id];
            if (
              !existing ||
              !stage.feedKeys[item.entityType].includes(id) ||
              existing.entity.revision !== item.revision
            )
              fail("CATALOGUE_REVISION_MISMATCH");
            if (stage.catalogueKeys[item.entityType].includes(id))
              fail("DUPLICATE_CATALOGUE_ENTRY");
            stage.catalogueKeys[item.entityType].push(id);
          } else if (phase === "changes") {
            const change = raw as HqWireChange;
            if (change.seq > page.changeUpper) fail("CHANGE_UPPER_EXCEEDED");
            const proof = createHash("sha256")
                .update(canonicalHqJson(change))
                .digest("hex"),
              oldProof = stage.seqProofs[String(change.seq)];
            if (oldProof !== undefined && oldProof !== proof)
              fail("SEQUENCE_CONFLICT");
            if (stage.lastSeq !== null && change.seq < stage.lastSeq)
              fail("SEQUENCE_REGRESSION");
            if (
              published &&
              change.seq <= published.metadata.changeUpper &&
              oldProof === undefined
            )
              fail("REPLAY_BEFORE_CHECKPOINT");
            stage.lastSeq = change.seq;
            stage.seqProofs[String(change.seq)] = proof;
            if (
              !(
                published &&
                change.seq <= published.metadata.changeUpper &&
                oldProof === proof
              )
            ) {
              // Shape/type/key consistency has already passed the wire validator.
              apply(stage, {
                entityType: change.entityType,
                entityId: change.entityId,
                revision: change.revision,
                payload: change.payload,
              } as HqWireEntity);
            }
          } else {
            apply(stage, item);
            if (!stage.feedKeys[item.entityType].includes(id))
              stage.feedKeys[item.entityType].push(id);
          }
          if (checkpoint) await checkpoint();
        }
        if (page.nextCursor !== null) {
          const cursorKey = `${phase}:${page.nextCursor}`;
          if (
            stage.cursors.includes(cursorKey) ||
            page.nextCursor === stage.cursor
          )
            fail("CURSOR_LOOP");
          stage.cursors.push(cursorKey);
          stage.cursor = page.nextCursor;
        } else {
          stage.cursor = null;
          stage.phase =
            phase === "bookings"
              ? "business"
              : phase === "business"
                ? "catalogue_booking"
                : phase === "catalogue_booking"
                  ? "catalogue_business"
                  : "finish";
        }
        // This field is explicitly pending: visible checkpoint remains unchanged until final publication.
        stage.pendingResumeCursor = page.resumeCursor;
        const next: HqImplementedSyncState = {
          version: (current?.version ?? 0) + 1,
          published: checkpoint ? await clone(published) : published,
          stage: await clone(stage),
        };
        await write(current, next);
        current = next;
      }
      if (!stage.metadata || !stage.pendingResumeCursor)
        fail("INCOMPLETE_GENERATION");
      if (stage.kind === "backfill") {
        if (checkpoint) await cooperate(reconciliation(stage), checkpoint);
        else drain(reconciliation(stage));
      }
      const nextPublished: HqImplementedState = {
        wireVersion: "1.0.0",
        version: (published?.version ?? 0) + 1,
        scope: SCOPE,
        resumeCursor: stage.pendingResumeCursor!,
        metadata: stage.metadata!,
        entities: stage.entities,
        seqProofs: stage.seqProofs,
      };
      const unchanged =
        published !== null &&
        (checkpoint
          ? await cooperate(
              canonicalEquality(
                { ...published, version: 0 },
                { ...nextPublished, version: 0 }
              ),
              checkpoint
            )
          : sameCanonicalJson(
              { ...published, version: 0 },
              { ...nextPublished, version: 0 }
            ));
      if (unchanged) nextPublished.version = published!.version;
      const done: HqImplementedSyncState = {
        version: current!.version + 1,
        published: checkpoint ? await clone(nextPublished) : nextPublished,
        stage: null,
      };
      await write(current, done);
      return {
        status: "applied",
        state: await clone(nextPublished),
        pages: stage.pages,
        recordsRead: stage.recordsRead,
        unchanged,
      };
    } catch (error) {
      const candidate = error as { code?: unknown; status?: unknown };
      const expired =
        candidate?.status === 410 || candidate?.code === "RESTART_REQUIRED";
      const code =
        error instanceof SyncError
          ? error.code
          : expired
            ? "SOURCE_EXPIRED"
            : typeof candidate?.code === "string" &&
                [
                  "AUTH_DENIED",
                  "INVALID_QUERY",
                  "RATE_LIMITED",
                  "UNAVAILABLE",
                  "TIMEOUT",
                  "CLIENT_DISABLED",
                  "INVALID_PAYLOAD",
                  "PAYLOAD_TOO_LARGE",
                  "CONTRACT_VERSION_MISMATCH",
                  "INVALID_SEMANTICS",
                  "SCOPE_MISMATCH",
                  "REDIRECT_REJECTED",
                  "TRANSPORT_FAILURE",
                  "LEASE_LOST",
                  "SOURCE_BINDING_CHANGED",
                  "INVALID_PERSISTED_STATE",
                ].includes(candidate.code)
              ? candidate.code
              : "SOURCE_OR_STORE_UNAVAILABLE";
      // Re-read after a failed CAS: do not claim a superseded snapshot as the current last-good state.
      let latest: HqImplementedSyncState | null;
      try {
        latest = await store.readSync();
        await validate(latest);
      } catch {
        return {
          status: "unavailable",
          code: "STORE_UNAVAILABLE",
          state: null,
        };
      }
      if (expired && (controlledExpiry || latest?.stage)) {
        try {
          // Controlled sync recovery replaces expired staging AND records the backfill decision
          // in one CAS, before another source call or budget yield. Direct legacy calls still clear it.
          const next: HqImplementedSyncState = {
            version: (latest?.version ?? 0) + 1,
            published: checkpoint
              ? await clone(latest?.published ?? null)
              : (latest?.published ?? null),
            stage: controlledExpiry
              ? await createStage("backfill", latest?.published ?? null)
              : null,
          };
          await validate(next);
          await write(latest, next);
        } catch {
          return {
            status: "unavailable",
            code: "CAS_CONFLICT",
            state: latest?.published ?? null,
          };
        }
      }
      return { status: "unavailable", code, state: latest?.published ?? null };
    }
  }
  return {
    backfill: () => ingest("backfill"),
    catchup: () => ingest("catchup"),
    async restartBackfill(): Promise<HqImplementedResult> {
      try {
        const current = await store.readSync();
        await validate(current);
        if (current?.stage)
          await write(current, {
            version: current.version + 1,
            published: checkpoint
              ? await clone(current.published)
              : current.published,
            stage: null,
          });
      } catch {
        return {
          status: "unavailable",
          code: "STORE_UNAVAILABLE",
          state: null,
        };
      }
      return ingest("backfill");
    },
    async sync(): Promise<HqImplementedResult> {
      let current: HqImplementedSyncState | null;
      try {
        current = await store.readSync();
        await validate(current);
      } catch {
        return {
          status: "unavailable",
          code: "INVALID_PERSISTED_STATE",
          state: null,
        };
      }
      const mode =
        current?.stage?.kind ?? (current?.published ? "catchup" : "backfill");
      const result = await ingest(mode, true, { current });
      // One bounded complete recovery. Persistent expiry/unavailability is surfaced, never looped.
      if (result.status !== "unavailable" || result.code !== "SOURCE_EXPIRED")
        return result;
      return ingest("backfill");
    },
  };
}
