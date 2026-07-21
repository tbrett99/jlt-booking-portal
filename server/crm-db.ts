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
  emailSends,
  emailUnsubscribes,
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
    // Legal evidence fields
    signingIp?: string | null;
    signingUserAgent?: string | null;
    consentConfirmed?: boolean;
    contractTextSnapshot?: string | null;
    contractHash?: string | null;
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
  bodyText?: string;
  audienceType: "prospect" | "agent";
  segmentFilters?: string;
  templateId?: number;
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
    bodyText?: string;
    audienceType?: "prospect" | "agent";
    segmentFilters?: string;
    templateId?: number | null;
    status?: "draft" | "sending" | "sent" | "failed";
    sentAt?: Date;
    totalRecipients?: number;
    sentById?: number;
    sentByName?: string;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(emailCampaigns).set(data).where(eq(emailCampaigns.id, id));
}

export async function createEmailSends(
  sends: Array<{
    campaignId?: number;
    dripStepId?: number;
    enrollmentId?: number;
    recipientEmail: string;
    recipientName?: string;
    recipientType: "prospect" | "agent";
    recipientId?: number;
    subject: string;
  }>
) {
  if (sends.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(emailSends).values(sends);
}

export async function updateEmailSendStatus(
  id: number,
  status: "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained" | "failed",
  extra?: { resendMessageId?: string; failedReason?: string; openedAt?: Date; clickedAt?: Date; deliveredAt?: Date; bouncedAt?: Date }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateData: Record<string, unknown> = { status };
  if (status === "sent") updateData.sentAt = new Date();
  if (extra?.resendMessageId) updateData.resendMessageId = extra.resendMessageId;
  if (extra?.failedReason) updateData.failedReason = extra.failedReason;
  if (extra?.openedAt) updateData.openedAt = extra.openedAt;
  if (extra?.clickedAt) updateData.clickedAt = extra.clickedAt;
  if (extra?.deliveredAt) updateData.deliveredAt = extra.deliveredAt;
  if (extra?.bouncedAt) updateData.bouncedAt = extra.bouncedAt;
  await db.update(emailSends).set(updateData).where(eq(emailSends.id, id));
}

export async function getCampaignSends(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(emailSends).where(eq(emailSends.campaignId, campaignId));
}

export async function getEmailSendByResendId(resendMessageId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(emailSends).where(eq(emailSends.resendMessageId, resendMessageId)).limit(1);
  return rows[0] ?? null;
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

// ─── Email Templates ──────────────────────────────────────────────────────────

import {
  emailTemplates,
  emailDripWorkflows,
  emailDripSteps,
  emailDripEnrollments,
  type InsertEmailTemplate,
  type InsertEmailDripWorkflow,
  type InsertEmailDripEnrollment,
} from "../drizzle/schema";

export async function getAllEmailTemplates(audienceType?: "prospect" | "agent") {
  const db = await getDb();
  if (!db) return [];
  if (audienceType) {
    return db.select().from(emailTemplates).where(eq(emailTemplates.audienceType, audienceType)).orderBy(desc(emailTemplates.createdAt));
  }
  return db.select().from(emailTemplates).orderBy(desc(emailTemplates.createdAt));
}

export async function getEmailTemplateById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createEmailTemplate(data: InsertEmailTemplate) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(emailTemplates).values(data);
  return (result as { insertId: number }).insertId;
}

export async function updateEmailTemplate(id: number, data: Partial<InsertEmailTemplate>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(emailTemplates).set(data).where(eq(emailTemplates.id, id));
}

export async function deleteEmailTemplate(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(emailTemplates).where(eq(emailTemplates.id, id));
}

// ─── Drip Workflows ───────────────────────────────────────────────────────────

export async function getAllDripWorkflows() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(emailDripWorkflows).orderBy(desc(emailDripWorkflows.createdAt));
}

