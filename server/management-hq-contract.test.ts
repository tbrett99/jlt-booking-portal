import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  HQ_CONTRACT_VERSION,
  type HqBookingPage,
  type HqChangePage,
} from "../shared/management-hq-types";
import { HQ_CONTRACT_SCHEMAS } from "./management-hq-schemas";
import {
  HqContractError,
  HQ_MAX_PAYLOAD_BYTES,
  validateHqBookingPage,
  validateHqChangePage,
  validateHqDeclaredSchema,
  type HqSchemaName,
} from "./management-hq-contract";

// Verbatim synthetic examples from the supplied proposed OpenAPI contract.
// Any namespace literal below is a proposed sample only, not an approved mapping.
const SUPPLIED_EXAMPLES = {
  CurrentJanuaryValueAmendedTo6000: {
    contractVersion: "1.0.0-proposed",
    dataset: "bookings",
    snapshotId: "illustrative-generation-002",
    watermark: "illustrative-publication-watermark-002",
    projectionPublishedAt: "2026-11-22T10:45:00Z",
    sourceObservationStartedAt: "2026-11-22T10:35:00Z",
    sourceObservationCompletedAt: "2026-11-22T10:44:00Z",
    dateRuleVersion: "management-current-v1",
    statusRuleVersion: "confirmed-only-proposed-v1",
    financialPolicyVersion: "v1-source-adapter-approval-pending",
    scopeId: "illustrative-approved-real-business-scope",
    coverage: {
      status: "unverified",
      requestedFrom: "2026-01-01",
      verifiedFrom: null,
      verifiedThrough: null,
      population: "Synthetic fixtures only, no live history verified",
      undatedCount: null,
      unmatchedBusinessCount: null,
      limitations: [
        "No deployed API",
        "Synthetic values are not actual Orbit records",
      ],
    },
    nextCursor: null,
    hasMore: false,
    records: [
      {
        id: "9000001",
        bookingRef: "SAMPLE-ONLY-001",
        revision: "2",
        contentHash: "illustrative-hash-not-a-live-hash",
        sourceUpdatedAt: "2026-11-22T10:30:00Z",
        sourceObservedAt: "2026-11-22T10:40:00Z",
        status: "confirmed",
        dates: {
          portalRegisteredAt: "2026-01-10T12:00:00Z",
          bookedOnRaw: "2026-01-08",
          bookedOn: "2026-01-08",
          managementReportingDate: "2026-01-10",
          dateSource: "portal_registered_at",
          dateRuleVersion: "management-current-v1",
          warnings: [],
        },
        eligibility: {
          headlineCount: true,
          headlineGrossSales: true,
          cancelledCohort: false,
          pendingCohort: false,
          dated: true,
          statusRuleVersion: "confirmed-only-proposed-v1",
          reason: null,
        },
        currency: "GBP",
        currencyBasis: "validated_GBP",
        passengerCount: 3,
        bookingType: "hotel",
        currentOwningBusiness: {
          orbitTenantId: "9001001",
          name: "Illustrative Agency \u2014 no real records",
          accountType: "real",
          active: true,
          portalBusinessId: null,
          mappingStatus: "unmatched",
          mappingRevision: null,
          mappingSource: null,
        },
        originalSellingBusiness: {
          namespace: null,
          id: null,
          state: "missing",
          source: null,
        },
        originalSellingAgent: {
          namespace: null,
          id: null,
          state: "missing",
          source: null,
        },
        assignedUser: {
          namespace: "orbit.tenant_user",
          id: "9002001",
          state: "current_assignment",
          source: "bookings.assignedTenantUserId; illustrative",
        },
        processingAdministrator: {
          namespace: null,
          id: null,
          state: "missing",
          source: null,
        },
        financials: {
          grossBookingValue: {
            amount: "6000.00",
            currency: "GBP",
            state: "source_recorded",
            source: "bookings.bookingTotal; synthetic input",
            reason: null,
            evidenceIds: [],
          },
          supplierNetCost: {
            amount: "5400.00",
            currency: "GBP",
            state: "calculated",
            source: "Complete active product net; synthetic input",
            reason: null,
            evidenceIds: [],
          },
          knownSupplierNetSubtotal: {
            amount: "5400.00",
            currency: "GBP",
            state: "calculated",
            source: "Complete active product net; synthetic input",
            reason: null,
            evidenceIds: [],
          },
          grossBookingProfit: {
            amount: "600.00",
            currency: "GBP",
            state: "calculated",
            source: "Gross minus complete net; fixture arithmetic only",
            reason: null,
            evidenceIds: [],
          },
          grossBookingMargin: {
            fraction: "0.1",
            state: "calculated",
            denominator:
              "Same covered current customer gross, before deductions",
          },
          applicableVat: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason:
              "Synthetic example does not execute existing supplier VAT policy",
            evidenceIds: [],
          },
          legacyBookingVatOverride: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason: "Legacy field not an effective current VAT deduction",
            evidenceIds: [],
          },
          ptsFees: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason:
              "Actual tariff helper inputs not exercised by illustrative example",
            evidenceIds: [],
          },
          ptsFeeBasis: "existing_calculatePtsFees_estimate",
          ptsAssumptions: [
            "Expose existing payment/group/protection assumptions; not actual charged PTS fees",
          ],
          actualCardProcessingFees: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason:
              "No verified typed actual fee source mapped at reviewed HEAD",
            evidenceIds: [],
          },
          estimatedCardProcessingFees: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason:
              "Requires classified eligible paid PPS link and validated configured rate",
            evidenceIds: [],
          },
          otherDeductions: null,
          orbitCommissionBaseline: {
            basis: "orbit_vat_pts_estimate",
            complete: false,
            cardProcessingFeesIncluded: false,
            vatIncluded: true,
            ptsIncluded: true,
            netDistributableCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason:
                "Illustrative example does not execute the existing helper or establish all inputs",
              evidenceIds: [],
            },
            agentCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Incomplete inputs or applicable terms",
              evidenceIds: [],
            },
            jltRetainedCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Incomplete inputs or applicable terms",
              evidenceIds: [],
            },
            terms: {
              agentFraction: "0.80",
              jltFraction: "0.20",
              state: "stated_default_unverified",
              source:
                "Updated user instructions; applicable custom terms not mapped",
            },
            roundingBasis:
              "Preserve existing unrounded deduction/split then money rounding; expose any residual",
            roundingResidual: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Not calculated",
              evidenceIds: [],
            },
            limitations: [
              "Synthetic fixture only",
              "Existing baseline excludes PPS merchant fees; full policy needs mapped applicable deductions",
            ],
          },
          policyCompleteCommission: {
            basis: "approved_all_applicable_deductions_pending",
            complete: false,
            cardProcessingFeesIncluded: false,
            vatIncluded: true,
            ptsIncluded: true,
            netDistributableCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason:
                "Illustrative example does not execute the existing helper or establish all inputs",
              evidenceIds: [],
            },
            agentCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Incomplete inputs or applicable terms",
              evidenceIds: [],
            },
            jltRetainedCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Incomplete inputs or applicable terms",
              evidenceIds: [],
            },
            terms: {
              agentFraction: "0.80",
              jltFraction: "0.20",
              state: "stated_default_unverified",
              source:
                "Updated user instructions; applicable custom terms not mapped",
            },
            roundingBasis:
              "Preserve existing unrounded deduction/split then money rounding; expose any residual",
            roundingResidual: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Not calculated",
              evidenceIds: [],
            },
            limitations: [
              "Synthetic fixture only",
              "Existing baseline excludes PPS merchant fees; full policy needs mapped applicable deductions",
            ],
          },
          settledJltIncome: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason: "No reconciliation evidence",
            evidenceIds: [],
          },
          cancellationCharges: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason: "No evidenced cancellation charges",
            evidenceIds: [],
          },
          cancellationRetainedCommission: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason: "No evidenced retained cancellation commission",
            evidenceIds: [],
          },
          completeGrossAndCost: true,
          completeApprovedDeductions: false,
          policyVersion: "v1-source-adapter-approval-pending",
          warnings: [
            "Actual card fees and terms unresolved",
            "Do not replace unknown deductions with zero",
          ],
        },
        products: [
          {
            id: "9003001",
            productType: "hotel",
            rawBookingStatus: "confirmed",
            financialActive: true,
            supplierId: null,
            supplierName: "Illustrative Supplier",
            grossValue: {
              amount: "6000.00",
              currency: "GBP",
              state: "source_recorded",
              source: "booking_products.price; synthetic input",
              reason: null,
              evidenceIds: [],
            },
            netCost: {
              amount: "5400.00",
              currency: "GBP",
              state: "source_recorded",
              source: "booking_products.netPrice; synthetic input",
              reason: null,
              evidenceIds: [],
            },
            allocationBasis: "Single product; no passenger multiplier",
            vatApplicable: null,
            vatOverride: null,
            isReimbursement: false,
            sourceUpdatedAt: "2026-11-22T10:30:00Z",
          },
        ],
        payments: [],
        childMembershipComplete: true,
        qualityIssues: [
          "PORTAL_BUSINESS_UNMATCHED",
          "ACTUAL_CARD_FEE_SOURCE_UNMAPPED",
        ],
      },
    ],
  },
  StoredBookedDateFallback: {
    contractVersion: "1.0.0-proposed",
    dataset: "bookings",
    snapshotId: "illustrative-generation-002",
    watermark: "illustrative-publication-watermark-002",
    projectionPublishedAt: "2026-11-22T10:45:00Z",
    sourceObservationStartedAt: "2026-11-22T10:35:00Z",
    sourceObservationCompletedAt: "2026-11-22T10:44:00Z",
    dateRuleVersion: "management-current-v1",
    statusRuleVersion: "confirmed-only-proposed-v1",
    financialPolicyVersion: "v1-source-adapter-approval-pending",
    scopeId: "illustrative-approved-real-business-scope",
    coverage: {
      status: "unverified",
      requestedFrom: "2026-01-01",
      verifiedFrom: null,
      verifiedThrough: null,
      population: "Synthetic fixtures only, no live history verified",
      undatedCount: null,
      unmatchedBusinessCount: null,
      limitations: [
        "No deployed API",
        "Synthetic values are not actual Orbit records",
      ],
    },
    nextCursor: null,
    hasMore: false,
    records: [
      {
        id: "9000002",
        bookingRef: "SAMPLE-ONLY-002",
        revision: "2",
        contentHash: "illustrative-hash-not-a-live-hash",
        sourceUpdatedAt: "2026-11-22T10:30:00Z",
        sourceObservedAt: "2026-11-22T10:40:00Z",
        status: "confirmed",
        dates: {
          portalRegisteredAt: null,
          bookedOnRaw: "2026-01-08",
          bookedOn: "2026-01-08",
          managementReportingDate: "2026-01-08",
          dateSource: "booked_on",
          dateRuleVersion: "management-current-v1",
          warnings: ["BOOKED_DATE_FALLBACK"],
        },
        eligibility: {
          headlineCount: true,
          headlineGrossSales: true,
          cancelledCohort: false,
          pendingCohort: false,
          dated: true,
          statusRuleVersion: "confirmed-only-proposed-v1",
          reason: null,
        },
        currency: "GBP",
        currencyBasis: "validated_GBP",
        passengerCount: 3,
        bookingType: "hotel",
        currentOwningBusiness: {
          orbitTenantId: "9001001",
          name: "Illustrative Agency \u2014 no real records",
          accountType: "real",
          active: true,
          portalBusinessId: null,
          mappingStatus: "unmatched",
          mappingRevision: null,
          mappingSource: null,
        },
        originalSellingBusiness: {
          namespace: null,
          id: null,
          state: "missing",
          source: null,
        },
        originalSellingAgent: {
          namespace: null,
          id: null,
          state: "missing",
          source: null,
        },
        assignedUser: {
          namespace: "orbit.tenant_user",
          id: "9002001",
          state: "current_assignment",
          source: "bookings.assignedTenantUserId; illustrative",
        },
        processingAdministrator: {
          namespace: null,
          id: null,
          state: "missing",
          source: null,
        },
        financials: {
          grossBookingValue: {
            amount: "6000.00",
            currency: "GBP",
            state: "source_recorded",
            source: "bookings.bookingTotal; synthetic input",
            reason: null,
            evidenceIds: [],
          },
          supplierNetCost: {
            amount: "5400.00",
            currency: "GBP",
            state: "calculated",
            source: "Complete active product net; synthetic input",
            reason: null,
            evidenceIds: [],
          },
          knownSupplierNetSubtotal: {
            amount: "5400.00",
            currency: "GBP",
            state: "calculated",
            source: "Complete active product net; synthetic input",
            reason: null,
            evidenceIds: [],
          },
          grossBookingProfit: {
            amount: "600.00",
            currency: "GBP",
            state: "calculated",
            source: "Gross minus complete net; fixture arithmetic only",
            reason: null,
            evidenceIds: [],
          },
          grossBookingMargin: {
            fraction: "0.1",
            state: "calculated",
            denominator:
              "Same covered current customer gross, before deductions",
          },
          applicableVat: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason:
              "Synthetic example does not execute existing supplier VAT policy",
            evidenceIds: [],
          },
          legacyBookingVatOverride: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason: "Legacy field not an effective current VAT deduction",
            evidenceIds: [],
          },
          ptsFees: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason:
              "Actual tariff helper inputs not exercised by illustrative example",
            evidenceIds: [],
          },
          ptsFeeBasis: "existing_calculatePtsFees_estimate",
          ptsAssumptions: [
            "Expose existing payment/group/protection assumptions; not actual charged PTS fees",
          ],
          actualCardProcessingFees: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason:
              "No verified typed actual fee source mapped at reviewed HEAD",
            evidenceIds: [],
          },
          estimatedCardProcessingFees: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason:
              "Requires classified eligible paid PPS link and validated configured rate",
            evidenceIds: [],
          },
          otherDeductions: null,
          orbitCommissionBaseline: {
            basis: "orbit_vat_pts_estimate",
            complete: false,
            cardProcessingFeesIncluded: false,
            vatIncluded: true,
            ptsIncluded: true,
            netDistributableCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason:
                "Illustrative example does not execute the existing helper or establish all inputs",
              evidenceIds: [],
            },
            agentCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Incomplete inputs or applicable terms",
              evidenceIds: [],
            },
            jltRetainedCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Incomplete inputs or applicable terms",
              evidenceIds: [],
            },
            terms: {
              agentFraction: "0.80",
              jltFraction: "0.20",
              state: "stated_default_unverified",
              source:
                "Updated user instructions; applicable custom terms not mapped",
            },
            roundingBasis:
              "Preserve existing unrounded deduction/split then money rounding; expose any residual",
            roundingResidual: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Not calculated",
              evidenceIds: [],
            },
            limitations: [
              "Synthetic fixture only",
              "Existing baseline excludes PPS merchant fees; full policy needs mapped applicable deductions",
            ],
          },
          policyCompleteCommission: {
            basis: "approved_all_applicable_deductions_pending",
            complete: false,
            cardProcessingFeesIncluded: false,
            vatIncluded: true,
            ptsIncluded: true,
            netDistributableCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason:
                "Illustrative example does not execute the existing helper or establish all inputs",
              evidenceIds: [],
            },
            agentCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Incomplete inputs or applicable terms",
              evidenceIds: [],
            },
            jltRetainedCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Incomplete inputs or applicable terms",
              evidenceIds: [],
            },
            terms: {
              agentFraction: "0.80",
              jltFraction: "0.20",
              state: "stated_default_unverified",
              source:
                "Updated user instructions; applicable custom terms not mapped",
            },
            roundingBasis:
              "Preserve existing unrounded deduction/split then money rounding; expose any residual",
            roundingResidual: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Not calculated",
              evidenceIds: [],
            },
            limitations: [
              "Synthetic fixture only",
              "Existing baseline excludes PPS merchant fees; full policy needs mapped applicable deductions",
            ],
          },
          settledJltIncome: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason: "No reconciliation evidence",
            evidenceIds: [],
          },
          cancellationCharges: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason: "No evidenced cancellation charges",
            evidenceIds: [],
          },
          cancellationRetainedCommission: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason: "No evidenced retained cancellation commission",
            evidenceIds: [],
          },
          completeGrossAndCost: true,
          completeApprovedDeductions: false,
          policyVersion: "v1-source-adapter-approval-pending",
          warnings: [
            "Actual card fees and terms unresolved",
            "Do not replace unknown deductions with zero",
          ],
        },
        products: [
          {
            id: "9003001",
            productType: "hotel",
            rawBookingStatus: "confirmed",
            financialActive: true,
            supplierId: null,
            supplierName: "Illustrative Supplier",
            grossValue: {
              amount: "6000.00",
              currency: "GBP",
              state: "source_recorded",
              source: "booking_products.price; synthetic input",
              reason: null,
              evidenceIds: [],
            },
            netCost: {
              amount: "5400.00",
              currency: "GBP",
              state: "source_recorded",
              source: "booking_products.netPrice; synthetic input",
              reason: null,
              evidenceIds: [],
            },
            allocationBasis: "Single product; no passenger multiplier",
            vatApplicable: null,
            vatOverride: null,
            isReimbursement: false,
            sourceUpdatedAt: "2026-11-22T10:30:00Z",
          },
        ],
        payments: [],
        childMembershipComplete: true,
        qualityIssues: [
          "PORTAL_BUSINESS_UNMATCHED",
          "ACTUAL_CARD_FEE_SOURCE_UNMAPPED",
        ],
      },
    ],
  },
  CancelledRecordRetainedSeparately: {
    contractVersion: "1.0.0-proposed",
    dataset: "bookings",
    snapshotId: "illustrative-generation-002",
    watermark: "illustrative-publication-watermark-002",
    projectionPublishedAt: "2026-11-22T10:45:00Z",
    sourceObservationStartedAt: "2026-11-22T10:35:00Z",
    sourceObservationCompletedAt: "2026-11-22T10:44:00Z",
    dateRuleVersion: "management-current-v1",
    statusRuleVersion: "confirmed-only-proposed-v1",
    financialPolicyVersion: "v1-source-adapter-approval-pending",
    scopeId: "illustrative-approved-real-business-scope",
    coverage: {
      status: "unverified",
      requestedFrom: "2026-01-01",
      verifiedFrom: null,
      verifiedThrough: null,
      population: "Synthetic fixtures only, no live history verified",
      undatedCount: null,
      unmatchedBusinessCount: null,
      limitations: [
        "No deployed API",
        "Synthetic values are not actual Orbit records",
      ],
    },
    nextCursor: null,
    hasMore: false,
    records: [
      {
        id: "9000003",
        bookingRef: "SAMPLE-ONLY-003",
        revision: "2",
        contentHash: "illustrative-hash-not-a-live-hash",
        sourceUpdatedAt: "2026-11-22T10:30:00Z",
        sourceObservedAt: "2026-11-22T10:40:00Z",
        status: "cancelled",
        dates: {
          portalRegisteredAt: "2026-01-10T12:00:00Z",
          bookedOnRaw: "2026-01-08",
          bookedOn: "2026-01-08",
          managementReportingDate: "2026-01-10",
          dateSource: "portal_registered_at",
          dateRuleVersion: "management-current-v1",
          warnings: [],
        },
        eligibility: {
          headlineCount: false,
          headlineGrossSales: false,
          cancelledCohort: true,
          pendingCohort: false,
          dated: true,
          statusRuleVersion: "confirmed-only-proposed-v1",
          reason:
            "Currently cancelled; separate January current-cancelled cohort, not cancellation event flow",
        },
        currency: "GBP",
        currencyBasis: "validated_GBP",
        passengerCount: 3,
        bookingType: "hotel",
        currentOwningBusiness: {
          orbitTenantId: "9001001",
          name: "Illustrative Agency \u2014 no real records",
          accountType: "real",
          active: true,
          portalBusinessId: null,
          mappingStatus: "unmatched",
          mappingRevision: null,
          mappingSource: null,
        },
        originalSellingBusiness: {
          namespace: null,
          id: null,
          state: "missing",
          source: null,
        },
        originalSellingAgent: {
          namespace: null,
          id: null,
          state: "missing",
          source: null,
        },
        assignedUser: {
          namespace: "orbit.tenant_user",
          id: "9002001",
          state: "current_assignment",
          source: "bookings.assignedTenantUserId; illustrative",
        },
        processingAdministrator: {
          namespace: null,
          id: null,
          state: "missing",
          source: null,
        },
        financials: {
          grossBookingValue: {
            amount: "6000.00",
            currency: "GBP",
            state: "source_recorded",
            source: "bookings.bookingTotal; synthetic input",
            reason: null,
            evidenceIds: [],
          },
          supplierNetCost: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason:
              "Do not infer cancellation liabilities from retained original active product rows",
            evidenceIds: [],
          },
          knownSupplierNetSubtotal: {
            amount: "5400.00",
            currency: "GBP",
            state: "calculated",
            source: "Complete active product net; synthetic input",
            reason: null,
            evidenceIds: [],
          },
          grossBookingProfit: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason: "Cancelled booking excluded from active profit",
            evidenceIds: [],
          },
          grossBookingMargin: {
            fraction: null,
            state: "missing",
            denominator: "Cancelled excluded from active gross margin",
          },
          applicableVat: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason:
              "Synthetic example does not execute existing supplier VAT policy",
            evidenceIds: [],
          },
          legacyBookingVatOverride: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason: "Legacy field not an effective current VAT deduction",
            evidenceIds: [],
          },
          ptsFees: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason:
              "Actual tariff helper inputs not exercised by illustrative example",
            evidenceIds: [],
          },
          ptsFeeBasis: "existing_calculatePtsFees_estimate",
          ptsAssumptions: [
            "Expose existing payment/group/protection assumptions; not actual charged PTS fees",
          ],
          actualCardProcessingFees: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason:
              "No verified typed actual fee source mapped at reviewed HEAD",
            evidenceIds: [],
          },
          estimatedCardProcessingFees: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason:
              "Requires classified eligible paid PPS link and validated configured rate",
            evidenceIds: [],
          },
          otherDeductions: null,
          orbitCommissionBaseline: {
            basis: "orbit_vat_pts_estimate",
            complete: false,
            cardProcessingFeesIncluded: false,
            vatIncluded: true,
            ptsIncluded: true,
            netDistributableCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason:
                "Illustrative example does not execute the existing helper or establish all inputs",
              evidenceIds: [],
            },
            agentCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Incomplete inputs or applicable terms",
              evidenceIds: [],
            },
            jltRetainedCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Incomplete inputs or applicable terms",
              evidenceIds: [],
            },
            terms: {
              agentFraction: "0.80",
              jltFraction: "0.20",
              state: "stated_default_unverified",
              source:
                "Updated user instructions; applicable custom terms not mapped",
            },
            roundingBasis:
              "Preserve existing unrounded deduction/split then money rounding; expose any residual",
            roundingResidual: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Not calculated",
              evidenceIds: [],
            },
            limitations: [
              "Synthetic fixture only",
              "Existing baseline excludes PPS merchant fees; full policy needs mapped applicable deductions",
            ],
          },
          policyCompleteCommission: {
            basis: "approved_all_applicable_deductions_pending",
            complete: false,
            cardProcessingFeesIncluded: false,
            vatIncluded: true,
            ptsIncluded: true,
            netDistributableCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason:
                "Illustrative example does not execute the existing helper or establish all inputs",
              evidenceIds: [],
            },
            agentCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Incomplete inputs or applicable terms",
              evidenceIds: [],
            },
            jltRetainedCommission: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Incomplete inputs or applicable terms",
              evidenceIds: [],
            },
            terms: {
              agentFraction: "0.80",
              jltFraction: "0.20",
              state: "stated_default_unverified",
              source:
                "Updated user instructions; applicable custom terms not mapped",
            },
            roundingBasis:
              "Preserve existing unrounded deduction/split then money rounding; expose any residual",
            roundingResidual: {
              amount: null,
              currency: "GBP",
              state: "missing",
              source: null,
              reason: "Not calculated",
              evidenceIds: [],
            },
            limitations: [
              "Synthetic fixture only",
              "Existing baseline excludes PPS merchant fees; full policy needs mapped applicable deductions",
            ],
          },
          settledJltIncome: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason: "No reconciliation evidence",
            evidenceIds: [],
          },
          cancellationCharges: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason: "No evidenced cancellation charges",
            evidenceIds: [],
          },
          cancellationRetainedCommission: {
            amount: null,
            currency: "GBP",
            state: "missing",
            source: null,
            reason: "No evidenced retained cancellation commission",
            evidenceIds: [],
          },
          completeGrossAndCost: false,
          completeApprovedDeductions: false,
          policyVersion: "v1-source-adapter-approval-pending",
          warnings: [
            "Actual card fees and terms unresolved",
            "Do not replace unknown deductions with zero",
          ],
        },
        products: [
          {
            id: "9003001",
            productType: "hotel",
            rawBookingStatus: "confirmed",
            financialActive: false,
            supplierId: null,
            supplierName: "Illustrative Supplier",
            grossValue: {
              amount: "6000.00",
              currency: "GBP",
              state: "source_recorded",
              source: "booking_products.price; synthetic input",
              reason: null,
              evidenceIds: [],
            },
            netCost: {
              amount: "5400.00",
              currency: "GBP",
              state: "source_recorded",
              source: "booking_products.netPrice; synthetic input",
              reason: null,
              evidenceIds: [],
            },
            allocationBasis: "Single product; no passenger multiplier",
            vatApplicable: null,
            vatOverride: null,
            isReimbursement: false,
            sourceUpdatedAt: "2026-11-22T10:30:00Z",
          },
        ],
        payments: [],
        childMembershipComplete: true,
        qualityIssues: [
          "PORTAL_BUSINESS_UNMATCHED",
          "ACTUAL_CARD_FEE_SOURCE_UNMAPPED",
        ],
      },
    ],
  },
};

