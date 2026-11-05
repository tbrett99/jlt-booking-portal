import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import ts from "typescript";
import { eq } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { joinSessions } from "../drizzle/schema";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb }));
import {
  hasManualJoiningFeeReceipt,
  hasManualJoiningFeeReceiptForBillingRequest,
  assertNoManuallyRecoveredJoinForEmail,
  ManualJoiningFeeReceiptError,
  type ManualJoiningFeeReceipt,
  type ManualJoiningFeeSession,
} from "./join-manual-receipt";
import { completesJoinFlow } from "./join-payment-utils";

const receipt: ManualJoiningFeeReceipt = {
  version: 1, kind: "external_manual_joining_fee", applicationId: 7001,
  userId: 8001, email: "agent@example.test", currency: "GBP", amountMinor: 69700,
  receivedDate: "2026-11-05", receivedTimePrecision: "date_only", method: "stripe_card",
  originalBillingRequestId: "BRQ_OLD", contractHash: "a".repeat(64),
  recordedAt: "2026-11-05T10:00:00.000Z", authority: "Owner confirmation in Manus on 2026-11-05",
  providerActions: "manual_link_only",
};
const session = (overrides: Partial<ManualJoiningFeeSession> = {}): ManualJoiningFeeSession => ({
  id: 7001, userId: 8001, email: "agent@example.test", billingRequestId: "BRQ_OLD",
  contractHash: "a".repeat(64), contractSignedAt: new Date("2026-11-01T12:00:00Z"),
  joiningFeePaidAt: new Date("2026-11-05T23:59:59Z"), joiningFeeManualReceipt: { ...receipt },
  ...overrides,
});

beforeEach(() => { getDb.mockReset(); });

