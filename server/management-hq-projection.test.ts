import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type {
  HqWireBookingPayload,
  HqWireEntity,
  HqWireMemberLink,
  HqWireMetadata,
} from "../shared/management-hq-wire";
import type { HqImplementedState } from "./management-hq-ingestion";
import {
  exportHqReportCsv,
  getHqReport,
  canonicalHqJson,
  type HqIdentityDirectory,
} from "./management-hq-engine";
import { hqWirePence, projectHqWireBooking } from "./management-hq-projection";
import { HQ_WIRE_SCHEMAS } from "./management-hq-wire-schemas";
import { validateHqWireDeclaredSchema } from "./management-hq-wire-contract";
const examples = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/management-hq-projection-examples.json",
      import.meta.url
    ),
    "utf8"
  )
);
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function booking(scenario = "beforeAmendment"): HqWireEntity {
  const { entityType, entityId, revision, payload } =
    examples[scenario].body.items[0];
  return copy({ entityType, entityId, revision, payload });
}
const payload = (b: HqWireEntity) => b.payload as HqWireBookingPayload;
function business(b = booking()): HqWireEntity {
  const p = payload(b);
  return {
    entityType: "business",
    entityId: p.orbitTenantId!,
    revision: 1,
    payload: {
      orbitTenantId: p.orbitTenantId!,
      isActive: true,
      account: { name: "Synthetic business", type: "real" },
      identity: copy(p.identity),
      configuredCardFeeRates: {},
      membershipHistoryAvailable: false,
      portalMembershipJoinDate: null,
    },
  };
}
function state(
  b = booking(),
  mapping: HqWireEntity | null = business(b),
  scenario = "beforeAmendment"
): HqImplementedState {
  const source = examples[scenario].body;
  const {
    generationId,
    projectionVersion,
    scope,
    sourceObservationWindow,
    publishedAt,
    expiresAt,
    changeUpper,
    sourceAgeSeconds,
    freshnessTargetSeconds,
    stale,
    consistency,
    counts,
  } = source;
  const metadata: HqWireMetadata = {
    generationId,
    projectionVersion,
    scope,
    sourceObservationWindow: copy(sourceObservationWindow),
    publishedAt,
    expiresAt,
    changeUpper,
    sourceAgeSeconds,
    freshnessTargetSeconds,
    stale,
    consistency,
    counts: copy(counts),
  };
  const entities: HqImplementedState["entities"] = {};
  for (const entity of [b, ...(mapping ? [mapping] : [])])
    entities[`${entity.entityType}:${entity.entityId}`] = {
      entity,
      canonicalPayload: canonicalHqJson(entity),
      absent: false,
    };
  return {
    wireVersion: "1.0.0",
    version: 1,
    scope: "company_all_real_and_unattributed",
    resumeCursor: source.resumeCursor,
    metadata,
    entities,
    seqProofs: {},
  };
}
const owner = {
  userId: 101,
  uniqueAgentId: "JLT-101",
  name: "Existing owner",
  role: "agent",
};
const staff = {
  userId: 47,
  uniqueAgentId: null,
  name: "Existing staff",
  role: "staff",
};
function directory(): HqIdentityDirectory {
  return {
    resolve: vi.fn(async () => {
      throw new Error("historical seller should never resolve");
    }),
    resolveCurrentOwner: vi.fn(async () => owner),
    resolveAssignedStaff: vi.fn(async () => staff),
  };
}
async function report(
  b = booking(),
  mapping: HqWireEntity | null = business(b),
  dir = directory()
) {
  return getHqReport(state(b, mapping), dir, { year: 2026 });
}