export async function getDripWorkflowById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(emailDripWorkflows).where(eq(emailDripWorkflows.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createDripWorkflow(data: InsertEmailDripWorkflow) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(emailDripWorkflows).values(data);
  return (result as { insertId: number }).insertId;
}

export async function updateDripWorkflow(id: number, data: Partial<InsertEmailDripWorkflow>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(emailDripWorkflows).set(data).where(eq(emailDripWorkflows.id, id));
}

export async function deleteDripWorkflow(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(emailDripSteps).where(eq(emailDripSteps.workflowId, id));
  await db.delete(emailDripEnrollments).where(eq(emailDripEnrollments.workflowId, id));
  await db.delete(emailDripWorkflows).where(eq(emailDripWorkflows.id, id));
}

// ─── Drip Steps ───────────────────────────────────────────────────────────────

export async function getDripStepsByWorkflow(workflowId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(emailDripSteps).where(eq(emailDripSteps.workflowId, workflowId)).orderBy(emailDripSteps.stepOrder);
}

export async function upsertDripSteps(workflowId: number, steps: Array<{
  stepOrder: number;
  delayDays: number;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  templateId?: number;
}>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(emailDripSteps).where(eq(emailDripSteps.workflowId, workflowId));
  if (steps.length > 0) {
    await db.insert(emailDripSteps).values(steps.map((s) => ({ workflowId, ...s })));
  }
}

// ─── Drip Enrollments ─────────────────────────────────────────────────────────

export async function enrollInDripWorkflow(data: {
  workflowId: number;
  recipientEmail: string;
  recipientName?: string;
  recipientType: "prospect" | "agent";
  recipientId?: number;
  nextSendAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(emailDripEnrollments)
    .where(and(
      eq(emailDripEnrollments.workflowId, data.workflowId),
      eq(emailDripEnrollments.recipientEmail, data.recipientEmail),
      eq(emailDripEnrollments.status, "active")
    )).limit(1);
  if (existing.length > 0) return existing[0].id;
  const [result] = await db.insert(emailDripEnrollments).values({
    workflowId: data.workflowId,
    recipientEmail: data.recipientEmail,
    recipientName: data.recipientName,
    recipientType: data.recipientType,
    recipientId: data.recipientId,
    currentStep: 0,
    status: "active",
    nextSendAt: data.nextSendAt ?? new Date(),
  });
  return (result as { insertId: number }).insertId;
}

export async function getEnrollmentsByWorkflow(workflowId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(emailDripEnrollments).where(eq(emailDripEnrollments.workflowId, workflowId)).orderBy(desc(emailDripEnrollments.enrolledAt));
}

export async function advanceEnrollment(id: number, nextStep: number, nextSendAt: Date | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (nextSendAt === null) {
    await db.update(emailDripEnrollments).set({ status: "completed", completedAt: new Date() }).where(eq(emailDripEnrollments.id, id));
  } else {
    await db.update(emailDripEnrollments).set({ currentStep: nextStep, nextSendAt }).where(eq(emailDripEnrollments.id, id));
  }
}

export async function getDueEnrollments() {
  const db = await getDb();
  if (!db) return [];
  const { lte } = await import("drizzle-orm");
  return db.select().from(emailDripEnrollments)
    .where(and(
      eq(emailDripEnrollments.status, "active"),
      lte(emailDripEnrollments.nextSendAt, new Date())
    ));
}

// ─── Campaign Stats ───────────────────────────────────────────────────────────

export async function getCampaignStats(campaignId: number) {
  const db = await getDb();
  if (!db) return { total: 0, sent: 0, opened: 0, clicked: 0, failed: 0 };
  const sends = await db.select().from(emailSends).where(eq(emailSends.campaignId, campaignId));
  return {
    total: sends.length,
    sent: sends.filter((s) => ["sent", "delivered", "opened", "clicked"].includes(s.status)).length,
    opened: sends.filter((s) => ["opened", "clicked"].includes(s.status)).length,
    clicked: sends.filter((s) => s.status === "clicked").length,
    failed: sends.filter((s) => s.status === "failed").length,
  };
}

export async function getCampaignRecipients(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(emailSends)
    .where(eq(emailSends.campaignId, campaignId))
    .orderBy(emailSends.sentAt);
  return rows.map((r) => ({
    id: r.id,
    recipientEmail: r.recipientEmail,
    recipientName: r.recipientName,
    recipientType: r.recipientType,
    recipientId: r.recipientId,
    subject: r.subject,
    status: r.status,
    sentAt: r.sentAt,
    openedAt: r.openedAt,
    clickedAt: r.clickedAt,
    bouncedAt: r.bouncedAt,
    failedReason: r.failedReason,
  }));
}

export async function recordEmailOpen(sendId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(emailSends).set({ status: "opened", openedAt: new Date() }).where(eq(emailSends.id, sendId));
}

export async function recordEmailClick(sendId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(emailSends).set({ status: "clicked", clickedAt: new Date() }).where(eq(emailSends.id, sendId));
}

// ── Email Branding Settings ───────────────────────────────────────────────────
import { emailBrandingSettings, type EmailBrandingSettings, type InsertEmailBrandingSettings } from "../drizzle/schema";

export async function getEmailBrandingSettings(): Promise<EmailBrandingSettings | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(emailBrandingSettings).limit(1);
  return rows[0] ?? null;
}

export async function upsertEmailBrandingSettings(
  data: Partial<Omit<InsertEmailBrandingSettings, "id" | "updatedAt">>,
  updatedBy: number
): Promise<EmailBrandingSettings | null> {
  const db = await getDb();
  if (!db) return null;
  const existing = await getEmailBrandingSettings();
  if (existing) {
    await db
      .update(emailBrandingSettings)
      .set({ ...data, updatedBy })
      .where(eq(emailBrandingSettings.id, existing.id));
    return getEmailBrandingSettings();
  } else {
    const [result] = await db.insert(emailBrandingSettings).values({ ...data, updatedBy } as InsertEmailBrandingSettings);
    const id = (result as { insertId: number }).insertId;
    const rows = await db.select().from(emailBrandingSettings).where(eq(emailBrandingSettings.id, id)).limit(1);
    return rows[0] ?? null;
  }
}

// ─── Agent Email Log ──────────────────────────────────────────────────────────
export async function getAgentEmailLog(params: {
  search?: string;
  triggerKey?: string;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return { rows: [], total: 0 };
  const { agentEmails } = await import("../drizzle/schema");
  const { sql, desc: descOp } = await import("drizzle-orm");

  const conditions: any[] = [];
  if (params.search) {
    const s = `%${params.search}%`;
    conditions.push(or(like(agentEmails.toEmail, s), like(agentEmails.toName as any, s), like(agentEmails.subject, s)));
  }
  if (params.triggerKey) {
    // campaign:N keys are stored as "campaign:123" — prefix match covers all campaign emails
    if (params.triggerKey === "campaign") {
      conditions.push(like(agentEmails.triggerKey, "campaign%"));
    } else if (params.triggerKey === "gc_receipt") {
      // Receipts are stored with payment ID suffix: gc_receipt_PM01XND...
      conditions.push(like(agentEmails.triggerKey, "gc_receipt%"));
    } else {
      conditions.push(eq(agentEmails.triggerKey, params.triggerKey));
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(agentEmails)
    .where(where);

  const rows = await db
    .select()
    .from(agentEmails)
    .where(where)
    .orderBy(descOp(agentEmails.sentAt))
    .limit(params.limit ?? 50)
    .offset(params.offset ?? 0);

  return { rows, total: Number(countRow.count) };
}

// ─── Drip Email Processor ─────────────────────────────────────────────────────

/**
 * Processes all active CRM drip enrollments that are due to send.
 * Called by the scheduler every 15 minutes.
 */
export async function processDripEmailsInternal(): Promise<{ processed: number; sent: number; errors: number }> {
  const db = await getDb();
  if (!db) return { processed: 0, sent: 0, errors: 0 };

  const { lte } = await import("drizzle-orm");
  const due = await db.select().from(emailDripEnrollments)
    .where(and(
      eq(emailDripEnrollments.status, "active"),
      lte(emailDripEnrollments.nextSendAt, new Date())
    ));

  let sent = 0;
  let errors = 0;

  for (const enrollment of due) {
    try {
      // Get the workflow
      const workflow = await getDripWorkflowById(enrollment.workflowId);
      if (!workflow || !workflow.isActive) continue;

      // Get steps for this workflow
      const steps = await getDripStepsByWorkflow(enrollment.workflowId);
      const currentStep = steps.find((s) => s.stepOrder === enrollment.currentStep);

      if (!currentStep) {
        // No more steps — mark as completed
        await db.update(emailDripEnrollments)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(emailDripEnrollments.id, enrollment.id));
        continue;
      }

      // Check if recipient is unsubscribed
      const unsub = await db.select({ id: emailUnsubscribes.id })
        .from(emailUnsubscribes)
        .where(eq(emailUnsubscribes.email, enrollment.recipientEmail))
        .limit(1);
      if (unsub.length > 0) {
        await db.update(emailDripEnrollments)
          .set({ status: "unsubscribed" })
          .where(eq(emailDripEnrollments.id, enrollment.id));
        continue;
      }

      // Replace template variables
      const firstName = enrollment.recipientName?.split(" ")[0] ?? enrollment.recipientName ?? "";
      const subject = currentStep.subject
        .replace(/\{\{firstName\}\}/g, firstName)
        .replace(/\{\{name\}\}/g, enrollment.recipientName ?? "")
        .replace(/\{\{email\}\}/g, enrollment.recipientEmail);
      const bodyHtml = currentStep.bodyHtml
        .replace(/\{\{firstName\}\}/g, firstName)
        .replace(/\{\{name\}\}/g, enrollment.recipientName ?? "")
        .replace(/\{\{email\}\}/g, enrollment.recipientEmail);

      // Send via Resend
      const { sendMarketingEmail } = await import("./resend-email");
      const result = await sendMarketingEmail({
        to: enrollment.recipientEmail,
        toName: enrollment.recipientName ?? undefined,
        subject,
        bodyHtml,
        audienceType: enrollment.recipientType,
        recipientType: enrollment.recipientType,
        recipientId: enrollment.recipientId ?? undefined,
        dripStepId: currentStep.id,
        enrollmentId: enrollment.id,
        baseUrl: process.env.VITE_OAUTH_PORTAL_URL ?? "https://portal.thejltgroup.co.uk",
      });

      if (!result.success) {
        errors++;
        continue;
      }

      sent++;

      // Advance to next step
      const nextStep = steps.find((s) => s.stepOrder > enrollment.currentStep);
      if (nextStep) {
        const nextSendAt = new Date();
        nextSendAt.setDate(nextSendAt.getDate() + nextStep.delayDays);
        await db.update(emailDripEnrollments)
          .set({ currentStep: nextStep.stepOrder, nextSendAt })
          .where(eq(emailDripEnrollments.id, enrollment.id));
      } else {
        // All steps done
        await db.update(emailDripEnrollments)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(emailDripEnrollments.id, enrollment.id));
      }
    } catch (err: any) {
      console.error(`[DripProcessor] Error processing enrollment ${enrollment.id}:`, err?.message);
      errors++;
    }
  }

  return { processed: due.length, sent, errors };
}

/**
 * Auto-enroll CRM prospects in active drip workflows when their pipeline stage changes.
 * Called from the CRM prospect stage-change mutation.
 */
export async function autoEnrollProspectInDripWorkflows(prospectId: number, newStage: string, prospectEmail: string, prospectName: string) {
  const db = await getDb();
  if (!db) return;

  // Find active workflows triggered by this stage
  const workflows = await db.select()
    .from(emailDripWorkflows)
    .where(and(
      eq(emailDripWorkflows.isActive, true),
      eq(emailDripWorkflows.triggerStage, newStage)
    ));

  for (const workflow of workflows) {
    // Check if already enrolled
    const existing = await db.select({ id: emailDripEnrollments.id })
      .from(emailDripEnrollments)
      .where(and(
        eq(emailDripEnrollments.workflowId, workflow.id),
        eq(emailDripEnrollments.recipientEmail, prospectEmail),
        eq(emailDripEnrollments.status, "active")
      ))
      .limit(1);

    if (existing.length > 0) continue; // Already enrolled

    // Get first step to determine initial send time
    const steps = await getDripStepsByWorkflow(workflow.id);
    const firstStep = steps.sort((a, b) => a.stepOrder - b.stepOrder)[0];
    if (!firstStep) continue;

    const nextSendAt = new Date();
    nextSendAt.setDate(nextSendAt.getDate() + firstStep.delayDays);

    await db.insert(emailDripEnrollments).values({
      workflowId: workflow.id,
      recipientEmail: prospectEmail,
      recipientName: prospectName,
      recipientType: "prospect",
      recipientId: prospectId,
      currentStep: firstStep.stepOrder,
      status: "active",
      nextSendAt,
    });

    console.log(`[DripEngine] Auto-enrolled prospect ${prospectId} in workflow "${workflow.name}" (stage: ${newStage})`);
  }
}
