/**
 * One-off script: send backdated receipt to Melissa O'Neill for payment PM01XM4PBFKK234PA9QZE0M9WC7N
 * (29 June 2026, £87.00)
 * Run with: node send-melissa-receipt.mjs
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { Resend } from "resend";

const PAYMENT_ID = "PM01XM4PBFKK234PA9QZE0M9WC7N";
const USER_ID = 60368;
const AGENT_NAME = "Melissa O'Neill";
const AGENT_EMAIL = "hello@monaracollective.com";
const PAYMENT_DATE = "29 June 2026";
const AMOUNT_PENCE = 8700; // £87.00
const MANDATE_ID = "MD01KNF56E949A";
const MEMBERSHIP_TIER = "business_class"; // will be looked up from DB

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// 1. Check if receipt already sent
const [existing] = await conn.execute(
  "SELECT id FROM agent_emails WHERE triggerKey = ? AND userId = ? LIMIT 1",
  [`gc_receipt_${PAYMENT_ID}`, USER_ID]
);
if (existing.length > 0) {
  console.log("Receipt already sent — aborting to avoid duplicate.");
  await conn.end();
  process.exit(0);
}

// 2. Look up membership tier from CRM profile
const [crmRows] = await conn.execute(
  "SELECT membershipTier FROM agent_crm_profiles WHERE userId = ? LIMIT 1",
  [USER_ID]
);
const membershipTier = crmRows[0]?.membershipTier ?? "business_class";
const tierLabel =
  membershipTier === "first_class"
    ? "First Class"
    : membershipTier === "charter"
    ? "Charter"
    : "Business Class";

// 3. Build receipt HTML
const amountFormatted = `£${(AMOUNT_PENCE / 100).toFixed(2)}`;
const vatNet = Math.round(AMOUNT_PENCE / 1.2);
const vatAmt = AMOUNT_PENCE - vatNet;
const netFmt = `£${(vatNet / 100).toFixed(2)}`;
const vatFmt = `£${(vatAmt / 100).toFixed(2)}`;

const receiptHtml = `<div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <div style="background:#70FFE8;padding:28px 32px;">
    <h1 style="margin:0;font-size:22px;font-weight:700;color:#1a1a2e;">JLT Group</h1>
    <p style="margin:4px 0 0;font-size:13px;color:#1a1a2e;opacity:0.7;">Membership Payment Receipt</p>
  </div>
  <div style="padding:32px;">
    <p style="color:#414141;margin:0 0 20px;">Hi ${AGENT_NAME},</p>
    <p style="color:#414141;margin:0 0 20px;">Your JLT Group membership payment has been successfully collected.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px;">
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:10px 0;color:#6b7280;font-size:14px;">Net Amount (excl. VAT)</td>
        <td style="padding:10px 0;color:#414141;text-align:right;">${netFmt}</td>
      </tr>
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:10px 0;color:#6b7280;font-size:14px;">VAT (20%)</td>
        <td style="padding:10px 0;color:#414141;text-align:right;">${vatFmt}</td>
      </tr>
      <tr style="border-bottom:1px solid #f0f0f0;background:#f8fffe;">
        <td style="padding:10px 0;color:#414141;font-weight:700;font-size:15px;">Total</td>
        <td style="padding:10px 0;color:#414141;font-weight:700;font-size:16px;text-align:right;">${amountFormatted}</td>
      </tr>
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:10px 0;color:#6b7280;font-size:14px;">Membership</td>
        <td style="padding:10px 0;color:#414141;font-weight:600;text-align:right;">${tierLabel}</td>
      </tr>
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:10px 0;color:#6b7280;font-size:14px;">Date</td>
        <td style="padding:10px 0;color:#414141;text-align:right;">${PAYMENT_DATE}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#6b7280;font-size:14px;">Reference</td>
        <td style="padding:10px 0;color:#414141;font-family:monospace;text-align:right;">${PAYMENT_ID}</td>
      </tr>
    </table>
    <p style="color:#6b7280;font-size:13px;margin:0 0 8px;">VAT Registration Number: <strong>341303939</strong></p>
    <p style="color:#6b7280;font-size:13px;margin:0;">For queries contact <a href="mailto:memberships@thejltgroup.co.uk" style="color:#02E6D2;">memberships@thejltgroup.co.uk</a>.</p>
  </div>
  <div style="background:#f9fafb;padding:20px 32px;border-top:1px solid #f0f0f0;">
    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">JLT Group &bull; <a href="https://portal.thejltgroup.co.uk" style="color:#02E6D2;">portal.thejltgroup.co.uk</a></p>
  </div>
</div>`;

// 4. Send via Resend
const resend = new Resend(process.env.RESEND_API_KEY);
const { data, error } = await resend.emails.send({
  from: "JLT Group <memberships@thejltgroup.co.uk>",
  to: [AGENT_EMAIL],
  subject: `Membership Payment Receipt — ${amountFormatted}`,
  html: receiptHtml,
});

if (error) {
  console.error("Failed to send email:", error);
  await conn.end();
  process.exit(1);
}

console.log("Email sent successfully. Resend ID:", data?.id);

// 5. Log to agent_emails so it appears in the portal email log
await conn.execute(
  `INSERT INTO agent_emails (userId, toEmail, subject, triggerKey, sentAt, status, emailId)
   VALUES (?, ?, ?, ?, NOW(), 'sent', ?)`,
  [
    USER_ID,
    AGENT_EMAIL,
    `Membership Payment Receipt — ${amountFormatted}`,
    `gc_receipt_${PAYMENT_ID}`,
    data?.id ?? null,
  ]
);

console.log("Logged to agent_emails table.");
await conn.end();
console.log("Done.");
