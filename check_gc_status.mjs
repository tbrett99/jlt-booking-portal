import { createConnection } from "mysql2/promise";
const url = process.env.DATABASE_URL;
const match = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
const [, user, password, host, port, database] = match;
const conn = await createConnection({ host, port: Number(port), user, password, database, ssl: { rejectUnauthorized: false } });

// Get the most recently created mandates (last 5)
const [mandates] = await conn.execute(`
  SELECT m.id, m.userId, m.mandateId, m.billingRequestId, m.status,
         m.preferredPaymentDay, m.joiningFeePaidAt, m.createdAt,
         u.email, u.name
  FROM gc_mandates m
  LEFT JOIN users u ON u.id = m.userId
  ORDER BY m.createdAt DESC
  LIMIT 5
`);
console.log("Recent mandates:", JSON.stringify(mandates, null, 2));

// Get subscriptions (last 5)
const [subs] = await conn.execute(`
  SELECT s.id, s.userId, s.subscriptionId, s.status, s.amount,
         s.dayOfMonth, s.startDate, s.createdAt,
         u.email
  FROM gc_subscriptions s
  LEFT JOIN users u ON u.id = s.userId
  ORDER BY s.createdAt DESC
  LIMIT 5
`);
console.log("Recent subscriptions:", JSON.stringify(subs, null, 2));

await conn.end();