describe("manual joining-fee receipt policy", () => {
  it.each([null, undefined])("does not suppress an absent %s marker", marker => {
    expect(hasManualJoiningFeeReceipt(session({ joiningFeeManualReceipt: marker }))).toBe(false);
  });
  it("validates the v1 signed, linked external receipt", () => {
    expect(hasManualJoiningFeeReceipt(session())).toBe(true);
  });
  it("normalizes both email identities without mutating evidence", () => {
    const evidence = { ...receipt, email: " AGENT@EXAMPLE.TEST " };
    expect(hasManualJoiningFeeReceipt(session({ email: "Agent@Example.Test", joiningFeeManualReceipt: evidence }))).toBe(true);
    expect(evidence.email).toBe(" AGENT@EXAMPLE.TEST ");
  });
  it("does not hardcode a particular application, user, email, fee or date", () => {
    const evidence = { ...receipt, applicationId: 11, userId: 22, email: "another@example.test",
      amountMinor: 12345, receivedDate: "2026-12-08", recordedAt: "2026-12-09T12:00:00Z",
      authority: "Owner confirmation in Manus on 2026-12-09" };
    expect(hasManualJoiningFeeReceipt(session({ id: 11, userId: 22, email: evidence.email,
      joiningFeePaidAt: new Date("2026-12-08T23:59:59Z"), joiningFeeManualReceipt: evidence }))).toBe(true);
  });
  it("uses the joining-fee paid date in UTC, not the timestamp's local date", () => {
    expect(hasManualJoiningFeeReceipt(session({ joiningFeePaidAt: new Date("2026-11-06T00:30:00+01:00") }))).toBe(true);
    expect(() => hasManualJoiningFeeReceipt(session({ joiningFeePaidAt: new Date("2026-11-05T23:30:00-01:00") })))
      .toThrow("receipt date mismatch");
  });
  it("accepts a null original BRQ only when the application also has no BRQ", () => {
    expect(hasManualJoiningFeeReceipt(session({ billingRequestId: null,
      joiningFeeManualReceipt: { ...receipt, originalBillingRequestId: null } }))).toBe(true);
  });
  it.each([false, true, 0, 1, "", "{broken}", [], {}])("fails closed for non-null opaque marker %j", marker => {
    expect(() => hasManualJoiningFeeReceipt(session({ userId: null, joiningFeeManualReceipt: marker })))
      .toThrow(ManualJoiningFeeReceiptError);
  });
  const invalidEvidence: Array<[string, unknown]> = [
    ["version", 2], ["kind", "gocardless"], ["currency", "EUR"], ["receivedTimePrecision", "timestamp"],
    ["method", "bank_transfer"], ["providerActions", "automatic"], ["amountMinor", 0],
    ["amountMinor", -1], ["amountMinor", 69.7], ["amountMinor", "69700"],
    ["amountMinor", Number.NaN], ["amountMinor", Number.MAX_SAFE_INTEGER + 1],
    ["receivedDate", "2026-02-30"], ["receivedDate", "2026-11-05T00:00:00Z"],
    ["recordedAt", "not-a-date"], ["recordedAt", "2026-11-05"], ["recordedAt", "2026-02-30T10:00:00Z"],
    ["authority", "unverified"], ["authority", "Owner confirmation in Manus on 2026-02-30"],
    ["applicationId", 7002], ["applicationId", "7001"], ["userId", 8002], ["userId", null],
    ["email", "other@example.test"], ["email", "invalid"], ["contractHash", "b".repeat(64)],
    ["contractHash", ""], ["originalBillingRequestId", "BRQ_NEW"], ["originalBillingRequestId", null],
    ["originalBillingRequestId", ""],
  ];
  it.each(invalidEvidence)("rejects invalid or stale evidence %s=%j", (key, value) => {
    expect(() => hasManualJoiningFeeReceipt(session({ joiningFeeManualReceipt: { ...receipt, [key]: value } })))
      .toThrow(ManualJoiningFeeReceiptError);
  });
  it.each([
    { id: 7002 }, { userId: null }, { userId: 8002 }, { email: "changed@example.test" },
    { contractSignedAt: null }, { contractSignedAt: new Date("invalid") }, { contractHash: null },
    { billingRequestId: "BRQ_NEW" }, { joiningFeePaidAt: null }, { joiningFeePaidAt: new Date("invalid") },
    { joiningFeePaidAt: new Date("2026-11-06T00:00:00Z") },
  ])("rejects changed/missing current application evidence %j", overrides => {
    expect(() => hasManualJoiningFeeReceipt(session(overrides))).toThrow(ManualJoiningFeeReceiptError);
  });
  it("exposes an explicit retryable manual-review error without automatic permission", () => {
    try { hasManualJoiningFeeReceipt(session({ joiningFeeManualReceipt: false })); }
    catch (error) {
      expect(error).toMatchObject({ code: "MANUAL_JOINING_FEE_RECEIPT_BLOCKED", statusCode: 503 });
      expect((error as Error).message).toContain("Automatic join completion and provider creation are blocked");
      return;
    }
    throw new Error("Non-null marker must throw");
  });
});

