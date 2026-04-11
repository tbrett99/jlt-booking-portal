import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock DB helpers ──────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getAllUsers: vi.fn().mockResolvedValue([]),
  getUserByEmail: vi.fn().mockResolvedValue(null),
  getUserById: vi.fn().mockResolvedValue(null),
  createAgentUser: vi.fn().mockResolvedValue({ id: 99 }),
  updateUserRole: vi.fn().mockResolvedValue(undefined),
  toggleUserActive: vi.fn().mockResolvedValue(undefined),
  deleteUser: vi.fn().mockResolvedValue(undefined),
  updateUserPassword: vi.fn().mockResolvedValue(undefined),
  createBooking: vi.fn().mockResolvedValue({ id: 1 }),
  getBookingById: vi.fn().mockResolvedValue(null),
  getBookingsByAgent: vi.fn().mockResolvedValue([]),
  getAllBookings: vi.fn().mockResolvedValue([]),
  updateBookingStage: vi.fn().mockResolvedValue({ id: 1, currentStage: "Added to PTS" }),
  updateBookingAdminFields: vi.fn().mockResolvedValue({}),
  uploadReimbursementDoc: vi.fn().mockResolvedValue(undefined),
  getPipelineHistory: vi.fn().mockResolvedValue([]),
  createNote: vi.fn().mockResolvedValue({ id: 10 }),
  getNotesByBooking: vi.fn().mockResolvedValue([]),
  createAmendment: vi.fn().mockResolvedValue({ id: 5 }),
  getAmendmentsByBooking: vi.fn().mockResolvedValue([]),
  getAllAmendments: vi.fn().mockResolvedValue([]),
  actionAmendment: vi.fn().mockResolvedValue(undefined),
  createCancellation: vi.fn().mockResolvedValue(undefined),
  getAllCancellations: vi.fn().mockResolvedValue([]),
  createRefund: vi.fn().mockResolvedValue({ id: 3 }),
  getRefundsByBooking: vi.fn().mockResolvedValue([]),
  getAllRefunds: vi.fn().mockResolvedValue([]),
  getNotificationTemplates: vi.fn().mockResolvedValue([]),
  getNotificationTemplate: vi.fn().mockResolvedValue(null),
  upsertNotificationTemplate: vi.fn().mockResolvedValue(undefined),
  createInAppNotification: vi.fn().mockResolvedValue(undefined),
  getInAppNotifications: vi.fn().mockResolvedValue([]),
  markNotificationsRead: vi.fn().mockResolvedValue(undefined),
  getUnreadNotificationCount: vi.fn().mockResolvedValue(0),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  bulkCreateAgentUsers: vi.fn().mockResolvedValue([]),
  markCredentialsSent: vi.fn().mockResolvedValue(undefined),
  updateAmendmentPipeline: vi.fn().mockResolvedValue(undefined),
  updateRefundPipeline: vi.fn().mockResolvedValue(undefined),
  getCommissionDueBookings: vi.fn().mockResolvedValue([]),
  createCommissionClaim: vi.fn().mockResolvedValue({ id: 1 }),
  getCommissionClaimsByAgent: vi.fn().mockResolvedValue([]),
  getAllCommissionClaims: vi.fn().mockResolvedValue([]),
  markCommissionPaid: vi.fn().mockResolvedValue(undefined),
  getCommissionClaimByBooking: vi.fn().mockResolvedValue(null),
}));

vi.mock("./email", () => ({
  sendNotificationEmail: vi.fn().mockResolvedValue(undefined),
  sendCredentialsEmail: vi.fn().mockResolvedValue(undefined),
  sendDirectEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./encryption", () => ({
  encryptOptional: vi.fn((v) => (v ? `enc:${v}` : null)),
  decryptOptional: vi.fn((v) => (v ? v.replace("enc:", "") : null)),
}));

vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://cdn.example.com/file.pdf" }),
}));

// ─── Context factories ────────────────────────────────────────────────────────

