/**
 * Resend email helper for the JLT email marketing system.
 * Handles campaign sends, drip step sends, open/click tracking pixel injection.
 */
import { Resend } from "resend";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { emailSends } from "../drizzle/schema";
import { eq } from "drizzle-orm";

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

export function getFromAddress(audienceType: "prospect" | "agent"): string {
  return audienceType === "prospect" ? PROSPECT_FROM : AGENT_FROM;
}

/**
 * Wrap all links in the HTML body with a click-tracking redirect.
 * The tracking endpoint is /api/email-track/click?sid=<sendId>&url=<encoded>
 */
function injectClickTracking(html: string, sendId: number, baseUrl: string): string {
  return html.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_match, url) => {
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
 * Send a single email via Resend with open/click tracking.
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
  baseUrl: string; // e.g. https://portal.thejltgroup.co.uk
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

  // Inject tracking
  let html = injectOpenPixel(opts.bodyHtml, sendId, opts.baseUrl);
  html = injectClickTracking(html, sendId, opts.baseUrl);

  try {
    const resend = getResend();
    const result = await resend.emails.send({
      from: getFromAddress(opts.audienceType),
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
 * Returns { sent, failed } counts.
 */
export async function sendCampaignBatch(opts: {
  campaignId: number;
  recipients: Array<{ email: string; name?: string; id?: number; type: "prospect" | "agent" }>;
  subject: string;
  bodyHtml: string;
  audienceType: "prospect" | "agent";
  baseUrl: string;
}): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (const r of opts.recipients) {
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

  return { sent, failed };
}
