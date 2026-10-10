import { getDb } from "./db";
import { gcMandates, gcSubscriptions, gcPaymentEvents } from "../drizzle/schema";
import { and, eq, desc } from "drizzle-orm";

/**
 * Migration 0152 adds GoCardless' immutable event ID. Older production
 * databases can still receive webhooks and serve CRM history while that
 * additive column is awaiting rollout.
 */
export function isMissingGoCardlessEventIdColumn(error: unknown) {
  const candidate = error as { code?: string; message?: string; cause?: { code?: string; message?: string } } | undefined;
  const cause = candidate?.cause;
  const code = candidate?.code ?? cause?.code;
  const message = `${candidate?.message ?? ""}\n${cause?.message ?? ""}`;
  return (
    (code === "ER_BAD_FIELD_ERROR" || code === "ER_NO_SUCH_COLUMN" || /unknown column/i.test(message)) &&
    /gocardlessEventId/i.test(message)
  );
}

const legacyPaymentEventColumns = {
  id: gcPaymentEvents.id,
  userId: gcPaymentEvents.userId,
  mandateId: gcPaymentEvents.mandateId,
  paymentId: gcPaymentEvents.paymentId,
  eventType: gcPaymentEvents.eventType,
  status: gcPaymentEvents.status,
  amount: gcPaymentEvents.amount,
  currency: gcPaymentEvents.currency,
  failureReason: gcPaymentEvents.failureReason,
  failureDescription: gcPaymentEvents.failureDescription,
  occurredAt: gcPaymentEvents.occurredAt,
  rawPayload: gcPaymentEvents.rawPayload,
  createdAt: gcPaymentEvents.createdAt,
};

/**
 * The CRM is a lifecycle log, not a payment ledger. Historic webhook retries
 * can leave more than one row for the same payment reaching the same state.
 * Callers order newest-first, so keep that first record while retaining
 * genuinely separate payments and state changes.
 */
