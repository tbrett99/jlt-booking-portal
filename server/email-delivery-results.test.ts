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
  booking: vi.fn(),
  resolveRecipient: vi.fn(),
  mergeTarget: vi.fn(),
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
  getBookingById: mocks.booking,
}));
vi.mock("../drizzle/schema", () => ({ agentEmails: mocks.agentEmails }));
vi.mock("./agent-correspondence", () => ({
  resolveAgentCorrespondence: mocks.resolveRecipient,
}));
vi.mock("./agent-merge-identity", () => ({ getAgentMergeTarget: mocks.mergeTarget }));

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
  mocks.mergeTarget.mockResolvedValue(null);
  mocks.template.mockResolvedValue({
    isActive: true,
    subject: "Hello {{agentName}}",
    bodyHtml: "<p>Booking {{bookingId}}</p>",
  });
  mocks.booking.mockResolvedValue({ id: 99, crmRef: "ORBIT-99", ptsRef: "PTS-OLD", topdogRef: "TD-OTHER" });
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

describe("merged archive recipient safety (mocked, offline)", () => {
  const agentSenders = [
    ["direct", () => email.sendDirectEmail({ ...directParams, userId: 20 })],
    ["notification", () => email.sendNotificationEmail({ ...notificationParams, userId: 20 })],
    ["credentials", () => email.sendCredentialsEmail({ toEmail: directParams.toEmail, toName: directParams.toName, tempPassword: "mock-only", userId: 20 })],
    ["password reset", () => email.sendPasswordResetEmail({ toEmail: directParams.toEmail, toName: directParams.toName, resetUrl: "https://example.test/reset", userId: 20 })],
  ] as const;
  it.each(agentSenders)("blocks %s before any provider, resolver, template or audit write", async (_name, send) => {
    mocks.mergeTarget.mockResolvedValue(10);
    expect(await send()).toEqual({ success: false, error: "Recipient is a merged agent archive" });
    expect(mocks.mergeTarget).toHaveBeenCalledWith(20);
    expect(mocks.resend).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.resolveRecipient).not.toHaveBeenCalled();
    expect(mocks.template).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("does not suppress support recipient based on audit-only archived userId", async () => {
    mocks.mergeTarget.mockResolvedValue(10);
    expect(await email.sendSupportEmail({ subject: "Support", html: "<p>Staff mail</p>", auditUserId: 20 })).toMatchObject({ success: true });
    expect(mocks.mergeTarget).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls[0][0].to).toBe("support@thejltgroup.co.uk");
    expect(mocks.values.mock.calls[0][0].userId).toBe(20);
  });
  it("does not suppress frozen direct staff mail based on audit-only archived userId", async () => {
    mocks.mergeTarget.mockResolvedValue(10);
    expect(await email.sendDirectEmail({ ...directParams, toEmail: "support@example.test", auditUserId: 20, preRenderedHtml: true })).toMatchObject({ success: true });
    expect(mocks.mergeTarget).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls[0][0].to).toContain("support@example.test");
    expect(mocks.values.mock.calls[0][0].userId).toBe(20);
  });
  it("does not infer archive identity from recipient email alone", async () => {
    mocks.mergeTarget.mockResolvedValue(10);
    expect(await email.sendDirectEmail(directParams)).toMatchObject({ success: true });
    expect(mocks.mergeTarget).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  it("identity-store failure fails closed before provider calls", async () => {
    mocks.mergeTarget.mockRejectedValue(new Error("Mock permission failure"));
    await expect(email.sendDirectEmail({ ...directParams, userId: 20 })).rejects.toThrow("Mock permission failure");
    expect(mocks.resend).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("approved Orbit reference emails (mocked, offline)", () => {
  const savedLegacy = {
    isActive: true,
    subject: "Booking Added to PTS — Reference: {{ptsRef}}",
    bodyHtml: '<p>Hi {{agentName}}</p><p>Custom sign-off.</p><p>Your PTS Reference is: {{ptsRef}}</p><ul><li>Bank transfer payments: Use {{ptsRef}} as the payment reference.</li><li>PPS payment links: Use {{ptsRef}} in the Order Description.</li></ul>',
  };
  it("reads the actual booking crmRef instead of a stale caller reference, and retains PPS ptsRef", async () => {
    mocks.template.mockResolvedValue(savedLegacy);
    await email.sendNotificationEmail({ ...notificationParams, triggerKey: "added_to_pts", bookingId: 99, variables: { orbitRef: "STALE-CALLER", ptsRef: "STALE-PTS" } });
    expect(mocks.booking).toHaveBeenCalledWith(99);
    const payload = mocks.send.mock.calls[0][0];
    expect(payload.subject).toContain("ORBIT-99");
    expect(payload.subject).not.toContain("PTS-OLD");
    expect(payload.html).toContain("Bank transfer payments: Use ORBIT-99 as the payment reference");
    expect(payload.html).toContain("PPS payment links: Use PTS-OLD in the Order Description");
    expect(payload.html).toContain("Custom sign-off.");
    expect(payload.html).not.toContain("STALE-CALLER");
    expect(payload.html).not.toContain("STALE-PTS");
    expect(mocks.values.mock.calls[0][0].bodyHtml).toBe(payload.html);
  });
  it("does not give a PTS transfer reference when Orbit is missing", async () => {
    mocks.template.mockResolvedValue(savedLegacy);
    mocks.booking.mockResolvedValue({ id: 99, crmRef: "   ", ptsRef: "PTS-OLD", topdogRef: "TD-OTHER" });
    await email.sendNotificationEmail({ ...notificationParams, triggerKey: "added_to_pts", bookingId: 99 });
    const payload = mocks.send.mock.calls[0][0];
    expect(payload.subject).toContain("Not recorded");
    expect(payload.html).not.toContain("Bank transfer payments: Use");
    expect(payload.html).toContain("Do not use the PTS reference instead");
    expect(payload.html).toContain("PPS payment links: Use PTS-OLD");
    expect(payload.html).not.toContain("TD-OTHER");
  });
  it.each(["commission_claimable", "commission_claimed", "commission_due_for_payment", "commission_paid"])("adds the actual Orbit reference to existing %s templates", async triggerKey => {
    mocks.template.mockResolvedValue({ isActive: true, subject: "Commission", bodyHtml: "<p>Custom body retained</p>" });
    await email.sendNotificationEmail({ ...notificationParams, triggerKey, bookingId: 99 });
    const html = mocks.send.mock.calls[0][0].html;
    expect(html).toContain("Custom body retained");
    expect(html).toContain("Orbit reference:</strong> ORBIT-99");
    expect(html).not.toContain("PTS-OLD");
    expect(html).not.toContain("TD-OTHER");
  });
  it("upgrades explicit overrides as well as stored defaults", async () => {
    await email.sendNotificationEmail({ ...notificationParams, triggerKey: "commission_paid", bookingId: 99, overrideSubject: "Paid {{ptsRef}}", overrideBody: "<p>PTS Ref: {{ptsRef}}</p>" });
    expect(mocks.send.mock.calls[0][0].subject).toBe("Paid ORBIT-99");
    expect(mocks.send.mock.calls[0][0].html).toContain("Orbit reference: ORBIT-99");
  });
  it("preserves literal dollar sequences and escapes reference HTML", async () => {
    mocks.booking.mockResolvedValue({ id: 99, crmRef: 'ORBIT-$&-<test>', ptsRef: "PTS-OLD" });
    await email.sendNotificationEmail({ ...notificationParams, triggerKey: "commission_paid", bookingId: 99, overrideSubject: "Paid {{ptsRef}}", overrideBody: "<p>{{ptsRef}}</p>" });
    expect(mocks.send.mock.calls[0][0].subject).toBe('Paid ORBIT-$&-<test>');
    expect(mocks.send.mock.calls[0][0].html).toContain('ORBIT-$&amp;-&lt;test&gt;');
  });
  it("leaves payment receipt references unchanged and does not read a booking for that trigger", async () => {
    mocks.template.mockResolvedValue({ isActive: true, subject: "Receipt {{ptsRef}}", bodyHtml: "<p>PTS Ref: {{ptsRef}}</p>" });
    await email.sendNotificationEmail({ ...notificationParams, triggerKey: "payment_received", bookingId: 99, variables: { ptsRef: "PTS-OLD" } });
    expect(mocks.booking).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls[0][0].subject).toBe("Receipt PTS-OLD");
  });
});
