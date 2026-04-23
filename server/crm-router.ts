/**
 * CRM tRPC router — prospects, pipeline, AR forms, contracts, campaigns, remittances, payment config
 */
import { router, protectedProcedure, publicProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { nanoid } from "nanoid";
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
  createCampaignSends,
  updateCampaignSendStatus,
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
} from "./crm-db";
import { getAllUsers, getUserByEmail } from "./db";
import { storagePut } from "./storage";
import { sendDirectEmail } from "./email";
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
        // Send prospectus email (placeholder until real PDF uploaded)
        try {
          await sendDirectEmail({
            toEmail: input.email,
            toName: `${input.firstName} ${input.lastName}`,
            subject: "Welcome to JLT Group — Your Prospectus",
            html: `<p>Hi ${input.firstName},</p>
<p>Thank you for your interest in joining the JLT Group travel agency network.</p>
<p>We're excited to share more about the opportunity with you. Please find attached our prospectus (coming soon — we'll send it shortly).</p>
<p>In the meantime, we'd love for you to complete our <strong>Agent Application Form</strong> so we can learn more about you:</p>
<p><a href="${process.env.VITE_OAUTH_PORTAL_URL ?? ""}/apply/${prospect?.id}" style="background:#70FFE8;color:#414141;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;">Complete Your Application</a></p>
<p>If you have any questions, please don't hesitate to get in touch.</p>
<p>Best regards,<br/>The JLT Group Team</p>`,
          });
        } catch (e) {
          // Non-fatal — log but don't fail the submission
          console.warn("[CRM] Failed to send prospectus email:", e);
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

  campaigns: router({
    list: adminProcedure.query(async () => getAllCampaigns()),

    get: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .query(async ({ input }) => {
        const c = await getCampaignById(input.id);
        if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
        return c;
      }),

    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(1),
          subject: z.string().min(1),
          bodyHtml: z.string().min(1),
          segmentType: z.enum(["all_agents", "all_prospects", "all_contacts", "won_prospects", "custom"]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const id = await createCampaign({ ...input, createdById: ctx.user.id });
        return { success: true, id };
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          name: z.string().optional(),
          subject: z.string().optional(),
          bodyHtml: z.string().optional(),
          segmentType: z.enum(["all_agents", "all_prospects", "all_contacts", "won_prospects", "custom"]).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateCampaign(id, data);
        return { success: true };
      }),

    // Send a campaign (up to 500 recipients)
    send: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        const campaign = await getCampaignById(input.id);
        if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
        if (campaign.status === "sent") throw new TRPCError({ code: "BAD_REQUEST", message: "Campaign already sent" });

        // Build recipient list based on segment
        const allUsers = await getAllUsers();
        const allProspects = await (await import("./crm-db")).getAllProspects();

        type Recipient = { email: string; name: string };
        let recipients: Recipient[] = [];

        if (campaign.segmentType === "all_agents") {
          recipients = allUsers
            .filter((u) => u.isActive && u.email)
            .map((u) => ({ email: u.email!, name: u.name ?? u.email! }));
        } else if (campaign.segmentType === "all_prospects") {
          recipients = allProspects
            .filter((p) => p.email)
            .map((p) => ({ email: p.email, name: `${p.firstName} ${p.lastName}` }));
        } else if (campaign.segmentType === "won_prospects") {
          recipients = allProspects
            .filter((p) => p.stage === "Won" && p.email)
            .map((p) => ({ email: p.email, name: `${p.firstName} ${p.lastName}` }));
        } else {
          // all_contacts = agents + prospects combined (deduped by email)
          const emailSet = new Set<string>();
          const combined: Recipient[] = [];
          for (const u of allUsers.filter((u) => u.isActive && u.email)) {
            if (!emailSet.has(u.email!)) {
              emailSet.add(u.email!);
              combined.push({ email: u.email!, name: u.name ?? u.email! });
            }
          }
          for (const p of allProspects.filter((p) => p.email)) {
            if (!emailSet.has(p.email)) {
              emailSet.add(p.email);
              combined.push({ email: p.email, name: `${p.firstName} ${p.lastName}` });
            }
          }
          recipients = combined;
        }

        // Cap at 500
        recipients = recipients.slice(0, 500);

        // Mark as sending
        await updateCampaign(input.id, { status: "sending" });

        // Create send records
        await createCampaignSends(
          recipients.map((r) => ({
            campaignId: input.id,
            recipientEmail: r.email,
            recipientName: r.name,
          }))
        );

        // Send via Resend (or fallback SMTP)
        const sends = await getCampaignSends(input.id);
        let sentCount = 0;
        for (const send of sends) {
          try {
            await sendDirectEmail({
              toEmail: send.recipientEmail,
              toName: send.recipientName ?? send.recipientEmail,
              subject: campaign.subject,
              html: campaign.bodyHtml,
            });
            await updateCampaignSendStatus(send.id, "sent");
            sentCount++;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await updateCampaignSendStatus(send.id, "failed", msg);
          }
        }

        await updateCampaign(input.id, {
          status: "sent",
          sentAt: new Date(),
          sentCount,
        });

        return { success: true, sentCount };
      }),
  }),

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

  // ─── Agent CRM (registered portal agents) ────────────────────────────────
  agentCrm: router({
    list: adminProcedure.query(async () => {
      return listAgentsWithCrm();
    }),

    get: adminProcedure
      .input(z.object({ userId: z.number().int() }))
      .query(async ({ input }) => {
        const [profile, tags, supplierLogins] = await Promise.all([
          getAgentCrmProfile(input.userId),
          getAgentTags(input.userId),
          getAgentSupplierLogins(input.userId),
        ]);
        const decryptedProfile = profile ? await decryptAgentBankDetails(profile) : null;
        const decryptedLogins = supplierLogins.map((l) => ({
          ...l,
          password: decryptSupplierPassword(l),
        }));
        // Fetch join session contract data
        const { getDb } = await import("./db");
        const db = await getDb();
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
        })
      )
      .mutation(async ({ input }) => {
        const { userId, ...data } = input;
        await upsertAgentCrmProfile(userId, data as any);
        return { success: true };
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
                  <p style="margin:20px 0 0;color:#414141;">Please <strong>review their onboarding documents and activate their portal access</strong> in the CRM.</p>
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
          profileUpdate.pauseEndsAt = null;
          profileUpdate.noticeEndsAt = null;
          profileUpdate.cancelledAt = null;
        } else {
          // active — clear all date fields
          profileUpdate.pauseEndsAt = null;
          profileUpdate.noticeEndsAt = null;
          profileUpdate.cancelledAt = null;
          profileUpdate.suspendedAt = null;
        }

        await upsertAgentCrmProfile(input.userId, profileUpdate as any);

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
        await db.update(agentCrmProfiles).set({ teamId: input.teamId }).where(eq(agentCrmProfiles.userId, input.userId));
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
        "Supplier logins revoked",
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
    deleteRecord: superAdminProcedure
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
        const { adminOnboardingChecklist, users } = await import("../drizzle/schema");
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
          })
          .from(adminOnboardingChecklist)
          .leftJoin(users, eq(users.id, adminOnboardingChecklist.updatedById))
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
      const { users, agentCrmProfiles, adminOnboardingChecklist } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          portalStatus: users.portalStatus,
          createdAt: users.createdAt,
          membershipTier: agentCrmProfiles.membershipTier,
          dateJoined: agentCrmProfiles.dateJoined,
          uniqueAgentId: agentCrmProfiles.uniqueAgentId,
          trainingHubLogin: adminOnboardingChecklist.trainingHubLogin,
          jltEmailSetup: adminOnboardingChecklist.jltEmailSetup,
          idDocsReviewed: adminOnboardingChecklist.idDocsReviewed,
          contractReviewed: adminOnboardingChecklist.contractReviewed,
          welcomeEmailSent: adminOnboardingChecklist.welcomeEmailSent,
          portalAccessApproved: adminOnboardingChecklist.portalAccessApproved,
          ddSubscriptionCreated: adminOnboardingChecklist.ddSubscriptionCreated,
        })
        .from(users)
        .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, users.id))
        .leftJoin(adminOnboardingChecklist, eq(adminOnboardingChecklist.userId, users.id))
        .where(eq(users.portalStatus, "onboarding"))
        .orderBy(users.createdAt);
      return rows.map(r => {
        const steps = [
          r.trainingHubLogin ?? false,
          r.jltEmailSetup ?? false,
          r.idDocsReviewed ?? false,
          r.contractReviewed ?? false,
          r.welcomeEmailSent ?? false,
          r.portalAccessApproved ?? false,
          r.ddSubscriptionCreated ?? false,
        ];
        const completedSteps = steps.filter(Boolean).length;
        return { ...r, completedSteps, totalSteps: steps.length };
      });
    }),
  }),
});
