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
  pipelineStage: mysqlEnum("pipelineStage", ["To Do", "In Progress", "Actioned"]).default("To Do").notNull(),
  assignedToId: int("assignedToId"), // FK → users.id
  status: mysqlEnum("status", ["pending", "actioned"]).default("pending").notNull(),
  actionedAt: timestamp("actionedAt"),
  actionedById: int("actionedById"), // FK → users.id
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Amendment = typeof amendments.$inferSelect;

// ─── Cancellations ────────────────────────────────────────────────────────────

export const cancellations = mysqlTable("cancellations", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(), // FK → bookings.id
  agentId: int("agentId").notNull(), // FK → users.id
  confirmedAt: timestamp("confirmedAt").defaultNow().notNull(),
  processedById: int("processedById"), // FK → users.id
  processedAt: timestamp("processedAt"),
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

// ─── System Settings ──────────────────────────────────────────────────────────
// Simple key-value store for global system flags (e.g. notifications paused)
export const systemSettings = mysqlTable("system_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;
