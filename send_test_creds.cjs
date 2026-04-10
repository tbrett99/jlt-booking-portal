const nodemailer = require("nodemailer");
require("dotenv").config({ path: ".env" });

const toEmail = "max@thejltgroup.co.uk";
const toName = "Max Kelly";
const tempPassword = "Example@123";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "465"),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

transporter.sendMail({
  from: `"JLT Group" <support@thejltgroup.co.uk>`,
  to: `"${toName}" <${toEmail}>`,
  subject: "Your JLT Group Booking Portal Account",
  html: `
    <div style="font-family: 'Poppins', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #FFF6ED; padding: 32px; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #414141; font-size: 24px; margin: 0;">JLT Group Booking Portal</h1>
        <div style="width: 60px; height: 4px; background: #70FFE8; margin: 12px auto 0;"></div>
      </div>
      <p style="color: #414141;">Hi ${toName},</p>
      <p style="color: #414141;">Your account has been created on the JLT Group Booking Portal. Please use the credentials below to log in.</p>
      <div style="background: #fff; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #02E6D2;">
        <p style="margin: 0; color: #414141;"><strong>Email:</strong> ${toEmail}</p>
        <p style="margin: 8px 0 0; color: #414141;"><strong>Temporary Password:</strong> ${tempPassword}</p>
      </div>
      <p style="color: #414141;">You will be prompted to change your password on first login.</p>
      <div style="text-align: center; margin: 28px 0;">
        <a href="https://portal.thejltgroup.co.uk" style="display: inline-block; background: #02E6D2; color: #414141; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px;">Log in to the Portal</a>
      </div>
      <p style="color: #414141; font-size: 13px;">Or copy and paste this link into your browser:<br><a href="https://portal.thejltgroup.co.uk" style="color: #02E6D2;">https://portal.thejltgroup.co.uk</a></p>
      <p style="color: #414141;">If you have any questions, please contact your administrator.</p>
      <p style="color: #414141; margin-top: 32px;">The JLT Group Team</p>
    </div>
  `,
}, (err, info) => {
  if (err) {
    console.error("Failed to send:", err.message);
    process.exit(1);
  } else {
    console.log("Sent successfully:", info.messageId);
  }
});
