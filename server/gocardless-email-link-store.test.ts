import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { agentCrmNotes, agentCrmProfiles, gcMandates, gcSubscriptions, users } from "../drizzle/schema";
vi.mock("./db", () => ({ getRawDbPool: vi.fn(() => { throw new Error("Live DB must not be used in this suite"); }) }));
import { mirrorGoCardlessEmailLink, type EmailLinkMirror } from "./gocardless-email-link-store";

const agent = { id: 9001, name: "Test Agent", email: "agent@example.test", role: "agent" };
const actor = { id: 47, name: "Test Staff" };
const selection: EmailLinkMirror = {
  email: "agent@example.test", customer: { id: "CU_EXISTING" },
  mandate: { id: "MD_EXISTING", status: "active" },
  subscription: { id: "SB_EXISTING", status: "active", amount: 10200, currency: "EUR",
    start_date: "2026-07-01", day_of_month: 1, links: { mandate: "MD_EXISTING" },
    upcoming_payments: [{ charge_date: "2026-12-01", amount: 10200 }] },
};
const oldDate = new Date("2026-01-01T00:00:00Z");
type State = { agent: any; profile: any; mandates: any[]; subs: any[]; notes: any[]; portalStatus: string; arrears: number };
let state: State;
let failTable: unknown;
let locks: unknown[];
let calls: Array<{ kind: string; table: unknown; value?: any }>;
let duplicateAccount: any;
function db() {
  const records = (table: unknown) => table === users ? [state.agent, ...(duplicateAccount ? [duplicateAccount] : [])] : table === agentCrmProfiles ? [state.profile] :
    table === gcMandates ? state.mandates : table === gcSubscriptions ? state.subs : [];
  const tx = {
    select: vi.fn(() => ({ from: (table: unknown) => ({ where: () => ({ for: async (mode: string) => {
      expect(mode).toBe("update"); locks.push(table); return structuredClone(records(table));
    } }) }) })),
    insert: (table: unknown) => ({ values: async (value: any) => {
      calls.push({ kind: "insert", table, value });
      if (table === failTable) throw new Error("Simulated database write failure");
      const rows = table === gcMandates ? state.mandates : table === gcSubscriptions ? state.subs : table === agentCrmNotes ? state.notes : null;
      if (!rows) throw new Error("Unexpected write target");
      rows.push({ id: rows.length + 100, ...structuredClone(value) });
    } }),
    update: (table: unknown) => ({ set: (value: any) => ({ where: async () => {
      calls.push({ kind: "update", table, value });
      if (table === failTable) throw new Error("Simulated database write failure");
      const rows = table === gcMandates ? state.mandates : state.subs;
      const idKey = table === gcMandates ? "mandateId" : "subscriptionId";
      const ref = table === gcMandates ? selection.mandate.id : selection.subscription!.id;
      for (const row of rows) if (row.userId === agent.id && row[idKey] === ref) Object.assign(row, structuredClone(value));
    } }) }),
  };
  return { transaction: vi.fn(async (work: (transaction: any) => Promise<unknown>) => {
    const snapshot = structuredClone(state);
    try { return await work(tx); } catch (error) { state = snapshot; throw error; }
  }) };
}
const run = (value = selection, usesLoginEmail = true) => mirrorGoCardlessEmailLink(agent, value, actor, { usesLoginEmail, db: db() });
beforeEach(() => {
  state = { agent: { ...agent }, profile: { agentStatus: "active" }, mandates: [], subs: [], notes: [], portalStatus: "suspended", arrears: 8700 };
  failTable = undefined; locks = []; calls = [];
  duplicateAccount = undefined;
});
describe("GoCardless existing-reference mirror", () => {
  it("mirrors the single existing EUR setup without fabricating a new fee, date or provider request", async () => {
    const historical = { id: 10, userId: 9001, mandateId: "MD_OLD", status: "cancelled", joiningFeePaidAt: oldDate, createdAt: oldDate };
    state.mandates.push(historical);
    state.subs.push({ id: 11, userId: 9001, mandateId: "MD_OLD", subscriptionId: "SB_OLD", status: "cancelled" });
    const result = await run();
    expect(result).toMatchObject({ success: true, gcCustomerId: "CU_EXISTING", subscriptionId: "SB_EXISTING", mandatesFound: 1 });
    expect(state.mandates[0]).toEqual(historical);
    expect(state.mandates[1]).toMatchObject({ userId: 9001, mandateId: "MD_EXISTING", status: "active", preferredPaymentDay: 1 });
    expect(state.mandates[1]).not.toHaveProperty("joiningFeePaidAt");
    expect(state.mandates[1]).not.toHaveProperty("billingRequestId");
    expect(state.subs[1]).toMatchObject({ userId: 9001, mandateId: "MD_EXISTING", subscriptionId: "SB_EXISTING", amount: 10200, currency: "EUR", startDate: "2026-07-01", nextChargeDate: "2026-12-01" });
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0]).toMatchObject({ agentUserId: 9001, authorId: 47 });
    expect(state.notes[0].content).toContain("EUR 102.00");
    expect(locks).toEqual([users, agentCrmProfiles, gcMandates, gcSubscriptions]);
    expect(state.portalStatus).toBe("suspended"); expect(state.arrears).toBe(8700);
  });
  it("repeated staff linking refreshes the same own references without duplicate mandates or subscriptions", async () => {
    await run(); await run();
    expect(state.mandates).toHaveLength(1); expect(state.subs).toHaveLength(1);
    expect(calls.filter(c => c.kind === "update").every(c => !Object.hasOwn(c.value, "userId"))).toBe(true);
  });
  it.each([9999, null])("rejects an existing mandate owner %s, never reassigning the record", async owner => {
    state.mandates.push({ id: 1, userId: owner, mandateId: "MD_EXISTING", status: "active", createdAt: oldDate });
    await expect(run()).rejects.toThrow("already linked to another or unverified");
    expect(calls).toEqual([]); expect(state.mandates[0].userId).toBe(owner);
  });
  it("checks every duplicate reference row, including a conflicting second owner", async () => {
    state.mandates.push({ id: 1, userId: 9001, mandateId: "MD_EXISTING", status: "active", createdAt: oldDate },
      { id: 2, userId: 9999, mandateId: "MD_EXISTING", status: "active", createdAt: oldDate });
    await expect(run()).rejects.toThrow("ownership"); expect(calls).toEqual([]);
  });
  it.each([9999, null])("rejects a subscription owner %s before any mandate insert", async owner => {
    state.subs.push({ id: 1, userId: owner, mandateId: "MD_EXISTING", subscriptionId: "SB_EXISTING", status: "active" });
    await expect(run()).rejects.toThrow("already linked to another or unverified"); expect(calls).toEqual([]);
  });
  it("blocks a different local mandate on the same subscription ID", async () => {
    state.subs.push({ id: 1, userId: 9001, mandateId: "MD_OTHER", subscriptionId: "SB_EXISTING", status: "active" });
    await expect(run()).rejects.toThrow("different mandate reference"); expect(calls).toEqual([]);
  });
  it.each(["active", "submitted", "pending_submission", "pending"])("blocks a second %s local mandate", async status => {
    state.mandates.push({ id: 1, userId: 9001, mandateId: "MD_OTHER", status, createdAt: oldDate });
    await expect(run()).rejects.toThrow("Use Replace mandate"); expect(calls).toEqual([]);
  });
  it.each(["active", "paused"])("blocks a second %s subscription without changing current records", async status => {
    state.subs.push({ id: 1, userId: 9001, mandateId: "MD_OTHER", subscriptionId: "SB_OTHER", status });
    await expect(run()).rejects.toThrow("different ongoing subscription"); expect(calls).toEqual([]);
  });
  it("holds an older locally stored mandate when a newer historical current record exists", async () => {
    state.mandates.push({ id: 1, userId: 9001, mandateId: "MD_EXISTING", status: "cancelled", createdAt: oldDate },
      { id: 2, userId: 9001, mandateId: "MD_NEWER", status: "cancelled", createdAt: new Date("2026-02-01") });
    await expect(run()).rejects.toThrow("newer mandate record"); expect(calls).toEqual([]);
  });
  it("stores a real paused subscription as paused, not active", async () => {
    await run({ ...selection, subscription: { ...selection.subscription!, status: "paused" } });
    expect(state.subs[0].status).toBe("paused");
  });
  it("allows a verified mandate-only result without creating a subscription", async () => {
    await run({ ...selection, subscription: null });
    expect(state.mandates).toHaveLength(1); expect(state.subs).toHaveLength(0);
  });
  it("rolls back the mandate when a subsequent subscription insert fails", async () => {
    failTable = gcSubscriptions;
    await expect(run()).rejects.toThrow("Simulated");
    expect(state.mandates).toEqual([]); expect(state.subs).toEqual([]); expect(state.notes).toEqual([]);
  });
  it("rolls back both local mirrors if the mandatory CRM audit entry fails", async () => {
    failTable = agentCrmNotes;
    await expect(run()).rejects.toThrow("Simulated");
    expect(state.mandates).toEqual([]); expect(state.subs).toEqual([]);
  });
  it("refuses a stale login-email lookup after the agent email changed", async () => {
    state.agent.email = "changed@example.test";
    await expect(run()).rejects.toThrow("email changed"); expect(calls).toEqual([]);
  });
  it("holds an exact email shared with another Portal record rather than choosing an owner", async () => {
    duplicateAccount = { ...agent, id: 9999 };
    await expect(run()).rejects.toThrow("duplicate identity"); expect(calls).toEqual([]);
  });
  it("does not fabricate a subscription start date when the provider omitted it", async () => {
    await expect(run({ ...selection, subscription: { ...selection.subscription!, start_date: null } })).rejects.toThrow("original subscription start date");
    expect(calls).toEqual([]);
  });
  it("honours an explicitly entered different provider email without changing the login email", async () => {
    await run({ ...selection, email: "provider@example.test" }, false);
    expect(state.agent.email).toBe("agent@example.test");
  });
  it("refuses a non-agent account", async () => {
    state.agent.role = "admin";
    await expect(run()).rejects.toThrow("no longer an agent"); expect(calls).toEqual([]);
  });
  it.each(["cancelled", "left", "departed"])("refuses an explicitly %s membership", async status => {
    state.profile.agentStatus = status;
    await expect(run()).rejects.toThrow("membership has been cancelled"); expect(calls).toEqual([]);
  });
  it.each(["suspended", "paused", "in_notice"])("allows DD remediation for %s without changing account access", async status => {
    state.profile.agentStatus = status;
    await run(); expect(state.profile.agentStatus).toBe(status); expect(state.portalStatus).toBe("suspended");
  });
  it("uses the guarded existing-reference route and actual subscription currency in CRM", () => {
    const router = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    const block = router.slice(router.indexOf("    linkByEmail: adminProcedure"), router.indexOf("    sendReceipt:", router.indexOf("    linkByEmail: adminProcedure")));
    expect(block).toContain("lookupGoCardlessEmailLink"); expect(block).toContain("mirrorGoCardlessEmailLink");
    expect(block).not.toContain("gcCustomers.find"); expect(block).not.toContain(".set({ userId:");
    expect(block).toContain("method: 'GET'");
    expect(block).not.toContain("db: dbInst");
    const bulk = router.slice(router.indexOf("    reconcileUnlinked: adminProcedure"), router.indexOf("    linkByEmail: adminProcedure"));
    expect(bulk).toContain("selectGoCardlessEmailLink"); expect(bulk).toContain("mirrorGoCardlessEmailLink");
    expect(bulk).not.toContain(".set({ userId:"); expect(bulk).not.toContain("customerByEmail[email]");
    const ui = readFileSync(new URL("../client/src/pages/crm/AgentCrm.tsx", import.meta.url), "utf8");
    expect(ui).toContain("Checks all exact-email GoCardless customer records.");
    expect(ui).toContain('currency: subscription.currency || "GBP"');
    expect(ui).not.toContain('£{(subscription.amount / 100).toFixed(2)} / month');
  });
});
