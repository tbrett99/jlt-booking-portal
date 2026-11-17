import { TRPCError } from "@trpc/server";
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { getAgentMergeHistoryIds } from "./agent-merge-identity";
import { recruitmentProspects, recruitmentSignupLinks, recruitmentStageHistory } from "../drizzle/schema";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export const notSupersededRecruitmentProspect = (): SQL => sql`NOT EXISTS (
  SELECT 1 FROM recruitment_signup_links rsl WHERE rsl.supersededProspectId = ${recruitmentProspects.id}
)`;
export const notLinkedRecruitmentProspect = (): SQL => sql`NOT EXISTS (
  SELECT 1 FROM recruitment_signup_links rsl WHERE rsl.prospectId = ${recruitmentProspects.id} OR rsl.supersededProspectId = ${recruitmentProspects.id}
)`;

export async function recruitmentSignupLinkRoles(prospectId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Recruitment linking storage is unavailable." });
  const rows = await db.select({ prospectId: recruitmentSignupLinks.prospectId, supersededProspectId: recruitmentSignupLinks.supersededProspectId })
    .from(recruitmentSignupLinks).where(or(eq(recruitmentSignupLinks.prospectId, prospectId), eq(recruitmentSignupLinks.supersededProspectId, prospectId)));
  return { linked: rows.some(row => row.prospectId === prospectId), superseded: rows.some(row => row.supersededProspectId === prospectId) };
}
export async function assertRecruitmentSignupLinkAllowsStage(prospectId: number, toStage: string) {
  const role = await recruitmentSignupLinkRoles(prospectId);
  if (role.superseded || (role.linked && toStage !== "won")) throw new TRPCError({ code: "CONFLICT", message: "This enquiry has a preserved signup link. Its converted or duplicate status cannot be changed here." });
}
export async function assertRecruitmentSignupLinkAllowsDelete(prospectId: number) {
  const role = await recruitmentSignupLinkRoles(prospectId);
  if (role.linked || role.superseded) throw new TRPCError({ code: "CONFLICT", message: "This enquiry is part of a preserved signup link and cannot be deleted. Its history must be retained." });
}
export async function isRecruitmentSignupLinked(prospectId: number) {
  const role = await recruitmentSignupLinkRoles(prospectId);
  return role.linked || role.superseded;
}

/** Read-only historical identity resolution. Never transfers account authority or contracts. */
export async function explicitRecruitmentSignupLinkForUser(userId: number, joinSessionId?: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Recruitment linking storage is unavailable." });
  const ids = await getAgentMergeHistoryIds(userId, true);
  const rows = await db.select({ prospectId: recruitmentSignupLinks.prospectId, joinSessionId: recruitmentSignupLinks.joinSessionId, userId: recruitmentSignupLinks.userId })
    .from(recruitmentSignupLinks).where(inArray(recruitmentSignupLinks.userId, ids));
  if (rows.length > 1 || (rows.length === 1 && joinSessionId !== undefined && rows[0].joinSessionId !== joinSessionId))
    throw new TRPCError({ code: "CONFLICT", message: "The completed application conflicts with a preserved recruitment link; staff review is required." });
  return rows[0] ?? null;
}

/** Only manual links override historical conversion dates. Unlinked legacy event counts stay unchanged. */
const conversionProjection = sql`(
  SELECT rsl.prospectId, rsl.conversionAt FROM recruitment_signup_links rsl
  UNION ALL
  SELECT rsh.prospectId, rsh.changedAt AS conversionAt FROM recruitment_stage_history rsh
  WHERE rsh.toStage = 'won' AND NOT EXISTS (
    SELECT 1 FROM recruitment_signup_links rsl WHERE rsl.prospectId = rsh.prospectId OR rsl.supersededProspectId = rsh.prospectId
  )
)`;
export async function countRecruitmentConversions(db: Db, from?: Date, to?: Date): Promise<Array<{ count: number }>> {
  const filters: SQL[] = [];
  if (from) filters.push(sql`c.conversionAt >= ${from}`);
  if (to) filters.push(sql`c.conversionAt < ${to}`);
  const result = await db.execute(sql`SELECT COUNT(*) AS count FROM ${conversionProjection} c ${filters.length ? sql`WHERE ${and(...filters)}` : sql``}`);
  return (result as unknown as [Array<{ count: number }>, unknown])[0];
}
export async function averageRecruitmentConversionDays(db: Db): Promise<Array<{ avgDays: number | null }>> {
  const result = await db.execute(sql`SELECT AVG(TIMESTAMPDIFF(DAY, rp.createdAt, c.conversionAt)) AS avgDays FROM ${conversionProjection} c INNER JOIN recruitment_prospects rp ON rp.id = c.prospectId`);
  return (result as unknown as [Array<{ avgDays: number | null }>, unknown])[0];
}
export const recruitmentWonDateFilter = (from?: Date, toInclusive?: Date): SQL => {
  const linkedFilters = [sql`rsl.prospectId = ${recruitmentProspects.id}`];
  const legacyFilters = [sql`rsh.prospectId = ${recruitmentProspects.id}`, sql`rsh.toStage = 'won'`];
  if (from) { linkedFilters.push(sql`rsl.conversionAt >= ${from}`); legacyFilters.push(sql`rsh.changedAt >= ${from}`); }
  if (toInclusive) { linkedFilters.push(sql`rsl.conversionAt <= ${toInclusive}`); legacyFilters.push(sql`rsh.changedAt <= ${toInclusive}`); }
  return sql`(EXISTS (SELECT 1 FROM recruitment_signup_links rsl WHERE ${and(...linkedFilters)}) OR
    (${notLinkedRecruitmentProspect()} AND EXISTS (SELECT 1 FROM recruitment_stage_history rsh WHERE ${and(...legacyFilters)})))`;
};
