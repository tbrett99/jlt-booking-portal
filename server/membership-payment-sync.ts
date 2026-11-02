import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { gcMandates, gcSubscriptions, membershipPaymentInbox, membershipPaymentControl, membershipPaymentFees } from "../drizzle/schema";
import { recordMembershipPaymentEvent, processMembershipPaymentAccount, processMembershipPaymentOutbox } from "./membership-payment-service";
import { createPaymentEvent } from "./gocardless-db";

export type MembershipProviderEvent = {
  id: string; action: string; resource_type: string; created_at: string;
  links: { payment?: string; mandate?: string; subscription?: string };
  details?: { description?: string; cause?: string; will_attempt_retry?: boolean };
};
type ProviderPayment = { id: string; amount: number; currency: string; status: string; links?: { subscription?: string; mandate?: string }; metadata?: Record<string, string> };
const paymentActions = new Set(["failed", "charged_back", "confirmed", "paid_out", "submitted", "resubmission_requested", "cancelled", "pending_submission"]);

export async function membershipProviderGet<T>(path: string): Promise<T> {
  const token = process.env.GOCARDLESS_ACCESS_TOKEN;
  if (!token) throw new Error("GoCardless access is not configured");
  const base = (process.env.GOCARDLESS_ENVIRONMENT ?? "live").toLowerCase() === "live" ? "https://api.gocardless.com" : "https://api-sandbox.gocardless.com";
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}`, "GoCardless-Version": "2015-07-06", Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`GoCardless read failed: HTTP ${response.status}`);
  return await response.json() as T;
}

/** Persist first. Mapping, counters and notifications are resumable work, not receipt. */
export async function receiveMembershipProviderEvent(event: MembershipProviderEvent, source: "webhook" | "reconciliation") {
  await receiveMembershipProviderEvents([event], source);
}

/** One durable insert per provider page; exact replays never reopen excluded or processed events. */
export async function receiveMembershipProviderEvents(events: MembershipProviderEvent[], source: "webhook" | "reconciliation") {
  if (!events.length) return;
  if (events.length > 500) throw new Error("Provider receipt page exceeds the supported batch size");
  const values = events.map(event => {
  if (!event.id || !event.created_at || !Number.isFinite(new Date(event.created_at).getTime())) throw new Error("Provider event ID and timestamp are required");
    return {
      eventId: event.id, paymentId: event.links?.payment ?? null, mandateId: event.links?.mandate ?? null,
      subscriptionId: event.links?.subscription ?? null, action: event.resource_type === "payments" ? event.action : `${event.resource_type}_${event.action}`,
      occurredAt: new Date(event.created_at), source, rawPayload: JSON.stringify(event), status: "pending",
    };
  });
  const db = await getDb(); if (!db) throw new Error("Payment database unavailable");
  await db.insert(membershipPaymentInbox).values(values)
    .onDuplicateKeyUpdate({ set: { eventId: sql`${membershipPaymentInbox.eventId}` } });
}

export async function enrichMembershipProviderEvent(event: MembershipProviderEvent, source: "webhook" | "reconciliation") {
  const db = await getDb(); if (!db) throw new Error("Payment database unavailable");
  if (event.resource_type === "subscriptions" && event.links?.subscription) {
    const rows = await db.select().from(gcSubscriptions).where(eq(gcSubscriptions.subscriptionId, event.links.subscription));
    if (rows.length) {
      const live = await membershipProviderGet<{ subscriptions: { status: string } }>(`/subscriptions/${encodeURIComponent(event.links.subscription)}`);
      await db.update(gcSubscriptions).set({ status: live.subscriptions.status as any }).where(eq(gcSubscriptions.subscriptionId, event.links.subscription));
    }
    await db.update(membershipPaymentInbox).set({ status: "ignored", processedAt: new Date(), lastError: null }).where(eq(membershipPaymentInbox.eventId, event.id));
    return null;
  }
  if (event.resource_type === "mandates" && event.links?.mandate) {
    // Current provider resource wins, not an old cancellation replay for a replacement.
    const rows = await db.select().from(gcMandates).where(eq(gcMandates.mandateId, event.links.mandate));
    if (rows.length) {
      const live = await membershipProviderGet<{ mandates: { status: string } }>(`/mandates/${encodeURIComponent(event.links.mandate)}`);
      await db.update(gcMandates).set({ status: live.mandates.status as any }).where(eq(gcMandates.mandateId, event.links.mandate));
    }
    await db.update(membershipPaymentInbox).set({ status: "ignored", processedAt: new Date(), lastError: null }).where(eq(membershipPaymentInbox.eventId, event.id));
    return null;
  }
  if (event.resource_type !== "payments" || !event.links?.payment || !paymentActions.has(event.action)) {
    await db.update(membershipPaymentInbox).set({ status: "ignored", processedAt: new Date(), lastError: null }).where(eq(membershipPaymentInbox.eventId, event.id));
    return null;
  }
  const { payments: payment } = await membershipProviderGet<{ payments: ProviderPayment }>(`/payments/${encodeURIComponent(event.links.payment)}`);
  if (payment.id !== event.links.payment) throw new Error("Provider payment identity did not match the event");
  // Fee collections are separate obligations: never count them as a membership strike.
  const [fee] = await db.select().from(membershipPaymentFees).where(eq(membershipPaymentFees.paymentId, payment.id)).limit(1);
  if (fee || payment.metadata?.jlt_payment_kind === "membership_admin_fee") {
    if (fee) {
      const state = ["confirmed", "paid_out"].includes(payment.status) ? "paid" : ["failed", "charged_back", "cancelled"].includes(payment.status) ? "failed" : "collection_pending";
      await db.update(membershipPaymentFees).set({ status: state }).where(eq(membershipPaymentFees.id, fee.id));
    }
    await db.update(membershipPaymentInbox).set({ status: "ignored", processedAt: new Date(), lastError: null }).where(eq(membershipPaymentInbox.eventId, event.id));
    return null;
  }
  const subscriptionId = payment.links?.subscription ?? event.links?.subscription;
  // A mandate alone does not prove a payment is a monthly membership payment.
  // Joining fees and unrelated one-offs cannot reset or increment this policy.
  if (!subscriptionId) {
    await db.update(membershipPaymentInbox).set({ status: "ignored", processedAt: new Date(), lastError: null }).where(eq(membershipPaymentInbox.eventId, event.id));
    return null;
  }
  const subscriptions = await db.select().from(gcSubscriptions).where(eq(gcSubscriptions.subscriptionId, subscriptionId));
  const owners = new Set(subscriptions.map(s => s.userId));
  if (owners.size !== 1 || !subscriptions[0]?.userId) throw new Error("Membership subscription owner is missing or ambiguous; held for mapping review");
  const userId = subscriptions[0].userId;
  if (["failed", "charged_back"].includes(event.action) && ["confirmed", "paid_out"].includes(payment.status)) {
    // A delayed failure cannot suspend somebody whose same instalment has
    // already succeeded. Import actual provider evidence, never invent a
    // successful event from a current-status label or clear another month.
    const page = await membershipProviderGet<{ events: MembershipProviderEvent[] }>(`/events?payment=${encodeURIComponent(payment.id)}&limit=500`);
    const recoveries = page.events?.filter(e => e.resource_type === "payments" && e.links?.payment === payment.id && ["confirmed", "paid_out"].includes(e.action));
    if (!recoveries?.length) throw new Error("Payment is currently recovered but its matching recovery event is unavailable; held for review, no suspension applied");
    for (const recovered of recoveries) await recordMembershipPaymentEvent({
      eventId: recovered.id, userId, paymentId: payment.id, subscriptionId,
      mandateId: payment.links?.mandate ?? null, action: recovered.action, occurredAt: new Date(recovered.created_at),
      amountPence: payment.amount, currency: payment.currency, source, rawPayload: JSON.stringify(recovered),
    });
  }
  await recordMembershipPaymentEvent({
    eventId: event.id, userId, paymentId: payment.id, subscriptionId,
    mandateId: payment.links?.mandate ?? event.links?.mandate ?? null,
    action: event.action as any, occurredAt: new Date(event.created_at), amountPence: payment.amount, currency: payment.currency,
    willAttemptRetry: event.details?.will_attempt_retry ?? null, reason: event.details?.description ?? event.details?.cause ?? null,
    source, rawPayload: JSON.stringify(event),
  });
  // Keep the familiar audit timeline. This is not the processing/replay checkpoint.
  await createPaymentEvent({ gocardlessEventId: event.id, userId, paymentId: payment.id,
    mandateId: payment.links?.mandate, eventType: `payments_${event.action}`, status: event.action,
    amount: payment.amount, currency: payment.currency, occurredAt: new Date(event.created_at),
    failureDescription: event.details?.description, failureReason: event.details?.cause, rawPayload: JSON.stringify(event) });
  await processMembershipPaymentAccount(userId);
  return userId;
}

export async function recoverPendingMembershipEvents(limit = 100, deadline = Date.now() + 85000) {
  const db = await getDb(); if (!db) throw new Error("Payment database unavailable");
  const rows = await db.select().from(membershipPaymentInbox)
    .where(and(or(eq(membershipPaymentInbox.status, "pending"), eq(membershipPaymentInbox.status, "failed")), or(isNull(membershipPaymentInbox.nextProcessingAt), lte(membershipPaymentInbox.nextProcessingAt, new Date()))))
    .orderBy(membershipPaymentInbox.occurredAt).limit(Math.min(limit, 500));
  let completed = 0, errors = 0;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    try { await enrichMembershipProviderEvent(JSON.parse(row.rawPayload), row.source as "webhook" | "reconciliation"); completed++; }
    catch (error) {
      errors++;
      await db.update(membershipPaymentInbox).set({ status: "failed", processingAttempts: row.processingAttempts + 1, nextProcessingAt: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(row.processingAttempts, 6))), lastError: String((error as Error).message).slice(0, 2000) }).where(eq(membershipPaymentInbox.id, row.id));
    }
  }
  const counts = await membershipRecoveryQueueCounts();
  return { completed, errors, ...counts };
}

export async function membershipRecoveryQueueCounts() {
  const db = await getDb(); if (!db) throw new Error("Payment database unavailable");
  const [counts] = await db.select({
    pending: sql<number>`COALESCE(SUM(CASE WHEN ${membershipPaymentInbox.status} = 'pending' THEN 1 ELSE 0 END), 0)`,
    failed: sql<number>`COALESCE(SUM(CASE WHEN ${membershipPaymentInbox.status} = 'failed' THEN 1 ELSE 0 END), 0)`,
  }).from(membershipPaymentInbox).where(or(eq(membershipPaymentInbox.status, "pending"), eq(membershipPaymentInbox.status, "failed")));
  const pending = Number(counts?.pending ?? 0), failed = Number(counts?.failed ?? 0);
  return { pending, failed, backlog: pending + failed };
}

export class MembershipRecoveryReviewError extends Error {
  constructor(public readonly progress: { completed: number; errors: number; pending: number; failed: number; backlog: number }) {
    super(`${progress.failed} payment events require recovery or mapping review; ${progress.pending} pending events remain. Initial recovery is not complete.`);
    this.name = "MembershipRecoveryReviewError";
  }
}

/** External HTTP cron owns the schedule; no in-process timer or detached worker. */
export async function reconcileMembershipPayments() {
  const db = await getDb(); if (!db) throw new Error("Payment database unavailable");
  const started = new Date(), lockToken = randomUUID();
  await db.insert(membershipPaymentControl).values({ id: 1, enabled: false }).onDuplicateKeyUpdate({ set: { id: 1 } });
  const lease = await db.update(membershipPaymentControl).set({ syncLockToken: lockToken, syncLockedUntil: new Date(started.getTime() + 10 * 60 * 1000) })
    .where(and(eq(membershipPaymentControl.id, 1), or(isNull(membershipPaymentControl.syncLockedUntil), lte(membershipPaymentControl.syncLockedUntil, started))));
  if (!(lease as any)[0]?.affectedRows) return { skipped: "another reconciliation is running" };
  try {
    const [control] = await db.select().from(membershipPaymentControl).where(eq(membershipPaymentControl.id, 1));
    const since = control.lastEventSyncAt ? new Date(control.lastEventSyncAt.getTime() - 24 * 60 * 60 * 1000) : new Date(started);
    if (!control.lastEventSyncAt) since.setUTCMonth(since.getUTCMonth() - 18);
    let cursor: string | null = null, eventCount = 0, pages = 0;
    const cursors = new Set<string>();
    do {
      const params = new URLSearchParams({ limit: "500", "created_at[gte]": since.toISOString(), "created_at[lte]": started.toISOString() });
      if (cursor) params.set("after", cursor);
      const page = await membershipProviderGet<{ events: MembershipProviderEvent[]; meta?: { cursors?: { after?: string | null } } }>(`/events?${params}`);
      if (!Array.isArray(page.events)) throw new Error("Invalid provider event-list response");
      // Store each page before any network enrichment. A failed later page never advances the cursor.
      const relevant = page.events.filter(event => ["payments", "mandates", "subscriptions"].includes(event.resource_type));
      await receiveMembershipProviderEvents(relevant, "reconciliation"); eventCount += relevant.length;
      cursor = page.meta?.cursors?.after ?? null; pages++;
      if (cursor && (cursors.has(cursor) || pages >= 100)) throw new Error("Incomplete event pagination; recovery cursor not advanced");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    await db.update(membershipPaymentControl).set({ lastEventSyncAt: started }).where(and(eq(membershipPaymentControl.id, 1), eq(membershipPaymentControl.syncLockToken, lockToken)));
    const recovered = await recoverPendingMembershipEvents(250, started.getTime() + 85000);
    const notifications = await processMembershipPaymentOutbox(50);
    if (recovered.errors || recovered.failed) throw new MembershipRecoveryReviewError(recovered);
    if (recovered.pending) {
      // A successful bounded batch is not a completed/healthy ledger. The activation
      // gate still checks both lastSuccessAt and the actual pending/failed counts.
      await db.update(membershipPaymentControl).set({ lastError: null })
        .where(and(eq(membershipPaymentControl.id, 1), eq(membershipPaymentControl.syncLockToken, lockToken)));
      return { status: "in_progress" as const, eventCount, pages, recovered, notifications, automationEnabled: control.enabled };
    }
    await db.update(membershipPaymentControl).set({ lastSuccessAt: new Date(), lastError: null }).where(and(eq(membershipPaymentControl.id, 1), eq(membershipPaymentControl.syncLockToken, lockToken)));
    return { status: "complete" as const, eventCount, pages, recovered, notifications, automationEnabled: control.enabled };
  } catch (error) {
    await db.update(membershipPaymentControl).set({ lastError: String((error as Error).message).slice(0, 2000) }).where(and(eq(membershipPaymentControl.id, 1), eq(membershipPaymentControl.syncLockToken, lockToken)));
    throw error;
  } finally {
    await db.update(membershipPaymentControl).set({ syncLockToken: null, syncLockedUntil: null }).where(and(eq(membershipPaymentControl.id, 1), eq(membershipPaymentControl.syncLockToken, lockToken)));
  }
}
