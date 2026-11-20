import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "../drizzle/schema";
import { STAFF_WORK_DOMAINS, STAFF_WORK_METRICS } from "../shared/staff-workload";
import { validateStaffWorkRange } from "../shared/staff-workload-periods";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { getStaffWorkloadDetails, getStaffWorkloadSummary } from "./staff-workload-report";

export async function requireFreshStaffWorkSuperAdmin(db: any, user: { id: number; role: string }) {
  if (user.role !== "super_admin" || !Number.isSafeInteger(user.id) || user.id < 1) throw new TRPCError({ code: "FORBIDDEN", message: "Active super admin access required." });
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Staff workload access cannot be verified: database unavailable." });
  const rows = await db.select({ id: users.id, role: users.role, isActive: users.isActive, portalStatus: users.portalStatus }).from(users).where(eq(users.id, user.id)).limit(2);
  const fresh = rows[0];
  if (rows.length !== 1 || fresh.id !== user.id || fresh.role !== "super_admin" || fresh.isActive !== true || fresh.portalStatus !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Active super admin access required." });
}
const procedure = protectedProcedure.use(async ({ ctx, next }) => {
  const db = await getDb();
  await requireFreshStaffWorkSuperAdmin(db, ctx.user);
  return next({ ctx: { ...ctx, staffWorkDb: db! } });
});
const rangeShape = { rangeStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), rangeEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) };
function validateRange(input: { rangeStart: string; rangeEnd: string }) {
  try { validateStaffWorkRange(input); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Choose a valid report range." }); }
}
function reportError(error: unknown): never {
  // Surface only controlled safe-limit notices. Unexpected database failures never become zero totals.
  if (error instanceof Error && /^Staff workload .* (?:limit|verified|partial totals)/.test(error.message)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Staff workload history could not be verified. No partial totals are shown; please retry.", cause: error });
}
export const staffWorkloadProcedures = {
  workloadSummary: procedure.input(z.object(rangeShape)).query(async ({ input, ctx }) => {
    validateRange(input);
    try { return await getStaffWorkloadSummary(ctx.staffWorkDb, input); } catch (error) { reportError(error); }
  }),
  workloadDetails: procedure.input(z.object({ ...rangeShape, domain: z.enum(STAFF_WORK_DOMAINS), metric: z.enum(STAFF_WORK_METRICS), actorId: z.number().int().positive().nullable().optional(), page: z.number().int().min(1).max(100_000).default(1), pageSize: z.number().int().min(1).max(100).default(25) })).query(async ({ input, ctx }) => {
    validateRange(input);
    try { return await getStaffWorkloadDetails(ctx.staffWorkDb, input); } catch (error) { reportError(error); }
  }),
};
export const staffWorkloadRouter = router(staffWorkloadProcedures);
