// Implemented Management HQ wire contract only. Legacy proposed fixtures are internal.
// Additional source diagnostics are legal JSON, bounded by the server validator.
type WireObject = { [key: string]: unknown };
type WireDates = WireObject & {
  portalRegisteredAt: string | null;
  bookedOn: string | null;
  managementDate: string | null;
  dateSource: "portal_registered_at" | "booked_on" | "unavailable";
  month: string | null;
  timezone: "Europe/London";
  issues: string[];
};
export type HqWireMemberLink = WireObject & {
  orbitTenantId: number | null;
  mappingState: "existing_owner_link" | "unresolved";
  status: "candidate" | "unresolved";
  reason: string;
  sourceOnly: true;
  portalVerified: false;
  historicalSellingRelationshipVerified: false;
  attributionBasis: "current_owning_tenant_and_current_membership";
  ownerTenantUserId: number | null;
  memberJltAgentId: string | null;
  memberJltOpenId: string | null;
  ownerCandidates: WireObject[];
  members: WireObject[];
  assignedStaff: WireObject & {
    orbitTenantUserId: number | null;
    status:
      | "current_member"
      | "unassigned"
      | "missing_user"
      | "tenant_mismatch"
      | "unresolved_tenant";
    jltAgentId: string | null;
    jltOpenId: string | null;
    role: "owner" | "staff" | null;
    isActive: boolean | null;
    sourceOnly: true;
    portalVerified: false;
  };
};
type WireFinancials = WireObject & {
  version: "management_hq_financials_v1";
  currency: "GBP";
  grossBookingValue: number | null;
  totalNetCost: number | null;
  netCostSubtotal: number | null;
  grossBookingProfit: number | null;
  grossMarginPct: number | null;
  weightedMarginContribution: WireObject & {
    profitPence: number | null;
    coveredGrossPence: number | null;
    methodology: string;
  };
  vatDeduction: number | null;
  vatStatus: "computed_not_paid" | "incomplete";
  estimatedPtsFees: number | null;
  actualPtsFees: null;
  estimatedCardProcessingFees: number | null;
  knownPpsFeeEstimateSubtotal: number | null;
  actualCardProcessingFees: null;
  netDistributableCommission: null;
  agentCommission: null;
  jltRetainedCommission: null;
  retainedCancellationIncome: null;
  settledJltIncome: null;
  baselineEstimate: WireObject & {
    status: "excluded" | "estimated" | "incomplete" | "unavailable";
    financials: WireObject | null;
    cardProcessingFeesIncluded: false;
    otherDeductionsIncluded: false;
    agentSplitPct: 80;
    jltSplitPct: 20;
    reasons: string[];
  };
  completeness: WireObject & {
    status: "partial";
    economicsStatus: "complete" | "excluded" | "incomplete";
    strictSourceComplete: boolean;
    policyStatus: "incomplete";
    economicsReasons: string[];
    policyReasons: string[];
  };
};
type WireProduct = WireObject & {
  id: number;
  productType: string | null;
  supplierName: string | null;
  supplierId: number | null;
  price: string | number | null;
  netPrice: string | number | null;
  bookingStatus: string | null;
  vatApplicable: boolean | null;
  vatOverride: boolean | null;
  isReimbursement: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
};
export type HqWireBookingPayload = WireObject & {
  orbitBookingId: number;
  orbitTenantId: number | null;
  assignedTenantUserId: number | null;
  bookingRef: string;
  status: "confirmed" | "pending" | "cancelled";
  dates: WireDates;
  identity: HqWireMemberLink;
  financials: WireFinancials;
  products: WireProduct[];
  payments: WireObject[];
  ppsLinks: WireObject[];
  paymentSummary: WireObject;
  eligibility: WireObject & {
    activeSalesHeadline: boolean;
    pending: boolean;
    cancelled: boolean;
    undated: boolean;
  };
  childrenComplete: true;
  snapshotConsistency: "repeatable_read_per_source_page_not_run_wide";
};
export type HqWireBusinessPayload = WireObject & {
  orbitTenantId: number;
  isActive: boolean;
  account: WireObject;
  identity: HqWireMemberLink;
  configuredCardFeeRates: WireObject;
  membershipHistoryAvailable: false;
  portalMembershipJoinDate: null;
};
type WireTombstone = WireObject & {
  deleted: true;
  reason: "source_absent_or_now_explicit_demo";
  entityType: "booking" | "business";
  entityId: number;
};
export type HqWireEntity = WireObject &
  (
    | {
        entityType: "booking";
        entityId: number;
        revision: number;
        payload: HqWireBookingPayload | WireTombstone;
      }
    | {
        entityType: "business";
        entityId: number;
        revision: number;
        payload: HqWireBusinessPayload | WireTombstone;
      }
  );
export type HqWireChange = HqWireEntity & {
  seq: number;
  operation: "upsert" | "delete";
};
export type HqWireMetadata = WireObject & {
  generationId: number;
  projectionVersion: "1.0.0";
  scope: "company_all_real_and_unattributed";
  sourceObservationWindow: WireObject & { from: string; to: string };
  publishedAt: string;
  expiresAt: string;
  changeUpper: number;
  sourceAgeSeconds: number;
  freshnessTargetSeconds: 900;
  stale: boolean;
  consistency: "sealed_reporting_generation_with_per_page_source_snapshot";
  counts: WireObject;
};
type WirePage<T> = HqWireMetadata & {
  entityType: "booking" | "business" | "mixed";
  items: T[];
  nextCursor: string | null;
  resumeCursor: string;
  complete: boolean;
  checkpointInstructions: string;
};
export type HqWireBookingPage = WirePage<HqWireEntity>;
export type HqWireBusinessPage = WirePage<HqWireEntity>;
export type HqWireChangePage = WirePage<HqWireChange>;
export type HqWireCataloguePage = WirePage<
  WireObject & {
    entityType: "booking" | "business";
    entityId: number;
    revision: number;
  }
>;
export type HqWireStatus = HqWireMetadata & { ready: true };
export type HqWireCapabilities = WireObject & {
  apiVersion: "1.0.0";
  endpoints: string[];
  quotes: false;
  sourceWrites: false;
  providerCalls: false;
};
export interface HqWirePageQuery {
  cursor?: string;
  generationId?: number;
  limit?: number;
}
export interface HqWireReader {
  bookings(query?: HqWirePageQuery): Promise<HqWireBookingPage>;
  businessMappings(query?: HqWirePageQuery): Promise<HqWireBusinessPage>;
  catalogue(
    entityType: "booking" | "business",
    query?: HqWirePageQuery
  ): Promise<HqWireCataloguePage>;
  changes(cursor: string, limit?: number): Promise<HqWireChangePage>;
  status(): Promise<HqWireStatus>;
  capabilities(): Promise<HqWireCapabilities>;
}
