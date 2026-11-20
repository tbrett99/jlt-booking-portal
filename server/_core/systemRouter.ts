import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
      manualJoiningFeeReceiptGuard: 1,
      accountRecoverySafetyGuard: 1,
      adminTaskIdentityConsolidationGuard: 1,
      digestIntroRichFormatting: 1,
      academyLessonArchiveGuard: 1,
      academyPdfLessonEmbed: 1,
      academyUploadOnlyAssessment: 1,
      termsReviewCaa10aDraft: 1,
      agentSupportConversationalPilot: 1,
      agentSupportTopicRetrieval: 1,
      agentSupportValidationDiagnostics: 1,
      agentSupportScopedConditionChecks: 1,
      agentSupportDurationContext: 1,
      recruitmentSignupLinking: 1,
      businessStaffPermissions: 1,
      businessStaffOrbitPending: 1,
      businessStaffPortalResources: 1,
      businessStaffStandardBookings: 1,
      financialsGoCardlessOnlyVat: 1,
      staffHandbookInternal: 1,
      staffWorkloadReporting: 1,
      amendmentDepartureFilters: 1,
      staffHandbookSimpleSave: 1,
      staffHandbookFirstUse: 1,
      academyQuestionPasteToggle: 1,
      academyLiveQuestionWording: 1,
      academyFirstClassWeeklyAccess: 1,
      crmMembershipMultiFilters: 1,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