const fixture = (): HqBookingPage =>
  structuredClone(
    SUPPLIED_EXAMPLES.CurrentJanuaryValueAmendedTo6000
  ) as HqBookingPage;
function changed(): HqChangePage {
  const p = fixture();
  return {
    ...p,
    dataset: "changes",
    upperWatermark: "synthetic-upper-2",
    records: [
      {
        position: "synthetic-position-1",
        entityType: "booking",
        id: p.records[0].id,
        revision: p.records[0].revision,
        operation: "upsert",
        reason: "current_state_changed",
        observedAt: "2026-11-22T10:40:00Z",
        publishedAt: "2026-11-22T10:45:00Z",
        booking: p.records[0],
        mapping: null,
        quote: null,
      },
    ],
  };
}
function sample(schema: any, field = ""): any {
  if (schema.$ref)
    return sample(
      HQ_CONTRACT_SCHEMAS[schema.$ref.split("/").at(-1) as HqSchemaName],
      field
    );
  if (schema.allOf)
    return Object.assign({}, ...schema.allOf.map((s: any) => sample(s, field)));
  if (schema.anyOf) return sample(schema.anyOf.at(-1), field);
  if (schema.enum) return schema.enum[0];
  if (Array.isArray(schema.type))
    return schema.type.includes("null")
      ? null
      : sample({ ...schema, type: schema.type[0] }, field);
  if (schema.type === "object")
    return Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, sample(v, k)])
    );
  if (schema.type === "array") return [];
  if (schema.type === "integer") return 1;
  if (schema.type === "boolean") return false;
  if (schema.type === "null") return null;
  if (field === "contractVersion") return HQ_CONTRACT_VERSION;
  if (schema.format === "date") return "2026-01-10";
  if (schema.format === "date-time") return "2026-01-10T12:00:00Z";
  if (field === "currency") return "GBP";
  if (field === "amount") return "1.00";
  if (
    field === "fraction" ||
    field === "agentFraction" ||
    field === "jltFraction"
  )
    return "0.50";
  return "1";
}
function bad(
  value: unknown,
  validate: (v: unknown) => unknown = validateHqBookingPage,
  code?: string
): void {
  let error: unknown;
  try {
    validate(value);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(HqContractError);
  if (code) expect((error as HqContractError).code).toBe(code);
  expect((error as HqContractError).message).toBe(
    (error as HqContractError).code
  );
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("proposed HQ full contract", () => {
  it.each(Object.entries(SUPPLIED_EXAMPLES))(
    "validates supplied %s verbatim without inventing finances",
    (_, value) => {
      const result = validateHqBookingPage(value);
      expect(result).toEqual(value);
      expect(result).not.toBe(value);
      expect(
        result.records[0].financials.actualCardProcessingFees.amount
      ).toBeNull();
    }
  );
  it.each(Object.keys(HQ_CONTRACT_SCHEMAS) as HqSchemaName[])(
    "resolves every ref and validates declared schema %s",
    name => {
      validateHqDeclaredSchema(name, sample(HQ_CONTRACT_SCHEMAS[name]));
      expect(() => validateHqDeclaredSchema(name, [])).toThrow(HqContractError);
    }
  );
  it("drops legal envelope extensions and clones descendants", () => {
    const p: any = fixture();
    p.email = "private@sample.test";
    p.client = { passport: "SENSITIVE" };
    const clean = validateHqBookingPage(p);
    expect(clean).toEqual(fixture());
    expect(JSON.stringify(clean)).not.toMatch(/private|SENSITIVE/);
    p.records[0].bookingRef = "MUTATED";
    expect(clean.records[0].bookingRef).not.toBe("MUTATED");
  });
  it("does not invoke getters or accept exotic JSON", () => {
    const p: any = fixture();
    const getter = vi.fn(() => "SECRET");
    Object.defineProperty(p, "extra", { enumerable: true, get: getter });
    bad(p);
    expect(getter).not.toHaveBeenCalled();
    bad(new Date());
    const cycle: any = {};
    cycle.self = cycle;
    bad(cycle);
  });
  it("keeps namespaces open without asserting approval", () => {
    const p = fixture();
    p.records[0].assignedUser.namespace = "custom.server.configured.namespace";
    expect(validateHqBookingPage(p).records[0].assignedUser.namespace).toBe(
      "custom.server.configured.namespace"
    );
    expect(
      HQ_CONTRACT_SCHEMAS.IdentityEvidence.properties.namespace
    ).not.toHaveProperty("enum");
  });
  it("preserves arbitrary decimal revisions to 40 digits", () => {
    const p = fixture();
    p.records[0].revision = "9".repeat(40);
    expect(validateHqBookingPage(p).records[0].revision).toBe("9".repeat(40));
    p.records[0].revision += "9";
    bad(p);
  });
  const invalid: [string, (p: any) => void][] = [
    ["version mismatch", p => (p.contractVersion = "1.0.0")],
    ["missing payments", p => delete p.records[0].payments],
    ["record email", p => (p.records[0].email = "PII")],
    ["client name", p => (p.records[0].clientName = "PII")],
    ["identity email", p => (p.records[0].assignedUser.email = "PII")],
    [
      "product raw provider payload",
      p => (p.records[0].products[0].providerPayload = { auth: "PII" }),
    ],
    [
      "financial extension",
      p => (p.records[0].financials.grossBookingValue.email = "PII"),
    ],
    ["missing financials", p => delete p.records[0].financials],
    ["unknown status", p => (p.records[0].status = "paid")],
    [
      "numeric money",
      p => (p.records[0].financials.grossBookingValue.amount = 6000),
    ],
    [
      "one decimal money",
      p => (p.records[0].financials.grossBookingValue.amount = "6000.0"),
    ],
    [
      "exponential money",
      p => (p.records[0].financials.grossBookingValue.amount = "6e3"),
    ],
    [
      "missing state carrying money",
      p => (p.records[0].financials.grossBookingValue.state = "missing"),
    ],
    [
      "invalid state carrying money",
      p => (p.records[0].financials.grossBookingValue.state = "invalid"),
    ],
    [
      "recorded state missing amount",
      p => (p.records[0].financials.grossBookingValue.amount = null),
    ],
    [
      "money missing currency",
      p => (p.records[0].financials.grossBookingValue.currency = null),
    ],
    [
      "money missing source",
      p => (p.records[0].financials.grossBookingValue.source = null),
    ],
    [
      "currency mismatch",
      p => (p.records[0].products[0].netCost.currency = "EUR"),
    ],
    ["GBP assertion mismatch", p => (p.records[0].currency = "EUR")],
    [
      "unverified gross headline",
      p => (p.records[0].currencyBasis = "unverified"),
    ],
    ["floating revision", p => (p.records[0].revision = 2.5)],
    ["signed revision", p => (p.records[0].revision = "-1")],
    ["exponential revision", p => (p.records[0].revision = "1e20")],
    ["string passengers not coerced", p => (p.records[0].passengerCount = "3")],
    ["fractional passengers", p => (p.records[0].passengerCount = 1.5)],
    ["negative passengers", p => (p.records[0].passengerCount = -1)],
    ["unbounded passengers", p => (p.records[0].passengerCount = 10001)],
    [
      "invalid booked calendar",
      p => (p.records[0].dates.bookedOn = "2026-02-30"),
    ],
    [
      "invalid registration calendar",
      p => (p.records[0].dates.portalRegisteredAt = "2026-02-30T12:00:00Z"),
    ],
    [
      "invalid registration format",
      p => (p.records[0].dates.portalRegisteredAt = "yesterday"),
    ],
    [
      "local datetime",
      p => (p.records[0].dates.portalRegisteredAt = "2026-01-10T12:00:00"),
    ],
    [
      "invalid coverage calendar",
      p => (p.coverage.requestedFrom = "2026-13-01"),
    ],
    [
      "date source mismatch",
      p => (p.records[0].dates.dateSource = "booked_on"),
    ],
    [
      "current selected date mismatch",
      p => (p.records[0].dates.managementReportingDate = "2026-01-09"),
    ],
    ["date rule mismatch", p => (p.records[0].dates.dateRuleVersion = "wrong")],
    [
      "status rule mismatch",
      p => (p.records[0].eligibility.statusRuleVersion = "wrong"),
    ],
    [
      "financial policy mismatch",
      p => (p.records[0].financials.policyVersion = "wrong"),
    ],
    [
      "cancelled headline",
      p => {
        p.records[0].status = "cancelled";
        p.records[0].eligibility.cancelledCohort = true;
      },
    ],
    [
      "cancelled cohort mismatch",
      p => (p.records[0].eligibility.cancelledCohort = true),
    ],
    [
      "pending policy guessed",
      p => {
        p.records[0].status = "pending";
        p.records[0].eligibility.pendingCohort = true;
      },
    ],
    [
      "incomplete child membership",
      p => (p.records[0].childMembershipComplete = false),
    ],
    [
      "false complete active net",
      p => {
        p.records[0].products[0].netCost.amount = null;
        p.records[0].products[0].netCost.state = "missing";
      },
    ],
    [
      "false policy complete",
      p => (p.records[0].financials.policyCompleteCommission.complete = true),
    ],
    [
      "margin state mismatch",
      p => (p.records[0].financials.grossBookingMargin.state = "missing"),
    ],
    [
      "duplicate child id",
      p =>
        p.records[0].products.push(structuredClone(p.records[0].products[0])),
    ],
    [
      "duplicate booking id",
      p => p.records.push(structuredClone(p.records[0])),
    ],
    ["wrong dataset", p => (p.dataset = "quotes")],
    ["missing continuation", p => (p.hasMore = true)],
    ["unexpected continuation", p => (p.nextCursor = "cursor")],
    [
      "overlong cursor",
      p => {
        p.hasMore = true;
        p.nextCursor = "x".repeat(2049);
      },
    ],
    ["unbounded string", p => (p.records[0].bookingRef = "x".repeat(4097))],
    [
      "overlarge page",
      p =>
        (p.records = Array.from({ length: 501 }, (_, n) => ({
          ...p.records[0],
          id: String(n),
        }))),
    ],
  ];
  it.each(invalid)("rejects %s", (_, mutate) => {
    const p = fixture();
    mutate(p);
    bad(p);
  });
  it("bounds whole payload including legal extras", () => {
    const p: any = fixture();
    p.extra = "x".repeat(HQ_MAX_PAYLOAD_BYTES);
    bad(p, validateHqBookingPage, "PAYLOAD_TOO_LARGE");
  });
  it("retains incomplete valid source finances and signed profits, not entitlement", () => {
    const p = fixture();
    const f = p.records[0].financials;
    f.grossBookingProfit.amount = "-123.45";
    f.grossBookingMargin.fraction = "-0.020575";
    f.completeGrossAndCost = false;
    f.orbitCommissionBaseline.agentCommission = structuredClone(
      f.grossBookingProfit
    );
    const result = validateHqBookingPage(p);
    expect(result.records[0].financials.grossBookingProfit.amount).toBe(
      "-123.45"
    );
    expect(result.records[0].financials.orbitCommissionBaseline.complete).toBe(
      false
    );
    expect(
      result.records[0].financials.policyCompleteCommission.agentCommission
        .amount
    ).toBeNull();
  });
  it("allows labelled baseline default terms but not policy-complete default terms", () => {
    const p = fixture();
    const f = p.records[0].financials;
    const zero = {
      ...f.grossBookingValue,
      amount: "0.00",
      state: "estimated" as const,
    };
    f.applicableVat = zero;
    f.ptsFees = zero;
    const baseline = f.orbitCommissionBaseline;
    baseline.complete = true;
    baseline.netDistributableCommission = zero;
    baseline.agentCommission = zero;
    baseline.jltRetainedCommission = zero;
    expect(
      validateHqBookingPage(p).records[0].financials.orbitCommissionBaseline
        .terms.state
    ).toBe("stated_default_unverified");
    f.policyCompleteCommission = structuredClone(baseline);
    f.completeApprovedDeductions = true;
    f.otherDeductions = [];
    bad(p);
  });
  it("preserves pending uncertainty rather than guessing inclusion", () => {
    const p = fixture();
    const b = p.records[0];
    b.status = "pending";
    b.eligibility.pendingCohort = true;
    b.eligibility.headlineCount = null;
    b.eligibility.headlineGrossSales = null;
    expect(
      validateHqBookingPage(p).records[0].eligibility.headlineCount
    ).toBeNull();
  });
  it("uses London DST calendar and permits later corrected source dates", () => {
    const p = fixture();
    const b = p.records[0];
    b.dates.portalRegisteredAt = "2026-06-30T23:30:00Z";
    b.dates.managementReportingDate = "2026-07-01";
    expect(
      validateHqBookingPage(p).records[0].dates.managementReportingDate
    ).toBe("2026-07-01");
    b.dates.managementReportingDate = "2026-06-30";
    bad(p);
    b.dates.portalRegisteredAt = "2026-02-01T00:30:00+01:00";
    b.dates.managementReportingDate = "2026-01-31";
    expect(
      validateHqBookingPage(p).records[0].dates.managementReportingDate
    ).toBe("2026-01-31");
    b.revision = "3";
    Object.assign(b.dates, {
      portalRegisteredAt: null,
      bookedOn: "2026-02-02",
      managementReportingDate: "2026-02-02",
      dateSource: "booked_on",
    });
    expect(
      validateHqBookingPage(p).records[0].dates.managementReportingDate
    ).toBe("2026-02-02");
  });
  it("retains undated exceptions without fabricated cohorts", () => {
    const p = fixture();
    const b = p.records[0];
    Object.assign(b.dates, {
      portalRegisteredAt: null,
      bookedOn: null,
      bookedOnRaw: "invalid raw evidence",
      managementReportingDate: null,
      dateSource: "none",
    });
    Object.assign(b.eligibility, {
      dated: false,
      headlineCount: false,
      headlineGrossSales: false,
    });
    expect(
      validateHqBookingPage(p).records[0].dates.managementReportingDate
    ).toBeNull();
    b.eligibility.headlineCount = true;
    bad(p);
  });
});

describe("complete change replacements", () => {
  it("validates booking upsert and empty tombstone", () => {
    const p = changed();
    expect(validateHqChangePage(p)).toEqual(p);
    Object.assign(p.records[0], {
      operation: "tombstone",
      reason: "source_deleted",
      booking: null,
    });
    expect(validateHqChangePage(p).records[0].booking).toBeNull();
  });
  it("validates complete mapping and optional quote shapes", () => {
    const p = changed();
    const b = p.records[0].booking!;
    Object.assign(p.records[0], {
      entityType: "business_mapping",
      id: b.currentOwningBusiness.orbitTenantId,
      booking: null,
      mapping: b.currentOwningBusiness,
      reason: "mapping_changed",
    });
    expect(validateHqChangePage(p).records[0].mapping).not.toBeNull();
    const q = sample(HQ_CONTRACT_SCHEMAS.Quote);
    q.id = "7";
    q.revision = "2";
    q.grossValue = b.financials.grossBookingValue;
    Object.assign(p.records[0], {
      entityType: "quote",
      id: "7",
      mapping: null,
      quote: q,
      reason: "current_state_changed",
    });
    expect(validateHqChangePage(p).records[0].quote).toEqual(q);
  });
  const invalid: [string, (p: any) => void][] = [
    ["missing replacement", p => (p.records[0].booking = null)],
    [
      "multiple replacements",
      p => (p.records[0].mapping = p.records[0].booking.currentOwningBusiness),
    ],
    ["wrong replacement entity", p => (p.records[0].entityType = "quote")],
    ["wrong id", p => (p.records[0].id = "8")],
    ["wrong revision", p => (p.records[0].revision = "3")],
    ["partial children", p => delete p.records[0].booking.products],
    ["tombstone with payload", p => (p.records[0].operation = "tombstone")],
    ["upsert deletion", p => (p.records[0].reason = "source_deleted")],
    ["unknown operation", p => (p.records[0].operation = "update")],
    ["change PII", p => (p.records[0].clientEmail = "PII")],
    [
      "invalid timestamp",
      p => (p.records[0].observedAt = "2026-02-30T00:00:00Z"),
    ],
    [
      "duplicate durable position",
      p => p.records.push(structuredClone(p.records[0])),
    ],
    ["numeric revision", p => (p.records[0].revision = 2)],
    ["missing watermark", p => delete p.upperWatermark],
  ];
  it.each(invalid)("rejects %s", (_, mutate) => {
    const p = changed();
    mutate(p);
    bad(p, validateHqChangePage);
  });
});