function makeCtx(role: "super_admin" | "admin" | "agent" | null = null): TrpcContext {
  const clearedCookies: any[] = [];
  return {
    user: role
      ? {
          id: role === "super_admin" ? 1 : role === "admin" ? 2 : 3,
          openId: `openid-${role}`,
          name: `Test ${role}`,
          email: `${role}@jlt.test`,
          loginMethod: "password",
          role,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastSignedIn: new Date(),
          hashedPassword: null,
          tempPassword: null,
          mustChangePassword: false,
        }
      : null,
    req: { protocol: "https", headers: {} } as any,
    res: {
      clearCookie: (name: string, opts: any) => clearedCookies.push({ name, opts }),
    } as any,
  };
}

// ─── Auth tests ───────────────────────────────────────────────────────────────

describe("auth.logout", () => {
  it("clears session cookie and returns success", async () => {
    const ctx = makeCtx("agent");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
  });

  it("auth.me returns null when not authenticated", async () => {
    const ctx = makeCtx(null);
    const caller = appRouter.createCaller(ctx);
    const me = await caller.auth.me();
    expect(me).toBeNull();
  });

  it("auth.me returns user when authenticated", async () => {
    const ctx = makeCtx("agent");
    const caller = appRouter.createCaller(ctx);
    const me = await caller.auth.me();
    expect(me?.role).toBe("agent");
  });
});

// ─── Role guard tests ─────────────────────────────────────────────────────────

