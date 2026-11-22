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
  | { status: "unavailable"; code: string; state: HqImplementedState | null };
export interface HqImplementedOptions {
  maxPages?: number;
  maxRecords?: number;
  maxStateBytes?: number;
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
function validContainer(value: HqImplementedSyncState | null) {
  if (!value) return;
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
      !validToken(value.published.resumeCursor) ||
      value.published.metadata.scope !== SCOPE)
  )
    fail("INVALID_PERSISTED_STATE");
  if (
    value.stage &&
    value.stage.basePublishedVersion !== (value.published?.version ?? null)
  )
    fail("STAGED_CHECKPOINT_MISMATCH");
  for (const recordSet of [value.published, value.stage]) {
    if (!recordSet) continue;
    if (!recordSet.metadata) fail("INVALID_PERSISTED_METADATA");
    validateHqWireStatus({ ...recordSet.metadata, ready: true });
    if (
      !recordSet.entities ||
      Array.isArray(recordSet.entities) ||
      !recordSet.seqProofs ||
      Array.isArray(recordSet.seqProofs)
    )
      fail("INVALID_PERSISTED_STATE");
    for (const [id, record] of Object.entries(recordSet.entities)) {
      const validated = validateHqWireEntity(record.entity);
      if (
        id !== key(validated.entityType, validated.entityId) ||
        typeof record.absent !== "boolean" ||
        record.canonicalPayload !== canonicalHqJson(validated)
      )
        fail("PERSISTED_RECORD_CONFLICT");
    }
    for (const [seq, proof] of Object.entries(recordSet.seqProofs))
      if (
        !/^[1-9][0-9]*$/.test(seq) ||
        !Number.isSafeInteger(Number(seq)) ||
        !/^[a-f0-9]{64}$/.test(proof)
      )
        fail("INVALID_REPLAY_PROOF");
  }
  const stage = value.stage;
  if (stage) {
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
      stage.cursors.some(c => typeof c !== "string" || c.length > 2080)
    )
      fail("INVALID_STAGED_PROGRESS");
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
        if (
          !Array.isArray(list) ||
          list.some(
            id =>
              typeof id !== "string" ||
              !id.startsWith(`${type}:`) ||
              !stage.entities[id]
          )
        )
          fail("INVALID_STAGED_MEMBERSHIP");
      }
  }
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
  function bounded(next: HqImplementedSyncState) {
    const stage = next.stage;
    if (stage && (stage.pages > maxPages || stage.recordsRead > maxRecords))
      fail(
        stage.pages > maxPages ? "PAGE_CAP_EXCEEDED" : "RECORD_CAP_EXCEEDED"
      );
    if (
      Object.keys(stage?.entities ?? next.published?.entities ?? {}).length >
      maxRecords
    )
      fail("STATE_RECORD_CAP_EXCEEDED");
    if (
      Object.keys(stage?.seqProofs ?? next.published?.seqProofs ?? {}).length >
      maxRecords
    )
      fail("REPLAY_PROOF_CAP_EXCEEDED");
    if (Buffer.byteLength(JSON.stringify(next)) > maxStateBytes)
      fail("STATE_BYTE_CAP_EXCEEDED");
  }
  async function write(
    current: HqImplementedSyncState | null,
    next: HqImplementedSyncState
  ) {
    bounded(next);
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
  function finishReconciliation(stage: HqImplementedStage) {
    for (const type of ["booking", "business"] as const) {
      const feed = new Set(stage.feedKeys[type]),
        catalogue = new Set(stage.catalogueKeys[type]);
      if (
        feed.size !== catalogue.size ||
        Array.from(feed).some(id => !catalogue.has(id))
      )
        fail("CATALOGUE_MEMBERSHIP_MISMATCH");
      for (const [id, record] of Object.entries(stage.entities))
        if (record.entity.entityType === type && !feed.has(id))
          record.absent = true;
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
        const actual = stage.feedKeys[type].filter(
          id => !isDeleted(stage.entities[id].entity)
        ).length;
        if (actual !== expected) fail("SOURCE_COUNT_MISMATCH");
      }
    }
  }
  async function ingest(
    requested: "backfill" | "catchup"
  ): Promise<HqImplementedResult> {
    let current: HqImplementedSyncState | null = null;
    try {
      current = await store.readSync();
      if (current) bounded(current);
      validContainer(current);
      const status = validateHqWireStatus(await reader.status());
      validateHqWireCapabilities(await reader.capabilities());
      if (!status.ready) fail("SOURCE_NOT_READY");
      if (current?.stage && current.stage.kind !== requested)
        fail("STAGED_MODE_MISMATCH");
      if (requested === "catchup" && !current?.published)
        fail("CHECKPOINT_REQUIRED");
      let stage = current?.stage
        ? copy(current.stage)
        : newStage(requested, current?.published ?? null);
      const published = current?.published ?? null;
      while (stage.phase !== "finish") {
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
          published,
          stage: copy(stage),
        };
        await write(current, next);
        current = next;
      }
      if (!stage.metadata || !stage.pendingResumeCursor)
        fail("INCOMPLETE_GENERATION");
      if (stage.kind === "backfill") finishReconciliation(stage);
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
        canonicalHqJson({ ...published, version: 0 }) ===
          canonicalHqJson({ ...nextPublished, version: 0 });
      if (unchanged) nextPublished.version = published!.version;
      const done: HqImplementedSyncState = {
        version: current!.version + 1,
        published: nextPublished,
        stage: null,
      };
      await write(current, done);
      return {
        status: "applied",
        state: copy(nextPublished),
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
                ].includes(candidate.code)
              ? candidate.code
              : "SOURCE_OR_STORE_UNAVAILABLE";
      // Re-read after a failed CAS: do not claim a superseded snapshot as the current last-good state.
      let latest: HqImplementedSyncState | null;
      try {
        latest = await store.readSync();
        validContainer(latest);
      } catch {
        return {
          status: "unavailable",
          code: "STORE_UNAVAILABLE",
          state: null,
        };
      }
      if (expired && latest?.stage) {
        try {
          await write(latest, {
            version: latest.version + 1,
            published: latest.published,
            stage: null,
          });
        } catch {
          return {
            status: "unavailable",
            code: "CAS_CONFLICT",
            state: latest.published,
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
        validContainer(current);
        if (current?.stage)
          await write(current, {
            version: current.version + 1,
            published: current.published,
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
        validContainer(current);
      } catch {
        return {
          status: "unavailable",
          code: "INVALID_PERSISTED_STATE",
          state: null,
        };
      }
      const mode =
        current?.stage?.kind ?? (current?.published ? "catchup" : "backfill");
      const result = await ingest(mode);
      // One bounded complete recovery. Persistent expiry/unavailability is surfaced, never looped.
      return result.status === "unavailable" && result.code === "SOURCE_EXPIRED"
        ? ingest("backfill")
        : result;
    },
  };
}
