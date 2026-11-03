import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

const mocks = vi.hoisted(() => ({
  send: vi.fn(), resend: vi.fn(), getDb: vi.fn(), select: vi.fn(),
  insert: vi.fn(), update: vi.fn(), mergeTarget: vi.fn(), resolve: vi.fn(),
  branding: vi.fn(), results: [] as any[][],
}));
vi.mock("resend", () => ({ Resend: mocks.resend }));
vi.mock("./_core/env", () => ({ ENV: { resendApiKey: "offline-only-fake-key" } }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./crm-db", () => ({ getEmailBrandingSettings: mocks.branding }));
vi.mock("./recruitment-db", () => ({
  encodeApplicationToken: vi.fn(), extractApplicationToken: vi.fn(),
  getRecruitmentProspectById: vi.fn(), updateRecruitmentProspect: vi.fn(),
}));
vi.mock("./agent-correspondence", () => ({ resolveAgentCorrespondence: mocks.resolve }));
vi.mock("./agent-merge-identity", () => ({ getAgentMergeTarget: mocks.mergeTarget }));
let email: typeof import("./resend-email");
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in offline tests"); }));
  mocks.mergeTarget.mockResolvedValue(10);
  mocks.getDb.mockResolvedValue({ select: mocks.select, insert: mocks.insert, update: mocks.update });
  mocks.select.mockImplementation(() => {
    const rows = mocks.results.shift() ?? [];
    const chain: any = {};
    for (const method of ["from", "where", "limit"]) chain[method] = () => chain;
    chain.then = (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  });
  email = await import("./resend-email");
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const params = {
  to: "source@example.test", toName: "Source", subject: "Campaign", bodyHtml: "<p>Hi</p>",
  audienceType: "agent" as const, recipientType: "agent" as const,
  recipientId: 20, baseUrl: "https://example.test",
};

describe("archived marketing recipient guards", () => {
  it("blocks agent drip/direct marketing before queued-row, provider, resolver or audit effects", async () => {
    expect(await email.sendMarketingEmail({ ...params, dripStepId: 9 })).toEqual({ sendId: 0, success: false, error: "Recipient is a merged agent archive" });
    expect(mocks.mergeTarget).toHaveBeenCalledWith(20);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.resend).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each(["queued", "failed", "sent"])("skips archived %s campaign rows, including exact retry IDs, without rewriting original evidence", async (status) => {
    mocks.results = [
      [{ id: 99, campaignId: 7, recipientType: "agent", recipientId: 20, recipientEmail: params.to, recipientName: "Source", status }],
      [{ id: 7, audienceType: "agent", subject: "Campaign", bodyHtml: "<p>Hi</p>" }],
      [{ id: 99 }],
    ];
    expect(await email.processCampaignQueue(50, [99])).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(mocks.mergeTarget).toHaveBeenCalledWith(20);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.branding).not.toHaveBeenCalled();
    expect(mocks.resend).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not mistake prospect IDs for archived agent IDs", async () => {
    mocks.results = [
      [{ id: 99, campaignId: 7, recipientType: "prospect", recipientId: 20, recipientEmail: params.to, status: "failed" }],
      [{ id: 7, audienceType: "prospect", subject: "Campaign", bodyHtml: "<p>Hi</p>" }],
      [{ unsubscribedAt: new Date() }],
      [{ id: 99 }],
    ];
    const where = vi.fn().mockResolvedValue(undefined);
    mocks.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where }) });
    expect(await email.processCampaignQueue(50, [99])).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(mocks.mergeTarget).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("fails closed on identity table permission errors", async () => {
    mocks.mergeTarget.mockRejectedValue(new Error("offline identity store failure"));
    await expect(email.sendMarketingEmail(params)).rejects.toThrow("offline identity store failure");
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("raw route guard wiring (source-only, no router/service execution)", () => {
  const read = (name: string) => fs.readFileSync(new URL(name, import.meta.url), "utf8");
  it("blocks raw generic portal/CRM toggles before database access", () => {
    const source = read("./routers.ts");
    for (const route of ["toggleCrmAccess", "setPortalStatus"]) {
      const block = source.slice(source.indexOf(`    ${route}:`), source.indexOf("return { success: true };", source.indexOf(`    ${route}:`)));
      expect(block).toContain("await assertAgentNotMerged(input.userId);");
      expect(block.indexOf("assertAgentNotMerged")).toBeLessThan(block.indexOf("getDb"));
    }
    expect(source).toContain("const user = await getUserForLoginByEmail(input.email);");
    expect(source).toContain("const existing = await getUserByEmail(input.email);");
  });
  it("gates direct CRM status/archive deletion and profile write paths", () => {
    const source = read("./crm-router.ts");
    for (const route of ["updateAgentStatus", "deleteNewSignUp"]) {
      const block = source.slice(source.indexOf(`    ${route}:`));
      expect(block.indexOf("assertAgentNotMerged(input.userId)")).toBeLessThan(block.indexOf("getDb"));
    }
    expect(source).toContain("await assertAgentNotMerged(req.userId);");
    expect(source).toContain("await assertAgentNotMerged(ctx.user.id);");
  });
  it("gates old join password session and SSO redemption before token/user writes", () => {
    expect(read("./join-router.ts")).toContain("await assertAgentNotMerged(session.userId);");
    const external = read("./external-api.ts");
    expect(external.indexOf("getAgentMergeTarget(record.userId)")).toBeLessThan(external.indexOf("db.update(ssoTokens)"));
    expect(external).not.toContain("agent.id =");
  });
});
