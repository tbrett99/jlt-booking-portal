/**
 * Recruitment Pipeline DB helpers
 */
import { getDb } from "./db";
import {
  recruitmentProspects,
  recruitmentEmailsSent,
  recruitmentStageHistory,
  users,
  type RecruitmentProspect,
  type InsertRecruitmentProspect,
} from "../drizzle/schema";
import { eq, desc, like, or, and, isNull, getTableColumns } from "drizzle-orm";

// ─── Prospects ────────────────────────────────────────────────────────────────

export async function createRecruitmentProspect(
  data: InsertRecruitmentProspect
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [result] = await db.insert(recruitmentProspects).values(data);
  return (result as any).insertId as number;
}

export async function getRecruitmentProspectById(
  id: number
): Promise<(RecruitmentProspect & { referrerName: string | null }) | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ ...getTableColumns(recruitmentProspects), referrerName: users.name })
    .from(recruitmentProspects)
    .leftJoin(users, eq(recruitmentProspects.referredById, users.id))
    .where(eq(recruitmentProspects.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getRecruitmentProspectByEmail(
  email: string
): Promise<RecruitmentProspect | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(recruitmentProspects)
    .where(eq(recruitmentProspects.email, email.toLowerCase().trim()))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAllRecruitmentProspects(opts?: {
  stage?: string;
  search?: string;
  referredById?: number;
  limit?: number;
  offset?: number;
}): Promise<(RecruitmentProspect & { referrerName: string | null })[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions: any[] = [];

  if (opts?.stage && opts.stage !== "all") {
    conditions.push(eq(recruitmentProspects.pipelineStage, opts.stage));
  }

  if (opts?.referredById) {
    conditions.push(eq(recruitmentProspects.referredById, opts.referredById));
  }

  if (opts?.search) {
    const q = `%${opts.search}%`;
    conditions.push(
      or(
        like(recruitmentProspects.firstName, q),
        like(recruitmentProspects.lastName, q),
        like(recruitmentProspects.email, q),
        like(recruitmentProspects.phone, q)
      )
    );
  }

  const query = db
    .select({ ...getTableColumns(recruitmentProspects), referrerName: users.name })
    .from(recruitmentProspects)
    .leftJoin(users, eq(recruitmentProspects.referredById, users.id))
    .orderBy(desc(recruitmentProspects.createdAt))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0);

  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }
  return query;
}

export async function updateRecruitmentProspect(
  id: number,
  data: Partial<InsertRecruitmentProspect>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(recruitmentProspects)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(recruitmentProspects.id, id));
}

export async function moveRecruitmentProspectStage(opts: {
  prospectId: number;
  toStage: string;
  changedById?: number;
  changedByName?: string;
  note?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Get current stage for history
  const current = await getRecruitmentProspectById(opts.prospectId);
  const fromStage = current?.pipelineStage ?? null;

  // Update prospect
  await db
    .update(recruitmentProspects)
    .set({
      pipelineStage: opts.toStage,
      updatedAt: new Date(),
      ...(opts.toStage === "archived" ? { archivedAt: new Date() } : {}),
      ...(opts.toStage === "ar_approved" || opts.toStage === "ar_declined"
        ? { reviewedAt: new Date(), reviewedById: opts.changedById ?? null }
        : {}),
    })
    .where(eq(recruitmentProspects.id, opts.prospectId));

  // Insert history record
  await db.insert(recruitmentStageHistory).values({
    prospectId: opts.prospectId,
    fromStage: fromStage ?? null,
    toStage: opts.toStage,
    changedById: opts.changedById ?? null,
    changedByName: opts.changedByName ?? null,
    note: opts.note ?? null,
    changedAt: new Date(),
  });
}

// ─── Stage History ────────────────────────────────────────────────────────────

export async function getRecruitmentStageHistory(prospectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(recruitmentStageHistory)
    .where(eq(recruitmentStageHistory.prospectId, prospectId))
    .orderBy(desc(recruitmentStageHistory.changedAt));
}

// ─── Emails Sent ─────────────────────────────────────────────────────────────

export async function logRecruitmentEmail(opts: {
  prospectId: number;
  stage: string;
  emailKey: string;
  subject?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(recruitmentEmailsSent).values({
    prospectId: opts.prospectId,
    stage: opts.stage,
    emailKey: opts.emailKey,
    subject: opts.subject ?? null,
    sentAt: new Date(),
  });
}

export async function getRecruitmentEmailsSent(prospectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(recruitmentEmailsSent)
    .where(eq(recruitmentEmailsSent.prospectId, prospectId))
    .orderBy(desc(recruitmentEmailsSent.sentAt));
}

export async function hasRecruitmentEmailBeenSent(
  prospectId: number,
  emailKey: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select()
    .from(recruitmentEmailsSent)
    .where(
      and(
        eq(recruitmentEmailsSent.prospectId, prospectId),
        eq(recruitmentEmailsSent.emailKey, emailKey)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function deleteRecruitmentProspect(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Delete related rows first to avoid FK constraint errors
  await db.delete(recruitmentEmailsSent).where(eq(recruitmentEmailsSent.prospectId, id));
  await db.delete(recruitmentStageHistory).where(eq(recruitmentStageHistory.prospectId, id));
  // Delete the prospect itself
  await db.delete(recruitmentProspects).where(eq(recruitmentProspects.id, id));
}
