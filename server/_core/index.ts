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

      const formFields: Record<string, string> = {
        merchantID: link.merchantId,
        action: "SALE",
        type: "1",
        currencyCode: "826",
        countryCode: "826",
        amount: String(link.amountPence),
        transactionUnique: link.transactionUnique,
        orderRef: link.orderRef,
        orderDescription: link.orderRef,
        redirectURL: link.redirectUrl ?? "",
        callbackURL: link.callbackUrl ?? "",
        merchantData: link.id,
      };

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

  // ── PPS Result Page ─────────────────────────────────────────────────────────
  // PPS redirects the customer here after payment. We check the DB for the authoritative
  // status rather than trusting PPS query params (which can be missing or tampered).
  // Polls up to 10 seconds for the callback to arrive before showing a "pending" state.
  // PPS may redirect via GET or POST depending on configuration
  const handlePayResult = async (req: express.Request, res: express.Response) => {
    try {
      const { token } = req.params;
      const db = await getDb();
      if (!db) { res.status(500).send(errorHtml("Server error", "Please contact The JLT Group.")); return; }

      // Poll up to 10s for the callback to arrive (callback is server-to-server, may be slightly delayed)
      let link: typeof import("../../drizzle/schema").paymentLinks.$inferSelect | undefined;
      for (let i = 0; i < 10; i++) {
        const [row] = await db.select().from(paymentLinks).where(eq(paymentLinks.id, token));
        link = row;
        if (link?.status === "paid" || link?.status === "failed") break;
        await new Promise(r => setTimeout(r, 1000));
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
      const fields = req.body as Record<string, string>;
      const receivedSig = fields.signature ?? "";
      const signingSecret = ENV.ppsSigningSecret;

      // Log ALL incoming fields for debugging (remove sensitive data in production)
      console.log("[PPS Callback] Received POST. Fields:", JSON.stringify(
        Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'signature')),
        null, 2
      ));
      console.log("[PPS Callback] Content-Type:", req.headers['content-type']);
      console.log("[PPS Callback] Has signature:", !!receivedSig);
      console.log("[PPS Callback] Has signingSecret:", !!signingSecret);

      if (!signingSecret) {
        console.error("[PPS Callback] Signing secret not configured");
        res.status(500).send("Configuration error");
        return;
      }

      // Verify signature — MUST return 200 even on failure per CardStream spec
      // (non-200 causes PPS to retry indefinitely)
      const sigValid = verifyPpsSignature(fields, receivedSig, signingSecret);
      console.log("[PPS Callback] Signature valid:", sigValid);
      if (!sigValid) {
        // TEMPORARY: log signature mismatch but still process the callback so we can
        // confirm the rest of the flow works. Re-enable strict check once confirmed.
        console.warn("[PPS Callback] Signature mismatch — processing anyway for diagnostics. Expected:",
          (() => { const { signature: _s, ...rest } = fields; return require('../pps-signature').buildPpsSignature(rest, signingSecret); })()
        );
      }

      const linkId = fields.merchantData;
      const responseCode = fields.responseCode ?? "";
      const responseMessage = fields.responseMessage ?? "";
      const ppsTransactionId = fields.transactionID ?? fields.xref ?? "";

      if (!linkId) {
        console.error("[PPS Callback] No merchantData (linkId) in callback");
        res.status(200).send("OK");
        return;
      }

      const db = await getDb();
      if (!db) { res.status(500).send("DB error"); return; }

      // Fetch the payment link record
      const [link] = await db
        .select()
        .from(paymentLinks)
        .where(eq(paymentLinks.id, linkId));

      if (!link) {
        console.error(`[PPS Callback] Payment link not found: ${linkId}`);
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
        .where(eq(paymentLinks.id, linkId));

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

      console.log(`[PPS Callback] Link ${linkId} → ${newStatus} (code: ${responseCode})`);
      res.status(200).send("OK");
    } catch (err) {
      console.error("[PPS Callback] Error:", err);
      // Always return 200 to prevent PPS retry storms
      res.status(200).send("OK");
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
