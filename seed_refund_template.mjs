import mysql from "mysql2/promise";

const PROD_DB = "mysql://root:uzArNRvsIOUNMvIOBbGSLCmDXUFvIYHR@maglev.proxy.rlwy.net:38024/railway";

const bodyHtml = `<p>Hi {{agentName}},</p><p>Your refund request for <strong>{{clientName}}</strong> (Booking #{{bookingId}}) has been successfully submitted. Here's what happens next:</p><hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb;" /><h3 style="margin:0 0 8px;">Your Responsibilities</h3><ul><li><strong>You must initiate the refund directly with the supplier</strong> (where applicable). JLT cannot do this on your behalf.</li><li>You are responsible for chasing the supplier until the refund is received.</li><li>Keep a record of all correspondence with the supplier — you may need to provide this to JLT.</li></ul>{{supplierSection}}<hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb;" /><h3 style="margin:0 0 8px;">Timelines</h3><ul><li>Supplier refunds typically take <strong>4–12 weeks</strong> depending on the supplier's own processes.</li><li>Once the supplier refund is confirmed, JLT will process the client refund within <strong>5 working days</strong>.</li><li>Bank transfers to clients are processed on Tuesdays and Thursdays.</li></ul><hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb;" /><h3 style="margin:0 0 8px;">What JLT Will Do</h3><ul><li>Your refund request has been added to our pipeline and will be reviewed by the team.</li><li>We will support you throughout the process and keep you updated on progress.</li><li>If we need any further information from you, we will be in touch.</li></ul><p style="margin-top:16px;">If you have any questions, please contact the JLT support team.</p>`;

const conn = await mysql.createConnection(PROD_DB);
await conn.execute(
  `INSERT INTO notification_templates (triggerKey, label, subject, bodyHtml, recipientType, isActive)
   VALUES (?, ?, ?, ?, 'agent', 1)
   ON DUPLICATE KEY UPDATE label=VALUES(label), subject=VALUES(subject), bodyHtml=VALUES(bodyHtml)`,
  [
    "refund_confirmation",
    "Refund Request Confirmation (Agent)",
    "Refund Request Submitted — {{clientName}} (Booking #{{bookingId}})",
    bodyHtml,
  ]
);
console.log("✅ refund_confirmation template seeded to production");
await conn.end();
