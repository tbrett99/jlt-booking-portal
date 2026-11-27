import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type {
  Pool,
  PoolConnection,
  RowDataPacket,
  ResultSetHeader,
} from "mysql2/promise";
import {
  cloneHqJsonAsync,
  validateHqImplementedSyncState,
  validateHqImplementedSyncStateAsync,
  type HqImplementedState,
  type HqImplementedStore,
  type HqImplementedSyncState,
} from "./management-hq-ingestion";
import type { HqLiveConfig } from "./management-hq-live-config";
import {
  decodeHqLiveV2Sync,
  decodeHqLiveV2SyncAsync,
  encodeHqLiveV2Sync,
  encodeHqLiveV2SyncAsync,
  encodeHqLiveV2SyncOwnedAsync,
  hqJsonUtf8BytesAsync,
  isHqLiveV2CapacityError,
  manifestChunkRefs,
  validateHqV2Chunk,
  validateHqV2Manifest,
  HQ_LIVE_V2_CHUNK_ROW_BYTES,
  HQ_LIVE_V2_ROOT_BYTES,
  HQ_LIVE_V2_OLD_COMPACT_BYTES,
  HQ_LIVE_V2_OLD_EXPANDED_BYTES,
  type HqV2Manifest,
  type HqV2ChunkRef,
} from "./management-hq-storage-v2";
import { canonicalHqJson } from "./management-hq-engine";
import { createHqCpuCheckpoint } from "./management-hq-cooperative";
import {
  readHqProgressSnapshot,
  type HqProgressSnapshot,
} from "./management-hq-progress";

/** Reserved service namespace; ownerUserId=0 creates no user and has no FK. Never caller-selected. */
export const HQ_LIVE_SYNC_DATASET_ID = "live:company:orbit:v1:sync";
export const HQ_LIVE_CONTROL_DATASET_ID = "live:company:orbit:v1:control";
export const HQ_LIVE_OWNER_USER_ID = 0;
export const HQ_LIVE_LEASE_SECONDS = 30;
export const HQ_LIVE_MAX_LEASE_SECONDS = 95;
const MAX_VERSION = 2_147_483_646;
const MAX_BYTES = 16 * 1024 * 1024;
const V1_WRITE_BYTES = 8 * 1024 * 1024;
// At most four bounded rows per response, even if a hostile row uses its full row cap.
const CHUNK_READ_BATCH_COUNT = 4;
export const HQ_LIVE_ERROR_CODES = [
  "CONFIG_INVALID",
  "CONFIG_INCOMPLETE",
  "STORE_UNAVAILABLE",
  "INVALID_PERSISTED_STATE",
  "SOURCE_BINDING_CHANGED",
  "LEASE_LOST",
  "VERSION_EXHAUSTED",
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
  "SOURCE_EXPIRED",
  "SOURCE_NOT_READY",
  "SOURCE_SCOPE_MISMATCH",
  "GENERATION_METADATA_DRIFT",
  "STALE_REVISION",
  "REVISION_CONFLICT",
  "STAGED_CHECKPOINT_MISMATCH",
  "STAGED_MODE_MISMATCH",
  "CHECKPOINT_REQUIRED",
  "PAGE_CAP_EXCEEDED",
  "RECORD_CAP_EXCEEDED",
  "STATE_RECORD_CAP_EXCEEDED",
  "REPLAY_PROOF_CAP_EXCEEDED",
  "STATE_BYTE_CAP_EXCEEDED",
  "STATE_VERSION_OVERFLOW",
  "CAS_CONFLICT",
  "CATALOGUE_MEMBERSHIP_MISMATCH",
  "INVALID_SOURCE_COUNTS",
  "SOURCE_COUNT_MISMATCH",
  "GENERATION_REGRESSION",
  "PAGINATION_INCONSISTENT",
  "ENDPOINT_ENTITY_MISMATCH",
  "CATALOGUE_REVISION_MISMATCH",
  "DUPLICATE_CATALOGUE_ENTRY",
  "CHANGE_UPPER_EXCEEDED",
  "SEQUENCE_CONFLICT",
  "SEQUENCE_REGRESSION",
  "REPLAY_BEFORE_CHECKPOINT",
  "CURSOR_LOOP",
  "INCOMPLETE_GENERATION",
  "SOURCE_OR_STORE_UNAVAILABLE",
] as const;
export type HqLiveErrorCode = (typeof HQ_LIVE_ERROR_CODES)[number];
export function safeHqLiveErrorCode(value: unknown): HqLiveErrorCode {
  return typeof value === "string" &&
    (HQ_LIVE_ERROR_CODES as readonly string[]).includes(value)
    ? (value as HqLiveErrorCode)
    : "STORE_UNAVAILABLE";
}
export class HqLiveError extends Error {
  readonly code: HqLiveErrorCode;
  constructor(code: HqLiveErrorCode) {
    const safe = safeHqLiveErrorCode(code);
    super(safe);
    this.code = safe;
    this.name = "HqLiveError";
  }
}
function fail(code: HqLiveErrorCode): never {
  throw new HqLiveError(code);
}
export type HqLiveStageStatus =
  | "idle"
  | "running"
  | "progress"
  | "applied"
  | "backoff"
  | "needs_attention";
export interface HqLiveInitialRecovery {
  format: "empty-initial-recovery-v1";
  atMs: number;
  fromControlVersion: number;
  previousErrorCode: "INVALID_SEMANTICS";
  previousAttemptAtMs: number;
}
export type HqLiveInitialRecoveryResult =
  | "recovered"
  | "notdue"
  | "busy"
  | "not_recoverable";
export interface HqLiveInitialStagedResume {
  format: "staged-initial-resume-v1";
  atMs: number;
  fromControlVersion: number;
  syncVersion: number;
  previousErrorCode: "STATE_BYTE_CAP_EXCEEDED";
  previousAttemptAtMs: number;
  previousConsecutiveFailures: number;
  pages: number;
  recordsRead: number;
}
export type HqLiveStagedResumeResult =
  | "resumed"
  | "notdue"
  | "busy"
  | "not_resumable";
export interface HqLiveInitialCapacityRepair {
  format: "staged-initial-capacity-repair-v1";
  atMs: number;
  fromControlVersion: number;
  syncVersion: number;
  previousErrorCode: "INVALID_PERSISTED_STATE" | "STATE_BYTE_CAP_EXCEEDED";
  previousAttemptAtMs: number;
  previousConsecutiveFailures: number;
  pages: number;
  recordsRead: number;
}
export type HqLiveInitialCapacityRepairResult =
  | "repaired"
  | "notdue"
  | "busy"
  | "not_repairable";
export interface HqLiveControl {
  format: "hq-live-control-v1";
  version: number;
  sourceFingerprint: string;
  fencingNumber: number;
  leaseToken: string | null;
  leaseExpiresAtMs: number | null;
  leaseHardExpiresAtMs: number | null;
  nextDueAtMs: number;
  consecutiveFailures: number;
  lastAttemptAtMs: number | null;
  lastSuccessAtMs: number | null;
  lastPublishAtMs: number | null;
  lastErrorCode: HqLiveErrorCode | null;
  stageStatus: HqLiveStageStatus;
  initialRecovery?: HqLiveInitialRecovery;
  initialStagedResume?: HqLiveInitialStagedResume;
  initialCapacityRepair?: HqLiveInitialCapacityRepair;
}
export interface HqLiveLease {
  token: string;
  fencingNumber: number;
  sourceFingerprint: string;
  hardExpiresAtMs: number;
}
interface HqLiveSyncEnvelope {
  format: "hq-live-sync-v1";
  sourceFingerprint: string;
  sync: HqImplementedSyncState;
}
export interface HqLiveSnapshot {
  control: HqLiveControl | null;
  sync: HqImplementedSyncState | null;
  databaseNowMs: number;
}
export type HqLiveAcquireResult =
  | { status: "acquired"; lease: HqLiveLease }
  | { status: "busy" | "notdue" | "needs_attention" | "already_complete" };
