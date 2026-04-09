import nodemailer from "nodemailer";
import * as dotenv from "dotenv";
dotenv.config();

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

console.log(`Connecting to ${SMTP_HOST}:${SMTP_PORT} as ${SMTP_USER}`);

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: Number(SMTP_PORT) === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  tls: { rejectUnauthorized: false },
});

try {
  await transporter.verify();
  console.log("✅ SMTP connection verified");

  const info = await transporter.sendMail({
    from: `"JLT Group Booking Portal" <support@thejltgroup.co.uk>`,
    to: "max@thejltgroup.co.uk",
    subject: "✅ JLT Portal — Test Email",
    html: `
      <div style="font-family: Poppins, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #FFF6ED; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #414141; font-size: 24px; margin: 0;">JLT Group Booking Portal</h1>
          <p style="color: #02E6D2; font-size: 14px; margin: 4px 0 0;">Email Notification Test</p>
        </div>
        <div style="background: white; border-radius: 8px; padding: 24px; border-left: 4px solid #02E6D2;">
          <h2 style="color: #414141; margin-top: 0;">This is a test email</h2>
          <p style="color: #414141; line-height: 1.6;">
            If you're reading this, the JLT Group Booking Portal email notification system is working correctly.
            Emails will be sent from <strong>support@thejltgroup.co.uk</strong> for all booking pipeline events.
          </p>
          <p style="color: #414141; line-height: 1.6;">
            Notification triggers include:
          </p>
          <ul style="color: #414141; line-height: 2;">
            <li>New booking registered</li>
            <li>Booking added to PTS</li>
            <li>Commission claimable</li>
            <li>Commission claimed</li>
            <li>Commission paid</li>
            <li>Amendment actioned</li>
            <li>Booking cancelled</li>
          </ul>
        </div>
        <p style="text-align: center; color: #999; font-size: 12px; margin-top: 24px;">
          JLT Group Booking Portal &bull; support@thejltgroup.co.uk
        </p>
      </div>
    `,
  });

  console.log("✅ Test email sent! Message ID:", info.messageId);
} catch (err) {
  console.error("❌ Error:", err.message);
  process.exit(1);
}
