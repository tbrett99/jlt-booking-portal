import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { createInAppNotification, getDb } from "./db";
import { storagePut } from "./storage";
import {
  academyActionAssignments,
  academyActionPlans,
  academyActionPlanTargets,
  agentCrmNotes,
  agentCrmProfiles,
  agentEngagementCases,
  agentEngagementInteractions,
  users,
} from "../drizzle/schema";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

const actionStatus = z.enum(["assigned", "submitted", "review", "completed", "needs_revision"]);
const actionPlanStatus = z.enum(["draft", "scheduled", "published", "archived"]);
const audience = z.enum(["agent_accelerator", "selected_agents", "all_agents"]);
const evidence = z.object({
  note: z.string().trim().max(10_000).nullable().optional(),
  url: z.string().trim().url().max(2_000).nullable().optional(),
  fileUrl: z.string().trim().url().max(10_000).nullable().optional(),
  fileKey: z.string().trim().max(600).nullable().optional(),
  fileName: z.string().trim().max(255).nullable().optional(),
});

function optionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function getEligibleAgentIds(plan: {
  audience: "agent_accelerator" | "selected_agents" | "all_agents";
  assignmentTrigger: "immediate" | "on_accelerator_entry";
}, explicitAgentIds: number[]) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  if (plan.audience === "selected_agents") return Array.from(new Set(explicitAgentIds));

  const rows = await db.select({ id: users.id, trainingStage: agentCrmProfiles.trainingStage })
    .from(users)
    .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, users.id))
    .where(and(eq(users.role, "agent"), eq(users.isActive, true), eq(users.portalStatus, "active")));
  if (plan.audience === "all_agents") return rows.map((row) => row.id);

  const acceleratorIds = rows.filter((row) => row.trainingStage === "Agent Accelerator").map((row) => row.id);
  if (plan.assignmentTrigger === "on_accelerator_entry") return acceleratorIds;

  // Agents who have not yet received an entry task are legacy Accelerator members
  // and can join a weekly plan. New Accelerator agents must complete their entry
  // action first, so they never land on a stack of weekly actions at once.
  const entryAssignments = acceleratorIds.length
    ? await db.select({ agentId: academyActionAssignments.agentId, status: academyActionAssignments.status })
      .from(academyActionAssignments)
      .innerJoin(academyActionPlans, eq(academyActionPlans.id, academyActionAssignments.planId))
      .where(and(
        inArray(academyActionAssignments.agentId, acceleratorIds),
        eq(academyActionPlans.assignmentTrigger, "on_accelerator_entry"),
      ))
    : [];
  const byAgent = new Map<number, string[]>();
  for (const item of entryAssignments) byAgent.set(item.agentId, [...(byAgent.get(item.agentId) ?? []), item.status]);
  return acceleratorIds.filter((agentId) => {
    const statuses = byAgent.get(agentId) ?? [];
    return !statuses.length || statuses.some((status) => status === "completed");
  });
}

async function createAssignments(params: { planId: number; agentIds: number[]; actorId: number }) {
  const db = await getDb();
  if (!db || !params.agentIds.length) return { created: 0 };
  const existing = await db.select({ agentId: academyActionAssignments.agentId })
    .from(academyActionAssignments)
    .where(and(eq(academyActionAssignments.planId, params.planId), inArray(academyActionAssignments.agentId, params.agentIds)));
  const existingIds = new Set(existing.map((item) => item.agentId));
  const targetIds = params.agentIds.filter((id) => !existingIds.has(id));
  if (!targetIds.length) return { created: 0 };
  await db.insert(academyActionAssignments).values(targetIds.map((agentId) => ({ planId: params.planId, agentId })) as any);
  await Promise.all(targetIds.map(async (agentId) => {
    await createInAppNotification({
      userId: agentId,
      message: "You have a new Academy action to complete.",
      linkUrl: "/academy/actions",
      isUrgent: true,
    });
  }));
  return { created: targetIds.length };
}

async function publishPlan(planId: number, actorId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [plan] = await db.select().from(academyActionPlans).where(eq(academyActionPlans.id, planId)).limit(1);
  if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "Academy action plan not found" });
  if (plan.status === "archived") throw new TRPCError({ code: "BAD_REQUEST", message: "Archived actions cannot be published" });
  const explicit = await db.select({ agentId: academyActionPlanTargets.agentId }).from(academyActionPlanTargets).where(eq(academyActionPlanTargets.planId, plan.id));
  const agentIds = await getEligibleAgentIds(plan as any, explicit.map((row) => row.agentId));
  const assignmentResult = await createAssignments({ planId: plan.id, agentIds, actorId });
  const now = new Date();
  await db.update(academyActionPlans).set({ status: "published", publishedAt: plan.publishedAt ?? now, publishedById: plan.publishedById ?? actorId }).where(eq(academyActionPlans.id, plan.id));
  return { created: assignmentResult.created, plan: { ...plan, status: "published" as const } };
}

