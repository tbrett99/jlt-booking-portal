import mysql from 'mysql2/promise';
const conn = await mysql.createConnection({
  host: 'gateway03.us-east-1.prod.aws.tidbcloud.com',
  port: 4000,
  user: '4PycK9Y631tLhJa.0110aa12e67a',
  password: 'mz7ohC31nEYeW9i0Jp6x',
  database: 'PdcDVQRp8zC2FzsyWBWptW',
  ssl: { rejectUnauthorized: true },
});

// Users columns
const [uc] = await conn.execute(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_NAME='users' AND TABLE_SCHEMA=DATABASE() ORDER BY ORDINAL_POSITION`);
console.log('Users cols:', uc.map(c=>c.COLUMN_NAME).join(', '));

// Claire
const [claire] = await conn.execute(`SELECT id, name, email FROM users WHERE name LIKE '%Claire%' OR email LIKE '%claire%' LIMIT 3`);
console.log('\n=== CLAIRE ==='); console.table(claire);
if (claire[0]) {
  const {id, email} = claire[0];
  const [inv] = await conn.execute(`SELECT id, invited_email, leader_id, team_id, status, LEFT(token,20) tok, expires_at, accepted_at, accepted_by_user_id FROM team_invites WHERE invited_email=? ORDER BY created_at DESC LIMIT 5`, [email]);
  console.log('-- Invites --'); console.table(inv);
  const [sess] = await conn.execute(`SELECT id, email, step, status, user_id, team_id, contract_signed_at FROM join_sessions WHERE user_id=? OR email=? ORDER BY created_at DESC LIMIT 5`, [id, email]);
  console.log('-- Sessions --'); console.table(sess);
  const [prof] = await conn.execute(`SELECT user_id, membership_tier, training_stage, team_id, date_joined, unique_agent_id FROM agent_crm_profiles WHERE user_id=?`, [id]);
  console.log('-- CRM --'); console.table(prof);
  const [cs] = await conn.execute(`SELECT id, user_id, signed_at, signer_name FROM contract_signatures WHERE user_id=?`, [id]);
  console.log('-- Contracts --'); console.table(cs);
}

// Joe
const [joe] = await conn.execute(`SELECT id, name, email FROM users WHERE name LIKE '%Westhead%' LIMIT 3`);
console.log('\n=== JOE WESTHEAD ==='); console.table(joe);
if (joe[0]) {
  const {id, email} = joe[0];
  const [sess] = await conn.execute(`SELECT id, email, step, status, user_id, membership_tier, membership_type, contract_signed_at FROM join_sessions WHERE user_id=? OR email=? ORDER BY created_at DESC LIMIT 5`, [id, email]);
  console.log('-- Sessions --'); console.table(sess);
  const [prof] = await conn.execute(`SELECT * FROM agent_crm_profiles WHERE user_id=?`, [id]);
  if (prof[0]) {
    const p = prof[0];
    const nulls = Object.keys(p).filter(k => p[k]===null||p[k]==='');
    const filled = Object.keys(p).filter(k => p[k]!==null&&p[k]!=='').map(k=>`${k}=${p[k]}`);
    console.log('Filled:', filled.join(' | '));
    console.log('NULL/empty:', nulls.join(', '));
  }
}

// Missing data summary
const [miss] = await conn.execute(`SELECT COUNT(*) total, SUM(membership_tier IS NULL) no_tier, SUM(training_stage IS NULL) no_training, SUM(phone IS NULL OR phone='') no_phone, SUM(jlt_email IS NULL OR jlt_email='') no_jlt_email FROM agent_crm_profiles`);
console.log('\n=== MISSING DATA ==='); console.table(miss);

await conn.end();
