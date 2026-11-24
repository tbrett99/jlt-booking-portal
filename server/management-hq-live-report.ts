import type { HqReport } from "../shared/management-hq-report";
import type { HqWireMemberLink } from "../shared/management-hq-wire";
import { getHqReport, type HqIdentityDirectory } from "./management-hq-engine";
import { createPortalHqImplementedDirectory } from "./management-hq-identity";
import type { HqImplementedState } from "./management-hq-ingestion";
import type { HqLiveStatusDto } from "./management-hq-live-service";

/** Only a single report owns this cache. Rejections propagate; never salvage a failed merge. */
export function memoizeHqReportDirectory(
  directory: HqIdentityDirectory
): HqIdentityDirectory {
  const memo = (
    resolve: NonNullable<HqIdentityDirectory["resolveCurrentOwner"]>
  ) => {
    const links = new Map<string, ReturnType<typeof resolve>>();
    return (link: HqWireMemberLink) => {
      const key = JSON.stringify(link);
      if (!links.has(key)) links.set(key, resolve(link));
      return links.get(key)!;
    };
  };
  return {
    resolve: evidence => directory.resolve(evidence),
    ...(directory.resolveCurrentOwner
      ? {
          resolveCurrentOwner: memo(link =>
            directory.resolveCurrentOwner!(link)
          ),
        }
      : {}),
    ...(directory.resolveAssignedStaff
      ? {
          resolveAssignedStaff: memo(link =>
            directory.resolveAssignedStaff!(link)
          ),
        }
      : {}),
  };
}

export async function getHqLiveReport(
  state: HqImplementedState,
  db: unknown,
  range: { year: number; month?: number }
): Promise<HqReport> {
  // The real existing-person directory is mandatory. No fixture directory in live mode.
  const report = await getHqReport(
    state,
    memoizeHqReportDirectory(createPortalHqImplementedDirectory(db)),
    range
  );
  if (report.status !== "available") throw new Error("HQ_REPORT_UNAVAILABLE");
  return report;
}

/** Dynamic safe status can tighten, but never weaken Orbit's emitted freshness policy. */
export function withHqLiveReportMetadata(
  report: HqReport,
  state: HqImplementedState,
  status: HqLiveStatusDto
): HqReport {
  if (
    !status.configured ||
    !status.readEnabled ||
    !status.hasPublished ||
    status.generationId !== state.metadata.generationId ||
    status.sourceAgeSeconds === null
  )
    throw new Error("HQ_REPORT_UNAVAILABLE");
  const target = Math.min(
    state.metadata.freshnessTargetSeconds,
    status.freshnessTargetSeconds
  );
  const stale =
    state.metadata.stale ||
    status.isStale === true ||
    status.sourceAgeSeconds > target;
  return {
    ...report,
    sourceMode: "live",
    liveReady: false,
    sourceAgeSeconds: status.sourceAgeSeconds,
    freshnessTargetSeconds: target,
    stale,
    stateVersion: status.stateVersion,
    lastSuccessfulCheckAt: status.lastSuccessfulCheckAt,
    lastPublishedAt: status.lastPublishedAt,
    limitations: report.limitations.map(note =>
      note ===
      "Implemented 1.0.0 source projection; offline local examples only, no verified live deployment."
        ? "Orbit reporting import through production wiring; live semantic acceptance is not yet verified."
        : note
    ),
  };
}
