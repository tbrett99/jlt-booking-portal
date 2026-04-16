/**
 * Agent CRM database helpers
 * Manages CRM profiles, tags, and supplier logins for registered portal agents
 */
import { eq, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  agentCrmProfiles,
  agentTags,
  agentSupplierLogins,
  users,
  type AgentCrmProfile,
  type AgentTag,
  type AgentSupplierLogin,
} from "../drizzle/schema";
import { encrypt, decrypt } from "./encryption";

// ─── Profile helpers ──────────────────────────────────────────────────────────

export async function getAgentCrmProfile(userId: number): Promise<AgentCrmProfile | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(agentCrmProfiles).where(eq(agentCrmProfiles.userId, userId));
  return rows[0] ?? null;
}

export async function upsertAgentCrmProfile(
  userId: number,
  data: Partial<Omit<AgentCrmProfile, "id" | "userId" | "createdAt" | "updatedAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Encrypt bank fields if provided
  const payload: Record<string, unknown> = { ...data };
  if (data.bankSortCode) payload.bankSortCode = encrypt(data.bankSortCode);
  if (data.bankAccountNumber) payload.bankAccountNumber = encrypt(data.bankAccountNumber);

  const existing = await getAgentCrmProfile(userId);
  if (existing) {
    await db.update(agentCrmProfiles).set(payload).where(eq(agentCrmProfiles.userId, userId));
  } else {
    await db.insert(agentCrmProfiles).values({ userId, ...payload });
  }
}

export async function decryptAgentBankDetails(profile: AgentCrmProfile): Promise<AgentCrmProfile> {
  return {
    ...profile,
    bankSortCode: profile.bankSortCode ? decrypt(profile.bankSortCode) : profile.bankSortCode,
    bankAccountNumber: profile.bankAccountNumber ? decrypt(profile.bankAccountNumber) : profile.bankAccountNumber,
  };
}

// ─── Tag helpers ──────────────────────────────────────────────────────────────

export async function getAgentTags(userId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(agentTags).where(eq(agentTags.userId, userId));
  return rows.map((r) => r.tag);
}

export async function addAgentTag(userId: number, tag: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Avoid duplicates
  const existing = await db
    .select()
    .from(agentTags)
    .where(eq(agentTags.userId, userId));
  if (existing.some((r) => r.tag === tag)) return;
  await db.insert(agentTags).values({ userId, tag });
}

export async function removeAgentTag(userId: number, tag: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const rows = await db
    .select()
    .from(agentTags)
    .where(eq(agentTags.userId, userId));
  const match = rows.find((r) => r.tag === tag);
  if (match) {
    await db.delete(agentTags).where(eq(agentTags.id, match.id));
  }
}

// ─── Supplier login helpers ───────────────────────────────────────────────────

export async function getAgentSupplierLogins(userId: number): Promise<AgentSupplierLogin[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(agentSupplierLogins)
    .where(eq(agentSupplierLogins.userId, userId))
    .orderBy(desc(agentSupplierLogins.createdAt));
}

export async function addAgentSupplierLogin(
  userId: number,
  data: {
    supplierName: string;
    loginUrl?: string;
    username?: string;
    password?: string;
    notes?: string;
  }
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const passwordEncrypted = data.password ? encrypt(data.password) : null;
  const [result] = await db.insert(agentSupplierLogins).values({
    userId,
    supplierName: data.supplierName,
    loginUrl: data.loginUrl ?? null,
    username: data.username ?? null,
    passwordEncrypted,
    notes: data.notes ?? null,
  });
  return (result as any).insertId ?? 0;
}

export async function updateAgentSupplierLogin(
  id: number,
  data: {
    supplierName?: string;
    loginUrl?: string;
    username?: string;
    password?: string;
    notes?: string;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const payload: Record<string, unknown> = {};
  if (data.supplierName !== undefined) payload.supplierName = data.supplierName;
  if (data.loginUrl !== undefined) payload.loginUrl = data.loginUrl;
  if (data.username !== undefined) payload.username = data.username;
  if (data.password !== undefined) payload.passwordEncrypted = encrypt(data.password);
  if (data.notes !== undefined) payload.notes = data.notes;
  await db.update(agentSupplierLogins).set(payload).where(eq(agentSupplierLogins.id, id));
}

export async function deleteAgentSupplierLogin(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(agentSupplierLogins).where(eq(agentSupplierLogins.id, id));
}

export function decryptSupplierPassword(login: AgentSupplierLogin): string | null {
  if (!login.passwordEncrypted) return null;
  try {
    return decrypt(login.passwordEncrypted);
  } catch {
    return null;
  }
}

// ─── List all agents with CRM data ───────────────────────────────────────────

export async function listAgentsWithCrm() {
  const db = await getDb();
  if (!db) return [];
  // Get all agent users
  const agentUsers = await db
    .select()
    .from(users)
    .where(eq(users.role, "agent"))
    .orderBy(desc(users.createdAt));

  // Get all CRM profiles
  const profiles = await db.select().from(agentCrmProfiles);
  const profileMap = new Map(profiles.map((p) => [p.userId, p]));

  // Get all tags
  const allTags = await db.select().from(agentTags);
  const tagMap = new Map<number, string[]>();
  for (const t of allTags) {
    if (!tagMap.has(t.userId)) tagMap.set(t.userId, []);
    tagMap.get(t.userId)!.push(t.tag);
  }

  return agentUsers.map((u) => ({
    ...u,
    crmProfile: profileMap.get(u.id) ?? null,
    tags: tagMap.get(u.id) ?? [],
  }));
}

// ─── Generate unique agent ID ─────────────────────────────────────────────────

export async function generateUniqueAgentIdForUser(): Promise<string> {
  const db = await getDb();
  if (!db) return `JLT-${String(Date.now()).slice(-4)}`;
  const existing = await db.select().from(agentCrmProfiles);
  const usedIds = new Set(existing.map((p) => p.uniqueAgentId).filter(Boolean));
  let num = existing.length + 1;
  let id = `JLT-${String(num).padStart(4, "0")}`;
  while (usedIds.has(id)) {
    num++;
    id = `JLT-${String(num).padStart(4, "0")}`;
  }
  return id;
}
