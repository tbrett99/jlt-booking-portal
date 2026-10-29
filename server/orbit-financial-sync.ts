export type OrbitFinancialSyncDecision = {
  outcome: "applied" | "held_for_claim_review";
  reason: string | null;
};

/**
 * Orbit owns the current booking-price, margin and expected-commission estimate.
 * The Portal may safely mirror those live values until the booking enters its
 * financial claim lifecycle. After that point a new Orbit snapshot remains
 * valuable for staff comparison, but it must not rewrite a claim or payment
 * record that was reviewed using an earlier value.
 */
export function decideOrbitFinancialSync(input: {
  currentStage: string | null | undefined;
  hasCommissionClaim: boolean;
}): OrbitFinancialSyncDecision {
  const stage = String(input.currentStage ?? "").trim().toLowerCase();
  const protectedStages = new Set([
    "commission claimed",
    "commission due for payment",
    "commission paid",
  ]);

  if (input.hasCommissionClaim || protectedStages.has(stage)) {
    return {
      outcome: "held_for_claim_review",
      reason: input.hasCommissionClaim
        ? "A commission claim already exists for this booking."
        : `The booking is in the protected ${input.currentStage} stage.`,
    };
  }

  return { outcome: "applied", reason: null };
}

export function buildOrbitBookingFinancialFields(snapshot: {
  grossBookingValue: number | null;
  marginPct: number | null;
  expectedCommission: number | null;
}) {
  return {
    grossCost: snapshot.grossBookingValue === null ? null : snapshot.grossBookingValue.toFixed(2),
    orbitMarginPct: snapshot.marginPct === null ? null : snapshot.marginPct.toFixed(3),
    expectedCommission: snapshot.expectedCommission === null ? null : snapshot.expectedCommission.toFixed(2),
  };
}

export function hasOrbitBookingFinancialChange(
  current: {
    grossCost?: string | number | null;
    orbitMarginPct?: string | number | null;
    expectedCommission?: string | number | null;
  },
  next: ReturnType<typeof buildOrbitBookingFinancialFields>,
) {
  const sameDecimal = (left: string | number | null | undefined, right: string | null) => {
    if (left === null || left === undefined || left === "") return right === null;
    if (right === null) return false;
    return Number(left) === Number(right);
  };

  return !(
    sameDecimal(current.grossCost, next.grossCost) &&
    sameDecimal(current.orbitMarginPct, next.orbitMarginPct) &&
    sameDecimal(current.expectedCommission, next.expectedCommission)
  );
}
