/**
 * Recruitment Email Workflow tRPC router
 *
 * Admin procedures: listWorkflows, getWorkflow, saveWorkflowEmail, deleteWorkflowEmail,
 *                   toggleWorkflow, processWorkflowEmails (also called by scheduled task)
 */
import { router, protectedProcedure, publicProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  listWorkflows,
  getWorkflowByStage,
  getWorkflowById,
  upsertWorkflow,
  setWorkflowActive,
  getWorkflowEmails,
  upsertWorkflowEmail,
  deleteWorkflowEmail as dbDeleteWorkflowEmail,
  getDueEnrollments,
  advanceEnrollment,
  enrollProspectInWorkflow,
} from "./recruitment-workflow-db";
import { getRecruitmentProspectById, logRecruitmentEmail } from "./recruitment-db";
import { sendSupportEmail } from "./email";
import { PROSPECT_FROM, PROSPECT_REPLY_TO } from "./resend-email";
import { Resend } from "resend";
import { ENV } from "./_core/env";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireAdmin(ctx: { user?: { role?: string } | null }) {
  if (!ctx.user || !["admin", "super_admin"].includes(ctx.user.role ?? "")) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}

async function sendWorkflowEmail(opts: {
  toEmail: string;
  toName: string;
  subject: string;
  bodyHtml: string;
}) {
  if (!ENV.resendApiKey) {
    console.warn("[Workflow] No Resend API key — skipping email send");
    return;
  }
  const resend = new Resend(ENV.resendApiKey);
  const wrappedHtml = `
    <div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#FFF6ED;border-radius:16px;">
      ${opts.bodyHtml}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="font-size:0.75rem;color:#9ca3af;text-align:center;">
        JLT Group · <a href="mailto:jointheteam@thejltgroup.co.uk" style="color:#02E6D2;">jointheteam@thejltgroup.co.uk</a>
      </p>
    </div>`;
  await resend.emails.send({
    from: PROSPECT_FROM,
    to: [opts.toEmail],
    replyTo: PROSPECT_REPLY_TO,
    subject: opts.subject,
    html: wrappedHtml,
  });
}

// ─── Default workflow email content ──────────────────────────────────────────
// Pre-populated from the existing hardcoded stage emails.

const DEFAULT_WORKFLOW_EMAILS: Record<string, { subject: string; bodyHtml: string }[]> = {
  new_enquiry: [
    {
      subject: "Your JLT Group Prospectus is Ready!",
      bodyHtml: `<p>Hi {{firstName}},</p>
<p>Thank you for your interest in joining the JLT Group travel agency network!</p>
<p>We've attached your prospectus — please take a look and, when you're ready, complete your application using the link below.</p>
<p style="text-align:center;margin:24px 0;">
  <a href="{{applicationLink}}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">Complete Your Application</a>
</p>
<p>If you have any questions, just reply to this email — we'd love to hear from you.</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
    },
  ],
  application_received: [
    {
      subject: "Application Received — JLT Group",
      bodyHtml: `<p>Hi {{firstName}},</p>
<p>Thank you for completing your application to join the JLT Group team! We've received your answers and our team will be in touch shortly.</p>
<p>We review all applications personally, so please allow a few business days for us to get back to you.</p>
<p>In the meantime, if you have any questions, feel free to reply to this email.</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
    },
  ],
  ar_approved: [
    {
      subject: "Great News — Your Application Has Been Approved!",
      bodyHtml: `<p>Hi {{firstName}},</p>
<p>We've reviewed your application and we're delighted to let you know that you've been approved to move forward in our recruitment process!</p>
<p>The next step is a short discovery call with our team. Please use the link below to book a time that works for you:</p>
<p style="text-align:center;margin:24px 0;">
  <a href="https://cal.com/jlt-group/jlt-discovery" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">Book Your Discovery Call</a>
</p>
<p>We look forward to speaking with you soon!</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
    },
  ],
  ar_declined: [
    {
      subject: "Update on Your JLT Group Application",
      bodyHtml: `<p>Hi {{firstName}},</p>
<p>Thank you for taking the time to apply to join the JLT Group team. We've carefully reviewed your application and, unfortunately, we won't be moving forward at this time.</p>
<p>We appreciate your interest and wish you all the best in your future endeavours.</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
    },
  ],
  discovery_call_booked: [
    {
      subject: "Your Discovery Call is Confirmed — JLT Group",
      bodyHtml: `<p>Hi {{firstName}},</p>
<p>Great news — your discovery call with the JLT Group team is confirmed!</p>
<p>We look forward to speaking with you. If you need to reschedule, please use the link in your calendar invitation.</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
    },
  ],
  rebook_required: [
    {
      subject: "No problem — let's find a better time | JLT Group",
      bodyHtml: `<p>Hi {{firstName}},</p>
<p>We noticed you cancelled your discovery call — that's completely fine, life gets busy!</p>
<p>If you'd still like to speak with us, please feel free to rebook at a time that suits you:</p>
<p style="text-align:center;margin:24px 0;">
  <a href="https://cal.com/jlt-group/jlt-discovery" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">Book a New Time</a>
</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
    },
  ],
  did_not_turn_up: [
    {
      subject: "We Missed You — JLT Group Discovery Call",
      bodyHtml: `<p>Hi {{firstName}},</p>
<p>We noticed you weren't able to make it to your discovery call today. No worries — these things happen!</p>
<p>If you'd still like to speak with us, please feel free to rebook at a time that suits you:</p>
<p style="text-align:center;margin:24px 0;">
  <a href="https://cal.com/jlt-group/jlt-discovery" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">Rebook Your Discovery Call</a>
</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
    },
  ],
  waitlisted: [
    {
      subject: "You're on Our Waitlist — JLT Group",
      bodyHtml: `<p>Hi {{firstName}},</p>
<p>Thank you for your interest in joining the JLT Group. While we're not able to move forward right now, we'd love to keep in touch and reach out when a suitable opportunity arises.</p>
<p>We've added you to our waitlist and will be in touch as soon as something opens up.</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
    },
  ],
  onboarding_approved: [
    {
      subject: "Welcome to the JLT Group Family!",
      bodyHtml: `<p>Hi {{firstName}},</p>
<p>We are absolutely thrilled to welcome you to the JLT Group team! 🎉</p>
<p>Your onboarding has been approved and we'll be in touch very shortly with everything you need to get started.</p>
<p>We can't wait to have you on board!</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
    },
  ],
  onboarding_declined: [
    {
      subject: "Update on Your JLT Group Onboarding",
      bodyHtml: `<p>Hi {{firstName}},</p>
<p>Thank you for your time and enthusiasm throughout the recruitment process. After careful consideration, we won't be moving forward with your onboarding at this time.</p>
<p>We appreciate your interest in the JLT Group and wish you all the best.</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
    },
  ],
  won: [
    {
      subject: "You're officially part of the JLT Group! 🎉",
      bodyHtml: `<p>Hi {{firstName}},</p>
<p>Welcome to the JLT Group family! Your account is now active and you can log in to the portal to get started.</p>
<p style="text-align:center;margin:24px 0;">
  <a href="https://portal.thejltgroup.co.uk" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">Access Your Portal</a>
</p>
<p>If you have any questions, don't hesitate to reach out to us.</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`,
    },
  ],
};

