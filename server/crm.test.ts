/**
 * CRM module unit tests
 * Tests the core CRM tRPC procedures: prospect management, AR form, contracts, campaigns, remittances
 */
import { describe, it, expect, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Mock the CRM DB helpers ──────────────────────────────────────────────────
vi.mock("./crm-db", () => ({
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
  getAllProspects: vi.fn().mockResolvedValue([
    { id: 1, firstName: "Jane", lastName: "Smith", email: "jane@example.com", stage: "New Enquiry", tags: ["prospect"], uniqueAgentId: null, createdAt: new Date() },
    { id: 2, firstName: "Bob", lastName: "Jones", email: "bob@example.com", stage: "Won", tags: ["agent"], uniqueAgentId: "JLT-001", createdAt: new Date() },
  ]),
  getProspectById: vi.fn().mockResolvedValue({
    id: 1, firstName: "Jane", lastName: "Smith", email: "jane@example.com",
    stage: "New Enquiry", tags: ["prospect"], uniqueAgentId: null,
    arForms: [], contracts: [], supplierLogins: [], history: [],
    createdAt: new Date(),
  }),
  createProspect: vi.fn().mockResolvedValue(42),
  updateProspect: vi.fn().mockResolvedValue(undefined),
  moveProspectStage: vi.fn().mockResolvedValue(undefined),
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
  getAllCampaigns: vi.fn().mockResolvedValue([
    { id: 1, name: "April Update", subject: "Hello agents", bodyHtml: "<p>Hi</p>", segmentType: "all_agents", status: "draft", sentCount: 0, createdAt: new Date() },
  ]),
  getCampaignById: vi.fn().mockResolvedValue({
    id: 1, name: "April Update", subject: "Hello agents", bodyHtml: "<p>Hi</p>",
    segmentType: "all_agents", status: "draft", sentCount: 0, createdAt: new Date(),
  }),
  createCampaign: vi.fn().mockResolvedValue(1),
  updateCampaign: vi.fn().mockResolvedValue(undefined),
  createCampaignSends: vi.fn().mockResolvedValue(undefined),
  getCampaignSends: vi.fn().mockResolvedValue([]),
  updateCampaignSendStatus: vi.fn().mockResolvedValue(undefined),
  getAllRemittances: vi.fn().mockResolvedValue([
    { id: 1, filename: "week1.csv", csvUrl: "https://s3.example.com/week1.csv", itemCount: 5, uploadedAt: new Date() },
  ]),
  getRemittanceById: vi.fn().mockResolvedValue({ id: 1, filename: "week1.csv", items: [] }),
  createRemittance: vi.fn().mockResolvedValue(1),
  createRemittanceItems: vi.fn().mockResolvedValue(undefined),
  getRemittanceItemsByAgent: vi.fn().mockResolvedValue([]),
  getPaymentConfig: vi.fn().mockResolvedValue({
    id: 1,
    stripeJoiningFeeUrl: "https://buy.stripe.com/test",
    businessClassDay1Url: "https://pay.gocardless.com/bc1",
    businessClassDay15Url: "https://pay.gocardless.com/bc15",
    businessClassDay28Url: "https://pay.gocardless.com/bc28",
    firstClassDay1Url: "https://pay.gocardless.com/fc1",
    firstClassDay15Url: "https://pay.gocardless.com/fc15",
    firstClassDay28Url: "https://pay.gocardless.com/fc28",
  }),
  upsertPaymentConfig: vi.fn().mockResolvedValue({ id: 1 }),
  uploadProspectDoc: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock storage ─────────────────────────────────────────────────────────────
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://cdn.example.com/file.pdf", key: "crm/test.pdf" }),
}));

// ── Mock email helpers ────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([]) }),
  }),
  getAllUsers: vi.fn().mockResolvedValue([
    { id: 1, name: "Test Admin", email: "admin@example.com", role: "admin", isActive: true },
  ]),
  getUserById: vi.fn().mockResolvedValue({ id: 1, name: "Test Admin", email: "admin@example.com", role: "admin" }),
  sendDirectEmail: vi.fn().mockResolvedValue(undefined),
  createInAppNotification: vi.fn().mockResolvedValue(undefined),
  // Other db helpers that may be called
  getBookingById: vi.fn().mockResolvedValue(null),
  getAllBookings: vi.fn().mockResolvedValue([]),
  getAmendmentsByBooking: vi.fn().mockResolvedValue([]),
  getCancellationsByBooking: vi.fn().mockResolvedValue([]),
  updateReimbursementAssignee: vi.fn().mockResolvedValue(undefined),
  markReimbursementActioned: vi.fn().mockResolvedValue(undefined),
  getPasswordResetToken: vi.fn().mockResolvedValue(null),
  markPasswordResetTokenUsed: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock auth core ────────────────────────────────────────────────────────────
vi.mock("./_core/oauth", () => ({
  OAuthClient: class {
    constructor() {}
    getLoginUrl() { return "https://login.example.com"; }
    handleCallback() { return { user: null, sessionToken: null }; }
  },
}));

// ── Context helpers ────────────────────────────────────────────────────────────
const adminCtx: TrpcContext = {
  user: { id: 1, openId: "admin-open-id", name: "Admin", email: "admin@example.com", role: "admin", isActive: true, mustChangePassword: false },
  req: {} as any,
  res: {} as any,
};

