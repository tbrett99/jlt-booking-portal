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

/** Reserved service namespace; ownerUserId=0 creates no user and has no FK. Never caller-selected. */
export const HQ_LIVE_SYNC_DATASET_ID = "live:company:orbit:v1:sync";
export const HQ_LIVE_CONTROL_DATASET_ID = "live:company:orbit:v1:control";
export const HQ_LIVE_OWNER_USER_ID = 0;
export const HQ_LIVE_LEASE_SECONDS = 30;
export const HQ_LIVE_MAX_LEASE_SECONDS = 95;
const MAX_VERSION = 2_147_483_646;
const MAX_BYTES = 16 * 1024 * 1024;
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
    work: (c: PoolConnection) => Promise<T>
  ): Promise<T> {
    let c: PoolConnection | undefined;
    try {
      c = await pool.getConnection();
      await c.beginTransaction();
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
  async function sync(
    c: PoolConnection,
    f: string
  ): Promise<HqImplementedSyncState | null> {
    const result = await rows(c, HQ_LIVE_SYNC_DATASET_ID);
    if (!result.length) return null;
    const envelope = syncRow(result[0]);
    assertBinding(f, envelope.sourceFingerprint);
    return envelope.sync;
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
    async readSnapshot() {
      const f = binding();
      return transaction(async c => {
        const control = await locked(c, f);
        const state = await sync(c, f);
        if (!control && state) fail("INVALID_PERSISTED_STATE");
        return { control, sync: state, databaseNowMs: await dbNow(c) };
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
          binding(true);
          try {
            validateHqImplementedSyncState(next);
          } catch {
            fail("INVALID_PERSISTED_STATE");
          }
          if (
            !integer(next.version, 1, MAX_VERSION) ||
            next.version !== (expected ?? 0) + 1
          )
            fail("INVALID_PERSISTED_STATE");
          const envelope: HqLiveSyncEnvelope = {
            format: "hq-live-sync-v1",
            sourceFingerprint: lease.sourceFingerprint,
            sync: next,
          };
          const serialized = JSON.stringify(envelope);
          if (Buffer.byteLength(serialized) > MAX_BYTES)
            fail("INVALID_PERSISTED_STATE");
          return transaction(async c => {
            await guard(c, lease); // control lock before sync row; never a transaction around HTTP
            const current = await sync(c, lease.sourceFingerprint);
            if ((current?.version ?? null) !== expected) return false;
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
            if (r.affectedRows !== 1) return false;
            // A sync write can itself cross expiry: staging, 410 intent/cleanup and publication all roll back.
            await guard(c, lease);
            if (
              next.stage === null &&
              next.published &&
              next.published.version !== current?.published?.version
            ) {
              control.lastPublishAtMs = now;
              await guard(c, lease); // final success/control update is guarded too
              await saveControl(c, control);
            }
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
  acquire(): Promise<HqLiveAcquireResult>;
  renew(lease: HqLiveLease): Promise<void>;
  fencedSyncStore(lease: HqLiveLease): HqImplementedStore;
  complete(lease: HqLiveLease, completion: HqLiveCompletion): Promise<void>;
}
