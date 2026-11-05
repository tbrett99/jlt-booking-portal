import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  academyCourses,
  agentCrmProfiles,
  agentRecordMerges,
  staffRoleAssignments,
  staffInstructorCourses,
  staffAccessAudit,
  users,
} from "../drizzle/schema";
import { getStaffAccessSnapshot } from "./staff-access";
import {
  STAFF_ROLES,
  normaliseStaffCourseIds,
  staffAccountEligible,
} from "../shared/staff-access";

const superAdminProcedure = protectedProcedure
  .use(({ ctx, next }) => {
    if (ctx.user.role !== "super_admin")
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only Super Admins can manage staff access",
      });
    return next({ ctx });
  })
  .use(async ({ next }) => {
    const result = await next();
    if (!result.ok && result.error.code === "INTERNAL_SERVER_ERROR") {
      return {
        ...result,
        error: new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Staff access could not be verified or saved. Refresh and try again.",
        }),
      };
    }
    return result;
  });
async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Staff access storage unavailable",
    });
  return db;
}
export const staffAccessRouter = router({
  mine: protectedProcedure.query(({ ctx }) => getStaffAccessSnapshot(ctx.user)),
  adminOptions: superAdminProcedure.query(async () => {
    const db = await database();
    const agents = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .leftJoin(agentRecordMerges, eq(agentRecordMerges.sourceUserId, users.id))
      .leftJoin(agentCrmProfiles, eq(agentCrmProfiles.userId, users.id))
      .where(
        and(
          eq(users.role, "agent"),
          eq(users.isActive, true),
          eq(users.portalStatus, "active"),
          eq(users.mustChangePassword, false),
          isNull(agentRecordMerges.id),
          sql`(${agentCrmProfiles.agentStatus} IS NULL OR TRIM(${agentCrmProfiles.agentStatus}) = '' OR LOWER(TRIM(${agentCrmProfiles.agentStatus})) = 'active')`
        )
      )
      .orderBy(asc(users.name));
    const courses = await db
      .select({
        id: academyCourses.id,
        title: academyCourses.title,
        status: academyCourses.status,
      })
      .from(academyCourses)
      .orderBy(asc(academyCourses.title));
    return { agents, courses };
  }),
  adminList: superAdminProcedure.query(async () => {
    const db = await database();
    const rows = await db
      .select({
        id: staffRoleAssignments.id,
        userId: staffRoleAssignments.userId,
        name: users.name,
        email: users.email,
        staffRole: staffRoleAssignments.staffRole,
        isActive: staffRoleAssignments.isActive,
        grantedAt: staffRoleAssignments.grantedAt,
      })
      .from(staffRoleAssignments)
      .innerJoin(users, eq(users.id, staffRoleAssignments.userId))
      .orderBy(asc(users.name));
    const scopes = await db
      .select({
        assignmentId: staffInstructorCourses.assignmentId,
        courseId: staffInstructorCourses.courseId,
      })
      .from(staffInstructorCourses);
    return rows.map(row => ({
      ...row,
      courseIds: normaliseStaffCourseIds(
        scopes.filter(s => s.assignmentId === row.id).map(s => s.courseId)
      ),
    }));
  }),
  adminSave: superAdminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        staffRole: z.enum(STAFF_ROLES),
        enabled: z.boolean(),
        courseIds: z.array(z.number().int().positive()).max(100).default([]),
        reason: z.string().trim().min(5).max(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await database();
      const courseIds = normaliseStaffCourseIds(input.courseIds);
      if (input.staffRole === "agent_engagement" && courseIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Course assignments belong to the Instructor role only",
        });
      }
      if (
        input.enabled &&
        input.staffRole === "instructor" &&
        !courseIds.length
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Select an existing course before granting Instructor access",
        });
      }
      return db.transaction(
        async tx => {
          const [account] = await tx
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
            .leftJoin(
              agentRecordMerges,
              eq(agentRecordMerges.sourceUserId, users.id)
            )
            .where(eq(users.id, input.userId))
            .limit(1)
            .for("update");
          if (!account || account.role !== "agent")
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Staff permissions must be added to an existing agent account",
            });
          if (
            input.enabled &&
            !staffAccountEligible({
              ...account,
              archived: account.archiveId !== null,
            })
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Only active, non-archived agents with completed login setup can receive staff access",
            });
          }
          if (input.enabled && courseIds.length) {
            const found = await tx
              .select({ id: academyCourses.id, status: academyCourses.status })
              .from(academyCourses)
              .where(inArray(academyCourses.id, courseIds));
            if (
              found.length !== courseIds.length ||
              found.some(c => c.status === "archived")
            ) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Select existing draft or published courses only",
              });
            }
          }
          const [existing] = await tx
            .select()
            .from(staffRoleAssignments)
            .where(
              and(
                eq(staffRoleAssignments.userId, input.userId),
                eq(staffRoleAssignments.staffRole, input.staffRole)
              )
            )
            .limit(1)
            .for("update");
          const oldScopes = existing
            ? await tx
                .select({ courseId: staffInstructorCourses.courseId })
                .from(staffInstructorCourses)
                .where(eq(staffInstructorCourses.assignmentId, existing.id))
            : [];
          const now = new Date();
          if (existing) {
            await tx
              .update(staffRoleAssignments)
              .set(
                input.enabled
                  ? {
                      isActive: true,
                      grantedById: ctx.user.id,
                      grantedAt: now,
                      revokedById: null,
                      revokedAt: null,
                    }
                  : {
                      isActive: false,
                      revokedById: ctx.user.id,
                      revokedAt: now,
                    }
              )
              .where(eq(staffRoleAssignments.id, existing.id));
          } else {
            await tx
              .insert(staffRoleAssignments)
              .values({
                userId: input.userId,
                staffRole: input.staffRole,
                isActive: input.enabled,
                grantedById: ctx.user.id,
                grantedAt: now,
                revokedById: input.enabled ? null : ctx.user.id,
                revokedAt: input.enabled ? null : now,
              });
          }
          const [saved] = await tx
            .select({
              id: staffRoleAssignments.id,
              isActive: staffRoleAssignments.isActive,
            })
            .from(staffRoleAssignments)
            .where(
              and(
                eq(staffRoleAssignments.userId, input.userId),
                eq(staffRoleAssignments.staffRole, input.staffRole)
              )
            )
            .limit(1);
          if (!saved || saved.isActive !== input.enabled)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Staff assignment could not be verified",
            });
          await tx
            .delete(staffInstructorCourses)
            .where(eq(staffInstructorCourses.assignmentId, saved.id));
          if (input.enabled && input.staffRole === "instructor") {
            await tx
              .insert(staffInstructorCourses)
              .values(
                courseIds.map(courseId => ({
                  assignmentId: saved.id,
                  courseId,
                }))
              );
          }
          const verifiedScopes = await tx
            .select({ courseId: staffInstructorCourses.courseId })
            .from(staffInstructorCourses)
            .where(eq(staffInstructorCourses.assignmentId, saved.id));
          const expected =
            input.enabled && input.staffRole === "instructor" ? courseIds : [];
          if (
            JSON.stringify(
              normaliseStaffCourseIds(verifiedScopes.map(c => c.courseId))
            ) !== JSON.stringify(expected)
          ) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Staff course scope could not be verified",
            });
          }
          await tx
            .insert(staffAccessAudit)
            .values({
              actorId: ctx.user.id,
              targetUserId: input.userId,
              action: input.enabled
                ? "staff_access_granted"
                : "staff_access_revoked",
              metadata: {
                staffRole: input.staffRole,
                reason: input.reason,
                previousActive: existing?.isActive ?? false,
                previousCourseIds: oldScopes.map(c => c.courseId),
                courseIds: expected,
              },
            });
          return { success: true, assignmentId: saved.id };
        },
        { isolationLevel: "serializable" }
      );
    }),
});
