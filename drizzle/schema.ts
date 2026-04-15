import {
  boolean,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  json,
} from "drizzle-orm/mysql-core";

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["super_admin", "admin", "agent"]).default("agent").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  tempPassword: varchar("tempPassword", { length: 255 }), // hashed temp password for new agents
  mustChangePassword: boolean("mustChangePassword").default(false).notNull(),
  phone: varchar("phone", { length: 30 }), // optional phone number for future SMS alerts
  credentialsSentAt: timestamp("credentialsSentAt"), // when login credentials were last sent
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Bookings ─────────────────────────────────────────────────────────────────

export const bookings = mysqlTable("bookings", {
  id: int("id").autoincrement().primaryKey(),
  agentId: int("agentId").notNull(), // FK → users.id
  clientName: varchar("clientName", { length: 255 }).notNull(),
  departureDate: timestamp("departureDate").notNull(),
  bookedDate: timestamp("bookedDate"), // Date the booking was made (agent-entered)
  topdogRef: varchar("topdogRef", { length: 100 }),
  reimbursementsRequired: boolean("reimbursementsRequired").default(false).notNull(),
  reimbursementDocUrl: text("reimbursementDocUrl"), // S3 URL
  reimbursementDocUploadedAt: timestamp("reimbursementDocUploadedAt"),
  reimbursementDocLateUpload: boolean("reimbursementDocLateUpload").default(false).notNull(),
  expectedCommission: decimal("expectedCommission", { precision: 10, scale: 2 }),
  grossCost: decimal("grossCost", { precision: 10, scale: 2 }),
  // Admin-managed fields
  ptsRef: varchar("ptsRef", { length: 100 }),
  destination: varchar("destination", { length: 255 }), // Country/destination from PTS
  finalSupplierPaymentDate: timestamp("finalSupplierPaymentDate"),
  finalSupplierPaymentNotified: boolean("finalSupplierPaymentNotified").default(false).notNull(),
  paymentDateDismissed: boolean("paymentDateDismissed").default(false).notNull(), // Suppress from missing-payment-date dashboard alert
  isPersonalBooking: boolean("isPersonalBooking").default(false).notNull(), // Agent's own travel — no commission, payment date = departure date
  // Current pipeline stage
  currentStage: varchar("currentStage", { length: 100 }).default("New Booking").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Booking = typeof bookings.$inferSelect;
export type InsertBooking = typeof bookings.$inferInsert;

// ─── Pipeline Stage History ───────────────────────────────────────────────────

export const pipelineHistory = mysqlTable("pipeline_history", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(), // FK → bookings.id
  fromStage: varchar("fromStage", { length: 100 }),
  toStage: varchar("toStage", { length: 100 }).notNull(),
  movedById: int("movedById").notNull(), // FK → users.id
  movedAt: timestamp("movedAt").defaultNow().notNull(),
});

export type PipelineHistory = typeof pipelineHistory.$inferSelect;

// ─── Amendments ───────────────────────────────────────────────────────────────

export const amendments = mysqlTable("amendments", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(), // FK → bookings.id
  agentId: int("agentId").notNull(), // FK → users.id
  details: text("details").notNull(),
  isReimbursementDoc: boolean("isReimbursementDoc").default(false).notNull(), // true = created from doc upload
  pipelineStage: mysqlEnum("pipelineStage", ["To Do", "In Progress", "Actioned"]).default("To Do").notNull(),
  assignedToId: int("assignedToId"), // FK → users.id
  status: mysqlEnum("status", ["pending", "actioned"]).default("pending").notNull(),
  actionedAt: timestamp("actionedAt"),
  actionedById: int("actionedById"), // FK → users.id
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Amendment = typeof amendments.$inferSelect;

// ─── Amendment Line Items ─────────────────────────────────────────────────────

export const amendmentLineItems = mysqlTable("amendment_line_items", {
  id: int("id").autoincrement().primaryKey(),
  amendmentId: int("amendmentId").notNull(), // FK → amendments.id
  type: mysqlEnum("type", ["add_supplier", "remove_supplier", "change_cost", "other"]).notNull(),
  supplierName: varchar("supplierName", { length: 255 }),
  cost: decimal("cost", { precision: 10, scale: 2 }),
  oldCost: decimal("oldCost", { precision: 10, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AmendmentLineItem = typeof amendmentLineItems.$inferSelect;

// ─── Cancellations ────────────────────────────────────────────────────────────

export const cancellations = mysqlTable("cancellations", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(), // FK → bookings.id
  agentId: int("agentId").notNull(), // FK → users.id
  confirmedAt: timestamp("confirmedAt").defaultNow().notNull(),
  processedById: int("processedById"), // FK → users.id
  processedAt: timestamp("processedAt"),
  status: mysqlEnum("status", ["pending", "actioned"]).default("pending").notNull(),
});

export type Cancellation = typeof cancellations.$inferSelect;

// ─── Refunds ──────────────────────────────────────────────────────────────────

export const refunds = mysqlTable("refunds", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(), // FK → bookings.id
  agentId: int("agentId").notNull(), // FK → users.id
  refundType: mysqlEnum("refundType", ["supplier", "customer", "both"]).notNull(),
  supplierCount: int("supplierCount").notNull(),
  amountToClient: decimal("amountToClient", { precision: 10, scale: 2 }),
  refundReason: text("refundReason").notNull(),
  // AES-256 encrypted fields stored as base64 strings
  clientBankName: text("clientBankName"), // encrypted
  clientSortCode: text("clientSortCode"), // encrypted
  clientAccountNumber: text("clientAccountNumber"), // encrypted
  stepsTaken: text("stepsTaken").notNull(),
  pipelineStage: mysqlEnum("pipelineStage", ["New Refund Request", "Acknowledged by Supplier", "Refund Sent to PTS", "Refund Received in JLT", "Refund Processed"]).default("New Refund Request").notNull(),
  assignedToId: int("assignedToId"), // FK → users.id
  status: mysqlEnum("status", ["pending", "processing", "completed"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Refund = typeof refunds.$inferSelect;

// ─── Refund Suppliers ─────────────────────────────────────────────────────────

export const refundSuppliers = mysqlTable("refund_suppliers", {
  id: int("id").autoincrement().primaryKey(),
  refundId: int("refundId").notNull(), // FK → refunds.id
  supplierName: varchar("supplierName", { length: 255 }).notNull(),
  amountDue: decimal("amountDue", { precision: 10, scale: 2 }).notNull(),
});

export type RefundSupplier = typeof refundSuppliers.$inferSelect;

// ─── Notes ────────────────────────────────────────────────────────────────────

export const notes = mysqlTable("notes", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(), // FK → bookings.id
  authorId: int("authorId").notNull(), // FK → users.id
  content: text("content").notNull(),
  isInternal: boolean("isInternal").default(false).notNull(), // true = admin-only
  isReadByAdmin: boolean("isReadByAdmin").default(false).notNull(), // true once an admin has seen/replied
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Note = typeof notes.$inferSelect;

// ─── Notification Templates ───────────────────────────────────────────────────

export const notificationTemplates = mysqlTable("notification_templates", {
  id: int("id").autoincrement().primaryKey(),
  triggerKey: varchar("triggerKey", { length: 100 }).notNull().unique(),
  label: varchar("label", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  bodyHtml: text("bodyHtml").notNull(),
  recipientType: mysqlEnum("recipientType", ["agent", "admin", "both"]).default("agent").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  updatedById: int("updatedById"), // FK → users.id
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NotificationTemplate = typeof notificationTemplates.$inferSelect;

// ─── Notification Log ─────────────────────────────────────────────────────────

export const notificationLog = mysqlTable("notification_log", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId"), // FK → bookings.id (nullable for system notifications)
  triggerKey: varchar("triggerKey", { length: 100 }).notNull(),
  sentTo: varchar("sentTo", { length: 320 }).notNull(),
  sentAt: timestamp("sentAt").defaultNow().notNull(),
  success: boolean("success").default(true).notNull(),
  errorMessage: text("errorMessage"),
});

export type NotificationLog = typeof notificationLog.$inferSelect;

// ─── In-App Notifications ─────────────────────────────────────────────────────

export const inAppNotifications = mysqlTable("in_app_notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // FK → users.id
  bookingId: int("bookingId"), // FK → bookings.id (optional)
  message: text("message").notNull(),
  linkUrl: varchar("linkUrl", { length: 500 }), // optional deep link
  isRead: boolean("isRead").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type InAppNotification = typeof inAppNotifications.$inferSelect;

// ─── Commission Claims ────────────────────────────────────────────────────────

export const commissionClaims = mysqlTable("commission_claims", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(), // FK → bookings.id
  agentId: int("agentId").notNull(), // FK → users.id
  bookingType: mysqlEnum("bookingType", ["lapland", "cruise", "disney", "other"]).notNull().default("other"),
  claimedAt: timestamp("claimedAt").defaultNow().notNull(),
  status: mysqlEnum("status", ["claimed_not_paid", "paid"]).default("claimed_not_paid").notNull(),
  grossAmount: decimal("grossAmount", { precision: 10, scale: 2 }), // Agent's declared gross commission before fees
  vatAmount: decimal("vatAmount", { precision: 10, scale: 2 }), // VAT on the commission
  paidAt: timestamp("paidAt"),
  paidById: int("paidById"), // FK → users.id (admin who marked as paid)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CommissionClaim = typeof commissionClaims.$inferSelect;
export type InsertCommissionClaim = typeof commissionClaims.$inferInsert;

// ─── Password Reset Tokens ─────────────────────────────────────────────────────────────────────────────────
export const passwordResetTokens = mysqlTable("password_reset_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // FK → users.id
  token: varchar("token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"), // null = not yet used
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// ─── Reimbursement Documents ────────────────────────────────────────────────────
// Stores multiple reimbursement docs per booking (replaces single reimbursementDocUrl on bookings)
export const reimbursementDocs = mysqlTable("reimbursement_docs", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(), // FK → bookings.id
  uploadedById: int("uploadedById").notNull(), // FK → users.id
  fileUrl: text("fileUrl").notNull(), // S3 URL
  fileName: varchar("fileName", { length: 255 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }),
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
});

export type ReimbursementDoc = typeof reimbursementDocs.$inferSelect;
export type InsertReimbursementDoc = typeof reimbursementDocs.$inferInsert;

// ─── Admin Notification Preferences ─────────────────────────────────────────
// Per-admin, per-trigger-key opt-in/out for email notifications
export const adminNotificationPrefs = mysqlTable("admin_notification_prefs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  triggerKey: varchar("triggerKey", { length: 100 }).notNull(),
  emailEnabled: boolean("emailEnabled").default(true).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AdminNotificationPref = typeof adminNotificationPrefs.$inferSelect;

// ─── Admin Tasks ──────────────────────────────────────────────────────────────
export const adminTasks = mysqlTable("admin_tasks", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["open", "in_progress", "done"]).default("open").notNull(),
  priority: mysqlEnum("priority", ["low", "medium", "high", "urgent"]).default("medium").notNull(),
  assigneeId: int("assigneeId"),
  createdById: int("createdById").notNull(),
  dueDate: timestamp("dueDate"),
  linkedType: mysqlEnum("linkedType", ["booking", "amendment", "refund", "cancellation", "none"]).default("none").notNull(),
  linkedId: int("linkedId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AdminTask = typeof adminTasks.$inferSelect;
export type InsertAdminTask = typeof adminTasks.$inferInsert;

// ─── Admin Task Comments ──────────────────────────────────────────────────────
export const adminTaskComments = mysqlTable("admin_task_comments", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  authorId: int("authorId").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AdminTaskComment = typeof adminTaskComments.$inferSelect;

// ─── Calendar Events ─────────────────────────────────────────────────────────

export const calendarEvents = mysqlTable("calendar_events", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  type: mysqlEnum("type", ["holiday", "event", "task"]).notNull().default("event"),
  startDate: timestamp("startDate").notNull(),
  endDate: timestamp("endDate").notNull(),
  allDay: boolean("allDay").default(true).notNull(),
  assigneeId: int("assigneeId"), // FK → users.id (for holiday: who is off; for task: who is assigned)
  createdById: int("createdById").notNull(), // FK → users.id
  // Recurrence
  recurrenceRule: mysqlEnum("recurrenceRule", ["none", "daily", "weekly", "monthly", "yearly"]).default("none").notNull(),
  recurrenceEndDate: timestamp("recurrenceEndDate"), // null = recur indefinitely
  // Task-specific
  dueDate: timestamp("dueDate"), // for tasks: the due date
  reminderSentAt: timestamp("reminderSentAt"), // set when reminder notification was sent
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type InsertCalendarEvent = typeof calendarEvents.$inferInsert;

// ─── Reimbursement Items ─────────────────────────────────────────────────────
export const reimbursementItems = mysqlTable("reimbursement_items", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),          // FK → bookings.id
  agentId: int("agentId").notNull(),              // FK → users.id
  supplierName: varchar("supplierName", { length: 255 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["pending", "scheduled", "paid"]).default("pending").notNull(),
  isLate: boolean("isLate").default(false).notNull(), // true if added after booking reached Added to PTS
  scheduledAt: timestamp("scheduledAt"),          // when status moved to scheduled
  paidAt: timestamp("paidAt"),                    // when admin marked as paid
  paidById: int("paidById"),                      // FK → users.id (admin who marked paid)
  assignedToId: int("assignedToId"),               // FK → users.id (admin assigned to handle this item)
  actionedAt: timestamp("actionedAt"),             // when admin marked as actioned (for late items)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ReimbursementItem = typeof reimbursementItems.$inferSelect;
export type InsertReimbursementItem = typeof reimbursementItems.$inferInsert;

// ─── Reimbursement Item Docs ─────────────────────────────────────────────────
export const reimbursementItemDocs = mysqlTable("reimbursement_item_docs", {
  id: int("id").autoincrement().primaryKey(),
  reimbursementItemId: int("reimbursementItemId").notNull(), // FK → reimbursement_items.id
  bookingId: int("bookingId").notNull(),                    // FK → bookings.id (for easy querying)
  fileUrl: text("fileUrl").notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  uploadedById: int("uploadedById").notNull(),              // FK → users.id
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ReimbursementItemDoc = typeof reimbursementItemDocs.$inferSelect;
export type InsertReimbursementItemDoc = typeof reimbursementItemDocs.$inferInsert;

// ─── System Settings ──────────────────────────────────────────────────────────
// Simple key-value store for global system flags (e.g. notifications paused)
export const systemSettings = mysqlTable("system_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;

// ─── Inbox / IMAP Integration ─────────────────────────────────────────────────

export const imapConfig = mysqlTable("imap_config", {
  id: int("id").autoincrement().primaryKey(),
  host: varchar("host", { length: 255 }).notNull().default(""),
  port: int("port").notNull().default(993),
  email: varchar("email", { length: 320 }).notNull().default(""),
  passwordEncrypted: varchar("passwordEncrypted", { length: 2048 }).notNull().default(""),
  useSsl: boolean("useSsl").notNull().default(true),
  agentAccessEnabled: boolean("agentAccessEnabled").notNull().default(false), // feature flag: hide from agents until tested
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ImapConfig = typeof imapConfig.$inferSelect;

export const cachedEmails = mysqlTable("cached_emails", {
  id: int("id").autoincrement().primaryKey(),
  uid: varchar("uid", { length: 128 }).notNull().unique(),
  subject: varchar("subject", { length: 1000 }).notNull().default(""),
  fromAddress: varchar("fromAddress", { length: 320 }).notNull().default(""),
  fromName: varchar("fromName", { length: 255 }).notNull().default(""),
  emailDate: timestamp("emailDate").notNull(),
  bodyText: text("bodyText"),
  bodyHtml: text("bodyHtml"),
  snippet: varchar("snippet", { length: 500 }).notNull().default(""),
  hasAttachments: boolean("hasAttachments").notNull().default(false),
  attachmentNames: text("attachmentNames"),   // JSON array of filenames
  s3Keys: text("s3Keys"),                     // JSON array of {filename, contentType, s3Key, s3Url, size}
  importedAt: timestamp("importedAt").defaultNow().notNull(),
});
export type CachedEmail = typeof cachedEmails.$inferSelect;

export const inboxAuditLogs = mysqlTable("inbox_audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  guestName: varchar("guestName", { length: 255 }).notNull(),
  departureDate: varchar("departureDate", { length: 32 }).notNull(),
  bookingReference: varchar("bookingReference", { length: 128 }),
  resultsCount: int("resultsCount").notNull().default(0),
  searchedAt: timestamp("searchedAt").defaultNow().notNull(),
});
export type InboxAuditLog = typeof inboxAuditLogs.$inferSelect;
export type InsertCachedEmail = typeof cachedEmails.$inferInsert;
export type InsertImapConfig = typeof imapConfig.$inferInsert;
export type InsertInboxAuditLog = typeof inboxAuditLogs.$inferInsert;
