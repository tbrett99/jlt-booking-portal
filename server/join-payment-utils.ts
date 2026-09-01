export type GoCardlessJoinEvent = {
  resourceType: string;
  action: string;
  billingRequestId?: string | null;
};

/**
 * A joining fee is authoritative once GoCardless confirms its payment. In the
 * usual path that coincides with billing_requests.fulfilled, but GoCardless can
 * deliver the payment confirmation first or omit the fulfilment webhook.
 */
export function completesJoinFlow(event: GoCardlessJoinEvent): boolean {
  return (
    (event.resourceType === "billing_requests" && event.action === "fulfilled") ||
    (event.resourceType === "payments" && event.action === "confirmed" && Boolean(event.billingRequestId))
  );
}
