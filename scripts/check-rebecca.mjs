import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Search broadly for Rebecca
const [users] = await conn.execute(`
  SELECT u.id, u.name, u.email, u.portalStatus, u.createdAt
  FROM users u
  WHERE u.name LIKE '%Rebecca%' OR u.email LIKE '%ransom%' OR u.email LIKE '%becky%' OR u.email LIKE '%rebecca%'
  ORDER BY u.createdAt DESC
  LIMIT 10
`);
console.log('=== USERS ===');
console.log(JSON.stringify(users, null, 2));

if (users.length > 0) {
  const userId = users[0].id;
  const [mandates] = await conn.execute(`SELECT * FROM gc_mandates WHERE userId = ?`, [userId]);
  console.log('\n=== MANDATES ===');
  console.log(JSON.stringify(mandates, null, 2));

  if (mandates.length > 0) {
    const mandateId = mandates[0].mandateId;
    const [subs] = await conn.execute(`SELECT * FROM gc_subscriptions WHERE mandateId = ?`, [mandateId]);
    console.log('\n=== SUBSCRIPTIONS ===');
    console.log(JSON.stringify(subs, null, 2));
  }
}

// Also check join_sessions
const [sessions] = await conn.execute(`
  SELECT * FROM join_sessions 
  WHERE email LIKE '%ransom%' OR email LIKE '%becky%' OR email LIKE '%rebecca%'
  ORDER BY createdAt DESC LIMIT 5
`);
console.log('\n=== JOIN SESSIONS ===');
console.log(JSON.stringify(sessions, null, 2));

await conn.end();
process.exit(0);
