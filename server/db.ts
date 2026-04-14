import { and, desc, eq, gte, inArray, like, lte, not, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  adminTasks,
  amendments,
  bookings,
  calendarEvents,
  cancellations,
  commissionClaims,
  inAppNotifications,
  notificationTemplates,
  notes,
  passwordResetTokens,
  pipelineHistory,
  refundSuppliers,
  refunds,
  reimbursementDocs,
  reimbursementItems,
  users,
  systemSettings,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "super_admin";
    updateSet.role = "super_admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt));
}

export async function createAgentUser(data: {
  name: string;
  email: string;
  hashedPassword: string;
  phone?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const openId = `agent_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await db.insert(users).values({
    openId,
    name: data.name,
    email: data.email,
    loginMethod: "password",
    role: "agent",
    tempPassword: data.hashedPassword,
    mustChangePassword: true,
    isActive: true,
    phone: data.phone ?? null,
    lastSignedIn: new Date(),
  } as any);
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function bulkCreateAgentUsers(agents: Array<{
  name: string;
  email: string;
  hashedPassword: string;
  phone?: string;
}>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const results: Array<{ email: string; success: boolean; error?: string; userId?: number }> = [];
  for (const agent of agents) {
    try {
      // Skip if email already exists
      const existing = await getUserByEmail(agent.email);
      if (existing) {
        results.push({ email: agent.email, success: false, error: "already_exists", userId: existing.id });
        continue;
      }
      const openId = `agent_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await db.insert(users).values({
        openId,
        name: agent.name,
        email: agent.email,
        loginMethod: "password",
        role: "agent",
        tempPassword: agent.hashedPassword,
        mustChangePassword: true,
        isActive: true,
        phone: agent.phone ?? null,
        lastSignedIn: new Date(),
      } as any);
      const created = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
      results.push({ email: agent.email, success: true, userId: created[0]?.id });
    } catch (err: any) {
      results.push({ email: agent.email, success: false, error: err?.message ?? "unknown" });
    }
  }
  return results;
}

export async function markCredentialsSent(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(users).set({ credentialsSentAt: new Date() } as any).where(eq(users.id, userId));
}

export async function updateUserRole(userId: number, role: "super_admin" | "admin" | "agent") {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

export async function toggleUserActive(userId: number, isActive: boolean) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(users).set({ isActive }).where(eq(users.id, userId));
}

export async function deleteUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(users).where(eq(users.id, userId));
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0];
}

export async function updateUserPassword(userId: number, hashedPassword: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .update(users)
    .set({ tempPassword: hashedPassword, mustChangePassword: false })
    .where(eq(users.id, userId));
}

// ─── Bookings ─────────────────────────────────────────────────────────────────

export async function createBooking(data: {
  agentId: number;
  clientName: string;
  departureDate: Date;
  bookedDate?: Date;
  topdogRef?: string;
  reimbursementsRequired: boolean;
  reimbursementDocUrl?: string;
  expectedCommission?: number;
  grossCost?: number;
  destination?: string;
  isPersonalBooking?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // Personal bookings: payment date = departure date automatically
  const finalSupplierPaymentDate = data.isPersonalBooking ? data.departureDate : undefined;
  const result = await db.insert(bookings).values({
    agentId: data.agentId,
    clientName: data.clientName,
    departureDate: data.departureDate,
    bookedDate: data.bookedDate,
    topdogRef: data.topdogRef,
    reimbursementsRequired: data.reimbursementsRequired,
    reimbursementDocUrl: data.reimbursementDocUrl,
    reimbursementDocUploadedAt: data.reimbursementDocUrl ? new Date() : undefined,
    expectedCommission: data.expectedCommission != null ? String(data.expectedCommission) : undefined,
    grossCost: data.grossCost != null ? String(data.grossCost) : undefined,
    destination: data.destination,
    isPersonalBooking: data.isPersonalBooking ?? false,
    finalSupplierPaymentDate,
    currentStage: "New Booking",
  } as any);
  const id = (result as any)[0]?.insertId ?? (result as any).insertId;
  return getBookingById(id);
}

export async function getBookingById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  return result[0];
}

export async function getBookingWithAgent(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select({
      booking: bookings,
      agentName: users.name,
      agentEmail: users.email,
    })
    .from(bookings)
    .leftJoin(users, eq(bookings.agentId, users.id))
    .where(eq(bookings.id, id))
    .limit(1);
  if (!result[0]) return undefined;
  const { booking, agentName, agentEmail } = result[0];
  return {
    ...booking,
    agentName: agentName ?? null,
    agentEmail: agentEmail ?? null,
  };
}

export async function getBookingsByAgent(agentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(bookings)
    .where(eq(bookings.agentId, agentId))
    .orderBy(desc(bookings.createdAt));
}

export async function getAllBookings(filters?: {
  agentId?: number;
  fromDate?: Date;
  toDate?: Date;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.agentId) conditions.push(eq(bookings.agentId, filters.agentId));
  if (filters?.fromDate) conditions.push(gte(bookings.departureDate, filters.fromDate));
  if (filters?.toDate) conditions.push(lte(bookings.departureDate, filters.toDate));
  const query =
    conditions.length > 0
      ? db
          .select()
          .from(bookings)
          .where(and(...conditions))
          .orderBy(bookings.createdAt)
      : db.select().from(bookings).orderBy(bookings.createdAt);
  return query;
}

export async function updateBookingStage(
  bookingId: number,
  toStage: string,
  movedById: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const booking = await getBookingById(bookingId);
  if (!booking) throw new Error("Booking not found");

  await db.insert(pipelineHistory).values({
    bookingId,
    fromStage: booking.currentStage,
    toStage,
    movedById,
  });

  await db.update(bookings).set({ currentStage: toStage }).where(eq(bookings.id, bookingId));
  return getBookingById(bookingId);
}

