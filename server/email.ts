import nodemailer from "nodemailer";
import { getNotificationTemplate, areNotificationsPaused } from "./db";
import { getDb } from "./db";

// Log an email sent to an agent into the agent_emails audit table
async function logAgentEmail(params: {
  userId?: number | null;
  toEmail: string;
  toName?: string;
  subject: string;
  triggerKey?: string;
  bodyHtml?: string;
  status?: string;
}) {
  try {
    const db = await getDb();
    if (!db) return;
    const { agentEmails } = await import("../drizzle/schema");
    await db.insert(agentEmails).values({
      userId: params.userId ?? null,
      toEmail: params.toEmail,
      toName: params.toName ?? null,
      subject: params.subject,
      triggerKey: params.triggerKey ?? null,
      bodyHtml: params.bodyHtml ?? null,
      status: params.status ?? "sent",
      sentAt: new Date(),
    });
  } catch (e) {
    // Non-critical — never block email sending
    console.error("[Email] Failed to log agent email:", e);
  }
}

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

// Support team notification email — sends to support@thejltgroup.co.uk
export async function sendSupportEmail(params: {
  subject: string;
  html: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const t = getTransporter();
    await t.sendMail({
      from: `"JLT Group Portal" <support@thejltgroup.co.uk>`,
      to: `"JLT Support" <support@thejltgroup.co.uk>`,
      subject: params.subject,
      html: params.html,
    });
    return { success: true };
  } catch (err: any) {
    console.error("[Email] Failed to send support notification:", err?.message);
    return { success: false, error: err?.message };
  }
}

// Direct email — bypasses template system, used for message notifications
// Pass `injectPortalFooter: true` (+ optional `bookingId`) to append the
// "Please reply in the portal" footer to agent-facing messages.
export async function sendDirectEmail(params: {
  toEmail: string;
  toName: string;
  subject: string;
  html: string;
  injectPortalFooter?: boolean;
  bookingId?: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    if (await areNotificationsPaused()) {
      console.log(`[Notifications] Paused — skipping direct email to ${params.toEmail}`);
      return { success: false, error: "Notifications are currently paused" };
    }
    let html = params.html;
    if (params.injectPortalFooter) {
      const footer = portalReplyFooter(params.bookingId);
      html = html.includes('<div')
        ? html.replace(/<\/div>\s*$/, `${footer}</div>`)
        : `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">${html}${footer}</div>`;
    }
    const t = getTransporter();
    await t.sendMail({
      from: `"JLT Group" <support@thejltgroup.co.uk>`,
      to: `"${params.toName}" <${params.toEmail}>`,
      subject: params.subject,
      html,
    });
    // Log to agent_emails audit table (non-blocking)
    await logAgentEmail({
      userId: (params as any).userId ?? null,
      toEmail: params.toEmail,
      toName: params.toName,
      subject: params.subject,
      triggerKey: (params as any).triggerKey ?? "direct",
      bodyHtml: html,
      status: "sent",
    });
    return { success: true };
  } catch (err: any) {
    console.error("[Email] Failed to send direct email:", err?.message);
    return { success: false, error: err?.message };
  }
}

// Standard portal reply footer injected into all agent-facing emails
function portalReplyFooter(bookingId?: number): string {
  const bookingLink = bookingId
    ? `https://portal.thejltgroup.co.uk/bookings/${bookingId}`
    : `https://portal.thejltgroup.co.uk`;
  return `
    <div style="margin-top:28px;padding:16px 20px;background:#f0fffe;border-top:3px solid #02E6D2;border-radius:0 0 8px 8px;">
      <p style="margin:0 0 10px;color:#1a1a2e;font-weight:600;font-size:14px;">&#128274; Please reply in the portal — not by email</p>
      <p style="margin:0 0 12px;color:#444;font-size:13px;">All communication should be kept inside the JLT Group Booking Portal so nothing gets missed. Click the button below to view your booking and reply.</p>
      <a href="${bookingLink}" style="display:inline-block;background:#02E6D2;color:#1a1a2e;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;">Open in Portal &rarr;</a>
    </div>
  `;
}

