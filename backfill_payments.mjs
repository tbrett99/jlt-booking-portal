/**
 * Back-fill all GoCardless payments into gc_payment_events
 */

import mysql from 'mysql2/promise';

const GC_BASE = 'https://api.gocardless.com';
const GC_TOKEN = process.env.GOCARDLESS_ACCESS_TOKEN;
const GC_HEADERS = {
  Authorization: `Bearer ${GC_TOKEN}`,
  'GoCardless-Version': '2015-07-06',
  Accept: 'application/json',
};

async function gcGet(path) {
  const res = await fetch(`${GC_BASE}${path}`, { headers: GC_HEADERS });
  if (!res.ok) throw new Error(`GC API ${res.status} ${path}: ${await res.text()}`);
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

// Load existing payment event IDs to avoid duplicates
const [existingEvents] = await conn.execute('SELECT paymentId FROM gc_payment_events WHERE paymentId IS NOT NULL');
const existingPaymentIds = new Set(existingEvents.map(e => e.paymentId));
console.log(`Existing payment events: ${existingPaymentIds.size}`);

// Load mandate → userId mapping
const [mandateRows] = await conn.execute('SELECT mandateId, userId FROM gc_mandates WHERE mandateId IS NOT NULL');
const mandateToUser = new Map(mandateRows.map(m => [m.mandateId, m.userId]));
console.log(`Mandate → user mappings: ${mandateToUser.size}`);

// Fetch all payments from GoCardless
console.log('\nFetching all payments from GoCardless...');
const allPayments = await gcGetAll('payments');
console.log(`Total GoCardless payments: ${allPayments.length}`);

let created = 0, skipped = 0, noUser = 0;

for (const payment of allPayments) {
  if (existingPaymentIds.has(payment.id)) {
    skipped++;
    continue;
  }

  const mandateId = payment.links?.mandate;
  const userId = mandateId ? mandateToUser.get(mandateId) : null;

  if (!userId) {
    noUser++;
    console.log(`  No user for payment ${payment.id} [${payment.status}] mandate=${mandateId ?? 'none'}`);
    continue;
  }

  // Map GC status to our event type
  const eventType = `payments_${payment.status}`;
  const occurredAt = payment.created_at ? new Date(payment.created_at) : new Date();

  await conn.execute(
    `INSERT INTO gc_payment_events 
     (userId, mandateId, paymentId, eventType, status, amount, currency, failureReason, failureDescription, occurredAt, rawPayload, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      userId,
      mandateId ?? null,
      payment.id,
      eventType,
      payment.status,
      payment.amount ?? null,
      payment.currency ?? 'GBP',
      null, // failureReason
      null, // failureDescription
      occurredAt,
      JSON.stringify(payment),
    ]
  );

  existingPaymentIds.add(payment.id);
  created++;
  console.log(`  Created: ${payment.id} [${payment.status}] £${((payment.amount ?? 0)/100).toFixed(2)} charge_date=${payment.charge_date} user=${userId}`);
}

console.log(`\nPayments: created=${created}, skipped=${skipped}, no-user=${noUser}`);

// Verify Peter Stamford
const [peterEvents] = await conn.execute(
  'SELECT paymentId, status, amount, chargeDate FROM gc_payment_events WHERE userId = 60185 ORDER BY occurredAt DESC'
);
console.log('\nPeter Stamford payment events after back-fill:', JSON.stringify(peterEvents));

await conn.end();
console.log('Done.');
