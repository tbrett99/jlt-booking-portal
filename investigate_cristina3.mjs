import mysql from 'mysql2/promise';

const conn = await mysql.createConnection('mysql://root:uzArNRvsIOUNMvIOBbGSLCmDXUFvIYHR@maglev.proxy.rlwy.net:38024/railway');

const email = 'cristinaruizcasalis@icloud.com';

// Check prospects
const [prospects] = await conn.execute('SELECT * FROM prospects WHERE email = ?', [email]);
console.log('PROSPECTS:', JSON.stringify(prospects, null, 2));

// Check recruitment_prospects
const [rp] = await conn.execute('SELECT * FROM recruitment_prospects WHERE email = ?', [email]);
console.log('RECRUITMENT_PROSPECTS:', JSON.stringify(rp, null, 2));

// Check contract_signatures
const [cs] = await conn.execute('SELECT * FROM contract_signatures WHERE email = ? ORDER BY createdAt DESC LIMIT 5', [email]);
console.log('CONTRACT_SIGNATURES:', JSON.stringify(cs, null, 2));

// Check join_sessions
const [js] = await conn.execute('SELECT * FROM join_sessions WHERE email = ? ORDER BY createdAt DESC LIMIT 5', [email]);
console.log('JOIN_SESSIONS:', JSON.stringify(js, null, 2));

// Check prospect_contracts
const [pc] = await conn.execute('SELECT * FROM prospect_contracts WHERE email = ? ORDER BY createdAt DESC LIMIT 5', [email]);
console.log('PROSPECT_CONTRACTS:', JSON.stringify(pc, null, 2));

await conn.end();
