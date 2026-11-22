// Verbatim components.schemas from the supplied implemented OpenAPI 3.1.1.
// Resource bounds and semantics are applied separately; do not alter source declarations.
export const HQ_WIRE_SCHEMAS = {
  Dates: {
    type: "object",
    properties: {
      portalRegisteredAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      bookedOn: {
        type: ["string", "null"],
      },
      managementDate: {
        type: ["string", "null"],
        pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
      },
      dateSource: {
        enum: ["portal_registered_at", "booked_on", "unavailable"],
      },
      month: {
        type: ["string", "null"],
      },
      timezone: {
        const: "Europe/London",
      },
      issues: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: [
      "portalRegisteredAt",
      "bookedOn",
      "managementDate",
      "dateSource",
      "month",
      "timezone",
      "issues",
    ],
  },
  MemberLink: {
    type: "object",
    properties: {
      orbitTenantId: {
        type: ["integer", "null"],
      },
      mappingState: {
        enum: ["existing_owner_link", "unresolved"],
      },
      status: {
        enum: ["candidate", "unresolved"],
      },
      reason: {
        type: "string",
      },
      sourceOnly: {
        const: true,
      },
      portalVerified: {
        const: false,
      },
      historicalSellingRelationshipVerified: {
        const: false,
      },
      attributionBasis: {
        const: "current_owning_tenant_and_current_membership",
      },
      ownerTenantUserId: {
        type: ["integer", "null"],
      },
      memberJltAgentId: {
        type: ["string", "null"],
      },
      memberJltOpenId: {
        type: ["string", "null"],
      },
      ownerCandidates: {
        type: "array",
        items: {
          type: "object",
        },
      },
      members: {
        type: "array",
        items: {
          type: "object",
        },
      },
      assignedStaff: {
        type: "object",
        properties: {
          orbitTenantUserId: {
            type: ["integer", "null"],
          },
          status: {
            enum: [
              "current_member",
              "unassigned",
              "missing_user",
              "tenant_mismatch",
              "unresolved_tenant",
            ],
          },
          jltAgentId: {
            type: ["string", "null"],
          },
          jltOpenId: {
            type: ["string", "null"],
          },
          role: {
            enum: ["owner", "staff", null],
          },
          isActive: {
            type: ["boolean", "null"],
          },
          sourceOnly: {
            const: true,
          },
          portalVerified: {
            const: false,
          },
        },
        required: [
          "orbitTenantUserId",
          "status",
          "jltAgentId",
          "jltOpenId",
          "role",
          "isActive",
          "sourceOnly",
          "portalVerified",
        ],
      },
    },
    required: [
      "orbitTenantId",
      "mappingState",
      "status",
      "reason",
      "sourceOnly",
      "portalVerified",
      "historicalSellingRelationshipVerified",
      "attributionBasis",
      "ownerTenantUserId",
      "memberJltAgentId",
      "memberJltOpenId",
      "ownerCandidates",
      "members",
      "assignedStaff",
    ],
  },
  Financials: {
    type: "object",
    properties: {
      version: {
        const: "management_hq_financials_v1",
      },
      currency: {
        const: "GBP",
      },
      grossBookingValue: {
        type: ["number", "null"],
      },
      totalNetCost: {
        type: ["number", "null"],
      },
      netCostSubtotal: {
        type: ["number", "null"],
      },
      grossBookingProfit: {
        type: ["number", "null"],
      },
      grossMarginPct: {
        type: ["number", "null"],
      },
      weightedMarginContribution: {
        type: "object",
        properties: {
          profitPence: {
            type: ["integer", "null"],
          },
          coveredGrossPence: {
            type: ["integer", "null"],
          },
          methodology: {
            type: "string",
          },
        },
        required: ["profitPence", "coveredGrossPence", "methodology"],
      },
      vatDeduction: {
        type: ["number", "null"],
      },
      vatStatus: {
        enum: ["computed_not_paid", "incomplete"],
      },
      estimatedPtsFees: {
        type: ["number", "null"],
      },
      actualPtsFees: {
        type: "null",
      },
      estimatedCardProcessingFees: {
        type: ["number", "null"],
      },
      knownPpsFeeEstimateSubtotal: {
        type: ["number", "null"],
      },
      actualCardProcessingFees: {
        type: "null",
      },
      netDistributableCommission: {
        type: "null",
      },
      agentCommission: {
        type: "null",
      },
      jltRetainedCommission: {
        type: "null",
      },
      retainedCancellationIncome: {
        type: "null",
      },
      settledJltIncome: {
        type: "null",
      },
      baselineEstimate: {
        type: "object",
        properties: {
          status: {
            enum: ["excluded", "estimated", "incomplete", "unavailable"],
          },
          financials: {
            type: ["object", "null"],
          },
          cardProcessingFeesIncluded: {
            const: false,
          },
          otherDeductionsIncluded: {
            const: false,
          },
          agentSplitPct: {
            const: 80,
          },
          jltSplitPct: {
            const: 20,
          },
          reasons: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },
        required: [
          "status",
          "financials",
          "cardProcessingFeesIncluded",
          "otherDeductionsIncluded",
          "agentSplitPct",
          "jltSplitPct",
          "reasons",
        ],
        description:
          "Existing Orbit Forecast VAT+estimated PTS, default80/20 only. Baseline share fields are not all-fees entitlement.",
      },
      completeness: {
        type: "object",
        properties: {
          status: {
            const: "partial",
          },
          economicsStatus: {
            enum: ["complete", "excluded", "incomplete"],
          },
          strictSourceComplete: {
            type: "boolean",
          },
          policyStatus: {
            const: "incomplete",
          },
          economicsReasons: {
            type: "array",
            items: {
              type: "string",
            },
          },
          policyReasons: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },
        required: [
          "status",
          "economicsStatus",
          "strictSourceComplete",
          "policyStatus",
          "economicsReasons",
          "policyReasons",
        ],
      },
    },
    required: [
      "version",
      "currency",
      "grossBookingValue",
      "totalNetCost",
      "netCostSubtotal",
      "grossBookingProfit",
      "grossMarginPct",
      "weightedMarginContribution",
      "vatDeduction",
      "vatStatus",
      "estimatedPtsFees",
      "actualPtsFees",
      "estimatedCardProcessingFees",
      "knownPpsFeeEstimateSubtotal",
      "actualCardProcessingFees",
      "netDistributableCommission",
      "agentCommission",
      "jltRetainedCommission",
      "retainedCancellationIncome",
      "settledJltIncome",
      "baselineEstimate",
      "completeness",
    ],
    description:
      "Numbers in GBP pounds unless explicitly named PENCE/MINOR. Current strict economics; actual fee/settlement/custom terms not certified. Weighted margin uses matching covered gross only. Additional diagnostic fields are returned.",
  },
  Product: {
    type: "object",
    properties: {
      id: {
        type: "integer",
        minimum: 1,
        maximum: 9007199254740991,
      },
      productType: {
        type: ["string", "null"],
      },
      supplierName: {
        type: ["string", "null"],
      },
      supplierId: {
        type: ["integer", "null"],
      },
      price: {
        type: ["string", "number", "null"],
      },
      netPrice: {
        type: ["string", "number", "null"],
      },
      bookingStatus: {
        type: ["string", "null"],
      },
      vatApplicable: {
        type: ["boolean", "null"],
      },
      vatOverride: {
        type: ["boolean", "null"],
      },
      isReimbursement: {
        type: ["boolean", "null"],
      },
      createdAt: {
        type: ["string", "null"],
        format: "date-time",
      },
      updatedAt: {
        type: ["string", "null"],
        format: "date-time",
      },
    },
    required: [
      "id",
      "productType",
      "supplierName",
      "supplierId",
      "price",
      "netPrice",
      "bookingStatus",
      "vatApplicable",
      "vatOverride",
      "isReimbursement",
      "createdAt",
      "updatedAt",
    ],
  },
  BookingPayload: {
    type: "object",
    properties: {
      orbitBookingId: {
        type: "integer",
        minimum: 1,
        maximum: 9007199254740991,
      },
      orbitTenantId: {
        type: ["integer", "null"],
      },
      assignedTenantUserId: {
        type: ["integer", "null"],
      },
      bookingRef: {
        type: "string",
      },
      status: {
        enum: ["confirmed", "pending", "cancelled"],
      },
      dates: {
        $ref: "#/components/schemas/Dates",
      },
      identity: {
        $ref: "#/components/schemas/MemberLink",
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
          type: "object",
        },
      },
      ppsLinks: {
        type: "array",
        items: {
          type: "object",
        },
      },
      paymentSummary: {
        type: "object",
      },
      eligibility: {
        type: "object",
        properties: {
          activeSalesHeadline: {
            type: "boolean",
          },
          pending: {
            type: "boolean",
          },
          cancelled: {
            type: "boolean",
          },
          undated: {
            type: "boolean",
          },
        },
        required: ["activeSalesHeadline", "pending", "cancelled", "undated"],
      },
      childrenComplete: {
        const: true,
      },
      snapshotConsistency: {
        const: "repeatable_read_per_source_page_not_run_wide",
      },
    },
    required: [
      "orbitBookingId",
      "orbitTenantId",
      "assignedTenantUserId",
      "bookingRef",
      "status",
      "dates",
      "identity",
      "financials",
      "products",
      "payments",
      "ppsLinks",
      "paymentSummary",
      "eligibility",
      "childrenComplete",
      "snapshotConsistency",
    ],
    description:
      "Complete current aggregate replacement including explicit empty child arrays. Contains additional allowlisted current source fields and diagnostics. Original registration/creator labels and raw callbacks/customer PII/supplier booking tokens are excluded. Current ownership is not an immutable original seller.",
  },
  BusinessPayload: {
    type: "object",
    properties: {
      orbitTenantId: {
        type: "integer",
        minimum: 1,
        maximum: 9007199254740991,
      },
      isActive: {
        type: "boolean",
      },
      account: {
        type: "object",
      },
      identity: {
        $ref: "#/components/schemas/MemberLink",
      },
      configuredCardFeeRates: {
        type: "object",
      },
      membershipHistoryAvailable: {
        const: false,
      },
      portalMembershipJoinDate: {
        type: "null",
      },
    },
    required: [
      "orbitTenantId",
      "isActive",
      "account",
      "identity",
      "configuredCardFeeRates",
      "membershipHistoryAvailable",
      "portalMembershipJoinDate",
    ],
  },
  Tombstone: {
    type: "object",
    properties: {
      deleted: {
        const: true,
      },
      reason: {
        const: "source_absent_or_now_explicit_demo",
      },
      entityType: {
        enum: ["booking", "business"],
      },
      entityId: {
        type: "integer",
        minimum: 1,
        maximum: 9007199254740991,
      },
    },
    required: ["deleted", "reason", "entityType", "entityId"],
  },
  Entity: {
    type: "object",
    properties: {
      entityType: {
        enum: ["booking", "business"],
      },
      entityId: {
        type: "integer",
        minimum: 1,
        maximum: 9007199254740991,
      },
      revision: {
        type: "integer",
        minimum: 1,
        maximum: 9007199254740991,
      },
      payload: {
        oneOf: [
          {
            $ref: "#/components/schemas/BookingPayload",
          },
          {
            $ref: "#/components/schemas/BusinessPayload",
          },
          {
            $ref: "#/components/schemas/Tombstone",
          },
        ],
      },
    },
    required: ["entityType", "entityId", "revision", "payload"],
    description:
      "Stable source PK plus globally increasing immutable reporting revision. Apply by (entityType, entityId), not bookingRef or financial hash. Revisions may contain gaps.",
  },
  Change: {
    type: "object",
    properties: {
      entityType: {
        enum: ["booking", "business"],
      },
      entityId: {
        type: "integer",
        minimum: 1,
        maximum: 9007199254740991,
      },
      revision: {
        type: "integer",
        minimum: 1,
        maximum: 9007199254740991,
      },
      payload: {
        oneOf: [
          {
            $ref: "#/components/schemas/BookingPayload",
          },
          {
            $ref: "#/components/schemas/BusinessPayload",
          },
          {
            $ref: "#/components/schemas/Tombstone",
          },
        ],
      },
      seq: {
        type: "integer",
        minimum: 1,
        maximum: 9007199254740991,
      },
      operation: {
        enum: ["upsert", "delete"],
      },
    },
    required: [
      "entityType",
      "entityId",
      "revision",
      "payload",
      "seq",
      "operation",
    ],
  },
  CatalogueEntry: {
    type: "object",
    properties: {
      entityType: {
        enum: ["booking", "business"],
      },
      entityId: {
        type: "integer",
        minimum: 1,
        maximum: 9007199254740991,
      },
      revision: {
        type: "integer",
        minimum: 1,
        maximum: 9007199254740991,
      },
    },
    required: ["entityType", "entityId", "revision"],
  },
  Metadata: {
    type: "object",
    properties: {
      generationId: {
        type: "integer",
        minimum: 1,
        maximum: 9007199254740991,
      },
      projectionVersion: {
        const: "1.0.0",
      },
      scope: {
        const: "company_all_real_and_unattributed",
      },
      sourceObservationWindow: {
        type: "object",
        properties: {
          from: {
            type: "string",
            format: "date-time",
          },
          to: {
            type: "string",
            format: "date-time",
          },
        },
        required: ["from", "to"],
      },
      publishedAt: {
        type: "string",
        format: "date-time",
      },
      expiresAt: {
        type: "string",
        format: "date-time",
      },
      changeUpper: {
        type: "integer",
        minimum: 0,
        maximum: 9007199254740991,
      },
      sourceAgeSeconds: {
        type: "integer",
        minimum: 0,
        maximum: 9007199254740991,
      },
      freshnessTargetSeconds: {
        const: 900,
      },
      stale: {
        type: "boolean",
      },
      consistency: {
        const: "sealed_reporting_generation_with_per_page_source_snapshot",
      },
      counts: {
        type: "object",
      },
    },
    required: [
      "generationId",
      "projectionVersion",
      "scope",
      "sourceObservationWindow",
      "publishedAt",
      "expiresAt",
      "changeUpper",
      "sourceAgeSeconds",
      "freshnessTargetSeconds",
      "stale",
      "consistency",
      "counts",
    ],
  },
  BookingPage: {
    allOf: [
      {
        $ref: "#/components/schemas/Metadata",
      },
      {
        type: "object",
        properties: {
          entityType: {
            enum: ["booking", "business", "mixed"],
          },
          items: {
            type: "array",
            items: {
              $ref: "#/components/schemas/Entity",
            },
          },
          nextCursor: {
            type: ["string", "null"],
          },
          resumeCursor: {
            type: "string",
          },
          complete: {
            type: "boolean",
          },
          checkpointInstructions: {
            type: "string",
          },
        },
        required: [
          "entityType",
          "items",
          "nextCursor",
          "resumeCursor",
          "complete",
          "checkpointInstructions",
        ],
      },
    ],
  },
  BusinessPage: {
    allOf: [
      {
        $ref: "#/components/schemas/Metadata",
      },
      {
        type: "object",
        properties: {
          entityType: {
            enum: ["booking", "business", "mixed"],
          },
          items: {
            type: "array",
            items: {
              $ref: "#/components/schemas/Entity",
            },
          },
          nextCursor: {
            type: ["string", "null"],
          },
          resumeCursor: {
            type: "string",
          },
          complete: {
            type: "boolean",
          },
          checkpointInstructions: {
            type: "string",
          },
        },
        required: [
          "entityType",
          "items",
          "nextCursor",
          "resumeCursor",
          "complete",
          "checkpointInstructions",
        ],
      },
    ],
  },
  ChangePage: {
    allOf: [
      {
        $ref: "#/components/schemas/Metadata",
      },
      {
        type: "object",
        properties: {
          entityType: {
            enum: ["booking", "business", "mixed"],
          },
          items: {
            type: "array",
            items: {
              $ref: "#/components/schemas/Change",
            },
          },
          nextCursor: {
            type: ["string", "null"],
          },
          resumeCursor: {
            type: "string",
          },
          complete: {
            type: "boolean",
          },
          checkpointInstructions: {
            type: "string",
          },
        },
        required: [
          "entityType",
          "items",
          "nextCursor",
          "resumeCursor",
          "complete",
          "checkpointInstructions",
        ],
      },
    ],
  },
  CataloguePage: {
    allOf: [
      {
        $ref: "#/components/schemas/Metadata",
      },
      {
        type: "object",
        properties: {
          entityType: {
            enum: ["booking", "business", "mixed"],
          },
          items: {
            type: "array",
            items: {
              $ref: "#/components/schemas/CatalogueEntry",
            },
          },
          nextCursor: {
            type: ["string", "null"],
          },
          resumeCursor: {
            type: "string",
          },
          complete: {
            type: "boolean",
          },
          checkpointInstructions: {
            type: "string",
          },
        },
        required: [
          "entityType",
          "items",
          "nextCursor",
          "resumeCursor",
          "complete",
          "checkpointInstructions",
        ],
      },
    ],
  },
  Status: {
    allOf: [
      {
        $ref: "#/components/schemas/Metadata",
      },
      {
        type: "object",
        properties: {
          ready: {
            const: true,
          },
        },
        required: ["ready"],
      },
    ],
  },
  Capabilities: {
    type: "object",
    required: [
      "apiVersion",
      "endpoints",
      "quotes",
      "sourceWrites",
      "providerCalls",
    ],
    properties: {
      apiVersion: {
        const: "1.0.0",
      },
      endpoints: {
        type: "array",
        items: {
          type: "string",
        },
      },
      quotes: {
        const: false,
      },
      sourceWrites: {
        const: false,
      },
      providerCalls: {
        const: false,
      },
    },
  },
  Error: {
    type: "object",
    properties: {
      error: {
        type: "object",
        properties: {
          code: {
            type: "string",
          },
          message: {
            type: "string",
          },
          requestId: {
            type: "string",
          },
        },
        required: ["code", "message"],
      },
    },
    required: ["error"],
  },
} as const;
