import type {
  HqWireBookingPayload,
  HqWireEntity,
  HqWireMemberLink,
  HqWireMetadata,
  HqWirePageQuery,
  HqWireReader,
} from "../shared/management-hq-wire";
import { canonicalHqJson } from "./management-hq-engine";
import {
  HQ_WIRE_MAX_TEXT_LENGTH,
  validateHqWireBookingPage,
  validateHqWireBusinessPage,
  validateHqWireCataloguePage,
  validateHqWireChangePage,
  validateHqWireStatus,
  validateHqWireCapabilities,
} from "./management-hq-wire-contract";

export interface HqLargeSyntheticReaderOptions {
  bookingCount?: number;
  /** Total ASCII diagnostic content per booking, split into <=4096-byte strings. */
  paddingBytes?: number;
  generationId?: number;
}
export const HQ_LARGE_SYNTHETIC_DEFAULTS = {
  bookingCount: 1200,
  paddingBytes: 8000,
  generationId: 700000001,
} as const;
const BOOKING_ID_BASE = 810000000;
const BUSINESS_ID_BASE = 820000000;
const USER_ID_BASE = 830000000;
const PRODUCT_ID_BASE = 840000000;
const SUPPLIER_ID = 850000001;
const PAGE_SIZE = 100;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function queryError(expired = false): never {
  throw Object.assign(new Error("Invalid offline synthetic HQ traversal"), {
    code: expired ? "RESTART_REQUIRED" : "INVALID_QUERY",
    status: expired ? 410 : 400,
  });
}
function resolvedOptions(options: HqLargeSyntheticReaderOptions = {}) {
  const result = {
    bookingCount:
      options.bookingCount === undefined
        ? HQ_LARGE_SYNTHETIC_DEFAULTS.bookingCount
        : options.bookingCount,
    paddingBytes:
      options.paddingBytes === undefined
        ? HQ_LARGE_SYNTHETIC_DEFAULTS.paddingBytes
        : options.paddingBytes,
    generationId:
      options.generationId === undefined
        ? HQ_LARGE_SYNTHETIC_DEFAULTS.generationId
        : options.generationId,
  };
  // Padding is intentionally bounded below the EXISTING 4 MiB wire page cap.
  if (
    !Number.isSafeInteger(result.bookingCount) ||
    result.bookingCount < 0 ||
    result.bookingCount > 100000 ||
    !Number.isSafeInteger(result.paddingBytes) ||
    result.paddingBytes < 0 ||
    result.paddingBytes > 24 * 1024 ||
    !Number.isSafeInteger(result.generationId) ||
    result.generationId < 1
  )
    throw new Error("Invalid offline synthetic HQ fixture options");
  return result;
}
function validateLimit(limit = PAGE_SIZE) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_SIZE)
    queryError();
  return limit;
}
function memberLink(businessIndex: number): HqWireMemberLink {
  const tenantId = BUSINESS_ID_BASE + businessIndex + 1;
  const ownerId = USER_ID_BASE + businessIndex * 2 + 1;
  const staffId = ownerId + 1;
  const ownerAgent = `SYN-L-OWNER-${businessIndex + 1}`;
  const staffAgent = `SYN-L-STAFF-${businessIndex + 1}`;
  const ownerOpen = `synthetic-large-owner-${businessIndex + 1}`;
  const staffOpen = `synthetic-large-staff-${businessIndex + 1}`;
  const owner = {
    id: ownerId,
    tenantId,
    role: "owner",
    isActive: true,
    jltAgentId: ownerAgent,
    jltOpenId: ownerOpen,
  };
  return {
    orbitTenantId: tenantId,
    mappingState: "existing_owner_link",
    status: "candidate",
    reason: "single_owner_with_agent_id",
    sourceOnly: true,
    portalVerified: false,
    historicalSellingRelationshipVerified: false,
    attributionBasis: "current_owning_tenant_and_current_membership",
    ownerTenantUserId: ownerId,
    memberJltAgentId: ownerAgent,
    memberJltOpenId: ownerOpen,
    ownerCandidates: [copy(owner)],
    members: [
      owner,
      {
        id: staffId,
        tenantId,
        role: "staff",
        isActive: true,
        jltAgentId: staffAgent,
        jltOpenId: staffOpen,
      },
    ],
    assignedStaff: {
      orbitTenantUserId: staffId,
      status: "current_member",
      jltAgentId: staffAgent,
      jltOpenId: staffOpen,
      role: "staff",
      isActive: true,
      sourceOnly: true,
      portalVerified: false,
    },
  };
}

