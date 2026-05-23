import {
  boolean,
  int,
  mysqlEnum,
  mysqlTable,
  mediumtext,
  longtext,
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
  portalStatus: mysqlEnum("portalStatus", ["onboarding", "active", "paused", "suspended", "in_notice", "cancelled"]).default("onboarding").notNull(),
  crmAccess: boolean("crmAccess").default(false).notNull(), // Whether this agent can access the CRM via Open CRM button
  crmEmail: varchar("crmEmail", { length: 320 }), // Optional CRM email alias (e.g. hello@loupr.com) — used to match bookings from external CRM
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
  clientEmail: varchar("clientEmail", { length: 320 }), // Customer email for payment confirmations
  departureDate: timestamp("departureDate").notNull(),
  bookedDate: timestamp("bookedDate"), // Date the booking was made (agent-entered)
  topdogRef: varchar("topdogRef", { length: 100 }),
  reimbursementsRequired: boolean("reimbursementsRequired").default(false).notNull(),
  reimbursementDocUrl: text("reimbursementDocUrl"), // S3 URL
  reimbursementDocUploadedAt: timestamp("reimbursementDocUploadedAt"),
  reimbursementDocLateUpload: boolean("reimbursementDocLateUpload").default(false).notNull(),
  suppliersAndDocsAddedToPts: boolean("suppliersAndDocsAddedToPts").default(false).notNull(),
  expectedCommission: decimal("expectedCommission", { precision: 10, scale: 2 }),
  grossCost: decimal("grossCost", { precision: 10, scale: 2 }),
  grossCostLockedAt: timestamp("grossCostLockedAt"), // Set when agent first saves grossCost — after this only admins can edit
  // Admin-managed fields
  ptsRef: varchar("ptsRef", { length: 100 }),
  destination: varchar("destination", { length: 255 }), // Country/destination from PTS
  passengers: int("passengers"), // Number of passengers (excluding infants)
  numberOfNights: int("numberOfNights"), // Duration of trip in nights
  finalSupplierPaymentDate: timestamp("finalSupplierPaymentDate"),
  finalSupplierPaymentNotified: boolean("finalSupplierPaymentNotified").default(false).notNull(),
  paymentDateDismissed: boolean("paymentDateDismissed").default(false).notNull(), // Suppress from missing-payment-date dashboard alert
  isPersonalBooking: boolean("isPersonalBooking").default(false).notNull(), // Agent's own travel — no commission, payment date = departure date
  crmRef: varchar("crmRef", { length: 100 }), // External CRM booking reference (e.g. Tom's CRM ref L71)
  commissionPreAuthorised: boolean("commissionPreAuthorised").default(false).notNull(), // Agent pre-authorises auto-claim when file becomes claimable
  commissionVat: decimal("commissionVat", { precision: 10, scale: 2 }), // VAT amount set by admin when marking claimable
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
  pipelineStage: mysqlEnum("pipelineStage", ["New Refund Request", "Query", "Acknowledged by Supplier", "Refund Sent to PTS", "Refund Received in JLT", "Refund Processed"]).default("New Refund Request").notNull(),
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
  tag: mysqlEnum("tag", ["Commissions", "Refunds", "Amendments", "Reimbursements", "New Booking", "Support"]),
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
  status: mysqlEnum("status", ["pending", "processing", "awaiting_payment", "paid", "top_up_required"]).default("pending").notNull(),
  topUpAmountPence: int("topUpAmountPence"), // set when admin requests a top-up
  topUpNote: text("topUpNote"), // optional note from admin when requesting top-up
  topUpRequestedAt: timestamp("topUpRequestedAt"), // when the top-up was requested
  topUpRequestedById: int("topUpRequestedById"), // admin who requested the top-up
  topUpNotifiedAt: timestamp("topUpNotifiedAt"), // when the agent was notified
  topUpResolvedAt: timestamp("topUpResolvedAt"), // when the agent confirmed top-up done
  grossAmount: decimal("grossAmount", { precision: 10, scale: 2 }), // Agent's declared gross commission before fees
  vatAmount: decimal("vatAmount", { precision: 10, scale: 2 }), // VAT on the commission
  paidAt: timestamp("paidAt"),
  paidById: int("paidById"), // FK → users.id (admin who marked as paid)
  remittanceLineId: int("remittanceLineId"), // FK → remittance_lines.id (set when matched to a PTS remittance)
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
  // Agent-facing event fields
  agentFacing: boolean("agentFacing").default(false).notNull(),
  eventUrl: varchar("eventUrl", { length: 500 }), // Zoom/Teams/Meet link
  eventCategory: mysqlEnum("eventCategory", ["training", "webinar", "supplier_event"]),
  duration: int("duration").default(60), // duration in minutes
  registrationEnabled: boolean("registrationEnabled").default(false).notNull(),
  agentReminderSentAt: timestamp("agentReminderSentAt"), // set when day-of agent reminder was sent
  communityPostId: int("communityPostId"), // FK → community_posts.id (auto-created post)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type InsertCalendarEvent = typeof calendarEvents.$inferInsert;

// ─── Event Registrations ─────────────────────────────────────────────────────
export const eventRegistrations = mysqlTable("event_registrations", {
  id: int("id").autoincrement().primaryKey(),
  eventId: int("eventId").notNull(), // FK → calendar_events.id
  userId: int("userId").notNull(),   // FK → users.id
  registeredAt: timestamp("registeredAt").defaultNow().notNull(),
});
export type EventRegistration = typeof eventRegistrations.$inferSelect;
export type InsertEventRegistration = typeof eventRegistrations.$inferInsert;

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
  jltCompanyCard: boolean("jltCompanyCard").default(false).notNull(), // true = paid with JLT card, funds stay with JLT
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
  bodyText: mediumtext("bodyText"),
  bodyHtml: mediumtext("bodyHtml"),
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

// Links a cached inbox email to a booking registration
export const bookingEmailLinks = mysqlTable("booking_email_links", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  cachedEmailId: int("cachedEmailId").notNull(),
  linkedBy: int("linkedBy").notNull(),           // userId who created the link
  note: varchar("note", { length: 500 }),        // optional agent note
  linkedAt: timestamp("linkedAt").defaultNow().notNull(),
});
export type BookingEmailLink = typeof bookingEmailLinks.$inferSelect;
export type InsertBookingEmailLink = typeof bookingEmailLinks.$inferInsert;

// ─── CRM: Prospects ───────────────────────────────────────────────────────────

