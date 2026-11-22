/** Server-validated proposed reporting DTOs; no identity namespace literal is approved here. */
export const HQ_CONTRACT_VERSION = "1.0.0-proposed" as const;

export type HqAmount = {
  amount: string | null;
  currency: string | null;
  state:
    | "source_recorded"
    | "actual_recorded"
    | "calculated"
    | "estimated"
    | "missing"
    | "not_applicable"
    | "invalid";
  source: string | null;
  reason: string | null;
  evidenceIds: string[];
};

export type HqMargin = {
  fraction: string | null;
  state: "calculated" | "missing" | "invalid";
  denominator: string;
};

export type HqIdentity = {
  namespace: string | null;
  id: string | null;
  state:
    | "verified"
    | "current_assignment"
    | "label_only"
    | "unverified"
    | "missing";
  source: string | null;
};

export type HqBusiness = {
  orbitTenantId: string;
  name: string;
  accountType: "real" | "demo";
  active: boolean;
  portalBusinessId: string | null;
  mappingStatus: "verified" | "unmatched" | "conflict";
  mappingRevision: string | null;
  mappingSource: string | null;
};

export type HqDates = {
  portalRegisteredAt: string | null;
  bookedOnRaw: string | null;
  bookedOn: string | null;
  managementReportingDate: string | null;
  dateSource: "portal_registered_at" | "booked_on" | "none";
  dateRuleVersion: string;
  warnings: string[];
};

export type HqEligibility = {
  headlineCount: boolean | null;
  headlineGrossSales: boolean | null;
  cancelledCohort: boolean;
  pendingCohort: boolean;
  dated: boolean;
  statusRuleVersion: string;
  reason: string | null;
};

export type HqCommissionTerms = {
  agentFraction: string | null;
  jltFraction: string | null;
  state: "verified" | "stated_default_unverified" | "missing";
  source: string | null;
};

export type HqCommissionResult = {
  basis: string;
  complete: boolean;
  cardProcessingFeesIncluded: boolean;
  vatIncluded: boolean;
  ptsIncluded: boolean;
  netDistributableCommission: HqAmount;
  agentCommission: HqAmount;
  jltRetainedCommission: HqAmount;
  terms: HqCommissionTerms;
  roundingBasis: string;
  roundingResidual: HqAmount;
  limitations: string[];
};

export type HqDeduction = {
  code: string;
  amount: HqAmount;
  applicability: "applicable" | "not_applicable" | "unknown";
  alreadyIncludedElsewhere: boolean | null;
  policySource: string | null;
};

export type HqFinancials = {
  grossBookingValue: HqAmount;
  supplierNetCost: HqAmount;
  knownSupplierNetSubtotal: HqAmount;
  grossBookingProfit: HqAmount;
  grossBookingMargin: HqMargin;
  applicableVat: HqAmount;
  legacyBookingVatOverride: HqAmount;
  ptsFees: HqAmount;
  ptsFeeBasis: string;
  ptsAssumptions: string[];
  actualCardProcessingFees: HqAmount;
  estimatedCardProcessingFees: HqAmount;
  otherDeductions: HqDeduction[] | null;
  orbitCommissionBaseline: HqCommissionResult;
  policyCompleteCommission: HqCommissionResult;
  settledJltIncome: HqAmount;
  cancellationCharges: HqAmount;
  cancellationRetainedCommission: HqAmount;
  completeGrossAndCost: boolean;
  completeApprovedDeductions: boolean;
  policyVersion: string;
  warnings: string[];
};

export type HqProduct = {
  id: string;
  productType: string;
  rawBookingStatus: string | null;
  financialActive: boolean;
  supplierId: string | null;
  supplierName: string | null;
  grossValue: HqAmount;
  netCost: HqAmount;
  allocationBasis: string;
  vatApplicable: boolean | null;
  vatOverride: boolean | null;
  isReimbursement: boolean;
  sourceUpdatedAt: string | null;
};

export type HqPaymentEvidence = {
  id: string;
  method: string;
  paymentType: string;
  recordedReceipt: HqAmount;
  paidAt: string | null;
  createdAt: string | null;
  ppsLinkId: string | null;
  providerTransactionId: string | null;
  matchState: "verified" | "unmatched" | "ambiguous" | "unverified";
  feeEvidenceState:
    | "mapped_actual"
    | "estimated_only"
    | "unmapped"
    | "not_applicable";
};

