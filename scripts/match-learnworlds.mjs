/**
 * Match LearnWorlds export to portal CRM agents.
 * - Agents who registered before Jan 2026 → set trainingStage = 'Accredited'
 * - Report unmatched agents and those missing a training stage
 */
import { createConnection } from 'mysql2/promise';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';

const CSV_PATH = '/home/ubuntu/upload/2026-06-09_ExportUsers.csv';
const JAN_2026 = new Date('2026-01-01T00:00:00Z');

// Parse CSV
const csvContent = readFileSync(CSV_PATH, 'utf-8');
const lwUsers = parse(csvContent, { columns: true, skip_empty_lines: true });

console.log(`\nLearnWorlds users loaded: ${lwUsers.length}`);

// Parse signup date from "09 Sep 2024 10:53:25" format
function parseSignup(str) {
  if (!str) return null;
  try {
    return new Date(str);
  } catch {
    return null;
  }
}

// Connect to DB
const conn = await createConnection(process.env.DATABASE_URL);

// Get all portal users + CRM profiles
const [portalUsers] = await conn.execute(`
  SELECT u.id, u.name, u.email, p.id as crmId, p.trainingStage, u.portalStatus, p.agentStatus
  FROM users u
  LEFT JOIN agent_crm_profiles p ON p.userId = u.id
  ORDER BY u.email
`);

console.log(`Portal users loaded: ${portalUsers.length}`);

// Build email lookup map for portal users
const portalByEmail = new Map();
for (const u of portalUsers) {
  portalByEmail.set(u.email.toLowerCase().trim(), u);
}

// Results tracking
const matched = [];
const unmatched = [];
const updated = [];
const alreadyAccredited = [];
const missingTrainingStage = [];

for (const lw of lwUsers) {
  const email = (lw.email || '').toLowerCase().trim();
  const signupDate = parseSignup(lw.signup);
  const portalUser = portalByEmail.get(email);

  if (!portalUser) {
    unmatched.push({ name: lw.username, email: lw.email, signup: lw.signup });
    continue;
  }

  matched.push({ name: lw.username, email: lw.email, portalId: portalUser.id, trainingStage: portalUser.trainingStage });

  const isBeforeJan2026 = signupDate && signupDate < JAN_2026;

  if (isBeforeJan2026) {
    if (portalUser.trainingStage === 'Accredited') {
      alreadyAccredited.push({ name: lw.username, email: lw.email });
    } else {
      // Update to Accredited
      if (portalUser.crmId) {
        await conn.execute(
          `UPDATE agent_crm_profiles SET trainingStage = 'Accredited' WHERE id = ?`,
          [portalUser.crmId]
        );
        updated.push({ name: lw.username, email: lw.email, previousStage: portalUser.trainingStage || 'NULL', portalId: portalUser.id });
      } else {
        // No CRM profile yet — create one
        await conn.execute(
          `INSERT INTO agent_crm_profiles (userId, trainingStage, createdAt, updatedAt) VALUES (?, 'Accredited', NOW(), NOW())`,
          [portalUser.id]
        );
        updated.push({ name: lw.username, email: lw.email, previousStage: 'NO PROFILE', portalId: portalUser.id });
      }
    }
  }
}

// Now check all matched portal users for missing training stage (not updated to Accredited, and no stage set)
const [allCrmProfiles] = await conn.execute(`
  SELECT u.id, u.name, u.email, p.trainingStage, u.portalStatus, p.agentStatus
  FROM users u
  LEFT JOIN agent_crm_profiles p ON p.userId = u.id
  WHERE u.role NOT IN ('admin', 'super_admin')
  ORDER BY u.email
`);

for (const u of allCrmProfiles) {
  if (!u.trainingStage || u.trainingStage === '' || u.trainingStage === null) {
    // Only flag if they are in the LW export (i.e. they are a real agent)
    const inLW = lwUsers.find(lw => (lw.email || '').toLowerCase().trim() === (u.email || '').toLowerCase().trim());
    missingTrainingStage.push({ name: u.name, email: u.email, inLearnWorlds: inLW ? 'Yes' : 'No', portalStatus: u.portalStatus, agentStatus: u.agentStatus });
  }
}

await conn.end();

// Output results
console.log('\n========================================');
console.log(`MATCHED: ${matched.length}`);
console.log(`UNMATCHED (in LW but not in portal): ${unmatched.length}`);
console.log(`UPDATED TO ACCREDITED: ${updated.length}`);
console.log(`ALREADY ACCREDITED: ${alreadyAccredited.length}`);
console.log(`MISSING TRAINING STAGE (portal users): ${missingTrainingStage.length}`);
console.log('========================================\n');

if (updated.length > 0) {
  console.log('--- UPDATED TO ACCREDITED ---');
  for (const u of updated) {
    console.log(`  ${u.name} <${u.email}> (was: ${u.previousStage})`);
  }
}

if (unmatched.length > 0) {
  console.log('\n--- UNMATCHED (in LearnWorlds but NOT in portal) ---');
  for (const u of unmatched) {
    console.log(`  ${u.name} <${u.email}> (signed up: ${u.signup})`);
  }
}

if (missingTrainingStage.length > 0) {
  console.log('\n--- PORTAL USERS MISSING TRAINING STAGE ---');
  for (const u of missingTrainingStage) {
    console.log(`  ${u.name} <${u.email}> | Status: ${u.portalStatus || 'N/A'} | In LW: ${u.inLearnWorlds}`);
  }
}

console.log('\nDone.');
process.exit(0);
