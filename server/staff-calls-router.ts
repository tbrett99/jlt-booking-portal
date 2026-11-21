import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import {
  staffCallDiaryInput,
  staffCallWindowInput,
  staffCallAgentsInput,
  staffCallGetInput,
  staffCallAvailabilityInput,
  staffCallBookInput,
  staffCallRescheduleInput,
  staffCallCancelInput,
  staffCallCancelParticipantInput,
  staffCallReconcileInput,
  staffCallNotesInput,
  staffCallShareInput,
  staffCallFollowUpInput,
  staffCallAgentHistoryInput,
} from "../shared/staff-calls";
import { staffCallsService } from "./staff-calls-service";
import { getStaffCallReport } from "./staff-calls-reporting";

// Database/provider internals may contain SQL including notes; never serialize those errors.
const procedure = protectedProcedure.use(async ({ ctx, next }) => {
  try {
    const result = await next({ ctx });
    if (!result.ok && result.error.code === "INTERNAL_SERVER_ERROR")
      throw new Error("Private operation failure");
    return result;
  } catch (error) {
    if (error instanceof TRPCError && error.code !== "INTERNAL_SERVER_ERROR")
      throw error;
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "The private diary operation could not be completed. Please reload or contact an administrator.",
    });
  }
});

export const staffCallsRouter = router({
  context: procedure.query(({ ctx }) => staffCallsService.context(ctx.user.id)),
  hosts: procedure.query(({ ctx }) => staffCallsService.hosts(ctx.user.id)),
  agents: procedure
    .input(staffCallAgentsInput)
    .query(({ ctx, input }) => staffCallsService.agents(ctx.user.id, input)),
  diary: procedure
    .input(staffCallDiaryInput)
    .query(({ ctx, input }) => staffCallsService.diary(ctx.user.id, input)),
  mine: procedure
    .input(staffCallWindowInput)
    .query(({ ctx, input }) => staffCallsService.mine(ctx.user.id, input)),
  get: procedure
    .input(staffCallGetInput)
    .query(({ ctx, input }) =>
      staffCallsService.get(ctx.user.id, input.callId)
    ),
  availability: procedure
    .input(staffCallAvailabilityInput)
    .query(({ ctx, input }) =>
      staffCallsService.availability(ctx.user.id, input)
    ),
  book: procedure
    .input(staffCallBookInput)
    .mutation(({ ctx, input }) => staffCallsService.book(ctx.user.id, input)),
  reschedule: procedure
    .input(staffCallRescheduleInput)
    .mutation(({ ctx, input }) =>
      staffCallsService.reschedule(ctx.user.id, input)
    ),
  cancel: procedure
    .input(staffCallCancelInput)
    .mutation(({ ctx, input }) => staffCallsService.cancel(ctx.user.id, input)),
  cancelParticipant: procedure
    .input(staffCallCancelParticipantInput)
    .mutation(({ ctx, input }) =>
      staffCallsService.cancelParticipant(ctx.user.id, input)
    ),
  reconcile: procedure
    .input(staffCallReconcileInput)
    .mutation(({ ctx, input }) =>
      staffCallsService.reconcile(ctx.user.id, input.requestId)
    ),
  saveNotes: procedure
    .input(staffCallNotesInput)
    .mutation(({ ctx, input }) =>
      staffCallsService.saveNotes(ctx.user.id, input)
    ),
  shareRecap: procedure
    .input(staffCallShareInput)
    .mutation(({ ctx, input }) =>
      staffCallsService.shareRecap(ctx.user.id, input)
    ),
  draftFollowUp: procedure
    .input(staffCallFollowUpInput)
    .mutation(({ ctx, input }) =>
      staffCallsService.draftFollowUp(ctx.user.id, input)
    ),
  agentHistory: procedure
    .input(staffCallAgentHistoryInput)
    .query(({ ctx, input }) =>
      staffCallsService.agentHistory(ctx.user.id, input)
    ),
  report: procedure
    .input(
      z
        .object({
          rangeStart: z.string(),
          rangeEnd: z.string(),
          basis: z.enum(["booked", "scheduled"]),
          hostUserId: z.number().int().positive().optional(),
          reasonKey: z.string().max(64).optional(),
          format: z.enum(["one_to_one", "group"]).optional(),
        })
        .strict()
    )
    .query(({ ctx, input }) => getStaffCallReport(ctx.user.id, input)),
});
