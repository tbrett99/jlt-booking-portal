# Restricted staff access implementation contract

Approved scope: Instructor edits assigned existing First Class course directly and marks written/document assessments; Agent Engagement manages Academy Actions and agent activity/check-ins only. No Community/event delegation. Same existing agent identity/base role and personal portal. No actual accounts assigned or agent data modified by this build. First Class course does not yet exist; Super Admin selects explicit course IDs after creation, never infer grants by course title.

## Ownership

Parent owns shared/staff-access.ts, server/staff-access.ts, server/staff-access-router.ts, drizzle/schema.ts and migrations; server/routers.ts app router registration; integration, security review, SQL handover, validation/release. Other agents must not modify those files.

Academy implementer owns selective Academy procedure gates, scoped uploads/downloads and tests. Engagement implementer owns agent-development-router selective gates and safe DTOs, new engagement helper if needed and tests. UI implementer owns new staff pages/components and App/PortalLayout navigation, plus UI tests. Do not modify another owner's files.

## Fixed data/API contract

Base users.role remains agent; general adminProcedure and global CRM/finance/report endpoints remain unchanged. Additive DB tables:
- staff_role_assignments: id,userId,staffRole ('instructor'|'agent_engagement'),isActive,grantedById,grantedAt,revokedById,revokedAt. Unique userId+staffRole.
- staff_instructor_courses: id,assignmentId,courseId. Unique assignmentId+courseId.
- staff_access_audit: id,actorId,targetUserId,action,metadata JSON,createdAt.
- staff_academy_uploads: id,userId,courseId,objectKey,kind ('attachment'|'document_template'|'image'),createdAt. Unique objectKey.

Parent exports from server/staff-access.ts:
- requireInstructorCourse(user: User, courseId: number): Promise<void>; admin/super_admin allowed unchanged. Restricted agent requires active/nonarchived assignment and exact explicit course grant; no selflearner privilege bypass. Raises FORBIDDEN for unavailable assignment/schema and out of scope; no role rewrite.
- requireEngagementStaff(user: User): Promise<void>; admins allowed unchanged; agent needs active engagement grant.
- getInstructorCourseIds(user: User): Promise<number[]|null>; null means existing admin unrestricted, [] restricted no grants.
- isFullAdmin(user): boolean.
- assertNotSelfReview(user: User, learnerId: number): void; restricted staff only initially, no self marking; existing admin behavior not expanded or changed by unrelated scope.
- recordStaffOperation(user, action:string, metadata:Record<string,unknown>): Promise<void>; mandatory awaited auditing for restricted writes.
- staff status validation includes isActive, allowed portalStatus active (restricted staff), archived check, mustChangePassword false. Existing admin behavior unchanged.

trpc.staffAccess:
- mine query -> { instructor:boolean, engagement:boolean, courseIds:number[], schemaAvailable:boolean }; ordinary agents without schema return all false, no error disrupting own portal. All queries re-read grants server-side; no client role trust.
- adminOptions (SuperAdmin only) -> { agents:[{id,name,email}], courses:[{id,title,status}] }; minimal data.
- adminList (SuperAdmin only) -> [{id,userId,name,email,staffRole,isActive,courseIds:number[],grantedAt}]
- adminSave input {userId:number,staffRole:'instructor'|'agent_engagement',enabled:boolean,courseIds:number[],reason:string}; explicit course IDs existing, restricted active agent only, audited transaction. Enabling instructor requires >=1 course; existing inactive placeholder not auto access. Base role never changed.

## UI

Separate /staff workspace within agent branch, not admin view. /staff/instructor and /staff/engagement; /admin/staff-access SuperAdmin configuration page. Agent menu 'Staff workspace' only if grants. Staff pages own sidebar/header with My Agent Portal link; do not mount Admin workspace nav, global users.listAgents, CRM queries or admin dashboards.

Instructor allowed existing academy.admin APIs become capability-aware per procedure only: courses/editor (server-filtered), saveCourse (assigned existing only, protect global flags/status), saveModule/saveLesson/replaceQuestions/reorder only actual parent course, relevant uploadAttachment/uploadDocumentAssessmentTemplate plus new uploadCourseImage with courseId supplied for restricted users. Marking/document queues/markWritten/markDocument scope both attempt and enrolment relationships and reject self. Use current genuine marking logic/notifications/progression, no synthetic admin identity or createCaller role spoofing. No course creation/deletion/publish/archive/enrolment/access/waivers/accreditation/migration/reset APIs delegated. Existing admin behavior preserved.

Engagement allowed selective agentDevelopment.admin API gates only. Safe explicit minimal projections, not full users/profiles/CRM notes. Academy Actions create/edit/assign/review permitted; no reward-rule setting, bulk arbitrary email, course enrolment or content changes. Actions may award preconfigured points through existing validated path, no staff self review. Existing admin-only fields/effects must be protected for restricted inputs; manually logging channel='email' is a log, never send. Check-in operations write engagement interactions/audit only for restricted role, do not create/expose general CRM notes. No finance/CRM links.

No broad middleware widening, no empty missing-schema bypass, no unauthorized object ID access, no private fields hidden only on client, no insecure download route. All new schemas require separately supplied Railway SQL and user confirmation before release.
