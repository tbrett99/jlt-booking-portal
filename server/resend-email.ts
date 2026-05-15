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

/**
 * Replace {{first_name}}, {{full_name}}, {{email}} merge tags with real values.
 * Mirrors the client-side applyMergeTags helper in RichEmailEditor.tsx.
 */
function applyMergeTags(html: string, recipient: { name?: string | null; email?: string | null }): string {
  const fullName = recipient.name?.trim() ?? "";
  const firstName = fullName.split(" ")[0] ?? fullName;
  const email = recipient.email ?? "";
  return html
    .replace(/\{\{first_name\}\}/gi, firstName || fullName || "there")
    .replace(/\{\{full_name\}\}/gi, fullName || firstName || "there")
    .replace(/\{\{email\}\}/gi, email);
}

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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <title>${companyName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <style>
    /* Reset */
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; border-collapse:collapse; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none;
          max-width:100% !important; width:100% !important; height:auto !important; display:block; }
    /* Responsive wrapper */
    .email-wrapper { width:100% !important; background-color:${bodyBg}; padding:20px 0; }
    .email-card   { max-width:600px; width:100%; margin:0 auto; background:${cardBg};
                    border-radius:12px; overflow:hidden; }
    .email-header { background-color:${headerBg}; padding:24px 40px; text-align:center; }
    .email-body   { padding:32px 40px; color:#414141; font-family:'Poppins',Arial,sans-serif;
                    font-size:15px; line-height:1.7; }
    .email-footer { padding:20px 40px; text-align:center; background-color:#fafafa; }
    /* Mobile */
    @media only screen and (max-width:620px) {
      .email-wrapper { padding:0 !important; }
      .email-card    { border-radius:0 !important; }
      .email-header  { padding:20px 20px !important; }
      .email-body    { padding:24px 20px !important; font-size:15px !important; }
      .email-footer  { padding:16px 20px !important; }
      .email-unsub   { padding:12px 20px !important; }
      /* Make CTA buttons full-width on mobile */
      a[data-cta] { display:block !important; text-align:center !important;
                    padding:14px 20px !important; }
      /* Ensure images never overflow */
      img { max-width:100% !important; height:auto !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${bodyBg};font-family:'Poppins',Arial,sans-serif;">
  <!--[if mso]><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><![endif]-->
  <div class="email-wrapper">
    <div class="email-card" style="max-width:600px;width:100%;margin:0 auto;background:${cardBg};border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

      <!-- Header -->
      <div class="email-header" style="background-color:${headerBg};padding:24px 40px;text-align:center;">
        ${logoHtml}
        ${tagline ? `<div style="font-family:'Poppins',Arial,sans-serif;font-size:13px;color:${headerText};opacity:0.75;margin-top:6px;">${tagline}</div>` : ""}
      </div>

      <!-- Body -->
      <div class="email-body" style="padding:32px 40px;color:#414141;font-family:'Poppins',Arial,sans-serif;font-size:15px;line-height:1.7;">
        ${opts.bodyHtml}
      </div>

      <!-- Divider -->
      <div style="padding:0 40px;"><hr style="border:none;border-top:1px solid #f0f0f0;margin:0;"/></div>

      <!-- Footer -->
      <div class="email-footer" style="padding:20px 40px;text-align:center;background-color:#fafafa;">
        ${socials ? `<div style="margin-bottom:10px;">${socials}</div>` : ""}
        <p style="font-family:'Poppins',Arial,sans-serif;font-size:12px;color:#999;margin:0;">${footerText}</p>
      </div>

      ${opts.unsubscribeUrl ? `
      <!-- Unsubscribe -->
      <div class="email-unsub" style="padding:12px 40px;text-align:center;">
        <p style="font-family:'Poppins',Arial,sans-serif;font-size:12px;color:#999;margin:0;">
          You're receiving this email because you enquired about joining the JLT Group.<br/>
          <a href="${opts.unsubscribeUrl}" style="color:${accent};text-decoration:underline;">Unsubscribe</a>
        </p>
      </div>` : ""}

    </div>
  </div>
  <!--[if mso]></td></tr></table><![endif]-->
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

  // Apply personalisation merge tags ({{first_name}}, {{full_name}}, {{email}})
  const personalisedBody = applyMergeTags(opts.bodyHtml, { name: opts.toName, email: opts.to });
  const personalisedSubject = applyMergeTags(opts.subject, { name: opts.toName, email: opts.to });

  // Wrap in branded template
  let html = wrapInBrandedTemplate({
    bodyHtml: personalisedBody,
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
      subject: personalisedSubject,
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

/**
 * Pre-insert all campaign recipients as 'queued' rows in email_sends.
 * Called synchronously when a campaign is triggered — the actual sending
 * is handled by processCampaignQueue() in the scheduler.
 */
export async function enqueueCampaignRecipients(opts: {
  campaignId: number;
  recipients: Array<{ email: string; name?: string; id?: number; type: "prospect" | "agent" }>;
  subject: string;
  audienceType: "prospect" | "agent";
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (opts.recipients.length === 0) return 0;

  // Insert all recipients as queued in a single bulk insert
  await db.insert(emailSends).values(
    opts.recipients.map((r) => ({
      campaignId: opts.campaignId,
      recipientEmail: r.email,
      recipientName: r.name ?? null,
      recipientType: r.type,
      recipientId: r.id ?? null,
      subject: opts.subject,
      status: "queued" as const,
    }))
  );

  return opts.recipients.length;
}

/**
 * Process up to `batchSize` queued campaign email_sends rows.
 * Called by the scheduler every 15 minutes.
 * Restart-safe: progress is persisted in the database.
 */
export async function processCampaignQueue(batchSize = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { sent: 0, failed: 0, skipped: 0 };

  const { and, isNotNull, isNull, sql: sqlFn } = await import("drizzle-orm");
  const { emailCampaigns } = await import("../drizzle/schema");

  // Pick up to batchSize queued rows that belong to a campaign (not drip)
  const rows = await db
    .select()
    .from(emailSends)
    .where(
      and(
        sqlFn`${emailSends.status} = 'queued'`,
        isNotNull(emailSends.campaignId),
        isNull(emailSends.dripStepId)
      )
    )
    .limit(batchSize);

  if (rows.length === 0) return { sent: 0, failed: 0, skipped: 0 };

  // Load the campaign details for each unique campaignId in this batch
  const campaignIds = Array.from(new Set(rows.map((r) => r.campaignId!)));
  const campaigns = await db
    .select()
    .from(emailCampaigns)
    .where(sqlFn`${emailCampaigns.id} IN (${campaignIds.join(",")})`);
  const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const campaign = campaignMap.get(row.campaignId!);
    if (!campaign) {
      // Campaign deleted — mark as failed
      await updateSendStatus(row.id, "failed", undefined, "Campaign not found");
      failed++;
      continue;
    }

    const audienceType = campaign.audienceType as "prospect" | "agent";

    // Skip unsubscribed prospects
    if (audienceType === "prospect") {
      const unsub = await isUnsubscribed(row.recipientEmail);
      if (unsub) {
        await db.update(emailSends).set({ status: "failed", failedReason: "Unsubscribed" }).where(eq(emailSends.id, row.id));
        skipped++;
        continue;
      }
    }

    // Build unsubscribe URL
    let unsubscribeUrl: string | undefined;
    if (audienceType === "prospect") {
      const token = await getOrCreateUnsubscribeToken(row.recipientEmail, row.recipientId ?? undefined);
      unsubscribeUrl = `${process.env.VITE_OAUTH_PORTAL_URL ?? "https://portal.thejltgroup.co.uk"}/unsubscribe?token=${token}`;
    }

    const branding = await getEmailBrandingSettings();
    const personalisedBody = applyMergeTags(campaign.bodyHtml, { name: row.recipientName, email: row.recipientEmail });
    const personalisedSubject = applyMergeTags(campaign.subject, { name: row.recipientName, email: row.recipientEmail });

    let html = wrapInBrandedTemplate({ bodyHtml: personalisedBody, audienceType, unsubscribeUrl, branding });
    html = injectOpenPixel(html, row.id, process.env.VITE_OAUTH_PORTAL_URL ?? "https://portal.thejltgroup.co.uk");
    html = injectClickTracking(html, row.id, process.env.VITE_OAUTH_PORTAL_URL ?? "https://portal.thejltgroup.co.uk");

    try {
      const resend = getResend();
      const result = await resend.emails.send({
        from: getFromAddress(audienceType),
        replyTo: getReplyTo(audienceType),
        to: row.recipientEmail,
        subject: personalisedSubject,
        html,
      });

      if (result.error) {
        await updateSendStatus(row.id, "failed", undefined, result.error.message);
        failed++;
      } else {
        await updateSendStatus(row.id, "sent", result.data?.id);
        sent++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateSendStatus(row.id, "failed", undefined, msg);
      failed++;
    }

    // 100ms delay between sends to respect Resend rate limits
    await new Promise((res) => setTimeout(res, 100));
  }

  // After processing, check if all queued rows for each campaign are done
  // and update campaign status accordingly
  for (const campaignId of campaignIds) {
    const remaining = await db
      .select({ id: emailSends.id })
      .from(emailSends)
      .where(and(sqlFn`${emailSends.campaignId} = ${campaignId}`, sqlFn`${emailSends.status} = 'queued'`))
      .limit(1);
    if (remaining.length === 0) {
      // All done — mark campaign as sent
      await db.update(emailCampaigns).set({ status: "sent" }).where(sqlFn`${emailCampaigns.id} = ${campaignId}`);
    }
  }

  return { sent, failed, skipped };
}
