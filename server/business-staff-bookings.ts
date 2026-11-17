import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { z } from "zod";
import {
  agentCrmProfiles,
  agentRecordMerges,
  bookings,
  businessStaffAudit,
  businessStaffBookingNotes,
  businessStaffMemberships,
  staffRoleAssignments,
  users,
} from "../drizzle/schema";
import { readBusinessStaffPermissions } from "../shared/business-staff";
import { protectedProcedure, router } from "./_core/trpc";
import {
  getBusinessStaffAuthority,
  requireBusinessStaffCapability,
  type BusinessStaffActor,
} from "./business-staff-access";
import { getDb } from "./db";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Connection = Database | Transaction;

const pagination = {
  page: z.number().int().min(1).max(100_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
};
const bookingInput = z.object({ bookingId: z.number().int().positive() }).strict();
const notesInput = bookingInput.extend(pagination).strict();
const addNoteInput = bookingInput.extend({ text: z.string().trim().min(1).max(2000) }).strict();

// Deliberately never project a complete booking, even temporarily. Refs are text,
// not provider URLs; supplier/document/ledger tables are outside this workspace.
const operationalFields = {
  id: bookings.id,
  clientName: bookings.clientName,
  departureDate: bookings.departureDate,
  bookedDate: bookings.bookedDate,
  topdogRef: bookings.topdogRef,
  ptsRef: bookings.ptsRef,
  crmRef: bookings.crmRef,
  destination: bookings.destination,
  passengers: bookings.passengers,
  numberOfNights: bookings.numberOfNights,
  currentStage: bookings.currentStage,
};
const membershipFields = {
  id: businessStaffMemberships.id,
  ownerUserId: businessStaffMemberships.ownerUserId,
  staffUserId: businessStaffMemberships.staffUserId,
  status: businessStaffMemberships.status,
  revision: businessStaffMemberships.revision,
  permissions: businessStaffMemberships.permissions,
};
const accountFields = {
  id: users.id,
  role: users.role,
  isActive: users.isActive,
  portalStatus: users.portalStatus,
  mustChangePassword: users.mustChangePassword,
};
const noteFields = {
  id: businessStaffBookingNotes.id,
  authorUserId: businessStaffBookingNotes.authorUserId,
  text: businessStaffBookingNotes.text,
  createdAt: businessStaffBookingNotes.createdAt,
};

// Orbit's grossBookingValue (the customer selling price) is stored in the
// existing bookings.grossCost field; see orbit-financial-sync.ts. The restricted
// response names it grossPrice and never reads supplier costs or the snapshot.
const customerGrossPriceColumn = bookings.grossCost;
function operationalBooking<T extends { currentStage: string }>(booking: T): T {
  const visibleStages = new Set(["New Booking", "To Add to PTS", "Added to PTS", "Awaiting Documents", "In Progress", "Cancelled", "Cancellation Requested"]);
  return { ...booking, currentStage: visibleStages.has(booking.currentStage) ? booking.currentStage : "Booking recorded" };
}

function forbidden(): never {
  throw new TRPCError({ code: "FORBIDDEN", message: "This business booking permission is not available." });
}
function missingBooking(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "Booking not available in this workspace." });
}
async function database(): Promise<Database> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Business bookings are temporarily unavailable." });
  return db;
}
async function safe<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof TRPCError) throw error;
    // Never expose driver SQL, provider data, connection details or raw note text.
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Business bookings are temporarily unavailable." });
  }
}
function bookingScope(ownerUserId: number, bookingId?: number) {
  return and(
    eq(bookings.agentId, ownerUserId),
    eq(bookings.isPersonalBooking, false),
    bookingId === undefined ? undefined : eq(bookings.id, bookingId),
  );
}
async function staffAuthority(user: BusinessStaffActor, permission: "viewBookings" | "addBookingNotes") {
  const authority = await requireBusinessStaffCapability(user, permission);
  if (user.role !== "agent" || !authority.managed || !authority.active || !authority.membership ||
    !authority.membership.permissions.viewBookings || !authority.membership.permissions[permission] ||
    authority.membership.staffUserId !== user.id || authority.membership.ownerUserId === user.id ||
    authority.membership.status !== "active" || authority.owner?.id !== authority.membership.ownerUserId) forbidden();
  return authority as typeof authority & { membership: NonNullable<typeof authority.membership> };
}

