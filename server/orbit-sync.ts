/**
 * orbit-sync.ts
 * Pushes commission claim status updates from the JLT Portal to Orbit.
 *
 * Orbit webhook: POST https://orbit.thejltgroup.co.uk/api/webhooks/portal-commission
 * Auth: X-API-Key header matching ORBIT_WEBHOOK_SECRET env var.
 *
 * Status mapping (portal → Orbit portalClaimStatus):
 *   no claim yet          → "unclaimed"
 *   pending / processing  → "pending"
 *   awaiting_payment      → "partial"
 *   paid                  → "claimed"
 *   notice_hold           → "pending"
 *   top_up_required       → "pending"
 */

const ORBIT_WEBHOOK_URL =
  (process.env.ORBIT_WEBHOOK_URL ?? "https://orbit.thejltgroup.co.uk") +
  "/api/webhooks/portal-commission";

const ORBIT_API_KEY = process.env.ORBIT_WEBHOOK_SECRET ?? "";

export type PortalClaimStatus =
  | "unclaimed"
  | "claimable"
  | "pending"
  | "processing"
  | "awaiting_payment"
  | "top_up_required"
  | "notice_hold"
  | "paid";

/**
 * Map portal-internal claim status to the value sent to Orbit.
 * Now sends exact portal statuses so both systems stay in sync.
 * When there is no claim yet, pass bookingStage to distinguish
 * "claimable" (Commission Claimable stage) from plain "unclaimed".
 */
export function mapClaimStatus(
  status: string | null | undefined,
  bookingStage?: string | null
): PortalClaimStatus {
  if (!status) {
    if (bookingStage === "Commission Claimable") return "claimable";
    return "unclaimed";
  }
  switch (status) {
    case "paid":             return "paid";
    case "awaiting_payment": return "awaiting_payment";
    case "top_up_required":  return "top_up_required";
    case "notice_hold":      return "notice_hold";
    case "processing":       return "processing";
    case "pending":          return "pending";
    default:                 return "pending";
  }
}

export interface OrbitCommissionPayload {
  crmRef?: string | null;
  ptsRef?: string | null;
  topdogRef?: string | null;
  bookingId?: number | null;
  claimStatus: PortalClaimStatus;
  claimedAmount?: number | null;
  claimedAt?: string | null;
  paidAt?: string | null;
  notes?: string | null;
}

/**
 * Convenience: look up a booking by ID, fetch its latest claim, and push to Orbit.
 * Fire-and-forget — never throws.
 */
export async function pushClaimStatusToOrbit(bookingId: number): Promise<void> {
  try {
    const { getDb } = await import("./db");
    const { bookings, commissionClaims } = await import("../drizzle/schema");
    const { eq, desc } = await import("drizzle-orm");

    const db = await getDb();
    if (!db) return;

    const bookingRows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);
    const booking = bookingRows[0];
    if (!booking) return;

    const claimRows = await db
      .select()
      .from(commissionClaims)
      .where(eq(commissionClaims.bookingId, bookingId))
      .orderBy(desc(commissionClaims.updatedAt))
      .limit(1);
    const claim = claimRows[0] ?? null;

    await pushCommissionToOrbit({
      crmRef:    booking.crmRef    ?? null,
      ptsRef:    (booking as any).ptsRef    ?? null,
      topdogRef: (booking as any).topdogRef ?? null,
      bookingId: booking.id,
      claimStatus: mapClaimStatus(claim?.status, booking.currentStage),
      claimedAmount: claim?.grossAmount != null ? parseFloat(String(claim.grossAmount)) : null,
      claimedAt: claim?.claimedAt ? new Date(claim.claimedAt).toISOString() : null,
      paidAt: claim?.paidAt ? new Date(claim.paidAt).toISOString() : null,
      notes: claim?.topUpNote ?? null,
    });
  } catch (err) {
    console.error("[OrbitSync] pushClaimStatusToOrbit failed:", err);
  }
}

/**
 * Fire-and-forget push to Orbit. Logs errors but never throws — commission
 * processing must not be blocked by a webhook failure.
 */
export async function pushCommissionToOrbit(
  payload: OrbitCommissionPayload
): Promise<void> {
  if (!ORBIT_API_KEY) {
    console.warn("[OrbitSync] ORBIT_WEBHOOK_SECRET not set — skipping push");
    return;
  }

  // Must have at least one ref
  if (!payload.crmRef && !payload.topdogRef && !payload.bookingId) {
    console.warn("[OrbitSync] No booking ref available — skipping push");
    return;
  }

  try {
    const body: Record<string, unknown> = {
      claimStatus: payload.claimStatus,
    };
    if (payload.crmRef)     body.crmRef     = payload.crmRef;
    if (payload.ptsRef)     body.ptsRef     = payload.ptsRef;
    if (payload.topdogRef)  body.topdogRef  = payload.topdogRef;
    if (payload.bookingId)  body.bookingId  = payload.bookingId;
    if (payload.claimedAmount != null) body.claimedAmount = payload.claimedAmount;
    if (payload.claimedAt) body.claimedAt = payload.claimedAt;
    if (payload.paidAt) body.paidAt = payload.paidAt;
    if (payload.notes) body.notes = payload.notes;

    const res = await fetch(ORBIT_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": ORBIT_API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `[OrbitSync] Webhook returned ${res.status}: ${text.slice(0, 200)}`
      );
    } else {
      console.log(
        `[OrbitSync] Pushed claimStatus=${payload.claimStatus} for ref=${
          payload.crmRef ?? payload.topdogRef ?? payload.bookingId
        }`
      );
    }
  } catch (err) {
    console.error("[OrbitSync] Webhook push failed:", err);
  }
}