export async function sendNotificationEmail(params: {
  triggerKey: string;
  toEmail: string;
  toName: string;
  variables?: Record<string, string>;
  bookingId?: number;
  overrideSubject?: string;
  overrideBody?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    // Respect global notifications kill-switch
    if (await areNotificationsPaused()) {
      console.log(`[Notifications] Paused — skipping email (${params.triggerKey}) to ${params.toEmail}`);
      return { success: false, error: "Notifications are currently paused" };
    }
    const template = await getNotificationTemplate(params.triggerKey);
    if (!template || !template.isActive) {
      return { success: false, error: "Template not found or inactive" };
    }

    let subject = params.overrideSubject ?? template.subject;
    let body = params.overrideBody ?? template.bodyHtml;

    // Replace template variables like {{clientName}}, {{bookingId}}, etc.
    const vars: Record<string, string> = {
      agentName: params.toName,
      toName: params.toName,   // alias so templates can use either
      bookingId: String(params.bookingId ?? ""),
      ...params.variables,
    };

    // Process {{#if key}}...{{/if}} conditional blocks before simple substitution
    body = body.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_match, key, inner) => {
      const val = vars[key];
      return val && val.trim() ? inner : "";
    });
    subject = subject.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_match, key, inner) => {
      const val = vars[key];
      return val && val.trim() ? inner : "";
    });

    for (const [key, value] of Object.entries(vars)) {
      subject = subject.replace(new RegExp(`{{${key}}}`, "g"), value);
      body = body.replace(new RegExp(`{{${key}}}`, "g"), value);
    }

    // Append portal reply footer to all agent-facing notification emails
    const footer = portalReplyFooter(params.bookingId);
    // Wrap body in a container if it isn't already, then append footer
    const wrappedBody = body.includes('<div') 
      ? body.replace(/<\/div>\s*$/, `${footer}</div>`)
      : `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">${body}${footer}</div>`;

    const t = getTransporter();
    await t.sendMail({
      from: `"JLT Group" <support@thejltgroup.co.uk>`,
      to: `"${params.toName}" <${params.toEmail}>`,
      subject,
      html: wrappedBody,
    });
    // Log to agent_emails audit table (non-blocking)
    await logAgentEmail({
      userId: (params as any).userId ?? null,
      toEmail: params.toEmail,
      toName: params.toName,
      subject,
      triggerKey: params.triggerKey,
      bodyHtml: wrappedBody,
      status: "sent",
    });
    return { success: true };
  } catch (err: any) {
    console.error("[Email] Failed to send:", err?.message);
    return { success: false, error: err?.message };
  }
}

export async function sendPasswordResetEmail(params: {
  toEmail: string;
  toName: string;
  resetUrl: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const t = getTransporter();
    await t.sendMail({
      from: `"JLT Group" <support@thejltgroup.co.uk>`,
      to: `"${params.toName}" <${params.toEmail}>`,
      subject: "Reset your JLT Group Booking Portal password",
      html: `
        <div style="font-family: 'Poppins', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #FFF6ED; padding: 32px; border-radius: 12px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #414141; font-size: 24px; margin: 0;">JLT Group Booking Portal</h1>
            <div style="width: 60px; height: 4px; background: #70FFE8; margin: 12px auto 0;"></div>
          </div>
          <p style="color: #414141;">Hi ${params.toName},</p>
          <p style="color: #414141;">We received a request to reset your password. Click the button below to set a new password. This link expires in 1 hour.</p>
          <div style="text-align: center; margin: 28px 0;">
            <a href="${params.resetUrl}" style="background: #02E6D2; color: #414141; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Reset Password</a>
          </div>
          <p style="color: #888; font-size: 13px;">If you didn't request a password reset, you can safely ignore this email. The link will expire in 1 hour.</p>
          <p style="color: #414141; margin-top: 32px;">The JLT Group Team</p>
        </div>
      `,
    });
    return { success: true };
  } catch (err: any) {
    console.error("[Email] Failed to send password reset:", err?.message);
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
          <div style="text-align: center; margin: 28px 0;">
            <a href="https://portal.thejltgroup.co.uk" style="display: inline-block; background: #02E6D2; color: #414141; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px;">Log in to the Portal</a>
          </div>
          <p style="color: #414141; font-size: 13px;">Or copy and paste this link into your browser:<br><a href="https://portal.thejltgroup.co.uk" style="color: #02E6D2;">https://portal.thejltgroup.co.uk</a></p>
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
