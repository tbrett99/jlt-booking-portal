import { readFileSync } from "node:fs";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookings, users } from "../drizzle/schema";
import {
  addForecastDays,
  type CommissionForecastInput,
} from "../shared/commission-workload-forecast";
import {
  buildCommissionWorkloadForecast,
  commissionForecastFlag,
  COMMISSION_FORECAST_MAX_FILES,
  CommissionForecastValidationError,
  validateCommissionForecastInput,
  type CommissionForecastRow,
} from "./commission-workload-forecast-policy";
import {
  COMMISSION_REVIEW_ELIGIBLE_STAGES,
  isBookingReadyForCommissionReview,
} from "./commission-workflow-utils";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
// Replace the entire module: importing the live pool is forbidden in this suite.
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import { getCommissionWorkloadForecast } from "./commission-workload-forecast-service";

const NOW = new Date("2026-11-11T15:00:00.000Z");
const PERIOD: CommissionForecastInput = {
  startDate: "2026-11-11",
  endDate: "2026-12-31",
  groupBy: "week",
};
function row(
  id: number,
  patch: Partial<CommissionForecastRow> = {}
): CommissionForecastRow {
  return {
    id,
    agentId: 10,
    clientName: `Synthetic client ${id}`,
    agentName: "Synthetic agent",
    ptsRef: `PTS-${id}`,
    crmRef: `ORBIT-${id}`,
    currentStage: "Added to PTS",
    finalSupplierPaymentDate: "2026-11-12",
    departureDate: "2027-01-15",
    isPersonalBooking: false,
    commissionPreAuthorised: false,
    inContract: false,
    hasOutstandingRefund: false,
    hasOutstandingAmendment: false,
    hasOutstandingReimbursement: false,
    ...patch,
  };
}
const forecast = (rows: CommissionForecastRow[], period = PERIOD, now = NOW) =>
  buildCommissionWorkloadForecast(rows, period, now);

/** Executes no SQL: real Drizzle builds the query, but our thenable returns only
 * synthetic rows and records toSQL(). No connection/client execution is used. */
