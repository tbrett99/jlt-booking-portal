import { createConnection } from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) { console.error("No DATABASE_URL"); process.exit(1); }

// Parse mysql://user:pass@host:port/db?ssl=...
const match = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
if (!match) { console.error("Could not parse DATABASE_URL:", url.substring(0, 40)); process.exit(1); }
const [, user, password, host, port, database] = match;

const conn = await createConnection({ host, port: Number(port), user, password, database, ssl: { rejectUnauthorized: false } });

// Check the actual column definition
const [cols] = await conn.execute('SHOW COLUMNS FROM gc_mandates WHERE Field = "userId"');
console.log("gc_mandates.userId column:", JSON.stringify(cols, null, 2));

// Also check for any existing rows with userId=0 or null
const [rows] = await conn.execute('SELECT id, userId, billingRequestId, status, createdAt FROM gc_mandates ORDER BY createdAt DESC LIMIT 10');
console.log("Recent gc_mandates rows:", JSON.stringify(rows, null, 2));

await conn.end();
