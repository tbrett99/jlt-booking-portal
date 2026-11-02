import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { sdk } from "./_core/sdk";
import { reconcileMembershipPayments } from "./membership-payment-sync";
import { getDb } from "./db";
import { membershipPaymentControl } from "../drizzle/schema";
import { eq } from "drizzle-orm";

export function matchesMembershipCronSecret(provided: unknown, expected = process.env.MEMBERSHIP_PAYMENT_CRON_SECRET): boolean {
  if (typeof provided !== "string" || !expected || expected.length < 32) return false;
  const left = Buffer.from(provided), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
export async function membershipPaymentRecoveryHandler(req: Request, res: Response) {
  let authorised = matchesMembershipCronSecret(req.headers["x-membership-cron-secret"]);
  if (!authorised) {
    try {
      const caller = await sdk.authenticateRequest(req);
      if (caller.isCron && caller.taskUid) {
        const db = await getDb();
        const rows = db ? await db.select({ id: membershipPaymentControl.id }).from(membershipPaymentControl).where(eq(membershipPaymentControl.scheduleCronTaskUid, caller.taskUid)).limit(1) : [];
        authorised = rows.length === 1;
      }
    }
    catch { authorised = false; }
  }
  if (!authorised) return res.status(403).json({ error: "Payment recovery cron authentication required" });
  try {
    const result = await reconcileMembershipPayments();
    return res.json({ ok: true, result, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("[MembershipPaymentRecovery] Failed", (error as Error).message);
    return res.status(503).json({ ok: false, error: "Membership payment recovery did not complete. Check Memberships → Payment & Direct Debit Issues and Railway logs.", timestamp: new Date().toISOString() });
  }
}
export function registerMembershipPaymentRoutes(app: Express) {
  app.post("/api/scheduled/membership-payments", membershipPaymentRecoveryHandler);
}
