/**
 * Join Router — public tRPC procedures for the agent sign-up flow.
 *
 * Flow:
 *  1. startSession   → creates a join_sessions row, returns sessionToken
 *  2. getSession     → returns current session state (for page refresh recovery)
 *  3. getContractTemplate → returns the active contract PDF URL
 *  4. signContract   → stores signature data, advances step to 'payment'
 *  5. initiatePayment → calls GoCardless (Instant Bank Pay + mandate), returns hosted URL
 *  6. sendTeamInvite → (Phase 4) sends invite email to team members
 *  7. acceptInvite   → (Phase 4) team member accepts invite, signs contract
 */

import { z } from "zod";
import { eq, and, isNull, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  joinSessions,
  teamInvites,
  agentTeams,
  users,
  agentCrmProfiles,
} from "../drizzle/schema";
import { getActiveContractTemplate } from "./crm-db";
import { createJoinBillingRequest, createBillingRequestFlow } from "./gocardless";
import {
  MEMBERSHIP_TIERS,
  MEMBERSHIP_TYPES,
  PAYMENT_DAYS,
  getJoiningFee,
  getMonthlyAmount,
  TIER_LABELS,
  TYPE_LABELS,
  MEMBER_COUNTS,
} from "../shared/membership";
import { sendDirectEmail } from "./email";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { sdk } from "./_core/sdk";
import { getSessionCookieOptions } from "./_core/cookies";
import { COOKIE_NAME } from "@shared/const";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateSessionToken(): string {
  return nanoid(64);
}

function sessionExpiresAt(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 24);
  return d;
}

async function getSessionByToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(joinSessions)
    .where(eq(joinSessions.sessionToken, token))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Join Router ──────────────────────────────────────────────────────────────

