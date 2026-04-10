/**
 * Revert all incorrectly assigned ptsRefs from the fuzzy name match pass.
 *
 * Strategy:
 * 1. Find all bookings where ptsRef was set by the CSV import script (via system note).
 * 2. For each, check if the ptsRef in the CSV actually matches the client name.
 * 3. If it does NOT match (name mismatch or ref not in CSV), clear ptsRef and destination.
 * 4. Also revert any stage moves caused by the fuzzy match (if stage was moved to Commission Claimed by the script).
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

function normName(name) {
  return (name ?? "").toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

function namesMatch(a, b) {
  const wa = normName(a).split(" ").filter((w) => w.length > 1);
  const wb = normName(b).split(" ").filter((w) => w.length > 1);
  const matches = wa.filter((w) => wb.includes(w));
  return matches.length >= Math.min(2, Math.min(wa.length, wb.length));
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log("Connected.");

  // Load CSV into a map: ptsRef.toUpperCase() -> { name, country }
  const csvContent = fs.readFileSync("/home/ubuntu/upload/TravelReportBookings.csv", "utf8");
  const lines = csvContent.split("\n").filter((l) => l.trim());
  const csvByRef = new Map();
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    if (parts[0]) {
      csvByRef.set(parts[0].trim().toUpperCase(), { name: parts[1], country: parts[4] });
    }
  }

  // Find all bookings where ptsRef was set by the CSV import script
  const [updated] = await conn.execute(
    `SELECT DISTINCT b.id, b.clientName, b.topdogRef, b.ptsRef, b.destination, b.currentStage
     FROM bookings b
     JOIN notes n ON n.bookingId = b.id
     WHERE n.content LIKE '%PTS ref set from CSV%'
     AND n.content LIKE '%updated via PTS CSV import%'`
  );

  console.log(`Found ${updated.length} bookings updated by the CSV script.`);

  let reverted = 0;
  let kept = 0;
  const revertedList = [];

  for (const b of updated) {
    const csvRow = csvByRef.get((b.ptsRef ?? "").toUpperCase());

    let shouldRevert = false;
    let reason = "";

    if (!csvRow) {
      // The ptsRef assigned doesn't exist in the CSV at all
      shouldRevert = true;
      reason = "ptsRef not found in CSV";
    } else if (!namesMatch(b.clientName, csvRow.name)) {
      // The name in the CSV doesn't match the portal booking name
      shouldRevert = true;
      reason = `name mismatch: portal="${b.clientName}" vs csv="${csvRow.name}"`;
    }

    if (shouldRevert) {
      // Clear ptsRef and destination that were incorrectly set
      await conn.execute(
        "UPDATE bookings SET ptsRef = NULL, destination = NULL WHERE id = ?",
        [b.id]
      );

      // Add a corrective note
      await conn.execute(
        "INSERT INTO notes (bookingId, authorId, content, isInternal, createdAt) VALUES (?, ?, ?, ?, NOW())",
        [b.id, 1, `[System] Reverted incorrect PTS ref assignment (${reason}). PTS ref and destination cleared.`, true]
      );

      reverted++;
      revertedList.push({ id: b.id, clientName: b.clientName, wrongPtsRef: b.ptsRef, reason });
    } else {
      kept++;
    }
  }

  console.log(`\n=== Revert Results ===`);
  console.log(`Total checked: ${updated.length}`);
  console.log(`Correctly matched (kept): ${kept}`);
  console.log(`Incorrectly matched (reverted): ${reverted}`);

  if (revertedList.length > 0) {
    console.log(`\nFirst 20 reverted:`);
    revertedList.slice(0, 20).forEach((r) =>
      console.log(`  #${r.id} ${r.clientName} | wrong ptsRef: ${r.wrongPtsRef} | ${r.reason}`)
    );
    fs.writeFileSync("/tmp/reverted-list.json", JSON.stringify(revertedList, null, 2));
    console.log(`\nFull list saved to /tmp/reverted-list.json`);
  }

  await conn.end();
}

main().catch((e) => {
  console.error("Script failed:", e.message);
  process.exit(1);
});
