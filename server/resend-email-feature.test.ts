/**
 * Resend Email Feature — unit tests
 * Tests the crm.agentEmailLog.resend procedure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  }),
  getAllUsers: vi.fn().mockResolvedValue([
    { id: 20, name: "Kirsty Mays", email: "kirsty@example.com", role: "agent", isActive: true },
    { id: 21, name: "Jane Smith", email: "jane@example.com", role: "agent", isActive: true },
  ]),
  getUserById: vi.fn().mockResolvedValue(null),
  getNotificationTemplate: vi.fn().mockResolvedValue(null),
  areNotificationsPaused: vi.fn().mockResolvedValue(false),
  createInAppNotification: vi.fn().mockResolvedValue(undefined),
  getBookingById: vi.fn().mockResolvedValue(null),
  getAllBookings: vi.fn().mockResolvedValue([]),
  getAmendmentsByBooking: vi.fn().mockResolvedValue([]),
  getCancellationsByBooking: vi.fn().mockResolvedValue([]),
  updateReimbursementAssignee: vi.fn().mockResolvedValue(undefined),
  markReimbursementActioned: vi.fn().mockResolvedValue(undefined),
  getPasswordResetToken: vi.fn().mockResolvedValue(null),
  markPasswordResetTokenUsed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./email", () => ({
  sendDirectEmail: vi.fn().mockResolvedValue({ success: true }),
  sendNotificationEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("./crm-db", () => ({
  getAgentEmailLog: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  getAgentCrmProfile: vi.fn().mockResolvedValue(null),
  listAgentsWithCrm: vi.fn().mockResolvedValue([]),
  getAgentTags: vi.fn().mockResolvedValue([]),
  getAllProspects: vi.fn().mockResolvedValue([]),
  getProspectById: vi.fn().mockResolvedValue(null),
  createProspect: vi.fn().mockResolvedValue(1),
  updateProspect: vi.fn().mockResolvedValue(undefined),
  moveProspectStage: vi.fn().mockResolvedValue(undefined),
  getProspectByEmail: vi.fn().mockResolvedValue(null),
  deleteProspect: vi.fn().mockResolvedValue(undefined),
  getProspectPipelineHistory: vi.fn().mockResolvedValue([]),
  getProspectTags: vi.fn().mockResolvedValue([]),
  addProspectTag: vi.fn().mockResolvedValue(undefined),
  removeProspectTag: vi.fn().mockResolvedValue(undefined),
  getLatestArForm: vi.fn().mockResolvedValue(null),
  updateSupplierLogin: vi.fn().mockResolvedValue(undefined),
  getActiveContractTemplate: vi.fn().mockResolvedValue(null),
  createProspectContract: vi.fn().mockResolvedValue(5),
  getRemittanceItems: vi.fn().mockResolvedValue([]),
  markRemittanceNotificationSent: vi.fn().mockResolvedValue(undefined),
  generateUniqueAgentId: vi.fn().mockResolvedValue("JLT-042"),
  uploadProspectDoc: vi.fn().mockResolvedValue(undefined),
  getAllCampaigns: vi.fn().mockResolvedValue([]),
  getCampaignById: vi.fn().mockResolvedValue(null),
  createCampaign: vi.fn().mockResolvedValue(1),
  updateCampaign: vi.fn().mockResolvedValue(undefined),
  createCampaignSends: vi.fn().mockResolvedValue(undefined),
  getCampaignSends: vi.fn().mockResolvedValue([]),
  updateCampaignSendStatus: vi.fn().mockResolvedValue(undefined),
  getAllRemittances: vi.fn().mockResolvedValue([]),
  getRemittanceById: vi.fn().mockResolvedValue(null),
  createRemittance: vi.fn().mockResolvedValue(1),
  createRemittanceItems: vi.fn().mockResolvedValue(undefined),
  getRemittanceItemsByAgent: vi.fn().mockResolvedValue([]),
  getPaymentConfig: vi.fn().mockResolvedValue(null),
  upsertPaymentConfig: vi.fn().mockResolvedValue({ id: 1 }),
  addTagToProspect: vi.fn().mockResolvedValue(undefined),
  removeTagFromProspect: vi.fn().mockResolvedValue(undefined),
  getArFormsByProspect: vi.fn().mockResolvedValue([]),
  createArForm: vi.fn().mockResolvedValue(10),
  reviewArForm: vi.fn().mockResolvedValue(undefined),
  getContractsByProspect: vi.fn().mockResolvedValue([]),
  getContractByToken: vi.fn().mockResolvedValue(null),
  createContract: vi.fn().mockResolvedValue(5),
  signContract: vi.fn().mockResolvedValue(undefined),
  markContractSent: vi.fn().mockResolvedValue(undefined),
  getAllContractTemplates: vi.fn().mockResolvedValue([]),
  createContractTemplate: vi.fn().mockResolvedValue(1),
  getSupplierLoginsByProspect: vi.fn().mockResolvedValue([]),
  addSupplierLogin: vi.fn().mockResolvedValue(1),
  deleteSupplierLogin: vi.fn().mockResolvedValue(undefined),
  getCampaignRecipients: vi.fn().mockResolvedValue([]),
  enqueueCampaignRecipients: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./_core/oauth", () => ({
  OAuthClient: class {
    constructor() {}
    getLoginUrl() { return "https://login.example.com"; }
    handleCallback() { return { user: null, sessionToken: null }; }
  },
}));

vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://cdn.example.com/file.pdf", key: "test.pdf" }),
}));

// ── Context helpers ───────────────────────────────────────────────────────────
const adminCtx: TrpcContext = {
  user: { id: 1, openId: "admin-open-id", name: "Admin", email: "admin@example.com", role: "admin", isActive: true, mustChangePassword: false },
  req: {} as any,
  res: {} as any,
};

const agentCtx: TrpcContext = {
  user: { id: 20, openId: "agent-open-id", name: "Kirsty Mays", email: "kirsty@example.com", role: "agent", isActive: true, mustChangePassword: false },
  req: {} as any,
  res: {} as any,
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("Resend Email Feature — agentEmailLog.resend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects resend for non-admin users (agents cannot resend)", async () => {
    const caller = appRouter.createCaller(agentCtx);
    await expect(
      caller.crm.agentEmailLog.resend({
        sourceEmailId: 1,
        recipientUserIds: [20],
      })
    ).rejects.toThrow();
  });

  it("rejects resend with empty recipient list (Zod min(1))", async () => {
    const caller = appRouter.createCaller(adminCtx);
    await expect(
      caller.crm.agentEmailLog.resend({
        sourceEmailId: 1,
        recipientUserIds: [],
      })
    ).rejects.toThrow();
  });

  it("rejects resend with more than 100 recipients (Zod max(100))", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const tooMany = Array.from({ length: 101 }, (_, i) => i + 1);
    await expect(
      caller.crm.agentEmailLog.resend({
        sourceEmailId: 1,
        recipientUserIds: tooMany,
      })
    ).rejects.toThrow();
  });

  it("agentEmailLog.list is accessible to admins and returns rows + total", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.crm.agentEmailLog.list({});
    expect(result).toHaveProperty("rows");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it("agentEmailLog.list is rejected for non-admin users", async () => {
    const caller = appRouter.createCaller(agentCtx);
    await expect(caller.crm.agentEmailLog.list({})).rejects.toThrow();
  });

  it("agentEmailLog.getBody is rejected for non-admin users", async () => {
    const caller = appRouter.createCaller(agentCtx);
    await expect(caller.crm.agentEmailLog.getBody({ id: 1 })).rejects.toThrow();
  });
});
