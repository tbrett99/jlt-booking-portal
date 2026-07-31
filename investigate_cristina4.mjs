import mysql from 'mysql2/promise';

const conn = await mysql.createConnection('mysql://root:uzArNRvsIOUNMvIOBbGSLCmDXUFvIYHR@maglev.proxy.rlwy.net:38024/railway');

const prospectId = 1440368;

// Check contract_signatures columns
const [cols] = await conn.execute('DESCRIBE contract_signatures');
console.log('CONTRACT_SIGNATURES COLUMNS:', cols.map(c => c.Field).join(', '));

// Check prospect_contracts columns
const [cols2] = await conn.execute('DESCRIBE prospect_contracts');
console.log('PROSPECT_CONTRACTS COLUMNS:', cols2.map(c => c.Field).join(', '));

// Check join_sessions columns
const [cols3] = await conn.execute('DESCRIBE join_sessions');
console.log('JOIN_SESSIONS COLUMNS:', cols3.map(c => c.Field).join(', '));

// Find contract signatures by prospectId
const [cs] = await conn.execute('SELECT * FROM contract_signatures WHERE prospectId = ? ORDER BY createdAt DESC LIMIT 5', [prospectId]);
console.log('CONTRACT_SIGNATURES:', JSON.stringify(cs, null, 2));

// Find prospect_contracts by prospectId
const [pc] = await conn.execute('SELECT * FROM prospect_contracts WHERE prospectId = ? ORDER BY createdAt DESC LIMIT 5', [prospectId]);
console.log('PROSPECT_CONTRACTS:', JSON.stringify(pc, null, 2));

// Find join_sessions by prospectId
const [js] = await conn.execute('SELECT * FROM join_sessions WHERE prospectId = ? ORDER BY createdAt DESC LIMIT 5', [prospectId]);
console.log('JOIN_SESSIONS:', JSON.stringify(js, null, 2));

// Check recruitment_stage_history for this prospect
const [rsh] = await conn.execute('SELECT * FROM recruitment_stage_history WHERE prospectId = ? ORDER BY createdAt DESC LIMIT 10', [prospectId]);
console.log('RECRUITMENT_STAGE_HISTORY:', JSON.stringify(rsh, null, 2));

await conn.end();
