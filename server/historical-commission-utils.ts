export type HistoricalCommissionClaimCandidate = {
  status: string;
  grossAmount: string | number | null;
  paidAt: Date | string | null;
  paidById: number | null;
  agentPaymentReceivedAt: Date | string | null;
  agentPaymentReceivedById: number | null;
  remittanceLineId: number | null;
};

/**
 * A pending/top-up record without a financial amount, payment, receipt, or
 * remittance link is a pre-payment workflow marker rather than a completed
 * commission claim. Staff may reconcile it into a documented historic payment
 * when the commission was paid before the Portal tracked the payment lifecycle.
 */
export function canReconcileHistoricalCommissionClaim(
  claim: HistoricalCommissionClaimCandidate | null | undefined,
) {
  if (!claim) return false;

  return ["pending", "top_up_required"].includes(claim.status)
    && claim.grossAmount === null
    && claim.paidAt === null
    && claim.paidById === null
    && claim.agentPaymentReceivedAt === null
    && claim.agentPaymentReceivedById === null
    && claim.remittanceLineId === null;
}
