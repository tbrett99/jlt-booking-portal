import { describe, expect, it } from "vitest";
import {
  calculateStaffCallReport,
  staffCallReportRange,
  type CallMetricParticipant,
  type CallMetricSession,
  type StaffCallReportInput,
} from "../shared/staff-call-reporting";
const now = new Date("2026-11-21T18:00:00Z");
const input: StaffCallReportInput = {
  rangeStart: "2026-11-16",
  rangeEnd: "2026-11-23",
  basis: "scheduled",
};
const session = (
  patch: Partial<CallMetricSession> = {}
): CallMetricSession => ({
  id: 1,
  hostUserId: 9,
  hostName: "Synthetic host",
  reasonKey: "academy_progress",
  format: "one_to_one",
  status: "booked",
  startAt: new Date("2026-11-20T12:00:00Z"),
  endAt: new Date("2026-11-20T12:30:00Z"),
  createdAt: new Date("2026-11-01T09:00:00Z"),
  bookedAt: new Date("2026-11-19T09:00:00Z"),
  rescheduled: false,
  ...patch,
});
const participant = (
  patch: Partial<CallMetricParticipant> = {}
): CallMetricParticipant => ({
  id: 1,
  callId: 1,
  status: "booked",
  attendance: "awaiting",
  bookedAt: new Date("2026-11-19T09:00:00Z"),
  ...patch,
});
describe("Staff calls honest report metrics", () => {
  it("reports an empty period without invented attendance or history", () => {
    const result = calculateStaffCallReport(input, [], [], now);
    expect(result.counts.sessions).toBe(0);
    expect(result.counts.attendanceRate).toBeNull();
    expect(result.daily).toHaveLength(7);
  });
  it("uses provider confirmation rather than request creation for booked during", () => {
    const result = calculateStaffCallReport(
      { ...input, basis: "booked" },
      [session()],
      [participant()],
      now
    );
    expect(result.counts.bookedSessions).toBe(1);
    expect(
      result.daily.find(x => x.date === "2026-11-19")?.bookedSessions
    ).toBe(1);
  });
  it("does not classify a pending request as booked", () => {
    const c = session({ status: "pending", bookedAt: null });
    const r = calculateStaffCallReport(
      input,
      [c],
      [participant({ bookedAt: null })],
      now
    );
    expect(r.counts.pendingSessions).toBe(1);
    expect(r.counts.bookedSessions).toBe(0);
    expect(r.counts.bookedParticipants).toBe(0);
    expect(r.counts.awaitingOutcome).toBe(0);
    expect(
      calculateStaffCallReport({ ...input, basis: "booked" }, [c], [], now)
        .counts.sessions
    ).toBe(0);
  });
  it("separates one session from three participant invitations", () => {
    const r = calculateStaffCallReport(
      input,
      [session({ format: "group" })],
      [
        participant({ attendance: "attended" }),
        participant({ id: 2, attendance: "no_show" }),
        participant({ id: 3 }),
      ],
      now
    );
    expect(r.counts).toMatchObject({
      sessions: 1,
      bookedParticipants: 3,
      sessionsWithAttendance: 1,
      attended: 1,
      noShow: 1,
      awaitingOutcome: 1,
      attendanceDenominator: 2,
      attendanceRate: 0.5,
    });
  });
  it("does not infer attendance at scheduled end", () => {
    expect(
      calculateStaffCallReport(input, [session()], [participant()], now).counts
    ).toMatchObject({ attended: 0, awaitingOutcome: 1 });
  });
  it("future calls do not await outcomes", () => {
    expect(
      calculateStaffCallReport(
        input,
        [
          session({
            startAt: new Date("2026-11-22T12:00:00Z"),
            endAt: new Date("2026-11-22T12:30:00Z"),
          }),
        ],
        [participant()],
        now
      ).counts.awaitingOutcome
    ).toBe(0);
  });
  it("cancelled invitations are retained without a no-show inference", () => {
    const r = calculateStaffCallReport(
      input,
      [session({ status: "cancelled" })],
      [participant({ status: "cancelled" })],
      now
    );
    expect(r.counts).toMatchObject({
      cancelledSessions: 1,
      bookedSessions: 1,
      cancelledParticipants: 1,
      noShow: 0,
      awaitingOutcome: 0,
    });
  });
  it("partial group cancellation excludes only cancelled participant from awaiting outcomes", () => {
    const r = calculateStaffCallReport(
      input,
      [session({ format: "group" })],
      [participant(), participant({ id: 2, status: "cancelled" })],
      now
    );
    expect(r.counts.awaitingOutcome).toBe(1);
    expect(r.counts.cancelledSessions).toBe(0);
  });
  it("excludes excused and not held from attendance rate", () => {
    const r = calculateStaffCallReport(
      input,
      [session({ format: "group" })],
      [
        participant({ attendance: "excused" }),
        participant({ id: 2, attendance: "not_held" }),
        participant({ id: 3, attendance: "no_show" }),
      ],
      now
    );
    expect(r.counts).toMatchObject({
      excused: 1,
      notHeld: 1,
      noShow: 1,
      attendanceDenominator: 1,
      attendanceRate: 0,
    });
  });
  it("uncertain provider responses never imply attendance", () => {
    const r = calculateStaffCallReport(
      input,
      [session({ status: "needs_recovery", bookedAt: null })],
      [participant({ bookedAt: null, attendance: "attended" })],
      now
    );
    expect(r.counts).toMatchObject({
      recoverySessions: 1,
      attended: 0,
      attendanceRate: null,
    });
  });
  it("retains recorded attendance when a later cancellation arrives", () => {
    const r = calculateStaffCallReport(
      input,
      [session({ status: "cancelled" })],
      [participant({ status: "cancelled", attendance: "attended" })],
      now
    );
    expect(r.counts.attended).toBe(1);
  });
  it("counts a repeatedly rescheduled session once", () => {
    expect(
      calculateStaffCallReport(
        input,
        [session({ rescheduled: true })],
        [participant()],
        now
      ).counts.rescheduledSessions
    ).toBe(1);
  });
  it.each(["hostUserId", "reasonKey", "format"] as const)(
    "filters on %s without mixing groups",
    field => {
      const filter =
        field === "hostUserId"
          ? { hostUserId: 22 }
          : field === "reasonKey"
            ? { reasonKey: "different" }
            : { format: "group" as const };
      expect(
        calculateStaffCallReport(
          { ...input, ...filter },
          [session()],
          [participant()],
          now
        ).counts.sessions
      ).toBe(0);
    }
  );
  it("provides summed host and reason breakdowns", () => {
    const r = calculateStaffCallReport(
      input,
      [
        session(),
        session({
          id: 2,
          hostUserId: 22,
          hostName: "Other host",
          reasonKey: "support",
        }),
      ],
      [
        participant({ attendance: "attended" }),
        participant({ id: 2, callId: 2, attendance: "no_show" }),
      ],
      now
    );
    expect(r.byHost.reduce((sum, x) => sum + x.sessions, 0)).toBe(
      r.counts.sessions
    );
    expect(r.byReason.reduce((sum, x) => sum + x.noShow, 0)).toBe(
      r.counts.noShow
    );
  });
  it("uses London midnight across 23-hour spring DST day", () => {
    const r = staffCallReportRange({
      ...input,
      rangeStart: "2026-03-29",
      rangeEnd: "2026-03-30",
    });
    expect(r.end.getTime() - r.start.getTime()).toBe(23 * 3600000);
  });
  it("uses London midnight across 25-hour autumn DST day", () => {
    const r = staffCallReportRange({
      ...input,
      rangeStart: "2026-10-25",
      rangeEnd: "2026-10-26",
    });
    expect(r.end.getTime() - r.start.getTime()).toBe(25 * 3600000);
  });
  it("includes start and excludes exact end", () => {
    const rows = [
      session({ id: 1, startAt: new Date("2026-11-16T00:00:00Z") }),
      session({ id: 2, startAt: new Date("2026-11-23T00:00:00Z") }),
    ];
    expect(calculateStaffCallReport(input, rows, [], now).counts.sessions).toBe(
      1
    );
  });
  it("rejects invalid or unbounded ranges", () => {
    for (const patch of [
      { rangeStart: "2026-02-30" },
      { rangeEnd: "2026-11-16" },
      { rangeStart: "2020-01-01" },
    ])
      expect(() => staffCallReportRange({ ...input, ...patch })).toThrow();
  });
  it("rejects duplicate sessions instead of inflating totals", () => {
    expect(() =>
      calculateStaffCallReport(input, [session(), session()], [], now)
    ).toThrow("Duplicate call session");
  });
  it("rejects duplicate participants instead of inflating totals", () => {
    expect(() =>
      calculateStaffCallReport(
        input,
        [session()],
        [participant(), participant()],
        now
      )
    ).toThrow("Duplicate call participant");
  });
});