/** Strict owner/actor gate, projected and locked on the same write connection. */
async function eligibleAccount(db: Connection, userId: number, kind: "staff" | "owner", lock: boolean, lockedAccount?: typeof users.$inferSelect | Record<string, unknown>) {
  let query = db.select(accountFields).from(users).where(eq(users.id, userId)).limit(1);
  const account = lockedAccount ?? (await (lock ? query.for("update") : query))[0];
  if (!account || account.role !== "agent" || account.isActive !== true ||
      (kind === "staff" ? !["active", "onboarding"].includes(String(account.portalStatus)) : account.portalStatus !== "active") ||
      (kind === "staff" && account.mustChangePassword)) forbidden();
  let mergeQuery = db.select({ id: agentRecordMerges.id }).from(agentRecordMerges)
    .where(eq(agentRecordMerges.sourceUserId, userId)).limit(1);
  if ((await (lock ? mergeQuery.for("update") : mergeQuery)).length) forbidden();
  let rolesQuery = db.select({ id: staffRoleAssignments.id }).from(staffRoleAssignments)
    .where(eq(staffRoleAssignments.userId, userId)).limit(1);
  if ((await (lock ? rolesQuery.for("update") : rolesQuery)).length) forbidden();
  if (kind === "owner") {
    // A retained (even revoked) row means a staff-only identity, never an owner.
    let memberQuery = db.select({ id: businessStaffMemberships.id }).from(businessStaffMemberships)
      .where(eq(businessStaffMemberships.staffUserId, userId)).limit(1);
    if ((await (lock ? memberQuery.for("update") : memberQuery)).length) forbidden();
    let profileQuery = db.select({ id: agentCrmProfiles.id, agentStatus: agentCrmProfiles.agentStatus })
      .from(agentCrmProfiles).where(eq(agentCrmProfiles.userId, userId)).limit(2);
    const profiles = await (lock ? profileQuery.for("update") : profileQuery);
    if (profiles.length !== 1 || profiles[0].agentStatus !== "active") forbidden();
  } else {
    let ownerQuery = db.select({ id: businessStaffMemberships.id }).from(businessStaffMemberships)
      .where(eq(businessStaffMemberships.ownerUserId, userId)).limit(1);
    if ((await (lock ? ownerQuery.for("update") : ownerQuery)).length) forbidden();
  }
  return account;
}
async function ownedBooking(db: Connection, ownerUserId: number, bookingId: number, lock: boolean) {
  const query = db.select({ id: bookings.id }).from(bookings).where(bookingScope(ownerUserId, bookingId)).limit(1);
  const [booking] = await (lock ? query.for("update") : query);
  if (!booking) missingBooking();
  return booking;
}
export { eligibleAccount as eligibleBusinessBookingAccount, ownedBooking as lockedBusinessBooking };
async function ownerAuthority(user: BusinessStaffActor, db: Connection, lock = false) {
  if (user.role !== "agent") forbidden();
  const authority = await getBusinessStaffAuthority(user);
  if (authority.managed) forbidden();
  return eligibleAccount(db, user.id, "owner", lock);
}

async function amounts(db: Database, ownerUserId: number, ids: number[], allowed: boolean) {
  if (!allowed || !customerGrossPriceColumn || !ids.length) return new Map<number, string | null>();
  // Permission-dependent separate projection: money never enters the operational query.
  const rows = await db.select({ id: bookings.id, grossPrice: customerGrossPriceColumn }).from(bookings)
    .where(and(bookingScope(ownerUserId), inArray(bookings.id, ids))).limit(50);
  return new Map(rows.map(row => [row.id, row.grossPrice]));
}
async function readNotes(db: Database, ownerUserId: number, input: z.infer<typeof notesInput>) {
  await ownedBooking(db, ownerUserId, input.bookingId, false);
  const rows = await db.select(noteFields).from(businessStaffBookingNotes)
    .where(and(eq(businessStaffBookingNotes.bookingId, input.bookingId), eq(businessStaffBookingNotes.ownerUserId, ownerUserId)))
    .orderBy(desc(businessStaffBookingNotes.id)).limit(input.pageSize + 1).offset((input.page - 1) * input.pageSize);
  return { items: rows.slice(0, input.pageSize), page: input.page, pageSize: input.pageSize, hasMore: rows.length > input.pageSize };
}
async function insertNote(tx: Transaction, input: z.infer<typeof addNoteInput>, ownerUserId: number, authorUserId: number, membershipId: number | null) {
  const [created] = await tx.insert(businessStaffBookingNotes).values({
    bookingId: input.bookingId, ownerUserId, authorUserId, membershipId, text: input.text,
  }).$returningId();
  if (!created?.id) throw new Error("Note creation failed");
  if (membershipId !== null) {
    await tx.insert(businessStaffAudit).values({
      membershipId, actorUserId: authorUserId, action: "booking_note", reason: "Business staff note",
      afterState: { bookingId: input.bookingId, noteId: created.id },
    });
  }
  // For owner posts there is no membership and businessStaffAudit requires one.
  // The append-only channel row retains owner/author/time; never invent a staff
  // membership or change the membership audit schema for an owner action.
  return { success: true as const, noteId: created.id };
}

