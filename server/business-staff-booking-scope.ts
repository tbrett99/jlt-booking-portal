import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
import { getBusinessStaffAuthority } from "./business-staff-access";
import type { BusinessStaffAuthority } from "./business-staff-access";

export type BookingAccessMode = "read" | "operate";
export type BookingScopeContext = Pick<TrpcContext, "user"> & { businessStaffAuthority?: BusinessStaffAuthority | null };
export type BookingActorScope = { managed: boolean; ownerUserId: number; actorUserId: number; membershipId: number | null };

/** Owner is a server-verified business relationship, never a client-selected user. */
export async function getBookingActorScope(ctx: BookingScopeContext, mode: BookingAccessMode = "read"): Promise<BookingActorScope> {
  const user = ctx.user;
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  const authority = ctx.businessStaffAuthority === undefined
    ? user.role === "agent" ? await getBusinessStaffAuthority(user) : null
    : ctx.businessStaffAuthority;
  if (!authority?.managed) return { managed: false, ownerUserId: user.id, actorUserId: user.id, membershipId: null };
  if (!authority.active || !authority.membership?.permissions.viewBookings || (mode === "operate" && !authority.membership.permissions.manageBookings)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This business staff booking permission is not available." });
  }
  return { managed: true, ownerUserId: authority.membership.ownerUserId, actorUserId: user.id, membershipId: authority.membership.id };
}

/** Check the real booking record. Staff never access another business or an owner's personal file. */
export async function assertBookingActorAccess(
  ctx: BookingScopeContext,
  booking: { agentId: number; isPersonalBooking?: boolean | number | null },
  mode: BookingAccessMode = "read",
): Promise<BookingActorScope> {
  const scope = await getBookingActorScope(ctx, mode);
  if (scope.managed) {
    if (booking.agentId !== scope.ownerUserId || !(booking.isPersonalBooking === false || booking.isPersonalBooking === 0)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "This booking is not available to this business staff account." });
    }
  } else if (ctx.user?.role === "agent" && booking.agentId !== ctx.user.id) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return scope;
}

/** Claim authorisation/state is not part of the normal business booking DTO. */
export function withoutStaffClaimFields<T extends object>(booking: T): T {
  const copy = { ...booking } as Record<string, unknown>;
  delete copy.commissionPreAuthorised;
  delete copy.commissionPreAuthorisedAt;
  delete copy.commissionPreAuthorisedById;
  return copy as T;
}

/** Existing ordinary behavior is retained; delegated writes and audit are atomic. */
export async function withBookingActorWrite<T>(
  ctx: BookingScopeContext,
  bookingId: number | null,
  work: (writer: any | undefined, scope: BookingActorScope) => Promise<T>,
  mode: BookingAccessMode = "operate",
  options: { referenceLock?: boolean; operation?: string } = {},
): Promise<T> {
  const scope = await getBookingActorScope(ctx, mode);
  if (!scope.managed) return work(undefined, scope);
  const { getDb } = await import("./db");
  const { users, businessStaffMemberships, businessStaffAudit } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const { readBusinessStaffPermissions } = await import("../shared/business-staff");
  const { eligibleBusinessBookingAccount, lockedBusinessBooking } = await import("./business-staff-bookings");
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking access could not be verified." });
  const transaction = async (tx: any) => {
    const accounts = new Map<number, any>();
    for (const id of [scope.actorUserId, scope.ownerUserId].sort((a, b) => a - b)) {
      const [account] = await tx.select({ id: users.id, role: users.role, isActive: users.isActive, portalStatus: users.portalStatus, mustChangePassword: users.mustChangePassword }).from(users).where(eq(users.id, id)).limit(1).for("update");
      if (!account) throw new TRPCError({ code: "FORBIDDEN" });
      accounts.set(id, account);
    }
    const rows = await tx.select({ id: businessStaffMemberships.id, staffUserId: businessStaffMemberships.staffUserId, ownerUserId: businessStaffMemberships.ownerUserId, status: businessStaffMemberships.status, permissions: businessStaffMemberships.permissions, revision: businessStaffMemberships.revision }).from(businessStaffMemberships).where(eq(businessStaffMemberships.staffUserId, scope.actorUserId)).limit(2).for("update");
    const member = rows[0];
    const permissions = readBusinessStaffPermissions(member?.permissions);
    if (rows.length !== 1 || member?.id !== scope.membershipId || member.staffUserId !== scope.actorUserId || member.ownerUserId !== scope.ownerUserId || member.status !== "active" || !permissions.viewBookings || (mode === "operate" && !permissions.manageBookings)) throw new TRPCError({ code: "FORBIDDEN", message: "This staff booking permission has changed." });
    await eligibleBusinessBookingAccount(tx, scope.actorUserId, "staff", true, accounts.get(scope.actorUserId));
    await eligibleBusinessBookingAccount(tx, scope.ownerUserId, "owner", true, accounts.get(scope.ownerUserId));
    if (bookingId !== null) await lockedBusinessBooking(tx, scope.ownerUserId, bookingId, true);
    const result = await work(tx, scope);
    const entityId = result && typeof result === "object" && "id" in result && Number.isSafeInteger(result.id) ? result.id : null;
    await tx.insert(businessStaffAudit).values({ membershipId: member.id, actorUserId: scope.actorUserId, action: options.operation ?? "booking_operation", reason: "Normal business booking operation", beforeState: null, afterState: { ownerUserId: scope.ownerUserId, bookingId, entityId, membershipRevision: member.revision } });
    return result;
  };
  if (options.referenceLock) {
    const { withBookingReferenceLock } = await import("./booking-reference-guard");
    return withBookingReferenceLock(locked => locked.transaction(transaction, { isolationLevel: "serializable" }));
  }
  return db.transaction(transaction, { isolationLevel: "serializable" });
}
