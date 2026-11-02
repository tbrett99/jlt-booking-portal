/** Compatibility entry point. Payment-resource snapshots cannot count retry attempts. */
export async function reconcilePaymentFailureSuspensions() {
  const { reconcileMembershipPayments } = await import("./membership-payment-sync");
  return reconcileMembershipPayments();
}
