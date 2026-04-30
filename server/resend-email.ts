/**
 * Resend email helper for the JLT email marketing system.
 * Handles campaign sends, drip step sends, open/click tracking pixel injection,
 * branded HTML wrapper, reply-to headers, and unsubscribe token injection.
 */
import { Resend } from "resend";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { emailSends, emailUnsubscribes } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { getEmailBrandingSettings } from "./crm-db";
import type { EmailBrandingSettings } from "../drizzle/schema";

// Lazy-init Resend client
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    const key = ENV.resendApiKey;
    if (!key) throw new Error("RESEND_API_KEY is not configured");
    _resend = new Resend(key);
  }
  return _resend;
}

// Sending addresses
export const PROSPECT_FROM = "JLT Group <jointheteam@mail.thejltgroup.co.uk>";
export const AGENT_FROM = "JLT Group <support@mail.thejltgroup.co.uk>";
export const PROSPECT_REPLY_TO = "jointheteam@thejltgroup.co.uk";
export const AGENT_REPLY_TO = "support@thejltgroup.co.uk";

export function getFromAddress(audienceType: "prospect" | "agent"): string {
  return audienceType === "prospect" ? PROSPECT_FROM : AGENT_FROM;
}

export function getReplyTo(audienceType: "prospect" | "agent"): string {
  return audienceType === "prospect" ? PROSPECT_REPLY_TO : AGENT_REPLY_TO;
}

/**
 * Generate a unique unsubscribe token for a recipient.
 */
async function getOrCreateUnsubscribeToken(email: string, prospectId?: number): Promise<string> {
  const db = await getDb();
  if (!db) return crypto.randomBytes(32).toString("hex");
  // Check if token already exists for this email
  const existing = await db.select().from(emailUnsubscribes).where(eq(emailUnsubscribes.email, email)).limit(1);
  if (existing.length > 0) return existing[0].token;
  const token = crypto.randomBytes(32).toString("hex");
  await db.insert(emailUnsubscribes).values({ email, token, prospectId: prospectId ?? null });
  return token;
}

/**
 * Check if an email address has unsubscribed.
 */
export async function isUnsubscribed(email: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select().from(emailUnsubscribes).where(eq(emailUnsubscribes.email, email)).limit(1);
  return rows.length > 0 && rows[0].unsubscribedAt != null;
}

/**
 * Process an unsubscribe by token — marks the record as unsubscribed.
 * Returns the email address that was unsubscribed, or null if token not found.
 */
export async function processUnsubscribe(token: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(emailUnsubscribes).where(eq(emailUnsubscribes.token, token)).limit(1);
  if (rows.length === 0) return null;
  // Already unsubscribed — just return the email
  return rows[0].email;
}

/**
 * Wrap all links in the HTML body with a click-tracking redirect.
 */
function injectClickTracking(html: string, sendId: number, baseUrl: string): string {
  return html.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_match, url) => {
      // Don't wrap the unsubscribe link
      if (url.includes("/unsubscribe")) return `href="${url}"`;
      const tracked = `${baseUrl}/api/email-track/click?sid=${sendId}&url=${encodeURIComponent(url)}`;
      return `href="${tracked}"`;
    }
  );
}

/**
 * Inject a 1×1 transparent tracking pixel at the end of the HTML body.
 */
function injectOpenPixel(html: string, sendId: number, baseUrl: string): string {
  const pixel = `<img src="${baseUrl}/api/email-track/open?sid=${sendId}" width="1" height="1" style="display:none" alt="" />`;
  return html.replace(/<\/body>/i, `${pixel}</body>`) + (html.includes("</body>") ? "" : pixel);
}

/**
 * Wrap the user-composed HTML in a branded JLT email template.
 */
