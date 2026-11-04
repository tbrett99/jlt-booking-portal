import { inArray } from "drizzle-orm";
import { bookings } from "../drizzle/schema";
import { bookingOrbitReference } from "../shared/booking-email-reference";
import type { getDb } from "./db";

type Line = { bookingId?: number | null; agentId?: number | null; clientName?: string | null; remit80?: string | null };
export function remittanceOrbitReferenceMap(rows: Array<{ id: number; agentId: number; crmRef?: string | null }>): Map<string, string | null> {
  return new Map(rows.map(row => [`${row.agentId}:${row.id}`, bookingOrbitReference(row)]));
}
export async function readRemittanceOrbitReferences(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, lines: Line[]) {
  const ids = Array.from(new Set(lines.flatMap(line => line.bookingId ? [line.bookingId] : [])));
  if (!ids.length) return new Map<string, string | null>();
  const rows = await db.select({ id: bookings.id, agentId: bookings.agentId, crmRef: bookings.crmRef })
    .from(bookings).where(inArray(bookings.id, ids));
  return remittanceOrbitReferenceMap(rows);
}
export function buildRemittanceBookingList(lines: Line[], references: Map<string, string | null>): string {
  return lines.map(line => {
    const reference = references.get(`${line.agentId}:${line.bookingId}`);
    return `• ${line.clientName ?? "Booking"} (${reference ? `Orbit reference: ${reference}` : "Orbit reference not recorded"}) — £${parseFloat(line.remit80 ?? "0").toFixed(2)}`;
  }).join("\n");
}
