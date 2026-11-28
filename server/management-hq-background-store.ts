import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import {
  HqLiveError,
  HQ_LIVE_ERROR_CODES,
  type HqLiveErrorCode,
} from "./management-hq-live-store";
import { hqReadDeadline } from "./management-hq-read-deadline";

/** This one reserved row is independent of the existing reporting control/root/chunks. */
export const HQ_BACKGROUND_DATASET_ID =
  "live:company:orbit:v1:initial-background";
export const HQ_BACKGROUND_RUN_MS = 24 * 60 * 60 * 1000;
export const HQ_BACKGROUND_LEASE_MS = 10 * 60 * 1000;
export const HQ_BACKGROUND_MAX_ATTEMPTS = 200;
export const HQ_BACKGROUND_MAX_ERRORS = 3;
const MAX_VERSION = 2_147_483_646;
const MAX_BYTES = 4096;
const KEYS = [
  "format",
  "version",
  "sourceBinding",
  "actorId",
  "status",
  "startedAtMs",
  "updatedAtMs",
  "expiresAtMs",
  "attempts",
  "consecutiveErrors",
  "nextDueAtMs",
  "token",
  "leaseUntilMs",
  "lastErrorCode",
] as const;
export type HqBackgroundStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed";
export interface HqBackgroundJob {
  format: "hq-initial-background-v1";
  version: number;
  sourceBinding: string;
  actorId: number;
  status: HqBackgroundStatus;
  startedAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  attempts: number;
  consecutiveErrors: number;
  nextDueAtMs: number;
  token: string | null;
  leaseUntilMs: number | null;
  lastErrorCode: HqLiveErrorCode | null;
}
export interface HqBackgroundOutcome {
  status: "queued" | "completed" | "failed";
  nextDueAtMs?: number;
  errorCode?: HqLiveErrorCode | null;
}
export type HqBackgroundClaimResult =
  | { kind: "claimed"; job: HqBackgroundJob }
  | { kind: "idle"; job: HqBackgroundJob | null };
export interface HqBackgroundStore {
  /** Metadata only: no source requests, payload-tree reads, lease or job mutations. */
  read(): Promise<{ job: HqBackgroundJob | null; databaseNowMs: number }>;
  start(
    actorId: number,
    sourceBinding: string,
    guard: () => Promise<void>
  ): Promise<HqBackgroundJob>;
  pause(guard: () => Promise<void>): Promise<HqBackgroundJob | null>;
  claim(
    sourceBinding: string,
    guard: () => Promise<void>
  ): Promise<HqBackgroundClaimResult>;
  settle(
    token: string,
    outcome: HqBackgroundOutcome,
    guard: () => Promise<void>
  ): Promise<HqBackgroundJob | null>;
}
const fail = (code: HqLiveErrorCode): never => {
  throw new HqLiveError(code);
};
const integer = (
  v: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER
): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const errorCode = (v: unknown): v is HqLiveErrorCode | null =>
  v === null ||
  (typeof v === "string" &&
    (HQ_LIVE_ERROR_CODES as readonly string[]).includes(v));
const active = (j: HqBackgroundJob) =>
  j.status === "queued" || j.status === "running";
const safeError = (error: unknown): HqLiveError =>
  error instanceof HqLiveError ? error : new HqLiveError("STORE_UNAVAILABLE");
