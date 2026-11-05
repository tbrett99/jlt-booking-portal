import { and, eq, isNotNull, sql } from "drizzle-orm";
import { joinSessions } from "../drizzle/schema";
import { getDb } from "./db";

/** External evidence only: this is never a GoCardless payment, payout or mandate. */
export interface ManualJoiningFeeReceipt {
  version: 1;
  kind: "external_manual_joining_fee";
  applicationId: number;
  userId: number;
  email: string;
  currency: "GBP";
  amountMinor: number;
  receivedDate: string;
  receivedTimePrecision: "date_only";
  method: "stripe_card";
  originalBillingRequestId: string | null;
  contractHash: string;
  recordedAt: string;
  authority: string;
  providerActions: "manual_link_only";
}

export interface ManualJoiningFeeSession {
  id: number;
  userId: number | null;
  email: string;
  billingRequestId: string | null;
  contractHash: string | null;
  contractSignedAt: Date | null;
  joiningFeePaidAt: Date | null;
  joiningFeeManualReceipt?: unknown;
}

/** An opaque or stale non-null marker must never fall back to automatic collection. */
export class ManualJoiningFeeReceiptError extends Error {
  readonly code = "MANUAL_JOINING_FEE_RECEIPT_BLOCKED";
  readonly statusCode = 503;

  constructor(reason: string) {
    super(`Manual joining-fee receipt: ${reason}. Automatic join completion and provider creation are blocked; manual review/linking is required.`);
    this.name = "ManualJoiningFeeReceiptError";
  }
}

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const positiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const validDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());
const dateOnly = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return validDate(date) && date.toISOString().slice(0, 10) === value;
};

/**
 * No account, email or joining-fee price is privileged here. Validate evidence
 * against the current signed application, including its UTC receipt date.
 * Non-null malformed evidence throws rather than being interpreted as absent.
 */
export function hasManualJoiningFeeReceipt(session: ManualJoiningFeeSession): boolean {
  const marker = session.joiningFeeManualReceipt;
  if (marker === null || marker === undefined) return false;
  const fail = (reason: string): never => { throw new ManualJoiningFeeReceiptError(reason); };
  if (typeof marker !== "object" || Array.isArray(marker)) fail("invalid evidence object");
  const receipt = marker as Record<string, unknown>;
  if (receipt.version !== 1 || receipt.kind !== "external_manual_joining_fee" ||
      receipt.currency !== "GBP" || receipt.receivedTimePrecision !== "date_only" ||
      receipt.method !== "stripe_card" || receipt.providerActions !== "manual_link_only") {
    fail("invalid evidence policy");
  }
  if (!positiveInteger(receipt.amountMinor)) fail("invalid receipt amount");
  if (!dateOnly(receipt.receivedDate)) fail("invalid receipt date");
  if (typeof receipt.recordedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(receipt.recordedAt) ||
      !dateOnly(receipt.recordedAt.slice(0, 10)) ||
      !Number.isFinite(Date.parse(receipt.recordedAt))) fail("invalid evidence timestamp");
  const authorityDate = typeof receipt.authority === "string"
    ? /^Owner confirmation in Manus on (\d{4}-\d{2}-\d{2})$/.exec(receipt.authority)?.[1]
    : undefined;
  if (!dateOnly(authorityDate)) fail("invalid owner authority");
  if (!positiveInteger(session.id) || !positiveInteger(receipt.applicationId) ||
      receipt.applicationId !== session.id) fail("application identity mismatch");
  if (!positiveInteger(session.userId) || !positiveInteger(receipt.userId) ||
      receipt.userId !== session.userId) fail("linked user identity mismatch");
  if (typeof receipt.email !== "string" || typeof session.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(receipt.email)) ||
      normalizeEmail(receipt.email) !== normalizeEmail(session.email)) fail("email identity mismatch");
  if (!validDate(session.contractSignedAt) || typeof receipt.contractHash !== "string" ||
      !/^[a-f0-9]{64}$/i.test(receipt.contractHash) ||
      receipt.contractHash !== session.contractHash) fail("signed contract identity mismatch");
  if (!(receipt.originalBillingRequestId === null ||
        (typeof receipt.originalBillingRequestId === "string" && receipt.originalBillingRequestId.trim().length > 0)) ||
      receipt.originalBillingRequestId !== session.billingRequestId) fail("original billing request identity mismatch");
  if (!validDate(session.joiningFeePaidAt) ||
      session.joiningFeePaidAt.toISOString().slice(0, 10) !== receipt.receivedDate) fail("current joining-fee receipt date mismatch");
  return true;
}

/**
 * Read-only, request-scoped lookup. Never filter by linked user: even an opaque
 * marker on an unlinked application must fail closed. A later manually linked
 * mandate with no BRQ (or a different BRQ) is unaffected by the old receipt.
 */
export async function hasManualJoiningFeeReceiptForBillingRequest(
  billingRequestId: string | null | undefined,
): Promise<boolean> {
  if (!billingRequestId) return false;
  const db = await getDb();
  if (!db) throw new ManualJoiningFeeReceiptError("database unavailable for evidence verification");
  const sessions = await db.select().from(joinSessions)
    .where(eq(joinSessions.billingRequestId, billingRequestId));
  let found = false;
  // Check every matching application; do not let an unmarked duplicate hide a marker.
  for (const session of sessions) {
    if (hasManualJoiningFeeReceipt(session)) found = true;
  }
  return found;
}

/**
 * A second application for the same email must not reopen external recovery.
 * Presence alone blocks retries; malformed evidence must not permit a new BRQ.
 * Intentionally does not reject ordinary linked users or unmarked applications.
 */
export async function assertNoManuallyRecoveredJoinForEmail(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  email: string,
): Promise<void> {
  const rows = await db.select({
    id: joinSessions.id,
    joiningFeeManualReceipt: joinSessions.joiningFeeManualReceipt,
  }).from(joinSessions).where(and(
    eq(sql`LOWER(TRIM(${joinSessions.email}))`, normalizeEmail(email)),
    isNotNull(joinSessions.joiningFeeManualReceipt),
  )).limit(1);
  if (rows.length > 0) {
    throw new ManualJoiningFeeReceiptError("joining application already completed externally for this email; sign in or contact support for manual mandate linking");
  }
}
