import nodemailer from "nodemailer";
import { getNotificationTemplate } from "./db";

// Always create a fresh transporter so env changes take effect without restart
function getTransporter() {
  const port = Number(process.env.SMTP_PORT ?? 465);
  const secure = port === 465 || process.env.SMTP_SECURE === "true";
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "mail.thejltgroup.co.uk",
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendNotificationEmail(params: {
  triggerKey: string;
  toEmail: string;
  toName: string;
  variables?: Record<string, string>;
  bookingId?: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const template = await getNotificationTemplate(params.triggerKey);
    if (!template || !template.isActive) {
      return { success: false, error: "Template not found or inactive" };
    }

    let subject = template.subject;
    let body = template.bodyHtml;

    // Replace template variables like {{clientName}}, {{bookingId}}, etc.
    const vars: Record<string, string> = {
      agentName: params.toName,
      bookingId: String(params.bookingId ?? ""),
      ...params.variables,
    };
    for (const [key, value] of Object.entries(vars)) {
      subject = subject.replace(new RegExp(`{{${key}}}`, "g"), value);
      body = body.replace(new RegExp(`{{${key}}}`, "g"), value);
    }

    const t = getTransporter();
    await t.sendMail({
      from: `"JLT Group" <support@thejltgroup.co.uk>`,
      to: `"${params.toName}" <${params.toEmail}>`,
      subject,
      html: body,
    });

    return { success: true };
  } catch (err: any) {
    console.error("[Email] Failed to send:", err?.message);
    return { success: false, error: err?.message };
  }
}

export async function sendCredentialsEmail(params: {
  toEmail: string;
  toName: string;
  tempPassword: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const t = getTransporter();
    await t.sendMail({
      from: `"JLT Group" <support@thejltgroup.co.uk>`,
      to: `"${params.toName}" <${params.toEmail}>`,
      subject: "Your JLT Group Booking Portal Account",
      html: `
        <div style="font-family: 'Poppins', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #FFF6ED; padding: 32px; border-radius: 12px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #414141; font-size: 24px; margin: 0;">JLT Group Booking Portal</h1>
            <div style="width: 60px; height: 4px; background: #70FFE8; margin: 12px auto 0;"></div>
          </div>
          <p style="color: #414141;">Hi ${params.toName},</p>
          <p style="color: #414141;">Your account has been created on the JLT Group Booking Portal. Please use the credentials below to log in.</p>
          <div style="background: #fff; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #02E6D2;">
            <p style="margin: 0; color: #414141;"><strong>Email:</strong> ${params.toEmail}</p>
            <p style="margin: 8px 0 0; color: #414141;"><strong>Temporary Password:</strong> ${params.tempPassword}</p>
          </div>
          <p style="color: #414141;">You will be prompted to change your password on first login.</p>
          <p style="color: #414141;">If you have any questions, please contact your administrator.</p>
          <p style="color: #414141; margin-top: 32px;">The JLT Group Team</p>
        </div>
      `,
    });
    return { success: true };
  } catch (err: any) {
    console.error("[Email] Failed to send credentials:", err?.message);
    return { success: false, error: err?.message };
  }
}
