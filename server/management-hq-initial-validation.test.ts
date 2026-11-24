import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import supplied from "./fixtures/management-hq-implemented-http-examples.json";
import type {
  HqWireBookingPayload,
  HqWireEntity,
} from "../shared/management-hq-wire";
import type { HqImplementedState } from "./management-hq-ingestion";
import type { HqLiveStatusDto } from "./management-hq-live-service";
import { canonicalHqJson, getHqReport } from "./management-hq-engine";
import { createPortalHqImplementedDirectory } from "./management-hq-identity";
import { validateHqInitialPublication } from "./management-hq-initial-validation";
import * as liveReport from "./management-hq-live-report";

// Only the existing merge resolver's operational dependency is replaced. The
// actual live report, wire validator, exact-pence engine and CRM/OAuth resolver
// execute. No DB, source/client/service/status calls, environment or app startup.
vi.mock("./agent-merge-identity", () => ({
  getAgentMergeTarget: vi.fn(async () => null),
}));
const NOW = Date.parse("2026-11-24T16:00:00.000Z");
const SECRET =
  "private-key https://private.example/cursor?q=token person@example.test raw-person raw-booking-reference";
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const stageKeys = {
  initial: "beforeAmendment",
  amended: "afterAmendment",
  cancelled: "afterCancellation",
} as const;
function publication(
  stage: keyof typeof stageKeys = "initial"
): HqImplementedState {
  const body = copy(supplied[stageKeys[stage]].body);
  const item = body.items[0];
  const booking: HqWireEntity = {
    entityType: "booking",
    entityId: item.entityId,
    revision: item.revision,
    payload: copy(item.payload),
  } as HqWireEntity;
  const p = booking.payload as HqWireBookingPayload;
  const business: HqWireEntity = {
    entityType: "business",
    entityId: p.orbitTenantId!,
    revision: 1,
    payload: {
      orbitTenantId: p.orbitTenantId!,
      isActive: false,
      account: { businessName: "raw-person", accountType: "real" },
      identity: copy(p.identity),
      configuredCardFeeRates: {},
      membershipHistoryAvailable: false,
      portalMembershipJoinDate: null,
    },
  };
  const {
    generationId,
    projectionVersion,
    scope,
    changeUpper,
    freshnessTargetSeconds,
    consistency,
    counts,
  } = body;
  const state: HqImplementedState = {
    wireVersion: "1.0.0",
    version: 2,
    scope,
    resumeCursor: "offline-opaque-checkpoint",
    seqProofs: {},
    entities: {},
    metadata: {
      generationId,
      projectionVersion,
      scope,
      changeUpper,
      freshnessTargetSeconds,
      consistency,
      counts,
      sourceObservationWindow: {
        from: "2026-11-24T15:59:58.000Z",
        to: "2026-11-24T15:59:59.000Z",
      },
      publishedAt: "2026-11-24T16:00:00.000Z",
      expiresAt: "2026-11-25T16:00:00.000Z",
      sourceAgeSeconds: 1,
      stale: false,
    },
  };
  for (const entity of [booking, business]) put(state, entity);
  return state;
}
function put(state: HqImplementedState, entity: HqWireEntity, absent = false) {
  state.entities[`${entity.entityType}:${entity.entityId}`] = {
    entity: copy(entity),
    canonicalPayload: canonicalHqJson(entity),
    absent,
  };
}
function booking(state: HqImplementedState): HqWireEntity {
  return Object.values(state.entities).find(
    r => r.entity.entityType === "booking"
  )!.entity;
}
function changeBooking(
  state: HqImplementedState,
  edit: (p: HqWireBookingPayload) => void
) {
  const entity = copy(booking(state));
  edit(entity.payload as HqWireBookingPayload);
  put(state, entity);
}
function setDate(entity: HqWireEntity, date: string | null) {
  const p = entity.payload as HqWireBookingPayload;
  p.dates = {
    ...p.dates,
    portalRegisteredAt: null,
    bookedOn: date,
    managementDate: date,
    dateSource: date === null ? "unavailable" : "booked_on",
    month: date?.slice(0, 7) ?? null,
  };
  p.eligibility.undated = date === null;
  if (date === null) {
    p.eligibility.activeSalesHeadline = false;
    p.financials.headlineEligible = false;
  }
}
function status(state: HqImplementedState): HqLiveStatusDto {
  return {
    configured: true,
    syncEnabled: true,
    readEnabled: false,
    configurationCode: "CONFIGURED",
    configurationMessage: "fixed",
    intervalSeconds: 900,
    freshnessSeconds: 900,
    health: "ready",
    hasPublished: true,
    stateVersion: 8,
    generationId: state.metadata.generationId,
    lastAttemptAt: "2026-11-24T16:00:00.000Z",
    lastSuccessfulCheckAt: "2026-11-24T16:00:00.000Z",
    lastPublishedAt: "2026-11-24T16:00:00.000Z",
    nextDueAt: null,
    lastErrorCode: null,
    recoveryGuidance: null,
    stageStatus: "applied",
    progress: null,
    sourceObservationAt: state.metadata.sourceObservationWindow.to,
    sourcePublishedAt: state.metadata.publishedAt,
    sourceAgeSeconds: 1,
    freshnessTargetSeconds: 900,
    isStale: false,
  } as unknown as HqLiveStatusDto;
}
function offlineDb(
  sets: any[][] = [],
  onRead?: (index: number) => Promise<void>
) {
  let index = 0;
  const tables: unknown[] = [];
  const conditions: any[] = [];
  const select = vi.fn(() => {
    const rows = sets.shift() ?? [];
    const q: any = {
      from: (table: unknown) => {
        tables.push(table);
        return q;
      },
      leftJoin: () => q,
      where: (condition: unknown) => {
        conditions.push(condition);
        return q;
      },
      limit: vi.fn(async () => {
        if (onRead) await onRead(index++);
        return rows;
      }),
    };
    return q;
  });
  return { select, tables, conditions };
}
function matchingRows() {
  const owner = {
    id: 101,
    name: "raw-person",
    role: "agent",
    uniqueAgentId: "SYN-MEMBER-1",
  };
  const staff = {
    id: 102,
    name: "raw-person",
    role: "staff",
    uniqueAgentId: "SYN-STAFF-1",
  };
  return [
    [{ userId: 101, uniqueAgentId: "SYN-MEMBER-1" }],
    [owner],
    [{ userId: 101, openId: "synthetic-owner-open-id" }],
    [owner],
    [{ userId: 102, uniqueAgentId: "SYN-STAFF-1" }],
    [staff],
    [{ userId: 102, openId: "synthetic-staff-open-id" }],
    [staff],
  ];
}
const expectSuppressed = (
  result: Awaited<ReturnType<typeof validateHqInitialPublication>>
) => {
  expect(result).toMatchObject({
    status: "needs_attention",
    generationId: null,
    sourcePublishedAt: null,
    years: [],
    manualChecksPending: true,
  });
  expect(result.message).toContain("checks_not_current");
  expect(JSON.stringify(result)).not.toMatch(
    /private-key|private\.example|person@|raw-person|raw-booking-reference|offline-opaque/
  );
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("initial HQ validation: sealed bounded publication only", () => {
  it("preserves actual known financials while keeping manual acceptance and flags off", async () => {
    const state = publication();
    const safe = status(state);
    const before = copy({ state, safe });
    const db = offlineDb(matchingRows());
    const result = await validateHqInitialPublication(state, db, safe);
    expect(result).toMatchObject({
      status: "checks_ready",
      generationId: 1,
      isStale: false,
      manualChecksPending: true,
      years: [
        {
          year: 2026,
          activeBookings: 1,
          grossSales: "10000.00",
          grossSalesMissing: 0,
          grossProfit: "1500.00",
          grossProfitMissing: 0,
          cancelledBookings: 0,
          pendingBookings: 0,
          undatedBookings: 0,
          unattributedBookings: 0,
        },
      ],
    });
    expect(db.select).toHaveBeenCalledTimes(8);
    expect(result.limitations.join(" ")).toMatch(
      /provisional.*never verified original/
    );
    expect(result.limitations.join(" ")).toContain("not all-fees entitlement");
    expect(result.limitations.join(" ")).toContain("MANUAL pending");
    expect(result.limitations.join(" ")).not.toMatch(
      /JLT-5707|verified amendment|all accepted/
    );
    expect({ state, safe }).toEqual(before);
    expect(Object.keys(result).sort()).toEqual(
      [
        "status",
        "message",
        "generationId",
        "checkedAt",
        "sourcePublishedAt",
        "isStale",
        "years",
        "manualChecksPending",
        "limitations",
      ].sort()
    );
    expect(JSON.stringify(result)).not.toMatch(
      /SYN-HQ|SYN-MEMBER|Synthetic|raw-person|resumeCursor|products|payments|watermark|snapshotId|ownerTenantUserId/
    );
  });
  it("exactly passes through the existing engine totals, not gross minus invented costs", async () => {
    const state = publication();
    changeBooking(state, p => {
      p.financials.grossBookingProfit = 731.29;
    });
    const expected = await getHqReport(
      state,
      createPortalHqImplementedDirectory(offlineDb(matchingRows())),
      { year: 2026 }
    );
    const result = await validateHqInitialPublication(
      state,
      offlineDb(matchingRows()),
      status(state)
    );
    expect(result.years[0].grossSales).toBe(
      expected.totals.grossSales.knownSum
    );
    expect(result.years[0].grossProfit).toBe(
      expected.totals.grossProfit.knownSum
    );
    expect(result.years[0].grossProfit).toBe("731.29");
  });
  it("reports missing inputs as unknown, not zero", async () => {
    const state = publication();
    changeBooking(state, p => {
      p.financials.grossBookingValue = null;
      p.financials.totalNetCost = null;
      p.financials.netCostStatus = "missing";
    });
    const result = await validateHqInitialPublication(
      state,
      offlineDb(),
      status(state)
    );
    expect(result.status).toBe("checks_ready");
    expect(result.years[0]).toMatchObject({
      activeBookings: 1,
      grossSales: null,
      grossSalesMissing: 1,
      grossProfit: null,
      grossProfitMissing: 1,
    });
  });
  it("rejects source sub-penny values through the existing wire validator", async () => {
    const state = publication();
    changeBooking(state, p => {
      p.financials.grossBookingValue = 100.001;
    });
    const db = offlineDb();
    expectSuppressed(
      await validateHqInitialPublication(state, db, status(state))
    );
    expect(db.select).not.toHaveBeenCalled();
  });
  it("a truly empty publication reports current year only with unknown, not healthy-zero financials", async () => {
    const state = publication();
    state.entities = {};
    state.metadata.counts = { bookingCount: 0, businessCount: 0 };
    const db = offlineDb();
    const result = await validateHqInitialPublication(state, db, status(state));
    expect(result.status).toBe("checks_ready");
    expect(result.years).toEqual([
      {
        year: 2026,
        activeBookings: 0,
        grossSales: null,
        grossSalesMissing: 0,
        grossProfit: null,
        grossProfitMissing: 0,
        cancelledBookings: 0,
        pendingBookings: 0,
        undatedBookings: 0,
        unattributedBookings: 0,
      },
    ]);
    expect(db.select).not.toHaveBeenCalled();
  });
  it("absence awaits import without manufacturing a publication", async () => {
    const state = publication();
    const safe = {
      ...status(state),
      hasPublished: false,
      health: "no_data",
      stageStatus: "idle",
      generationId: null,
      stateVersion: null,
    } as HqLiveStatusDto;
    const db = offlineDb();
    const result = await validateHqInitialPublication(
      null as unknown as HqImplementedState,
      db,
      safe
    );
    expect(result).toMatchObject({
      status: "awaiting_import",
      generationId: null,
      years: [],
      manualChecksPending: true,
    });
    expect(db.select).not.toHaveBeenCalled();
  });
  it.each(["progress", "backoff", "needs_attention"] as const)(
    "absent %s state is not an awaiting-success claim",
    async health => {
      const safe = { ...status(publication()), hasPublished: false, health };
      expectSuppressed(
        await validateHqInitialPublication(
          null as unknown as HqImplementedState,
          offlineDb(),
          safe
        )
      );
    }
  );
  it.each([
    ["configured", false],
    ["syncEnabled", false],
    ["readEnabled", true],
    ["hasPublished", false],
    ["generationId", 2],
    ["stateVersion", 1],
    ["stateVersion", null],
    ["stateVersion", 8.5],
    ["health", "progress"],
    ["health", "backoff"],
    ["health", "stale"],
    ["health", "needs_attention"],
    ["stageStatus", "running"],
    ["stageStatus", "progress"],
    ["stageStatus", "backoff"],
    ["stageStatus", "needs_attention"],
    [
      "progress",
      { kind: "backfill", phase: "bookings", pages: 1, recordsRead: 1 },
    ],
    ["lastErrorCode", "TIMEOUT"],
    ["recoveryGuidance", "investigate_before_explicit_protected_recovery"],
    ["sourceObservationAt", null],
    ["sourcePublishedAt", null],
    ["lastSuccessfulCheckAt", null],
  ])(
    "rejects unsafe or mismatched safe status %s=%j before reading directory",
    async (field, value) => {
      const state = publication();
      const safe = status(state);
      (safe as unknown as Record<string, unknown>)[field] = value;
      const db = offlineDb();
      expectSuppressed(await validateHqInitialPublication(state, db, safe));
      expect(db.select).not.toHaveBeenCalled();
    }
  );
  it.each([undefined, "1", -1, 0.5, 0, 2, NaN])(
    "rejects malformed or mismatched pinned booking count %j",
    async count => {
      const state = publication();
      state.metadata.counts.bookingCount = count;
      const db = offlineDb();
      expectSuppressed(
        await validateHqInitialPublication(state, db, status(state))
      );
      expect(db.select).not.toHaveBeenCalled();
    }
  );
  it("rejects business count drift, incomplete children and canonical payload tampering", async () => {
    for (const mutation of [
      (s: HqImplementedState) => {
        s.metadata.counts.businessCount = 0;
      },
      (s: HqImplementedState) =>
        changeBooking(s, p => {
          (p as any).childrenComplete = false;
        }),
      (s: HqImplementedState) => {
        Object.values(s.entities)[0].canonicalPayload = SECRET;
      },
      (s: HqImplementedState) => {
        (s.metadata as any).consistency = "partial";
      },
    ]) {
      const state = publication();
      mutation(state);
      const db = offlineDb();
      expectSuppressed(
        await validateHqInitialPublication(state, db, status(state))
      );
      expect(db.select).not.toHaveBeenCalled();
    }
  });
  it("uses the existing 16 MiB state boundary, without salvaging partial rows", async () => {
    const state = publication();
    state.metadata.diagnostics = "x".repeat(16 * 1024 * 1024);
    const db = offlineDb();
    expectSuppressed(
      await validateHqInitialPublication(state, db, status(state))
    );
    expect(db.select).not.toHaveBeenCalled();
  });
  it("retains existing report row ceiling rather than bypassing the financial engine", async () => {
    const state = publication();
    // Valid bounded tombstones make the existing report's 20,000-entity cap fail
    // before directory reads while remaining inside the 100,000-record state cap.
    for (let id = 1; id <= 20001; id++) {
      if (state.entities[`booking:${id}`]) continue;
      put(state, {
        entityType: "booking",
        entityId: id,
        revision: 1,
        payload: {
          deleted: true,
          entityType: "booking",
          entityId: id,
          reason: "source_absent_or_now_explicit_demo",
        },
      });
    }
    const db = offlineDb();
    expectSuppressed(
      await validateHqInitialPublication(state, db, status(state))
    );
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe("actual source-selected years, amendments and cancellation structure", () => {
  it("uses each actual management year, including 2000 and 2100, not current year by default", async () => {
    const state = publication();
    const first = copy(booking(state));
    setDate(first, "2000-05-01");
    put(state, first);
    const second = copy(first);
    second.entityId++;
    (second.payload as HqWireBookingPayload).orbitBookingId = second.entityId;
    setDate(second, "2100-06-01");
    put(state, second);
    state.metadata.counts.bookingCount = 2;
    const result = await validateHqInitialPublication(
      state,
      offlineDb(),
      status(state)
    );
    expect(result.status).toBe("checks_ready");
    expect(result.years.map(row => row.year)).toEqual([2000, 2100]);
    expect(result.years.map(row => row.activeBookings)).toEqual([1, 1]);
  });
  it.each(["1999-12-31", "2101-01-01"])(
    "rejects eligible year outside bounded range %s, no silent omission",
    async date => {
      const state = publication();
      const entity = copy(booking(state));
      setDate(entity, date);
      put(state, entity);
      const db = offlineDb();
      expectSuppressed(
        await validateHqInitialPublication(state, db, status(state))
      );
      expect(db.select).not.toHaveBeenCalled();
    }
  );
  it("supports all 101 allowed years without returning entity rows", async () => {
    const state = publication();
    const template = copy(booking(state));
    state.entities = {};
    for (let year = 2000; year <= 2100; year++) {
      const entity = copy(template);
      entity.entityId = year;
      (entity.payload as HqWireBookingPayload).orbitBookingId = year;
      setDate(entity, `${year}-01-01`);
      put(state, entity);
    }
    state.metadata.counts = { bookingCount: 101, businessCount: 0 };
    const result = await validateHqInitialPublication(
      state,
      offlineDb(),
      status(state)
    );
    expect(result.status).toBe("checks_ready");
    expect(result.years).toHaveLength(101);
    expect(result.years[0].year).toBe(2000);
    expect(result.years[100].year).toBe(2100);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(40000);
  });
  it("existing +1000 synthetic amendment changes the original month only; manual real-case evidence stays pending", async () => {
    const state = publication("amended");
    const report = await getHqReport(
      state,
      createPortalHqImplementedDirectory(offlineDb()),
      { year: 2026 }
    );
    expect(report.monthly[0].totals.grossSales.knownSum).toBe("11000.00");
    expect(report.monthly[1].totals.grossSales.knownSum).toBeNull();
    const result = await validateHqInitialPublication(
      state,
      offlineDb(),
      status(state)
    );
    expect(result.years[0]).toMatchObject({
      grossSales: "11000.00",
      grossProfit: "2500.00",
    });
    expect(result.manualChecksPending).toBe(true);
    expect(result.limitations.join(" ")).toContain(
      "actual original management month"
    );
    expect(result.limitations.join(" ")).not.toContain("January");
  });
  it("actual cancellation is retained in cohort and excluded from headline monetary sums", async () => {
    const state = publication("cancelled");
    const result = await validateHqInitialPublication(
      state,
      offlineDb(),
      status(state)
    );
    expect(result.status).toBe("checks_ready");
    expect(result.years[0]).toMatchObject({
      activeBookings: 0,
      cancelledBookings: 1,
      grossSales: null,
      grossSalesMissing: 0,
      grossProfit: null,
      grossProfitMissing: 0,
    });
    expect(result.limitations.join(" ")).toContain(
      "without an Orbit reference"
    );
  });
  it("pending bookings and undated exceptions do not become active totals", async () => {
    const state = publication();
    changeBooking(state, p => {
      p.status = "pending";
      p.eligibility.pending = true;
      p.eligibility.activeSalesHeadline = false;
      p.financials.bookingStatus = "pending";
      p.financials.headlineEligible = false;
    });
    const undated = copy(booking(state));
    undated.entityId++;
    (undated.payload as HqWireBookingPayload).orbitBookingId = undated.entityId;
    setDate(undated, null);
    put(state, undated);
    state.metadata.counts.bookingCount = 2;
    const result = await validateHqInitialPublication(
      state,
      offlineDb(),
      status(state)
    );
    expect(result.status).toBe("checks_ready");
    expect(result.years[0]).toMatchObject({
      activeBookings: 0,
      pendingBookings: 1,
      undatedBookings: 1,
      grossSales: null,
    });
  });
  it("undated-only publication uses one current-year exception row", async () => {
    const state = publication();
    const entity = copy(booking(state));
    setDate(entity, null);
    put(state, entity);
    const result = await validateHqInitialPublication(
      state,
      offlineDb(),
      status(state)
    );
    expect(result.status).toBe("checks_ready");
    expect(result.years).toHaveLength(1);
    expect(result.years[0]).toMatchObject({
      year: 2026,
      undatedBookings: 1,
      activeBookings: 0,
      grossSales: null,
    });
  });
  it("absent and demo tombstones reconcile only current-live supplied counts", async () => {
    const state = publication();
    const entity = copy(booking(state));
    put(state, entity, true);
    state.metadata.counts.bookingCount = 0;
    const result = await validateHqInitialPublication(
      state,
      offlineDb(),
      status(state)
    );
    expect(result.status).toBe("checks_ready");
    expect(result.years[0].activeBookings).toBe(0);
  });
});

describe("existing identity resolver never promotes original sellers or emits people", () => {
  it("unresolved exact CRM mapping never falls back to names or OAuth and stays unattributed", async () => {
    const state = publication();
    const db = offlineDb();
    const result = await validateHqInitialPublication(state, db, status(state));
    expect(result.years[0].unattributedBookings).toBe(1);
    expect(db.select).toHaveBeenCalledTimes(2); // owner and staff exact CRM lookups only
    expect(JSON.stringify(result)).not.toContain("raw-person");
  });
  it("conflicting independently resolved CRM/OAuth identities remain unattributed", async () => {
    const state = publication();
    const rows = matchingRows();
    rows[2] = [{ userId: 201, openId: "synthetic-owner-open-id" }];
    rows[3] = [
      {
        id: 201,
        name: "raw-person",
        role: "agent",
        uniqueAgentId: "SYN-MEMBER-OTHER",
      },
    ];
    const result = await validateHqInitialPublication(
      state,
      offlineDb(rows),
      status(state)
    );
    expect(result.status).toBe("checks_ready");
    expect(result.years[0].unattributedBookings).toBe(1);
  });
  it("even a resolved current non-agent member is not an original selling agent", async () => {
    const state = publication();
    const rows = matchingRows();
    (rows[1][0] as any).role = "admin";
    (rows[3][0] as any).role = "admin";
    const result = await validateHqInitialPublication(
      state,
      offlineDb(rows),
      status(state)
    );
    expect(result.status).toBe("checks_ready");
    expect(result.years[0].unattributedBookings).toBe(1);
  });
});

describe("freshness, current ceiling and concurrent guard revocation", () => {
  it.each([
    ["isStale", true],
    ["isStale", null],
    ["sourceAgeSeconds", null],
    ["sourceAgeSeconds", -1],
    ["sourceAgeSeconds", 900.5],
    ["sourceAgeSeconds", 901],
    ["freshnessTargetSeconds", 901],
    ["freshnessTargetSeconds", 0],
    ["lastSuccessfulCheckAt", "2026-11-24T16:00:01.000Z"],
  ])(
    "unsafe freshness %s=%j never releases financial checks",
    async (field, value) => {
      const state = publication();
      const safe = status(state);
      (safe as any)[field] = value;
      expectSuppressed(
        await validateHqInitialPublication(state, offlineDb(), safe)
      );
    }
  );
  it("source stale flag and emitted source age cannot be weakened", async () => {
    for (const edit of [
      (s: HqImplementedState) => {
        s.metadata.stale = true;
      },
      (s: HqImplementedState) => {
        s.metadata.sourceAgeSeconds = 901;
      },
      (s: HqImplementedState) => {
        s.metadata.sourceObservationWindow.to = "2026-11-24T15:44:59.000Z";
        s.metadata.sourceObservationWindow.from = "2026-11-24T15:44:58.000Z";
      },
      (s: HqImplementedState) => {
        s.metadata.sourceObservationWindow.to = "2026-11-24T16:00:01.000Z";
        s.metadata.publishedAt = "2026-11-24T16:00:01.000Z";
      },
      (s: HqImplementedState) => {
        s.metadata.expiresAt = "2026-11-24T15:59:59.000Z";
        s.metadata.publishedAt = "2026-11-24T15:59:58.000Z";
        s.metadata.sourceObservationWindow = {
          from: "2026-11-24T15:59:57.000Z",
          to: "2026-11-24T15:59:58.000Z",
        };
      },
    ]) {
      const state = publication();
      edit(state);
      expectSuppressed(
        await validateHqInitialPublication(state, offlineDb(), status(state))
      );
    }
  });
  it("exact current ceiling 900 is allowed, but a tighter safe policy controls", async () => {
    const state = publication();
    const safe = status(state);
    safe.sourceAgeSeconds = 900;
    expect(
      (await validateHqInitialPublication(state, offlineDb(), safe)).status
    ).toBe("checks_ready");
    safe.freshnessTargetSeconds = 60;
    safe.sourceAgeSeconds = 61;
    expectSuppressed(
      await validateHqInitialPublication(state, offlineDb(), safe)
    );
  });
  it("passes fresh guard to actual report read and brackets the whole awaited report", async () => {
    const spy = vi.spyOn(liveReport, "getHqLiveReport");
    const guard = vi.fn(async () => undefined);
    const state = publication();
    expect(
      (
        await validateHqInitialPublication(
          state,
          offlineDb(),
          status(state),
          guard
        )
      ).status
    ).toBe("checks_ready");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][3]).toEqual(expect.any(Function));
    expect(guard.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it("revocation before report denies reads and exposes no raw guard error", async () => {
    const state = publication();
    const db = offlineDb();
    const guard = vi.fn(async () => {
      throw new Error(SECRET);
    });
    expectSuppressed(
      await validateHqInitialPublication(state, db, status(state), guard)
    );
    expect(db.select).not.toHaveBeenCalled();
  });
  it("revocation during directory reads suppresses all aggregate results", async () => {
    const state = publication();
    let revoked = false;
    const db = offlineDb(matchingRows(), async () => {
      revoked = true;
    });
    const guard = async () => {
      if (revoked) throw new Error(SECRET);
    };
    expectSuppressed(
      await validateHqInitialPublication(state, db, status(state), guard)
    );
    // A revoked owner-resolution read must not continue into assigned-staff
    // resolution. The unchanged real resolver takes four owner-only queries;
    // a more granular query guard may safely stop earlier.
    expect(db.select.mock.calls.length).toBeLessThanOrEqual(4);
  });
  it("concurrent safe container version or publication generation change suppresses all results", async () => {
    for (const edit of [
      (s: HqImplementedState, safe: HqLiveStatusDto) => {
        safe.stateVersion = 9;
      },
      (s: HqImplementedState) => {
        s.metadata.generationId++;
      },
      (s: HqImplementedState) => {
        s.version++;
      },
      (s: HqImplementedState, safe: HqLiveStatusDto) => {
        safe.readEnabled = true;
      },
      (s: HqImplementedState, safe: HqLiveStatusDto) => {
        safe.health = "backoff";
      },
    ]) {
      const state = publication();
      const safe = status(state);
      const db = offlineDb(matchingRows(), async () => {
        edit(state, safe);
      });
      expectSuppressed(
        await validateHqInitialPublication(
          state,
          db,
          safe,
          async () => undefined
        )
      );
    }
  });
  it("crossing source age or expiry during awaited directory work suppresses results", async () => {
    for (const delay of [901000, 86400000]) {
      const state = publication();
      const db = offlineDb(matchingRows(), async () => {
        vi.setSystemTime(NOW + delay);
      });
      expectSuppressed(
        await validateHqInitialPublication(state, db, status(state))
      );
      vi.setSystemTime(NOW);
    }
  });
  it("raw directory or report errors are suppressed without partial financial rows", async () => {
    const state = publication();
    const db = offlineDb([], async () => {
      throw new Error(SECRET);
    });
    expectSuppressed(
      await validateHqInitialPublication(state, db, status(state))
    );
    vi.spyOn(liveReport, "getHqLiveReport").mockRejectedValueOnce(
      new Error(SECRET)
    );
    expectSuppressed(
      await validateHqInitialPublication(state, offlineDb(), status(state))
    );
  });
});
