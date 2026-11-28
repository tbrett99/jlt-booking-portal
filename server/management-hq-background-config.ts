import { createHash } from "node:crypto";
export const HQ_BACKGROUND_STARTUP_DATABASE_URL = process.env.DATABASE_URL;
const SETTINGS = [
  "DATABASE_URL",
  "HQ_ORBIT_REPORTING_BASE_URL",
  "HQ_ORBIT_REPORTING_API_KEY",
  "HQ_PORTAL_SYNC_TOKEN",
  "HQ_LIVE_SYNC_ENABLED",
  "HQ_LIVE_READ_ENABLED",
  "HQ_LIVE_INTERVAL_SECONDS",
  "HQ_LIVE_FRESHNESS_SECONDS",
  "HQ_INITIAL_BACKGROUND_ENABLED",
] as const;
/** Pure opt-in: no reporting store, database pool, source client or migrations. */
export function rawHqBackgroundEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const flag = env.HQ_INITIAL_BACKGROUND_ENABLED;
  if (flag !== undefined && flag !== "false" && flag !== "true")
    throw Object.assign(new Error("CONFIG_INVALID"), {
      code: "CONFIG_INVALID",
    });
  return flag === "true";
}
export function hqBackgroundBinding(
  env: NodeJS.ProcessEnv = process.env
): string {
  return createHash("sha256")
    .update(JSON.stringify(SETTINGS.map(key => env[key])))
    .digest("hex");
}