export async function updateBookingAdminFields(
  bookingId: number,
  data: {
    ptsRef?: string;
    topdogRef?: string;
    destination?: string;
    finalSupplierPaymentDate?: Date | null;
    expectedCommission?: number;
    grossCost?: number;
    clientName?: string;
    departureDate?: Date;
    bookedDate?: Date | null;
    isPersonalBooking?: boolean;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(bookings).set(data as any).where(eq(bookings.id, bookingId));
  return getBookingById(bookingId);
}

export async function uploadReimbursementDoc(
  bookingId: number,
  docUrl: string,
  isLate: boolean
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .update(bookings)
    .set({
      reimbursementDocUrl: docUrl,
      reimbursementDocUploadedAt: new Date(),
      reimbursementDocLateUpload: isLate,
    })
    .where(eq(bookings.id, bookingId));
  return getBookingById(bookingId);
}

export async function getPipelineHistory(bookingId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(pipelineHistory)
    .where(eq(pipelineHistory.bookingId, bookingId))
    .orderBy(desc(pipelineHistory.movedAt));
  // Enrich with mover name
  const moverIds = Array.from(new Set(rows.map((r) => r.movedById)));
  const moverRows = moverIds.length > 0
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, moverIds))
    : [];
  const moverMap = new Map(moverRows.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, movedByName: moverMap.get(r.movedById) ?? null }));
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export async function createNote(data: {
  bookingId: number;
  authorId: number;
  content: string;
  isInternal: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(notes).values(data);
}

export async function getNotesByBooking(bookingId: number, includeInternal: boolean) {
  const db = await getDb();
  if (!db) return [];
  const condition = includeInternal
    ? eq(notes.bookingId, bookingId)
    : and(eq(notes.bookingId, bookingId), eq(notes.isInternal, false));
  return db.select().from(notes).where(condition).orderBy(notes.createdAt);
}

// Mark all agent notes on a booking as read by admin
export async function markNotesReadByAdmin(bookingId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(notes)
    .set({ isReadByAdmin: true })
    .where(and(eq(notes.bookingId, bookingId), eq(notes.isReadByAdmin, false)));
}

// Get bookings that have unread agent notes (for admin dashboard panel)
export async function getBookingsWithUnreadAgentNotes() {
  const db = await getDb();
  if (!db) return [];
  // Find distinct bookingIds where there's an agent note not yet read by admin
  // Note: orderBy(createdAt) is intentionally omitted here — MySQL strict mode rejects
  // ordering by a non-aggregated column that isn't in GROUP BY. We sort per-booking below.
  const unreadNotes = await db
    .select({ bookingId: notes.bookingId })
    .from(notes)
    .where(and(eq(notes.isInternal, false), eq(notes.isReadByAdmin, false)))
    .groupBy(notes.bookingId);
  if (unreadNotes.length === 0) return [];
  // Filter to only notes authored by agents
  const bookingIds = unreadNotes.map((n) => n.bookingId);
  // Get the bookings + latest unread note content
  const result = [];
  for (const { bookingId } of unreadNotes) {
    const booking = await getBookingById(bookingId);
    if (!booking) continue;
    // Get the latest unread note for this booking
    const latestUnread = await db
      .select()
      .from(notes)
      .where(and(eq(notes.bookingId, bookingId), eq(notes.isInternal, false), eq(notes.isReadByAdmin, false)))
      .orderBy(desc(notes.createdAt))
      .limit(1);
    if (!latestUnread[0]) continue;
    // Only include if the latest unread note was written by an agent
    const author = await getUserById(latestUnread[0].authorId);
    if (!author || (author.role !== 'agent')) continue;
    result.push({
      bookingId,
      clientName: booking.clientName,
      agentId: booking.agentId,
      latestMessage: latestUnread[0].content,
      latestMessageAt: latestUnread[0].createdAt,
      authorName: author.name ?? 'Agent',
    });
  }
  return result;
}

// Get ALL bookings that have at least one shared note — for the Messages page
// Returns threads sorted by latest message date, with unread count per thread
export async function getAllMessageThreads() {
  const db = await getDb();
  if (!db) return [];
  // Get all distinct bookingIds that have shared notes
  const threadRows = await db
    .select({ bookingId: notes.bookingId })
    .from(notes)
    .where(and(eq(notes.isInternal, false), not(like(notes.content, '[System]%'))))
    .groupBy(notes.bookingId);
  if (threadRows.length === 0) return [];

  const result = [];
  for (const { bookingId } of threadRows) {
    const booking = await getBookingById(bookingId);
    if (!booking) continue;
    // Latest shared note
    const latestNote = await db
      .select()
      .from(notes)
      .where(and(eq(notes.bookingId, bookingId), eq(notes.isInternal, false), not(like(notes.content, '[System]%'))))
      .orderBy(desc(notes.createdAt))
      .limit(1);
    if (!latestNote[0]) continue;
    const latestAuthor = await getUserById(latestNote[0].authorId);
    // Unread count (agent notes not yet read by admin)
    const unreadRows = await db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.bookingId, bookingId), eq(notes.isInternal, false), eq(notes.isReadByAdmin, false), not(like(notes.content, '[System]%'))));
    // Count only unread notes authored by agents
    let unreadCount = 0;
    for (const row of unreadRows) {
      const noteRow = await db.select().from(notes).where(eq(notes.id, row.id)).limit(1);
      if (!noteRow[0]) continue;
      const noteAuthor = await getUserById(noteRow[0].authorId);
      if (noteAuthor?.role === 'agent') unreadCount++;
    }
    const agentUser = await getUserById(booking.agentId);
    result.push({
      bookingId,
      clientName: booking.clientName,
      agentId: booking.agentId,
      agentName: agentUser?.name ?? 'Agent',
      ptsRef: booking.ptsRef ?? null,
      topdogRef: booking.topdogRef ?? null,
      latestMessage: latestNote[0].content,
      latestMessageAt: latestNote[0].createdAt,
      latestAuthorName: latestAuthor?.name ?? 'Unknown',
      latestAuthorRole: latestAuthor?.role ?? 'agent',
      unreadCount,
    });
  }
  // Sort by latest message date descending
  result.sort((a, b) => new Date(b.latestMessageAt).getTime() - new Date(a.latestMessageAt).getTime());
  return result;
}

// Count of bookings with unread agent notes (for sidebar badge)
export async function getTotalUnreadMessageCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ bookingId: notes.bookingId })
    .from(notes)
    .where(and(eq(notes.isInternal, false), eq(notes.isReadByAdmin, false), not(like(notes.content, '[System]%'))))
    .groupBy(notes.bookingId);
  // Filter to only those with at least one agent-authored unread note
  let count = 0;
  for (const { bookingId } of rows) {
    const latestUnread = await db
      .select()
      .from(notes)
      .where(and(eq(notes.bookingId, bookingId), eq(notes.isInternal, false), eq(notes.isReadByAdmin, false)))
      .orderBy(desc(notes.createdAt))
      .limit(1);
    if (!latestUnread[0]) continue;
    const author = await getUserById(latestUnread[0].authorId);
    if (author?.role === 'agent') count++;
  }
  return count;
}

