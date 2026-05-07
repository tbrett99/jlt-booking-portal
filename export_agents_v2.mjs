import mysql from 'mysql2/promise';
import { createWriteStream } from 'fs';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [rows] = await conn.execute(`
  SELECT 
    name,
    email,
    phone,
    crmEmail AS crm_email_alias,
    role,
    portalStatus AS portal_status
  FROM users
  WHERE role = 'agent'
    AND portalStatus != 'cancelled'
    AND isActive = 1
  ORDER BY name ASC
`);

await conn.end();

const escape = (v) => {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
};

const headers = ['name', 'portal_email', 'phone', 'crm_email_alias', 'role', 'portal_status'];
const lines = [headers.join(',')];
for (const row of rows) {
  lines.push([
    escape(row.name),
    escape(row.email),
    escape(row.phone),
    escape(row.crm_email_alias),
    escape(row.role),
    escape(row.portal_status),
  ].join(','));
}

const out = '/home/ubuntu/jlt_agents_export_v2.csv';
const ws = createWriteStream(out);
ws.write(lines.join('\n') + '\n');
ws.end();

console.log(`Exported ${rows.length} active agents to ${out}`);
