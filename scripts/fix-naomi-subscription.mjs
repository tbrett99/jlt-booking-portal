/**
 * One-off fix: create GoCardless subscription for Mrs Naomi Claire Gibson (naomigib@sky.com)
 * whose mandate MD01KRHBNZQJEHWXZCA38MFVX7RR is active but subscription creation failed
 * with 422 scheme_doesnt_support_functionality (Faster Payments mandate — no day_of_month allowed).
 *
 * Run with:
 *   env $(cat /proc/$(pgrep -f "tsx watch server" | head -1)/environ | tr '\0' '\n' | grep -E 'DATABASE_URL|GOCARDLESS') node scripts/fix-naomi-subscription.mjs
 */

import mysql from "mysql2/promise";
import https from "https";

const MANDATE_ID = "MD01KRHBNZQJEHWXZCA38MFVX7RR";
const USER_ID = 8079651;
const MONTHLY_AMOUNT_PENCE = 3000; // £30 business_class solo
const GC_TOKEN = process.env.GOCARDLESS_ACCESS_TOKEN;
const GC_ENV = process.env.GOCARDLESS_ENVIRONMENT ?? "live";
const GC_BASE = GC_ENV === "sandbox" ? "https://api-sandbox.gocardless.com" : "https://api.gocardless.com";

if (!GC_TOKEN) {
  console.error("GOCARDLESS_ACCESS_TOKEN not set");
  process.exit(1);
}

async function gcRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const url = new URL(GC_BASE + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method,
      headers: {
        "Authorization": `Bearer ${GC_TOKEN}`,
        "GoCardless-Version": "2015-07-06",
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => raw += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 400) {
            reject(new Error(`GoCardless API error ${res.statusCode}: ${JSON.stringify(parsed)}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${raw}`));
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// Parse DATABASE_URL and strip SSL JSON param
const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) { console.error("DATABASE_URL not set"); process.exit(1); }
const urlObj = new URL(rawUrl);
const cleanUrl = `mysql://${urlObj.username}:${urlObj.password}@${urlObj.hostname}:${urlObj.port}${urlObj.pathname}`;

const pool = await mysql.createPool({
  uri: cleanUrl,
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 2,
});

try {
  // 1. Fetch the live mandate to get next_possible_charge_date and confirm scheme
  console.log("Fetching mandate from GoCardless...");
  const mandateRes = await gcRequest("GET", `/mandates/${MANDATE_ID}`);
  const mandate = mandateRes.mandates;
  console.log(`Mandate scheme: ${mandate.scheme}, status: ${mandate.status}, next_possible_charge_date: ${mandate.next_possible_charge_date}`);

  if (mandate.scheme !== "faster_payments") {
    console.warn("WARNING: mandate scheme is not faster_payments — you may be able to use day_of_month");
  }

  // 2. Create the subscription (no day_of_month for Faster Payments)
  const startDate = mandate.next_possible_charge_date ?? new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10);
  console.log(`Creating subscription with startDate: ${startDate}, amount: £${MONTHLY_AMOUNT_PENCE / 100}`);

  const subRes = await gcRequest("POST", "/subscriptions", {
    subscriptions: {
      amount: MONTHLY_AMOUNT_PENCE,
      currency: "GBP",
      name: "JLT Monthly Membership",
      interval_unit: "monthly",
      interval: 1,
      start_date: startDate,
      links: { mandate: MANDATE_ID },
      // No day_of_month — not supported for Faster Payments mandates
    },
  });
  const sub = subRes.subscriptions;
  console.log(`Subscription created: ${sub.id}, status: ${sub.status}, start_date: ${sub.start_date}`);
  console.log(`Upcoming payments:`, sub.upcoming_payments);

  // 3. Store subscription in DB
  const nextChargeDate = sub.upcoming_payments?.[0]?.charge_date ?? null;
  await pool.execute(
    `INSERT INTO gc_subscriptions (userId, mandateId, subscriptionId, amount, startDate, nextChargeDate, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())
     ON DUPLICATE KEY UPDATE status='active', updatedAt=NOW()`,
    [USER_ID, MANDATE_ID, sub.id, sub.amount, sub.start_date ?? startDate, nextChargeDate]
  );
  console.log(`Subscription row inserted for user ${USER_ID}`);

  // 4. Verify
  const [rows] = await pool.execute("SELECT * FROM gc_subscriptions WHERE userId = ?", [USER_ID]);
  console.log("DB subscription row:", rows[0]);

  console.log("\n✅ Done — Naomi's subscription is now active.");
} catch (err) {
  console.error("Error:", err.message);
} finally {
  await pool.end();
}