// Mark all unread agent notes as read by admin (for "Mark all as read" button)
export async function markAllAgentNotesAsRead(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(notes)
    .set({ isReadByAdmin: true })
    .where(and(eq(notes.isInternal, false), eq(notes.isReadByAdmin, false)));
}

// Get the last admin/super_admin who sent a shared (non-internal) note on a booking
// Used to route reply emails back to the specific admin who last messaged, not all admins
export async function getLastAdminNoteAuthor(bookingId: number): Promise<{ id: number; name: string | null; email: string | null } | null> {
  const db = await getDb();
  if (!db) return null;
  // Find the most recent shared note on this booking authored by an admin
  const rows = await db
    .select({ authorId: notes.authorId })
    .from(notes)
    .where(and(eq(notes.bookingId, bookingId), eq(notes.isInternal, false)))
    .orderBy(desc(notes.createdAt))
    .limit(20); // look back up to 20 notes
  for (const row of rows) {
    const user = await getUserById(row.authorId);
    if (user && (user.role === 'admin' || user.role === 'super_admin')) {
      return { id: user.id, name: user.name ?? null, email: user.email ?? null };
    }
  }
  return null;
}

// ─── Amendments ───────────────────────────────────────────────────────────────

export async function createAmendment(data: {
  bookingId: number;
  agentId: number;
  details: string;
  isReimbursementDoc?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(amendments).values({
    bookingId: data.bookingId,
    agentId: data.agentId,
    details: data.details,
    isReimbursementDoc: data.isReimbursementDoc ?? false,
  });
}

export async function getAmendmentsByBooking(bookingId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(amendments)
    .where(eq(amendments.bookingId, bookingId))
    .orderBy(desc(amendments.createdAt));
}

export async function getAllAmendments() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(amendments).orderBy(desc(amendments.createdAt));
  // Enrich with booking info and assignee name
  const bookingIds = Array.from(new Set(rows.map((a) => a.bookingId)));
  const assigneeIds = Array.from(new Set(rows.map((a) => a.assignedToId).filter(Boolean) as number[]));
  const bookingRows = bookingIds.length > 0
    ? await db.select({ id: bookings.id, clientName: bookings.clientName, ptsRef: bookings.ptsRef, topdogRef: bookings.topdogRef }).from(bookings).where(inArray(bookings.id, bookingIds))
    : [];
  const assigneeRows = assigneeIds.length > 0
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, assigneeIds))
    : [];
  const bookingMap = new Map(bookingRows.map((b) => [b.id, b]));
  const assigneeMap = new Map(assigneeRows.map((u) => [u.id, u.name]));
  return rows.map((a) => ({
    ...a,
    clientName: bookingMap.get(a.bookingId)?.clientName ?? null,
    ptsRef: bookingMap.get(a.bookingId)?.ptsRef ?? null,
    topdogRef: bookingMap.get(a.bookingId)?.topdogRef ?? null,
    assignedToName: a.assignedToId ? (assigneeMap.get(a.assignedToId) ?? null) : null,
  }));
}

export async function actionAmendment(amendmentId: number, adminId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .update(amendments)
    .set({ status: "actioned", actionedAt: new Date(), actionedById: adminId })
    .where(eq(amendments.id, amendmentId));
}

export async function updateAmendmentPipeline(amendmentId: number, data: {
  pipelineStage?: "To Do" | "In Progress" | "Actioned";
  assignedToId?: number | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const updateData: Record<string, unknown> = {};
  if (data.pipelineStage !== undefined) updateData.pipelineStage = data.pipelineStage;
  if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId;
  await db.update(amendments).set(updateData as any).where(eq(amendments.id, amendmentId));
  const result = await db.select().from(amendments).where(eq(amendments.id, amendmentId)).limit(1);
  return result[0];
}

// ─── Cancellations ────────────────────────────────────────────────────────────

export async function createCancellation(data: { bookingId: number; agentId: number }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(cancellations).values(data);
}

export async function getAllCancellations() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(cancellations).orderBy(desc(cancellations.confirmedAt));
  // Enrich with booking info
  const bookingIds = Array.from(new Set(rows.map((c) => c.bookingId)));
  const bookingRows = bookingIds.length > 0
    ? await db.select({ id: bookings.id, clientName: bookings.clientName, ptsRef: bookings.ptsRef, topdogRef: bookings.topdogRef }).from(bookings).where(inArray(bookings.id, bookingIds))
    : [];
  const bookingMap = new Map(bookingRows.map((b) => [b.id, b]));
  return rows.map((c) => ({
    ...c,
    clientName: bookingMap.get(c.bookingId)?.clientName ?? null,
    ptsRef: bookingMap.get(c.bookingId)?.ptsRef ?? null,
    topdogRef: bookingMap.get(c.bookingId)?.topdogRef ?? null,
    processed: !!c.processedById,
  }));
}

// ─── Refunds ──────────────────────────────────────────────────────────────────

