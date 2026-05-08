/**
 * Recruitment Pipeline tRPC router
 *
 * Public procedures: createProspect, submitApplication, getApplicationToken
 * Admin procedures: listProspects, getProspect, updateStage, updateNotes, getStageHistory, getEmailsSent
 */
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import {
  createRecruitmentProspect,
  getRecruitmentProspectById,
  getRecruitmentProspectByEmail,
  getAllRecruitmentProspects,
  updateRecruitmentProspect,
  moveRecruitmentProspectStage,
  getRecruitmentStageHistory,
  getRecruitmentEmailsSent,
  logRecruitmentEmail,
  deleteRecruitmentProspect,
} from "./recruitment-db";
import { PROSPECT_FROM, PROSPECT_REPLY_TO } from "./resend-email";
import { Resend } from "resend";
import { ENV } from "./_core/env";
import { getEmailBrandingSettings } from "./crm-db";

// ─── Prospectus / Application email helpers ───────────────────────────────────

const PROSPECTUS_URL = "https://portal.thejltgroup.co.uk/api/prospectus";
const FACEBOOK_GROUP_URL = "https://www.facebook.com/groups/jltgroup/";

function getResend(): Resend {
  const key = ENV.resendApiKey;
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  return new Resend(key);
}

async function sendProspectEmail(opts: {
  toEmail: string;
  toName: string;
  subject: string;
  bodyHtml: string;
}): Promise<void> {
  try {
    const resend = getResend();
    const branding = await getEmailBrandingSettings();
    const logoHtml = branding?.logoUrl
      ? `<img src="${branding.logoUrl}" alt="JLT Group" style="max-height:60px;max-width:200px;display:block;margin:0 auto;object-fit:contain;mix-blend-mode:multiply;" />`
      : `<span style="font-family:'Poppins',Arial,sans-serif;font-size:22px;font-weight:700;color:#414141;">JLT Group</span>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${opts.subject}</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background-color:#FFF6ED;font-family:'Poppins',Arial,sans-serif;">
  <div style="width:100%;background-color:#FFF6ED;padding:32px 0;">
    <div style="max-width:600px;width:100%;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07);">
      <div style="background-color:#70FFE8;padding:28px 40px;text-align:center;">
        ${logoHtml}
      </div>
      <div style="padding:36px 40px;color:#414141;font-family:'Poppins',Arial,sans-serif;font-size:15px;line-height:1.8;">
        ${opts.bodyHtml}
      </div>
      <div style="padding:20px 40px;text-align:center;background-color:#FFF6ED;font-family:'Poppins',Arial,sans-serif;font-size:12px;color:#888;">
        &copy; ${new Date().getFullYear()} JLT Group. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>`;

    await resend.emails.send({
      from: PROSPECT_FROM,
      to: [opts.toEmail],
      replyTo: PROSPECT_REPLY_TO,
      subject: opts.subject,
      html,
    });
  } catch (err: any) {
    console.error("[Recruitment] Failed to send prospect email:", err?.message);
  }
}

