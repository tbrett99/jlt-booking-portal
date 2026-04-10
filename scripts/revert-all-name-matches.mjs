/**
 * Revert ALL ptsRef assignments made by the fuzzy name match pass.
 *
 * The only safe ptsRef assignments are those where the booking's ptsRef
 * was ALREADY in the portal before the script ran (exact match from a previous import).
 *
 * Strategy:
 * - Find all bookings that have a system note "PTS ref set from CSV ... updated via PTS CSV import"
 * - These are the ones where the script SET the ptsRef (they didn't have one before)
 * - Clear ptsRef and destination on ALL of them
 * - The 1,865 exact-matched bookings already had their ptsRef set before the script ran,
 *   so they will NOT have this note (the script skipped them as "already correct")
 *
 * After this, only bookings that had ptsRef BEFORE the script will retain it.
 */

import mysql from "mysql2/promise";
import fs from "fs";
import "dotenv/config";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log("Connected.");

  // Find all bookings where the script SET a ptsRef (they had the "PTS ref set from CSV" note)
  const [toRevert] = await conn.execute(
    `SELECT DISTINCT b.id, b.clientName, b.topdogRef, b.ptsRef, b.destination, b.currentStage
     FROM bookings b
     JOIN notes n ON n.bookingId = b.id
     WHERE n.content LIKE '%PTS ref set from CSV%'
     AND n.content LIKE '%updated via PTS CSV import%'`
  );

  console.log(`Found ${toRevert.length} bookings where ptsRef was set by the script. Reverting all...`);

  let reverted = 0;
  for (const b of toRevert) {
    await conn.execute(
      "UPDATE bookings SET ptsRef = NULL, destination = NULL WHERE id = ?",
      [b.id]
    );
    await conn.execute(
      "INSERT INTO notes (bookingId, authorId, content, isInternal, createdAt) VALUES (?, ?, ?, ?, NOW())",
      [b.id, 1, `[System] Reverted: ptsRef (${b.ptsRef}) and destination cleared — name-based matching was unreliable.`, true]
    );
    reverted++;
  }

  console.log(`Reverted ${reverted} bookings.`);

  // Verify booking 32364 is now clean
  const [check] = await conn.execute("SELECT id, clientName, topdogRef, ptsRef, destination FROM bookings WHERE id = 32364");
  console.log("Booking 32364 after revert:", JSON.stringify(check[0]));

  // Summary
  const [withPts] = await conn.execute("SELECT COUNT(*) as c FROM bookings WHERE ptsRef IS NOT NULL AND ptsRef != ''");
  const [withDest] = await conn.execute("SELECT COUNT(*) as c FROM bookings WHERE destination IS NOT NULL AND destination != ''");
  console.log(`\nBookings with ptsRef: ${withPts[0].c}`);
  console.log(`Bookings with destination: ${withDest[0].c}`);

  await conn.end();
}

main().catch((e) => {
  console.error("Script failed:", e.message);
  process.exit(1);
});