export async function createRefund(data: {
  bookingId: number;
  agentId: number;
  refundType: "supplier" | "customer" | "both";
  supplierCount: number;
  amountToClient?: number;
  refundReason: string;
  clientBankName?: string; // already encrypted
  clientSortCode?: string; // already encrypted
  clientAccountNumber?: string; // already encrypted
  stepsTaken: string;
  suppliers: { supplierName: string; amountDue: number }[];
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const { suppliers, ...refundData } = data;
  const result = await db.insert(refunds).values(refundData as any);
  const refundId = (result as any)[0]?.insertId ?? (result as any).insertId;
  if (suppliers.length > 0) {
    await db.insert(refundSuppliers).values(
      suppliers.map((s) => ({ refundId, supplierName: s.supplierName, amountDue: String(s.amountDue) }))
    );
  }
  return refundId;
}

export async function getRefundsByBooking(bookingId: number) {
  const db = await getDb();
  if (!db) return [];
  const refundRows = await db
    .select()
    .from(refunds)
    .where(eq(refunds.bookingId, bookingId))
    .orderBy(desc(refunds.createdAt));
  const result = [];
  for (const r of refundRows) {
    const suppliers = await db
      .select()
      .from(refundSuppliers)
      .where(eq(refundSuppliers.refundId, r.id));
    result.push({ ...r, suppliers });
  }
  return result;
}

export async function getAllRefunds() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(refunds).orderBy(desc(refunds.createdAt));
  // Enrich with booking info and assignee name
  const bookingIds = Array.from(new Set(rows.map((r) => r.bookingId)));
  const assigneeIds = Array.from(new Set(rows.map((r) => r.assignedToId).filter(Boolean) as number[]));
  const bookingRows = bookingIds.length > 0
    ? await db.select({ id: bookings.id, clientName: bookings.clientName, ptsRef: bookings.ptsRef, topdogRef: bookings.topdogRef }).from(bookings).where(inArray(bookings.id, bookingIds))
    : [];
  const assigneeRows = assigneeIds.length > 0
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, assigneeIds))
    : [];
  const bookingMap = new Map(bookingRows.map((b) => [b.id, b]));
  const assigneeMap = new Map(assigneeRows.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    ...r,
    clientName: bookingMap.get(r.bookingId)?.clientName ?? null,
    ptsRef: bookingMap.get(r.bookingId)?.ptsRef ?? null,
    topdogRef: bookingMap.get(r.bookingId)?.topdogRef ?? null,
    assignedToName: r.assignedToId ? (assigneeMap.get(r.assignedToId) ?? null) : null,
  }));
}

export async function updateRefundPipeline(refundId: number, data: {
  pipelineStage?: "New Refund Request" | "Acknowledged by Supplier" | "Refund Sent to PTS" | "Refund Received in JLT" | "Refund Processed";
  assignedToId?: number | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const updateData: Record<string, unknown> = {};
  if (data.pipelineStage !== undefined) updateData.pipelineStage = data.pipelineStage;
  if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId;
  await db.update(refunds).set(updateData as any).where(eq(refunds.id, refundId));
  const result = await db.select().from(refunds).where(eq(refunds.id, refundId)).limit(1);
  return result[0];
}

// ─── Commission Due ───────────────────────────────────────────────────────────

export async function getCommissionDueBookings() {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  // Bookings where finalSupplierPaymentDate has passed and stage is not terminal, and not personal
  const terminalStages = ["Commission Claimable", "Commission Claimed", "Cancelled"];
  const rows = await db.select().from(bookings).orderBy(desc(bookings.finalSupplierPaymentDate));
  return rows.filter(
    (b) =>
      b.finalSupplierPaymentDate &&
      b.finalSupplierPaymentDate <= now &&
      !terminalStages.includes(b.currentStage) &&
      !(b as any).isPersonalBooking
  );
}

// ─── Notification Templates ───────────────────────────────────────────────────

export async function getNotificationTemplates() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notificationTemplates).orderBy(notificationTemplates.triggerKey);
}

export async function getNotificationTemplate(triggerKey: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(notificationTemplates)
    .where(eq(notificationTemplates.triggerKey, triggerKey))
    .limit(1);
  return result[0];
}

export async function upsertNotificationTemplate(data: {
  triggerKey: string;
  label: string;
  subject: string;
  bodyHtml: string;
  recipientType: "agent" | "admin" | "both";
  updatedById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .insert(notificationTemplates)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        label: data.label,
        subject: data.subject,
        bodyHtml: data.bodyHtml,
        recipientType: data.recipientType,
        updatedById: data.updatedById,
      },
    });
}

// ─── System Settings ─────────────────────────────────────────────────────────

export async function getSystemSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setSystemSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(systemSettings)
    .values({ key, value })
    .onDuplicateKeyUpdate({ set: { value } });
}

export async function areNotificationsPaused(): Promise<boolean> {
  const val = await getSystemSetting("notifications_paused");
  return val === "true";
}

// ─── In-App Notifications ─────────────────────────────────────────────────────

export async function createInAppNotification(data: {
  userId: number;
  bookingId?: number;
  message: string;
  linkUrl?: string;
}) {
  // Respect global notifications kill-switch
  if (await areNotificationsPaused()) {
    console.log("[Notifications] Paused — skipping in-app notification:", data.message.slice(0, 60));
    return;
  }
  const db = await getDb();
  if (!db) return;
  await db.insert(inAppNotifications).values(data);
}

export async function getInAppNotifications(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(inAppNotifications)
    .where(eq(inAppNotifications.userId, userId))
    .orderBy(desc(inAppNotifications.createdAt))
    .limit(50);
}

export async function markNotificationsRead(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(inAppNotifications)
    .set({ isRead: true })
    .where(and(eq(inAppNotifications.userId, userId), eq(inAppNotifications.isRead, false)));
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(inAppNotifications)
    .where(and(eq(inAppNotifications.userId, userId), eq(inAppNotifications.isRead, false)));
  return Number(result[0]?.count ?? 0);
}

// ─── Commission Claims ────────────────────────────────────────────────────────

export async function createCommissionClaim(bookingId: number, agentId: number, bookingType: "lapland" | "cruise" | "disney" | "other" = "other", grossAmount?: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // Prevent duplicate claims
  const existing = await db
    .select()
    .from(commissionClaims)
    .where(eq(commissionClaims.bookingId, bookingId))
    .limit(1);
  if (existing.length > 0) return existing[0];
  await db.insert(commissionClaims).values({ bookingId, agentId, bookingType, grossAmount: grossAmount?.toString() ?? null });
  const result = await db
    .select()
    .from(commissionClaims)
    .where(eq(commissionClaims.bookingId, bookingId))
    .limit(1);
  return result[0];
}

export async function getCommissionClaimsByAgent(agentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(commissionClaims)
    .where(eq(commissionClaims.agentId, agentId))
    .orderBy(desc(commissionClaims.claimedAt));
}

export async function getAllCommissionClaims() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(commissionClaims)
    .orderBy(desc(commissionClaims.claimedAt));
}

export async function markCommissionPaid(claimIds: number[], paidById: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const now = new Date();
  for (const id of claimIds) {
    await db
      .update(commissionClaims)
      .set({ status: "paid", paidAt: now, paidById })
      .where(eq(commissionClaims.id, id));
  }
}

export async function getCommissionClaimByBooking(bookingId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(commissionClaims)
    .where(eq(commissionClaims.bookingId, bookingId))
    .limit(1);
  return result[0];
}