function readOnlyDb(rows: ManualJoiningFeeSession[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const db = { select, insert: vi.fn(() => { throw new Error("Forbidden insert"); }),
    update: vi.fn(() => { throw new Error("Forbidden update"); }),
    delete: vi.fn(() => { throw new Error("Forbidden delete"); }) };
  getDb.mockResolvedValue(db);
  return { db, from, where };
}

describe("read-only BRQ-scoped marker lookup", () => {
  it.each([null, undefined, ""])("does not query without a BRQ %s", async brq => {
    expect(await hasManualJoiningFeeReceiptForBillingRequest(brq)).toBe(false);
    expect(getDb).not.toHaveBeenCalled();
  });
  it("selects only by the supplied billing request, never by linked user", async () => {
    const mock = readOnlyDb([session()]);
    expect(await hasManualJoiningFeeReceiptForBillingRequest("BRQ_OLD")).toBe(true);
    expect(mock.from).toHaveBeenCalledWith(joinSessions);
    const predicate = mock.where.mock.calls[0][0];
    expect(predicate.queryChunks).toContain(joinSessions.billingRequestId);
    expect(predicate.queryChunks.some((chunk: any) => chunk?.value === "BRQ_OLD")).toBe(true);
    expect(mock.db.insert).not.toHaveBeenCalled(); expect(mock.db.update).not.toHaveBeenCalled();
    expect(mock.db.delete).not.toHaveBeenCalled();
  });
  it("returns false for an unrelated new BRQ or an ordinary join", async () => {
    readOnlyDb([]);
    expect(await hasManualJoiningFeeReceiptForBillingRequest("BRQ_NEW")).toBe(false);
    readOnlyDb([session({ joiningFeeManualReceipt: null })]);
    expect(await hasManualJoiningFeeReceiptForBillingRequest("BRQ_ORDINARY")).toBe(false);
  });
  it("checks an opaque marker even before an application has a linked user", async () => {
    readOnlyDb([session({ userId: null, joiningFeeManualReceipt: "opaque" })]);
    await expect(hasManualJoiningFeeReceiptForBillingRequest("BRQ_OLD")).rejects.toThrow(ManualJoiningFeeReceiptError);
  });
  it("checks every duplicate application rather than letting an unmarked first row hide evidence", async () => {
    readOnlyDb([session({ joiningFeeManualReceipt: null }), session()]);
    expect(await hasManualJoiningFeeReceiptForBillingRequest("BRQ_OLD")).toBe(true);
    readOnlyDb([session(), session({ joiningFeeManualReceipt: false })]);
    await expect(hasManualJoiningFeeReceiptForBillingRequest("BRQ_OLD")).rejects.toThrow(ManualJoiningFeeReceiptError);
  });
  it("fails closed when the database is unavailable", async () => {
    getDb.mockResolvedValue(null);
    await expect(hasManualJoiningFeeReceiptForBillingRequest("BRQ_OLD")).rejects.toThrow("database unavailable");
  });
  it("propagates read errors without returning automatic permission", async () => {
    getDb.mockRejectedValue(new Error("Read failed"));
    await expect(hasManualJoiningFeeReceiptForBillingRequest("BRQ_OLD")).rejects.toThrow("Read failed");
  });
});

describe("normalized-email manual-recovery retry guard", () => {
  function emailDb(rows: Array<{ id: number; joiningFeeManualReceipt: unknown }>) {
    const limit = vi.fn().mockResolvedValue(rows);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = { select, insert: vi.fn(() => { throw new Error("Forbidden insert"); }),
      update: vi.fn(() => { throw new Error("Forbidden update"); }) };
    return { db, select, from, where, limit };
  }
  const run = (mock: ReturnType<typeof emailDb>, email = " AGENT@EXAMPLE.TEST ") =>
    assertNoManuallyRecoveredJoinForEmail(mock.db as unknown as Parameters<typeof assertNoManuallyRecoveredJoinForEmail>[0], email);

  it("selects only id/marker by normalized email and non-null marker, with no writes", async () => {
    const mock = emailDb([]);
    await run(mock);
    expect(mock.select).toHaveBeenCalledWith({ id: joinSessions.id, joiningFeeManualReceipt: joinSessions.joiningFeeManualReceipt });
    expect(mock.from).toHaveBeenCalledWith(joinSessions);
    const query = new MySqlDialect().sqlToQuery(mock.where.mock.calls[0][0]);
    expect(query.sql).toContain("LOWER(TRIM(`join_sessions`.`email`))");
    expect(query.sql).toContain("`join_sessions`.`joiningFeeManualReceipt` is not null");
    expect(query.sql).not.toContain("userId");
    expect(query.params).toEqual(["agent@example.test"]);
    expect(mock.limit).toHaveBeenCalledWith(1);
    expect(mock.db.insert).not.toHaveBeenCalled(); expect(mock.db.update).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });
  it.each([receipt, false, "opaque", {}, 0])("blocks any non-null manual marker %j without validating account identity", async marker => {
    const mock = emailDb([{ id: 7001, joiningFeeManualReceipt: marker }]);
    await expect(run(mock)).rejects.toThrow("already completed externally");
    expect(mock.db.insert).not.toHaveBeenCalled(); expect(mock.db.update).not.toHaveBeenCalled();
  });
  it("allows ordinary users/unsigned retry applications when no manual marker is selected", async () => {
    await expect(run(emailDb([]))).resolves.toBeUndefined();
  });
  it("propagates a failed read rather than allowing a new provider request", async () => {
    const mock = emailDb([]);
    mock.limit.mockRejectedValue(new Error("Email evidence read failed"));
    await expect(run(mock)).rejects.toThrow("Email evidence read failed");
  });
});

const coreSource = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");
const coreAst = ts.createSourceFile("index.ts", coreSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function actualWebhookCallback(): ts.ArrowFunction {
  let callback: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(coreAst) === "app.post" &&
        ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "/api/gocardless/webhook") {
      callback = node.arguments[1] as ts.ArrowFunction;
    }
    ts.forEachChild(node, visit);
  };
  visit(coreAst);
  if (!callback) throw new Error("Actual webhook route not found");
  return callback;
}
const webhookSource = actualWebhookCallback().getText(coreAst);