/** Parent mounts only this namespace as businessBookings. No booking edits or finance writes. */
export const businessStaffBookingsRouter = router({
  list: protectedProcedure.input(z.object({
    page: pagination.page,
    pageSize: z.number().int().min(1).max(50).default(25),
    search: z.string().trim().max(100).optional(),
  }).strict()).query(({ ctx, input }) => safe(async () => {
    const authority = await staffAuthority(ctx.user, "viewBookings");
    const db = await database();
    const ownerUserId = authority.membership.ownerUserId;
    // Escape LIKE wildcards so a search remains a literal operational text search.
    const pattern = input.search ? `%${input.search.replace(/[\\%_]/g, "\\$&")}%` : undefined;
    const rows = await db.select(operationalFields).from(bookings).where(and(
      bookingScope(ownerUserId), pattern === undefined ? undefined : or(
        like(bookings.clientName, pattern), like(bookings.topdogRef, pattern),
        like(bookings.ptsRef, pattern), like(bookings.crmRef, pattern), like(bookings.destination, pattern),
      ),
    )).orderBy(desc(bookings.id)).limit(input.pageSize + 1).offset((input.page - 1) * input.pageSize);
    const items = rows.slice(0, input.pageSize);
    const prices = await amounts(db, ownerUserId, items.map(row => row.id), authority.membership.permissions.viewCustomerAmounts === true);
    return {
      items: items.map(raw => { const row = operationalBooking(raw); return prices.has(row.id) ? { ...row, grossPrice: prices.get(row.id)! } : row; }),
      page: input.page, pageSize: input.pageSize, hasMore: rows.length > input.pageSize,
    };
  })),
  detail: protectedProcedure.input(bookingInput).query(({ ctx, input }) => safe(async () => {
    const authority = await staffAuthority(ctx.user, "viewBookings");
    const db = await database();
    const [booking] = await db.select(operationalFields).from(bookings)
      .where(bookingScope(authority.membership.ownerUserId, input.bookingId)).limit(1);
    if (!booking) missingBooking();
    const prices = await amounts(db, authority.membership.ownerUserId, [booking.id], authority.membership.permissions.viewCustomerAmounts === true);
    const safeBooking = operationalBooking(booking);
    return prices.has(booking.id) ? { ...safeBooking, grossPrice: prices.get(booking.id)! } : safeBooking;
  })),
  listNotes: protectedProcedure.input(notesInput).query(({ ctx, input }) => safe(async () => {
    const authority = await staffAuthority(ctx.user, "viewBookings");
    return readNotes(await database(), authority.membership.ownerUserId, input);
  })),
  addNote: protectedProcedure.input(addNoteInput).mutation(({ ctx, input }) => safe(async () => {
    const authority = await staffAuthority(ctx.user, "addBookingNotes");
    const db = await database();
    return db.transaction(async tx => {
      // Match management writes: lock single user rows in ascending ID order
      // before locking membership/eligibility rows and finally the booking.
      const accounts = new Map<number, Record<string, unknown>>();
      for (const userId of [ctx.user.id, authority.membership.ownerUserId].sort((a, b) => a - b)) {
        const [account] = await tx.select(accountFields).from(users).where(eq(users.id, userId)).limit(1).for("update");
        if (!account) forbidden();
        accounts.set(userId, account);
      }
      // Fresh locked membership, actor, owner and booking; never rely on stale ctx
      // permission or the pre-transaction authority to authorize the append.
      const members = await tx.select(membershipFields).from(businessStaffMemberships)
        .where(eq(businessStaffMemberships.staffUserId, ctx.user.id)).limit(2).for("update");
      const member = members[0];
      if (members.length !== 1 || !member || member.id !== authority.membership.id || member.staffUserId !== ctx.user.id ||
          member.ownerUserId !== authority.membership.ownerUserId || member.status !== "active" ||
          member.ownerUserId === ctx.user.id) forbidden();
      const permissions = readBusinessStaffPermissions(member.permissions);
      if (!permissions.viewBookings || !permissions.addBookingNotes) forbidden();
      await eligibleAccount(tx, member.staffUserId, "staff", true, accounts.get(member.staffUserId));
      await eligibleAccount(tx, member.ownerUserId, "owner", true, accounts.get(member.ownerUserId));
      await ownedBooking(tx, member.ownerUserId, input.bookingId, true);
      return insertNote(tx, input, member.ownerUserId, ctx.user.id, member.id);
    }, { isolationLevel: "serializable" });
  })),
  ownerNotes: protectedProcedure.input(notesInput).query(({ ctx, input }) => safe(async () => {
    const db = await database();
    await ownerAuthority(ctx.user, db);
    return readNotes(db, ctx.user.id, input);
  })),
  ownerAddNote: protectedProcedure.input(addNoteInput).mutation(({ ctx, input }) => safe(async () => {
    const db = await database();
    await ownerAuthority(ctx.user, db);
    return db.transaction(async tx => {
      // A fresh owner-only check inside the transaction also rejects an identity
      // that acquired a retained staff membership after the initial check.
      await eligibleAccount(tx, ctx.user.id, "owner", true);
      await ownedBooking(tx, ctx.user.id, input.bookingId, true);
      return insertNote(tx, input, ctx.user.id, ctx.user.id, null);
    }, { isolationLevel: "serializable" });
  })),
});