export async function deleteCommissionClaim(claimId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(commissionClaims).where(eq(commissionClaims.id, claimId));
}

// ─── Password Reset Tokens ────────────────────────────────────────────────────

export async function createPasswordResetToken(userId: number, token: string, expiresAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // Invalidate any existing unused tokens for this user
  await db
    .delete(passwordResetTokens)
    .where(and(eq(passwordResetTokens.userId, userId)));
  await db.insert(passwordResetTokens).values({ userId, token, expiresAt });
}

export async function getPasswordResetToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.token, token))
    .limit(1);
  return result[0];
}

export async function markPasswordResetTokenUsed(tokenId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, tokenId));
}

// ─── User Profile ─────────────────────────────────────────────────────────────

export async function updateUserProfile(
  userId: number,
  data: { name?: string; email?: string; phone?: string }
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const updateSet: Record<string, unknown> = {};
  if (data.name !== undefined) updateSet.name = data.name;
  if (data.email !== undefined) updateSet.email = data.email;
  if (data.phone !== undefined) updateSet.phone = data.phone;
  if (Object.keys(updateSet).length === 0) return;
  await db.update(users).set(updateSet as any).where(eq(users.id, userId));
}

export async function getPtsMissingPaymentDate() {
  const db = await getDb();
  if (!db) return [];
  // Bookings in "Added to PTS" stage with no finalSupplierPaymentDate, not dismissed, joined with agent name
  const result = await db
    .select({
      booking: bookings,
      agentName: users.name,
      agentEmail: users.email,
    })
    .from(bookings)
    .leftJoin(users, eq(bookings.agentId, users.id))
    .where(
      and(
        eq(bookings.currentStage, "Added to PTS"),
        sql`${bookings.finalSupplierPaymentDate} IS NULL`,
        eq(bookings.paymentDateDismissed, false),
        not(eq(bookings.currentStage, "Cancelled")),
        eq(bookings.isPersonalBooking, false)
      )
    )
    .orderBy(bookings.createdAt);
  return result.map(({ booking, agentName, agentEmail }) => ({
    ...booking,
     agentName: agentName ?? null,
    agentEmail: agentEmail ?? null,
  }));
}

export async function getCommissionClaimableMissingPaymentDate() {
  const db = await getDb();
  if (!db) return [];
  const result = await db
    .select({
      booking: bookings,
      agentName: users.name,
      agentEmail: users.email,
    })
    .from(bookings)
    .leftJoin(users, eq(bookings.agentId, users.id))
    .where(
      and(
        eq(bookings.currentStage, "Commission Claimable"),
        sql`${bookings.finalSupplierPaymentDate} IS NULL`,
        eq(bookings.paymentDateDismissed, false),
        eq(bookings.isPersonalBooking, false)
      )
    )
    .orderBy(bookings.createdAt);
  return result.map(({ booking, agentName, agentEmail }) => ({
    ...booking,
    agentName: agentName ?? null,
    agentEmail: agentEmail ?? null,
  }));
}

// ─── Reimbursement Documents ──────────────────────────────────────────────────

export async function getReimbursementDocs(bookingId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: reimbursementDocs.id,
      bookingId: reimbursementDocs.bookingId,
      fileUrl: reimbursementDocs.fileUrl,
      fileName: reimbursementDocs.fileName,
      mimeType: reimbursementDocs.mimeType,
      uploadedAt: reimbursementDocs.uploadedAt,
      uploaderName: users.name,
    })
    .from(reimbursementDocs)
    .leftJoin(users, eq(reimbursementDocs.uploadedById, users.id))
    .where(eq(reimbursementDocs.bookingId, bookingId))
    .orderBy(reimbursementDocs.uploadedAt);
}

export async function addReimbursementDoc(params: {
  bookingId: number;
  uploadedById: number;
  fileUrl: string;
  fileName: string;
  mimeType?: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(reimbursementDocs).values({
    bookingId: params.bookingId,
    uploadedById: params.uploadedById,
    fileUrl: params.fileUrl,
    fileName: params.fileName,
    mimeType: params.mimeType ?? null,
  });
}

// Get all booking IDs that have at least one unread agent message (for Kanban badges)
export async function getUnreadBookingIds(): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ bookingId: notes.bookingId, authorId: notes.authorId })
    .from(notes)
    .where(and(eq(notes.isInternal, false), eq(notes.isReadByAdmin, false), not(like(notes.content, '[System]%'))));
  // Only include notes authored by agents
  const result = new Set<number>();
  for (const row of rows) {
    const author = await getUserById(row.authorId);
    if (author?.role === 'agent') result.add(row.bookingId);
  }
  return Array.from(result);
}

// ─── Admin Notification Preferences ──────────────────────────────────────────

export async function getAdminNotifPrefs(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const { adminNotificationPrefs } = await import("../drizzle/schema");
  return db.select().from(adminNotificationPrefs).where(eq(adminNotificationPrefs.userId, userId));
}

export async function upsertAdminNotifPref(userId: number, triggerKey: string, emailEnabled: boolean) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const { adminNotificationPrefs } = await import("../drizzle/schema");
  // Check if row exists
  const existing = await db
    .select()
    .from(adminNotificationPrefs)
    .where(and(eq(adminNotificationPrefs.userId, userId), eq(adminNotificationPrefs.triggerKey, triggerKey)))
    .limit(1);
  if (existing[0]) {
    await db
      .update(adminNotificationPrefs)
      .set({ emailEnabled })
      .where(and(eq(adminNotificationPrefs.userId, userId), eq(adminNotificationPrefs.triggerKey, triggerKey)));
  } else {
    await db.insert(adminNotificationPrefs).values({ userId, triggerKey, emailEnabled });
  }
}

// Check if a specific admin has email enabled for a trigger key (default: true if no row)
export async function isAdminEmailEnabledForTrigger(userId: number, triggerKey: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return true;
  const { adminNotificationPrefs } = await import("../drizzle/schema");
  const rows = await db
    .select()
    .from(adminNotificationPrefs)
    .where(and(eq(adminNotificationPrefs.userId, userId), eq(adminNotificationPrefs.triggerKey, triggerKey)))
    .limit(1);
  if (!rows[0]) return true; // default: enabled
  return rows[0].emailEnabled;
}

// ─── Admin Tasks ──────────────────────────────────────────────────────────────