function wrapInBrandedTemplate(opts: {
  bodyHtml: string;
  audienceType: "prospect" | "agent";
  unsubscribeUrl?: string;
  branding?: EmailBrandingSettings | null;
}): string {
  const year = new Date().getFullYear();
  const b = opts.branding;

  // Colours — fall back to JLT defaults
  const headerBg = b?.headerBgColor ?? "#70FFE8";
  const headerText = b?.headerTextColor ?? "#414141";
  const bodyBg = b?.bodyBgColor ?? "#f5f5f5";
  const cardBg = b?.cardBgColor ?? "#ffffff";
  const accent = b?.accentColor ?? "#02E6D2";
  const companyName = b?.companyName ?? "JLT Group";
  const tagline = b?.tagline ?? "";
  const footerText = b?.footerText ?? `&copy; ${year} ${companyName}. All rights reserved.`;

  // Logo or text fallback
  const logoHtml = b?.logoUrl
    ? `<img src="${b.logoUrl}" alt="${companyName}" style="max-height:60px;max-width:200px;display:block;margin:0 auto;object-fit:contain;" />`
    : `<span style="font-family:'Poppins',Arial,sans-serif;font-size:22px;font-weight:700;color:${headerText};letter-spacing:-0.5px;">${companyName}</span>`;

  // Social links
  const socials = [
    b?.websiteUrl && `<a href="${b.websiteUrl}" style="color:${accent};text-decoration:none;margin:0 6px;font-family:'Poppins',Arial,sans-serif;font-size:12px;">Website</a>`,
    b?.facebookUrl && `<a href="${b.facebookUrl}" style="color:${accent};text-decoration:none;margin:0 6px;font-family:'Poppins',Arial,sans-serif;font-size:12px;">Facebook</a>`,
    b?.instagramUrl && `<a href="${b.instagramUrl}" style="color:${accent};text-decoration:none;margin:0 6px;font-family:'Poppins',Arial,sans-serif;font-size:12px;">Instagram</a>`,
    b?.twitterUrl && `<a href="${b.twitterUrl}" style="color:${accent};text-decoration:none;margin:0 6px;font-family:'Poppins',Arial,sans-serif;font-size:12px;">Twitter</a>`,
    b?.linkedinUrl && `<a href="${b.linkedinUrl}" style="color:${accent};text-decoration:none;margin:0 6px;font-family:'Poppins',Arial,sans-serif;font-size:12px;">LinkedIn</a>`,
  ].filter(Boolean).join("");

  const unsubscribeSection = opts.unsubscribeUrl
    ? `<tr><td style="padding:16px 40px;text-align:center;">
        <p style="font-family:'Poppins',Arial,sans-serif;font-size:12px;color:#999;margin:0;">
          You're receiving this email because you enquired about joining the JLT Group.<br/>
          <a href="${opts.unsubscribeUrl}" style="color:${accent};text-decoration:underline;">Unsubscribe</a>
        </p>
      </td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${companyName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background-color:${bodyBg};font-family:'Poppins',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${bodyBg};padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${cardBg};border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:${headerBg};padding:28px 40px;text-align:center;">
              ${logoHtml}
              ${tagline ? `<div style="font-family:'Poppins',Arial,sans-serif;font-size:13px;color:${headerText};opacity:0.75;margin-top:6px;">${tagline}</div>` : ""}
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;color:#414141;font-family:'Poppins',Arial,sans-serif;font-size:15px;line-height:1.7;">
              ${opts.bodyHtml}
            </td>
          </tr>
          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <hr style="border:none;border-top:1px solid #f0f0f0;margin:0;"/>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;text-align:center;background-color:#fafafa;">
              ${socials ? `<div style="margin-bottom:10px;">${socials}</div>` : ""}
              <p style="font-family:'Poppins',Arial,sans-serif;font-size:12px;color:#999;margin:0;">
                ${footerText}
              </p>
            </td>
          </tr>
          ${unsubscribeSection}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Create a send record in the DB and return its ID.
 */
async function createSendRecord(data: {
  campaignId?: number;
  dripStepId?: number;
  enrollmentId?: number;
  recipientEmail: string;
  recipientName?: string;
  recipientType: "prospect" | "agent";
  recipientId?: number;
  subject: string;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(emailSends).values({
    ...data,
    status: "queued",
  });
  return (result as { insertId: number }).insertId;
}

/**
 * Update send record status and timestamps.
 */
async function updateSendStatus(
  sendId: number,
  status: "sent" | "failed",
  resendMessageId?: string,
  failedReason?: string
) {
  const db = await getDb();
  if (!db) return;
  await db.update(emailSends).set({
    status,
    resendMessageId: resendMessageId ?? null,
    sentAt: status === "sent" ? new Date() : undefined,
    failedReason: failedReason ?? null,
  }).where(eq(emailSends.id, sendId));
}

/**
 * Send a single email via Resend with open/click tracking and branded wrapper.
 * Returns the send record ID.
 */
export async function sendMarketingEmail(opts: {
  to: string;
  toName?: string;
  subject: string;
  bodyHtml: string;
  audienceType: "prospect" | "agent";
  recipientType: "prospect" | "agent";
  recipientId?: number;
  campaignId?: number;
  dripStepId?: number;
  enrollmentId?: number;
  baseUrl: string;
}): Promise<{ sendId: number; success: boolean; error?: string }> {
  const sendId = await createSendRecord({
    campaignId: opts.campaignId,
    dripStepId: opts.dripStepId,
    enrollmentId: opts.enrollmentId,
    recipientEmail: opts.to,
    recipientName: opts.toName,
    recipientType: opts.recipientType,
    recipientId: opts.recipientId,
    subject: opts.subject,
  });

  // Build unsubscribe URL for prospect emails
  let unsubscribeUrl: string | undefined;
  if (opts.audienceType === "prospect") {
    const token = await getOrCreateUnsubscribeToken(opts.to, opts.recipientId);
    unsubscribeUrl = `${opts.baseUrl}/unsubscribe?token=${token}`;
  }

  // Load branding settings (cached per process — acceptable for email sends)
  const branding = await getEmailBrandingSettings();

  // Wrap in branded template
  let html = wrapInBrandedTemplate({
    bodyHtml: opts.bodyHtml,
    audienceType: opts.audienceType,
    unsubscribeUrl,
    branding,
  });

  // Inject tracking
  html = injectOpenPixel(html, sendId, opts.baseUrl);
  html = injectClickTracking(html, sendId, opts.baseUrl);

  try {
    const resend = getResend();
    const result = await resend.emails.send({
      from: getFromAddress(opts.audienceType),
      replyTo: getReplyTo(opts.audienceType),
      to: opts.to,
      subject: opts.subject,
      html,
    });

    if (result.error) {
      await updateSendStatus(sendId, "failed", undefined, result.error.message);
      return { sendId, success: false, error: result.error.message };
    }

    await updateSendStatus(sendId, "sent", result.data?.id);
    return { sendId, success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateSendStatus(sendId, "failed", undefined, msg);
    return { sendId, success: false, error: msg };
  }
}

/**
 * Send a campaign to a list of recipients.
 * Automatically skips unsubscribed prospect emails.
 * Returns { sent, failed, skipped } counts.
 */
export async function sendCampaignBatch(opts: {
  campaignId: number;
  recipients: Array<{ email: string; name?: string; id?: number; type: "prospect" | "agent" }>;
  subject: string;
  bodyHtml: string;
  audienceType: "prospect" | "agent";
  baseUrl: string;
}): Promise<{ sent: number; failed: number; skipped: number }> {
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of opts.recipients) {
    // Skip unsubscribed prospects
    if (opts.audienceType === "prospect") {
      const unsub = await isUnsubscribed(r.email);
      if (unsub) { skipped++; continue; }
    }

    const result = await sendMarketingEmail({
      to: r.email,
      toName: r.name,
      subject: opts.subject,
      bodyHtml: opts.bodyHtml,
      audienceType: opts.audienceType,
      recipientType: r.type,
      recipientId: r.id,
      campaignId: opts.campaignId,
      baseUrl: opts.baseUrl,
    });
    if (result.success) sent++;
    else failed++;
    // Small delay to avoid rate limiting (100ms between sends)
    await new Promise((res) => setTimeout(res, 100));
  }

  return { sent, failed, skipped };
}
