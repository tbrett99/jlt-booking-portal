import { incomeVatBreakdown } from "./gocardless-income-report";

export type FinancialsIncomeReason = "missing_payment_evidence" | "conflicting_payment_evidence" | "non_gbp_income" | "invalid_commission" | "too_many_events" | "unavailable";
export type FinancialsIncome = {
  available: boolean;
  reason: FinancialsIncomeReason | null;
  gcGrossMinor: number | null;
  gcVatMinor: number | null;
  gcExVatMinor: number | null;
  commissionMinor: number | null;
  grossIncomeMinor: number | null;
  incomeAfterVatMinor: number | null;
  paymentCount: number;
};
export type FinancialsPaymentEvidence = { paymentId: string | null; amount: number | null; currency: string | null };
export const FINANCIALS_EVENT_LIMIT = 20000;
export function unavailableFinancialsIncome(reason: FinancialsIncomeReason): FinancialsIncome {
  return { available: false, reason, gcGrossMinor: null, gcVatMinor: null, gcExVatMinor: null,
    commissionMinor: null, grossIncomeMinor: null, incomeAfterVatMinor: null, paymentCount: 0 };
}
/** Converts a DECIMAL GBP remittance aggregate without losing pence or using
 * floating-point division. A zero aggregate must be explicitly supplied by the
 * caller after a successful empty SQL SUM; unknown/malformed input is not zero.
 */
function commissionPence(value: string | number): number | null {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const minor = (BigInt(match[2]) * BigInt(100) + BigInt((match[3] ?? "").padEnd(2, "0"))) * BigInt(match[1] ? -1 : 1);
  const result = Number(minor);
  return Number.isSafeInteger(result) ? result : null;
}
/** Read-only management estimate from recorded payout events, NOT bank settlement
 * reconciliation or profit. VAT is extracted ONLY from GoCardless payments.
 * JLT's recorded PTS commission share passes through unchanged, including valid
 * negative remittance adjustments. Duplicate event copies cannot double-count.
 */
export function buildFinancialsIncome(commissionGbp: string | number, events: FinancialsPaymentEvidence[]): FinancialsIncome {
  if (events.length > FINANCIALS_EVENT_LIMIT) return unavailableFinancialsIncome("too_many_events");
  const commissionMinor = commissionPence(commissionGbp);
  if (commissionMinor === null) return unavailableFinancialsIncome("invalid_commission");
  const payments = new Map<string, { amounts: Set<number>; currencies: Set<string> }>();
  for (const event of events) {
    if (!event.paymentId || event.paymentId !== event.paymentId.trim()) return unavailableFinancialsIncome("missing_payment_evidence");
    let copies = payments.get(event.paymentId);
    if (!copies) { copies = { amounts: new Set(), currencies: new Set() }; payments.set(event.paymentId, copies); }
    // A known immutable field on another copy can fill a missing field, but
    // contradictions or malformed non-null values must never be guessed away.
    if (event.amount !== null) {
      if (!Number.isSafeInteger(event.amount) || event.amount < 0) return unavailableFinancialsIncome("missing_payment_evidence");
      copies.amounts.add(event.amount);
    }
    if (event.currency !== null && event.currency !== "") {
      if (!/^[A-Z]{3}$/.test(event.currency)) return unavailableFinancialsIncome("missing_payment_evidence");
      copies.currencies.add(event.currency);
    }
  }
  let gross = BigInt(0), vat = BigInt(0);
  for (const payment of Array.from(payments.values())) {
    if (payment.amounts.size > 1 || payment.currencies.size > 1) return unavailableFinancialsIncome("conflicting_payment_evidence");
    if (payment.amounts.size !== 1 || payment.currencies.size !== 1) return unavailableFinancialsIncome("missing_payment_evidence");
    const currency = Array.from(payment.currencies)[0];
    if (currency !== "GBP") return unavailableFinancialsIncome("non_gbp_income");
    const amount = incomeVatBreakdown(Array.from(payment.amounts)[0], currency)!;
    gross += BigInt(amount.grossMinor);
    vat += BigInt(amount.vatMinor);
  }
  const net = gross - vat;
  const grossIncome = gross + BigInt(commissionMinor), afterVat = net + BigInt(commissionMinor);
  if (![gross, vat, net, grossIncome, afterVat].every(value => Number.isSafeInteger(Number(value)))) return unavailableFinancialsIncome("unavailable");
  return { available: true, reason: null, gcGrossMinor: Number(gross), gcVatMinor: Number(vat), gcExVatMinor: Number(net),
    commissionMinor, grossIncomeMinor: Number(grossIncome), incomeAfterVatMinor: Number(afterVat), paymentCount: payments.size };
}

export type FinancialsCommissionEvidence = { jlt20: string | number | null; currency: string | null };
/** The new headline uses the actual recorded line evidence, not the legacy SUM
 * which omits null shares and has no currency context. No lines means genuine
 * zero; a recorded unknown share/currency is an unavailable total, not zero.
 */
export function buildFinancialsIncomeFromEvidence(commissions: FinancialsCommissionEvidence[], events: FinancialsPaymentEvidence[]): FinancialsIncome {
  if (commissions.length > FINANCIALS_EVENT_LIMIT) return unavailableFinancialsIncome("too_many_events");
  let total = BigInt(0);
  for (const line of commissions) {
    if (line.jlt20 === null || !line.currency || !/^[A-Z]{3}$/.test(line.currency)) return unavailableFinancialsIncome("invalid_commission");
    if (line.currency !== "GBP") return unavailableFinancialsIncome("non_gbp_income");
    const amount = commissionPence(line.jlt20);
    if (amount === null) return unavailableFinancialsIncome("invalid_commission");
    total += BigInt(amount);
  }
  if (!Number.isSafeInteger(Number(total))) return unavailableFinancialsIncome("invalid_commission");
  const digits = (total < BigInt(0) ? -total : total).toString().padStart(3, "0");
  const commissionGbp = (total < BigInt(0) ? "-" : "") + digits.slice(0, -2) + "." + digits.slice(-2);
  return buildFinancialsIncome(commissionGbp, events);
}
