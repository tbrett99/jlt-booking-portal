import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source-only checks: these tests never import the application, connect a database,
// call GoCardless, send mail, or run a recovery/collection operation.
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");
const routerSource = read("./routers.ts");
const dbSource = read("./gocardless-db.ts");
const issueSource = read("./membership-payment-issues-router.ts");
const crmSource = read("../client/src/pages/crm/AgentCrm.tsx");
const procedure = (name: string, nextName: string) =>
  routerSource.slice(
    routerSource.indexOf(`${name}: adminProcedure`),
    routerSource.indexOf(`${nextName}: adminProcedure`)
  );

describe("GoCardless exact mandate status and collection safety", () => {
  it("rejects unusable replacement mandates before any operational or audit write", () => {
    const source = procedure("adminLinkReplacementMandate", "adminGetPaymentSchedule");
    const guard = source.indexOf("if (!canLinkGoCardlessMandate(gcMandate.status))");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(source.indexOf("await updateGcMandate("));
    expect(guard).toBeLessThan(source.indexOf("await createGcMandateReplacement("));
    expect(source).toContain("status: parseGoCardlessMandateStatus(gcMandate.status)");
    expect(source).not.toContain('status: gcMandate.status === "active" ? "active" : "pending"');
    expect(source).not.toContain("await createSubscription(");
  });

  it("preserves provider statuses in both refresh writes rather than reviving them as pending", () => {
    const source = procedure("adminRefreshMandateStatus", "syncSubscriptions");
    expect(source).toContain("const newStatus = parseGoCardlessMandateStatus(gcMandate.status)");
    expect(source).toContain("const bestMandateStatus = parseGoCardlessMandateStatus(bestMandate.status)");
    expect(source).not.toMatch(/\?[^;\n]*:\s*["']pending["']/);
  });

  it("preserves the provider status during bulk mandate sync", () => {
    const source = routerSource.slice(routerSource.indexOf("// Update mandate statuses"));
    const mandateLoop = source.slice(0, source.indexOf("return {"));
    expect(mandateLoop).toContain("const newStatus = parseGoCardlessMandateStatus(gcM.status)");
    expect(mandateLoop).toContain(".set({ status: newStatus, updatedAt: new Date() })");
    expect(mandateLoop).not.toContain("validMandStatuses");
    expect(mandateLoop).not.toMatch(/:\s*["']pending["']/);
  });

  it("checks the actual provider mandate before creating a subscription, including manual-ID overrides", () => {
    const source = procedure("adminCreateSubscription", "adminGetMissedSubscriptions");
    const liveRead = source.indexOf("const gcMandateInfo = await getGcMandate(effectiveMandateId)");
    const liveGuard = source.indexOf("if (!canLinkGoCardlessMandate(gcMandateInfo.status))");
    const create = source.indexOf("const sub = await createSubscription(");
    expect(liveRead).toBeGreaterThan(-1);
    expect(liveGuard).toBeGreaterThan(liveRead);
    expect(create).toBeGreaterThan(liveGuard);
    expect(source.slice(liveRead, create)).not.toContain("catch");
    expect(source.slice(liveRead, create)).not.toContain("!input.mandateId");
    expect(source).toContain("!canLinkGoCardlessMandate(mandate.status) && !input.mandateId");
  });

  it("derives operational mandate write status typing from the schema without altering replacement audit typing", () => {
    const operational = dbSource.slice(dbSource.indexOf("export async function updateGcMandate("), dbSource.indexOf("export async function getAllGcMandates("));
    expect(operational).toContain('status: typeof gcMandates.$inferSelect["status"]');
    const audit = dbSource.slice(dbSource.indexOf("// ─── Mandate-replacement audit helpers"), dbSource.indexOf("// ─── Subscription helpers"));
    expect(audit).not.toContain('"consumed"');
    expect(audit).not.toContain('"blocked"');
    expect(audit).not.toContain('"suspended_by_payer"');
  });
});

describe("unusable mandate presentation and DD issue flags", () => {
  it.each(["ddIssue", "onboardingDd"])("includes unusable states in %s but not pending approval", flag => {
    const statusList = issueSource.match(new RegExp("gcMandates\\.status\\} IN \\(([^)]*)\\)\\)\\) AS " + flag));
    expect(statusList).not.toBeNull();
    for (const status of ["cancelled", "failed", "expired", "consumed", "blocked", "suspended_by_payer"])
      expect(statusList?.[1]).toContain(`'${status}'`);
    expect(statusList?.[1]).not.toContain("pending_customer_approval");
  });

  it("warns about consumed mandates in the DD tab and onboarding panel", () => {
    expect(crmSource.match(/Consumed mandate — cannot be reused\./g)).toHaveLength(2);
    expect(crmSource).toContain('mandates_consumed: "Mandate Consumed"');
  });

  it("hides both CRM subscription creation entry points and an already-open onboarding form for unusable mandates", () => {
    expect(crmSource).toContain("!subscription && canLinkGoCardlessMandate(mandate.status)");
    expect(crmSource).toContain("mandate && canLinkGoCardlessMandate(mandate.status) && !showSubForm");
    expect(crmSource).toContain("mandate && canLinkGoCardlessMandate(mandate.status) && showSubForm");
    expect(crmSource).not.toContain('mandate?.status !== "cancelled" && mandate?.status !== "expired"');
  });
});
