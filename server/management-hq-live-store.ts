import { randomUUID } from "node:crypto";
import type {
  Pool,
  PoolConnection,
  RowDataPacket,
  ResultSetHeader,
} from "mysql2/promise";
import {
  validateHqImplementedSyncState,
  type HqImplementedState,
  type HqImplementedStore,
  type HqImplementedSyncState,
} from "./management-hq-ingestion";
import type { HqLiveConfig } from "./management-hq-live-config";
import {
  decodeHqLiveV2Sync,
  encodeHqLiveV2Sync,
  hqJsonUtf8Bytes,
  manifestChunkRefs,
  validateHqV2Chunk,
  validateHqV2Manifest,
  HQ_LIVE_V2_CHUNK_ROW_BYTES,
  HQ_LIVE_V2_ROOT_BYTES,
  type HqV2Manifest,
  type HqV2ChunkRef,
} from "./management-hq-storage-v2";

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
  | { status: "busy" | "notdue" | "needs_attention" };
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
  return c;
}
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
/** Short transactions only. All sync/control writes lock the same control row first. */
export function createHqLiveStore(
  pool: Pool,
  config: HqLiveConfig
): HqLiveStore {
  function binding(write = false): string {
    const s = config.status(),
      f = config.sourceFingerprint();
    if (
      !s.configured ||
      !f ||
      (write ? !s.syncEnabled : !s.syncEnabled && !s.readEnabled)
    )
      fail("CONFIG_INVALID");
    return f;
  }
  async function transaction<T>(
    work: (c: PoolConnection) => Promise<T>,
    openingAuthority?: () => Promise<void>
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
      await c.commit();
      return result;
    } catch (error) {
      if (c)
        try {
          await c.rollback();
        } catch {
          /* no provider text */
        }
      if (error instanceof HqLiveError) throw error;
      return fail("STORE_UNAVAILABLE");
    } finally {
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
    if (actual !== f) fail("SOURCE_BINDING_CHANGED");
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
  async function fullSync(
    c: PoolConnection,
    f: string
  ): Promise<{
    state: HqImplementedSyncState | null;
    manifest: HqV2Manifest | null;
    chunks: Map<string, string>;
  }> {
    const result = await rows(c, HQ_LIVE_SYNC_DATASET_ID);
    if (!result.length) {
      assertBinding(f, binding());
      return { state: null, manifest: null, chunks: new Map() };
    }
    const root = parseRow(
      result[0],
      HQ_LIVE_SYNC_DATASET_ID,
      HQ_LIVE_V2_ROOT_BYTES
    ) as HqV2Manifest;
    if (root?.format !== "hq-live-sync-manifest-v2") {
      const envelope = syncRow(result[0]);
      assertBinding(f, envelope.sourceFingerprint);
      assertBinding(f, binding());
      return { state: envelope.sync, manifest: null, chunks: new Map() };
    }
    if (hash(root.sourceFingerprint)) assertBinding(f, root.sourceFingerprint);
    let refs: HqV2ChunkRef[];
    try {
      validateHqV2Manifest(root, Number(result[0].stateVersion), f);
      refs = manifestChunkRefs(root);
    } catch {
      fail("INVALID_PERSISTED_STATE");
    }
    const chunks = await chunkRows(c, refs!, f);
    let state: HqImplementedSyncState;
    try {
      state = decodeHqLiveV2Sync(root, chunks, f);
    } catch {
      fail("INVALID_PERSISTED_STATE");
    }
    assertBinding(f, binding()); // no state exposure after an awaited binding drift
    return { state: state!, manifest: root, chunks };
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
        const loaded = await fullSync(guarded, originalBinding!);
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
    async acquire() {
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
        const state = await sync(c, f); // reject corrupt or differently-bound state BEFORE granting a lease/provider request
        if (initialized.affectedRows === 1 && state)
          fail("INVALID_PERSISTED_STATE"); // missing control is not an implicit protected reset
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
    fencedSyncStore(lease) {
      return {
        async readSync() {
          return (await store.readSnapshot()).sync;
        },
        async compareAndSwapSync(expected, next) {
          assertBinding(lease.sourceFingerprint, binding(true));
          if (
            !integer(next.version, 1, MAX_VERSION) ||
            next.version !== (expected ?? 0) + 1
          )
            fail("INVALID_PERSISTED_STATE");
          // All encoding and bounded validation happens outside the transaction.
          // Prepare both representations because a small next state must stay v2
          // when its current root has already migrated.
          let encoded: ReturnType<typeof encodeHqLiveV2Sync>;
          let legacy: string | null = null;
          const envelope: HqLiveSyncEnvelope = {
            format: "hq-live-sync-v1",
            sourceFingerprint: lease.sourceFingerprint,
            sync: next,
          };
          try {
            encoded = encodeHqLiveV2Sync(next, lease.sourceFingerprint);
            if (hqJsonUtf8Bytes(envelope) < V1_WRITE_BYTES)
              legacy = JSON.stringify(envelope);
          } catch {
            fail("INVALID_PERSISTED_STATE");
          }
          const manifestSerialized = JSON.stringify(encoded!.manifest);
          if (Buffer.byteLength(manifestSerialized) > HQ_LIVE_V2_ROOT_BYTES)
            fail("INVALID_PERSISTED_STATE");
          const newRefs = manifestChunkRefs(encoded!.manifest);
          const preparedChunks = new Map(
            encoded!.chunks.map(chunk => [chunk.id, chunk.serialized])
          );
          return transaction(async c => {
            await guard(c, lease); // control lock before sync row; never a transaction around HTTP
            const loaded = await fullSync(c, lease.sourceFingerprint);
            const current = loaded.state;
            if ((current?.version ?? null) !== expected) return false;
            const useV2 = loaded.manifest !== null || legacy === null;
            const serialized = useV2 ? manifestSerialized : legacy!;
            const oldRefs = loaded.manifest
              ? manifestChunkRefs(loaded.manifest)
              : [];
            if (useV2) {
              const unheld = newRefs.filter(ref => !loaded.chunks.has(ref.id));
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
            if (expected === null)
              [r] = await c.execute<ResultSetHeader>(
                "INSERT IGNORE INTO management_hq_datasets (datasetId,mode,ownerUserId,stateVersion,state,updatedAt) VALUES (?,'live',0,1,?,UTC_TIMESTAMP(3))",
                [HQ_LIVE_SYNC_DATASET_ID, serialized]
              );
            else
              [r] = await c.execute<ResultSetHeader>(
                "UPDATE management_hq_datasets SET stateVersion = ?,state = ?,updatedAt = UTC_TIMESTAMP(3) WHERE datasetId = ? AND mode = 'live' AND ownerUserId = 0 AND stateVersion = ?",
                [next.version, serialized, HQ_LIVE_SYNC_DATASET_ID, expected]
              );
            // Once chunks may have been inserted, a false return would commit
            // orphan mutations. Any failed root CAS is therefore a rollback.
            if (r.affectedRows !== 1) fail("LEASE_LOST");
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
                if (deleted.affectedRows !== 1) fail("INVALID_PERSISTED_STATE");
              }
            }
            if (
              next.stage === null &&
              next.published &&
              next.published.version !== current?.published?.version
            ) {
              control.lastPublishAtMs = now;
              await guard(c, lease); // final success/control update is guarded too
              await saveControl(c, control);
              await guard(c, lease);
            }
            await guard(c, lease); // fresh configuration/fence/database clock before commit
            return true;
          });
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
      )
        fail("INVALID_PERSISTED_STATE");
      await transaction(async c => {
        const { control, now } = await guard(c, lease);
        await sync(c, lease.sourceFingerprint); // don't report successful health for corrupt cached state
        const verified = await guard(c, lease);
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
        control.leaseToken = null;
        control.leaseExpiresAtMs = null;
        control.leaseHardExpiresAtMs = null;
        await saveControl(c, control);
      });
    },
  };
  return store;
}
export interface HqLiveStore {
  readSnapshot(): Promise<HqLiveSnapshot>;
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
  acquire(): Promise<HqLiveAcquireResult>;
  renew(lease: HqLiveLease): Promise<void>;
  fencedSyncStore(lease: HqLiveLease): HqImplementedStore;
  complete(lease: HqLiveLease, completion: HqLiveCompletion): Promise<void>;
}
