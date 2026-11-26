import type { HqWireReader } from "../shared/management-hq-wire";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import type { Pool } from "mysql2/promise";
import {
  createHqImplementedEngine,
  validateHqImplementedSyncState,
  validateHqImplementedSyncStateAsync,
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
import { hqJsonUtf8BytesAsync } from "./management-hq-storage-v2";
import { createHqCpuCheckpoint } from "./management-hq-cooperative";
import type { HqProgressSnapshot } from "./management-hq-progress";

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
  /** Unchecked progress is never accepted reporting health or report data. */
  payloadIntegrity?: "validated" | "unchecked";
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
  return projectHqLiveStatus(configuration, snapshot, nowMs, errorCode);
}
function projectHqLiveStatus(
  configuration: HqLiveConfigurationStatus,
  snapshot: HqLiveSnapshot | null,
  nowMs: number,
  errorCode: HqLiveErrorCode | null
): HqLiveStatusDto {
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
    ...(snapshot ? { payloadIntegrity: "validated" as const } : {}),
  };
}
function buildHqProgressStatus(
  configuration: HqLiveConfigurationStatus,
  observation: HqProgressSnapshot,
  nowMs: number
): HqLiveStatusDto {
  const base = buildHqLiveStatus(configuration, null, nowMs);
  const control = observation.control;
  const stageStatus =
    control?.stageStatus === "running" &&
    (control.leaseExpiresAtMs === null ||
      control.leaseExpiresAtMs <= observation.databaseNowMs ||
      control.leaseHardExpiresAtMs === null ||
      control.leaseHardExpiresAtMs <= observation.databaseNowMs)
      ? observation.progress
        ? "progress"
        : "idle"
      : (control?.stageStatus ?? "idle");
  const attention = stageStatus === "needs_attention";
  return {
    ...base,
    payloadIntegrity: "unchecked",
    health: attention
      ? "needs_attention"
      : stageStatus === "backoff"
        ? "backoff"
        : observation.progress ||
            observation.hasPublished ||
            stageStatus === "running"
          ? "progress"
          : "no_data",
    hasPublished: observation.hasPublished,
    stateVersion: observation.stateVersion,
    lastAttemptAt: iso(control?.lastAttemptAtMs),
    lastSuccessfulCheckAt: iso(control?.lastSuccessAtMs),
    lastPublishedAt: iso(control?.lastPublishAtMs),
    nextDueAt: iso(control?.nextDueAtMs),
    lastErrorCode: control?.lastErrorCode ?? null,
    recoveryGuidance:
      control?.lastErrorCode === "SOURCE_BINDING_CHANGED"
        ? "restore_original_source_binding_or_explicit_protected_reset"
        : attention
          ? "investigate_before_explicit_protected_recovery"
          : null,
    stageStatus,
    progress: observation.progress,
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
  /** Protected initial-run profile only; no native/manual-default changes. */
  acceleratedInitialImport?: boolean;
  /** Synchronous raw settings guard; CPU-only yields cannot perform side effects. */
  initialImportCpuBindingGuard?: () => void;
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
  /** Explicit totals checks require strong publication metadata, not progress headers. */
  getValidationStatus?(): Promise<HqLiveStatusDto>;
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
  const accelerated = options.acceleratedInitialImport === true;
  if (
    accelerated &&
    (options.onlyInitialPublication !== true ||
      typeof guard !== "function" ||
      typeof options.initialImportCpuBindingGuard !== "function")
  )
    throw new HqLiveError("CONFIG_INVALID");
  // Action-local rather than a global/cache latch: a concurrent invocation
  // cannot clear the first denial observed by a suspended action.
  const cpuActions = new AsyncLocalStorage<{
    denial: { error: unknown } | null;
  }>();
  const cpuGuard = async () => {
    const action = cpuActions.getStore();
    let denial = action?.denial ?? null;
    const retain = (error: unknown) => {
      denial ??= { error };
      if (action) action.denial ??= denial;
    };
    try {
      if (!options.createStore) currentDatabaseBinding();
    } catch (error) {
      retain(error);
    }
    // Still refresh authority when a simultaneous database failure is observed.
    try {
      await guard?.();
    } catch (error) {
      retain(error);
    }
    try {
      if (!options.createStore) currentDatabaseBinding();
    } catch (error) {
      retain(error);
    }
    if (denial) throw denial.error;
  };
  let lastCpuAuthorityAt = -Infinity;
  const cpuYieldGuard = async () => {
    if (!accelerated) return cpuGuard();
    const action = cpuActions.getStore();
    if (action?.denial) throw action.denial.error;
    try {
      if (!options.createStore) currentDatabaseBinding();
      options.initialImportCpuBindingGuard!();
      // CPU-only work has no source/storage side effects. Source methods,
      // CAS and transaction commit retain the independent fresh cpuGuard.
      if (performance.now() - lastCpuAuthorityAt >= 1000) {
        await cpuGuard();
        lastCpuAuthorityAt = performance.now();
      }
      options.initialImportCpuBindingGuard!();
      if (!options.createStore) currentDatabaseBinding();
    } catch (error) {
      if (action) action.denial ??= { error };
      throw action?.denial?.error ?? error;
    }
  };
  const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
    await cpuGuard();
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: await work() };
    } catch (error) {
      outcome = { ok: false, error };
    }
    await cpuGuard();
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
    return createHqLiveStore(await getSharedHqPool(), config, {
      cooperativeGuard: cpuGuard,
      ...(accelerated ? { cooperativeYieldGuard: cpuYieldGuard } : {}),
      ...(accelerated
        ? {
            // Only an opaque identity crosses request boundaries, never this
            // action's authority/settings closures or a lease-bearing service.
            validatedInitialReuseScope: createHash("sha256")
              .update(
                JSON.stringify(
                  [
                    "DATABASE_URL",
                    "HQ_ORBIT_REPORTING_BASE_URL",
                    "HQ_ORBIT_REPORTING_API_KEY",
                    "HQ_PORTAL_SYNC_TOKEN",
                    "HQ_LIVE_SYNC_ENABLED",
                    "HQ_LIVE_READ_ENABLED",
                    "HQ_LIVE_INTERVAL_SECONDS",
                    "HQ_LIVE_FRESHNESS_SECONDS",
                  ].map(key => process.env[key])
                )
              )
              .digest("hex"),
          }
        : {}),
    });
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
  const strongStatus = async (configuration: HqLiveConfigurationStatus) => {
    const snapshot = await (await getStore()).readSnapshot();
    await cpuGuard();
    const cpu = createHqCpuCheckpoint(cpuGuard);
    await validateHqImplementedSyncStateAsync(
      snapshot.sync,
      {
        ...HQ_LIVE_V2_VALIDATION_OPTIONS,
        measureStateBytesAsync: (value, maximum) =>
          hqJsonUtf8BytesAsync(value, maximum, cpu),
      },
      cpu
    );
    await cpuGuard();
    return projectHqLiveStatus(configuration, snapshot, now(), null);
  };
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
      let initialAcquisitionChecked = false;
      try {
        store = await guarded(getStore);
        initialAcquisitionChecked =
          !!options.onlyInitialPublication &&
          typeof store.acquireInitialPublication === "function";
        if (options.onlyInitialPublication && !initialAcquisitionChecked) {
          const before = await guarded(() => store.readSnapshot());
          if (before.sync?.published) return { status: "already_complete" };
        }
        lease = await guarded(() =>
          initialAcquisitionChecked
            ? store.acquireInitialPublication!()
            : store.acquire()
        );
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
      let dataStartedAt: number | null = null,
        largestDataWorkMs = 0;
      try {
        if (options.onlyInitialPublication && !initialAcquisitionChecked) {
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
        let renewedAt = performance.now();
        const cpu = createHqCpuCheckpoint(async () => {
          await cpuYieldGuard();
          if (performance.now() - renewedAt >= 8000) {
            await guarded(() =>
              store.renewCooperative
                ? store.renewCooperative(lease.lease)
                : store.renew(lease.lease)
            );
            renewedAt = performance.now();
          }
        });
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
            cooperativeCheckpoint: cpu,
            measureStateBytesAsync: (value, maximum) =>
              hqJsonUtf8BytesAsync(value, maximum, cpu),
            shouldContinue: async () => {
              if (accelerated && dataStartedAt !== null) {
                largestDataWorkMs = Math.max(
                  largestDataWorkMs,
                  now() - dataStartedAt
                );
                // Preserve the original method-start/hard-lease ceilings rather
                // than starting another costly page close to their boundary.
                if (
                  now() -
                    started +
                    Math.ceil(largestDataWorkMs * 1.25) +
                    10000 >=
                  deadlineMs
                )
                  return false;
              }
              if (methods >= maxMethods || now() - started >= deadlineMs)
                return false;
              await guarded(() => store.renew(lease.lease));
              if (now() - started >= deadlineMs) return false;
              methods++;
              if (accelerated && methods >= 3) dataStartedAt = now();
              return true;
            },
          }
        );
        const result = await engine.sync();
        await cpuGuard(); // sanitized engine outcomes cannot clear a prior denial
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
              delaySeconds: accelerated ? 0 : HQ_LIVE_PROGRESS_DELAY_SECONDS,
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
    async getValidationStatus() {
      const configuration = config.status();
      if (
        !configuration.configured ||
        !configuration.syncEnabled ||
        configuration.readEnabled
      )
        throw new HqLiveError("CONFIG_INVALID");
      return strongStatus(configuration);
    },
    async getStatus() {
      const configuration = config.status();
      if (
        !configuration.configured ||
        (!configuration.syncEnabled && !configuration.readEnabled)
      )
        return buildHqLiveStatus(configuration, null, now());
      try {
        const store = await getStore();
        if (
          configuration.syncEnabled &&
          !configuration.readEnabled &&
          store.readProgressSnapshot
        ) {
          const observation = await store.readProgressSnapshot();
          if (!options.createStore) currentDatabaseBinding();
          return buildHqProgressStatus(configuration, observation, now());
        }
        return await strongStatus(configuration);
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
  const inAction = <T>(work: () => Promise<T>) =>
    cpuActions.run({ denial: null }, work);
  const invoke = service.invoke.bind(service);
  const status = service.getStatus.bind(service);
  const published = service.readPublished.bind(service);
  const validation = service.readValidationSnapshot.bind(service);
  const validationStatus = service.getValidationStatus!.bind(service);
  service.invoke = () => inAction(invoke);
  service.getStatus = () => inAction(status);
  service.readPublished = () => inAction(published);
  service.readValidationSnapshot = () => inAction(validation);
  service.getValidationStatus = () => inAction(validationStatus);
  return service;
}
