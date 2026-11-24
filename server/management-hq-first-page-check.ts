import type { HqContractErrorCode } from "./management-hq-contract";
import { captureHqInitialImportBinding } from "./management-hq-initial-import";
import { createHqLiveConfig, HQ_LIVE_SCOPE } from "./management-hq-live-config";
import { HqOrbitClient } from "./management-hq-orbit-client";
import {
  HqContractError,
  getHqWireFailureRule,
  validateHqWireBookingPage,
  validateHqWireCapabilities,
  validateHqWireStatus,
} from "./management-hq-wire-contract";
import type { HqWireFailureRule } from "./management-hq-wire-contract";

export interface HqFirstPageCheckResult {
  outcome: "page_valid" | "needs_attention" | "invalid_settings";
  checkedAt: string;
  message: string;
  stage: "settings" | "status" | "capabilities" | "bookings";
  errorCode: HqContractErrorCode | null;
  failedRule: HqWireFailureRule | null;
  generationId: number | null;
  sourcePublishedAt: string | null;
  sourceObservationAt: string | null;
}

const MESSAGES: Record<HqFirstPageCheckResult["outcome"], string> = {
  page_valid:
    "Only the current first bookings page passed strict source validation. This diagnostic does not establish the cause of an earlier import failure or accept the whole import or reporting reads. No import, retry, reset, dashboard activation or automatic update was performed.",
  needs_attention:
    "The current first-page diagnostic needs attention. No import, retry, reset, dashboard activation or automatic update was performed.",
  invalid_settings:
    "The first-page diagnostic requires valid configured sync-on/read-off settings. No import, retry, reset, dashboard activation or automatic update was performed.",
};

/** Trust only actual contract errors and this fixed local vocabulary, never arbitrary error properties. */
function safeErrorCode(error: unknown): HqContractErrorCode {
  if (!(error instanceof HqContractError)) return "TRANSPORT_FAILURE";
  switch (error.code) {
    case "INVALID_PAYLOAD":
    case "PAYLOAD_TOO_LARGE":
    case "CONTRACT_VERSION_MISMATCH":
    case "INVALID_SEMANTICS":
    case "SCOPE_MISMATCH":
    case "CLIENT_DISABLED":
    case "INVALID_CONFIGURATION":
    case "INVALID_QUERY":
    case "AUTH_DENIED":
    case "RESTART_REQUIRED":
    case "RATE_LIMITED":
    case "UNAVAILABLE":
    case "REDIRECT_REJECTED":
    case "TIMEOUT":
    case "TRANSPORT_FAILURE":
      return error.code;
    default:
      return "TRANSPORT_FAILURE";
  }
}

/** Server-only seams; the protected route supplies fresh authority, not caller-selected settings. */
export async function checkHqFirstPage(
  options: {
    env?: NodeJS.ProcessEnv;
    guard?: () => Promise<void>;
    createReader?: (
      baseUrl: string,
      apiKey: string
    ) => Pick<HqOrbitClient, "status" | "capabilities" | "bookings">;
  } = {}
): Promise<HqFirstPageCheckResult> {
  const env = options.env ?? process.env;
  // Validate actual live settings before constructing any enabled reader; no URL fallback.
  const configuration = createHqLiveConfig(env).status();
  const assertBinding = captureHqInitialImportBinding(env);
  const baseUrl = env.HQ_ORBIT_REPORTING_BASE_URL;
  const apiKey = env.HQ_ORBIT_REPORTING_API_KEY;
  let guardFailure: { error: unknown } | null = null;
  const gate = async () => {
    // Latch binding drift before the authority await, but still perform that fresh
    // authority check. Restoration cannot clear this request's first-failure latch.
    try {
      assertBinding();
    } catch (error) {
      guardFailure ??= { error };
    }
    try {
      await options.guard?.();
    } catch (error) {
      guardFailure ??= { error };
    }
    try {
      assertBinding();
    } catch (error) {
      guardFailure ??= { error };
    }
    if (guardFailure) throw guardFailure.error;
  };
  const guarded = async <T>(read: () => Promise<T>): Promise<T> => {
    await gate();
    let source: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      source = { ok: true, value: await read() };
    } catch (error) {
      source = { ok: false, error };
    }
    await gate();
    if (!source.ok) throw source.error;
    return source.value;
  };
  let stage: HqFirstPageCheckResult["stage"] = "settings";
  const result = (
    outcome: HqFirstPageCheckResult["outcome"],
    errorCode: HqContractErrorCode | null = null,
    failedRule: HqWireFailureRule | null = null
  ): HqFirstPageCheckResult => ({
    outcome,
    checkedAt: new Date().toISOString(),
    message: MESSAGES[outcome],
    stage,
    errorCode,
    failedRule,
    generationId: null,
    sourcePublishedAt: null,
    sourceObservationAt: null,
  });

  let dto: HqFirstPageCheckResult;
  try {
    await gate();
    if (
      !configuration.configured ||
      !configuration.syncEnabled ||
      configuration.readEnabled
    ) {
      dto = result("invalid_settings", "INVALID_CONFIGURATION");
    } else {
      const reader = options.createReader
        ? options.createReader(baseUrl!, apiKey!)
        : new HqOrbitClient({
            baseUrl: baseUrl!,
            apiKey: apiKey!,
            scopeId: HQ_LIVE_SCOPE,
            enabled: true,
          });
      stage = "status";
      validateHqWireStatus(await guarded(() => reader.status()));
      stage = "capabilities";
      validateHqWireCapabilities(await guarded(() => reader.capabilities()));
      stage = "bookings";
      // Match the actual initial import's first-page query: no cursor or generation pin.
      const page = validateHqWireBookingPage(
        await guarded(() => reader.bookings({ limit: 100 }))
      );
      // Project metadata only from the validated bookings page, never status or partial/failing input.
      dto = {
        ...result("page_valid"),
        generationId: page.generationId,
        sourcePublishedAt: page.publishedAt,
        sourceObservationAt: page.sourceObservationWindow.to,
      };
    }
  } catch (error) {
    dto = result(
      "needs_attention",
      safeErrorCode(error),
      error instanceof HqContractError ? getHqWireFailureRule(error) : null
    );
  }
  // Last await, after construction, validation and DTO projection. Never map guard denial into data.
  await gate();
  return dto;
}
