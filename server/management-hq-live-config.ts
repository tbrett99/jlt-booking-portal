import { createHash, timingSafeEqual } from "node:crypto";
import { HqOrbitClient } from "./management-hq-orbit-client";
import type { HqWireReader } from "../shared/management-hq-wire";

export const HQ_LIVE_SCOPE = "company_all_real_and_unattributed" as const;
export type HqLiveConfigurationCode =
  | "CONFIG_DISABLED"
  | "CONFIG_INVALID"
  | "CONFIG_INCOMPLETE"
  | null;
export interface HqLiveConfigurationStatus {
  syncEnabled: boolean;
  readEnabled: boolean;
  configured: boolean;
  configurationCode: HqLiveConfigurationCode;
  intervalSeconds: number;
  freshnessSeconds: number;
}
/** Opaque, server-only capability: no URL, key or trigger token is exposed as data. */
export interface HqLiveConfig {
  status(): HqLiveConfigurationStatus;
  sourceFingerprint(): string | null;
  authorizeTrigger(token: unknown): boolean;
  createReader(): HqWireReader;
}
export function createHqLiveConfig(
  env: NodeJS.ProcessEnv = process.env
): HqLiveConfig {
  const flag = (v: string | undefined) =>
    v === undefined || v === "false" ? false : v === "true" ? true : null;
  const sync = flag(env.HQ_LIVE_SYNC_ENABLED),
    read = flag(env.HQ_LIVE_READ_ENABLED);
  const integer = (
    v: string | undefined,
    fallback: number,
    min: number,
    max: number
  ) =>
    v === undefined
      ? fallback
      : /^[1-9][0-9]*$/.test(v) &&
          Number.isSafeInteger(Number(v)) &&
          Number(v) >= min &&
          Number(v) <= max
        ? Number(v)
        : null;
  const interval = integer(env.HQ_LIVE_INTERVAL_SECONDS, 300, 60, 3600);
  const freshness = integer(env.HQ_LIVE_FRESHNESS_SECONDS, 900, 60, 86400);
  const baseUrl = env.HQ_ORBIT_REPORTING_BASE_URL;
  const apiKey = env.HQ_ORBIT_REPORTING_API_KEY;
  const triggerToken = env.HQ_PORTAL_SYNC_TOKEN;
  let code: HqLiveConfigurationCode = null;
  let fingerprint: string | null = null;
  if (sync === null || read === null || interval === null || freshness === null)
    code = "CONFIG_INVALID";
  else if (!sync && !read) code = "CONFIG_DISABLED";
  else if (!baseUrl || !apiKey || (sync && !triggerToken))
    code = "CONFIG_INCOMPLETE";
  else {
    try {
      // Constructor reuses the adapter's fixed trusted HTTPS URL/key/scope validation; no requests.
      new HqOrbitClient({
        baseUrl: baseUrl!,
        apiKey: apiKey!,
        scopeId: HQ_LIVE_SCOPE,
        enabled: false,
      });
      if (
        triggerToken !== undefined &&
        (triggerToken.length < 32 ||
          triggerToken.length > 256 ||
          /[^\x21-\x7e]/.test(triggerToken) ||
          triggerToken === apiKey)
      )
        throw new Error("invalid");
      const normalized = new URL(baseUrl!);
      normalized.pathname = normalized.pathname.replace(/\/$/, "");
      fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            "hq-live-source-v1",
            normalized.href,
            HQ_LIVE_SCOPE,
            apiKey,
          ])
        )
        .digest("hex");
    } catch {
      code = "CONFIG_INVALID";
    }
  }
  const configured = code === null;
  const projection: HqLiveConfigurationStatus = Object.freeze({
    syncEnabled: sync === true,
    readEnabled: read === true,
    configured,
    configurationCode: code,
    intervalSeconds: interval ?? 300,
    freshnessSeconds: freshness ?? 900,
  });
  return Object.freeze({
    status: () => ({ ...projection }),
    sourceFingerprint: () => fingerprint,
    authorizeTrigger(token: unknown) {
      if (
        !configured ||
        !sync ||
        typeof token !== "string" ||
        !triggerToken ||
        token.length > 256
      )
        return false;
      const expected = Buffer.from(triggerToken),
        actual = Buffer.from(token);
      return (
        expected.length === actual.length && timingSafeEqual(expected, actual)
      );
    },
    createReader() {
      if (!configured || !sync)
        throw Object.assign(new Error("CONFIG_INVALID"), {
          code: "CONFIG_INVALID",
        });
      return new HqOrbitClient({
        baseUrl: baseUrl!,
        apiKey: apiKey!,
        scopeId: HQ_LIVE_SCOPE,
        enabled: true,
      });
    },
  });
}
