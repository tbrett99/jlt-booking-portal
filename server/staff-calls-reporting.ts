import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import {
  staffCalls,
  staffCallParticipants,
  staffCallHistory,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { requireStaffCallActor } from "./staff-calls-service";
import {
  calculateStaffCallReport,
  staffCallReportRange,
  type StaffCallReportInput,
} from "../shared/staff-call-reporting";

const MAX_CALLS = 5000;
const MAX_PARTICIPANTS = 50000;
const MAX_RESCHEDULE_HISTORY = 50000;
export async function getStaffCallReport(
  actorId: number,
  input: StaffCallReportInput
) {
  let range: ReturnType<typeof staffCallReportRange>;
  try {
    range = staffCallReportRange(input);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose valid London calendar dates spanning 1–366 days.",
    });
  }
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Call reporting is unavailable.",
    });
  await requireStaffCallActor(db, actorId, { manage: true, admin: true });
  const result = await db.transaction(
    async tx => {
      await requireStaffCallActor(tx, actorId, { manage: true, admin: true });
      const dateColumn =
        input.basis === "booked" ? staffCalls.bookedAt : staffCalls.startAt;
      const calls = await tx
        .select({
          id: staffCalls.id,
          hostUserId: staffCalls.hostUserId,
          hostName: users.name,
          reasonKey: staffCalls.reasonKey,
          format: staffCalls.format,
          status: staffCalls.status,
          startAt: staffCalls.startAt,
          endAt: staffCalls.endAt,
          createdAt: staffCalls.createdAt,
          bookedAt: staffCalls.bookedAt,
        })
        .from(staffCalls)
        .leftJoin(users, eq(users.id, staffCalls.hostUserId))
        .where(
          and(
            gte(dateColumn, range.start),
            lt(dateColumn, range.end),
            input.hostUserId
              ? eq(staffCalls.hostUserId, input.hostUserId)
              : undefined,
            input.reasonKey
              ? eq(staffCalls.reasonKey, input.reasonKey)
              : undefined,
            input.format ? eq(staffCalls.format, input.format) : undefined
          )
        )
        .orderBy(asc(staffCalls.id))
        .limit(MAX_CALLS + 1);
      if (calls.length > MAX_CALLS)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This period contains too many calls. Narrow the dates or staff filter; no partial totals are displayed.",
        });
      const ids = calls.map(call => call.id);
      const participants = ids.length
        ? await tx
            .select({
              id: staffCallParticipants.id,
              callId: staffCallParticipants.callId,
              status: staffCallParticipants.status,
              attendance: staffCallParticipants.attendance,
              bookedAt: staffCallParticipants.bookedAt,
            })
            .from(staffCallParticipants)
            .where(inArray(staffCallParticipants.callId, ids))
            .orderBy(asc(staffCallParticipants.id))
            .limit(MAX_PARTICIPANTS + 1)
        : [];
      if (participants.length > MAX_PARTICIPANTS)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This period contains too many participant invitations. Narrow the filters; no partial totals are displayed.",
        });
      const history = ids.length
        ? await tx
            .select({ callId: staffCallHistory.callId })
            .from(staffCallHistory)
            .where(
              and(
                inArray(staffCallHistory.callId, ids),
                inArray(staffCallHistory.action, [
                  "reschedule.succeeded",
                  "provider.rescheduled",
                ])
              )
            )
            .orderBy(asc(staffCallHistory.id))
            .limit(MAX_RESCHEDULE_HISTORY + 1)
        : [];
      if (history.length > MAX_RESCHEDULE_HISTORY)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This period contains too much reschedule history. Narrow the filters; no partial totals are displayed.",
        });
      const rescheduled = new Set(history.map(row => row.callId));
      return calculateStaffCallReport(
        input,
        calls.map(call => ({
          ...call,
          hostName: call.hostName ?? "Former or unavailable host",
          rescheduled: rescheduled.has(call.id),
        })),
        participants
      );
    },
    { isolationLevel: "repeatable read" }
  );
  // Independent post-snapshot check prevents a cached session/revoked role from
  // receiving results after a longer report read. Never expose private notes.
  await requireStaffCallActor(db, actorId, { manage: true, admin: true });
  return result;
}
