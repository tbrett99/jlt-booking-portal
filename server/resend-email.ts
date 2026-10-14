/**
 * Resend email helper for the JLT email marketing system.
 * Handles campaign sends, drip step sends, open/click tracking pixel injection,
 * branded HTML wrapper, reply-to headers, and unsubscribe token injection.
 */
import { Resend } from "resend";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { emailSends, emailUnsubscribes, agentEmails } from "../drizzle/schema";
import { eq, isNotNull, inArray } from "drizzle-orm";
import crypto from "crypto";
import { getEmailBrandingSettings } from "./crm-db";
import type { EmailBrandingSettings } from "../drizzle/schema";
import {
  encodeApplicationToken,
  extractApplicationToken,
  getRecruitmentProspectById,
  updateRecruitmentProspect,
} from "./recruitment-db";
import { nanoid } from "nanoid";

/**
 * Log a campaign email sent to an agent into the agent_emails audit table.
 * Non-blocking — never throws.
 */
async function logCampaignEmailToAudit(params: {
  recipientEmail: string;
  recipientName?: string | null;
  recipientId?: number | null;
  subject: string;
  bodyHtml: string;
  campaignId?: number | null;
  status: string;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(agentEmails).values({
      userId: params.recipientId ?? null,
      toEmail: params.recipientEmail,
      toName: params.recipientName ?? null,
      subject: params.subject,
      triggerKey: params.campaignId ? `campaign:${params.campaignId}` : "campaign",
      bodyHtml: params.bodyHtml,
      status: params.status,
      sentAt: new Date(),
    });
  } catch (e) {
    console.error("[Email] Failed to log campaign email to audit:", e);
  }
}

export const DISCOVERY_CALL_BOOKING_URL = "https://cal.com/jlt-group/jlt-discovery";

export type MarketingMergeValues = {
  applicationLink?: string;
  discoveryCallLink?: string;
};

/**
 * Campaigns created before the Email Marketing composer supported secure links
 * can use the existing workflow-style camelCase tags. Keep both forms valid so
 * staff never send a literal placeholder by mistake.
 */
export function hasApplicationLinkMergeTag(content: string): boolean {
  return /\{\{application(?:_|)link\}\}/i.test(content);
}

/**
 * Replace email campaign merge tags with the recipient's safe values.
 * This deliberately runs server-side, immediately before email delivery: an
 * individual application token is never stored in the campaign definition.
 */
export function applyMarketingMergeTags(
  html: string,
  recipient: { name?: string | null; email?: string | null },
  values: MarketingMergeValues = {},
): string {
  const fullName = recipient.name?.trim() ?? "";
  const firstName = fullName.split(" ")[0] ?? fullName;
  const email = recipient.email ?? "";
  const applicationLink = values.applicationLink ?? "";
  const discoveryCallLink = values.discoveryCallLink ?? DISCOVERY_CALL_BOOKING_URL;
  return html
    .replace(/\{\{first_name\}\}/gi, firstName || fullName || "there")
    .replace(/\{\{full_name\}\}/gi, fullName || firstName || "there")
    .replace(/\{\{email\}\}/gi, email)
    .replace(/\{\{application_link\}\}/gi, applicationLink)
    .replace(/\{\{applicationLink\}\}/g, applicationLink)
    .replace(/\{\{discovery_call_link\}\}/gi, discoveryCallLink)
    .replace(/\{\{discoveryCallLink\}\}/g, discoveryCallLink);
}

/**
 * Retrieves or creates the application token for the queued recruitment
 * prospect. The recipient email is checked as a defensive guard against a
 * stale/mismatched queued recipient ID before a private link is produced.
 */
export async function getCampaignProspectMergeValues(opts: {
  recipientId?: number | null;
  recipientEmail: string;
  baseUrl: string;
}): Promise<MarketingMergeValues> {
  if (!opts.recipientId) {
    throw new Error("A secure application link needs a recruitment prospect record");
  }

  const prospect = await getRecruitmentProspectById(opts.recipientId);
  if (!prospect || prospect.email.trim().toLowerCase() !== opts.recipientEmail.trim().toLowerCase()) {
    throw new Error("Could not verify the recruitment prospect for the secure application link");
  }

  let token = extractApplicationToken(prospect.adminNotes);
  if (!token) {
    token = nanoid(32);
    await updateRecruitmentProspect(
      prospect.id,
      { adminNotes: encodeApplicationToken(token, prospect.adminNotes) },
    );
  }

  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  return {
    applicationLink: `${baseUrl}/apply/form?token=${encodeURIComponent(token)}`,
    discoveryCallLink: DISCOVERY_CALL_BOOKING_URL,
  };
}

