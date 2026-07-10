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

// ─── Admin CC list ────────────────────────────────────────────────────────────
// Returns all active admin and super_admin email addresses to CC on agent emails.
let _adminEmailCache: { emails: string[]; fetchedAt: number } | null = null;
const ADMIN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getAdminCcEmails(): Promise<string[]> {
  const now = Date.now();
  if (_adminEmailCache && now - _adminEmailCache.fetchedAt < ADMIN_CACHE_TTL_MS) {
    return _adminEmailCache.emails;
  }
  try {
    const db = await getDb();
    if (!db) return [];
    const { users } = await import("../drizzle/schema");
    const { inArray, isNotNull } = await import("drizzle-orm");
    const rows = await db
      .select({ email: users.email })
      .from(users)
      .where(inArray(users.role, ["admin", "super_admin"]));
    const emails = rows
      .map((r) => r.email)
      .filter((e): e is string => !!e && e.includes("@"));
    _adminEmailCache = { emails, fetchedAt: now };
    return emails;
  } catch (e) {
    console.error("[Email] Failed to fetch admin CC list:", e);
    return [];
  }
}

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

// ─── HTML email wrapper with inline styles ────────────────────────────────────
// Wraps raw HTML body in a full email-safe container with inline CSS resets
// so that paragraphs, bullet lists, headings etc. render correctly in all
// email clients (Gmail, Outlook, Apple Mail) regardless of client CSS stripping.
function wrapEmailHtml(body: string, footer?: string): string {
  const content = footer ? `${body}${footer}` : body;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>JLT Group</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:#0d1a26;padding:20px 28px;text-align:left;">
              <span style="color:#70FFE8;font-size:20px;font-weight:700;letter-spacing:-0.5px;">JLT Group</span>
              <span style="color:#ffffff;font-size:14px;margin-left:8px;opacity:0.7;">Booking Portal</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px 28px 8px;color:#1a1a2e;font-size:15px;line-height:1.7;">
              <div style="
                color:#1a1a2e;
                font-size:15px;
                line-height:1.7;
              ">
                ${inlineEmailStyles(content)}
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:8px 28px 28px;">
              <p style="margin:24px 0 0;color:#888;font-size:12px;border-top:1px solid #eee;padding-top:16px;">
                This email was sent from the JLT Group Booking Portal. Please do not reply directly to this email — log in to the portal to respond.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Applies inline CSS to common HTML elements produced by the Tiptap editor
 * so they render correctly in email clients that strip <style> tags.
 */
function inlineEmailStyles(html: string): string {
  return html
    // Paragraphs — margin top/bottom so they don't collapse
    .replace(/<p(\s[^>]*)?>/gi, (m, attrs = "") =>
      `<p${attrs} style="margin:0 0 14px;color:#1a1a2e;font-size:15px;line-height:1.7;">`)
    // Bullet lists
    .replace(/<ul(\s[^>]*)?>/gi, (m, attrs = "") =>
      `<ul${attrs} style="margin:0 0 14px;padding-left:24px;color:#1a1a2e;font-size:15px;line-height:1.7;">`)
    // Ordered lists
    .replace(/<ol(\s[^>]*)?>/gi, (m, attrs = "") =>
      `<ol${attrs} style="margin:0 0 14px;padding-left:24px;color:#1a1a2e;font-size:15px;line-height:1.7;">`)
    // List items
    .replace(/<li(\s[^>]*)?>/gi, (m, attrs = "") =>
      `<li${attrs} style="margin:0 0 6px;color:#1a1a2e;font-size:15px;line-height:1.7;">`)
    // Headings
    .replace(/<h1(\s[^>]*)?>/gi, (m, attrs = "") =>
      `<h1${attrs} style="margin:0 0 16px;color:#0d1a26;font-size:22px;font-weight:700;line-height:1.3;">`)
    .replace(/<h2(\s[^>]*)?>/gi, (m, attrs = "") =>
      `<h2${attrs} style="margin:0 0 14px;color:#0d1a26;font-size:18px;font-weight:700;line-height:1.3;">`)
    .replace(/<h3(\s[^>]*)?>/gi, (m, attrs = "") =>
      `<h3${attrs} style="margin:0 0 12px;color:#0d1a26;font-size:16px;font-weight:700;line-height:1.3;">`)
    // Strong / bold
    .replace(/<strong(\s[^>]*)?>/gi, (m, attrs = "") =>
      `<strong${attrs} style="font-weight:700;color:#0d1a26;">`)
    // Blockquote
    .replace(/<blockquote(\s[^>]*)?>/gi, (m, attrs = "") =>
      `<blockquote${attrs} style="margin:0 0 14px;padding:10px 16px;border-left:4px solid #70FFE8;background:#f0fffe;color:#1a1a2e;font-style:italic;">`)
    // Links
    .replace(/<a(\s[^>]*)?>/gi, (m, attrs = "") =>
      `<a${attrs} style="color:#02E6D2;text-decoration:underline;">`);
}

// ─── Portal reply footer ──────────────────────────────────────────────────────
function portalReplyFooter(bookingId?: number): string {
  const bookingLink = bookingId
    ? `https://portal.thejltgroup.co.uk/bookings/${bookingId}`
    : `https://portal.thejltgroup.co.uk`;
  return `
    <div style="margin-top:24px;padding:16px 20px;background:#f0fffe;border-top:3px solid #02E6D2;border-radius:6px;">
      <p style="margin:0 0 10px;color:#1a1a2e;font-weight:700;font-size:14px;">&#128274; Please reply in the portal — not by email</p>
      <p style="margin:0 0 12px;color:#444;font-size:13px;line-height:1.6;">All communication should be kept inside the JLT Group Booking Portal so nothing gets missed. Click the button below to view your booking and reply.</p>
      <a href="${bookingLink}" style="display:inline-block;background:#02E6D2;color:#1a1a2e;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;">Open in Portal &rarr;</a>
    </div>
  `;
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

// ─── Direct email ─────────────────────────────────────────────────────────────
// Bypasses template system; used for message notifications and ad-hoc sends.
export async function sendDirectEmail(params: {
  toEmail: string;
  toName: string;
  subject: string;
  html: string;
  injectPortalFooter?: boolean;
  bookingId?: number;
  userId?: number | null;
  triggerKey?: string;
  skipAdminCc?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  if (await areNotificationsPaused()) {
    console.log(`[Notifications] Paused — skipping direct email to ${params.toEmail}`);
    return { success: false, error: "Notifications are currently paused" };
  }

  const footer = params.injectPortalFooter ? portalReplyFooter(params.bookingId) : undefined;
  const html = wrapEmailHtml(params.html, footer);

  const adminCc = params.skipAdminCc ? [] : await getAdminCcEmails();

  try {
    const resend = getResend();
    await resend.emails.send({
      from: FROM_AGENT,
      replyTo: REPLY_TO_AGENT,
      to: `${params.toName} <${params.toEmail}>`,
      ...(adminCc.length > 0 ? { cc: adminCc } : {}),
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
  skipAdminCc?: boolean;
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
  const html = wrapEmailHtml(body, footer);

  const adminCc = params.skipAdminCc ? [] : await getAdminCcEmails();

  try {
    const resend = getResend();
    await resend.emails.send({
      from: FROM_AGENT,
      replyTo: REPLY_TO_AGENT,
      to: `${params.toName} <${params.toEmail}>`,
      ...(adminCc.length > 0 ? { cc: adminCc } : {}),
      subject,
      html,
    });
    await logAgentEmail({
      userId: params.userId ?? null,
      toEmail: params.toEmail,
      toName: params.toName,
      subject,
      triggerKey: params.triggerKey,
      bodyHtml: html,
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
      bodyHtml: html,
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
  const html = wrapEmailHtml(`
    <p>Hi ${params.toName},</p>
    <p>We received a request to reset your password. Click the button below to set a new password. This link expires in 1 hour.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${params.resetUrl}" style="display:inline-block;background:#02E6D2;color:#1a1a2e;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Reset Password</a>
    </div>
    <p style="color:#888;font-size:13px;">If you didn't request a password reset, you can safely ignore this email. The link will expire in 1 hour.</p>
    <p>The JLT Group Team</p>
  `);
  try {
    const resend = getResend();
    await resend.emails.send({
      from: FROM_AGENT,
      replyTo: REPLY_TO_AGENT,
      to: `${params.toName} <${params.toEmail}>`,
      subject: "Reset your JLT Group Booking Portal password",
      html,
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
  const html = wrapEmailHtml(`
    <p>Hi ${params.toName},</p>
    <p>Your account has been created on the JLT Group Booking Portal. Please use the credentials below to log in.</p>
    <div style="background:#f0fffe;border-radius:8px;padding:20px;margin:20px 0;border-left:4px solid #02E6D2;">
      <p style="margin:0;"><strong>Email:</strong> ${params.toEmail}</p>
      <p style="margin:8px 0 0;"><strong>Temporary Password:</strong> ${params.tempPassword}</p>
    </div>
    <p>You will be prompted to change your password on first login.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="https://portal.thejltgroup.co.uk" style="display:inline-block;background:#02E6D2;color:#1a1a2e;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;">Log in to the Portal</a>
    </div>
    <p style="font-size:13px;color:#888;">Or copy and paste this link: <a href="https://portal.thejltgroup.co.uk" style="color:#02E6D2;">https://portal.thejltgroup.co.uk</a></p>
    <p>If you have any questions, please contact your administrator.</p>
    <p>The JLT Group Team</p>
  `);
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
