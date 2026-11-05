import { TRPCError } from "@trpc/server";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { academyActionPlans, agentCrmProfiles, users, type User } from "../drizzle/schema";
import { getDb } from "./db";
import { getArchivedAgentMergeIds } from "./agent-merge-identity";
import { isFullAdmin } from "./staff-access";

export const staffLearnerColumns = { id: users.id, name: users.name };
export const staffTeachingProfileColumns = { trainingStage: agentCrmProfiles.trainingStage };

/** Keep the existing administrator RPC type contract; restricted runtime DTOs
 * contain only these explicitly selected columns, never a complete user/profile.
 * Callers must not assume admin-only fields exist in the staff workspace. */
export function engagementIdentityColumns(user: User): typeof users {
  return isFullAdmin(user) ? users : staffLearnerColumns as unknown as typeof users;
}
export function engagementTeachingColumns(user: User): typeof agentCrmProfiles {
  return isFullAdmin(user) ? agentCrmProfiles : staffTeachingProfileColumns as unknown as typeof agentCrmProfiles;
}
export function engagementIdentityDto<T extends { id: number; name: string | null }>(user: User, value: T): T {
  return isFullAdmin(user) ? value : { id: value.id, name: value.name } as T;
}
export function engagementTeachingDto<T extends { trainingStage: string | null }>(user: User, value: T | null): T | null {
  return isFullAdmin(user) || !value ? value : { trainingStage: value.trainingStage } as T;
}

/** A scope predicate shared by every restricted list and object-ID operation. */
export async function currentEngagementAgentFilter() {
  const archivedIds = await getArchivedAgentMergeIds();
  return and(
    eq(users.role, "agent"), eq(users.isActive, true), eq(users.portalStatus, "active"),
    archivedIds.length ? notInArray(users.id, archivedIds) : undefined,
    sql`NOT EXISTS (SELECT 1 FROM agent_crm_profiles engagement_scope_profile WHERE engagement_scope_profile.userId = ${users.id} AND COALESCE(engagement_scope_profile.agentStatus, 'active') <> 'active')`,
  )!;
}

export async function requireCurrentEngagementAgents(agentIds: number[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const filter = await currentEngagementAgentFilter();
  for (const agentId of Array.from(new Set(agentIds))) {
    const [agent] = await db.select(staffLearnerColumns).from(users).where(and(filter, eq(users.id, agentId))).limit(1);
    if (!agent) throw new TRPCError({ code: "FORBIDDEN", message: "Only current, nonarchived agents are available in the staff workspace" });
  }
}

type ActionPolicyInput = {
  courseId?: number | null;
  courseWeek?: number | null;
  assignmentTrigger: "immediate" | "on_accelerator_entry";
  actionType: "onboarding" | "weekly" | "ad_hoc";
  audience: "agent_accelerator" | "selected_agents" | "all_agents";
  staffReviewRequired?: boolean;
  momentumAwardMode?: "off" | "self_declared_completion" | "reviewed_completion";
  momentumPoints?: number;
};
type Plan = typeof academyActionPlans.$inferSelect;

/** Reward settings and journey coupling are administrator policy, not staff input.
 * Optional policy fields let a restricted editor omit them and retain configured values. */
export function applyEngagementActionPolicy<T extends ActionPolicyInput>(input: T, existing?: Plan): T & {
  staffReviewRequired: boolean;
  momentumAwardMode: Plan["momentumAwardMode"];
  momentumPoints: number;
  courseId: number | null;
  courseWeek: number | null;
} {
  const denied = () => { throw new TRPCError({ code: "FORBIDDEN", message: "Reward policy and course journey configuration require a full administrator" }); };
  if (existing) {
    if ((input.courseId !== undefined && input.courseId !== existing.courseId)
      || (input.courseWeek !== undefined && input.courseWeek !== existing.courseWeek)
      || input.assignmentTrigger !== existing.assignmentTrigger || input.actionType !== existing.actionType
      || ((existing.courseId || existing.assignmentTrigger === "on_accelerator_entry") && input.audience !== existing.audience)
      || (input.staffReviewRequired !== undefined && input.staffReviewRequired !== existing.staffReviewRequired)
      || (input.momentumAwardMode !== undefined && input.momentumAwardMode !== existing.momentumAwardMode)
      || (input.momentumPoints !== undefined && input.momentumPoints !== existing.momentumPoints)) denied();
    return { ...input, courseId: existing.courseId, courseWeek: existing.courseWeek,
      staffReviewRequired: existing.staffReviewRequired, momentumAwardMode: existing.momentumAwardMode, momentumPoints: existing.momentumPoints };
  }
  if (input.courseId || input.courseWeek || input.assignmentTrigger !== "immediate" || input.actionType !== "ad_hoc"
    || (input.momentumAwardMode !== undefined && input.momentumAwardMode !== "off") || (input.momentumPoints ?? 0) !== 0) denied();
  return { ...input, courseId: null, courseWeek: null, staffReviewRequired: input.staffReviewRequired ?? false, momentumAwardMode: "off", momentumPoints: 0 };
}

export function assertEngagementOwner(user: User, ownerId: number | null | undefined, existingOwnerId?: number | null) {
  if (!isFullAdmin(user) && ownerId != null && ownerId !== user.id && ownerId !== existingOwnerId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Staff may retain the current check-in owner or take ownership themselves" });
  }
}
