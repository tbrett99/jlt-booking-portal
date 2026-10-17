import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  MOMENTUM_RULE_KEYS,
  getMomentumAdminDashboard,
  getMyMomentum,
  reverseMomentumForSource,
  updateMomentumRule,
} from "./momentum";

const ruleKey = z.enum(MOMENTUM_RULE_KEYS);

export const momentumRouter = router({
  mine: protectedProcedure.query(async ({ ctx }) => getMyMomentum(ctx.user.id)),

  adminDashboard: adminProcedure.query(async () => getMomentumAdminDashboard()),

  updateRule: adminProcedure.input(z.object({
    ruleKey,
    enabled: z.boolean(),
    points: z.number().int().min(0).max(1_000),
    weeklyCap: z.number().int().min(0).max(10_000),
    minimumTextLength: z.number().int().min(0).max(2_000),
  })).mutation(async ({ input }) => {
    await updateMomentumRule(input);
    return { success: true };
  }),

  reverseEntry: adminProcedure.input(z.object({
    agentId: z.number().int().positive(),
    sourceType: z.string().min(1).max(80),
    sourceId: z.number().int().positive(),
    reason: z.string().trim().min(3).max(2_000),
  })).mutation(async ({ ctx, input }) => {
    const count = await reverseMomentumForSource({
      agentId: input.agentId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      reversedById: ctx.user.id,
      reason: input.reason,
    });
    if (!count) throw new TRPCError({ code: "NOT_FOUND", message: "No active Momentum award was found for that source" });
    return { reversed: count };
  }),
});
