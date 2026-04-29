/**
 * Check GoCardless payments for a specific subscription/mandate
 * and check total payment history across all subscriptions
 */

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

// Peter Stamford's subscription
const subId = 'SB01KA4TPCKDMJ';
const mandateId = 'MD01KMYP2SW7FK';

console.log(`Fetching payments for subscription ${subId}...`);
const payments = await gcGetAll('payments', `&subscription=${subId}`);
console.log(`Payments for Peter Stamford's subscription: ${payments.length}`);
for (const p of payments) {
  console.log(`  ${p.id} [${p.status}] £${(p.amount/100).toFixed(2)} charge_date=${p.charge_date} created=${p.created_at}`);
}

// Also check mandate-level payments
console.log(`\nFetching payments for mandate ${mandateId}...`);
const mandatePayments = await gcGetAll('payments', `&mandate=${mandateId}`);
console.log(`Payments for Peter Stamford's mandate: ${mandatePayments.length}`);
for (const p of mandatePayments) {
  console.log(`  ${p.id} [${p.status}] £${(p.amount/100).toFixed(2)} charge_date=${p.charge_date} created=${p.created_at}`);
}

// Check total payments across all subscriptions in the system
console.log('\nFetching ALL payments from GoCardless...');
const allPayments = await gcGetAll('payments');
console.log(`Total GoCardless payments: ${allPayments.length}`);
const byStatus = {};
for (const p of allPayments) {
  byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
}
console.log('By status:', JSON.stringify(byStatus));
