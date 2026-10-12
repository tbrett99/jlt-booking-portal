import { eq, inArray } from "drizzle-orm";
import { bookings, commissionClaims, users } from "../drizzle/schema";
import { createNote, getBookingById, getDb, updateBookingStage } from "./db";
import {
  COMMISSION_REVIEW_STAGE,
  isBookingReadyForCommissionReview,
} from "./commission-workflow-utils";

export type CommissionReviewQueueResult = {
  reviewed: number;
  moved: number;
  skipped: number;
  bookingIds: number[];
};

async function resolveQueueActorId(movedById: number | null | undefined) {
  if (movedById) return movedById;
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const actor = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "super_admin"))
    .limit(1);
  if (!actor[0]?.id) throw new Error("A Super Admin is required to record the automated commission review transition");
  return actor[0].id;
}

/**
 * Move only genuinely due, non-personal bookings into the staff review queue.
 * This deliberately stops at review: a staff member must explicitly confirm
 * the file before the agent is invited to claim commission.
 */
export async function queueDueBookingsForCommissionReview(input?: {
  now?: Date;
  bookingId?: number;
  movedById?: number | null;
}): Promise<CommissionReviewQueueResult> {
  const now = input?.now ?? new Date();
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const actorId = await resolveQueueActorId(input?.movedById);

  const candidates = input?.bookingId
    ? await db.select().from(bookings).where(eq(bookings.id, input.bookingId)).limit(1)
    : await db.select().from(bookings);
  const existingClaimBookingIds = candidates.length > 0
    ? new Set((await db
      .select({ bookingId: commissionClaims.bookingId })
      .from(commissionClaims)
      .where(inArray(commissionClaims.bookingId, candidates.map((booking) => booking.id))))
      .map((claim) => claim.bookingId))
    : new Set<number>();

  const result: CommissionReviewQueueResult = {
    reviewed: candidates.length,
    moved: 0,
    skipped: 0,
    bookingIds: [],
  };

  for (const booking of candidates) {
    if (
      !isBookingReadyForCommissionReview(booking, now)
      || existingClaimBookingIds.has(booking.id)
      || booking.currentStage === COMMISSION_REVIEW_STAGE
      || booking.currentStage === "Commission Claimable"
    ) {
      result.skipped++;
      continue;
    }

    await updateBookingStage(booking.id, COMMISSION_REVIEW_STAGE, actorId);
    await createNote({
      bookingId: booking.id,
      authorId: actorId,
      content: "[System] Final supplier payment date has been reached; booking moved to Commission Ready for Review.",
      isInternal: true,
    });
    result.moved++;
    result.bookingIds.push(booking.id);
  }

  return result;
}

/** Return a fresh booking after an immediately-triggered queue check. */
export async function queueBookingForCommissionReview(bookingId: number, movedById: number) {
  await queueDueBookingsForCommissionReview({ bookingId, movedById });
  return getBookingById(bookingId);
}
