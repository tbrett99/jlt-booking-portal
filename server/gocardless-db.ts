import { getDb } from "./db";
import { gcMandates, gcSubscriptions, gcPaymentEvents } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

// ─── Mandate helpers ──────────────────────────────────────────────────────────

export async function createGcMandate(data: {
  userId: number;
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

export async function updateGcMandate(
  id: number,
  data: Partial<{
    mandateId: string;
    status: "pending" | "active" | "cancelled" | "failed" | "expired";
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
  });
}

export async function getPaymentEventsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(gcPaymentEvents)
    .where(eq(gcPaymentEvents.userId, userId))
    .orderBy(desc(gcPaymentEvents.occurredAt));
}

export async function getRecentFailedPayments(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(gcPaymentEvents)
    .where(eq(gcPaymentEvents.eventType, "payments_failed"))
    .orderBy(desc(gcPaymentEvents.occurredAt))
    .limit(limit);
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