export const joinRouter = router({
  /**
   * Step 1: Start a new join session.
   * Called when the user submits the plan selection form.
   * Returns a sessionToken stored in localStorage.
   */
  startSession: publicProcedure
    .input(
      z.object({
        email: z.string().email("Please enter a valid email address"),
        membershipTier: z.enum(MEMBERSHIP_TIERS),
        membershipType: z.enum(MEMBERSHIP_TYPES),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Check if there's already an active session for this email
      // (allow re-use if not yet complete)
      const existing = await db
        .select()
        .from(joinSessions)
        .where(eq(joinSessions.email, input.email))
        .orderBy(joinSessions.createdAt)
        .limit(1);

      // If an active (non-expired, non-complete) session exists, return it
      if (existing[0] && existing[0].step !== "complete" && existing[0].expiresAt > new Date()) {
        // If the session is stuck at "payment" (billing request was never fulfilled),
        // reset it back to "contract" so the user can re-sign and try again.
        const resumeStep = existing[0].step === "payment" ? "contract" : existing[0].step;
        // Update tier/type in case they changed their mind, and reset step if needed
        await db
          .update(joinSessions)
          .set({
            membershipTier: input.membershipTier,
            membershipType: input.membershipType,
            step: resumeStep,
            // Clear any stale billing request data so a fresh one is created
            ...(existing[0].step === "payment" ? {
              billingRequestId: null,
              billingRequestFlowUrl: null,
            } : {}),
          })
          .where(eq(joinSessions.id, existing[0].id));
        return {
          sessionToken: existing[0].sessionToken,
          step: resumeStep,
          isResumed: true,
        };
      }

      // Create a new session
      const sessionToken = generateSessionToken();
      const expiresAt = sessionExpiresAt();

      await db.insert(joinSessions).values({
        sessionToken,
        email: input.email,
        membershipTier: input.membershipTier,
        membershipType: input.membershipType,
        step: "contract",
        expiresAt,
      });

      return {
        sessionToken,
        step: "contract",
        isResumed: false,
      };
    }),

  /**
   * Get the current session state (for page refresh recovery).
   */
  getSession: publicProcedure
    .input(z.object({ sessionToken: z.string() }))
    .query(async ({ input }) => {
      const session = await getSessionByToken(input.sessionToken);
      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found or expired" });
      }
      if (session.expiresAt < new Date()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Session has expired. Please start again." });
      }
      return {
        email: session.email,
        membershipTier: session.membershipTier,
        membershipType: session.membershipType,
        step: session.step,
        contractSignedAt: session.contractSignedAt,
        billingRequestFlowUrl: session.billingRequestFlowUrl,
        joiningFeePaidAt: session.joiningFeePaidAt,
        userId: session.userId,
      };
    }),

  /**
   * Get the active contract template PDF URL.
   * Called on the contract signing page to display the PDF.
   */
  getContractTemplate: publicProcedure.query(async () => {
    const template = await getActiveContractTemplate();
    if (!template) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No contract template available. Please contact JLT Group." });
    }
    return {
      id: template.id,
      name: template.name,
      pdfUrl: template.pdfUrl,
    };
  }),

  /**
   * Step 2: Sign the contract.
   * Stores drawn + typed signature, advances step to 'payment'.
   */
  signContract: publicProcedure
    .input(
      z.object({
        sessionToken: z.string(),
        signatureDataUrl: z.string().min(1, "Signature is required"),
        signerName: z.string().min(2, "Please enter your full name"),
        signerAddress: z.string().min(5, "Please enter your address"),
        consentConfirmed: z.boolean().optional(),
        signingUserAgent: z.string().optional(),
        contractTextSnapshot: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const session = await getSessionByToken(input.sessionToken);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      if (session.expiresAt < new Date()) throw new TRPCError({ code: "FORBIDDEN", message: "Session expired" });
      if (session.step === "complete") throw new TRPCError({ code: "BAD_REQUEST", message: "Sign-up already complete" });

      // Capture IP address
      const signingIp = (ctx.req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
        ?? ctx.req.socket?.remoteAddress
        ?? null;

      // Generate tamper-detection hash
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

      await db
        .update(joinSessions)
        .set({
          signatureDataUrl: input.signatureDataUrl,
          signerName: input.signerName,
          signerAddress: input.signerAddress,
          contractSignedAt: new Date(),
          step: "payment",
          ipAddress: signingIp,
          signingUserAgent: input.signingUserAgent ?? null,
          consentConfirmed: input.consentConfirmed ?? false,
          contractTextSnapshot: input.contractTextSnapshot ?? null,
          contractHash,
        })
        .where(eq(joinSessions.id, session.id));

      return { success: true, step: "payment" };
    }),

  /**
   * Step 3: Initiate payment.
   * Creates a GoCardless Billing Request with:
   *   - payment_request: Instant Bank Pay (joining fee)
   *   - mandate_request: BACS Direct Debit mandate
   * Returns the GoCardless hosted page URL to redirect the user to.
   */
  initiatePayment: publicProcedure
    .input(
      z.object({
        sessionToken: z.string(),
        origin: z.string().url(), // window.location.origin from frontend
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const session = await getSessionByToken(input.sessionToken);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      if (session.expiresAt < new Date()) throw new TRPCError({ code: "FORBIDDEN", message: "Session expired" });
      if (!session.contractSignedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Please sign the contract first" });
      }

      // If already initiated, return the existing URL (idempotency)
      if (session.billingRequestFlowUrl && session.step === "payment") {
        return { authorisationUrl: session.billingRequestFlowUrl };
      }

      const tier = (session.membershipTier ?? "business_class") as typeof MEMBERSHIP_TIERS[number];
      const type = (session.membershipType ?? "solo") as typeof MEMBERSHIP_TYPES[number];
      const joiningFee = getJoiningFee(type);
      const tierLabel = TIER_LABELS[tier];
      const typeLabel = TYPE_LABELS[type];

      // Build name parts from signer name
      const nameParts = (session.signerName ?? "").trim().split(/\s+/);
      const givenName = nameParts[0] ?? "";
      const familyName = nameParts.slice(1).join(" ") || undefined;

      // Create GoCardless Billing Request with Instant Bank Pay + mandate
      const brq = await createJoinBillingRequest({
        amountPence: joiningFee,
        description: `JLT Group Joining Fee — ${tierLabel} ${typeLabel}`,
      });

      // Create the hosted flow — prefilled_customer goes here, not in billing_request
      const flow = await createBillingRequestFlow({
        billingRequestId: brq.id,
        redirectUri: `${input.origin}/join/complete?token=${session.sessionToken}`,
        exitUri: `${input.origin}/join?step=payment&token=${session.sessionToken}`,
        prefilledCustomer: {
          givenName,
          familyName,
          email: session.email,
        },
      });

      // NOTE: gc_mandates row is created in the billing_request.fulfilled webhook
      // (not here) so we always have the real userId before inserting.

      // Store billing request details in session
      await db
        .update(joinSessions)
        .set({
          billingRequestId: brq.id,
          billingRequestFlowUrl: flow.authorisation_url,
        })
        .where(eq(joinSessions.id, session.id));

      return { authorisationUrl: flow.authorisation_url };
    }),

  /**
   * Get pricing info for display on the plan selection page.
   */
  getPricing: publicProcedure.query(() => {
    const tiers = MEMBERSHIP_TIERS.map((tier) => ({
      tier,
      label: TIER_LABELS[tier],
      types: MEMBERSHIP_TYPES.map((type) => ({
        type,
        label: TYPE_LABELS[type],
        memberCount: MEMBER_COUNTS[type],
        monthlyPence: getMonthlyAmount(tier, type),
        joiningFeePence: getJoiningFee(type),
      })),
    }));
    // Also expose a per-type map for easy frontend lookup
    const joiningFees = Object.fromEntries(
      MEMBERSHIP_TYPES.map((type) => [type, getJoiningFee(type)])
    ) as Record<string, number>;
    return {
      tiers,
      joiningFeePence: getJoiningFee("solo"), // kept for backwards compat
      joiningFees,
      paymentDays: [...PAYMENT_DAYS],
    };
  }),

  /**
   * Send a team member invite email.
   * Called after the team leader completes sign-up.
   * (Phase 4 — team leader must have a userId set on their session)
   */
  sendTeamInvite: publicProcedure
    .input(
      z.object({
        sessionToken: z.string(),
        invitedEmail: z.string().email(),
        origin: z.string().url(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const session = await getSessionByToken(input.sessionToken);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      if (!session.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Sign-up not yet complete" });
      }
      if (session.membershipType === "solo") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Solo membership does not support team members" });
      }

      // Get or create the team record
      const leader = await db
        .select()
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);
      if (!leader[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Leader account not found" });

      // Find the team for this leader (via agentCrmProfiles.teamId)
      const leaderProfile = await db
        .select()
        .from(agentCrmProfiles)
        .where(eq(agentCrmProfiles.userId, session.userId))
        .limit(1);

      let teamId = leaderProfile[0]?.teamId;
      if (!teamId) {
        // Create a team record
        const tierLabel = TIER_LABELS[(session.membershipTier ?? "business_class") as typeof MEMBERSHIP_TIERS[number]];
        const typeLabel = TYPE_LABELS[(session.membershipType ?? "duo") as typeof MEMBERSHIP_TYPES[number]];
        const [teamResult] = await db.insert(agentTeams).values({
          name: `${leader[0].name ?? session.email} — ${tierLabel} ${typeLabel}`,
          membershipTier: session.membershipTier ?? undefined,
        });
        teamId = (teamResult as any).insertId as number;

        // Link leader to team
        await db
          .update(agentCrmProfiles)
          .set({ teamId })
          .where(eq(agentCrmProfiles.userId, session.userId));
      }

      // Check if already invited
      const existingInvite = await db
        .select()
        .from(teamInvites)
        .where(
          and(
            eq(teamInvites.teamId, teamId),
            eq(teamInvites.invitedEmail, input.invitedEmail)
          )
        )
        .limit(1);

      if (existingInvite[0] && existingInvite[0].status === "pending" && existingInvite[0].expiresAt > new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "An invite has already been sent to this email" });
      }

      // Generate invite token
      const token = nanoid(64);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7-day expiry

      await db.insert(teamInvites).values({
        teamId,
        leaderId: session.userId,
        invitedEmail: input.invitedEmail,
        token,
        status: "pending",
        expiresAt,
      });

      // Send invite email
      const inviteUrl = `${input.origin}/join/accept?token=${token}`;
      const tierLabel = TIER_LABELS[(session.membershipTier ?? "business_class") as typeof MEMBERSHIP_TIERS[number]];
      const typeLabel = TYPE_LABELS[(session.membershipType ?? "duo") as typeof MEMBERSHIP_TYPES[number]];
      const leaderName = leader[0].name ?? "Your team leader";

      await sendDirectEmail({
        toEmail: input.invitedEmail,
        toName: input.invitedEmail,
        subject: `You've been invited to join JLT Group — ${tierLabel} ${typeLabel}`,
        html: `
          <div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF6ED;padding:32px;border-radius:16px;">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="background:#70FFE8;border-radius:50%;width:56px;height:56px;display:inline-flex;align-items:center;justify-content:center;">
                <span style="font-weight:700;color:#414141;font-size:1rem">JLT</span>
              </div>
              <h1 style="color:#414141;font-size:1.4rem;margin:16px 0 4px;">You're invited to join JLT Group</h1>
              <p style="color:#6b7280;font-size:.9rem;margin:0;">${leaderName} has invited you to join their ${tierLabel} ${typeLabel} membership.</p>
            </div>
            <div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:24px;">
              <p style="color:#414141;margin:0 0 16px;">As a team member, you'll need to:</p>
              <ol style="color:#414141;padding-left:20px;margin:0;">
                <li style="margin-bottom:8px;">Review and sign the JLT Group membership contract</li>
                <li style="margin-bottom:8px;">Complete your agent profile</li>
                <li style="margin-bottom:8px;">Upload your ID and proof of address</li>
              </ol>
              <p style="color:#6b7280;font-size:.85rem;margin:16px 0 0;"><strong>No payment required</strong> — your team leader covers the joining fee and monthly subscription.</p>
            </div>
            <div style="text-align:center;">
              <a href="${inviteUrl}" style="display:inline-block;background:#70FFE8;color:#414141;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:1rem;">Accept Invitation</a>
              <p style="color:#9ca3af;font-size:.75rem;margin:16px 0 0;">This invitation expires in 7 days. If you did not expect this email, please ignore it.</p>
            </div>
          </div>
        `,
      });

      return { success: true };
    }),

  /**
   * Get invite details by token (for the /join/accept page).
   */
  getInvite: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const rows = await db
        .select()
        .from(teamInvites)
        .where(eq(teamInvites.token, input.token))
        .limit(1);

      const invite = rows[0];
      if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      if (invite.status === "accepted") throw new TRPCError({ code: "BAD_REQUEST", message: "This invite has already been accepted" });
      if (invite.expiresAt < new Date()) throw new TRPCError({ code: "FORBIDDEN", message: "This invite has expired" });

      // Get team info
      const teamRows = await db
        .select()
        .from(agentTeams)
        .where(eq(agentTeams.id, invite.teamId))
        .limit(1);

      // Get leader info
      const leaderRows = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, invite.leaderId))
        .limit(1);

      return {
        invitedEmail: invite.invitedEmail,
        teamName: teamRows[0]?.name ?? "JLT Group Team",
        membershipTier: teamRows[0]?.membershipTier ?? null,
        leaderName: leaderRows[0]?.name ?? "Your team leader",
        expiresAt: invite.expiresAt,
      };
    }),

  /**
   * Accept a team invite: sign contract and complete onboarding (no payment).
   * The invited person must already have an account (via /register or OAuth).
   */
  acceptInvite: publicProcedure
    .input(
      z.object({
        token: z.string(),
        sessionToken: z.string(), // join session for contract signing
        signatureDataUrl: z.string().min(1),
        signerName: z.string().min(2),
        signerAddress: z.string().min(5),
        userId: z.number().int(), // the team member's user ID
        signingUserAgent: z.string().optional(),
        consentConfirmed: z.boolean().optional(),
        contractTextSnapshot: z.string().optional(),
      })
    )
     .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Validate invite
      const rows = await db
        .select()
        .from(teamInvites)
        .where(eq(teamInvites.token, input.token))
        .limit(1);
      const invite = rows[0];
      if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      if (invite.status === "accepted") throw new TRPCError({ code: "BAD_REQUEST", message: "Already accepted" });
      if (invite.expiresAt < new Date()) throw new TRPCError({ code: "FORBIDDEN", message: "Invite expired" });
      // Mark invite as accepted
      await db
        .update(teamInvites)
        .set({
          status: "accepted",
          acceptedAt: new Date(),
          acceptedByUserId: input.userId,
        })
        .where(eq(teamInvites.id, invite.id));
      // Store signing evidence in joinSessions if a session token was provided
      const signingIp = (ctx.req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
        ?? ctx.req.socket?.remoteAddress
        ?? null;
      const session = await getSessionByToken(input.sessionToken).catch(() => null);
      if (session) {
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
        await db
          .update(joinSessions)
          .set({
            signatureDataUrl: input.signatureDataUrl,
            signerName: input.signerName,
            signerAddress: input.signerAddress,
            contractSignedAt: new Date(),
            step: "complete",
            ipAddress: signingIp,
            signingUserAgent: input.signingUserAgent ?? null,
            consentConfirmed: input.consentConfirmed ?? false,
            contractTextSnapshot: input.contractTextSnapshot ?? null,
            contractHash,
          })
          .where(eq(joinSessions.id, session.id));
      }
      // Link team member to the team
      const existingProfile = await db
        .select()
        .from(agentCrmProfiles)
        .where(eq(agentCrmProfiles.userId, input.userId))
        .limit(1);

      if (existingProfile[0]) {
        await db
          .update(agentCrmProfiles)
          .set({ teamId: invite.teamId })
          .where(eq(agentCrmProfiles.userId, input.userId));
      } else {
        await db.insert(agentCrmProfiles).values({
          userId: input.userId,
          teamId: invite.teamId,
        } as any);
      }

      return { success: true };
    }),

  // ─── Admin: list join sessions ─────────────────────────────────────────────
  adminListSessions: protectedProcedure
    .input(z.object({
      status: z.enum(["all", "pending", "complete", "contract", "payment"]).default("all"),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin" && ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const { desc } = await import("drizzle-orm");

      let query = db
        .select({
          id: joinSessions.id,
          sessionToken: joinSessions.sessionToken,
          email: joinSessions.email,
          membershipTier: joinSessions.membershipTier,
          membershipType: joinSessions.membershipType,
          step: joinSessions.step,
          contractSignedAt: joinSessions.contractSignedAt,
          signerName: joinSessions.signerName,
          joiningFeePaidAt: joinSessions.joiningFeePaidAt,
          mandateId: joinSessions.mandateId,
          userId: joinSessions.userId,
          createdAt: joinSessions.createdAt,
          expiresAt: joinSessions.expiresAt,
        })
        .from(joinSessions)
        .$dynamic();

      if (input.status !== "all") {
        const { eq: eqFn } = await import("drizzle-orm");
        query = query.where(eqFn(joinSessions.step, input.status));
      }

      const rows = await query
        .orderBy(desc(joinSessions.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows;
    }),

  // ─── Admin: activate portal access for an agent ────────────────────────────
  adminApproveAgent: protectedProcedure
    .input(z.object({ userId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin" && ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .update(users)
        .set({ portalStatus: "active" })
        .where(eq(users.id, input.userId));
      return { success: true };
    }),

  // ─── Set password after payment (auto-login) ────────────────────────────────
  setPassword: publicProcedure
    .input(z.object({
      sessionToken: z.string(),
      password: z.string().min(8, "Password must be at least 8 characters"),
    }))
    .mutation(async ({ input, ctx }) => {
      const session = await getSessionByToken(input.sessionToken);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found or expired" });
      if (session.step !== "complete") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Payment not yet confirmed. Please wait a moment and refresh." });
      }
      if (!session.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Account not yet created — please wait a moment and try again." });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Hash and save the chosen password, clear mustChangePassword flag
      const hashed = await bcrypt.hash(input.password, 12);
      await db
        .update(users)
        .set({ tempPassword: hashed, mustChangePassword: false })
        .where(eq(users.id, session.userId));
      // Fetch user for openId
      const userRows = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
      const user = userRows[0];
      if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "User not found" });
      // Issue session cookie (auto-login)
      const token = await sdk.createSessionToken(user.openId, { name: user.name ?? user.email ?? "" });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, cookieOptions);
      return { success: true };
    }),

  // ─── Admin: list agent teams ───────────────────────────────────────────────
  adminListTeams: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin" && ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const { desc } = await import("drizzle-orm");

      const teams = await db
        .select({
          id: agentTeams.id,
          name: agentTeams.name,
          membershipTier: agentTeams.membershipTier,
          monthlySub: agentTeams.monthlySub,
          notes: agentTeams.notes,
          createdAt: agentTeams.createdAt,
        })
        .from(agentTeams)
        .orderBy(desc(agentTeams.createdAt));

      // Get member counts
      const teamsWithCounts = await Promise.all(
        teams.map(async (team) => {
          const members = await db
            .select({ userId: agentCrmProfiles.userId })
            .from(agentCrmProfiles)
            .where(eq(agentCrmProfiles.teamId, team.id));
          const invites = await db
            .select({ id: teamInvites.id, status: teamInvites.status, invitedEmail: teamInvites.invitedEmail })
            .from(teamInvites)
            .where(eq(teamInvites.teamId, team.id));
          return { ...team, memberCount: members.length, invites };
        })
      );

      return teamsWithCounts;
    }),

  // ── Admin: list abandoned sign-up sessions ──────────────────────────────────
  getAbandonedSessions: protectedProcedure
    .input(z.object({ daysIdle: z.number().int().min(0).default(0) }).optional())
    .query(async ({ ctx, input }) => {
      if (!['admin', 'super_admin'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select({
          id: joinSessions.id,
          email: joinSessions.email,
          membershipTier: joinSessions.membershipTier,
          membershipType: joinSessions.membershipType,
          step: joinSessions.step,
          contractSignedAt: joinSessions.contractSignedAt,
          joiningFeePaidAt: joinSessions.joiningFeePaidAt,
          createdAt: joinSessions.createdAt,
          updatedAt: joinSessions.updatedAt,
          expiresAt: joinSessions.expiresAt,
          sessionToken: joinSessions.sessionToken,
        })
        .from(joinSessions)
        .where(isNull(joinSessions.userId))
        .orderBy(desc(joinSessions.createdAt));

      const now = Date.now();
      const minDaysIdle = input?.daysIdle ?? 0;
      return rows
        .map((r) => {
          const createdMs = r.createdAt ? new Date(r.createdAt as any).getTime() : now;
          const updatedMs = r.updatedAt ? new Date(r.updatedAt as any).getTime() : createdMs;
          const daysIdle = Math.floor((now - updatedMs) / (1000 * 60 * 60 * 24));
          const daysAgo = Math.floor((now - createdMs) / (1000 * 60 * 60 * 24));
          let progress = 'Started application';
          if (r.joiningFeePaidAt) progress = 'Paid — awaiting account creation';
          else if (r.contractSignedAt) progress = 'Contract signed — payment pending';
          else if (r.step === 'payment') progress = 'Reached payment step';
          else if (r.step === 'contract') progress = 'Reached contract step';
          return { ...r, daysIdle, daysAgo, progress };
        })
        .filter((r) => r.daysIdle >= minDaysIdle);
    }),

  // ── Admin: send a nudge email to an abandoned sign-up ──────────────────────
  sendNudge: protectedProcedure
    .input(z.object({ sessionId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!['admin', 'super_admin'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const rows = await db
        .select()
        .from(joinSessions)
        .where(and(eq(joinSessions.id, input.sessionId), isNull(joinSessions.userId)))
        .limit(1);

      const session = rows[0];
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found or already completed' });

      const baseUrl = process.env.VITE_OAUTH_PORTAL_URL ?? 'https://portal.thejltgroup.co.uk';
      const resumeUrl = `${baseUrl}/join?token=${session.sessionToken}`;

      const tierLabel = session.membershipTier === 'business_class' ? 'Business Class'
        : session.membershipTier === 'first_class' ? 'First Class'
        : session.membershipTier === 'charter' ? 'Charter'
        : session.membershipTier ?? 'membership';

      const stepLabel = session.joiningFeePaidAt ? 'finalising your account'
        : session.contractSignedAt ? 'completing your payment'
        : session.step === 'payment' ? 'completing your payment'
        : 'reviewing and signing your contract';

      await sendDirectEmail({
        toEmail: session.email,
        toName: session.email.split('@')[0],
        subject: `You're almost there — complete your JLT Group application`,
        html: `
          <p>Hi there,</p>
          <p>We noticed you started your application to join JLT Group as a <strong>${tierLabel}</strong> member, but didn't quite finish.</p>
          <p>You were at the step of <strong>${stepLabel}</strong> — you're so close!</p>
          <p>Click the button below to pick up right where you left off:</p>
          <p style="margin: 24px 0;">
            <a href="${resumeUrl}" style="background:#70FFE8;color:#0a0a0a;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">Resume My Application</a>
          </p>
          <p>If you have any questions or need help, just reply to this email — we'd love to have you on board.</p>
          <p>The JLT Group Team</p>
        `,
      });

      return { ok: true, email: session.email };
    }),

  // ── Admin: resend team invite ───────────────────────────────────────────────
  adminResendTeamInvite: protectedProcedure
    .input(z.object({
      userId: z.number().int(),   // team leader's userId
      invitedEmail: z.string().email(),
      origin: z.string().url(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!['admin', 'super_admin'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const { eq: eqOp, and: andOp } = await import('drizzle-orm');
      const { nanoid } = await import('nanoid');

      // Find the leader's profile to get teamId
      const leaderProfile = await db
        .select({ teamId: agentCrmProfiles.teamId })
        .from(agentCrmProfiles)
        .where(eqOp(agentCrmProfiles.userId, input.userId))
        .limit(1);

      const leader = await db
        .select({ name: users.name, membershipTier: agentCrmProfiles.membershipTier, membershipType: joinSessions.membershipType })
        .from(users)
        .leftJoin(agentCrmProfiles, eqOp(agentCrmProfiles.userId, users.id))
        .leftJoin(joinSessions, eqOp(joinSessions.userId, users.id))
        .where(eqOp(users.id, input.userId))
        .limit(1);

      if (!leader[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'Leader not found' });

      let teamId = leaderProfile[0]?.teamId;
      if (!teamId) {
        // Create team if it doesn't exist yet
        const tierLabel = TIER_LABELS[(leader[0].membershipTier ?? 'business_class') as typeof MEMBERSHIP_TIERS[number]];
        const typeLabel = TYPE_LABELS[(leader[0].membershipType ?? 'duo') as typeof MEMBERSHIP_TYPES[number]];
        const [teamResult] = await db.insert(agentTeams).values({
          name: `${leader[0].name ?? 'Team Leader'} — ${tierLabel} ${typeLabel}`,
          membershipTier: leader[0].membershipTier ?? undefined,
        });
        teamId = (teamResult as any).insertId as number;
        await db.update(agentCrmProfiles).set({ teamId }).where(eqOp(agentCrmProfiles.userId, input.userId));
      }

      // Expire any existing pending invite for this email
      await db
        .update(teamInvites)
        .set({ status: 'expired' })
        .where(andOp(
          eqOp(teamInvites.teamId, teamId),
          eqOp(teamInvites.invitedEmail, input.invitedEmail),
        ));

      // Create new invite
      const token = nanoid(64);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await db.insert(teamInvites).values({
        teamId,
        leaderId: input.userId,
        invitedEmail: input.invitedEmail,
        token,
        status: 'pending',
        expiresAt,
      });

      const inviteUrl = `${input.origin}/join/accept?token=${token}`;
      const tierLabel = TIER_LABELS[(leader[0].membershipTier ?? 'business_class') as typeof MEMBERSHIP_TIERS[number]];
      const typeLabel = TYPE_LABELS[(leader[0].membershipType ?? 'duo') as typeof MEMBERSHIP_TYPES[number]];
      const leaderName = leader[0].name ?? 'Your team leader';

      await sendDirectEmail({
        toEmail: input.invitedEmail,
        toName: input.invitedEmail,
        subject: `You've been invited to join JLT Group — ${tierLabel} ${typeLabel}`,
        html: `
          <div style="font-family:'Poppins',Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFF6ED;padding:32px;border-radius:16px;">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="background:#70FFE8;border-radius:50%;width:56px;height:56px;display:inline-flex;align-items:center;justify-content:center;">
                <span style="font-weight:700;color:#414141;font-size:1rem">JLT</span>
              </div>
              <h1 style="color:#414141;font-size:1.4rem;margin:16px 0 4px;">You're invited to join JLT Group</h1>
              <p style="color:#6b7280;font-size:.9rem;margin:0;">${leaderName} has invited you to join their ${tierLabel} ${typeLabel} membership.</p>
            </div>
            <div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:24px;">
              <p style="color:#414141;margin:0 0 16px;">As a team member, you'll need to:</p>
              <ol style="color:#414141;padding-left:20px;margin:0;">
                <li style="margin-bottom:8px;">Review and sign the JLT Group membership contract</li>
                <li style="margin-bottom:8px;">Complete your agent profile</li>
                <li style="margin-bottom:8px;">Upload your ID and proof of address</li>
              </ol>
              <p style="color:#6b7280;font-size:.85rem;margin:16px 0 0;"><strong>No payment required</strong> — your team leader covers the joining fee and monthly subscription.</p>
            </div>
            <div style="text-align:center;">
              <a href="${inviteUrl}" style="display:inline-block;background:#70FFE8;color:#414141;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:1rem;">Accept Invitation</a>
              <p style="color:#9ca3af;font-size:.75rem;margin:16px 0 0;">This invitation expires in 7 days. If you did not expect this email, please ignore it.</p>
            </div>
          </div>
        `,
      });

      return { ok: true };
    }),

  // ── Admin: delete a join session (abandoned or application) ───────────────
  deleteJoinSession: protectedProcedure
    .input(z.object({ sessionId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (!['admin', 'super_admin'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const { eq: eqOp } = await import('drizzle-orm');
      // Safety: only allow deleting sessions that have NOT been converted to a user account
      const rows = await db
        .select({ id: joinSessions.id, userId: joinSessions.userId })
        .from(joinSessions)
        .where(eqOp(joinSessions.id, input.sessionId))
        .limit(1);
      if (!rows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });
      if (rows[0].userId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot delete a session that has been converted to an agent account. Delete the agent account instead.',
        });
      }
      await db.delete(joinSessions).where(eqOp(joinSessions.id, input.sessionId));
      return { ok: true };
    }),
});
