import mysql from 'mysql2/promise';

const conn = await mysql.createConnection('mysql://root:uzArNRvsIOUNMvIOBbGSLCmDXUFvIYHR@maglev.proxy.rlwy.net:38024/railway');

try {
  // Step 1: Add the column if it doesn't exist
  const [cols] = await conn.execute(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'railway' AND TABLE_NAME = 'users' AND COLUMN_NAME = 'commissionRatePct'
  `);

  if (cols.length === 0) {
    await conn.execute('ALTER TABLE `users` ADD `commissionRatePct` int DEFAULT 80 NOT NULL');
    console.log('✓ Added commissionRatePct column');
  } else {
    console.log('✓ commissionRatePct column already exists');
  }

  // Step 2: Find Max Kelly
  const [users] = await conn.execute(
    "SELECT id, name, email, commissionRatePct FROM users WHERE name LIKE '%Max%Kelly%' OR name LIKE '%max%kelly%' OR email LIKE '%max%kelly%' OR email LIKE '%maxkelly%'"
  );
  console.log('Max Kelly search results:', JSON.stringify(users, null, 2));

  if (users.length === 1) {
    await conn.execute('UPDATE users SET commissionRatePct = 100 WHERE id = ?', [users[0].id]);
    console.log(`✓ Set commissionRatePct = 100 for ${users[0].name} (id: ${users[0].id})`);
  } else if (users.length === 0) {
    console.log('⚠ Max Kelly not found — check the name/email in the DB');
  } else {
    console.log('⚠ Multiple matches found — update manually');
  }
} finally {
  await conn.end();
}
