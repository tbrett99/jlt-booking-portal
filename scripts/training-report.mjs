import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

const CSV_PATH = '/home/ubuntu/upload/2026-06-09_ExportUsers.csv';

const csvContent = readFileSync(CSV_PATH, 'utf-8');
const lwUsers = parse(csvContent, { columns: true, skip_empty_lines: true });
const lwByEmail = new Map(lwUsers.map(u => [(u.email || '').toLowerCase().trim(), u]));

const conn = await createConnection(process.env.DATABASE_URL);

// Get all portal users with CRM profiles
const [portal] = await conn.execute(`
  SELECT u.id, u.name, u.email, u.portalStatus, p.id as crmId, p.trainingStage, p.agentStatus
  FROM users u
  LEFT JOIN agent_crm_profiles p ON p.userId = u.id
  WHERE u.role NOT IN ('admin', 'super_admin')
  ORDER BY u.name
`);

const portalByEmail = new Map(portal.map(u => [u.email.toLowerCase().trim(), u]));

// 1. LW users not found in portal
const unmatched = [];
for (const lw of lwUsers) {
  const email = (lw.email || '').toLowerCase().trim();
  if (!portalByEmail.has(email)) {
    unmatched.push({ name: lw.username, email: lw.email, signup: lw.signup });
  }
}

// 2. Portal agents in Training, Agent Accelerator, or no stage
const trainingList = [];
const acceleratorList = [];
const emptyList = [];

for (const u of portal) {
  // Skip obvious test/admin accounts
  if (u.email.includes('test@') || u.email.includes('testagent@') || u.email.includes('partnerships@')) continue;
  
  const stage = (u.trainingStage || '').trim();
  const inLW = lwByEmail.has(u.email.toLowerCase().trim());
  
  if (stage === 'Training') {
    trainingList.push({ name: u.name, email: u.email, portalStatus: u.portalStatus, inLW });
  } else if (stage === 'Agent Accelerator') {
    acceleratorList.push({ name: u.name, email: u.email, portalStatus: u.portalStatus, inLW });
  } else if (!stage) {
    emptyList.push({ name: u.name, email: u.email, portalStatus: u.portalStatus, inLW });
  }
}

await conn.end();

// Output
console.log(`\n=== UNMATCHED IN LEARNWORLDS (not found in portal): ${unmatched.length} ===`);
for (const u of unmatched) {
  console.log(`${u.name}\t${u.email}\t${u.signup}`);
}

console.log(`\n=== TRAINING STAGE: ${trainingList.length} agents ===`);
for (const u of trainingList) {
  console.log(`${u.name}\t${u.email}\t${u.portalStatus}\tIn LW: ${u.inLW ? 'Yes' : 'No'}`);
}

console.log(`\n=== AGENT ACCELERATOR STAGE: ${acceleratorList.length} agents ===`);
for (const u of acceleratorList) {
  console.log(`${u.name}\t${u.email}\t${u.portalStatus}\tIn LW: ${u.inLW ? 'Yes' : 'No'}`);
}

console.log(`\n=== NO TRAINING STAGE SET: ${emptyList.length} agents ===`);
for (const u of emptyList) {
  console.log(`${u.name}\t${u.email}\t${u.portalStatus}\tIn LW: ${u.inLW ? 'Yes' : 'No'}`);
}

process.exit(0);
