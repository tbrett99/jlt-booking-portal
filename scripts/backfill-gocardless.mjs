/**
 * GoCardless → CRM Backfill Script
 * Pulls all customers, mandates, and subscriptions from GoCardless,
 * matches them to CRM agents by email, and backfills gc_mandates + gc_subscriptions.
 */
import * as dotenv from "dotenv";
import { createConnection } from "mysql2/promise";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const GC_TOKEN = process.env.GOCARDLESS_ACCESS_TOKEN;
const GC_ENV = process.env.GOCARDLESS_ENVIRONMENT ?? "live";
const GC_BASE = GC_ENV === "sandbox"
  ? "https://api-sandbox.gocardless.com"
  : "https://api.gocardless.com";

const DB_URL = process.env.DATABASE_URL;

async function gcGet(path, params = {}) {
  const url = new URL(GC_BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${GC_TOKEN}`,
      "GoCardless-Version": "2015-07-06",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GoCardless ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function fetchAll(resource, key) {
  const results = [];
  let after = null;
  while (true) {
    const params = { limit: 500 };
    if (after) params.after = after;
    const data = await gcGet(`/${resource}`, params);
    results.push(...data[key]);
    if (data.meta?.cursors?.after) {
      after = data.meta.cursors.after;
    } else {
      break;
    }
  }
  return results;
}

function parseDbUrl(url) {
  // mysql://user:pass@host:port/db?params
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || "3306"),
    user: u.username,
    password: u.password,
    database: u.pathname.replace(/^\//, ""),
    ssl: u.searchParams.get("ssl-mode") ? { rejectUnauthorized: false } : undefined,
  };
}

async function main() {
  console.log("🔌 Connecting to database...");
  const conn = await createConnection({ ...parseDbUrl(DB_URL), ssl: { rejectUnauthorized: false } });

  console.log("📋 Loading CRM agents from database...");
  const [agents] = await conn.execute(
    "SELECT id, name, email FROM users WHERE role IN ('agent','admin','super_admin') AND email IS NOT NULL"
  );
  const agentByEmail = new Map(agents.map((a) => [a.email.toLowerCase().trim(), a]));
  console.log(`   Found ${agents.length} CRM users`);

  console.log("\n🏦 Fetching GoCardless customers...");
  const customers = await fetchAll("customers", "customers");
  console.log(`   Found ${customers.length} GoCardless customers`);

  // Build email → customer map
  const customerByEmail = new Map();
  for (const c of customers) {
    if (c.email) customerByEmail.set(c.email.toLowerCase().trim(), c);
  }

  console.log("\n🔗 Fetching all mandates...");
  const allMandates = await fetchAll("mandates", "mandates");
  console.log(`   Found ${allMandates.length} mandates`);

  // Build customer_id → mandates map
  const mandatesByCustomer = new Map();
  for (const m of allMandates) {
    const cid = m.links?.customer;
    if (!mandatesByCustomer.has(cid)) mandatesByCustomer.set(cid, []);
    mandatesByCustomer.get(cid).push(m);
  }

  console.log("\n📅 Fetching all subscriptions...");
  const allSubs = await fetchAll("subscriptions", "subscriptions");
  console.log(`   Found ${allSubs.length} subscriptions`);

  // Build mandate_id → subscriptions map
  const subsByMandate = new Map();
  for (const s of allSubs) {
    const mid = s.links?.mandate;
    if (!subsByMandate.has(mid)) subsByMandate.set(mid, []);
    subsByMandate.get(mid).push(s);
  }

  console.log("\n🔄 Matching and backfilling...");
  let matched = 0;
  let skipped = 0;
  let noGc = 0;

  for (const [email, agent] of agentByEmail) {
    const gcCustomer = customerByEmail.get(email);
    if (!gcCustomer) {
      noGc++;
      continue;
    }

    const mandates = mandatesByCustomer.get(gcCustomer.id) ?? [];
    if (mandates.length === 0) {
      console.log(`  ⚠️  ${agent.name} (${email}) — GoCardless customer found but no mandates`);
      skipped++;
      continue;
    }

    // Use the most recent active mandate, or just the most recent
    const mandate = mandates.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ).find((m) => m.status === "active") ?? mandates[0];

    // Check if already in DB
    const [existing] = await conn.execute(
      "SELECT id FROM gc_mandates WHERE mandateId = ? OR userId = ?",
      [mandate.id, agent.id]
    );
    if (existing.length > 0) {
      console.log(`  ✅ ${agent.name} (${email}) — already in DB, skipping`);
      skipped++;
      continue;
    }

    // Insert mandate
    await conn.execute(
      `INSERT INTO gc_mandates (userId, billingRequestId, mandateId, status, preferredPaymentDay, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        agent.id,
        null, // no billing request for pre-existing mandates
        mandate.id,
        mandate.status,
        null, // payment day unknown for legacy mandates
      ]
    );
    console.log(`  ✅ ${agent.name} (${email}) — mandate ${mandate.id} (${mandate.status}) inserted`);

    // Insert subscriptions for this mandate
    const subs = subsByMandate.get(mandate.id) ?? [];
    for (const sub of subs) {
      const [existingSub] = await conn.execute(
        "SELECT id FROM gc_subscriptions WHERE subscriptionId = ?",
        [sub.id]
      );
      if (existingSub.length > 0) continue;

      await conn.execute(
        `INSERT INTO gc_subscriptions (userId, mandateId, subscriptionId, status, startDate, amount, nextChargeDate, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          agent.id,
          mandate.id,
          sub.id,
          sub.status,
          sub.start_date ?? null,  // varchar(10) — store as YYYY-MM-DD string
          sub.amount ? Math.round(sub.amount) : null, // GoCardless stores in pence
          sub.upcoming_payments?.[0]?.charge_date ?? null,  // varchar(10)
        ]
      );
      console.log(`     └─ subscription ${sub.id} (${sub.status}, £${(sub.amount / 100).toFixed(2)}/month) inserted`);
    }

    matched++;
  }

  await conn.end();

  console.log("\n📊 Summary:");
  console.log(`   ✅ Matched and backfilled: ${matched} agents`);
  console.log(`   ⏭️  Skipped (already in DB or no mandates): ${skipped}`);
  console.log(`   ❌ No GoCardless record found: ${noGc} agents`);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
