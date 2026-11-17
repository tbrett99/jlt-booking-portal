/**
 * Recruitment Pipeline DB helpers
 */
import { getDb } from "./db";
import { TRPCError } from "@trpc/server";
import { notLinkedRecruitmentProspect, notSupersededRecruitmentProspect, recruitmentWonDateFilter } from "./recruitment-signup-link-integration";
import {
  recruitmentProspects,
  recruitmentSignupLinks,
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

/**
 * Find a prospect directly from the prefix-stored application token. Public
 * form submissions must not depend on a limited in-memory prospect list.
 */
export async function getRecruitmentProspectByApplicationToken(
  token: string
): Promise<RecruitmentProspect | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(recruitmentProspects)
    .where(like(recruitmentProspects.adminNotes, `APP_TOKEN:${token}%`))
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

  const conditions: any[] = [notSupersededRecruitmentProspect()];

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
    conditions.push(recruitmentWonDateFilter(opts!.dateFrom, endOfDay ?? undefined));
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
  const guardedStage = data.pipelineStage !== undefined;
  const [changed] = await db
    .update(recruitmentProspects)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(recruitmentProspects.id, id), guardedStage
      ? data.pipelineStage === "won" ? notSupersededRecruitmentProspect() : notLinkedRecruitmentProspect()
      : undefined));
  if (guardedStage && changed.affectedRows === 0) throw new TRPCError({ code: "CONFLICT", message: "The enquiry changed or has a preserved signup link. Refresh before changing its stage." });
}

export async function moveRecruitmentProspectStage(opts: {
  prospectId: number;
  toStage: string;
  changedById?: number;
  changedByName?: string;
  note?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Recruitment database unavailable." });
  await db.transaction(async tx => {
    const [current] = await tx.select({ pipelineStage: recruitmentProspects.pipelineStage }).from(recruitmentProspects)
      .where(eq(recruitmentProspects.id, opts.prospectId)).for("update");
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Enquiry not found." });
    const links = await tx.select({ prospectId: recruitmentSignupLinks.prospectId, supersededProspectId: recruitmentSignupLinks.supersededProspectId })
      .from(recruitmentSignupLinks).where(or(eq(recruitmentSignupLinks.prospectId, opts.prospectId), eq(recruitmentSignupLinks.supersededProspectId, opts.prospectId)));
    if (links.some(link => link.supersededProspectId === opts.prospectId || opts.toStage !== "won"))
      throw new TRPCError({ code: "CONFLICT", message: "This enquiry has a preserved signup link. Its converted or duplicate status cannot be changed here." });
    if (current.pipelineStage === opts.toStage) return;
    const now = new Date();
    await tx.update(recruitmentProspects).set({
      pipelineStage: opts.toStage, updatedAt: now,
      ...(opts.toStage === "archived" ? { archivedAt: now } : {}),
      ...(opts.toStage === "ar_approved" || opts.toStage === "ar_declined" ? { reviewedAt: now, reviewedById: opts.changedById ?? null } : {}),
    }).where(eq(recruitmentProspects.id, opts.prospectId));
    await tx.insert(recruitmentStageHistory).values({
      prospectId: opts.prospectId, fromStage: current.pipelineStage, toStage: opts.toStage,
      changedById: opts.changedById ?? null, changedByName: opts.changedByName ?? null, note: opts.note ?? null, changedAt: now,
    });
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
  await db.transaction(async tx => {
    await tx.select({ id: recruitmentProspects.id }).from(recruitmentProspects).where(eq(recruitmentProspects.id, id)).for("update");
    const links = await tx.select({ id: recruitmentSignupLinks.id }).from(recruitmentSignupLinks)
      .where(or(eq(recruitmentSignupLinks.prospectId, id), eq(recruitmentSignupLinks.supersededProspectId, id)));
    if (links.length) throw new TRPCError({ code: "CONFLICT", message: "This enquiry is part of a preserved signup link and cannot be deleted." });
    await tx.delete(recruitmentEmailsSent).where(eq(recruitmentEmailsSent.prospectId, id));
    await tx.delete(recruitmentStageHistory).where(eq(recruitmentStageHistory.prospectId, id));
    await tx.delete(recruitmentProspects).where(eq(recruitmentProspects.id, id));
  });
}
