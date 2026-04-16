/**
 * CRM database helpers — prospects, pipeline, AR forms, contracts, campaigns, remittances
 */
import { getDb } from "./db";
import {
  prospects,
  prospectTags,
  prospectPipelineHistory,
  prospectArForms,
  prospectSupplierLogins,
  contractTemplates,
  prospectContracts,
  emailCampaigns,
  campaignSends,
  commissionRemittances,
  commissionRemittanceItems,
  paymentConfig,
  type Prospect,
  type InsertProspect,
  type ProspectArForm,
  type InsertProspectArForm,
} from "../drizzle/schema";
import { eq, desc, and, or, like, isNull } from "drizzle-orm";
import { encryptPassword, decryptPassword } from "./imap";

// ─── Prospects ────────────────────────────────────────────────────────────────

export async function createProspect(data: InsertProspect) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(prospects).values(data);
  const id = (result as { insertId: number }).insertId;
  return getProspectById(id);
}

export async function getProspectById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(prospects).where(eq(prospects.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getProspectByEmail(email: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(prospects).where(eq(prospects.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function getAllProspects() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(prospects).orderBy(desc(prospects.createdAt));
}

export async function updateProspect(id: number, data: Partial<Omit<Prospect, "id" | "createdAt">>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(prospects).set(data).where(eq(prospects.id, id));
  return getProspectById(id);
}

export async function deleteProspect(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(prospects).where(eq(prospects.id, id));
}

export async function moveProspectStage(
  prospectId: number,
  toStage: Prospect["stage"],
  movedById: number | null,
  note?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const current = await getProspectById(prospectId);
  if (!current) throw new Error("Prospect not found");
  await db.update(prospects).set({ stage: toStage }).where(eq(prospects.id, prospectId));
  await db.insert(prospectPipelineHistory).values({
    prospectId,
    fromStage: current.stage,
    toStage,
    movedById,
    note: note ?? null,
  });
  return getProspectById(prospectId);
}

export async function getProspectPipelineHistory(prospectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(prospectPipelineHistory)
    .where(eq(prospectPipelineHistory.prospectId, prospectId))
    .orderBy(desc(prospectPipelineHistory.movedAt));
}

// ─── Prospect Tags ────────────────────────────────────────────────────────────

export async function getProspectTags(prospectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(prospectTags).where(eq(prospectTags.prospectId, prospectId));
}

export async function addProspectTag(prospectId: number, tag: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(prospectTags).values({ prospectId, tag });
}

export async function removeProspectTag(prospectId: number, tag: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(prospectTags)
    .where(and(eq(prospectTags.prospectId, prospectId), eq(prospectTags.tag, tag)));
}

// ─── Agent Application (AR) Forms ────────────────────────────────────────────

export async function createArForm(data: InsertProspectArForm) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(prospectArForms).values(data);
  const id = (result as { insertId: number }).insertId;
  const rows = await db.select().from(prospectArForms).where(eq(prospectArForms.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getArFormsByProspect(prospectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(prospectArForms)
    .where(eq(prospectArForms.prospectId, prospectId))
    .orderBy(desc(prospectArForms.submittedAt));
}

export async function getLatestArForm(prospectId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(prospectArForms)
    .where(eq(prospectArForms.prospectId, prospectId))
    .orderBy(desc(prospectArForms.submittedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function reviewArForm(
  formId: number,
  reviewStatus: "approved" | "rejected",
  reviewNotes: string | null,
  reviewedById: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(prospectArForms)
    .set({ reviewStatus, reviewNotes, reviewedById, reviewedAt: new Date() })
    .where(eq(prospectArForms.id, formId));
}

// ─── Supplier Logins ──────────────────────────────────────────────────────────

export async function getSupplierLoginsByProspect(prospectId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(prospectSupplierLogins)
    .where(eq(prospectSupplierLogins.prospectId, prospectId));
  return rows.map((r: typeof rows[0]) => ({
    ...r,
    password: r.passwordEncrypted ? decryptPassword(r.passwordEncrypted) : null,
  }));
}

export async function addSupplierLogin(data: {
  prospectId: number;
  supplierName: string;
  username?: string;
  password?: string;
  loginUrl?: string;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const passwordEncrypted = data.password ? encryptPassword(data.password) : null;
  const [result] = await db.insert(prospectSupplierLogins).values({
    prospectId: data.prospectId,
    supplierName: data.supplierName,
    username: data.username ?? null,
    passwordEncrypted: passwordEncrypted ?? undefined,
    loginUrl: data.loginUrl ?? null,
    notes: data.notes ?? null,
  });
  return (result as { insertId: number }).insertId;
}

export async function updateSupplierLogin(
  id: number,
  data: {
    supplierName?: string;
    username?: string;
    password?: string;
    loginUrl?: string;
    notes?: string;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateData: Record<string, unknown> = {};
  if (data.supplierName !== undefined) updateData.supplierName = data.supplierName;
  if (data.username !== undefined) updateData.username = data.username;
  if (data.password !== undefined) updateData.passwordEncrypted = encryptPassword(data.password);
  if (data.loginUrl !== undefined) updateData.loginUrl = data.loginUrl;
  if (data.notes !== undefined) updateData.notes = data.notes;
  await db.update(prospectSupplierLogins).set(updateData).where(eq(prospectSupplierLogins.id, id));
}

export async function deleteSupplierLogin(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(prospectSupplierLogins).where(eq(prospectSupplierLogins.id, id));
}

// ─── Contract Templates ───────────────────────────────────────────────────────

export async function getActiveContractTemplate() {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(contractTemplates)
    .where(eq(contractTemplates.isActive, true))
    .orderBy(desc(contractTemplates.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAllContractTemplates() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(contractTemplates).orderBy(desc(contractTemplates.createdAt));
}

export async function createContractTemplate(data: {
  name: string;
  pdfUrl: string;
  pdfKey: string;
  uploadedById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Deactivate all existing templates
  await db.update(contractTemplates).set({ isActive: false });
  const [result] = await db.insert(contractTemplates).values({ ...data, isActive: true });
  return (result as { insertId: number }).insertId;
}

// ─── Prospect Contracts (signing) ────────────────────────────────────────────

export async function createProspectContract(data: {
  prospectId: number;
  templateId: number;
  signingToken: string;
  signingTokenExpiresAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(prospectContracts).values(data);
  return (result as { insertId: number }).insertId;
}

export async function getContractByToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(prospectContracts)
    .where(eq(prospectContracts.signingToken, token))
    .limit(1);
  return rows[0] ?? null;
}

export async function getContractsByProspect(prospectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(prospectContracts)
    .where(eq(prospectContracts.prospectId, prospectId))
    .orderBy(desc(prospectContracts.createdAt));
}

export async function signContract(
  contractId: number,
  data: {
    signerName: string;
    signerAddress: string;
    signatureDataUrl: string;
    signedPdfUrl: string;
    signedPdfKey: string;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(prospectContracts)
    .set({ ...data, signedAt: new Date() })
    .where(eq(prospectContracts.id, contractId));
}

export async function markContractSent(contractId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(prospectContracts)
    .set({ sentAt: new Date() })
    .where(eq(prospectContracts.id, contractId));
}

// ─── Email Campaigns ──────────────────────────────────────────────────────────

export async function getAllCampaigns() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(emailCampaigns).orderBy(desc(emailCampaigns.createdAt));
}

export async function getCampaignById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createCampaign(data: {
  name: string;
  subject: string;
  bodyHtml: string;
  segmentType: "all_agents" | "all_prospects" | "all_contacts" | "won_prospects" | "custom";
  createdById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(emailCampaigns).values(data);
  return (result as { insertId: number }).insertId;
}

export async function updateCampaign(
  id: number,
  data: {
    name?: string;
    subject?: string;
    bodyHtml?: string;
    segmentType?: "all_agents" | "all_prospects" | "all_contacts" | "won_prospects" | "custom";
    status?: "draft" | "sending" | "sent";
    sentAt?: Date;
    sentCount?: number;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(emailCampaigns).set(data).where(eq(emailCampaigns.id, id));
}

export async function createCampaignSends(
  sends: Array<{ campaignId: number; recipientEmail: string; recipientName?: string }>
) {
  if (sends.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(campaignSends).values(sends);
}

export async function updateCampaignSendStatus(
  id: number,
  status: "sent" | "failed",
  errorMessage?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(campaignSends)
    .set({ status, errorMessage: errorMessage ?? null, sentAt: new Date() })
    .where(eq(campaignSends.id, id));
}

export async function getCampaignSends(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(campaignSends).where(eq(campaignSends.campaignId, campaignId));
}

// ─── Commission Remittances ───────────────────────────────────────────────────

export async function createRemittance(data: {
  uploadedById: number;
  filename: string;
  csvUrl?: string;
  csvKey?: string;
  periodLabel?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(commissionRemittances).values(data);
  return (result as { insertId: number }).insertId;
}

export async function createRemittanceItems(
  items: Array<{
    remittanceId: number;
    agentId?: number;
    agentCode?: string;
    agentName?: string;
    amount: string;
    bookingRef?: string;
    description?: string;
  }>
) {
  if (items.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(commissionRemittanceItems).values(items);
}

export async function getAllRemittances() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(commissionRemittances).orderBy(desc(commissionRemittances.uploadedAt));
}

export async function getRemittanceById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(commissionRemittances)
    .where(eq(commissionRemittances.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getRemittanceItems(remittanceId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(commissionRemittanceItems)
    .where(eq(commissionRemittanceItems.remittanceId, remittanceId));
}

export async function getRemittanceItemsByAgent(agentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: commissionRemittanceItems.id,
      remittanceId: commissionRemittanceItems.remittanceId,
      agentCode: commissionRemittanceItems.agentCode,
      amount: commissionRemittanceItems.amount,
      bookingRef: commissionRemittanceItems.bookingRef,
      description: commissionRemittanceItems.description,
      periodLabel: commissionRemittances.periodLabel,
      uploadedAt: commissionRemittances.uploadedAt,
    })
    .from(commissionRemittanceItems)
    .leftJoin(
      commissionRemittances,
      eq(commissionRemittanceItems.remittanceId, commissionRemittances.id)
    )
    .where(eq(commissionRemittanceItems.agentId, agentId))
    .orderBy(desc(commissionRemittances.uploadedAt));
}

export async function markRemittanceNotificationSent(itemId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(commissionRemittanceItems)
    .set({ notificationSentAt: new Date() })
    .where(eq(commissionRemittanceItems.id, itemId));
}

// ─── Payment Config ───────────────────────────────────────────────────────────

export async function getPaymentConfig() {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(paymentConfig).limit(1);
  return rows[0] ?? null;
}

export async function upsertPaymentConfig(data: {
  stripeJoiningFeeUrl?: string;
  businessClassDay1Url?: string;
  businessClassDay15Url?: string;
  businessClassDay28Url?: string;
  firstClassDay1Url?: string;
  firstClassDay15Url?: string;
  firstClassDay28Url?: string;
  updatedById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getPaymentConfig();
  if (existing) {
    await db.update(paymentConfig).set(data).where(eq(paymentConfig.id, existing.id));
  } else {
    await db.insert(paymentConfig).values(data);
  }
  return getPaymentConfig();
}

// ─── Unique Agent ID generation ───────────────────────────────────────────────

export async function generateUniqueAgentId(): Promise<string> {
  const db = await getDb();
  if (!db) return "JLT-0001";
  // Find the highest existing JLT-XXXX number
  const all = await db
    .select({ uniqueAgentId: prospects.uniqueAgentId })
    .from(prospects)
    .where(like(prospects.uniqueAgentId, "JLT-%"));
  let max = 0;
  for (const row of all) {
    if (row.uniqueAgentId) {
      const num = parseInt(row.uniqueAgentId.replace("JLT-", ""), 10);
      if (!isNaN(num) && num > max) max = num;
    }
  }
  return `JLT-${String(max + 1).padStart(4, "0")}`;
}