async function sendProspectusEmail(opts: {
  prospectId: number;
  toEmail: string;
  firstName: string;
  applicationUrl: string;
}): Promise<void> {
  const subject = "Your JLT Group Prospectus";
  const bodyHtml = `
<p style="margin:0 0 16px;">Hi ${opts.firstName},</p>
<p style="margin:0 0 16px;">Thank you for your interest in joining JLT Group. We are really excited to share more about who we are and what we offer.</p>
<p style="margin:0 0 16px;">Start by reading our prospectus. It covers everything you need to know about life at JLT Group and what makes us different:</p>
<p style="text-align:center;margin:28px 0;">
  <a href="${PROSPECTUS_URL}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:700;padding:15px 36px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;font-size:15px;">Read the JLT Prospectus</a>
</p>
<p style="margin:0 0 16px;">We also have a fantastic Facebook community where current agents and prospective members connect, share tips, and get a real feel for the JLT culture. We would love for you to join us there. When you request to join, please answer the membership questions so we can approve you straight away:</p>
<p style="text-align:center;margin:28px 0;">
  <a href="${FACEBOOK_GROUP_URL}" style="display:inline-block;background:#414141;color:#ffffff;font-weight:700;padding:15px 36px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;font-size:15px;">Join the JLT Facebook Community</a>
</p>
<hr style="border:none;border-top:1px solid #e8e8e8;margin:28px 0;"/>
<p style="margin:0 0 12px;"><strong>Ready for the next step?</strong></p>
<p style="margin:0 0 16px;">Once you have read the prospectus, we would love to learn more about you by completing a short application form. There is absolutely no commitment involved in doing so. The form simply helps us understand where you are right now and allows us to organise a discovery call that is completely tailored to you and your goals. It takes just a few minutes and makes all the difference.</p>
<p style="text-align:center;margin:28px 0;">
  <a href="${opts.applicationUrl}" style="display:inline-block;background:#70FFE8;color:#414141;font-weight:700;padding:15px 36px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;font-size:15px;">Complete Your Application</a>
</p>
<p style="margin:0 0 16px;">If you have any questions at any point, just reply to this email and we will be happy to help.</p>
<p style="margin:0;">Warm regards,<br/><strong>The JLT Group Team</strong></p>`;

  await sendProspectEmail({
    toEmail: opts.toEmail,
    toName: opts.firstName,
    subject,
    bodyHtml,
  });

  await logRecruitmentEmail({
    prospectId: opts.prospectId,
    stage: "new_enquiry",
    emailKey: "prospectus_sent",
    subject,
  });
}

// ─── Application token helpers ────────────────────────────────────────────────

function generateApplicationToken(): string {
  return nanoid(32);
}

// We store the application token in the adminNotes field temporarily as a
// simple approach — or better, we store it in a dedicated column.
// For simplicity we'll encode it as a prefix in adminNotes: "APP_TOKEN:<token>"
// and strip it when displaying notes.
function encodeApplicationToken(token: string, existingNotes?: string | null): string {
  const existing = existingNotes?.replace(/^APP_TOKEN:[^\n]+\n?/, "") ?? "";
  return `APP_TOKEN:${token}\n${existing}`.trim();
}

function extractApplicationToken(adminNotes?: string | null): string | null {
  if (!adminNotes) return null;
  const match = adminNotes.match(/^APP_TOKEN:([^\n]+)/);
  return match ? match[1].trim() : null;
}