// ─── Seed helper (called on first listWorkflows if DB is empty) ───────────────

async function seedDefaultWorkflows() {
  const existing = await listWorkflows();
  // Only seed if fewer than 13 workflows exist (full set)
  if (existing.length >= 13) return;

  const STAGE_NAMES: Record<string, string> = {
    new_enquiry: "New Enquiry",
    application_received: "Application Received",
    ar_approved: "AR Approved",
    ar_declined: "AR Declined",
    discovery_call_booked: "Call Booked",
    rebook_required: "Rebook Required",
    did_not_turn_up: "Did Not Turn Up",
    discovery_call_complete: "Call Complete",
    onboarding_approved: "Onboarding Approved",
    onboarding_declined: "Onboarding Declined",
    won: "Won",
    waitlisted: "Waitlisted",
    archived: "Archived",
  };

  for (const [stage, name] of Object.entries(STAGE_NAMES)) {
    const workflowId = await upsertWorkflow(stage, name, true);
    const emails = DEFAULT_WORKFLOW_EMAILS[stage] ?? [];
    for (let i = 0; i < emails.length; i++) {
      await upsertWorkflowEmail({
        workflowId,
        stepOrder: i + 1,
        delayHours: 0,
        subject: emails[i].subject,
        bodyHtml: emails[i].bodyHtml,
      });
    }
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const recruitmentWorkflowRouter = router({
  /**
   * List all workflows with their email steps.
   * Seeds defaults on first call if DB is empty.
   */
  listWorkflows: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx);
    await seedDefaultWorkflows();
    const workflows = await listWorkflows();
    const result = await Promise.all(
      workflows.map(async (w) => ({
        ...w,
        emails: await getWorkflowEmails(w.id),
      }))
    );
    return result;
  }),

  /**
   * Get a single workflow by stage slug.
   */
  getWorkflow: protectedProcedure
    .input(z.object({ stage: z.string() }))
    .query(async ({ ctx, input }) => {
      requireAdmin(ctx);
      const workflow = await getWorkflowByStage(input.stage);
      if (!workflow) return null;
      return { ...workflow, emails: await getWorkflowEmails(workflow.id) };
    }),

  /**
   * Save (create or update) a workflow email step.
   */
  saveWorkflowEmail: protectedProcedure
    .input(
      z.object({
        id: z.number().optional(),
        stage: z.string(),
        stepOrder: z.number().int().min(1),
        delayHours: z.number().int().min(0),
        subject: z.string().min(1).max(500),
        bodyHtml: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx);
      // Ensure workflow exists for this stage
      let workflow = await getWorkflowByStage(input.stage);
      if (!workflow) {
        const id = await upsertWorkflow(input.stage, input.stage, true);
        workflow = await getWorkflowById(id);
      }
      if (!workflow) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const emailId = await upsertWorkflowEmail({
        id: input.id,
        workflowId: workflow.id,
        stepOrder: input.stepOrder,
        delayHours: input.delayHours,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
      });
      return { id: emailId };
    }),

  /**
   * Delete a workflow email step.
   */
  deleteWorkflowEmail: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx);
      await dbDeleteWorkflowEmail(input.id);
      return { success: true };
    }),

  /**
   * Toggle a workflow on/off.
   */
  toggleWorkflow: protectedProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx);
      await setWorkflowActive(input.id, input.isActive);
      return { success: true };
    }),

  /**
   * Add a new email step to a workflow.
   */
  addWorkflowEmail: protectedProcedure
    .input(
      z.object({
        stage: z.string(),
        delayHours: z.number().int().min(0).default(0),
        subject: z.string().min(1).max(500),
        bodyHtml: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx);
      let workflow = await getWorkflowByStage(input.stage);
      if (!workflow) {
        const id = await upsertWorkflow(input.stage, input.stage, true);
        workflow = await getWorkflowById(id);
      }
      if (!workflow) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const existingEmails = await getWorkflowEmails(workflow.id);
      const nextOrder = existingEmails.length + 1;
      const emailId = await upsertWorkflowEmail({
        workflowId: workflow.id,
        stepOrder: nextOrder,
        delayHours: input.delayHours,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
      });
      return { id: emailId };
    }),

  /**
   * Process all due workflow emails.
   * Called by the scheduled task every hour, and also available as a manual trigger.
   */
  processWorkflowEmails: protectedProcedure.mutation(async ({ ctx }) => {
    requireAdmin(ctx);
    return processWorkflowEmailsInternal();
  }),

  /**
   * Scheduled task endpoint — processes due workflow emails.
   * Accepts POST from the scheduled task agent (user role).
   */
  processWorkflowEmailsScheduled: protectedProcedure.mutation(async () => {
    return processWorkflowEmailsInternal();
  }),
});

