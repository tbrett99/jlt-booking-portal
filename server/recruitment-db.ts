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
import { eq, desc, like, or, and, isNull, getTableColumns, gte, lte, sql, inArray } from "drizzle-orm";

// ─── Application token helpers ──────────────────────────────────────────────────

/**
 * Encode an application token as a prefix in adminNotes.
 * Format: "APP_TOKEN:<token>\n<rest of notes>"
 */
export function encodeApplicationToken(token: string, existingNotes?: string | null): string {
  const existing = existingNotes?.replace(/^APP_TOKEN:[^\n]+\n?/, "") ?? "";
  return `APP_TOKEN:${token}\n${existing}`.trim();
}

/**
 * Extract the application token from adminNotes (returns null if not present).
 */
export function extractApplicationToken(adminNotes?: string | null): string | null {
  if (!adminNotes) return null;
  const match = adminNotes.match(/^APP_TOKEN:([^\n]+)/);
  return match ? match[1].trim() : null;
}

/**
 * Strip the application token prefix from adminNotes for display.
 */
export function stripApplicationToken(adminNotes?: string | null): string {
  if (!adminNotes) return "";
  return adminNotes.replace(/^APP_TOKEN:[^\n]+\n?/, "").trim();
}

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
  const rows = await (db
    .select({ ...getTableColumns(recruitmentProspects), referrerName: users.name })
    .from(recruitmentProspects)
    .leftJoin(users, eq(recruitmentProspects.referredById, users.id))
    .where(eq(recruitmentProspects.id, id))
    .limit(1) as any);
  return (rows[0] ?? null) as (RecruitmentProspect & { referrerName: string | null }) | null;
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
  hearAboutUs?: string;  // filter by lead source
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}): Promise<(RecruitmentProspect & { referrerName: string | null })[]> {
  const db = await getDb();
  if (!db) return [];

  // When filtering by "won" stage with a date range, we want to filter by
  // when the prospect moved to "won" (from stage history), not when they first enquired.
  const isWonStageWithDateFilter =
    opts?.stage === "won" && (opts?.dateFrom || opts?.dateTo);

  const conditions: any[] = [];

  if (opts?.stage && opts.stage !== "all") {
    conditions.push(eq(recruitmentProspects.pipelineStage, opts.stage));
  }

  if (opts?.referredById) {
    conditions.push(eq(recruitmentProspects.referredById, opts.referredById));
  }

  if (!isWonStageWithDateFilter) {
    // For non-won stages, filter by enquiry date (createdAt)
    if (opts?.dateFrom) {
      conditions.push(gte(recruitmentProspects.createdAt, opts.dateFrom));
    }
    if (opts?.dateTo) {
      const endOfDay = new Date(opts.dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push(lte(recruitmentProspects.createdAt, endOfDay));
    }
  }

  if (opts?.hearAboutUs && opts.hearAboutUs !== "all") {
    // Match against howHeard column OR applicationData JSON heardAbout array
    const src = `%${opts.hearAboutUs}%`;
    conditions.push(
      or(
        like(recruitmentProspects.howHeard, src),
        sql`JSON_SEARCH(${recruitmentProspects.applicationData}, 'one', ${opts.hearAboutUs}, NULL, '$.heardAbout') IS NOT NULL`
      )
    );
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

  // For "won" stage with date range: filter by when the prospect moved to "won"
  // using a subquery on recruitment_stage_history.changedAt
  if (isWonStageWithDateFilter) {
    const endOfDay = opts!.dateTo ? new Date(opts!.dateTo) : null;
    if (endOfDay) endOfDay.setHours(23, 59, 59, 999);

    const historyConditions: any[] = [
      eq(recruitmentStageHistory.toStage, "won"),
    ];
    if (opts!.dateFrom) {
      historyConditions.push(gte(recruitmentStageHistory.changedAt, opts!.dateFrom));
    }
    if (endOfDay) {
      historyConditions.push(lte(recruitmentStageHistory.changedAt, endOfDay));
    }

    const wonProspectIds = db
      .selectDistinct({ id: recruitmentStageHistory.prospectId })
      .from(recruitmentStageHistory)
      .where(and(...historyConditions));

    conditions.push(inArray(recruitmentProspects.id, wonProspectIds));
  }

  const baseQuery = db
    .select({
      ...getTableColumns(recruitmentProspects),
      referrerName: users.name,
      emailCount: sql<number>`(
        SELECT COUNT(*) FROM recruitment_emails_sent
        WHERE prospectId = ${recruitmentProspects.id}
      )`,
    })
    .from(recruitmentProspects)
    .leftJoin(users, eq(recruitmentProspects.referredById, users.id))
    .orderBy(desc(recruitmentProspects.createdAt))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0);

  const result: any[] = conditions.length > 0
    ? await (baseQuery.where(and(...conditions)) as any)
    : await (baseQuery as any);
  return result as (RecruitmentProspect & { referrerName: string | null; emailCount: number })[];
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
