/**
 * CRM tRPC router — prospects, pipeline, AR forms, contracts, campaigns, remittances, payment config
 */
import { router, protectedProcedure, publicProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { createRecruitmentProspect, getRecruitmentProspectByEmail } from "./recruitment-db";
import {
  createProspect,
  getProspectById,
  getProspectByEmail,
  getAllProspects,
  updateProspect,
  deleteProspect,
  moveProspectStage,
  getProspectPipelineHistory,
  getProspectTags,
  addProspectTag,
  removeProspectTag,
  createArForm,
  getArFormsByProspect,
  getLatestArForm,
  reviewArForm,
  getSupplierLoginsByProspect,
  addSupplierLogin,
  updateSupplierLogin,
  deleteSupplierLogin,
  getActiveContractTemplate,
  getAllContractTemplates,
  createContractTemplate,
  createProspectContract,
  getContractByToken,
  getContractsByProspect,
  signContract,
  markContractSent,
  getAllCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaign,
  createEmailSends,
  updateEmailSendStatus,
  getCampaignSends,
  createRemittance,
  createRemittanceItems,
  getAllRemittances,
  getRemittanceById,
  getRemittanceItems,
  getRemittanceItemsByAgent,
  markRemittanceNotificationSent,
  getPaymentConfig,
  upsertPaymentConfig,
  generateUniqueAgentId,
  getAllEmailTemplates,
  getEmailTemplateById,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  getAllDripWorkflows,
  getDripWorkflowById,
  createDripWorkflow,
  updateDripWorkflow,
  deleteDripWorkflow,
  getDripStepsByWorkflow,
  upsertDripSteps,
  enrollInDripWorkflow,
  getEnrollmentsByWorkflow,
  getCampaignStats,
  getCampaignRecipients,
  getEmailBrandingSettings,
  upsertEmailBrandingSettings,
} from "./crm-db";
import { getAllUsers, getUserByEmail } from "./db";
import { storagePut } from "./storage";
import { sendDirectEmail } from "./email";
import { enqueueCampaignRecipients } from "./resend-email";
import { createInAppNotification } from "./db";
import {
  listAgentsWithCrm,
  getAgentCrmProfile,
  upsertAgentCrmProfile,
  decryptAgentBankDetails,
  getAgentTags,
  addAgentTag,
  removeAgentTag,
  getAgentSupplierLogins,
  addAgentSupplierLogin,
  updateAgentSupplierLogin,
  deleteAgentSupplierLogin,
  decryptSupplierPassword,
  generateUniqueAgentIdForUser,
} from "./agent-crm-db";

// ─── Role guards ──────────────────────────────────────────────────────────────

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

const superAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Super admin access required" });
  }
  return next({ ctx });
});

// ─── Prospect stage enum ──────────────────────────────────────────────────────

const PROSPECT_STAGES = [
  "New Enquiry",
  "AR Submitted",
  "AR Approved",
  "Discovery Call Booked",
  "Approved",
  "Rejected",
  "Lost",
  "Won",
] as const;

type ProspectStage = (typeof PROSPECT_STAGES)[number];

// ─── CRM Router ───────────────────────────────────────────────────────────────