// ─── Internal email processor ─────────────────────────────────────────────────

export async function processWorkflowEmailsInternal() {
  const due = await getDueEnrollments();
  let sent = 0;
  let errors = 0;

  for (const enrollment of due) {
    try {
      // Get the workflow and current step
      const workflow = await getWorkflowById(enrollment.workflowId);
      if (!workflow || !workflow.isActive) {
        // Workflow disabled — skip but don't cancel enrollment
        continue;
      }

      const steps = await getWorkflowEmails(enrollment.workflowId);
      const currentStepData = steps.find((s) => s.stepOrder === enrollment.currentStep);
      if (!currentStepData) {
        // Step not found — mark as done
        await advanceEnrollment(enrollment.id, enrollment.workflowId, enrollment.currentStep + 1);
        continue;
      }

      // Get prospect details
      const prospect = await getRecruitmentProspectById(enrollment.prospectId);
      if (!prospect) {
        await advanceEnrollment(enrollment.id, enrollment.workflowId, enrollment.currentStep + 1);
        continue;
      }

      // Replace template variables
      const subject = currentStepData.subject
        .replace(/\{\{firstName\}\}/g, prospect.firstName)
        .replace(/\{\{lastName\}\}/g, prospect.lastName)
        .replace(/\{\{email\}\}/g, prospect.email);

      const bodyHtml = currentStepData.bodyHtml
        .replace(/\{\{firstName\}\}/g, prospect.firstName)
        .replace(/\{\{lastName\}\}/g, prospect.lastName)
        .replace(/\{\{email\}\}/g, prospect.email);

      // Send the email
      await sendWorkflowEmail({
        toEmail: prospect.email,
        toName: prospect.firstName,
        subject,
        bodyHtml,
      });

      sent++;
      // Log the email so it appears in the prospect's Email Log on the portal
      try {
        await logRecruitmentEmail({
          prospectId: enrollment.prospectId,
          stage: workflow.stage,
          emailKey: `workflow_${workflow.stage}_step${enrollment.currentStep}`,
          subject,
        });
      } catch (_logErr) {
        // Non-fatal — email was sent, logging failure should not block advancement
      }
      // Advance to next step
      await advanceEnrollment(enrollment.id, enrollment.workflowId, enrollment.currentStep + 1);
    } catch (err) {
      console.error(`[WorkflowProcessor] Error processing enrollment ${enrollment.id}:`, err);
      errors++;
    }
  }

  return { processed: due.length, sent, errors };
}
