const mysql = require('mysql2/promise');

(async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('DATABASE_URL not set'); process.exit(1); }
  console.log('Connecting to DB...');
  const conn = await mysql.createConnection(dbUrl);
  try {
    await conn.execute('ALTER TABLE bookings ADD COLUMN bookedDate timestamp NULL');
    console.log('✓ bookedDate column added');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log('Column already exists — skipping');
    } else {
      throw e;
    }
  }
  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
