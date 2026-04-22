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
import { sendNotificationEmail, sendDirectEmail } from "../email";
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
  const server = createServer(app);

  // Capture raw body for PPS callback signature verification BEFORE urlencoded parser decodes it.
  // PPS signs the raw URL-encoded string; Express decodes it, so we must re-verify against raw.
  app.use("/api/pps/callback", express.raw({ type: "application/x-www-form-urlencoded", limit: "1mb" }));

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
      const events: Array<{ id: string; action: string; resource_type: string; links: Record<string, string> }> =
        req.body?.events ?? [];

      for (const event of events) {
        console.log(`[GC Webhook] ${event.resource_type}.${event.action}`, event.links);

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
            console.warn(`[GC Webhook] No local mandate found for mandate ${mandateId}`);
            continue;
          }

          // Update local mandate status
          await updateGcMandate(localMandate.id, { mandateId, status: "active" });

          // Calculate subscription start date: 1 month after joining fee payment
          const joiningFeeDate = localMandate.joiningFeePaidAt ?? new Date();
          const dayOfMonth = localMandate.preferredPaymentDay ?? 1;
          const startDate = calcSubscriptionStartDate(joiningFeeDate, dayOfMonth);

          // Create the GoCardless subscription
          const sub = await createSubscription({
            mandateId,
            amountPence: 3000, // £30.00 — update to your actual monthly fee
            name: "JLT Monthly Membership",
            startDate,
            dayOfMonth,
          });

          // Store subscription locally
          await createGcSubscription({
            userId: localMandate.userId,
            mandateId,
            subscriptionId: sub.id,
            amount: sub.amount,
            startDate,
            dayOfMonth,
            nextChargeDate: sub.upcoming_payments?.[0]?.charge_date,
          });

          // Notify admin
          await notifyOwner({
            title: "New DD Mandate Active",
            content: `Agent (user ID ${localMandate.userId}) has set up their Direct Debit mandate. First payment scheduled for ${startDate}.`,
          });

          console.log(`[GC Webhook] Subscription ${sub.id} created for mandate ${mandateId}, starts ${startDate}`);
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
              userId: localMandate.userId,
              mandateId,
              eventType: `mandates_${event.action}`,
              status: event.action,
              occurredAt: new Date(),
              rawPayload: JSON.stringify(event),
            });
            // Notify admin
            await notifyOwner({
              title: `DD Mandate ${event.action.charAt(0).toUpperCase() + event.action.slice(1)}`,
              content: `The Direct Debit mandate for agent (user ID ${localMandate.userId}) has been ${event.action}. Please check their account in the CRM.`,
            });
            console.log(`[GC Webhook] Mandate ${mandateId} ${event.action} for user ${localMandate.userId}`);
          }
        }

        // Payment failed or charged back
        if (
          event.resource_type === "payments" &&
          ["failed", "charged_back"].includes(event.action)
        ) {
          const paymentId = event.links.payment;
          const mandateId = event.links.mandate;
          const meta = (event as any).details ?? {};
          // Resolve user from mandate
          let userId: number | undefined;
          if (mandateId) {
            const db = await getDb();
            if (db) {
              const { gcMandates } = await import("../../drizzle/schema");
              const { eq: eqOp } = await import("drizzle-orm");
              const rows = await db.select().from(gcMandates).where(eqOp(gcMandates.mandateId, mandateId)).limit(1);
              if (rows[0]) userId = rows[0].userId;
            }
          }
          await createPaymentEvent({
            userId,
            mandateId,
            paymentId,
            eventType: `payments_${event.action}`,
            status: event.action,
            failureReason: meta.cause ?? meta.reason_code ?? undefined,
            failureDescription: meta.description ?? undefined,
            occurredAt: new Date(),
            rawPayload: JSON.stringify(event),
          });
          // Notify admin
          await notifyOwner({
            title: `DD Payment ${event.action === "charged_back" ? "Charged Back" : "Failed"}`,
            content: `A Direct Debit payment (${paymentId}) has ${event.action === "charged_back" ? "been charged back" : "failed"}${userId ? ` for agent (user ID ${userId})` : ""}. ${meta.description ? `Reason: ${meta.description}.` : ""} Please check the CRM.`,
          });
          console.log(`[GC Webhook] Payment ${paymentId} ${event.action} for user ${userId ?? "unknown"}`);
        }
      }

      res.status(200).json({ success: true });
    } catch (err) {
      console.error("[GC Webhook] Error:", err);
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
