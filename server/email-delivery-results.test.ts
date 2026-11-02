import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests import only the sender under test. No real SDK, DB, env/secrets,
// correspondence resolver, or schema module is loaded, and fetch is forbidden.
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  resend: vi.fn(),
  getDb: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  paused: vi.fn(),
  template: vi.fn(),
  resolveRecipient: vi.fn(),
  agentEmails: { mockTable: "agent_emails" },
}));

vi.mock("resend", () => ({
  Resend: mocks.resend,
}));
vi.mock("./_core/env", () => ({
  ENV: { resendApiKey: "mock-only-not-a-production-key" },
}));
vi.mock("./db", () => ({
  getDb: mocks.getDb,
  areNotificationsPaused: mocks.paused,
  getNotificationTemplate: mocks.template,
}));
vi.mock("../drizzle/schema", () => ({ agentEmails: mocks.agentEmails }));
vi.mock("./agent-correspondence", () => ({
  resolveAgentCorrespondence: mocks.resolveRecipient,
}));

let email: typeof import("./email");
const directParams = {
  toEmail: "agent@example.test",
  toName: "Test Agent",
  subject: "Test subject",
  html: "<p>Test body</p>",
};
const notificationParams = {
  toEmail: directParams.toEmail,
  toName: directParams.toName,
  triggerKey: "test_notice",
};

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("Network requests are forbidden in mock-only email tests");
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.resend.mockImplementation(function () {
    return { emails: { send: mocks.send } };
  });
  mocks.send.mockResolvedValue({ data: { id: "provider-id-123" }, error: null });
  mocks.paused.mockResolvedValue(false);
  mocks.template.mockResolvedValue({
    isActive: true,
    subject: "Hello {{agentName}}",
    bodyHtml: "<p>Booking {{bookingId}}</p>",
  });
  mocks.getDb.mockResolvedValue({ insert: mocks.insert });
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockResolvedValue(undefined);
  mocks.resolveRecipient.mockResolvedValue({
    email: "resolved@example.test",
    name: "Resolved Agent",
  });
  email = await import("./email");
});

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const senders = [
  {
    name: "direct",
    toEmail: directParams.toEmail,
    triggerKey: "direct",
    send: () => email.sendDirectEmail(directParams),
  },
  {
    name: "support",
    toEmail: "support@thejltgroup.co.uk",
    triggerKey: "support",
    send: () => email.sendSupportEmail({
      subject: directParams.subject,
      html: directParams.html,
    }),
  },
  {
    name: "template notification",
    toEmail: directParams.toEmail,
    triggerKey: notificationParams.triggerKey,
    send: () => email.sendNotificationEmail(notificationParams),
  },
];

function expectAudit(status: "sent" | "failed", toEmail: string, triggerKey: string) {
  expect(mocks.insert).toHaveBeenCalledTimes(1);
  expect(mocks.insert).toHaveBeenCalledWith(mocks.agentEmails);
  expect(mocks.values).toHaveBeenCalledTimes(1);
  const [row] = mocks.values.mock.calls[0];
  expect(row).toMatchObject({ status, toEmail, triggerKey, sentAt: expect.any(Date) });
  // The existing audit schema cannot store reasons, message IDs, or delivery.
  expect(row).not.toHaveProperty("failureReason");
  expect(row).not.toHaveProperty("providerMessageId");
  expect(row).not.toHaveProperty("deliveredAt");
}

