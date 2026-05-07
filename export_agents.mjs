import { createConnection } from "mysql2/promise";
import { writeFileSync } from "fs";

const url = process.env.DATABASE_URL;
if (!url) { console.error("No DATABASE_URL"); process.exit(1); }

const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
if (!m) { console.error("Cannot parse DATABASE_URL"); process.exit(1); }
const [, user, password, host, port, database] = m;

const conn = await createConnection({
  host, port: Number(port), user, password, database,
  ssl: { rejectUnauthorized: false },
});

const [rows] = await conn.execute(
  `SELECT name, email, phone, crmEmail, role
   FROM users
   WHERE isActive = 1 AND role IN ('agent', 'admin', 'super_admin')
   ORDER BY name ASC`
);

const header = "Name,Email,Phone,CRM Email Alias,Role";
const lines = rows.map(u => {
  const esc = v => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
  return [esc(u.name), esc(u.email), esc(u.phone ?? ""), esc(u.crmEmail ?? ""), esc(u.role)].join(",");
});

const csv = [header, ...lines].join("\n");
writeFileSync("/home/ubuntu/jlt_agents_export.csv", csv, "utf8");
console.log(`Exported ${rows.length} active agents/admins`);

await conn.end();
