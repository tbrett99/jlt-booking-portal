import mysql from 'mysql2/promise';

const conn = await mysql.createConnection('mysql://root:uzArNRvsIOUNMvIOBbGSLCmDXUFvIYHR@maglev.proxy.rlwy.net:38024/railway');

const email = 'cristinaruizcasalis@icloud.com';
const prospectId = 1440368;

// Find prospect_contracts by prospectId (correct column name)
const [pc] = await conn.execute('SELECT * FROM prospect_contracts WHERE prospectId = ? ORDER BY createdAt DESC LIMIT 5', [prospectId]);
console.log('PROSPECT_CONTRACTS:', JSON.stringify(pc, null, 2));

// Find join_sessions by email
const [js] = await conn.execute('SELECT * FROM join_sessions WHERE email = ? ORDER BY createdAt DESC LIMIT 5', [email]);
console.log('JOIN_SESSIONS:', JSON.stringify(js, null, 2));

// Check recruitment_stage_history columns
const [cols] = await conn.execute('DESCRIBE recruitment_stage_history');
console.log('RECRUITMENT_STAGE_HISTORY COLUMNS:', cols.map(c => c.Field).join(', '));

// Check prospect_contracts columns again
const [cols2] = await conn.execute('DESCRIBE prospect_contracts');
console.log('PROSPECT_CONTRACTS COLUMNS:', cols2.map(c => c.Field).join(', '));

await conn.end();