const isStartContention = (error: unknown) => {
  const e = error as { code?: unknown; errno?: unknown } | null;
  return (
    !!e &&
    ((e.code === "ER_LOCK_DEADLOCK" && e.errno === 1213) ||
      (e.code === "ER_DUP_ENTRY" && e.errno === 1062))
  );
};
// mysql2 normally returns these INTEGER values as numbers; canonical numeric strings
// are supported, but coercions such as null/false/empty string are never accepted.
const columnInteger = (v: unknown, min: number, max: number): number => {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v)
        ? Number(v)
        : NaN;
  if (!integer(n, min, max)) fail("INVALID_PERSISTED_STATE");
  return n;
};
function validateJob(value: unknown, version: number): HqBackgroundJob {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("INVALID_PERSISTED_STATE");
  const j = value as HqBackgroundJob;
  if (
    Object.keys(j).length !== KEYS.length ||
    KEYS.some(k => !Object.prototype.hasOwnProperty.call(j, k)) ||
    j.format !== "hq-initial-background-v1" ||
    !integer(j.version, 1, MAX_VERSION) ||
    j.version !== version ||
    !hash(j.sourceBinding) ||
    !integer(j.actorId, 1) ||
    !["queued", "running", "paused", "completed", "failed"].includes(
      j.status
    ) ||
    !integer(
      j.startedAtMs,
      1,
      Number.MAX_SAFE_INTEGER - HQ_BACKGROUND_RUN_MS
    ) ||
    !integer(j.updatedAtMs, j.startedAtMs) ||
    !integer(j.expiresAtMs, 1) ||
    j.expiresAtMs !== j.startedAtMs + HQ_BACKGROUND_RUN_MS ||
    !integer(j.attempts, 0, HQ_BACKGROUND_MAX_ATTEMPTS) ||
    !integer(j.consecutiveErrors, 0, HQ_BACKGROUND_MAX_ERRORS) ||
    !integer(j.nextDueAtMs) ||
    !errorCode(j.lastErrorCode) ||
    (j.token !== null && !uuid(j.token)) ||
    (j.leaseUntilMs !== null && !integer(j.leaseUntilMs, 1)) ||
    (j.status === "running"
      ? j.token === null || j.leaseUntilMs === null
      : j.token !== null || j.leaseUntilMs !== null) ||
    (j.status === "running" &&
      (j.attempts < 1 ||
        j.updatedAtMs >= j.expiresAtMs ||
        j.leaseUntilMs! !==
          Math.min(j.updatedAtMs + HQ_BACKGROUND_LEASE_MS, j.expiresAtMs)))
  )
    fail("INVALID_PERSISTED_STATE");
  return j;
}
function parseRow(row: RowDataPacket): HqBackgroundJob {
  try {
    if (
      row.datasetId !== HQ_BACKGROUND_DATASET_ID ||
      row.mode !== "live" ||
      columnInteger(row.ownerUserId, 0, 0) !== 0
    )
      fail("INVALID_PERSISTED_STATE");
    const version = columnInteger(row.stateVersion, 1, MAX_VERSION);
    // The SELECT caps even hostile row responses; still validate bytes independently.
    columnInteger(row.stateBytes, 1, MAX_BYTES);
    if (row.state === null) fail("INVALID_PERSISTED_STATE");
    const text =
      typeof row.state === "string" ? row.state : JSON.stringify(row.state);
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_BYTES)
      fail("INVALID_PERSISTED_STATE");
    return validateJob(JSON.parse(text), version);
  } catch {
    return fail("INVALID_PERSISTED_STATE");
  }
}
const NOW_SQL =
  "SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS nowMs";
const READ_SQL =
  "SELECT datasetId,mode,ownerUserId,stateVersion,OCTET_LENGTH(CAST(state AS CHAR CHARACTER SET utf8mb4)) AS stateBytes,CASE WHEN OCTET_LENGTH(CAST(state AS CHAR CHARACTER SET utf8mb4)) <= 4096 THEN state ELSE NULL END AS state FROM management_hq_datasets WHERE datasetId = ?";
const OBSERVE_SQL =
  "SELECT clock.nowMs,job.datasetId,job.mode,job.ownerUserId,job.stateVersion,OCTET_LENGTH(CAST(job.state AS CHAR CHARACTER SET utf8mb4)) AS stateBytes,CASE WHEN OCTET_LENGTH(CAST(job.state AS CHAR CHARACTER SET utf8mb4)) <= 4096 THEN job.state ELSE NULL END AS state FROM (SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS nowMs) AS clock LEFT JOIN management_hq_datasets AS job ON job.datasetId = ?";
const INSERT_SQL =
  "INSERT INTO management_hq_datasets (datasetId,mode,ownerUserId,stateVersion,state,updatedAt) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))";
const UPDATE_SQL =
  "UPDATE management_hq_datasets SET stateVersion = ?,state = ?,updatedAt = UTC_TIMESTAMP(3) WHERE datasetId = ? AND mode = ? AND ownerUserId = ? AND stateVersion = ?";

