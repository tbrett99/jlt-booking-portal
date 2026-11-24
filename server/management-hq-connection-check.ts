import { HqContractError, HqOrbitClient } from "./management-hq-orbit-client";
import { HQ_LIVE_SCOPE } from "./management-hq-live-config";
import type { HqWireStatus } from "../shared/management-hq-wire";
import type {
  HqConnectionCheckResult,
  HqConnectionCheckOutcome,
} from "../shared/management-hq-connection-check";

export type HqConnectionCheckEnv = Partial<
  Pick<
    NodeJS.ProcessEnv,
    | "HQ_ORBIT_REPORTING_API_KEY"
    | "HQ_ORBIT_REPORTING_BASE_URL"
    | "HQ_LIVE_SYNC_ENABLED"
    | "HQ_LIVE_READ_ENABLED"
    | "HQ_LIVE_INTERVAL_SECONDS"
    | "HQ_LIVE_FRESHNESS_SECONDS"
  >
>;

type CheckOptions = {
  /** Internal test seam; never supplied from RPC input. */
  env?: HqConnectionCheckEnv;
  /** Internal test seam; never supplied from RPC input. */
  createReader?: (
    baseUrl: string,
    apiKey: string
  ) => Pick<HqOrbitClient, "status" | "capabilities">;
  /** Fresh authorization gate, called before and after every source await. */
  beforeRequest?: () => Promise<void>;
};

export const HQ_DEFAULT_REPORTING_BASE_URL =
  "https://orbit.thejltgroup.co.uk/api/reporting/v1";
const INVALID_SETTINGS_MESSAGE =
  "Orbit connection settings are invalid. No bookings have been imported.";
const MISSING_KEY_MESSAGE =
  "Orbit reporting key is not configured (HQ_ORBIT_REPORTING_API_KEY).";
const READY_MESSAGE =
  "Portal can connect to Orbit. No bookings have been imported or HQ switched on.";
const STALE_MESSAGE =
  "Orbit is connected, but its latest reporting data is out of date.";
const NOT_READY_MESSAGE =
  "Orbit’s reporting data is not ready yet. No bookings have been imported.";
const KEY_REJECTED_MESSAGE = "Orbit reporting key was rejected.";
const UNAVAILABLE_MESSAGE =
  "Portal could not complete the Orbit connection check. No bookings have been imported.";

function result(
  outcome: HqConnectionCheckOutcome,
  message: string,
  status?: Pick<
    HqWireStatus,
    "generationId" | "publishedAt" | "sourceObservationWindow"
  >
): HqConnectionCheckResult {
  const timestamp = new Date().toISOString();
  const healthy = outcome === "ready" || outcome === "stale";
  return {
    outcome,
    message,
    checkedAt: timestamp,
    generationId: healthy ? (status?.generationId ?? null) : null,
    sourcePublishedAt: healthy ? (status?.publishedAt ?? null) : null,
    sourceObservationAt: healthy
      ? (status?.sourceObservationWindow.to ?? null)
      : null,
  };
}
function validFlag(value: string | undefined): boolean {
  return value === undefined || value === "true" || value === "false";
}
function validInteger(
  value: string | undefined,
  min: number,
  max: number
): boolean {
  return (
    value === undefined ||
    (/^[1-9][0-9]*$/.test(value) &&
      Number.isSafeInteger(Number(value)) &&
      Number(value) >= min &&
      Number(value) <= max)
  );
}
function validateSettings(env: HqConnectionCheckEnv): string | null {
  if (
    !validFlag(env.HQ_LIVE_SYNC_ENABLED) ||
    !validFlag(env.HQ_LIVE_READ_ENABLED) ||
    !validInteger(env.HQ_LIVE_INTERVAL_SECONDS, 60, 3600) ||
    !validInteger(env.HQ_LIVE_FRESHNESS_SECONDS, 60, 86400)
  )
    return null;
  const key = env.HQ_ORBIT_REPORTING_API_KEY;
  if (key === undefined || key === "") return "missing";
  if (key.length < 32 || key.length > 256 || /[^\x21-\x7e]/.test(key))
    return null;
  const base = env.HQ_ORBIT_REPORTING_BASE_URL ?? HQ_DEFAULT_REPORTING_BASE_URL;
  try {
    new HqOrbitClient({
      baseUrl: base,
      apiKey: key,
      scopeId: HQ_LIVE_SCOPE,
      enabled: false,
    });
  } catch {
    return null;
  }
  return base;
}
function binding(env: HqConnectionCheckEnv): string {
  return JSON.stringify([
    env.HQ_ORBIT_REPORTING_BASE_URL ?? HQ_DEFAULT_REPORTING_BASE_URL,
    env.HQ_ORBIT_REPORTING_API_KEY,
    env.HQ_LIVE_SYNC_ENABLED,
    env.HQ_LIVE_READ_ENABLED,
    env.HQ_LIVE_INTERVAL_SECONDS,
    env.HQ_LIVE_FRESHNESS_SECONDS,
  ]);
}
/** Server-only closure; no source URL, credential or fingerprint is returned to callers. */
export function captureHqConnectionBinding(
  env: HqConnectionCheckEnv = process.env as HqConnectionCheckEnv
): () => void {
  const captured = binding(env);
  return () => {
    if (binding(env) !== captured)
      throw new HqContractError("INVALID_CONFIGURATION");
  };
}
function errorOutcome(error: unknown): HqConnectionCheckOutcome {
  const code = (error as { code?: unknown })?.code;
  if (code === "AUTH_DENIED") return "key_rejected";
  if (code === "INVALID_CONFIGURATION") return "invalid_settings";
  if (
    code === "INVALID_PAYLOAD" ||
    code === "INVALID_SEMANTICS" ||
    code === "SOURCE_NOT_READY"
  )
    return "not_ready";
  return "unavailable";
}
function errorMessage(outcome: HqConnectionCheckOutcome): string {
  if (outcome === "not_ready") return NOT_READY_MESSAGE;
  if (outcome === "key_rejected") return KEY_REJECTED_MESSAGE;
  if (outcome === "invalid_settings") return INVALID_SETTINGS_MESSAGE;
  return UNAVAILABLE_MESSAGE;
}

