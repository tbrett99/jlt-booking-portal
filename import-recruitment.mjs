/**
 * Import recruitment prospects from CSV into the JLT portal database.
 * - Skips duplicates (by email, case-insensitive)
 * - Attributes Max referrals (source = "Website Enquiry Form - Max" OR tag "max referral") to user ID 47
 * - Does NOT trigger any emails
 * - Preserves original createdAt date
 */
import { createPool } from "mysql2/promise";
import { createReadStream } from "fs";
import { parse } from "csv-parse";
import { fileURLToPath } from "url";
import path from "path";

const CSV_PATH = "/home/ubuntu/upload/pasted_file_4tro86_opportunities.csv";
const MAX_USER_ID = 47;

// Stage mapping from CSV → portal pipelineStage values
const STAGE_MAP = {
  "New Enquiry": "new_enquiry",
  "Joined": "won",
  "Discovery Call Complete": "discovery_call_complete",
  "DNTU": "did_not_turn_up",
  "Discovery Call Booked": "discovery_call_booked",
};

function parseName(fullName) {
  if (!fullName || !fullName.trim()) return { firstName: "", lastName: "" };
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || "";
  const lastName = parts.slice(1).join(" ") || "";
  return { firstName, lastName };
}

function isMaxReferral(row) {
  const source = (row["source"] || "").trim().toLowerCase();
  const tags = (row["tags"] || "").toLowerCase();
  return source === "website enquiry form - max" || tags.includes("max referral");
}

async function main() {
  // Get DATABASE_URL from environment (injected by the platform)
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const pool = createPool(dbUrl);

  // Load existing emails to skip duplicates
  const [existingRows] = await pool.query("SELECT email FROM recruitment_prospects");
  const existingEmails = new Set(existingRows.map((r) => r.email.toLowerCase().trim()));
  console.log(`Existing prospects in DB: ${existingEmails.size}`);

  // Parse CSV
  const records = await new Promise((resolve, reject) => {
    const rows = [];
    createReadStream(CSV_PATH)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });

  console.log(`CSV rows to process: ${records.length}`);

  let inserted = 0;
  let skipped = 0;
  let noEmail = 0;
  let maxReferrals = 0;

  for (const row of records) {
    const email = (row["email"] || "").trim().toLowerCase();

    // Skip if no email
    if (!email) {
      noEmail++;
      continue;
    }

    // Skip duplicates
    if (existingEmails.has(email)) {
      skipped++;
      continue;
    }

    const { firstName, lastName } = parseName(row["Contact Name"] || "");
    const phone = (row["phone"] || "").trim() || null;
    const stage = STAGE_MAP[row["stage"]?.trim()] || "new_enquiry";
    const notes = (row["Notes"] || "").trim() || null;
    const createdAt = row["Created on"] ? new Date(row["Created on"]) : new Date();
    const referredById = isMaxReferral(row) ? MAX_USER_ID : null;

    if (referredById) maxReferrals++;

    await pool.query(
      `INSERT INTO recruitment_prospects
        (firstName, lastName, email, phone, pipelineStage, adminNotes, referredById, createdAt, updatedAt, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        firstName,
        lastName,
        email,
        phone,
        stage,
        notes,
        referredById,
        createdAt,
        createdAt,
        "import",
      ]
    );

    existingEmails.add(email); // prevent in-batch duplicates
    inserted++;
  }

  await pool.end();

  console.log("\n=== Import Complete ===");
  console.log(`Inserted:      ${inserted}`);
  console.log(`Skipped (dup): ${skipped}`);
  console.log(`Skipped (no email): ${noEmail}`);
  console.log(`Max referrals: ${maxReferrals}`);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
