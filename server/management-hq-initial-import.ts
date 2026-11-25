import type { HqInitialImportResult } from "../shared/management-hq-initial-import";
import {
  createHqLiveConfig,
  type HqLiveConfig,
} from "./management-hq-live-config";
import {
  createHqLiveService,
  type HqLiveServiceOptions,
  type HqLiveService,
  type HqLiveStatusDto,
  HQ_LIVE_MAX_SOURCE_METHODS,
} from "./management-hq-live-service";
import { HqLiveError, safeHqLiveErrorCode } from "./management-hq-live-store";

/** Status + capabilities + at most one data page per protected manual action.
 * Native trigger defaults, source page caps and existing lease limits are unchanged. */
export const HQ_INITIAL_IMPORT_MAX_SOURCE_METHODS = 3;

const SETTINGS = [
  "HQ_ORBIT_REPORTING_BASE_URL",
  "HQ_ORBIT_REPORTING_API_KEY",
  "HQ_PORTAL_SYNC_TOKEN",
  "HQ_LIVE_SYNC_ENABLED",
  "HQ_LIVE_READ_ENABLED",
  "HQ_LIVE_INTERVAL_SECONDS",
  "HQ_LIVE_FRESHNESS_SECONDS",
] as const;
/** Captures raw settings, including token rotation; never exports their values. */
export function captureHqInitialImportBinding(
  env: NodeJS.ProcessEnv = process.env
): () => void {
  const read = () => JSON.stringify(SETTINGS.map(key => env[key]));
  const original = read();
  return () => {
    if (read() !== original) throw new HqLiveError("CONFIG_INVALID");
  };
}
const MESSAGES: Record<HqInitialImportResult["status"], string> = {
  disabled:
    "First import is disabled. Valid sync-on/read-off settings are required; dashboards and automatic updates remain off.",
  notdue:
    "The first import is not due yet. No additional source batch was started.",
  busy: "A reporting import is already running. No additional source batch was started.",
  progress:
    "The first import is incomplete. Partial staging is not a published report; dashboards and automatic updates remain off.",
  applied:
    "The first reporting publication is imported and ready for validation. Dashboards and automatic updates remain off.",
  already_complete:
    "A complete reporting publication already exists. No refresh was started; dashboards and automatic updates remain off.",
  needs_attention:
    "The first import needs investigation before protected recovery. No reset or immediate retry was performed.",
};
function result(
  status: HqInitialImportResult["status"],
  live: HqLiveStatusDto | null = null,
  errorCode: unknown = null
): HqInitialImportResult {
  return {
    status,
    message: MESSAGES[status],
    nextDueAt: live?.nextDueAt ?? null,
    hasPublished: live?.hasPublished ?? false,
    progress: live?.progress
      ? { pages: live.progress.pages, recordsRead: live.progress.recordsRead }
      : null,
    errorCode: errorCode == null ? null : safeHqLiveErrorCode(errorCode),
  };
}
type ImportOptions = {
  /** Server-side seams only; the RPC accepts z.void(). */
  config?: HqLiveConfig;
  env?: NodeJS.ProcessEnv;
  guard: () => Promise<void>;
  createService?: (options: HqLiveServiceOptions) => HqLiveService;
  /** Private explicit initial-run profile; no RPC input selects limits. */
  accelerated?: true;
};
/** One click advances at most one existing fenced bounded batch. Never creates recurring work. */
export async function importHqInitialBatch(
  options: ImportOptions
): Promise<HqInitialImportResult> {
  const config = options.config ?? createHqLiveConfig(options.env);
  const assertBinding = captureHqInitialImportBinding(options.env);
  let guardFailure: { error: unknown } | null = null;
  const guard = async () => {
    // Authority is checked even after a failed read or simultaneous settings drift.
    try {
      await options.guard();
      assertBinding();
    } catch (error) {
      guardFailure ??= { error };
    }
    // A service may classify a thrown guard as attention; this request remains
    // denied even if subsequent fresh reads become authoritative again.
    if (guardFailure) throw guardFailure.error;
  };
  const guarded = async <T>(read: () => Promise<T>): Promise<T> => {
    await guard();
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: await read() };
    } catch (error) {
      outcome = { ok: false, error };
    }
    await guard();
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  };
  await guard();
  const configuration = config.status();
  if (
    !configuration.configured ||
    !configuration.syncEnabled ||
    configuration.readEnabled
  ) {
    await guard();
    return result(
      configuration.configurationCode === "CONFIG_INVALID" ||
        configuration.configurationCode === "CONFIG_INCOMPLETE"
        ? "needs_attention"
        : "disabled",
      null,
      configuration.configurationCode === "CONFIG_INVALID" ||
        configuration.configurationCode === "CONFIG_INCOMPLETE"
        ? configuration.configurationCode
        : null
    );
  }
  const service = (options.createService ?? createHqLiveService)({
    config,
    onlyInitialPublication: true,
    initialImportGuard: guard,
    maxSourceMethods: options.accelerated
      ? HQ_LIVE_MAX_SOURCE_METHODS
      : HQ_INITIAL_IMPORT_MAX_SOURCE_METHODS,
    ...(options.accelerated
      ? {
          acceleratedInitialImport: true,
          initialImportCpuBindingGuard: () => {
            if (guardFailure) throw guardFailure.error;
            assertBinding();
          },
        }
      : {}),
  });
  const before = await guarded(() => service.getStatus());
  // An observational header is not a validated publication. The service's
  // atomic initial-only acquire must strongly validate it before refusing work.
  if (before.hasPublished && before.payloadIntegrity !== "unchecked")
    return result("already_complete", before);
  if (
    before.health === "needs_attention" ||
    before.stageStatus === "needs_attention"
  )
    return result("needs_attention", before, before.lastErrorCode);
  const invocation = await guarded(() => service.invoke());
  const after = await guarded(() => service.getStatus());
  if (
    after.health === "needs_attention" ||
    after.stageStatus === "needs_attention"
  )
    return result(
      "needs_attention",
      after,
      invocation.errorCode ?? after.lastErrorCode
    );
  if (invocation.status === "applied" && !after.hasPublished)
    return result("needs_attention", after, "STORE_UNAVAILABLE");
  return result(
    invocation.status,
    after,
    invocation.errorCode ?? after.lastErrorCode
  );
}

/** One explicitly-started run batch; same lease/caps and initial-only publication fence. */
export const finishHqInitialBatch = (
  options: Omit<ImportOptions, "accelerated">
) => importHqInitialBatch({ ...options, accelerated: true });