export async function checkHqConnection(
  options: CheckOptions = {}
): Promise<HqConnectionCheckResult> {
  const env = (options.env ?? process.env) as HqConnectionCheckEnv;
  const settings = validateSettings(env);
  if (settings === "missing") return result("missing_key", MISSING_KEY_MESSAGE);
  if (settings === null)
    return result("invalid_settings", INVALID_SETTINGS_MESSAGE);

  const assertBinding = captureHqConnectionBinding(env);
  const gate = async () => {
    // Always check fresh authority, even if the source binding drifted while
    // a failed read was pending. No source request starts before this gate.
    await options.beforeRequest?.();
    assertBinding();
  };
  const reader = options.createReader
    ? options.createReader(settings, env.HQ_ORBIT_REPORTING_API_KEY!)
    : new HqOrbitClient({
        baseUrl: settings,
        apiKey: env.HQ_ORBIT_REPORTING_API_KEY!,
        scopeId: HQ_LIVE_SCOPE,
        enabled: true,
      });

  // Source failures are data, not authority failures. Always revalidate after
  // a source await, including rejected reads, before classifying its outcome.
  const readWithGate = async <T>(read: () => Promise<T>) => {
    await gate();
    let response: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      response = { ok: true, value: await read() };
    } catch (error) {
      response = { ok: false, error };
    }
    await gate();
    return response;
  };
  try {
    const statusRead = await readWithGate(() => reader.status());
    if (!statusRead.ok) {
      const outcome = errorOutcome(statusRead.error);
      return result(outcome, errorMessage(outcome));
    }
    const capabilitiesRead = await readWithGate(() => reader.capabilities());
    if (!capabilitiesRead.ok) {
      const outcome = errorOutcome(capabilitiesRead.error);
      return result(outcome, errorMessage(outcome));
    }
    const status = statusRead.value;
    const freshness = Math.min(
      Number(env.HQ_LIVE_FRESHNESS_SECONDS ?? 900),
      status.freshnessTargetSeconds
    );
    const now = Date.now();
    const observationAge =
      (now - Date.parse(status.sourceObservationWindow.to)) / 1000;
    return status.stale ||
      status.sourceAgeSeconds > freshness ||
      observationAge > freshness ||
      Date.parse(status.expiresAt) <= now
      ? result("stale", STALE_MESSAGE, status)
      : result("ready", READY_MESSAGE, status);
  } catch (error) {
    if (
      error instanceof HqContractError &&
      error.code === "INVALID_CONFIGURATION"
    )
      return result("invalid_settings", INVALID_SETTINGS_MESSAGE);
    throw error;
  }
}
