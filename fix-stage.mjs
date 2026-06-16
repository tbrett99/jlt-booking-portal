import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(
  'mysql://root:uzArNRvsIOUNMvIOBbGSLCmDXUFvIYHR@maglev.proxy.rlwy.net:38024/railway'
);

const [check] = await conn.execute(
  "SELECT id, clientName, currentStage FROM bookings WHERE currentStage IN ('Not on Topdog', 'Not on TopDog', 'not_on_topdog')"
);
console.log('Bookings to fix:', check);

const [result] = await conn.execute(
  "UPDATE bookings SET currentStage = 'Incomplete Booking' WHERE currentStage IN ('Not on Topdog', 'Not on TopDog', 'not_on_topdog')"
);
console.log('Updated rows:', result.affectedRows);

await conn.end();