export async function createAdminTask(data: {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  assigneeId?: number;
  createdById: number;
  dueDate?: Date;
  linkedType?: "booking" | "amendment" | "refund" | "cancellation" | "none";
  linkedId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const { adminTasks } = await import("../drizzle/schema");
  const result = await db.insert(adminTasks).values({
    title: data.title,
    description: data.description ?? null,
    priority: data.priority ?? "medium",
    assigneeId: data.assigneeId ?? null,
    createdById: data.createdById,
    dueDate: data.dueDate ?? null,
    linkedType: data.linkedType ?? "none",
    linkedId: data.linkedId ?? null,
  } as any);
  const id = (result as any)[0]?.insertId ?? (result as any).insertId;
  const { adminTasks: at } = await import("../drizzle/schema");
  const rows = await db.select().from(at).where(eq(at.id, id)).limit(1);
  return rows[0];
}

export async function getAllAdminTasks() {
  const db = await getDb();
  if (!db) return [];
  const { adminTasks } = await import("../drizzle/schema");
  return db.select().from(adminTasks).orderBy(desc(adminTasks.createdAt));
}

export async function getAdminTaskById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const { adminTasks } = await import("../drizzle/schema");
  const rows = await db.select().from(adminTasks).where(eq(adminTasks.id, id)).limit(1);
  return rows[0];
}

export async function updateAdminTask(id: number, data: {
  title?: string;
  description?: string;
  status?: "open" | "in_progress" | "done";
  priority?: "low" | "medium" | "high" | "urgent";
  assigneeId?: number | null;
  dueDate?: Date | null;
  linkedType?: "booking" | "amendment" | "refund" | "cancellation" | "none";
  linkedId?: number | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const { adminTasks } = await import("../drizzle/schema");
  await db.update(adminTasks).set(data as any).where(eq(adminTasks.id, id));
  const rows = await db.select().from(adminTasks).where(eq(adminTasks.id, id)).limit(1);
  return rows[0];
}

export async function deleteAdminTask(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const { adminTasks, adminTaskComments } = await import("../drizzle/schema");
  await db.delete(adminTaskComments).where(eq(adminTaskComments.taskId, id));
  await db.delete(adminTasks).where(eq(adminTasks.id, id));
}

export async function getAdminTaskComments(taskId: number) {
  const db = await getDb();
  if (!db) return [];
  const { adminTaskComments } = await import("../drizzle/schema");
  return db.select().from(adminTaskComments).where(eq(adminTaskComments.taskId, taskId)).orderBy(adminTaskComments.createdAt);
}

export async function addAdminTaskComment(data: {
  taskId: number;
  authorId: number;
  content: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const { adminTaskComments } = await import("../drizzle/schema");
  await db.insert(adminTaskComments).values(data);
}

// ─── Delete Booking (cascade) ─────────────────────────────────────────────────
export async function deleteBooking(bookingId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const { adminTasks } = await import("../drizzle/schema");
  // Cascade delete in dependency order
  await db.delete(pipelineHistory).where(eq(pipelineHistory.bookingId, bookingId));
  await db.delete(notes).where(eq(notes.bookingId, bookingId));
  await db.delete(reimbursementDocs).where(eq(reimbursementDocs.bookingId, bookingId));
  await db.delete(commissionClaims).where(eq(commissionClaims.bookingId, bookingId));
  await db.delete(amendments).where(eq(amendments.bookingId, bookingId));
  await db.delete(cancellations).where(eq(cancellations.bookingId, bookingId));
  await db.delete(refunds).where(eq(refunds.bookingId, bookingId));
  // Unlink admin tasks (don't delete tasks, just clear the link)
  await db.update(adminTasks)
    .set({ linkedType: "none", linkedId: null } as any)
    .where(and(eq(adminTasks.linkedType, "booking"), eq(adminTasks.linkedId, bookingId)));
  // Finally delete the booking itself
  await db.delete(bookings).where(eq(bookings.id, bookingId));
}

// ─── Merge Bookings ───────────────────────────────────────────────────────────
export async function mergeBookings(sourceId: number, targetId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // Move all related records from source to target
  await db.update(pipelineHistory).set({ bookingId: targetId } as any).where(eq(pipelineHistory.bookingId, sourceId));
  await db.update(notes).set({ bookingId: targetId } as any).where(eq(notes.bookingId, sourceId));
  await db.update(reimbursementDocs).set({ bookingId: targetId } as any).where(eq(reimbursementDocs.bookingId, sourceId));
  await db.update(commissionClaims).set({ bookingId: targetId } as any).where(eq(commissionClaims.bookingId, sourceId));
  await db.update(amendments).set({ bookingId: targetId } as any).where(eq(amendments.bookingId, sourceId));
  await db.update(cancellations).set({ bookingId: targetId } as any).where(eq(cancellations.bookingId, sourceId));
  await db.update(refunds).set({ bookingId: targetId } as any).where(eq(refunds.bookingId, sourceId));
  // Re-link admin tasks
  await db.update(adminTasks)
    .set({ linkedId: targetId } as any)
    .where(and(eq(adminTasks.linkedType, "booking"), eq(adminTasks.linkedId, sourceId)));
  // Delete the source booking (now orphaned)
  await db.delete(bookings).where(eq(bookings.id, sourceId));
}

// ─── Calendar Events ─────────────────────────────────────────────────────────

export async function getCalendarEvents(from: Date, to: Date) {
  const db = await getDb();
  if (!db) return [];
  // Fetch base events that start within range OR are recurring (need expansion)
  const rows = await db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      description: calendarEvents.description,
      type: calendarEvents.type,
      startDate: calendarEvents.startDate,
      endDate: calendarEvents.endDate,
      allDay: calendarEvents.allDay,
      assigneeId: calendarEvents.assigneeId,
      createdById: calendarEvents.createdById,
      createdAt: calendarEvents.createdAt,
      assigneeName: users.name,
      recurrenceRule: calendarEvents.recurrenceRule,
      recurrenceEndDate: calendarEvents.recurrenceEndDate,
      dueDate: calendarEvents.dueDate,
      reminderSentAt: calendarEvents.reminderSentAt,
    })
    .from(calendarEvents)
    .leftJoin(users, eq(calendarEvents.assigneeId, users.id))
    .where(
      or(
        // Non-recurring: overlap with range
        and(
          eq(calendarEvents.recurrenceRule, "none"),
          lte(calendarEvents.startDate, to),
          gte(calendarEvents.endDate, from)
        ),
        // Recurring: started before range end (and not ended before range start)
        and(
          not(eq(calendarEvents.recurrenceRule, "none")),
          lte(calendarEvents.startDate, to),
          or(
            sql`${calendarEvents.recurrenceEndDate} IS NULL`,
            gte(calendarEvents.recurrenceEndDate, from)
          )
        )
      )
    )
    .orderBy(calendarEvents.startDate);
  return rows;
}

