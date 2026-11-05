import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import {
  agentCrmProfiles,
  agentRecordMerges,
  staffRoleAssignments,
  staffInstructorCourses,
  staffAccessAudit,
  users,
  type User,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  NO_STAFF_ACCESS,
  normaliseStaffCourseIds,
  staffAccountEligible,
  type StaffAccessSnapshot,
} from "../shared/staff-access";

export function isFullAdmin(user: Pick<User, "role">): boolean {
  return user.role === "admin" || user.role === "super_admin";
}
export function isMissingStaffSchemaError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as {
      code?: string;
      errno?: number;
      sqlMessage?: string;
      message?: string;
      cause?: unknown;
    };
    if (
      (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) &&
      /\bstaff_(role_assignments|instructor_courses|access_audit|academy_uploads)\b/.test(
        e.sqlMessage ?? e.message ?? ""
      )
    )
      return true;
    current = e.cause;
  }
  return false;
}

/** Reads fresh user/account state as well as grants; stale session or client flags never confer staff access. */
export async function getStaffAccessSnapshot(
  user: User
): Promise<StaffAccessSnapshot> {
  if (isFullAdmin(user)) return { ...NO_STAFF_ACCESS, courseIds: [] };
  if (user.role !== "agent") return { ...NO_STAFF_ACCESS, courseIds: [] };
  try {
    const db = await getDb();
    if (!db)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Staff permissions could not be verified",
      });
    // Query the new entitlement first so pre-migration ordinary agents degrade safely.
    const assignments = await db
      .select({
        id: staffRoleAssignments.id,
        staffRole: staffRoleAssignments.staffRole,
      })
      .from(staffRoleAssignments)
      .where(
        and(
          eq(staffRoleAssignments.userId, user.id),
          eq(staffRoleAssignments.isActive, true)
        )
      );
    if (!assignments.length) return { ...NO_STAFF_ACCESS, courseIds: [] };
    const [account] = await db
      .select({
        role: users.role,
        isActive: users.isActive,
        portalStatus: users.portalStatus,
        mustChangePassword: users.mustChangePassword,
        crmStatus: agentCrmProfiles.agentStatus,
        archiveId: agentRecordMerges.id,
      })
      .from(users)
      .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, users.id))
      .leftJoin(agentRecordMerges, eq(agentRecordMerges.sourceUserId, users.id))
      .where(eq(users.id, user.id))
      .limit(1);
    if (
      !account ||
      !staffAccountEligible({
        ...account,
        archived: account.archiveId !== null,
      })
    ) {
      return { ...NO_STAFF_ACCESS, courseIds: [] };
    }
    const instructor = assignments.find(a => a.staffRole === "instructor");
    const courses = instructor
      ? await db
          .select({ courseId: staffInstructorCourses.courseId })
          .from(staffInstructorCourses)
          .where(eq(staffInstructorCourses.assignmentId, instructor.id))
      : [];
    const courseIds = normaliseStaffCourseIds(courses.map(c => c.courseId));
    return {
      instructor: !!instructor && courseIds.length > 0,
      engagement: assignments.some(a => a.staffRole === "agent_engagement"),
      courseIds,
      schemaAvailable: true,
    };
  } catch (error) {
    if (isMissingStaffSchemaError(error))
      return { ...NO_STAFF_ACCESS, courseIds: [], schemaAvailable: false };
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Staff permissions could not be verified",
    });
  }
}
export async function getInstructorCourseIds(
  user: User
): Promise<number[] | null> {
  if (isFullAdmin(user)) return null;
  const snapshot = await getStaffAccessSnapshot(user);
  return snapshot.instructor ? snapshot.courseIds : [];
}
export async function requireInstructorCourse(
  user: User,
  courseId: number
): Promise<void> {
  if (!Number.isSafeInteger(courseId) || courseId < 1)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Course permission required",
    });
  if (isFullAdmin(user)) return;
  const courses = await getInstructorCourseIds(user);
  if (!courses?.includes(courseId))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This course is not assigned to you as an Instructor",
    });
}
export async function requireEngagementStaff(user: User): Promise<void> {
  if (isFullAdmin(user)) return;
  if (!(await getStaffAccessSnapshot(user)).engagement)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Agent Engagement staff access required",
    });
}
export function assertNotSelfReview(user: User, learnerId: number): void {
  if (!isFullAdmin(user) && user.id === learnerId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You cannot review or mark your own work",
    });
}
export async function recordStaffOperation(
  user: User,
  action: string,
  metadata: Record<string, unknown>
): Promise<void> {
  if (isFullAdmin(user)) return; // Existing administrator workflows keep their existing audit.
  try {
    const db = await getDb();
    if (!db) throw new Error("Missing audit storage");
    await db
      .insert(staffAccessAudit)
      .values({ actorId: user.id, targetUserId: user.id, action, metadata });
  } catch {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Staff audit storage unavailable",
    });
  }
}
