/**
 * One-off script: manually advance join session 300001 for astmeridian@outlook.com
 * to "complete" status after the GoCardless billing_request.fulfilled webhook
 * failed to arrive.
 *
 * GoCardless confirmed:
 *   - Payment: PM01XGZ0D28FSWK8F8T5QSQT1FFF (£447.00, confirmed)
 *   - Mandate: MD01KRPBWMXTYHD4Y602KX16PC1V (Faster Payments, consumed)
 *   - Customer: CU01M34WYWBE9E7GB8KVFXQ1HBMW
 *   - Bank auth completed: 2026-05-15T17:45:31.180Z
 *
 * This script replicates exactly what the webhook handler would have done.
 *
 * Run with: cd /home/ubuntu/jlt-booking-portal && node --env-file=/dev/stdin scripts/fix-astmeridian-stuck-payment.mjs
 * (env vars are injected from the running server process)
 */

import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";

// ─── Configuration (hardcoded from known DB state) ───────────────────────────
const SESSION_ID = 300001;
const SESSION_EMAIL = "astmeridian@outlook.com";
const SESSION_SIGNER_NAME = "Abu Sufyan";
const SESSION_MEMBERSHIP_TIER = "business_class";
const SESSION_MEMBERSHIP_TYPE = "duo";
const BILLING_REQUEST_ID = "BRQ01KRPBQ61N5HRA1X8D36VFB1ZB";
const GC_MANDATE_ID = "MD01KRPBWMXTYHD4Y602KX16PC1V"; // Real mandate from GoCardless

// ─── DB Connection ────────────────────────────────────────────────────────────
// TiDB URLs include ?ssl={"rejectUnauthorized":true} which mysql2 can't parse as a profile name.
// Strip the query string and pass ssl option explicitly.
const rawDbUrl = process.env.DATABASE_URL ?? "";
const cleanDbUrl = rawDbUrl.split("?")[0];
const pool = mysql.createPool({
  uri: cleanDbUrl,
  ssl: { rejectUnauthorized: true },
  waitForConnections: true,
  connectionLimit: 5,
});
const db = pool;
console.log("[Fix] Connected to database");

// ─── Step 0: Safety check — verify session is still in expected state ─────────
const [sessionRows] = await db.execute(
  "SELECT id, email, step, userId, joiningFeePaidAt FROM join_sessions WHERE id = ?",
  [SESSION_ID]
);
const session = sessionRows[0];
if (!session) {
  console.error("[Fix] ERROR: Session 300001 not found!");
  process.exit(1);
}
if (session.userId) {
  console.error(`[Fix] ERROR: Session already has userId=${session.userId} — already processed!`);
  process.exit(1);
}
if (session.step === "complete") {
  console.error("[Fix] ERROR: Session is already 'complete' — nothing to do.");
  process.exit(1);
}
console.log(`[Fix] Session confirmed: step=${session.step}, email=${session.email}, userId=NULL ✓`);

