const DAY_MS = 24 * 60 * 60 * 1000;

/** Returns the UTC calendar-day window exactly `weeks` before a departure date. */
export function commissionReadinessTargetWindow(now: Date, weeks = 12) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + weeks * 7));
  const end = new Date(start.getTime() + DAY_MS);
  return { start, end };
}

export function isCommissionReadinessEligible(booking: {
  departureDate: Date;
  currentStage: string;
  isPersonalBooking: boolean;
}, now: Date) {
  const { start, end } = commissionReadinessTargetWindow(now);
  return !booking.isPersonalBooking
    && booking.currentStage !== "Cancelled"
    && booking.departureDate >= start
    && booking.departureDate < end;
}
