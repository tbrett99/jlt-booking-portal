import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), histories: vi.fn(), execute: vi.fn(), select: vi.fn(), records: [] as unknown[], queries: [] as any[] }));
vi.mock("./membership-payment-sync", () => ({ membershipProviderGet: vi.fn(() => { throw new Error("Provider access forbidden in offline tests"); }) }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./agent-merge-identity", () => ({ getAgentMergeHistoryIds: mocks.histories }));
import { assertRecruitmentSignupLinkAllowsDelete, assertRecruitmentSignupLinkAllowsStage, averageRecruitmentConversionDays, countRecruitmentConversions, explicitRecruitmentSignupLinkForUser, isRecruitmentSignupLinked, notLinkedRecruitmentProspect, notSupersededRecruitmentProspect, recruitmentWonDateFilter } from "./recruitment-signup-link-integration";
import { selectIncomeSource } from "./gocardless-income-service";
const dialect = new MySqlDialect();
beforeEach(() => {
  vi.clearAllMocks(); mocks.records = []; mocks.queries = []; mocks.histories.mockResolvedValue([22]);
  mocks.execute.mockImplementation(async query => { mocks.queries.push(dialect.sqlToQuery(query)); return [[{ count: 1, avgDays: 7 }], []]; });
  mocks.select.mockReturnValue({ from: () => ({ where: async () => mocks.records }) });
  mocks.getDb.mockResolvedValue({ select: mocks.select, execute: mocks.execute });
});
describe("durable signup link guards", () => {
  it("reads historical IDs strictly, with no missing-table identity fallback", async () => { expect(await explicitRecruitmentSignupLinkForUser(22, 11)).toBeNull(); expect(mocks.histories).toHaveBeenCalledWith(22, true); });
  it("does not fall back on strict identity storage errors", async () => { mocks.histories.mockRejectedValue(new Error("Missing identity storage")); await expect(explicitRecruitmentSignupLinkForUser(22)).rejects.toThrow("Missing identity storage"); });
  it("holds conflicting links across preserved account history", async () => { mocks.records = [{ userId: 22, prospectId: 33, joinSessionId: 11 }, { userId: 77, prospectId: 44, joinSessionId: 12 }]; await expect(explicitRecruitmentSignupLinkForUser(22)).rejects.toMatchObject({ code: "CONFLICT" }); });
  it("rejects a different completed application instead of email fallback", async () => { mocks.records = [{ userId: 22, prospectId: 33, joinSessionId: 11 }]; await expect(explicitRecruitmentSignupLinkForUser(22, 12)).rejects.toMatchObject({ code: "CONFLICT" }); });
  it("returns one exact application link without rewriting any identity", async () => { mocks.records = [{ userId: 22, prospectId: 33, joinSessionId: 11 }]; expect(await explicitRecruitmentSignupLinkForUser(22, 11)).toEqual(mocks.records[0]); expect(mocks.execute).not.toHaveBeenCalled(); });
  it.each(["archived", "new_enquiry", "application_received", "onboarding_declined"])("blocks regression of a linked enquiry to %s", async stage => { mocks.records = [{ prospectId: 33, supersededProspectId: 44 }]; await expect(assertRecruitmentSignupLinkAllowsStage(33, stage)).rejects.toMatchObject({ code: "CONFLICT" }); });
  it("permits only the canonical already-Won status", async () => { mocks.records = [{ prospectId: 33, supersededProspectId: 44 }]; await expect(assertRecruitmentSignupLinkAllowsStage(33, "won")).resolves.toBeUndefined(); });
  it("never restores a superseded shadow", async () => { mocks.records = [{ prospectId: 33, supersededProspectId: 44 }]; await expect(assertRecruitmentSignupLinkAllowsStage(44, "won")).rejects.toMatchObject({ code: "CONFLICT" }); });
  it.each([33, 44])("protects linked or shadow enquiry %s from deletion", async id => { mocks.records = [{ prospectId: 33, supersededProspectId: 44 }]; await expect(assertRecruitmentSignupLinkAllowsDelete(id)).rejects.toMatchObject({ code: "CONFLICT" }); expect(await isRecruitmentSignupLinked(id)).toBe(true); });
  it("allows ordinary unlinked prospects", async () => { await expect(assertRecruitmentSignupLinkAllowsDelete(55)).resolves.toBeUndefined(); expect(await isRecruitmentSignupLinked(55)).toBe(false); });
  it("does not turn unavailable link storage into an unlinked record", async () => { mocks.getDb.mockResolvedValue(null); await expect(isRecruitmentSignupLinked(33)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); });
});
describe("canonical manual-link reporting while preserving legacy counts", () => {
  it("suppresses shadows by numeric ID, not by name or email", () => { const query = dialect.sqlToQuery(notSupersededRecruitmentProspect()).sql; expect(query).toContain("supersededProspectId"); expect(query).toContain("NOT EXISTS"); expect(query).not.toMatch(/email|firstName|lastName/); });
  it("protects both canonical and superseded roles", () => { const query = dialect.sqlToQuery(notLinkedRecruitmentProspect()).sql; expect(query).toContain("rsl.prospectId"); expect(query).toContain("rsl.supersededProspectId"); });
  it("counts the link once at the recorded original conversion date and removes both raw linked history IDs", async () => { const db = await mocks.getDb(); const from = new Date("2026-11-09T00:00:00Z"), to = new Date("2026-11-16T00:00:00Z"); expect(await countRecruitmentConversions(db, from, to)).toEqual([{ count: 1, avgDays: 7 }]); const q = mocks.queries[0]; expect(q.sql).toContain("rsl.conversionAt"); expect(q.sql).toContain("UNION ALL"); expect(q.sql).toContain("rsl.prospectId = rsh.prospectId OR rsl.supersededProspectId = rsh.prospectId"); expect(q.sql).toContain("c.conversionAt >= ?"); expect(q.sql).toContain("c.conversionAt < ?"); expect(q.params).toEqual([from, to]); expect(q.sql).not.toMatch(/UPDATE|DELETE FROM|INSERT|email|billingRequest/); });
  it("preserves unlinked legacy event counts rather than retrospectively rewriting their history", async () => { await countRecruitmentConversions(await mocks.getDb()); const q = mocks.queries[0]; expect(q.sql).toContain("rsh.changedAt AS conversionAt"); expect(q.sql).not.toMatch(/DISTINCT|GROUP BY|MIN\(/); expect(q.params).toEqual([]); });
  it("uses the same original conversion date for time-to-signup averages", async () => { await averageRecruitmentConversionDays(await mocks.getDb()); expect(mocks.queries[0].sql).toContain("TIMESTAMPDIFF(DAY, rp.createdAt, c.conversionAt)"); expect(mocks.queries[0].sql).toContain("rsl.conversionAt"); });
  it("Won date filtering does not let today's correction audit override the recorded signup date", () => { const q = dialect.sqlToQuery(recruitmentWonDateFilter(new Date("2026-11-09Z"), new Date("2026-11-16Z"))); expect(q.sql).toContain("rsl.conversionAt >= ?"); expect(q.sql).toContain("rsh.changedAt >= ?"); expect(q.sql).toContain("NOT EXISTS"); expect(q.sql).not.toContain("rsl.linkedAt"); });
});
describe("original source attribution, no money changes", () => {
  it("labels explicitly linked enquiry attribution honestly instead of claiming an email match", () => { expect(selectIncomeSource({ linkedForms: [], recruitment: [{ howHeard: "TikTok", applicationData: null }], explicitRecruitmentLink: true })).toEqual({ sources: ["TikTok"], evidence: "Currently recorded enquiry source; staff-confirmed recruitment signup link (attribution only)" }); });
  it("preserves existing unlinked source evidence labels", () => { expect(selectIncomeSource({ linkedForms: [], recruitment: [{ howHeard: "website", applicationData: null }] }).evidence).toContain("exact-email recruitment match"); });
});