export function dedupePaymentEventHistory<T extends {
  id: number;
  paymentId?: string | null;
  eventType: string;
  gocardlessEventId?: string | null;
}>(events: T[]): T[] {
  const seen = new Set<string>();

  return events.filter((event) => {
    const key = event.paymentId
      ? `payment:${event.paymentId}:${event.eventType}`
      : event.gocardlessEventId
        ? `event:${event.gocardlessEventId}`
        : `row:${event.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Mandate helpers ──────────────────────────────────────────────────────────

export async function createGcMandate(data: {
  userId: number | null;
  billingRequestId: string;
  billingRequestFlowId: string;
  preferredPaymentDay: number;
  joiningFeePaidAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(gcMandates).values({
    userId: data.userId,
    billingRequestId: data.billingRequestId,
    billingRequestFlowId: data.billingRequestFlowId,
    preferredPaymentDay: data.preferredPaymentDay,
    joiningFeePaidAt: data.joiningFeePaidAt ?? new Date(),
    status: "pending",
  });
  return result;
}

export async function getGcMandateByUserId(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(gcMandates)
    .where(eq(gcMandates.userId, userId))
    .orderBy(gcMandates.createdAt)
    .limit(1);
  return rows[0] ?? null;
}

export async function getGcMandateByBillingRequestId(brqId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(gcMandates)
    .where(eq(gcMandates.billingRequestId, brqId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getGcMandateByMandateId(mandateId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(gcMandates)
    .where(eq(gcMandates.mandateId, mandateId))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateGcMandate(
  id: number,
  data: Partial<{
    mandateId: string;
    status: "pending" | "pending_submission" | "submitted" | "active" | "cancelled" | "failed" | "expired";
    userId: number;
    joiningFeePaidAt: Date;
    preferredPaymentDay: number;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(gcMandates).set(data).where(eq(gcMandates.id, id));
}

export async function getAllGcMandates() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(gcMandates).orderBy(gcMandates.createdAt);
}

// ─── Subscription helpers ─────────────────────────────────────────────────────

export async function createGcSubscription(data: {
  userId: number;
  mandateId: string;
  subscriptionId: string;
  amount: number;
  startDate: string;
  dayOfMonth?: number;
  nextChargeDate?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(gcSubscriptions).values({
    userId: data.userId,
    mandateId: data.mandateId,
    subscriptionId: data.subscriptionId,
    amount: data.amount,
    currency: "GBP",
    startDate: data.startDate,
    dayOfMonth: data.dayOfMonth,
    nextChargeDate: data.nextChargeDate,
    status: "active",
  });
  return result;
}

export async function getGcSubscriptionByUserId(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(gcSubscriptions)
    .where(eq(gcSubscriptions.userId, userId))
    .orderBy(gcSubscriptions.createdAt)
    .limit(1);
  return rows[0] ?? null;
}

// ─── Payment event helpers ───────────────────────────────────────────────────

export async function createPaymentEvent(data: {
  gocardlessEventId?: string;
  userId?: number;
  mandateId?: string;
  paymentId?: string;
  eventType: string;
  status?: string;
  amount?: number;
  currency?: string;
  failureReason?: string;
  failureDescription?: string;
  occurredAt: Date;
  rawPayload?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    if (data.gocardlessEventId) {
      const existing = await db
        .select({ id: gcPaymentEvents.id })
        .from(gcPaymentEvents)
        .where(eq(gcPaymentEvents.gocardlessEventId, data.gocardlessEventId))
        .limit(1);
      if (existing.length) return { created: false };
    }
    await db.insert(gcPaymentEvents).values({
      gocardlessEventId: data.gocardlessEventId ?? null,
      userId: data.userId ?? null,
      mandateId: data.mandateId ?? null,
      paymentId: data.paymentId ?? null,
      eventType: data.eventType,
      status: data.status ?? null,
      amount: data.amount ?? null,
      currency: data.currency ?? "GBP",
      failureReason: data.failureReason ?? null,
      failureDescription: data.failureDescription ?? null,
      occurredAt: data.occurredAt,
      rawPayload: data.rawPayload ?? null,
    });
    return { created: true };
  } catch (error: any) {
    // The unique event ID is the authoritative replay guard. A concurrent
    // webhook retry can win the race between the lookup above and the insert.
    if (data.gocardlessEventId && error?.code === "ER_DUP_ENTRY") {
      return { created: false };
    }
    if (isMissingGoCardlessEventIdColumn(error)) {
      // Keep payment auditing and strike notices operating while a live
      // deployment is waiting for additive migration 0152. paymentId and
      // eventType are the best legacy replay guard available before the
      // provider event ID column exists.
      if (data.paymentId) {
        const existing = await db
          .select({ id: gcPaymentEvents.id })
          .from(gcPaymentEvents)
          .where(and(eq(gcPaymentEvents.paymentId, data.paymentId), eq(gcPaymentEvents.eventType, data.eventType)))
          .limit(1);
        if (existing.length) return { created: false };
      }
      await db.insert(gcPaymentEvents).values({
        userId: data.userId ?? null,
        mandateId: data.mandateId ?? null,
        paymentId: data.paymentId ?? null,
        eventType: data.eventType,
        status: data.status ?? null,
        amount: data.amount ?? null,
        currency: data.currency ?? "GBP",
        failureReason: data.failureReason ?? null,
        failureDescription: data.failureDescription ?? null,
        occurredAt: data.occurredAt,
        rawPayload: data.rawPayload ?? null,
      } as any);
      console.warn("[GoCardless] Using legacy payment-event storage until migration 0152 is available.");
      return { created: true };
    }
    throw error;
  }
}

export async function getPaymentEventsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  try {
    const events = await db
      .select()
      .from(gcPaymentEvents)
      .where(eq(gcPaymentEvents.userId, userId))
      .orderBy(desc(gcPaymentEvents.occurredAt), desc(gcPaymentEvents.id));
    return dedupePaymentEventHistory(events);
  } catch (error) {
    if (!isMissingGoCardlessEventIdColumn(error)) throw error;
    console.warn("[GoCardless] Falling back to legacy payment-event history until migration 0152 is available.");
    const events = await db
      .select(legacyPaymentEventColumns)
      .from(gcPaymentEvents)
      .where(eq(gcPaymentEvents.userId, userId))
      .orderBy(desc(gcPaymentEvents.occurredAt), desc(gcPaymentEvents.id));
    return dedupePaymentEventHistory(events);
  }
}

export async function getRecentFailedPayments(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  try {
    const events = await db
      .select()
      .from(gcPaymentEvents)
      .where(eq(gcPaymentEvents.eventType, "payments_failed"))
      .orderBy(desc(gcPaymentEvents.occurredAt))
      .limit(limit);
    return dedupePaymentEventHistory(events);
  } catch (error) {
    if (!isMissingGoCardlessEventIdColumn(error)) throw error;
    const events = await db
      .select(legacyPaymentEventColumns)
      .from(gcPaymentEvents)
      .where(eq(gcPaymentEvents.eventType, "payments_failed"))
      .orderBy(desc(gcPaymentEvents.occurredAt))
      .limit(limit);
    return dedupePaymentEventHistory(events);
  }
}

export async function updateGcSubscription(
  id: number,
  data: Partial<{
    status: "active" | "paused" | "cancelled" | "finished";
    nextChargeDate: string;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(gcSubscriptions).set(data).where(eq(gcSubscriptions.id, id));
}
