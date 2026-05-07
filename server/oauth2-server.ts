/**
 * JLT Portal — OAuth 2.0 Authorisation Server
 *
 * Implements the Authorisation Code flow so external apps (e.g. Tom's CRM)
 * can use the JLT portal as an identity provider for agent login.
 *
 * Endpoints:
 *   GET  /api/oauth2/authorize   — shows consent screen, issues auth code
 *   POST /api/oauth2/token       — exchanges auth code for JWT access token
 *   GET  /api/oauth2/userinfo    — returns agent profile from Bearer token
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { jwtVerify } from "jose";
import { getDb } from "./db";
import { oauthClients, oauthCodes, users } from "../drizzle/schema";
import { eq, and, gt } from "drizzle-orm";
import { ENV } from "./_core/env";
import { COOKIE_NAME } from "../shared/const";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

async function getClient(clientId: string) {
  const db = await getDb();
  if (!db) return null;
  const results = await db
    .select()
    .from(oauthClients)
    .where(and(eq(oauthClients.clientId, clientId), eq(oauthClients.isActive, true)))
    .limit(1);
  return results[0] ?? null;
}

// ─── GET /api/oauth2/authorize ────────────────────────────────────────────────
// The agent's browser is redirected here by Tom's CRM.
// If the agent is already logged in (session cookie), we issue a code immediately.
// If not, we redirect them to the JLT portal login page first, then back here.

router.get("/authorize", async (req: Request, res: Response) => {
  const { client_id, redirect_uri, state, response_type } = req.query as Record<string, string>;

  // Validate response_type
  if (response_type !== "code") {
    return res.status(400).send("Unsupported response_type. Only 'code' is supported.");
  }

  // Validate client
  const client = await getClient(client_id);
  if (!client) {
    return res.status(400).send("Unknown or inactive client_id.");
  }

  // Validate redirect_uri matches registered URI
  if (redirect_uri !== client.redirectUri) {
    return res.status(400).send("redirect_uri does not match registered URI for this client.");
  }

  // Check if agent is already authenticated via session cookie
  const cookieHeader = req.headers.cookie ?? "";
  const cookieMap = new Map(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k.trim(), decodeURIComponent(v.join("="))];
    })
  );
  const sessionCookie = cookieMap.get(COOKIE_NAME);
  if (!sessionCookie) {
    const returnUrl = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?returnTo=${returnUrl}`);
  }

  // Verify session using jose (same as core SDK)
  let openId: string;
  try {
    const secretKey = new TextEncoder().encode(ENV.cookieSecret);
    const { payload } = await jwtVerify(sessionCookie, secretKey, { algorithms: ["HS256"] });
    openId = payload.openId as string;
    if (!openId) throw new Error("Missing openId");
  } catch {
    const returnUrl = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?returnTo=${returnUrl}`);
  }

  // Load user by openId
  const db = await getDb();
  if (!db) return res.status(503).send("Database unavailable");
  const userResults = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  const user = userResults[0];
  if (!user || !user.isActive) {
    return res.status(403).send("Your account is not active.");
  }

  // Only agents (and admins testing) can authorise
  if (!["agent", "admin", "super_admin"].includes(user.role)) {
    return res.status(403).send("Only agent accounts can authorise this application.");
  }

  // Issue auth code (valid for 10 minutes, single-use)
  const code = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.insert(oauthCodes).values({
    code,
    clientId: client_id,
    userId: user.id,
    redirectUri: redirect_uri,
    expiresAt,
  } as any);

  // Redirect back to Tom's CRM with the code
  const params = new URLSearchParams({ code });
  if (state) params.set("state", state);
  return res.redirect(`${redirect_uri}?${params.toString()}`);
});

// ─── POST /api/oauth2/token ───────────────────────────────────────────────────
// Tom's CRM server calls this to exchange the auth code for an access token.
// Uses HTTP Basic Auth: Authorization: Basic base64(client_id:client_secret)

router.post("/token", async (req: Request, res: Response) => {
  // Parse client credentials from Basic Auth header
  const authHeader = req.headers.authorization ?? "";
  let clientId: string;
  let clientSecret: string;

  if (authHeader.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const [id, secret] = decoded.split(":");
    clientId = id;
    clientSecret = secret;
  } else if (req.body.client_id && req.body.client_secret) {
    // Also accept in body for convenience
    clientId = req.body.client_id;
    clientSecret = req.body.client_secret;
  } else {
    return res.status(401).json({ error: "invalid_client", error_description: "Missing client credentials" });
  }

  const { grant_type, code, redirect_uri } = req.body;

  if (grant_type !== "authorization_code") {
    return res.status(400).json({ error: "unsupported_grant_type" });
  }

  if (!code || !redirect_uri) {
    return res.status(400).json({ error: "invalid_request", error_description: "Missing code or redirect_uri" });
  }

  // Validate client
  const client = await getClient(clientId);
  if (!client) {
    return res.status(401).json({ error: "invalid_client", error_description: "Unknown client_id" });
  }

  // Verify client secret
  if (hashSecret(clientSecret) !== client.clientSecretHash) {
    return res.status(401).json({ error: "invalid_client", error_description: "Invalid client_secret" });
  }

  // Look up the auth code
  const db = await getDb();
  if (!db) return res.status(503).json({ error: "server_error" });

  const now = new Date();
  const codeResults = await db
    .select()
    .from(oauthCodes)
    .where(
      and(
        eq(oauthCodes.code, code),
        eq(oauthCodes.clientId, clientId),
        gt(oauthCodes.expiresAt, now)
      )
    )
    .limit(1);

  const codeRecord = codeResults[0];
  if (!codeRecord) {
    return res.status(400).json({ error: "invalid_grant", error_description: "Code is invalid or expired" });
  }

  if (codeRecord.usedAt) {
    return res.status(400).json({ error: "invalid_grant", error_description: "Code has already been used" });
  }

  if (codeRecord.redirectUri !== redirect_uri) {
    return res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
  }

  // Mark code as used (prevent replay)
  await db
    .update(oauthCodes)
    .set({ usedAt: now })
    .where(eq(oauthCodes.id, codeRecord.id));

  // Load the user
  const userResults = await db.select().from(users).where(eq(users.id, codeRecord.userId)).limit(1);
  const user = userResults[0];
  if (!user || !user.isActive) {
    return res.status(400).json({ error: "invalid_grant", error_description: "User account not found or inactive" });
  }

  // Issue JWT access token (valid 1 hour)
  const accessToken = jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      name: user.name,
      role: user.role,
      openId: user.openId,
      iss: "https://portal.thejltgroup.co.uk",
      aud: clientId,
    },
    ENV.cookieSecret,
    { expiresIn: "1h" }
  );

  return res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    scope: "profile email",
  });
});

// ─── GET /api/oauth2/userinfo ─────────────────────────────────────────────────
// Tom's CRM calls this with the access token to get the agent's profile.

router.get("/userinfo", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "invalid_token", error_description: "Missing Bearer token" });
  }

  const token = authHeader.slice(7);
  let payload: any;
  try {
    payload = jwt.verify(token, ENV.cookieSecret);
  } catch {
    return res.status(401).json({ error: "invalid_token", error_description: "Token is invalid or expired" });
  }

  const db = await getDb();
  if (!db) return res.status(503).json({ error: "server_error" });

  const userResults = await db
    .select()
    .from(users)
    .where(eq(users.id, parseInt(payload.sub, 10)))
    .limit(1);
  const user = userResults[0];
  if (!user || !user.isActive) {
    return res.status(401).json({ error: "invalid_token", error_description: "User not found or inactive" });
  }

  // Return standard OIDC-style userinfo
  return res.json({
    sub: String(user.id),
    name: user.name ?? "",
    email: user.email ?? "",
    role: user.role,
    openId: user.openId,
    portalStatus: user.portalStatus,
    isActive: user.isActive,
  });
});

export { router as oauth2Router };
