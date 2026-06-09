import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

const CSV_PATH = '/home/ubuntu/upload/2026-06-09_ExportUsers.csv';
const JAN_2026 = new Date('2026-01-01T00:00:00Z');

const csvContent = readFileSync(CSV_PATH, 'utf-8');
const lwUsers = parse(csvContent, { columns: true, skip_empty_lines: true });
const preJan = lwUsers.filter(u => new Date(u.signup) < JAN_2026);
console.log('Pre-Jan 2026 LW users:', preJan.length);

const conn = await createConnection(process.env.DATABASE_URL);
const [portal] = await conn.execute(
  'SELECT u.id, u.email, p.id as crmId, p.trainingStage FROM users u LEFT JOIN agent_crm_profiles p ON p.userId=u.id ORDER BY u.email'
);
const byEmail = new Map();
for (const u of portal) {
  byEmail.set(u.email.toLowerCase().trim(), u);
}

const needUpdate = [];
const alreadyDone = [];
for (const lw of preJan) {
  const email = (lw.email || '').toLowerCase().trim();
  const p = byEmail.get(email);
  if (!p) continue;
  if (p.trainingStage === 'Accredited') {
    alreadyDone.push(lw.email);
  } else {
    needUpdate.push({ email: lw.email, stage: p.trainingStage, crmId: p.crmId, userId: p.id });
  }
}

console.log('Need update:', needUpdate.length);
console.log('Already accredited:', alreadyDone.length);
if (needUpdate.length > 0) {
  console.log('Agents to update:');
  for (const u of needUpdate) {
    console.log(`  ${u.email} (stage: ${u.stage}, crmId: ${u.crmId})`);
  }
  // Perform the updates
  console.log('\nUpdating...');
  for (const u of needUpdate) {
    if (u.crmId) {
      await conn.execute("UPDATE agent_crm_profiles SET trainingStage = 'Accredited' WHERE id = ?", [u.crmId]);
    }
  }
  console.log('Done updating.');
}

await conn.end();
process.exit(0);
