import { isPreAuthorisedCommissionEligibleAfterDeparture } from "./commission-readiness-utils";

export const COMMISSION_REVIEW_STAGE = "Commission Ready for Review";

/**
 * Only final-supplier-payment hand-off files belong in the staff review queue.
 * Historical Commission Claimable records are already agent-ready and are
 * reported separately for follow-up.
 */
export const COMMISSION_REVIEW_ELIGIBLE_STAGES = new Set([
  "Added to PTS",
  COMMISSION_REVIEW_STAGE,
]);

/**
 * These stages represent financial workflow events, not free-form booking
 * pipeline choices. They can only be reached through their dedicated server
 * actions so that the claim, remittance and booking state remain aligned.
 */
export const COMMISSION_CONTROLLED_STAGES = new Set([
  COMMISSION_REVIEW_STAGE,
  "Commission Claimable",
  "Commission Claimed",
  "Commission Due for Payment",
  "Commission Paid",
]);

export function isFinalSupplierPaymentDateDue(
  finalSupplierPaymentDate: Date | string | null | undefined,
  now: Date,
) {
  if (!finalSupplierPaymentDate) return false;
  const date = new Date(finalSupplierPaymentDate);
  if (Number.isNaN(date.getTime())) return false;

  const dueDate = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  const today = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));

  return dueDate.getTime() <= today.getTime();
}

export function isBookingReadyForCommissionReview(
  booking: {
    currentStage: string;
    finalSupplierPaymentDate: Date | string | null;
    departureDate: Date | string | null;
    isPersonalBooking: boolean | null;
    commissionPreAuthorised?: boolean | null;
  },
  now: Date,
) {
  // Personal bookings follow the same auditable review and claim lifecycle as
  // every other booking. Their claim value can legitimately be £0, but the
  // booking still needs to be checked and closed through the Portal.
  if (booking.currentStage === "Cancelled") return false;
  // Commission Claimable is a completed staff decision, not a queue state.
  // Treating historic claimable files as newly due review work inflated the
  // Commission Due queue after the workflow repair.
  if (!COMMISSION_REVIEW_ELIGIBLE_STAGES.has(booking.currentStage)) return false;
  if (!isFinalSupplierPaymentDateDue(booking.finalSupplierPaymentDate, now)) return false;

  return !booking.commissionPreAuthorised
    || isPreAuthorisedCommissionEligibleAfterDeparture(booking.departureDate, now);
}

export function outstandingCommissionReviewLabels(flags: {
  hasOutstandingRefund?: boolean;
  hasOutstandingAmendment?: boolean;
  hasOutstandingReimbursement?: boolean;
}) {
  return [
    flags.hasOutstandingRefund ? "refund" : null,
    flags.hasOutstandingAmendment ? "amendment" : null,
    flags.hasOutstandingReimbursement ? "reimbursement" : null,
  ].filter((value): value is string => Boolean(value));
}
