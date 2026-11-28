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
      flightRequestsFaremine: 1,
      financialsGoCardlessOnlyVat: 1,
      staffHandbookInternal: 1,
      staffWorkloadReporting: 1,
      privateStaffCalls: 1,
      amendmentDepartureFilters: 1,
      staffHandbookSimpleSave: 1,
      staffHandbookFirstUse: 1,
      staffHandbookCsvImport: 1,
      staffHandbookBrowseOrdering: 1,
      academyQuestionPasteToggle: 1,
      academyLiveQuestionWording: 1,
      academyFirstClassWeeklyAccess: 1,
      academyFirstClassResourceConversion: 1,
      academyFirstClassConversionDiagnostics: 1,
      academyFirstClassLargeResourceConversion: 1,
      crmMembershipMultiFilters: 1,
      managementHqProductionWiring: 1,
      managementHqConnectionCheck: 1,
      managementHqInitialImport: 1,
      managementHqConfigurationDiagnostics: 1,
      managementHqFinancialHeadlineEligibility: 1,
      managementHqRegisteredPendingActive: 1,
      managementHqFirstPageCheck: 1,
      managementHqInitialRecovery: 1,
      managementHqChunkedStorageV2: 1,
      managementHqStagedInitialResume: 1,
      managementHqImportResponsiveness: 1,
      managementHqInitialRunPerformance: 1,
      managementHqInitialReuseLifecycle: 1,
      managementHqInitialCapacityRepair: 1,
      managementHqInitialCompletionVerification: 1,
      managementHqBoundedReports: 1,
      managementHqInitialBackground: 1,
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
