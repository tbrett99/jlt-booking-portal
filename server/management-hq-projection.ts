import type {
  HqAmount,
  HqBooking,
  HqCommissionResult,
  HqIdentity,
} from "../shared/management-hq-types";
import type {
  HqWireBookingPayload,
  HqWireBusinessPayload,
  HqWireEntity,
  HqWireMemberLink,
} from "../shared/management-hq-wire";

type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Fields)
    : {};
const positiveId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const exactId = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  value === value.trim() &&
  !/[\u0000-\u001f\u007f]/.test(value);
const idsValid = (agent: unknown, open: unknown) =>
  (agent === null || exactId(agent, 20)) &&
  (open === null || exactId(open, 64)) &&
  (agent !== null || open !== null);
const memberMatches = (
  m: Fields,
  tenant: number,
  id: number,
  role: unknown,
  agent: unknown,
  open: unknown
) =>
  m.id === id &&
  m.tenantId === tenant &&
  m.role === role &&
  m.jltAgentId === agent &&
  m.jltOpenId === open &&
  typeof m.isActive === "boolean";
const sourceLinkValid = (link: HqWireMemberLink) =>
  link !== null &&
  typeof link === "object" &&
  link.sourceOnly === true &&
  link.portalVerified === false &&
  link.historicalSellingRelationshipVerified === false &&
  link.attributionBasis === "current_owning_tenant_and_current_membership" &&
  positiveId(link.orbitTenantId) &&
  Array.isArray(link.members) &&
  Array.isArray(link.ownerCandidates);

/** Source candidate coherence only; this is never verification of historical selling. */
export function hqCurrentOwnerSourceCandidate(
  link: HqWireMemberLink
): { jltAgentId: string | null; jltOpenId: string | null } | null {
  if (
    !sourceLinkValid(link) ||
    link.status !== "candidate" ||
    link.mappingState !== "existing_owner_link" ||
    !positiveId(link.ownerTenantUserId) ||
    !idsValid(link.memberJltAgentId, link.memberJltOpenId) ||
    link.ownerCandidates.length !== 1
  )
    return null;
  const candidate = fields(link.ownerCandidates[0]);
  if (
    !memberMatches(
      candidate,
      link.orbitTenantId!,
      link.ownerTenantUserId,
      "owner",
      link.memberJltAgentId,
      link.memberJltOpenId
    )
  )
    return null;
  const owners = link.members.map(fields).filter(m => m.role === "owner");
  const members = link.members
    .map(fields)
    .filter(m => m.id === link.ownerTenantUserId);
  if (
    owners.length !== 1 ||
    members.length !== 1 ||
    !memberMatches(
      members[0],
      link.orbitTenantId!,
      link.ownerTenantUserId,
      "owner",
      link.memberJltAgentId,
      link.memberJltOpenId
    ) ||
    members[0].isActive !== candidate.isActive
  )
    return null;
  return { jltAgentId: link.memberJltAgentId, jltOpenId: link.memberJltOpenId };
}

/** Assigned membership is separate from owner and processing-administrator evidence. */
export function hqAssignedStaffSourceCandidate(
  link: HqWireMemberLink
): { jltAgentId: string | null; jltOpenId: string | null } | null {
  if (!sourceLinkValid(link)) return null;
  const assigned = fields(link.assignedStaff);
  if (
    assigned.status !== "current_member" ||
    assigned.sourceOnly !== true ||
    assigned.portalVerified !== false ||
    !positiveId(assigned.orbitTenantUserId) ||
    !["owner", "staff"].includes(String(assigned.role)) ||
    !idsValid(assigned.jltAgentId, assigned.jltOpenId)
  )
    return null;
  const members = link.members
    .map(fields)
    .filter(m => m.id === assigned.orbitTenantUserId);
  if (
    members.length !== 1 ||
    !memberMatches(
      members[0],
      link.orbitTenantId!,
      assigned.orbitTenantUserId,
      assigned.role,
      assigned.jltAgentId,
      assigned.jltOpenId
    ) ||
    members[0].isActive !== assigned.isActive
  )
    return null;
  return {
    jltAgentId: assigned.jltAgentId as string | null,
    jltOpenId: assigned.jltOpenId as string | null,
  };
}

/** Interpret the decimal spelling, not a binary-float multiplication/rounding operation.
 * Unsafe penny magnitudes and sub-penny source amounts remain unknown. */
