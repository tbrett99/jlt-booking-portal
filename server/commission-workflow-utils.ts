import { isPreAuthorisedCommissionEligibleAfterDeparture } from "./commission-readiness-utils";

export const COMMISSION_REVIEW_STAGE = "Commission Ready for Review";

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
  if (booking.isPersonalBooking || booking.currentStage === "Cancelled") return false;
  // A record with one of the final payment lifecycle stages must never be
  // re-opened merely because a date is amended. "Ready for Review" and
  // "Commission Claimable" intentionally remain reviewable: they can exist
  // without a claim after historic imports or an incomplete prior review.
  if (["Commission Claimed", "Commission Due for Payment", "Commission Paid"].includes(booking.currentStage)) return false;
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
