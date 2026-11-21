import {
  addStaffWorkDays,
  staffWorkLondonDate,
  staffWorkLondonMidnight,
} from "./staff-workload-periods";

export interface StaffCallReportInput {
  rangeStart: string;
  /** Exclusive London calendar-date end. */
  rangeEnd: string;
  basis: "booked" | "scheduled";
  hostUserId?: number;
  reasonKey?: string;
  format?: "one_to_one" | "group";
}
export interface StaffCallReportCounts {
  sessions: number;
  bookedSessions: number;
  cancelledSessions: number;
  pendingSessions: number;
  recoverySessions: number;
  sessionsWithAttendance: number;
  rescheduledSessions: number;
  participantInvitations: number;
  bookedParticipants: number;
  cancelledParticipants: number;
  attended: number;
  noShow: number;
  excused: number;
  notHeld: number;
  awaitingOutcome: number;
  attendanceDenominator: number;
  attendanceRate: number | null;
}
export interface StaffCallReport extends StaffCallReportInput {
  timezone: "Europe/London";
  asOf: string;
  counts: StaffCallReportCounts;
  daily: Array<StaffCallReportCounts & { date: string }>;
  byHost: Array<
    StaffCallReportCounts & { hostUserId: number; hostName: string }
  >;
  byReason: Array<StaffCallReportCounts & { reasonKey: string }>;
  warnings: string[];
}
export function staffCallReportRange(input: StaffCallReportInput) {
  const start = staffWorkLondonMidnight(input.rangeStart);
  const end = staffWorkLondonMidnight(input.rangeEnd);
  const calendarStart = Date.parse(`${input.rangeStart}T00:00:00Z`);
  const calendarEnd = Date.parse(`${input.rangeEnd}T00:00:00Z`);
  const days = (calendarEnd - calendarStart) / 86_400_000;
  if (!Number.isInteger(days) || days < 1 || days > 366)
    throw new Error("Choose a range of 1–366 London calendar days.");
  return {
    start,
    end,
    dates: Array.from({ length: days }, (_, i) =>
      addStaffWorkDays(input.rangeStart, i)
    ),
  };
}
export interface CallMetricSession {
  id: number;
  hostUserId: number;
  hostName: string;
  reasonKey: string;
  format: "one_to_one" | "group";
  status: string;
  startAt: Date;
  endAt: Date;
  createdAt: Date;
  /** First provider confirmation, not request creation. Null is never counted as booked. */
  bookedAt: Date | null;
  rescheduled: boolean;
}
export interface CallMetricParticipant {
  id: number;
  callId: number;
  status: string;
  attendance: string;
  bookedAt: Date | null;
}
function emptyCounts(): StaffCallReportCounts {
  return {
    sessions: 0,
    bookedSessions: 0,
    cancelledSessions: 0,
    pendingSessions: 0,
    recoverySessions: 0,
    sessionsWithAttendance: 0,
    rescheduledSessions: 0,
    participantInvitations: 0,
    bookedParticipants: 0,
    cancelledParticipants: 0,
    attended: 0,
    noShow: 0,
    excused: 0,
    notHeld: 0,
    awaitingOutcome: 0,
    attendanceDenominator: 0,
    attendanceRate: null,
  };
}
function addSession(
  counts: StaffCallReportCounts,
  call: CallMetricSession,
  participants: CallMetricParticipant[],
  now: Date
) {
  counts.sessions++;
  if (call.bookedAt) counts.bookedSessions++;
  if (call.status === "cancelled") counts.cancelledSessions++;
  if (["pending", "pending_booking"].includes(call.status))
    counts.pendingSessions++;
  if (["needs_recovery", "recovery"].includes(call.status))
    counts.recoverySessions++;
  if (call.rescheduled) counts.rescheduledSessions++;
  let attendedSession = false;
  for (const p of participants) {
    counts.participantInvitations++;
    if (p.bookedAt) counts.bookedParticipants++;
    if (p.status === "cancelled") counts.cancelledParticipants++;
    // Only manual outcomes on provider-confirmed invitations count. Cancellation
    // does not erase an earlier recorded conversation, nor infer attendance.
    if (!p.bookedAt) continue;
    if (p.attendance === "attended") {
      counts.attended++;
      attendedSession = true;
    } else if (p.attendance === "no_show") counts.noShow++;
    else if (p.attendance === "excused") counts.excused++;
    else if (["not_held", "notheld"].includes(p.attendance)) counts.notHeld++;
    else if (
      call.status === "booked" &&
      p.status !== "cancelled" &&
      call.endAt <= now
    )
      counts.awaitingOutcome++;
  }
  if (attendedSession) counts.sessionsWithAttendance++;
  counts.attendanceDenominator = counts.attended + counts.noShow;
  counts.attendanceRate = counts.attendanceDenominator
    ? counts.attended / counts.attendanceDenominator
    : null;
}
/** Input must be a complete, bounded, consistent DB snapshot. Never supply partial pages as totals. */
export function calculateStaffCallReport(
  input: StaffCallReportInput,
  calls: CallMetricSession[],
  participants: CallMetricParticipant[],
  now = new Date()
): StaffCallReport {
  const range = staffCallReportRange(input);
  const rows = calls.filter(call => {
    const date = input.basis === "booked" ? call.bookedAt : call.startAt;
    return (
      date &&
      date >= range.start &&
      date < range.end &&
      (!input.hostUserId || call.hostUserId === input.hostUserId) &&
      (!input.reasonKey || call.reasonKey === input.reasonKey) &&
      (!input.format || call.format === input.format)
    );
  });
  const counts = emptyCounts();
  const daily = range.dates.map(date => ({ date, ...emptyCounts() }));
  const days = new Map(daily.map(day => [day.date, day]));
  const hosts = new Map<number, StaffCallReport["byHost"][number]>();
  const reasons = new Map<string, StaffCallReport["byReason"][number]>();
  const seenCalls = new Set<number>();
  const seenParticipants = new Set<number>();
  const byCall = new Map<number, CallMetricParticipant[]>();
  for (const p of participants) {
    if (seenParticipants.has(p.id))
      throw new Error("Duplicate call participant in report snapshot.");
    seenParticipants.add(p.id);
    byCall.set(p.callId, [...(byCall.get(p.callId) ?? []), p]);
  }
  for (const call of rows) {
    if (seenCalls.has(call.id))
      throw new Error("Duplicate call session in report snapshot.");
    seenCalls.add(call.id);
    const own = byCall.get(call.id) ?? [];
    const date = staffWorkLondonDate(
      (input.basis === "booked" ? call.bookedAt : call.startAt)!
    );
    const host = hosts.get(call.hostUserId) ?? {
      hostUserId: call.hostUserId,
      hostName: call.hostName,
      ...emptyCounts(),
    };
    const reason = reasons.get(call.reasonKey) ?? {
      reasonKey: call.reasonKey,
      ...emptyCounts(),
    };
    for (const target of [counts, days.get(date)!, host, reason])
      addSession(target, call, own, now);
    hosts.set(call.hostUserId, host);
    reasons.set(call.reasonKey, reason);
  }
  return {
    ...input,
    timezone: "Europe/London",
    asOf: now.toISOString(),
    counts,
    daily,
    byHost: Array.from(hosts.values()).sort((a, b) =>
      a.hostName.localeCompare(b.hostName)
    ),
    byReason: Array.from(reasons.values()).sort((a, b) =>
      a.reasonKey.localeCompare(b.reasonKey)
    ),
    warnings: [
      "Only calls retained by this feature are included; older public events and RSVPs are not attendance records.",
      "Booked during uses the first provider confirmation; scheduled in uses the current appointment time. Cancelled and rescheduled history is retained.",
      "Attendance rate is attended ÷ (attended + no-show). Unrecorded, future, cancelled-only, excused and not-held invitations are excluded.",
      "Participant totals count invitations, not unique agents. Sessions with attendance means at least one manually marked attended participant.",
    ],
  };
}
