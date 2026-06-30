/**
 * email.ts — all portal email sending via Resend API.
 * Nodemailer/SMTP is no longer used. Every send is logged to agent_emails
 * with status "sent" or "failed" so failures are visible in the admin email log.
 */
import { Resend } from "resend";
import { ENV } from "./_core/env";
import { getNotificationTemplate, areNotificationsPaused } from "./db";
import { getDb } from "./db";

// ─── Resend client ────────────────────────────────────────────────────────────
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    const key = ENV.resendApiKey;
    if (!key) throw new Error("RESEND_API_KEY is not configured");
    _resend = new Resend(key);
  }
  return _resend;
}

// Verified sending address (must match a verified domain in Resend)
const FROM_AGENT = "JLT Group <support@mail.thejltgroup.co.uk>";
const REPLY_TO_AGENT = "support@thejltgroup.co.uk";

// ─── Audit log ────────────────────────────────────────────────────────────────
async function logAgentEmail(params: {
  userId?: number | null;
  toEmail: string;
  toName?: string;
  subject: string;
  triggerKey?: string;
  bodyHtml?: string;
  status: "sent" | "failed";
  failureReason?: string;
}) {
  try {
    const db = await getDb();
    if (!db) return;
    const { agentEmails } = await import("../drizzle/schema");
    // Truncate bodyHtml to 500 KB to avoid packet-size issues
    const MAX_BODY = 500_000;
    const body = params.bodyHtml
      ? params.bodyHtml.length > MAX_BODY
        ? params.bodyHtml.slice(0, MAX_BODY) + "\n<!-- [truncated] -->"
        : params.bodyHtml
      : null;
    await db.insert(agentEmails).values({
      userId: params.userId ?? null,
      toEmail: params.toEmail,
      toName: params.toName ?? null,
      subject: params.subject,
      triggerKey: params.triggerKey ?? null,
      bodyHtml: body,
      status: params.status,
      sentAt: new Date(),
    });
  } catch (e) {
    // Non-critical — never block email sending
    console.error("[Email] Failed to log agent email:", e);
  }
}

// ─── Support notification (internal) ─────────────────────────────────────────
export async function sendSupportEmail(params: {
  subject: string;
  html: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const resend = getResend();
    await resend.emails.send({
      from: FROM_AGENT,
      replyTo: REPLY_TO_AGENT,
      to: "support@thejltgroup.co.uk",
      subject: params.subject,
      html: params.html,
    });
    return { success: true };
  } catch (err: any) {
    console.error("[Email] Failed to send support notification:", err?.message);
    return { success: false, error: err?.message };
  }
}

// ─── Portal reply footer ──────────────────────────────────────────────────────
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

