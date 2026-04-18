import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, inArray } from "drizzle-orm";
import { readFileSync } from "fs";

// Parse the CSV
const csv = readFileSync("/home/ubuntu/upload/Commissions-April26-17.csv", "utf8");
const lines = csv.split("\n").map(l => l.trim()).filter(l => l.length > 0);

// Extract unique PTS refs (col 3, index 2) and VAT (col 13, index 12) and Remit80 (col 14, index 13)
const csvData = {};
for (const line of lines) {
  const cols = line.split(",");
  const ref = cols[2]?.trim();
  const vat = parseFloat(cols[12]?.trim() ?? "0") || 0;
  const remit = parseFloat(cols[13]?.trim() ?? "0") || 0;
  if (ref && ref !== "Booking Ref" && ref.startsWith("2T")) {
    // Keep highest remit if duplicate ref
    if (!csvData[ref] || remit > csvData[ref].remit) {
      csvData[ref] = { ref, vat, remit };
    }
  }
}
const ptsRefs = Object.keys(csvData);
console.log(`CSV contains ${ptsRefs.length} unique PTS refs`);

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(conn);
const { bookings, commissionClaims, pipelineHistory } = await import("../drizzle/schema.ts");

// Look up all bookings
const bookingRows = await db
  .select({ id: bookings.id, agentId: bookings.agentId, clientName: bookings.clientName, ptsRef: bookings.ptsRef, currentStage: bookings.currentStage })
  .from(bookings)
  .where(inArray(bookings.ptsRef, ptsRefs));

console.log(`Found ${bookingRows.length} matching bookings in portal`);

const now = new Date();
let claimsCreated = 0;
let claimsPaid = 0;
let stagesAdvanced = 0;
const notFound = ptsRefs.filter(r => !bookingRows.find(b => b.ptsRef === r));

for (const booking of bookingRows) {
  const csvRow = csvData[booking.ptsRef];
  const terminalStages = ["Commission Claimed", "Cancelled"];

  // 1. Advance booking stage to Commission Claimed if not already there
  if (!terminalStages.includes(booking.currentStage ?? "")) {
    await db.update(bookings)
      .set({ currentStage: "Commission Claimed", updatedAt: now })
      .where(eq(bookings.id, booking.id));
    await db.insert(pipelineHistory).values({
      bookingId: booking.id,
      toStage: "Commission Claimed",
      movedById: 1,
    });
    stagesAdvanced++;
  }

  // 2. Get or create commission claim
  let claimRows = await db
    .select()
    .from(commissionClaims)
    .where(eq(commissionClaims.bookingId, booking.id))
    .limit(1);

  if (claimRows.length === 0) {
    await db.insert(commissionClaims).values({
      bookingId: booking.id,
      agentId: booking.agentId,
      bookingType: "other",
      status: "processing",
      claimedAt: now,
    });
    claimRows = await db
      .select()
      .from(commissionClaims)
      .where(eq(commissionClaims.bookingId, booking.id))
      .limit(1);
    claimsCreated++;
  }

  const claim = claimRows[0];

  // 3. Mark claim as paid with VAT from CSV (only update if not already paid)
  if (claim.status !== "paid") {
    await db.update(commissionClaims)
      .set({
        status: "paid",
        vatAmount: csvRow.vat > 0 ? csvRow.vat.toFixed(2) : claim.vatAmount,
        grossAmount: csvRow.remit > 0 ? csvRow.remit.toFixed(2) : claim.grossAmount,
        paidAt: now,
        updatedAt: now,
      })
      .where(eq(commissionClaims.id, claim.id));
    claimsPaid++;
    console.log(`  ✓ ${booking.ptsRef} | ${booking.clientName} | VAT: £${csvRow.vat.toFixed(2)} | Remit: £${csvRow.remit.toFixed(2)} → PAID`);
  } else {
    console.log(`  ⏭  ${booking.ptsRef} | ${booking.clientName} — already paid, skipped`);
  }
}

if (notFound.length > 0) {
  console.log(`\n⚠️  ${notFound.length} refs not found in portal:`);
  notFound.forEach(r => console.log(`  ${r}`));
}

console.log(`\nDone.`);
console.log(`  Claims created:   ${claimsCreated}`);
console.log(`  Claims paid:      ${claimsPaid}`);
console.log(`  Stages advanced:  ${stagesAdvanced}`);
await conn.end();