// ─── Step 1: Check if user already exists ─────────────────────────────────────
const [existingUserRows] = await db.execute(
  "SELECT id FROM users WHERE email = ?",
  [SESSION_EMAIL]
);
let newUserId;
if (existingUserRows[0]) {
  newUserId = existingUserRows[0].id;
  console.log(`[Fix] User already exists with id=${newUserId} — skipping user creation`);
} else {
  // ─── Step 2: Create the agent user account ──────────────────────────────────
  const tempPassword = Math.random().toString(36).slice(2, 10) + "!Jlt1";
  const hashedPassword = await bcrypt.hash(tempPassword, 10);
  const openId = `agent_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await db.execute(
    `INSERT INTO users (openId, name, email, loginMethod, role, tempPassword, mustChangePassword, isActive, lastSignedIn, createdAt, updatedAt)
     VALUES (?, ?, ?, 'password', 'agent', ?, 1, 1, NOW(), NOW(), NOW())`,
    [openId, SESSION_SIGNER_NAME, SESSION_EMAIL, hashedPassword]
  );
  const [newUserRows] = await db.execute(
    "SELECT id FROM users WHERE openId = ?",
    [openId]
  );
  newUserId = newUserRows[0].id;
  console.log(`[Fix] Created agent user: id=${newUserId}, openId=${openId}`);
}

// ─── Step 3: Update join session ─────────────────────────────────────────────
await db.execute(
  `UPDATE join_sessions SET userId = ?, joiningFeePaidAt = NOW(), step = 'complete', updatedAt = NOW() WHERE id = ?`,
  [newUserId, SESSION_ID]
);
console.log(`[Fix] Updated join session ${SESSION_ID}: userId=${newUserId}, step=complete, joiningFeePaidAt=NOW()`);

// ─── Step 4: Create CRM profile ──────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
await db.execute(
  `INSERT INTO agent_crm_profiles (userId, membershipTier, dateJoined, agentStatus, trainingStage, personalEmail, createdAt, updatedAt)
   VALUES (?, ?, ?, 'active', 'Training', ?, NOW(), NOW())
   ON DUPLICATE KEY UPDATE membershipTier = VALUES(membershipTier), dateJoined = VALUES(dateJoined), trainingStage = VALUES(trainingStage), personalEmail = VALUES(personalEmail)`,
  [newUserId, SESSION_MEMBERSHIP_TIER, today, SESSION_EMAIL]
);
console.log(`[Fix] Upserted CRM profile for user ${newUserId}`);

// ─── Step 5: Create gc_mandates row ──────────────────────────────────────────
const [existingMandateRows] = await db.execute(
  "SELECT id FROM gc_mandates WHERE billingRequestId = ?",
  [BILLING_REQUEST_ID]
);
if (existingMandateRows[0]) {
  // Update existing row with userId
  await db.execute(
    `UPDATE gc_mandates SET userId = ?, joiningFeePaidAt = NOW(), mandateId = ?, status = 'pending', updatedAt = NOW() WHERE billingRequestId = ?`,
    [newUserId, GC_MANDATE_ID, BILLING_REQUEST_ID]
  );
  console.log(`[Fix] Updated existing gc_mandates row for billingRequestId=${BILLING_REQUEST_ID}`);
} else {
  await db.execute(
    `INSERT INTO gc_mandates (userId, billingRequestId, billingRequestFlowId, mandateId, preferredPaymentDay, joiningFeePaidAt, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 1, NOW(), 'pending', NOW(), NOW())`,
    [newUserId, BILLING_REQUEST_ID, BILLING_REQUEST_ID, GC_MANDATE_ID]
  );
  console.log(`[Fix] Created gc_mandates row for user ${newUserId}, mandate ${GC_MANDATE_ID}`);
}

// ─── Step 6: Send admin new-joiner notification ───────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "mail.thejltgroup.co.uk",
  port: Number(process.env.SMTP_PORT ?? 465),
  secure: Number(process.env.SMTP_PORT ?? 465) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

try {
  await transporter.sendMail({
    from: `"JLT Group Portal" <support@thejltgroup.co.uk>`,
    to: `"JLT Support" <support@thejltgroup.co.uk>`,
    subject: `New Agent Joined: ${SESSION_SIGNER_NAME} (manual fix — webhook missed)`,
    html: `
      <div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF6ED;padding:32px;border-radius:16px;">
        <h2 style="color:#414141;margin:0 0 16px;">New Agent Joined via Self-Sign-Up</h2>
        <p style="color:#e97316;font-weight:600;margin:0 0 12px;">⚠️ This notification was sent manually — the GoCardless webhook did not arrive.</p>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Name</td><td style="padding:6px 0;color:#414141;font-weight:600;">${SESSION_SIGNER_NAME}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Email</td><td style="padding:6px 0;color:#414141;">${SESSION_EMAIL}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Membership</td><td style="padding:6px 0;color:#414141;">${SESSION_MEMBERSHIP_TIER} — ${SESSION_MEMBERSHIP_TYPE}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">User ID</td><td style="padding:6px 0;color:#414141;">${newUserId}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">GC Payment</td><td style="padding:6px 0;color:#414141;">PM01XGZ0D28FSWK8F8T5QSQT1FFF (£447.00)</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">GC Mandate</td><td style="padding:6px 0;color:#414141;">${GC_MANDATE_ID}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Signed up</td><td style="padding:6px 0;color:#414141;">${new Date().toUTCString()}</td></tr>
        </table>
        <p style="margin:20px 0 0;color:#414141;">Please <strong>activate their portal access</strong> in the CRM once onboarding is complete.</p>
        <p style="margin:8px 0 0;color:#9ca3af;font-size:.8rem;">JLT Group Booking Portal — automated notification</p>
      </div>
    `,
  });
  console.log("[Fix] Admin new-joiner notification sent to support@thejltgroup.co.uk");
} catch (emailErr) {
  console.error("[Fix] Failed to send admin notification:", emailErr.message);
}

// ─── Step 7: Send welcome email to the new agent ─────────────────────────────
try {
  const firstName = SESSION_SIGNER_NAME.split(" ")[0] || "there";
  await transporter.sendMail({
    from: `"JLT Group" <support@thejltgroup.co.uk>`,
    to: `"${SESSION_SIGNER_NAME}" <${SESSION_EMAIL}>`,
    subject: "Welcome to JLT Group — You're officially one of us! 🎉",
    html: `
      <div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF6ED;padding:32px;border-radius:16px;">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="background:#70FFE8;border-radius:50%;width:56px;height:56px;display:inline-flex;align-items:center;justify-content:center;">
            <span style="font-weight:700;color:#414141;font-size:1rem">JLT</span>
          </div>
          <h1 style="color:#414141;font-size:1.4rem;margin:16px 0 4px;">Welcome to JLT Group, ${firstName}!</h1>
        </div>
        <div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:24px;">
          <p style="color:#414141;margin:0 0 14px;">Hi ${SESSION_SIGNER_NAME},</p>
          <p style="color:#414141;margin:0 0 14px;">Thank you so much for joining JLT Group &mdash; we&rsquo;re really excited to have you on board! Your payment has been confirmed and you&rsquo;re now officially part of the team.</p>
          <p style="color:#414141;font-weight:600;margin:0 0 10px;">Here&rsquo;s what happens next:</p>
          <table style="width:100%;border-collapse:collapse;margin:0 0 14px;">
            <tr><td style="padding:8px 0;vertical-align:top;width:28px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#70FFE8;color:#414141;font-size:.7rem;font-weight:700;">1</span></td><td style="padding:8px 0;color:#414141;font-size:.9rem;"><strong>Set your password</strong> &mdash; visit your sign-up link to set your password and log in to your portal for the first time.</td></tr>
            <tr><td style="padding:8px 0;vertical-align:top;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#70FFE8;color:#414141;font-size:.7rem;font-weight:700;">2</span></td><td style="padding:8px 0;color:#414141;font-size:.9rem;"><strong>Complete your onboarding</strong> &mdash; log in to your portal and work through the onboarding steps so we have everything we need to get you fully set up.</td></tr>
            <tr><td style="padding:8px 0;vertical-align:top;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#70FFE8;color:#414141;font-size:.7rem;font-weight:700;">3</span></td><td style="padding:8px 0;color:#414141;font-size:.9rem;"><strong>Look out for your Training Hub email</strong> &mdash; our team will send you a separate email with your Training Hub login details as soon as your account is ready.</td></tr>
            <tr><td style="padding:8px 0;vertical-align:top;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#70FFE8;color:#414141;font-size:.7rem;font-weight:700;">4</span></td><td style="padding:8px 0;color:#414141;font-size:.9rem;"><strong>We&rsquo;ll be in touch</strong> &mdash; a member of the team will reach out to welcome you personally and walk you through your next steps.</td></tr>
          </table>
          <p style="color:#414141;margin:0;">If you have any questions in the meantime, don&rsquo;t hesitate to get in touch &mdash; we&rsquo;re here to help.</p>
        </div>
        <p style="color:#9ca3af;font-size:.75rem;text-align:center;margin:0;">Questions? Email <a href="mailto:memberships@thejltgroup.co.uk" style="color:#02E6D2;">memberships@thejltgroup.co.uk</a></p>
      </div>
    `,
  });
  console.log(`[Fix] Welcome email sent to ${SESSION_EMAIL}`);
} catch (welcomeErr) {
  console.error("[Fix] Failed to send welcome email:", welcomeErr.message);
}

// ─── Done ─────────────────────────────────────────────────────────────────────
await pool.end();
console.log("\n[Fix] ✅ All done! Summary:");
console.log(`  - User ID:     ${newUserId}`);
console.log(`  - Email:       ${SESSION_EMAIL}`);
console.log(`  - Session:     ${SESSION_ID} → step=complete`);
console.log(`  - Mandate:     ${GC_MANDATE_ID} stored in gc_mandates`);
console.log(`  - Emails:      admin notification + welcome email sent`);
console.log("\n  Next: GoCardless will send mandates.active webhook when the mandate activates.");
console.log("  That will trigger subscription creation automatically.");
