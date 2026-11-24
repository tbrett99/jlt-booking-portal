import type { HqInitialValidationResult } from "../shared/management-hq-initial-validation";
import type { HqReport } from "../shared/management-hq-report";
import type { HqWireBookingPayload } from "../shared/management-hq-wire";
import {
  validateHqImplementedSyncState,
  type HqImplementedState,
} from "./management-hq-ingestion";
import { getHqLiveReport } from "./management-hq-live-report";
import type { HqLiveStatusDto } from "./management-hq-live-service";
import { HQ_LIVE_V2_VALIDATION_OPTIONS } from "./management-hq-storage-v2";

const LIMITATIONS = [
  "Scope: company_all_real_and_unattributed; no operational financial tables are used.",
  "GBP gross sales and gross profit are existing exact-pence engine known sums; missing coverage is not zero or a complete total.",
  "Current restated booking values stay in the source-selected management month; they are not an amendment or event ledger.",
  "MANUAL pending: compare the known +GBP 1000 amendment against Orbit-side before/after evidence in its actual original management month; current restated data cannot prove the historical change.",
  "Registered pending bookings count as active and contribute known GBP gross sales; unregistered pending and cancelled bookings are excluded. Pending status counts overlap active counts and must not be added again.",
  "Explicit source-financial sales exclusions remain excluded and flagged for review where a registered pending booking has known gross. Profit, margin, fee and commission totals retain confirmed source-eligible coverage; active sales are not earned commission or settled cash.",
  "Cohort counts do not prove a particular upstream historical cancellation without an Orbit reference.",
  "Current-owner mapping uses existing CRM uniqueAgentId and OAuth openId only; resolved owners remain provisional current membership, never verified original selling agents. Unresolved mappings remain unattributed.",
  "Baseline VAT and estimated PTS commission are source estimates, not all-fees entitlement, actual card fees, verified custom terms, cancellation income or settled JLT income.",
  "Source observation is per-page, not a run-wide source snapshot; membership history, join dates and quote conversion reporting are unavailable.",
  "Undated bookings are dataset-wide exceptions repeated on each year row; do not sum them across years. Unattributed counts concern dated selected bookings, not original-seller verification.",
  "Only actual eligible management years from 2000 through 2100 are checked; a publication with no dated bookings uses the current year only. Existing report-engine row and byte caps still apply.",
  "Manual checks remain pending. Normal reports, read access and recurring updates are not enabled or accepted by these checks.",
] as const;
const integer = (v: unknown, min = 0): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const instant = (v: unknown): number | null =>
  typeof v === "string" && v.length <= 64 && Number.isFinite(Date.parse(v))
    ? Date.parse(v)
    : null;
const unavailable = (checkedAt: string): HqInitialValidationResult => ({
  status: "needs_attention",
  message:
    "checks_not_current: a complete, matching, fresh publication is required; manual checks remain pending.",
  generationId: null,
  checkedAt,
  sourcePublishedAt: null,
  isStale: null,
  years: [],
  manualChecksPending: true,
  limitations: [...LIMITATIONS],
});
function current(
  state: HqImplementedState,
  status: HqLiveStatusDto,
  nowMs: number,
  pin: {
    generationId: number;
    stateVersion: number;
    publicationVersion: number;
  }
): boolean {
  const m = state.metadata;
  const observed = instant(m.sourceObservationWindow.to);
  const published = instant(m.publishedAt);
  const expires = instant(m.expiresAt);
  const checked = instant(status.lastSuccessfulCheckAt);
  if (
    !status.configured ||
    status.syncEnabled !== true ||
    status.readEnabled !== false ||
    status.hasPublished !== true ||
    status.health !== "ready" ||
    !["idle", "applied"].includes(status.stageStatus) ||
    status.progress !== null ||
    status.lastErrorCode !== null ||
    status.recoveryGuidance !== null ||
    status.isStale !== false ||
    m.stale !== false ||
    status.generationId !== pin.generationId ||
    m.generationId !== pin.generationId ||
    status.stateVersion !== pin.stateVersion ||
    state.version !== pin.publicationVersion ||
    !integer(status.stateVersion, 1) ||
    status.stateVersion < state.version ||
    status.sourceObservationAt !== m.sourceObservationWindow.to ||
    status.sourcePublishedAt !== m.publishedAt ||
    !integer(status.sourceAgeSeconds) ||
    !integer(status.freshnessTargetSeconds, 1) ||
    status.freshnessTargetSeconds > 900 ||
    observed === null ||
    published === null ||
    expires === null ||
    checked === null ||
    observed > nowMs ||
    published > nowMs ||
    checked > nowMs ||
    expires <= nowMs
  )
    return false;
  // Tighten emitted source age, never overwrite it with a younger cached status.
  const age = Math.max(
    m.sourceAgeSeconds,
    status.sourceAgeSeconds,
    Math.floor((nowMs - observed) / 1000),
    m.sourceAgeSeconds + Math.floor((nowMs - checked) / 1000)
  );
  return (
    age <=
    Math.min(900, m.freshnessTargetSeconds, status.freshnessTargetSeconds)
  );
}
function knownMoney(v: unknown): v is string | null {
  return (
    v === null ||
    (typeof v === "string" && v.length <= 128 && /^-?[0-9]+\.[0-9]{2}$/.test(v))
  );
}
function summary(
  report: HqReport,
  year: number
): HqInitialValidationResult["years"][number] {
  if (
    report.status !== "available" ||
    report.sourceContract !== "implemented_1.0.0" ||
    report.currency !== "GBP" ||
    report.scopeId !== "company_all_real_and_unattributed" ||
    report.filters.year !== year ||
    report.filters.month !== null ||
    !report.exportComplete ||
    !knownMoney(report.totals.grossSales.knownSum) ||
    !knownMoney(report.totals.grossProfit.knownSum)
  )
    throw new Error("HQ_INITIAL_CHECKS_NOT_CURRENT");
  const result = {
    year,
    activeBookings: report.totals.bookingCount,
    grossSales: report.totals.grossSales.knownSum,
    grossSalesMissing: report.totals.grossSales.missingCount,
    grossProfit: report.totals.grossProfit.knownSum,
    grossProfitMissing: report.totals.grossProfit.missingCount,
    cancelledBookings: report.cohorts.cancelledCount,
    pendingBookings: report.cohorts.pendingCount,
    undatedBookings: report.cohorts.undatedCount,
    unattributedBookings: report.cohorts.unattributedCount,
  };
  if (
    Object.entries(result).some(
      ([key, value]) =>
        key !== "grossSales" &&
        key !== "grossProfit" &&
        (!integer(value) || value > 100000)
    )
  )
    throw new Error("HQ_INITIAL_CHECKS_NOT_CURRENT");
  return result;
}

