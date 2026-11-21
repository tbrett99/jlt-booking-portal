import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ db: null as any, authorize: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => f.db }));
vi.mock("./staff-calls-service", () => ({
  requireStaffCallActor: (...args: any[]) => f.authorize(...args),
}));
import { getStaffCallReport } from "./staff-calls-reporting";
import { staffCallParticipants } from "../drizzle/schema";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const input = {
  rangeStart: "2026-11-16",
  rangeEnd: "2026-11-23",
  basis: "scheduled" as const,
};
const call = {
  id: 1,
  hostUserId: 9,
  hostName: "Synthetic host",
  reasonKey: "onboarding",
  format: "one_to_one" as const,
  status: "booked",
  startAt: new Date("2026-11-20T12:00:00Z"),
  endAt: new Date("2026-11-20T12:30:00Z"),
  createdAt: new Date("2026-11-19T09:00:00Z"),
  bookedAt: new Date("2026-11-19T09:00:00Z"),
};
function fixture(
  responses: unknown[][] = [
    [call],
    [
      {
        id: 1,
        callId: 1,
        attendance: "attended",
        status: "active",
        bookedAt: call.bookedAt,
      },
    ],
    [],
  ]
) {
  const reads: any[] = [];
  const tx: any = {
    select: vi.fn((columns: any) => {
      const read = { columns, limit: 0, where: null as any };
      reads.push(read);
      const query: any = {
        from: () => query,
        leftJoin: () => query,
        where: (condition: any) => {
          read.where = condition;
          return query;
        },
        orderBy: () => query,
        limit: (limit: number) => {
          read.limit = limit;
          return Promise.resolve(responses.shift() ?? []);
        },
      };
      return query;
    }),
  };
  const db: any = {
    transaction: vi.fn(async (work: any, options: any) => work(tx)),
  };
  f.db = db;
  return { db, tx, reads };
}
beforeEach(() => {
  f.db = null;
  f.authorize.mockReset();
  f.authorize.mockResolvedValue({ id: 1, isAdmin: true });
});
describe("Private call report service", () => {
  it("requires administrator authority before, inside and after a consistent snapshot", async () => {
    const x = fixture();
    const result = await getStaffCallReport(47, input);
    expect(result.counts.attended).toBe(1);
    expect(f.authorize.mock.calls).toEqual([
      [x.db, 47, { manage: true, admin: true }],
      [x.tx, 47, { manage: true, admin: true }],
      [x.db, 47, { manage: true, admin: true }],
    ]);
    expect(x.db.transaction.mock.calls[0][1]).toEqual({
      isolationLevel: "repeatable read",
    });
  });
  it("denies restricted engagement/instructor users without querying calls", async () => {
    const x = fixture();
    f.authorize.mockRejectedValue(new Error("Admin required"));
    await expect(getStaffCallReport(10, input)).rejects.toThrow(
      "Admin required"
    );
    expect(x.tx.select).not.toHaveBeenCalled();
  });
  it("withholds results if authority is revoked after snapshot", async () => {
    fixture();
    f.authorize
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("Revoked"));
    await expect(getStaffCallReport(10, input)).rejects.toThrow("Revoked");
  });
  it("rejects invalid dates before any data access", async () => {
    const x = fixture();
    await expect(
      getStaffCallReport(1, { ...input, rangeStart: "2026-02-30" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(x.db.transaction).not.toHaveBeenCalled();
  });
  it("fails closed on unavailable storage", async () => {
    await expect(getStaffCallReport(1, input)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
  it("never silently truncates large session totals", async () => {
    const x = fixture([
      Array.from({ length: 5001 }, (_, index) => ({ ...call, id: index + 1 })),
    ]);
    await expect(getStaffCallReport(1, input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(x.reads).toHaveLength(1);
  });
  it("never silently truncates participant totals", async () => {
    fixture([
      [call],
      Array.from({ length: 50001 }, (_, index) => ({
        id: index + 1,
        callId: 1,
        attendance: "awaiting",
        status: "active",
        bookedAt: call.bookedAt,
      })),
    ]);
    await expect(getStaffCallReport(1, input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it("never silently truncates reschedule evidence", async () => {
    fixture([[call], [], Array.from({ length: 50001 }, () => ({ callId: 1 }))]);
    await expect(getStaffCallReport(1, input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it("does not select private notes, email addresses or provider secrets", async () => {
    const x = fixture();
    await getStaffCallReport(1, input);
    expect(Object.keys(x.reads[1].columns).sort()).toEqual([
      "attendance",
      "bookedAt",
      "callId",
      "id",
      "status",
    ]);
    expect(Object.values(x.reads[1].columns)).not.toContain(
      staffCallParticipants.privateNotes
    );
    for (const read of x.reads)
      expect(Object.keys(read.columns).join(" ")).not.toMatch(
        /email|privateNotes|sharedSummary|providerBooking|apiKey/
      );
  });
  it("does not perform unrelated participant/history queries for empty periods", async () => {
    const x = fixture([[]]);
    const result = await getStaffCallReport(1, input);
    expect(result.counts.sessions).toBe(0);
    expect(x.reads).toHaveLength(1);
  });
  it("preserves explicit unavailable former-host attribution", async () => {
    fixture([[{ ...call, hostName: null }], [], []]);
    const result = await getStaffCallReport(1, input);
    expect(result.byHost[0].hostName).toBe("Former or unavailable host");
  });
  it("counts the actual successful reschedule actions, never pending or failed attempts", async () => {
    const x = fixture([[call], [], [{ callId: 1 }, { callId: 1 }]]);
    const result = await getStaffCallReport(1, input);
    expect(result.counts.rescheduledSessions).toBe(1);
    const condition = new MySqlDialect().sqlToQuery(x.reads[2].where);
    expect(condition.params).toEqual([
      1,
      "reschedule.succeeded",
      "provider.rescheduled",
    ]);
    expect(condition.params).not.toContain("reschedule.pending");
    expect(condition.params).not.toContain("reschedule.needs_recovery");
  });
});
