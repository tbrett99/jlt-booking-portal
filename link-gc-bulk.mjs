import mysql from 'mysql2/promise';

const DB_URL = process.env.DATABASE_URL;
const GC_TOKEN = process.env.GOCARDLESS_ACCESS_TOKEN;

const agents = [
  { email: 'kelly@arewethereyettravel.co.uk', subId: 'SB01KTBY2KQYKE9VAY4J7FR73QC5' },
  { email: 'asad@oaktravelco.com',            subId: 'SB01KVJANNTWKMQ3EP0QQM5DT3Y4' },
  { email: 'bookings@escapeintotheblue.co.uk',subId: 'SB01KANG7A0N43' },
  { email: 'dave.t1001@googlemail.com',        subId: 'SB01KPZNMRQACYG3A4A35XQZ0M92' },
  { email: 'helena.coupland@gmail.com',        subId: 'SB01KTBRYFDSCWXNK6C8MPXT7AC7' },
  { email: 'jon.purehorizonstravel@outlook.com', subId: 'SB01KRB4EGZ66ERQFYT7FSBEQ3C8' },
  { email: 'twinnytravelsstephanie@thejltgroup.co.uk', subId: 'SB01KT9TW12P5M0N9133TZBYX4XC' },
  { email: 'thom@parksandwaves.com',           subId: 'SB01KATYHMXKQT' },
];

async function gcGet(path) {
  const res = await fetch(`https://api.gocardless.com${path}`, {
    headers: { Authorization: `Bearer ${GC_TOKEN}`, 'GoCardless-Version': '2015-07-06' }
  });
  if (!res.ok) throw new Error(`GC ${path} → ${res.status}`);
  return res.json();
}

async function upsertMandate(db, userId, mandateId, status) {
  const [ex] = await db.execute('SELECT id FROM gc_mandates WHERE userId = ?', [userId]);
  if (ex.length) {
    await db.execute('UPDATE gc_mandates SET mandateId=?, status=? WHERE userId=?', [mandateId, status, userId]);
    return 'updated';
  } else {
    await db.execute('INSERT INTO gc_mandates (userId, mandateId, status) VALUES (?,?,?)', [userId, mandateId, status]);
    return 'inserted';
  }
}

async function upsertSubscription(db, userId, sub, mandateId, startDate) {
  const [ex] = await db.execute('SELECT id FROM gc_subscriptions WHERE userId = ?', [userId]);
  if (ex.length) {
    await db.execute(
      'UPDATE gc_subscriptions SET subscriptionId=?, status=?, mandateId=?, amount=?, currency=?, startDate=? WHERE userId=?',
      [sub.id, sub.status, mandateId, sub.amount, sub.currency, startDate, userId]
    );
    return 'updated';
  } else {
    await db.execute(
      'INSERT INTO gc_subscriptions (userId, subscriptionId, status, mandateId, amount, currency, startDate) VALUES (?,?,?,?,?,?,?)',
      [userId, sub.id, sub.status, mandateId, sub.amount, sub.currency, startDate]
    );
    return 'inserted';
  }
}

const db = await mysql.createConnection(DB_URL);

for (const agent of agents) {
  try {
    const [users] = await db.execute('SELECT id, name FROM users WHERE email = ? LIMIT 1', [agent.email]);
    if (!users.length) { console.log(`NOT FOUND: ${agent.email}`); continue; }
    const user = users[0];

    const subData = await gcGet(`/subscriptions/${agent.subId}`);
    const sub = subData.subscriptions;
    const mandateId = sub.links?.mandate ?? null;
    const startDate = sub.start_date ?? new Date().toISOString().split('T')[0];

    let mandateStatus = null;
    if (mandateId) {
      const mData = await gcGet(`/mandates/${mandateId}`);
      mandateStatus = mData.mandates?.status ?? null;
    }

    const mAction = mandateId ? await upsertMandate(db, user.id, mandateId, mandateStatus) : 'skipped (no mandate)';
    const sAction = await upsertSubscription(db, user.id, sub, mandateId, startDate);

    console.log(`✓ ${user.name} (${agent.email}) — mandate ${mAction} [${mandateId} ${mandateStatus}] | sub ${sAction} [${sub.id} ${sub.status}]`);
  } catch (err) {
    console.error(`✗ ${agent.email}: ${err.message}`);
  }
}

await db.end();
console.log('\nDone.');
