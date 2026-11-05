# Staff UI integration handover

## Routing and authority

`/staff`, `/staff/instructor`, `/staff/engagement` are within the pure-agent branch of App's AuthRouter, before PortalLayout/SuspendedGuard mount. StaffWorkspace has its own restrained sidebar and `My Agent Portal` link to `/dashboard`; it never changes ViewModeContext or user.role. Agent personal finance, learning and booking routes remain intact. `/admin/staff-access` is routed and linked only for Super Admins. AuthRouter is now a named export for mocked rendered route tests.

StaffAccess.mine runs only for active agent accounts with password setup complete and isActive true. Missing schema, denied grants, lookup errors or inactive accounts do not mount instructor/engagement pages. The shell is also the authority context for disabled-on-denial staff hooks. No staff page imports full AdminAcademy/AdminAcademyActions/AdminAgentEngagement, users.listAgents, CRM pages or global insights. No polling is added.

## Instructor payloads

Uses academy.admin.courses/editor/saveCourse/saveModule/saveLesson/replaceQuestions and markingQueue/documentMarkingQueue/markWrittenAssessment/markDocumentAssessment. Saves course id explicitly, preserving existing isCoreAcademy/isAcceleratorJourney flags; status/publication are not controls. New modules/lessons attach only to the selected assigned parent. Question payloads retain existing IDs and actual answer/type/marking-guide fields. Every uploadAttachment/uploadDocumentAssessmentTemplate/uploadCourseImage payload includes courseId. Plain HTML lesson editor avoids CRM/email upload integration; dedicated Academy image uploads can populate a cover or append an image to lesson HTML. Uploads require a subsequent explicit form save.

Written marking sends `{attemptId,feedback,responses:[{questionId,score,feedback}]}` with a genuine score and feedback for every answer. Documents send `{attemptId,score,feedback}`. No AI, reset, migration, enrolment, waiver, delete, publish or accreditation controls. Downloads use only API-issued `/api/academy/assessment-document/` URLs, restricted to the portal origin; raw object keys/storage URLs are not rendered for assessment downloads. Self-review rows are excluded client-side in addition to server guards.

## Engagement payloads and DTOs

Uses agentDevelopment.admin.staffLearners **name-only** `{id,name}` array and staffActivity safe `{agent,activity,enrollments,actions,checkIns}` briefing after an explicit learner selection. Does not rely on full user/profile payloads or email being available.

Uses existing nested actionPlans/actionAssignments/actionReviewQueue/reviewAction DTOs. New Action drafts use selected_agents / immediate / ad_hoc, explicit targetAgentIds and optional staffReviewRequired; reward and course policy fields are omitted. Existing drafts retain actionType/audience/assignmentTrigger and omit policy fields, so backend retains configured review/reward/journey rules. PublishActionPlan is an explicit confirmed Action assignment only, never course publication. No reminder/bulk-email endpoint is called. Reviews are confirmation-gated, preserve feedback on failure, and only show saved success after server confirmation.

Check-ins use engagementCases/getEngagementCase/createEngagementCase/logEngagementInteraction with `{case,agent,latestInteraction}` and detail `{case,agent,interactions:[{interaction,staff}]}` nesting. No profile fields are read. Case creation and interaction logging omit ownerId. `channel='email'` is visibly record-only and never sends email. Restricted backend writes remain engagement-only (not general CRM notes).

## Validation

All tests use mocked tRPC/auth hooks in happy-dom; no database/provider, browser, impersonation, grant, migration or Git operation is performed by this UI build. Test file: `client/src/pages/staff/StaffWorkspace.test.ts`. Tests cover denied direct routes, missing schema, lookup error with stale grants, disabled queries for inactive accounts, explicit course choice, safe learner picker, same-identity personal finance/Academy routing and staff-to-personal switch, explicit grant payload, failed marking/action/check-in draft retention, signed document links, and restricted engagement Action payloads. Parent should verify release/database readiness separately.
