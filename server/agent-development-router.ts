import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, lt, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { shouldAwardActionMomentum, validateActionMomentumConfiguration } from "@shared/momentum-policy";
import { router, protectedProcedure } from "./_core/trpc";
import { createInAppNotification, getDb, getRawDbPool } from "./db";
import { sendDirectEmail } from "./email";
import { storagePut } from "./storage";
import { awardMomentum, getMomentumRule } from "./momentum";
import {
  academyActionAssignments,
  academyActionPlans,
  academyActionPlanTargets,
  academyCourses,
  academyEnrollments,
  academyModules,
  agentCrmNotes,
  agentCrmProfiles,
  agentEngagementCases,
  agentEngagementInteractions,
  users,
} from "../drizzle/schema";
import { acceleratorWeekActionDueAt, acceleratorWeekReleaseAt } from "./academy-journey";
import { dispatchAcademyEmailAlerts } from "./academy-email-alerts";

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

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[character] ?? character));
}

function formatActionDueDate(value: Date | null) {
  if (!value) return "No deadline has been set";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Europe/London",
    timeZoneName: "short",
  }).format(new Date(value));
}

async function sendAcademyActionEmail(params: {
  agent: { id: number; email: string | null; name: string | null };
  plan: { id: number; title: string; dueAt: Date | null };
  assignmentDueAt?: Date | null;
  reminder?: boolean;
}) {
  if (!params.agent.email) return { success: false, skipped: true } as const;
  const safeTitle = escapeHtml(params.plan.title);
  const greetingName = escapeHtml(params.agent.name ?? "there");
  const dueDate = escapeHtml(formatActionDueDate(params.assignmentDueAt ?? params.plan.dueAt));
  const isReminder = params.reminder === true;
  try {
    const result = await sendDirectEmail({
      toEmail: params.agent.email,
      toName: params.agent.name ?? "Agent",
      userId: params.agent.id,
      triggerKey: isReminder ? `academy_action_reminder_${params.plan.id}` : `academy_action_assigned_${params.plan.id}`,
      subject: isReminder ? `Reminder: Academy action — ${params.plan.title}` : `New Academy action: ${params.plan.title}`,
      html: `
        <p>Hi ${greetingName},</p>
        <p>${isReminder ? "This is a reminder that you still have an Academy action to complete." : "Your JLT team has assigned you a new Academy action."}</p>
        <div style="margin:20px 0;padding:16px 18px;background:#f0fffe;border-left:4px solid #70FFE8;border-radius:6px;">
          <p style="margin:0 0 6px;"><strong>${safeTitle}</strong></p>
          <p style="margin:0;color:#444;"><strong>Due:</strong> ${dueDate}</p>
        </div>
        <p>Open your Academy Actions area to read the instructions and provide any notes, link or evidence requested.</p>
        <p style="margin:24px 0;"><a href="https://portal.thejltgroup.co.uk/academy/actions" style="display:inline-block;background:#02E6D2;color:#1a1a2e;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:700;">Open Academy Actions &rarr;</a></p>
      `,
    });
    if (!result.success) console.error(`[Academy Actions] Email notification was not sent for assignment plan ${params.plan.id}: ${result.error ?? "unknown error"}`);
    return result;
  } catch (error) {
    console.error(`[Academy Actions] Email notification failed for assignment plan ${params.plan.id}:`, error);
    return { success: false, skipped: false } as const;
  }
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

async function createAssignments(params: { plan: { id: number; title: string; dueAt: Date | null }; agentIds: number[]; actorId: number; dueAt?: Date | null }) {
  const db = await getDb();
  if (!db || !params.agentIds.length) return { created: 0 };
  const existing = await db.select({ agentId: academyActionAssignments.agentId })
    .from(academyActionAssignments)
    .where(and(eq(academyActionAssignments.planId, params.plan.id), inArray(academyActionAssignments.agentId, params.agentIds)));
  const existingIds = new Set(existing.map((item) => item.agentId));
  const targetIds = params.agentIds.filter((id) => !existingIds.has(id));
  if (!targetIds.length) return { created: 0 };
  const pool = await getRawDbPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  await pool.execute(
    `INSERT INTO academy_action_assignments (planId, agentId, dueAt) VALUES ${targetIds.map(() => "(?, ?, ?)").join(", ")}`,
    targetIds.flatMap((agentId) => [params.plan.id, agentId, params.dueAt ?? params.plan.dueAt]),
  );
  const recipients = await db.select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(inArray(users.id, targetIds));
  const recipientsById = new Map(recipients.map((recipient) => [recipient.id, recipient]));
  await Promise.all(targetIds.map(async (agentId) => {
    await createInAppNotification({
      userId: agentId,
      message: "You have a new Academy action to complete.",
      linkUrl: "/academy/actions",
      isUrgent: true,
    });
    const recipient = recipientsById.get(agentId);
    if (recipient) await sendAcademyActionEmail({ agent: recipient, plan: params.plan, assignmentDueAt: params.dueAt });
  }));
  return { created: targetIds.length };
}

async function publishPlan(planId: number, actorId: number, options: { publishNow?: boolean } = {}) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [plan] = await db.select().from(academyActionPlans).where(eq(academyActionPlans.id, planId)).limit(1);
  if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "Academy action plan not found" });
  if (plan.status === "archived") throw new TRPCError({ code: "BAD_REQUEST", message: "Archived actions cannot be published" });
  const now = new Date();
  if (plan.status === "scheduled" && plan.publishAt && plan.publishAt > now && !options.publishNow) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `This Action is scheduled for ${formatActionDueDate(plan.publishAt)}. Keep its schedule or use the explicit Publish now control.`,
    });
  }
  const explicit = await db.select({ agentId: academyActionPlanTargets.agentId }).from(academyActionPlanTargets).where(eq(academyActionPlanTargets.planId, plan.id));
  // Course-linked Accelerator actions publish as a reusable week template. They
  // are assigned only by releaseAvailableJourneyActions when each individual
  // learner reaches that week, never to the whole Accelerator audience at once.
  const agentIds = plan.courseId && plan.courseWeek ? [] : await getEligibleAgentIds(plan as any, explicit.map((row) => row.agentId));
  const assignmentResult = await createAssignments({ plan, agentIds, actorId });
  const pool = await getRawDbPool();
  await pool.execute(
    "UPDATE academy_action_plans SET status = ?, publishedAt = ?, publishedById = ? WHERE id = ?",
    ["published", now, plan.publishedById ?? actorId, plan.id],
  );
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
  for (const plan of plans) assigned += (await createAssignments({ plan, agentIds: [agentId], actorId })).created;
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