export async function createCalendarEvent(data: {
  title: string;
  description?: string;
  type: "holiday" | "event" | "task";
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  assigneeId?: number | null;
  createdById: number;
  recurrenceRule?: "none" | "daily" | "weekly" | "monthly" | "yearly";
  recurrenceEndDate?: Date | null;
  dueDate?: Date | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [result] = await db.insert(calendarEvents).values({
    title: data.title,
    description: data.description ?? null,
    type: data.type,
    startDate: data.startDate,
    endDate: data.endDate,
    allDay: data.allDay,
    assigneeId: data.assigneeId ?? null,
    createdById: data.createdById,
    recurrenceRule: data.recurrenceRule ?? "none",
    recurrenceEndDate: data.recurrenceEndDate ?? null,
    dueDate: data.dueDate ?? null,
  });
  return result;
}

export async function updateCalendarEvent(
  id: number,
  data: Partial<{
    title: string;
    description: string | null;
    type: "holiday" | "event" | "task";
    startDate: Date;
    endDate: Date;
    allDay: boolean;
    assigneeId: number | null;
    recurrenceRule: "none" | "daily" | "weekly" | "monthly" | "yearly";
    recurrenceEndDate: Date | null;
    dueDate: Date | null;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(calendarEvents).set(data as any).where(eq(calendarEvents.id, id));
}

// Returns tasks whose dueDate is tomorrow and reminderSentAt is null
export async function getTasksDueForReminder() {
  const db = await getDb();
  if (!db) return [];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStart = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 0, 0, 0);
  const tomorrowEnd   = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59);
  const rows = await db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      dueDate: calendarEvents.dueDate,
      assigneeId: calendarEvents.assigneeId,
      assigneeName: users.name,
    })
    .from(calendarEvents)
    .leftJoin(users, eq(calendarEvents.assigneeId, users.id))
    .where(
      and(
        eq(calendarEvents.type, "task"),
        gte(calendarEvents.dueDate, tomorrowStart),
        lte(calendarEvents.dueDate, tomorrowEnd),
        sql`${calendarEvents.reminderSentAt} IS NULL`
      )
    );
  return rows;
}

export async function markCalendarReminderSent(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(calendarEvents).set({ reminderSentAt: new Date() }).where(eq(calendarEvents.id, id));
}

export async function deleteCalendarEvent(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(calendarEvents).where(eq(calendarEvents.id, id));
}

// ─── Delete Reimbursement Doc ─────────────────────────────────────────────────
export async function deleteReimbursementDoc(docId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const rows = await db.select().from(reimbursementDocs).where(eq(reimbursementDocs.id, docId)).limit(1);
  if (!rows[0]) return null;
  await db.delete(reimbursementDocs).where(eq(reimbursementDocs.id, docId));
  return rows[0];
}

// ─── Reimbursement Items ──────────────────────────────────────────────────────

export async function createReimbursementItems(items: Array<{
  bookingId: number;
  agentId: number;
  supplierName: string;
  amount: number;
  isLate?: boolean;
}>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  if (items.length === 0) return [];
  await db.insert(reimbursementItems).values(
    items.map((item) => ({
      bookingId: item.bookingId,
      agentId: item.agentId,
      supplierName: item.supplierName,
      amount: String(item.amount),
      status: "pending" as const,
      isLate: item.isLate ?? false,
    }))
  );
  return db.select().from(reimbursementItems).where(eq(reimbursementItems.bookingId, items[0].bookingId));
}

export async function getReimbursementsByBooking(bookingId: number) {
  const db = await getDb();
  if (!db) return [];
  const { reimbursementItemDocs } = await import("../drizzle/schema");
  // Fetch items
  const items = await db
    .select()
    .from(reimbursementItems)
    .where(eq(reimbursementItems.bookingId, bookingId))
    .orderBy(reimbursementItems.createdAt);
  if (items.length === 0) return [];
  // Fetch all docs for this booking
  const docs = await db
    .select()
    .from(reimbursementItemDocs)
    .where(eq(reimbursementItemDocs.bookingId, bookingId))
    .orderBy(reimbursementItemDocs.createdAt);
  // Group docs under their item
  return items.map((item) => ({
    ...item,
    docs: docs.filter((d) => d.reimbursementItemId === item.id),
  }));
}

export async function updateReimbursementAssignee(id: number, assignedToId: number | null) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(reimbursementItems).set({ assignedToId } as any).where(eq(reimbursementItems.id, id));
}

export async function markReimbursementActioned(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(reimbursementItems).set({ actionedAt: new Date() } as any).where(eq(reimbursementItems.id, id));
}

export async function getReimbursementsAdmin(filters?: {
  status?: "pending" | "scheduled" | "paid";
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.status) conditions.push(eq(reimbursementItems.status, filters.status));
  const rows = await (conditions.length > 0
    ? db
        .select({
          item: reimbursementItems,
          clientName: bookings.clientName,
          ptsRef: bookings.ptsRef,
          departureDate: bookings.departureDate,
          agentName: users.name,
          agentEmail: users.email,
        })
        .from(reimbursementItems)
        .leftJoin(bookings, eq(reimbursementItems.bookingId, bookings.id))
        .leftJoin(users, eq(reimbursementItems.agentId, users.id))
        .where(and(...conditions))
        .orderBy(desc(reimbursementItems.createdAt))
    : db
        .select({
          item: reimbursementItems,
          clientName: bookings.clientName,
          ptsRef: bookings.ptsRef,
          departureDate: bookings.departureDate,
          agentName: users.name,
          agentEmail: users.email,
        })
        .from(reimbursementItems)
        .leftJoin(bookings, eq(reimbursementItems.bookingId, bookings.id))
        .leftJoin(users, eq(reimbursementItems.agentId, users.id))
        .orderBy(desc(reimbursementItems.createdAt)));
  return rows.map((r) => ({
    ...r.item,
    clientName: r.clientName ?? null,
    ptsRef: r.ptsRef ?? null,
    departureDate: r.departureDate ?? null,
    agentName: r.agentName ?? null,
    agentEmail: r.agentEmail ?? null,
  }));
}