// ─── Direct email ─────────────────────────────────────────────────────────────
// Bypasses template system; used for message notifications and ad-hoc sends.
// Pass `injectPortalFooter: true` (+ optional `bookingId`) to append the footer.
export async function sendDirectEmail(params: {
  toEmail: string;
  toName: string;
  subject: string;
  html: string;
  injectPortalFooter?: boolean;
  bookingId?: number;
  // Optional extras forwarded by callers via spread
  userId?: number | null;
  triggerKey?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (await areNotificationsPaused()) {
    console.log(`[Notifications] Paused — skipping direct email to ${params.toEmail}`);
    return { success: false, error: "Notifications are currently paused" };
  }
  let html = params.html;
  if (params.injectPortalFooter) {
    const footer = portalReplyFooter(params.bookingId);
    html = html.includes("<div")
      ? html.replace(/<\/div>\s*$/, `${footer}</div>`)
      : `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">${html}${footer}</div>`;
  }
  try {
    const resend = getResend();
    await resend.emails.send({
      from: FROM_AGENT,
      replyTo: REPLY_TO_AGENT,
      to: `${params.toName} <${params.toEmail}>`,
      subject: params.subject,
      html,
    });
    await logAgentEmail({
      userId: params.userId ?? null,
      toEmail: params.toEmail,
      toName: params.toName,
      subject: params.subject,
      triggerKey: params.triggerKey ?? "direct",
      bodyHtml: html,
      status: "sent",
    });
    return { success: true };
  } catch (err: any) {
    console.error("[Email] Failed to send direct email:", err?.message);
    await logAgentEmail({
      userId: params.userId ?? null,
      toEmail: params.toEmail,
      toName: params.toName,
      subject: params.subject,
      triggerKey: params.triggerKey ?? "direct",
      bodyHtml: html,
      status: "failed",
      failureReason: err?.message,
    });
    return { success: false, error: err?.message };
  }
}

// ─── Template-based notification email ───────────────────────────────────────
export async function sendNotificationEmail(params: {
  triggerKey: string;
  toEmail: string;
  toName: string;
  variables?: Record<string, string>;
  bookingId?: number;
  overrideSubject?: string;
  overrideBody?: string;
  userId?: number | null;
}): Promise<{ success: boolean; error?: string }> {
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

  const vars: Record<string, string> = {
    agentName: params.toName,
    toName: params.toName,
    bookingId: String(params.bookingId ?? ""),
    ...params.variables,
  };

  // Process {{#if key}}...{{/if}} conditional blocks
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

  const footer = portalReplyFooter(params.bookingId);
  const wrappedBody = body.includes("<div")
    ? body.replace(/<\/div>\s*$/, `${footer}</div>`)
    : `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">${body}${footer}</div>`;

  try {
    const resend = getResend();
    await resend.emails.send({
      from: FROM_AGENT,
      replyTo: REPLY_TO_AGENT,
      to: `${params.toName} <${params.toEmail}>`,
      subject,
      html: wrappedBody,
    });
    await logAgentEmail({
      userId: params.userId ?? null,
      toEmail: params.toEmail,
      toName: params.toName,
      subject,
      triggerKey: params.triggerKey,
      bodyHtml: wrappedBody,
      status: "sent",
    });
    return { success: true };
  } catch (err: any) {
    console.error("[Email] Failed to send notification email:", err?.message);
    await logAgentEmail({
      userId: params.userId ?? null,
      toEmail: params.toEmail,
      toName: params.toName,
      subject,
      triggerKey: params.triggerKey,
      bodyHtml: wrappedBody,
      status: "failed",
      failureReason: err?.message,
    });
    return { success: false, error: err?.message };
  }
}

// ─── Password reset email ─────────────────────────────────────────────────────
export async function sendPasswordResetEmail(params: {
  toEmail: string;
  toName: string;
  resetUrl: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const resend = getResend();
    await resend.emails.send({
      from: FROM_AGENT,
      replyTo: REPLY_TO_AGENT,
      to: `${params.toName} <${params.toEmail}>`,
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

// ─── Credentials email ────────────────────────────────────────────────────────
export async function sendCredentialsEmail(params: {
  toEmail: string;
  toName: string;
  tempPassword: string;
  userId?: number | null;
}): Promise<{ success: boolean; error?: string }> {
  const html = `
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
  `;
  try {
    const resend = getResend();
    await resend.emails.send({
      from: FROM_AGENT,
      replyTo: REPLY_TO_AGENT,
      to: `${params.toName} <${params.toEmail}>`,
      subject: "Your JLT Group Booking Portal Account",
      html,
    });
    await logAgentEmail({
      userId: params.userId ?? null,
      toEmail: params.toEmail,
      toName: params.toName,
      subject: "Your JLT Group Booking Portal Account",
      triggerKey: "credentials",
      bodyHtml: html,
      status: "sent",
    });
    return { success: true };
  } catch (err: any) {
    console.error("[Email] Failed to send credentials:", err?.message);
    await logAgentEmail({
      userId: params.userId ?? null,
      toEmail: params.toEmail,
      toName: params.toName,
      subject: "Your JLT Group Booking Portal Account",
      triggerKey: "credentials",
      bodyHtml: html,
      status: "failed",
      failureReason: err?.message,
    });
    return { success: false, error: err?.message };
  }
}
