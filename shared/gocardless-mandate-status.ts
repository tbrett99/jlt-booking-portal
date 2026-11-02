/**
 * Provider reference checked 2026-11-02:
 * https://docs.gocardless.com/docs/api-reference/mandate
 * `consumed` cannot be reused; `blocked` cannot accept payments;
 * `suspended_by_payer` is unavailable, not an active or pending mandate.
 * `pending` is retained as the Portal's local hosted-flow placeholder.
 */
export const GO_CARDLESS_MANDATE_STATUSES = [
  "pending", "pending_submission", "submitted", "active", "cancelled", "failed", "expired",
  "consumed", "blocked", "pending_customer_approval", "suspended_by_payer",
] as const;
export type GoCardlessMandateStatus = typeof GO_CARDLESS_MANDATE_STATUSES[number];

export function parseGoCardlessMandateStatus(value: unknown): GoCardlessMandateStatus {
  if (typeof value !== "string" || !(GO_CARDLESS_MANDATE_STATUSES as readonly string[]).includes(value)) {
    throw new Error("Unsupported GoCardless mandate status; held for review instead of changing it to pending.");
  }
  return value as GoCardlessMandateStatus;
}

export function canLinkGoCardlessMandate(value: unknown): boolean {
  return typeof value === "string" && ["pending", "pending_customer_approval", "pending_submission", "submitted", "active"].includes(value);
}
