/**
 * Enriches all suppliers in the database using the AI enrichment procedure.
 * Runs directly against the DB using the same LLM helper as the server.
 * Usage: node scripts/enrich-suppliers.mjs
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load env
const dotenv = await import("dotenv");
dotenv.config({ path: join(__dirname, "../.env") });

const mysql = await import("mysql2/promise");

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY;

if (!FORGE_API_URL || !FORGE_API_KEY) {
  console.error("BUILT_IN_FORGE_API_URL or BUILT_IN_FORGE_API_KEY not set");
  process.exit(1);
}

async function invokeLLM(messages, responseFormat) {
  const body = { messages };
  if (responseFormat) body.response_format = responseFormat;
  const resp = await fetch(`${FORGE_API_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FORGE_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM API error ${resp.status}: ${text}`);
  }
  return resp.json();
}

// Parse DB URL: mysql://user:pass@host:port/db
function parseDbUrl(url) {
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Invalid DATABASE_URL format");
  return { user: m[1], password: m[2], host: m[3], port: parseInt(m[4]), database: m[5] };
}

async function main() {
  const dbConfig = parseDbUrl(DB_URL);
  const conn = await mysql.default.createConnection({ ...dbConfig, ssl: { rejectUnauthorized: false } });

  // Get all suppliers that haven't been enriched yet
  const [rows] = await conn.execute(
    "SELECT id, name, description, categories, locations, commission FROM suppliers WHERE isActive = 1 AND aiEnrichedAt IS NULL ORDER BY id"
  );

  console.log(`Found ${rows.length} suppliers to enrich`);

  let success = 0;
  let failed = 0;

  for (const supplier of rows) {
    try {
      const context = [
        `Name: ${supplier.name}`,
        supplier.description
          ? `Description: ${supplier.description.replace(/<[^>]+>/g, " ").slice(0, 1500)}`
          : "",
        supplier.categories ? `Categories: ${supplier.categories}` : "",
        supplier.locations ? `Locations/Destinations: ${supplier.locations}` : "",
        supplier.commission ? `Commission: ${supplier.commission}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const result = await invokeLLM(
        [
          {
            role: "system",
            content: `You are a travel industry expert. Based on the supplier information provided, extract and generate structured data. Return ONLY valid JSON with these exact fields (use null for unknown):
{
  "usp": "2-3 key selling points as bullet points starting with •, or null",
  "priceTier": "one of: budget, mid-range, luxury, ultra-luxury, or null",
  "notSuitableFor": "what this supplier is NOT ideal for (e.g. last-minute bookings, budget travellers), or null",
  "preferredContact": "email, phone, portal, or null",
  "aiSummary": "1-2 sentence summary optimised for AI matching - mention destinations, trip types, client types, and key strengths"
}`,
          },
          {
            role: "user",
            content: `Supplier information:\n${context}`,
          },
        ],
        { type: "json_object" }
      );

      const content = result.choices?.[0]?.message?.content ?? "{}";
      let enriched;
      try {
        enriched = JSON.parse(content);
      } catch {
        console.warn(`  [${supplier.id}] ${supplier.name}: Failed to parse JSON response`);
        failed++;
        continue;
      }

      // Update the supplier in the database
      await conn.execute(
        `UPDATE suppliers SET 
          usp = ?, 
          priceTier = ?, 
          notSuitableFor = ?, 
          preferredContact = ?, 
          aiSummary = ?,
          aiEnrichedAt = NOW()
        WHERE id = ?`,
        [
          enriched.usp ?? null,
          enriched.priceTier ?? null,
          enriched.notSuitableFor ?? null,
          enriched.preferredContact ?? null,
          enriched.aiSummary ?? null,
          supplier.id,
        ]
      );

      success++;
      console.log(`  [${supplier.id}] ${supplier.name}: ✓ (${enriched.priceTier ?? "unknown tier"})`);

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.error(`  [${supplier.id}] ${supplier.name}: ✗ ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${success} enriched, ${failed} failed`);
  await conn.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
