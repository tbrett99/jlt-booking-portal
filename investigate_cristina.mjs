import mysql from 'mysql2/promise';

const conn = await mysql.createConnection('mysql://root:uzArNRvsIOUNMvIOBbGSLCmDXUFvIYHR@maglev.proxy.rlwy.net:38024/railway');

const email = 'cristinaruizcasalis@icloud.com';

// Find the user
const [users] = await conn.execute('SELECT id, name, email, role, createdAt FROM users WHERE email = ?', [email]);
console.log('USER:', JSON.stringify(users, null, 2));

// Check all sign-up related tables
const tables = ['sign_up_applications', 'sign_ups', 'agent_applications', 'applications'];
for (const t of tables) {
  try {
    const [rows] = await conn.execute(`SELECT * FROM \`${t}\` WHERE email = ? OR applicantEmail = ? ORDER BY createdAt DESC LIMIT 5`, [email, email]);
    if (rows.length > 0) console.log(`${t}:`, JSON.stringify(rows, null, 2));
  } catch (e) {
    // table doesn't exist, skip
  }
}

// Show all tables to understand the schema
const [tbls] = await conn.execute("SHOW TABLES LIKE '%sign%'");
console.log('SIGN TABLES:', JSON.stringify(tbls, null, 2));

const [tbls2] = await conn.execute("SHOW TABLES LIKE '%applic%'");
console.log('APPLICATION TABLES:', JSON.stringify(tbls2, null, 2));

await conn.end();