export type HqBooking = {
  id: string;
  bookingRef: string;
  revision: string;
  contentHash: string;
  sourceUpdatedAt: string | null;
  sourceObservedAt: string | null;
  status: "confirmed" | "pending" | "cancelled";
  dates: HqDates;
  eligibility: HqEligibility;
  currency: string | null;
  currencyBasis: "validated_GBP" | "unverified" | "verified_native";
  passengerCount: number | null;
  bookingType: string | null;
  currentOwningBusiness: HqBusiness;
  originalSellingBusiness: HqIdentity;
  originalSellingAgent: HqIdentity;
  assignedUser: HqIdentity;
  processingAdministrator: HqIdentity;
  financials: HqFinancials;
  products: HqProduct[];
  payments: HqPaymentEvidence[];
  childMembershipComplete: boolean;
  qualityIssues: string[];
};

export type HqCoverage = {
  status: "verified" | "partial" | "unverified";
  requestedFrom: string | null;
  verifiedFrom: string | null;
  verifiedThrough: string | null;
  population: string;
  undatedCount: number | null;
  unmatchedBusinessCount: number | null;
  limitations: string[];
};

export type HqEnvelope = {
  contractVersion: typeof HQ_CONTRACT_VERSION;
  dataset: string;
  snapshotId: string;
  watermark: string;
  projectionPublishedAt: string | null;
  sourceObservationStartedAt: string | null;
  sourceObservationCompletedAt: string | null;
  dateRuleVersion: string;
  statusRuleVersion: string;
  financialPolicyVersion: string;
  scopeId: string;
  coverage: HqCoverage;
  nextCursor: string | null;
  hasMore: boolean;
};

export type HqBookingPage = HqEnvelope & {
  records: HqBooking[];
};

export type HqChange = {
  position: string;
  entityType: "booking" | "business_mapping" | "quote";
  id: string;
  revision: string;
  operation: "upsert" | "tombstone";
  reason:
    | "current_state_changed"
    | "source_deleted"
    | "out_of_scope"
    | "mapping_changed";
  observedAt: string | null;
  publishedAt: string | null;
  booking: HqBooking | null;
  mapping: HqBusiness | null;
  quote: HqQuote | null;
};

export type HqChangePage = HqEnvelope & {
  upperWatermark: string;
  records: HqChange[];
};

export type HqCatalogueEntry = {
  entityType: "booking" | "business_mapping" | "quote";
  id: string;
  revision: string;
  contentHash: string;
};

export type HqCataloguePage = HqEnvelope & {
  records: HqCatalogueEntry[];
};

export type HqBusinessPage = HqEnvelope & {
  records: HqBusiness[];
};

export type HqQuote = {
  id: string;
  quoteRef: string;
  revision: string;
  orbitTenantId: string;
  createdAt: string | null;
  updatedAt: string | null;
  status: "draft" | "sent" | "accepted" | "booked" | "expired";
  grossValue: HqAmount;
  enquiryId: string | null;
  linkedBookingId: string | null;
  linkedBookingRef: string | null;
  qualifiedActivity: boolean | null;
  qualificationBasis: string;
  qualificationWarnings: string[];
};

export type HqQuotePage = HqEnvelope & {
  records: HqQuote[];
};

export type HqModule = {
  name: string;
  enabled: boolean;
  readiness: "available" | "partial" | "unavailable";
  limitations: string[];
};

export type HqCapabilities = {
  contractVersion: typeof HQ_CONTRACT_VERSION;
  implementationState: string;
  modules: HqModule[];
  dateRuleVersion: string;
  statusRuleVersion: string;
  financialPolicyVersion: string;
  currencyBasis: string;
  coverage: HqCoverage;
  snapshotRetentionSeconds: number | null;
  journalRetentionSeconds: number | null;
  maximumPageSize: number;
  targetFreshnessMinutes: number;
  targetIsGuaranteed: boolean;
  pendingApprovals: string[];
};

export type HqStatus = {
  state: "healthy" | "building" | "partial" | "stale" | "failed" | "disabled";
  lastCompleteSnapshotId: string | null;
  lastCompleteWatermark: string | null;
  lastCompletePublishedAt: string | null;
  sourceObservationStartedAt: string | null;
  sourceObservationCompletedAt: string | null;
  oldestRetainedCursor: string | null;
  currentRunId: string | null;
  failureCode: string | null;
  targetFreshnessMinutes: number;
  targetIsGuaranteed: boolean;
};

export type HqError = {
  code:
    | "AUTHENTICATION_REQUIRED"
    | "SCOPE_FORBIDDEN"
    | "INVALID_QUERY"
    | "SNAPSHOT_EXPIRED"
    | "CURSOR_EXPIRED"
    | "RATE_LIMITED"
    | "MODULE_UNAVAILABLE"
    | "SOURCE_UNAVAILABLE";
  message: string;
  requestId: string;
  retryable: boolean;
};

export interface HqReader {
  bookings(cursor?: string): Promise<HqBookingPage>;
  changes(after: string, cursor?: string): Promise<HqChangePage>;
}
