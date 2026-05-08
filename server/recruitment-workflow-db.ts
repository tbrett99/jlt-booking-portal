/**
 * DB helpers for the Recruitment Email Workflow system.
 *
 * Tables:
 *   recruitment_workflows          — one row per pipeline stage
 *   recruitment_workflow_emails    — ordered email steps per workflow
 *   recruitment_workflow_enrollments — tracks which step each prospect is on
 */
import { getDb } from "./db";
import {
  recruitmentWorkflows,
  recruitmentWorkflowEmails,
  recruitmentWorkflowEnrollments,
} from "../drizzle/schema";
import { eq, and, isNull, lte, isNotNull } from "drizzle-orm";

// ─── Workflows ────────────────────────────────────────────────────────────────

export async function listWorkflows() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(recruitmentWorkflows).orderBy(recruitmentWorkflows.id);
}

export async function getWorkflowByStage(stage: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(recruitmentWorkflows)
    .where(eq(recruitmentWorkflows.stage, stage))
    .limit(1);
  return rows[0] ?? null;
}

export async function getWorkflowById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(recruitmentWorkflows)
    .where(eq(recruitmentWorkflows.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertWorkflow(stage: string, name: string, isActive: boolean) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const existing = await getWorkflowByStage(stage);
  if (existing) {
    await db
      .update(recruitmentWorkflows)
      .set({ name, isActive })
      .where(eq(recruitmentWorkflows.id, existing.id));
    return existing.id;
  }
  const result = await db.insert(recruitmentWorkflows).values({ stage, name, isActive });
  return (result as any).insertId as number;
}

export async function setWorkflowActive(id: number, isActive: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(recruitmentWorkflows).set({ isActive }).where(eq(recruitmentWorkflows.id, id));
}

// ─── Workflow Email Steps ─────────────────────────────────────────────────────

export async function getWorkflowEmails(workflowId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(recruitmentWorkflowEmails)
    .where(eq(recruitmentWorkflowEmails.workflowId, workflowId))
    .orderBy(recruitmentWorkflowEmails.stepOrder);
}

export async function upsertWorkflowEmail(opts: {
  id?: number;
  workflowId: number;
  stepOrder: number;
  delayHours: number;
  subject: string;
  bodyHtml: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  if (opts.id) {
    await db
      .update(recruitmentWorkflowEmails)
      .set({
        stepOrder: opts.stepOrder,
        delayHours: opts.delayHours,
        subject: opts.subject,
        bodyHtml: opts.bodyHtml,
      })
      .where(eq(recruitmentWorkflowEmails.id, opts.id));
    return opts.id;
  }
  const result = await db.insert(recruitmentWorkflowEmails).values({
    workflowId: opts.workflowId,
    stepOrder: opts.stepOrder,
    delayHours: opts.delayHours,
    subject: opts.subject,
    bodyHtml: opts.bodyHtml,
  });
  return (result as any).insertId as number;
}

export async function deleteWorkflowEmail(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(recruitmentWorkflowEmails).where(eq(recruitmentWorkflowEmails.id, id));
}

export async function reorderWorkflowEmails(workflowId: number, orderedIds: number[]) {
  const db = await getDb();
  if (!db) return;
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(recruitmentWorkflowEmails)
      .set({ stepOrder: i + 1 })
      .where(
        and(
          eq(recruitmentWorkflowEmails.id, orderedIds[i]),
          eq(recruitmentWorkflowEmails.workflowId, workflowId)
        )
      );
  }
}

// ─── Enrollments ──────────────────────────────────────────────────────────────

/**
 * Enroll a prospect in the workflow for a given stage.
 * Cancels any existing active enrollments first.
 */
export async function enrollProspectInWorkflow(prospectId: number, stage: string) {
  const db = await getDb();
  if (!db) return null;
  // Cancel all existing active enrollments for this prospect
  await db
    .update(recruitmentWorkflowEnrollments)
    .set({ cancelledAt: new Date() })
    .where(
      and(
        eq(recruitmentWorkflowEnrollments.prospectId, prospectId),
        isNull(recruitmentWorkflowEnrollments.cancelledAt)
      )
    );

  // Find the workflow for this stage
  const workflow = await getWorkflowByStage(stage);
  if (!workflow || !workflow.isActive) return null;

  // Get the first email step
  const steps = await getWorkflowEmails(workflow.id);
  if (!steps.length) return null;

  const firstStep = steps[0];
  const nextSendAt = new Date(Date.now() + firstStep.delayHours * 60 * 60 * 1000);

  const result = await db.insert(recruitmentWorkflowEnrollments).values({
    prospectId,
    workflowId: workflow.id,
    currentStep: 1,
    nextSendAt,
  });
  return (result as any).insertId as number;
}

/**
 * Cancel all active enrollments for a prospect (called on stage change).
 */
export async function unenrollProspect(prospectId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(recruitmentWorkflowEnrollments)
    .set({ cancelledAt: new Date() })
    .where(
      and(
        eq(recruitmentWorkflowEnrollments.prospectId, prospectId),
        isNull(recruitmentWorkflowEnrollments.cancelledAt)
      )
    );
}

/**
 * Get all enrollments that are due to send their next email.
 * Returns enrollments where nextSendAt <= now and cancelledAt is null.
 */
export async function getDueEnrollments() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(recruitmentWorkflowEnrollments)
    .where(
      and(
        isNull(recruitmentWorkflowEnrollments.cancelledAt),
        isNotNull(recruitmentWorkflowEnrollments.nextSendAt),
        lte(recruitmentWorkflowEnrollments.nextSendAt, new Date())
      )
    );
}

/**
 * Advance an enrollment to the next step (or mark complete).
 */
export async function advanceEnrollment(enrollmentId: number, workflowId: number, nextStep: number) {
  const db = await getDb();
  if (!db) return;
  const steps = await getWorkflowEmails(workflowId);
  const nextStepData = steps.find((s: { stepOrder: number; delayHours: number }) => s.stepOrder === nextStep);

  if (!nextStepData) {
    // No more steps — mark enrollment as done by setting nextSendAt to null
    await db
      .update(recruitmentWorkflowEnrollments)
      .set({ currentStep: nextStep, nextSendAt: null })
      .where(eq(recruitmentWorkflowEnrollments.id, enrollmentId));
    return;
  }

  const nextSendAt = new Date(Date.now() + nextStepData.delayHours * 60 * 60 * 1000);
  await db
    .update(recruitmentWorkflowEnrollments)
    .set({ currentStep: nextStep, nextSendAt })
    .where(eq(recruitmentWorkflowEnrollments.id, enrollmentId));
}
