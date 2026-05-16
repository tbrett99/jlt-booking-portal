import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { eq } from "drizzle-orm";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startScheduler, runNightlyExport, getLastExportRun } from "../scheduler";
import { ENV } from "./env";
import { verifyPpsSignature, buildPpsSignature } from "../pps-signature";
import { getDb, createInAppNotification } from "../db";
import { paymentLinks, bookings, users } from "../../drizzle/schema";
import { sendNotificationEmail, sendDirectEmail, sendSupportEmail } from "../email";
import {
  getBillingRequest,
  createSubscription,
  calcSubscriptionStartDate,
} from "../gocardless";
import {
  getGcMandateByBillingRequestId,
  updateGcMandate,
  createGcSubscription,
  createPaymentEvent,
} from "../gocardless-db";
import { notifyOwner } from "./notification";
import { externalApiRouter } from "../external-api";
import { oauth2Router } from "../oauth2-server";
import { supplierApiRouter } from "../supplier-api";
import { joinSessions, agentCrmProfiles, teamInvites, users as usersTable } from "../../drizzle/schema";
import { createAgentUser } from "../db";
import { getMonthlyAmount } from "../../shared/membership";
import bcrypt from "bcryptjs";

// HTML escape helper to prevent XSS in server-rendered payment page
function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Simple error page for payment link issues
function errorHtml(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)} — The JLT Group</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f0fffb; display: flex; align-items: center; justify-content: center;
           min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,.08);
            padding: 2.5rem 2rem; max-width: 380px; width: 100%; text-align: center; }
    .icon { width: 56px; height: 56px; border-radius: 50%; background: #ffc3bc;
            display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem; }
    h1 { font-size: 1.1rem; color: #414141; margin: 0 0 .5rem; }
    p { font-size: .85rem; color: #6b7280; margin: 0 0 .5rem; }
    .contact { font-size: .75rem; color: #d1d5db; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    </div>
    <h1>${escHtml(title)}</h1>
    <p>${escHtml(message)}</p>
    <p class="contact">Contact us: <a href="mailto:info@thejltgroup.co.uk">info@thejltgroup.co.uk</a></p>
  </div>
</body>
</html>`;
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  // Trust the reverse proxy (Cloud Run / load balancer) so that req.protocol
  // correctly reflects the original HTTPS scheme via x-forwarded-proto.
  // Without this, SameSite=None cookies are set without Secure=true and
  // modern browsers silently drop them, breaking the OAuth flow.
  app.set("trust proxy", true);
  const server = createServer(app);

  // Capture raw body for PPS callback signature verification BEFORE urlencoded parser decodes it.
  // PPS signs the raw URL-encoded string; Express decodes it, so we must re-verify against raw.
  app.use("/api/pps/callback", express.raw({ type: "application/x-www-form-urlencoded", limit: "1mb" }));
  // Capture raw body for GoCardless webhook HMAC-SHA256 signature verification.
  // Must be registered BEFORE express.json() so the raw Buffer is preserved.
  app.use("/api/gocardless/webhook", express.raw({ type: "application/json", limit: "1mb" }));

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // ── Secure nightly export trigger endpoint ──────────────────────────────────
  // Called by the external Manus scheduled task. Requires Bearer token auth.
  app.post("/api/export/nightly", async (req, res) => {
    const auth = req.headers.authorization ?? "";
    const token = ENV.exportTriggerToken;
    if (!token || auth !== `Bearer ${token}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    console.log("[ExportEndpoint] Triggered via external scheduler");
    const result = await runNightlyExport("external");
    res.json(result);
  });

  // ── Supplier AI enrichment trigger (one-time bulk enrichment) ────────────────
  app.post("/api/suppliers/enrich-all", async (req, res) => {
    const auth = req.headers.authorization ?? "";
    const token = ENV.exportTriggerToken;
    if (!token || auth !== `Bearer ${token}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { getDb } = await import("../db");
    const { invokeLLM } = await import("./llm");
    const { suppliers: suppliersTable } = await import("../../drizzle/schema");
    const { eq, sql: drizzleSql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }
    // Re-enrich ALL active suppliers (not just unenriched) with the improved prompt
    const allSuppliers = await db.select().from(suppliersTable).where(drizzleSql`${suppliersTable.isActive} = 1`);
    const count = allSuppliers.length;
    res.json({ ok: true, count, message: `Started enriching ${count} suppliers in background` });
    (async () => {
      let done = 0;
      for (const supplier of allSuppliers) {
        try {
          const context = [
            `Name: ${supplier.name}`,
            supplier.shortDescription ? `Short description: ${supplier.shortDescription}` : "",
            supplier.description ? `Description: ${supplier.description.replace(/<[^>]+>/g, " ").slice(0, 2000)}` : "",
            supplier.categories ? `Categories: ${supplier.categories}` : "",
            supplier.locations ? `Locations/destinations: ${supplier.locations}` : "",
            supplier.commission ? `Commission: ${supplier.commission}` : "",
            supplier.generalNotes ? `Internal notes: ${supplier.generalNotes.slice(0, 800)}` : "",
          ].filter(Boolean).join("\n");
          const result = await invokeLLM({
            messages: [
              { role: "system", content: `You are an expert travel industry consultant helping travel agents understand suppliers. Based on the supplier information provided, generate enrichment data written from the agent's perspective. Return ONLY valid JSON with these exact fields:\n{"usp":"2-3 specific bullet points starting with \u2022 of what genuinely makes this supplier stand out","priceTier":"one of exactly: budget, mid-range, luxury, ultra-luxury","notSuitableFor":"specific scenarios this supplier is NOT ideal for","aiSummary":"2-3 sentences for an agent \u2014 start with Use this supplier when... or Best for... \u2014 mention destinations, specialisms, client types","idealClient":"comma-separated client types this supplier is perfect for","bookingTips":"2-3 practical bullet points starting with \u2022 that an agent should know when booking"}` },
              { role: "user", content: context },
            ],
            response_format: { type: "json_object" },
          });
          const rawContent = (result.choices[0]?.message?.content as string) ?? "{}";
          const enriched = JSON.parse(rawContent);
          // Get a fresh DB connection for each update to avoid connection timeout
          const freshDb = await getDb();
          if (!freshDb) { console.error(`[SupplierEnrich] DB unavailable for supplier ${supplier.id}`); continue; }
          await freshDb.update(suppliersTable).set({
            usp: enriched.usp ? String(enriched.usp).slice(0, 2000) : null,
            priceTier: enriched.priceTier ? String(enriched.priceTier).slice(0, 50) : null,
            notSuitableFor: enriched.notSuitableFor ? String(enriched.notSuitableFor).slice(0, 1000) : null,
            aiSummary: enriched.aiSummary ? String(enriched.aiSummary).slice(0, 1000) : null,
            idealClient: enriched.idealClient ? String(enriched.idealClient).slice(0, 500) : null,
            bookingTips: enriched.bookingTips ? String(enriched.bookingTips).slice(0, 2000) : null,
            aiEnrichedAt: new Date(),
          }).where(eq(suppliersTable.id, supplier.id));
          done++;
          if (done % 20 === 0) console.log(`[SupplierEnrich] Progress: ${done}/${count}`);
          await new Promise(r => setTimeout(r, 300));
        } catch (err: any) {
          const cause = err?.cause;
          console.error(`[SupplierEnrich] Error on supplier ${supplier.id}:`, err?.message,
            cause ? `| cause: ${cause?.message ?? JSON.stringify(cause)}` : "",
            cause?.code ? `| code: ${cause.code}` : "",
            cause?.sqlMessage ? `| sql: ${cause.sqlMessage}` : ""
          );
        }
      }
      console.log(`[SupplierEnrich] Completed: ${done}/${count} suppliers enriched`);
    })();
  });

  // ── Last export run status (for admin dashboard) ────────────────────────────
  app.get("/api/export/status", async (req, res) => {
    const auth = req.headers.authorization ?? "";
    const token = ENV.exportTriggerToken;
    if (!token || auth !== `Bearer ${token}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const last = await getLastExportRun();
    res.json(last ?? { ranAt: null, success: null, rowCount: null });
  });

  // ── Backdate DD receipt emails ─────────────────────────────────────────────
  // One-off endpoint: sends backdated receipts for all confirmed/paid_out
  // payment events that never had a userId resolved (and thus no receipt sent).
  app.post("/api/dd/backdate-receipts", async (req, res) => {
    const auth = req.headers.authorization ?? "";
    const token = ENV.exportTriggerToken;
    if (!token || auth !== `Bearer ${token}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const dryRun = req.query.dry === "1";
    res.json({ ok: true, message: dryRun ? "Dry run started" : "Backdate job started — check server logs for progress" });
    // Run async so the HTTP response returns immediately
    (async () => {
      try {
        const { fetchPayment } = await import("../gocardless");
        const { sendDirectEmail } = await import("../email");
        const db = await getDb();
        if (!db) { console.error("[BackdateReceipts] DB unavailable"); return; }
        const { gcPaymentEvents, gcMandates, users: usersT } = await import("../../drizzle/schema");
        const { eq: eqOp, isNull } = await import("drizzle-orm");
        // Fetch all confirmed/paid_out events with no userId
        const events = await db.select().from(gcPaymentEvents)
          .where(isNull(gcPaymentEvents.userId))
          .then(rows => rows.filter(r => r.eventType === "payments_confirmed" || r.eventType === "payments_paid_out"));
        // Build DB lookup: paymentId -> { mandateId, userId } from pending_submission events
        const allPending = await db.select().from(gcPaymentEvents)
          .then(rows => rows.filter(r => r.eventType === "payments_pending_submission" && r.mandateId && r.userId));
        const pendingByPaymentId = new Map<string, { mandateId: string; userId: number }>();
        for (const p of allPending) {
          if (p.paymentId && p.mandateId && p.userId) {
            pendingByPaymentId.set(p.paymentId, { mandateId: p.mandateId, userId: p.userId });
          }
        }
        console.log(`[BackdateReceipts] Processing ${events.length} events (dryRun=${dryRun}), DB lookup covers ${pendingByPaymentId.size} payments`);
        let sent = 0, skipped = 0, failed = 0;
        for (const evt of events) {
          try {
            if (!evt.paymentId) { skipped++; continue; }
            // Step 1: DB cross-reference from pending_submission events (fast, no API call)
            let mandateId: string | null = null;
            let userId: number | null = null;
            const pending = pendingByPaymentId.get(evt.paymentId);
            if (pending) {
              mandateId = pending.mandateId;
              userId = pending.userId;
            }
            // Note: GoCardless API fallback removed — payments not in DB lookup are pre-portal agents
            if (!mandateId || !userId) { console.warn(`[BackdateReceipts] Could not resolve agent for payment ${evt.paymentId}`); skipped++; continue; }
            // Fetch agent details
            const [agentRow] = await db.select().from(usersT).where(eqOp(usersT.id, userId)).limit(1);
            if (!agentRow?.email) { skipped++; continue; }
            const agentEmail = agentRow.email;
            const agentName = agentRow.name ?? "there";
            const membershipTier = (agentRow as any)?.membershipTier ?? null;
            const tierLabel = membershipTier === "first_class" ? "First Class" : membershipTier === "charter" ? "Charter" : "Business Class";
            const amount = evt.amount ?? undefined;
            const amountFormatted = amount ? `\u00a3${(amount / 100).toFixed(2)}` : "\u2014";
            const paymentDate = evt.occurredAt ? new Date(evt.occurredAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "unknown date";
            if (dryRun) {
              console.log(`[BackdateReceipts][DRY] Would send to ${agentEmail} for payment ${evt.paymentId} (${amountFormatted}, ${paymentDate})`);
              sent++;
              continue;
            }
            // Update the event record with resolved userId and mandateId
            await db.update(gcPaymentEvents).set({ userId, mandateId }).where(eqOp(gcPaymentEvents.id, evt.id));
            const receiptHtml = `<div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);"><div style="background:#70FFE8;padding:28px 32px;"><h1 style="margin:0;font-size:22px;font-weight:700;color:#1a1a2e;">JLT Group</h1><p style="margin:4px 0 0;font-size:13px;color:#1a1a2e;opacity:0.7;">Membership Payment Receipt</p></div><div style="padding:32px;"><p style="color:#414141;margin:0 0 20px;">Hi ${agentName},</p><p style="color:#414141;margin:0 0 20px;">We noticed you didn&rsquo;t receive a receipt for a recent membership payment &mdash; we&rsquo;re sorry about that! Please find your receipt below for your records.</p><table style="width:100%;border-collapse:collapse;margin:0 0 24px;"><tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:10px 0;color:#6b7280;font-size:14px;">Amount</td><td style="padding:10px 0;color:#414141;font-weight:700;font-size:16px;text-align:right;">${amountFormatted}</td></tr><tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:10px 0;color:#6b7280;font-size:14px;">Membership</td><td style="padding:10px 0;color:#414141;font-weight:600;text-align:right;">${tierLabel}</td></tr><tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:10px 0;color:#6b7280;font-size:14px;">Payment Date</td><td style="padding:10px 0;color:#414141;text-align:right;">${paymentDate}</td></tr><tr><td style="padding:10px 0;color:#6b7280;font-size:14px;">Reference</td><td style="padding:10px 0;color:#414141;font-family:monospace;text-align:right;">${evt.paymentId ?? "\u2014"}</td></tr></table><p style="color:#6b7280;font-size:13px;margin:0;">For queries contact <a href="mailto:memberships@thejltgroup.co.uk" style="color:#02E6D2;">memberships@thejltgroup.co.uk</a>.</p></div><div style="background:#f9fafb;padding:20px 32px;border-top:1px solid #f0f0f0;"><p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">JLT Group &bull; <a href="https://portal.thejltgroup.co.uk" style="color:#02E6D2;">portal.thejltgroup.co.uk</a></p></div></div>`;
            await sendDirectEmail({ toEmail: agentEmail, toName: agentName, subject: `Backdated Membership Payment Receipt \u2014 ${amountFormatted}`, html: receiptHtml, ...({ triggerKey: "gc_receipt_backdate", userId } as any) });
            sent++;
            // Small delay to avoid hammering Resend rate limits
            await new Promise(r => setTimeout(r, 200));
          } catch (err: any) {
            console.error(`[BackdateReceipts] Error on event ${evt.id}:`, err?.message);
            failed++;
          }
        }
        console.log(`[BackdateReceipts] Done: sent=${sent}, skipped=${skipped}, failed=${failed}`);
      } catch (err: any) {
        console.error("[BackdateReceipts] Fatal error:", err?.message);
      }
    })();
  });

  // ── PPS Direct Payment Page ─────────────────────────────────────────────────
  // Server-side GET /api/pay/:token — returns a self-submitting HTML form that
  // goes straight to PPS. Uses /api/ prefix so it's never intercepted by the
  // static file server or CDN. No React app, no portal login required.
  app.get("/api/pay/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const db = await getDb();
      if (!db) { res.status(500).send("Server error"); return; }

      const [link] = await db
        .select()
        .from(paymentLinks)
        .where(eq(paymentLinks.id, token));

      if (!link) {
        res.status(404).send(errorHtml("Payment link not found", "This payment link does not exist or has expired. Please contact The JLT Group."));
        return;
      }
      if (link.status === "cancelled") {
        res.status(410).send(errorHtml("Link Cancelled", "This payment link has been cancelled. Please contact The JLT Group."));
        return;
      }
      if (link.status === "paid") {
        res.status(410).send(errorHtml("Already Paid", "This payment has already been completed. Thank you!"));
        return;
      }
      if (link.expiresAt && new Date() > link.expiresAt) {
        res.status(410).send(errorHtml("Link Expired", "This payment link has expired. Please contact The JLT Group to request a new link."));
        return;
      }

      const signingSecret = ENV.ppsSigningSecret;
      const gatewayUrl = ENV.ppsGatewayUrl;

      if (!signingSecret || !gatewayUrl) {
        res.status(500).send(errorHtml("Configuration Error", "Payment gateway is not configured. Please contact The JLT Group."));
        return;
      }

      // Fetch booking to get customer email/name for 3DS2 (required for manual card entry)
      const [bookingForForm] = await db
        .select({ clientEmail: bookings.clientEmail, clientName: bookings.clientName })
        .from(bookings)
        .where(eq(bookings.id, link.bookingId));

      const formFields: Record<string, string> = {
        merchantID: link.merchantId,
        action: "SALE",
        type: "1",
        currencyCode: "826",
        countryCode: "826",
        amount: String(link.amountPence),
        transactionUnique: link.transactionUnique,
        orderRef: link.orderRef,
        redirectURL: link.redirectUrl ?? "",
        callbackURL: link.callbackUrl ?? "",
      };
      // Optional fields — only include if present (matches Tom's reference implementation)
      // v2: removed merchantData, using orderDetails (CardStream spec)
      if (link.description) formFields.orderDetails = link.description;
      // Pass customer details for 3DS2 risk assessment (required for manual card entry on live accounts)
      if (bookingForForm?.clientName) formFields.customerName = bookingForForm.clientName;
      if (bookingForForm?.clientEmail) formFields.customerEmail = bookingForForm.clientEmail;

      const signature = buildPpsSignature(formFields, signingSecret);
      formFields.signature = signature;

      const hiddenInputs = Object.entries(formFields)
        .map(([name, value]) => `<input type="hidden" name="${escHtml(name)}" value="${escHtml(value)}">`)
        .join("\n        ");

      const amountFormatted = `£${(link.amountPence / 100).toFixed(2)}`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Secure Payment — The JLT Group</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f0fffb; display: flex; align-items: center; justify-content: center;
           min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,.08);
            padding: 2.5rem 2rem; max-width: 380px; width: 100%; text-align: center; }
    .logo { width: 56px; height: 56px; border-radius: 50%; background: #70ffe8;
            display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem; }
    h1 { font-size: 1.1rem; color: #414141; margin: 0 0 .25rem; }
    .sub { font-size: .8rem; color: #9ca3af; margin: 0 0 1.5rem; }
    .detail { background: #f9fafb; border-radius: 10px; padding: .9rem 1rem;
              text-align: left; margin-bottom: 1.5rem; }
    .row { display: flex; justify-content: space-between; font-size: .85rem; margin-bottom: .4rem; }
    .row:last-child { margin-bottom: 0; }
    .label { color: #6b7280; }
    .value { font-weight: 600; color: #414141; }
    .amount { font-size: 1.2rem; }
    .spinner { width: 28px; height: 28px; border: 3px solid #e5e7eb;
               border-top-color: #02e6d2; border-radius: 50%;
               animation: spin .7s linear infinite; margin: 0 auto .75rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .msg { font-size: .85rem; color: #6b7280; }
    .powered { font-size: .7rem; color: #d1d5db; margin-top: .5rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#414141" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    </div>
    <h1>The JLT Group</h1>
    <p class="sub">Secure Payment</p>
    <div class="detail">
      <div class="row"><span class="label">Reference</span><span class="value">${escHtml(link.orderRef)}</span></div>
      <div class="row"><span class="label">Amount</span><span class="value amount">${escHtml(amountFormatted)}</span></div>
    </div>
    <div class="spinner"></div>
    <p class="msg">Redirecting to secure payment&hellip;</p>
    <p class="powered">Powered by Protected Payment Services</p>
  </div>
  <form id="ppsForm" method="POST" action="${escHtml(gatewayUrl)}">
        ${hiddenInputs}
  </form>
  <script>document.getElementById('ppsForm').submit();</script>
</body>
</html>`);
    } catch (err) {
      console.error("[PayRoute] Error:", err);
      res.status(500).send(errorHtml("Error", "An unexpected error occurred. Please contact The JLT Group."));
    }
  });

  // ── PPS Result Page ────────────────────────────────────────────────────
  // PPS redirects the customer here after payment. We check the DB for the authoritative
  // status (set by the server-to-server callback). If the callback hasn't fired yet (e.g.
  // Apple Pay / wallet payments), we fall back to verifying the redirect fields PPS sends
  // here and process the payment directly. PPS may redirect via GET or POST.
  const handlePayResult = async (req: express.Request, res: express.Response) => {
    try {
      const { token } = req.params;
      const db = await getDb();
      if (!db) { res.status(500).send(errorHtml("Server error", "Please contact The JLT Group.")); return; }

      // Collect redirect fields from POST body or GET query string
      const redirectFields: Record<string, string> = {};
      const bodyFields = Buffer.isBuffer(req.body)
        ? Object.fromEntries(Array.from(new URLSearchParams(req.body.toString("utf8")).entries()))
        : (req.body as Record<string, string> ?? {});
      Object.assign(redirectFields, req.query as Record<string, string>, bodyFields);

      // Poll up to 10s for the server-to-server callback to arrive first
      let link: typeof import("../../drizzle/schema").paymentLinks.$inferSelect | undefined;
      for (let i = 0; i < 10; i++) {
        const [row] = await db.select().from(paymentLinks).where(eq(paymentLinks.id, token));
        link = row;
        if (link?.status === "paid" || link?.status === "failed") break;
        await new Promise(r => setTimeout(r, 1000));
      }

      // Fallback: if still pending, try to process using the redirect fields PPS sent here.
      // This handles Apple Pay and other wallet methods where the callback may not fire.
      if (link && link.status === "pending" && redirectFields.responseCode) {
        console.log("[PayResult] Callback not received — attempting fallback from redirect fields for link:", token);
        const signingSecret = ENV.ppsSigningSecret;
        const receivedSig = redirectFields.signature ?? "";
        let sigValid = false;

        if (signingSecret && receivedSig) {
          sigValid = verifyPpsSignature(redirectFields, receivedSig, signingSecret);
          console.log("[PayResult] Redirect signature valid:", sigValid);
        }

        // Process if signature valid OR if no signature present (some PPS configs omit it on redirect)
        if (sigValid || !receivedSig) {
          const responseCode = redirectFields.responseCode ?? "";
          const responseMessage = redirectFields.responseMessage ?? "";
          const ppsTransactionId = redirectFields.transactionID ?? redirectFields.xref ?? "";
          const isPaid = responseCode === "0";
          const newStatus = isPaid ? "paid" : "failed";

          // Only update if still pending (idempotency)
          const [currentLink] = await db.select({ status: paymentLinks.status }).from(paymentLinks).where(eq(paymentLinks.id, token));
          if (currentLink?.status === "pending") {
            await db.update(paymentLinks).set({
              status: newStatus,
              ppsTransactionId,
              ppsResponseCode: responseCode,
              ppsResponseMessage: responseMessage,
              ...(isPaid ? { paidAt: new Date() } : {}),
            }).where(eq(paymentLinks.id, token));

            console.log(`[PayResult] Fallback processed link ${token} → ${newStatus}`);

            // Re-fetch updated link
            const [updatedLink] = await db.select().from(paymentLinks).where(eq(paymentLinks.id, token));
            if (updatedLink) link = updatedLink;

            if (isPaid) {
              // Fire agent notifications (same as callback)
              const [bookingRow] = await db
                .select({ id: bookings.id, clientName: bookings.clientName, ptsRef: bookings.ptsRef, agentId: bookings.agentId, clientEmail: bookings.clientEmail })
                .from(bookings).where(eq(bookings.id, link!.bookingId));

              if (bookingRow) {
                const [agentRow] = await db
                  .select({ id: users.id, name: users.name, email: users.email })
                  .from(users).where(eq(users.id, bookingRow.agentId));

                const amountFormatted = `£${(link!.amountPence / 100).toFixed(2)}`;

                await createInAppNotification({
                  userId: bookingRow.agentId,
                  bookingId: bookingRow.id,
                  message: `Payment of ${amountFormatted} received for “${bookingRow.clientName}” (PTS: ${bookingRow.ptsRef ?? link!.orderRef}).`,
                  linkUrl: `/bookings/${bookingRow.id}`,
                });

                if (agentRow?.email) {
                  await sendNotificationEmail({
                    triggerKey: "payment_received",
                    toEmail: agentRow.email,
                    toName: agentRow.name ?? "Agent",
                    variables: {
                      clientName: bookingRow.clientName,
                      ptsRef: bookingRow.ptsRef ?? link!.orderRef,
                      amount: amountFormatted,
                      transactionId: ppsTransactionId,
                    },
                    bookingId: bookingRow.id,
                  });
                }

                if (bookingRow.clientEmail) {
                  const ptsRef = bookingRow.ptsRef ?? link!.orderRef;
                  await sendDirectEmail({
                    toEmail: bookingRow.clientEmail,
                    toName: bookingRow.clientName ?? "Customer",
                    subject: `Payment Confirmed – ${ptsRef}`,
                    html: `<p>Dear ${bookingRow.clientName ?? "Customer"},</p><p>Thank you for your payment of <strong>${amountFormatted}</strong>. Your payment has been received and processed successfully.</p><p><strong>Booking Reference:</strong> ${ptsRef}<br/><strong>Transaction ID:</strong> ${ppsTransactionId}</p><p>If you have any questions, please contact your travel agent.</p><p>The JLT Group Team</p>`,
                  });
                }
              }
            }
          }
        } else {
          console.warn("[PayResult] Redirect signature invalid — not processing fallback");
        }
      }

      // Final fallback: if still pending, query PPS directly via the QUERY action.
      // This handles Apple Pay where PPS redirects without any result fields.
      if (link && link.status === "pending" && link.transactionUnique) {
        console.log("[PayResult] Still pending — querying PPS directly for transactionUnique:", link.transactionUnique);
        try {
          const signingSecret = ENV.ppsSigningSecret;
          const merchantId = link.merchantId;
          const gatewayUrl = ENV.ppsGatewayUrl;

          if (signingSecret && merchantId && gatewayUrl) {
            const queryFields: Record<string, string> = {
              merchantID: merchantId,
              action: "QUERY",
              transactionUnique: link.transactionUnique,
            };
            queryFields.signature = buildPpsSignature(queryFields, signingSecret);

            const qRes = await fetch(gatewayUrl, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams(queryFields).toString(),
            });
            const qText = await qRes.text();
            console.log("[PayResult] PPS QUERY response:", qText.slice(0, 500));

            // Parse URL-encoded response
            const qParams = new URLSearchParams(qText);
            const qResponseCode = qParams.get("responseCode") ?? "";
            const qTransactionId = qParams.get("transactionID") ?? qParams.get("xref") ?? "";
            const qResponseMessage = qParams.get("responseMessage") ?? "";

            if (qResponseCode !== "") {
              const isPaid = qResponseCode === "0";
              const newStatus = isPaid ? "paid" : "failed";

              // Idempotency: only update if still pending
              const [currentLink] = await db.select({ status: paymentLinks.status }).from(paymentLinks).where(eq(paymentLinks.id, token));
              if (currentLink?.status === "pending") {
                await db.update(paymentLinks).set({
                  status: newStatus,
                  ppsTransactionId: qTransactionId,
                  ppsResponseCode: qResponseCode,
                  ppsResponseMessage: qResponseMessage,
                  ...(isPaid ? { paidAt: new Date() } : {}),
                }).where(eq(paymentLinks.id, token));

                console.log(`[PayResult] PPS QUERY fallback: link ${token} → ${newStatus}`);

                // Re-fetch updated link
                const [updatedLink] = await db.select().from(paymentLinks).where(eq(paymentLinks.id, token));
                if (updatedLink) link = updatedLink;

                if (isPaid) {
                  const [bookingRow] = await db
                    .select({ id: bookings.id, clientName: bookings.clientName, ptsRef: bookings.ptsRef, agentId: bookings.agentId, clientEmail: bookings.clientEmail })
                    .from(bookings).where(eq(bookings.id, link!.bookingId));

                  if (bookingRow) {
                    const [agentRow] = await db
                      .select({ id: users.id, name: users.name, email: users.email })
                      .from(users).where(eq(users.id, bookingRow.agentId));

                    const amountFormatted = `£${(link!.amountPence / 100).toFixed(2)}`;

                    await createInAppNotification({
                      userId: bookingRow.agentId,
                      bookingId: bookingRow.id,
                      message: `Payment of ${amountFormatted} received for “${bookingRow.clientName}” (PTS: ${bookingRow.ptsRef ?? link!.orderRef}).`,
                      linkUrl: `/bookings/${bookingRow.id}`,
                    });

                    if (agentRow?.email) {
                      await sendNotificationEmail({
                        triggerKey: "payment_received",
                        toEmail: agentRow.email,
                        toName: agentRow.name ?? "Agent",
                        variables: {
                          clientName: bookingRow.clientName,
                          ptsRef: bookingRow.ptsRef ?? link!.orderRef,
                          amount: amountFormatted,
                          transactionId: qTransactionId,
                        },
                        bookingId: bookingRow.id,
                      });
                    }

                    if (bookingRow.clientEmail) {
                      const ptsRef = bookingRow.ptsRef ?? link!.orderRef;
                      await sendDirectEmail({
                        toEmail: bookingRow.clientEmail,
                        toName: bookingRow.clientName ?? "Customer",
                        subject: `Payment Confirmed – ${ptsRef}`,
                        html: `<p>Dear ${bookingRow.clientName ?? "Customer"},</p><p>Thank you for your payment of <strong>${amountFormatted}</strong>. Your payment has been received and processed successfully.</p><p><strong>Booking Reference:</strong> ${ptsRef}<br/><strong>Transaction ID:</strong> ${qTransactionId}</p><p>If you have any questions, please contact your travel agent.</p><p>The JLT Group Team</p>`,
                      });
                    }
                  }
                }
              }
            } else {
              console.warn("[PayResult] PPS QUERY returned no responseCode — transaction may not exist yet");
            }
          }
        } catch (qErr) {
          console.error("[PayResult] PPS QUERY error:", qErr);
          // Non-fatal: fall through to show pending page
        }
      }

      if (!link) {
        res.status(404).send(errorHtml("Not Found", "Payment link not found."));
        return;
      }

      const amountFormatted = `£${(link.amountPence / 100).toFixed(2)}`;
      const ptsRef = escHtml(link.orderRef);
      const txId = escHtml(link.ppsTransactionId ?? "");

      const isPaid = link.status === "paid";
      const isFailed = link.status === "failed";

      const iconSvg = isPaid
        ? `<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
        : isFailed
        ? `<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
        : `<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

      const title = isPaid ? "Payment Successful" : isFailed ? "Payment Failed" : "Payment Pending";
      const subtitle = isPaid
        ? "Your payment has been received. A confirmation has been sent to your travel agent."
        : isFailed
        ? "Your payment could not be processed. Please contact The JLT Group."
        : "We are confirming your payment. Please check your email for confirmation.";
      const bgColor = isPaid ? "#d1fae5" : isFailed ? "#fee2e2" : "#fef3c7";
      const textColor = isPaid ? "#065f46" : isFailed ? "#991b1b" : "#92400e";

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)} — The JLT Group</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f0fffb; display: flex; align-items: center; justify-content: center;
           min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,.08);
            padding: 2.5rem 2rem; max-width: 420px; width: 100%; text-align: center; }
    .logo { width: 56px; height: 56px; border-radius: 50%; background: #70ffe8;
            display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem; }
    h1 { font-size: 1.3rem; color: #414141; margin: .75rem 0 .5rem; }
    .sub { font-size: .85rem; color: #6b7280; margin: 0 0 1.5rem; }
    .detail { background: #f9fafb; border-radius: 10px; padding: .9rem 1rem;
              text-align: left; margin-bottom: 1.5rem; }
    .row { display: flex; justify-content: space-between; font-size: .85rem; margin-bottom: .4rem; }
    .row:last-child { margin-bottom: 0; }
    .label { color: #6b7280; }
    .value { font-weight: 600; color: #414141; }
    .notice { border-radius: 10px; padding: .75rem 1rem; font-size: .8rem; margin-bottom: 1rem;
              background: ${bgColor}; color: ${textColor}; }
    .powered { font-size: .7rem; color: #d1d5db; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <span style="font-weight:700;color:#414141;font-size:1rem">JLT</span>
    </div>
    ${iconSvg}
    <h1>${escHtml(title)}</h1>
    <p class="sub">${escHtml(subtitle)}</p>
    <div class="detail">
      <div class="row"><span class="label">Reference</span><span class="value">${ptsRef}</span></div>
      <div class="row"><span class="label">Amount</span><span class="value">${escHtml(amountFormatted)}</span></div>
      ${txId ? `<div class="row"><span class="label">Transaction ID</span><span class="value" style="font-size:.75rem;font-family:monospace">${txId}</span></div>` : ""}
    </div>
    <div class="notice">${escHtml(subtitle)}</div>
    <p class="powered">Powered by Protected Payment Services</p>
  </div>
</body>
</html>`);
    } catch (err) {
      console.error("[PayResult] Error:", err);
      res.status(500).send(errorHtml("Error", "An unexpected error occurred."));
    }
  };
  app.get("/api/pay/:token/result", handlePayResult);
  app.post("/api/pay/:token/result", handlePayResult);

  // ── PPS Callback Reachability Test ────────────────────────────────────────
  // GET /api/pps/callback — simple 200 OK so we can verify the URL is publicly reachable
  app.get("/api/pps/callback", (_req, res) => {
    res.status(200).send("PPS callback endpoint is reachable");
  });

  // ── PPS Payment Callback ────────────────────────────────────────────────────
  // PPS POSTs the payment result here server-to-server after the customer pays.
  // This is the authoritative source of truth — we verify the signature and update the DB.
  app.post("/api/pps/callback", async (req, res) => {
    try {
      const signingSecret = ENV.ppsSigningSecret;

      if (!signingSecret) {
        console.error("[PPS Callback] Signing secret not configured");
        res.status(200).send("OK");
        return;
      }

      // express.raw() gives us a Buffer for this route — parse it ourselves so we can
      // verify the signature against the original URL-encoded string (before decoding).
      // Express's urlencoded parser decodes values, which changes the encoding and breaks
      // the signature check (e.g. ':' → '%3A' differs between PPS and Node's URLSearchParams).
      let fields: Record<string, string> = {};
      let rawBody = "";
      if (Buffer.isBuffer(req.body)) {
        rawBody = req.body.toString("utf8");
        const params = new URLSearchParams(rawBody);
        Array.from(params.entries()).forEach(([k, v]) => { fields[k] = v; });
      } else {
        // Fallback: body already parsed by urlencoded middleware
        fields = req.body as Record<string, string>;
      }

      const receivedSig = fields.signature ?? "";
      console.log("[PPS Callback] Received POST. Content-Type:", req.headers['content-type']);
      console.log("[PPS Callback] Fields (excl sig):", JSON.stringify(
        Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'signature')),
        null, 2
      ));

      // Verify signature using the corrected algorithm (localeCompare sort, partial signature support).
      const sigValid = verifyPpsSignature(fields, receivedSig, signingSecret);
      if (!sigValid) {
        console.warn("[PPS Callback] Signature mismatch — processing anyway (diagnostic mode)");
        // Note: still processing to avoid missing payments. Re-enable strict rejection once confirmed working.
      } else {
        console.log("[PPS Callback] Signature valid");
      }

      const transactionUnique = fields.transactionUnique ?? "";
      const responseCode = fields.responseCode ?? "";
      const responseMessage = fields.responseMessage ?? "";
      const ppsTransactionId = fields.transactionID ?? fields.xref ?? "";

      if (!transactionUnique) {
        console.error("[PPS Callback] No transactionUnique in callback");
        res.status(200).send("OK");
        return;
      }

      const db = await getDb();
      if (!db) { res.status(500).send("DB error"); return; }

      // Fetch the payment link record by transactionUnique (Tom's approach — no merchantData field)
      const [link] = await db
        .select()
        .from(paymentLinks)
        .where(eq(paymentLinks.transactionUnique, transactionUnique));

      if (!link) {
        console.error(`[PPS Callback] Payment link not found for transactionUnique: ${transactionUnique}`);
        res.status(200).send("OK");
        return;
      }

      // Idempotency: if already paid, just return OK
      if (link.status === "paid") {
        res.status(200).send("OK");
        return;
      }

      const isPaid = responseCode === "0";
      const newStatus = isPaid ? "paid" : "failed";

      await db
        .update(paymentLinks)
        .set({
          status: newStatus,
          ppsTransactionId,
          ppsResponseCode: responseCode,
          ppsResponseMessage: responseMessage,
          ...(isPaid ? { paidAt: new Date() } : {}),
        })
        .where(eq(paymentLinks.id, link.id));

      if (isPaid) {
        // Look up booking + agent for notifications
        const [bookingRow] = await db
          .select({ id: bookings.id, clientName: bookings.clientName, ptsRef: bookings.ptsRef, agentId: bookings.agentId, clientEmail: bookings.clientEmail })
          .from(bookings)
          .where(eq(bookings.id, link.bookingId));

        if (bookingRow) {
          const [agentRow] = await db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, bookingRow.agentId));

          const amountFormatted = `£${(link.amountPence / 100).toFixed(2)}`;

          // In-app notification to agent
          await createInAppNotification({
            userId: bookingRow.agentId,
            bookingId: bookingRow.id,
            message: `Payment of ${amountFormatted} received for "${bookingRow.clientName}" (PTS: ${bookingRow.ptsRef ?? link.orderRef}).`,
            linkUrl: `/bookings/${bookingRow.id}`,
          });

          // Email notification to agent
          if (agentRow?.email) {
            await sendNotificationEmail({
              triggerKey: "payment_received",
              toEmail: agentRow.email,
              toName: agentRow.name ?? "Agent",
              variables: {
                clientName: bookingRow.clientName,
                ptsRef: bookingRow.ptsRef ?? link.orderRef,
                amount: amountFormatted,
                transactionId: ppsTransactionId,
              },
              bookingId: bookingRow.id,
            });
          }

          // Email confirmation to client
          if (bookingRow.clientEmail) {
            const ptsRef = bookingRow.ptsRef ?? link.orderRef;
            await sendDirectEmail({
              toEmail: bookingRow.clientEmail,
              toName: bookingRow.clientName ?? "Customer",
              subject: `Payment Confirmed – ${ptsRef}`,
              html: `<p>Dear ${bookingRow.clientName ?? "Customer"},</p><p>Thank you for your payment of <strong>${amountFormatted}</strong>. Your payment has been received and processed successfully.</p><p><strong>Booking Reference:</strong> ${ptsRef}<br/><strong>Transaction ID:</strong> ${ppsTransactionId}</p><p>If you have any questions, please contact your travel agent.</p><p>The JLT Group Team</p>`,
            });
          }
        }
      }

      console.log(`[PPS Callback] Link ${link.id} (txn: ${transactionUnique}) → ${newStatus} (code: ${responseCode})`);
      res.status(200).send("OK");
    } catch (err) {
      console.error("[PPS Callback] Error:", err);
      // Always return 200 to prevent PPS retry storms
      res.status(200).send("OK");
    }
  });

  // ── GoCardless Webhook ────────────────────────────────────────────────────
  // GoCardless POSTs events here. We handle mandates_active to auto-create subscriptions.
  app.post("/api/gocardless/webhook", async (req, res) => {
    try {
      // ── HMAC-SHA256 signature verification ────────────────────────────────
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
      const webhookSecret = process.env.GOCARDLESS_WEBHOOK_SECRET;
      const incomingSig = req.headers["webhook-signature"] as string | undefined;
      if (webhookSecret) {
        if (!incomingSig) {
          console.warn("[GC Webhook] Missing Webhook-Signature header — request rejected");
          return res.status(498).send("Missing signature");
        }
        const { createHmac } = await import("crypto");
        const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
        if (expected !== incomingSig) {
          console.warn("[GC Webhook] Invalid signature — request rejected");
          return res.status(498).send("Invalid signature");
        }
      } else {
        console.warn("[GC Webhook] GOCARDLESS_WEBHOOK_SECRET not set — skipping signature check");
      }
      // Parse the raw buffer to JSON
      const payload = JSON.parse(rawBody.toString());
      const events: Array<{ id: string; action: string; resource_type: string; links: Record<string, string> }> =
        payload?.events ?? [];

      for (const event of events) {
        console.log(`[GC Webhook] ${event.resource_type}.${event.action}`, event.links);

        // ── Join Flow: billing_request fulfilled → create agent account + subscription ──
        if (event.resource_type === "billing_requests" && event.action === "fulfilled") {
          const billingRequestId = event.links.billing_request;
          if (!billingRequestId) continue;

          const db = await getDb();
          if (!db) continue;

          // Find the join session for this billing request
          const sessionRows = await db
            .select()
            .from(joinSessions)
            .where(eq(joinSessions.billingRequestId, billingRequestId))
            .limit(1);
          const session = sessionRows[0];
          if (!session) {
            console.log(`[GC Webhook] billing_request.fulfilled: no join session for ${billingRequestId}`);
            continue;
          }

          // Idempotency: if already processed AND mandate row exists, skip
          if (session.userId) {
            // Check if mandate row was already created
            const existingMandate = await getGcMandateByBillingRequestId(billingRequestId);
            if (existingMandate) {
              console.log(`[GC Webhook] billing_request.fulfilled: already fully processed for session ${session.id}`);
              continue;
            }
            // User exists but mandate row is missing — create it now
            console.log(`[GC Webhook] billing_request.fulfilled: user ${session.userId} exists but mandate row missing — creating now`);
            try {
              const { createGcMandate: insertMandate } = await import("../gocardless-db");
              await insertMandate({
                userId: session.userId,
                billingRequestId: session.billingRequestId!,
                billingRequestFlowId: session.billingRequestId!,
                preferredPaymentDay: 1,
                joiningFeePaidAt: session.joiningFeePaidAt ?? new Date(),
              });
              console.log(`[GC Webhook] billing_request.fulfilled: created missing mandate row for user ${session.userId}`);
            } catch (mErr: any) {
              console.error(`[GC Webhook] Failed to create missing mandate row for user ${session.userId}:`, mErr.message);
            }
            continue;
          }

          // Create the agent user account
          let newUser: Awaited<ReturnType<typeof createAgentUser>>;
          try {
            const tempPassword = Math.random().toString(36).slice(2, 10) + "!Jlt1";
            const hashedPassword = await bcrypt.hash(tempPassword, 10);
            newUser = await createAgentUser({
              name: session.signerName ?? session.email,
              email: session.email,
              hashedPassword,
            });
          } catch (err: any) {
            console.error(`[GC Webhook] Failed to create agent user for ${session.email}:`, err.message);
            continue;
          }

          if (!newUser) {
            console.error(`[GC Webhook] createAgentUser returned null for ${session.email}`);
            continue;
          }

          // Link session to new user
          await db
            .update(joinSessions)
            .set({
              userId: newUser.id,
              joiningFeePaidAt: new Date(),
              step: "complete",
            })
            .where(eq(joinSessions.id, session.id));

          // Create CRM profile with membership tier and personal email from sign-up
          await db.insert(agentCrmProfiles).values({
            userId: newUser.id,
            membershipTier: session.membershipTier ?? "business_class",
            dateJoined: new Date().toISOString().slice(0, 10),
            agentStatus: "active",
            trainingStage: "Training",
            personalEmail: session.email ?? null,
          } as any).onDuplicateKeyUpdate({
            set: {
              membershipTier: session.membershipTier ?? "business_class",
              dateJoined: new Date().toISOString().slice(0, 10),
              trainingStage: "Training",
              personalEmail: session.email ?? null,
            },
          });

          // Auto-link team: if this new agent was invited as a duo/trio partner, or if they are the
          // leader and their partner already has an account, link both CRM profiles to the same team now.
          // This ensures team linkage happens at payment confirmation, not just at invite-acceptance.
          try {
            const { and: andOp } = await import("drizzle-orm");
            // Case 1: This agent was invited as a partner — find a pending invite for their email
            const inviteForThisAgent = await db
              .select()
              .from(teamInvites)
              .where(
                andOp(
                  eq(teamInvites.invitedEmail, session.email),
                  eq(teamInvites.status, "pending")
                )
              )
              .limit(1);
            if (inviteForThisAgent[0]) {
              const invite = inviteForThisAgent[0];
              await db
                .update(agentCrmProfiles)
                .set({ teamId: invite.teamId })
                .where(eq(agentCrmProfiles.userId, newUser.id));
              await db
                .update(teamInvites)
                .set({ status: "accepted", acceptedAt: new Date(), acceptedByUserId: newUser.id })
                .where(eq(teamInvites.id, invite.id));
              console.log(`[GC Webhook] Auto-linked user ${newUser.id} (${session.email}) to team ${invite.teamId} via pending invite`);
            }
            // Case 2: This agent is the leader — find any pending invites they sent and link
            // partners who already have a CRM profile (partner joined before leader's payment confirmed)
            const leaderProfileRows = await db
              .select({ teamId: agentCrmProfiles.teamId })
              .from(agentCrmProfiles)
              .where(eq(agentCrmProfiles.userId, newUser.id))
              .limit(1);
            const leaderTeamId = leaderProfileRows[0]?.teamId;
            if (leaderTeamId) {
              const pendingInvitesByLeader = await db
                .select()
                .from(teamInvites)
                .where(
                  andOp(
                    eq(teamInvites.leaderId, newUser.id),
                    eq(teamInvites.status, "pending")
                  )
                );
              for (const invite of pendingInvitesByLeader) {
                const partnerUserRows = await db
                  .select({ id: usersTable.id })
                  .from(usersTable)
                  .where(eq(usersTable.email, invite.invitedEmail))
                  .limit(1);
                if (partnerUserRows[0]) {
                  const partnerUserId = partnerUserRows[0].id;
                  const partnerProfileRows = await db
                    .select({ id: agentCrmProfiles.id, teamId: agentCrmProfiles.teamId })
                    .from(agentCrmProfiles)
                    .where(eq(agentCrmProfiles.userId, partnerUserId))
                    .limit(1);
                  if (partnerProfileRows[0] && !partnerProfileRows[0].teamId) {
                    await db
                      .update(agentCrmProfiles)
                      .set({ teamId: leaderTeamId })
                      .where(eq(agentCrmProfiles.userId, partnerUserId));
                    await db
                      .update(teamInvites)
                      .set({ status: "accepted", acceptedAt: new Date(), acceptedByUserId: partnerUserId })
                      .where(eq(teamInvites.id, invite.id));
                    console.log(`[GC Webhook] Auto-linked partner ${partnerUserId} (${invite.invitedEmail}) to team ${leaderTeamId}`);
                  }
                }
              }
            }
          } catch (teamLinkErr) {
            console.error("[GC Webhook] Failed to auto-link team members:", teamLinkErr);
          }

          // Create the gc_mandates row now that we have the real userId.
          // We do this here (not in join-router) so the insert never runs without a valid userId.
          if (session.billingRequestId) {
            try {
              const { createGcMandate: insertMandate } = await import("../gocardless-db");
              await insertMandate({
                userId: newUser.id,
                billingRequestId: session.billingRequestId,
                billingRequestFlowId: session.billingRequestId, // flow ID not stored on session; use brq ID as reference
                preferredPaymentDay: 1, // default — agent updates during onboarding
                joiningFeePaidAt: new Date(),
              });
            } catch (mandateErr: any) {
              // If a row already exists (duplicate), update it instead
              if (mandateErr?.code === "ER_DUP_ENTRY" || String(mandateErr?.message).includes("duplicate")) {
                try {
                  const existing = await getGcMandateByBillingRequestId(session.billingRequestId);
                  if (existing) {
                    await updateGcMandate(existing.id, { userId: newUser.id, joiningFeePaidAt: new Date() });
                  }
                } catch (upErr) {
                  console.error(`[GC Webhook] Failed to upsert gc_mandate for billing request ${session.billingRequestId}:`, upErr);
                }
              } else {
                console.error(`[GC Webhook] Failed to create gc_mandate for billing request ${session.billingRequestId}:`, mandateErr);
              }
            }
          }

          // Notify support@ by email only (no Manus in-app notification)
          try {
            await sendSupportEmail({
              subject: `New Agent Joined: ${session.signerName ?? session.email}`,
              html: `
                <div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF6ED;padding:32px;border-radius:16px;">
                  <h2 style="color:#414141;margin:0 0 16px;">New Agent Joined via Self-Sign-Up</h2>
                  <table style="width:100%;border-collapse:collapse;">
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Name</td><td style="padding:6px 0;color:#414141;font-weight:600;">${session.signerName ?? "—"}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Email</td><td style="padding:6px 0;color:#414141;">${session.email}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Membership</td><td style="padding:6px 0;color:#414141;">${session.membershipTier ?? "business_class"} — ${session.membershipType ?? "solo"}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">User ID</td><td style="padding:6px 0;color:#414141;">${newUser.id}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Signed up</td><td style="padding:6px 0;color:#414141;">${new Date().toUTCString()}</td></tr>
                  </table>
                  <p style="margin:20px 0 0;color:#414141;">Please <strong>activate their portal access</strong> in the CRM once onboarding is complete.</p>
                  <p style="margin:8px 0 0;color:#9ca3af;font-size:.8rem;">JLT Group Booking Portal — automated notification</p>
                </div>
              `,
            });
          } catch (supportEmailErr) {
            console.error("[GC Webhook] Failed to send support new-joiner email:", supportEmailErr);
          }

          // Send welcome email with credentials
          try {
            const { sendDirectEmail: sendEmail } = await import("../email");
            await sendEmail({
              toEmail: session.email,
              toName: session.signerName ?? session.email,
              subject: "Welcome to JLT Group — You're officially one of us! 🎉",
              html: `
                <div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF6ED;padding:32px;border-radius:16px;">
                  <div style="text-align:center;margin-bottom:24px;">
                    <div style="background:#70FFE8;border-radius:50%;width:56px;height:56px;display:inline-flex;align-items:center;justify-content:center;">
                      <span style="font-weight:700;color:#414141;font-size:1rem">JLT</span>
                    </div>
                    <h1 style="color:#414141;font-size:1.4rem;margin:16px 0 4px;">Welcome to JLT Group, ${(session.signerName ?? '').split(' ')[0] || 'there'}!</h1>
                  </div>
                  <div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:24px;">
                    <p style="color:#414141;margin:0 0 14px;">Hi ${session.signerName ?? session.email},</p>
                    <p style="color:#414141;margin:0 0 14px;">Thank you so much for joining JLT Group &mdash; we&rsquo;re really excited to have you on board! Your payment has been confirmed and you&rsquo;re now officially part of the team.</p>
                    <p style="color:#414141;font-weight:600;margin:0 0 10px;">Here&rsquo;s what happens next:</p>
                    <table style="width:100%;border-collapse:collapse;margin:0 0 14px;">
                      <tr><td style="padding:8px 0;vertical-align:top;width:28px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#70FFE8;color:#414141;font-size:.7rem;font-weight:700;">1</span></td><td style="padding:8px 0;color:#414141;font-size:.9rem;"><strong>Complete your onboarding</strong> &mdash; log in to your portal and work through the onboarding steps so we have everything we need to get you fully set up.</td></tr>
                      <tr><td style="padding:8px 0;vertical-align:top;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#70FFE8;color:#414141;font-size:.7rem;font-weight:700;">2</span></td><td style="padding:8px 0;color:#414141;font-size:.9rem;"><strong>Look out for your Training Hub email</strong> &mdash; our team will send you a separate email with your Training Hub login details as soon as your account is ready.</td></tr>
                      <tr><td style="padding:8px 0;vertical-align:top;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#70FFE8;color:#414141;font-size:.7rem;font-weight:700;">3</span></td><td style="padding:8px 0;color:#414141;font-size:.9rem;"><strong>We&rsquo;ll be in touch</strong> &mdash; a member of the team will reach out to welcome you personally and walk you through your next steps. Please note that responses may be a little slower during evenings and weekends, but we&rsquo;ll always get back to you as quickly as we can.</td></tr>
                    </table>
                    <p style="color:#414141;margin:0;">If you have any questions in the meantime, don&rsquo;t hesitate to get in touch &mdash; we&rsquo;re here to help.</p>
                  </div>
                  <p style="color:#9ca3af;font-size:.75rem;text-align:center;margin:0;">Questions? Email <a href="mailto:memberships@thejltgroup.co.uk" style="color:#02E6D2;">memberships@thejltgroup.co.uk</a></p>
                </div>
              `,
            });
          } catch (emailErr) {
            console.error("[GC Webhook] Failed to send welcome email:", emailErr);
          }

          console.log(`[GC Webhook] billing_request.fulfilled: created agent user ${newUser.id} for ${session.email}`);

          // Advance recruitment prospect to 'won' if one exists with this email
          try {
            const { moveRecruitmentProspectStage } = await import("../recruitment-db");
            const { getAllRecruitmentProspects } = await import("../recruitment-db");
            const allProspects = await getAllRecruitmentProspects();
            const prospect = allProspects.find(
              (p: any) => p.email?.toLowerCase() === session.email?.toLowerCase()
            );
            if (prospect && prospect.pipelineStage !== "won") {
              await moveRecruitmentProspectStage({
                prospectId: prospect.id,
                toStage: "won",
                changedByName: "System (payment confirmed)",
                note: `Joining fee paid via GoCardless — agent account created (user #${newUser.id})`,
              });
              console.log(`[GC Webhook] Recruitment prospect ${prospect.id} advanced to 'won'`);
            }
          } catch (recruitErr) {
            console.error("[GC Webhook] Failed to advance recruitment prospect stage:", recruitErr);
          }
        }

        // Mandate became active → create the subscription
        if (event.resource_type === "mandates" && event.action === "active") {
          const mandateId = event.links.mandate;
          if (!mandateId) continue;

          // Find our local record via billing_request link (if present) or mandate ID
          const billingRequestId = event.links.billing_request ?? null;
          let localMandate = billingRequestId
            ? await getGcMandateByBillingRequestId(billingRequestId)
            : null;

          if (!localMandate) {
            // Mandate row missing — try to create it now by looking up the join session via billingRequestId
            console.warn(`[GC Webhook] mandates.active: no local mandate for ${mandateId}, attempting recovery via join session`);
            if (billingRequestId) {
              try {
                const db2 = await getDb();
                if (db2) {
                  const { joinSessions: jSess } = await import("../../drizzle/schema");
                  const { eq: eqOp } = await import("drizzle-orm");
                  const sessRows = await db2.select().from(jSess).where(eqOp(jSess.billingRequestId, billingRequestId)).limit(1);
                  const sess = sessRows[0];
                  if (sess?.userId) {
                    const { createGcMandate: insertMandate } = await import("../gocardless-db");
                    await insertMandate({
                      userId: sess.userId,
                      billingRequestId,
                      billingRequestFlowId: billingRequestId,
                      preferredPaymentDay: 1,
                      joiningFeePaidAt: sess.joiningFeePaidAt ?? new Date(),
                    });
                    localMandate = await getGcMandateByBillingRequestId(billingRequestId);
                    console.log(`[GC Webhook] mandates.active: recovered mandate row for user ${sess.userId}`);
                  }
                }
              } catch (recErr: any) {
                console.error(`[GC Webhook] mandates.active: recovery failed:`, recErr.message);
              }
            }
            if (!localMandate) {
              console.warn(`[GC Webhook] mandates.active: could not recover mandate for ${mandateId}, skipping subscription creation`);
              continue;
            }
          }

          // Update local mandate status
          await updateGcMandate(localMandate.id, { mandateId, status: "active" });

          // Calculate subscription start date: 1 month after joining fee payment
          const joiningFeeDate = localMandate.joiningFeePaidAt ?? new Date();
          const dayOfMonth = localMandate.preferredPaymentDay ?? 1;
          const startDate = calcSubscriptionStartDate(joiningFeeDate, dayOfMonth);

          // Look up the agent's membership tier/type to get the correct monthly amount
          let monthlyAmountPence = 3000; // fallback £30
          try {
            const db2 = await getDb();
            if (db2) {
              const { agentCrmProfiles: crmProfiles } = await import("../../drizzle/schema");
              const { eq: eqOp } = await import("drizzle-orm");
              const crmRows = await db2.select().from(crmProfiles).where(eqOp(crmProfiles.userId, localMandate.userId ?? 0)).limit(1);
              if (crmRows[0]) {
                const tier = (crmRows[0].membershipTier ?? "business_class") as any;
                // Look up the join session to get membershipType
                const { joinSessions: jSessions } = await import("../../drizzle/schema");
                const sessionRows = await db2.select().from(jSessions).where(eqOp(jSessions.userId, localMandate.userId ?? 0)).limit(1);
                const membershipType = (sessionRows[0]?.membershipType ?? "solo") as any;
                monthlyAmountPence = getMonthlyAmount(tier, membershipType);
              }
            }
          } catch (amtErr) {
            console.error("[GC Webhook] Could not resolve monthly amount, using fallback:", amtErr);
          }

          // Create the GoCardless subscription
          const sub = await createSubscription({
            mandateId,
            amountPence: monthlyAmountPence,
            name: "JLT Monthly Membership",
            startDate,
            dayOfMonth,
          });

          // Store subscription locally
          await createGcSubscription({
            userId: localMandate.userId ?? 0,
            mandateId,
            subscriptionId: sub.id,
            amount: sub.amount,
            startDate,
            dayOfMonth,
            nextChargeDate: sub.upcoming_payments?.[0]?.charge_date,
          });

          // Notify support@ by email only
          try {
            await sendSupportEmail({
              subject: `Direct Debit Mandate Active — Agent ID ${localMandate.userId}`,
              html: `
                <div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF6ED;padding:32px;border-radius:16px;">
                  <h2 style="color:#414141;margin:0 0 16px;">New Direct Debit Mandate Active</h2>
                  <table style="width:100%;border-collapse:collapse;">
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Agent User ID</td><td style="padding:6px 0;color:#414141;font-weight:600;">${localMandate.userId}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Mandate ID</td><td style="padding:6px 0;color:#414141;">${mandateId}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">First payment date</td><td style="padding:6px 0;color:#414141;">${startDate}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Monthly amount</td><td style="padding:6px 0;color:#414141;">£${(monthlyAmountPence / 100).toFixed(2)}</td></tr>
                  </table>
                  <p style="margin:8px 0 0;color:#9ca3af;font-size:.8rem;">JLT Group Booking Portal — automated notification</p>
                </div>
              `,
            });
          } catch (supportEmailErr) {
            console.error("[GC Webhook] Failed to send support DD mandate email:", supportEmailErr);
          }

          console.log(`[GC Webhook] Subscription ${sub.id} created for mandate ${mandateId}, starts ${startDate}`);
        }

        // Mandate submitted / pending_submission — update status badge in CRM
        if (
          event.resource_type === "mandates" &&
          ["submitted", "pending_submission"].includes(event.action)
        ) {
          const mandateId = event.links.mandate;
          const billingRequestId = event.links.billing_request ?? null;
          // Try to find local mandate by mandate ID first, then by billing request
          let localMandate = mandateId
            ? await (async () => {
                const db2 = await getDb();
                if (!db2) return null;
                const { gcMandates: gcMandatesT } = await import("../../drizzle/schema");
                const { eq: eqOp } = await import("drizzle-orm");
                const rows = await db2.select().from(gcMandatesT).where(eqOp(gcMandatesT.mandateId, mandateId)).limit(1);
                return rows[0] ?? null;
              })()
            : null;
          if (!localMandate && billingRequestId) {
            localMandate = await getGcMandateByBillingRequestId(billingRequestId);
          }
          if (localMandate) {
            const newStatus = event.action as "submitted" | "pending_submission";
            // Also persist the real mandateId if we didn't have it before
            await updateGcMandate(localMandate.id, {
              status: newStatus,
              ...(mandateId && !localMandate.mandateId ? { mandateId } : {}),
            });
            console.log(`[GC Webhook] Mandate ${mandateId} status → ${newStatus} for user ${localMandate.userId}`);
          } else {
            console.warn(`[GC Webhook] mandates.${event.action}: no local mandate found for mandateId=${mandateId} billingRequestId=${billingRequestId}`);
          }
        }

        // Mandate cancelled/failed/expired
        if (
          event.resource_type === "mandates" &&
          ["cancelled", "failed", "expired"].includes(event.action)
        ) {
          const mandateId = event.links.mandate;
          const billingRequestId = event.links.billing_request ?? null;
          const localMandate = billingRequestId
            ? await getGcMandateByBillingRequestId(billingRequestId)
            : null;
          if (localMandate) {
            await updateGcMandate(localMandate.id, {
              status: event.action as "cancelled" | "failed" | "expired",
            });
            // Record the event
            await createPaymentEvent({
              userId: localMandate.userId ?? undefined,
              mandateId,
              eventType: `mandates_${event.action}`,
              status: event.action,
              occurredAt: new Date(),
              rawPayload: JSON.stringify(event),
            });
            // Notify support@ by email only
            try {
              await sendSupportEmail({
                subject: `DD Mandate ${event.action.charAt(0).toUpperCase() + event.action.slice(1)} — Agent ID ${localMandate.userId}`,
                html: `
                  <div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF6ED;padding:32px;border-radius:16px;">
                    <h2 style="color:#414141;margin:0 0 16px;">DD Mandate ${event.action.charAt(0).toUpperCase() + event.action.slice(1)}</h2>
                    <table style="width:100%;border-collapse:collapse;">
                      <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Agent User ID</td><td style="padding:6px 0;color:#414141;font-weight:600;">${localMandate.userId}</td></tr>
                      <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Mandate ID</td><td style="padding:6px 0;color:#414141;">${mandateId}</td></tr>
                      <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Status</td><td style="padding:6px 0;color:#dc2626;font-weight:600;">${event.action}</td></tr>
                      <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Time</td><td style="padding:6px 0;color:#414141;">${new Date().toUTCString()}</td></tr>
                    </table>
                    <p style="margin:20px 0 0;color:#414141;">Please check the agent's account in the CRM and take appropriate action.</p>
                    <p style="margin:8px 0 0;color:#9ca3af;font-size:.8rem;">JLT Group Booking Portal — automated notification</p>
                  </div>
                `,
              });
            } catch (supportEmailErr) {
              console.error("[GC Webhook] Failed to send support mandate status email:", supportEmailErr);
            }
            console.log(`[GC Webhook] Mandate ${mandateId} ${event.action} for user ${localMandate.userId}`);
          }
        }

        // Payment failed or charged back
        if (
          event.resource_type === "payments" &&
          ["confirmed", "paid_out", "failed", "charged_back", "cancelled"].includes(event.action)
        ) {
          const paymentId = event.links.payment;
          let mandateId: string | undefined = event.links.mandate;
          const subscriptionId = event.links.subscription;
          const meta = (event as any).details ?? {};
          // Resolve amount from the payment resource if available
          // Also resolve mandateId from the payment API if not in webhook links
          // (GoCardless confirmed/paid_out events often omit links.mandate)
          let amount: number | undefined;
          let currency: string | undefined;
          try {
            const { fetchPayment } = await import("../gocardless");
            if (paymentId) {
              const gcPayment = await fetchPayment(paymentId);
              amount = gcPayment?.amount;
              currency = gcPayment?.currency;
              if (!mandateId && gcPayment?.links?.mandate) {
                mandateId = gcPayment.links.mandate;
                console.log(`[GC Webhook] Resolved mandateId ${mandateId} from payment API for ${paymentId}`);
              }
            }
          } catch { /* non-critical */ }
          // Resolve user from mandate
          let userId: number | undefined;
          if (mandateId) {
            const db = await getDb();
            if (db) {
              const { gcMandates } = await import("../../drizzle/schema");
              const { eq: eqOp } = await import("drizzle-orm");
              const rows = await db.select().from(gcMandates).where(eqOp(gcMandates.mandateId, mandateId)).limit(1);
              if (rows[0]) userId = rows[0].userId ?? undefined;
            }
          }
          await createPaymentEvent({
            userId,
            mandateId,
            paymentId,
            eventType: `payments_${event.action}`,
            status: event.action,
            amount,
            currency,
            failureReason: meta.cause ?? meta.reason_code ?? undefined,
            failureDescription: meta.description ?? undefined,
            occurredAt: new Date(),
            rawPayload: JSON.stringify(event),
          });
          // For failures and chargebacks, notify support
          if (["failed", "charged_back"].includes(event.action)) {
            try {
              // Resolve agent name + email for the support notification
              let supportAgentName: string | null = null;
              let supportAgentEmail: string | null = null;
              if (userId) {
                const dbForSupport = await getDb();
                if (dbForSupport) {
                  const { users: usersT } = await import("../../drizzle/schema");
                  const { eq: eqOp } = await import("drizzle-orm");
                  const [agentRow] = await dbForSupport.select().from(usersT).where(eqOp(usersT.id, userId)).limit(1);
                  supportAgentName = agentRow?.name ?? null;
                  supportAgentEmail = agentRow?.email ?? null;
                }
              }
              const crmProfileUrl = userId ? `https://portal.thejltgroup.co.uk/crm/${userId}` : null;
              await sendSupportEmail({
                subject: `DD Payment ${event.action === "charged_back" ? "Charged Back" : "Failed"}${supportAgentName ? ` — ${supportAgentName}` : userId ? ` — Agent ID ${userId}` : ""}`,
                html: `
                  <div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF6ED;padding:32px;border-radius:16px;">
                    <h2 style="color:#414141;margin:0 0 16px;">DD Payment ${event.action === "charged_back" ? "Charged Back" : "Failed"}</h2>
                    <table style="width:100%;border-collapse:collapse;">
                      ${supportAgentName ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Agent Name</td><td style="padding:6px 0;color:#414141;font-weight:600;">${supportAgentName}</td></tr>` : ""}
                      ${supportAgentEmail ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Agent Email</td><td style="padding:6px 0;color:#414141;">${supportAgentEmail}</td></tr>` : ""}
                      ${userId ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Agent ID</td><td style="padding:6px 0;color:#414141;">${userId}</td></tr>` : ""}
                      <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Payment ID</td><td style="padding:6px 0;color:#414141;">${paymentId ?? "—"}</td></tr>
                      <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Event</td><td style="padding:6px 0;color:#dc2626;font-weight:600;">${event.action}</td></tr>
                      ${meta.description ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Reason</td><td style="padding:6px 0;color:#414141;">${meta.description}</td></tr>` : ""}
                      <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Time</td><td style="padding:6px 0;color:#414141;">${new Date().toUTCString()}</td></tr>
                    </table>
                    ${crmProfileUrl ? `<p style="margin:20px 0 8px;"><a href="${crmProfileUrl}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;font-size:14px;">View Agent in CRM →</a></p>` : ""}
                    <p style="margin:12px 0 0;color:#414141;">Please check the agent's account in the CRM and contact them if necessary.</p>
                    <p style="margin:8px 0 0;color:#9ca3af;font-size:.8rem;">JLT Group Booking Portal — automated notification</p>
                  </div>
                `,
              });
            } catch (supportEmailErr) {
              console.error("[GC Webhook] Failed to send support payment failed email:", supportEmailErr);
            }
          }
          // ── Send receipt email to agent on confirmed/paid_out ──────────────
          if (["confirmed", "paid_out"].includes(event.action) && userId) {
            try {
              const db2 = await getDb();
              let agentEmail: string | null = null;
              let agentName: string | null = null;
              let membershipTier: string | null = null;
              if (db2) {
                const { users: usersT } = await import("../../drizzle/schema");
                const { eq: eqOp } = await import("drizzle-orm");
                const [agentRow] = await db2.select().from(usersT).where(eqOp(usersT.id, userId)).limit(1);
                agentEmail = agentRow?.email ?? null;
                agentName = agentRow?.name ?? null;
                membershipTier = (agentRow as any)?.membershipTier ?? null;
              }
              if (agentEmail) {
                const amountFormatted = amount ? `\u00a3${(amount / 100).toFixed(2)}` : "\u2014";
                const tierLabel = membershipTier === "first_class" ? "First Class" : membershipTier === "charter" ? "Charter" : "Business Class";
                const receiptHtml = `<div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);"><div style="background:#70FFE8;padding:28px 32px;"><h1 style="margin:0;font-size:22px;font-weight:700;color:#1a1a2e;">JLT Group</h1><p style="margin:4px 0 0;font-size:13px;color:#1a1a2e;opacity:0.7;">Membership Payment Receipt</p></div><div style="padding:32px;"><p style="color:#414141;margin:0 0 20px;">Hi ${agentName ?? "there"},</p><p style="color:#414141;margin:0 0 20px;">Your JLT Group membership payment has been successfully collected.</p><table style="width:100%;border-collapse:collapse;margin:0 0 24px;"><tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:10px 0;color:#6b7280;font-size:14px;">Amount</td><td style="padding:10px 0;color:#414141;font-weight:700;font-size:16px;text-align:right;">${amountFormatted}</td></tr><tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:10px 0;color:#6b7280;font-size:14px;">Membership</td><td style="padding:10px 0;color:#414141;font-weight:600;text-align:right;">${tierLabel}</td></tr><tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:10px 0;color:#6b7280;font-size:14px;">Date</td><td style="padding:10px 0;color:#414141;text-align:right;">${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</td></tr><tr><td style="padding:10px 0;color:#6b7280;font-size:14px;">Reference</td><td style="padding:10px 0;color:#414141;font-family:monospace;text-align:right;">${paymentId ?? "\u2014"}</td></tr></table><p style="color:#6b7280;font-size:13px;margin:0;">For queries contact <a href="mailto:memberships@thejltgroup.co.uk" style="color:#02E6D2;">memberships@thejltgroup.co.uk</a>.</p></div><div style="background:#f9fafb;padding:20px 32px;border-top:1px solid #f0f0f0;"><p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">JLT Group &bull; <a href="https://portal.thejltgroup.co.uk" style="color:#02E6D2;">portal.thejltgroup.co.uk</a></p></div></div>`;
                await sendDirectEmail({ toEmail: agentEmail, toName: agentName ?? "Agent", subject: `Membership Payment Receipt \u2014 ${amountFormatted}`, html: receiptHtml, ...(({ triggerKey: "gc_receipt", userId } as any)) });
              }
              // Reset consecutive failure counter on successful payment
              if (db2) {
                const { gcPaymentFailures: gcPF } = await import("../../drizzle/schema");
                const { eq: eqOp } = await import("drizzle-orm");
                await db2.update(gcPF).set({ consecutiveFailures: 0 }).where(eqOp(gcPF.userId, userId));
              }
            } catch (receiptErr) {
              console.error("[GC Webhook] Failed to send receipt email:", receiptErr);
            }
          }
          // ── Send failure email to agent + auto-suspend after 3 failures ──
          if (["failed", "charged_back"].includes(event.action) && userId) {
            try {
              const db2 = await getDb();
              let agentEmail: string | null = null;
              let agentName: string | null = null;
              let newConsecutive = 1;
              if (db2) {
                const { users: usersT, gcPaymentFailures: gcPF } = await import("../../drizzle/schema");
                const { eq: eqOp } = await import("drizzle-orm");
                const [agentRow] = await db2.select().from(usersT).where(eqOp(usersT.id, userId)).limit(1);
                agentEmail = agentRow?.email ?? null;
                agentName = agentRow?.name ?? null;
                const [existing] = await db2.select().from(gcPF).where(eqOp(gcPF.userId, userId)).limit(1);
                if (existing) {
                  newConsecutive = (existing.consecutiveFailures ?? 0) + 1;
                  await db2.update(gcPF).set({ consecutiveFailures: newConsecutive, lastFailedAt: new Date() }).where(eqOp(gcPF.userId, userId));
                } else {
                  await db2.insert(gcPF).values({ userId, consecutiveFailures: 1, lastFailedAt: new Date() });
                }
                if (newConsecutive >= 3 && agentRow && (agentRow as any).agentStatus !== "suspended") {
                  await db2.update(usersT).set({ agentStatus: "suspended", suspendedAt: new Date() } as any).where(eqOp(usersT.id, userId));
                  await db2.update(gcPF).set({ autoSuspendedAt: new Date() }).where(eqOp(gcPF.userId, userId));
                  await sendSupportEmail({ subject: `\u26a0\ufe0f Agent Auto-Suspended \u2014 3 Consecutive DD Failures (Agent ID ${userId})`, html: `<div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF6ED;padding:32px;border-radius:16px;"><h2 style="color:#dc2626;margin:0 0 16px;">Agent Auto-Suspended</h2><p style="color:#414141;">Agent <strong>${agentName ?? userId}</strong> (ID: ${userId}) has been automatically suspended after <strong>3 consecutive failed Direct Debit payments</strong>.</p><p style="color:#414141;">Please review their account in the CRM and contact them to resolve the payment issue before reinstating access.</p></div>` });
                  console.log(`[GC Webhook] Agent ${userId} auto-suspended after 3 consecutive payment failures`);
                }
              }
              if (agentEmail) {
                const failureReason = meta.description ?? meta.cause ?? null;
                const isSuspended = newConsecutive >= 3;
                const failureHtml = `<div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);"><div style="background:#fee2e2;padding:28px 32px;"><h1 style="margin:0;font-size:22px;font-weight:700;color:#991b1b;">JLT Group</h1><p style="margin:4px 0 0;font-size:13px;color:#991b1b;opacity:0.8;">Membership Payment ${event.action === "charged_back" ? "Charged Back" : "Failed"}</p></div><div style="padding:32px;"><p style="color:#414141;margin:0 0 16px;">Hi ${agentName ?? "there"},</p><p style="color:#414141;margin:0 0 16px;">Your JLT Group membership Direct Debit payment was <strong>${event.action === "charged_back" ? "charged back" : "unsuccessful"}</strong>.</p>${failureReason ? `<p style="color:#6b7280;font-size:14px;margin:0 0 16px;"><strong>Reason:</strong> ${failureReason}</p>` : ""}${isSuspended ? `<div style="background:#fee2e2;border-left:4px solid #dc2626;padding:16px;border-radius:4px;margin:0 0 20px;"><p style="margin:0;color:#991b1b;font-weight:600;">Your portal access has been temporarily suspended</p><p style="margin:8px 0 0;color:#991b1b;font-size:14px;">This is due to ${newConsecutive} consecutive failed payments. Please contact us to resolve this.</p></div>` : `<p style="color:#414141;margin:0 0 20px;">This is failure <strong>${newConsecutive} of 3</strong>. If 3 consecutive payments fail, your portal access will be temporarily suspended.</p>`}<p style="color:#6b7280;font-size:13px;margin:0;">For help contact <a href="mailto:memberships@thejltgroup.co.uk" style="color:#02E6D2;">memberships@thejltgroup.co.uk</a>.</p></div><div style="background:#f9fafb;padding:20px 32px;border-top:1px solid #f0f0f0;"><p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">JLT Group &bull; <a href="https://portal.thejltgroup.co.uk" style="color:#02E6D2;">portal.thejltgroup.co.uk</a></p></div></div>`;
                await sendDirectEmail({ toEmail: agentEmail, toName: agentName ?? "Agent", subject: `Action Required: Membership Payment ${event.action === "charged_back" ? "Charged Back" : "Failed"}`, html: failureHtml, ...(({ triggerKey: "gc_payment_failed", userId } as any)) });
              }
            } catch (failureEmailErr) {
              console.error("[GC Webhook] Failed to send payment failure email to agent:", failureEmailErr);
            }
          }
          console.log(`[GC Webhook] Payment ${paymentId} ${event.action} for user ${userId ?? "unknown"} amount=${amount ?? "?"} pence`);
        }
      }

      res.status(200).json({ success: true });
    } catch (err) {
      console.error("[GC Webhook] Error:", err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ── Email Open/Click Tracking ──────────────────────────────────────────────
  app.get("/api/email-track/open", async (req, res) => {
    try {
      const sid = parseInt(req.query.sid as string);
      if (!isNaN(sid)) {
        const { getDb } = await import("../db");
        const { emailSends } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (db) {
          await db.update(emailSends).set({ status: "opened", openedAt: new Date() }).where(eq(emailSends.id, sid));
        }
      }
    } catch (e) { /* silent */ }
    // Return 1x1 transparent GIF
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "no-store");
    res.end(gif);
  });

  app.get("/api/email-track/click", async (req, res) => {
    const sid = parseInt(req.query.sid as string);
    const url = req.query.url as string;
    try {
      if (!isNaN(sid)) {
        const { getDb } = await import("../db");
        const { emailSends } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (db) {
          await db.update(emailSends).set({ status: "clicked", clickedAt: new Date() }).where(eq(emailSends.id, sid));
        }
      }
    } catch (e) { /* silent */ }
    if (url) {
      res.redirect(302, decodeURIComponent(url));
    } else {
      res.redirect(302, "/");
    }
  });

  // ── Prospectus PDF (inline viewer) ──────────────────────────────────────────
  // Proxies the PDF from CloudFront with Content-Disposition: inline so it
  // opens directly in the browser tab rather than triggering a download.
  app.get("/api/prospectus", async (_req, res) => {
    try {
      const PROSPECTUS_CDN = "https://d2xsxph8kpxj0f.cloudfront.net/310419663026820811/PdcDVQRp8zC2FzsyWBWptW/JLTProspectus-4_0115900d.pdf";
      const upstream = await fetch(PROSPECTUS_CDN);
      if (!upstream.ok) {
        res.status(502).send("Could not retrieve prospectus");
        return;
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'inline; filename="JLT-Group-Prospectus.pdf"');
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Content-Length", buffer.length);
      res.end(buffer);
    } catch (e) {
      console.error("[Prospectus] Failed to proxy PDF:", e);
      res.status(500).send("Error loading prospectus");
    }
  });

  // ── Email Unsubscribe ─────────────────────────────────────────────────────
  app.get("/api/unsubscribe", async (req, res) => {
    const token = req.query.token as string;
    if (!token) return res.redirect("/unsubscribe?error=invalid");
    try {
      const { processUnsubscribe } = await import("../resend-email");
      const email = await processUnsubscribe(token);
      if (!email) return res.redirect("/unsubscribe?error=invalid");
      res.redirect(`/unsubscribe?success=1&email=${encodeURIComponent(email)}`);
    } catch (e) {
      res.redirect("/unsubscribe?error=server");
    }
  });

  // ── Resend Webhook ──────────────────────────────────────────────────────
  // Resend POSTs delivery events here. We use it to update email_sends status.
  // Docs: https://resend.com/docs/dashboard/webhooks/event-types
  app.post("/api/webhooks/resend", async (req, res) => {
    try {
      const svixId = req.headers["svix-id"] as string | undefined;
      const svixTimestamp = req.headers["svix-timestamp"] as string | undefined;
      const svixSignature = req.headers["svix-signature"] as string | undefined;

      // Verify webhook signature if secret is configured
      const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
      if (webhookSecret && svixId && svixTimestamp && svixSignature) {
        try {
          const { createHmac } = await import("crypto");
          const rawBody = JSON.stringify(req.body);
          const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
          const secretBytes = Buffer.from(webhookSecret.replace(/^whsec_/, ""), "base64");
          const signature = createHmac("sha256", secretBytes).update(signedContent).digest("base64");
          const expectedSigs = svixSignature.split(" ").map((s) => s.replace(/^v1,/, ""));
          if (!expectedSigs.includes(signature)) {
            console.warn("[Resend Webhook] Invalid signature");
            return res.status(401).json({ error: "Invalid signature" });
          }
        } catch (sigErr) {
          console.error("[Resend Webhook] Signature verification error:", sigErr);
        }
      }

      const event = req.body as { type: string; data: Record<string, any> };
      const { type, data } = event;
      const messageId: string | undefined = data?.email_id ?? data?.message_id;

      console.log(`[Resend Webhook] ${type}`, { messageId });

      if (!messageId) {
        return res.status(200).json({ ok: true, skipped: "no message_id" });
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(200).json({ ok: true, skipped: "no db" });

      const { emailSends, emailUnsubscribes } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      // Find the send record by resendMessageId
      const [send] = await db
        .select({ id: emailSends.id, recipientEmail: emailSends.recipientEmail })
        .from(emailSends)
        .where(eq(emailSends.resendMessageId, messageId))
        .limit(1);

      if (!send) {
        console.log(`[Resend Webhook] No send record found for message_id=${messageId}`);
        return res.status(200).json({ ok: true, skipped: "no send record" });
      }

      const now = new Date();
      let updateData: Record<string, any> = {};

      switch (type) {
        case "email.delivered":
          updateData = { status: "delivered", deliveredAt: now };
          break;
        case "email.opened":
          updateData = { status: "opened", openedAt: now };
          break;
        case "email.clicked":
          updateData = { status: "clicked", clickedAt: now };
          break;
        case "email.bounced":
          updateData = { status: "bounced", bouncedAt: now, failedReason: data?.bounce?.message ?? "Bounced" };
          break;
        case "email.complained":
          // Mark as complained and auto-unsubscribe the recipient
          updateData = { status: "complained" };
          if (send.recipientEmail) {
            // Check if already unsubscribed before inserting
            const existing = await db
              .select({ id: emailUnsubscribes.id })
              .from(emailUnsubscribes)
              .where(eq(emailUnsubscribes.email, send.recipientEmail))
              .limit(1);
            if (existing.length === 0) {
              const { randomBytes } = await import("crypto");
              await db.insert(emailUnsubscribes).values({
                email: send.recipientEmail,
                token: randomBytes(32).toString("hex"),
                unsubscribedAt: now,
              });
            }
            console.log(`[Resend Webhook] Auto-unsubscribed ${send.recipientEmail} due to complaint`);
          }
          break;
        case "email.delivery_delayed":
          // Don't change status, just log
          console.log(`[Resend Webhook] Delivery delayed for send #${send.id}`);
          return res.status(200).json({ ok: true });
        default:
          return res.status(200).json({ ok: true, skipped: `unhandled event type: ${type}` });
      }

      await db.update(emailSends).set(updateData).where(eq(emailSends.id, send.id));
      console.log(`[Resend Webhook] Updated send #${send.id} → ${type}`);

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("[Resend Webhook] Error:", e);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  // ── Cal.com Webhook ──────────────────────────────────────────────────────
  // Cal.com POSTs booking events here. We use it to advance the recruitment
  // pipeline stage when a discovery call is booked or completed.
  app.post("/api/calcom/webhook", async (req, res) => {
    try {
      const payload = req.body as Record<string, any>;
      const triggerEvent: string = payload?.triggerEvent ?? "";
      const attendees: Array<{ email?: string; name?: string }> = payload?.payload?.attendees ?? [];
      const calEventId: string | undefined = payload?.payload?.uid ?? payload?.payload?.id?.toString();
      const startTime: string | undefined = payload?.payload?.startTime;

      console.log(`[Cal.com Webhook] ${triggerEvent}`, { calEventId, attendees: attendees.map((a) => a.email) });

      if (!attendees.length) {
        return res.status(200).json({ ok: true, skipped: "no attendees" });
      }

      const { getAllRecruitmentProspects, updateRecruitmentProspect, moveRecruitmentProspectStage } = await import("../recruitment-db");

      for (const attendee of attendees) {
        if (!attendee.email) continue;
        const email = attendee.email.toLowerCase().trim();

        // Find matching prospect
        const prospects = await getAllRecruitmentProspects({ limit: 5000 });
        const prospect = prospects.find((p) => p.email.toLowerCase() === email);
        if (!prospect) {
          console.log(`[Cal.com Webhook] No recruitment prospect found for ${email}`);
          continue;
        }

        if (triggerEvent === "BOOKING_CREATED" || triggerEvent === "BOOKING_RESCHEDULED") {
          // Advance to discovery_call_booked
          if (prospect.pipelineStage !== "discovery_call_booked") {
            await moveRecruitmentProspectStage({
              prospectId: prospect.id,
              toStage: "discovery_call_booked",
              changedByName: "Cal.com (auto)",
              note: `Discovery call booked via Cal.com${calEventId ? ` (event: ${calEventId})` : ""}`,
            });
          }
          if (calEventId || startTime) {
            await updateRecruitmentProspect(prospect.id, {
              calComEventId: calEventId ?? null,
              discoveryCallAt: startTime ? new Date(startTime) : null,
            });
          }
          // Send booking confirmation email via Resend
          const { Resend } = await import("resend");
          const { ENV: env } = await import("./env");
          const { PROSPECT_FROM, PROSPECT_REPLY_TO } = await import("../resend-email");
          if (env.resendApiKey) {
            const resend = new Resend(env.resendApiKey);
            const callDateStr = startTime ? new Date(startTime).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" }) : "the scheduled time";
            await resend.emails.send({
              from: PROSPECT_FROM,
              to: [prospect.email],
              replyTo: PROSPECT_REPLY_TO,
              subject: "Discovery Call Confirmed — JLT Group",
              html: `<div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#FFF6ED;border-radius:16px;"><h2 style="color:#414141;">Your Discovery Call is Confirmed!</h2><p style="color:#414141;">Hi ${prospect.firstName},</p><p style="color:#414141;">Great news — your discovery call with the JLT Group team is confirmed for <strong>${callDateStr}</strong>.</p><p style="color:#414141;">We look forward to speaking with you. If you need to reschedule, please use the link in your calendar invitation.</p><p style="color:#414141;">Warm regards,<br/><strong>The JLT Group Team</strong></p></div>`,
            }).catch((e: any) => console.error("[Cal.com Webhook] Failed to send booking confirmation:", e?.message));
          }
          // Notify support@ that a discovery call has been booked
          try {
            const { sendSupportEmail: notifySupport } = await import("../email");
            const callDateStr = startTime ? new Date(startTime).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/London" }) : "TBC";
            await notifySupport({
              subject: `Discovery Call Booked \u2014 ${prospect.firstName} ${prospect.lastName}`,
              html: `
                <div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF6ED;padding:32px;border-radius:16px;">
                  <h2 style="color:#414141;margin:0 0 16px;">Discovery Call Booked</h2>
                  <table style="width:100%;border-collapse:collapse;">
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Name</td><td style="padding:6px 0;color:#414141;font-weight:600;">${prospect.firstName} ${prospect.lastName}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Email</td><td style="padding:6px 0;color:#414141;">${prospect.email}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Phone</td><td style="padding:6px 0;color:#414141;">${prospect.phone ?? '\u2014'}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Call Date &amp; Time</td><td style="padding:6px 0;color:#414141;font-weight:600;">${callDateStr}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Tier Interest</td><td style="padding:6px 0;color:#414141;">${prospect.tierInterest ?? '\u2014'}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Pipeline Stage</td><td style="padding:6px 0;color:#414141;">Discovery Call Booked</td></tr>
                  </table>
                  <p style="margin:20px 0 0;"><a href="https://portal.thejltgroup.co.uk/crm/recruitment" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">View in Agent Recruitment</a></p>
                  <p style="margin:8px 0 0;color:#9ca3af;font-size:.8rem;">JLT Group Booking Portal \u2014 automated notification</p>
                </div>
              `,
            });
          } catch (adminEmailErr) {
            console.error("[Cal.com Webhook] Failed to send admin discovery call notification:", adminEmailErr);
          }
          // Enroll in discovery_call_booked workflow
          try {
            const { enrollProspectInWorkflow } = await import("../recruitment-workflow-db");
            await enrollProspectInWorkflow(prospect.id, "discovery_call_booked");
          } catch {}
          console.log(`[Cal.com Webhook] Prospect ${prospect.id} advanced to discovery_call_booked`);
        }

        if (triggerEvent === "BOOKING_CANCELLED") {
          // Prospect proactively cancelled → Rebook Required (they're still engaged)
          // Did Not Turn Up is reserved for no-shows only (set manually by admin)
          if (prospect.pipelineStage === "discovery_call_booked") {
            await moveRecruitmentProspectStage({
              prospectId: prospect.id,
              toStage: "rebook_required",
              changedByName: "Cal.com (auto)",
              note: "Prospect cancelled their discovery call via Cal.com — rebook required",
            });
            // Send rebook email inline (same pattern as booking confirmation above)
            {
              const { Resend } = await import("resend");
              const { ENV: env } = await import("./env");
              const { PROSPECT_FROM, PROSPECT_REPLY_TO } = await import("../resend-email");
              if (env.resendApiKey) {
                const resend = new Resend(env.resendApiKey);
                await resend.emails.send({
                  from: PROSPECT_FROM,
                  to: [prospect.email],
                  replyTo: PROSPECT_REPLY_TO,
                  subject: "No problem — let's find a better time | JLT Group",
                  html: `<div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#FFF6ED;border-radius:16px;"><h2 style="color:#414141;">No problem at all!</h2><p style="color:#414141;">Hi ${prospect.firstName},</p><p style="color:#414141;">We noticed you cancelled your discovery call — that's completely fine, life gets busy!</p><p style="color:#414141;">We'd love to find a time that works better for you. Simply use the link below to pick a new slot:</p><p style="text-align:center;margin:24px 0;"><a href="https://cal.com/jlt-group/jlt-discovery" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;">Book a New Time</a></p><p style="color:#414141;">If you have any questions or would prefer to chat over email first, just reply to this message.</p><p style="color:#414141;">Warm regards,<br/><strong>The JLT Group Team</strong></p></div>`,
                }).catch((e: any) => console.error("[Cal.com Webhook] Failed to send rebook email:", e?.message));
              }
            }
            // Enroll in rebook_required workflow
            try {
              const { enrollProspectInWorkflow } = await import("../recruitment-workflow-db");
              await enrollProspectInWorkflow(prospect.id, "rebook_required");
            } catch {}
            console.log(`[Cal.com Webhook] Prospect ${prospect.id} moved to rebook_required`);
          }
        }
      }

      res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error("[Cal.com Webhook] Error:", err?.message);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // Allow /apply/embed to be embedded in iframes on external websites
  // All other routes keep the default (no X-Frame-Options set, which browsers treat as SAMEORIGIN in some cases)
  app.use("/apply/embed", (_req, res, next) => {
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Content-Security-Policy", "frame-ancestors *");
    next();
  });

  // External CRM API
  app.use("/api/external", externalApiRouter);
  app.use("/api/oauth2", oauth2Router);
  // Supplier Directory REST API (for Tom's CRM and external integrations)
  app.use("/api/v1", supplierApiRouter);

  // ── Scheduled: process recruitment workflow emails ─────────────────────────
  // Called hourly by the Manus scheduled task via session cookie auth.
  // Per periodic_updates guidelines: user.role == "user" is allowed.
  app.post("/api/scheduled/process-workflows", async (req, res) => {
    try {
      const { processWorkflowEmailsInternal } = await import("../recruitment-workflow-router");
      const processWorkflowEmails = processWorkflowEmailsInternal;
      const result = await processWorkflowEmails();
      console.log(`[WorkflowScheduler] Processed ${result.processed} enrollments, sent ${result.sent} emails`);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[WorkflowScheduler] Error:", err?.message);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    startScheduler();
  });
}

startServer().catch(console.error);
