import { createRequire } from 'module';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('No DATABASE_URL'); process.exit(1); }

import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(DATABASE_URL);

// Check existing payment templates
const [rows] = await conn.execute(
  "SELECT trigger_key, subject, recipient_type FROM notification_templates WHERE trigger_key LIKE '%payment%'"
);
console.log('Existing payment templates:', JSON.stringify(rows, null, 2));

// Check if payment_received exists
const existing = rows.find(r => r.trigger_key === 'payment_received');
if (!existing) {
  console.log('\nNo payment_received template found — inserting default...');
  await conn.execute(`
    INSERT INTO notification_templates (trigger_key, label, subject, body_html, recipient_type, updated_by_id, created_at, updated_at)
    VALUES (
      'payment_received',
      'Payment Received',
      'Payment received for {{clientName}} ({{ptsRef}})',
      '<p>Hi {{toName}},</p><p>A payment of <strong>{{amount}}</strong> has been received for your booking for <strong>{{clientName}}</strong> (PTS Ref: {{ptsRef}}).</p><p>Transaction ID: {{transactionId}}</p><p>Thank you,<br/>JLT Group</p>',
      'agent',
      1,
      NOW(),
      NOW()
    )
  `);
  console.log('payment_received template created.');
} else {
  console.log('\npayment_received template already exists.');
}

// Also check payment_confirmation (customer-facing)
const existingCustomer = rows.find(r => r.trigger_key === 'payment_confirmation');
if (!existingCustomer) {
  console.log('No payment_confirmation template found — inserting default...');
  await conn.execute(`
    INSERT INTO notification_templates (trigger_key, label, subject, body_html, recipient_type, updated_by_id, created_at, updated_at)
    VALUES (
      'payment_confirmation',
      'Payment Confirmation (Customer)',
      'Payment confirmation for your booking',
      '<p>Dear {{clientName}},</p><p>Thank you for your payment of <strong>{{amount}}</strong> for your booking (Ref: {{ptsRef}}).</p><p>Your payment has been received and your booking is confirmed.</p><p>Kind regards,<br/>JLT Group</p>',
      'admin',
      1,
      NOW(),
      NOW()
    )
  `);
  console.log('payment_confirmation template created.');
}

await conn.end();
console.log('\nDone.');
