import mysql from 'mysql2/promise';

const db = await mysql.createConnection(process.env.DATABASE_URL);

const KEEP_EMAIL = 'jon.purehorizonstravel@outlook.com';
const DUP_EMAIL  = 'jonathan@purehorizonstravel.co.uk';

const [[keepUser]] = await db.execute('SELECT id, name FROM users WHERE email = ? LIMIT 1', [KEEP_EMAIL]);
const [[dupUser]]  = await db.execute('SELECT id, name FROM users WHERE email = ? LIMIT 1', [DUP_EMAIL]);

if (!keepUser || !dupUser) {
  console.error('Could not find one or both accounts');
  await db.end();
  process.exit(1);
}

console.log(`Keeping:  ${keepUser.name} (ID ${keepUser.id}) — ${KEEP_EMAIL}`);
console.log(`Removing: ${dupUser.name} (ID ${dupUser.id}) — ${DUP_EMAIL}`);

// The duplicate account has its own gc_mandates / gc_subscriptions rows.
// The keeper already has the correct GC records (linked earlier today).
// We just need to delete the duplicate's GC rows and deactivate the account.

const [dupMandates] = await db.execute('SELECT id, mandateId FROM gc_mandates WHERE userId = ?', [dupUser.id]);
const [dupSubs]     = await db.execute('SELECT id, subscriptionId FROM gc_subscriptions WHERE userId = ?', [dupUser.id]);

console.log(`Duplicate GC mandates to remove: ${dupMandates.map(r => r.mandateId).join(', ') || 'none'}`);
console.log(`Duplicate GC subscriptions to remove: ${dupSubs.map(r => r.subscriptionId).join(', ') || 'none'}`);

// Delete duplicate GC rows
await db.execute('DELETE FROM gc_subscriptions WHERE userId = ?', [dupUser.id]);
await db.execute('DELETE FROM gc_mandates WHERE userId = ?', [dupUser.id]);
console.log('Deleted duplicate GC records.');

// Deactivate the duplicate user account
await db.execute('UPDATE users SET isActive = 0 WHERE id = ?', [dupUser.id]);
console.log(`Deactivated duplicate account (ID ${dupUser.id}).`);

// Verify keeper account is intact
const [keepMandates] = await db.execute('SELECT mandateId, status FROM gc_mandates WHERE userId = ?', [keepUser.id]);
const [keepSubs]     = await db.execute('SELECT subscriptionId, status FROM gc_subscriptions WHERE userId = ?', [keepUser.id]);
const [keepBookings] = await db.execute('SELECT COUNT(*) as cnt FROM bookings WHERE agentId = ?', [keepUser.id]);

console.log('\nKeeper account summary:');
console.log('  Mandates:', keepMandates.map(r => `${r.mandateId} (${r.status})`).join(', ') || 'none');
console.log('  Subscriptions:', keepSubs.map(r => `${r.subscriptionId} (${r.status})`).join(', ') || 'none');
console.log('  Bookings:', keepBookings[0].cnt);

await db.end();
console.log('\nMerge complete.');