// Called by the Academy completion workflow. Only plans explicitly marked as an
// Accelerator entry action are assigned here; weekly tasks are never backfilled.
export async function assignAcceleratorEntryActions(agentId: number, actorId: number) {
  const db = await getDb();
  if (!db) return { assigned: 0 };
  const plans = await db.select().from(academyActionPlans).where(and(
    eq(academyActionPlans.status, "published"),
    eq(academyActionPlans.audience, "agent_accelerator"),
    eq(academyActionPlans.assignmentTrigger, "on_accelerator_entry"),
  ));
  let assigned = 0;
  for (const plan of plans) assigned += (await createAssignments({ planId: plan.id, agentIds: [agentId], actorId })).created;
  return { assigned };
}

export async function publishScheduledAcademyActionPlans() {
  const db = await getDb();
  if (!db) return { published: 0, assignments: 0 };
  const now = new Date();
  const plans = await db.select().from(academyActionPlans).where(and(
    eq(academyActionPlans.status, "scheduled"),
    lte(academyActionPlans.publishAt, now),
  ));
  let assignments = 0;
  for (const plan of plans) assignments += (await publishPlan(plan.id, plan.createdById)).created;
  return { published: plans.length, assignments };
}

export const agentDevelopmentRouter = router({
  actions: router({
    mine: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await db.select({ assignment: academyActionAssignments, plan: academyActionPlans })
        .from(academyActionAssignments)
        .innerJoin(academyActionPlans, eq(academyActionPlans.id, academyActionAssignments.planId))
        .where(and(eq(academyActionAssignments.agentId, ctx.user.id), eq(academyActionPlans.status, "published")))
        .orderBy(asc(academyActionPlans.dueAt), desc(academyActionPlans.publishedAt));
      const now = new Date();
      return rows.map((row) => ({
        ...row,
        isOverdue: !!row.plan.dueAt && !["completed"].includes(row.assignment.status) && new Date(row.plan.dueAt) < now,
      }));
    }),

    uploadEvidence: protectedProcedure.input(z.object({
      fileName: z.string().trim().min(1).max(255),
      fileBase64: z.string().min(1).max(20_000_000),
      mimeType: z.enum(["application/pdf", "image/jpeg", "image/jpg", "image/png"]),
    })).mutation(async ({ ctx, input }) => {
      const bytes = Buffer.from(input.fileBase64, "base64");
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "Evidence files must be under 10 MB" });
      const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "action-evidence";
      const stored = await storagePut(`academy/actions/${ctx.user.id}/${Date.now()}-${safeName}`, bytes, input.mimeType);
      return { url: stored.url, key: stored.key, name: input.fileName };
    }),

    submit: protectedProcedure.input(z.object({ assignmentId: z.number().int().positive(), evidence })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [row] = await db.select({ assignment: academyActionAssignments, plan: academyActionPlans })
        .from(academyActionAssignments).innerJoin(academyActionPlans, eq(academyActionPlans.id, academyActionAssignments.planId))
        .where(and(eq(academyActionAssignments.id, input.assignmentId), eq(academyActionAssignments.agentId, ctx.user.id))).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Academy action not found" });
      if (row.assignment.status === "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "This action is already complete" });
      const note = optionalText(input.evidence.note);
      const url = optionalText(input.evidence.url);
      const fileUrl = optionalText(input.evidence.fileUrl);
      if (row.plan.requiresNote && !note) throw new TRPCError({ code: "BAD_REQUEST", message: "Add your completion notes before submitting" });
      if (row.plan.requiresUrl && !url) throw new TRPCError({ code: "BAD_REQUEST", message: "Add the requested URL before submitting" });
      if (row.plan.requiresUpload && !fileUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "Upload the requested evidence before submitting" });
      const now = new Date();
      const status = row.plan.staffReviewRequired ? "review" : "completed";
      await db.update(academyActionAssignments).set({
        status,
        completionNote: note,
        evidenceUrl: url,
        evidenceFileUrl: fileUrl,
        evidenceFileKey: optionalText(input.evidence.fileKey),
        evidenceFileName: optionalText(input.evidence.fileName),
        submittedAt: now,
        completedAt: status === "completed" ? now : null,
      } as any).where(eq(academyActionAssignments.id, row.assignment.id));
      await createInAppNotification({ userId: ctx.user.id, message: status === "completed" ? "Academy action marked complete. Great work." : "Academy action submitted for review.", linkUrl: "/academy/actions", isUrgent: false });
      return { status };
    }),
  }),

  admin: router({
    actionPlans: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const plans = await db.select().from(academyActionPlans).orderBy(desc(academyActionPlans.createdAt));
      const planIds = plans.map((plan) => plan.id);
      const assignments = planIds.length ? await db.select().from(academyActionAssignments).where(inArray(academyActionAssignments.planId, planIds)) : [];
      const targets = planIds.length ? await db.select().from(academyActionPlanTargets).where(inArray(academyActionPlanTargets.planId, planIds)) : [];
      return plans.map((plan) => ({
        ...plan,
        targetAgentIds: targets.filter((target) => target.planId === plan.id).map((target) => target.agentId),
        counts: {
          assigned: assignments.filter((item) => item.planId === plan.id).length,
          completed: assignments.filter((item) => item.planId === plan.id && item.status === "completed").length,
          awaitingReview: assignments.filter((item) => item.planId === plan.id && item.status === "review").length,
        },
      }));
    }),

    saveActionPlan: adminProcedure.input(z.object({
      id: z.number().int().positive().optional(),
      title: z.string().trim().min(3).max(255),
      instructions: z.string().trim().min(3).max(20_000),
      actionType: z.enum(["onboarding", "weekly", "ad_hoc"]),
      audience,
      assignmentTrigger: z.enum(["immediate", "on_accelerator_entry"]),
      publishAt: z.date().nullable().optional(),
      dueAt: z.date().nullable().optional(),
      requiresNote: z.boolean().default(true),
      requiresUrl: z.boolean().default(false),
      requiresUpload: z.boolean().default(false),
      staffReviewRequired: z.boolean().default(false),
      targetAgentIds: z.array(z.number().int().positive()).max(2_000).default([]),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      if (input.audience === "selected_agents" && !input.targetAgentIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose at least one agent for a selected-agent action" });
      if (input.assignmentTrigger === "on_accelerator_entry" && input.audience !== "agent_accelerator") throw new TRPCError({ code: "BAD_REQUEST", message: "Entry actions can only target Agent Accelerator" });
      if (input.actionType === "weekly" && (!input.publishAt || !input.dueAt)) throw new TRPCError({ code: "BAD_REQUEST", message: "Weekly actions need a Monday publish date and Sunday deadline" });
      if (input.publishAt && input.dueAt && input.dueAt < input.publishAt) throw new TRPCError({ code: "BAD_REQUEST", message: "The deadline must be after the publish date" });
      const scheduledStatus = input.publishAt && input.publishAt > new Date() && input.assignmentTrigger !== "on_accelerator_entry" ? "scheduled" : "draft";
      const payload = {
        title: input.title,
        instructions: input.instructions,
        actionType: input.actionType,
        audience: input.audience,
        assignmentTrigger: input.assignmentTrigger,
        publishAt: input.publishAt ?? null,
        dueAt: input.dueAt ?? null,
        requiresNote: input.requiresNote,
        requiresUrl: input.requiresUrl,
        requiresUpload: input.requiresUpload,
        staffReviewRequired: input.staffReviewRequired,
        status: scheduledStatus,
        updatedById: ctx.user.id,
      };
      let planId = input.id;
      if (planId) {
        const [plan] = await db.select().from(academyActionPlans).where(eq(academyActionPlans.id, planId)).limit(1);
        if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "Academy action plan not found" });
        if (plan.status === "published") throw new TRPCError({ code: "BAD_REQUEST", message: "Create a new plan instead of changing an action already assigned to agents" });
        await db.update(academyActionPlans).set(payload as any).where(eq(academyActionPlans.id, planId));
        await db.delete(academyActionPlanTargets).where(eq(academyActionPlanTargets.planId, planId));
      } else {
        const result = await db.insert(academyActionPlans).values({ ...payload, createdById: ctx.user.id } as any);
        planId = Number((result as any).insertId);
      }
      if (input.audience === "selected_agents" && input.targetAgentIds.length) {
        await db.insert(academyActionPlanTargets).values(input.targetAgentIds.map((agentId) => ({ planId: planId!, agentId })) as any);
      }
      return { id: planId };
    }),

    publishActionPlan: adminProcedure.input(z.object({ planId: z.number().int().positive() })).mutation(async ({ ctx, input }) => publishPlan(input.planId, ctx.user.id)),

    archiveActionPlan: adminProcedure.input(z.object({ planId: z.number().int().positive() })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db.update(academyActionPlans).set({ status: "archived" }).where(eq(academyActionPlans.id, input.planId));
      return { success: true };
    }),

    actionAssignments: adminProcedure.input(z.object({ planId: z.number().int().positive() })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return db.select({ assignment: academyActionAssignments, agent: users })
        .from(academyActionAssignments).innerJoin(users, eq(users.id, academyActionAssignments.agentId))
        .where(eq(academyActionAssignments.planId, input.planId)).orderBy(asc(users.name));
    }),

    reviewAction: adminProcedure.input(z.object({ assignmentId: z.number().int().positive(), outcome: z.enum(["completed", "needs_revision"]), feedback: z.string().trim().max(10_000).nullable().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [assignment] = await db.select().from(academyActionAssignments).where(eq(academyActionAssignments.id, input.assignmentId)).limit(1);
      if (!assignment) throw new TRPCError({ code: "NOT_FOUND", message: "Action assignment not found" });
      const now = new Date();
      await db.update(academyActionAssignments).set({ status: input.outcome, reviewerFeedback: optionalText(input.feedback), reviewedAt: now, reviewedById: ctx.user.id, completedAt: input.outcome === "completed" ? now : null } as any).where(eq(academyActionAssignments.id, assignment.id));
      await createInAppNotification({
        userId: assignment.agentId,
        message: input.outcome === "completed" ? "Your Academy action has been approved." : "Your Academy action needs an update. Read the feedback and resubmit.",
        linkUrl: "/academy/actions",
        isUrgent: input.outcome === "needs_revision",
      });
      return { success: true };
    }),

    engagementCases: adminProcedure.input(z.object({ status: z.enum(["active", "waiting", "monitoring", "closed", "all"]).default("active") }).optional()).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await db.select({ case: agentEngagementCases, agent: users, profile: agentCrmProfiles })
        .from(agentEngagementCases)
        .innerJoin(users, eq(users.id, agentEngagementCases.agentId))
        .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, agentEngagementCases.agentId))
        .orderBy(asc(agentEngagementCases.nextFollowUpAt), desc(agentEngagementCases.updatedAt));
      const filtered = input?.status && input.status !== "all" ? rows.filter((row) => row.case.status === input.status) : rows;
      const caseIds = filtered.map((row) => row.case.id);
      const interactions = caseIds.length ? await db.select().from(agentEngagementInteractions).where(inArray(agentEngagementInteractions.caseId, caseIds)).orderBy(desc(agentEngagementInteractions.occurredAt)) : [];
      return filtered.map((row) => ({ ...row, latestInteraction: interactions.find((interaction) => interaction.caseId === row.case.id) ?? null }));
    }),

    createEngagementCase: adminProcedure.input(z.object({ agentId: z.number().int().positive(), riskReason: z.string().trim().min(3).max(10_000), ownerId: z.number().int().positive().nullable().optional(), nextFollowUpAt: z.date().nullable().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [agent] = await db.select({ id: users.id, role: users.role, name: users.name }).from(users).where(eq(users.id, input.agentId)).limit(1);
      if (!agent || agent.role !== "agent") throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      const [existing] = await db.select().from(agentEngagementCases).where(and(eq(agentEngagementCases.agentId, input.agentId), ne(agentEngagementCases.status, "closed"))).limit(1);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "This agent already has an active engagement case" });
      const result = await db.insert(agentEngagementCases).values({ agentId: input.agentId, riskReason: input.riskReason, ownerId: input.ownerId ?? ctx.user.id, openedById: ctx.user.id, nextFollowUpAt: input.nextFollowUpAt ?? null } as any);
      const id = Number((result as any).insertId);
      await db.insert(agentCrmNotes).values({ agentUserId: input.agentId, authorId: ctx.user.id, authorName: ctx.user.name ?? "Admin", content: `[Engagement opened] ${input.riskReason}` } as any);
      return { id };
    }),

    getEngagementCase: adminProcedure.input(z.object({ caseId: z.number().int().positive() })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [row] = await db.select({ case: agentEngagementCases, agent: users, profile: agentCrmProfiles })
        .from(agentEngagementCases).innerJoin(users, eq(users.id, agentEngagementCases.agentId)).leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, users.id))
        .where(eq(agentEngagementCases.id, input.caseId)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Engagement case not found" });
      const interactions = await db.select({ interaction: agentEngagementInteractions, staff: users })
        .from(agentEngagementInteractions).leftJoin(users, eq(users.id, agentEngagementInteractions.createdById))
        .where(eq(agentEngagementInteractions.caseId, input.caseId)).orderBy(desc(agentEngagementInteractions.occurredAt));
      return { ...row, interactions };
    }),

    logEngagementInteraction: adminProcedure.input(z.object({ caseId: z.number().int().positive(), channel: z.enum(["call", "email", "whatsapp", "meeting", "other"]), summary: z.string().trim().min(3).max(20_000), outcome: z.string().trim().max(10_000).nullable().optional(), nextFollowUpAt: z.date().nullable().optional(), status: z.enum(["active", "waiting", "monitoring", "closed"]) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [caseRecord] = await db.select().from(agentEngagementCases).where(eq(agentEngagementCases.id, input.caseId)).limit(1);
      if (!caseRecord) throw new TRPCError({ code: "NOT_FOUND", message: "Engagement case not found" });
      const now = new Date();
      await db.insert(agentEngagementInteractions).values({ caseId: caseRecord.id, agentId: caseRecord.agentId, createdById: ctx.user.id, channel: input.channel, summary: input.summary, outcome: optionalText(input.outcome), occurredAt: now, nextFollowUpAt: input.nextFollowUpAt ?? null } as any);
      await db.update(agentEngagementCases).set({ status: input.status, lastContactAt: now, nextFollowUpAt: input.status === "closed" ? null : (input.nextFollowUpAt ?? null), outcome: optionalText(input.outcome), closedAt: input.status === "closed" ? now : null, closedById: input.status === "closed" ? ctx.user.id : null } as any).where(eq(agentEngagementCases.id, caseRecord.id));
      await db.insert(agentCrmNotes).values({ agentUserId: caseRecord.agentId, authorId: ctx.user.id, authorName: ctx.user.name ?? "Admin", content: `[Engagement · ${input.channel}] ${input.summary}${input.outcome ? `\nOutcome: ${input.outcome}` : ""}${input.nextFollowUpAt ? `\nNext follow-up: ${input.nextFollowUpAt.toLocaleDateString("en-GB")}` : ""}` } as any);
      return { success: true };
    }),

    updateEngagementCase: adminProcedure.input(z.object({ caseId: z.number().int().positive(), status: z.enum(["active", "waiting", "monitoring", "closed"]), ownerId: z.number().int().positive().nullable().optional(), nextFollowUpAt: z.date().nullable().optional(), riskReason: z.string().trim().min(3).max(10_000).optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [caseRecord] = await db.select().from(agentEngagementCases).where(eq(agentEngagementCases.id, input.caseId)).limit(1);
      if (!caseRecord) throw new TRPCError({ code: "NOT_FOUND", message: "Engagement case not found" });
      const now = new Date();
      await db.update(agentEngagementCases).set({ status: input.status, ownerId: input.ownerId ?? caseRecord.ownerId, nextFollowUpAt: input.status === "closed" ? null : (input.nextFollowUpAt ?? caseRecord.nextFollowUpAt), riskReason: input.riskReason ?? caseRecord.riskReason, closedAt: input.status === "closed" ? now : null, closedById: input.status === "closed" ? ctx.user.id : null } as any).where(eq(agentEngagementCases.id, input.caseId));
      return { success: true };
    }),

    engagementForAgent: adminProcedure.input(z.object({ agentId: z.number().int().positive() })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const cases = await db.select().from(agentEngagementCases).where(eq(agentEngagementCases.agentId, input.agentId)).orderBy(desc(agentEngagementCases.openedAt));
      const ids = cases.map((item) => item.id);
      const interactions = ids.length ? await db.select().from(agentEngagementInteractions).where(inArray(agentEngagementInteractions.caseId, ids)).orderBy(desc(agentEngagementInteractions.occurredAt)) : [];
      return cases.map((caseRecord) => ({ ...caseRecord, interactions: interactions.filter((interaction) => interaction.caseId === caseRecord.id) }));
    }),
  }),
});