export const prospects = mysqlTable("prospects", {
  id: int("id").autoincrement().primaryKey(),
  // Basic contact info (from embeddable enquiry form)
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  marketingConsent: boolean("marketingConsent").default(false).notNull(),
  // Recruitment pipeline stage
  stage: mysqlEnum("stage", [
    "New Enquiry",
    "AR Submitted",
    "AR Approved",
    "Discovery Call Booked",
    "Approved",
    "Rejected",
    "Lost",
    "Won",
  ]).default("New Enquiry").notNull(),
  // Extended CRM profile (filled in over time)
  uniqueAgentId: varchar("uniqueAgentId", { length: 20 }).unique(), // e.g. JLT-0042
  personalEmail: varchar("personalEmail", { length: 320 }),
  jltEmail: varchar("jltEmail", { length: 320 }),
  mobile: varchar("mobile", { length: 30 }),
  addressLine1: varchar("addressLine1", { length: 255 }),
  addressLine2: varchar("addressLine2", { length: 255 }),
  city: varchar("city", { length: 100 }),
  postcode: varchar("postcode", { length: 20 }),
  ukRegion: varchar("ukRegion", { length: 100 }),
  // ID documents (S3 URLs)
  idDocUrl: text("idDocUrl"),
  idDocKey: varchar("idDocKey", { length: 500 }),
  proofOfAddressUrl: text("proofOfAddressUrl"),
  proofOfAddressKey: varchar("proofOfAddressKey", { length: 500 }),
  // Bank details for commission payouts (AES-256 encrypted)
  bankAccountName: varchar("bankAccountName", { length: 255 }),
  bankSortCode: varchar("bankSortCode", { length: 512 }),       // encrypted
  bankAccountNumber: varchar("bankAccountNumber", { length: 512 }), // encrypted
  // Portal access flags (for Won agents)
  wonPortalAccess: boolean("wonPortalAccess").default(false).notNull(),
  fullPortalAccess: boolean("fullPortalAccess").default(false).notNull(),
  linkedUserId: int("linkedUserId"),  // FK → users.id once they have a portal account
  // Admin notes
  adminNotes: text("adminNotes"),
  // Metadata
  source: varchar("source", { length: 100 }).default("enquiry_form"), // enquiry_form, manual, import
  createdById: int("createdById"),  // FK → users.id (null = public form)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Prospect = typeof prospects.$inferSelect;
export type InsertProspect = typeof prospects.$inferInsert;

// ─── CRM: Prospect Tags ───────────────────────────────────────────────────────

export const prospectTags = mysqlTable("prospect_tags", {
  id: int("id").autoincrement().primaryKey(),
  prospectId: int("prospectId").notNull(),  // FK → prospects.id
  tag: varchar("tag", { length: 100 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ProspectTag = typeof prospectTags.$inferSelect;

// ─── CRM: Prospect Pipeline History ──────────────────────────────────────────

export const prospectPipelineHistory = mysqlTable("prospect_pipeline_history", {
  id: int("id").autoincrement().primaryKey(),
  prospectId: int("prospectId").notNull(),  // FK → prospects.id
  fromStage: varchar("fromStage", { length: 100 }),
  toStage: varchar("toStage", { length: 100 }).notNull(),
  movedById: int("movedById"),  // FK → users.id (null = system/public)
  note: varchar("note", { length: 500 }),
  movedAt: timestamp("movedAt").defaultNow().notNull(),
});
export type ProspectPipelineHistory = typeof prospectPipelineHistory.$inferSelect;

// ─── CRM: Agent Application (AR) Form Responses ───────────────────────────────

export const prospectArForms = mysqlTable("prospect_ar_forms", {
  id: int("id").autoincrement().primaryKey(),
  prospectId: int("prospectId").notNull(),  // FK → prospects.id
  // Section 1: Background & Experience
  whyInterested: text("whyInterested"),
  isSelfEmployed: varchar("isSelfEmployed", { length: 10 }),  // Yes/No
  hasTravelExperience: varchar("hasTravelExperience", { length: 10 }),  // Yes/No
  travelExperienceDetails: text("travelExperienceDetails"),
  currentJob: varchar("currentJob", { length: 255 }),
  // Section 2: Travel Business Plans
  businessGoal12Months: varchar("businessGoal12Months", { length: 100 }),  // Earn some extra income / Replace my current income / Build a full-time travel business / Not sure yet
  travelSpecialisation: text("travelSpecialisation"),
  weeklyHours: varchar("weeklyHours", { length: 50 }),  // Less than 5 hours / 5-10 hours / 10-20 hours / Full time
  // Section 3: Mindset & Readiness
  hasHomeSupport: varchar("hasHomeSupport", { length: 20 }),  // Yes/No/Not sure yet
  investmentReadiness: varchar("investmentReadiness", { length: 100 }),
  understandsSelfEmployed: varchar("understandsSelfEmployed", { length: 100 }),
  biggestHesitation: text("biggestHesitation"),
  // Section 4: Financial & Tech Readiness
  techConfidence: varchar("techConfidence", { length: 100 }),
  financialReadiness: varchar("financialReadiness", { length: 100 }),
  // Section 5: Long-Term Vision
  twoYearVision: text("twoYearVision"),
  // Section 6: How Did You Hear About Us
  hearAboutUs: varchar("hearAboutUs", { length: 255 }),  // comma-separated: Facebook, Instagram, TikTok, Recommended by someone, Other
  hearAboutUsDetails: varchar("hearAboutUsDetails", { length: 255 }),
  lookingAtOtherAgencies: varchar("lookingAtOtherAgencies", { length: 10 }),  // Yes/No
  otherAgenciesDetails: varchar("otherAgenciesDetails", { length: 255 }),
  confirmationAccepted: boolean("confirmationAccepted").default(false).notNull(),
  // Admin review
  reviewStatus: mysqlEnum("reviewStatus", ["pending", "approved", "rejected"]).default("pending").notNull(),
  reviewNotes: text("reviewNotes"),
  reviewedById: int("reviewedById"),  // FK → users.id
  reviewedAt: timestamp("reviewedAt"),
  submittedAt: timestamp("submittedAt").defaultNow().notNull(),
});
export type ProspectArForm = typeof prospectArForms.$inferSelect;
export type InsertProspectArForm = typeof prospectArForms.$inferInsert;

// ─── CRM: Supplier Logins per Prospect/Agent ─────────────────────────────────

export const prospectSupplierLogins = mysqlTable("prospect_supplier_logins", {
  id: int("id").autoincrement().primaryKey(),
  prospectId: int("prospectId").notNull(),  // FK → prospects.id
  supplierName: varchar("supplierName", { length: 255 }).notNull(),
  username: varchar("username", { length: 255 }),
  passwordEncrypted: varchar("passwordEncrypted", { length: 512 }),  // AES-256 encrypted
  loginUrl: varchar("loginUrl", { length: 500 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ProspectSupplierLogin = typeof prospectSupplierLogins.$inferSelect;

// ─── CRM: Contract Templates ──────────────────────────────────────────────────

export const contractTemplates = mysqlTable("contract_templates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  pdfUrl: text("pdfUrl").notNull(),
  pdfKey: varchar("pdfKey", { length: 500 }).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  uploadedById: int("uploadedById").notNull(),  // FK → users.id
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ContractTemplate = typeof contractTemplates.$inferSelect;

// ─── CRM: Signed Contracts ────────────────────────────────────────────────────

export const prospectContracts = mysqlTable("prospect_contracts", {
  id: int("id").autoincrement().primaryKey(),
  prospectId: int("prospectId").notNull(),  // FK → prospects.id
  templateId: int("templateId"),  // FK → contract_templates.id
  signingToken: varchar("signingToken", { length: 128 }).unique(),  // secure URL token
  signingTokenExpiresAt: timestamp("signingTokenExpiresAt"),
  signerName: varchar("signerName", { length: 255 }),
  signerAddress: text("signerAddress"),
  signatureDataUrl: text("signatureDataUrl"),  // base64 canvas signature image
  signedPdfUrl: text("signedPdfUrl"),  // S3 URL of generated signed PDF
  signedPdfKey: varchar("signedPdfKey", { length: 500 }),
  sentAt: timestamp("sentAt"),
  signedAt: timestamp("signedAt"),
  // ─── Legal evidence fields ───────────────────────────────────────────────────
  signingIp: varchar("signingIp", { length: 64 }),                  // IP address at time of signing
  signingUserAgent: text("signingUserAgent"),                        // Browser/device at time of signing
  consentConfirmed: boolean("consentConfirmed").default(false),      // Explicit "I agree" checkbox
  contractTextSnapshot: longtext("contractTextSnapshot"),            // Full contract HTML at moment of signing
  contractHash: varchar("contractHash", { length: 128 }),           // SHA-256 of (contractText+signature+timestamp)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ProspectContract = typeof prospectContracts.$inferSelect;

// ─── CRM: Email Campaigns ─────────────────────────────────────────────────────
// Full marketing campaigns (ad-hoc bulk sends to prospects or agents)

export const emailCampaigns = mysqlTable("email_campaigns", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  audienceType: mysqlEnum("audienceType", ["prospect", "agent"]).notNull().default("prospect"),
  segmentFilters: text("segmentFilters"),                           // JSON string: { stages?, tags?, membershipTiers?, trainingStages? }
  subject: varchar("subject", { length: 500 }).notNull(),
  bodyHtml: longtext("bodyHtml").notNull(),
  bodyText: text("bodyText"),
  templateId: int("templateId"),                                    // FK → emailTemplates.id (if based on template)
  status: mysqlEnum("status", ["draft", "sending", "sent", "failed"]).default("draft").notNull(),
  totalRecipients: int("totalRecipients").default(0),
  sentAt: timestamp("sentAt"),
  sentById: int("sentById"),                                        // FK → users.id
  sentByName: varchar("sentByName", { length: 128 }),
  createdById: int("createdById"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type EmailCampaign = typeof emailCampaigns.$inferSelect;
export type InsertEmailCampaign = typeof emailCampaigns.$inferInsert;

// ─── CRM: Email Sends (per-recipient tracking for campaigns and drip steps) ──

export const emailSends = mysqlTable("email_sends", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId"),                                    // FK → emailCampaigns.id (null for drip)
  dripStepId: int("dripStepId"),                                    // FK → emailDripSteps.id (null for campaign)
  enrollmentId: int("enrollmentId"),                                // FK → emailDripEnrollments.id (null for campaign)
  recipientEmail: varchar("recipientEmail", { length: 320 }).notNull(),
  recipientName: varchar("recipientName", { length: 255 }),
  recipientType: mysqlEnum("recipientType", ["prospect", "agent"]).notNull(),
  recipientId: int("recipientId"),                                  // FK → agentCrmProfiles.id or users.id
  subject: varchar("subject", { length: 500 }).notNull(),
  resendMessageId: varchar("resendMessageId", { length: 255 }),     // Resend message ID for webhook matching
  status: mysqlEnum("status", ["queued", "sent", "delivered", "opened", "clicked", "bounced", "complained", "failed"]).default("queued").notNull(),
  sentAt: timestamp("sentAt"),
  deliveredAt: timestamp("deliveredAt"),
  openedAt: timestamp("openedAt"),
  clickedAt: timestamp("clickedAt"),
  bouncedAt: timestamp("bouncedAt"),
  failedReason: varchar("failedReason", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type EmailSend = typeof emailSends.$inferSelect;
export type InsertEmailSend = typeof emailSends.$inferInsert;

// ─── CRM: Commission Remittances (weekly CSV uploads) ────────────────────────

export const commissionRemittances = mysqlTable("commission_remittances", {
  id: int("id").autoincrement().primaryKey(),
  uploadedById: int("uploadedById").notNull(),  // FK → users.id
  filename: varchar("filename", { length: 255 }).notNull(),
  csvUrl: text("csvUrl"),  // S3 URL of original CSV
  csvKey: varchar("csvKey", { length: 500 }),
  periodLabel: varchar("periodLabel", { length: 100 }),  // e.g. "Week ending 14 Apr 2026"
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
});
export type CommissionRemittance = typeof commissionRemittances.$inferSelect;

export const commissionRemittanceItems = mysqlTable("commission_remittance_items", {
  id: int("id").autoincrement().primaryKey(),
  remittanceId: int("remittanceId").notNull(),  // FK → commission_remittances.id
  agentId: int("agentId"),  // FK → users.id (null if not matched)
  agentCode: varchar("agentCode", { length: 50 }),  // from CSV
  agentName: varchar("agentName", { length: 255 }),  // from CSV
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  bookingRef: varchar("bookingRef", { length: 100 }),
  description: varchar("description", { length: 500 }),
  notificationSentAt: timestamp("notificationSentAt"),
});
export type CommissionRemittanceItem = typeof commissionRemittanceItems.$inferSelect;

// ─── CRM: GoCardless / Payment Config ────────────────────────────────────────

export const paymentConfig = mysqlTable("payment_config", {
  id: int("id").autoincrement().primaryKey(),
  stripeJoiningFeeUrl: text("stripeJoiningFeeUrl"),  // Stripe payment link for £297
  // GoCardless mandate links: 2 tiers × 3 payment dates = 6 links
  businessClassDay1Url: text("businessClassDay1Url"),
  businessClassDay15Url: text("businessClassDay15Url"),
  businessClassDay28Url: text("businessClassDay28Url"),
  firstClassDay1Url: text("firstClassDay1Url"),
  firstClassDay15Url: text("firstClassDay15Url"),
  firstClassDay28Url: text("firstClassDay28Url"),
  updatedById: int("updatedById"),  // FK → users.id
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PaymentConfig = typeof paymentConfig.$inferSelect;

// ─── Agent CRM: Extended Profile ─────────────────────────────────────────────
export const agentCrmProfiles = mysqlTable("agent_crm_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(), // FK → users.id
  uniqueAgentId: varchar("uniqueAgentId", { length: 20 }).unique(), // e.g. JLT-0042
  jltEmail: varchar("jltEmail", { length: 320 }),
  personalEmail: varchar("personalEmail", { length: 320 }),
  mobile: varchar("mobile", { length: 30 }),
  addressLine1: varchar("addressLine1", { length: 255 }),
  addressLine2: varchar("addressLine2", { length: 255 }),
  city: varchar("city", { length: 100 }),
  postcode: varchar("postcode", { length: 20 }),
  ukRegion: varchar("ukRegion", { length: 100 }),
  idDocUrl: text("idDocUrl"),
  idDocKey: varchar("idDocKey", { length: 500 }),
  proofOfAddressUrl: text("proofOfAddressUrl"),
  proofOfAddressKey: varchar("proofOfAddressKey", { length: 500 }),
  bankAccountName: varchar("bankAccountName", { length: 255 }),
  bankSortCode: varchar("bankSortCode", { length: 512 }),       // AES-256 encrypted
  bankAccountNumber: varchar("bankAccountNumber", { length: 512 }), // AES-256 encrypted
  businessEmail: varchar("businessEmail", { length: 320 }),      // IRS/Topdog login email
  membershipTier: varchar("membershipTier", { length: 100 }),    // Business Class / First Class
  topdogRetailerName: varchar("topdogRetailerName", { length: 255 }),
  topdogRetailerCode: varchar("topdogRetailerCode", { length: 50 }),
  // Structured profile fields
  agentStatus: varchar("agentStatus", { length: 50 }).default("active"),  // active | paused | in_notice | cancelled
  businessName: varchar("businessName", { length: 255 }),                 // trading/business name
  retailerCode: varchar("retailerCode", { length: 50 }),                  // supplier retailer code
  introducedBy: varchar("introducedBy", { length: 255 }),                 // referral source
  dateJoined: varchar("dateJoined", { length: 30 }),                      // ISO date string
  monthlySub: varchar("monthlySub", { length: 50 }),                      // e.g. £87 / £127
  internalNotes: text("internalNotes"),                                   // replaces adminNotes
  adminNotes: text("adminNotes"),                                         // kept for legacy data
  teamId: int("teamId"),                                                    // FK → agent_teams.id (for Duo/Trio groupings)
  // Status-change workflow date fields
  pauseEndsAt: timestamp("pauseEndsAt"),                                    // Date when pause period ends
  noticeEndsAt: timestamp("noticeEndsAt"),                                  // Agent's final date at JLT (in_notice)
  cancelledAt: timestamp("cancelledAt"),                                    // Date agent was cancelled / final date recorded
  suspendedAt: timestamp("suspendedAt"),                                    // Date agent was suspended
  cancelChecklist: json("cancelChecklist"),                                 // JSON array of ticked offboarding items
  trainingStage: varchar("trainingStage", { length: 50 }),                   // Training | Agent Accelerator | Accredited
  // Emergency contact (collected during onboarding)
  emergencyContactName: varchar("emergencyContactName", { length: 255 }),
  emergencyContactPhone: varchar("emergencyContactPhone", { length: 30 }),
  // Preferred monthly payment day: 1, 15, or 28
  preferredPaymentDay: int("preferredPaymentDay"),
  // JLT email address preference (collected during onboarding)
  jltEmailPreference: varchar("jltEmailPreference", { length: 320 }),
  // Orbit beta access — admin-controlled toggle
  orbitEnabled: boolean("orbitEnabled").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AgentCrmProfile = typeof agentCrmProfiles.$inferSelect;

// ─── Agent CRM: Tags ──────────────────────────────────────────────────────────
export const agentTags = mysqlTable("agent_tags", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // FK → users.id
  tag: varchar("tag", { length: 100 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AgentTag = typeof agentTags.$inferSelect;

// ─── Agent CRM: Supplier Logins ───────────────────────────────────────────────
export const agentSupplierLogins = mysqlTable("agent_supplier_logins", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // FK → users.id
  supplierName: varchar("supplierName", { length: 255 }).notNull(),
  loginUrl: varchar("loginUrl", { length: 1000 }),
  username: varchar("username", { length: 255 }),
  passwordEncrypted: varchar("passwordEncrypted", { length: 512 }), // AES-256 encrypted
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AgentSupplierLogin = typeof agentSupplierLogins.$inferSelect;

// ─── Agent CRM: Change Requests ───────────────────────────────────────────────
export const agentChangeRequests = mysqlTable("agent_change_requests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),                                        // FK → users.id (the agent)
  fieldName: varchar("fieldName", { length: 100 }).notNull(),            // e.g. "addressLine1", "bankSortCode"
  fieldLabel: varchar("fieldLabel", { length: 150 }).notNull(),          // human-readable label
  currentValue: text("currentValue"),                                     // current value at time of request
  requestedValue: text("requestedValue").notNull(),                       // what the agent wants it changed to
  reason: text("reason"),                                                 // optional reason from agent
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | approved | rejected
  adminNote: text("adminNote"),                                           // admin's note on review
  reviewedById: int("reviewedById"),                                      // FK → users.id (admin who reviewed)
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AgentChangeRequest = typeof agentChangeRequests.$inferSelect;

// ─── Agent CRM: Status Events (audit log) ───────────────────────────────────
export const agentStatusEvents = mysqlTable("agent_status_events", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),                                          // FK → users.id (the agent)
  fromStatus: varchar("fromStatus", { length: 50 }),                       // previous status
  toStatus: varchar("toStatus", { length: 50 }).notNull(),                 // new status
  adminId: int("adminId").notNull(),                                        // FK → users.id (admin who made change)
  notes: text("notes"),                                                     // optional admin notes
  pauseEndsAt: timestamp("pauseEndsAt"),                                    // for paused events
  noticeEndsAt: timestamp("noticeEndsAt"),                                  // for in_notice events
  cancelledAt: timestamp("cancelledAt"),                                    // for cancelled events
  cancelChecklist: json("cancelChecklist"),                                 // JSON array of ticked checklist items
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AgentStatusEvent = typeof agentStatusEvents.$inferSelect;

// ─── Agent Teams (Duo / Trio groupings) ──────────────────────────────────────
export const agentTeams = mysqlTable("agent_teams", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),                       // e.g. "Smith Travel Duo"
  membershipTier: varchar("membershipTier", { length: 50 }),              // Business Duo / Business Trio / First Class Duo
  monthlySub: varchar("monthlySub", { length: 20 }),                     // shared monthly price e.g. "174"
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AgentTeam = typeof agentTeams.$inferSelect;

// ─── PTS Remittance Batches ───────────────────────────────────────────────────
export const remittanceBatches = mysqlTable("remittance_batches", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),          // e.g. "Week of 14 Apr 2026"
  weekOf: timestamp("weekOf").notNull(),                      // start of the week this remittance covers
  uploadedById: int("uploadedById").notNull(),                // FK → users.id (admin who uploaded)
  totalRemittance: decimal("totalRemittance", { precision: 12, scale: 2 }).notNull().default("0"),
  totalLines: int("totalLines").notNull().default(0),
  matchedLines: int("matchedLines").notNull().default(0),
  unmatchedLines: int("unmatchedLines").notNull().default(0),
  pushedToAgentsAt: timestamp("pushedToAgentsAt"),            // when Push to Agents was last run
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type RemittanceBatch = typeof remittanceBatches.$inferSelect;

// ─── PTS Remittance Lines ─────────────────────────────────────────────────────
export const remittanceLines = mysqlTable("remittance_lines", {
  id: int("id").autoincrement().primaryKey(),
  batchId: int("batchId").notNull(),                          // FK → remittance_batches.id
  // Raw PTS columns
  clientName: varchar("clientName", { length: 255 }).notNull(),
  ptsRef: varchar("ptsRef", { length: 100 }).notNull(),       // Booking Reference from PTS
  returnDate: varchar("returnDate", { length: 50 }),
  pax: int("pax"),
  currency: varchar("currency", { length: 10 }).default("GBP"),
  totalIn: decimal("totalIn", { precision: 12, scale: 2 }),
  totalOut: decimal("totalOut", { precision: 12, scale: 2 }),
  sfi: decimal("sfi", { precision: 10, scale: 2 }),
  safi: decimal("safi", { precision: 10, scale: 2 }),
  ptrc: decimal("ptrc", { precision: 10, scale: 2 }),
  pts: decimal("pts", { precision: 10, scale: 2 }),
  vatFromPts: decimal("vatFromPts", { precision: 10, scale: 2 }),  // VAT column from PTS CSV
  remittance: decimal("remittance", { precision: 12, scale: 2 }).notNull(),
  // Calculated fields
  vatFromPortal: decimal("vatFromPortal", { precision: 10, scale: 2 }),   // VAT from portal booking record
  remit80: decimal("remit80", { precision: 12, scale: 2 }),               // 80% agent share
  jlt20: decimal("jlt20", { precision: 12, scale: 2 }),                   // 20% JLT share
  // Matched booking / agent
  bookingId: int("bookingId"),                                // FK → bookings.id (null if unmatched)
  agentId: int("agentId"),                                    // FK → users.id (null if unmatched)
  agentName: varchar("agentName", { length: 255 }),
  agentEmail: varchar("agentEmail", { length: 320 }),
  isMatched: boolean("isMatched").default(false).notNull(),
  // Push state
  pushedToAgent: boolean("pushedToAgent").default(false).notNull(),
  pushedAt: timestamp("pushedAt"),
  // Processing flag — set when matched booking has a commission claim still in 'processing' status
  processingClaimId: int("processingClaimId"),               // FK → commission_claims.id (null once resolved)
  // Admin notes
  adminNotes: text("adminNotes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type RemittanceLine = typeof remittanceLines.$inferSelect;

// ─── Nightly Export Run Log ───────────────────────────────────────────────────
export const exportRuns = mysqlTable("export_runs", {
  id: int("id").primaryKey().autoincrement(),
  ranAt: timestamp("ranAt").defaultNow().notNull(),
  success: boolean("success").notNull(),
  rowCount: int("rowCount"),
  errorMessage: text("errorMessage"),
  triggeredBy: varchar("triggeredBy", { length: 50 }).default("cron"), // "cron" | "external" | "manual"
});
export type ExportRun = typeof exportRuns.$inferSelect;

// ─── Flight Requests ──────────────────────────────────────────────────────────
export const flightRequests = mysqlTable("flight_requests", {
  id: int("id").primaryKey().autoincrement(),
  bookingId: int("bookingId").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  agentId: int("agentId").notNull().references(() => users.id),
  requestType: varchar("requestType", { length: 20 }).notNull(), // "ticketing" | "cancellation" | "both"
  supplier: varchar("supplier", { length: 50 }).notNull(), // "Aviate" | "Lime" | "VA Flight Store"
  pnr: varchar("pnr", { length: 50 }).notNull(),
  departureDate: timestamp("departureDate").notNull(),
  ticketingDeadline: timestamp("ticketingDeadline").notNull(),
  // Cancellation-specific fields (used when requestType = 'both')
  cancellationPnr: varchar("cancellationPnr", { length: 50 }),
  cancellationDepartureDate: timestamp("cancellationDepartureDate"),
  cancellationTicketingDeadline: timestamp("cancellationTicketingDeadline"),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // "pending" | "ticketed" | "cancelled" | "query"
  cancellationStatus: varchar("cancellationStatus", { length: 20 }).default("pending"), // only used when requestType = 'both': "pending" | "cancelled"
  invoiceAddedToPts: boolean("invoiceAddedToPts").notNull().default(false),
  queryMessage: text("queryMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type FlightRequest = typeof flightRequests.$inferSelect;

// ─── PPS Payment Links ────────────────────────────────────────────────────────
export const paymentLinks = mysqlTable("payment_links", {
  id: varchar("id", { length: 36 }).primaryKey(), // UUID token
  bookingId: int("bookingId").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  createdById: int("createdById").notNull().references(() => users.id),
  merchantId: varchar("merchantId", { length: 20 }).notNull(),
  transactionUnique: varchar("transactionUnique", { length: 50 }).notNull(),
  amountPence: int("amountPence").notNull(),
  orderRef: varchar("orderRef", { length: 255 }).notNull(), // PTS reference
  description: varchar("description", { length: 255 }),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // "pending" | "paid" | "failed" | "cancelled"
  redirectUrl: varchar("redirectUrl", { length: 500 }),
  callbackUrl: varchar("callbackUrl", { length: 500 }),
  ppsTransactionId: varchar("ppsTransactionId", { length: 100 }),
  ppsResponseCode: varchar("ppsResponseCode", { length: 10 }),
  ppsResponseMessage: varchar("ppsResponseMessage", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  paidAt: timestamp("paidAt"),
  expiresAt: timestamp("expiresAt"),
});
export type PaymentLink = typeof paymentLinks.$inferSelect;

// ─── GoCardless Mandates ──────────────────────────────────────────────────────

export const gcMandates = mysqlTable("gc_mandates", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"), // FK → users.id (nullable — placeholder row created before user account exists)
  mandateId: varchar("mandateId", { length: 100 }), // GoCardless mandate ID (MD...)
  billingRequestId: varchar("billingRequestId", { length: 100 }), // BRQ...
  billingRequestFlowId: varchar("billingRequestFlowId", { length: 100 }), // BRF...
  status: mysqlEnum("status", ["pending", "pending_submission", "submitted", "active", "cancelled", "failed", "expired"]).default("pending").notNull(),
  preferredPaymentDay: int("preferredPaymentDay"), // 1–28, agent's chosen day of month
  joiningFeePaidAt: timestamp("joiningFeePaidAt"), // When joining fee was paid
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type GcMandate = typeof gcMandates.$inferSelect;

// ─── GoCardless Subscriptions ─────────────────────────────────────────────────

export const gcSubscriptions = mysqlTable("gc_subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // FK → users.id
  mandateId: varchar("mandateId", { length: 100 }).notNull(), // GoCardless mandate ID
  subscriptionId: varchar("subscriptionId", { length: 100 }), // GoCardless subscription ID (SB...)
  status: mysqlEnum("status", ["active", "paused", "cancelled", "finished"]).default("active").notNull(),
  amount: int("amount").notNull(), // in pence
  currency: varchar("currency", { length: 3 }).default("GBP").notNull(),
  startDate: varchar("startDate", { length: 10 }).notNull(), // YYYY-MM-DD
  dayOfMonth: int("dayOfMonth"), // 1–28
  nextChargeDate: varchar("nextChargeDate", { length: 10 }), // YYYY-MM-DD
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type GcSubscription = typeof gcSubscriptions.$inferSelect;

// ─── GoCardless Payment Events ────────────────────────────────────────────────
export const gcPaymentEvents = mysqlTable("gc_payment_events", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"), // FK → users.id (resolved from mandate lookup)
  mandateId: varchar("mandateId", { length: 100 }), // GoCardless mandate ID
  paymentId: varchar("paymentId", { length: 100 }), // GoCardless payment ID (PM...)
  eventType: varchar("eventType", { length: 60 }).notNull(), // e.g. payments_failed, mandates_cancelled
  status: varchar("status", { length: 40 }), // e.g. failed, charged_back, cancelled
  amount: int("amount"), // in pence (null for mandate events)
  currency: varchar("currency", { length: 3 }).default("GBP"),
  failureReason: varchar("failureReason", { length: 255 }), // GoCardless failure reason code
  failureDescription: varchar("failureDescription", { length: 512 }), // human-readable
  occurredAt: timestamp("occurredAt").notNull(),
  rawPayload: text("rawPayload"), // full JSON for debugging
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type GcPaymentEvent = typeof gcPaymentEvents.$inferSelect;

// ─── Join Flow: Contract Signatures ──────────────────────────────────────────
export const contractSignatures = mysqlTable("contract_signatures", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),                                // FK → users.id
  contractTemplateId: int("contractTemplateId"),                  // FK → contract_templates.id
  signedAt: timestamp("signedAt").defaultNow().notNull(),
  signatureDataUrl: mediumtext("signatureDataUrl"),               // base64 drawn signature image
  signerName: varchar("signerName", { length: 255 }).notNull(),   // typed full name
  signerAddress: text("signerAddress"),                           // typed address
  ipAddress: varchar("ipAddress", { length: 64 }),                // for audit trail
  membershipTier: varchar("membershipTier", { length: 50 }),      // tier at time of signing
  membershipType: varchar("membershipType", { length: 20 }),      // solo/duo/trio at time of signing
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ContractSignature = typeof contractSignatures.$inferSelect;

// ─── Join Flow: Team Invites ──────────────────────────────────────────────────
export const teamInvites = mysqlTable("team_invites", {
  id: int("id").autoincrement().primaryKey(),
  teamId: int("teamId").notNull(),                                // FK → agent_teams.id
  leaderId: int("leaderId").notNull(),                            // FK → users.id (team leader)
  invitedEmail: varchar("invitedEmail", { length: 320 }).notNull(),
  token: varchar("token", { length: 128 }).notNull().unique(),    // unique invite token
  status: mysqlEnum("status", ["pending", "accepted", "expired"]).default("pending").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  acceptedAt: timestamp("acceptedAt"),
  acceptedByUserId: int("acceptedByUserId"),                      // FK → users.id (team member)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TeamInvite = typeof teamInvites.$inferSelect;

// ─── Join Flow: Join Sessions (tracks multi-step sign-up progress) ────────────
export const joinSessions = mysqlTable("join_sessions", {
  id: int("id").autoincrement().primaryKey(),
  sessionToken: varchar("sessionToken", { length: 128 }).notNull().unique(),
  email: varchar("email", { length: 320 }).notNull(),
  membershipTier: varchar("membershipTier", { length: 50 }),      // business_class / first_class
  membershipType: varchar("membershipType", { length: 20 }),      // solo / duo / trio
  step: varchar("step", { length: 30 }).default("plan").notNull(), // plan / contract / payment / complete
  contractSignedAt: timestamp("contractSignedAt"),
  signatureDataUrl: mediumtext("signatureDataUrl"),
  signerName: varchar("signerName", { length: 255 }),
  signerAddress: text("signerAddress"),
  billingRequestId: varchar("billingRequestId", { length: 100 }), // GC billing request ID
  billingRequestFlowUrl: text("billingRequestFlowUrl"),           // GC hosted page URL
  joiningFeePaidAt: timestamp("joiningFeePaidAt"),
  mandateId: varchar("mandateId", { length: 100 }),
  userId: int("userId"),                                           // set once account is created
  ipAddress: varchar("ipAddress", { length: 64 }),
  // ─── Legal evidence fields ───────────────────────────────────────────────────
  signingUserAgent: text("signingUserAgent"),                        // Browser/device at time of signing
  consentConfirmed: boolean("consentConfirmed").default(false),      // Explicit "I agree" checkbox
  contractTextSnapshot: longtext("contractTextSnapshot"),            // Full contract HTML at moment of signing
  contractHash: varchar("contractHash", { length: 128 }),           // SHA-256 of (contractText+signature+timestamp)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),                     // sessions expire after 24h
});
export type JoinSession = typeof joinSessions.$inferSelect;

// ─── Admin Onboarding Checklist ───────────────────────────────────────────────
// Tracks admin tasks for each new agent during onboarding

export const adminOnboardingChecklist = mysqlTable("admin_onboarding_checklist", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),                                  // FK → users.id (the agent)
  trainingHubLogin: boolean("trainingHubLogin").default(false).notNull(),
  jltEmailSetup: boolean("jltEmailSetup").default(false).notNull(),
  idDocsReviewed: boolean("idDocsReviewed").default(false).notNull(),
  contractReviewed: boolean("contractReviewed").default(false).notNull(),
  welcomeEmailSent: boolean("welcomeEmailSent").default(false).notNull(),
  portalAccessApproved: boolean("portalAccessApproved").default(false).notNull(),
  ddSubscriptionCreated: boolean("ddSubscriptionCreated").default(false).notNull(),
  updatedById: int("updatedById"),                                  // FK → users.id (the admin)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AdminOnboardingChecklist = typeof adminOnboardingChecklist.$inferSelect;

// ─── Agent CRM Notes ──────────────────────────────────────────────────────────
// Timestamped contact log / general notes on an agent's CRM profile
export const agentCrmNotes = mysqlTable("agent_crm_notes", {
  id: int("id").autoincrement().primaryKey(),
  agentUserId: int("agentUserId").notNull(),                        // FK → users.id (the agent being noted)
  authorId: int("authorId").notNull(),                              // FK → users.id (the admin who wrote the note)
  authorName: varchar("authorName", { length: 128 }),               // Denormalised for display
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AgentCrmNote = typeof agentCrmNotes.$inferSelect;

// ─── Booking Documents ────────────────────────────────────────────────────────
// Files uploaded to a booking (invoices, ATOL certificates, other docs)
export const bookingDocuments = mysqlTable("booking_documents", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),                            // FK → bookings.id
  uploadedById: int("uploadedById").notNull(),                      // FK → users.id
  uploadedByName: varchar("uploadedByName", { length: 128 }),       // Denormalised for display
  docType: mysqlEnum("docType", ["invoice", "atol", "other"]).notNull().default("other"),
  displayName: varchar("displayName", { length: 255 }).notNull(),   // Human-readable name (admin can rename)
  fileUrl: text("fileUrl").notNull(),                               // S3 public URL
  fileKey: varchar("fileKey", { length: 512 }).notNull(),           // S3 key for deletion
  mimeType: varchar("mimeType", { length: 128 }),
  fileSize: int("fileSize"),                                        // bytes
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type BookingDocument = typeof bookingDocuments.$inferSelect;
export type InsertBookingDocument = typeof bookingDocuments.$inferInsert;


// ─── Email Templates ──────────────────────────────────────────────────────────
// Reusable email templates for campaigns and drip workflows
export const emailTemplates = mysqlTable("email_templates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  bodyHtml: longtext("bodyHtml").notNull(),
  bodyText: text("bodyText"),
  audienceType: mysqlEnum("audienceType", ["prospect", "agent"]).notNull().default("prospect"),
  createdById: int("createdById"),
  createdByName: varchar("createdByName", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertEmailTemplate = typeof emailTemplates.$inferInsert;

// ─── Email Drip Workflows ─────────────────────────────────────────────────────
export const emailDripWorkflows = mysqlTable("email_drip_workflows", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  audienceType: mysqlEnum("audienceType", ["prospect", "agent"]).notNull().default("prospect"),
  triggerStage: varchar("triggerStage", { length: 100 }),
  isActive: boolean("isActive").notNull().default(true),
  createdById: int("createdById"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type EmailDripWorkflow = typeof emailDripWorkflows.$inferSelect;
export type InsertEmailDripWorkflow = typeof emailDripWorkflows.$inferInsert;

// ─── Email Drip Steps ─────────────────────────────────────────────────────────
export const emailDripSteps = mysqlTable("email_drip_steps", {
  id: int("id").autoincrement().primaryKey(),
  workflowId: int("workflowId").notNull(),
  stepOrder: int("stepOrder").notNull().default(0),
  delayDays: int("delayDays").notNull().default(0),
  subject: varchar("subject", { length: 500 }).notNull(),
  bodyHtml: longtext("bodyHtml").notNull(),
  bodyText: text("bodyText"),
  templateId: int("templateId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type EmailDripStep = typeof emailDripSteps.$inferSelect;
export type InsertEmailDripStep = typeof emailDripSteps.$inferInsert;

// ─── Email Drip Enrollments ───────────────────────────────────────────────────
export const emailDripEnrollments = mysqlTable("email_drip_enrollments", {
  id: int("id").autoincrement().primaryKey(),
  workflowId: int("workflowId").notNull(),
  recipientEmail: varchar("recipientEmail", { length: 320 }).notNull(),
  recipientName: varchar("recipientName", { length: 255 }),
  recipientType: mysqlEnum("recipientType", ["prospect", "agent"]).notNull(),
  recipientId: int("recipientId"),
  currentStep: int("currentStep").notNull().default(0),
  status: mysqlEnum("status", ["active", "completed", "unsubscribed", "failed"]).notNull().default("active"),
  enrolledAt: timestamp("enrolledAt").defaultNow().notNull(),
  nextSendAt: timestamp("nextSendAt"),
  completedAt: timestamp("completedAt"),
});
export type EmailDripEnrollment = typeof emailDripEnrollments.$inferSelect;
export type InsertEmailDripEnrollment = typeof emailDripEnrollments.$inferInsert;

// ── Email Unsubscribes ────────────────────────────────────────────────────────
export const emailUnsubscribes = mysqlTable("email_unsubscribes", {
  id: int("id").primaryKey().autoincrement(),
  email: varchar("email", { length: 255 }).notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  prospectId: int("prospectId"),
  unsubscribedAt: timestamp("unsubscribedAt").notNull().defaultNow(),
});
export type EmailUnsubscribe = typeof emailUnsubscribes.$inferSelect;
export type InsertEmailUnsubscribe = typeof emailUnsubscribes.$inferInsert;

// ── Email Branding Settings ───────────────────────────────────────────────────
export const emailBrandingSettings = mysqlTable("email_branding_settings", {
  id: int("id").primaryKey().autoincrement(),
  logoUrl: text("logoUrl"),                                          // S3 URL for logo image
  headerBgColor: varchar("headerBgColor", { length: 20 }).notNull().default("#70FFE8"),
  headerTextColor: varchar("headerTextColor", { length: 20 }).notNull().default("#414141"),
  bodyBgColor: varchar("bodyBgColor", { length: 20 }).notNull().default("#f5f5f5"),
  cardBgColor: varchar("cardBgColor", { length: 20 }).notNull().default("#ffffff"),
  accentColor: varchar("accentColor", { length: 20 }).notNull().default("#02E6D2"),
  companyName: varchar("companyName", { length: 255 }).notNull().default("JLT Group"),
  tagline: varchar("tagline", { length: 255 }),
  footerText: text("footerText"),
  websiteUrl: varchar("websiteUrl", { length: 500 }),
  facebookUrl: varchar("facebookUrl", { length: 500 }),
  instagramUrl: varchar("instagramUrl", { length: 500 }),
  twitterUrl: varchar("twitterUrl", { length: 500 }),
  linkedinUrl: varchar("linkedinUrl", { length: 500 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  updatedBy: int("updatedBy"),                                       // FK → users.id
});
export type EmailBrandingSettings = typeof emailBrandingSettings.$inferSelect;
export type InsertEmailBrandingSettings = typeof emailBrandingSettings.$inferInsert;

// ─── Reimbursement Audit Log ──────────────────────────────────────────────────
export const reimbursementAuditLogs = mysqlTable("reimbursement_audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  reimbursementItemId: int("reimbursementItemId").notNull(), // FK → reimbursement_items.id
  bookingId: int("bookingId").notNull(),                     // FK → bookings.id
  action: varchar("action", { length: 100 }).notNull(),      // e.g. "status_changed", "created", "deleted"
  oldStatus: varchar("oldStatus", { length: 50 }),           // previous status
  newStatus: varchar("newStatus", { length: 50 }),           // new status
  actedById: int("actedById").notNull(),                     // FK → users.id
  actedAt: timestamp("actedAt").defaultNow().notNull(),
  note: text("note"),                                        // optional free-text note
});
export type ReimbursementAuditLog = typeof reimbursementAuditLogs.$inferSelect;

// ─── Agent Email Log ──────────────────────────────────────────────────────────
export const agentEmails = mysqlTable("agent_emails", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),                                          // null if sent before account created
  toEmail: varchar("toEmail", { length: 320 }).notNull(),
  toName: varchar("toName", { length: 255 }),
  subject: varchar("subject", { length: 500 }).notNull(),
  triggerKey: varchar("triggerKey", { length: 100 }),             // e.g. gc_receipt, gc_payment_failed, payment_received
  bodyHtml: mediumtext("bodyHtml"),
  status: varchar("status", { length: 30 }).default("sent"),      // sent | failed
  sentAt: timestamp("sentAt").defaultNow().notNull(),
});
export type AgentEmail = typeof agentEmails.$inferSelect;

// ─── GoCardless Consecutive Payment Failures ─────────────────────────────────
export const gcPaymentFailures = mysqlTable("gc_payment_failures", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  consecutiveFailures: int("consecutiveFailures").default(0).notNull(),
  lastFailedAt: timestamp("lastFailedAt"),
  autoSuspendedAt: timestamp("autoSuspendedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type GcPaymentFailure = typeof gcPaymentFailures.$inferSelect;

// ─── Recruitment Pipeline ────────────────────────────────────────────────────

export const recruitmentPipelineStageEnum = mysqlEnum("recruitmentPipelineStageEnum", [
  "new_enquiry",
  "application_received",
  "ar_approved",
  "ar_declined",
  "discovery_call_booked",
  "rebook_required",
  "did_not_turn_up",
  "discovery_call_complete",
  "onboarding_approved",
  "onboarding_declined",
  "waitlisted",
  "archived",
]);

export const recruitmentProspects = mysqlTable("recruitment_prospects", {
  id: int("id").primaryKey().autoincrement(),
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  pipelineStage: varchar("pipelineStage", { length: 50 }).notNull().default("new_enquiry"),
  applicationData: json("applicationData"),
  applicationSubmittedAt: timestamp("applicationSubmittedAt"),
  calComEventId: varchar("calComEventId", { length: 255 }),
  discoveryCallAt: timestamp("discoveryCallAt"),
  reviewedById: int("reviewedById"),
  reviewedAt: timestamp("reviewedAt"),
  declineReason: text("declineReason"),
  adminNotes: text("adminNotes"),
  source: varchar("source", { length: 100 }).default("website"),
  referredById: int("referredById"),                                     // FK → users.id (null = no referrer)
  tierInterest: varchar("tierInterest", { length: 50 }),
  howHeard: varchar("howHeard", { length: 255 }),
  prospectusEmailSentAt: timestamp("prospectusEmailSentAt"),
  archivedAt: timestamp("archivedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type RecruitmentProspect = typeof recruitmentProspects.$inferSelect;
export type InsertRecruitmentProspect = typeof recruitmentProspects.$inferInsert;

export const recruitmentEmailsSent = mysqlTable("recruitment_emails_sent", {
  id: int("id").primaryKey().autoincrement(),
  prospectId: int("prospectId").notNull(),
  stage: varchar("stage", { length: 100 }).notNull(),
  emailKey: varchar("emailKey", { length: 100 }).notNull(),
  subject: varchar("subject", { length: 500 }),
  sentAt: timestamp("sentAt").defaultNow().notNull(),
});
export type RecruitmentEmailSent = typeof recruitmentEmailsSent.$inferSelect;

export const recruitmentStageHistory = mysqlTable("recruitment_stage_history", {
  id: int("id").primaryKey().autoincrement(),
  prospectId: int("prospectId").notNull(),
  fromStage: varchar("fromStage", { length: 100 }),
  toStage: varchar("toStage", { length: 100 }).notNull(),
  changedById: int("changedById"),
  changedByName: varchar("changedByName", { length: 200 }),
  note: text("note"),
  changedAt: timestamp("changedAt").defaultNow().notNull(),
});
export type RecruitmentStageHistory = typeof recruitmentStageHistory.$inferSelect;

// ─── External API Keys ────────────────────────────────────────────────────────

export const apiKeys = mysqlTable("api_keys", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(), // Friendly name e.g. "Tom's CRM"
  keyHash: varchar("keyHash", { length: 255 }).notNull(), // SHA-256 hash of the raw key
  keyPrefix: varchar("keyPrefix", { length: 10 }).notNull(), // First 8 chars of raw key for display
  agencyName: varchar("agencyName", { length: 100 }), // Optional agency name
  createdById: int("createdById").notNull(), // FK → users.id
  lastUsedAt: timestamp("lastUsedAt"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

// ─── OAuth 2.0 Identity Provider ─────────────────────────────────────────────

export const oauthClients = mysqlTable("oauth_clients", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(), // Friendly name e.g. "Tom's CRM"
  clientId: varchar("clientId", { length: 64 }).notNull().unique(), // Public client identifier
  clientSecretHash: varchar("clientSecretHash", { length: 255 }).notNull(), // SHA-256 hash of secret
  clientSecretPrefix: varchar("clientSecretPrefix", { length: 10 }).notNull(), // First 8 chars for display
  redirectUri: varchar("redirectUri", { length: 500 }).notNull(), // Allowed callback URL
  logoUrl: varchar("logoUrl", { length: 500 }), // Optional logo shown on consent screen
  isActive: boolean("isActive").default(true).notNull(),
  createdById: int("createdById").notNull(), // FK → users.id
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type OAuthClient = typeof oauthClients.$inferSelect;
export type InsertOAuthClient = typeof oauthClients.$inferInsert;

export const oauthCodes = mysqlTable("oauth_codes", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 128 }).notNull().unique(), // The auth code sent to client
  clientId: varchar("clientId", { length: 64 }).notNull(), // FK → oauth_clients.clientId
  userId: int("userId").notNull(), // FK → users.id (the agent who authorised)
  redirectUri: varchar("redirectUri", { length: 500 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(), // Short-lived: 10 minutes
  usedAt: timestamp("usedAt"), // Null until exchanged; prevents replay
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type OAuthCode = typeof oauthCodes.$inferSelect;
export type InsertOAuthCode = typeof oauthCodes.$inferInsert;

// ─── Magic Link / SSO Tokens ──────────────────────────────────────────────────
export const ssoTokens = mysqlTable("sso_tokens", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 128 }).notNull().unique(), // Cryptographically random token
  userId: int("userId").notNull(), // FK → users.id
  expiresAt: timestamp("expiresAt").notNull(), // Short-lived: 90 seconds
  usedAt: timestamp("usedAt"), // Null until consumed; prevents replay
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SsoToken = typeof ssoTokens.$inferSelect;
export type InsertSsoToken = typeof ssoTokens.$inferInsert;

// ─── Terms & Contract Signing ─────────────────────────────────────────────────

export const termsVersions = mysqlTable("terms_versions", {
  id: int("id").autoincrement().primaryKey(),
  versionLabel: varchar("versionLabel", { length: 50 }).notNull(), // e.g. "May 2026"
  description: text("description"), // Admin notes about what changed
  isActive: boolean("isActive").default(false).notNull(), // Only one active at a time
  sentAt: timestamp("sentAt"), // When admin pushed this version out to agents
  sentById: int("sentById"), // FK → users.id (admin who sent it)
  deadline: timestamp("deadline"), // Optional signing deadline shown to agents
  documentUrl: text("documentUrl"), // S3 URL of the uploaded PDF agreement
  documentKey: text("documentKey"), // S3 key for deletion
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TermsVersion = typeof termsVersions.$inferSelect;
export type InsertTermsVersion = typeof termsVersions.$inferInsert;

export const termsSignings = mysqlTable("terms_signings", {
  id: int("id").autoincrement().primaryKey(),
  termsVersionId: int("termsVersionId").notNull(), // FK → terms_versions.id
  userId: int("userId").notNull(), // FK → users.id (the agent who signed)
  signedName: varchar("signedName", { length: 200 }).notNull(), // Typed full name
  signatureImage: text("signatureImage"), // Base64 data URL of drawn signature
  ipAddress: varchar("ipAddress", { length: 45 }), // IPv4 or IPv6
  userAgent: varchar("userAgent", { length: 500 }), // Browser info
  signedAt: timestamp("signedAt").defaultNow().notNull(),
});
export type TermsSigning = typeof termsSignings.$inferSelect;
export type InsertTermsSigning = typeof termsSignings.$inferInsert;

// ─── Recruitment Email Workflows ──────────────────────────────────────────────
// One workflow per pipeline stage. Each workflow contains ordered email steps.
// When a prospect enters a stage, they are enrolled in that stage's workflow.
// When they move to a new stage, they are unenrolled from all other workflows.

export const recruitmentWorkflows = mysqlTable("recruitment_workflows", {
  id: int("id").autoincrement().primaryKey(),
  stage: varchar("stage", { length: 100 }).notNull().unique(), // e.g. "new_enquiry"
  name: varchar("name", { length: 255 }).notNull(),            // human-readable label
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type RecruitmentWorkflow = typeof recruitmentWorkflows.$inferSelect;
export type InsertRecruitmentWorkflow = typeof recruitmentWorkflows.$inferInsert;

export const recruitmentWorkflowEmails = mysqlTable("recruitment_workflow_emails", {
  id: int("id").autoincrement().primaryKey(),
  workflowId: int("workflowId").notNull(),   // FK → recruitment_workflows.id
  stepOrder: int("stepOrder").notNull(),      // 1-based ordering within workflow
  delayHours: int("delayHours").notNull().default(0), // hours after enrollment before sending
  subject: varchar("subject", { length: 500 }).notNull(),
  bodyHtml: longtext("bodyHtml").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type RecruitmentWorkflowEmail = typeof recruitmentWorkflowEmails.$inferSelect;
export type InsertRecruitmentWorkflowEmail = typeof recruitmentWorkflowEmails.$inferInsert;

export const recruitmentWorkflowEnrollments = mysqlTable("recruitment_workflow_enrollments", {
  id: int("id").autoincrement().primaryKey(),
  prospectId: int("prospectId").notNull(),   // FK → recruitment_prospects.id
  workflowId: int("workflowId").notNull(),   // FK → recruitment_workflows.id
  currentStep: int("currentStep").notNull().default(1), // next step to send
  nextSendAt: timestamp("nextSendAt"),        // when to send the next email (null = done)
  enrolledAt: timestamp("enrolledAt").defaultNow().notNull(),
  cancelledAt: timestamp("cancelledAt"),      // set when prospect moves to a different stage
});
export type RecruitmentWorkflowEnrollment = typeof recruitmentWorkflowEnrollments.$inferSelect;
export type InsertRecruitmentWorkflowEnrollment = typeof recruitmentWorkflowEnrollments.$inferInsert;

// ─── Supplier Directory ───────────────────────────────────────────────────────
// credentialStage: which stage unlocks this supplier's credentials
//   1 = always visible (no credentials shown at stage 1)
//   2 = credentials visible at stage 2+
//   3 = credentials visible at stage 3 only
export const suppliers = mysqlTable("suppliers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: longtext("description"),                          // full HTML description
  shortDescription: text("shortDescription"),
  publicWebsite: varchar("publicWebsite", { length: 1000 }),
  tradeWebsite: varchar("tradeWebsite", { length: 1000 }),       // agent booking portal URL
  additionalWebsite: varchar("additionalWebsite", { length: 1000 }),
  agencyId: text("agencyId"),                                    // agency/ABTA ID (can be long)
  loginUsername: varchar("loginUsername", { length: 500 }),      // trade portal username
  loginPassword: varchar("loginPassword", { length: 500 }),      // trade portal password
  commission: varchar("commission", { length: 500 }),
  facebookUrl: varchar("facebookUrl", { length: 1000 }),
  instagramUrl: varchar("instagramUrl", { length: 1000 }),
  mediaAssetsUrl: varchar("mediaAssetsUrl", { length: 1000 }),    // media kit / brand assets page
  accountManager: varchar("accountManager", { length: 255 }),
  phone: varchar("phone", { length: 500 }),
  email: varchar("email", { length: 320 }),
  generalNotes: longtext("generalNotes"),                        // free-text notes
  video1: text("video1"),                                        // Loom embed HTML
  video2: text("video2"),
  video3: text("video3"),
  video4: text("video4"),                                        // Loom URL 4
  video5: text("video5"),                                        // Loom URL 5
  categories: text("categories"),                                // semicolon-separated
  locations: text("locations"),                                  // semicolon-separated countries
  imageUrl: text("imageUrl"),                                    // S3 URL for logo/image
  adminUsername: varchar("adminUsername", { length: 500 }),      // admin-only credential
  adminPassword: varchar("adminPassword", { length: 500 }),
  adminNotes: text("adminNotes"),
  credentialStage: int("credentialStage").notNull().default(2),  // 2 = stage 2+, 3 = stage 3 only
  isActive: int("isActive").notNull().default(1),               // soft delete (1=active, 0=inactive)
  sortOrder: int("sortOrder").notNull().default(0),
  // AI enrichment fields
  usp: text("usp"),                                              // Key selling points (AI-generated or manual)
  priceTier: varchar("priceTier", { length: 50 }),               // budget / mid-range / luxury / ultra-luxury
  notSuitableFor: text("notSuitableFor"),                        // e.g. "last-minute bookings, solo travellers"
  preferredContact: varchar("preferredContact", { length: 100 }), // email / phone / portal
  aiSummary: text("aiSummary"),                                  // AI-generated one-paragraph summary for search
  idealClient: text("idealClient"),                              // AI: who this supplier is best for (e.g. couples, families)
  bookingTips: text("bookingTips"),                              // AI: practical tips for agents when booking this supplier
  aiEnrichedAt: timestamp("aiEnrichedAt"),                       // when AI enrichment was last run
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = typeof suppliers.$inferInsert;

// Per-agent supplier stage unlock (1, 2, or 3)
export const agentSupplierStages = mysqlTable("agent_supplier_stages", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),                               // FK → users.id
  stage: int("stage").notNull().default(1),                     // 1, 2, or 3
  unlockedAt: timestamp("unlockedAt").defaultNow().notNull(),
  unlockedById: int("unlockedById"),                            // FK → users.id (admin who unlocked)
});
export type AgentSupplierStage = typeof agentSupplierStages.$inferSelect;
export type InsertAgentSupplierStage = typeof agentSupplierStages.$inferInsert;

// Supplier attachments (PDFs, brochures, rate cards, etc.)
export const supplierAttachments = mysqlTable("supplier_attachments", {
  id: int("id").autoincrement().primaryKey(),
  supplierId: int("supplierId").notNull(),                        // FK → suppliers.id
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileUrl: text("fileUrl").notNull(),                            // S3 public URL
  fileKey: varchar("fileKey", { length: 500 }).notNull(),        // S3 key for deletion
  fileSize: int("fileSize"),                                     // bytes
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
  uploadedById: int("uploadedById"),                             // FK → users.id
});
export type SupplierAttachment = typeof supplierAttachments.$inferSelect;
export type InsertSupplierAttachment = typeof supplierAttachments.$inferInsert;

// ─── Community Hub ────────────────────────────────────────────────────────────

export const communityPosts = mysqlTable("community_posts", {
  id: int("id").autoincrement().primaryKey(),
  authorId: int("authorId").notNull(),                                    // FK → users.id
  authorName: varchar("authorName", { length: 255 }).notNull(),
  category: mysqlEnum("category", [
    "business_update",
    "supplier_news_deals",
    "news_announcements",
    "agent_win",
    "jlt_stay_story",
    "events",
    "training_webinars",
    "mindset",
    "first_class_lounge",
  ]).notNull(),
  supplierSubCategory: varchar("supplierSubCategory", { length: 100 }),   // cruise|disney|tour_operators|flights|hotels|other (supplier_news_deals only)
  supplierPostType: mysqlEnum("supplierPostType", ["news", "deal"]),       // news or deal (supplier_news_deals only)
  title: varchar("title", { length: 500 }).notNull(),
  bodyHtml: longtext("bodyHtml").notNull(),                                // Rich text HTML (admin) or plain text (agent)
  loomUrl: varchar("loomUrl", { length: 500 }),                           // Loom embed URL (admin only)
  imageUrls: json("imageUrls"),                                            // string[] of S3 URLs
  attachmentUrls: json("attachmentUrls"),                                  // { name, url, key }[] of S3 attachments
  isPinned: boolean("isPinned").default(false).notNull(),
  isHidden: boolean("isHidden").default(false).notNull(),                  // soft-hide by admin
  isDraft: boolean("isDraft").default(false).notNull(),
  requiresConfirmation: boolean("requiresConfirmation").default(false).notNull(), // true for business_update
  expiresAt: timestamp("expiresAt"),                                       // optional auto-hide date
  viewCount: int("viewCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CommunityPost = typeof communityPosts.$inferSelect;
export type InsertCommunityPost = typeof communityPosts.$inferInsert;

// ─── Community: Reactions ─────────────────────────────────────────────────────
export const communityReactions = mysqlTable("community_reactions", {
  id: int("id").autoincrement().primaryKey(),
  postId: int("postId").notNull(),                                         // FK → community_posts.id
  userId: int("userId").notNull(),                                         // FK → users.id
  emoji: mysqlEnum("emoji", ["thumbs_up", "heart", "celebrate", "fire", "plane"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CommunityReaction = typeof communityReactions.$inferSelect;

// ─── Community: Comments ──────────────────────────────────────────────────────
export const communityComments = mysqlTable("community_comments", {
  id: int("id").autoincrement().primaryKey(),
  postId: int("postId").notNull(),                                         // FK → community_posts.id
  authorId: int("authorId").notNull(),                                     // FK → users.id
  authorName: varchar("authorName", { length: 255 }).notNull(),
  content: text("content").notNull(),
  isDeleted: boolean("isDeleted").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CommunityComment = typeof communityComments.$inferSelect;

// ─── Community: Read Confirmations (Business Updates) ────────────────────────
export const communityConfirmations = mysqlTable("community_confirmations", {
  id: int("id").autoincrement().primaryKey(),
  postId: int("postId").notNull(),                                         // FK → community_posts.id
  userId: int("userId").notNull(),                                         // FK → users.id
  confirmedAt: timestamp("confirmedAt").defaultNow().notNull(),
});
export type CommunityConfirmation = typeof communityConfirmations.$inferSelect;

// ─── Community: Post Views (for "unread" tracking) ────────────────────────────
export const communityPostViews = mysqlTable("community_post_views", {
  id: int("id").autoincrement().primaryKey(),
  postId: int("postId").notNull(),                                         // FK → community_posts.id
  userId: int("userId").notNull(),                                         // FK → users.id
  viewedAt: timestamp("viewedAt").defaultNow().notNull(),
});
export type CommunityPostView = typeof communityPostViews.$inferSelect;

// ─── Community: Confirmation Reminder Log ────────────────────────────────────
// Tracks when automated 14-day reminder emails were sent to prevent re-spamming
export const communityConfirmationReminders = mysqlTable("community_confirmation_reminders", {
  id: int("id").autoincrement().primaryKey(),
  postId: int("postId").notNull(),                                         // FK → community_posts.id
  userId: int("userId").notNull(),                                         // FK → users.id
  sentAt: timestamp("sentAt").defaultNow().notNull(),
});
export type CommunityConfirmationReminder = typeof communityConfirmationReminders.$inferSelect;

// ─── Community: Weekly Digests ────────────────────────────────────────────────
export const communityDigests = mysqlTable("community_digests", {
  id: int("id").autoincrement().primaryKey(),
  weekStarting: timestamp("weekStarting").notNull(),                       // Monday 00:00 UTC of the week covered
  status: mysqlEnum("status", ["draft", "sent"]).default("draft").notNull(),
  introText: text("introText"),                                            // Optional custom intro from admin
  includedPostIds: json("includedPostIds"),                                 // int[] — curated list of post IDs
  includeBookingHighlights: boolean("includeBookingHighlights").default(true).notNull(),
  bookingHighlightsOverride: json("bookingHighlightsOverride"),            // manual overrides to auto-generated highlights
  statsSnapshot: json("statsSnapshot"),                                    // { bookingsCount, commissionTotal, reimbursementsCount }
  sentAt: timestamp("sentAt"),
  sentById: int("sentById"),                                               // FK → users.id
  recipientCount: int("recipientCount"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CommunityDigest = typeof communityDigests.$inferSelect;
