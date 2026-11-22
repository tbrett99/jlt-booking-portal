// Exact proposed OpenAPI 3.1 components, copied without narrowing identity namespaces.
// Validation hardening is applied separately; these remain the declared contract.
export const HQ_CONTRACT_SCHEMAS = {
  Amount: {
    type: "object",
    additionalProperties: false,
    properties: {
      amount: {
        type: ["string", "null"],
        pattern: "^-?[0-9]+\\.[0-9]{2}$",
      },
      currency: {
        type: ["string", "null"],
        pattern: "^[A-Z]{3}$",
      },
      state: {
        enum: [
          "source_recorded",
          "actual_recorded",
          "calculated",
          "estimated",
          "missing",
          "not_applicable",
          "invalid",
        ],
      },
      source: {
        type: ["string", "null"],
      },
      reason: {
        type: ["string", "null"],
      },
      evidenceIds: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: [
      "amount",
      "currency",
      "state",
      "source",
      "reason",
      "evidenceIds",
    ],
    description:
      "Exact decimal money, never JSON floats. State describes the source/derivation, not settlement certification. Actual charges need verified transaction evidence. Missing/invalid amounts are null; verified zero is 0.00. Credits may be signed only under the approved policy.",
  },
  Margin: {
    type: "object",
    additionalProperties: false,
    properties: {
      fraction: {
        type: ["string", "null"],
        pattern: "^-?[0-9]+\\.[0-9]+$",
      },
      state: {
        enum: ["calculated", "missing", "invalid"],
      },
      denominator: {
        type: "string",
      },
    },
    required: ["fraction", "state", "denominator"],
  },
  IdentityEvidence: {
    type: "object",
    additionalProperties: false,
    properties: {
      namespace: {
        type: ["string", "null"],
      },
      id: {
        type: ["string", "null"],
      },
      state: {
        enum: [
          "verified",
          "current_assignment",
          "label_only",
          "unverified",
          "missing",
        ],
      },
      source: {
        type: ["string", "null"],
      },
    },
    required: ["namespace", "id", "state", "source"],
  },
  Business: {
    type: "object",
    additionalProperties: false,
    properties: {
      orbitTenantId: {
        type: "string",
        pattern: "^[0-9]+$",
      },
      name: {
        type: "string",
      },
      accountType: {
        enum: ["real", "demo"],
      },
      active: {
        type: "boolean",
      },
      portalBusinessId: {
        type: ["string", "null"],
      },
      mappingStatus: {
        enum: ["verified", "unmatched", "conflict"],
      },
      mappingRevision: {
        type: ["string", "null"],
      },
      mappingSource: {
        type: ["string", "null"],
      },
    },
    required: [
      "orbitTenantId",
      "name",
      "accountType",
      "active",
      "portalBusinessId",
      "mappingStatus",
      "mappingRevision",
      "mappingSource",
    ],
  },
  Dates: {
    type: "object",
    additionalProperties: false,
    properties: {
      portalRegisteredAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      bookedOnRaw: {
        type: ["string", "null"],
      },
      bookedOn: {
        type: ["string", "null"],
        format: "date",
      },
      managementReportingDate: {
        type: ["string", "null"],
        format: "date",
      },
      dateSource: {
        enum: ["portal_registered_at", "booked_on", "none"],
      },
      dateRuleVersion: {
        type: "string",
      },
      warnings: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: [
      "portalRegisteredAt",
      "bookedOnRaw",
      "bookedOn",
      "managementReportingDate",
      "dateSource",
      "dateRuleVersion",
      "warnings",
    ],
    description:
      "Valid registration instant -> Europe/London calendar date, else valid booked date, else undated exception. Never use created/departure/confirmation dates. Invalid-present registration fallback and future-date treatment require final approval. Source corrections/later registration replace the current selected cohort; value-only amendments keep it unchanged.",
  },
  Eligibility: {
    type: "object",
    additionalProperties: false,
    properties: {
      headlineCount: {
        type: ["boolean", "null"],
      },
      headlineGrossSales: {
        type: ["boolean", "null"],
      },
      cancelledCohort: {
        type: "boolean",
      },
      pendingCohort: {
        type: "boolean",
      },
      dated: {
        type: "boolean",
      },
      statusRuleVersion: {
        type: "string",
      },
      reason: {
        type: ["string", "null"],
      },
    },
    required: [
      "headlineCount",
      "headlineGrossSales",
      "cancelledCohort",
      "pendingCohort",
      "dated",
      "statusRuleVersion",
      "reason",
    ],
    description:
      "Proposed v1 truth table: confirmed yes; pending separate; cancelled excluded from headlines and retained separately. Pending treatment awaits approval. Undated rows stay exported but do not acquire a fabricated period. Net booking sales means customer gross after status exclusions, not supplier net.",
  },
  CommissionTerms: {
    type: "object",
    additionalProperties: false,
    properties: {
      agentFraction: {
        type: ["string", "null"],
      },
      jltFraction: {
        type: ["string", "null"],
      },
      state: {
        enum: ["verified", "stated_default_unverified", "missing"],
      },
      source: {
        type: ["string", "null"],
      },
    },
    required: ["agentFraction", "jltFraction", "state", "source"],
  },
  CommissionResult: {
    type: "object",
    additionalProperties: false,
    properties: {
      basis: {
        type: "string",
      },
      complete: {
        type: "boolean",
      },
      cardProcessingFeesIncluded: {
        type: "boolean",
      },
      vatIncluded: {
        type: "boolean",
      },
      ptsIncluded: {
        type: "boolean",
      },
      netDistributableCommission: {
        $ref: "#/components/schemas/Amount",
      },
      agentCommission: {
        $ref: "#/components/schemas/Amount",
      },
      jltRetainedCommission: {
        $ref: "#/components/schemas/Amount",
      },
      terms: {
        $ref: "#/components/schemas/CommissionTerms",
      },
      roundingBasis: {
        type: "string",
      },
      roundingResidual: {
        $ref: "#/components/schemas/Amount",
      },
      limitations: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: [
      "basis",
      "complete",
      "cardProcessingFeesIncluded",
      "vatIncluded",
      "ptsIncluded",
      "netDistributableCommission",
      "agentCommission",
      "jltRetainedCommission",
      "terms",
      "roundingBasis",
      "roundingResidual",
      "limitations",
    ],
    description:
      "Baseline is the existing VAT + estimated PTS only helper, standard 80/20, with exclusions. Policy-complete fields require all applicable approved deductions and terms. Existing rounding is preserved; do not deduct fees twice or substitute gross spread/stored commission as entitlement.",
  },
  Deduction: {
    type: "object",
    additionalProperties: false,
    properties: {
      code: {
        type: "string",
      },
      amount: {
        $ref: "#/components/schemas/Amount",
      },
      applicability: {
        enum: ["applicable", "not_applicable", "unknown"],
      },
      alreadyIncludedElsewhere: {
        type: ["boolean", "null"],
      },
      policySource: {
        type: ["string", "null"],
      },
    },
    required: [
      "code",
      "amount",
      "applicability",
      "alreadyIncludedElsewhere",
      "policySource",
    ],
  },
  Financials: {
    type: "object",
    additionalProperties: false,
    properties: {
      grossBookingValue: {
        $ref: "#/components/schemas/Amount",
      },
      supplierNetCost: {
        $ref: "#/components/schemas/Amount",
      },
      knownSupplierNetSubtotal: {
        $ref: "#/components/schemas/Amount",
      },
      grossBookingProfit: {
        $ref: "#/components/schemas/Amount",
      },
      grossBookingMargin: {
        $ref: "#/components/schemas/Margin",
      },
      applicableVat: {
        $ref: "#/components/schemas/Amount",
      },
      legacyBookingVatOverride: {
        $ref: "#/components/schemas/Amount",
      },
      ptsFees: {
        $ref: "#/components/schemas/Amount",
      },
      ptsFeeBasis: {
        type: "string",
      },
      ptsAssumptions: {
        type: "array",
        items: {
          type: "string",
        },
      },
      actualCardProcessingFees: {
        $ref: "#/components/schemas/Amount",
      },
      estimatedCardProcessingFees: {
        $ref: "#/components/schemas/Amount",
      },
      otherDeductions: {
        type: ["array", "null"],
        items: {
          $ref: "#/components/schemas/Deduction",
        },
      },
      orbitCommissionBaseline: {
        $ref: "#/components/schemas/CommissionResult",
      },
      policyCompleteCommission: {
        $ref: "#/components/schemas/CommissionResult",
      },
      settledJltIncome: {
        $ref: "#/components/schemas/Amount",
      },
      cancellationCharges: {
        $ref: "#/components/schemas/Amount",
      },
      cancellationRetainedCommission: {
        $ref: "#/components/schemas/Amount",
      },
      completeGrossAndCost: {
        type: "boolean",
      },
      completeApprovedDeductions: {
        type: "boolean",
      },
      policyVersion: {
        type: "string",
      },
      warnings: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: [
      "grossBookingValue",
      "supplierNetCost",
      "knownSupplierNetSubtotal",
      "grossBookingProfit",
      "grossBookingMargin",
      "applicableVat",
      "legacyBookingVatOverride",
      "ptsFees",
      "ptsFeeBasis",
      "ptsAssumptions",
      "actualCardProcessingFees",
      "estimatedCardProcessingFees",
      "otherDeductions",
      "orbitCommissionBaseline",
      "policyCompleteCommission",
      "settledJltIncome",
      "cancellationCharges",
      "cancellationRetainedCommission",
      "completeGrossAndCost",
      "completeApprovedDeductions",
      "policyVersion",
      "warnings",
    ],
    description:
      "Gross profit/margin precede VAT, PTS, merchant fees and sharing. Cost completeness and exact product/stored gross reconciliation gate derived metrics. VAT is existing computed product policy; legacy booking override is not an effective current deduction. PTS and PPS rate-derived values are estimates. Settlement and cancellation retained finances require distinct evidence.",
  },
  Product: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: {
        type: "string",
        pattern: "^[0-9]+$",
      },
      productType: {
        type: "string",
      },
      rawBookingStatus: {
        type: ["string", "null"],
      },
      financialActive: {
        type: "boolean",
      },
      supplierId: {
        type: ["string", "null"],
      },
      supplierName: {
        type: ["string", "null"],
      },
      grossValue: {
        $ref: "#/components/schemas/Amount",
      },
      netCost: {
        $ref: "#/components/schemas/Amount",
      },
      allocationBasis: {
        type: "string",
      },
      vatApplicable: {
        type: ["boolean", "null"],
      },
      vatOverride: {
        type: ["boolean", "null"],
      },
      isReimbursement: {
        type: "boolean",
      },
      sourceUpdatedAt: {
        type: ["string", "null"],
        format: "date-time",
      },
    },
    required: [
      "id",
      "productType",
      "rawBookingStatus",
      "financialActive",
      "supplierId",
      "supplierName",
      "grossValue",
      "netCost",
      "allocationBasis",
      "vatApplicable",
      "vatOverride",
      "isReimbursement",
      "sourceUpdatedAt",
    ],
    description:
      "Source booking_products; product values are additive only on approved allocation/completeness basis. Never attach the whole booking gross to every supplier/room. Supplier distinct booking counts overlap. No raw provider tokens or references required.",
  },
  PaymentEvidence: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: {
        type: "string",
        pattern: "^[0-9]+$",
      },
      method: {
        type: "string",
      },
      paymentType: {
        type: "string",
      },
      recordedReceipt: {
        $ref: "#/components/schemas/Amount",
      },
      paidAt: {
        type: ["string", "null"],
        format: "date",
      },
      createdAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      ppsLinkId: {
        type: ["string", "null"],
      },
      providerTransactionId: {
        type: ["string", "null"],
      },
      matchState: {
        enum: ["verified", "unmatched", "ambiguous", "unverified"],
      },
      feeEvidenceState: {
        enum: ["mapped_actual", "estimated_only", "unmapped", "not_applicable"],
      },
    },
    required: [
      "id",
      "method",
      "paymentType",
      "recordedReceipt",
      "paidAt",
      "createdAt",
      "ppsLinkId",
      "providerTransactionId",
      "matchState",
      "feeEvidenceState",
    ],
    description:
      "Current recorded receipt, not actual merchant fee or settled net. No typed ledger-to-PPS FK at reviewed HEAD; transaction matching requires validated exact identity/status/currency. Raw callbacks, payment URLs, card/auth data and free text excluded.",
  },
  Booking: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: {
        type: "string",
        pattern: "^[0-9]+$",
      },
      bookingRef: {
        type: "string",
      },
      revision: {
        type: "string",
        pattern: "^[0-9]+$",
      },
      contentHash: {
        type: "string",
      },
      sourceUpdatedAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      sourceObservedAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      status: {
        enum: ["confirmed", "pending", "cancelled"],
      },
      dates: {
        $ref: "#/components/schemas/Dates",
      },
      eligibility: {
        $ref: "#/components/schemas/Eligibility",
      },
      currency: {
        type: ["string", "null"],
      },
      currencyBasis: {
        enum: ["validated_GBP", "unverified", "verified_native"],
      },
      passengerCount: {
        type: ["integer", "null"],
        minimum: 0,
      },
      bookingType: {
        type: ["string", "null"],
      },
      currentOwningBusiness: {
        $ref: "#/components/schemas/Business",
      },
      originalSellingBusiness: {
        $ref: "#/components/schemas/IdentityEvidence",
      },
      originalSellingAgent: {
        $ref: "#/components/schemas/IdentityEvidence",
      },
      assignedUser: {
        $ref: "#/components/schemas/IdentityEvidence",
      },
      processingAdministrator: {
        $ref: "#/components/schemas/IdentityEvidence",
      },
      financials: {
        $ref: "#/components/schemas/Financials",
      },
      products: {
        type: "array",
        items: {
          $ref: "#/components/schemas/Product",
        },
      },
      payments: {
        type: "array",
        items: {
          $ref: "#/components/schemas/PaymentEvidence",
        },
      },
      childMembershipComplete: {
        type: "boolean",
      },
      qualityIssues: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: [
      "id",
      "bookingRef",
      "revision",
      "contentHash",
      "sourceUpdatedAt",
      "sourceObservedAt",
      "status",
      "dates",
      "eligibility",
      "currency",
      "currencyBasis",
      "passengerCount",
      "bookingType",
      "currentOwningBusiness",
      "originalSellingBusiness",
      "originalSellingAgent",
      "assignedUser",
      "processingAdministrator",
      "financials",
      "products",
      "payments",
      "childMembershipComplete",
      "qualityIssues",
    ],
    description:
      "Complete immutable published CURRENT revision; not an original sale/event snapshot. Include cancelled, unmatched and undated rows in the approved source population. Assigning/reporting date does not prove remote registration. Failed child reads are not empty lists.",
  },
  Coverage: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: {
        enum: ["verified", "partial", "unverified"],
      },
      requestedFrom: {
        type: ["string", "null"],
        format: "date",
      },
      verifiedFrom: {
        type: ["string", "null"],
        format: "date",
      },
      verifiedThrough: {
        type: ["string", "null"],
        format: "date",
      },
      population: {
        type: "string",
      },
      undatedCount: {
        type: ["integer", "null"],
      },
      unmatchedBusinessCount: {
        type: ["integer", "null"],
      },
      limitations: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: [
      "status",
      "requestedFrom",
      "verifiedFrom",
      "verifiedThrough",
      "population",
      "undatedCount",
      "unmatchedBusinessCount",
      "limitations",
    ],
  },
  Envelope: {
    type: "object",
    properties: {
      contractVersion: {
        type: "string",
      },
      dataset: {
        type: "string",
      },
      snapshotId: {
        type: "string",
      },
      watermark: {
        type: "string",
      },
      projectionPublishedAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      sourceObservationStartedAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      sourceObservationCompletedAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      dateRuleVersion: {
        type: "string",
      },
      statusRuleVersion: {
        type: "string",
      },
      financialPolicyVersion: {
        type: "string",
      },
      scopeId: {
        type: "string",
      },
      coverage: {
        $ref: "#/components/schemas/Coverage",
      },
      nextCursor: {
        type: ["string", "null"],
      },
      hasMore: {
        type: "boolean",
      },
    },
    required: [
      "contractVersion",
      "dataset",
      "snapshotId",
      "watermark",
      "projectionPublishedAt",
      "sourceObservationStartedAt",
      "sourceObservationCompletedAt",
      "dateRuleVersion",
      "statusRuleVersion",
      "financialPolicyVersion",
      "scopeId",
      "coverage",
      "nextCursor",
      "hasMore",
    ],
    description:
      "Pinned sealed projection generation, not one whole-source historical instant. Cursor binds principal, scope, snapshot and filters; no silent generation change. Canonical reporting revisions exclude request timestamps. Only complete successful publication advances health.",
  },
  BookingPage: {
    allOf: [
      {
        $ref: "#/components/schemas/Envelope",
      },
      {
        type: "object",
        properties: {
          records: {
            type: "array",
            items: {
              $ref: "#/components/schemas/Booking",
            },
          },
        },
        required: ["records"],
      },
    ],
  },
  Change: {
    type: "object",
    additionalProperties: false,
    properties: {
      position: {
        type: "string",
      },
      entityType: {
        enum: ["booking", "business_mapping", "quote"],
      },
      id: {
        type: "string",
        pattern: "^[0-9]+$",
      },
      revision: {
        type: "string",
        pattern: "^[0-9]+$",
      },
      operation: {
        enum: ["upsert", "tombstone"],
      },
      reason: {
        enum: [
          "current_state_changed",
          "source_deleted",
          "out_of_scope",
          "mapping_changed",
        ],
      },
      observedAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      publishedAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      booking: {
        anyOf: [
          {
            $ref: "#/components/schemas/Booking",
          },
          {
            type: "null",
          },
        ],
      },
      mapping: {
        anyOf: [
          {
            $ref: "#/components/schemas/Business",
          },
          {
            type: "null",
          },
        ],
      },
      quote: {
        anyOf: [
          {
            $ref: "#/components/schemas/Quote",
          },
          {
            type: "null",
          },
        ],
      },
    },
    required: [
      "position",
      "entityType",
      "id",
      "revision",
      "operation",
      "reason",
      "observedAt",
      "publishedAt",
      "booking",
      "mapping",
      "quote",
    ],
    description:
      "Complete replacement at durable publication position; not monetary amendment deltas. Upsert carries exactly one matching complete payload; tombstone carries no payload. Every persisting agreed-state difference is detected on successful full scans; transient transitions between scans are not guaranteed events.",
  },
  ChangePage: {
    allOf: [
      {
        $ref: "#/components/schemas/Envelope",
      },
      {
        type: "object",
        properties: {
          upperWatermark: {
            type: "string",
          },
          records: {
            type: "array",
            items: {
              $ref: "#/components/schemas/Change",
            },
          },
        },
        required: ["upperWatermark", "records"],
      },
    ],
  },
  CatalogueEntry: {
    type: "object",
    additionalProperties: false,
    properties: {
      entityType: {
        enum: ["booking", "business_mapping", "quote"],
      },
      id: {
        type: "string",
        pattern: "^[0-9]+$",
      },
      revision: {
        type: "string",
        pattern: "^[0-9]+$",
      },
      contentHash: {
        type: "string",
      },
    },
    required: ["entityType", "id", "revision", "contentHash"],
  },
  CataloguePage: {
    allOf: [
      {
        $ref: "#/components/schemas/Envelope",
      },
      {
        type: "object",
        properties: {
          records: {
            type: "array",
            items: {
              $ref: "#/components/schemas/CatalogueEntry",
            },
          },
        },
        required: ["records"],
      },
    ],
  },
  BusinessPage: {
    allOf: [
      {
        $ref: "#/components/schemas/Envelope",
      },
      {
        type: "object",
        properties: {
          records: {
            type: "array",
            items: {
              $ref: "#/components/schemas/Business",
            },
          },
        },
        required: ["records"],
      },
    ],
  },
  Quote: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: {
        type: "string",
        pattern: "^[0-9]+$",
      },
      quoteRef: {
        type: "string",
      },
      revision: {
        type: "string",
        pattern: "^[0-9]+$",
      },
      orbitTenantId: {
        type: "string",
        pattern: "^[0-9]+$",
      },
      createdAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      updatedAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      status: {
        enum: ["draft", "sent", "accepted", "booked", "expired"],
      },
      grossValue: {
        $ref: "#/components/schemas/Amount",
      },
      enquiryId: {
        type: ["string", "null"],
      },
      linkedBookingId: {
        type: ["string", "null"],
      },
      linkedBookingRef: {
        type: ["string", "null"],
      },
      qualifiedActivity: {
        type: ["boolean", "null"],
      },
      qualificationBasis: {
        type: "string",
      },
      qualificationWarnings: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: [
      "id",
      "quoteRef",
      "revision",
      "orbitTenantId",
      "createdAt",
      "updatedAt",
      "status",
      "grossValue",
      "enquiryId",
      "linkedBookingId",
      "linkedBookingRef",
      "qualifiedActivity",
      "qualificationBasis",
      "qualificationWarnings",
    ],
    description:
      "Optional module: approve qualification before claiming genuine activity. Exclude raw drafts as genuine issued quotes; lack of trusted issued timestamp/history may make qualification unknown. Current status/created timestamp proxy must be labelled. Alternatives/revisions are not opportunity denominator units; booked/converted may still mean a pending booking.",
  },
  QuotePage: {
    allOf: [
      {
        $ref: "#/components/schemas/Envelope",
      },
      {
        type: "object",
        properties: {
          records: {
            type: "array",
            items: {
              $ref: "#/components/schemas/Quote",
            },
          },
        },
        required: ["records"],
      },
    ],
  },
  Module: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: {
        type: "string",
      },
      enabled: {
        type: "boolean",
      },
      readiness: {
        enum: ["available", "partial", "unavailable"],
      },
      limitations: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: ["name", "enabled", "readiness", "limitations"],
  },
  Capabilities: {
    type: "object",
    additionalProperties: false,
    properties: {
      contractVersion: {
        type: "string",
      },
      implementationState: {
        type: "string",
      },
      modules: {
        type: "array",
        items: {
          $ref: "#/components/schemas/Module",
        },
      },
      dateRuleVersion: {
        type: "string",
      },
      statusRuleVersion: {
        type: "string",
      },
      financialPolicyVersion: {
        type: "string",
      },
      currencyBasis: {
        type: "string",
      },
      coverage: {
        $ref: "#/components/schemas/Coverage",
      },
      snapshotRetentionSeconds: {
        type: ["integer", "null"],
      },
      journalRetentionSeconds: {
        type: ["integer", "null"],
      },
      maximumPageSize: {
        type: "integer",
      },
      targetFreshnessMinutes: {
        type: "integer",
      },
      targetIsGuaranteed: {
        type: "boolean",
      },
      pendingApprovals: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: [
      "contractVersion",
      "implementationState",
      "modules",
      "dateRuleVersion",
      "statusRuleVersion",
      "financialPolicyVersion",
      "currencyBasis",
      "coverage",
      "snapshotRetentionSeconds",
      "journalRetentionSeconds",
      "maximumPageSize",
      "targetFreshnessMinutes",
      "targetIsGuaranteed",
      "pendingApprovals",
    ],
  },
  Status: {
    type: "object",
    additionalProperties: false,
    properties: {
      state: {
        enum: ["healthy", "building", "partial", "stale", "failed", "disabled"],
      },
      lastCompleteSnapshotId: {
        type: ["string", "null"],
      },
      lastCompleteWatermark: {
        type: ["string", "null"],
      },
      lastCompletePublishedAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      sourceObservationStartedAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      sourceObservationCompletedAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      oldestRetainedCursor: {
        type: ["string", "null"],
      },
      currentRunId: {
        type: ["string", "null"],
      },
      failureCode: {
        type: ["string", "null"],
      },
      targetFreshnessMinutes: {
        type: "integer",
      },
      targetIsGuaranteed: {
        type: "boolean",
      },
    },
    required: [
      "state",
      "lastCompleteSnapshotId",
      "lastCompleteWatermark",
      "lastCompletePublishedAt",
      "sourceObservationStartedAt",
      "sourceObservationCompletedAt",
      "oldestRetainedCursor",
      "currentRunId",
      "failureCode",
      "targetFreshnessMinutes",
      "targetIsGuaranteed",
    ],
    description:
      "Orbit publication health only; Portal separately exposes last fully applied watermark, ingestion lag and dashboard refresh. Failed/partial scans retain previous complete generation and cannot turn green.",
  },
  Error: {
    type: "object",
    additionalProperties: false,
    properties: {
      code: {
        enum: [
          "AUTHENTICATION_REQUIRED",
          "SCOPE_FORBIDDEN",
          "INVALID_QUERY",
          "SNAPSHOT_EXPIRED",
          "CURSOR_EXPIRED",
          "RATE_LIMITED",
          "MODULE_UNAVAILABLE",
          "SOURCE_UNAVAILABLE",
        ],
      },
      message: {
        type: "string",
      },
      requestId: {
        type: "string",
      },
      retryable: {
        type: "boolean",
      },
    },
    required: ["code", "message", "requestId", "retryable"],
  },
} as const;
