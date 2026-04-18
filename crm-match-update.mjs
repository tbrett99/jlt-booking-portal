import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

// ── Simple CSV parser (handles quoted fields) ─────────────────────────────────
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const result = [];
  let headers = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());

    if (!headers) { headers = fields; continue; }
    const obj = {};
    headers.forEach((h, i) => { obj[h] = fields[i] ?? ''; });
    result.push(obj);
  }
  return result;
}

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ── 1. Load CSV ──────────────────────────────────────────────────────────────
const csvRaw = readFileSync('/home/ubuntu/upload/Members-AllAgents.csv', 'utf-8').replace(/^\uFEFF/, '');
const rows = parseCSV(csvRaw);
console.log(`CSV rows: ${rows.length}`);

// ── 2. Load CRM profiles + users from DB ─────────────────────────────────────
const [dbUsers] = await conn.execute(`
  SELECT u.id, u.email AS portalEmail, u.name,
         cp.id AS profileId, cp.dateJoined, cp.trainingStage,
         cp.jltEmail, cp.personalEmail
  FROM users u
  LEFT JOIN agent_crm_profiles cp ON cp.userId = u.id
  WHERE u.role = 'agent'
`);
console.log(`DB agents: ${dbUsers.length}`);

// ── 3. Build email → DB user map ─────────────────────────────────────────────
const emailMap = new Map();
for (const u of dbUsers) {
  if (u.portalEmail) emailMap.set(u.portalEmail.trim().toLowerCase(), u);
  if (u.jltEmail)    emailMap.set(u.jltEmail.trim().toLowerCase(), u);
  if (u.personalEmail) emailMap.set(u.personalEmail.trim().toLowerCase(), u);
}

// ── 4. Match CSV rows to DB users ─────────────────────────────────────────────
const matched = [];
const unmatched = [];

for (const row of rows) {
  const csvPersonalEmail = (row['Email Address'] || '').trim().toLowerCase();
  // Handle trailing space in header name
  const csvJltEmail = (row['JLT Email Address '] || row['JLT Email Address'] || '').trim().toLowerCase();
  const csvName       = (row['Name'] || '').trim();
  const csvDateJoined = (row['Date Joined'] || '').trim();
  const csvSignedOff  = (row['Signed Off'] || '').trim();

  const dbUser = emailMap.get(csvPersonalEmail) || emailMap.get(csvJltEmail);

  if (dbUser) {
    matched.push({ dbUser, csvName, csvDateJoined, csvSignedOff, csvPersonalEmail, csvJltEmail });
  } else {
    unmatched.push({ csvName, csvPersonalEmail, csvJltEmail, csvDateJoined });
  }
}

console.log(`\nMatched: ${matched.length}`);
console.log(`Unmatched: ${unmatched.length}`);

// ── 5. Apply updates ──────────────────────────────────────────────────────────
let updated = 0;
let skipped = 0;
const updateLog = [];

for (const { dbUser, csvName, csvDateJoined, csvSignedOff } of matched) {
  const isSignedOff = csvSignedOff.toUpperCase().startsWith('YES');

  // Parse date: format is D/M/YYYY or D/M/YY
  let parsedDate = null;
  if (csvDateJoined) {
    const parts = csvDateJoined.split('/');
    if (parts.length === 3) {
      const [d, m, y] = parts;
      const fullYear = y.length === 2 ? '20' + y : y;
      parsedDate = `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }

  if (!dbUser.profileId) {
    // No CRM profile yet — create one
    await conn.execute(`
      INSERT INTO agent_crm_profiles (userId, dateJoined, trainingStage)
      VALUES (?, ?, ?)
    `, [dbUser.id, parsedDate, isSignedOff ? null : 'Training']);
    updated++;
    updateLog.push(`[NEW PROFILE] ${csvName} (${dbUser.portalEmail}) → dateJoined=${parsedDate}, trainingStage=${isSignedOff ? '(none)' : 'Training'}`);
  } else {
    // Update existing profile
    // Always update dateJoined if we have one
    // Only set trainingStage to Training if not signed off AND trainingStage is currently blank/null
    const updates = [];
    const vals = [];

    if (parsedDate) {
      updates.push('dateJoined = ?');
      vals.push(parsedDate);
    }

    if (!isSignedOff) {
      updates.push("trainingStage = CASE WHEN (trainingStage IS NULL OR trainingStage = '') THEN 'Training' ELSE trainingStage END");
    }

    if (updates.length > 0) {
      vals.push(dbUser.profileId);
      await conn.execute(`UPDATE agent_crm_profiles SET ${updates.join(', ')} WHERE id = ?`, vals);
      updated++;
      updateLog.push(`[UPDATED] ${csvName} (${dbUser.portalEmail}) → dateJoined=${parsedDate ?? '(no date)'}, signedOff=${isSignedOff}, trainingStage=${isSignedOff ? '(unchanged)' : 'Training (if was blank)'}`);
    } else {
      skipped++;
      updateLog.push(`[SKIPPED] ${csvName} — no date and already signed off`);
    }
  }
}

console.log(`Updated: ${updated}`);
console.log(`Skipped: ${skipped}`);

console.log('\n── UPDATE LOG ──────────────────────────────────────────────────────────');
for (const line of updateLog) console.log(line);

console.log('\n── UNMATCHED CSV ROWS ──────────────────────────────────────────────────');
for (const u of unmatched) {
  console.log(`  ${u.csvName} | personal: ${u.csvPersonalEmail} | jlt: ${u.csvJltEmail}`);
}

await conn.end();
