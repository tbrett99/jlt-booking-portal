import { createConnection } from "mysql2/promise";
const url = process.env.DATABASE_URL;
const match = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
const [, user, password, host, port, database] = match;
const conn = await createConnection({ host, port: Number(port), user, password, database, ssl: { rejectUnauthorized: false } });
const [rows] = await conn.execute('SELECT id, name, email, openId, role FROM users WHERE name LIKE "%Max%" OR email LIKE "%loupr%" OR email LIKE "%max@%" ORDER BY id LIMIT 10');
console.log("Max/loupr users:", JSON.stringify(rows, null, 2));
await conn.end();
