const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Check existing payment templates
  const [rows] = await conn.execute(
    "SELECT triggerKey, subject, recipientType FROM notification_templates WHERE triggerKey LIKE '%payment%'"
  );
  console.log('Existing payment templates:', JSON.stringify(rows));

  const hasReceived = rows.some(r => r.triggerKey === 'payment_received');
  if (hasReceived) {
    console.log('payment_received template already exists — no action needed.');
  } else {
    await conn.execute(
      `INSERT INTO notification_templates (triggerKey, label, subject, bodyHtml, recipientType, isActive, updatedById, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        'payment_received',
        'Payment Received (Agent)',
        'Payment received: {{clientName}} ({{ptsRef}})',
        '<p>Hi {{toName}},</p><p>A payment of <strong>{{amount}}</strong> has been received for your client <strong>{{clientName}}</strong> (PTS Ref: {{ptsRef}}).</p><p>Transaction ID: {{transactionId}}</p><p>Kind regards,<br/>JLT Group</p>',
        'agent',
        1,
        1,
      ]
    );
    console.log('Created payment_received template.');
  }

  await conn.end();
  console.log('Done.');
})();