/** No environment access, pool creation, timer, schema change, or reporting-store calls.
 * The caller owns fresh authority/settings checks. Denial remains latched for this
 * entire operation, even if the supplied guard subsequently starts succeeding.
 */
export function createHqBackgroundStore(pool: Pool): HqBackgroundStore {
  // Lazy: connection-only Portal routes never instantiate this job store.
  class StartContention extends HqLiveError {}
  async function now(
    c: PoolConnection,
    check?: () => Promise<void>
  ): Promise<number> {
    let rows: RowDataPacket[];
    try {
      [rows] = await c.execute<RowDataPacket[]>(NOW_SQL);
    } finally {
      await check?.();
    }
    const n = Number(rows[0]?.nowMs);
    if (!integer(n, 1)) fail("STORE_UNAVAILABLE");
    return n;
  }
  async function load(
    c: PoolConnection,
    lock: boolean,
    check?: () => Promise<void>
  ): Promise<HqBackgroundJob | null> {
    let rows: RowDataPacket[];
    try {
      [rows] = await c.execute<RowDataPacket[]>(
        READ_SQL + (lock ? " FOR UPDATE" : ""),
        [HQ_BACKGROUND_DATASET_ID]
      );
    } finally {
      await check?.();
    }
    if (!Array.isArray(rows) || rows.length > 1)
      fail("INVALID_PERSISTED_STATE");
    return rows.length ? parseRow(rows[0]) : null;
  }
  type Decision<T> = { result: T; write?: HqBackgroundJob; deadline?: number };
  async function mutate<T>(
    guard: () => Promise<void>,
    decide: (job: HqBackgroundJob | null, time: number) => Decision<T>
  ): Promise<T> {
    if (typeof guard !== "function") fail("CONFIG_INVALID");
    let denial: HqLiveError | undefined;
    const check = async () => {
      try {
        await guard();
      } catch (error) {
        denial ??= safeError(error);
      }
      if (denial) throw denial;
    };
    let c: PoolConnection | undefined;
    let committed = false;
    let commitStarted = false;
    try {
      await check();
      try {
        c = await pool.getConnection();
      } finally {
        await check();
      }
      try {
        await c.beginTransaction();
      } finally {
        await check();
      }
      // The exact primary-key row (or its absence) is locked before reading the DB clock.
      const original = await load(c, true, check);
      await check();
      const at = await now(c, check);
      await check();
      if (original && at < original.updatedAtMs)
        fail("INVALID_PERSISTED_STATE");
      const decision = decide(original, at);
      if (decision.write) {
        const j = validateJob(decision.write, decision.write.version);
        const text = JSON.stringify(j);
        if (Buffer.byteLength(text, "utf8") > MAX_BYTES)
          fail("INVALID_PERSISTED_STATE");
        await check();
        let result: ResultSetHeader;
        try {
          [result] = original
            ? await c.execute<ResultSetHeader>(UPDATE_SQL, [
                j.version,
                text,
                HQ_BACKGROUND_DATASET_ID,
                "live",
                0,
                original.version,
              ])
            : await c.execute<ResultSetHeader>(INSERT_SQL, [
                HQ_BACKGROUND_DATASET_ID,
                "live",
                0,
                j.version,
                text,
              ]);
        } finally {
          await check();
        }
        if (result.affectedRows !== 1) fail("STORE_UNAVAILABLE");
      }
      await check();
      // Refresh authoritative DB time after the write; conservatively count any
      // awaited final guard time too. No renewal or sliding run window exists.
      const sampledAt = performance.now();
      const finalNow = await now(c, check);
      await check();
      if (
        finalNow < at ||
        (decision.deadline !== undefined &&
          finalNow + Math.ceil(performance.now() - sampledAt) >=
            decision.deadline)
      )
        fail("STORE_UNAVAILABLE");
      await check(); // last awaited authority check inside rollback boundary
      if (
        decision.deadline !== undefined &&
        finalNow + Math.ceil(performance.now() - sampledAt) >= decision.deadline
      )
        fail("STORE_UNAVAILABLE");
      try {
        commitStarted = true;
        await c.commit();
        committed = true;
      } finally {
        await check();
      }
      return decision.result;
    } catch (error) {
      let rolledBack = false;
      if (c && !committed) {
        try {
          await c.rollback();
          rolledBack = true;
        } catch {
          /* operation still fails; never provider text */
        }
        try {
          await check();
        } catch {
          /* retain the permanently latched denial */
        }
      }
      if (!denial && !commitStarted && rolledBack && isStartContention(error))
        throw new StartContention("STORE_UNAVAILABLE");
      throw denial ?? safeError(error);
    } finally {
      try {
        c?.release();
      } catch {
        fail("STORE_UNAVAILABLE");
      }
    }
  }
  function bump(
    j: HqBackgroundJob,
    at: number,
    patch: Partial<HqBackgroundJob>
  ): HqBackgroundJob {
    if (j.version >= MAX_VERSION || at < j.updatedAtMs)
      fail("INVALID_PERSISTED_STATE");
    return { ...j, ...patch, version: j.version + 1, updatedAtMs: at };
  }
  function failed(
    j: HqBackgroundJob,
    at: number,
    code: HqLiveErrorCode
  ): HqBackgroundJob {
    return bump(j, at, {
      status: "failed",
      token: null,
      leaseUntilMs: null,
      lastErrorCode: code,
    });
  }
  function newRun(
    actorId: number,
    binding: string,
    at: number,
    version: number
  ): HqBackgroundJob {
    if (
      !integer(at, 1, Number.MAX_SAFE_INTEGER - HQ_BACKGROUND_RUN_MS) ||
      !integer(version, 1, MAX_VERSION)
    )
      fail("INVALID_PERSISTED_STATE");
    return {
      format: "hq-initial-background-v1",
      version,
      sourceBinding: binding,
      actorId,
      status: "queued",
      startedAtMs: at,
      updatedAtMs: at,
      expiresAtMs: at + HQ_BACKGROUND_RUN_MS,
      attempts: 0,
      consecutiveErrors: 0,
      nextDueAtMs: at,
      token: null,
      leaseUntilMs: null,
      lastErrorCode: null,
    };
  }
  return {
    async read() {
      let abandoned = false;
      try {
        // The helper abandons only this read result; no cancellation or retry.
        // Connection cleanup lives inside the work, including late resolution.
        return await hqReadDeadline(async () => {
          let c: PoolConnection | undefined;
          try {
            c = await pool.getConnection();
            if (abandoned) fail("STORE_UNAVAILABLE");
            // Exact indexed join returns clock even without a job. No transaction,
            // FOR UPDATE, job mutation or dependency on a reporting-control lock.
            const [rows] = await c.execute<RowDataPacket[]>(OBSERVE_SQL, [
              HQ_BACKGROUND_DATASET_ID,
            ]);
            if (abandoned) fail("STORE_UNAVAILABLE");
            if (!Array.isArray(rows) || rows.length !== 1)
              fail("INVALID_PERSISTED_STATE");
            const databaseNowMs = Number(rows[0].nowMs);
            if (!integer(databaseNowMs, 1)) fail("STORE_UNAVAILABLE");
            const absent = rows[0].datasetId === null;
            if (
              absent &&
              [
                "mode",
                "ownerUserId",
                "stateVersion",
                "stateBytes",
                "state",
              ].some(k => rows[0][k] !== null)
            )
              fail("INVALID_PERSISTED_STATE");
            const job = absent ? null : parseRow(rows[0]);
            return { job, databaseNowMs };
          } finally {
            try {
              c?.release();
            } catch {
              fail("STORE_UNAVAILABLE");
            }
          }
        });
      } catch (error) {
        abandoned = true;
        throw safeError(error);
      }
    },
    async start(actorId, sourceBinding, guard) {
      if (!integer(actorId, 1) || !hash(sourceBinding)) fail("CONFIG_INVALID");
      const attempt = () =>
        mutate(guard, (j, at) => {
          if (j && active(j)) {
            if (j.sourceBinding !== sourceBinding) fail("CONFIG_INVALID");
            if (at >= j.expiresAtMs) {
              const stopped = failed(j, at, "SOURCE_EXPIRED");
              return { result: stopped, write: stopped };
            }
            return { result: j, deadline: j.expiresAtMs };
          }
          if (j?.status === "completed") fail("CONFIG_INVALID");
          if (j && (j.version >= MAX_VERSION || at < j.updatedAtMs))
            fail("INVALID_PERSISTED_STATE");
          const started = newRun(
            actorId,
            sourceBinding,
            at,
            j ? j.version + 1 : 1
          );
          return {
            result: started,
            write: started,
            deadline: started.expiresAtMs,
          };
        });
      try {
        return await attempt();
      } catch (error) {
        // Exactly one fresh short transaction after a proven rolled-back SQL
        // contention. Never retry source work, uncertain COMMIT, denial or timeout.
        if (!(error instanceof StartContention)) throw error;
        return await attempt();
      }
    },
    async pause(guard) {
      return mutate(guard, (j, at) => {
        if (!j || !active(j)) return { result: j };
        const paused = bump(j, at, {
          status: "paused",
          token: null,
          leaseUntilMs: null,
        });
        return { result: paused, write: paused };
      });
    },
    async claim(sourceBinding, guard) {
      if (!hash(sourceBinding)) fail("CONFIG_INVALID");
      return mutate<HqBackgroundClaimResult>(guard, (j, at) => {
        if (!j || !active(j)) return { result: { kind: "idle", job: j } };
        if (j.sourceBinding !== sourceBinding) fail("CONFIG_INVALID");
        if (
          at >= j.expiresAtMs ||
          j.attempts >= HQ_BACKGROUND_MAX_ATTEMPTS ||
          j.consecutiveErrors >= HQ_BACKGROUND_MAX_ERRORS
        ) {
          const stopped = failed(
            j,
            at,
            at >= j.expiresAtMs
              ? "SOURCE_EXPIRED"
              : (j.lastErrorCode ?? "STORE_UNAVAILABLE")
          );
          return { result: { kind: "idle", job: stopped }, write: stopped };
        }
        if (
          j.nextDueAtMs > at ||
          (j.status === "running" && j.leaseUntilMs! > at)
        )
          return { result: { kind: "idle", job: j } };
        const claimed = bump(j, at, {
          status: "running",
          attempts: j.attempts + 1,
          token: randomUUID(),
          leaseUntilMs: Math.min(at + HQ_BACKGROUND_LEASE_MS, j.expiresAtMs),
        });
        return {
          result: { kind: "claimed", job: claimed },
          write: claimed,
          deadline: claimed.leaseUntilMs!,
        };
      });
    },
    async settle(token, outcome, guard) {
      if (
        !uuid(token) ||
        !outcome ||
        typeof outcome !== "object" ||
        Array.isArray(outcome) ||
        Object.keys(outcome).some(
          k => !["status", "nextDueAtMs", "errorCode"].includes(k)
        ) ||
        !["queued", "completed", "failed"].includes(outcome.status) ||
        (outcome.nextDueAtMs !== undefined && !integer(outcome.nextDueAtMs)) ||
        (outcome.errorCode !== undefined && !errorCode(outcome.errorCode))
      )
        fail("CONFIG_INVALID");
      // Capture scalar inputs before any await; no caller mutation can alter this outcome.
      const status = outcome.status,
        nextDueAtMs = outcome.nextDueAtMs,
        code = outcome.errorCode ?? null;
      const hasErrorCode = outcome.errorCode !== undefined;
      return mutate(guard, (j, at) => {
        if (
          !j ||
          j.status !== "running" ||
          j.token !== token ||
          at >= j.expiresAtMs ||
          at >= j.leaseUntilMs!
        )
          return { result: j };
        const errors =
          status === "queued"
            ? code === null
              ? 0
              : j.consecutiveErrors + 1
            : j.consecutiveErrors;
        const nextStatus =
          status === "queued" &&
          (errors >= HQ_BACKGROUND_MAX_ERRORS ||
            j.attempts >= HQ_BACKGROUND_MAX_ATTEMPTS)
            ? "failed"
            : status;
        const settled = bump(j, at, {
          status: nextStatus,
          nextDueAtMs: nextDueAtMs ?? j.nextDueAtMs,
          consecutiveErrors: errors,
          token: null,
          leaseUntilMs: null,
          lastErrorCode:
            status === "failed" && !hasErrorCode ? j.lastErrorCode : code,
        });
        return {
          result: settled,
          write: settled,
          deadline: Math.min(j.expiresAtMs, j.leaseUntilMs!),
        };
      });
    },
  };
}
