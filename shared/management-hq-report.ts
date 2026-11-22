/** Isolated HQ read-model DTO. Decimal strings are GBP amounts, never JSON floats.
 * Source financial values are passed through, not recalculated entitlements/cash.
 */
export interface HqMoneyCoverage {
  knownSum: string | null;
  coveredCount: number;
  eligibleCount: number;
  missingCount: number;
  /** Non-applicable items, including explicit evidenced zero; not missing inputs. */
  notApplicableCount?: number;
  estimatedCount: number;
  actualRecordedCount: number;
}
export interface HqReportTotals {
  bookingCount: number;
  passengerCount: number;
  unknownPassengerCount: number;
  grossSales: HqMoneyCoverage;
  supplierNetCost: HqMoneyCoverage;
  knownSupplierNetSubtotal: HqMoneyCoverage;
  grossProfit: HqMoneyCoverage;
  weightedMargin: {
    fraction: string | null;
    coveredCount: number;
    coveredGross: string | null;
    coveredProfit: string | null;
  };
  applicableVat: HqMoneyCoverage;
  ptsFees: HqMoneyCoverage;
  actualCardFees: HqMoneyCoverage;
  estimatedCardFees: HqMoneyCoverage;
  baselineAgentCommission: HqMoneyCoverage;
  baselineJltRetainedCommission: HqMoneyCoverage;
  completeAgentCommission: HqMoneyCoverage;
  completeJltRetainedCommission: HqMoneyCoverage;
  settledJltIncome: HqMoneyCoverage;
}
export interface HqReportPerson {
  userId: number;
  uniqueAgentId: string | null;
  name: string;
  role: string;
}
export interface HqBookingDrilldown {
  id: string;
  bookingRef: string;
  revision: string;
  status: "confirmed" | "pending" | "cancelled";
  reportingDate: string | null;
  dateSource: string;
  cohort: "headline" | "pending" | "cancelled" | "exception";
  business: {
    orbitTenantId: string;
    name: string;
    mappingStatus: string;
    portalBusinessId: string | null;
  };
  seller: HqReportPerson | null;
  sellerReason: string | null;
  processor: HqReportPerson | null;
  currentOwner?: HqReportPerson | null;
  currentOwnerReason?: string | null;
  assignedStaff?: HqReportPerson | null;
  attributionState?:
    | "provisional_current_owner"
    | "unresolved"
    | "verified_original_seller";
  passengerCount: number | null;
  currency: string | null;
  currencyBasis: string;
  financials: {
    gross: string | null;
    supplierNet: string | null;
    knownSupplierNetSubtotal: string | null;
    grossProfit: string | null;
    applicableVat: string | null;
    ptsFees: string | null;
    actualCardFees: string | null;
    estimatedCardFees: string | null;
    baselineAgentCommission: string | null;
    baselineJltRetainedCommission: string | null;
    completeAgentCommission: string | null;
    completeJltRetainedCommission: string | null;
    settledJltIncome: string | null;
    cancellationCharges: string | null;
    cancellationRetainedCommission: string | null;
    baselineComplete: boolean;
    policyComplete: boolean;
    grossMargin: {
      fraction: string | null;
      state: string;
      denominator: string;
    };
    baseline: HqCommissionPassthrough;
    policy: HqCommissionPassthrough;
    otherDeductions: HqDeductionPassthrough[] | null;
    policyVersion: string;
    ptsFeeBasis: string;
    ptsAssumptions: string[];
    completeGrossAndCost: boolean;
    completeApprovedDeductions: boolean;
    warnings: string[];
    /** Source state/currency metadata, no evidence/provider IDs exposed. */
    amountStates: Record<
      string,
      { state: string; currency: string | null; reason: string | null }
    >;
    sourceStatus?: {
      netCost: string;
      baseline: string;
      economics: string;
      vat: string;
      reasons: string[];
    };
    knownPpsFeeEstimateSubtotal?: string | null;
    sourceGrossMarginPct?: string | null;
    weightedMarginContribution?: {
      profitPence: number | null;
      coveredGrossPence: number | null;
      methodology: string;
    };
  };
  qualityIssues: string[];
}
export interface HqCommissionPassthrough {
  basis: string;
  complete: boolean;
  netDistributableCommission: string | null;
  agentCommission: string | null;
  jltRetainedCommission: string | null;
  cardProcessingFeesIncluded: boolean;
  vatIncluded: boolean;
  ptsIncluded: boolean;
  terms: {
    agentFraction: string | null;
    jltFraction: string | null;
    state: string;
  };
  roundingBasis: string;
  roundingResidual: string | null;
  limitations: string[];
}
export interface HqDeductionPassthrough {
  code: string;
  amount: string | null;
  currency: string | null;
  state: string;
  applicability: string;
  alreadyIncludedElsewhere: boolean | null;
  policySource: string | null;
}
export interface HqMonthlyReportRow {
  month: number;
  totals: HqReportTotals;
  pendingCount: number;
  cancelledCount: number;
  exceptionCount: number;
}
export interface HqAgentReportRow {
  agent: HqReportPerson;
  totals: HqReportTotals;
  pendingCount: number;
  cancelledCount: number;
  attributionState?: "provisional_current_owner" | "verified_original_seller";
}
export interface HqReport {
  status: "available" | "unavailable";
  unavailableReason: string | null;
  liveReady: false;
  scopeId: string;
  watermark: string;
  snapshotId: string;
  filters: { year: number; month: number | null };
  currency: "GBP";
  totals: HqReportTotals;
  cohorts: {
    pendingCount: number;
    cancelledCount: number;
    exceptionCount: number;
    undatedCount: number;
    unmatchedBusinessCount: number;
    unattributedCount: number;
    excludedDemoCount: number;
    tombstoneCount: number;
    unsupportedCurrencyCount: number;
  };
  monthly: HqMonthlyReportRow[];
  agents: HqAgentReportRow[];
  bookings: HqBookingDrilldown[];
  undatedExceptions: HqBookingDrilldown[];
  exportComplete: boolean;
  limitations: string[];
  sourceContract?: "implemented_1.0.0" | "legacy_internal";
  generationId?: number;
  sourceObservationWindow?: { from: string; to: string };
  publishedAt?: string;
  sourceAgeSeconds?: number;
  freshnessTargetSeconds?: number;
  stale?: boolean;
}