function syntheticDb(rows: CommissionForecastRow[] = [], failure?: Error) {
  const builder = drizzle.mock();
  const reads: { sql: string; params: unknown[] }[] = [];
  const projection: Record<string, unknown>[] = [];
  const failWrite = vi.fn(() => {
    throw new Error("Forecast must never write or execute raw SQL");
  });
  const db = {
    insert: failWrite,
    update: failWrite,
    delete: failWrite,
    execute: failWrite,
    transaction: failWrite,
    select: vi.fn((fields: Record<string, unknown>) => {
      projection.push(fields);
      let query: any = builder.select(fields as any);
      const chain: Record<string, any> = {};
      for (const name of ["from", "leftJoin", "where", "orderBy", "limit"]) {
        chain[name] = vi.fn((...args: any[]) => {
          query = query[name](...args);
          return chain;
        });
      }
      chain.then = (
        resolve: (rows: CommissionForecastRow[]) => unknown,
        reject: (error: unknown) => unknown
      ) => {
        reads.push(query.toSQL());
        return (failure ? Promise.reject(failure) : Promise.resolve(rows)).then(
          resolve,
          reject
        );
      };
      return chain;
    }),
  };
  return { db, reads, projection, failWrite };
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("commission workload forecast input validation", () => {
  it.each([
    null,
    undefined,
    [],
    "2026-11-11",
    {},
    { ...PERIOD, startDate: "2026-11-1" },
    { ...PERIOD, startDate: "11/11/2026" },
    { ...PERIOD, startDate: "2026-02-29" },
    { ...PERIOD, endDate: "2026-04-31" },
    { ...PERIOD, startDate: "2026-11-11T00:00:00Z" },
    { ...PERIOD, startDate: "2026-11-12", endDate: "2026-11-11" },
    { ...PERIOD, groupBy: "day" },
    { ...PERIOD, startDate: 20261111 },
    { ...PERIOD, endDate: "invalid-secret-input" },
  ])("rejects invalid input %j with a typed safe error", input => {
    expect(() => validateCommissionForecastInput(input)).toThrow(
      CommissionForecastValidationError
    );
    try {
      validateCommissionForecastInput(input);
    } catch (error) {
      expect(error).toMatchObject({ code: "BAD_REQUEST" });
      expect(String(error)).not.toContain("invalid-secret-input");
    }
  });

  it("accepts one calendar day and leap day, and copies only contract input fields", () => {
    expect(
      validateCommissionForecastInput({
        startDate: "2028-02-29",
        endDate: "2028-02-29",
        groupBy: "month",
        privateValue: "ignored",
      })
    ).toEqual({
      startDate: "2028-02-29",
      endDate: "2028-02-29",
      groupBy: "month",
    });
    expect(
      forecast([], { ...PERIOD, endDate: PERIOD.startDate }).buckets
    ).toHaveLength(1);
  });

  it("allows exactly 730 inclusive days, rejects 731, including leap-year ranges", () => {
    const startDate = "2027-03-01";
    expect(
      validateCommissionForecastInput({
        startDate,
        endDate: addForecastDays(startDate, 729),
        groupBy: "week",
      }).endDate
    ).toBe(addForecastDays(startDate, 729));
    expect(() =>
      validateCommissionForecastInput({
        startDate,
        endDate: addForecastDays(startDate, 730),
        groupBy: "week",
      })
    ).toThrow(/730/);
  });
});

describe("commission workload forecast eligibility and review dates", () => {
  it("includes both hand-off stages and excludes every other stage and any stale claim", () => {
    const excluded = [
      "New Booking",
      "Documents Required",
      "Awaiting Payment",
      "Cancelled",
      "Commission Claimable",
      "Commission Claimed",
      "Commission Due for Payment",
      "Commission Paid",
      "",
      null,
    ];
    const result = forecast([
      row(1),
      row(2, { currentStage: "Commission Ready for Review" }),
      ...excluded.map((currentStage, i) => row(i + 3, { currentStage })),
      row(20, { hasCommissionClaim: true }),
      row(21, { hasCommissionClaim: "1" }),
    ]);
    expect(result.files.map(file => file.bookingId)).toEqual([1, 2]);
    expect(result.upcomingCount).toBe(2);
    expect(
      result.dueNowCount + result.unscheduledCount + result.outsideRangeCount
    ).toBe(0);
  });

  it("counts personal and zero-commission files, without needing an amount field", () => {
    const personal = {
      ...row(1, { isPersonalBooking: true }),
      expectedCommission: "0.00",
    };
    const zero = { ...row(2), expectedCommission: "0.00" };
    const result = forecast([personal, zero]);
    expect(result.upcomingCount).toBe(2);
    expect(result.files.every(file => !("expectedCommission" in file))).toBe(
      true
    );
  });

  it("uses ordinary final payment dates regardless of departure, without assuming departure for missing payment", () => {
    const result = forecast([
      row(1, {
        finalSupplierPaymentDate: "2026-11-15",
        departureDate: "2026-11-13",
      }),
      row(2, { finalSupplierPaymentDate: "2026-11-12", departureDate: null }),
      row(3, { finalSupplierPaymentDate: null, departureDate: "2026-11-15" }),
    ]);
    expect(result.files.map(file => file.reviewDate)).toEqual([
      "2026-11-15",
      "2026-11-12",
      null,
    ]);
    expect(result.files[2].unscheduledReason).toBe("missing_payment_date");
    expect(result.upcomingCount).toBe(2);
  });

  it("preauthorised review uses the later of payment day and departure UTC day plus seven days", () => {
    const result = forecast([
      row(1, {
        commissionPreAuthorised: true,
        finalSupplierPaymentDate: "2026-11-12T23:59:59Z",
        departureDate: "2026-11-15T23:59:59Z",
      }),
      row(2, {
        commissionPreAuthorised: true,
        finalSupplierPaymentDate: "2026-11-30",
        departureDate: "2026-11-15",
      }),
      row(3, {
        commissionPreAuthorised: true,
        finalSupplierPaymentDate: "2026-11-22",
        departureDate: "2026-11-15",
      }),
    ]);
    expect(result.files.map(file => file.reviewDate)).toEqual([
      "2026-11-22",
      "2026-11-30",
      "2026-11-22",
    ]);
    expect(
      result.buckets.reduce((sum, bucket) => sum + bucket.preAuthorisedCount, 0)
    ).toBe(3);
  });

  it("due now matches the existing review utility exactly, including same-day payment and preauthorised gates", () => {
    const rows = [
      row(1, { finalSupplierPaymentDate: "2026-11-11T23:59:59Z" }),
      row(2, { finalSupplierPaymentDate: "2026-11-10" }),
      row(3, { finalSupplierPaymentDate: "2026-11-12" }),
      row(4, {
        commissionPreAuthorised: true,
        finalSupplierPaymentDate: "2026-11-11",
        departureDate: "2026-11-04T23:59:59Z",
      }),
      row(5, {
        commissionPreAuthorised: true,
        finalSupplierPaymentDate: "2026-11-10",
        departureDate: "2026-11-05",
      }),
      row(6, {
        finalSupplierPaymentDate: "2026-11-11",
        isPersonalBooking: true,
      }),
      row(7, {
        commissionPreAuthorised: true,
        finalSupplierPaymentDate: "2026-11-12",
        departureDate: "2026-10-01",
      }),
    ];
    const result = forecast(rows);
    const readyIds = rows
      .filter(value =>
        isBookingReadyForCommissionReview(
          {
            currentStage: value.currentStage!,
            finalSupplierPaymentDate: value.finalSupplierPaymentDate ?? null,
            departureDate: value.departureDate ?? null,
            isPersonalBooking: value.isPersonalBooking === true,
            commissionPreAuthorised: value.commissionPreAuthorised === true,
          },
          NOW
        )
      )
      .map(value => value.id);
    expect(
      result.files
        .filter(file => file.category === "due_now")
        .map(file => file.bookingId)
    ).toEqual(readyIds);
    expect(readyIds).toEqual([1, 2, 4, 6]);
    expect(result.dueNowCount).toBe(4);
    expect(result.upcomingCount).toBe(3);
    expect(
      result.buckets.reduce((sum, bucket) => sum + bucket.fileCount, 0)
    ).toBe(3);
    expect(
      result.files
        .filter(file => file.category === "due_now")
        .every(file => file.bucketKey === null)
    ).toBe(true);
  });

  it("due-now and unscheduled remain separate from the future selected range and outside-range counts", () => {
    const period = {
      startDate: "2026-12-01",
      endDate: "2026-12-10",
      groupBy: "month",
    } as const;
    const result = forecast(
      [
        row(1, { finalSupplierPaymentDate: "2026-11-11" }),
        row(2, { finalSupplierPaymentDate: "2026-11-30" }),
        row(3, { finalSupplierPaymentDate: "2026-12-01" }),
        row(4, { finalSupplierPaymentDate: "2026-12-10" }),
        row(5, { finalSupplierPaymentDate: "2026-12-11" }),
        row(6, { finalSupplierPaymentDate: null }),
        row(7, {
          finalSupplierPaymentDate: "2026-12-02",
          commissionPreAuthorised: true,
          departureDate: "2026-12-10",
        }),
      ],
      period
    );
    expect(result).toMatchObject({
      dueNowCount: 1,
      upcomingCount: 2,
      unscheduledCount: 1,
      outsideRangeCount: 3,
    });
    expect(result.files.map(file => file.bookingId)).toEqual([1, 3, 4, 6]);
    expect(result.buckets[0].fileCount).toBe(2);
  });

  it.each([
    {
      patch: { finalSupplierPaymentDate: null },
      reason: "missing_payment_date",
    },
    {
      patch: { finalSupplierPaymentDate: undefined },
      reason: "missing_payment_date",
    },
    {
      patch: { finalSupplierPaymentDate: "   " },
      reason: "missing_payment_date",
    },
    {
      patch: { finalSupplierPaymentDate: "not-a-date" },
      reason: "invalid_payment_date",
    },
    {
      patch: { finalSupplierPaymentDate: "2026-02-30" },
      reason: "invalid_payment_date",
    },
    {
      patch: { finalSupplierPaymentDate: "2026-02-30T10:00:00Z" },
      reason: "invalid_payment_date",
    },
    {
      patch: { finalSupplierPaymentDate: new Date(NaN) },
      reason: "invalid_payment_date",
    },
    {
      patch: { finalSupplierPaymentDate: "2026-11-12T25:00:00Z" },
      reason: "invalid_payment_date",
    },
    {
      patch: { commissionPreAuthorised: true, departureDate: null },
      reason: "missing_departure_date",
    },
    {
      patch: { commissionPreAuthorised: true, departureDate: "" },
      reason: "missing_departure_date",
    },
    {
      patch: { commissionPreAuthorised: true, departureDate: "invalid" },
      reason: "invalid_departure_date",
    },
    {
      patch: { commissionPreAuthorised: true, departureDate: "2026-02-30" },
      reason: "invalid_departure_date",
    },
    {
      patch: { commissionPreAuthorised: true, departureDate: new Date(NaN) },
      reason: "invalid_departure_date",
    },
    {
      patch: {
        commissionPreAuthorised: true,
        finalSupplierPaymentDate: null,
        departureDate: null,
      },
      reason: "missing_payment_date",
    },
  ])(
    "reports $reason for missing/invalid calendar data without a guessed date",
    ({ patch, reason }) => {
      const result = forecast([row(1, patch)]);
      expect(result).toMatchObject({
        upcomingCount: 0,
        dueNowCount: 0,
        unscheduledCount: 1,
        outsideRangeCount: 0,
      });
      expect(result.files[0]).toMatchObject({
        reviewDate: null,
        bucketKey: null,
        category: "unscheduled",
        unscheduledReason: reason,
      });
    }
  );

  it("ordinary invalid departure does not block a valid payment-date review", () => {
    const result = forecast([row(1, { departureDate: "invalid" })]);
    expect(result.files[0]).toMatchObject({
      departureDate: null,
      reviewDate: "2026-11-12",
      category: "upcoming",
      unscheduledReason: null,
    });
  });

  it("counts attention once per file even with multiple flags, and flags are not exclusion gates", () => {
    const result = forecast([
      row(1, {
        inContract: true,
        hasOutstandingRefund: true,
        hasOutstandingAmendment: true,
        hasOutstandingReimbursement: true,
      }),
      row(2, { inContract: "0", hasOutstandingRefund: "1" }),
      row(3, {
        inContract: "0",
        hasOutstandingRefund: "0",
        hasOutstandingAmendment: "0",
        hasOutstandingReimbursement: "0",
      }),
    ]);
    expect(result.upcomingCount).toBe(3);
    expect(result.buckets[0]).toMatchObject({
      fileCount: 3,
      attentionCount: 2,
    });
    expect(result.files[2]).toMatchObject({
      inContract: false,
      hasOutstandingRefund: false,
      hasOutstandingAmendment: false,
      hasOutstandingReimbursement: false,
    });
  });

  it.each([true, 1, "1"])("normalizes %j as true", flag =>
    expect(commissionForecastFlag(flag)).toBe(true)
  );
  it.each([false, 0, "0", "", null, undefined, "false", "true", 2, "2"])(
    "normalizes %j as false",
    flag => expect(commissionForecastFlag(flag)).toBe(false)
  );

  it("returns deterministic booking-ID order without mutating inputs, and null-safe contract fields only", () => {
    const rows = [
      row(9),
      row(2, {
        clientName: null,
        agentName: undefined,
        ptsRef: null,
        crmRef: undefined,
      }),
    ];
    const before = structuredClone(rows);
    const result = forecast(rows);
    expect(rows).toEqual(before);
    expect(result.files.map(file => file.bookingId)).toEqual([2, 9]);
    expect(result.files[0]).toMatchObject({
      clientName: null,
      agentName: null,
      ptsRef: null,
      orbitRef: null,
    });
    expect(result.asOf).toBe(NOW.toISOString());
    expect(result.today).toBe("2026-11-11");
    expect(Object.keys(result.files[0]).sort()).toEqual(
      [
        "bookingId",
        "clientName",
        "agentId",
        "agentName",
        "ptsRef",
        "orbitRef",
        "stage",
        "finalSupplierPaymentDate",
        "departureDate",
        "reviewDate",
        "preAuthorised",
        "inContract",
        "hasOutstandingRefund",
        "hasOutstandingAmendment",
        "hasOutstandingReimbursement",
        "unscheduledReason",
        "bucketKey",
        "category",
      ].sort()
    );
  });
});

describe("commission workload forecast UTC buckets", () => {
  it("uses canonical Monday weekly keys, clips partial ranges, includes Sunday and next Monday", () => {
    const result = forecast(
      [
        row(1, { finalSupplierPaymentDate: "2026-11-15" }),
        row(2, { finalSupplierPaymentDate: "2026-11-16" }),
        row(3, { finalSupplierPaymentDate: "2026-11-17" }),
        row(4, { finalSupplierPaymentDate: "2026-11-18" }),
      ],
      { startDate: "2026-11-13", endDate: "2026-11-17", groupBy: "week" }
    );
    expect(result.buckets).toEqual([
      {
        key: "2026-11-09",
        startDate: "2026-11-13",
        endDate: "2026-11-15",
        label: "Week of 2026-11-09",
        fileCount: 1,
        preAuthorisedCount: 0,
        attentionCount: 0,
      },
      {
        key: "2026-11-16",
        startDate: "2026-11-16",
        endDate: "2026-11-17",
        label: "Week of 2026-11-16",
        fileCount: 2,
        preAuthorisedCount: 0,
        attentionCount: 0,
      },
    ]);
    expect(result.files.map(file => file.bucketKey)).toEqual([
      "2026-11-09",
      "2026-11-16",
      "2026-11-16",
    ]);
    expect(result.outsideRangeCount).toBe(1);
  });

  it("includes zero weeks across a year boundary and uses the prior-year Monday key", () => {
    const result = forecast(
      [row(1, { finalSupplierPaymentDate: "2027-01-01" })],
      { startDate: "2026-12-30", endDate: "2027-01-12", groupBy: "week" }
    );
    expect(
      result.buckets.map(bucket => [
        bucket.key,
        bucket.startDate,
        bucket.endDate,
        bucket.fileCount,
      ])
    ).toEqual([
      ["2026-12-28", "2026-12-30", "2027-01-03", 1],
      ["2027-01-04", "2027-01-04", "2027-01-10", 0],
      ["2027-01-11", "2027-01-11", "2027-01-12", 0],
    ]);
  });

  it("uses calendar months including zero months, clipped boundaries, leap February, and year rollover", () => {
    const result = forecast(
      [
        row(1, { finalSupplierPaymentDate: "2027-12-31" }),
        row(2, { finalSupplierPaymentDate: "2028-02-29" }),
        row(3, { finalSupplierPaymentDate: "2028-03-02" }),
      ],
      { startDate: "2027-12-30", endDate: "2028-03-02", groupBy: "month" }
    );
    expect(
      result.buckets.map(bucket => [
        bucket.key,
        bucket.startDate,
        bucket.endDate,
        bucket.fileCount,
      ])
    ).toEqual([
      ["2027-12", "2027-12-30", "2027-12-31", 1],
      ["2028-01", "2028-01-01", "2028-01-31", 0],
      ["2028-02", "2028-02-01", "2028-02-29", 1],
      ["2028-03", "2028-03-01", "2028-03-02", 1],
    ]);
    expect(result.buckets[0].label).toBe("December 2027");
    expect(result.files.map(file => file.bucketKey)).toEqual([
      "2027-12",
      "2028-02",
      "2028-03",
    ]);
  });

  it("returns every selected bucket at zero when no future files exist", () => {
    const result = forecast([], {
      startDate: "2026-11-15",
      endDate: "2027-01-01",
      groupBy: "month",
    });
    expect(result.buckets.map(bucket => bucket.key)).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
    expect(
      result.buckets.every(
        bucket =>
          bucket.fileCount === 0 &&
          bucket.attentionCount === 0 &&
          bucket.preAuthorisedCount === 0
      )
    ).toBe(true);
    expect(result.files).toEqual([]);
  });

  it.each(["Europe/London", "America/New_York", "Pacific/Auckland"])(
    "keeps UTC readiness/date/bucket parity across DST in %s",
    timezone => {
      vi.stubEnv("TZ", timezone);
      const now = new Date("2026-03-29T00:30:00Z");
      const period: CommissionForecastInput = {
        startDate: "2026-03-29",
        endDate: "2026-04-06",
        groupBy: "week",
      };
      const result = forecast(
        [
          row(1, { finalSupplierPaymentDate: "2026-03-29T23:59:59Z" }),
          row(2, {
            commissionPreAuthorised: true,
            finalSupplierPaymentDate: "2026-03-28",
            departureDate: "2026-03-22T23:59:59Z",
          }),
          row(3, {
            commissionPreAuthorised: true,
            finalSupplierPaymentDate: "2026-03-29",
            departureDate: "2026-03-23T23:59:59Z",
          }),
          row(4, { finalSupplierPaymentDate: "2026-03-29 23:59:59" }),
          row(5, { finalSupplierPaymentDate: "2026-03-30T00:30:00+01:00" }),
          row(6, {
            finalSupplierPaymentDate: new Date("2026-03-30T00:01:00Z"),
          }),
        ],
        period,
        now
      );
      expect(result).toMatchObject({
        today: "2026-03-29",
        dueNowCount: 4,
        upcomingCount: 2,
      });
      expect(result.files.find(file => file.bookingId === 3)).toMatchObject({
        reviewDate: "2026-03-30",
        bucketKey: "2026-03-30",
        category: "upcoming",
      });
      expect(result.files.find(file => file.bookingId === 5)?.reviewDate).toBe(
        "2026-03-29"
      );
      expect(result.buckets.map(bucket => bucket.fileCount)).toEqual([0, 2, 0]);
    }
  );

  it("uses UTC calendar arithmetic through the autumn DST transition for preauthorised files", () => {
    const result = forecast(
      [
        row(1, {
          commissionPreAuthorised: true,
          finalSupplierPaymentDate: "2026-10-25",
          departureDate: "2026-10-24T23:30:00Z",
        }),
      ],
      { startDate: "2026-10-25", endDate: "2026-11-01", groupBy: "week" },
      new Date("2026-10-25T00:30:00Z")
    );
    expect(result.files[0]).toMatchObject({
      reviewDate: "2026-10-31",
      bucketKey: "2026-10-26",
      category: "upcoming",
    });
  });
});

describe("commission workload forecast read-only service", () => {
  it("makes a single bounded, deterministically ordered minimal query with no writes or provider calls", async () => {
    const adapter = syntheticDb([
      row(2, {
        inContract: "0",
        hasOutstandingRefund: "1",
        hasOutstandingAmendment: "0",
        hasOutstandingReimbursement: 0,
        commissionPreAuthorised: "0",
        agentName: null,
      }),
    ]);
    mocks.getDb.mockResolvedValue(adapter.db);
    const provider = vi.fn(() => {
      throw new Error("No provider calls are allowed");
    });
    vi.stubGlobal("fetch", provider);
    const result = await getCommissionWorkloadForecast(PERIOD, NOW);
    expect(mocks.getDb).toHaveBeenCalledTimes(1);
    expect(adapter.db.select).toHaveBeenCalledTimes(1);
    expect(adapter.reads).toHaveLength(1);
    const query = adapter.reads[0];
    expect(query.sql).toContain(
      "from `bookings` left join `users` on `users`.`id` = `bookings`.`agentId`"
    );
    expect(query.sql).toContain("order by `bookings`.`id` asc limit ?");
    expect(query.params.at(-1)).toBe(50_001);
    expect(query.sql).not.toMatch(
      /email|bank|accountNumber|sortCode|grossCost|grossAmount|commissionRate|expectedCommission|margin|vat|financial|\bselect\s+\*/i
    );
    expect(Object.keys(adapter.projection[0]).sort()).toEqual(
      [
        "id",
        "agentId",
        "clientName",
        "agentName",
        "ptsRef",
        "crmRef",
        "currentStage",
        "finalSupplierPaymentDate",
        "departureDate",
        "isPersonalBooking",
        "commissionPreAuthorised",
        "inContract",
        "hasOutstandingRefund",
        "hasOutstandingAmendment",
        "hasOutstandingReimbursement",
      ].sort()
    );
    expect(adapter.projection[0].id).toBe(bookings.id);
    expect(adapter.projection[0].agentName).toBe(users.name);
    expect(result.files[0]).toMatchObject({
      inContract: false,
      preAuthorised: false,
      hasOutstandingRefund: true,
      hasOutstandingAmendment: false,
      hasOutstandingReimbursement: false,
      agentName: null,
    });
    expect(adapter.failWrite).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    // Side-effectful workflow/provider helpers must not even be imported by this service.
    const source = readFileSync(
      new URL("./commission-workload-forecast-service.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(
      /updateBookingStage|createNote|createCommissionClaim|queueDueBookings|queueBookingForCommission|orbitFinancial|sendEmail|axios|fetch\(/
    );
  });

  it("SQL filters exactly shared hand-off stages and excludes claims of every status, without amount or personal exclusions", async () => {
    const adapter = syntheticDb();
    mocks.getDb.mockResolvedValue(adapter.db);
    await getCommissionWorkloadForecast(PERIOD, NOW);
    const query = adapter.reads[0];
    const where = query.sql.slice(
      query.sql.lastIndexOf(" where ("),
      query.sql.indexOf(" order by")
    );
    expect(where).toContain("`bookings`.`currentStage` in (?, ?)");
    expect(where).toMatch(
      /not exists\s*\(\s*select 1 from `commission_claims`\s*where `commission_claims`.`bookingId` = `bookings`.`id`\s*\)/
    );
    expect(where).not.toMatch(
      /`commission_claims`.`status`|isPersonalBooking|expectedCommission|departureDate|finalSupplierPaymentDate|gross|email/i
    );
    expect(query.params.slice(-3, -1)).toEqual([
      ...COMMISSION_REVIEW_ELIGIBLE_STAGES,
    ]);
  });

  it("correlated EXISTS flags use only the exact active refund/amendment/reimbursement and profile predicates", async () => {
    const adapter = syntheticDb();
    mocks.getDb.mockResolvedValue(adapter.db);
    await getCommissionWorkloadForecast(PERIOD, NOW);
    const dialect = new MySqlDialect();
    const flag = (key: string) =>
      dialect.sqlToQuery(adapter.projection[0][key] as any);
    expect(flag("inContract")).toMatchObject({ params: [1] });
    expect(flag("inContract").sql).toMatch(
      /exists\s*\(\s*select 1 from `agent_crm_profiles`\s*where `agent_crm_profiles`.`userId` = `bookings`.`agentId`\s*and `agent_crm_profiles`.`inContract` = \?\s*\)/
    );
    expect(flag("hasOutstandingRefund")).toMatchObject({
      params: ["completed"],
    });
    expect(flag("hasOutstandingRefund").sql).toMatch(
      /exists\s*\(\s*select 1 from `refunds`\s*where `refunds`.`bookingId` = `bookings`.`id`\s*and `refunds`.`status` <> \?\s*\)/
    );
    expect(flag("hasOutstandingAmendment")).toMatchObject({
      params: ["actioned", "rejected"],
    });
    expect(flag("hasOutstandingAmendment").sql).toMatch(
      /exists\s*\(\s*select 1 from `amendments`\s*where `amendments`.`bookingId` = `bookings`.`id`\s*and `amendments`.`status` not in \(\?, \?\)\s*\)/
    );
    expect(flag("hasOutstandingReimbursement")).toMatchObject({
      params: ["pending", "awaiting_agent"],
    });
    expect(flag("hasOutstandingReimbursement").sql).toMatch(
      /exists\s*\(\s*select 1 from `reimbursement_items`\s*where `reimbursement_items`.`bookingId` = `bookings`.`id`\s*and `reimbursement_items`.`status` in \(\?, \?\)\s*\)/
    );
    expect(adapter.reads[0].sql.match(/exists\s*\(/g)).toHaveLength(5);
    expect(adapter.failWrite).not.toHaveBeenCalled();
  });

  it("reaffirms stage and claim exclusion defensively for synthetic/raw callers", async () => {
    const adapter = syntheticDb([
      row(1),
      row(2, { hasCommissionClaim: true }),
      row(3, { currentStage: "Commission Paid" }),
      row(4, { currentStage: "Cancelled" }),
    ]);
    mocks.getDb.mockResolvedValue(adapter.db);
    const result = await getCommissionWorkloadForecast(PERIOD, NOW);
    expect(result.files.map(file => file.bookingId)).toEqual([1]);
  });

  it("distinguishes a genuine empty dataset from unavailable DB with zero buckets still included", async () => {
    const adapter = syntheticDb([]);
    mocks.getDb.mockResolvedValue(adapter.db);
    const result = await getCommissionWorkloadForecast(PERIOD, NOW);
    expect(result.files).toEqual([]);
    expect(result.buckets.length).toBeGreaterThan(0);
    expect(result.buckets.every(bucket => bucket.fileCount === 0)).toBe(true);
    mocks.getDb.mockResolvedValue(null);
    await expect(getCommissionWorkloadForecast(PERIOD, NOW)).rejects.toThrow(
      /could not be loaded completely/
    );
  });

  it.each(["getDb", "query"])(
    "fails closed and strips raw SQL/nested causes for %s errors",
    async point => {
      const marker = "SYNTHETIC_PRIVATE_SQL_MARKER";
      const error = new Error(`select secret from users where ${marker}`, {
        cause: new Error(marker),
      });
      const adapter = syntheticDb([], error);
      if (point === "getDb") mocks.getDb.mockRejectedValue(error);
      else mocks.getDb.mockResolvedValue(adapter.db);
      const failure = await getCommissionWorkloadForecast(PERIOD, NOW).catch(
        value => value
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).toMatch(/could not be loaded completely/);
      expect(failure.message).not.toContain(marker);
      expect(failure.cause).toBeUndefined();
      expect(JSON.stringify(failure)).not.toContain(marker);
      expect(adapter.failWrite).not.toHaveBeenCalled();
    }
  );

  it("rejects more than 50,000 candidates instead of truncating the forecast", async () => {
    const adapter = syntheticDb(
      Array.from({ length: COMMISSION_FORECAST_MAX_FILES + 1 }, (_, i) =>
        row(i + 1)
      )
    );
    mocks.getDb.mockResolvedValue(adapter.db);
    await expect(getCommissionWorkloadForecast(PERIOD, NOW)).rejects.toThrow(
      /could not be loaded completely/
    );
    expect(adapter.reads[0].params.at(-1)).toBe(
      COMMISSION_FORECAST_MAX_FILES + 1
    );
    expect(adapter.failWrite).not.toHaveBeenCalled();
  });

  it("accepts exactly 50,000 candidates without silently truncating files/counts", async () => {
    const adapter = syntheticDb(
      Array.from({ length: COMMISSION_FORECAST_MAX_FILES }, (_, i) =>
        row(i + 1)
      )
    );
    mocks.getDb.mockResolvedValue(adapter.db);
    const result = await getCommissionWorkloadForecast(PERIOD, NOW);
    expect(result.upcomingCount).toBe(COMMISSION_FORECAST_MAX_FILES);
    expect(result.files).toHaveLength(COMMISSION_FORECAST_MAX_FILES);
    expect(
      result.buckets.reduce((sum, bucket) => sum + bucket.fileCount, 0)
    ).toBe(COMMISSION_FORECAST_MAX_FILES);
  });

  it("validates before DB access and never interpolates user input into errors", async () => {
    await expect(
      getCommissionWorkloadForecast(
        { ...PERIOD, endDate: "PRIVATE_INVALID_DATE" },
        NOW
      )
    ).rejects.toBeInstanceOf(CommissionForecastValidationError);
    expect(mocks.getDb).not.toHaveBeenCalled();
    await expect(
      getCommissionWorkloadForecast(PERIOD, new Date(NaN))
    ).rejects.toThrow(/valid forecast reference date/);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
