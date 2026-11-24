import type { HqWireReader } from "../shared/management-hq-wire";
import { createHash } from "node:crypto";
import type { Pool } from "mysql2/promise";
import {
  createHqImplementedEngine,
  validateHqImplementedSyncState,
  type HqImplementedState,
} from "./management-hq-ingestion";
import {
  createHqLiveConfig,
  type HqLiveConfig,
  type HqLiveConfigurationStatus,
} from "./management-hq-live-config";
import {
  createHqLiveStore,
  HqLiveError,
  safeHqLiveErrorCode,
  type HqLiveErrorCode,
  type HqLiveSnapshot,
  type HqLiveStore,
} from "./management-hq-live-store";
import { HQ_LIVE_V2_VALIDATION_OPTIONS } from "./management-hq-storage-v2";

// One lazy process-wide pool, not one per HTTP request. No raw DB URI is retained in exported data.
// A runtime DB binding change requires process restart rather than silently mixing stores/pools.
let sharedPool: Promise<Pool> | null = null;
let sharedDatabaseFingerprint: string | null = null;
function currentDatabaseBinding(): string {
  const uri = process.env.DATABASE_URL;
  if (!uri) throw new HqLiveError("STORE_UNAVAILABLE");
  const fingerprint = createHash("sha256").update(uri).digest("hex");
  if (sharedDatabaseFingerprint && fingerprint !== sharedDatabaseFingerprint)
    throw new HqLiveError("CONFIG_INVALID");
  return uri;
}
async function getSharedHqPool(): Promise<Pool> {
  const uri = currentDatabaseBinding();
  if (!sharedPool) {
    sharedDatabaseFingerprint = createHash("sha256").update(uri).digest("hex");
    sharedPool = import("mysql2/promise").then(mysql =>
      mysql.createPool({
        uri,
        connectionLimit: 3,
        waitForConnections: true,
        queueLimit: 10,
        connectTimeout: 10000,
        timezone: "Z",
      })
    );
  }
  try {
    return await sharedPool;
  } catch {
    sharedPool = null;
    throw new HqLiveError("STORE_UNAVAILABLE");
  }
}
export const HQ_LIVE_MAX_SOURCE_METHODS = 25;
export const HQ_LIVE_METHOD_START_DEADLINE_MS = 75000;
export const HQ_LIVE_PROGRESS_DELAY_SECONDS = 60;
export type HqLiveInvocationStatus =
  | "disabled"
  | "notdue"
  | "busy"
  | "progress"
  | "applied"
  | "already_complete"
  | "needs_attention";
export interface HqLiveInvocationResult {
  status: HqLiveInvocationStatus;
  errorCode?: HqLiveErrorCode;
}
export interface HqLiveStatusDto extends HqLiveConfigurationStatus {
  health:
    | "disabled"
    | "no_data"
    | "ready"
    | "stale"
    | "progress"
    | "backoff"
    | "needs_attention";
  hasPublished: boolean;
  stateVersion: number | null;
  generationId: number | null;
  lastAttemptAt: string | null;
  lastSuccessfulCheckAt: string | null;
  lastPublishedAt: string | null;
  nextDueAt: string | null;
  lastErrorCode: HqLiveErrorCode | null;
  recoveryGuidance:
    | "restore_original_source_binding_or_explicit_protected_reset"
    | "investigate_before_explicit_protected_recovery"
    | null;
  stageStatus:
    | "idle"
    | "running"
    | "progress"
    | "applied"
    | "backoff"
    | "needs_attention";
  progress: {
    kind: "backfill" | "catchup";
    phase: string;
    pages: number;
    recordsRead: number;
  } | null;
  sourceObservationAt: string | null;
  sourcePublishedAt: string | null;
  sourceAgeSeconds: number | null;
  freshnessTargetSeconds: number;
  isStale: boolean | null;
}
const iso = (v: number | null | undefined) =>
  v == null ? null : new Date(v).toISOString();
