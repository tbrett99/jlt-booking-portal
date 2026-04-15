/**
 * Unit tests for the inbox tRPC router.
 *
 * These tests do NOT require a real IMAP server or database connection.
 * They verify the router's access-control logic and input validation
 * using in-memory mocks.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock the db helpers used by the inbox router ────────────────────────────

vi.mock("./db", async (importOriginal) => {
  const original = await importOriginal<typeof import("./db")>();
  return {
    ...original,
    getImapConfig: vi.fn().mockResolvedValue(null),
    upsertImapConfig: vi.fn().mockResolvedValue(undefined),
    getCachedEmailCount: vi.fn().mockResolvedValue(0),
    getLastImportTime: vi.fn().mockResolvedValue(null),
    createInboxAuditLog: vi.fn().mockResolvedValue(undefined),
    listInboxAuditLogs: vi.fn().mockResolvedValue([]),
  };
});

// ─── Mock the IMAP engine ─────────────────────────────────────────────────────

vi.mock("./imap", () => ({
  searchCachedEmails: vi.fn().mockResolvedValue([]),
  importInbox: vi.fn().mockResolvedValue({ imported: 0, skipped: 0, errors: 0 }),
  encryptPassword: vi.fn((p: string) => `enc:${p}`),
  decryptPassword: vi.fn((p: string) => p.replace("enc:", "")),
}));

// ─── Context helpers ──────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeUser(role: AuthenticatedUser["role"]): AuthenticatedUser {
  return {
    id: 1,
    openId: `test-${role}`,
    email: `${role}@test.com`,
    name: `Test ${role}`,
    loginMethod: "password",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

function makeCtx(role: AuthenticatedUser["role"]): TrpcContext {
  return {
    user: makeUser(role),
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("inbox.isAvailable", () => {
  it("returns true for admin users regardless of config", async () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    const result = await caller.inbox.isAvailable();
    expect(result).toBe(true);
  });

  it("returns true for super_admin users", async () => {
    const caller = appRouter.createCaller(makeCtx("super_admin"));
    const result = await caller.inbox.isAvailable();
    expect(result).toBe(true);
  });

  it("returns false for agents when no config exists", async () => {
    const { getImapConfig } = await import("./db");
    vi.mocked(getImapConfig).mockResolvedValueOnce(null);
    const caller = appRouter.createCaller(makeCtx("agent"));
    const result = await caller.inbox.isAvailable();
    expect(result).toBe(false);
  });

  it("returns false for agents when agentAccessEnabled is false", async () => {
    const { getImapConfig } = await import("./db");
    vi.mocked(getImapConfig).mockResolvedValueOnce({
      id: 1,
      host: "mail.example.com",
      port: 993,
      email: "inbox@example.com",
      passwordEncrypted: "enc:secret",
      useSsl: true,
      agentAccessEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const caller = appRouter.createCaller(makeCtx("agent"));
    const result = await caller.inbox.isAvailable();
    expect(result).toBe(false);
  });

  it("returns true for agents when agentAccessEnabled is true", async () => {
    const { getImapConfig } = await import("./db");
    vi.mocked(getImapConfig).mockResolvedValueOnce({
      id: 1,
      host: "mail.example.com",
      port: 993,
      email: "inbox@example.com",
      passwordEncrypted: "enc:secret",
      useSsl: true,
      agentAccessEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const caller = appRouter.createCaller(makeCtx("agent"));
    const result = await caller.inbox.isAvailable();
    expect(result).toBe(true);
  });
});

describe("inbox.getConfig", () => {
  it("is forbidden for agents", async () => {
    const caller = appRouter.createCaller(makeCtx("agent"));
    await expect(caller.inbox.getConfig()).rejects.toThrow();
  });

  it("returns null when no config is set", async () => {
    const { getImapConfig } = await import("./db");
    vi.mocked(getImapConfig).mockResolvedValueOnce(null);
    const caller = appRouter.createCaller(makeCtx("admin"));
    const result = await caller.inbox.getConfig();
    expect(result).toBeNull();
  });

  it("returns masked config for admins", async () => {
    const { getImapConfig } = await import("./db");
    vi.mocked(getImapConfig).mockResolvedValueOnce({
      id: 1,
      host: "mail.example.com",
      port: 993,
      email: "inbox@example.com",
      passwordEncrypted: "enc:secret",
      useSsl: true,
      agentAccessEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const caller = appRouter.createCaller(makeCtx("admin"));
    const result = await caller.inbox.getConfig();
    expect(result).not.toBeNull();
    expect(result?.host).toBe("mail.example.com");
    expect(result?.email).toBe("inbox@example.com");
    // Password must NOT be returned
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("passwordEncrypted");
  });
});

describe("inbox.importStatus", () => {
  it("is forbidden for agents", async () => {
    const caller = appRouter.createCaller(makeCtx("agent"));
    await expect(caller.inbox.importStatus()).rejects.toThrow();
  });

  it("returns zero counts when no emails are cached", async () => {
    const { getCachedEmailCount, getLastImportTime } = await import("./db");
    vi.mocked(getCachedEmailCount).mockResolvedValueOnce(0);
    vi.mocked(getLastImportTime).mockResolvedValueOnce(null);
    const caller = appRouter.createCaller(makeCtx("admin"));
    const result = await caller.inbox.importStatus();
    expect(result.cachedEmailCount).toBe(0);
    expect(result.lastImportedAt).toBeNull();
  });
});

describe("inbox.search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws FORBIDDEN for agents when access is disabled", async () => {
    const { getImapConfig } = await import("./db");
    vi.mocked(getImapConfig).mockResolvedValueOnce({
      id: 1,
      host: "mail.example.com",
      port: 993,
      email: "inbox@example.com",
      passwordEncrypted: "enc:secret",
      useSsl: true,
      agentAccessEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const caller = appRouter.createCaller(makeCtx("agent"));
    await expect(
      caller.inbox.search({ guestName: "John Smith", departureDate: "2026-06-01" })
    ).rejects.toThrow();
  });

  it("throws PRECONDITION_FAILED when no emails are cached", async () => {
    const { getImapConfig, getCachedEmailCount } = await import("./db");
    vi.mocked(getImapConfig).mockResolvedValueOnce({
      id: 1,
      host: "mail.example.com",
      port: 993,
      email: "inbox@example.com",
      passwordEncrypted: "enc:secret",
      useSsl: true,
      agentAccessEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(getCachedEmailCount).mockResolvedValueOnce(0);
    const caller = appRouter.createCaller(makeCtx("agent"));
    await expect(
      caller.inbox.search({ guestName: "John Smith", departureDate: "2026-06-01" })
    ).rejects.toThrow();
  });

  it("returns empty array when searchCachedEmails returns nothing", async () => {
    const { getImapConfig, getCachedEmailCount, createInboxAuditLog } = await import("./db");
    const { searchCachedEmails } = await import("./imap");
    vi.mocked(getImapConfig).mockResolvedValueOnce({
      id: 1,
      host: "mail.example.com",
      port: 993,
      email: "inbox@example.com",
      passwordEncrypted: "enc:secret",
      useSsl: true,
      agentAccessEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(getCachedEmailCount).mockResolvedValueOnce(50);
    vi.mocked(searchCachedEmails).mockResolvedValueOnce([]);
    vi.mocked(createInboxAuditLog).mockResolvedValueOnce(undefined);

    const caller = appRouter.createCaller(makeCtx("agent"));
    const results = await caller.inbox.search({ guestName: "John Smith", departureDate: "2026-06-01" });
    expect(results).toEqual([]);
    expect(createInboxAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ guestName: "John Smith", resultsCount: 0 })
    );
  });

  it("admins can search even when agentAccessEnabled is false", async () => {
    const { getImapConfig, getCachedEmailCount, createInboxAuditLog } = await import("./db");
    const { searchCachedEmails } = await import("./imap");
    vi.mocked(getImapConfig).mockResolvedValue({
      id: 1,
      host: "mail.example.com",
      port: 993,
      email: "inbox@example.com",
      passwordEncrypted: "enc:secret",
      useSsl: true,
      agentAccessEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(getCachedEmailCount).mockResolvedValue(10);
    vi.mocked(searchCachedEmails).mockResolvedValue([]);
    vi.mocked(createInboxAuditLog).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(makeCtx("admin"));
    const results = await caller.inbox.search({ guestName: "Jane Doe", departureDate: "2026-07-15" });
    expect(Array.isArray(results)).toBe(true);
  });
});
