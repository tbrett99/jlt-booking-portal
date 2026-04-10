import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  amendments,
  bookings,
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
  topdogRef?: string;
  reimbursementsRequired: boolean;
  reimbursementDocUrl?: string;
  expectedCommission?: number;
  grossCost?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(bookings).values({
    agentId: data.agentId,
    clientName: data.clientName,
    departureDate: data.departureDate,
    topdogRef: data.topdogRef,
    reimbursementsRequired: data.reimbursementsRequired,
    reimbursementDocUrl: data.reimbursementDocUrl,
    reimbursementDocUploadedAt: data.reimbursementDocUrl ? new Date() : undefined,
    expectedCommission: data.expectedCommission != null ? String(data.expectedCommission) : undefined,
    grossCost: data.grossCost != null ? String(data.grossCost) : undefined,
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
          .orderBy(desc(bookings.createdAt))
      : db.select().from(bookings).orderBy(desc(bookings.createdAt));
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
    finalSupplierPaymentDate?: Date | null;
    expectedCommission?: number;
    grossCost?: number;
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
  return db
    .select()
    .from(pipelineHistory)
    .where(eq(pipelineHistory.bookingId, bookingId))
    .orderBy(desc(pipelineHistory.movedAt));
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
    .where(eq(notes.isInternal, false))
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
      .where(and(eq(notes.bookingId, bookingId), eq(notes.isInternal, false)))
      .orderBy(desc(notes.createdAt))
      .limit(1);
    if (!latestNote[0]) continue;
    const latestAuthor = await getUserById(latestNote[0].authorId);
    // Unread count (agent notes not yet read by admin)
    const unreadRows = await db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.bookingId, bookingId), eq(notes.isInternal, false), eq(notes.isReadByAdmin, false)));
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
    .where(and(eq(notes.isInternal, false), eq(notes.isReadByAdmin, false)))
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
  return db.select().from(amendments).orderBy(desc(amendments.createdAt));
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
  return db.select().from(cancellations).orderBy(desc(cancellations.confirmedAt));
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
  return db.select().from(refunds).orderBy(desc(refunds.createdAt));
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
  // Bookings where finalSupplierPaymentDate has passed and stage is not terminal
  const terminalStages = ["Commission Claimable", "Commission Claimed", "Cancelled"];
  const rows = await db.select().from(bookings).orderBy(desc(bookings.finalSupplierPaymentDate));
  return rows.filter(
    (b) =>
      b.finalSupplierPaymentDate &&
      b.finalSupplierPaymentDate <= now &&
      !terminalStages.includes(b.currentStage)
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

export async function createCommissionClaim(bookingId: number, agentId: number, bookingType: "lapland" | "cruise" | "disney" | "other" = "other") {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // Prevent duplicate claims
  const existing = await db
    .select()
    .from(commissionClaims)
    .where(eq(commissionClaims.bookingId, bookingId))
    .limit(1);
  if (existing.length > 0) return existing[0];
  await db.insert(commissionClaims).values({ bookingId, agentId, bookingType });
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
        eq(bookings.paymentDateDismissed, false)
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
