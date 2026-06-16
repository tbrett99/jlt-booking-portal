import mysql from 'mysql2/promise';

const conn = await mysql.createConnection('mysql://root:uzArNRvsIOUNMvIOBbGSLCmDXUFvIYHR@maglev.proxy.rlwy.net:38024/railway');

try {
  const [result] = await conn.execute(
    "UPDATE users SET commissionRatePct = 100 WHERE id IN (47, 760)"
  );
  console.log(`✓ Updated ${result.affectedRows} rows — both Max Kelly accounts now at 100%`);

  const [rows] = await conn.execute(
    "SELECT id, name, email, commissionRatePct FROM users WHERE id IN (47, 760)"
  );
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await conn.end();
}
