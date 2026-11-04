import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { adminProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { membershipPaymentControl as control, membershipPaymentFees as fees, membershipPaymentInbox as inbox } from "../drizzle/schema";
import { reconcileMembershipPayments } from "./membership-payment-sync";
import { recordManualMembershipSettlement, ignoreMembershipPayment } from "./membership-payment-service";

export const membershipPaymentControlProcedures = {
  refreshFromProvider: adminProcedure.input(z.object({})).mutation(async () => reconcileMembershipPayments()),
  setAutomation: adminProcedure.input(z.object({ enabled: z.boolean(), confirmation: z.string() })).mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== "super_admin") throw new TRPCError({ code: "FORBIDDEN", message: "Super Admin approval is required." });
    if (input.confirmation !== (input.enabled ? "ENABLE FUTURE PAYMENT RULES" : "PAUSE PAYMENT RULES")) throw new TRPCError({ code: "BAD_REQUEST", message: "Type the displayed confirmation exactly." });
    const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    return db.transaction(async tx => {
      const [state] = await tx.select().from(control).where(eq(control.id, 1)).for("update");
      if (!state) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Complete the first provider reconciliation before enabling rules." });
      const checkAt = state.activatedAt ? state.lastEventSyncAt : state.lastSuccessAt;
      if (input.enabled && (!checkAt || (!state.activatedAt && state.lastError) || Date.now() - checkAt.getTime() > 15 * 60 * 1000)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A current provider reconciliation is required. First activation needs a healthy complete ledger; resuming retries already activated future work." });
      const [pending] = await tx.select({ count: sql<number>`COUNT(*)` }).from(inbox).where(inArray(inbox.status, ["pending", "failed"]));
      const [failed] = await tx.select({ count: sql<number>`COUNT(*)` }).from(inbox).where(eq(inbox.status, "failed"));
      if (input.enabled && ((!state.activatedAt && Number(pending?.count ?? 0) > 0) || Number(failed?.count ?? 0) > 0)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Resolve the provider-event errors before enabling future rules." });
      await tx.update(control).set({ enabled: input.enabled, activatedAt: state.activatedAt ?? (input.enabled ? new Date() : null) }).where(eq(control.id, 1));
      return { enabled: input.enabled, activatedAt: state.activatedAt ?? (input.enabled ? new Date() : null) };
    });
  }),
  approveFeePolicy: adminProcedure.input(z.object({ amountPence: z.number().int().positive().max(100000), confirmation: z.literal("APPROVE ADMIN FEE POLICY") })).mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== "super_admin") throw new TRPCError({ code: "FORBIDDEN", message: "Super Admin approval is required." });
    const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    await db.update(control).set({ feePolicyApproved: true, feeAmountPence: input.amountPence, feeCollectionMode: "staff_approval" }).where(eq(control.id, 1));
    return { amountPence: input.amountPence, collectionMode: "staff_approval", note: "Only future qualifying fees are assessed. No money is collected by this action." };
  }),
  recordSettlement: adminProcedure.input(z.object({ userId: z.number().int().positive(), paymentId: z.string().min(1).max(100), amountPence: z.number().int().positive(), reference: z.string().trim().min(1).max(255), notes: z.string().trim().min(1).max(3000), settledAt: z.string().datetime(), confirmation: z.literal("RECORD PAYMENT RECEIVED") })).mutation(async ({ ctx, input }) => {
    try { return await recordManualMembershipSettlement({ ...input, actorId: ctx.user.id }); }
    catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message }); }
  }),
  ignorePayment: adminProcedure.input(z.object({ userId: z.number().int().positive(), paymentId: z.string().trim().min(1).max(100), amountPence: z.number().int().positive(), reason: z.string().trim().min(3).max(3000), confirmation: z.literal("IGNORE OUTSTANDING PAYMENT") })).mutation(async ({ ctx, input }) => {
    try { return await ignoreMembershipPayment({ ...input, actorId: ctx.user.id }); }
    catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message }); }
  }),
  recordFeeSettlement: adminProcedure.input(z.object({ feeId: z.number().int().positive(), reference: z.string().trim().min(1).max(255), notes: z.string().trim().min(1).max(3000), confirmation: z.literal("RECORD FEE RECEIVED") })).mutation(async ({ ctx, input }) => {
    const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    return db.transaction(async tx => {
      const [fee] = await tx.select().from(fees).where(eq(fees.id, input.feeId)).for("update");
      if (!fee || fee.status !== "assessed") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only an assessed, not already collected fee can be recorded as manually paid. Historical review fees require separate review." });
      await tx.update(fees).set({ status: "paid", settledById: ctx.user.id, notes: `${fee.notes ?? ""}\nManual receipt ${new Date().toISOString()}; reference ${input.reference}; ${input.notes}` }).where(and(eq(fees.id, fee.id), eq(fees.status, "assessed")));
      return { paid: true, feeId: fee.id, note: "Only this fee was settled. Membership instalments and access were not changed." };
    });
  }),
};