function stripApplicationToken(adminNotes?: string | null): string {
  if (!adminNotes) return "";
  return adminNotes.replace(/^APP_TOKEN:[^\n]+\n?/, "").trim();
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const recruitmentRouter = router({
  /**
   * PUBLIC — Submit initial enquiry form.
   * Creates a prospect in new_enquiry stage and sends prospectus email.
   */
  createProspect: publicProcedure
    .input(
      z.object({
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        email: z.string().email().max(255),
        phone: z.string().max(50).optional(),
        tierInterest: z.string().max(50).optional(),
        howHeard: z.string().max(255).optional(),
        source: z.string().max(100).optional(),
        origin: z.string().url().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const email = input.email.toLowerCase().trim();

      // Check for duplicate
      const existing = await getRecruitmentProspectByEmail(email);
      if (existing) {
        // Silently succeed — don't reveal whether email exists
        return { success: true, duplicate: true };
      }

      // Generate application token
      const appToken = generateApplicationToken();
      const applicationUrl = input.origin
        ? `${input.origin}/apply/form?token=${appToken}`
        : `https://portal.thejltgroup.co.uk/apply/form?token=${appToken}`;

      // Create prospect
      const id = await createRecruitmentProspect({
        firstName: input.firstName,
        lastName: input.lastName,
        email,
        phone: input.phone ?? null,
        pipelineStage: "new_enquiry",
        source: input.source ?? "website",
        tierInterest: input.tierInterest ?? null,
        howHeard: input.howHeard ?? null,
        adminNotes: encodeApplicationToken(appToken),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Send prospectus email
      await sendProspectusEmail({
        prospectId: id,
        toEmail: email,
        firstName: input.firstName,
        applicationUrl,
      });

      // Update prospectusEmailSentAt
      await updateRecruitmentProspect(id, { prospectusEmailSentAt: new Date() });

      return { success: true, duplicate: false };
    }),

  /**
   * PUBLIC — Get prospect info by application token (for pre-filling form).
   */
  getApplicationByToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      // We need to find the prospect with this token in adminNotes
      const prospects = await getAllRecruitmentProspects({ limit: 5000 });
      const prospect = prospects.find(
        (p) => extractApplicationToken(p.adminNotes) === input.token
      );
      if (!prospect) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid or expired application link" });
      }
      // Only return safe fields
      return {
        id: prospect.id,
        firstName: prospect.firstName,
        lastName: prospect.lastName,
        email: prospect.email,
        pipelineStage: prospect.pipelineStage,
        applicationSubmittedAt: prospect.applicationSubmittedAt,
      };
    }),

  /**
   * PUBLIC — Submit full application form (token-based).
   */
  submitApplication: publicProcedure
    .input(
      z.object({
        token: z.string(),
        occupation: z.string().min(1).max(255),
        whyJlt: z.string().min(1).max(2000),
        experience: z.string().max(2000).optional(),
        fullOrPartTime: z.enum(["full_time", "part_time", "not_sure"]),
        linkedinUrl: z.string().url().optional().or(z.literal("")).optional(),
        anythingElse: z.string().max(2000).optional(),
        // Extended Agent Readiness Form fields
        extendedData: z.object({
          selfEmployed: z.string().optional(),
          travelExperience: z.string().optional(),
          travelExperienceDetails: z.string().optional(),
          mainGoal: z.array(z.string()).optional(),
          travelSpecialism: z.string().optional(),
          hoursPerWeek: z.string().optional(),
          homeSupport: z.string().optional(),
          investmentReadiness: z.string().optional(),
          selfEmployedAwareness: z.string().optional(),
          biggestWorry: z.string().optional(),
          techConfidence: z.string().optional(),
          financialReadiness: z.string().optional(),
          twoYearVision: z.string().optional(),
          heardAbout: z.array(z.string()).optional(),
          heardAboutOther: z.string().optional(),
          lookingAtOthers: z.string().optional(),
          lookingAtOthersDetails: z.string().optional(),
        }).optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Find prospect by token
      const prospects = await getAllRecruitmentProspects({ limit: 5000 });
      const prospect = prospects.find(
        (p) => extractApplicationToken(p.adminNotes) === input.token
      );
      if (!prospect) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid or expired application link" });
      }

      // Already submitted?
      if (prospect.applicationSubmittedAt) {
        return { success: true, alreadySubmitted: true };
      }

      const applicationData = {
        occupation: input.occupation,
        whyJlt: input.whyJlt,
        experience: input.experience ?? "",
        fullOrPartTime: input.fullOrPartTime,
        linkedinUrl: input.linkedinUrl ?? "",
        anythingElse: input.anythingElse ?? "",
        submittedAt: new Date().toISOString(),
        // Agent Readiness Form extended fields
        ...(input.extendedData ?? {}),
      };

      await updateRecruitmentProspect(prospect.id, {
        applicationData,
        applicationSubmittedAt: new Date(),
        pipelineStage: "application_received",
      });

      // Log stage change
      await moveRecruitmentProspectStage({
        prospectId: prospect.id,
        toStage: "application_received",
        changedByName: "System (self-service)",
        note: "Application form submitted by prospect",
      });

      // Send confirmation email to prospect
      const subject = "Application Received — JLT Group";
      const bodyHtml = `
<p>Hi ${prospect.firstName},</p>
<p>Thank you for completing your application to join the JLT Group team! We've received your answers and our team will be in touch shortly.</p>
<p>We review all applications personally, so please allow a few business days for us to get back to you.</p>
<p>In the meantime, if you have any questions, feel free to reply to this email.</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`;

      await sendProspectEmail({
        toEmail: prospect.email,
        toName: prospect.firstName,
        subject,
        bodyHtml,
      });

      await logRecruitmentEmail({
        prospectId: prospect.id,
        stage: "application_received",
        emailKey: "application_confirmation",
        subject,
      });

      return { success: true, alreadySubmitted: false };
    }),

  // ─── Admin procedures ───────────────────────────────────────────────────────

  /**
   * ADMIN — List all prospects with optional stage filter and search.
   */
  listProspects: protectedProcedure
    .input(
      z.object({
        stage: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(200).optional(),
        offset: z.number().min(0).optional(),
      })
    )
    .query(async ({ ctx }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      // Input is available via the destructured parameter
      return getAllRecruitmentProspects();
    }),

  /**
   * ADMIN — List prospects with filters (separate to avoid TS issues).
   */
  listProspectsFiltered: protectedProcedure
    .input(
      z.object({
        stage: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(200).optional(),
        offset: z.number().min(0).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getAllRecruitmentProspects({
        stage: input.stage,
        search: input.search,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  /**
   * ADMIN — Get full prospect detail with stage history and emails sent.
   */
  getProspect: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const prospect = await getRecruitmentProspectById(input.id);
      if (!prospect) throw new TRPCError({ code: "NOT_FOUND" });

      const [stageHistory, emailsSent] = await Promise.all([
        getRecruitmentStageHistory(input.id),
        getRecruitmentEmailsSent(input.id),
      ]);

      // Strip application token from adminNotes before returning
      return {
        ...prospect,
        adminNotes: stripApplicationToken(prospect.adminNotes),
        stageHistory,
        emailsSent,
      };
    }),

  /**
   * ADMIN — Update prospect stage (approve, decline, advance).
   */
  updateStage: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        toStage: z.string(),
        note: z.string().optional(),
        declineReason: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const prospect = await getRecruitmentProspectById(input.id);
      if (!prospect) throw new TRPCError({ code: "NOT_FOUND" });

      await moveRecruitmentProspectStage({
        prospectId: input.id,
        toStage: input.toStage,
        changedById: ctx.user.id,
        changedByName: ctx.user.name ?? "Admin",
        note: input.note,
      });

      // Store decline reason if provided
      if (input.declineReason) {
        await updateRecruitmentProspect(input.id, {
          declineReason: input.declineReason,
        });
      }

      // Send stage-specific emails
      await sendStageEmail(input.id, input.toStage, prospect);

      return { success: true };
    }),

  /**
   * ADMIN — Update admin notes on a prospect.
   */
  updateNotes: protectedProcedure
    .input(z.object({ id: z.number(), adminNotes: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      // Preserve the application token prefix
      const prospect = await getRecruitmentProspectById(input.id);
      if (!prospect) throw new TRPCError({ code: "NOT_FOUND" });

      const token = extractApplicationToken(prospect.adminNotes);
      const newNotes = token
        ? encodeApplicationToken(token, input.adminNotes)
        : input.adminNotes;

      await updateRecruitmentProspect(input.id, { adminNotes: newNotes });
      return { success: true };
    }),

  /**
   * ADMIN — Resend prospectus email.
   */
  resendProspectusEmail: protectedProcedure
    .input(z.object({ id: z.number(), origin: z.string().url().optional() }))
    .mutation(async ({ input, ctx }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const prospect = await getRecruitmentProspectById(input.id);
      if (!prospect) throw new TRPCError({ code: "NOT_FOUND" });

      let token = extractApplicationToken(prospect.adminNotes);
      if (!token) {
        token = generateApplicationToken();
        await updateRecruitmentProspect(input.id, {
          adminNotes: encodeApplicationToken(token, prospect.adminNotes),
        });
      }

      const applicationUrl = input.origin
        ? `${input.origin}/apply/form?token=${token}`
        : `https://portal.thejltgroup.co.uk/apply/form?token=${token}`;

      await sendProspectusEmail({
        prospectId: input.id,
        toEmail: prospect.email,
        firstName: prospect.firstName,
        applicationUrl,
      });

      await updateRecruitmentProspect(input.id, { prospectusEmailSentAt: new Date() });

      return { success: true };
    }),

  /**
   * ADMIN — Get stage history for a prospect.
   */
  getStageHistory: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getRecruitmentStageHistory(input.id);
    }),

  /**
   * ADMIN — Get emails sent to a prospect.
   */
  getEmailsSent: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getRecruitmentEmailsSent(input.id);
    }),

  /**
   * ADMIN — Count prospects by stage (for pipeline overview).
   */
  stageCounts: protectedProcedure.query(async ({ ctx }) => {
    if (![
"admin", "super_admin"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    const all = await getAllRecruitmentProspects({ limit: 5000 });
    const counts: Record<string, number> = {};
    for (const p of all) {
      counts[p.pipelineStage] = (counts[p.pipelineStage] ?? 0) + 1;
    }
    return counts;
  }),

  /**
   * ADMIN — Permanently delete a prospect and all related data.
   */
  deleteProspect: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!["admin", "super_admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await deleteRecruitmentProspect(input.id);
      return { success: true };
    }),
});
// ─── Stage-triggered emails ───────────────────────────────────────────────────

