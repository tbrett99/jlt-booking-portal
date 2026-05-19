/**
 * One-off backfill: assign JLT-XXXX uniqueAgentId to every agent_crm_profiles row that has NULL.
 * Runs sequentially to avoid duplicate ID generation (generateUniqueAgentIdForUser reads all existing IDs each call).
 */
import { createPool } from "mysql2/promise";

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) { console.error("DATABASE_URL not set"); process.exit(1); }

// Strip SSL JSON from URL and connect with ssl option
const urlObj = new URL(rawUrl);
const sslParam = urlObj.searchParams.get("ssl");
urlObj.searchParams.delete("ssl");
const cleanUrl = urlObj.toString();

const pool = createPool({
  uri: cleanUrl,
  ssl: sslParam ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 2,
});

async function generateNextId(conn) {
  const [rows] = await conn.execute(
    "SELECT uniqueAgentId FROM agent_crm_profiles WHERE uniqueAgentId IS NOT NULL AND uniqueAgentId LIKE 'JLT-%'"
  );
  const usedIds = new Set(rows.map(r => r.uniqueAgentId));
  let num = rows.length + 1;
  let id = `JLT-${String(num).padStart(4, "0")}`;
  while (usedIds.has(id)) {
    num++;
    id = `JLT-${String(num).padStart(4, "0")}`;
  }
  return id;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    const [profiles] = await conn.execute(
      "SELECT id FROM agent_crm_profiles WHERE uniqueAgentId IS NULL ORDER BY id ASC"
    );
    console.log(`Found ${profiles.length} agents without an Agent ID`);

    let assigned = 0;
    let failed = 0;

    for (const profile of profiles) {
      try {
        const id = await generateNextId(conn);
        await conn.execute(
          "UPDATE agent_crm_profiles SET uniqueAgentId = ? WHERE id = ? AND uniqueAgentId IS NULL",
          [id, profile.id]
        );
        assigned++;
        if (assigned % 50 === 0) console.log(`  Assigned ${assigned}/${profiles.length}...`);
      } catch (err) {
        console.error(`  Failed for profile ${profile.id}:`, err.message);
        failed++;
      }
    }

    console.log(`\nDone. Assigned: ${assigned}, Failed: ${failed}`);

    // Verify
    const [[{ remaining }]] = await conn.execute(
      "SELECT COUNT(*) as remaining FROM agent_crm_profiles WHERE uniqueAgentId IS NULL"
    );
    console.log(`Remaining NULL uniqueAgentId: ${remaining}`);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
