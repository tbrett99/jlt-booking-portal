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
  if (snapshot) validateHqImplementedSyncState(snapshot.sync);
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
}
export interface HqLiveService {
  configurationStatus(): HqLiveConfigurationStatus;
  authorizeTrigger(token: unknown): boolean;
  /** No body, actor ID, URL, source scope or cursor input. Caller protects external trigger. */
  invoke(): Promise<HqLiveInvocationResult>;
  /** Parent must apply its fresh Super Admin access gate before these reads. */
  readPublished(): Promise<HqImplementedState | null>;
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
      let store: HqLiveStore;
      let lease: Awaited<ReturnType<HqLiveStore["acquire"]>>;
      try {
        store = await getStore();
        lease = await store.acquire();
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
        const source = options.createReader
          ? options.createReader(config)
          : config.createReader();
        // Capture only the bounded delay hint; never provider errors/messages/records in the result.
        const call = async <T>(work: () => Promise<T>): Promise<T> => {
          try {
            return await work();
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
        const engine = createHqImplementedEngine(
          reader,
          store.fencedSyncStore(lease.lease),
          {
            shouldContinue: async () => {
              if (methods >= maxMethods || now() - started >= deadlineMs)
                return false;
              await store.renew(lease.lease);
              if (now() - started >= deadlineMs) return false;
              methods++;
              return true;
            },
          }
        );
        const result = await engine.sync();
        if (result.status === "applied") {
          await store.complete(lease.lease, {
            status: "applied",
            delaySeconds: configuration.intervalSeconds,
          });
          return { status: "applied" };
        }
        if (result.status === "yielded") {
          await store.complete(lease.lease, {
            status: "progress",
            delaySeconds: HQ_LIVE_PROGRESS_DELAY_SECONDS,
          });
          return { status: "progress" };
        }
        const code = safeHqLiveErrorCode(result.code);
        if (transient.has(code)) {
          const snapshot = await store.readSnapshot();
          const failures = snapshot.control?.consecutiveFailures ?? 0;
          const delay = Math.min(
            3600,
            Math.max(retryAfter, 60 * 2 ** Math.min(failures, 6))
          );
          await store.complete(lease.lease, {
            status: "backoff",
            delaySeconds: delay,
            errorCode: code,
          });
          return { status: "progress", errorCode: code };
        }
        await store.complete(lease.lease, {
          status: "needs_attention",
          delaySeconds: 3600,
          errorCode: code,
        });
        return { status: "needs_attention", errorCode: code };
      } catch (error) {
        const code = safeHqLiveErrorCode((error as HqLiveError)?.code);
        // A lost holder cannot release or clobber its successor. Other errors get guarded attention if possible.
        if (code !== "LEASE_LOST" && code !== "SOURCE_BINDING_CHANGED") {
          try {
            await store.complete(lease.lease, {
              status: "needs_attention",
              delaySeconds: 3600,
              errorCode: code,
            });
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