async function sendStageEmail(
  prospectId: number,
  toStage: string,
  prospect: Awaited<ReturnType<typeof getRecruitmentProspectById>>
): Promise<void> {
  if (!prospect) return;

  const name = prospect.firstName;
  const email = prospect.email;

  if (toStage === "ar_approved") {
    const subject = "Great News — Your Application Has Been Approved!";
    const bodyHtml = `
<p>Hi ${name},</p>
<p>We've reviewed your application and we're delighted to let you know that you've been approved to move forward in our recruitment process!</p>
<p>The next step is a short discovery call with our team. Please use the link below to book a time that works for you:</p>
<p style="text-align:center;margin:24px 0;">
  <a href="https://cal.com/thejltgroup" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;">
    Book Your Discovery Call
  </a>
</p>
<p>We look forward to speaking with you soon!</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`;

    await sendProspectEmail({ toEmail: email, toName: name, subject, bodyHtml });
    await logRecruitmentEmail({ prospectId, stage: "ar_approved", emailKey: "ar_approved_notification", subject });
  }

  if (toStage === "ar_declined") {
    const subject = "Update on Your JLT Group Application";
    const bodyHtml = `
<p>Hi ${name},</p>
<p>Thank you for taking the time to apply to join the JLT Group team. We've carefully reviewed your application and, unfortunately, we won't be moving forward at this time.</p>
<p>We appreciate your interest and wish you all the best in your future endeavours.</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`;

    await sendProspectEmail({ toEmail: email, toName: name, subject, bodyHtml });
    await logRecruitmentEmail({ prospectId, stage: "ar_declined", emailKey: "ar_declined_notification", subject });
  }

  if (toStage === "waitlisted") {
    const subject = "You're on Our Waitlist — JLT Group";
    const bodyHtml = `
<p>Hi ${name},</p>
<p>Thank you for your interest in joining the JLT Group. While we're not able to move forward right now, we'd love to keep in touch and reach out when a suitable opportunity arises.</p>
<p>We've added you to our waitlist and will be in touch as soon as something opens up.</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`;

    await sendProspectEmail({ toEmail: email, toName: name, subject, bodyHtml });
    await logRecruitmentEmail({ prospectId, stage: "waitlisted", emailKey: "waitlisted_notification", subject });
  }

  if (toStage === "did_not_turn_up") {
    const subject = "We Missed You — JLT Group Discovery Call";
    const bodyHtml = `
<p>Hi ${name},</p>
<p>We noticed you weren't able to make it to your discovery call today. No worries — these things happen!</p>
<p>If you'd still like to speak with us, please feel free to rebook at a time that suits you:</p>
<p style="text-align:center;margin:24px 0;">
  <a href="https://cal.com/thejltgroup" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;">
    Rebook Your Discovery Call
  </a>
</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`;

    await sendProspectEmail({ toEmail: email, toName: name, subject, bodyHtml });
    await logRecruitmentEmail({ prospectId, stage: "did_not_turn_up", emailKey: "dntu_notification", subject });
  }

  if (toStage === "onboarding_approved") {
    const subject = "Welcome to the JLT Group Family!";
    const bodyHtml = `
<p>Hi ${name},</p>
<p>We are absolutely thrilled to welcome you to the JLT Group team! 🎉</p>
<p>Your onboarding has been approved and we'll be in touch very shortly with everything you need to get started.</p>
<p>We can't wait to have you on board!</p>
<p>Warm regards,<br/><strong>The JLT Group Team</strong></p>`;

    await sendProspectEmail({ toEmail: email, toName: name, subject, bodyHtml });
    await logRecruitmentEmail({ prospectId, stage: "onboarding_approved", emailKey: "onboarding_approved_notification", subject });
  }
}
