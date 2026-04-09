import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST;
const port = parseInt(process.env.SMTP_PORT || '587');
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

if (!host || !user || !pass) {
  console.log('SMTP_NOT_CONFIGURED: credentials not yet set — this is expected if skipped during setup');
  process.exit(0);
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
});

transporter.verify((err) => {
  if (err) {
    console.error('SMTP_VERIFY_FAILED:', err.message);
    process.exit(1);
  } else {
    console.log('SMTP_OK: connection verified successfully');
    process.exit(0);
  }
});
