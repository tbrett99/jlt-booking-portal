import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { joinSessions, users, agentCrmProfiles, recruitmentProspects } from "../drizzle/schema";
import { getAgentMergeTarget } from "./agent-merge-identity";
import { explicitRecruitmentSignupLinkForUser, notSupersededRecruitmentProspect } from "./recruitment-signup-link-integration";
import { hasManualJoiningFeeReceipt } from "./join-manual-receipt";
import { moveRecruitmentProspectStage } from "./recruitment-db";

/** No provider calls, signing writes, account creation or email effects. An account alone is not a conversion. */
export async function syncRecruitmentCompletedSignup(userId: number, joinSessionId?: number): Promise<{ changed: boolean; prospectId: number | null }> {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid signup account." });
  const existing = await explicitRecruitmentSignupLinkForUser(userId, joinSessionId);
  if (existing) return { changed: false, prospectId: existing.prospectId };
  if (await getAgentMergeTarget(userId, true)) return { changed: false, prospectId: null };
  const db = await getDb();
  if (!db) throw new Error("Recruitment completion storage unavailable");
  const [person] = await db.select({ id: users.id, role: users.role, isActive: users.isActive, portalStatus: users.portalStatus })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!person || person.role !== "agent" || !person.isActive || !["onboarding", "active"].includes(person.portalStatus ?? "")) return { changed: false, prospectId: null };
  const profiles = await db.select({ userId: agentCrmProfiles.userId, agentStatus: agentCrmProfiles.agentStatus }).from(agentCrmProfiles).where(eq(agentCrmProfiles.userId, userId)).limit(2);
  if (profiles.length !== 1 || profiles[0].agentStatus !== "active") return { changed: false, prospectId: null };
  const sessions = await db.select({ id: joinSessions.id, userId: joinSessions.userId, email: joinSessions.email, membershipType: joinSessions.membershipType,
    contractSignedAt: joinSessions.contractSignedAt, joiningFeePaidAt: joinSessions.joiningFeePaidAt, contractHash: joinSessions.contractHash,
    billingRequestId: joinSessions.billingRequestId, joiningFeeManualReceipt: joinSessions.joiningFeeManualReceipt,
    consentConfirmed: joinSessions.consentConfirmed,
    hasSigner: sql<number>`CASE WHEN LENGTH(TRIM(${joinSessions.signerName})) > 0 THEN 1 ELSE 0 END`,
    hasSnapshot: sql<number>`CASE WHEN LENGTH(${joinSessions.contractTextSnapshot}) > 0 THEN 1 ELSE 0 END`,
    hasSignature: sql<number>`CASE WHEN LENGTH(${joinSessions.signatureDataUrl}) > 0 THEN 1 ELSE 0 END`,
  }).from(joinSessions).where(and(eq(joinSessions.userId, userId), eq(joinSessions.step, "complete"), sql`${joinSessions.joiningFeePaidAt} IS NOT NULL AND ${joinSessions.contractSignedAt} IS NOT NULL AND ${joinSessions.membershipType} <> 'team_member' AND ${joinSessions.consentConfirmed} = 1 AND LENGTH(${joinSessions.contractTextSnapshot}) > 0 AND LENGTH(${joinSessions.signatureDataUrl}) > 0 AND ${joinSessions.contractHash} REGEXP '^[a-fA-F0-9]{64}$'`)).limit(2);
  if (sessions.length !== 1 || (joinSessionId !== undefined && sessions[0].id !== joinSessionId)) return { changed: false, prospectId: null };
  const session = sessions[0];
  const validDate = (date: Date | null): date is Date => date instanceof Date && Number.isFinite(date.getTime());
  if (session.membershipType === "team_member" || !session.consentConfirmed || !Number(session.hasSigner) || !Number(session.hasSnapshot) || !Number(session.hasSignature) ||
    !/^[a-f0-9]{64}$/i.test(session.contractHash ?? "") || !validDate(session.contractSignedAt) || !validDate(session.joiningFeePaidAt)) return { changed: false, prospectId: null };
  hasManualJoiningFeeReceipt(session); // Non-null malformed/stale external evidence must fail closed.
  const email = session.email.trim().toLowerCase();
  const matches = await db.select({ id: recruitmentProspects.id, pipelineStage: recruitmentProspects.pipelineStage }).from(recruitmentProspects)
    .where(and(sql`LOWER(TRIM(${recruitmentProspects.email})) = ${email}`, notSupersededRecruitmentProspect())).limit(2);
  if (matches.length > 1) throw new TRPCError({ code: "CONFLICT", message: "Multiple enquiries use this checkout email. Staff must explicitly link the completed signup." });
  const prospect = matches[0];
  if (!prospect || ["won", "archived", "ar_declined", "onboarding_declined", "waitlisted"].includes(prospect.pipelineStage)) return { changed: false, prospectId: prospect?.id ?? null };
  await moveRecruitmentProspectStage({ prospectId: prospect.id, toStage: "won", changedByName: "System (completed signup)", note: `Completed signed signup #${session.id}, joining fee recorded; agent account #${userId}.` });
  return { changed: true, prospectId: prospect.id };
}