export async function updateReimbursementStatus(
  id: number,
  status: "pending" | "scheduled" | "paid",
  actorId: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const now = new Date();
  const updates: Record<string, unknown> = { status };
  if (status === "scheduled") updates.scheduledAt = now;
  if (status === "paid") { updates.paidAt = now; updates.paidById = actorId; }
  await db.update(reimbursementItems).set(updates as any).where(eq(reimbursementItems.id, id));
  const rows = await db.select().from(reimbursementItems).where(eq(reimbursementItems.id, id)).limit(1);
  return rows[0];
}

export async function scheduleReimbursementsForBooking(bookingId: number) {
  // Called when booking moves to "Added to PTS" — auto-schedule all pending non-late items
  const db = await getDb();
  if (!db) return;
  await db
    .update(reimbursementItems)
    .set({ status: "scheduled", scheduledAt: new Date() } as any)
    .where(
      and(
        eq(reimbursementItems.bookingId, bookingId),
        eq(reimbursementItems.status, "pending"),
        eq(reimbursementItems.isLate, false)
      )
    );
}

export async function getReimbursementDashboardStats() {
  const db = await getDb();
  if (!db) return { pendingCount: 0, pendingTotal: 0, scheduledCount: 0, scheduledTotal: 0 };
  const rows = await db
    .select({
      status: reimbursementItems.status,
      amount: reimbursementItems.amount,
    })
    .from(reimbursementItems)
    .where(not(eq(reimbursementItems.status, "paid")));
  let pendingCount = 0, pendingTotal = 0, scheduledCount = 0, scheduledTotal = 0;
  for (const r of rows) {
    const amt = Number(r.amount);
    if (r.status === "pending") { pendingCount++; pendingTotal += amt; }
    if (r.status === "scheduled") { scheduledCount++; scheduledTotal += amt; }
  }
  return { pendingCount, pendingTotal, scheduledCount, scheduledTotal };
}

export async function getBookingReimbursementFlag(bookingId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: reimbursementItems.id }).from(reimbursementItems).where(eq(reimbursementItems.bookingId, bookingId)).limit(1);
  return rows.length > 0;
}

// ─── Reimbursement Item Docs ──────────────────────────────────────────────────

export async function addReimbursementItemDoc(data: {
  reimbursementItemId: number;
  bookingId: number;
  fileUrl: string;
  fileKey: string;
  fileName: string;
  uploadedById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const { reimbursementItemDocs } = await import("../drizzle/schema");
  await db.insert(reimbursementItemDocs).values(data);
  const rows = await db
    .select()
    .from(reimbursementItemDocs)
    .where(eq(reimbursementItemDocs.reimbursementItemId, data.reimbursementItemId))
    .orderBy(desc(reimbursementItemDocs.createdAt));
  return rows;
}

export async function getReimbursementItemDocs(reimbursementItemId: number) {
  const db = await getDb();
  if (!db) return [];
  const { reimbursementItemDocs } = await import("../drizzle/schema");
  return db
    .select()
    .from(reimbursementItemDocs)
    .where(eq(reimbursementItemDocs.reimbursementItemId, reimbursementItemId))
    .orderBy(reimbursementItemDocs.createdAt);
}

export async function getReimbursementItemDocsByBooking(bookingId: number) {
  const db = await getDb();
  if (!db) return [];
  const { reimbursementItemDocs } = await import("../drizzle/schema");
  return db
    .select()
    .from(reimbursementItemDocs)
    .where(eq(reimbursementItemDocs.bookingId, bookingId))
    .orderBy(reimbursementItemDocs.createdAt);
}

// Get bookings for an agent that have at least one reimbursement item with no uploaded docs
export async function getReimbItemsWithMissingDocsByAgent(agentId: number) {
  const db = await getDb();
  if (!db) return [];
  const { reimbursementItems, reimbursementItemDocs, bookings } = await import("../drizzle/schema");
  // Get all reimbursement items for this agent
  const items = await db
    .select({
      id: reimbursementItems.id,
      bookingId: reimbursementItems.bookingId,
      supplierName: reimbursementItems.supplierName,
      amount: reimbursementItems.amount,
      status: reimbursementItems.status,
    })
    .from(reimbursementItems)
    .where(eq(reimbursementItems.agentId, agentId))
    .orderBy(reimbursementItems.createdAt);

  if (items.length === 0) return [];

  // For each item, check if it has any docs
  const itemIds = items.map((i) => i.id);
  const docs = await db
    .select({ reimbursementItemId: reimbursementItemDocs.reimbursementItemId })
    .from(reimbursementItemDocs)
    .where(inArray(reimbursementItemDocs.reimbursementItemId, itemIds));

  const docItemIds = new Set(docs.map((d) => d.reimbursementItemId));
  const missingItems = items.filter((i) => !docItemIds.has(i.id));

  if (missingItems.length === 0) return [];

  // Get unique booking IDs and fetch client names
  const bookingIds = Array.from(new Set(missingItems.map((i) => i.bookingId)));
  const bookingRows = await db
    .select({ id: bookings.id, clientName: bookings.clientName, currentStage: bookings.currentStage })
    .from(bookings)
    .where(inArray(bookings.id, bookingIds));

  const bookingMap = new Map(bookingRows.map((b) => [b.id, b]));

  return missingItems.map((i) => ({
    ...i,
    clientName: bookingMap.get(i.bookingId)?.clientName ?? null,
    currentStage: bookingMap.get(i.bookingId)?.currentStage ?? null,
  }));
}

// Count reimbursement items that are pending (not yet scheduled or paid)
export async function getOutstandingReimbursementsCount() {
  const db = await getDb();
  if (!db) return 0;
  const { reimbursementItems } = await import("../drizzle/schema");
  const rows = await db
    .select({ id: reimbursementItems.id })
    .from(reimbursementItems)
    .where(eq(reimbursementItems.status, "pending"));
  return rows.length;
}

export async function getCancellationsByBooking(bookingId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(cancellations)
    .where(eq(cancellations.bookingId, bookingId))
    .orderBy(desc(cancellations.confirmedAt));
}