export async function getCampaignRecipientMergeValues(opts: {
  audienceType: "prospect" | "agent";
  subject: string;
  bodyHtml: string;
  recipientId?: number | null;
  recipientEmail: string;
  baseUrl: string;
}): Promise<MarketingMergeValues> {
  const needsApplicationLink = hasApplicationLinkMergeTag(opts.subject) || hasApplicationLinkMergeTag(opts.bodyHtml);
  if (!needsApplicationLink) {
    return { discoveryCallLink: DISCOVERY_CALL_BOOKING_URL };
  }
  if (opts.audienceType !== "prospect") {
    throw new Error("Secure application links can only be sent in prospect campaigns");
  }
  return getCampaignProspectMergeValues({
    recipientId: opts.recipientId,
    recipientEmail: opts.recipientEmail,
    baseUrl: opts.baseUrl,
  });
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
 * The API route performs the opt-out and then returns the recipient to the
 * public confirmation page. Keeping the token out of the client route means
 * every prospect-email link completes the same server-side action.
 */
export function buildUnsubscribeUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/unsubscribe?token=${encodeURIComponent(token)}`;
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
  const record = rows[0];
  // Tokens are created when an email is prepared. Do not suppress the address
  // until the recipient has deliberately used that token to opt out.
  if (!record.unsubscribedAt) {
    await db
      .update(emailUnsubscribes)
      .set({ unsubscribedAt: new Date() })
      .where(eq(emailUnsubscribes.id, record.id));
  }
  return record.email;
}

/** Return only addresses that have explicitly completed an unsubscribe action. */
export async function getConfirmedUnsubscribedEmailSet(): Promise<Set<string>> {
  const db = await getDb();
  if (!db) return new Set();
  const rows = await db
    .select({ email: emailUnsubscribes.email })
    .from(emailUnsubscribes)
    .where(isNotNull(emailUnsubscribes.unsubscribedAt));
  return new Set(rows.map((row) => row.email.trim().toLowerCase()));
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
  mergeValues?: MarketingMergeValues;
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
    unsubscribeUrl = buildUnsubscribeUrl(opts.baseUrl, token);
  }

  // Load branding settings (cached per process — acceptable for email sends)
  const branding = await getEmailBrandingSettings();

  // Apply personalisation immediately before delivery. Campaign callers supply
  // recipient-specific secure links; ordinary marketing/drip callers retain the
  // original name/email behaviour and may also use the standard call booking link.
  const personalisedBody = applyMarketingMergeTags(opts.bodyHtml, { name: opts.toName, email: opts.to }, opts.mergeValues);
  const personalisedSubject = applyMarketingMergeTags(opts.subject, { name: opts.toName, email: opts.to }, opts.mergeValues);

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
    // Log agent-audience campaign emails to the agent_emails audit table
    if (opts.audienceType === "agent") {
      await logCampaignEmailToAudit({
        recipientEmail: opts.to,
        recipientName: opts.toName,
        recipientId: opts.recipientId,
        subject: personalisedSubject,
        bodyHtml: html,
        campaignId: opts.campaignId ?? null,
        status: "sent",
      });
    }
    return { sendId, success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateSendStatus(sendId, "failed", undefined, msg);
    if (opts.audienceType === "agent") {
      await logCampaignEmailToAudit({
        recipientEmail: opts.to,
        recipientName: opts.toName,
        recipientId: opts.recipientId,
        subject: opts.subject,
        bodyHtml: opts.bodyHtml,
        campaignId: opts.campaignId ?? null,
        status: "failed",
      });
    }
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
export async function processCampaignQueue(
  batchSize = 50,
  retrySendIds?: number[]
): Promise<{ sent: number; failed: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { sent: 0, failed: 0, skipped: 0 };

  const { and, isNotNull, isNull, sql: sqlFn } = await import("drizzle-orm");
  const { emailCampaigns } = await import("../drizzle/schema");

  // The scheduler picks queued rows. A controlled resend may provide exact
  // historical send IDs; this deliberately never picks unrelated failed rows.
  const queueOrRetryCondition = retrySendIds?.length
    ? inArray(emailSends.id, retrySendIds)
    : sqlFn`${emailSends.status} = 'queued'`;

  // Pick up to batchSize campaign rows (not drip)
  const rows = await db
    .select()
    .from(emailSends)
    .where(
      and(
        queueOrRetryCondition,
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
      unsubscribeUrl = buildUnsubscribeUrl(
        process.env.VITE_OAUTH_PORTAL_URL ?? "https://portal.thejltgroup.co.uk",
        token,
      );
    }

    const baseUrl = process.env.VITE_OAUTH_PORTAL_URL ?? "https://portal.thejltgroup.co.uk";
    let mergeValues: MarketingMergeValues;
    try {
      mergeValues = await getCampaignRecipientMergeValues({
        audienceType,
        subject: campaign.subject,
        bodyHtml: campaign.bodyHtml,
        recipientId: row.recipientId,
        recipientEmail: row.recipientEmail,
        baseUrl,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not personalise campaign links";
      await updateSendStatus(row.id, "failed", undefined, message);
      failed++;
      continue;
    }

    const branding = await getEmailBrandingSettings();
    const personalisedBody = applyMarketingMergeTags(campaign.bodyHtml, { name: row.recipientName, email: row.recipientEmail }, mergeValues);
    const personalisedSubject = applyMarketingMergeTags(campaign.subject, { name: row.recipientName, email: row.recipientEmail }, mergeValues);

    let html = wrapInBrandedTemplate({ bodyHtml: personalisedBody, audienceType, unsubscribeUrl, branding });
    html = injectOpenPixel(html, row.id, baseUrl);
    html = injectClickTracking(html, row.id, baseUrl);

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
        if (audienceType === "agent") {
          await logCampaignEmailToAudit({
            recipientEmail: row.recipientEmail,
            recipientName: row.recipientName,
            recipientId: row.recipientId,
            subject: personalisedSubject,
            bodyHtml: html,
            campaignId: row.campaignId,
            status: "failed",
          });
        }
      } else {
        await updateSendStatus(row.id, "sent", result.data?.id);
        sent++;
        if (audienceType === "agent") {
          await logCampaignEmailToAudit({
            recipientEmail: row.recipientEmail,
            recipientName: row.recipientName,
            recipientId: row.recipientId,
            subject: personalisedSubject,
            bodyHtml: html,
            campaignId: row.campaignId,
            status: "sent",
          });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateSendStatus(row.id, "failed", undefined, msg);
      failed++;
      if (audienceType === "agent") {
        await logCampaignEmailToAudit({
          recipientEmail: row.recipientEmail,
          recipientName: row.recipientName,
          recipientId: row.recipientId,
          subject: personalisedSubject,
          bodyHtml: html,
          campaignId: row.campaignId,
          status: "failed",
        });
      }
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