export interface HqLiveCompletion {
  status: "progress" | "applied" | "backoff" | "needs_attention";
  delaySeconds: number;
  errorCode?: HqLiveErrorCode;
}
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (
  v: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER
): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const time = (v: unknown) => v === null || integer(v, 1);
function parseRow(row: RowDataPacket, id: string, limit: number): unknown {
  if (
    row.datasetId !== id ||
    row.mode !== "live" ||
    Number(row.ownerUserId) !== 0 ||
    !integer(Number(row.stateVersion), 1, MAX_VERSION)
  )
    fail("INVALID_PERSISTED_STATE");
  try {
    const text =
      typeof row.state === "string" ? row.state : JSON.stringify(row.state);
    if (Buffer.byteLength(text) > limit) fail("INVALID_PERSISTED_STATE");
    return JSON.parse(text);
  } catch {
    return fail("INVALID_PERSISTED_STATE");
  }
}
function controlRow(row: RowDataPacket): HqLiveControl {
  const c = parseRow(row, HQ_LIVE_CONTROL_DATASET_ID, 4096) as HqLiveControl;
  if (
    !c ||
    typeof c !== "object" ||
    Array.isArray(c) ||
    c.format !== "hq-live-control-v1" ||
    !integer(c.version, 1, MAX_VERSION) ||
    c.version !== Number(row.stateVersion) ||
    !hash(c.sourceFingerprint) ||
    !integer(c.fencingNumber, 0, MAX_VERSION) ||
    !integer(c.nextDueAtMs) ||
    !integer(c.consecutiveFailures, 0, 1000000) ||
    !time(c.leaseExpiresAtMs) ||
    !time(c.leaseHardExpiresAtMs) ||
    !time(c.lastAttemptAtMs) ||
    !time(c.lastSuccessAtMs) ||
    !time(c.lastPublishAtMs) ||
    (c.lastErrorCode !== null &&
      !(HQ_LIVE_ERROR_CODES as readonly unknown[]).includes(c.lastErrorCode)) ||
    ![
      "idle",
      "running",
      "progress",
      "applied",
      "backoff",
      "needs_attention",
    ].includes(c.stageStatus) ||
    (c.leaseToken !== null &&
      (typeof c.leaseToken !== "string" ||
        !/^[a-f0-9-]{36}$/.test(c.leaseToken))) ||
    (c.leaseToken === null) !== (c.leaseExpiresAtMs === null) ||
    (c.leaseToken === null) !== (c.leaseHardExpiresAtMs === null) ||
    (c.leaseExpiresAtMs !== null &&
      c.leaseExpiresAtMs > c.leaseHardExpiresAtMs!) ||
    (c.leaseToken !== null &&
      (!c.lastAttemptAtMs ||
        c.leaseHardExpiresAtMs! - c.lastAttemptAtMs >
          HQ_LIVE_MAX_LEASE_SECONDS * 1000))
  )
    fail("INVALID_PERSISTED_STATE");
  if (Object.prototype.hasOwnProperty.call(c, "initialRecovery")) {
    const recovery = c.initialRecovery;
    if (
      !recovery ||
      typeof recovery !== "object" ||
      Array.isArray(recovery) ||
      recovery.format !== "empty-initial-recovery-v1" ||
      !integer(recovery.atMs, 1) ||
      !integer(recovery.fromControlVersion, 1, MAX_VERSION) ||
      recovery.fromControlVersion >= c.version ||
      recovery.previousErrorCode !== "INVALID_SEMANTICS" ||
      !integer(recovery.previousAttemptAtMs, 1)
    )
      fail("INVALID_PERSISTED_STATE");
  }
  if (Object.prototype.hasOwnProperty.call(c, "initialStagedResume")) {
    const resume = c.initialStagedResume;
    const keys = [
      "format",
      "atMs",
      "fromControlVersion",
      "syncVersion",
      "previousErrorCode",
      "previousAttemptAtMs",
      "previousConsecutiveFailures",
      "pages",
      "recordsRead",
    ];
    if (
      !resume ||
      typeof resume !== "object" ||
      Array.isArray(resume) ||
      Object.keys(resume).length !== keys.length ||
      keys.some(key => !Object.prototype.hasOwnProperty.call(resume, key)) ||
      resume.format !== "staged-initial-resume-v1" ||
      !integer(resume.atMs, 1) ||
      !integer(resume.fromControlVersion, 1, MAX_VERSION) ||
      resume.fromControlVersion >= c.version ||
      !integer(resume.syncVersion, 1, MAX_VERSION) ||
      resume.previousErrorCode !== "STATE_BYTE_CAP_EXCEEDED" ||
      !integer(resume.previousAttemptAtMs, 1) ||
      !integer(resume.previousConsecutiveFailures, 1, 1000000) ||
      !integer(resume.pages, 1, 1000) ||
      !integer(resume.recordsRead, 1, 100000)
    )
      fail("INVALID_PERSISTED_STATE");
  }
  if (Object.prototype.hasOwnProperty.call(c, "initialCapacityRepair")) {
    const repair = c.initialCapacityRepair;
    const keys = [
      "format",
      "atMs",
      "fromControlVersion",
      "syncVersion",
      "previousErrorCode",
      "previousAttemptAtMs",
      "previousConsecutiveFailures",
      "pages",
      "recordsRead",
    ];
    if (
      !repair ||
      typeof repair !== "object" ||
      Array.isArray(repair) ||
      Object.keys(repair).length !== keys.length ||
      keys.some(key => !Object.prototype.hasOwnProperty.call(repair, key)) ||
      repair.format !== "staged-initial-capacity-repair-v1" ||
      !integer(repair.atMs, 1) ||
      !integer(repair.fromControlVersion, 1, MAX_VERSION) ||
      repair.fromControlVersion >= c.version ||
      !integer(repair.syncVersion, 1, MAX_VERSION) ||
      !["INVALID_PERSISTED_STATE", "STATE_BYTE_CAP_EXCEEDED"].includes(
        repair.previousErrorCode
      ) ||
      !integer(repair.previousAttemptAtMs, 1) ||
      !integer(repair.previousConsecutiveFailures, 1, 1000000) ||
      !integer(repair.pages, 1, 1000) ||
      !integer(repair.recordsRead, 1, 100000)
    )
      fail("INVALID_PERSISTED_STATE");
  }
  return c;
}
/** Bounded control validation shared with explicitly unchecked progress observation. */
export const parseHqLiveControlRow = controlRow;
function syncRow(row: RowDataPacket): HqLiveSyncEnvelope {
  const e = parseRow(
    row,
    HQ_LIVE_SYNC_DATASET_ID,
    MAX_BYTES
  ) as HqLiveSyncEnvelope;
  if (
    !e ||
    typeof e !== "object" ||
    Array.isArray(e) ||
    e.format !== "hq-live-sync-v1" ||
    !hash(e.sourceFingerprint)
  )
    fail("INVALID_PERSISTED_STATE");
  try {
    validateHqImplementedSyncState(e.sync);
  } catch {
    fail("INVALID_PERSISTED_STATE");
  }
  if (!e.sync || e.sync.version !== Number(row.stateVersion))
    fail("INVALID_PERSISTED_STATE");
  return e;
}
type VerifiedV2 = {
  sourceFingerprint: string;
  rootCanonical: string;
  chunks: Map<string, Buffer>;
  state: HqImplementedSyncState;
};
type ValidatedSyncFacts = Readonly<{
  version: number;
  publishedVersion: number | null;
}>;
function syncFacts(state: HqImplementedSyncState): ValidatedSyncFacts {
  return Object.freeze({
    version: state.version,
    publishedVersion: state.published?.version ?? null,
  });
}
type SyncRows = {
  manifest: HqV2Manifest | null;
  chunks: Map<string, string>;
};
type FullSyncResult = SyncRows & { state: HqImplementedSyncState | null };
type SyncVerificationResult = SyncRows & { facts: ValidatedSyncFacts | null };
type CompletionProof = {
  sourceFingerprint: string;
  rootCanonical: string;
  chunks: Map<string, Buffer>;
  facts: ValidatedSyncFacts;
  token: string;
  fencingNumber: number;
  scope: string;
  expiresAt: number;
};
// One module-private result, never authority/config/guards/actors/leases. The
// opaque parent SHA binds all seven raw settings plus DB URL; Pool identity is
// additionally mandatory. Only unfinished initial V2 states qualify. Original
// codec caps bound logical retained state to 256 MiB expanded JSON, chunks to
// 128 MiB decoded bytes and canonical root to 16 MiB UTF-8: 400 MiB logical,
// NOT an RSS bound. No publication is retained.
// Non-sliding 60s monotonic TTL, checked/cleared on access; no timers or work.
const INITIAL_REUSE_TTL_MS = 60_000;
let initialVerifiedV2:
  | {
      pool: Pool;
      scope: string;
      expiresAt: number;
      result: VerifiedV2;
    }
  | undefined;