/**
 * Materialises only the weekly work that has reached its own learner-specific
 * Friday release time. It is safe to call from the Heartbeat task and on
 * Academy reads: the Action unique key and email-delivery keys prevent replay.
 */
export async function releaseAvailableJourneyActions(now = new Date()) {
  const db = await getDb();
  if (!db) return { releasedWeeks: 0, assignments: 0, alerts: 0 };
  const journeys = await db.select({ enrollment: academyEnrollments, course: academyCourses, agent: users })
    .from(academyEnrollments)
    .innerJoin(academyCourses, eq(academyCourses.id, academyEnrollments.courseId))
    .innerJoin(users, eq(users.id, academyEnrollments.agentId))
    .where(and(
      eq(academyCourses.isAcceleratorJourney, true),
      eq(academyCourses.status, "published"),
      ne(academyEnrollments.status, "completed"),
      ne(academyEnrollments.status, "waived"),
    ));
  let releasedWeeks = 0;
  let assignments = 0;
  let alerts = 0;
  for (const { enrollment, course, agent } of journeys) {
    if (!enrollment.journeyStartedAt) continue;
    const modules = await db.select().from(academyModules).where(eq(academyModules.courseId, course.id));
    const plans = await db.select().from(academyActionPlans).where(and(
      eq(academyActionPlans.courseId, course.id),
      eq(academyActionPlans.status, "published"),
    ));
    for (let week = 1; week <= 8; week++) {
      const releaseAt = acceleratorWeekReleaseAt(enrollment.journeyStartedAt, week);
      if (releaseAt > now) continue;
      const weekModules = modules.filter((module) => Number(module.releaseWeek) === week);
      const hasPreviouslyReleasedWeek = weekModules.some(() => true);
      if (!hasPreviouslyReleasedWeek) continue;
      const weekPlans = plans.filter((plan) => Number(plan.courseWeek) === week);
      for (const plan of weekPlans) {
        assignments += (await createAssignments({
          plan,
          agentIds: [agent.id],
          actorId: plan.createdById,
          dueAt: acceleratorWeekActionDueAt(enrollment.journeyStartedAt, week),
        })).created;
      }
      const releaseResults = await Promise.all(weekModules.map((module) => dispatchAcademyEmailAlerts({
        eventType: "week_released",
        eventKey: `week-released-${week}`,
        enrollmentId: enrollment.id,
        courseId: course.id,
        courseTitle: course.title,
        moduleId: module.id,
        moduleTitle: module.title,
        agentId: agent.id,
        agentName: agent.name,
        agentEmail: agent.email,
      })));
      alerts += releaseResults.reduce((total, result) => total + result.sent, 0);
      releasedWeeks += 1;
    }
  }
  return { releasedWeeks, assignments, alerts };
}