describe("role guards", () => {
  it("users.list is forbidden for agents", async () => {
    const ctx = makeCtx("agent");
    const caller = appRouter.createCaller(ctx);
    await expect(caller.users.list()).rejects.toThrow(/FORBIDDEN|Admin access required/i);
  });

  it("users.list is accessible to admin", async () => {
    const ctx = makeCtx("admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.users.list();
    expect(result).toHaveProperty('items');
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("notifications.templates.update is forbidden for admin (not super_admin)", async () => {
    const ctx = makeCtx("admin");
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.notifications.templates.update({
        triggerKey: "test",
        label: "Test",
        subject: "Test Subject",
        bodyHtml: "<p>Test</p>",
        recipientType: "agent",
      })
    ).rejects.toThrow(/FORBIDDEN|Super admin/i);
  });

  it("notifications.templates.update is accessible to super_admin", async () => {
    const ctx = makeCtx("super_admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.notifications.templates.update({
      triggerKey: "test",
      label: "Test",
      subject: "Test Subject",
      bodyHtml: "<p>Test</p>",
      recipientType: "agent",
    });
    expect(result.success).toBe(true);
  });
});

// ─── Notes tests ──────────────────────────────────────────────────────────────

describe("notes", () => {
  it("agents cannot post internal notes", async () => {
    const { getBookingById } = await import("./db");
    vi.mocked(getBookingById).mockResolvedValueOnce({
      id: 1,
      agentId: 3,
      clientName: "Test Client",
      departureDate: new Date(),
      topdogRef: null,
      reimbursementsRequired: false,
      reimbursementDocUrl: null,
      reimbursementDocUploadedAt: null,
      reimbursementDocLateUpload: false,
      ptsRef: null,
      finalSupplierPaymentDate: null,
      expectedCommission: null,
      currentStage: "New Booking",
      isHoldingAccount: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const ctx = makeCtx("agent");
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.notes.add({ bookingId: 1, content: "secret", isInternal: true })
    ).rejects.toThrow(/FORBIDDEN|Agents cannot post internal notes/i);
  });

  it("admin can post internal notes", async () => {
    const { getBookingById, createNote } = await import("./db");
    vi.mocked(getBookingById).mockResolvedValueOnce({
      id: 1,
      agentId: 3,
      clientName: "Test Client",
      departureDate: new Date(),
      topdogRef: null,
      reimbursementsRequired: false,
      reimbursementDocUrl: null,
      reimbursementDocUploadedAt: null,
      reimbursementDocLateUpload: false,
      ptsRef: null,
      finalSupplierPaymentDate: null,
      expectedCommission: null,
      currentStage: "New Booking",
      isHoldingAccount: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(createNote).mockResolvedValueOnce({ id: 10 } as any);

    const ctx = makeCtx("admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.notes.add({ bookingId: 1, content: "internal note", isInternal: true });
    expect(result.success).toBe(true);
  });
});

// ─── Notifications tests ──────────────────────────────────────────────────────

describe("notifications", () => {
  it("unreadCount returns 0 when no notifications", async () => {
    const ctx = makeCtx("agent");
    const caller = appRouter.createCaller(ctx);
    const count = await caller.notifications.unreadCount();
    expect(count).toBe(0);
  });

  it("myNotifications returns empty array initially", async () => {
    const ctx = makeCtx("agent");
    const caller = appRouter.createCaller(ctx);
    const notifs = await caller.notifications.myNotifications();
    expect(Array.isArray(notifs)).toBe(true);
    expect(notifs.length).toBe(0);
  });
});

// ─── Reporting tests ──────────────────────────────────────────────────────────

describe("reports", () => {
  it("reports.bookings is forbidden for agents", async () => {
    const ctx = makeCtx("agent");
    const caller = appRouter.createCaller(ctx);
    await expect(caller.reports.bookings()).rejects.toThrow(/FORBIDDEN|Admin/i);
  });

  it("reports.bookings returns enriched list for admin", async () => {
    const { getAllBookings, getAllUsers } = await import("./db");
    vi.mocked(getAllBookings).mockResolvedValueOnce([
      {
        id: 1,
        agentId: 3,
        clientName: "John Doe",
        departureDate: new Date(),
        topdogRef: "TD123",
        reimbursementsRequired: false,
        reimbursementDocUrl: null,
        reimbursementDocUploadedAt: null,
        reimbursementDocLateUpload: false,
        ptsRef: "PTS456",
        finalSupplierPaymentDate: null,
        expectedCommission: null,
        currentStage: "Added to PTS",
        isHoldingAccount: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as any);
    vi.mocked(getAllUsers).mockResolvedValueOnce([
      { id: 3, name: "Agent Jane", email: "jane@jlt.test", role: "agent" } as any,
    ]);

    const ctx = makeCtx("admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.reports.bookings();
    expect(result.length).toBe(1);
    expect((result[0] as any).agentName).toBe("Agent Jane");
  });
});

// ─── Delete user tests ────────────────────────────────────────────────────────

describe("users.delete", () => {
  it("super_admin can delete another user", async () => {
    const ctx = makeCtx("super_admin");
    // ctx.user.id is 1 (from makeCtx), deleting user 99
    const caller = appRouter.createCaller(ctx);
    const result = await caller.users.delete({ userId: 99 });
    expect(result.success).toBe(true);
  });

  it("super_admin cannot delete their own account", async () => {
    const ctx = makeCtx("super_admin");
    const caller = appRouter.createCaller(ctx);
    // ctx.user.id is 1 — attempting to delete self
    await expect(caller.users.delete({ userId: 1 })).rejects.toThrow(/cannot delete your own/i);
  });

  it("admin is forbidden from deleting users", async () => {
    const ctx = makeCtx("admin");
    const caller = appRouter.createCaller(ctx);
    await expect(caller.users.delete({ userId: 99 })).rejects.toThrow(/FORBIDDEN|Super admin/i);
  });

  it("agent is forbidden from deleting users", async () => {
    const ctx = makeCtx("agent");
    const caller = appRouter.createCaller(ctx);
    await expect(caller.users.delete({ userId: 99 })).rejects.toThrow(/FORBIDDEN|Super admin/i);
  });
});

// ─── Payment date guardrail tests ─────────────────────────────────────────────

const BOOKING_WITHOUT_PAYMENT_DATE = {
  id: 1,
  agentId: 3,
  clientName: "Test Client",
  departureDate: new Date(),
  topdogRef: null,
  reimbursementsRequired: false,
  reimbursementDocUrl: null,
  reimbursementDocUploadedAt: null,
  reimbursementDocLateUpload: false,
  ptsRef: null,
  finalSupplierPaymentDate: null,
  expectedCommission: null,
  currentStage: "New Booking",
  isHoldingAccount: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const BOOKING_WITH_PAYMENT_DATE = {
  ...BOOKING_WITHOUT_PAYMENT_DATE,
  finalSupplierPaymentDate: new Date("2026-06-01"),
};

describe("bookings.moveStage payment date guardrail", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects move to 'Added to PTS' when finalSupplierPaymentDate is null", async () => {
    const { getBookingById } = await import("./db");
    vi.mocked(getBookingById).mockResolvedValueOnce(BOOKING_WITHOUT_PAYMENT_DATE as any);

    const ctx = makeCtx("admin");
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.bookings.moveStage({ bookingId: 1, toStage: "Added to PTS" })
    ).rejects.toThrow(/Final Supplier Payment Date/i);
  });

  it("rejects move to 'Commission Claimable' when finalSupplierPaymentDate is null", async () => {
    const { getBookingById } = await import("./db");
    vi.mocked(getBookingById).mockResolvedValueOnce(BOOKING_WITHOUT_PAYMENT_DATE as any);

    const ctx = makeCtx("admin");
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.bookings.moveStage({ bookingId: 1, toStage: "Commission Claimable" })
    ).rejects.toThrow(/Final Supplier Payment Date/i);
  });

  it("allows move to 'Added to PTS' when finalSupplierPaymentDate is set", async () => {
    const { getBookingById, updateBookingStage, getUserById, getNotificationTemplate, createInAppNotification, createNote } = await import("./db");
    // Use mockResolvedValueOnce multiple times to cover all getBookingById calls in the procedure
    vi.mocked(getBookingById).mockResolvedValueOnce(BOOKING_WITH_PAYMENT_DATE as any);
    vi.mocked(getBookingById).mockResolvedValueOnce(BOOKING_WITH_PAYMENT_DATE as any);
    vi.mocked(updateBookingStage).mockResolvedValueOnce({ id: 1, currentStage: "Added to PTS" } as any);
    vi.mocked(getUserById).mockResolvedValueOnce({ id: 3, name: "Agent", email: "agent@jlt.test", role: "agent" } as any);
    vi.mocked(getNotificationTemplate).mockResolvedValueOnce(null);
    vi.mocked(createInAppNotification).mockResolvedValueOnce(undefined);
    vi.mocked(createNote).mockResolvedValueOnce({ id: 99 } as any);

    const ctx = makeCtx("admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bookings.moveStage({ bookingId: 1, toStage: "Added to PTS" });
    // moveStage returns the updated booking row, not {success:true}
    expect(result).toBeTruthy();
    expect((result as any).id).toBe(1);
  });

  it("allows move to earlier stages without finalSupplierPaymentDate", async () => {
    const { getBookingById, updateBookingStage, getUserById, getNotificationTemplate, createInAppNotification, createNote } = await import("./db");
    vi.mocked(getBookingById).mockResolvedValueOnce(BOOKING_WITHOUT_PAYMENT_DATE as any);
    vi.mocked(getBookingById).mockResolvedValueOnce(BOOKING_WITHOUT_PAYMENT_DATE as any);
    vi.mocked(updateBookingStage).mockResolvedValueOnce({ id: 1, currentStage: "Query" } as any);
    vi.mocked(getUserById).mockResolvedValueOnce({ id: 3, name: "Agent", email: "agent@jlt.test", role: "agent" } as any);
    vi.mocked(getNotificationTemplate).mockResolvedValueOnce(null);
    vi.mocked(createInAppNotification).mockResolvedValueOnce(undefined);
    vi.mocked(createNote).mockResolvedValueOnce({ id: 99 } as any);

    const ctx = makeCtx("admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bookings.moveStage({ bookingId: 1, toStage: "Query" });
    // moveStage returns the updated booking row, not {success:true}
    expect(result).toBeTruthy();
    expect((result as any).id).toBe(1);
  });
});

// ─── @mention notification tests ─────────────────────────────────────────────

describe("notes @mention notifications", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sends in-app notification to mentioned admin when posting internal note", async () => {
    const { getBookingById, createNote, getAllUsers, createInAppNotification } = await import("./db");
    vi.mocked(getBookingById).mockResolvedValueOnce(BOOKING_WITHOUT_PAYMENT_DATE as any);
    vi.mocked(createNote).mockResolvedValueOnce({ id: 10 } as any);
    vi.mocked(getAllUsers).mockResolvedValueOnce([
      { id: 2, name: "Admin Alice", email: "alice@jlt.test", role: "admin" } as any,
    ]);
    vi.mocked(createInAppNotification).mockResolvedValueOnce(undefined);

    const superCtx = makeCtx("super_admin"); // id=1, mentioning Admin Alice (id=2)
    const caller = appRouter.createCaller(superCtx);
    await caller.notes.add({ bookingId: 1, content: "Hey @Admin Alice please check this", isInternal: true });

    expect(vi.mocked(createInAppNotification)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 2,
        bookingId: 1,
        message: expect.stringContaining("mentioned you"),
      })
    );
  });

  it("does not notify the author if they mention themselves", async () => {
    const { getBookingById, createNote, getAllUsers, createInAppNotification } = await import("./db");
    vi.mocked(getBookingById).mockResolvedValueOnce(BOOKING_WITHOUT_PAYMENT_DATE as any);
    vi.mocked(createNote).mockResolvedValueOnce({ id: 11 } as any);
    vi.mocked(createInAppNotification).mockResolvedValueOnce(undefined);
    // Admin (id=2) mentions themselves
    vi.mocked(getAllUsers).mockResolvedValueOnce([
      { id: 2, name: "Test admin", email: "admin@jlt.test", role: "admin" } as any,
    ]);

    const ctx = makeCtx("admin"); // id=2, name="Test admin"
    const caller = appRouter.createCaller(ctx);
    await caller.notes.add({ bookingId: 1, content: "Note to self @Test admin", isInternal: true });

    // createInAppNotification should NOT be called for the author mentioning themselves
    expect(vi.mocked(createInAppNotification)).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: 2 })
    );
  });
});

