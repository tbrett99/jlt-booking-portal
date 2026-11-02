import { eq, gt, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { membershipPaymentAccounts, membershipPaymentControl, membershipPaymentInbox } from "../drizzle/schema";

// The Memberships workspace uses the same three-missed-five-minute-runs threshold.
export const MEMBERSHIP_PAYMENT_HEALTH_MAX_AGE_MS = 15 * 60 * 1000;

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
    const [queue] = await db.select({
      pending: sql<number>`COALESCE(SUM(CASE WHEN ${membershipPaymentInbox.status} = 'pending' THEN 1 ELSE 0 END), 0)`,
      failed: sql<number>`COALESCE(SUM(CASE WHEN ${membershipPaymentInbox.status} = 'failed' THEN 1 ELSE 0 END), 0)`,
    }).from(membershipPaymentInbox).where(or(eq(membershipPaymentInbox.status, "pending"), eq(membershipPaymentInbox.status, "failed")));
    const pending = Number(queue?.pending), failed = Number(queue?.failed);
    const successAt = control?.lastSuccessAt ? new Date(control.lastSuccessAt).getTime() : NaN;
    const providerAt = control?.lastEventSyncAt ? new Date(control.lastEventSyncAt).getTime() : NaN;
    const accountAt = account?.lastSyncedAt ? new Date(account.lastSyncedAt).getTime() : NaN;
    const age = Date.now() - successAt;
    let syncError: string | null = account?.lastError ?? control?.lastError ?? null;
    if (!syncError && (!Number.isFinite(pending) || !Number.isFinite(failed))) {
      syncError = "Current payment health is unverified because the recovery queue could not be checked.";
    } else if (!syncError && failed > 0) {
      syncError = `Current payment health is unverified: ${failed} payment event(s) require recovery or mapping review.`;
    } else if (!syncError && pending > 0) {
      syncError = `Current payment health is unverified while recovery is in progress: ${pending} payment event(s) remain pending.`;
    } else if (!syncError && Number.isFinite(providerAt) && (!Number.isFinite(successAt) || providerAt > successAt)) {
      syncError = "Current payment health is unverified: the latest provider scan has not completed ledger recovery.";
    } else if (!syncError && (!Number.isFinite(successAt) || age < 0 || age > MEMBERSHIP_PAYMENT_HEALTH_MAX_AGE_MS)) {
      syncError = "Current payment health is unverified: a complete provider reconciliation is missing or more than 15 minutes old.";
    } else if (!syncError && !Number.isFinite(accountAt)) {
      syncError = "Current payment health is unverified: this agent's payment ledger has not been reconciled.";
    }
    // An agent with no new events need not be rewritten every five minutes: a fresh,
    // complete provider scan and an empty inbox verify their unchanged ledger.
    return { available: true, verified: !syncError, account: account ?? null, lastProviderSyncAt: control?.lastSuccessAt ?? null, syncError };
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