export function hqWirePence(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const text = String(value);
  if (text.length > 128 || !/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) return null;
  const pennies =
    BigInt(whole) * BigInt(100) +
    BigInt((fraction.slice(0, 2) + "00").slice(0, 2));
  if (pennies > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(negative ? -pennies : pennies);
}
const pennyDecimal = (value: number): string => {
  const p = BigInt(value),
    n = p < BigInt(0),
    abs = n ? -p : p;
  return `${n ? "-" : ""}${abs / BigInt(100)}.${(abs % BigInt(100)).toString().padStart(2, "0")}`;
};
const integerPence = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;
const safeCode = (value: unknown): string | null =>
  typeof value === "string" && /^[a-z][a-z0-9_]{0,255}$/.test(value)
    ? value
    : null;
// Explicit allowlist: arbitrary diagnostic strings, URLs, tokens and evidence IDs never enter a report.
const REASONS = new Set([
  "cancelled_booking_excluded",
  "pending_booking_excluded",
  "no_active_products",
  "missing_active_product_price",
  "missing_active_product_net_cost",
  "missing_net_cost",
  "missing_net_cost_products",
  "stored_total_missing",
  "gross_reconciliation_mismatch",
  "no_pps_links_is_not_evidence_of_no_card_fees",
  "actual_or_applicable_card_processing_fee_evidence_unverified",
  "actual_pts_charge_evidence_unverified",
  "other_deductions_applicability_unverified",
  "commission_terms_unverified_default",
  "current_supplier_vat_policy_parity_unverified",
]);
const reasons = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((s): s is string => typeof s === "string" && REASONS.has(s))
    : [];
const identityMissing = (): HqIdentity => ({
  namespace: null,
  id: null,
  state: "missing",
  source: null,
});
function amount(
  value: unknown,
  currency: string | null,
  state: HqAmount["state"] = "source_recorded",
  reason: string | null = null
): HqAmount {
  const pence = hqWirePence(value);
  return {
    amount: pence === null ? null : pennyDecimal(pence),
    currency,
    state:
      pence !== null
        ? state
        : value === null || value === undefined
          ? "missing"
          : "invalid",
    source: pence !== null ? "implemented_wire_source" : null,
    reason:
      pence === null
        ? (reason ??
          (value === null || value === undefined
            ? "SOURCE_AMOUNT_MISSING"
            : "SOURCE_AMOUNT_UNSAFE_OR_SUBPENNY"))
        : reason,
    evidenceIds: [],
  };
}
function unknownCommission(currency: string | null): HqCommissionResult {
  return {
    basis: "unavailable_not_certified_by_implemented_source",
    complete: false,
    cardProcessingFeesIncluded: false,
    vatIncluded: false,
    ptsIncluded: false,
    netDistributableCommission: amount(null, currency),
    agentCommission: amount(null, currency),
    jltRetainedCommission: amount(null, currency),
    terms: {
      agentFraction: null,
      jltFraction: null,
      state: "missing",
      source: null,
    },
    roundingBasis: "",
    roundingResidual: amount(null, currency),
    limitations: [
      "All-fees entitlement and settlement are not certified by the implemented source.",
    ],
  };
}

/** Projects a validated current aggregate; does not manufacture an old draft envelope/rule generation. */
export function projectHqWireBooking(
  entity: HqWireEntity,
  businessEntity?: HqWireEntity
): HqBooking {
  if (
    entity.entityType !== "booking" ||
    !positiveId(entity.entityId) ||
    !positiveId(entity.revision)
  )
    throw new Error("Invalid booking projection entity");
  const p = entity.payload as HqWireBookingPayload;
  if (
    !p ||
    fields(p).deleted === true ||
    p.orbitBookingId !== entity.entityId ||
    !p.childrenComplete
  )
    throw new Error("Booking projection requires complete live payload");
  const f = fields(p.financials),
    baseline = fields(f.baselineEstimate),
    bf = fields(baseline.financials),
    completeness = fields(f.completeness);
  const currency =
    f.currency === "GBP"
      ? "GBP"
      : typeof f.currency === "string"
        ? f.currency
        : null;
  const completeNet =
    (f.netCostStatus === "complete" ||
      (f.netCostStatus === undefined &&
        completeness.strictSourceComplete === true)) &&
    hqWirePence(f.totalNetCost) !== null;
  const profitEligible =
    p.status === "confirmed" &&
    f.economicProfitEligible !== false &&
    completeness.economicsStatus === "complete" &&
    completeNet;
  const baselineAvailable =
    baseline.status === "estimated" && baseline.financials !== null;
  const baselineResult = unknownCommission(currency);
  baselineResult.basis =
    baseline.basis === "orbit_vat_pts_estimate"
      ? "orbit_vat_pts_estimate"
      : "source_baseline_estimate";
  baselineResult.terms = {
    agentFraction: baseline.agentSplitPct === 80 ? "0.80" : null,
    jltFraction: baseline.jltSplitPct === 20 ? "0.20" : null,
    state: "stated_default_unverified",
    source: "implemented_source_default_not_verified_custom_terms",
  };
  baselineResult.vatIncluded = baselineAvailable;
  baselineResult.ptsIncluded = baselineAvailable;
  baselineResult.netDistributableCommission = amount(
    baselineAvailable ? bf.netDistributableCommission : null,
    currency,
    "estimated"
  );
  baselineResult.agentCommission = amount(
    baselineAvailable ? bf.agentExpectedCommission : null,
    currency,
    "estimated"
  );
  baselineResult.jltRetainedCommission = amount(
    baselineAvailable ? bf.jltRetainedCommission : null,
    currency,
    "estimated"
  );
  const residual = integerPence(baseline.splitRoundingResidualPence);
  baselineResult.roundingResidual =
    residual === null
      ? amount(null, currency)
      : amount(pennyDecimal(residual), currency, "calculated");
  baselineResult.roundingBasis =
    baseline.rounding ===
    "existing_helper_sums_raw_vat_and_pts_then_splits_unrounded_post_fee_amount_and_rounds_each_share_independently"
      ? baseline.rounding
      : "";
  baselineResult.limitations = [
    "Source estimate only; default split is not verified custom terms and excludes card fees and other deductions.",
    ...reasons(baseline.reasons),
  ];
  const b =
    businessEntity?.entityType === "business" &&
    businessEntity.entityId === p.orbitTenantId
      ? (businessEntity.payload as HqWireBusinessPayload)
      : undefined;
  const businessAvailable =
    b &&
    fields(b).deleted !== true &&
    b.orbitTenantId === p.orbitTenantId &&
    b.identity?.orbitTenantId === p.orbitTenantId;
  const currentOwnerLink = businessAvailable ? b.identity : undefined;
  const assignedStaffLink = businessAvailable
    ? { ...p.identity, members: b.identity.members }
    : p.identity;
  const account = fields(b?.account);
  const w = fields(f.weightedMarginContribution),
    wp = integerPence(w.profitPence),
    wg = integerPence(w.coveredGrossPence);
  const weightedMethod =
    w.methodology ===
    "sum_profit_pence_divided_by_matching_sum_covered_gross_pence_times_100"
      ? w.methodology
      : "";
  const weightedKnown =
    profitEligible &&
    currency === "GBP" &&
    weightedMethod !== "" &&
    wp !== null &&
    wg !== null &&
    wg >= 0;
  const gross = amount(f.grossBookingValue, currency);
  const supplierNet = amount(
    completeNet ? f.totalNetCost : null,
    currency,
    "source_recorded",
    completeNet ? null : "SOURCE_NET_COST_INCOMPLETE"
  );
  const profit = amount(profitEligible ? f.grossBookingProfit : null, currency);
  const baselineStatus = [
    "excluded",
    "estimated",
    "incomplete",
    "unavailable",
  ].includes(String(baseline.status))
    ? String(baseline.status)
    : "unavailable";
  return {
    id: String(entity.entityId),
    bookingRef: p.bookingRef,
    revision: String(entity.revision),
    contentHash: "",
    sourceUpdatedAt: null,
    sourceObservedAt: null,
    status: p.status,
    dates: {
      portalRegisteredAt: p.dates.portalRegisteredAt,
      bookedOnRaw: p.dates.bookedOn,
      bookedOn: p.dates.bookedOn,
      managementReportingDate: p.dates.managementDate,
      dateSource:
        p.dates.dateSource === "unavailable" ? "none" : p.dates.dateSource,
      dateRuleVersion: "",
      warnings: [],
    },
    eligibility: {
      headlineCount:
        p.status === "confirmed" && p.eligibility.activeSalesHeadline === true,
      headlineGrossSales:
        p.status === "confirmed" &&
        p.eligibility.activeSalesHeadline === true &&
        f.headlineEligible !== false,
      cancelledCohort: p.status === "cancelled",
      pendingCohort: p.status === "pending",
      dated: !p.eligibility.undated && p.dates.managementDate !== null,
      statusRuleVersion: "",
      reason: null,
    },
    currency,
    currencyBasis: currency === "GBP" ? "validated_GBP" : "unverified",
    passengerCount:
      Number.isSafeInteger(fields(p).travelers) &&
      Number(fields(p).travelers) >= 0
        ? Number(fields(p).travelers)
        : null,
    bookingType: safeCode(fields(p).packageType),
    currentOwningBusiness: {
      orbitTenantId: p.orbitTenantId === null ? "" : String(p.orbitTenantId),
      name:
        typeof account.businessName === "string"
          ? account.businessName
          : typeof account.name === "string"
            ? account.name
            : p.orbitTenantId === null
              ? "Unattributed business"
              : `Orbit business ${p.orbitTenantId}`,
      accountType: "real",
      active: b?.isActive ?? true,
      portalBusinessId: null,
      mappingStatus: "unmatched",
      mappingRevision: null,
      mappingSource: null,
    },
    originalSellingBusiness: identityMissing(),
    originalSellingAgent: identityMissing(),
    assignedUser: identityMissing(),
    processingAdministrator: identityMissing(),
    financials: {
      grossBookingValue: gross,
      supplierNetCost: supplierNet,
      knownSupplierNetSubtotal: amount(f.netCostSubtotal, currency),
      grossBookingProfit: profit,
      grossBookingMargin: {
        fraction: null,
        state:
          profitEligible &&
          typeof f.grossMarginPct === "number" &&
          Number.isFinite(f.grossMarginPct)
            ? "calculated"
            : "missing",
        denominator: "source_matching_covered_gross",
      },
      applicableVat: amount(
        f.vatStatus === "computed_not_paid" ? f.vatDeduction : null,
        currency,
        "calculated"
      ),
      legacyBookingVatOverride: amount(null, currency),
      ptsFees: amount(f.estimatedPtsFees, currency, "estimated"),
      ptsFeeBasis: "source_estimated_pts_not_actual_charge",
      ptsAssumptions: ["Source assumptions only; no Portal fee recomputation."],
      actualCardProcessingFees: amount(null, currency),
      estimatedCardProcessingFees: amount(
        f.estimatedCardProcessingFees,
        currency,
        "estimated"
      ),
      otherDeductions: null,
      orbitCommissionBaseline: baselineResult,
      policyCompleteCommission: unknownCommission(currency),
      settledJltIncome: amount(null, currency),
      cancellationCharges: amount(null, currency),
      cancellationRetainedCommission: amount(null, currency),
      completeGrossAndCost: completeNet && gross.amount !== null,
      completeApprovedDeductions: false,
      policyVersion: "",
      warnings: [
        ...reasons(completeness.economicsReasons),
        ...reasons(completeness.policyReasons),
      ],
    },
    products: [],
    payments: [],
    childMembershipComplete: true,
    qualityIssues: [],
    projectionSource: "implemented_wire",
    currentOwnerLink,
    assignedStaffLink,
    currentOwnerSourceReason: businessAvailable
      ? undefined
      : "CURRENT_BUSINESS_MAPPING_UNAVAILABLE",
    weightedMarginContribution: {
      profitPence: weightedKnown ? wp : null,
      coveredGrossPence: weightedKnown ? wg : null,
      methodology: weightedMethod,
    },
    sourceFinance: {
      netCostStatus: ["complete", "incomplete", "missing"].includes(
        String(f.netCostStatus)
      )
        ? String(f.netCostStatus)
        : "unknown",
      baselineStatus,
      economicsStatus: ["complete", "excluded", "incomplete"].includes(
        String(completeness.economicsStatus)
      )
        ? String(completeness.economicsStatus)
        : "unknown",
      vatStatus:
        f.vatStatus === "computed_not_paid"
          ? "computed_not_paid"
          : "incomplete",
      knownPpsFeeEstimateSubtotal: amount(
        f.knownPpsFeeEstimateSubtotal,
        currency,
        "estimated"
      ),
      grossMarginPct:
        typeof f.grossMarginPct === "number" &&
        Number.isFinite(f.grossMarginPct)
          ? String(f.grossMarginPct)
          : null,
      reasons: [
        ...reasons(baseline.reasons),
        ...reasons(completeness.economicsReasons),
        ...reasons(completeness.policyReasons),
      ],
    },
  };
}
