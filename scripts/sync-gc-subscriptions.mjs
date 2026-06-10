/**
 * Sync GoCardless subscription data into the portal DB.
 * - Fetches all subscriptions from GC API (paginated)
 * - Matches them to portal users via gc_mandates table
 * - Updates gc_subscriptions table with latest status/amount/interval
 * - Reports any active subscriptions not linked to a user
 */
import { createConnection } from 'mysql2/promise';

const GC_TOKEN = process.env.GOCARDLESS_ACCESS_TOKEN;
const GC_ENV = (process.env.GOCARDLESS_ENVIRONMENT || 'live').toUpperCase();
const GC_BASE = GC_ENV === 'LIVE'
  ? 'https://api.gocardless.com'
  : 'https://api-sandbox.gocardless.com';

const DB_URL = process.env.DATABASE_URL;

async function gcGet(path) {
  const res = await fetch(`${GC_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${GC_TOKEN}`,
      'GoCardless-Version': '2015-07-06',
      'Accept': 'application/json',
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GC API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function fetchAllSubscriptions() {
  const all = [];
  let after = null;
  let page = 1;
  while (true) {
    const qs = after ? `?after=${after}&limit=200` : '?limit=200';
    const data = await gcGet(`/subscriptions${qs}`);
    all.push(...data.subscriptions);
    console.log(`  Page ${page}: fetched ${data.subscriptions.length} subscriptions (total so far: ${all.length})`);
    if (data.meta?.cursors?.after) {
      after = data.meta.cursors.after;
      page++;
    } else {
      break;
    }
  }
  return all;
}

async function fetchAllMandates() {
  const all = [];
  let after = null;
  let page = 1;
  while (true) {
    const qs = after ? `?after=${after}&limit=200` : '?limit=200';
    const data = await gcGet(`/mandates${qs}`);
    all.push(...data.mandates);
    if (data.meta?.cursors?.after) {
      after = data.meta.cursors.after;
      page++;
    } else {
      break;
    }
  }
  return all;
}

const conn = await createConnection(DB_URL);

console.log('=== GoCardless Subscription Sync ===');
console.log(`Environment: ${GC_ENV}`);
console.log('');

// Fetch all subscriptions from GC
console.log('Fetching subscriptions from GoCardless...');
const gcSubscriptions = await fetchAllSubscriptions();
console.log(`Total subscriptions in GC: ${gcSubscriptions.length}`);

// Get status breakdown
const statusCounts = {};
for (const s of gcSubscriptions) {
  statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
}
console.log('Status breakdown:', statusCounts);
console.log('');

// Get all portal gc_mandates (mandateId -> userId)
const [mandateRows] = await conn.execute(
  'SELECT id, userId, mandateId, status FROM gc_mandates'
);
const mandateMap = {}; // mandateId -> { id, userId, status }
for (const m of mandateRows) {
  mandateMap[m.mandateId] = m;
}
console.log(`Portal mandates on record: ${mandateRows.length}`);

// Get existing gc_subscriptions in portal DB
const [existingSubs] = await conn.execute(
  'SELECT id, subscriptionId, userId, mandateId, status, amount, `interval`, intervalUnit, name, createdAt, updatedAt FROM gc_subscriptions'
);
const existingSubMap = {}; // subscriptionId -> row
for (const s of existingSubs) {
  existingSubMap[s.subscriptionId] = s;
}
console.log(`Portal subscriptions on record: ${existingSubs.length}`);
console.log('');

// Process each GC subscription
let created = 0;
let updated = 0;
let skipped = 0;
let noMandate = 0;
const activeUnlinked = [];

for (const gcSub of gcSubscriptions) {
  const mandateId = gcSub.links?.mandate;
  const portalMandate = mandateMap[mandateId];

  if (!portalMandate) {
    if (gcSub.status === 'active') {
      activeUnlinked.push({ id: gcSub.id, mandateId, name: gcSub.name, amount: gcSub.amount });
    }
    noMandate++;
    continue;
  }

  const userId = portalMandate.userId;
  const existing = existingSubMap[gcSub.id];

  const amount = gcSub.amount; // in pence
  const interval = gcSub.interval;
  const intervalUnit = gcSub.interval_unit;
  const status = gcSub.status;
  const name = gcSub.name || null;
  const now = Date.now();

  if (!existing) {
    // Insert new subscription record
    await conn.execute(
      `INSERT INTO gc_subscriptions 
       (subscriptionId, userId, mandateId, status, amount, \`interval\`, intervalUnit, name, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [gcSub.id, userId, portalMandate.id, status, amount, interval, intervalUnit, name, now, now]
    );
    created++;
  } else if (existing.status !== status || existing.amount !== amount) {
    // Update changed fields
    await conn.execute(
      `UPDATE gc_subscriptions SET status=?, amount=?, \`interval\`=?, intervalUnit=?, name=?, updatedAt=? WHERE id=?`,
      [status, amount, interval, intervalUnit, name, now, existing.id]
    );
    updated++;
  } else {
    skipped++;
  }
}

// Also update mandate statuses from GC
console.log('Fetching mandate statuses from GoCardless...');
const gcMandates = await fetchAllMandates();
let mandatesUpdated = 0;
for (const gcM of gcMandates) {
  const portalMandate = mandateMap[gcM.id];
  if (portalMandate && portalMandate.status !== gcM.status) {
    await conn.execute(
      'UPDATE gc_mandates SET status=?, updatedAt=? WHERE id=?',
      [gcM.status, Date.now(), portalMandate.id]
    );
    mandatesUpdated++;
  }
}

console.log('=== SYNC RESULTS ===');
console.log(`Subscriptions created: ${created}`);
console.log(`Subscriptions updated: ${updated}`);
console.log(`Subscriptions unchanged: ${skipped}`);
console.log(`GC subscriptions with no portal mandate: ${noMandate}`);
console.log(`Mandates updated: ${mandatesUpdated}`);
console.log('');

if (activeUnlinked.length > 0) {
  console.log(`WARNING: ${activeUnlinked.length} active GC subscriptions have no matching portal mandate:`);
  for (const s of activeUnlinked) {
    console.log(`  ${s.id} | mandate: ${s.mandateId} | ${s.name} | £${(s.amount/100).toFixed(2)}/mo`);
  }
}

// Final summary: portal users with active subscriptions
const [activeSubs] = await conn.execute(`
  SELECT u.id, u.firstName, u.lastName, u.email, gs.subscriptionId, gs.status, gs.amount, gs.intervalUnit
  FROM gc_subscriptions gs
  JOIN users u ON gs.userId = u.id
  WHERE gs.status = 'active'
  ORDER BY u.lastName, u.firstName
`);

console.log('');
console.log(`=== ACTIVE SUBSCRIPTIONS IN PORTAL: ${activeSubs.length} ===`);
for (const s of activeSubs) {
  console.log(`  ${s.firstName} ${s.lastName} <${s.email}> | £${(s.amount/100).toFixed(2)}/${s.intervalUnit} | ${s.subscriptionId}`);
}

await conn.end();
process.exit(0);