for (const sender of senders) {
  describe(`${sender.name} email provider results`, () => {
    it("reports a resolved provider rejection as failure, never sent", async () => {
      mocks.send.mockResolvedValue({
        data: null,
        error: { name: "validation_error", message: "Recipient rejected" },
      });
      expect(await sender.send()).toEqual({ success: false, error: "Recipient rejected" });
      expectAudit("failed", sender.toEmail, sender.triggerKey);
    });

    it("treats a provider error as failure even if an ID is also returned", async () => {
      mocks.send.mockResolvedValue({
        data: { id: "not-an-acceptance" },
        error: { message: "Provider rejected request" },
      });
      expect(await sender.send()).toEqual({ success: false, error: "Provider rejected request" });
      expectAudit("failed", sender.toEmail, sender.triggerKey);
    });

    it("reports a thrown SDK failure and records failed audit", async () => {
      mocks.send.mockRejectedValue(new Error("Mock transport failure"));
      expect(await sender.send()).toEqual({ success: false, error: "Mock transport failure" });
      expectAudit("failed", sender.toEmail, sender.triggerKey);
    });

    it("returns a useful error for a non-Error thrown failure", async () => {
      mocks.send.mockRejectedValue("Mock thrown string");
      expect(await sender.send()).toEqual({ success: false, error: "Mock thrown string" });
      expectAudit("failed", sender.toEmail, sender.triggerKey);
    });

    it.each([
      { data: null, error: null },
      { data: {}, error: null },
      { data: { id: "" }, error: null },
      { data: { id: "   " }, error: null },
      { data: { id: 123 }, error: null },
      undefined,
    ])("fails when provider acceptance has no usable message ID (%j)", async (response) => {
      mocks.send.mockResolvedValue(response);
      expect(await sender.send()).toEqual({
        success: false,
        error: "Email provider did not return a message ID",
      });
      expectAudit("failed", sender.toEmail, sender.triggerKey);
    });

    it("returns the accepted ID without claiming confirmed delivery", async () => {
      const result = await sender.send();
      expect(result).toEqual({ success: true, providerMessageId: "provider-id-123" });
      expect(result).not.toHaveProperty("delivered");
      expect(mocks.send).toHaveBeenCalledTimes(1);
      expectAudit("sent", sender.toEmail, sender.triggerKey);
    });

    it("honours global pause without constructing or calling the provider", async () => {
      mocks.paused.mockResolvedValue(true);
      expect(await sender.send()).toEqual({
        success: false,
        error: "Notifications are currently paused",
      });
      expect(mocks.resend).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.template).not.toHaveBeenCalled();
      expectAudit("failed", sender.toEmail, sender.triggerKey);
    });

    it("does not turn provider acceptance into failure when audit storage fails", async () => {
      mocks.values.mockRejectedValue(new Error("Mock audit failure"));
      expect(await sender.send()).toEqual({ success: true, providerMessageId: "provider-id-123" });
      expect(mocks.send).toHaveBeenCalledTimes(1);
      expect(mocks.values).toHaveBeenCalledTimes(1);
    });
  });
}

for (const sender of [
  {
    name: "direct",
    send: (idempotencyKey?: string) => email.sendDirectEmail({ ...directParams, idempotencyKey }),
  },
  {
    name: "support",
    send: (idempotencyKey?: string) => email.sendSupportEmail({
      subject: directParams.subject,
      html: directParams.html,
      idempotencyKey,
    }),
  },
]) {
  describe(`${sender.name} email idempotency`, () => {
    it("passes the caller key as the SDK's second options argument", async () => {
      await sender.send("test-request/123");
      expect(mocks.send).toHaveBeenCalledTimes(1);
      expect(mocks.send).toHaveBeenCalledWith(
        expect.objectContaining({ subject: directParams.subject, html: expect.any(String) }),
        { idempotencyKey: "test-request/123" },
      );
      expect(mocks.send.mock.calls[0][0]).not.toHaveProperty("idempotencyKey");
    });

    it("keeps calls without a key compatible and does not invent a key", async () => {
      expect(await sender.send()).toEqual({ success: true, providerMessageId: "provider-id-123" });
      expect(mocks.send.mock.calls[0][1]).toBeUndefined();
      expect(mocks.send.mock.calls[0][0]).not.toHaveProperty("idempotencyKey");
    });
  });
}

describe("recipient and template compatibility", () => {
  it("keeps direct agent resolution, footer, and audit identity intact", async () => {
    await email.sendDirectEmail({
      ...directParams,
      userId: 42,
      triggerKey: "booking_message",
      bookingId: 99,
      injectPortalFooter: true,
    });
    expect(mocks.resolveRecipient).toHaveBeenCalledTimes(1);
    expect(mocks.resolveRecipient).toHaveBeenCalledWith({
      userId: 42,
      fallbackEmail: directParams.toEmail,
      fallbackName: directParams.toName,
    });
    expect(mocks.send.mock.calls[0][0]).toMatchObject({
      to: "Resolved Agent <resolved@example.test>",
      html: expect.stringContaining("https://portal.thejltgroup.co.uk/bookings/99"),
    });
    expectAudit("sent", "resolved@example.test", "booking_message");
    expect(mocks.values.mock.calls[0][0]).toMatchObject({ userId: 42, toName: "Resolved Agent" });
  });

  it("preserves template rendering and portal footer", async () => {
    await email.sendNotificationEmail({ ...notificationParams, bookingId: 99 });
    expect(mocks.template).toHaveBeenCalledTimes(1);
    expect(mocks.template).toHaveBeenCalledWith("test_notice");
    expect(mocks.send.mock.calls[0][0]).toMatchObject({
      to: "Test Agent <agent@example.test>",
      subject: "Hello Test Agent",
      html: expect.stringContaining("Booking 99"),
    });
    expect(mocks.send.mock.calls[0][0].html).toContain("https://portal.thejltgroup.co.uk/bookings/99");
  });
});