/** Server-only, read-only initial checks. No service/status/provider/import/cache calls.
 * The caller supplies the validated published state and a fresh protected status.
 * safeStatus.stateVersion is the sync-container version, NOT state.version; the
 * protected router must recheck that same container version/generation, authority
 * and source binding after this helper and before releasing its bounded result.
 * getHqLiveReport's optional fourth guard must bracket each awaited real directory
 * resolution; this helper also brackets every report read and rechecks freshness.
 */
export async function validateHqInitialPublication(
  state: HqImplementedState,
  db: unknown,
  safeStatus: HqLiveStatusDto,
  guard?: () => Promise<void>
): Promise<HqInitialValidationResult> {
  const checkedAt = new Date().toISOString();
  try {
    if (!state) {
      if (
        safeStatus.configured &&
        safeStatus.syncEnabled === true &&
        safeStatus.readEnabled === false &&
        safeStatus.hasPublished === false &&
        safeStatus.health === "no_data" &&
        safeStatus.progress === null &&
        safeStatus.lastErrorCode === null &&
        ["idle", "applied"].includes(safeStatus.stageStatus)
      ) {
        if (guard) await guard();
        return {
          ...unavailable(checkedAt),
          status: "awaiting_import",
          message:
            "Awaiting a complete initial reporting publication; manual checks remain pending.",
        };
      }
      return unavailable(checkedAt);
    }
    validateHqImplementedSyncState(
      {
        version: state.version,
        published: state,
        stage: null,
      },
      HQ_LIVE_V2_VALIDATION_OPTIONS
    );
    if (!integer(safeStatus.stateVersion, 1)) return unavailable(checkedAt);
    const pin = {
      generationId: state.metadata.generationId,
      stateVersion: safeStatus.stateVersion,
      publicationVersion: state.version,
    };
    if (!current(state, safeStatus, Date.now(), pin))
      return unavailable(checkedAt);

    // The existing validator checks canonical payloads, full children, source date
    // semantics and metadata. Reconcile supplied live counts, not guessed totals.
    const liveCounts = { booking: 0, business: 0 };
    const years = new Set<number>();
    for (const record of Object.values(state.entities)) {
      if (record.absent || record.entity.payload.deleted === true) continue;
      liveCounts[record.entity.entityType]++;
      if (record.entity.entityType !== "booking") continue;
      const payload = record.entity.payload as HqWireBookingPayload;
      if (payload.eligibility.undated || payload.dates.managementDate === null)
        continue;
      const year = Number(payload.dates.managementDate.slice(0, 4));
      if (!integer(year, 2000) || year > 2100) return unavailable(checkedAt);
      years.add(year);
    }
    for (const kind of ["booking", "business"] as const) {
      const supplied = state.metadata.counts[`${kind}Count`];
      if (!integer(supplied) || supplied !== liveCounts[kind])
        return unavailable(checkedAt);
    }
    if (years.size === 0) {
      const year = new Date().getUTCFullYear();
      if (year < 2000 || year > 2100) return unavailable(checkedAt);
      years.add(year);
    }
    if (years.size > 101) return unavailable(checkedAt);
    const assertCurrent = async () => {
      if (guard) await guard();
      if (!current(state, safeStatus, Date.now(), pin))
        throw new Error("HQ_INITIAL_CHECKS_NOT_CURRENT");
    };
    const rows: HqInitialValidationResult["years"] = [];
    // Optional guarded reader contract is backwards compatible with 3-arg callers.
    const read: (
      state: HqImplementedState,
      db: unknown,
      range: { year: number },
      guard?: () => Promise<void>
    ) => Promise<HqReport> = getHqLiveReport;
    for (const year of Array.from(years).sort((a, b) => a - b)) {
      await assertCurrent();
      const report = await read(state, db, { year }, assertCurrent);
      await assertCurrent();
      if (
        report.generationId !== pin.generationId ||
        report.publishedAt !== state.metadata.publishedAt
      )
        return unavailable(checkedAt);
      rows.push(summary(report, year));
    }
    await assertCurrent();
    return {
      status: "checks_ready",
      message:
        "Bounded publication checks are ready for manual review; they are not accepted and reporting remains disabled.",
      generationId: pin.generationId,
      checkedAt,
      sourcePublishedAt: new Date(state.metadata.publishedAt).toISOString(),
      isStale: false,
      years: rows,
      manualChecksPending: true,
      limitations: [...LIMITATIONS],
    };
  } catch {
    // Never return thrown SQL, provider, guard or identity messages/causes.
    return unavailable(checkedAt);
  }
}
