import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  agentCrmProfiles,
  amendments,
  bookings,
  commissionClaims,
  reimbursementItems,
  refunds,
  users,
} from "../drizzle/schema";
import type {
  CommissionForecastInput,
  CommissionForecastResponse,
} from "../shared/commission-workload-forecast";
import { getDb } from "./db";
import { COMMISSION_REVIEW_ELIGIBLE_STAGES } from "./commission-workflow-utils";
import {
  buildCommissionWorkloadForecast,
  COMMISSION_FORECAST_MAX_FILES,
  validateCommissionForecastInput,
} from "./commission-workload-forecast-policy";

/** This read never advances stages, creates claims, approves files, or calls providers. */
export async function getCommissionWorkloadForecast(
  input: CommissionForecastInput,
  now = new Date()
): Promise<CommissionForecastResponse> {
  const period = validateCommissionForecastInput(input);
  if (!Number.isFinite(now.getTime()))
    throw new Error("A valid forecast reference date is required.");
  try {
    const db = await getDb();
    if (!db) throw new Error("Commission forecast is temporarily unavailable.");
    const rows = await db
      .select({
        id: bookings.id,
        agentId: bookings.agentId,
        clientName: bookings.clientName,
        agentName: users.name,
        ptsRef: bookings.ptsRef,
        crmRef: bookings.crmRef,
        currentStage: bookings.currentStage,
        finalSupplierPaymentDate: bookings.finalSupplierPaymentDate,
        departureDate: bookings.departureDate,
        isPersonalBooking: bookings.isPersonalBooking,
        commissionPreAuthorised: bookings.commissionPreAuthorised,
        inContract: sql<number | string | boolean | null>`exists (
          select 1 from ${agentCrmProfiles}
          where ${agentCrmProfiles.userId} = ${bookings.agentId}
          and ${agentCrmProfiles.inContract} = ${1}
        )`,
        hasOutstandingRefund: sql<number | string | boolean | null>`exists (
          select 1 from ${refunds}
          where ${refunds.bookingId} = ${bookings.id}
          and ${refunds.status} <> ${"completed"}
        )`,
        hasOutstandingAmendment: sql<number | string | boolean | null>`exists (
          select 1 from ${amendments}
          where ${amendments.bookingId} = ${bookings.id}
          and ${amendments.status} not in (${"actioned"}, ${"rejected"})
        )`,
        hasOutstandingReimbursement: sql<
          number | string | boolean | null
        >`exists (
          select 1 from ${reimbursementItems}
          where ${reimbursementItems.bookingId} = ${bookings.id}
          and ${reimbursementItems.status} in (${"pending"}, ${"awaiting_agent"})
        )`,
      })
      .from(bookings)
      .leftJoin(users, eq(users.id, bookings.agentId))
      .where(
        and(
          inArray(
            bookings.currentStage,
            Array.from(COMMISSION_REVIEW_ELIGIBLE_STAGES)
          ),
          sql`not exists (
          select 1 from ${commissionClaims}
          where ${commissionClaims.bookingId} = ${bookings.id}
        )`
        )
      )
      .orderBy(asc(bookings.id))
      .limit(COMMISSION_FORECAST_MAX_FILES + 1);
    if (rows.length > COMMISSION_FORECAST_MAX_FILES) {
      throw new Error("Commission forecast exceeds the complete-file limit.");
    }
    return buildCommissionWorkloadForecast(rows, period, now);
  } catch {
    // Never attach raw SQL errors, parameters, or nested causes to client-facing errors.
    throw new Error(
      "Commission forecast could not be loaded completely. Please retry or contact support."
    );
  }
}
