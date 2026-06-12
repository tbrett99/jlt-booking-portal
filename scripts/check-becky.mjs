import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [users] = await conn.execute(
  `SELECT id, name, email, portalStatus, createdAt FROM users WHERE email = ?`,
  ['becky@thestevensfamily.co.uk']
);
console.log('=== USER ===');
console.log(JSON.stringify(users, null, 2));

if (users.length > 0) {
  const userId = users[0].id;

  const [mandates] = await conn.execute(
    `SELECT * FROM gc_mandates WHERE userId = ? ORDER BY createdAt DESC`,
    [userId]
  );
  console.log('\n=== MANDATES ===');
  console.log(JSON.stringify(mandates, null, 2));

  const [subs] = await conn.execute(
    `SELECT * FROM gc_subscriptions WHERE userId = ? ORDER BY createdAt DESC`,
    [userId]
  );
  console.log('\n=== SUBSCRIPTIONS ===');
  console.log(JSON.stringify(subs, null, 2));

  const [events] = await conn.execute(
    `SELECT * FROM gc_payment_events WHERE userId = ? ORDER BY createdAt DESC LIMIT 10`,
    [userId]
  );
  console.log('\n=== PAYMENT EVENTS ===');
  console.log(JSON.stringify(events, null, 2));

  const [crm] = await conn.execute(
    `SELECT id, uniqueAgentId, agentStatus, trainingStage, membershipTier FROM agent_crm_profiles WHERE userId = ?`,
    [userId]
  );
  console.log('\n=== CRM PROFILE ===');
  console.log(JSON.stringify(crm, null, 2));
}

await conn.end();
process.exit(0);