describe("implemented 200 source examples, exact finance projection and report", () => {
  it.each([
    ["beforeAmendment", "10000.00", "1500.00", "979.28", 1, 0, 1],
    ["afterAmendment", "11000.00", "2500.00", "1644.69", 1, 0, 1],
    ["afterCancellation", null, null, null, 0, 1, 1],
    ["afterLaterRegistration", null, null, null, 0, 1, 2],
  ] as const)(
    "projects actual HTTP 200 %s without old draft-envelope adaptation",
    async (scenario, gross, profit, baseline, count, cancelled, month) => {
      const b = booking(scenario),
        dir = directory();
      const r = await getHqReport(state(b, business(b), scenario), dir, {
        year: 2026,
      });
      expect(examples[scenario].httpStatus).toBe(200);
      expect(r.status).toBe("available");
      expect(r.liveReady).toBe(false);
      expect(r.totals.grossSales.knownSum).toBe(gross);
      expect(r.totals.grossProfit.knownSum).toBe(profit);
      expect(r.totals.baselineAgentCommission.knownSum).toBe(baseline);
      expect(r.totals.bookingCount).toBe(count);
      expect(r.cohorts.cancelledCount).toBe(cancelled);
      expect(r.bookings[0].reportingDate?.slice(5, 7)).toBe(
        String(month).padStart(2, "0")
      );
      expect(r.generationId).toBe(examples[scenario].body.generationId);
      expect(r.snapshotId).toBe(String(r.generationId));
      expect(r.watermark).toBe("");
      expect(r.sourceObservationWindow).toEqual(
        examples[scenario].body.sourceObservationWindow
      );
      expect(r.publishedAt).toBe(examples[scenario].body.publishedAt);
      expect(r.sourceAgeSeconds).toBe(0);
      expect(r.stale).toBe(false);
      expect(dir.resolve).not.toHaveBeenCalled();
      expect(r.bookings[0].seller).toBeNull();
      expect(r.bookings[0].processor).toBeNull();
      expect(r.bookings[0].currentOwner).toEqual(owner);
      expect(r.bookings[0].assignedStaff).toEqual(staff);
      expect(r.bookings[0].attributionState).toBe("provisional_current_owner");
      expect(r.agents[0].attributionState).toBe("provisional_current_owner");
      expect(JSON.stringify(r)).not.toContain(
        examples[scenario].body.resumeCursor
      );
      expect(r.limitations.join(" ")).toMatch(/Implemented.*offline/);
    }
  );
  it.each([
    [25.9, 2590],
    [244.82, 24482],
    [979.28, 97928],
    [0, 0],
    [-0.01, -1],
    ["123.4500", 12345],
    [0.1, 10],
    [null, null],
    [undefined, null],
    [0.30000000000000004, null],
    [1.001, null],
    ["1.001", null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    [9007199254740991, null],
    ["90071992547409.92", null],
    ["1e2", null],
    ["-0.00", 0],
  ] as const)(
    "converts decimal spelling %j to exact safe pennies %j without floating rounding",
    (input, expected) => {
      expect(hqWirePence(input)).toBe(expected);
    }
  );
  it("passes through gross/net/profit/VAT/PTS/baseline shares/residual and keeps actual/settlement unknown", async () => {
    const b = booking();
    payload(b).financials.estimatedCardProcessingFees = 12.34;
    payload(b).financials.knownPpsFeeEstimateSubtotal = 8.76;
    payload(b).financials.baselineEstimate.splitRoundingResidualPence = -1;
    const r = await report(b),
      f = r.bookings[0].financials;
    expect(f).toMatchObject({
      gross: "10000.00",
      supplierNet: "8500.00",
      grossProfit: "1500.00",
      applicableVat: "250.00",
      ptsFees: "25.90",
      estimatedCardFees: "12.34",
      knownPpsFeeEstimateSubtotal: "8.76",
      baselineAgentCommission: "979.28",
      baselineJltRetainedCommission: "244.82",
      completeAgentCommission: null,
      actualCardFees: null,
      settledJltIncome: null,
    });
    expect(f.baseline).toMatchObject({
      netDistributableCommission: "1224.10",
      roundingResidual: "-0.01",
      complete: false,
      terms: { state: "stated_default_unverified" },
    });
    expect(f.policyComplete).toBe(false);
    expect(r.totals.ptsFees).toMatchObject({
      knownSum: "25.90",
      estimatedCount: 1,
    });
    expect(r.totals.actualCardFees.knownSum).toBeNull();
    expect(r.totals.estimatedCardFees.knownSum).toBe("12.34");
  });
  it("missing net cost remains unknown, explicit zero remains covered", async () => {
    const missing = booking();
    payload(missing).financials.totalNetCost = null;
    payload(missing).financials.netCostStatus = "incomplete";
    payload(missing).financials.completeness.economicsStatus = "incomplete";
    const mr = await report(missing);
    expect(mr.totals.supplierNetCost.knownSum).toBeNull();
    expect(mr.totals.grossSales.knownSum).toBe("10000.00");
    expect(mr.totals.grossProfit.knownSum).toBeNull();
    expect(mr.totals.weightedMargin.coveredCount).toBe(0);
    const zero = booking();
    payload(zero).financials.totalNetCost = 0;
    payload(zero).financials.grossBookingProfit = 0;
    payload(zero).financials.weightedMarginContribution.profitPence = 0;
    const zr = await report(zero);
    expect(zr.totals.supplierNetCost.knownSum).toBe("0.00");
    expect(zr.totals.grossProfit.knownSum).toBe("0.00");
    expect(zr.totals.weightedMargin.fraction).toBe("0.000000");
  });
  it("weighted margin uses only supplied matching contribution, never broad gross or mean row margin", async () => {
    const b = booking();
    payload(b).financials.weightedMarginContribution = {
      profitPence: -100,
      coveredGrossPence: 1000,
      methodology:
        "sum_profit_pence_divided_by_matching_sum_covered_gross_pence_times_100",
    };
    const r = await report(b);
    expect(r.totals.grossSales.knownSum).toBe("10000.00");
    expect(r.totals.weightedMargin).toEqual({
      fraction: "-0.100000",
      coveredCount: 1,
      coveredGross: "10.00",
      coveredProfit: "-1.00",
    });
    const missing = copy(b);
    missing.entityId = 2;
    payload(missing).orbitBookingId = 2;
    payload(missing).financials.weightedMarginContribution.profitPence = null;
    const s = state(b);
    s.entities["booking:2"] = {
      entity: missing,
      canonicalPayload: canonicalHqJson(missing),
      absent: false,
    };
    const both = await getHqReport(s, directory(), { year: 2026 });
    expect(both.totals.grossSales.knownSum).toBe("20000.00");
    expect(both.totals.weightedMargin).toEqual(r.totals.weightedMargin);
  });
  it("negative profit and zero denominator remain signed/unknown without absolute or divide-by-zero fabrication", async () => {
    const b = booking();
    payload(b).financials.grossBookingProfit = -123.45;
    payload(b).financials.weightedMarginContribution.profitPence = -12345;
    payload(b).financials.weightedMarginContribution.coveredGrossPence = 0;
    const r = await report(b);
    expect(r.totals.grossProfit.knownSum).toBe("-123.45");
    expect(r.totals.weightedMargin.fraction).toBeNull();
    expect(r.totals.weightedMargin.coveredGross).toBe("0.00");
  });
  it("unsafe/subpenny money does not become a rounded financial value", async () => {
    const b = booking();
    payload(b).financials.grossBookingValue = 1.001;
    payload(b).financials.estimatedPtsFees = 0.30000000000000004;
    const r = await report(b);
    expect(r.totals.grossSales.knownSum).toBeNull();
    expect(r.bookings[0].financials.ptsFees).toBeNull();
    expect(r.bookings[0].financials.amountStates.ptsFees.state).toBe("invalid");
  });
  it("cancelled stored gross/net are retained in drilldown but headline, profit and income excluded", async () => {
    const r = await report(booking("afterCancellation"));
    expect(r.totals.bookingCount).toBe(0);
    expect(r.totals.grossSales.knownSum).toBeNull();
    expect(r.bookings[0].financials).toMatchObject({
      gross: "11000.00",
      supplierNet: "8500.00",
      grossProfit: null,
      cancellationRetainedCommission: null,
      sourceStatus: { baseline: "excluded", economics: "excluded" },
    });
  });
  it("provisional candidate with false historical/source flags is never marked verified seller", async () => {
    const b = booking(),
      projected = projectHqWireBooking(b, business(b));
    expect(projected.originalSellingAgent.state).toBe("missing");
    expect(projected.originalSellingBusiness.state).toBe("missing");
    expect(projected.processingAdministrator.state).toBe("missing");
    expect(projected.dates.dateRuleVersion).toBe("");
    expect(projected.financials.policyVersion).toBe("");
    const r = await report(b);
    expect(r.bookings[0].sellerReason).toBe("ORIGINAL_SELLER_NOT_VERIFIED");
    expect(r.agents[0].attributionState).toBe("provisional_current_owner");
  });
  it.each(["missing", "deleted", "absent"] as const)(
    "keeps company booking but suppresses embedded owner after business %s",
    async mode => {
      const b = booking(),
        s = state(b, mode === "missing" ? null : business(b));
      if (mode === "deleted")
        s.entities["business:90052"].entity.payload = {
          deleted: true,
          reason: "source_absent_or_now_explicit_demo",
          entityType: "business",
          entityId: 90052,
        };
      if (mode === "absent") s.entities["business:90052"].absent = true;
      const dir = directory(),
        r = await getHqReport(s, dir, { year: 2026 });
      expect(r.totals.grossSales.knownSum).toBe("10000.00");
      expect(r.bookings[0].currentOwner).toBeNull();
      expect(r.bookings[0].currentOwnerReason).toBe(
        "CURRENT_BUSINESS_MAPPING_UNAVAILABLE"
      );
      expect(r.bookings[0].attributionState).toBe("unresolved");
      expect(r.agents).toHaveLength(0);
      expect(dir.resolveCurrentOwner).not.toHaveBeenCalled();
    }
  );
  it("business-only remapping uses current authoritative member, not stale embedded booking owner", async () => {
    const b = booking(),
      mapping = business(b),
      link = (mapping.payload as any).identity as HqWireMemberLink;
    link.memberJltAgentId = "REPLACEMENT";
    link.memberJltOpenId = "replacement-open";
    for (const m of [...link.ownerCandidates, ...link.members].filter(
      m => m.role === "owner"
    )) {
      m.jltAgentId = "REPLACEMENT";
      m.jltOpenId = "replacement-open";
    }
    const dir = directory();
    dir.resolveCurrentOwner = vi.fn(async l =>
      l.memberJltAgentId === "REPLACEMENT" ? { ...owner, userId: 102 } : null
    );
    const r = await report(b, mapping, dir);
    expect(r.bookings[0].currentOwner?.userId).toBe(102);
    expect(r.bookings[0].seller).toBeNull();
    expect(r.totals.grossSales.knownSum).toBe("10000.00");
  });
  it("employee resolution is no owner fallback; staff remains distinct from null processor", async () => {
    const dir = directory();
    dir.resolveCurrentOwner = vi.fn(async () => staff);
    const r = await report(booking(), business(), dir);
    expect(r.agents).toHaveLength(0);
    expect(r.bookings[0].currentOwner).toBeNull();
    expect(r.bookings[0].currentOwnerReason).toBe(
      "CURRENT_OWNER_MEMBER_NOT_AGENT"
    );
    expect(r.bookings[0].assignedStaff).toEqual(staff);
    expect(r.bookings[0].processor).toBeNull();
  });
  it("inactive current real businesses and owners remain in company booking cohorts", async () => {
    const b = booking(),
      mapping = business(b);
    (mapping.payload as any).isActive = false;
    const link = (mapping.payload as any).identity;
    link.members[0].isActive = false;
    link.ownerCandidates[0].isActive = false;
    const r = await report(b, mapping);
    expect(r.totals.bookingCount).toBe(1);
    expect(r.totals.grossSales.knownSum).toBe("10000.00");
    expect(r.bookings[0].currentOwner).toEqual(owner);
  });
  it("unknown diagnostics/callbacks/tokens/evidence IDs and raw checkpoints cannot reach report or CSV", async () => {
    const b = booking(),
      p: any = payload(b);
    p.rawCallback = "SECRET-CALLBACK";
    p.customer = { token: "SECRET-TOKEN" };
    p.products[0].bookingToken = "SECRET-SUPPLIER";
    p.payments = [{ providerTransactionId: "SECRET-TRANSACTION" }];
    p.financials.completeness.policyReasons.push("SECRET-EVIDENCE");
    p.identity.reason = "SECRET-LINK";
    p.financials.baselineEstimate.rounding = "SECRET-ROUNDING";
    const s = state(b);
    (s.metadata as any).diagnostics = "SECRET-METADATA";
    (s.metadata.sourceObservationWindow as any).token = "SECRET-WINDOW";
    const r = await getHqReport(s, directory(), { year: 2026 }),
      csv = exportHqReportCsv(r);
    expect(JSON.stringify(r)).not.toMatch(
      /SECRET|resumeCursor|rawCallback|evidenceIds|bookingToken|providerTransactionId/
    );
    expect(csv).not.toMatch(/SECRET/);
    expect(csv).toContain("Provisional current owner");
    expect(csv).toContain("Assigned staff");
    expect(csv).toContain("provisional_current_owner");
  });
});

describe("declared-schema compatibility, not optional diagnostics as approval", () => {
  it("required payload fields suffice for gross/net/profit without optional eligible/net status diagnostics", async () => {
    const b = booking(),
      p: any = payload(b),
      schema: any = HQ_WIRE_SCHEMAS;
    const retainRequired = (value: any, name: string) =>
      Object.fromEntries(
        schema[name].required.map((key: string) => [key, value[key]])
      );
    b.payload = retainRequired(p, "BookingPayload") as HqWireBookingPayload;
    const minimal: any = payload(b);
    minimal.financials = retainRequired(minimal.financials, "Financials");
    minimal.financials.completeness = Object.fromEntries(
      schema.Financials.properties.completeness.required.map((key: string) => [
        key,
        minimal.financials.completeness[key],
      ])
    );
    minimal.financials.baselineEstimate = Object.fromEntries(
      schema.Financials.properties.baselineEstimate.required.map(
        (key: string) => [key, minimal.financials.baselineEstimate[key]]
      )
    );
    expect(minimal.financials.netCostStatus).toBeUndefined();
    expect(minimal.financials.economicProfitEligible).toBeUndefined();
    expect(minimal.financials.headlineEligible).toBeUndefined();
    expect(() =>
      validateHqWireDeclaredSchema("BookingPayload", minimal)
    ).not.toThrow();
    const r = await report(b);
    expect(r.status).toBe("available");
    expect(r.totals.grossSales.knownSum).toBe("10000.00");
    expect(r.totals.supplierNetCost.knownSum).toBe("8500.00");
    expect(r.totals.grossProfit.knownSum).toBe("1500.00");
    expect(r.totals.weightedMargin.fraction).toBe("0.150000");
    expect(r.bookings[0].financials.sourceGrossMarginPct).toBe("15");
  });
  it("free-form account type cannot silently exclude a booking that the scoped source feed includes", async () => {
    const b = booking(),
      mapping = business(b);
    (mapping.payload as any).account = { accountType: "demo", type: "demo" };
    const r = await report(b, mapping);
    expect(r.totals.bookingCount).toBe(1);
    expect(r.totals.grossSales.knownSum).toBe("10000.00");
    expect(r.cohorts.excludedDemoCount).toBe(0);
  });
});
