export function manualJoinReceiptLabel(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return "External receipt needs review";
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "External receipt needs review";
  const r = value as Record<string, unknown>;
  if (
    r.version !== 1 ||
    r.kind !== "external_manual_joining_fee" ||
    r.currency !== "GBP" ||
    !Number.isSafeInteger(r.amountMinor) ||
    Number(r.amountMinor) <= 0 ||
    typeof r.receivedDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(r.receivedDate)
  )
    return "External receipt needs review";
  const date = new Date(`${r.receivedDate}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== r.receivedDate
  )
    return "External receipt needs review";
  const amount = (Number(r.amountMinor) / 100).toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
  });
  const method =
    r.method === "stripe_card" ? "Stripe card" : "external payment";
  return `${amount} received — ${method}, ${r.receivedDate} (date only; not GoCardless)`;
}
