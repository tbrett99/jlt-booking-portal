import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "./db";
import { membershipPaymentAccounts, membershipPaymentControl } from "../drizzle/schema";

export function isMembershipSchemaMissing(error: unknown): boolean {
  let current: any = error;
  for (let depth = 0; current && depth < 6; depth++, current = current.cause) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(current.code) || /(?:doesn't exist|Unknown column).*membership_|membership_.*(?:doesn't exist|Unknown column)/i.test(current.message ?? "")) return true;
  }
  return false;
}
export async function readMembershipPaymentState(userId: number) {
  const db = await getDb(); if (!db) throw new Error("Payment database unavailable");
  try {
    const [account] = await db.select().from(membershipPaymentAccounts).where(eq(membershipPaymentAccounts.userId, userId)).limit(1);
    const [control] = await db.select().from(membershipPaymentControl).where(eq(membershipPaymentControl.id, 1)).limit(1);
    return { available: true, verified: Boolean(account?.lastSyncedAt && control?.lastSuccessAt && !account.lastError && !control.lastError), account: account ?? null, lastProviderSyncAt: control?.lastSuccessAt ?? null, syncError: account?.lastError ?? control?.lastError ?? null };
  } catch (error) {
    if (!isMembershipSchemaMissing(error)) throw error;
    return { available: false, verified: false, account: null, lastProviderSyncAt: null, syncError: "Apply the membership payment reliability migration to Railway." };
  }
}
export async function getCurrentMembershipPaymentIssues() {
  const db = await getDb(); if (!db) throw new Error("Payment database unavailable");
  return db.select({ userId: membershipPaymentAccounts.userId, failedAttempts: membershipPaymentAccounts.failedAttempts, outstandingCount: membershipPaymentAccounts.outstandingCount, lastSyncedAt: membershipPaymentAccounts.lastSyncedAt })
    .from(membershipPaymentAccounts).where(gt(membershipPaymentAccounts.outstandingCount, 0));
}
