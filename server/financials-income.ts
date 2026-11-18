import { and, eq, gte, lt } from "drizzle-orm";
import { gcPaymentEvents, remittanceBatches, remittanceLines } from "../drizzle/schema";
import type { getDb } from "./db";
import { buildFinancialsIncomeFromEvidence, FINANCIALS_EVENT_LIMIT, unavailableFinancialsIncome, type FinancialsIncome } from "../shared/financials-income";

/** Uses the dashboard's selected period, local recorded paid-out events and PTS
 * batch dates. No provider request or account/financial mutation; does not imply
 * local history or remittance batch dates are a bank reconciliation. No private
 * payer, booking, email, mandate, description or raw payload is projected.
 */
export async function readFinancialsIncome(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  from: Date,
  to: Date,
): Promise<FinancialsIncome> {
  try {
    const [events, commissions] = await Promise.all([
      db.select({ paymentId: gcPaymentEvents.paymentId, amount: gcPaymentEvents.amount, currency: gcPaymentEvents.currency })
        .from(gcPaymentEvents)
        .where(and(eq(gcPaymentEvents.eventType, "payments_paid_out"), gte(gcPaymentEvents.occurredAt, from), lt(gcPaymentEvents.occurredAt, to)))
        .limit(FINANCIALS_EVENT_LIMIT + 1),
      db.select({ jlt20: remittanceLines.jlt20, currency: remittanceLines.currency })
        .from(remittanceLines)
        .innerJoin(remittanceBatches, eq(remittanceLines.batchId, remittanceBatches.id))
        .where(and(gte(remittanceBatches.createdAt, from), lt(remittanceBatches.createdAt, to)))
        .limit(FINANCIALS_EVENT_LIMIT + 1),
    ]);
    return buildFinancialsIncomeFromEvidence(commissions, events);
  } catch {
    // Withhold the new estimate; no rounded-gross fallback or private SQL detail.
    return unavailableFinancialsIncome("unavailable");
  }
}
