import mysql from 'mysql2/promise';

const PROD_DB = 'mysql://root:uzArNRvsIOUNMvIOBbGSLCmDXUFvIYHR@maglev.proxy.rlwy.net:38024/railway';
const GC_TOKEN = process.env.GOCARDLESS_ACCESS_TOKEN;
const GC_ENV = process.env.GOCARDLESS_ENVIRONMENT;
const GC_BASE = GC_ENV === 'live' ? 'https://api.gocardless.com' : 'https://api-sandbox.gocardless.com';
const GC_HEADERS = {
  'Authorization': `Bearer ${GC_TOKEN}`,
  'GoCardless-Version': '2015-07-06',
  'Accept': 'application/json',
};

console.log(`GC environment: ${GC_ENV}, base: ${GC_BASE}`);

// Agents to link/update. For Dylan, existing records will be updated to the new subscription.
const AGENTS_TO_LINK = [
  { email: 'bethglazertravel@gmail.com', subscriptionId: 'SB01KT9SK7WBM1YK4H64Z38EZB5S' },
  { email: 'arrowslin@gmail.com', subscriptionId: 'SB01KVG6R29GZ6TH3VD35C5DTSXN', nameHint: 'Linda Arrowsmith' },
  { email: 'iliana@thejltgroup.co.uk', subscriptionId: 'SB01KT1RBNAZGXHWJS1V9S3EB10W', nameHint: 'Iliana Baughan' },
  { email: 'dylan.foster@example.com', subscriptionId: 'SB01KT98T7ZR9QF0HECX0PT4G24B', nameHint: 'Dylan Foster' },
];

const db = await mysql.createConnection(PROD_DB);

for (const agent of AGENTS_TO_LINK) {
  console.log(`\n--- Processing ${agent.email} ---`);

  // Find user by email
  const [users] = await db.execute('SELECT id, name, email FROM users WHERE email = ?', [agent.email]);
  let user = users[0];

  // If not found by email, try searching by name
  if (!user && agent.nameHint) {
    const [byName] = await db.execute('SELECT id, name, email FROM users WHERE name LIKE ?', [`%${agent.nameHint}%`]);
    if (byName.length) { user = byName[0]; console.log(`Found by name: ${user.name} (${user.email})`); }
  }

  if (!user) { console.log(`NOT FOUND in users for ${agent.email}`); continue; }
  console.log(`User: id=${user.id} name=${user.name} email=${user.email}`);

  // Fetch subscription from GC
  const subRes = await fetch(`${GC_BASE}/subscriptions/${agent.subscriptionId}`, { headers: GC_HEADERS });
  const subData = await subRes.json();
  const sub = subData.subscriptions;
  if (!sub) { console.log(`Subscription ${agent.subscriptionId} not found in GC:`, JSON.stringify(subData)); continue; }
  console.log(`Sub: status=${sub.status} amount=${sub.amount} mandate=${sub.links?.mandate}`);

  const mandateId = sub.links?.mandate;

  // Fetch mandate
  const mandRes = await fetch(`${GC_BASE}/mandates/${mandateId}`, { headers: GC_HEADERS });
  const mandData = await mandRes.json();
  const mandate = mandData.mandates;
  console.log(`Mandate: id=${mandateId} status=${mandate?.status}`);

  // Upsert mandate — check by mandateId first, then by userId
  const [existMandByMandateId] = await db.execute('SELECT id, userId FROM gc_mandates WHERE mandateId = ?', [mandateId]);
  const [existMandByUserId] = await db.execute('SELECT id, userId, mandateId FROM gc_mandates WHERE userId = ?', [user.id]);

  if (existMandByMandateId.length > 0) {
    // Mandate already exists — update userId if needed
    const row = existMandByMandateId[0];
    if (row.userId !== user.id) {
      await db.execute('UPDATE gc_mandates SET userId = ?, status = ?, updatedAt = NOW() WHERE mandateId = ?', [user.id, mandate.status, mandateId]);
      console.log(`Mandate updated userId ${row.userId} -> ${user.id}`);
    } else {
      await db.execute('UPDATE gc_mandates SET status = ?, updatedAt = NOW() WHERE mandateId = ?', [mandate.status, mandateId]);
      console.log(`Mandate status refreshed`);
    }
  } else if (existMandByUserId.length > 0) {
    // User has an old mandate — update it to the new mandateId
    const row = existMandByUserId[0];
    await db.execute('UPDATE gc_mandates SET mandateId = ?, status = ?, updatedAt = NOW() WHERE id = ?', [mandateId, mandate.status, row.id]);
    console.log(`Mandate record updated from ${row.mandateId} -> ${mandateId}`);
  } else {
    await db.execute(
      'INSERT INTO gc_mandates (userId, mandateId, status, createdAt, updatedAt) VALUES (?, ?, ?, NOW(), NOW())',
      [user.id, mandateId, mandate.status]
    );
    console.log('Mandate inserted');
  }

  // Upsert subscription — check by subscriptionId first, then by userId
  const [existSubBySubId] = await db.execute('SELECT id, userId FROM gc_subscriptions WHERE subscriptionId = ?', [agent.subscriptionId]);
  const [existSubByUserId] = await db.execute('SELECT id, userId, subscriptionId FROM gc_subscriptions WHERE userId = ?', [user.id]);
  const nextCharge = sub.upcoming_payments?.[0]?.charge_date ?? null;

  if (existSubBySubId.length > 0) {
    const row = existSubBySubId[0];
    await db.execute(
      'UPDATE gc_subscriptions SET userId = ?, mandateId = ?, status = ?, amount = ?, nextChargeDate = ?, updatedAt = NOW() WHERE subscriptionId = ?',
      [user.id, mandateId, sub.status, sub.amount, nextCharge, agent.subscriptionId]
    );
    console.log(`Subscription updated (userId was ${row.userId}, now ${user.id})`);
  } else if (existSubByUserId.length > 0) {
    // User has an old subscription record — update it to the new subscriptionId
    const row = existSubByUserId[0];
    await db.execute(
      'UPDATE gc_subscriptions SET mandateId = ?, subscriptionId = ?, status = ?, amount = ?, nextChargeDate = ?, updatedAt = NOW() WHERE id = ?',
      [mandateId, agent.subscriptionId, sub.status, sub.amount, nextCharge, row.id]
    );
    console.log(`Subscription record updated from ${row.subscriptionId} -> ${agent.subscriptionId}`);
  } else {
    await db.execute(
      'INSERT INTO gc_subscriptions (userId, mandateId, subscriptionId, status, amount, currency, startDate, dayOfMonth, nextChargeDate, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [user.id, mandateId, agent.subscriptionId, sub.status, sub.amount, sub.currency ?? 'GBP', sub.start_date ?? new Date().toISOString().slice(0, 10), sub.day_of_month ?? null, nextCharge]
    );
    console.log('Subscription inserted');
  }

  console.log(`✓ ${user.name} linked successfully`);
}

await db.end();
console.log('\nAll done.');
