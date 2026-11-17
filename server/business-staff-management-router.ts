import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { BUSINESS_STAFF_ORBIT_NOTICE } from "../shared/business-staff";
import {
  businessStaffManagement, adminListInput, peopleSearchInput, linkExistingInput,
  createStaffInput, updatePermissionsInput, setStatusInput, createSetupLinkInput,
} from "./business-staff-management";

/** Integration: appRouter.businessStaff = businessStaffRouter. No owner self-management. */
export const businessStaffRouter = router({
  mine: protectedProcedure.query(async ({ ctx }) => {
    // Parent-owned core authority is the sole classification/permission implementation.
    const { getBusinessStaffAuthority } = await import("./business-staff-access");
    const authority = await getBusinessStaffAuthority(ctx.user);
    return { ...authority, orbitReady: false as const, orbitNotice: BUSINESS_STAFF_ORBIT_NOTICE };
  }),
  ownerSummary: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "agent" || !ctx.user.isActive || ctx.user.portalStatus !== "active") return { hasStaff: false };
    try {
      const { getDb } = await import("./db");
      const { businessStaffMemberships } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new Error("Unavailable");
      const rows = await db.select({ id: businessStaffMemberships.id }).from(businessStaffMemberships).where(eq(businessStaffMemberships.ownerUserId, ctx.user.id)).limit(1);
      return { hasStaff: rows.length > 0 };
    } catch {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Business staff details could not be verified." });
    }
  }),
  adminList: adminProcedure.input(adminListInput).query(({ ctx, input }) => businessStaffManagement.adminList(ctx.user.id, input)),
  searchOwners: adminProcedure.input(peopleSearchInput).query(({ ctx, input }) => businessStaffManagement.searchOwners(ctx.user.id, input)),
  searchAccounts: adminProcedure.input(peopleSearchInput).query(({ ctx, input }) => businessStaffManagement.searchAccounts(ctx.user.id, input)),
  linkExisting: adminProcedure.input(linkExistingInput).mutation(({ ctx, input }) => businessStaffManagement.linkExisting(ctx.user.id, input)),
  createStaff: adminProcedure.input(createStaffInput).mutation(({ ctx, input }) => businessStaffManagement.createStaff(ctx.user.id, input)),
  updatePermissions: adminProcedure.input(updatePermissionsInput).mutation(({ ctx, input }) => businessStaffManagement.updatePermissions(ctx.user.id, input)),
  setStatus: adminProcedure.input(setStatusInput).mutation(({ ctx, input }) => businessStaffManagement.setStatus(ctx.user.id, input)),
  createSetupLink: adminProcedure.input(createSetupLinkInput).mutation(({ ctx, input }) => businessStaffManagement.createSetupLink(ctx.user.id, input)),
});
export default businessStaffRouter;