// ─── bulkImport tests ─────────────────────────────────────────────────────────
describe("bookings.bulkImport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("imports a new booking and persists grossCost", async () => {
    const { getAllBookings, getUserById, createBooking, updateBookingAdminFields, updateBookingStage, createNote } = await import("./db");
    vi.mocked(getAllBookings).mockResolvedValueOnce([]);
    vi.mocked(getUserById).mockResolvedValueOnce({ id: 3, name: "Agent", email: "agent@jlt.test", role: "agent" } as any);
    vi.mocked(createBooking).mockResolvedValueOnce({ id: 100 } as any);
    vi.mocked(updateBookingAdminFields).mockResolvedValueOnce({ id: 100 } as any);
    vi.mocked(updateBookingStage).mockResolvedValueOnce({ id: 100, currentStage: "Added to PTS" } as any);
    vi.mocked(createNote).mockResolvedValueOnce({ id: 1 } as any);
    const ctx = makeCtx("admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bookings.bulkImport([
      {
        agentId: 3,
        clientName: "Test Client",
        departureDate: new Date("2026-06-01"),
        topdogRef: "TD999",
        ptsRef: "PTS999",
        currentStage: "Added to PTS",
        reimbursementsRequired: false,
        grossCost: 1500,
        expectedCommission: 150,
      },
    ]);
    expect(result.succeeded).toBe(1);
    expect(vi.mocked(updateBookingAdminFields)).toHaveBeenCalledWith(
      100,
      expect.objectContaining({ grossCost: 1500 })
    );
  });

  it("skips duplicate booking with existing topdogRef", async () => {
    const { getAllBookings, createBooking } = await import("./db");
    vi.mocked(getAllBookings).mockResolvedValueOnce([
      { id: 1, topdogRef: "TD123", ptsRef: "PTS456" } as any,
    ]);
    const ctx = makeCtx("admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bookings.bulkImport([
      {
        agentId: 3,
        clientName: "Duplicate Client",
        departureDate: new Date("2026-06-01"),
        topdogRef: "TD123",
        reimbursementsRequired: false,
      },
    ]);
    expect(result.total).toBe(1);
    expect(result.results[0].skipped).toBe(true);
    expect(vi.mocked(createBooking)).not.toHaveBeenCalled();
  });

  it("rejects booking with invalid agentId", async () => {
    const { getAllBookings, getUserById, createBooking } = await import("./db");
    vi.mocked(getAllBookings).mockResolvedValueOnce([]);
    vi.mocked(getUserById).mockResolvedValueOnce(null);
    const ctx = makeCtx("admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bookings.bulkImport([
      {
        agentId: 9999,
        clientName: "Ghost Client",
        departureDate: new Date("2026-06-01"),
        reimbursementsRequired: false,
      },
    ]);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toBe("invalid_agent_id");
    expect(vi.mocked(createBooking)).not.toHaveBeenCalled();
  });
});