const publicCtx: TrpcContext = {
  user: null,
  req: {} as any,
  res: {} as any,
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("CRM — Prospect Management", () => {
  it("lists all prospects for admin", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.crm.prospects.list();
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(2);
  });

  it("gets a single prospect by ID", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.crm.prospects.get({ id: 1 });
    expect((result as any).firstName).toBe("Jane");
    expect((result as any).email).toBe("jane@example.com");
  });

  it("creates a new prospect", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.crm.prospects.create({
      firstName: "Alice",
      lastName: "Brown",
      email: "alice@example.com",
      phone: "07700000000",
    });
    // createProspect mock returns 42 (the new ID)
    expect(result).toBe(42);
  });

  it("moves a prospect to a new stage", async () => {
    const caller = appRouter.createCaller(adminCtx);
    // moveProspectStage mock returns undefined — just check it doesn't throw
    await expect(
      caller.crm.prospects.moveStage({ id: 1, stage: "AR Submitted", note: "Test move" })
    ).resolves.not.toThrow();
  });

  it("adds a tag to a prospect", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.crm.prospects.addTag({ prospectId: 1, tag: "prospect" });
    expect((result as any).success).toBe(true);
  });

  it("removes a tag from a prospect", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.crm.prospects.removeTag({ prospectId: 1, tag: "prospect" });
    expect((result as any).success).toBe(true);
  });
});

describe("CRM — Enquiry Form (public)", () => {
  it("submits a new enquiry and creates a prospect", async () => {
    const caller = appRouter.createCaller(publicCtx);
    const result = await caller.crm.enquiry.submit({
      firstName: "New",
      lastName: "Lead",
      email: "new@example.com",
      phone: "07700000001",
      marketingConsent: true,
    });
    expect((result as any).success).toBe(true);
  });
});

describe("CRM — AR Form", () => {
  it("submits an AR form for a prospect", async () => {
    const caller = appRouter.createCaller(publicCtx);
    const result = await caller.crm.arForm.submit({
      prospectId: 1,
      whyInterested: "I love travel",
      isSelfEmployed: "Yes — currently",
      hasTravelExperience: "Yes — in travel/tourism",
      travelExperienceDetails: "10 years in travel",
      currentJob: "Travel consultant",
      businessGoal12Months: "Build a client base",
      travelSpecialisation: "Luxury",
      weeklyHours: "20–30 hours",
      hasHomeSupport: "Yes, fully supportive",
      investmentReadiness: "Yes, absolutely",
      understandsSelfEmployed: "Yes, fully",
      biggestHesitation: "Finding clients",
      techConfidence: "Very confident",
      financialReadiness: "Stable — ready to invest",
      twoYearVision: "Full-time travel agent",
      hearAboutUs: "Google search",
      hearAboutUsDetails: "",
      lookingAtOtherAgencies: "No, JLT Group is my first choice",
      otherAgenciesDetails: "",
      confirmationAccepted: true,
    });
    expect((result as any).success).toBe(true);
  });

  it("allows admin to review an AR form", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.crm.arForm.review({
      formId: 10,
      prospectId: 1,
      reviewStatus: "approved",
      reviewNotes: "Looks good",
    });
    expect((result as any).success).toBe(true);
  });
});

describe("CRM — Campaigns", () => {
  it("lists campaigns for admin", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.crm.campaigns.list();
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[])[0].name).toBe("April Update");
  });

  it("creates a new campaign", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.crm.campaigns.create({
      name: "May Update",
      subject: "May news",
      bodyHtml: "<p>Hello</p>",
      segmentType: "all_agents",
    });
    expect((result as any).success).toBe(true);
  });

  it("updates a campaign", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.crm.campaigns.update({
      id: 1,
      name: "Updated Name",
    });
    expect((result as any).success).toBe(true);
  });
});

describe("CRM — Remittances", () => {
  it("lists remittances for admin", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.crm.remittances.list();
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[])[0].filename).toBe("week1.csv");
  });

  it("returns agent's own remittance items", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.crm.remittances.myItems();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("CRM — Payment Config", () => {
  it("gets payment config", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.crm.paymentConfig.get();
    expect((result as any).stripeJoiningFeeUrl).toBe("https://buy.stripe.com/test");
  });

  it("returns GoCardless URL for business class day 1", async () => {
    const caller = appRouter.createCaller(publicCtx);
    const result = await caller.crm.paymentConfig.getDirectDebitUrl({
      tier: "business_class",
      paymentDay: "1",
    });
    expect((result as any).url).toBe("https://pay.gocardless.com/bc1");
  });

  it("returns GoCardless URL for first class day 15", async () => {
    const caller = appRouter.createCaller(publicCtx);
    const result = await caller.crm.paymentConfig.getDirectDebitUrl({
      tier: "first_class",
      paymentDay: "15",
    });
    expect((result as any).url).toBe("https://pay.gocardless.com/fc15");
  });
});

describe("CRM — Supplier Logins", () => {
  it("adds a supplier login to a prospect", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.crm.supplierLogins.add({
      prospectId: 1,
      supplierName: "Travelport",
      username: "jsmith",
      password: "secret",
      loginUrl: "https://travelport.com/login",
      notes: "Main GDS",
    });
    expect((result as any).success).toBe(true);
  });

  it("deletes a supplier login", async () => {
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.crm.supplierLogins.delete({ id: 1 });
    expect((result as any).success).toBe(true);
  });
});
