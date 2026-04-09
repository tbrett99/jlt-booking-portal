import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection);

const templates = [
  { triggerKey: "added_to_pts", label: "Added to PTS", subject: "Your booking has been added to PTS", bodyHtml: "<p>Hi {{agentName}},</p><p>Great news! Your booking for <strong>{{clientName}}</strong> has been added to PTS and is now being processed.</p><p>The JLT Group Team</p>", recipientType: "agent" },
  { triggerKey: "not_on_topdog", label: "Not on Topdog", subject: "Action required: Booking not found on Topdog", bodyHtml: "<p>Hi {{agentName}},</p><p>We were unable to locate the booking for <strong>{{clientName}}</strong> on Topdog. Please check the Topdog reference and contact us if you need assistance.</p><p>The JLT Group Team</p>", recipientType: "agent" },
  { triggerKey: "query", label: "Query", subject: "Query raised on your booking", bodyHtml: "<p>Hi {{agentName}},</p><p>A query has been raised on the booking for <strong>{{clientName}}</strong>. Please log in to the portal to view the details and respond.</p><p>The JLT Group Team</p>", recipientType: "agent" },
  { triggerKey: "reimb_docs_missing", label: "Reimbursement Docs Missing", subject: "Action required: Reimbursement documents missing", bodyHtml: "<p>Hi {{agentName}},</p><p>We are missing reimbursement documents for the booking for <strong>{{clientName}}</strong>. Please upload them via the portal as soon as possible.</p><p>The JLT Group Team</p>", recipientType: "agent" },
  { triggerKey: "commission_claimable", label: "Commission Claimable", subject: "Your commission is ready to claim", bodyHtml: "<p>Hi {{agentName}},</p><p>Your commission for booking <strong>{{clientName}}</strong> is now ready to claim. Please log in to the portal to submit your claim.</p><p>The JLT Group Team</p>", recipientType: "agent" },
  { triggerKey: "commission_claimed", label: "Commission Claimed", subject: "Commission claim received", bodyHtml: "<p>Hi {{agentName}},</p><p>We have received your commission claim for booking <strong>{{clientName}}</strong>. We will process this shortly.</p><p>The JLT Group Team</p>", recipientType: "agent" },
  { triggerKey: "commission_paid", label: "Commission Paid", subject: "Your commission has been paid", bodyHtml: "<p>Hi {{agentName}},</p><p>Your commission for booking <strong>{{clientName}}</strong> has been processed and paid. Please check your account.</p><p>The JLT Group Team</p>", recipientType: "agent" },
  { triggerKey: "cancelled", label: "Booking Cancelled", subject: "Booking cancelled", bodyHtml: "<p>Hi {{agentName}},</p><p>The booking for <strong>{{clientName}}</strong> has been marked as cancelled on the portal.</p><p>The JLT Group Team</p>", recipientType: "agent" },
  { triggerKey: "amendment_actioned", label: "Amendment Actioned", subject: "Your amendment has been actioned", bodyHtml: "<p>Hi {{agentName}},</p><p>The amendment request for booking <strong>{{clientName}}</strong> has been actioned. Please log in to the portal for full details.</p><p>The JLT Group Team</p>", recipientType: "agent" },
  { triggerKey: "late_reimbursement_upload", label: "Late Reimbursement Document Upload", subject: "Reimbursement documents uploaded (late)", bodyHtml: "<p>Hi Admin,</p><p>Reimbursement documents have been uploaded for booking <strong>{{clientName}}</strong> after the initial submission. Please review them in the portal.</p><p>JLT Portal System</p>", recipientType: "admin" },
];

for (const t of templates) {
  await connection.execute(
    `INSERT INTO notification_templates (triggerKey, label, subject, bodyHtml, recipientType, updatedAt)
     VALUES (?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE label=VALUES(label), subject=VALUES(subject), bodyHtml=VALUES(bodyHtml), recipientType=VALUES(recipientType), updatedAt=NOW()`,
    [t.triggerKey, t.label, t.subject, t.bodyHtml, t.recipientType]
  );
}

console.log("Seeded", templates.length, "notification templates successfully");
await connection.end();
