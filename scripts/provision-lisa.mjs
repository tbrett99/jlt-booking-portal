/**
 * One-off script: manually provision Lisa Le Maistre's agent account.
 * Replicates what the billing_request.fulfilled webhook does, but skips
 * GoCardless mandate creation (she'll set up DD via onboarding instead).
 *
 * Usage: node scripts/provision-lisa.mjs
 */

import { createConnection } from "mysql2/promise";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

const conn = await createConnection(DATABASE_URL);

try {
  // ── 1. Find her join session ──────────────────────────────────────────────
  const [sessionRows] = await conn.execute(
    "SELECT * FROM join_sessions WHERE email = ? ORDER BY createdAt DESC LIMIT 1",
    ["lisalemaistre@gmail.com"]
  );
  const session = sessionRows[0];
  if (!session) throw new Error("Join session not found for lisalemaistre@gmail.com");
  console.log("Found session:", session.id, "step:", session.step, "userId:", session.userId);

  if (session.userId) {
    console.log("User already exists with ID", session.userId, "— nothing to do.");
    process.exit(0);
  }

  // ── 2. Create user account ────────────────────────────────────────────────
  const tempPassword = Math.random().toString(36).slice(2, 10) + "!Jlt1";
  const hashedPassword = await bcrypt.hash(tempPassword, 10);
  const openId = `agent_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  await conn.execute(
    `INSERT INTO users (openId, name, email, loginMethod, role, tempPassword, mustChangePassword, isActive, lastSignedIn)
     VALUES (?, ?, ?, 'password', 'agent', ?, 1, 1, NOW())`,
    [openId, session.signerName ?? session.email, session.email, hashedPassword]
  );

  const [userRows] = await conn.execute(
    "SELECT id FROM users WHERE openId = ? LIMIT 1",
    [openId]
  );
  const newUserId = userRows[0].id;
  console.log("Created user ID:", newUserId);

  // ── 3. Update join session ────────────────────────────────────────────────
  await conn.execute(
    `UPDATE join_sessions SET userId = ?, joiningFeePaidAt = NOW(), step = 'complete' WHERE id = ?`,
    [newUserId, session.id]
  );
  console.log("Updated join session to complete");

  // ── 4. Generate unique agent ID ───────────────────────────────────────────
  const [existingProfiles] = await conn.execute(
    "SELECT uniqueAgentId FROM agent_crm_profiles WHERE uniqueAgentId IS NOT NULL"
  );
  const usedIds = new Set(existingProfiles.map((p) => p.uniqueAgentId));
  let num = existingProfiles.length + 1;
  let agentId = `JLT-${String(num).padStart(4, "0")}`;
  while (usedIds.has(agentId)) { num++; agentId = `JLT-${String(num).padStart(4, "0")}`; }
  console.log("Assigned agent ID:", agentId);

  // ── 5. Create CRM profile ─────────────────────────────────────────────────
  await conn.execute(
    `INSERT INTO agent_crm_profiles (userId, uniqueAgentId, membershipTier, dateJoined, agentStatus, trainingStage, personalEmail)
     VALUES (?, ?, ?, CURDATE(), 'active', 'Training', ?)
     ON DUPLICATE KEY UPDATE membershipTier = VALUES(membershipTier), dateJoined = VALUES(dateJoined),
       trainingStage = VALUES(trainingStage), personalEmail = VALUES(personalEmail)`,
    [newUserId, agentId, session.membershipTier ?? "business_class", session.email]
  );
  console.log("Created CRM profile");

  console.log("\n✅ Done! Lisa Le Maistre provisioned successfully.");
  console.log("   User ID:", newUserId);
  console.log("   Agent ID:", agentId);
  console.log("   Temp password (for reference only — she should reset):", tempPassword);
  console.log("\nShe can now log in at portal.thejltgroup.co.uk and will be prompted to set up her DD in onboarding.");

} finally {
  await conn.end();
}