export const crmRouter = router({
  // ── Prospects ──────────────────────────────────────────────────────────────

  prospects: router({
    list: adminProcedure.query(async () => {
      const all = await getAllProspects();
      // Fetch tags for all prospects in one pass
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return all.map((p) => ({ ...p, tags: [] as string[] }));
      const { prospectTags } = await import("../drizzle/schema");
      const tagRows = await db.select().from(prospectTags);
      const tagMap = new Map<number, string[]>();
      for (const t of tagRows) {
        if (!tagMap.has(t.prospectId)) tagMap.set(t.prospectId, []);
        tagMap.get(t.prospectId)!.push(t.tag);
      }
      return all.map((p) => ({ ...p, tags: tagMap.get(p.id) ?? [] }));
    }),

    get: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .query(async ({ input }) => {
        const p = await getProspectById(input.id);
        if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Prospect not found" });
        const [tags, arForms, contracts, supplierLogins, history] = await Promise.all([
          getProspectTags(input.id),
          getArFormsByProspect(input.id),
          getContractsByProspect(input.id),
          getSupplierLoginsByProspect(input.id),
          getProspectPipelineHistory(input.id),
        ]);
        return {
          ...p,
          tags: tags.map((t) => t.tag),
          arForms,
          contracts,
          supplierLogins,
          history,
        };
      }),

    create: adminProcedure
      .input(
        z.object({
          firstName: z.string().min(1),
          lastName: z.string().min(1),
          email: z.string().email(),
          phone: z.string().optional(),
          marketingConsent: z.boolean().default(false),
          source: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const existing = await getProspectByEmail(input.email);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "A prospect with this email already exists" });
        const prospect = await createProspect({
          ...input,
          stage: "New Enquiry",
          source: input.source ?? "manual",
          createdById: ctx.user.id,
        });
        return prospect;
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          firstName: z.string().min(1).optional(),
          lastName: z.string().min(1).optional(),
          email: z.string().email().optional(),
          phone: z.string().optional().nullable(),
          mobile: z.string().optional().nullable(),
          personalEmail: z.string().email().optional().nullable(),
          jltEmail: z.string().email().optional().nullable(),
          addressLine1: z.string().optional().nullable(),
          addressLine2: z.string().optional().nullable(),
          city: z.string().optional().nullable(),
          postcode: z.string().optional().nullable(),
          ukRegion: z.string().optional().nullable(),
          bankAccountName: z.string().optional().nullable(),
          bankSortCode: z.string().optional().nullable(),
          bankAccountNumber: z.string().optional().nullable(),
          adminNotes: z.string().optional().nullable(),
          wonPortalAccess: z.boolean().optional(),
          fullPortalAccess: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const updated = await updateProspect(id, data);
        if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Prospect not found" });
        return updated;
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteProspect(input.id);
        return { success: true };
      }),

    moveStage: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          stage: z.enum(PROSPECT_STAGES),
          note: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const updated = await moveProspectStage(input.id, input.stage, ctx.user.id, input.note);
        // If moved to Won, assign unique agent ID if not already set
        if (input.stage === "Won" && updated && !updated.uniqueAgentId) {
          const agentId = await generateUniqueAgentId();
          await updateProspect(input.id, { uniqueAgentId: agentId, wonPortalAccess: true });
        }
        // Auto-enroll in CRM drip workflows triggered by this stage
        if (updated?.email) {
          const { autoEnrollProspectInDripWorkflows } = await import("./crm-db");
          autoEnrollProspectInDripWorkflows(
            input.id,
            input.stage,
            updated.email,
            [updated.firstName, updated.lastName].filter(Boolean).join(" ") || updated.email
          ).catch((e) => console.error("[DripEngine] Auto-enroll error:", e?.message));
        }
        return updated;
      }),

    assignAgentId: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        const agentId = await generateUniqueAgentId();
        const updated = await updateProspect(input.id, { uniqueAgentId: agentId });
        return updated;
      }),

    // Tags
    addTag: adminProcedure
      .input(z.object({ prospectId: z.number().int(), tag: z.string().min(1).max(50) }))
      .mutation(async ({ input }) => {
        await addProspectTag(input.prospectId, input.tag);
        return { success: true };
      }),

    removeTag: adminProcedure
      .input(z.object({ prospectId: z.number().int(), tag: z.string().min(1) }))
      .mutation(async ({ input }) => {
        await removeProspectTag(input.prospectId, input.tag);
        return { success: true };
      }),

    // Upload ID doc or proof of address
    uploadDoc: adminProcedure
      .input(
        z.object({
          prospectId: z.number().int(),
          docType: z.enum(["id", "proofOfAddress"]),
          fileBase64: z.string(),
          fileName: z.string(),
          mimeType: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        const buf = Buffer.from(input.fileBase64, "base64");
        const ext = input.fileName.split(".").pop() ?? "bin";
        const key = `crm/docs/${input.prospectId}/${input.docType}-${nanoid(8)}.${ext}`;
        const { url } = await storagePut(key, buf, input.mimeType);
        const updateData =
          input.docType === "id"
            ? { idDocUrl: url, idDocKey: key }
            : { proofOfAddressUrl: url, proofOfAddressKey: key };
        await updateProspect(input.prospectId, updateData);
        return { url, key };
      }),
  }),

  // ── Public enquiry form (embeddable) ───────────────────────────────────────

  enquiry: router({
    submit: publicProcedure
      .input(
        z.object({
          firstName: z.string().min(1).max(100),
          lastName: z.string().min(1).max(100),
          email: z.string().email(),
          phone: z.string().optional(),
          marketingConsent: z.boolean().default(false),
        })
      )
      .mutation(async ({ input }) => {
        // Check for duplicate
        const existing = await getProspectByEmail(input.email);
        if (existing) {
          // Don't reveal the duplicate, just return success silently
          return { success: true, prospectId: existing.id };
        }
        const prospect = await createProspect({
          ...input,
          stage: "New Enquiry",
          source: "enquiry_form",
        });
        // Generate a proper application token and create a recruitment prospect so the token lookup works
        try {
          const appToken = nanoid(32);
          const applicationUrl = `https://portal.thejltgroup.co.uk/apply/form?token=${appToken}`;
          // Also store token in CRM prospect adminNotes for reference
          if (prospect?.id) {
            await updateProspect(prospect.id, { adminNotes: `APP_TOKEN:${appToken}` });
          }
          // Create a recruitment prospect so getApplicationByToken and submitApplication work
          await createRecruitmentProspect({
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            phone: input.phone,
            pipelineStage: "new_enquiry",
            source: "enquiry_form",
            adminNotes: `APP_TOKEN:${appToken}`,
          });
          // Send the properly branded prospectus email via Resend
          const { Resend } = await import("resend");
          const { PROSPECT_FROM, PROSPECT_REPLY_TO } = await import("./resend-email");
          const { getEmailBrandingSettings } = await import("./crm-db");
          const resendKey = process.env.RESEND_API_KEY;
          if (resendKey && prospect?.id) {
            const resend = new Resend(resendKey);
            const branding = await getEmailBrandingSettings();
            const logoHtml = branding?.logoUrl
              ? `<img src="${branding.logoUrl}" alt="JLT Group" style="max-height:60px;max-width:200px;display:block;margin:0 auto;object-fit:contain;mix-blend-mode:multiply;" />`
              : `<span style="font-family:'Poppins',Arial,sans-serif;font-size:22px;font-weight:700;color:#414141;">JLT Group</span>`;
            const PROSPECTUS_URL_CRM = "https://portal.thejltgroup.co.uk/api/prospectus";
            const FACEBOOK_GROUP_URL_CRM = "https://www.facebook.com/groups/jltgroup/";
            const bodyHtml = `
<p style="margin:0 0 16px;">Hi ${input.firstName},</p>
<p style="margin:0 0 16px;">Thank you for your interest in joining JLT Group. We are really excited to share more about who we are and what we offer.</p>
<p style="margin:0 0 16px;">Start by reading our prospectus. It covers everything you need to know about life at JLT Group and what makes us different:</p>
<p style="text-align:center;margin:28px 0;">
  <a href="${PROSPECTUS_URL_CRM}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:700;padding:15px 36px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;font-size:15px;">Read the JLT Prospectus</a>
</p>
<p style="margin:0 0 16px;">We also have a fantastic Facebook community where current agents and prospective members connect, share tips, and get a real feel for the JLT culture. We would love for you to join us there. When you request to join, please answer the membership questions so we can approve you straight away:</p>
<p style="text-align:center;margin:28px 0;">
  <a href="${FACEBOOK_GROUP_URL_CRM}" style="display:inline-block;background:#414141;color:#ffffff;font-weight:700;padding:15px 36px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;font-size:15px;">Join the JLT Facebook Community</a>
</p>
<hr style="border:none;border-top:1px solid #e8e8e8;margin:28px 0;"/>
<p style="margin:0 0 12px;"><strong>Ready for the next step?</strong></p>
<p style="margin:0 0 16px;">Once you have read the prospectus, we would love to learn more about you by completing a short application form. There is absolutely no commitment involved in doing so. The form simply helps us understand where you are right now and allows us to organise a discovery call that is completely tailored to you and your goals. It takes just a few minutes and makes all the difference.</p>
<p style="text-align:center;margin:28px 0;">
  <a href="${applicationUrl}" style="display:inline-block;background:#70FFE8;color:#414141;font-weight:700;padding:15px 36px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;font-size:15px;">Complete Your Application</a>
</p>
<p style="margin:0 0 16px;">If you have any questions at any point, just reply to this email and we will be happy to help.</p>
<p style="margin:0;">Warm regards,<br/><strong>The JLT Group Team</strong></p>`;
            const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Your JLT Group Prospectus</title><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet"/></head><body style="margin:0;padding:0;background-color:#FFF6ED;font-family:'Poppins',Arial,sans-serif;"><div style="width:100%;background-color:#FFF6ED;padding:32px 0;"><div style="max-width:600px;width:100%;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07);"><div style="background-color:#70FFE8;padding:28px 40px;text-align:center;">${logoHtml}</div><div style="padding:36px 40px;color:#414141;font-family:'Poppins',Arial,sans-serif;font-size:15px;line-height:1.8;">${bodyHtml}</div><div style="padding:20px 40px;text-align:center;background-color:#FFF6ED;font-family:'Poppins',Arial,sans-serif;font-size:12px;color:#888;">&copy; ${new Date().getFullYear()} JLT Group. All rights reserved.</div></div></div></body></html>`;
            await resend.emails.send({
              from: PROSPECT_FROM,
              to: [input.email],
              replyTo: PROSPECT_REPLY_TO,
              subject: "Your JLT Group Prospectus",
              html,
            });
          }
        } catch (e) {
          // Non-fatal — log but don't fail the submission
          console.warn("[CRM] Failed to send prospectus email:", e);
        }
        return { success: true, prospectId: prospect?.id };
      }),
  }),

  // ── Referral funnel form (personal /info page) ────────────────────────────
  // Same as enquiry.submit but also attributes the lead to a referring user

  enquiryWithRef: router({
    submit: publicProcedure
      .input(
        z.object({
          firstName: z.string().min(1).max(100),
          lastName: z.string().min(1).max(100),
          email: z.string().email(),
          phone: z.string().min(1),
          marketingConsent: z.literal(true),
          refUserId: z.number().int().optional(), // referring user's ID
        })
      )
      .mutation(async ({ input }) => {
        const { refUserId, ...prospectInput } = input;
        // Check for duplicate in CRM prospects — create if new
        let prospect = await getProspectByEmail(prospectInput.email);
        if (!prospect) {
          prospect = await createProspect({
            ...prospectInput,
            stage: "New Enquiry",
            source: "referral_funnel",
            createdById: refUserId ?? null,
          });
        }
        // Always ensure a recruitment prospect exists for this email
        try {
          const appToken = nanoid(32);
          const applicationUrl = `https://portal.thejltgroup.co.uk/apply/form?token=${appToken}`;
          if (prospect?.id) {
            await updateProspect(prospect.id, { adminNotes: `APP_TOKEN:${appToken}` });
          }
          // Check for duplicate in recruitment pipeline separately
          const existingRecruit = await getRecruitmentProspectByEmail(prospectInput.email);
          if (!existingRecruit) {
            await createRecruitmentProspect({
              firstName: prospectInput.firstName,
              lastName: prospectInput.lastName,
              email: prospectInput.email,
              phone: prospectInput.phone,
              pipelineStage: "new_enquiry",
              source: "referral_funnel",
              referredById: refUserId ?? null,
              adminNotes: `APP_TOKEN:${appToken}`,
            });
          }
          // Send prospectus email
          const { Resend } = await import("resend");
          const { PROSPECT_FROM, PROSPECT_REPLY_TO } = await import("./resend-email");
          const { getEmailBrandingSettings } = await import("./crm-db");
          const resendKey = process.env.RESEND_API_KEY;
          if (resendKey && prospect?.id) {
            const resend = new Resend(resendKey);
            const branding = await getEmailBrandingSettings();
            const logoHtml = branding?.logoUrl
              ? `<img src="${branding.logoUrl}" alt="JLT Group" style="max-height:60px;max-width:200px;display:block;margin:0 auto;object-fit:contain;mix-blend-mode:multiply;" />`
              : `<span style="font-family:'Poppins',Arial,sans-serif;font-size:22px;font-weight:700;color:#414141;">JLT Group</span>`;
            const PROSPECTUS_URL = "https://portal.thejltgroup.co.uk/api/prospectus";
            const FACEBOOK_GROUP_URL = "https://www.facebook.com/groups/jltgroup/";
            const bodyHtml = `
<p style="margin:0 0 16px;">Hi ${prospectInput.firstName},</p>
<p style="margin:0 0 16px;">Thank you for your interest in joining JLT Group. We are really excited to share more about who we are and what we offer.</p>
<p style="margin:0 0 16px;">Start by reading our prospectus. It covers everything you need to know about life at JLT Group and what makes us different:</p>
<p style="text-align:center;margin:28px 0;">
  <a href="${PROSPECTUS_URL}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:700;padding:15px 36px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;font-size:15px;">Read the JLT Prospectus</a>
</p>
<p style="margin:0 0 16px;">We also have a fantastic Facebook community where current agents and prospective members connect, share tips, and get a real feel for the JLT culture:</p>
<p style="text-align:center;margin:28px 0;">
  <a href="${FACEBOOK_GROUP_URL}" style="display:inline-block;background:#414141;color:#ffffff;font-weight:700;padding:15px 36px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;font-size:15px;">Join the JLT Facebook Community</a>
</p>
<hr style="border:none;border-top:1px solid #e8e8e8;margin:28px 0;"/>
<p style="margin:0 0 12px;"><strong>Ready for the next step?</strong></p>
<p style="margin:0 0 16px;">Once you have read the prospectus, complete a short application form so we can organise a discovery call tailored to you:</p>
<p style="text-align:center;margin:28px 0;">
  <a href="${applicationUrl}" style="display:inline-block;background:#70FFE8;color:#414141;font-weight:700;padding:15px 36px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;font-size:15px;">Complete Your Application</a>
</p>
<p style="margin:0;">Warm regards,<br/><strong>The JLT Group Team</strong></p>`;
            const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Your JLT Group Prospectus</title></head><body style="margin:0;padding:0;background-color:#FFF6ED;font-family:'Poppins',Arial,sans-serif;"><div style="width:100%;background-color:#FFF6ED;padding:32px 0;"><div style="max-width:600px;width:100%;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07);"><div style="background-color:#70FFE8;padding:28px 40px;text-align:center;">${logoHtml}</div><div style="padding:36px 40px;color:#414141;font-family:'Poppins',Arial,sans-serif;font-size:15px;line-height:1.8;">${bodyHtml}</div><div style="padding:20px 40px;text-align:center;background-color:#FFF6ED;font-family:'Poppins',Arial,sans-serif;font-size:12px;color:#888;">&copy; ${new Date().getFullYear()} JLT Group. All rights reserved.</div></div></div></body></html>`;
            await resend.emails.send({
              from: PROSPECT_FROM,
              to: [prospectInput.email],
              replyTo: PROSPECT_REPLY_TO,
              subject: "Your JLT Group Prospectus",
              html,
            });
          }
          // Lead attribution recorded — no owner notification needed (visible in recruitment pipeline)
        } catch (e) {
          console.warn("[CRM] Failed to process referral enquiry:", e);
        }
        return { success: true, prospectId: prospect?.id };
      }),
  }),

  // ── Agent Application (AR) Form ────────────────────────────────────────────

  arForm: router({
    // Public: submit AR form (prospect fills this in)
    submit: publicProcedure
      .input(
        z.object({
          prospectId: z.number().int(),
          whyInterested: z.string().optional(),
          isSelfEmployed: z.string().optional(),
          hasTravelExperience: z.string().optional(),
          travelExperienceDetails: z.string().optional(),
          currentJob: z.string().optional(),
          businessGoal12Months: z.string().optional(),
          travelSpecialisation: z.string().optional(),
          weeklyHours: z.string().optional(),
          hasHomeSupport: z.string().optional(),
          investmentReadiness: z.string().optional(),
          understandsSelfEmployed: z.string().optional(),
          biggestHesitation: z.string().optional(),
          techConfidence: z.string().optional(),
          financialReadiness: z.string().optional(),
          twoYearVision: z.string().optional(),
          hearAboutUs: z.string().optional(),
          hearAboutUsDetails: z.string().optional(),
          lookingAtOtherAgencies: z.string().optional(),
          otherAgenciesDetails: z.string().optional(),
          confirmationAccepted: z.boolean().default(false),
        })
      )
      .mutation(async ({ input }) => {
        const prospect = await getProspectById(input.prospectId);
        if (!prospect) throw new TRPCError({ code: "NOT_FOUND", message: "Prospect not found" });
        await createArForm(input);
        // Move to AR Submitted stage
        await moveProspectStage(input.prospectId, "AR Submitted", null, "AR form submitted by prospect");
        return { success: true };
      }),

    // Admin: list AR forms for a prospect
    list: adminProcedure
      .input(z.object({ prospectId: z.number().int() }))
      .query(async ({ input }) => getArFormsByProspect(input.prospectId)),

    // Admin: review (approve/reject) an AR form
    review: adminProcedure
      .input(
        z.object({
          formId: z.number().int(),
          prospectId: z.number().int(),
          reviewStatus: z.enum(["approved", "rejected"]),
          reviewNotes: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        await reviewArForm(input.formId, input.reviewStatus, input.reviewNotes ?? null, ctx.user.id);
        const newStage: ProspectStage =
          input.reviewStatus === "approved" ? "AR Approved" : "Rejected";
        await moveProspectStage(input.prospectId, newStage, ctx.user.id, input.reviewNotes);
        return { success: true };
      }),
  }),

  // ── Supplier Logins ────────────────────────────────────────────────────────

  supplierLogins: router({
    list: adminProcedure
      .input(z.object({ prospectId: z.number().int() }))
      .query(async ({ input }) => getSupplierLoginsByProspect(input.prospectId)),

    add: adminProcedure
      .input(
        z.object({
          prospectId: z.number().int(),
          supplierName: z.string().min(1),
          username: z.string().optional(),
          password: z.string().optional(),
          loginUrl: z.string().url().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const id = await addSupplierLogin(input);
        return { success: true, id };
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          supplierName: z.string().optional(),
          username: z.string().optional(),
          password: z.string().optional(),
          loginUrl: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateSupplierLogin(id, data);
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteSupplierLogin(input.id);
        return { success: true };
      }),
  }),

  // ── Contract Templates ─────────────────────────────────────────────────────

  contractTemplates: router({
    list: adminProcedure.query(async () => getAllContractTemplates()),

    getActive: adminProcedure.query(async () => getActiveContractTemplate()),

    upload: adminProcedure
      .input(
        z.object({
          name: z.string().min(1),
          fileBase64: z.string(),
          fileName: z.string(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const buf = Buffer.from(input.fileBase64, "base64");
        const key = `crm/contracts/templates/${nanoid(12)}-${input.fileName}`;
        const { url } = await storagePut(key, buf, "application/pdf");
        const id = await createContractTemplate({
          name: input.name,
          pdfUrl: url,
          pdfKey: key,
          uploadedById: ctx.user.id,
        });
        return { success: true, id, url };
      }),
  }),

  // ── Contract Signing ───────────────────────────────────────────────────────

  contracts: router({
    // Admin: send signing link to prospect
    sendSigningLink: adminProcedure
      .input(
        z.object({
          prospectId: z.number().int(),
          origin: z.string().url(),
        })
      )
      .mutation(async ({ input }) => {
        const prospect = await getProspectById(input.prospectId);
        if (!prospect) throw new TRPCError({ code: "NOT_FOUND", message: "Prospect not found" });
        const template = await getActiveContractTemplate();
        if (!template) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No active contract template. Please upload one first." });
        const token = nanoid(48);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        const contractId = await createProspectContract({
          prospectId: input.prospectId,
          templateId: template.id,
          signingToken: token,
          signingTokenExpiresAt: expiresAt,
        });
        const signingUrl = `${input.origin}/sign-contract/${token}`;
        // Send email
        try {
          await sendDirectEmail({
            toEmail: prospect.email,
            toName: `${prospect.firstName} ${prospect.lastName}`,
            subject: "Your JLT Group Contract — Action Required",
            html: `<p>Hi ${prospect.firstName},</p>
<p>Congratulations on being approved to join the JLT Group travel agency network!</p>
<p>Please review and sign your contract using the link below. This link is valid for 7 days.</p>
<p><a href="${signingUrl}" style="background:#70FFE8;color:#414141;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;">Review & Sign Contract</a></p>
<p>If you have any questions, please contact us.</p>
<p>Best regards,<br/>The JLT Group Team</p>`,
          });
          await markContractSent(contractId);
        } catch (e) {
          console.warn("[CRM] Failed to send contract email:", e);
        }
        return { success: true, contractId, signingUrl };
      }),

    // Public: get contract for signing (by token)
    getByToken: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const contract = await getContractByToken(input.token);
        if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found or link has expired" });
        if (contract.signedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "This contract has already been signed" });
        if (contract.signingTokenExpiresAt && contract.signingTokenExpiresAt < new Date()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This signing link has expired. Please contact JLT Group." });
        }
        // Get template PDF URL
        const { getAllContractTemplates } = await import("./crm-db");
        const templates = await getAllContractTemplates();
        const template = templates.find((t) => t.id === contract.templateId);
        return {
          contractId: contract.id,
          prospectId: contract.prospectId,
          templatePdfUrl: template?.pdfUrl ?? null,
          alreadySigned: !!contract.signedAt,
        };
      }),

    // Public: submit signed contract
    sign: publicProcedure
      .input(
        z.object({
          token: z.string(),
          signerName: z.string().min(1),
          signerAddress: z.string().min(1),
          signatureDataUrl: z.string().min(1), // base64 canvas image
          origin: z.string().url(),
          consentConfirmed: z.boolean().optional(),
          signingUserAgent: z.string().optional(),
          contractTextSnapshot: z.string().optional(), // full HTML of contract at time of signing
        })
      )
      .mutation(async ({ input, ctx }) => {
        const contract = await getContractByToken(input.token);
        if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
        if (contract.signedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Already signed" });
        if (contract.signingTokenExpiresAt && contract.signingTokenExpiresAt < new Date()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Signing link expired" });
        }

        // Capture IP address from request
        const signingIp = (ctx.req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
          ?? ctx.req.socket?.remoteAddress
          ?? null;

        // Store signature image to S3
        const sigBuf = Buffer.from(input.signatureDataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
        const sigKey = `crm/contracts/signatures/${contract.id}-${nanoid(8)}.png`;
        const { url: sigUrl } = await storagePut(sigKey, sigBuf, "image/png");

        // Generate tamper-detection hash: SHA-256 of (contractText + signatureDataUrl + signedAt ISO)
        const { createHash } = await import("crypto");
        const signedAtIso = new Date().toISOString();
        const hashInput = [
          input.contractTextSnapshot ?? "",
          input.signatureDataUrl,
          signedAtIso,
          input.signerName,
          signingIp ?? "",
        ].join("|");
        const contractHash = createHash("sha256").update(hashInput).digest("hex");

        // For now store the signature URL as the "signed PDF" — a proper PDF overlay can be added later
        await signContract(contract.id, {
          signerName: input.signerName,
          signerAddress: input.signerAddress,
          signatureDataUrl: sigUrl,
          signedPdfUrl: sigUrl, // placeholder until PDF generation is added
          signedPdfKey: sigKey,
          signingIp,
          signingUserAgent: input.signingUserAgent ?? null,
          consentConfirmed: input.consentConfirmed ?? false,
          contractTextSnapshot: input.contractTextSnapshot ?? null,
          contractHash,
        });

        // Move prospect to Approved stage
        const prospect = await getProspectById(contract.prospectId);
        if (prospect && prospect.stage !== "Approved" && prospect.stage !== "Won") {
          await moveProspectStage(contract.prospectId, "Approved", null, "Contract signed by prospect");
        }

        // Email confirmation to prospect
        if (prospect) {
          try {
            const paymentConfig = await getPaymentConfig();
            const stripeUrl = paymentConfig?.stripeJoiningFeeUrl ?? "#";
            await sendDirectEmail({
              toEmail: prospect.email,
              toName: input.signerName,
              subject: "Contract Signed — Next Steps",
              html: `<p>Hi ${input.signerName},</p>
<p>Thank you for signing your JLT Group contract. A copy has been stored securely.</p>
<p>Your next step is to pay your joining fee of <strong>£297</strong>. Please click the button below to complete your payment:</p>
<p><a href="${stripeUrl}" style="background:#70FFE8;color:#414141;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;">Pay Joining Fee — £297</a></p>
<p>Once payment is confirmed, you'll receive access to the JLT Group portal and instructions for your next steps.</p>
<p>Best regards,<br/>The JLT Group Team</p>`,
            });
          } catch (e) {
            console.warn("[CRM] Failed to send post-sign email:", e);
          }
        }

        // Return the Stripe joining fee URL so the frontend can redirect directly to payment
        const paymentConfigForRedirect = await getPaymentConfig();
        const joiningFeeUrl = paymentConfigForRedirect?.stripeJoiningFeeUrl;
        return {
          success: true,
          redirectUrl: joiningFeeUrl ?? `${input.origin}/payment-complete`,
          hasPaymentUrl: !!joiningFeeUrl,
        };
      }),

    // Admin: list contracts for a prospect
    list: adminProcedure
      .input(z.object({ prospectId: z.number().int() }))
      .query(async ({ input }) => getContractsByProspect(input.prospectId)),
  }),

  // ── Email Campaigns ────────────────────────────────────────────────────────

  // ── Commission Remittances ─────────────────────────────────────────────────

  remittances: router({
    list: adminProcedure.query(async () => getAllRemittances()),

    get: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .query(async ({ input }) => {
        const r = await getRemittanceById(input.id);
        if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Remittance not found" });
        const items = await getRemittanceItems(input.id);
        return { ...r, items };
      }),

    // Admin: upload CSV remittance
    upload: adminProcedure
      .input(
        z.object({
          filename: z.string(),
          periodLabel: z.string().optional(),
          csvBase64: z.string(),
          // Parsed rows from the CSV (client-side parsed)
          rows: z.array(
            z.object({
              agentCode: z.string().optional(),
              agentName: z.string().optional(),
              amount: z.string(),
              bookingRef: z.string().optional(),
              description: z.string().optional(),
            })
          ),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // Upload CSV to S3
        const csvBuf = Buffer.from(input.csvBase64, "base64");
        const csvKey = `crm/remittances/${nanoid(12)}-${input.filename}`;
        const { url: csvUrl } = await storagePut(csvKey, csvBuf, "text/csv");

        const remittanceId = await createRemittance({
          uploadedById: ctx.user.id,
          filename: input.filename,
          csvUrl,
          csvKey,
          periodLabel: input.periodLabel,
        });

        // Match agents by agentCode (uniqueAgentId)
        const allUsers = await getAllUsers();
        const allProspects = await (await import("./crm-db")).getAllProspects();

        const items = input.rows.map((row) => {
          // Try to match by uniqueAgentId or name
          const matchedProspect = allProspects.find(
            (p) =>
              (row.agentCode && p.uniqueAgentId === row.agentCode) ||
              (row.agentName && `${p.firstName} ${p.lastName}`.toLowerCase() === row.agentName.toLowerCase())
          );
          const matchedUser = allUsers.find(
            (u) => row.agentName && u.name?.toLowerCase() === row.agentName.toLowerCase()
          );
          return {
            remittanceId,
            agentId: matchedUser?.id ?? undefined,
            agentCode: row.agentCode,
            agentName: row.agentName,
            amount: row.amount,
            bookingRef: row.bookingRef,
            description: row.description,
          };
        });

        await createRemittanceItems(items);

        // Send in-app notifications to matched agents
        for (const item of items) {
          if (item.agentId) {
            try {
              await createInAppNotification({
                userId: item.agentId,
                message: `Commission remittance for ${input.periodLabel ?? "this period"} is ready. Amount: £${item.amount}`,
                linkUrl: "/my-commissions",
              });
            } catch (e) {
              console.warn("[CRM] Failed to send remittance notification:", e);
            }
          }
        }

        return { success: true, remittanceId, itemCount: items.length };
      }),

    // Agent: get their own remittance items
    myItems: protectedProcedure.query(async ({ ctx }) => {
      return getRemittanceItemsByAgent(ctx.user.id);
    }),
  }),

  // ── Payment Config ─────────────────────────────────────────────────────────

  paymentConfig: router({
    get: adminProcedure.query(async () => getPaymentConfig()),

    upsert: adminProcedure
      .input(
        z.object({
          stripeJoiningFeeUrl: z.string().url().optional().nullable(),
          businessClassDay1Url: z.string().url().optional().nullable(),
          businessClassDay15Url: z.string().url().optional().nullable(),
          businessClassDay28Url: z.string().url().optional().nullable(),
          firstClassDay1Url: z.string().url().optional().nullable(),
          firstClassDay15Url: z.string().url().optional().nullable(),
          firstClassDay28Url: z.string().url().optional().nullable(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const config = await upsertPaymentConfig({
          stripeJoiningFeeUrl: input.stripeJoiningFeeUrl ?? undefined,
          businessClassDay1Url: input.businessClassDay1Url ?? undefined,
          businessClassDay15Url: input.businessClassDay15Url ?? undefined,
          businessClassDay28Url: input.businessClassDay28Url ?? undefined,
          firstClassDay1Url: input.firstClassDay1Url ?? undefined,
          firstClassDay15Url: input.firstClassDay15Url ?? undefined,
          firstClassDay28Url: input.firstClassDay28Url ?? undefined,
          updatedById: ctx.user.id,
        });
        return config;
      }),

    // Public: get GoCardless redirect URL for chosen tier + payment date
    getDirectDebitUrl: publicProcedure
      .input(
        z.object({
          tier: z.enum(["business_class", "first_class"]),
          paymentDay: z.enum(["1", "15", "28"]),
        })
      )
      .query(async ({ input }) => {
        const config = await getPaymentConfig();
        if (!config) throw new TRPCError({ code: "NOT_FOUND", message: "Payment configuration not set up yet" });
        const key = `${input.tier === "business_class" ? "businessClass" : "firstClass"}Day${input.paymentDay}Url` as keyof typeof config;
        const url = config[key] as string | null;
        if (!url) throw new TRPCError({ code: "NOT_FOUND", message: "Payment link not configured for this option" });
        return { url };
      }),
  }),

  // ─── GoCardless Mandate Sync ─────────────────────────────────────────────
  mandateSync: router({
    // Sync all local gc_mandates rows against the live GoCardless API
    // Updates status for any mandate that has a mandateId stored
    sync: adminProcedure.mutation(async () => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { gcMandates } = await import("../drizzle/schema");
      const { isNotNull, eq } = await import("drizzle-orm");
      const { getMandate } = await import("./gocardless");

      // Fetch all local mandate rows that have a GoCardless mandateId
      const rows = await db
        .select({ id: gcMandates.id, mandateId: gcMandates.mandateId, status: gcMandates.status })
        .from(gcMandates)
        .where(isNotNull(gcMandates.mandateId));

      let updated = 0;
      let unchanged = 0;
      let failed = 0;

      for (const row of rows) {
        if (!row.mandateId) continue;
        try {
          const live = await getMandate(row.mandateId);
          if (live.status !== row.status) {
            await db
              .update(gcMandates)
              .set({ status: live.status as any, updatedAt: new Date() })
              .where(eq(gcMandates.id, row.id));
            updated++;
          } else {
            unchanged++;
          }
        } catch (err) {
          console.error(`[MandateSync] Failed for ${row.mandateId}:`, err);
          failed++;
        }
      }

      return { total: rows.length, updated, unchanged, failed };
    }),

    // Get a summary of mandate statuses across all agents
    summary: adminProcedure.query(async () => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return { total: 0, active: 0, pending: 0, cancelled: 0, failed: 0, other: 0 };
      const { gcMandates } = await import("../drizzle/schema");
      const { isNotNull } = await import("drizzle-orm");
      const rows = await db
        .select({ status: gcMandates.status })
        .from(gcMandates)
        .where(isNotNull(gcMandates.mandateId));
      const counts = { total: rows.length, active: 0, pending: 0, cancelled: 0, failed: 0, other: 0 };
      for (const r of rows) {
        if (r.status === "active") counts.active++;
        else if (r.status === "pending" || r.status === "pending_submission" || r.status === "submitted") counts.pending++;
        else if (r.status === "cancelled" || r.status === "expired") counts.cancelled++;
        else if (r.status === "failed") counts.failed++;
        else counts.other++;
      }
      return counts;
    }),
  }),

  // ─── Agent CRM (registered portal agents) ────────────────────────────────
  agentCrm: router({
    list: adminProcedure.query(async () => {
      return listAgentsWithCrm();
    }),
    listTags: adminProcedure.query(async () => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return [] as string[];
      const { agentTags } = await import("../drizzle/schema");
      const rows = await db.selectDistinct({ tag: agentTags.tag }).from(agentTags).orderBy(agentTags.tag);
      return rows.map((r) => r.tag);
    }),

    get: adminProcedure
      .input(z.object({ userId: z.number().int() }))
      .query(async ({ input }) => {
        // Run DB queries in parallel — any failure here is a hard error
        const [profile, tags, supplierLogins] = await Promise.all([
          getAgentCrmProfile(input.userId),
          getAgentTags(input.userId),
          getAgentSupplierLogins(input.userId),
        ]);

        // Decrypt bank details — wrapped so a JWT_SECRET mismatch between environments
        // doesn't crash the whole procedure (bank fields will be null instead)
        const decryptedProfile = profile ? await decryptAgentBankDetails(profile) : null;

        // Decrypt supplier passwords — already safe (try/catch inside decryptSupplierPassword)
        const decryptedLogins = supplierLogins.map((l) => ({
          ...l,
          password: decryptSupplierPassword(l),
        }));

        // Fetch join session contract data — optional, failure returns null
        let contractData: {
          signatureDataUrl?: string | null;
          signerName?: string | null;
          signerAddress?: string | null;
          contractSignedAt?: Date | null;
          ipAddress?: string | null;
          signingUserAgent?: string | null;
          consentConfirmed?: boolean | null;
          contractTextSnapshot?: string | null;
          contractHash?: string | null;
        } | null = null;
        try {
          const { getDb } = await import("./db");
          const db = await getDb();
          if (db) {
            const { joinSessions } = await import("../drizzle/schema");
            const { eq } = await import("drizzle-orm");
            const sessions = await db
              .select({
                signerName: joinSessions.signerName,
                signerAddress: joinSessions.signerAddress,
                contractSignedAt: joinSessions.contractSignedAt,
                signatureDataUrl: joinSessions.signatureDataUrl,
                ipAddress: joinSessions.ipAddress,
                signingUserAgent: joinSessions.signingUserAgent,
                consentConfirmed: joinSessions.consentConfirmed,
                contractTextSnapshot: joinSessions.contractTextSnapshot,
                contractHash: joinSessions.contractHash,
              })
              .from(joinSessions)
              .where(eq(joinSessions.userId, input.userId))
              .limit(1);
            if (sessions[0]) contractData = sessions[0];
          }
        } catch (err) {
          console.error("[CRM] Failed to fetch contract data for user", input.userId, err);
        }

        return { profile: decryptedProfile, tags, supplierLogins: decryptedLogins, contractData };
      }),

    updateProfile: adminProcedure
      .input(
        z.object({
          userId: z.number().int(),
          jltEmail: z.string().email().optional().nullable(),
          personalEmail: z.string().email().optional().nullable(),
          businessEmail: z.string().email().optional().nullable(),
          mobile: z.string().optional().nullable(),
          addressLine1: z.string().optional().nullable(),
          addressLine2: z.string().optional().nullable(),
          city: z.string().optional().nullable(),
          postcode: z.string().optional().nullable(),
          ukRegion: z.string().optional().nullable(),
          bankAccountName: z.string().optional().nullable(),
          bankSortCode: z.string().optional().nullable(),
          bankAccountNumber: z.string().optional().nullable(),
          adminNotes: z.string().optional().nullable(),
          agentStatus: z.string().optional().nullable(),
          membershipTier: z.string().optional().nullable(),
          businessName: z.string().optional().nullable(),
          retailerCode: z.string().optional().nullable(),
          introducedBy: z.string().optional().nullable(),
          dateJoined: z.string().optional().nullable(),
          monthlySub: z.string().optional().nullable(),
          internalNotes: z.string().optional().nullable(),
          trainingStage: z.string().optional().nullable(),
          orbitEnabled: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { userId, ...data } = input;
        await upsertAgentCrmProfile(userId, data as any);
        return { success: true };
      }),

    // Admin: toggle Orbit access for a specific agent
    toggleOrbitAccess: adminProcedure
      .input(z.object({ userId: z.number().int(), enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        await upsertAgentCrmProfile(input.userId, { orbitEnabled: input.enabled });

        // Send automated email when Orbit access is turned ON
        if (input.enabled) {
          try {
            const { getDb } = await import("./db");
            const db = await getDb();
            if (db) {
              const { users: usersTable } = await import("../drizzle/schema");
              const { eq } = await import("drizzle-orm");
              const [agent] = await db
                .select({ name: usersTable.name, email: usersTable.email })
                .from(usersTable)
                .where(eq(usersTable.id, input.userId))
                .limit(1);
              if (agent?.email) {
                await sendDirectEmail({
                  toEmail: agent.email,
                  toName: agent.name ?? "Agent",
                  subject: "Your Orbit Account is Now Live",
                  html: `
                    <div style="font-family:'Poppins',Arial,sans-serif;max-width:620px;margin:0 auto;background:#FFF6ED;padding:32px;border-radius:12px;">
                      <div style="text-align:center;margin-bottom:24px;">
                        <h1 style="color:#414141;font-size:22px;margin:0;">JLT Group</h1>
                        <div style="width:60px;height:4px;background:#70FFE8;margin:10px auto 0;"></div>
                      </div>
                      <p style="color:#414141;">Hi ${agent.name ?? "there"},</p>
                      <p style="color:#414141;">Great news &mdash; your <strong>Orbit account is now live</strong> and ready to use.</p>

                      <div style="background:#fff;border:2px solid #70FFE8;border-radius:8px;padding:20px 24px;margin:24px 0;">
                        <p style="color:#414141;font-weight:700;font-size:15px;margin:0 0 12px;">&#128196; How to Access Orbit</p>
                        <p style="color:#414141;margin:0 0 8px;">Log in to the JLT Group Booking Portal and look for the <strong>&ldquo;Open Orbit&rdquo;</strong> button in the <strong>left-hand sidebar</strong>.</p>
                        <p style="color:#414141;margin:0;">Clicking it will open Orbit directly in your browser.</p>
                      </div>

                      <div style="background:#fee2e2;border:2px solid #f87171;border-radius:8px;padding:20px 24px;margin:24px 0;">
                        <p style="color:#991b1b;font-weight:700;font-size:15px;margin:0 0 8px;">&#9888;&#65039; Important &mdash; Live Booking System</p>
                        <p style="color:#991b1b;margin:0;">Orbit is a <strong>live booking system</strong>. Any bookings, quotes, or changes you make are real and will be processed immediately. Please ensure you are confident before confirming any transactions.</p>
                      </div>

                      <p style="color:#414141;">If you have any questions or need assistance getting started, please don&rsquo;t hesitate to contact the JLT Group team.</p>
                      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
                      <p style="color:#888;font-size:12px;text-align:center;">JLT Group Booking Portal &mdash; <a href="https://portal.thejltgroup.co.uk" style="color:#02E6D2;">portal.thejltgroup.co.uk</a></p>
                    </div>
                  `,
                });
              }
            }
          } catch (emailErr) {
            console.error("[Orbit] Failed to send Orbit access email:", emailErr);
            // Non-fatal — access is still granted even if email fails
          }
        }

        return { success: true, orbitEnabled: input.enabled };
      }),

    // Returns all orbit-enabled agents with a flag for whether they have an Aviate supplier login
    // Returns orbit-enabled agents with full Aviate login details (id, username, welcomeEmailSentAt)
    listOrbitAgents: adminProcedure.query(async () => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return [] as { userId: number; hasAviate: boolean; aviateLoginId: number | null; aviateUsername: string | null; welcomeEmailSentAt: Date | null }[];
      const { agentCrmProfiles, agentSupplierLogins } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const orbitProfiles = await db
        .select({ userId: agentCrmProfiles.userId })
        .from(agentCrmProfiles)
        .where(eq(agentCrmProfiles.orbitEnabled, true));
      const orbitUserIds = orbitProfiles.map((p) => p.userId);
      if (orbitUserIds.length === 0) return [];
      const aviateLogins = await db
        .select({ id: agentSupplierLogins.id, userId: agentSupplierLogins.userId, username: agentSupplierLogins.username, welcomeEmailSentAt: agentSupplierLogins.welcomeEmailSentAt })
        .from(agentSupplierLogins)
        .where(eq(agentSupplierLogins.supplierName, "Aviate"));
      const aviateMap = new Map(aviateLogins.map((l) => [l.userId, l]));
      return orbitUserIds.map((userId) => {
        const login = aviateMap.get(userId) ?? null;
        return {
          userId,
          hasAviate: !!login,
          aviateLoginId: login?.id ?? null,
          aviateUsername: login?.username ?? null,
          welcomeEmailSentAt: login?.welcomeEmailSentAt ?? null,
        };
      });
    }),

    updateAviateUsername: adminProcedure
      .input(z.object({ loginId: z.number().int(), username: z.string() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { agentSupplierLogins } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(agentSupplierLogins).set({ username: input.username || null }).where(eq(agentSupplierLogins.id, input.loginId));
        return { success: true };
      }),

    bulkSendAviateWelcome: adminProcedure
      .input(z.object({ instructions: z.string().optional() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { agentSupplierLogins, users: usersTable } = await import("../drizzle/schema");
        const { eq, and, isNull, isNotNull } = await import("drizzle-orm");
        // Find all Aviate logins with a username set but welcome email not yet sent
        const pending = await db
          .select({
            id: agentSupplierLogins.id,
            userId: agentSupplierLogins.userId,
            username: agentSupplierLogins.username,
          })
          .from(agentSupplierLogins)
          .where(
            and(
              eq(agentSupplierLogins.supplierName, "Aviate"),
              isNotNull(agentSupplierLogins.username),
              isNull(agentSupplierLogins.welcomeEmailSentAt)
            )
          );
        if (pending.length === 0) return { sent: 0, skipped: 0 };
        // Fetch agent details
        const userIds = pending.map((p) => p.userId);
        const agentRows = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable);
        const agentMap = new Map(agentRows.map((a) => [a.id, a]));
        // Build Resend client
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY ?? "");
        let sent = 0;
        let skipped = 0;
        const now = new Date();
        for (const login of pending) {
          const agent = agentMap.get(login.userId);
          if (!agent?.email) { skipped++; continue; }
          const instructionsHtml = (input.instructions ?? "").replace(/\n/g, "<br>");
          try {
            await resend.emails.send({
              from: "JLT Group <support@mail.thejltgroup.co.uk>",
              replyTo: "support@thejltgroup.co.uk",
              to: agent.email,
              subject: "Your Aviate Login Details",
              html: `
                <div style="font-family:'Poppins',Arial,sans-serif;max-width:620px;margin:0 auto;background:#FFF6ED;padding:32px;border-radius:12px;">
                  <div style="text-align:center;margin-bottom:24px;">
                    <h1 style="color:#414141;font-size:22px;margin:0;">JLT Group</h1>
                    <div style="width:60px;height:4px;background:#70FFE8;margin:10px auto 0;"></div>
                  </div>
                  <p style="color:#414141;">Hi ${agent.name ?? "there"},</p>
                  <p style="color:#414141;">Your Aviate login has been set up. Your username is:</p>
                  <div style="background:#fff;border:2px solid #70FFE8;border-radius:8px;padding:16px 24px;margin:20px 0;text-align:center;">
                    <span style="font-size:20px;font-weight:700;color:#414141;letter-spacing:1px;">${login.username}</span>
                  </div>

                  <!-- Password setup instructions -->
                  <div style="background:#fff3cd;border:2px solid #f59e0b;border-radius:8px;padding:20px 24px;margin:24px 0;">
                    <p style="color:#92400e;font-weight:700;font-size:15px;margin:0 0 12px;">&#9888;&#65039; Important: Password Setup Instructions</p>
                    <p style="color:#414141;margin:0 0 12px;">To set your password for <strong>Travel Innovation Group access (Aviate, Lime &amp; VA Flight Store)</strong>, you <strong>must</strong> follow the instructions below exactly:</p>
                    <table style="width:100%;border-collapse:collapse;">
                      <tr style="background:#fef9c3;">
                        <td style="padding:10px 14px;border-bottom:1px solid #fde68a;font-size:14px;color:#414141;">&#10003;&nbsp; Minimum <strong>8 characters</strong></td>
                      </tr>
                      <tr>
                        <td style="padding:10px 14px;border-bottom:1px solid #fde68a;font-size:14px;color:#414141;">&#10003;&nbsp; Must <strong>start with @</strong></td>
                      </tr>
                      <tr style="background:#fef9c3;">
                        <td style="padding:10px 14px;border-bottom:1px solid #fde68a;font-size:14px;color:#414141;">&#10003;&nbsp; Followed by a <strong>capital letter</strong></td>
                      </tr>
                      <tr>
                        <td style="padding:10px 14px;border-bottom:1px solid #fde68a;font-size:14px;color:#414141;">&#10003;&nbsp; Must include <strong>2 numbers</strong></td>
                      </tr>
                      <tr style="background:#fef9c3;">
                        <td style="padding:10px 14px;font-size:14px;color:#414141;">&#10003;&nbsp; Must <strong>end with a special character</strong> (e.g. <strong>!</strong>)</td>
                      </tr>
                    </table>
                    <div style="background:#d1fae5;border:1px solid #6ee7b7;border-radius:6px;padding:12px 16px;margin-top:14px;">
                      <p style="color:#065f46;font-weight:700;margin:0 0 4px;">&#128994; Example of a valid password:</p>
                      <p style="color:#065f46;font-family:monospace;font-size:16px;margin:0;">@Capital12!</p>
                    </div>
                    <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;padding:12px 16px;margin-top:10px;">
                      <p style="color:#991b1b;font-weight:700;margin:0;">&#128308; The strength bar must go <u>fully green</u> before you can save your password. If the bar is not fully green, your password will not be accepted.</p>
                    </div>
                  </div>

                  <!-- How to set your password -->
                  <div style="background:#f0f9ff;border:2px solid #38bdf8;border-radius:8px;padding:20px 24px;margin:24px 0;">
                    <p style="color:#0c4a6e;font-weight:700;font-size:15px;margin:0 0 12px;">&#128274; How to Set Your Password</p>
                    <ol style="color:#414141;margin:0;padding-left:20px;line-height:1.8;">
                      <li>Go to <a href="https://www.aviateworld.com/" style="color:#0284c7;font-weight:600;">www.aviateworld.com</a></li>
                      <li>Click <strong>Login</strong></li>
                      <li>Click <strong>Aviate Flights Login</strong></li>
                      <li>Click <strong>Forgotten Password</strong> and follow the prompts</li>
                    </ol>
                  </div>

                  ${instructionsHtml ? `<div style="color:#414141;margin-top:16px;">${instructionsHtml}</div>` : ""}
                  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
                  <p style="color:#888;font-size:12px;text-align:center;">JLT Group Booking Portal &mdash; <a href="https://portal.thejltgroup.co.uk" style="color:#02E6D2;">portal.thejltgroup.co.uk</a></p>
                </div>
              `,
            });
            // Mark as sent
            await db.update(agentSupplierLogins).set({ welcomeEmailSentAt: now }).where(eq(agentSupplierLogins.id, login.id));
            sent++;
          } catch (err) {
            console.error(`[Aviate] Failed to send welcome email to ${agent.email}:`, err);
            skipped++;
          }
        }
        return { sent, skipped };
      }),

    toggleAviateLogin: adminProcedure
      .input(z.object({ userId: z.number().int(), enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { agentSupplierLogins } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        if (input.enabled) {
          // Only add if not already present
          const existing = await db
            .select({ id: agentSupplierLogins.id })
            .from(agentSupplierLogins)
            .where(and(eq(agentSupplierLogins.userId, input.userId), eq(agentSupplierLogins.supplierName, "Aviate")));
          if (existing.length === 0) {
            await db.insert(agentSupplierLogins).values({ userId: input.userId, supplierName: "Aviate" });
          }
        } else {
          await db
            .delete(agentSupplierLogins)
            .where(and(eq(agentSupplierLogins.userId, input.userId), eq(agentSupplierLogins.supplierName, "Aviate")));
        }
        return { success: true, enabled: input.enabled };
      }),

    assignAgentId: adminProcedure
      .input(z.object({ userId: z.number().int() }))
      .mutation(async ({ input }) => {
        const existing = await getAgentCrmProfile(input.userId);
        if (existing?.uniqueAgentId) return { uniqueAgentId: existing.uniqueAgentId };
        const id = await generateUniqueAgentIdForUser();
        await upsertAgentCrmProfile(input.userId, { uniqueAgentId: id });
        return { uniqueAgentId: id };
      }),

    uploadIdDoc: adminProcedure
      .input(
        z.object({
          userId: z.number().int(),
          fileBase64: z.string(),
          fileName: z.string(),
          mimeType: z.string(),
          docType: z.enum(["id", "proof_of_address"]),
        })
      )
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const key = `agent-docs/${input.userId}/${input.docType}-${Date.now()}-${input.fileName}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        if (input.docType === "id") {
          await upsertAgentCrmProfile(input.userId, { idDocUrl: url, idDocKey: key });
        } else {
          await upsertAgentCrmProfile(input.userId, { proofOfAddressUrl: url, proofOfAddressKey: key });
        }
        return { url };
      }),

    addTag: adminProcedure
      .input(z.object({ userId: z.number().int(), tag: z.string().min(1) }))
      .mutation(async ({ input }) => {
        await addAgentTag(input.userId, input.tag);
        return { success: true };
      }),

    removeTag: adminProcedure
      .input(z.object({ userId: z.number().int(), tag: z.string().min(1) }))
      .mutation(async ({ input }) => {
        await removeAgentTag(input.userId, input.tag);
        return { success: true };
      }),

    addSupplierLogin: adminProcedure
      .input(
        z.object({
          userId: z.number().int(),
          supplierName: z.string().min(1),
          loginUrl: z.string().optional(),
          username: z.string().optional(),
          password: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { userId, ...data } = input;
        const id = await addAgentSupplierLogin(userId, data);
        return { id };
      }),

    updateSupplierLogin: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          supplierName: z.string().optional(),
          loginUrl: z.string().optional(),
          username: z.string().optional(),
          password: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateAgentSupplierLogin(id, data);
        return { success: true };
      }),

    deleteSupplierLogin: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteAgentSupplierLogin(input.id);
        return { success: true };
      }),

    // ── Activity tab — pulls live portal data for a given agent ──────────────
    getActivity: adminProcedure
      .input(z.object({ userId: z.number().int() }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const {
          bookings, commissionClaims, refunds, reimbursementItems,
        } = await import("../drizzle/schema");
        const { eq, and, sum, count, desc } = await import("drizzle-orm");

        const [bookingRows, commissionRows, refundRows, reimbRows] = await Promise.all([
          db.select().from(bookings).where(eq(bookings.agentId, input.userId)).orderBy(desc(bookings.createdAt)).limit(200),
          db.select().from(commissionClaims).where(eq(commissionClaims.agentId, input.userId)).orderBy(desc(commissionClaims.createdAt)),
          db.select().from(refunds).where(eq(refunds.agentId, input.userId)).orderBy(desc(refunds.createdAt)),
          db.select().from(reimbursementItems).where(eq(reimbursementItems.agentId, input.userId)).orderBy(desc(reimbursementItems.createdAt)),
        ]);

        // Booking stats
        const totalBookings = bookingRows.length;
        const activeBookings = bookingRows.filter(b => b.currentStage !== "Cancelled" && b.currentStage !== "Completed").length;
        const totalBookingValue = bookingRows.reduce((s, b) => s + parseFloat(String(b.grossCost ?? 0)), 0);
        const lastBookingDate = bookingRows[0]?.createdAt ?? null;

        // Commission stats
        const totalCommissionClaimed = commissionRows.reduce((s, c) => s + parseFloat(String(c.grossAmount ?? 0)), 0);
        const totalCommissionPaid = commissionRows.filter(c => c.status === "paid").reduce((s, c) => s + parseFloat(String(c.grossAmount ?? 0)), 0);
        const commissionOutstanding = totalCommissionClaimed - totalCommissionPaid;

        // Refund stats
        const totalRefunds = refundRows.length;
        const completedRefunds = refundRows.filter(r => r.status === "completed").length;
        const pendingRefunds = refundRows.filter(r => r.status === "pending" || r.status === "processing").length;

        // Reimbursement stats
        const totalReimb = reimbRows.reduce((s, r) => s + parseFloat(String(r.amount ?? 0)), 0);
        const paidReimb = reimbRows.filter(r => r.status === "paid").reduce((s, r) => s + parseFloat(String(r.amount ?? 0)), 0);
        const pendingReimb = reimbRows.filter(r => r.status === "pending" || r.status === "scheduled").reduce((s, r) => s + parseFloat(String(r.amount ?? 0)), 0);

        // Recent activity feed (last 20 events across all tables)
        const feed: { type: string; label: string; date: Date; meta?: string }[] = [
          ...bookingRows.slice(0, 10).map(b => ({ type: "booking", label: `Booking: ${b.clientName}`, date: b.createdAt, meta: b.currentStage })),
          ...commissionRows.slice(0, 5).map(c => ({ type: "commission", label: `Commission claimed`, date: c.claimedAt, meta: c.status === "paid" ? "Paid" : "Pending" })),
          ...refundRows.slice(0, 5).map(r => ({ type: "refund", label: `Refund request`, date: r.createdAt, meta: r.pipelineStage })),
        ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 20);

        return {
          bookings: { total: totalBookings, active: activeBookings, totalValue: totalBookingValue, lastBookingDate },
          commissions: { totalClaimed: totalCommissionClaimed, totalPaid: totalCommissionPaid, outstanding: commissionOutstanding },
          refunds: { total: totalRefunds, completed: completedRefunds, pending: pendingRefunds },
          reimbursements: { total: totalReimb, paid: paidReimb, pending: pendingReimb },
          recentBookings: bookingRows.slice(0, 10),
          feed,
        };
      }),

    // ── Change Requests ──────────────────────────────────────────────────────
    submitChangeRequest: protectedProcedure
      .input(z.object({
        fieldName: z.string().min(1),
        fieldLabel: z.string().min(1),
        currentValue: z.string().optional(),
        requestedValue: z.string().min(1),
        reason: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { agentChangeRequests } = await import("../drizzle/schema");
        const [result] = await db.insert(agentChangeRequests).values({
          userId: ctx.user.id,
          fieldName: input.fieldName,
          fieldLabel: input.fieldLabel,
          currentValue: input.currentValue ?? null,
          requestedValue: input.requestedValue,
          reason: input.reason ?? null,
          status: "pending",
        });
        return { success: true };
      }),

    listChangeRequests: adminProcedure
      .input(z.object({ status: z.enum(["pending", "approved", "rejected", "all"]).default("pending") }).optional())
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return [];
        const { agentChangeRequests, users } = await import("../drizzle/schema");
        const { eq, desc } = await import("drizzle-orm");
        const statusFilter = input?.status ?? "pending";
        const rows = await db.select({
          request: agentChangeRequests,
          agentName: users.name,
          agentEmail: users.email,
        })
          .from(agentChangeRequests)
          .leftJoin(users, eq(agentChangeRequests.userId, users.id))
          .where(statusFilter === "all" ? undefined : eq(agentChangeRequests.status, statusFilter))
          .orderBy(desc(agentChangeRequests.createdAt));
        return rows;
      }),

    getMyChangeRequests: protectedProcedure.query(async ({ ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return [];
      const { agentChangeRequests } = await import("../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");
      return db.select().from(agentChangeRequests)
        .where(eq(agentChangeRequests.userId, ctx.user.id))
        .orderBy(desc(agentChangeRequests.createdAt));
    }),

    reviewChangeRequest: adminProcedure
      .input(z.object({
        id: z.number().int(),
        action: z.enum(["approve", "reject"]),
        adminNote: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { agentChangeRequests } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Fetch the request
        const [req] = await db.select().from(agentChangeRequests).where(eq(agentChangeRequests.id, input.id));
        if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Change request not found" });

        const newStatus = input.action === "approve" ? "approved" : "rejected";
        await db.update(agentChangeRequests)
          .set({ status: newStatus, adminNote: input.adminNote ?? null, reviewedById: ctx.user.id, reviewedAt: new Date() })
          .where(eq(agentChangeRequests.id, input.id));

        // If approved, apply the change to the CRM profile
        if (input.action === "approve") {
          await upsertAgentCrmProfile(req.userId, { [req.fieldName]: req.requestedValue } as any);
        }

        // Notify the agent
        try {
          await createInAppNotification({
            userId: req.userId,
            message: input.action === "approve"
              ? `Your request to update ${req.fieldLabel} has been approved.`
              : `Your request to update ${req.fieldLabel} was not approved.${ input.adminNote ? ` Note: ${input.adminNote}` : "" }`,
            linkUrl: "/my-profile",
          });
        } catch {}

        return { success: true };
      }),

    getMyProfile: protectedProcedure.query(async ({ ctx }) => {
      const profile = await getAgentCrmProfile(ctx.user.id);
      const tags = await getAgentTags(ctx.user.id);
      const supplierLogins = await getAgentSupplierLogins(ctx.user.id);
      return {
        profile,
        tags: tags,
        suppliers: supplierLogins.map(s => s.supplierName),
        // Hoisted to top level to avoid SuperJSON depth truncation in PortalLayout
        orbitEnabled: profile?.orbitEnabled ?? false,
      };
    }),

    // ─── Agent self-onboarding ───────────────────────────────────────────────
    saveOnboardingProfile: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(255),
        personalEmail: z.string().email().optional().nullable(),
        mobile: z.string().min(1).max(30).optional().nullable(),
        addressLine1: z.string().min(1).max(255).optional().nullable(),
        addressLine2: z.string().max(255).optional().nullable(),
        city: z.string().max(100).optional().nullable(),
        postcode: z.string().max(20).optional().nullable(),
        businessName: z.string().max(255).optional().nullable(),
        // Bank details for commission payouts
        bankAccountName: z.string().max(255).optional().nullable(),
        bankSortCode: z.string().max(10).optional().nullable(),
        bankAccountNumber: z.string().max(20).optional().nullable(),
        // Emergency contact
        emergencyContactName: z.string().max(255).optional().nullable(),
        emergencyContactPhone: z.string().max(30).optional().nullable(),
        // Preferred monthly payment day: 1, 15, or 28
        preferredPaymentDay: z.union([z.literal(1), z.literal(15), z.literal(28)]).optional().nullable(),
        // JLT email address preference
        jltEmailPreference: z.string().max(320).optional().nullable(),
        notifyOnComplete: z.boolean().optional(),
        ukRegion: z.string().max(100).optional().nullable(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { users, gcMandates, gcSubscriptions } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        // Update the user's display name
        await db.update(users).set({ name: input.name }).where(eq(users.id, ctx.user.id));
        // Upsert the CRM profile fields (strip non-profile fields)
        const { name, notifyOnComplete, ...profileFields } = input;
        // jltEmailPreference is included in profileFields automatically
        await upsertAgentCrmProfile(ctx.user.id, profileFields);
        // Create the GoCardless subscription whenever a payment day is set and mandate is active
        // (not gated on notifyOnComplete — subscription should be created as soon as the agent picks their day)
        if (input.preferredPaymentDay) {
          try {
            const mandateRows = await db
              .select()
              .from(gcMandates)
              .where(eq(gcMandates.userId, ctx.user.id))
              .limit(1);
            const mandate = mandateRows[0];
            // Always sync preferredPaymentDay to gc_mandates row (even if mandate isn't active yet)
            if (mandate) {
              await db
                .update(gcMandates)
                .set({ preferredPaymentDay: input.preferredPaymentDay })
                .where(eq(gcMandates.id, mandate.id));
            }
            if (mandate?.mandateId && mandate.status === "active") {
              const existingSubs = await db
                .select()
                .from(gcSubscriptions)
                .where(eq(gcSubscriptions.userId, ctx.user.id))
                .limit(1);
              if (existingSubs.length === 0) {
                const { createSubscription, calcSubscriptionStartDate } = await import("./gocardless");
                const { createGcSubscription } = await import("./gocardless-db");
                const { getAgentCrmProfile } = await import("./agent-crm-db");
                const profile = await getAgentCrmProfile(ctx.user.id);
                const tier = profile?.membershipTier ?? "business_class";
                // Determine amount: Business Class Solo = £87/mo, First Class Solo = £127/mo
                // Team amounts are handled separately; default to solo rate
                const amountPence = tier === "first_class" ? 12700 : 8700;
                const startDate = calcSubscriptionStartDate(
                  mandate.joiningFeePaidAt ?? new Date(),
                  input.preferredPaymentDay
                );
                const tierLabel = tier === "first_class" ? "First Class" : "Business Class";
                const sub = await createSubscription({
                  mandateId: mandate.mandateId,
                  amountPence,
                  name: `JLT ${tierLabel} Membership`,
                  startDate,
                  dayOfMonth: input.preferredPaymentDay,
                });
                await createGcSubscription({
                  userId: ctx.user.id,
                  mandateId: mandate.mandateId,
                  subscriptionId: sub.id,
                  amount: sub.amount,
                  startDate,
                  dayOfMonth: input.preferredPaymentDay,
                  nextChargeDate: (sub as any).upcoming_payments?.[0]?.charge_date,
                });
              }
            }
          } catch (subErr: any) {
            console.error("[Onboarding] Subscription creation failed:", subErr.message);
            // Don't block onboarding completion — admin can create subscription manually
          }
        }
        // Notify JLT team when onboarding is complete — email only
        if (notifyOnComplete) {
          try {
            const { sendSupportEmail } = await import("./email");
            await sendSupportEmail({
              subject: `Agent Onboarding Complete: ${name}`,
              html: `
                <div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF6ED;padding:32px;border-radius:16px;">
                  <h2 style="color:#414141;margin:0 0 16px;">Agent Onboarding Complete</h2>
                  <table style="width:100%;border-collapse:collapse;">
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Agent Name</td><td style="padding:6px 0;color:#414141;font-weight:600;">${name}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Agent User ID</td><td style="padding:6px 0;color:#414141;">${ctx.user.id}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Preferred payment day</td><td style="padding:6px 0;color:#414141;">${input.preferredPaymentDay ?? "not set"}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:.9rem;">Completed at</td><td style="padding:6px 0;color:#414141;">${new Date().toUTCString()}</td></tr>
                  </table>
                  <p style="margin:20px 0 0;"><a href="https://portal.thejltgroup.co.uk/crm/${ctx.user.id}" style="display:inline-block;background:#02E6D2;color:#1a1a2e;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;font-size:14px;">View Agent in CRM →</a></p>
                  <p style="margin:12px 0 0;color:#414141;">Please <strong>review their onboarding documents and activate their portal access</strong> in the CRM.</p>
                  <p style="margin:8px 0 0;color:#9ca3af;font-size:.8rem;">JLT Group Booking Portal — automated notification</p>
                </div>
              `,
            });
          } catch {}
        }
        return { success: true };
      }),

    uploadOnboardingDoc: protectedProcedure
      .input(z.object({
        docType: z.enum(["id", "proofOfAddress"]),
        fileBase64: z.string(),
        fileName: z.string(),
        mimeType: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { storagePut } = await import("./storage");
        const { nanoid } = await import("nanoid");
        const buf = Buffer.from(input.fileBase64, "base64");
        const ext = input.fileName.split(".").pop() ?? "bin";
        const key = `onboarding/${ctx.user.id}/${input.docType}-${nanoid(8)}.${ext}`;
        const { url } = await storagePut(key, buf, input.mimeType);
        const updateData =
          input.docType === "id"
            ? { idDocUrl: url, idDocKey: key }
            : { proofOfAddressUrl: url, proofOfAddressKey: key };
        await upsertAgentCrmProfile(ctx.user.id, updateData);
        return { url, key };
      }),

    // ─── Status-Change Workflows ─────────────────────────────────────────────
    updateAgentStatus: adminProcedure
      .input(z.object({
        userId: z.number().int(),
        newStatus: z.enum(["active", "paused", "in_notice", "cancelled", "suspended"]),
        pauseEndsAt: z.string().optional().nullable(),      // ISO date string for paused
        noticeEndsAt: z.string().optional().nullable(),     // ISO date string for in_notice
        cancelledAt: z.string().optional().nullable(),      // ISO date string for cancelled
        cancelChecklist: z.array(z.string()).optional(),    // ticked items for cancelled
        notes: z.string().optional().nullable(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { agentCrmProfiles, agentStatusEvents, users } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Fetch agent name and current status
        const [agentUser] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, input.userId));
        const existingProfile = await getAgentCrmProfile(input.userId);
        const fromStatus = existingProfile?.agentStatus ?? "active";
        const agentName = agentUser?.name ?? `Agent #${input.userId}`;

        // Build profile update
        const profileUpdate: Record<string, unknown> = { agentStatus: input.newStatus };
        if (input.newStatus === "paused") {
          profileUpdate.pauseEndsAt = input.pauseEndsAt ? new Date(input.pauseEndsAt) : null;
          profileUpdate.noticeEndsAt = null;
          profileUpdate.cancelledAt = null;
          profileUpdate.suspendedAt = null;
        } else if (input.newStatus === "in_notice") {
          profileUpdate.noticeEndsAt = input.noticeEndsAt ? new Date(input.noticeEndsAt) : null;
          profileUpdate.pauseEndsAt = null;
          profileUpdate.cancelledAt = null;
          profileUpdate.suspendedAt = null;
        } else if (input.newStatus === "cancelled") {
          profileUpdate.cancelledAt = input.cancelledAt ? new Date(input.cancelledAt) : new Date();
          profileUpdate.pauseEndsAt = null;
          profileUpdate.noticeEndsAt = null;
          profileUpdate.suspendedAt = null;
        } else if (input.newStatus === "suspended") {
          profileUpdate.suspendedAt = new Date();
          profileUpdate.suspensionReason = "manual";
          profileUpdate.pauseEndsAt = null;
          profileUpdate.noticeEndsAt = null;
          profileUpdate.cancelledAt = null;
        } else {
          // active — clear all date fields and suspension reason
          profileUpdate.pauseEndsAt = null;
          profileUpdate.noticeEndsAt = null;
          profileUpdate.cancelledAt = null;
          profileUpdate.suspendedAt = null;
          profileUpdate.suspensionReason = null;
        }

        await upsertAgentCrmProfile(input.userId, profileUpdate as any);

        // Sync portalStatus on the users table so login guards are enforced
        // paused + suspended = blocked from portal; in_notice = still has access; cancelled = blocked; active = access restored
        const portalStatusMap: Record<string, string> = {
          active: 'active',
          paused: 'paused',
          suspended: 'suspended',
          in_notice: 'active', // agents in notice still have portal access
          cancelled: 'cancelled',
        };
        const newPortalStatus = portalStatusMap[input.newStatus] ?? 'active';
        // isActive must be false for cancelled/suspended/paused agents so they are excluded from all email sends
        const newIsActive = (input.newStatus === 'cancelled' || input.newStatus === 'suspended' || input.newStatus === 'paused') ? false : true;
        await db.update(users).set({ portalStatus: newPortalStatus as any, isActive: newIsActive }).where(eq(users.id, input.userId));

        // Log the status event
        await db.insert(agentStatusEvents).values({
          userId: input.userId,
          fromStatus,
          toStatus: input.newStatus,
          adminId: ctx.user.id,
          notes: input.notes ?? null,
          pauseEndsAt: input.pauseEndsAt ? new Date(input.pauseEndsAt) : null,
          noticeEndsAt: input.noticeEndsAt ? new Date(input.noticeEndsAt) : null,
          cancelledAt: input.cancelledAt ? new Date(input.cancelledAt) : null,
          cancelChecklist: input.cancelChecklist ?? null,
        });

        // Send email and notifications based on new status
        try {
          if (input.newStatus === "paused") {
            const endDateStr = input.pauseEndsAt
              ? new Date(input.pauseEndsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
              : "TBC";
            await sendDirectEmail({
              toEmail: "memberships@thejltgroup.co.uk",
              toName: "JLT Memberships",
              subject: `Agent Paused: ${agentName}`,
              html: `<p>Hi,</p><p><strong>${agentName}</strong> has been set to <strong>Paused</strong> status in the portal.</p><p><strong>Pause ends on:</strong> ${endDateStr}</p><p>Please pause their direct debit until this date. When the pause ends, remember to reinstate the direct debit.</p>${input.notes ? `<p><strong>Admin notes:</strong> ${input.notes}</p>` : ""}<p>This is an automated notification from the JLT Group Booking Portal.</p>`,
            });
            await createInAppNotification({
              userId: ctx.user.id,
              message: `${agentName} has been set to Paused. Pause ends: ${endDateStr}. Email sent to memberships.`,
              linkUrl: `/crm/agents`,
            });
          } else if (input.newStatus === "in_notice") {
            const finalDateStr = input.noticeEndsAt
              ? new Date(input.noticeEndsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
              : "TBC";
            await sendDirectEmail({
              toEmail: "memberships@thejltgroup.co.uk",
              toName: "JLT Memberships",
              subject: `Agent In Notice: ${agentName}`,
              html: `<p>Hi,</p><p><strong>${agentName}</strong> has been placed <strong>In Notice</strong> in the portal.</p><p><strong>Final date at JLT:</strong> ${finalDateStr}</p><p>Please arrange to cancel their direct debit at the end of their notice period.</p>${input.notes ? `<p><strong>Admin notes:</strong> ${input.notes}</p>` : ""}<p>This is an automated notification from the JLT Group Booking Portal.</p>`,
            });
            await createInAppNotification({
              userId: ctx.user.id,
              message: `${agentName} is In Notice. Final date: ${finalDateStr}. Email sent to memberships.`,
              linkUrl: `/crm/agents`,
            });
          } else if (input.newStatus === "cancelled") {
            const finalDateStr = input.cancelledAt
              ? new Date(input.cancelledAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
              : new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
            const checklist = input.cancelChecklist ?? [];
            const checklistHtml = checklist.length
              ? `<ul>${checklist.map(item => `<li>&#10003; ${item}</li>`).join("")}</ul>`
              : "<p>No checklist items recorded.</p>";
            await sendDirectEmail({
              toEmail: "memberships@thejltgroup.co.uk",
              toName: "JLT Memberships",
              subject: `Agent Cancelled: ${agentName}`,
              html: `<p>Hi,</p><p><strong>${agentName}</strong> has been <strong>Cancelled</strong> in the portal.</p><p><strong>Final date:</strong> ${finalDateStr}</p><p>The following systems have been acknowledged for restriction:</p>${checklistHtml}${input.notes ? `<p><strong>Admin notes:</strong> ${input.notes}</p>` : ""}<p>Please ensure all access is revoked by the final date.</p><p>This is an automated notification from the JLT Group Booking Portal.</p>`,
            });
            await createInAppNotification({
              userId: ctx.user.id,
              message: `${agentName} has been Cancelled. Final date: ${finalDateStr}. Checklist acknowledged and email sent to memberships.`,
              linkUrl: `/crm/agents`,
            });
          }
          // Suspended: no email, just update status — portal access is blocked by the guard
        } catch (emailErr) {
          console.error("[updateAgentStatus] Email/notification error:", emailErr);
          // Don't fail the mutation if email fails
        }

        return { success: true };
      }),

    // ── Check for agents whose pause/notice period has ended (run daily) ──────
    checkStatusDates: adminProcedure.mutation(async ({ ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { agentCrmProfiles, users } = await import("../drizzle/schema");
      const { eq, and, lte, isNotNull } = await import("drizzle-orm");
      const now = new Date();

      // Find paused agents whose pause has ended
      const pausedAgents = await db
        .select({ profile: agentCrmProfiles, name: users.name })
        .from(agentCrmProfiles)
        .innerJoin(users, eq(users.id, agentCrmProfiles.userId))
        .where(and(
          eq(agentCrmProfiles.agentStatus, "paused"),
          isNotNull(agentCrmProfiles.pauseEndsAt),
          lte(agentCrmProfiles.pauseEndsAt, now),
        ));

      for (const { profile, name } of pausedAgents) {
        const endDateStr = profile.pauseEndsAt
          ? new Date(profile.pauseEndsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
          : "today";
        try {
          await sendDirectEmail({
            toEmail: "memberships@thejltgroup.co.uk",
            toName: "JLT Memberships",
            subject: `Pause Period Ended: ${name}`,
            html: `<p>Hi,</p><p>The pause period for <strong>${name}</strong> ended on <strong>${endDateStr}</strong>.</p><p>Please reinstate their direct debit now.</p><p>This is an automated reminder from the JLT Group Booking Portal.</p>`,
          });
          await createInAppNotification({
            userId: ctx.user.id,
            message: `Reminder: ${name}'s pause period ended ${endDateStr}. Please reinstate their direct debit.`,
            linkUrl: `/crm/agents`,
          });
        } catch {}
      }

      // Find in_notice agents whose notice period has ended
      const noticeAgents = await db
        .select({ profile: agentCrmProfiles, name: users.name })
        .from(agentCrmProfiles)
        .innerJoin(users, eq(users.id, agentCrmProfiles.userId))
        .where(and(
          eq(agentCrmProfiles.agentStatus, "in_notice"),
          isNotNull(agentCrmProfiles.noticeEndsAt),
          lte(agentCrmProfiles.noticeEndsAt, now),
        ));

      for (const { profile, name } of noticeAgents) {
        const finalDateStr = profile.noticeEndsAt
          ? new Date(profile.noticeEndsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
          : "today";
        try {
          await sendDirectEmail({
            toEmail: "memberships@thejltgroup.co.uk",
            toName: "JLT Memberships",
            subject: `Notice Period Ended: ${name}`,
            html: `<p>Hi,</p><p>The notice period for <strong>${name}</strong> ended on <strong>${finalDateStr}</strong>.</p><p>Please cancel their direct debit now.</p><p>This is an automated reminder from the JLT Group Booking Portal.</p>`,
          });
          await createInAppNotification({
            userId: ctx.user.id,
            message: `Reminder: ${name}'s notice period ended ${finalDateStr}. Please cancel their direct debit.`,
            linkUrl: `/crm/agents`,
          });
        } catch {}
      }

      return { pausedCount: pausedAgents.length, noticeCount: noticeAgents.length };
    }),

    // ─── Team Management (Duo / Trio groupings) ──────────────────────────────
    createTeam: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        membershipTier: z.string().optional(),
        monthlySub: z.string().optional(),
        notes: z.string().optional(),
        memberUserIds: z.array(z.number()).min(1),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { agentTeams, agentCrmProfiles } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const [result] = await db.insert(agentTeams).values({
          name: input.name,
          membershipTier: input.membershipTier ?? null,
          monthlySub: input.monthlySub ?? null,
          notes: input.notes ?? null,
        });
        const teamId = (result as any).insertId as number;
        for (const userId of input.memberUserIds) {
          await db.update(agentCrmProfiles).set({ teamId }).where(eq(agentCrmProfiles.userId, userId));
        }
        return { teamId };
      }),

    updateTeam: adminProcedure
      .input(z.object({
        teamId: z.number(),
        name: z.string().min(1).optional(),
        membershipTier: z.string().optional(),
        monthlySub: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { agentTeams, agentCrmProfiles } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const { teamId, ...data } = input;
        // Update the team record
        await db.update(agentTeams).set(data).where(eq(agentTeams.id, teamId));
        // Sync membershipTier and monthlySub to all team members' CRM profiles
        const profileUpdate: Record<string, string | undefined> = {};
        if (input.membershipTier !== undefined) profileUpdate.membershipTier = input.membershipTier;
        if (input.monthlySub !== undefined) profileUpdate.monthlySub = input.monthlySub;
        if (Object.keys(profileUpdate).length > 0) {
          await db.update(agentCrmProfiles).set(profileUpdate).where(eq(agentCrmProfiles.teamId, teamId));
        }
        return { success: true };
      }),

    addTeamMember: adminProcedure
      .input(z.object({ teamId: z.number(), userId: z.number() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { agentCrmProfiles } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        // Check if a CRM profile already exists for this user
        const existing = await db.select({ id: agentCrmProfiles.id }).from(agentCrmProfiles).where(eq(agentCrmProfiles.userId, input.userId));
        if (existing.length > 0) {
          // Profile exists — just update the teamId
          await db.update(agentCrmProfiles).set({ teamId: input.teamId }).where(eq(agentCrmProfiles.userId, input.userId));
        } else {
          // No profile yet — create a minimal one with the teamId so the link is persisted
          const uniqueAgentId = await generateUniqueAgentIdForUser();
          await db.insert(agentCrmProfiles).values({ userId: input.userId, teamId: input.teamId, uniqueAgentId, agentStatus: "active" });
        }
        return { success: true };
      }),

    removeTeamMember: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { agentCrmProfiles } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(agentCrmProfiles).set({ teamId: null }).where(eq(agentCrmProfiles.userId, input.userId));
        return { success: true };
      }),

    getTeam: adminProcedure
      .input(z.object({ teamId: z.number() }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return null;
        const { agentTeams, agentCrmProfiles, users } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const teams = await db.select().from(agentTeams).where(eq(agentTeams.id, input.teamId));
        if (!teams[0]) return null;
        const members = await db
          .select({ userId: agentCrmProfiles.userId, name: users.name, email: users.email })
          .from(agentCrmProfiles)
          .innerJoin(users, eq(users.id, agentCrmProfiles.userId))
          .where(eq(agentCrmProfiles.teamId, input.teamId));
        return { ...teams[0], members };
      }),

    listTeams: adminProcedure.query(async () => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return [];
      const { agentTeams } = await import("../drizzle/schema");
      return db.select().from(agentTeams).orderBy(agentTeams.name);
    }),

    deleteTeam: adminProcedure
      .input(z.object({ teamId: z.number() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { agentTeams, agentCrmProfiles } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(agentCrmProfiles).set({ teamId: null }).where(eq(agentCrmProfiles.teamId, input.teamId));
        await db.delete(agentTeams).where(eq(agentTeams.id, input.teamId));
        return { success: true };
      }),

    // ─── Memberships Dashboard ───────────────────────────────────────────────
    getMembershipsOverview: adminProcedure.query(async () => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { agentCrmProfiles, users, agentSupplierLogins } = await import("../drizzle/schema");
      const { eq, and, isNotNull, sql, inArray } = await import("drizzle-orm");

      // All profiles with user info
      const allProfiles = await db
        .select({
          userId: agentCrmProfiles.userId,
          name: users.name,
          email: users.email,
          agentStatus: agentCrmProfiles.agentStatus,
          membershipTier: agentCrmProfiles.membershipTier,
          pauseEndsAt: agentCrmProfiles.pauseEndsAt,
          noticeEndsAt: agentCrmProfiles.noticeEndsAt,
          cancelledAt: agentCrmProfiles.cancelledAt,
          suspendedAt: agentCrmProfiles.suspendedAt,
          suspensionReason: agentCrmProfiles.suspensionReason,
          cancelChecklist: agentCrmProfiles.cancelChecklist,
          uniqueAgentId: agentCrmProfiles.uniqueAgentId,
          ukRegion: agentCrmProfiles.ukRegion,
        })
        .from(agentCrmProfiles)
        .innerJoin(users, eq(users.id, agentCrmProfiles.userId));

      // Stats by status
      const stats = {
        total: allProfiles.length,
        active: allProfiles.filter(p => (p.agentStatus ?? "active") === "active").length,
        paused: allProfiles.filter(p => p.agentStatus === "paused").length,
        in_notice: allProfiles.filter(p => p.agentStatus === "in_notice").length,
        cancelled: allProfiles.filter(p => p.agentStatus === "cancelled").length,
        suspended: allProfiles.filter(p => p.agentStatus === "suspended").length,
      };

      // Stats by tier (active agents only)
      const tierCounts: Record<string, number> = {};
      for (const p of allProfiles.filter(p => (p.agentStatus ?? "active") === "active")) {
        const tier = p.membershipTier ?? "Unassigned";
        tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
      }

      const CANCEL_CHECKLIST_ITEMS = [
        "Topdog login removed",
        "WhatsApp access removed",
        "Learnworlds access removed",
        "JLT email deactivated",
        "Portal access removed",
      ];

      // In notice — sorted by soonest final date
      const inNotice = allProfiles
        .filter(p => p.agentStatus === "in_notice")
        .sort((a, b) => {
          if (!a.noticeEndsAt) return 1;
          if (!b.noticeEndsAt) return -1;
          return new Date(a.noticeEndsAt).getTime() - new Date(b.noticeEndsAt).getTime();
        });

      // Paused — sorted by soonest pause end
      const paused = allProfiles
        .filter(p => p.agentStatus === "paused")
        .sort((a, b) => {
          if (!a.pauseEndsAt) return 1;
          if (!b.pauseEndsAt) return -1;
          return new Date(a.pauseEndsAt).getTime() - new Date(b.pauseEndsAt).getTime();
        });

      // Suspended
      const suspended = allProfiles
        .filter(p => p.agentStatus === "suspended")
        .sort((a, b) => {
          if (!a.suspendedAt) return 1;
          if (!b.suspendedAt) return -1;
          return new Date(b.suspendedAt).getTime() - new Date(a.suspendedAt).getTime();
        });

      // Cancelled — only those with incomplete offboarding checklist
      const cancelledPendingOffboarding = allProfiles
        .filter(p => {
          if (p.agentStatus !== "cancelled") return false;
          const ticked = Array.isArray(p.cancelChecklist) ? (p.cancelChecklist as string[]) : [];
          // We'll check completeness after we know the full item list (fixed + suppliers)
          return true;
        })
        .sort((a, b) => {
          if (!a.cancelledAt) return 1;
          if (!b.cancelledAt) return -1;
          return new Date(b.cancelledAt).getTime() - new Date(a.cancelledAt).getTime();
        });

      // Fetch supplier logins for all cancelled agents
      const cancelledUserIds = cancelledPendingOffboarding.map(p => p.userId);
      const supplierLoginRows = cancelledUserIds.length > 0
        ? await db
            .select({
              userId: agentSupplierLogins.userId,
              id: agentSupplierLogins.id,
              supplierName: agentSupplierLogins.supplierName,
            })
            .from(agentSupplierLogins)
            .where(inArray(agentSupplierLogins.userId, cancelledUserIds))
        : [];

      // Group supplier logins by userId
      const suppliersByUser: Record<number, { id: number; supplierName: string }[]> = {};
      for (const row of supplierLoginRows) {
        if (!suppliersByUser[row.userId]) suppliersByUser[row.userId] = [];
        suppliersByUser[row.userId].push({ id: row.id, supplierName: row.supplierName });
      }

      // Attach suppliers and filter out fully-offboarded agents
      const cancelledWithSuppliers = cancelledPendingOffboarding
        .map(p => ({
          ...p,
          supplierLogins: suppliersByUser[p.userId] ?? [],
        }))
        .filter(p => {
          const ticked = Array.isArray(p.cancelChecklist) ? (p.cancelChecklist as string[]) : [];
          const totalItems = CANCEL_CHECKLIST_ITEMS.length + p.supplierLogins.length;
          return ticked.length < totalItems;
        });

      return {
        stats,
        tierCounts,
        inNotice,
        paused,
        suspended,
        cancelledPendingOffboarding: cancelledWithSuppliers,
        checklistItems: CANCEL_CHECKLIST_ITEMS,
      };
    }),

    updateCancelChecklist: adminProcedure
      .input(z.object({
        userId: z.number().int(),
        checklist: z.array(z.string()),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { agentCrmProfiles } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(agentCrmProfiles)
          .set({ cancelChecklist: input.checklist })
          .where(eq(agentCrmProfiles.userId, input.userId));
        return { success: true };
      }),

    // ─── Overdue count for sidebar badge ─────────────────────────────────────────────
    getOverdueCount: adminProcedure.query(async () => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return { count: 0 };
      const { agentCrmProfiles } = await import("../drizzle/schema");
      const { eq, and, isNotNull, lte, or } = await import("drizzle-orm");
      const now = new Date();

      // Count agents whose pause or notice period has passed (still in that status)
      const overdue = await db
        .select({ userId: agentCrmProfiles.userId })
        .from(agentCrmProfiles)
        .where(
          or(
            and(
              eq(agentCrmProfiles.agentStatus, "paused"),
              isNotNull(agentCrmProfiles.pauseEndsAt),
              lte(agentCrmProfiles.pauseEndsAt, now),
            ),
            and(
              eq(agentCrmProfiles.agentStatus, "in_notice"),
              isNotNull(agentCrmProfiles.noticeEndsAt),
              lte(agentCrmProfiles.noticeEndsAt, now),
            ),
          )
        );

      return { count: overdue.length };
    }),

    // ─── Status History for agent sheet timeline ───────────────────────────────────────
    deleteRecord: adminProcedure
      .input(z.object({ userId: z.number().int() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB unavailable' });
        const {
          agentCrmProfiles,
          agentSupplierLogins,
          agentStatusEvents,
          agentTags,
          agentChangeRequests,
        } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        // Delete all related rows first, then the profile
        await db.delete(agentSupplierLogins).where(eq(agentSupplierLogins.userId, input.userId));
        await db.delete(agentStatusEvents).where(eq(agentStatusEvents.userId, input.userId));
        await db.delete(agentTags).where(eq(agentTags.userId, input.userId));
        await db.delete(agentChangeRequests).where(eq(agentChangeRequests.userId, input.userId));
        await db.delete(agentCrmProfiles).where(eq(agentCrmProfiles.userId, input.userId));
        return { success: true };
      }),

    getStatusHistory: adminProcedure
      .input(z.object({ userId: z.number().int() }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return [];
        const { agentStatusEvents, users } = await import("../drizzle/schema");
        const { eq, desc } = await import("drizzle-orm");
        const events = await db
          .select({
            id: agentStatusEvents.id,
            fromStatus: agentStatusEvents.fromStatus,
            toStatus: agentStatusEvents.toStatus,
            createdAt: agentStatusEvents.createdAt,
            notes: agentStatusEvents.notes,
            pauseEndsAt: agentStatusEvents.pauseEndsAt,
            noticeEndsAt: agentStatusEvents.noticeEndsAt,
            cancelledAt: agentStatusEvents.cancelledAt,
            cancelChecklist: agentStatusEvents.cancelChecklist,
            adminName: users.name,
          })
          .from(agentStatusEvents)
          .leftJoin(users, eq(users.id, agentStatusEvents.adminId))
          .where(eq(agentStatusEvents.userId, input.userId))
          .orderBy(desc(agentStatusEvents.createdAt));
        return events;
      }),

    // ─── Contract Evidence Viewer ───────────────────────────────────────────────
    getContractEvidence: adminProcedure
      .input(z.object({ userId: z.number().int() }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return null;
        const { joinSessions, users } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        // Get the agent's user record
        const agentRows = await db
          .select({ name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, input.userId))
          .limit(1);
        const agent = agentRows[0] ?? null;

        // Get the join session with all evidence fields
        const sessions = await db
          .select()
          .from(joinSessions)
          .where(eq(joinSessions.userId, input.userId))
          .limit(1);
        const session = sessions[0] ?? null;

        if (!session) return null;

        return {
          agent,
          signerName: session.signerName,
          signerAddress: session.signerAddress,
          contractSignedAt: session.contractSignedAt,
          signatureDataUrl: session.signatureDataUrl,
          ipAddress: session.ipAddress,
          signingUserAgent: session.signingUserAgent,
          consentConfirmed: session.consentConfirmed,
          contractTextSnapshot: session.contractTextSnapshot,
          contractHash: session.contractHash,
          membershipTier: session.membershipTier,
          membershipType: session.membershipType,
        };
      }),

    // ─── Admin Onboarding Checklist ───────────────────────────────────────────
    getOnboardingChecklist: adminProcedure
      .input(z.object({ userId: z.number().int() }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return null;
        const { adminOnboardingChecklist, users, agentCrmProfiles } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const rows = await db
          .select({
            id: adminOnboardingChecklist.id,
            trainingHubLogin: adminOnboardingChecklist.trainingHubLogin,
            jltEmailSetup: adminOnboardingChecklist.jltEmailSetup,
            idDocsReviewed: adminOnboardingChecklist.idDocsReviewed,
            contractReviewed: adminOnboardingChecklist.contractReviewed,
            welcomeEmailSent: adminOnboardingChecklist.welcomeEmailSent,
            portalAccessApproved: adminOnboardingChecklist.portalAccessApproved,
            ddSubscriptionCreated: adminOnboardingChecklist.ddSubscriptionCreated,
            updatedAt: adminOnboardingChecklist.updatedAt,
            updatedByName: users.name,
            jltEmailPreference: agentCrmProfiles.jltEmailPreference,
          })
          .from(adminOnboardingChecklist)
          .leftJoin(users, eq(users.id, adminOnboardingChecklist.updatedById))
          .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, input.userId))
          .where(eq(adminOnboardingChecklist.userId, input.userId))
          .limit(1);
        return rows[0] ?? null;
      }),

    updateOnboardingChecklist: adminProcedure
      .input(z.object({
        userId: z.number().int(),
        trainingHubLogin: z.boolean().optional(),
        jltEmailSetup: z.boolean().optional(),
        idDocsReviewed: z.boolean().optional(),
        contractReviewed: z.boolean().optional(),
        welcomeEmailSent: z.boolean().optional(),
        portalAccessApproved: z.boolean().optional(),
        ddSubscriptionCreated: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { adminOnboardingChecklist } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const { userId, ...fields } = input;
        // Upsert: try update first, then insert
        const existing = await db
          .select({ id: adminOnboardingChecklist.id })
          .from(adminOnboardingChecklist)
          .where(eq(adminOnboardingChecklist.userId, userId))
          .limit(1);
        if (existing[0]) {
          await db.update(adminOnboardingChecklist)
            .set({ ...fields, updatedById: ctx.user.id })
            .where(eq(adminOnboardingChecklist.userId, userId));
        } else {
          await db.insert(adminOnboardingChecklist).values({
            userId,
            trainingHubLogin: fields.trainingHubLogin ?? false,
            jltEmailSetup: fields.jltEmailSetup ?? false,
            idDocsReviewed: fields.idDocsReviewed ?? false,
            contractReviewed: fields.contractReviewed ?? false,
            welcomeEmailSent: fields.welcomeEmailSent ?? false,
            portalAccessApproved: fields.portalAccessApproved ?? false,
            ddSubscriptionCreated: fields.ddSubscriptionCreated ?? false,
            updatedById: ctx.user.id,
          });
        }
        return { success: true };
      }),

    sendWelcomeEmail: adminProcedure
      .input(z.object({ userId: z.number().int() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { users, adminOnboardingChecklist } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const agent = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, input.userId))
          .limit(1)
          .then(r => r[0]);
        if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
        const firstName = (agent.name ?? "").split(" ")[0] || "there";
        const { sendDirectEmail } = await import("./email");
        const result = await sendDirectEmail({
          toEmail: agent.email ?? "",
          toName: agent.name ?? "",
          subject: "Welcome to the JLT Group! \uD83C\uDF89",
          html: `
            <div style="font-family: 'Poppins', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #FFF6ED; padding: 32px; border-radius: 12px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h1 style="color: #414141; font-size: 24px; margin: 0;">JLT Group</h1>
                <div style="width: 60px; height: 4px; background: #70FFE8; margin: 12px auto 0;"></div>
              </div>
              <p style="color: #414141;">Hi ${firstName},</p>
              <p style="color: #414141;">A warm welcome to the JLT Group! We're thrilled to have you on board.</p>
              <p style="color: #414141;">You will receive an email shortly with details for setting up your training hub login. Once you receive this, please set yourself a password and navigate to the JLT Academy in the 'courses' area. You can start working through your training right away!</p>
              <p style="color: #414141;">In the first module, you'll find a link to our onboarding WhatsApp group &mdash; please make sure you join this to keep up to date with our regular announcements.</p>
              <p style="color: #414141;">The JLT email address you requested will be with you within 7 days; we'll email it over as soon as it's been created.</p>
              <p style="color: #414141;">As you dive into the training, please take it step by step. The modules are time locked to prevent you from racing through and missing anything important.</p>
              <p style="color: #414141;">We'll be here to provide feedback on your progress, along with any tips or advice to help you succeed.</p>
              <p style="color: #414141;">Remember, our WhatsApp groups are a valuable resource &mdash; whether you need support, have questions, or just want to chat, our agents and core team are here to help.</p>
              <p style="color: #414141;">We have a weekly induction call every Thursday, rotating between 12pm &amp; 6pm so hopefully we'll see you on the next one! You'll receive the time and Zoom link in the WhatsApp group so don't forget to join!</p>
              <p style="color: #414141; margin-top: 32px;">See you there!</p>
              <p style="color: #414141;"><strong>The JLT Team</strong></p>
            </div>
          `,
        });
        if (!result.success) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error ?? "Failed to send email" });
        // Mark welcomeEmailSent in checklist
        const existing = await db
          .select({ id: adminOnboardingChecklist.id })
          .from(adminOnboardingChecklist)
          .where(eq(adminOnboardingChecklist.userId, input.userId))
          .limit(1);
        if (existing[0]) {
          await db.update(adminOnboardingChecklist)
            .set({ welcomeEmailSent: true })
            .where(eq(adminOnboardingChecklist.userId, input.userId));
        } else {
          await db.insert(adminOnboardingChecklist).values({
            userId: input.userId,
            welcomeEmailSent: true,
            trainingHubLogin: false,
            jltEmailSetup: false,
            idDocsReviewed: false,
            contractReviewed: false,
            portalAccessApproved: false,
            ddSubscriptionCreated: false,
          });
        }
        return { success: true };
      }),

    getNewSignUps: adminProcedure.query(async () => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { users, agentCrmProfiles, adminOnboardingChecklist, joinSessions } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          portalStatus: users.portalStatus,
          createdAt: users.createdAt,
          membershipTier: agentCrmProfiles.membershipTier,
          membershipType: joinSessions.membershipType,
          dateJoined: agentCrmProfiles.dateJoined,
          uniqueAgentId: agentCrmProfiles.uniqueAgentId,
          jltEmailPreference: agentCrmProfiles.jltEmailPreference,
          // Admin checklist fields
          trainingHubLogin: adminOnboardingChecklist.trainingHubLogin,
          jltEmailSetup: adminOnboardingChecklist.jltEmailSetup,
          idDocsReviewed: adminOnboardingChecklist.idDocsReviewed,
          contractReviewed: adminOnboardingChecklist.contractReviewed,
          welcomeEmailSent: adminOnboardingChecklist.welcomeEmailSent,
          portalAccessApproved: adminOnboardingChecklist.portalAccessApproved,
          ddSubscriptionCreated: adminOnboardingChecklist.ddSubscriptionCreated,
          // Agent self-onboarding fields
          personalEmail: agentCrmProfiles.personalEmail,
          mobile: agentCrmProfiles.mobile,
          addressLine1: agentCrmProfiles.addressLine1,
          bankAccountName: agentCrmProfiles.bankAccountName,
          bankSortCode: agentCrmProfiles.bankSortCode,
          bankAccountNumber: agentCrmProfiles.bankAccountNumber,
          emergencyContactName: agentCrmProfiles.emergencyContactName,
          emergencyContactPhone: agentCrmProfiles.emergencyContactPhone,
          idDocUrl: agentCrmProfiles.idDocUrl,
          proofOfAddressUrl: agentCrmProfiles.proofOfAddressUrl,
          preferredPaymentDay: agentCrmProfiles.preferredPaymentDay,
        })
        .from(users)
        .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, users.id))
        .leftJoin(adminOnboardingChecklist, eq(adminOnboardingChecklist.userId, users.id))
        .leftJoin(joinSessions, eq(joinSessions.userId, users.id))
        .where(eq(users.portalStatus, "onboarding"))
        .orderBy(users.createdAt);
      return rows.map(r => {
        const adminSteps = [
          r.trainingHubLogin ?? false,
          r.jltEmailSetup ?? false,
          r.idDocsReviewed ?? false,
          r.contractReviewed ?? false,
          r.welcomeEmailSent ?? false,
          r.portalAccessApproved ?? false,
          r.ddSubscriptionCreated ?? false,
        ];
        const completedSteps = adminSteps.filter(Boolean).length;
        // Agent self-onboarding completion — what the agent has filled in themselves
        const agentSelfOnboarding = {
          personalDetails: !!(r.name && r.personalEmail && r.mobile && r.addressLine1),
          bankDetails: !!(r.bankAccountName && r.bankSortCode && r.bankAccountNumber),
          idDocs: !!(r.idDocUrl && r.proofOfAddressUrl),
          emergencyContact: !!(r.emergencyContactName && r.emergencyContactPhone),
          paymentDay: !!(r.preferredPaymentDay),
          jltEmail: !!(r.jltEmailPreference),
        };
        const agentSelfComplete = Object.values(agentSelfOnboarding).every(Boolean);
        const agentSelfCompletedCount = Object.values(agentSelfOnboarding).filter(Boolean).length;
        return {
          ...r,
          completedSteps,
          totalSteps: adminSteps.length,
          agentSelfOnboarding,
          agentSelfComplete,
          agentSelfCompletedCount,
          agentSelfTotalSteps: Object.keys(agentSelfOnboarding).length,
        };
      });
    }),
    newSignUpsCount: adminProcedure.query(async () => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return 0;
      const { users } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.portalStatus, "onboarding"));
      return rows.length;
    }),

    deleteNewSignUp: adminProcedure
      .input(z.object({ userId: z.number().int() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { users, agentCrmProfiles, adminOnboardingChecklist, joinSessions } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        // Only allow deleting users still in onboarding status (not yet active agents)
        const [row] = await db.select({ id: users.id, portalStatus: users.portalStatus }).from(users).where(eq(users.id, input.userId)).limit(1);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        if (row.portalStatus === "active") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete an active agent from here. Use the CRM agent management page instead." });
        }
        // Delete related records first
        await db.delete(adminOnboardingChecklist).where(eq(adminOnboardingChecklist.userId, input.userId));
        await db.delete(agentCrmProfiles).where(eq(agentCrmProfiles.userId, input.userId));
        await db.delete(joinSessions).where(eq(joinSessions.userId, input.userId));
        await db.delete(users).where(eq(users.id, input.userId));
        return { ok: true };
      }),
  }),

  // ─── Agent CRM Notes ───────────────────────────────────────────────────────
  agentNotes: router({
    list: adminProcedure
      .input(z.object({ agentUserId: z.number() }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return [];
        const { agentCrmNotes } = await import("../drizzle/schema");
        const { eq, desc } = await import("drizzle-orm");
        return db
          .select()
          .from(agentCrmNotes)
          .where(eq(agentCrmNotes.agentUserId, input.agentUserId))
          .orderBy(desc(agentCrmNotes.createdAt));
      }),

    add: adminProcedure
      .input(z.object({ agentUserId: z.number(), content: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { agentCrmNotes } = await import("../drizzle/schema");
        await db.insert(agentCrmNotes).values({
          agentUserId: input.agentUserId,
          authorId: ctx.user.id,
          authorName: ctx.user.name ?? "Admin",
          content: input.content,
        });
        return { ok: true };
      }),
  }),

  // ── Email Templates ───────────────────────────────────────────────────────

  emailTemplates: router({
    list: adminProcedure
      .input(z.object({ audienceType: z.enum(["prospect", "agent"]).optional() }))
      .query(async ({ input }) => getAllEmailTemplates(input.audienceType)),

    get: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .query(async ({ input }) => {
        const t = await getEmailTemplateById(input.id);
        if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
        return t;
      }),

    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        subject: z.string().min(1),
        bodyHtml: z.string().min(1),
        bodyText: z.string().optional(),
        audienceType: z.enum(["prospect", "agent"]),
      }))
      .mutation(async ({ input, ctx }) => {
        const id = await createEmailTemplate({
          ...input,
          createdById: ctx.user.id,
          createdByName: ctx.user.name ?? "Admin",
        });
        return { id };
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number().int(),
        name: z.string().min(1).optional(),
        subject: z.string().min(1).optional(),
        bodyHtml: z.string().optional(),
        bodyText: z.string().optional(),
        audienceType: z.enum(["prospect", "agent"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateEmailTemplate(id, data);
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteEmailTemplate(input.id);
        return { success: true };
      }),
  }),

  // ── Drip Workflows ────────────────────────────────────────────────────────

  dripWorkflows: router({
    list: adminProcedure.query(async () => getAllDripWorkflows()),

    get: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .query(async ({ input }) => {
        const w = await getDripWorkflowById(input.id);
        if (!w) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow not found" });
        const steps = await getDripStepsByWorkflow(input.id);
        const enrollments = await getEnrollmentsByWorkflow(input.id);
        return { ...w, steps, enrollmentCount: enrollments.length };
      }),

    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        audienceType: z.enum(["prospect", "agent"]),
        triggerStage: z.string().optional(),
        isActive: z.boolean().default(true),
      }))
      .mutation(async ({ input, ctx }) => {
        const id = await createDripWorkflow({ ...input, createdById: ctx.user.id });
        return { id };
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number().int(),
        name: z.string().min(1).optional(),
        triggerStage: z.string().optional().nullable(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateDripWorkflow(id, data);
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteDripWorkflow(input.id);
        return { success: true };
      }),

    saveSteps: adminProcedure
      .input(z.object({
        workflowId: z.number().int(),
        steps: z.array(z.object({
          stepOrder: z.number().int(),
          delayDays: z.number().int().min(0),
          subject: z.string().min(1),
          bodyHtml: z.string().min(1),
          bodyText: z.string().optional(),
          templateId: z.number().int().optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        await upsertDripSteps(input.workflowId, input.steps);
        return { success: true };
      }),

    enroll: adminProcedure
      .input(z.object({
        workflowId: z.number().int(),
        recipientEmail: z.string().email(),
        recipientName: z.string().optional(),
        recipientType: z.enum(["prospect", "agent"]),
        recipientId: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await enrollInDripWorkflow(input);
        return { id };
      }),
  }),

  // ── Campaign send (Resend) ────────────────────────────────────────────────

  campaigns: router({
    list: adminProcedure.query(async () => getAllCampaigns()),

    get: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .query(async ({ input }) => {
        const c = await getCampaignById(input.id);
        if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
        const stats = await getCampaignStats(input.id);
        return { ...c, stats };
      }),

    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        subject: z.string().min(1),
        bodyHtml: z.string().min(1),
        bodyText: z.string().optional(),
        audienceType: z.enum(["prospect", "agent"]),
        segmentFilters: z.string().optional(), // JSON string of filters
        templateId: z.number().int().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const id = await createCampaign({
          name: input.name,
          subject: input.subject,
          bodyHtml: input.bodyHtml,
          bodyText: input.bodyText,
          audienceType: input.audienceType,
          segmentFilters: input.segmentFilters,
          templateId: input.templateId,
          createdById: ctx.user.id,
        });
        return { id };
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number().int(),
        name: z.string().min(1).optional(),
        subject: z.string().min(1).optional(),
        bodyHtml: z.string().optional(),
        bodyText: z.string().optional(),
        audienceType: z.enum(["prospect", "agent"]).optional(),
        segmentFilters: z.string().optional(),
        templateId: z.number().int().optional().nullable(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateCampaign(id, data);
        return { success: true };
      }),

    send: adminProcedure
      .input(z.object({
        campaignId: z.number().int(),
        baseUrl: z.string().url(),
      }))
      .mutation(async ({ input, ctx }) => {
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
        if (campaign.status === "sent") throw new TRPCError({ code: "BAD_REQUEST", message: "Campaign already sent" });

        // Build recipient list from segmentFilters
        const rawFilters = campaign.segmentFilters ? JSON.parse(campaign.segmentFilters) : {};
        // Migrate legacy human-readable stage names to snake_case DB values
        const LEGACY_STAGE_MAP: Record<string, string> = {
          "New Enquiry": "new_enquiry",
          "AR Submitted": "application_received",
          "AR Approved": "ar_approved",
          "AR Declined": "ar_declined",
          "Discovery Call Booked": "discovery_call_booked",
          "Call Complete": "discovery_call_complete",
          "Did Not Turn Up": "did_not_turn_up",
          "Rebook Required": "rebook_required",
          "Approved": "onboarding_approved",
          "Rejected": "ar_declined",
          "Lost": "archived",
          "Won": "won",
          "Archived": "archived",
        };
        if (Array.isArray(rawFilters.stages)) {
          rawFilters.stages = rawFilters.stages.map((s: string) => LEGACY_STAGE_MAP[s] ?? s);
        }
        const filters = rawFilters;
        console.log("[Campaign Send Debug] campaignId:", input.campaignId, "audienceType:", campaign.audienceType, "segmentFilters raw:", campaign.segmentFilters, "parsed filters:", JSON.stringify(filters));
        let recipients: Array<{ email: string; name?: string; id?: number; type: "prospect" | "agent" }> = [];

        if (campaign.audienceType === "prospect") {
          // Use recruitment_prospects — the main pipeline table (900+ records)
          const { getAllRecruitmentProspects } = await import("./recruitment-db");
          // Pass limit: -1 sentinel to bypass the default 100-row limit
          const all = await getAllRecruitmentProspects({ limit: 999999 });
          console.log("[Campaign Send Debug] total prospects:", all.length, "sample stages:", Array.from(new Set(all.slice(0, 20).map(p => p.pipelineStage))));
          let filtered = all;
          if (filters.stages?.length) {
            // Allow filtering by specific pipeline stages — any (OR) or all (AND)
            if (filters.stageLogic === "all") {
              // AND: prospect must match every selected stage (only makes sense for multi-tag scenarios,
              // but honouring the user's explicit choice)
              filtered = filtered.filter((p) => filters.stages.every((s: string) => p.pipelineStage === s));
            } else {
              // ANY (OR, default): prospect matches at least one selected stage
              filtered = filtered.filter((p) => filters.stages.includes(p.pipelineStage));
            }
            console.log("[Campaign Send Debug] after stage filter:", filtered.length, "recipients");
          } else {
            // By default exclude archived and declined prospects
            filtered = filtered.filter(
              (p) => !['archived', 'onboarding_declined', 'won'].includes(p.pipelineStage)
            );
          }
          recipients = filtered
            .filter((p) => p.email)
            .map((p) => ({ email: p.email!, name: `${p.firstName} ${p.lastName}`.trim(), id: p.id, type: "prospect" as const }));
        } else {
          // Agents — join with agentCrmProfiles and agentTags for segmentation
          const { getDb } = await import("./db");
          const db = await getDb();
          if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
          const { agentCrmProfiles, agentTags: agentTagsTable, users: usersTable } = await import("../drizzle/schema");
          const { and, eq, inArray, isNotNull, sql: sqlFn } = await import("drizzle-orm");

          // Build base query: active agents with email
          const conditions: any[] = [
            sqlFn`${usersTable.role} = 'agent'`,
            isNotNull(usersTable.email),
          ];
          // Filter by agentStatus (active by default unless specified)
          const statusFilter = filters.agentStatus?.length ? filters.agentStatus : ["active"];
          conditions.push(inArray(agentCrmProfiles.agentStatus, statusFilter));

          // Filter by membershipTier
          if (filters.membershipTiers?.length) {
            conditions.push(inArray(agentCrmProfiles.membershipTier, filters.membershipTiers));
          }
          // Filter by trainingStage
          if (filters.trainingStages?.length) {
            conditions.push(inArray(agentCrmProfiles.trainingStage, filters.trainingStages));
          }

          const rows = await db
            .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, profileId: agentCrmProfiles.id })
            .from(usersTable)
            .innerJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, usersTable.id))
            .where(and(...conditions));

          let agentRows = rows;

          // Filter by active GoCardless mandate
          // Treat 'active' AND 'submitted' as having an active mandate:
          // GoCardless uses 'submitted' for mandates that have been successfully submitted
          // and are collecting — they are functionally active even before the status
          // transitions to 'active' in our local sync.
          if (filters.hasActiveMandate != null) {
            const { gcMandates } = await import("../drizzle/schema");
            const { inArray } = await import("drizzle-orm");
            const mandateRows = await db
              .select({ userId: gcMandates.userId })
              .from(gcMandates)
              .where(inArray(gcMandates.status, ["active", "submitted"]));
            const agentIdsWithMandate = new Set(mandateRows.map((m) => m.userId).filter(Boolean) as number[]);
            if (filters.hasActiveMandate === true) {
              agentRows = agentRows.filter((u) => agentIdsWithMandate.has(u.id));
            } else {
              agentRows = agentRows.filter((u) => !agentIdsWithMandate.has(u.id));
            }
          }

          // Filter by tags (post-query)
          if (filters.tags?.length) {
            const tagRows = await db.select().from(agentTagsTable);
            const tagMap = new Map<number, string[]>();
            for (const t of tagRows) {
              if (!tagMap.has(t.userId)) tagMap.set(t.userId, []);
              tagMap.get(t.userId)!.push(t.tag);
            }
            agentRows = agentRows.filter((u) =>
              filters.tags.some((tag: string) => tagMap.get(u.id)?.includes(tag))
            );
          }

          recipients = agentRows
            .filter((u) => u.email)
            .map((u) => ({ email: u.email!, name: u.name ?? undefined, id: u.id, type: "agent" as const }));
        }

        if (recipients.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No recipients match the selected filters" });
        }

        // Pre-insert all recipients as 'queued' rows — restart-safe
        // The scheduler (processCampaignQueue) will pick these up in batches every 15 minutes
        await enqueueCampaignRecipients({
          campaignId: input.campaignId,
          recipients,
          subject: campaign.subject,
          audienceType: campaign.audienceType as "prospect" | "agent",
        });

        // Mark as sending (scheduler will flip to 'sent' when queue is drained)
        await updateCampaign(input.campaignId, {
          status: "sending",
          sentById: ctx.user.id,
          sentByName: ctx.user.name ?? "Admin",
          totalRecipients: recipients.length,
        });

        return { success: true, recipientCount: recipients.length };
      }),

    stats: adminProcedure
      .input(z.object({ campaignId: z.number().int() }))
      .query(async ({ input }) => getCampaignStats(input.campaignId)),

    // Get per-recipient send records with open/click status
    recipients: adminProcedure
      .input(z.object({ campaignId: z.number().int() }))
      .query(async ({ input }) => getCampaignRecipients(input.campaignId)),

    // Resend to a single recipient (by emailSend id)
    resendOne: adminProcedure
      .input(z.object({ sendId: z.number().int() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { emailSends } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const rows = await db.select().from(emailSends).where(eq(emailSends.id, input.sendId)).limit(1);
        const send = rows[0];
        if (!send) throw new TRPCError({ code: "NOT_FOUND", message: "Send record not found" });
        const campaign = await getCampaignById(send.campaignId!);
        if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
        const { sendMarketingEmail } = await import("./resend-email");
        await sendMarketingEmail({
          to: send.recipientEmail,
          toName: send.recipientName ?? undefined,
          subject: campaign.subject,
          bodyHtml: campaign.bodyHtml,
          audienceType: campaign.audienceType as "prospect" | "agent",
          campaignId: campaign.id,
          recipientId: send.recipientId ?? undefined,
          recipientType: campaign.audienceType as "prospect" | "agent",
          baseUrl: process.env.VITE_OAUTH_PORTAL_URL ?? "https://portal.thejltgroup.co.uk",
        });
        return { success: true };
      }),

    // Resend to all recipients who haven't opened the campaign
    resendUnopenedAll: adminProcedure
      .input(z.object({ campaignId: z.number().int() }))
      .mutation(async ({ input }) => {
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
        const allSends = await getCampaignRecipients(input.campaignId);
        const unopened = allSends.filter((s) => !['opened','clicked'].includes(s.status ?? ''));
        if (unopened.length === 0) return { success: true, count: 0 };
        const { sendMarketingEmail } = await import("./resend-email");
        let sent = 0;
        // Throttle to max 3 sends/sec to stay within Resend's 5 req/sec rate limit
        const BATCH_SIZE = 3;
        const BATCH_DELAY_MS = 1100;
        for (let i = 0; i < unopened.length; i++) {
          const s = unopened[i];
          try {
            await sendMarketingEmail({
              to: s.recipientEmail,
              toName: s.recipientName ?? undefined,
              subject: campaign.subject,
              bodyHtml: campaign.bodyHtml,
              audienceType: campaign.audienceType as "prospect" | "agent",
              campaignId: campaign.id,
              recipientId: s.recipientId ?? undefined,
              recipientType: campaign.audienceType as "prospect" | "agent",
              baseUrl: process.env.VITE_OAUTH_PORTAL_URL ?? "https://portal.thejltgroup.co.uk",
            });
            sent++;
          } catch { /* continue on individual failure */ }
          // Pause after every BATCH_SIZE sends to respect rate limit
          if ((i + 1) % BATCH_SIZE === 0 && i + 1 < unopened.length) {
            await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
          }
        }
        return { success: true, count: sent };
      }),
  }),

  // ── Email Branding Settings ──────────────────────────────────────────────────
  emailBranding: router({
    get: protectedProcedure.query(async () => {
      return getEmailBrandingSettings();
    }),

    update: adminProcedure
      .input(
        z.object({
          logoUrl: z.string().nullable().optional(),
          headerBgColor: z.string().optional(),
          headerTextColor: z.string().optional(),
          bodyBgColor: z.string().optional(),
          cardBgColor: z.string().optional(),
          accentColor: z.string().optional(),
          companyName: z.string().optional(),
          tagline: z.string().nullable().optional(),
          footerText: z.string().nullable().optional(),
          websiteUrl: z.string().nullable().optional(),
          facebookUrl: z.string().nullable().optional(),
          instagramUrl: z.string().nullable().optional(),
          twitterUrl: z.string().nullable().optional(),
          linkedinUrl: z.string().nullable().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        return upsertEmailBrandingSettings(input, ctx.user.id);
      }),

    uploadLogo: adminProcedure
      .input(
        z.object({
          fileName: z.string(),
          fileBase64: z.string(),
          mimeType: z.string(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const key = `email-branding/logo-${Date.now()}-${input.fileName}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        await upsertEmailBrandingSettings({ logoUrl: url }, ctx.user.id);
        return { url };
      }),

    uploadImage: adminProcedure
      .input(
        z.object({
          fileName: z.string(),
          fileBase64: z.string(),
          mimeType: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const ext = input.fileName.split(".").pop() ?? "jpg";
        const key = `email-images/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        return { url };
      }),
  }),

   // ── Email Unsubscribes ─────────────────────────────────────────────────────────────────────────────
  emailUnsubscribes: router({
    list: adminProcedure
      .input(z.object({
        search: z.string().optional(),
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      }))
      .query(async ({ input }) => {
        const db = await (await import("./db")).getDb();
        if (!db) return { rows: [], total: 0 };
        const { emailUnsubscribes } = await import("../drizzle/schema");
        const { like, or, sql, desc } = await import("drizzle-orm");
        const conditions = [];
        if (input.search) {
          conditions.push(like(emailUnsubscribes.email, `%${input.search}%`));
        }
        const where = conditions.length > 0 ? or(...conditions) : undefined;
        const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(emailUnsubscribes).where(where);
        const rows = await db.select().from(emailUnsubscribes).where(where).orderBy(desc(emailUnsubscribes.unsubscribedAt)).limit(input.limit).offset(input.offset);
        return { rows, total: Number(countRow.count) };
      }),
    remove: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        const db = await (await import("./db")).getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { emailUnsubscribes } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db.delete(emailUnsubscribes).where(eq(emailUnsubscribes.id, input.id));
        return { success: true };
      }),
  }),

  // ── Agent Email Log ──────────────────────────────────────────────────────────────────────────────
  agentEmailLog: router({
    list: adminProcedure
      .input(
        z.object({
          search: z.string().optional(),
          triggerKey: z.string().optional(),
          limit: z.number().min(1).max(200).default(50),
          offset: z.number().min(0).default(0),
        })
      )
      .query(async ({ input }) => {
        const { getAgentEmailLog } = await import("./crm-db");
        return getAgentEmailLog(input);
      }),
    getBody: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const db = await (await import("./db")).getDb();
        if (!db) return null;
        const { agentEmails } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const [row] = await db.select().from(agentEmails).where(eq(agentEmails.id, input.id)).limit(1);
        return row ?? null;
      }),
    resend: adminProcedure
      .input(z.object({
        // The original email log entry to resend
        sourceEmailId: z.number().int(),
        // User IDs of agents to resend to
        recipientUserIds: z.array(z.number().int()).min(1).max(100),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await (await import("./db")).getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { agentEmails, users } = await import("../drizzle/schema");
        const { eq, inArray } = await import("drizzle-orm");

        // Fetch the original email
        const [original] = await db.select().from(agentEmails).where(eq(agentEmails.id, input.sourceEmailId)).limit(1);
        if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Email not found" });
        if (!original.bodyHtml) throw new TRPCError({ code: "BAD_REQUEST", message: "Email has no HTML body to resend" });

        // Fetch recipient agents
        const recipients = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, input.recipientUserIds));

        if (!recipients.length) throw new TRPCError({ code: "BAD_REQUEST", message: "No valid recipients found" });

        const { sendDirectEmail } = await import("./email");
        const results: Array<{ userId: number; email: string; success: boolean; error?: string }> = [];

        for (const recipient of recipients) {
          if (!recipient.email) {
            results.push({ userId: recipient.id, email: "", success: false, error: "No email address" });
            continue;
          }
          const result = await sendDirectEmail({
            toEmail: recipient.email,
            toName: recipient.name ?? recipient.email,
            subject: original.subject,
            html: original.bodyHtml,
            ...({
              userId: recipient.id,
              triggerKey: `resend:${original.triggerKey ?? "direct"}`,
            } as any),
          });
          results.push({ userId: recipient.id, email: recipient.email, success: result.success, error: result.error });
        }

        const sent = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        return { sent, failed, results };
      }),
  }),
});
