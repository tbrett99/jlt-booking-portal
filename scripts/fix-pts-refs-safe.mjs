/**
 * Safe PTS ref fix script — no name matching.
 *
 * Two operations only:
 * 1. Fix misplaced 2T refs: where topdogRef contains ONLY 2T-format refs and ptsRef is blank,
 *    move the first 2T ref to ptsRef (clear topdogRef only if ALL values are 2T refs).
 *    For bookings like "2T0119678, 2T0119682" — these have multiple PTS refs, handle carefully.
 * 2. Set destination: for bookings that already have a ptsRef matching the CSV,
 *    set destination from the CSV COUNTRY column (only if destination is currently blank).
 *
 * NO name-based matching. Only exact ref matching.
 */

import mysql from "mysql2/promise";
import fs from "fs";
import "dotenv/config";

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log("Connected.");

  // Load CSV: ptsRef -> { name, country, profitClaimed }
  const csvContent = fs.readFileSync("/home/ubuntu/upload/TravelReportBookings.csv", "utf8");
  const lines = csvContent.split("\n").filter((l) => l.trim());
  const csvByRef = new Map();
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    if (parts[0]) {
      csvByRef.set(parts[0].trim().toUpperCase(), {
        name: parts[1],
        country: parts[4] ?? "",
        profitClaimed: (parts[2] ?? "").trim().toUpperCase() === "Y",
      });
    }
  }
  console.log(`CSV loaded: ${csvByRef.size} rows.`);

  // ── Step 1: Fix misplaced 2T refs ─────────────────────────────────────────
  // Find bookings where topdogRef contains 2T-format values and ptsRef is blank
  const [misplaced] = await conn.execute(
    "SELECT id, clientName, topdogRef, ptsRef FROM bookings WHERE topdogRef LIKE '2T%' AND (ptsRef IS NULL OR ptsRef = '')"
  );
  console.log(`\nStep 1: ${misplaced.length} bookings with 2T in topdogRef and no ptsRef.`);

  let movedRefs = 0;
  for (const b of misplaced) {
    // Split topdogRef by comma in case there are multiple
    const refs = (b.topdogRef ?? "").split(",").map((r) => r.trim()).filter(Boolean);
    const allArePts = refs.every((r) => r.toUpperCase().startsWith("2T"));

    if (allArePts && refs.length === 1) {
      // Single 2T ref — move to ptsRef, clear topdogRef
      await conn.execute(
        "UPDATE bookings SET ptsRef = ?, topdogRef = NULL WHERE id = ?",
        [refs[0], b.id]
      );
      await conn.execute(
        "INSERT INTO notes (bookingId, authorId, content, isInternal, createdAt) VALUES (?, ?, ?, ?, NOW())",
        [b.id, 1, `[System] PTS ref moved from topdogRef to ptsRef: ${refs[0]}.`, true]
      );
      movedRefs++;
    } else if (allArePts && refs.length > 1) {
      // Multiple 2T refs — move all to ptsRef (comma-separated), clear topdogRef
      const ptsValue = refs.join(", ");
      await conn.execute(
        "UPDATE bookings SET ptsRef = ?, topdogRef = NULL WHERE id = ?",
        [ptsValue, b.id]
      );
      await conn.execute(
        "INSERT INTO notes (bookingId, authorId, content, isInternal, createdAt) VALUES (?, ?, ?, ?, NOW())",
        [b.id, 1, `[System] Multiple PTS refs moved from topdogRef to ptsRef: ${ptsValue}.`, true]
      );
      movedRefs++;
    }
    // If topdogRef has mixed refs (some 2T, some not), leave it alone
  }
  console.log(`Moved ${movedRefs} misplaced 2T refs to ptsRef.`);

  // ── Step 2: Set destination for exact PTS ref matches ─────────────────────
  const [allBookings] = await conn.execute(
    "SELECT id, ptsRef, destination FROM bookings WHERE ptsRef IS NOT NULL AND ptsRef != ''"
  );
  console.log(`\nStep 2: Checking ${allBookings.length} bookings with ptsRef for destination updates.`);

  let destUpdated = 0;
  for (const b of allBookings) {
    // Handle comma-separated ptsRef (multiple refs)
    const refs = (b.ptsRef ?? "").split(",").map((r) => r.trim()).filter(Boolean);
    // Use the first ref for CSV lookup
    const csvRow = csvByRef.get(refs[0].toUpperCase());
    if (csvRow && csvRow.country && (!b.destination || b.destination.trim() === "")) {
      await conn.execute(
        "UPDATE bookings SET destination = ? WHERE id = ?",
        [csvRow.country, b.id]
      );
      destUpdated++;
    }
  }
  console.log(`Set destination for ${destUpdated} bookings.`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const [withPts] = await conn.execute("SELECT COUNT(*) as c FROM bookings WHERE ptsRef IS NOT NULL AND ptsRef != ''");
  const [withDest] = await conn.execute("SELECT COUNT(*) as c FROM bookings WHERE destination IS NOT NULL AND destination != ''");
  console.log(`\n=== Final State ===`);
  console.log(`Bookings with ptsRef: ${withPts[0].c}`);
  console.log(`Bookings with destination: ${withDest[0].c}`);

  // Verify booking 32364
  const [check] = await conn.execute("SELECT id, clientName, topdogRef, ptsRef, destination FROM bookings WHERE id = 32364");
  console.log("Booking 32364:", JSON.stringify(check[0]));

  await conn.end();
}

main().catch((e) => {
  console.error("Script failed:", e.message);
  process.exit(1);
});