/** Short transactions only. All sync/control writes lock the same control row first. */
export function createHqLiveStore(
  pool: Pool,
  config: HqLiveConfig,
  options: {
    cooperativeGuard?: () => Promise<void>;
    cooperativeYieldGuard?: () => Promise<void>;
    /** Parent-only accelerated initial profile; SHA of raw settings + DB URL. */
    validatedInitialReuseScope?: string;
  } = {}
): HqLiveStore {
  const initialReuseScope = options.validatedInitialReuseScope;
  function sharedResult(): VerifiedV2 | undefined {
    if (
      initialVerifiedV2 &&
      (initialVerifiedV2.pool !== pool ||
        initialVerifiedV2.scope !== initialReuseScope ||
        performance.now() >= initialVerifiedV2.expiresAt)
    )
      initialVerifiedV2 = undefined;
    return initialVerifiedV2?.result;
  }
  function binding(write = false): string {
    if (initialReuseScope !== undefined) {
      sharedResult(); // configuration/scope changes and expiry clear on access
      if (!hash(initialReuseScope)) {
        clearVerifiedV2();
        fail("CONFIG_INVALID");
      }
    }
    const s = config.status(),
      f = config.sourceFingerprint();
    if (
      !s.configured ||
      !f ||
      (write ? !s.syncEnabled : !s.syncEnabled && !s.readEnabled)
    ) {
      clearVerifiedV2();
      fail("CONFIG_INVALID");
    }
    return f;
  }
  function checkpoint(f: string, renew?: () => Promise<void>) {
    let denial: HqLiveError | undefined;
    let renewedAt = performance.now();
    const cpu = createHqCpuCheckpoint(async () => {
      try {
        assertBinding(f, binding());
        await (options.cooperativeYieldGuard ?? options.cooperativeGuard)?.();
        if (renew && performance.now() - renewedAt >= 8000) {
          await renew();
          renewedAt = performance.now();
          await (options.cooperativeYieldGuard ?? options.cooperativeGuard)?.();
        }
        assertBinding(f, binding());
      } catch (error) {
        if (error instanceof HqLiveError) denial ??= error;
        throw error;
      }
    });
    return Object.assign(cpu, { denial: () => denial });
  }
  // A mismatched CAS must roll back any lease bookkeeping done while validating.
  const casMismatch = Symbol("hq-private-cas-mismatch");
  // Renewals are provisional until this transaction commits. Retain the earliest
  // old authorization deadline even if held validation renews more than once.
  const renewalDeadlines = new WeakMap<PoolConnection, number>();
  // Default callers retain their original single-store snapshot slot. Opt-in
  // callers use only the one bounded module result above. The persisted root is
  // compared canonically (wrapper key order is immaterial); every referenced
  // chunk is compared by exact decoded bytes returned by its validator.
  // Cooperative copies own the state; no mutable return value or Buffer view
  // aliases the slot. Candidates become reusable only after their SQL commit.
  // This is a validation result, never lease authority: acquisition may reuse
  // the same exact bytes in its newly fenced reader; every write still guards
  // the current control token/fence/DB deadlines independently below.
  let verifiedV2: VerifiedV2 | undefined;
  const pendingV2 = new WeakMap<PoolConnection, VerifiedV2>();
  // One-use, request/store-local publication proof, NEVER a shared read result.
  // Retains only owned emitted bytes and validated scalars, not the entity tree.
  // Non-sliding monotonic expiry; no timer, budget extension or lease authority.
  let committedCompletionProof: CompletionProof | undefined;
  const pendingCompletionProof = new WeakMap<PoolConnection, CompletionProof>();
  const clearVerifiedV2 = () => {
    verifiedV2 = undefined;
    committedCompletionProof = undefined;
    // Also invalidate an opt-in result if a default caller of the same pool
    // encounters a write/error/config denial. Never retain stale shared state.
    if (initialVerifiedV2?.pool === pool) initialVerifiedV2 = undefined;
  };
  function retainCandidate(candidate: VerifiedV2) {
    if (initialReuseScope === undefined) verifiedV2 = candidate;
    else if (candidate.state.published === null && candidate.state.stage) {
      initialVerifiedV2 = {
        pool,
        scope: initialReuseScope,
        expiresAt: performance.now() + INITIAL_REUSE_TTL_MS,
        result: candidate,
      };
    } else clearVerifiedV2();
  }
  function retainRenewalDeadline(
    c: PoolConnection,
    expiry: number,
    hard: number
  ) {
    renewalDeadlines.set(
      c,
      Math.min(renewalDeadlines.get(c) ?? Infinity, expiry, hard)
    );
  }
  async function transaction<T>(
    work: (c: PoolConnection) => Promise<T>,
    openingAuthority?: () => Promise<void>,
    finalAuthority?: () => Promise<void>
  ): Promise<T> {
    let c: PoolConnection | undefined;
    try {
      if (openingAuthority) await openingAuthority();
      try {
        c = await pool.getConnection();
      } finally {
        if (openingAuthority) await openingAuthority();
      }
      if (openingAuthority) await openingAuthority();
      try {
        await c.beginTransaction();
      } finally {
        if (openingAuthority) await openingAuthority();
      }
      const result = await work(c);
      const finalBinding = binding();
      // Still inside rollback boundary: a SQL await after a CPU guard cannot
      // authorize a renewal or publication for a now-denied action.
      await options.cooperativeGuard?.();
      const deadline = renewalDeadlines.get(c);
      if (deadline !== undefined) {
        // Refresh authoritative DB time after the final authority await. A last
        // fresh authority check follows SQL; monotonic elapsed conservatively
        // covers that awaited check without opening another SQL/authority gap.
        const sampledAt = performance.now();
        const databaseNow = await dbNow(c);
        await options.cooperativeGuard?.();
        if (databaseNow + Math.ceil(performance.now() - sampledAt) >= deadline)
          fail("LEASE_LOST");
      }
      if (finalAuthority) await finalAuthority();
      assertBinding(finalBinding, binding());
      await c.commit();
      const candidate = pendingV2.get(c);
      if (candidate) retainCandidate(candidate);
      // Promotion is strictly AFTER the actual SQL COMMIT resolves. Neither a
      // pending read nor root UPDATE/zero CAS/rollback can establish this proof.
      const completionProof = pendingCompletionProof.get(c);
      if (completionProof && performance.now() < completionProof.expiresAt)
        committedCompletionProof = completionProof;
      return result;
    } catch (error) {
      clearVerifiedV2();
      if (c)
        try {
          await c.rollback();
        } catch {
          /* no provider text */
        }
      if (error === casMismatch) throw error;
      if (error instanceof HqLiveError) throw error;
      return fail("STORE_UNAVAILABLE");
    } finally {
      if (c) {
        renewalDeadlines.delete(c);
        pendingV2.delete(c);
        pendingCompletionProof.delete(c);
      }
      c?.release();
    }
  }
  async function dbNow(c: PoolConnection): Promise<number> {
    const [rows] = await c.execute<RowDataPacket[]>(
      "SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS nowMs"
    );
    const n = Number(rows[0]?.nowMs);
    if (!integer(n, 1)) fail("STORE_UNAVAILABLE");
    return n;
  }
  async function rows(
    c: PoolConnection,
    id: string,
    lock = false
  ): Promise<RowDataPacket[]> {
    const [result] = await c.execute<RowDataPacket[]>(
      `SELECT datasetId,mode,ownerUserId,stateVersion,state,updatedAt FROM management_hq_datasets WHERE datasetId = ?${lock ? " FOR UPDATE" : ""}`,
      [id]
    );
    if (result.length > 1) fail("INVALID_PERSISTED_STATE");
    return result;
  }
  function assertBinding(f: string, actual: string) {
    if (actual !== f) {
      clearVerifiedV2();
      fail("SOURCE_BINDING_CHANGED");
    }
  }
  async function locked(
    c: PoolConnection,
    f: string
  ): Promise<HqLiveControl | null> {
    const result = await rows(c, HQ_LIVE_CONTROL_DATASET_ID, true);
    if (!result.length) return null;
    const control = controlRow(result[0]);
    assertBinding(f, control.sourceFingerprint);
    return control;
  }
  function chunkText(row: RowDataPacket, ref: HqV2ChunkRef, f: string): string {
    parseRow(row, ref.id, HQ_LIVE_V2_CHUNK_ROW_BYTES);
    if (Number(row.stateVersion) !== 1) fail("INVALID_PERSISTED_STATE");
    const text =
      typeof row.state === "string" ? row.state : JSON.stringify(row.state);
    try {
      validateHqV2Chunk(text, ref, f);
    } catch {
      fail("INVALID_PERSISTED_STATE");
    }
    return text;
  }
  async function chunkRows(
    c: PoolConnection,
    refs: readonly HqV2ChunkRef[],
    f: string,
    allowMissing = false
  ): Promise<Map<string, string>> {
    const chunks = new Map<string, string>();
    for (
      let offset = 0;
      offset < refs.length;
      offset += CHUNK_READ_BATCH_COUNT
    ) {
      const batch = refs.slice(offset, offset + CHUNK_READ_BATCH_COUNT);
      const expected = new Map(batch.map(ref => [ref.id, ref]));
      const [result] = await c.execute<RowDataPacket[]>(
        `SELECT datasetId,mode,ownerUserId,stateVersion,state,updatedAt FROM management_hq_datasets WHERE datasetId IN (${batch.map(() => "?").join(",")}) FOR UPDATE`,
        batch.map(ref => ref.id)
      );
      if (result.length > batch.length) fail("INVALID_PERSISTED_STATE");
      for (const row of result) {
        const ref = expected.get(row.datasetId);
        if (!ref || chunks.has(row.datasetId)) fail("INVALID_PERSISTED_STATE");
        chunks.set(ref.id, chunkText(row, ref, f));
      }
      if (!allowMissing && batch.some(ref => !chunks.has(ref.id)))
        fail("INVALID_PERSISTED_STATE");
    }
    return chunks;
  }
  function fullSync(
    c: PoolConnection,
    f: string,
    cooperative?: boolean,
    lease?: HqLiveLease
  ): Promise<FullSyncResult>;
  function fullSync(
    c: PoolConnection,
    f: string,
    cooperative: boolean,
    lease: HqLiveLease | undefined,
    purpose: "verify" | "complete"
  ): Promise<SyncVerificationResult>;
  async function fullSync(
    c: PoolConnection,
    f: string,
    cooperative = true,
    lease?: HqLiveLease,
    purpose: "state" | "verify" | "complete" = "state"
  ): Promise<FullSyncResult | SyncVerificationResult> {
    const loaded = (
      state: HqImplementedSyncState | null,
      manifest: HqV2Manifest | null,
      chunks: Map<string, string>
    ): FullSyncResult | SyncVerificationResult =>
      purpose === "state"
        ? { state, manifest, chunks }
        : { facts: state ? syncFacts(state) : null, manifest, chunks };
    // Only completion may consume the store-local publication proof. Selecting
    // it consumes it even on failure; all independent guards remain mandatory.
    let completionProof: CompletionProof | undefined;
    if (purpose === "complete") {
      const candidate = committedCompletionProof;
      committedCompletionProof = undefined;
      if (
        candidate &&
        lease &&
        candidate.token === lease.token &&
        candidate.fencingNumber === lease.fencingNumber &&
        candidate.sourceFingerprint === f &&
        candidate.scope === initialReuseScope &&
        performance.now() < candidate.expiresAt
      )
        completionProof = candidate;
    }
    const result = await rows(c, HQ_LIVE_SYNC_DATASET_ID);
    if (!result.length) {
      clearVerifiedV2();
      assertBinding(f, binding());
      return loaded(null, null, new Map());
    }
    const root = parseRow(
      result[0],
      HQ_LIVE_SYNC_DATASET_ID,
      HQ_LIVE_V2_ROOT_BYTES
    ) as HqV2Manifest;
    if (root?.format !== "hq-live-sync-manifest-v2") {
      clearVerifiedV2();
      let envelope: HqLiveSyncEnvelope;
      if (!cooperative) envelope = syncRow(result[0]);
      else {
        envelope = root as unknown as HqLiveSyncEnvelope;
        if (
          !envelope ||
          typeof envelope !== "object" ||
          Array.isArray(envelope) ||
          envelope.format !== "hq-live-sync-v1" ||
          !hash(envelope.sourceFingerprint)
        )
          fail("INVALID_PERSISTED_STATE");
        const cpu = checkpoint(
          f,
          lease ? () => renewCpuLease(c, lease) : undefined
        );
        try {
          await validateHqImplementedSyncStateAsync(
            envelope.sync,
            {
              maxStateBytes: MAX_BYTES,
              // Parsed V1 extras retain the original native JSON acceptance,
              // including depths that the strict V2 codec intentionally denies.
              // This one native byte pass remains bounded by the 16 MiB root.
              measureStateBytes: value =>
                Buffer.byteLength(JSON.stringify(value)),
            },
            cpu
          );
        } catch (error) {
          if (cpu.denial()) throw cpu.denial();
          if (error instanceof HqLiveError) throw error;
          fail("INVALID_PERSISTED_STATE");
        }
        if (
          !envelope.sync ||
          envelope.sync.version !== Number(result[0].stateVersion)
        )
          fail("INVALID_PERSISTED_STATE");
      }
      assertBinding(f, envelope.sourceFingerprint);
      assertBinding(f, binding());
      return loaded(envelope.sync, null, new Map());
    }
    if (hash(root.sourceFingerprint)) assertBinding(f, root.sourceFingerprint);
    let refs: HqV2ChunkRef[];
    try {
      validateHqV2Manifest(root, Number(result[0].stateVersion), f);
      refs = manifestChunkRefs(root);
    } catch {
      clearVerifiedV2();
      fail("INVALID_PERSISTED_STATE");
    }
    let chunks: Map<string, string>;
    try {
      chunks = await chunkRows(c, refs!, f);
    } catch (error) {
      clearVerifiedV2();
      throw error;
    }
    const cpu = cooperative
      ? checkpoint(f, lease ? () => renewCpuLease(c, lease) : undefined)
      : null;
    // Protected Resume deliberately keeps the original synchronous validator;
    // it neither reads nor populates the cooperative reuse slot.
    if (!cooperative) clearVerifiedV2();
    const rootCanonical = cooperative ? canonicalHqJson(root) : "";
    const available =
      completionProof ??
      (initialReuseScope === undefined ? verifiedV2 : sharedResult());
    if (
      available &&
      (available.sourceFingerprint !== f ||
        available.rootCanonical !== rootCanonical ||
        ("facts" in available
          ? available.facts.version
          : available.state.version) !== root.syncVersion)
    ) {
      clearVerifiedV2();
      completionProof = undefined;
    }
    const retained =
      completionProof ??
      (initialReuseScope === undefined ? verifiedV2 : sharedResult());
    const ownedChunks = new Map<string, Buffer>();
    if (cooperative) {
      let exact = !!retained && retained.chunks.size === chunks.size;
      try {
        for (const ref of refs!) {
          // Full wrapper/hash/row validation still runs on EVERY read. A hash
          // alone is never a substitute for exact previously validated bytes.
          const bytes = validateHqV2Chunk(chunks.get(ref.id)!, ref, f);
          if (!retained?.chunks.get(ref.id)?.equals(bytes)) exact = false;
          ownedChunks.set(ref.id, Buffer.from(bytes));
          await cpu!();
        }
        if (completionProof && performance.now() >= completionProof.expiresAt)
          exact = false;
        if (exact) {
          if (purpose !== "state") {
            const facts =
              "facts" in retained!
                ? retained.facts
                : syncFacts(retained!.state);
            assertBinding(f, binding());
            return { facts, manifest: root, chunks };
          }
          // Publication proofs are never selected for full/public/engine reads.
          if (!("state" in retained!)) fail("INVALID_PERSISTED_STATE");
          const state = await cloneHqJsonAsync(retained!.state, cpu!);
          assertBinding(f, binding());
          return { state, manifest: root, chunks };
        }
      } catch (error) {
        clearVerifiedV2();
        if (cpu!.denial()) throw cpu!.denial();
        if (error instanceof HqLiveError) throw error;
        fail("INVALID_PERSISTED_STATE");
      }
      clearVerifiedV2();
    }
    let state: HqImplementedSyncState;
    try {
      state = cooperative
        ? await decodeHqLiveV2SyncAsync(root, chunks, f, cpu!)
        : decodeHqLiveV2Sync(root, chunks, f);
      if (
        cooperative &&
        (initialReuseScope === undefined ||
          (state.published === null && state.stage))
      ) {
        // A cold verification-only decode has no mutable consumer: its decoded
        // tree is already independently owned and may be retained directly.
        const ownedState =
          purpose === "state" ? await cloneHqJsonAsync(state, cpu!) : state;
        assertBinding(f, binding());
        pendingV2.set(c, {
          sourceFingerprint: f,
          rootCanonical,
          chunks: ownedChunks,
          state: ownedState,
        });
      }
    } catch (error) {
      clearVerifiedV2();
      if (cpu?.denial()) throw cpu.denial();
      if (error instanceof HqLiveError) throw error;
      fail("INVALID_PERSISTED_STATE");
    }
    assertBinding(f, binding()); // no state exposure after an awaited binding drift
    return loaded(state!, root, chunks);
  }
  async function sync(
    c: PoolConnection,
    f: string
  ): Promise<HqImplementedSyncState | null> {
    return (await fullSync(c, f)).state;
  }
  async function saveControl(
    c: PoolConnection,
    control: HqLiveControl
  ): Promise<void> {
    if (control.version >= MAX_VERSION) fail("VERSION_EXHAUSTED");
    const expected = control.version;
    control.version++;
    const [r] = await c.execute<ResultSetHeader>(
      "UPDATE management_hq_datasets SET stateVersion = ?,state = ?,updatedAt = UTC_TIMESTAMP(3) WHERE datasetId = ? AND mode = 'live' AND ownerUserId = 0 AND stateVersion = ?",
      [
        control.version,
        JSON.stringify(control),
        HQ_LIVE_CONTROL_DATASET_ID,
        expected,
      ]
    );
    if (r.affectedRows !== 1) fail("LEASE_LOST");
  }
  async function guard(
    c: PoolConnection,
    lease: HqLiveLease
  ): Promise<{ control: HqLiveControl; now: number }> {
    const f = binding(true);
    assertBinding(f, lease.sourceFingerprint);
    const control = await locked(c, f);
    const now = await dbNow(c); // clock AFTER the row lock, not before its wait
    assertBinding(f, binding(true)); // refresh configuration after both awaited reads
    if (
      !control ||
      control.leaseToken !== lease.token ||
      control.fencingNumber !== lease.fencingNumber ||
      control.leaseExpiresAtMs! <= now ||
      control.leaseHardExpiresAtMs! <= now ||
      control.leaseHardExpiresAtMs !== lease.hardExpiresAtMs
    )
      fail("LEASE_LOST");
    return { control, now };
  }
  async function renewCpuLease(c: PoolConnection, lease: HqLiveLease) {
    // Same locked transaction and same fencing token; never renew an expired
    // or superseded holder, and never extend the original 95-second hard cap.
    await options.cooperativeGuard?.();
    const { control, now } = await guard(c, lease);
    if (control.leaseExpiresAtMs! - now > 20000) {
      await options.cooperativeGuard?.();
      assertBinding(lease.sourceFingerprint, binding(true));
      return;
    }
    const oldExpiry = control.leaseExpiresAtMs!;
    const oldHardExpiry = control.leaseHardExpiresAtMs!;
    await options.cooperativeGuard?.();
    const refreshed = await guard(c, lease);
    if (refreshed.now >= oldExpiry || refreshed.now >= oldHardExpiry)
      fail("LEASE_LOST");
    control.leaseExpiresAtMs = Math.min(
      refreshed.now + HQ_LIVE_LEASE_SECONDS * 1000,
      oldHardExpiry
    );
    retainRenewalDeadline(c, oldExpiry, oldHardExpiry);
    assertBinding(lease.sourceFingerprint, binding(true));
    await saveControl(c, control);
    await options.cooperativeGuard?.();
    const verified = await guard(c, lease);
    // A replacement expiry is not permission to cross the old deadline during
    // the renewal UPDATE or authority await.
    if (verified.now >= oldExpiry || verified.now >= oldHardExpiry)
      fail("LEASE_LOST");
    await options.cooperativeGuard?.();
    const finalNow = await dbNow(c);
    if (finalNow >= oldExpiry || finalNow >= oldHardExpiry) fail("LEASE_LOST");
    assertBinding(lease.sourceFingerprint, binding(true));
  }
  const store: HqLiveStore = {
    async recoverEmptyInitialImport(expectedVersion, authority) {
      // This capability is protected independently of ordinary lease acquisition.
      // In particular, a missing authority must fail before even opening SQL.
      if (typeof authority !== "function") fail("AUTH_DENIED");
      let originalBinding: string | undefined;
      function recoveryBinding(): string {
        const status = config.status();
        const fingerprint = config.sourceFingerprint();
        if (
          status.configured !== true ||
          status.configurationCode !== null ||
          status.syncEnabled !== true ||
          status.readEnabled !== false ||
          !hash(fingerprint)
        )
          fail("CONFIG_INVALID");
        if (originalBinding) assertBinding(originalBinding, fingerprint!);
        return fingerprint!;
      }
      async function verifyAuthority(): Promise<void> {
        let before: string | undefined;
        let denial: HqLiveError | undefined;
        try {
          before = recoveryBinding();
        } catch (error) {
          denial =
            error instanceof HqLiveError
              ? error
              : new HqLiveError("CONFIG_INVALID");
        }
        // Always refresh the parent-provided, latched seven-setting guard,
        // even if the store's own configuration check has already failed.
        try {
          await authority();
        } catch (error) {
          denial ??=
            error instanceof HqLiveError
              ? error
              : new HqLiveError("AUTH_DENIED");
        }
        try {
          const after = recoveryBinding();
          if (before) assertBinding(before, after);
        } catch (error) {
          denial ??=
            error instanceof HqLiveError
              ? error
              : new HqLiveError("CONFIG_INVALID");
        }
        if (denial) throw denial;
        originalBinding ??= before!;
      }
      await verifyAuthority();
      if (!integer(expectedVersion, 1, MAX_VERSION)) return "not_recoverable";
      return transaction(async c => {
        await verifyAuthority(); // recheck connection/transaction awaits
        const controlRows = await rows(c, HQ_LIVE_CONTROL_DATASET_ID, true);
        await verifyAuthority(); // fresh authority AFTER the control lock wait
        if (!controlRows.length) return "not_recoverable"; // never initialize
        const control = controlRow(controlRows[0]);
        assertBinding(originalBinding!, control.sourceFingerprint);
        const now = await dbNow(c); // the database clock is sampled AFTER lock
        await verifyAuthority();
        if (control.version !== expectedVersion) return "not_recoverable";
        if (control.leaseToken !== null)
          return control.leaseExpiresAtMs! > now ? "busy" : "not_recoverable";
        if (
          control.stageStatus !== "needs_attention" ||
          control.lastErrorCode !== "INVALID_SEMANTICS" ||
          control.consecutiveFailures !== 1 ||
          control.lastAttemptAtMs === null ||
          control.lastSuccessAtMs !== null ||
          control.lastPublishAtMs !== null ||
          control.initialRecovery !== undefined
        )
          return "not_recoverable";
        // Physical absence, not an empty parsed envelope: never clear, overwrite,
        // or accept even an otherwise empty/staged/foreign/corrupt sync row.
        const syncRows = await rows(c, HQ_LIVE_SYNC_DATASET_ID);
        await verifyAuthority();
        if (syncRows.length) return "not_recoverable";
        if (control.nextDueAtMs > now) return "notdue";
        if (control.fencingNumber >= MAX_VERSION) fail("VERSION_EXHAUSTED");
        control.initialRecovery = {
          format: "empty-initial-recovery-v1",
          atMs: now,
          fromControlVersion: control.version,
          previousErrorCode: "INVALID_SEMANTICS",
          previousAttemptAtMs: control.lastAttemptAtMs,
        };
        control.fencingNumber++;
        control.stageStatus = "idle";
        control.lastErrorCode = null;
        control.nextDueAtMs = now;
        await verifyAuthority(); // immediately before the existing version CAS
        await saveControl(c, control);
        await verifyAuthority(); // post-UPDATE denial rolls back, before commit
        return "recovered";
      });
    },
    async resumeStagedInitialImport(
      expectedControlVersion,
      expectedSyncVersion,
      authority
    ) {
      // Separate protected capability: never acquire, initialize or migrate state.
      if (typeof authority !== "function") fail("AUTH_DENIED");
      let originalBinding: string | undefined;
      let denial: HqLiveError | undefined;
      function resumeBinding(): string {
        const status = config.status();
        const fingerprint = config.sourceFingerprint();
        if (
          status.configured !== true ||
          status.configurationCode !== null ||
          status.syncEnabled !== true ||
          status.readEnabled !== false ||
          !hash(fingerprint)
        )
          fail("CONFIG_INVALID");
        if (originalBinding) assertBinding(originalBinding, fingerprint!);
        return fingerprint!;
      }
      async function verifyAuthority(): Promise<void> {
        let before: string | undefined;
        try {
          before = resumeBinding();
        } catch (error) {
          denial ??=
            error instanceof HqLiveError
              ? error
              : new HqLiveError("CONFIG_INVALID");
        }
        // Always refresh the mandatory parent-provided seven-setting guard,
        // including on configuration failure. First denial is permanent.
        try {
          await authority();
        } catch (error) {
          denial ??=
            error instanceof HqLiveError
              ? error
              : new HqLiveError("AUTH_DENIED");
        }
        try {
          const after = resumeBinding();
          if (before) assertBinding(before, after);
        } catch (error) {
          denial ??=
            error instanceof HqLiveError
              ? error
              : new HqLiveError("CONFIG_INVALID");
        }
        if (denial) throw denial;
        originalBinding ??= before!;
      }
      await verifyAuthority();
      if (
        !integer(expectedControlVersion, 1, MAX_VERSION) ||
        !integer(expectedSyncVersion, 1, MAX_VERSION)
      )
        return "not_resumable";
      return transaction(async c => {
        await verifyAuthority(); // connection and transaction waits
        // Guard every individual SQL await (including a rejected read), not just
        // fullSync as a whole: a later chunk batch cannot conceal a restoration.
        // The wrapper is local to Resume; all existing storage paths are unchanged.
        const guarded = new Proxy(c, {
          get(target, property) {
            if (property === "execute")
              return async (...args: unknown[]) => {
                await verifyAuthority();
                try {
                  return await (
                    target.execute as (...args: unknown[]) => Promise<unknown>
                  ).apply(target, args);
                } finally {
                  await verifyAuthority();
                }
              };
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const controlRows = await rows(
          guarded,
          HQ_LIVE_CONTROL_DATASET_ID,
          true
        );
        if (!controlRows.length) return "not_resumable";
        const control = controlRow(controlRows[0]);
        assertBinding(originalBinding!, control.sourceFingerprint);
        const lockedNow = await dbNow(guarded); // clock AFTER control lock
        if (control.version !== expectedControlVersion) return "not_resumable";
        if (control.leaseToken !== null)
          return control.leaseExpiresAtMs! > lockedNow
            ? "busy"
            : "not_resumable";
        if (
          control.stageStatus !== "needs_attention" ||
          control.lastErrorCode !== "STATE_BYTE_CAP_EXCEEDED" ||
          control.consecutiveFailures < 1 ||
          control.lastAttemptAtMs === null ||
          control.lastSuccessAtMs !== null ||
          control.lastPublishAtMs !== null ||
          control.initialStagedResume !== undefined
        )
          return "not_resumable";
        const loaded = await fullSync(guarded, originalBinding!, false);
        const state = loaded.state;
        if (
          !state ||
          state.version !== expectedSyncVersion ||
          state.published !== null ||
          !state.stage ||
          state.stage.kind !== "backfill" ||
          state.stage.basePublishedVersion !== null ||
          state.stage.metadata === null ||
          !integer(state.stage.pages, 1, 1000) ||
          !integer(state.stage.recordsRead, 1, 100000)
        )
          return "not_resumable";
        const now = await dbNow(guarded); // fresh AFTER the entire validated read
        if (control.nextDueAtMs > now) return "notdue";
        if (control.fencingNumber >= MAX_VERSION) fail("VERSION_EXHAUSTED");
        control.initialStagedResume = {
          format: "staged-initial-resume-v1",
          atMs: now,
          fromControlVersion: control.version,
          syncVersion: state.version,
          previousErrorCode: "STATE_BYTE_CAP_EXCEEDED",
          previousAttemptAtMs: control.lastAttemptAtMs,
          previousConsecutiveFailures: control.consecutiveFailures,
          pages: state.stage.pages,
          recordsRead: state.stage.recordsRead,
        };
        control.fencingNumber++;
        control.stageStatus = "progress";
        control.lastErrorCode = null;
        // All history, leases and original nextDueAtMs are preserved exactly.
        await saveControl(guarded, control); // pre/post authority; one fenced CAS
        return "resumed";
      }, verifyAuthority);
    },
    async repairInitialCapacity(
      expectedControlVersion,
      expectedSyncVersion,
      authority
    ) {
      // A distinct protected repair, never ordinary attention acquisition or
      // Resume generalization. No source work, lease, root migration or reset.
      if (typeof authority !== "function") fail("AUTH_DENIED");
      let originalBinding: string | undefined;
      let denial: HqLiveError | undefined;
      function repairBinding(): string {
        const status = config.status();
        const fingerprint = config.sourceFingerprint();
        if (
          status.configured !== true ||
          status.configurationCode !== null ||
          status.syncEnabled !== true ||
          status.readEnabled !== false ||
          !hash(fingerprint)
        )
          fail("CONFIG_INVALID");
        if (originalBinding) assertBinding(originalBinding, fingerprint!);
        return fingerprint!;
      }
      async function verifyAuthority(): Promise<void> {
        let before: string | undefined;
        try {
          before = repairBinding();
        } catch (error) {
          denial ??=
            error instanceof HqLiveError
              ? error
              : new HqLiveError("CONFIG_INVALID");
        }
        // The parent's seven-setting authority is mandatory even on a store
        // binding failure. The first denial is permanently latched.
        try {
          await authority();
        } catch (error) {
          denial ??=
            error instanceof HqLiveError
              ? error
              : new HqLiveError("AUTH_DENIED");
        }
        try {
          const after = repairBinding();
          if (before) assertBinding(before, after);
        } catch (error) {
          denial ??=
            error instanceof HqLiveError
              ? error
              : new HqLiveError("CONFIG_INVALID");
        }
        if (denial) throw denial;
        originalBinding ??= before!;
      }
      await verifyAuthority();
      if (
        !integer(expectedControlVersion, 1, MAX_VERSION) ||
        !integer(expectedSyncVersion, 1, MAX_VERSION)
      )
        return "not_repairable";
      return transaction(
        async c => {
          await verifyAuthority();
          // Identical protected await boundary to Resume: every individual read,
          // clock, batch and UPDATE checks authority before/after, even on rejection.
          const guarded = new Proxy(c, {
            get(target, property) {
              if (property === "execute")
                return async (...args: unknown[]) => {
                  await verifyAuthority();
                  try {
                    return await (
                      target.execute as (...args: unknown[]) => Promise<unknown>
                    ).apply(target, args);
                  } finally {
                    await verifyAuthority();
                  }
                };
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
          const controlRows = await rows(
            guarded,
            HQ_LIVE_CONTROL_DATASET_ID,
            true
          );
          if (!controlRows.length) return "not_repairable";
          const control = controlRow(controlRows[0]);
          assertBinding(originalBinding!, control.sourceFingerprint);
          const lockedNow = await dbNow(guarded);
          if (control.version !== expectedControlVersion)
            return "not_repairable";
          if (control.leaseToken !== null)
            return control.leaseExpiresAtMs! > lockedNow
              ? "busy"
              : "not_repairable";
          if (
            control.stageStatus !== "needs_attention" ||
            (control.lastErrorCode !== "INVALID_PERSISTED_STATE" &&
              control.lastErrorCode !== "STATE_BYTE_CAP_EXCEEDED") ||
            control.consecutiveFailures < 1 ||
            control.lastAttemptAtMs === null ||
            control.lastSuccessAtMs !== null ||
            control.lastPublishAtMs !== null ||
            control.initialCapacityRepair !== undefined
          )
            return "not_repairable";
          // Independent strict full decode, never a cooperative cache proof. The
          // unchanged root/chunks must be valid under the expanded live profile.
          const loaded = await fullSync(guarded, originalBinding!, false);
          const state = loaded.state;
          const manifest = loaded.manifest;
          const stage = state?.stage;
          if (
            !manifest ||
            manifest.compactBytes > HQ_LIVE_V2_OLD_COMPACT_BYTES ||
            manifest.expandedBytes > HQ_LIVE_V2_OLD_EXPANDED_BYTES ||
            (manifest.compactBytes < 56 * 1024 * 1024 &&
              manifest.expandedBytes < 112 * 1024 * 1024) ||
            !state ||
            state.version !== expectedSyncVersion ||
            state.published !== null ||
            !stage ||
            stage.kind !== "backfill" ||
            stage.basePublishedVersion !== null ||
            stage.metadata === null ||
            !integer(stage.pages, 1, 999) ||
            !integer(stage.recordsRead, 1, 99999) ||
            Object.keys(stage.entities).length === 0
          )
            return "not_repairable";
          const counts = stage.metadata.counts;
          if (
            !counts ||
            !integer(counts.bookingCount, 0, 100000) ||
            !integer(counts.businessCount, 0, 100000) ||
            counts.bookingCount + counts.businessCount === 0 ||
            counts.bookingCount + counts.businessCount > 100000 ||
            stage.feedKeys.booking.length > counts.bookingCount ||
            stage.feedKeys.business.length > counts.businessCount
          )
            return "not_repairable";
          const now = await dbNow(guarded); // fresh after the entire strict read
          if (Date.parse(stage.metadata.expiresAt) <= now)
            return "not_repairable";
          if (control.nextDueAtMs > now) return "notdue";
          if (control.fencingNumber >= MAX_VERSION) fail("VERSION_EXHAUSTED");
          control.initialCapacityRepair = {
            format: "staged-initial-capacity-repair-v1",
            atMs: now,
            fromControlVersion: control.version,
            syncVersion: state.version,
            previousErrorCode: control.lastErrorCode,
            previousAttemptAtMs: control.lastAttemptAtMs,
            previousConsecutiveFailures: control.consecutiveFailures,
            pages: stage.pages,
            recordsRead: stage.recordsRead,
          };
          control.fencingNumber++;
          control.stageStatus = "progress";
          control.lastErrorCode = null;
          // Exactly one existing control CAS. Original due/history/cursors and all
          // root/chunk/state-version bytes remain untouched. Finish is separate.
          await saveControl(guarded, control);
          return "repaired";
        },
        verifyAuthority,
        verifyAuthority
      );
    },
    readProgressSnapshot: () => readHqProgressSnapshot(pool, config),
    async readSnapshot() {
      const f = binding();
      return transaction(async c => {
        const control = await locked(c, f);
        const state = await sync(c, f);
        if (!control && state) fail("INVALID_PERSISTED_STATE");
        const databaseNowMs = await dbNow(c);
        assertBinding(f, binding());
        return { control, sync: state, databaseNowMs };
      });
    },
    async readPublished() {
      return (await store.readSnapshot()).sync?.published ?? null;
    },
    acquireInitialPublication: () => store.acquire(true),
    async acquire(initialOnly = false) {
      committedCompletionProof = undefined;
      const f = binding(true);
      return transaction(async c => {
        // INSERT IGNORE is initialization only; inspect by primary ID to reject foreign/sample collisions.
        const initial: HqLiveControl = {
          format: "hq-live-control-v1",
          version: 1,
          sourceFingerprint: f,
          fencingNumber: 0,
          leaseToken: null,
          leaseExpiresAtMs: null,
          leaseHardExpiresAtMs: null,
          nextDueAtMs: 0,
          consecutiveFailures: 0,
          lastAttemptAtMs: null,
          lastSuccessAtMs: null,
          lastPublishAtMs: null,
          lastErrorCode: null,
          stageStatus: "idle",
        };
        const [initialized] = await c.execute<ResultSetHeader>(
          "INSERT IGNORE INTO management_hq_datasets (datasetId,mode,ownerUserId,stateVersion,state,updatedAt) VALUES (?,'live',0,1,?,UTC_TIMESTAMP(3))",
          [HQ_LIVE_CONTROL_DATASET_ID, JSON.stringify(initial)]
        );
        const control = (await locked(c, f))!;
        if (!control) fail("STORE_UNAVAILABLE");
        // Reject corruption/binding drift BEFORE granting a lease/provider
        // request, without cloning a full tree merely to inspect presence.
        const { facts } = await fullSync(c, f, true, undefined, "verify");
        if (initialized.affectedRows === 1 && facts)
          fail("INVALID_PERSISTED_STATE"); // missing control is not an implicit protected reset
        if (initialOnly && facts && facts.publishedVersion !== null)
          return { status: "already_complete" };
        const now = await dbNow(c);
        if (control.leaseToken && control.leaseExpiresAtMs! > now)
          return { status: "busy" };
        if (control.stageStatus === "needs_attention")
          return { status: "needs_attention" };
        if (control.nextDueAtMs > now) return { status: "notdue" };
        if (control.fencingNumber >= MAX_VERSION) fail("VERSION_EXHAUSTED");
        control.fencingNumber++;
        control.leaseToken = randomUUID();
        control.lastAttemptAtMs = now;
        control.leaseExpiresAtMs = now + HQ_LIVE_LEASE_SECONDS * 1000;
        control.leaseHardExpiresAtMs = now + HQ_LIVE_MAX_LEASE_SECONDS * 1000;
        control.stageStatus = "running";
        await saveControl(c, control);
        return {
          status: "acquired",
          lease: {
            token: control.leaseToken,
            fencingNumber: control.fencingNumber,
            sourceFingerprint: f,
            hardExpiresAtMs: control.leaseHardExpiresAtMs,
          },
        };
      });
    },
    async renew(lease) {
      await transaction(async c => {
        const { control, now } = await guard(c, lease);
        control.leaseExpiresAtMs = Math.min(
          now + HQ_LIVE_LEASE_SECONDS * 1000,
          control.leaseHardExpiresAtMs!
        );
        await saveControl(c, control);
      });
    },
    renewCooperative: lease => transaction(c => renewCpuLease(c, lease)),
    fencedSyncStore(lease) {
      return {
        async readSync() {
          const f = binding();
          return transaction(async c => {
            // Keep original strong read-only snapshot semantics, including the
            // engine's recovery reread after a failed expiry-guarded CAS.
            const control = await locked(c, f);
            const loaded = await fullSync(c, f, true, lease);
            if (!control && loaded.state) fail("INVALID_PERSISTED_STATE");
            assertBinding(f, binding());
            return loaded.state;
          });
        },
        async compareAndSwapSync(expected, next) {
          committedCompletionProof = undefined; // a new write invalidates prior publication proof
          assertBinding(lease.sourceFingerprint, binding(true));
          if (
            !integer(next.version, 1, MAX_VERSION) ||
            next.version !== (expected ?? 0) + 1
          ) {
            if (initialReuseScope !== undefined) clearVerifiedV2();
            fail("INVALID_PERSISTED_STATE");
          }
          const nextVersion = next.version;
          // All encoding and bounded validation happens outside the transaction.
          // Prepare both representations because a small next state must stay v2
          // when its current root has already migrated.
          // Engine CAS inputs are private stable snapshots across these awaits.
          // Prepared bytes and scalar commit decisions are owned below; no
          // later transaction decision depends on a mutable caller object.
          let encoded: ReturnType<typeof encodeHqLiveV2Sync>;
          let preparedCandidate: VerifiedV2 | undefined;
          let preparedCompletionProof: CompletionProof | undefined;
          let legacy: string | null = null;
          const envelope: HqLiveSyncEnvelope = {
            format: "hq-live-sync-v1",
            sourceFingerprint: lease.sourceFingerprint,
            sync: next,
          };
          const cpu = checkpoint(lease.sourceFingerprint, () =>
            transaction(c => renewCpuLease(c, lease))
          );
          try {
            if (initialReuseScope === undefined) {
              encoded = await encodeHqLiveV2SyncAsync(
                next,
                lease.sourceFingerprint,
                cpu
              );
            } else {
              const owned = await encodeHqLiveV2SyncOwnedAsync(
                next,
                lease.sourceFingerprint,
                cpu
              );
              encoded = owned;
              envelope.sync = owned.candidate.state;
              if (
                owned.candidate.state.published === null &&
                owned.candidate.state.stage
              ) {
                preparedCandidate = {
                  sourceFingerprint: lease.sourceFingerprint,
                  rootCanonical: canonicalHqJson(owned.manifest),
                  chunks: owned.candidate.chunks,
                  state: owned.candidate.state,
                };
              }
              if (
                owned.candidate.state.stage === null &&
                owned.candidate.state.published !== null
              ) {
                preparedCompletionProof = {
                  sourceFingerprint: lease.sourceFingerprint,
                  rootCanonical: canonicalHqJson(owned.manifest),
                  chunks: new Map(
                    Array.from(owned.candidate.chunks, ([id, bytes]) => [
                      id,
                      Buffer.from(bytes),
                    ])
                  ),
                  facts: syncFacts(owned.candidate.state),
                  token: lease.token,
                  fencingNumber: lease.fencingNumber,
                  scope: initialReuseScope,
                  expiresAt: performance.now() + INITIAL_REUSE_TTL_MS,
                };
              }
            }
            if (
              encoded.manifest.syncVersion !== nextVersion ||
              next.version !== nextVersion
            )
              fail("INVALID_PERSISTED_STATE");
            const wrapperBytes =
              Buffer.byteLength(JSON.stringify({ ...envelope, sync: null })) -
              4;
            if (encoded.manifest.expandedBytes + wrapperBytes < V1_WRITE_BYTES)
              legacy = JSON.stringify(envelope);
          } catch (error) {
            if (initialReuseScope !== undefined) clearVerifiedV2();
            if (cpu.denial()) throw cpu.denial();
            if (error instanceof HqLiveError) throw error;
            if (isHqLiveV2CapacityError(error)) fail("STATE_BYTE_CAP_EXCEEDED");
            fail("INVALID_PERSISTED_STATE");
          }
          const manifestSerialized = JSON.stringify(encoded!.manifest);
          if (Buffer.byteLength(manifestSerialized) > HQ_LIVE_V2_ROOT_BYTES)
            fail("INVALID_PERSISTED_STATE");
          const completePublicationVersion =
            encoded!.manifest.sync.stage === null
              ? (encoded!.manifest.sync.published?.version ?? null)
              : null;
          const newRefs = manifestChunkRefs(encoded!.manifest);
          const preparedChunks = new Map(
            encoded!.chunks.map(chunk => [chunk.id, chunk.serialized])
          );
          try {
            return await transaction(async c => {
              await guard(c, lease); // control lock before sync row; never a transaction around HTTP
              await renewCpuLease(c, lease);
              const loaded = await fullSync(
                c,
                lease.sourceFingerprint,
                true,
                lease,
                "verify"
              );
              const current = loaded.facts;
              if ((current?.version ?? null) !== expected) throw casMismatch;
              const useV2 = loaded.manifest !== null || legacy === null;
              const serialized = useV2 ? manifestSerialized : legacy!;
              const oldRefs = loaded.manifest
                ? manifestChunkRefs(loaded.manifest)
                : [];
              if (useV2) {
                const unheld = newRefs.filter(
                  ref => !loaded.chunks.has(ref.id)
                );
                // Exact locked lookups only, including collisions not referenced by the old root.
                const existing = await chunkRows(
                  c,
                  unheld,
                  lease.sourceFingerprint,
                  true
                );
                for (const ref of newRefs) {
                  const text = preparedChunks.get(ref.id);
                  if (!text) fail("INVALID_PERSISTED_STATE");
                  const reused =
                    loaded.chunks.get(ref.id) ?? existing.get(ref.id);
                  if (reused !== undefined) {
                    try {
                      if (
                        !validateHqV2Chunk(
                          reused,
                          ref,
                          lease.sourceFingerprint
                        ).equals(
                          validateHqV2Chunk(text, ref, lease.sourceFingerprint)
                        )
                      )
                        fail("INVALID_PERSISTED_STATE");
                    } catch {
                      fail("INVALID_PERSISTED_STATE");
                    }
                    continue;
                  }
                  await guard(c, lease);
                  const [inserted] = await c.execute<ResultSetHeader>(
                    "INSERT IGNORE INTO management_hq_datasets (datasetId,mode,ownerUserId,stateVersion,state,updatedAt) VALUES (?,'live',0,1,?,UTC_TIMESTAMP(3))",
                    [ref.id, text]
                  );
                  await guard(c, lease);
                  if (inserted.affectedRows !== 1) {
                    if (inserted.affectedRows !== 0)
                      fail("INVALID_PERSISTED_STATE");
                    const collided = await rows(c, ref.id, true);
                    if (collided.length !== 1) fail("INVALID_PERSISTED_STATE");
                    if (
                      !validateHqV2Chunk(
                        chunkText(collided[0], ref, lease.sourceFingerprint),
                        ref,
                        lease.sourceFingerprint
                      ).equals(
                        validateHqV2Chunk(text, ref, lease.sourceFingerprint)
                      )
                    )
                      fail("INVALID_PERSISTED_STATE");
                  }
                }
              }
              // Recheck DB clock/binding/fence immediately before EVERY sync CAS (including publication/410).
              const { control, now } = await guard(c, lease);
              let r: ResultSetHeader;
              // The read candidate describes the old root, NEVER this write.
              // Clear before root SQL; denial/zero CAS/rollback cannot promote it.
              pendingV2.delete(c);
              clearVerifiedV2();
              if (expected === null)
                [r] = await c.execute<ResultSetHeader>(
                  "INSERT IGNORE INTO management_hq_datasets (datasetId,mode,ownerUserId,stateVersion,state,updatedAt) VALUES (?,'live',0,1,?,UTC_TIMESTAMP(3))",
                  [HQ_LIVE_SYNC_DATASET_ID, serialized]
                );
              else
                [r] = await c.execute<ResultSetHeader>(
                  "UPDATE management_hq_datasets SET stateVersion = ?,state = ?,updatedAt = UTC_TIMESTAMP(3) WHERE datasetId = ? AND mode = 'live' AND ownerUserId = 0 AND stateVersion = ?",
                  [nextVersion, serialized, HQ_LIVE_SYNC_DATASET_ID, expected]
                );
              // Once chunks may have been inserted, a false return would commit
              // orphan mutations. Any failed root CAS is therefore a rollback.
              if (r.affectedRows !== 1) fail("LEASE_LOST");
              if (useV2 && preparedCandidate)
                pendingV2.set(c, preparedCandidate);
              if (useV2 && preparedCompletionProof)
                pendingCompletionProof.set(c, preparedCompletionProof);
              // A sync write can itself cross expiry: staging, 410 intent/cleanup and publication all roll back.
              await guard(c, lease);
              if (useV2) {
                const retained = new Set(newRefs.map(ref => ref.id));
                for (const ref of oldRefs) {
                  if (retained.has(ref.id)) continue;
                  await guard(c, lease);
                  const [deleted] = await c.execute<ResultSetHeader>(
                    "DELETE FROM management_hq_datasets WHERE datasetId = ? AND mode = 'live' AND ownerUserId = 0 AND stateVersion = 1",
                    [ref.id]
                  );
                  await guard(c, lease);
                  if (deleted.affectedRows !== 1)
                    fail("INVALID_PERSISTED_STATE");
                }
              }
              if (
                completePublicationVersion !== null &&
                completePublicationVersion !== current?.publishedVersion
              ) {
                control.lastPublishAtMs = now;
                await guard(c, lease); // final success/control update is guarded too
                await saveControl(c, control);
                await guard(c, lease);
              }
              await guard(c, lease); // fresh configuration/fence/database clock before commit
              return true;
            });
          } catch (error) {
            if (error === casMismatch) return false;
            throw error;
          }
        },
      };
    },
    async complete(lease, completion) {
      if (
        !integer(completion.delaySeconds, 0, 3600) ||
        !["progress", "applied", "backoff", "needs_attention"].includes(
          completion.status
        ) ||
        (completion.errorCode !== undefined &&
          !(HQ_LIVE_ERROR_CODES as readonly unknown[]).includes(
            completion.errorCode
          ))
      ) {
        committedCompletionProof = undefined;
        fail("INVALID_PERSISTED_STATE");
      }
      try {
        await transaction(async c => {
          const opening = await guard(c, lease);
          const now = opening.now;
          await renewCpuLease(c, lease);
          await fullSync(c, lease.sourceFingerprint, true, lease, "complete"); // strong validation remains mandatory
          const verified = await guard(c, lease);
          const control = verified.control; // includes any fenced CPU renewals
          control.stageStatus = completion.status;
          control.nextDueAtMs = verified.now + completion.delaySeconds * 1000;
          control.lastErrorCode = completion.errorCode ?? null;
          if (completion.status === "applied") {
            control.lastSuccessAtMs = now;
            control.consecutiveFailures = 0;
          } else if (
            completion.status === "backoff" ||
            completion.status === "needs_attention"
          )
            control.consecutiveFailures = Math.min(
              control.consecutiveFailures + 1,
              1000000
            );
          else control.consecutiveFailures = 0;
          // Releasing the token is not permission to cross its DB deadlines
          // during the final UPDATE/authority await/COMMIT boundary.
          retainRenewalDeadline(
            c,
            control.leaseExpiresAtMs!,
            control.leaseHardExpiresAtMs!
          );
          control.leaseToken = null;
          control.leaseExpiresAtMs = null;
          control.leaseHardExpiresAtMs = null;
          await saveControl(c, control);
        });
      } finally {
        committedCompletionProof = undefined;
      }
    },
  };
  return store;
}
export interface HqLiveStore {
  readSnapshot(): Promise<HqLiveSnapshot>;
  readProgressSnapshot?(): Promise<HqProgressSnapshot>;
  readPublished(): Promise<HqImplementedState | null>;
  recoverEmptyInitialImport?(
    expectedVersion: number,
    authority: () => Promise<void>
  ): Promise<HqLiveInitialRecoveryResult>;
  resumeStagedInitialImport?(
    expectedControlVersion: number,
    expectedSyncVersion: number,
    authority: () => Promise<void>
  ): Promise<HqLiveStagedResumeResult>;
  repairInitialCapacity?(
    expectedControlVersion: number,
    expectedSyncVersion: number,
    authority: () => Promise<void>
  ): Promise<HqLiveInitialCapacityRepairResult>;
  acquire(initialOnly?: boolean): Promise<HqLiveAcquireResult>;
  acquireInitialPublication?(): Promise<HqLiveAcquireResult>;
  renew(lease: HqLiveLease): Promise<void>;
  renewCooperative?(lease: HqLiveLease): Promise<void>;
  fencedSyncStore(lease: HqLiveLease): HqImplementedStore;
  complete(lease: HqLiveLease, completion: HqLiveCompletion): Promise<void>;
}