/** Pure safe projection: excludes binding hash, lease data, cursors, records, URLs and secrets. */
export function buildHqLiveStatus(
  configuration: HqLiveConfigurationStatus,
  snapshot: HqLiveSnapshot | null = null,
  nowMs = Date.now(),
  errorCode: HqLiveErrorCode | null = null
): HqLiveStatusDto {
  if (snapshot)
    validateHqImplementedSyncState(
      snapshot.sync,
      HQ_LIVE_V2_VALIDATION_OPTIONS
    );
  const published = snapshot?.sync?.published,
    stage = snapshot?.sync?.stage,
    control = snapshot?.control;
  const sourceObservationAt =
    published?.metadata.sourceObservationWindow.to ?? null;
  const age = published
    ? Math.min(
        Number.MAX_SAFE_INTEGER,
        Math.max(
          0,
          Math.floor((nowMs - Date.parse(sourceObservationAt!)) / 1000),
          published.metadata.sourceAgeSeconds +
            Math.floor(
              Math.max(
                0,
                nowMs -
                  (control?.lastSuccessAtMs ??
                    control?.lastPublishAtMs ??
                    nowMs)
              ) / 1000
            )
        )
      )
    : null;
  const fixedError = errorCode ?? control?.lastErrorCode ?? null;
  const target = published
    ? Math.min(
        configuration.freshnessSeconds,
        published.metadata.freshnessTargetSeconds
      )
    : configuration.freshnessSeconds;
  const stale = age === null ? null : published!.metadata.stale || age > target;
  const disabled = !configuration.readEnabled && !configuration.syncEnabled;
  const health = !configuration.configured
    ? disabled && configuration.configurationCode === "CONFIG_DISABLED"
      ? "disabled"
      : "needs_attention"
    : fixedError &&
        (errorCode !== null || control?.stageStatus === "needs_attention")
      ? "needs_attention"
      : control?.stageStatus === "backoff"
        ? "backoff"
        : stage || control?.stageStatus === "running"
          ? "progress"
          : !published
            ? "no_data"
            : stale
              ? "stale"
              : "ready";
  return {
    ...configuration,
    health,
    hasPublished: !!published,
    stateVersion: snapshot?.sync?.version ?? null,
    generationId: published?.metadata.generationId ?? null,
    lastAttemptAt: iso(control?.lastAttemptAtMs),
    lastSuccessfulCheckAt: iso(control?.lastSuccessAtMs),
    lastPublishedAt: iso(control?.lastPublishAtMs),
    nextDueAt: iso(control?.nextDueAtMs),
    lastErrorCode: fixedError,
    recoveryGuidance:
      fixedError === "SOURCE_BINDING_CHANGED"
        ? "restore_original_source_binding_or_explicit_protected_reset"
        : health === "needs_attention"
          ? "investigate_before_explicit_protected_recovery"
          : null,
    stageStatus: control?.stageStatus ?? "idle",
    progress: stage
      ? {
          kind: stage.kind,
          phase: stage.phase,
          pages: stage.pages,
          recordsRead: stage.recordsRead,
        }
      : null,
    sourceObservationAt,
    sourcePublishedAt: published?.metadata.publishedAt ?? null,
    sourceAgeSeconds: age,
    freshnessTargetSeconds: target,
    isStale: stale,
  };
}
export interface HqLiveServiceOptions {
  config?: HqLiveConfig;
  /** Injection is server-side only, never an HTTP/RPC argument. */
  createStore?: (config: HqLiveConfig) => HqLiveStore | Promise<HqLiveStore>;
  createReader?: (config: HqLiveConfig) => HqWireReader;
  now?: () => number;
  maxSourceMethods?: number;
  methodStartDeadlineMs?: number;
  /** Server-only manual first-import fence; native trigger defaults remain unchanged. */
  onlyInitialPublication?: boolean;
  /** Fresh authority/settings guard for the manual first import, never RPC input. */
  initialImportGuard?: () => Promise<void>;
}
export interface HqLiveService {
  configurationStatus(): HqLiveConfigurationStatus;
  authorizeTrigger(token: unknown): boolean;
  /** No body, actor ID, URL, source scope or cursor input. Caller protects external trigger. */
  invoke(): Promise<HqLiveInvocationResult>;
  /** Server-only protected recovery; never starts an import or constructs a source reader. */
  recoverEmptyInitialImport?(): Promise<
    "recovered" | "notdue" | "busy" | "not_recoverable"
  >;
  /** Protected staged Resume only; no source requests, import or stage rewrite. */
  resumeStagedInitialImport?(): Promise<
    "resumed" | "notdue" | "busy" | "not_resumable"
  >;
  /** Parent must apply its fresh Super Admin access gate before these reads. */
  readPublished(): Promise<HqImplementedState | null>;
  /** Server-only acceptance snapshot; only configured sync-on/read-off is permitted. */
  readValidationSnapshot(): Promise<HqImplementedState | null>;
  getStatus(): Promise<HqLiveStatusDto>;
}
/** Native HTTP invocation core; no scheduling, activation, background loop or operational writes. */
export function createHqLiveService(
  options: HqLiveServiceOptions = {}
): HqLiveService {
  const config = options.config ?? createHqLiveConfig();
  const now = options.now ?? Date.now;
  const maxMethods = options.maxSourceMethods ?? HQ_LIVE_MAX_SOURCE_METHODS;
  const deadlineMs =
    options.methodStartDeadlineMs ?? HQ_LIVE_METHOD_START_DEADLINE_MS;
  const guard = options.onlyInitialPublication
    ? options.initialImportGuard
    : undefined;
  const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
    await guard?.();
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: await work() };
    } catch (error) {
      outcome = { ok: false, error };
    }
    await guard?.();
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  };
  if (
    !Number.isSafeInteger(maxMethods) ||
    maxMethods < 3 ||
    maxMethods > HQ_LIVE_MAX_SOURCE_METHODS ||
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs > HQ_LIVE_METHOD_START_DEADLINE_MS
  )
    throw new HqLiveError("CONFIG_INVALID");
  let storePromise: Promise<HqLiveStore> | null = null;
  async function defaultStore(): Promise<HqLiveStore> {
    // Lazy and server-only: do not import db.ts (which has unrelated operational/logging dependencies).
    // Read-only pool construction requires read-enabled; a client is constructed ONLY by invoke after acquire.
    return createHqLiveStore(await getSharedHqPool(), config);
  }
  async function getStore() {
    // Even a resolved default store must fail closed on runtime DB drift, without pool/DB work.
    // Server-injected fixture stores intentionally have no dependency on DATABASE_URL.
    if (!options.createStore) currentDatabaseBinding();
    if (!storePromise)
      storePromise = Promise.resolve().then(() =>
        options.createStore ? options.createStore(config) : defaultStore()
      );
    try {
      return await storePromise;
    } catch (error) {
      storePromise = null;
      throw new HqLiveError(safeHqLiveErrorCode((error as HqLiveError)?.code));
    }
  }
  const transient = new Set<HqLiveErrorCode>([
    "RATE_LIMITED",
    "TIMEOUT",
    "UNAVAILABLE",
    "TRANSPORT_FAILURE",
    "SOURCE_NOT_READY",
    "SOURCE_OR_STORE_UNAVAILABLE",
  ]);
  const service: HqLiveService = {
    configurationStatus: () => config.status(),
    authorizeTrigger: token => config.authorizeTrigger(token),
    async recoverEmptyInitialImport() {
      if (
        options.onlyInitialPublication !== true ||
        typeof options.initialImportGuard !== "function"
      )
        throw new HqLiveError("CONFIG_INVALID");
      const configuration = config.status();
      if (
        configuration.configured !== true ||
        configuration.configurationCode !== null ||
        configuration.syncEnabled !== true ||
        configuration.readEnabled !== false
      )
        throw new HqLiveError(
          configuration.configurationCode === "CONFIG_INCOMPLETE"
            ? "CONFIG_INCOMPLETE"
            : "CONFIG_INVALID"
        );
      const store = await guarded(getStore);
      const snapshot = await guarded(() => store.readSnapshot());
      const control = snapshot.control;
      if (
        !control ||
        snapshot.sync !== null ||
        control.stageStatus !== "needs_attention" ||
        control.lastErrorCode !== "INVALID_SEMANTICS" ||
        control.consecutiveFailures !== 1 ||
        control.lastSuccessAtMs !== null ||
        control.lastPublishAtMs !== null ||
        typeof store.recoverEmptyInitialImport !== "function"
      )
        return "not_recoverable";
      // The store rechecks the exact version/binding/empty state under its transaction.
      // Mandatory fresh authority is also awaited there immediately before its write.
      const status = await guarded(() =>
        store.recoverEmptyInitialImport!(
          control.version,
          options.initialImportGuard!
        )
      );
      return status === "recovered" || status === "notdue" || status === "busy"
        ? status
        : "not_recoverable";
    },
    async resumeStagedInitialImport() {
      if (
        options.onlyInitialPublication !== true ||
        typeof options.initialImportGuard !== "function"
      )
        throw new HqLiveError("CONFIG_INVALID");
      await guard!();
      const configuration = config.status();
      if (
        configuration.configured !== true ||
        configuration.configurationCode !== null ||
        configuration.syncEnabled !== true ||
        configuration.readEnabled !== false
      )
        throw new HqLiveError(
          configuration.configurationCode === "CONFIG_INCOMPLETE"
            ? "CONFIG_INCOMPLETE"
            : "CONFIG_INVALID"
        );
      const store = await guarded(getStore);
      const snapshot = await guarded(() => store.readSnapshot());
      const control = snapshot.control;
      const sync = snapshot.sync;
      const stage = sync?.stage;
      if (
        !control ||
        !sync ||
        sync.published !== null ||
        !stage ||
        stage.kind !== "backfill" ||
        stage.basePublishedVersion !== null ||
        !stage.metadata ||
        stage.pages < 1 ||
        stage.recordsRead < 1 ||
        control.stageStatus !== "needs_attention" ||
        control.lastErrorCode !== "STATE_BYTE_CAP_EXCEEDED" ||
        control.consecutiveFailures < 1 ||
        control.lastAttemptAtMs === null ||
        control.lastSuccessAtMs !== null ||
        control.lastPublishAtMs !== null ||
        control.initialStagedResume !== undefined ||
        typeof store.resumeStagedInitialImport !== "function"
      )
        return "not_resumable";
      // Recheck both observed versions under the store's control lock. Resume
      // updates control only, never this saved stage or its immutable chunks.
      const status = await guarded(() =>
        store.resumeStagedInitialImport!(
          control.version,
          sync.version,
          options.initialImportGuard!
        )
      );
      return status === "resumed" || status === "notdue" || status === "busy"
        ? status
        : "not_resumable";
    },
    async invoke() {
      const configuration = config.status();
      if (
        !configuration.syncEnabled &&
        configuration.configurationCode !== "CONFIG_INVALID"
      )
        return { status: "disabled" };
      if (!configuration.configured)
        return {
          status: "needs_attention",
          errorCode:
            configuration.configurationCode === "CONFIG_INCOMPLETE"
              ? "CONFIG_INCOMPLETE"
              : "CONFIG_INVALID",
        };
      if (!configuration.syncEnabled) return { status: "disabled" };
      if (options.onlyInitialPublication && configuration.readEnabled)
        return { status: "disabled" };
      let store: HqLiveStore;
      let lease: Awaited<ReturnType<HqLiveStore["acquire"]>>;
      try {
        store = await guarded(getStore);
        if (options.onlyInitialPublication) {
          const before = await guarded(() => store.readSnapshot());
          if (before.sync?.published) return { status: "already_complete" };
        }
        lease = await guarded(() => store.acquire());
      } catch (error) {
        return {
          status: "needs_attention",
          errorCode: safeHqLiveErrorCode((error as HqLiveError)?.code),
        };
      }
      if (lease.status !== "acquired") return { status: lease.status };
      const started = now();
      let methods = 0,
        retryAfter = 0;
      try {
        if (options.onlyInitialPublication) {
          // Renew proves the acquired fence before checking the published checkpoint.
          // No second generation may start if another worker published during acquire.
          await guarded(() => store.renew(lease.lease));
          const acquired = await guarded(() => store.readSnapshot());
          if (acquired.sync?.published) {
            // There is intentionally no unfenced release/reset or forced next-due write.
            // Existing crash-expiry releases this contended lease within 30 seconds.
            return { status: "already_complete" };
          }
        }
        const source = options.createReader
          ? options.createReader(config)
          : config.createReader();
        // Capture only the bounded delay hint; never provider errors/messages/records in the result.
        const call = async <T>(work: () => Promise<T>): Promise<T> => {
          try {
            return await guarded(() => {
              // The manual pre-GET authority await also consumes the existing
              // start budget. Native callback behavior is unchanged.
              if (
                options.onlyInitialPublication &&
                now() - started >= deadlineMs
              )
                throw new HqLiveError("TIMEOUT");
              return work();
            });
          } catch (error) {
            const hint = (error as { safeRetryAfter?: unknown })
              ?.safeRetryAfter;
            if (
              typeof hint === "number" &&
              Number.isSafeInteger(hint) &&
              hint >= 0 &&
              hint <= 3600
            )
              retryAfter = Math.max(retryAfter, hint);
            throw error;
          }
        };
        const reader: HqWireReader = {
          status: () => call(() => source.status()),
          capabilities: () => call(() => source.capabilities()),
          bookings: q => call(() => source.bookings(q)),
          businessMappings: q => call(() => source.businessMappings(q)),
          catalogue: (type, q) => call(() => source.catalogue(type, q)),
          changes: (cursor, limit) => call(() => source.changes(cursor, limit)),
        };
        const fenced = store.fencedSyncStore(lease.lease);
        const engine = createHqImplementedEngine(
          reader,
          guard
            ? {
                readSync: () => guarded(() => fenced.readSync()),
                compareAndSwapSync: (expected, next) =>
                  guarded(() => fenced.compareAndSwapSync(expected, next)),
              }
            : fenced,
          {
            ...HQ_LIVE_V2_VALIDATION_OPTIONS,
            shouldContinue: async () => {
              if (methods >= maxMethods || now() - started >= deadlineMs)
                return false;
              await guarded(() => store.renew(lease.lease));
              if (now() - started >= deadlineMs) return false;
              methods++;
              return true;
            },
          }
        );
        const result = await engine.sync();
        if (result.status === "applied") {
          await guarded(() =>
            store.complete(lease.lease, {
              status: "applied",
              delaySeconds: configuration.intervalSeconds,
            })
          );
          return { status: "applied" };
        }
        if (result.status === "yielded") {
          await guarded(() =>
            store.complete(lease.lease, {
              status: "progress",
              delaySeconds: HQ_LIVE_PROGRESS_DELAY_SECONDS,
            })
          );
          return { status: "progress" };
        }
        const code = safeHqLiveErrorCode(result.code);
        if (transient.has(code)) {
          const snapshot = await guarded(() => store.readSnapshot());
          const failures = snapshot.control?.consecutiveFailures ?? 0;
          const delay = Math.min(
            3600,
            Math.max(retryAfter, 60 * 2 ** Math.min(failures, 6))
          );
          await guarded(() =>
            store.complete(lease.lease, {
              status: "backoff",
              delaySeconds: delay,
              errorCode: code,
            })
          );
          return { status: "progress", errorCode: code };
        }
        await guarded(() =>
          store.complete(lease.lease, {
            status: "needs_attention",
            delaySeconds: 3600,
            errorCode: code,
          })
        );
        return { status: "needs_attention", errorCode: code };
      } catch (error) {
        const code = safeHqLiveErrorCode((error as HqLiveError)?.code);
        // A lost holder cannot release or clobber its successor. Other errors get guarded attention if possible.
        if (code !== "LEASE_LOST" && code !== "SOURCE_BINDING_CHANGED") {
          try {
            await guarded(() =>
              store.complete(lease.lease, {
                status: "needs_attention",
                delaySeconds: 3600,
                errorCode: code,
              })
            );
          } catch {
            /* crash expiry remains safe */
          }
        }
        return { status: "needs_attention", errorCode: code };
      }
    },
    async readPublished() {
      const configuration = config.status();
      if (!configuration.readEnabled) return null;
      if (!configuration.configured)
        throw new HqLiveError(
          configuration.configurationCode === "CONFIG_INCOMPLETE"
            ? "CONFIG_INCOMPLETE"
            : "CONFIG_INVALID"
        );
      return (await getStore()).readPublished();
    },
    async readValidationSnapshot() {
      const configuration = config.status();
      if (
        !configuration.configured ||
        !configuration.syncEnabled ||
        configuration.readEnabled
      )
        throw new HqLiveError(
          configuration.configurationCode === "CONFIG_INCOMPLETE"
            ? "CONFIG_INCOMPLETE"
            : "CONFIG_INVALID"
        );
      return (await getStore()).readPublished();
    },
    async getStatus() {
      const configuration = config.status();
      if (
        !configuration.configured ||
        (!configuration.syncEnabled && !configuration.readEnabled)
      )
        return buildHqLiveStatus(configuration, null, now());
      try {
        return buildHqLiveStatus(
          configuration,
          await (await getStore()).readSnapshot(),
          now()
        );
      } catch (error) {
        return buildHqLiveStatus(
          configuration,
          null,
          now(),
          safeHqLiveErrorCode((error as HqLiveError)?.code)
        );
      }
    },
  };
  return service;
}
