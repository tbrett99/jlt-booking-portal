import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, inArray } from "drizzle-orm";

// The 14 PTS refs from the screenshots
const PTS_REFS = [
  "2T0104928", // Caroline Field
  "2T0107783", // Lewis Don
  "2T0117855", // Judith Hill
  "2T0114026", // Benjamin Daley
  "2T0103971", // Paul Coope
  "2T0118244", // Gary Blakeley
  "2T0113269", // Rowen Nugent
  "2T0101179", // Rachel Spencer
  "2T0102228", // samantha Fenton
  "2T0109288", // JORDAN KNOWLES
  "2T0108428", // Leia Gordon
  "2T0102051", // Richard Hawkes
  "2T0111006", // James Coupland
  "2T0118071", // Alice Soloman
];

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(conn);

// Dynamically import schema
const { bookings, commissionClaims, pipelineHistory } = await import("../drizzle/schema.ts");

// 1. Look up bookings
const bookingRows = await db
  .select({ id: bookings.id, agentId: bookings.agentId, clientName: bookings.clientName, ptsRef: bookings.ptsRef, currentStage: bookings.currentStage })
  .from(bookings)
  .where(inArray(bookings.ptsRef, PTS_REFS));

console.log(`Found ${bookingRows.length} bookings:`);
bookingRows.forEach(b => console.log(`  ${b.ptsRef} | ${b.clientName} | stage: ${b.currentStage} | agentId: ${b.agentId}`));

// 2. Check which already have claims
const bookingIds = bookingRows.map(b => b.id);
const existingClaims = bookingIds.length > 0
  ? await db.select({ bookingId: commissionClaims.bookingId }).from(commissionClaims).where(inArray(commissionClaims.bookingId, bookingIds))
  : [];
const claimedBookingIds = new Set(existingClaims.map(c => c.bookingId));

const toFix = bookingRows.filter(b => !claimedBookingIds.has(b.id));
console.log(`\n${toFix.length} bookings need a claim created:`);
toFix.forEach(b => console.log(`  ${b.ptsRef} | ${b.clientName}`));

// 3. Create claims and advance stage
const now = new Date();
let created = 0;
let stageUpdated = 0;

for (const booking of toFix) {
  // Insert commission claim with status 'processing' (admin-created, not agent-claimed)
  await db.insert(commissionClaims).values({
    bookingId: booking.id,
    agentId: booking.agentId,
    bookingType: "other",
    grossAmount: null,
    status: "processing",
    claimedAt: now,
  });
  created++;
  console.log(`  ✓ Created claim for ${booking.ptsRef} (${booking.clientName})`);

  // Advance booking to Commission Claimed if not already there
  const terminalStages = ["Commission Claimed", "Cancelled"];
  if (!terminalStages.includes(booking.currentStage ?? "")) {
    await db.update(bookings)
      .set({ currentStage: "Commission Claimed", updatedAt: now })
      .where(eq(bookings.id, booking.id));
    // Log stage history
    await db.insert(pipelineHistory).values({
      bookingId: booking.id,
      toStage: "Commission Claimed",
      movedById: 1,
    });
    stageUpdated++;
    console.log(`  ✓ Advanced ${booking.ptsRef} to Commission Claimed`);
  }
}

// 4. Report PTS refs not found
const foundRefs = new Set(bookingRows.map(b => b.ptsRef));
const notFound = PTS_REFS.filter(r => !foundRefs.has(r));
if (notFound.length > 0) {
  console.log(`\n⚠️  Not found in portal (${notFound.length}):`);
  notFound.forEach(r => console.log(`  ${r}`));
}

console.log(`\nDone. Created ${created} claims, advanced ${stageUpdated} bookings.`);
await conn.end();