/** Entirely invented fixture, not derived production data or observed HTTP.
 * No DB, environment, network, clocks, app wiring or writes. Defaults exceed
 * 16 MiB in the legacy entity+canonicalPayload container, not in any wire page.
 * Cursors are deliberately unsigned FIXTURE tokens, never real source tokens.
 * Recreating a reader with identical options supports deterministic offline resume;
 * different options require a fresh traversal. Only same-checkpoint catchup exists.
 * Booking pattern: confirmed, registered pending, unregistered pending, cancelled,
 * confirmed (repeat). Source activeSalesHeadline stays confirmed-only; registered
 * pending has nested registration and financial headlineEligible=true, so the
 * existing Portal correction counts its gross without inventing earned income.
 */
export function createHqLargeSyntheticReader(
  options: HqLargeSyntheticReaderOptions = {}
): HqWireReader {
  const { bookingCount, paddingBytes, generationId } = resolvedOptions(options);
  const businessCount = Math.min(3, bookingCount);
  const prefix = `hq-large-synthetic-v1.g${generationId}.n${bookingCount}.p${paddingBytes}`;
  const resumeCursor = `${prefix}.checkpoint`;
  const padding: string[] = [];
  for (let remaining = paddingBytes; remaining > 0; ) {
    const size = Math.min(remaining, HQ_WIRE_MAX_TEXT_LENGTH);
    padding.push("S".repeat(size));
    remaining -= size;
  }
  const metadata: HqWireMetadata = {
    generationId,
    projectionVersion: "1.0.0",
    scope: "company_all_real_and_unattributed",
    sourceObservationWindow: {
      from: "2026-03-01T11:59:59.000Z",
      to: "2026-03-01T12:00:00.000Z",
    },
    publishedAt: "2026-03-01T12:00:00.000Z",
    expiresAt: "2099-03-02T12:00:00.000Z",
    changeUpper: bookingCount + businessCount,
    sourceAgeSeconds: 0,
    freshnessTargetSeconds: 900,
    stale: false,
    consistency: "sealed_reporting_generation_with_per_page_source_snapshot",
    counts: { bookingCount, businessCount },
  };
  function booking(index: number): HqWireEntity {
    const identity = memberLink(index % businessCount);
    const pattern = index % 5;
    const status =
      pattern === 1 || pattern === 2
        ? "pending"
        : pattern === 3
          ? "cancelled"
          : "confirmed";
    const confirmed = status === "confirmed";
    const registeredPending = pattern === 1;
    const portalRegisteredAt = registeredPending
      ? "2026-02-03T09:00:00.000Z"
      : null;
    const managementDate = registeredPending ? "2026-02-03" : "2026-01-10";
    const excludedReasons =
      status === "cancelled"
        ? ["cancelled_booking_excluded"]
        : status === "pending"
          ? ["pending_booking_excluded"]
          : [];
    const payload: HqWireBookingPayload = {
      orbitBookingId: BOOKING_ID_BASE + index + 1,
      orbitTenantId: identity.orbitTenantId,
      assignedTenantUserId: identity.assignedStaff.orbitTenantUserId,
      bookingRef: `SYNTHETIC-LARGE-${index + 1}`,
      status,
      travelers: 2,
      packageType: "hotel",
      bookingTotal: "1200.00",
      dates: {
        portalRegisteredAt,
        bookedOn: "2026-01-10",
        managementDate,
        dateSource: registeredPending ? "portal_registered_at" : "booked_on",
        month: managementDate.slice(0, 7),
        timezone: "Europe/London",
        issues: [],
      },
      identity,
      financials: {
        version: "management_hq_financials_v1",
        currency: "GBP",
        bookingStatus: status,
        cancelled: status === "cancelled",
        headlineEligible: status !== "cancelled",
        economicProfitEligible: confirmed,
        grossBookingValue: 1200,
        totalNetCost: 900,
        netCostSubtotal: 900,
        netCostStatus: "complete",
        grossBookingProfit: confirmed ? 300 : null,
        grossMarginPct: confirmed ? 25 : null,
        weightedMarginContribution: {
          profitPence: confirmed ? 30000 : null,
          coveredGrossPence: confirmed ? 120000 : null,
          methodology:
            "sum_profit_pence_divided_by_matching_sum_covered_gross_pence_times_100",
        },
        vatDeduction: confirmed ? 50 : null,
        vatStatus: confirmed ? "computed_not_paid" : "incomplete",
        estimatedPtsFees: confirmed ? 10 : null,
        actualPtsFees: null,
        estimatedCardProcessingFees: null,
        knownPpsFeeEstimateSubtotal: null,
        actualCardProcessingFees: null,
        netDistributableCommission: null,
        agentCommission: null,
        jltRetainedCommission: null,
        retainedCancellationIncome: null,
        settledJltIncome: null,
        baselineEstimate: {
          status: confirmed ? "estimated" : "excluded",
          financials: confirmed
            ? {
                netDistributableCommission: 240,
                agentExpectedCommission: 192,
                jltRetainedCommission: 48,
              }
            : null,
          cardProcessingFeesIncluded: false,
          otherDeductionsIncluded: false,
          agentSplitPct: 80,
          jltSplitPct: 20,
          reasons: copy(excludedReasons),
        },
        completeness: {
          status: "partial",
          economicsStatus: confirmed ? "complete" : "excluded",
          strictSourceComplete: true,
          policyStatus: "incomplete",
          economicsReasons: copy(excludedReasons),
          policyReasons: [
            "actual_pts_charge_evidence_unverified",
            "actual_or_applicable_card_processing_fee_evidence_unverified",
            "commission_terms_unverified_default",
          ],
        },
      },
      products: [
        {
          id: PRODUCT_ID_BASE + index + 1,
          productType: "hotel",
          supplierName: "Synthetic Large Fixture Supplier",
          supplierId: SUPPLIER_ID,
          price: "1200.00",
          netPrice: "900.00",
          bookingStatus: status,
          vatApplicable: true,
          vatOverride: null,
          isReimbursement: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      payments: [],
      ppsLinks: [],
      paymentSummary: { count: 0, amountMinor: 0, basis: "synthetic_ledger" },
      eligibility: {
        activeSalesHeadline: confirmed,
        pending: status === "pending",
        cancelled: status === "cancelled",
        undated: false,
      },
      childrenComplete: true,
      snapshotConsistency: "repeatable_read_per_source_page_not_run_wide",
      ...(paddingBytes > 0
        ? { syntheticDiagnostics: { padding: [...padding] } }
        : {}),
    };
    return {
      entityType: "booking",
      entityId: payload.orbitBookingId,
      revision: index + 1,
      payload,
    };
  }
  function business(index: number): HqWireEntity {
    const identity = memberLink(index);
    return {
      entityType: "business",
      entityId: BUSINESS_ID_BASE + index + 1,
      revision: bookingCount + index + 1,
      payload: {
        orbitTenantId: BUSINESS_ID_BASE + index + 1,
        isActive: true,
        account: {
          businessName: `Synthetic Large Fixture Business ${index + 1}`,
          accountType: "real",
        },
        identity,
        configuredCardFeeRates: {},
        membershipHistoryAvailable: false,
        portalMembershipJoinDate: null,
      },
    };
  }
  function range(endpoint: string, count: number, query?: HqWirePageQuery) {
    let start = 0;
    if (query !== undefined) {
      if (
        !query ||
        Object.getPrototypeOf(query) !== Object.prototype ||
        Object.getOwnPropertySymbols(query).length ||
        Object.keys(query).some(
          key => !["cursor", "generationId", "limit"].includes(key)
        )
      )
        queryError();
      if (query.cursor !== undefined && query.generationId !== undefined)
        queryError();
      if (query.generationId !== undefined) {
        if (!Number.isSafeInteger(query.generationId) || query.generationId < 1)
          queryError();
        if (query.generationId !== generationId) queryError(true);
      }
      if (query.cursor !== undefined) {
        const cursor = query.cursor;
        if (
          typeof cursor !== "string" ||
          !cursor.length ||
          cursor.length > 2048 ||
          /[\u0000-\u001f\u007f]/.test(cursor)
        )
          queryError();
        if (!cursor.startsWith(`${prefix}.`)) queryError(true);
        const beginning = `${prefix}.${endpoint}.offset-`;
        if (!cursor.startsWith(beginning)) queryError();
        const offset = cursor.slice(beginning.length);
        if (!/^[1-9][0-9]*$/.test(offset)) queryError();
        start = Number(offset);
        if (!Number.isSafeInteger(start) || start >= count) queryError();
      }
    }
    const end = Math.min(count, start + validateLimit(query?.limit));
    return {
      start,
      end,
      nextCursor: end < count ? `${prefix}.${endpoint}.offset-${end}` : null,
    };
  }
  function pageFields(
    entityType: "booking" | "business" | "mixed",
    nextCursor: string | null
  ) {
    return {
      ...copy(metadata),
      entityType,
      nextCursor,
      resumeCursor,
      complete: nextCursor === null,
      checkpointInstructions:
        "Offline synthetic checkpoint: persist only after both feeds and both catalogues are completely applied.",
    };
  }
  return {
    async status() {
      return validateHqWireStatus({ ...copy(metadata), ready: true });
    },
    async capabilities() {
      return validateHqWireCapabilities({
        apiVersion: "1.0.0",
        endpoints: [
          "/bookings",
          "/business-mappings",
          "/catalogue",
          "/changes",
          "/status",
          "/capabilities",
        ],
        quotes: false,
        sourceWrites: false,
        providerCalls: false,
      });
    },
    async bookings(query) {
      const { start, end, nextCursor } = range("bookings", bookingCount, query);
      return validateHqWireBookingPage({
        ...pageFields("booking", nextCursor),
        items: Array.from({ length: end - start }, (_, i) =>
          booking(start + i)
        ),
      });
    },
    async businessMappings(query) {
      const { start, end, nextCursor } = range(
        "business",
        businessCount,
        query
      );
      return validateHqWireBusinessPage({
        ...pageFields("business", nextCursor),
        items: Array.from({ length: end - start }, (_, i) =>
          business(start + i)
        ),
      });
    },
    async catalogue(entityType, query) {
      if (entityType !== "booking" && entityType !== "business") queryError();
      const isBooking = entityType === "booking";
      const { start, end, nextCursor } = range(
        `catalogue-${entityType}`,
        isBooking ? bookingCount : businessCount,
        query
      );
      return validateHqWireCataloguePage({
        ...pageFields(entityType, nextCursor),
        items: Array.from({ length: end - start }, (_, i) => ({
          entityType,
          entityId:
            (isBooking ? BOOKING_ID_BASE : BUSINESS_ID_BASE) + start + i + 1,
          revision: (isBooking ? 0 : bookingCount) + start + i + 1,
        })),
      });
    },
    async changes(cursor, limit) {
      validateLimit(limit);
      if (cursor !== resumeCursor) queryError(true);
      return validateHqWireChangePage({
        ...pageFields("mixed", null),
        items: [],
      });
    },
  };
}

/** Measures an as-if fully published LEGACY JSON container without assembling
 * its entity map or running ingestion/storage. Memory is bounded to one page.
 * Byte count includes the existing full entity plus escaped canonicalPayload;
 * it is a sizing diagnostic, not an attempt to bypass or increase any cap.
 */
export async function getHqLargeSyntheticFixtureSizing(
  options: HqLargeSyntheticReaderOptions = {}
) {
  const resolved = resolvedOptions(options);
  const reader = createHqLargeSyntheticReader(resolved);
  const { ready: _ready, ...metadata } = await reader.status();
  let resumeCursor = "";
  let entityMapContentBytes = 0,
    entityCount = 0,
    maxBookingPageBytes = 0;
  for (const read of [reader.bookings, reader.businessMappings]) {
    let query: HqWirePageQuery = { generationId: resolved.generationId };
    do {
      const page = await read(query);
      resumeCursor = page.resumeCursor;
      if (page.entityType === "booking")
        maxBookingPageBytes = Math.max(
          maxBookingPageBytes,
          Buffer.byteLength(JSON.stringify(page))
        );
      for (const entity of page.items) {
        const entry = {
          entity,
          canonicalPayload: canonicalHqJson(entity),
          absent: false,
        };
        entityMapContentBytes +=
          Buffer.byteLength(
            JSON.stringify(`${entity.entityType}:${entity.entityId}`)
          ) +
          1 +
          Buffer.byteLength(JSON.stringify(entry)) +
          Number(entityCount++ > 0);
      }
      if (page.nextCursor === null) break;
      query = { cursor: page.nextCursor };
    } while (true);
  }
  const businessCount = Math.min(3, resolved.bookingCount);
  const bookingPages = Math.max(
    1,
    Math.ceil(resolved.bookingCount / PAGE_SIZE)
  );
  const businessPages = Math.max(1, Math.ceil(businessCount / PAGE_SIZE));
  const emptyContainer = {
    version: 2 * (bookingPages + businessPages) + 1,
    published: {
      wireVersion: "1.0.0",
      version: 1,
      scope: metadata.scope,
      resumeCursor,
      metadata,
      entities: {},
      seqProofs: {},
    },
    stage: null,
  };
  return {
    ...resolved,
    businessCount,
    bookingPages,
    totalDiagnosticBytes: resolved.bookingCount * resolved.paddingBytes,
    legacyDiagnosticBytesLowerBound:
      2 * resolved.bookingCount * resolved.paddingBytes,
    maxBookingPageBytes,
    legacyPublishedContainerBytes:
      Buffer.byteLength(JSON.stringify(emptyContainer)) + entityMapContentBytes,
  };
}
