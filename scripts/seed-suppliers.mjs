/**
 * Seed suppliers from the exported CSV into the database.
 * Run: node scripts/seed-suppliers.mjs
 */
import { createConnection } from "mysql2/promise";
import { readFileSync } from "fs";
import { parse } from "csv-parse/sync";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// Parse DATABASE_URL: mysql://user:pass@host:port/db
function parseMysqlUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || "3306"),
    user: u.username,
    password: u.password,
    database: u.pathname.slice(1),
    ssl: { rejectUnauthorized: false },
  };
}

// Clean HTML from description fields
function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// Determine credential stage based on whether credentials exist
function getCredentialStage(row) {
  const hasCredentials = row["username__13"]?.trim() || row["password"]?.trim();
  // Default: if credentials exist, require stage 2 to see them
  // Admin can change this per supplier
  return hasCredentials ? 2 : 2;
}

async function main() {
  // Read and parse CSV (UTF-16 encoded, tab-separated)
  const csvPath = join(__dirname, "../../upload/export_dir/export.csv");
  let content;
  try {
    content = readFileSync(csvPath, "utf-16le");
    // Remove BOM if present
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
  } catch (e) {
    // Try the uploaded CSV directly
    const altPath = join(__dirname, "../../upload/pasted_file_b3itK8_export.csv");
    content = readFileSync(altPath, "utf-16le");
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
  }

  const rows = parse(content, {
    delimiter: "\t",
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });

  console.log(`Parsed ${rows.length} rows from CSV`);

  const conn = await createConnection(parseMysqlUrl(DATABASE_URL));

  // Clear existing suppliers
  await conn.execute("DELETE FROM suppliers");
  console.log("Cleared existing suppliers");

  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = row["listing_title"]?.trim();
    if (!name) continue;

    // Build image filename (will be updated with S3 URL later)
    const imageFilename = row["images"]?.trim() || null;

    // Clean categories and locations
    const categories = row["listing_category"]
      ?.split(";")
      .map((c) => c.trim())
      .filter(Boolean)
      .join(";") || null;

    const locations = row["locations_tags"]
      ?.split(";")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(";") || null;

    // Clean website URLs (remove trailing commas)
    const cleanUrl = (url) => url?.trim().replace(/,\s*$/, "") || null;

    const supplier = {
      name,
      description: row["description"]?.trim() || null,
      shortDescription: row["short_description"]?.trim() || null,
      publicWebsite: cleanUrl(row["public_website"]),
      tradeWebsite: cleanUrl(row["trade_website"]) || cleanUrl(row["website_1"]) || cleanUrl(row["website"]),
      additionalWebsite: null,
      agencyId: row["agency_id"]?.trim() || null,
      loginUsername: row["username__13"]?.trim() || null,
      loginPassword: row["password"]?.trim() || null,
      commission: row["commission"]?.trim() || null,
      facebookUrl: cleanUrl(row["facebook"]),
      accountManager: row["account_manager"]?.trim() || null,
      phone: row["phone"]?.trim() || null,
      email: row["email"]?.trim() || null,
      generalNotes: row["general"]?.trim() || null,
      video1: row["video_1"]?.trim() || null,
      video2: row["video_2"]?.trim() || null,
      video3: row["video_3"]?.trim() || null,
      categories,
      locations,
      imageUrl: imageFilename ? `__PENDING__${imageFilename}` : null, // will be replaced with S3 URL
      adminUsername: row["admin_only_-_username"]?.trim() || null,
      adminPassword: row["admin_only_-_password"]?.trim() || null,
      adminNotes: row["admin_only_-_notes"]?.trim() || null,
      credentialStage: getCredentialStage(row),
      isActive: 1,
      sortOrder: i,
    };

    try {
      await conn.execute(
        `INSERT INTO suppliers 
          (name, description, shortDescription, publicWebsite, tradeWebsite, additionalWebsite,
           agencyId, loginUsername, loginPassword, commission, facebookUrl, accountManager,
           phone, email, generalNotes, video1, video2, video3, categories, locations, imageUrl,
           adminUsername, adminPassword, adminNotes, credentialStage, isActive, sortOrder)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          supplier.name, supplier.description, supplier.shortDescription,
          supplier.publicWebsite, supplier.tradeWebsite, supplier.additionalWebsite,
          supplier.agencyId, supplier.loginUsername, supplier.loginPassword,
          supplier.commission, supplier.facebookUrl, supplier.accountManager,
          supplier.phone, supplier.email, supplier.generalNotes,
          supplier.video1, supplier.video2, supplier.video3,
          supplier.categories, supplier.locations, supplier.imageUrl,
          supplier.adminUsername, supplier.adminPassword, supplier.adminNotes,
          supplier.credentialStage, supplier.isActive, supplier.sortOrder,
        ]
      );
      inserted++;
    } catch (e) {
      console.error(`Error inserting "${name}":`, e.message);
      errors++;
    }
  }

  await conn.end();
  console.log(`\nDone! Inserted: ${inserted}, Errors: ${errors}`);
  console.log("Note: Image URLs are set to __PENDING__<filename> and will be updated after S3 upload.");
}

main().catch(console.error);