/** Sends configured support/bespoke alerts once when a course-week Action is overdue. */
export async function sendOverdueJourneyActionAlerts(now = new Date()) {
  const db = await getDb();
  if (!db) return { alerts: 0 };
  const rows = await db.select({ assignment: academyActionAssignments, plan: academyActionPlans, enrollment: academyEnrollments, course: academyCourses, agent: users })
    .from(academyActionAssignments)
    .innerJoin(academyActionPlans, eq(academyActionPlans.id, academyActionAssignments.planId))
    .innerJoin(academyEnrollments, and(eq(academyEnrollments.agentId, academyActionAssignments.agentId), eq(academyEnrollments.courseId, academyActionPlans.courseId)))
    .innerJoin(academyCourses, eq(academyCourses.id, academyActionPlans.courseId))
    .innerJoin(users, eq(users.id, academyActionAssignments.agentId))
    .where(and(
      eq(academyCourses.isAcceleratorJourney, true),
      lte(academyActionAssignments.dueAt, now),
      inArray(academyActionAssignments.status, ["assigned", "needs_revision"]),
    ));
  let alerts = 0;
  for (const { assignment, plan, enrollment, course, agent } of rows) {
    const result = await dispatchAcademyEmailAlerts({
      eventType: "action_overdue",
      eventKey: `action-overdue-${assignment.id}`,
      enrollmentId: enrollment.id,
      courseId: course.id,
      courseTitle: course.title,
      agentId: agent.id,
      agentName: agent.name,
      agentEmail: agent.email,
      actionTitle: plan.title,
      dueDate: assignment.dueAt,
    });
    alerts += result.sent;
  }
  return { alerts };
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
        isOverdue: !!(row.assignment.dueAt ?? row.plan.dueAt) && !["completed"].includes(row.assignment.status) && new Date(row.assignment.dueAt ?? row.plan.dueAt!) < now,
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
      const pool = await getRawDbPool();
      await pool.execute(
        `UPDATE academy_action_assignments
         SET status = ?, completionNote = ?, evidenceUrl = ?, evidenceFileUrl = ?,
             evidenceFileKey = ?, evidenceFileName = ?, submittedAt = ?, completedAt = ?
         WHERE id = ?`,
        [
          status, note, url, fileUrl, optionalText(input.evidence.fileKey), optionalText(input.evidence.fileName),
          now, status === "completed" ? now : null, row.assignment.id,
        ],
      );
      if (shouldAwardActionMomentum({ assignmentStatus: status, momentumAwardMode: row.plan.momentumAwardMode, completionPath: "self_declared", momentumPoints: row.plan.momentumPoints })) {
        const masterRule = await getMomentumRule("accountability_action");
        if (masterRule?.enabled) {
          await awardMomentum({
            agentId: ctx.user.id,
            ruleKey: "accountability_action",
            sourceType: "academy_action_assignment",
            sourceId: row.assignment.id,
            sourceLabel: row.plan.title,
            pointsOverride: row.plan.momentumPoints,
          });
        }
      }
      await createInAppNotification({ userId: ctx.user.id, message: status === "completed" ? "Academy action marked complete. Great work." : "Academy action submitted for review.", linkUrl: "/academy/actions", isUrgent: false });
      if (status === "review" && row.plan.courseId) {
        const [enrollment] = await db.select().from(academyEnrollments).where(and(
          eq(academyEnrollments.agentId, ctx.user.id),
          eq(academyEnrollments.courseId, row.plan.courseId),
        )).limit(1);
        const [course] = await db.select().from(academyCourses).where(eq(academyCourses.id, row.plan.courseId)).limit(1);
        if (enrollment && course) {
          void dispatchAcademyEmailAlerts({
            eventType: "action_submitted_for_review",
            eventKey: `action-submitted-${row.assignment.id}`,
            enrollmentId: enrollment.id,
            courseId: course.id,
            courseTitle: course.title,
            agentId: ctx.user.id,
            agentName: ctx.user.name,
            agentEmail: ctx.user.email,
            actionTitle: row.plan.title,
            dueDate: row.assignment.dueAt ?? row.plan.dueAt,
          }).catch((error) => console.error("[Academy Actions] Course alert dispatch failed:", error));
        }
      }
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
      courseId: z.number().int().positive().nullable().optional(),
      courseWeek: z.number().int().min(1).max(8).nullable().optional(),
      requiresNote: z.boolean().default(true),
      requiresUrl: z.boolean().default(false),
      requiresUpload: z.boolean().default(false),
      staffReviewRequired: z.boolean().default(false),
      momentumAwardMode: z.enum(["off", "self_declared_completion", "reviewed_completion"]).default("off"),
      momentumPoints: z.number().int().min(0).max(1_000).default(0),
      targetAgentIds: z.array(z.number().int().positive()).max(2_000).default([]),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const targetAgentIds = Array.from(new Set(input.targetAgentIds));
      if (input.audience === "selected_agents" && !targetAgentIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose at least one agent for a selected-agent action" });
      if (input.assignmentTrigger === "on_accelerator_entry" && input.audience !== "agent_accelerator") throw new TRPCError({ code: "BAD_REQUEST", message: "Entry actions can only target Agent Accelerator" });
      const isJourneyAction = !!input.courseId || !!input.courseWeek;
      if (isJourneyAction && (!input.courseId || !input.courseWeek)) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose both an Accelerator journey course and a week" });
      if (isJourneyAction) {
        if (input.audience !== "agent_accelerator") throw new TRPCError({ code: "BAD_REQUEST", message: "Course-week actions can only target Agent Accelerator" });
        const [course] = await db.select().from(academyCourses).where(eq(academyCourses.id, input.courseId!)).limit(1);
        if (!course?.isAcceleratorJourney) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a course marked as an Agent Accelerator journey" });
      }
      if (input.actionType === "weekly" && !isJourneyAction && (!input.publishAt || !input.dueAt)) throw new TRPCError({ code: "BAD_REQUEST", message: "Weekly actions need a publish date and deadline, unless they are linked to an Accelerator course week" });
      if (input.publishAt && input.dueAt && input.dueAt < input.publishAt) throw new TRPCError({ code: "BAD_REQUEST", message: "The deadline must be after the publish date" });
      const momentumConfigurationError = validateActionMomentumConfiguration(input);
      if (momentumConfigurationError) throw new TRPCError({ code: "BAD_REQUEST", message: momentumConfigurationError });
      const scheduledStatus = !isJourneyAction && input.publishAt && input.publishAt > new Date() && input.assignmentTrigger !== "on_accelerator_entry" ? "scheduled" : "draft";
      const payload = {
        title: input.title,
        instructions: input.instructions,
        actionType: input.actionType,
        audience: input.audience,
        assignmentTrigger: input.assignmentTrigger,
        publishAt: input.publishAt ?? null,
        dueAt: input.dueAt ?? null,
        courseId: input.courseId ?? null,
        courseWeek: input.courseWeek ?? null,
        requiresNote: input.requiresNote,
        requiresUrl: input.requiresUrl,
        requiresUpload: input.requiresUpload,
        staffReviewRequired: input.staffReviewRequired,
        momentumAwardMode: input.momentumAwardMode,
        momentumPoints: input.momentumAwardMode === "off" ? 0 : input.momentumPoints,
        status: scheduledStatus,
        updatedById: ctx.user.id,
      };
      let planId = input.id;
      const pool = await getRawDbPool();
      if (planId) {
        const [plan] = await db.select().from(academyActionPlans).where(eq(academyActionPlans.id, planId)).limit(1);
        if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "Academy action plan not found" });
        if (plan.status === "published") throw new TRPCError({ code: "BAD_REQUEST", message: "Create a new plan instead of changing an action already assigned to agents" });
        await pool.execute(
          `UPDATE academy_action_plans
           SET title = ?, instructions = ?, actionType = ?, audience = ?, assignmentTrigger = ?, status = ?,
               publishAt = ?, dueAt = ?, courseId = ?, courseWeek = ?, requiresNote = ?, requiresUrl = ?, requiresUpload = ?,
               staffReviewRequired = ?, momentumAwardMode = ?, momentumPoints = ?, updatedById = ?
           WHERE id = ?`,
          [
            payload.title, payload.instructions, payload.actionType, payload.audience, payload.assignmentTrigger, payload.status,
            payload.publishAt, payload.dueAt, payload.courseId, payload.courseWeek, payload.requiresNote, payload.requiresUrl, payload.requiresUpload,
            payload.staffReviewRequired, payload.momentumAwardMode, payload.momentumPoints, payload.updatedById, planId,
          ],
        );
        await pool.execute("DELETE FROM academy_action_plan_targets WHERE planId = ?", [planId]);
      } else {
        const [result] = await pool.execute(
          `INSERT INTO academy_action_plans (
            title, instructions, actionType, audience, assignmentTrigger, status,
            publishAt, dueAt, courseId, courseWeek, requiresNote, requiresUrl, requiresUpload, staffReviewRequired,
            momentumAwardMode, momentumPoints, createdById, updatedById
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            payload.title, payload.instructions, payload.actionType, payload.audience, payload.assignmentTrigger, payload.status,
            payload.publishAt, payload.dueAt, payload.courseId, payload.courseWeek, payload.requiresNote, payload.requiresUrl, payload.requiresUpload,
            payload.staffReviewRequired, payload.momentumAwardMode, payload.momentumPoints, ctx.user.id, payload.updatedById,
          ],
        );
        planId = Number((result as any).insertId);
      }
      if (input.audience === "selected_agents" && targetAgentIds.length) {
        await pool.execute(
          `INSERT INTO academy_action_plan_targets (planId, agentId) VALUES ${targetAgentIds.map(() => "(?, ?)").join(", ")}`,
          targetAgentIds.flatMap((agentId) => [planId!, agentId]),
        );
      }
      return { id: planId };
    }),

    publishActionPlan: adminProcedure.input(z.object({ planId: z.number().int().positive(), publishNow: z.boolean().optional().default(false) })).mutation(async ({ ctx, input }) => publishPlan(input.planId, ctx.user.id, { publishNow: input.publishNow })),

    archiveActionPlan: adminProcedure.input(z.object({ planId: z.number().int().positive() })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const pool = await getRawDbPool();
      await pool.execute("UPDATE academy_action_plans SET status = ? WHERE id = ?", ["archived", input.planId]);
      return { success: true };
    }),

    actionAssignments: adminProcedure.input(z.object({ planId: z.number().int().positive() })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return db.select({ assignment: academyActionAssignments, agent: users })
        .from(academyActionAssignments).innerJoin(users, eq(users.id, academyActionAssignments.agentId))
        .where(eq(academyActionAssignments.planId, input.planId)).orderBy(asc(users.name));
    }),

    remindActionPlanAgents: adminProcedure.input(z.object({ planId: z.number().int().positive() })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [plan] = await db.select().from(academyActionPlans).where(eq(academyActionPlans.id, input.planId)).limit(1);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "Academy action plan not found" });
      if (plan.status !== "published") throw new TRPCError({ code: "BAD_REQUEST", message: "Only published actions can be reminded" });
      const rows = await db.select({ assignment: academyActionAssignments, agent: users })
        .from(academyActionAssignments)
        .innerJoin(users, eq(users.id, academyActionAssignments.agentId))
        .where(eq(academyActionAssignments.planId, plan.id));
      const outstanding = rows.filter((row) => ["assigned", "needs_revision"].includes(row.assignment.status));
      let sent = 0;
      await Promise.all(outstanding.map(async ({ agent, assignment }) => {
        await createInAppNotification({
          userId: agent.id,
          message: `Reminder: your Academy action “${plan.title}” still needs your attention.`,
          linkUrl: "/academy/actions",
          isUrgent: true,
        });
        const outcome = await sendAcademyActionEmail({ agent, plan, assignmentDueAt: assignment.dueAt, reminder: true });
        if (outcome.success) sent += 1;
      }));
      return { recipients: outstanding.length, sent };
    }),

    reviewAction: adminProcedure.input(z.object({ assignmentId: z.number().int().positive(), outcome: z.enum(["completed", "needs_revision"]), feedback: z.string().trim().max(10_000).nullable().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [row] = await db.select({ assignment: academyActionAssignments, plan: academyActionPlans })
        .from(academyActionAssignments)
        .innerJoin(academyActionPlans, eq(academyActionPlans.id, academyActionAssignments.planId))
        .where(eq(academyActionAssignments.id, input.assignmentId)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Action assignment not found" });
      if (row.assignment.status !== "review") throw new TRPCError({ code: "BAD_REQUEST", message: "Only an action awaiting review can be approved or returned" });
      const now = new Date();
      const pool = await getRawDbPool();
      await pool.execute(
        "UPDATE academy_action_assignments SET status = ?, reviewerFeedback = ?, reviewedAt = ?, reviewedById = ?, completedAt = ? WHERE id = ?",
        [input.outcome, optionalText(input.feedback), now, ctx.user.id, input.outcome === "completed" ? now : null, row.assignment.id],
      );
      if (shouldAwardActionMomentum({ assignmentStatus: input.outcome, momentumAwardMode: row.plan.momentumAwardMode, completionPath: "reviewed", momentumPoints: row.plan.momentumPoints })) {
        const masterRule = await getMomentumRule("accountability_action");
        if (masterRule?.enabled) {
          await awardMomentum({
            agentId: row.assignment.agentId,
            ruleKey: "accountability_action",
            sourceType: "academy_action_assignment",
            sourceId: row.assignment.id,
            sourceLabel: row.plan.title,
            pointsOverride: row.plan.momentumPoints,
          });
        }
      }
      await createInAppNotification({
        userId: row.assignment.agentId,
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
      const pool = await getRawDbPool();
      const [agentRows] = await pool.execute(
        "SELECT id, role, name FROM users WHERE id = ? LIMIT 1",
        [input.agentId],
      );
      const agent = (agentRows as Array<{ id: number; role: string; name: string | null }>)[0];
      if (!agent || agent.role !== "agent") throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      const [existingRows] = await pool.execute(
        "SELECT id FROM agent_engagement_cases WHERE agentId = ? AND status <> ? LIMIT 1",
        [input.agentId, "closed"],
      );
      const existing = (existingRows as Array<{ id: number }>)[0];
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "This agent already has an active engagement case" });
      const [result] = await pool.execute(
        "INSERT INTO agent_engagement_cases (agentId, riskReason, ownerId, openedById, nextFollowUpAt) VALUES (?, ?, ?, ?, ?)",
        [input.agentId, input.riskReason, input.ownerId ?? ctx.user.id, ctx.user.id, input.nextFollowUpAt ?? null],
      );
      const id = Number((result as any).insertId);
      await pool.execute(
        "INSERT INTO agent_crm_notes (agentUserId, authorId, authorName, content) VALUES (?, ?, ?, ?)",
        [input.agentId, ctx.user.id, ctx.user.name ?? "Admin", `[Engagement opened] ${input.riskReason}`],
      );
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
      const pool = await getRawDbPool();
      await pool.execute(
        `INSERT INTO agent_engagement_interactions
         (caseId, agentId, createdById, channel, summary, outcome, occurredAt, nextFollowUpAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [caseRecord.id, caseRecord.agentId, ctx.user.id, input.channel, input.summary, optionalText(input.outcome), now, input.nextFollowUpAt ?? null],
      );
      await pool.execute(
        `UPDATE agent_engagement_cases
         SET status = ?, lastContactAt = ?, nextFollowUpAt = ?, outcome = ?, closedAt = ?, closedById = ?
         WHERE id = ?`,
        [
          input.status, now, input.status === "closed" ? null : (input.nextFollowUpAt ?? null), optionalText(input.outcome),
          input.status === "closed" ? now : null, input.status === "closed" ? ctx.user.id : null, caseRecord.id,
        ],
      );
      await pool.execute(
        "INSERT INTO agent_crm_notes (agentUserId, authorId, authorName, content) VALUES (?, ?, ?, ?)",
        [caseRecord.agentId, ctx.user.id, ctx.user.name ?? "Admin", `[Engagement · ${input.channel}] ${input.summary}${input.outcome ? `\nOutcome: ${input.outcome}` : ""}${input.nextFollowUpAt ? `\nNext follow-up: ${input.nextFollowUpAt.toLocaleDateString("en-GB")}` : ""}`],
      );
      return { success: true };
    }),

    updateEngagementCase: adminProcedure.input(z.object({ caseId: z.number().int().positive(), status: z.enum(["active", "waiting", "monitoring", "closed"]), ownerId: z.number().int().positive().nullable().optional(), nextFollowUpAt: z.date().nullable().optional(), riskReason: z.string().trim().min(3).max(10_000).optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [caseRecord] = await db.select().from(agentEngagementCases).where(eq(agentEngagementCases.id, input.caseId)).limit(1);
      if (!caseRecord) throw new TRPCError({ code: "NOT_FOUND", message: "Engagement case not found" });
      const now = new Date();
      const pool = await getRawDbPool();
      await pool.execute(
        `UPDATE agent_engagement_cases
         SET status = ?, ownerId = ?, nextFollowUpAt = ?, riskReason = ?, closedAt = ?, closedById = ?
         WHERE id = ?`,
        [
          input.status, input.ownerId ?? caseRecord.ownerId, input.status === "closed" ? null : (input.nextFollowUpAt ?? caseRecord.nextFollowUpAt),
          input.riskReason ?? caseRecord.riskReason, input.status === "closed" ? now : null,
          input.status === "closed" ? ctx.user.id : null, caseRecord.id,
        ],
      );
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
