/**
 * GoCardless back-fill script
 * 
 * 1. Fetches all mandates from GoCardless API
 * 2. For each mandate, tries to match to a user by email (via GC customer)
 * 3. If matched and no local gc_mandates row exists, creates one
 * 4. Fetches subscriptions linked to each mandate and creates gc_subscriptions rows
 */

import mysql from 'mysql2/promise';

const GC_BASE = process.env.GOCARDLESS_ENVIRONMENT === 'live'
  ? 'https://api.gocardless.com'
  : 'https://api.gocardless.com';

const GC_TOKEN = process.env.GOCARDLESS_ACCESS_TOKEN;
if (!GC_TOKEN) { console.error('GOCARDLESS_ACCESS_TOKEN not set'); process.exit(1); }

const GC_HEADERS = {
  Authorization: `Bearer ${GC_TOKEN}`,
  'GoCardless-Version': '2015-07-06',
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

async function gcGet(path) {
  const res = await fetch(`${GC_BASE}${path}`, { headers: GC_HEADERS });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GC API ${res.status} ${path}: ${txt}`);
  }
  return res.json();
}

async function gcGetAll(resource, params = '') {
  const items = [];
  let after = null;
  do {
    const cursor = after ? `&after=${after}` : '';
    const data = await gcGet(`/${resource}?limit=500${params}${cursor}`);
    const list = data[resource] ?? [];
    items.push(...list);
    after = data.meta?.cursors?.after ?? null;
  } while (after);
  return items;
}

const dbUrl = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: dbUrl.hostname,
  port: parseInt(dbUrl.port || '3306'),
  user: dbUrl.username,
  password: dbUrl.password,
  database: dbUrl.pathname.slice(1),
  ssl: { rejectUnauthorized: false },
});

console.log('Connected to DB');

// Load all existing gc_mandates and gc_subscriptions
const [existingMandates] = await conn.execute('SELECT id, userId, mandateId, billingRequestId, status FROM gc_mandates');
const existingMandateIds = new Set(existingMandates.map(m => m.mandateId).filter(Boolean));
const existingUserIds = new Set(existingMandates.map(m => m.userId).filter(Boolean));
console.log(`Existing mandate rows: ${existingMandates.length} (${existingMandateIds.size} with GC mandate IDs)`);

const [existingSubs] = await conn.execute('SELECT id, userId, mandateId, subscriptionId, status FROM gc_subscriptions');
const existingSubMandateIds = new Set(existingSubs.map(s => s.mandateId).filter(Boolean));
console.log(`Existing subscription rows: ${existingSubs.length}`);

// Fetch all mandates from GoCardless
console.log('\nFetching all mandates from GoCardless...');
const gcMandates = await gcGetAll('mandates');
console.log(`GoCardless mandates: ${gcMandates.length}`);

// Fetch all customers from GoCardless (to match by email)
console.log('Fetching all customers from GoCardless...');
const gcCustomers = await gcGetAll('customers');
console.log(`GoCardless customers: ${gcCustomers.length}`);
const customerMap = new Map(gcCustomers.map(c => [c.id, c]));

// Load all users from DB for email matching
const [dbUsers] = await conn.execute('SELECT id, email, name FROM users WHERE role = ?', ['agent']);
const emailToUserId = new Map(dbUsers.map(u => [u.email?.toLowerCase(), u.id]));
console.log(`DB users: ${dbUsers.length}`);

let created = 0, skipped = 0, noMatch = 0;
const noMatchList = [];

for (const mandate of gcMandates) {
  // Skip if we already have this mandate ID
  if (existingMandateIds.has(mandate.id)) {
    skipped++;
    continue;
  }

  // Try to find the user by looking up the customer
  const customerId = mandate.links?.customer;
  const customer = customerId ? customerMap.get(customerId) : null;
  const email = customer?.email?.toLowerCase();
  const userId = email ? emailToUserId.get(email) : null;

  if (!userId) {
    noMatch++;
    noMatchList.push({ mandateId: mandate.id, email: email ?? '(no email)', status: mandate.status });
    continue;
  }

  // Skip if user already has a mandate row (might have been created without a GC mandate ID)
  if (existingUserIds.has(userId)) {
    // Update the existing row with the real mandate ID if it's missing
    const existing = existingMandates.find(m => m.userId === userId);
    if (existing && !existing.mandateId) {
      await conn.execute(
        'UPDATE gc_mandates SET mandateId = ?, status = ? WHERE id = ?',
        [mandate.id, mandate.status, existing.id]
      );
      console.log(`  Updated mandate row for user ${userId} with mandate ID ${mandate.id}`);
    } else {
      skipped++;
    }
    continue;
  }

  // Create a new gc_mandates row
  const joiningFeePaidAt = mandate.created_at ? new Date(mandate.created_at) : new Date();
  await conn.execute(
    `INSERT INTO gc_mandates (userId, mandateId, billingRequestId, billingRequestFlowId, preferredPaymentDay, status, joiningFeePaidAt, createdAt, updatedAt)
     VALUES (?, ?, NULL, NULL, 1, ?, ?, NOW(), NOW())`,
    [userId, mandate.id, mandate.status, joiningFeePaidAt]
  );
  existingUserIds.add(userId);
  existingMandateIds.add(mandate.id);
  created++;
  console.log(`  Created mandate row for user ${userId} (${email}) — mandate ${mandate.id} [${mandate.status}]`);
}

console.log(`\nMandates: created=${created}, skipped=${skipped}, no-match=${noMatch}`);

// Now back-fill subscriptions
console.log('\nFetching all subscriptions from GoCardless...');
const gcSubscriptions = await gcGetAll('subscriptions');
console.log(`GoCardless subscriptions: ${gcSubscriptions.length}`);

let subCreated = 0, subSkipped = 0, subNoMandate = 0;

for (const sub of gcSubscriptions) {
  // Skip if we already have this subscription
  if (existingSubMandateIds.has(sub.links?.mandate)) {
    subSkipped++;
    continue;
  }

  const mandateId = sub.links?.mandate;
  if (!mandateId) { subNoMandate++; continue; }

  // Find the local mandate row
  const [mandateRows] = await conn.execute('SELECT id, userId FROM gc_mandates WHERE mandateId = ?', [mandateId]);
  const localMandate = mandateRows[0];
  if (!localMandate) {
    subNoMandate++;
    continue;
  }

  const nextCharge = sub.upcoming_payments?.[0]?.charge_date ?? null;
  await conn.execute(
    `INSERT INTO gc_subscriptions (userId, mandateId, subscriptionId, amount, currency, startDate, dayOfMonth, nextChargeDate, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 'GBP', ?, ?, ?, ?, NOW(), NOW())`,
    [localMandate.userId, mandateId, sub.id, sub.amount, sub.start_date, sub.day_of_month ?? 1, nextCharge, sub.status]
  );
  existingSubMandateIds.add(mandateId);
  subCreated++;
  console.log(`  Created subscription row for user ${localMandate.userId} — sub ${sub.id} [${sub.status}]`);
}

console.log(`\nSubscriptions: created=${subCreated}, skipped=${subSkipped}, no-mandate=${subNoMandate}`);

if (noMatchList.length > 0) {
  console.log('\nMandates with no matching user (by email):');
  for (const m of noMatchList) {
    console.log(`  ${m.mandateId} [${m.status}] — ${m.email}`);
  }
}

await conn.end();
console.log('\nDone.');
