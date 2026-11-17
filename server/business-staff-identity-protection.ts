import { TRPCError } from "@trpc/server";
import { eq, or } from "drizzle-orm";
import { businessStaffMemberships } from "../drizzle/schema";
import { getDb } from "./db";
/** Staff classification is retained even after revocation. Never make it bookable. */
export async function getRetainedBusinessStaffIds(): Promise<Set<number>> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Business staff identities could not be verified." });
  try {
    const rows = await db.select({ staffUserId: businessStaffMemberships.staffUserId }).from(businessStaffMemberships);
    return new Set(rows.map(row => row.staffUserId));
  } catch {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Business staff identities could not be verified." });
  }
}
export async function assertBusinessStaffIdentityNotDeleted(tx: any, userId: number): Promise<void> {
  const rows = await tx.select({ id: businessStaffMemberships.id }).from(businessStaffMemberships)
    .where(or(eq(businessStaffMemberships.ownerUserId, userId), eq(businessStaffMemberships.staffUserId, userId))).limit(1);
  if (rows.length) throw new TRPCError({ code: "CONFLICT", message: "This account has preserved business-staff relationships. Revoke staff access instead of deleting the account." });
}