type ProviderEvent = { id: string; resource_type: string; action: string; links: Record<string, string> };
function webhookHarness(options: { marked?: boolean; invalid?: boolean; localBrq?: string | null; noLocal?: boolean } = {}) {
  const order: string[] = [];
  const receive = vi.fn(async () => { order.push("durable-receipt"); });
  const enrich = vi.fn(async () => { order.push("enrich"); });
  const processOutbox = vi.fn().mockResolvedValue(undefined);
  const guard = vi.fn(async (brq: string | null | undefined) => {
    order.push(`guard:${brq ?? "none"}`);
    if (brq === "BRQ_OLD" && options.invalid) throw new ManualJoiningFeeReceiptError("invalid evidence object");
    return brq === "BRQ_OLD" && options.marked === true;
  });
  const insertMandate = vi.fn().mockResolvedValue(undefined);
  const createAgentUser = vi.fn().mockResolvedValue({ id: 8001 });
  const markWon = vi.fn().mockResolvedValue(undefined);
  const updateMandate = vi.fn().mockResolvedValue(undefined);
  const createSub = vi.fn().mockResolvedValue({ id: "SB_NEW", amount: 12345 });
  const persistSub = vi.fn().mockResolvedValue(undefined);
  const mandate = options.noLocal ? null : { id: 1, userId: 8001,
    billingRequestId: options.localBrq ?? null, joiningFeePaidAt: new Date("2026-11-05T00:00:00Z") };
  // Whitelisted modules only; importing the real index would start the server.
  const requireMock = (name: string) => {
    if (name === "crypto") return { createHmac, timingSafeEqual };
    if (name === "../membership-payment-sync") return {
      receiveMembershipProviderEvent: receive, enrichMembershipProviderEvent: enrich,
    };
    if (name === "../membership-payment-service") return { processMembershipPaymentOutbox: processOutbox };
    if (name === "../gocardless-db") return { createGcMandate: insertMandate };
    if (name === "../../drizzle/schema") return { joinSessions, agentCrmProfiles: {} };
    if (name === "drizzle-orm") return { eq };
    throw new Error(`Unexpected module import: ${name}`);
  };
  const application = { ...session(), membershipTier: "business_class", membershipType: "solo" };
  const mockDb = { select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [application] }) }) })) };
  const symbols = {
    require: requireMock,
    process: { env: { GOCARDLESS_WEBHOOK_SECRET: "offline-test-secret" } },
    Buffer, console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    hasManualJoiningFeeReceiptForBillingRequest: guard, ManualJoiningFeeReceiptError, completesJoinFlow,
    getDb: vi.fn().mockResolvedValue(mockDb), joinSessions, eq, createAgentUser,
    markRecruitmentProspectWonForPaidJoin: markWon,
    getGcMandateByBillingRequestId: vi.fn().mockResolvedValue(mandate),
    getGcMandateByMandateId: vi.fn().mockResolvedValue(mandate), updateGcMandate: updateMandate,
    getGcMandateReplacementByBillingRequestId: vi.fn().mockResolvedValue(null),
    getMandate: vi.fn().mockResolvedValue({ scheme: "bacs" }),
    getGcSubscriptionByUserId: vi.fn().mockResolvedValue(null),
    calcSubscriptionStartDate: vi.fn().mockReturnValue("2026-12-01"),
    getMonthlyAmount: vi.fn().mockReturnValue(12345), createSubscription: createSub,
    createGcSubscription: persistSub, sendSupportEmail: vi.fn().mockResolvedValue(undefined),
  };
  const compiled = ts.transpileModule(`const handler = ${webhookSource};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const handler = new Function(...Object.keys(symbols), `${compiled}\nreturn handler;`)(...Object.values(symbols));
  const run = async (events: ProviderEvent[]) => {
    const body = Buffer.from(JSON.stringify({ events }));
    const response = { headersSent: false, statusCode: 0, payload: undefined as unknown,
      status(code: number) { this.statusCode = code; return this; },
      json(value: unknown) { this.payload = value; return this; }, send(value: unknown) { this.payload = value; return this; } };
    await handler({ body, headers: { "webhook-signature": createHmac("sha256", "offline-test-secret").update(body).digest("hex") } }, response);
    return response;
  };
  return { run, order, receive, enrich, processOutbox, guard, insertMandate, createAgentUser, markWon,
    updateMandate, createSub, persistSub };
}
const event = (resource_type: string, action: string, links: Record<string, string>): ProviderEvent =>
  ({ id: `EV_${resource_type}_${action}`, resource_type, action, links });

describe("actual webhook source wiring (offline AST-extracted callback)", () => {
  it("places the upfront guard before all join account, mandate and recruitment effects", () => {
    const upfront = webhookSource.indexOf("const manualJoiningFee = await hasManualJoiningFeeReceiptForBillingRequest(event.links.billing_request)");
    expect(upfront).toBeGreaterThan(0);
    for (const effect of ["if (session.userId)", "await createAgentUser(", "await insertMandate(", "await markRecruitmentProspectWonForPaidJoin("])
      expect(webhookSource.indexOf(effect)).toBeGreaterThan(upfront);
    expect(webhookSource).toContain("if (!manualJoiningFee && completesJoinFlow(");
  });
  it("keeps the activation guard before recovery's swallowing catch and subscription creation", () => {
    const active = webhookSource.slice(webhookSource.indexOf('// Mandate became active'));
    const guard = active.indexOf("if (manualJoiningFee || await hasManualJoiningFeeReceiptForBillingRequest(localMandate?.billingRequestId))");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(active.indexOf("try {"));
    expect(guard).toBeLessThan(active.indexOf("await insertMandate("));
    expect(guard).toBeLessThan(active.indexOf("await createSubscription("));
    expect(webhookSource).toContain("res.status(503).json({ error: err.message, code: err.code })");
  });
  it.each(["fulfilled", "confirmed"])("bypasses old %s joining effects without skipping canonical payments", async action => {
    const harness = webhookHarness({ marked: true });
    const resource = action === "confirmed" ? "payments" : "billing_requests";
    const response = await harness.run([event(resource, action, { billing_request: "BRQ_OLD", payment: "PM_REAL" })]);
    expect(response.statusCode).toBe(200);
    expect(harness.insertMandate).not.toHaveBeenCalled(); expect(harness.createAgentUser).not.toHaveBeenCalled();
    expect(harness.markWon).not.toHaveBeenCalled(); expect(harness.createSub).not.toHaveBeenCalled();
    if (resource === "payments") {
      expect(harness.receive).toHaveBeenCalledOnce(); expect(harness.enrich).toHaveBeenCalledOnce();
      expect(harness.processOutbox).toHaveBeenCalledWith(10);
      expect(harness.order).toEqual(["durable-receipt", "guard:BRQ_OLD", "enrich"]);
    }
  });
  it.each(["created", "pending_submission", "submitted", "confirmed", "paid_out", "failed", "cancelled"])(
    "retains genuine %s canonical payment evidence and effects for a marked old BRQ", async action => {
      const harness = webhookHarness({ marked: true });
      expect((await harness.run([event("payments", action, { billing_request: "BRQ_OLD", payment: "PM_REAL" })])).statusCode).toBe(200);
      expect(harness.receive).toHaveBeenCalledOnce(); expect(harness.enrich).toHaveBeenCalledOnce();
      expect(harness.insertMandate).not.toHaveBeenCalled(); expect(harness.markWon).not.toHaveBeenCalled();
    }
  );
  it("makes the first confirmed payment durable before a malformed marker returns 503", async () => {
    const harness = webhookHarness({ invalid: true, noLocal: true });
    const response = await harness.run([event("payments", "confirmed", { billing_request: "BRQ_OLD", payment: "PM_REAL" })]);
    expect(response.statusCode).toBe(503);
    expect(response.payload).toMatchObject({ code: "MANUAL_JOINING_FEE_RECEIPT_BLOCKED" });
    expect(harness.order).toEqual(["durable-receipt", "guard:BRQ_OLD"]);
    expect(harness.receive).toHaveBeenCalledOnce(); expect(harness.insertMandate).not.toHaveBeenCalled();
    expect(harness.createAgentUser).not.toHaveBeenCalled(); expect(harness.markWon).not.toHaveBeenCalled();
  });
  it.each([false, true])("blocks old mandates.active before recovery/creation (missing row=%s)", async noLocal => {
    const harness = webhookHarness({ marked: true, noLocal });
    expect((await harness.run([event("mandates", "active", { mandate: "MD_OLD", billing_request: "BRQ_OLD" })])).statusCode).toBe(200);
    expect(harness.insertMandate).not.toHaveBeenCalled(); expect(harness.updateMandate).not.toHaveBeenCalled();
    expect(harness.createSub).not.toHaveBeenCalled(); expect(harness.persistSub).not.toHaveBeenCalled();
  });
  it("blocks an old local mandate's BRQ when the active event omits its BRQ", async () => {
    const harness = webhookHarness({ marked: true, localBrq: "BRQ_OLD" });
    expect((await harness.run([event("mandates", "active", { mandate: "MD_OLD" })])).statusCode).toBe(200);
    expect(harness.guard.mock.calls).toEqual([[undefined], ["BRQ_OLD"]]);
    expect(harness.createSub).not.toHaveBeenCalled(); expect(harness.updateMandate).not.toHaveBeenCalled();
  });
  it.each([false, true])("propagates malformed active evidence outside recovery's catch (local BRQ=%s)", async localOnly => {
    const harness = webhookHarness({ invalid: true, localBrq: localOnly ? "BRQ_OLD" : null, noLocal: !localOnly });
    const response = await harness.run([event("mandates", "active", { mandate: "MD_OLD", ...(localOnly ? {} : { billing_request: "BRQ_OLD" }) })]);
    expect(response.statusCode).toBe(503);
    expect(harness.insertMandate).not.toHaveBeenCalled(); expect(harness.createSub).not.toHaveBeenCalled();
  });
  it.each([null, "BRQ_NEW"])("leaves a later manually linked mandate with BRQ %s on its normal path", async localBrq => {
    const harness = webhookHarness({ marked: true, localBrq });
    expect((await harness.run([event("mandates", "active", { mandate: "MD_MANUALLY_LINKED" })])).statusCode).toBe(200);
    expect(harness.updateMandate).toHaveBeenCalledWith(1, { mandateId: "MD_MANUALLY_LINKED", status: "active" });
    expect(harness.createSub).toHaveBeenCalledOnce(); expect(harness.persistSub).toHaveBeenCalledOnce();
    expect(harness.insertMandate).not.toHaveBeenCalled();
  });
  it("retains linked-user mandate recovery for an unmarked ordinary BRQ", async () => {
    const harness = webhookHarness({ noLocal: true });
    expect((await harness.run([event("billing_requests", "fulfilled", { billing_request: "BRQ_ORDINARY" })])).statusCode).toBe(200);
    expect(harness.insertMandate).toHaveBeenCalledOnce(); expect(harness.markWon).toHaveBeenCalledWith("agent@example.test", 8001);
    expect(harness.createAgentUser).not.toHaveBeenCalled();
  });
});
