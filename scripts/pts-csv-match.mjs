/**
 * PTS CSV Match & Update Script
 *
 * Reads TravelReportBookings.csv and for each row:
 * 1. Looks up the booking in the portal by PTS ref (BOOKINGREFERENCE column)
 * 2. Also checks if the booking has a topdogRef starting with "2T" (misplaced PTS ref)
 * 3. Updates: ptsRef (if blank), destination, and moves to "Commission Claimed" if PROFIT CLAIMED = Y
 *
 * Run: node scripts/pts-csv-match.mjs /path/to/TravelReportBookings.csv
 */

import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const csvPath = process.argv[2] || "/home/ubuntu/upload/TravelReportBookings.csv";

// ─── Normalise name for fuzzy matching ────────────────────────────────────────
function normaliseName(name) {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Simple name similarity: check if all words in CSV name appear in portal name or vice versa
function namesMatch(csvName, portalName) {
  const a = normaliseName(csvName);
  const b = normaliseName(portalName);
  if (a === b) return true;
  const wordsA = a.split(" ");
  const wordsB = b.split(" ");
  // At least 2 words must match (handles middle name differences)
  const matches = wordsA.filter((w) => w.length > 1 && wordsB.includes(w));
  return matches.length >= Math.min(2, Math.min(wordsA.length, wordsB.length));
}

// ─── Parse CSV (handles quoted fields with commas) ────────────────────────────
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
  console.log("Connected to database.");

  // Load all portal bookings
  const [portalRows] = await conn.execute(
    "SELECT id, clientName, topdogRef, ptsRef, destination, currentStage FROM bookings"
  );

  // Build lookup maps
  const byPtsRef = new Map(); // ptsRef → booking
  const byTopdogRef = new Map(); // topdogRef → booking (for misplaced 2T refs)
  for (const b of portalRows) {
    if (b.ptsRef) byPtsRef.set(b.ptsRef.trim().toUpperCase(), b);
    if (b.topdogRef) byTopdogRef.set(b.topdogRef.trim().toUpperCase(), b);
  }

  // Read CSV
  const csvContent = fs.readFileSync(csvPath, "utf8");
  const lines = csvContent.split("\n").filter((l) => l.trim());
  const header = parseCsvLine(lines[0]);
  const refIdx = header.findIndex((h) => h.toUpperCase().includes("BOOKINGREFERENCE") || h.toUpperCase() === "BOOKINGREFERENCE");
  const nameIdx = header.findIndex((h) => h.toUpperCase() === "BOOKING");
  const profitIdx = header.findIndex((h) => h.toUpperCase().includes("PROFIT"));
  const countryIdx = header.findIndex((h) => h.toUpperCase() === "COUNTRY");

  console.log(`CSV columns: ref=${refIdx}, name=${nameIdx}, profit=${profitIdx}, country=${countryIdx}`);
  console.log(`Total CSV rows: ${lines.length - 1}`);

  const stats = {
    total: 0,
    matchedByPtsRef: 0,
    matchedByMisplacedRef: 0,
    matchedByName: 0,
    ptsRefUpdated: 0,
    destinationUpdated: 0,
    stageMovedToCommissionClaimed: 0,
    skippedAlreadyCorrect: 0,
    unmatched: 0,
    unmatchedRefs: [],
  };

  const COMMISSION_CLAIMED_STAGES = ["Commission Claimed"];
  // Stages that are "past" commission — don't move backwards
  const STAGES_NOT_TO_MOVE = ["Cancelled"];

  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    if (parts.length < 3) continue;

    const csvRef = (parts[refIdx] ?? "").trim().toUpperCase();
    const csvName = (parts[nameIdx] ?? "").trim();
    const csvProfit = (parts[profitIdx] ?? "").trim().toUpperCase();
    const csvCountry = (parts[countryIdx] ?? "").trim();

    if (!csvRef) continue;
    stats.total++;

    let booking = null;
    let matchType = null;

    // 1. Match by ptsRef
    if (byPtsRef.has(csvRef)) {
      booking = byPtsRef.get(csvRef);
      matchType = "ptsRef";
      stats.matchedByPtsRef++;
    }
    // 2. Match by misplaced topdogRef (2T* in topdogRef field)
    else if (byTopdogRef.has(csvRef)) {
      booking = byTopdogRef.get(csvRef);
      matchType = "misplacedRef";
      stats.matchedByMisplacedRef++;
    }
    // 3. Fuzzy name match among bookings with no ptsRef
    else {
      const noPtsRef = portalRows.filter((b) => !b.ptsRef);
      const nameMatch = noPtsRef.find((b) => namesMatch(csvName, b.clientName));
      if (nameMatch) {
        booking = nameMatch;
        matchType = "name";
        stats.matchedByName++;
      }
    }

    if (!booking) {
      stats.unmatched++;
      if (stats.unmatchedRefs.length < 20) stats.unmatchedRefs.push(csvRef);
      continue;
    }

    // Build update
    const updates = {};
    const notes = [];

    // Fix misplaced 2T ref
    if (matchType === "misplacedRef" && !booking.ptsRef) {
      updates.ptsRef = csvRef;
      updates.topdogRef = null; // clear from topdog field
      notes.push(`PTS ref corrected from topdogRef to ptsRef: ${csvRef}`);
      stats.ptsRefUpdated++;
    }

    // Set ptsRef if blank
    if (!booking.ptsRef && !updates.ptsRef) {
      updates.ptsRef = csvRef;
      notes.push(`PTS ref set from CSV: ${csvRef}`);
      stats.ptsRefUpdated++;
    }

    // Set destination if blank or different
    if (csvCountry && (!booking.destination || booking.destination.trim() !== csvCountry)) {
      updates.destination = csvCountry;
      notes.push(`Destination set: ${csvCountry}`);
      stats.destinationUpdated++;
    }

    // Move to Commission Claimed if profit claimed = Y and not already there
    const shouldMoveStage =
      csvProfit === "Y" &&
      !COMMISSION_CLAIMED_STAGES.includes(booking.currentStage) &&
      !STAGES_NOT_TO_MOVE.includes(booking.currentStage);

    if (shouldMoveStage) {
      updates.currentStage = "Commission Claimed";
      notes.push(`Stage moved to Commission Claimed (profit claimed)`);
      stats.stageMovedToCommissionClaimed++;
    }

    if (Object.keys(updates).length === 0) {
      stats.skippedAlreadyCorrect++;
      continue;
    }

    // Apply updates
    const setClauses = Object.keys(updates).map((k) => `\`${k}\` = ?`).join(", ");
    const values = [...Object.values(updates), booking.id];
    await conn.execute(`UPDATE bookings SET ${setClauses} WHERE id = ?`, values);

    // Write pipeline history if stage changed
    if (updates.currentStage) {
      await conn.execute(
        "INSERT INTO pipeline_history (bookingId, fromStage, toStage, movedById, movedAt) VALUES (?, ?, ?, ?, NOW())",
        [booking.id, booking.currentStage, updates.currentStage, 1]
      );
      // System note
      await conn.execute(
        "INSERT INTO notes (bookingId, authorId, content, isInternal, createdAt) VALUES (?, ?, ?, ?, NOW())",
        [booking.id, 1, `[System] ${notes.join("; ")} — updated via PTS CSV import.`, true]
      );
    } else {
      // System note for field updates only
      await conn.execute(
        "INSERT INTO notes (bookingId, authorId, content, isInternal, createdAt) VALUES (?, ?, ?, ?, NOW())",
        [booking.id, 1, `[System] ${notes.join("; ")} — updated via PTS CSV import.`, true]
      );
    }

    // Update the in-memory map so subsequent rows can find this booking by its new ptsRef
    if (updates.ptsRef) {
      byPtsRef.set(updates.ptsRef.toUpperCase(), { ...booking, ptsRef: updates.ptsRef });
    }
  }

  await conn.end();

  console.log("\n=== PTS CSV Match Results ===");
  console.log(`Total CSV rows processed:     ${stats.total}`);
  console.log(`Matched by PTS ref:           ${stats.matchedByPtsRef}`);
  console.log(`Matched by misplaced ref:     ${stats.matchedByMisplacedRef}`);
  console.log(`Matched by name (fuzzy):      ${stats.matchedByName}`);
  console.log(`PTS refs updated/fixed:       ${stats.ptsRefUpdated}`);
  console.log(`Destinations set:             ${stats.destinationUpdated}`);
  console.log(`Moved to Commission Claimed:  ${stats.stageMovedToCommissionClaimed}`);
  console.log(`Skipped (already correct):    ${stats.skippedAlreadyCorrect}`);
  console.log(`Unmatched (no portal booking):${stats.unmatched}`);
  if (stats.unmatchedRefs.length > 0) {
    console.log(`\nFirst unmatched refs (up to 20):`);
    stats.unmatchedRefs.forEach((r) => console.log(`  ${r}`));
  }
}

main().catch((e) => {
  console.error("Script failed:", e.message);
  process.exit(1);
});
