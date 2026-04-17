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
import { verifyPpsSignature } from "../pps-signature";
import { getDb, createInAppNotification } from "../db";
import { paymentLinks, bookings, users } from "../../drizzle/schema";
import { sendNotificationEmail } from "../email";

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

  // ── PPS Payment Callback ────────────────────────────────────────────────────
  // PPS POSTs the payment result here server-to-server after the customer pays.
  // This is the authoritative source of truth — we verify the signature and update the DB.
  app.post("/api/pps/callback", async (req, res) => {
    try {
      const fields = req.body as Record<string, string>;
      const receivedSig = fields.signature ?? "";
      const signingSecret = ENV.ppsSigningSecret;

      if (!signingSecret) {
        console.error("[PPS Callback] Signing secret not configured");
        res.status(500).send("Configuration error");
        return;
      }

      // Verify signature
      if (!verifyPpsSignature(fields, receivedSig, signingSecret)) {
        console.error("[PPS Callback] Invalid signature — possible tampering");
        res.status(400).send("Invalid signature");
        return;
      }

      const linkId = fields.merchantData;
      const responseCode = fields.responseCode ?? "";
      const responseMessage = fields.responseMessage ?? "";
      const ppsTransactionId = fields.transactionID ?? fields.xref ?? "";

      if (!linkId) {
        console.error("[PPS Callback] No merchantData (linkId) in callback");
        res.status(400).send("Missing merchantData");
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
        res.status(404).send("Not found");
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
          .select({ id: bookings.id, clientName: bookings.clientName, ptsRef: bookings.ptsRef, agentId: bookings.agentId })
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
        }
      }

      console.log(`[PPS Callback] Link ${linkId} → ${newStatus} (code: ${responseCode})`);
      res.status(200).send("OK");
    } catch (err) {
      console.error("[PPS Callback] Error:", err);
      res.status(500).send("Internal error");
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
