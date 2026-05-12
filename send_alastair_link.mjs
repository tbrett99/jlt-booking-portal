/**
 * One-off script: send Alastair Naughton his personalised application link email.
 * Prospect ID: 90018, token: RRywdVe20hHki0WuqctkNO-3ENPNtRJT
 */
import { Resend } from "resend";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";

// Load env from project
dotenv.config({ path: "/home/ubuntu/jlt-booking-portal/.env" });

const RESEND_API_KEY = process.env.RESEND_API_KEY;
if (!RESEND_API_KEY) {
  console.error("No RESEND_API_KEY found in env");
  process.exit(1);
}

const token = "RRywdVe20hHki0WuqctkNO-3ENPNtRJT";
const applicationUrl = `https://portal.thejltgroup.co.uk/apply/form?token=${token}`;
const firstName = "Alastair";
const toEmail = "anaughton02@gmail.com";
const subject = "Your JLT Group Application Link";

const bodyHtml = `
<p>Hi ${firstName},</p>
<p>Thank you for your patience — we wanted to make sure you have a working link to complete your JLT Group application.</p>
<p>We're sorry if you experienced any issues with previous links. Please use the button below, which is your personal application link:</p>
<p style="text-align:center;margin:28px 0;">
  <a href="${applicationUrl}" style="display:inline-block;background:#70FFE8;color:#414141;font-weight:700;padding:15px 36px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;font-size:15px;">Complete Your Application &rarr;</a>
</p>
<p>It only takes about 5 minutes to complete. If you have any questions, please reply to this email and we'll be happy to help.</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`;

const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${subject}</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:'Poppins',Arial,sans-serif;">
  <div style="width:100%;background-color:#f5f5f5;padding:20px 0;">
    <div style="max-width:600px;width:100%;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
      <div style="background-color:#70FFE8;padding:24px 40px;text-align:center;">
        <span style="font-family:'Poppins',Arial,sans-serif;font-size:22px;font-weight:700;color:#414141;">JLT Group</span>
      </div>
      <div style="padding:32px 40px;color:#414141;font-family:'Poppins',Arial,sans-serif;font-size:15px;line-height:1.7;">
        ${bodyHtml}
      </div>
      <div style="padding:20px 40px;text-align:center;background-color:#fafafa;font-family:'Poppins',Arial,sans-serif;font-size:12px;color:#888;">
        &copy; ${new Date().getFullYear()} JLT Group. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>`;

const resend = new Resend(RESEND_API_KEY);

try {
  const result = await resend.emails.send({
    from: "JLT Group <noreply@thejltgroup.co.uk>",
    to: [toEmail],
    replyTo: "max@thejltgroup.co.uk",
    subject,
    html: fullHtml,
  });
  console.log("Email sent successfully:", JSON.stringify(result, null, 2));
  console.log("\nApplication URL sent:", applicationUrl);
} catch (err) {
  console.error("Failed to send email:", err);
  process.exit(1);
}
