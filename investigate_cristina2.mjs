import mysql from 'mysql2/promise';

const conn = await mysql.createConnection('mysql://root:uzArNRvsIOUNMvIOBbGSLCmDXUFvIYHR@maglev.proxy.rlwy.net:38024/railway');

const email = 'cristinaruizcasalis@icloud.com';

// Show ALL tables
const [allTables] = await conn.execute("SHOW TABLES");
console.log('ALL TABLES:', allTables.map(r => Object.values(r)[0]).join(', '));

await conn.end();
