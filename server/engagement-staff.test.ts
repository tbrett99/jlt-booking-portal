import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), getRawDbPool: vi.fn(), notify: vi.fn(), email: vi.fn(), award: vi.fn(), rule: vi.fn(),
  storage: vi.fn(), alerts: vi.fn(), archives: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: mocks.getDb, getRawDbPool: mocks.getRawDbPool, createInAppNotification: mocks.notify }));
vi.mock("./email", () => ({ sendDirectEmail: mocks.email }));
vi.mock("./storage", () => ({ storagePut: mocks.storage }));
vi.mock("./momentum", () => ({ awardMomentum: mocks.award, getMomentumRule: mocks.rule }));
vi.mock("./academy-email-alerts", () => ({ dispatchAcademyEmailAlerts: mocks.alerts }));
vi.mock("./agent-merge-identity", () => ({ getArchivedAgentMergeIds: mocks.archives }));

import { agentDevelopmentRouter, publishScheduledAcademyActionPlans } from "./agent-development-router";
import { applyEngagementActionPolicy, currentEngagementAgentFilter, requireCurrentEngagementAgents } from "./engagement-staff";

let rows: unknown[][];
let selections: any[];
let predicates: string[];
let auditRecords: any[];
let nativeWrites: { sql: string; params: unknown[] }[];
let writeAffectedRows: number;
const dialect = new MySqlDialect();

function fakeDb() {
  return {
    select: vi.fn((selection?: unknown) => {
      selections.push(selection);
      const response = rows.shift();
      if (!response) throw new Error("Unexpected DB query in mocked-only suite");
      const query: any = {
        from: () => query, innerJoin: () => query, leftJoin: () => query,
        where: (predicate: any) => { if (predicate) predicates.push(dialect.sqlToQuery(predicate).sql); return query; },
        orderBy: () => query, groupBy: () => query,
        limit: async () => response,
        then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(response).then(resolve, reject),
      };
      return query;
    }),
    insert: vi.fn(() => ({ values: async (record: unknown) => { auditRecords.push(record); } })),
  };
}
function caller(role: User["role"] = "agent", overrides: Partial<User> = {}) {
  const user = { id: 7, role, name: "Engagement staff", isActive: true, portalStatus: "active", mustChangePassword: false, ...overrides } as User;
  return agentDevelopmentRouter.createCaller({ user, req: {}, res: {} } as TrpcContext);
}
function authorised(...responses: unknown[][]) {
  rows.push([{ id: 88, staffRole: "agent_engagement" }], [{ role: "agent", isActive: true, portalStatus: "active", mustChangePassword: false, crmStatus: "active", archiveId: null }], ...responses);
}
const learner = { id: 12, name: "Learner" };
const caseRecord = { id: 32, agentId: 12, status: "active", ownerId: 7, riskReason: "Needs a learning check-in" };
const plan = { id: 41, title: "Learning reflection", instructions: "Reflect on this week's learning", status: "draft", actionType: "ad_hoc", audience: "selected_agents", assignmentTrigger: "immediate", courseId: null, courseWeek: null,
  momentumAwardMode: "reviewed_completion", momentumPoints: 25, staffReviewRequired: true, dueAt: null, publishedById: null };
const newPlanInput = { title: "Learning reflection", instructions: "Reflect on the module", actionType: "ad_hoc" as const, audience: "selected_agents" as const, assignmentTrigger: "immediate" as const, targetAgentIds: [12] };

beforeEach(() => {
  vi.clearAllMocks(); rows = []; selections = []; predicates = []; auditRecords = []; nativeWrites = []; writeAffectedRows = 1;
  mocks.getDb.mockResolvedValue(fakeDb());
  mocks.archives.mockResolvedValue([99]);
  mocks.rule.mockResolvedValue({ enabled: true });
  mocks.notify.mockResolvedValue(undefined); mocks.email.mockResolvedValue({ success: true });
  mocks.getRawDbPool.mockResolvedValue({ execute: vi.fn(async (sql: string, params: unknown[] = []) => {
    nativeWrites.push({ sql, params });
    if (sql.startsWith("SELECT id, role, name")) return [[{ ...learner, role: "agent" }]];
    if (sql.startsWith("SELECT id FROM agent_engagement_cases")) return [[]];
    if (sql.startsWith("INSERT")) return [{ insertId: 61, affectedRows: 1 }];
    if (sql.startsWith("UPDATE") || sql.startsWith("DELETE")) return [{ affectedRows: writeAffectedRows }];
    throw new Error(`Unexpected native SQL: ${sql}`);
  }) });
});

describe("selectively gated engagement staff API (no live data or providers)", () => {
  it("denies ordinary agents and disabled/missing grants on direct calls without a role rewrite", async () => {
    rows.push([]);
    await expect(caller().admin.staffLearners()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getRawDbPool).not.toHaveBeenCalled();
    expect(auditRecords).toHaveLength(0);
    expect(predicates[0]).toContain("isActive");
  });

  it.each([
    { role: "admin", isActive: true, portalStatus: "active", mustChangePassword: false, crmStatus: "active", archiveId: null },
    { role: "agent", isActive: false, portalStatus: "active", mustChangePassword: false, crmStatus: "active", archiveId: null },
    { role: "agent", isActive: true, portalStatus: "paused", mustChangePassword: false, crmStatus: "active", archiveId: null },
    { role: "agent", isActive: true, portalStatus: "active", mustChangePassword: true, crmStatus: "active", archiveId: null },
    { role: "agent", isActive: true, portalStatus: "active", mustChangePassword: false, crmStatus: "cancelled", archiveId: null },
    { role: "agent", isActive: true, portalStatus: "active", mustChangePassword: false, crmStatus: "active", archiveId: 22 },
  ])("denies ineligible fresh staff account %j", async (account) => {
    rows.push([{ id: 88, staffRole: "agent_engagement" }], [account]);
    await expect(caller().admin.actionPlans()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(nativeWrites).toHaveLength(0);
  });

  it("fails closed when grant schema is unavailable", async () => {
    mocks.getDb.mockResolvedValue({ select: () => { throw { code: "ER_NO_SUCH_TABLE", message: "staff_role_assignments missing" }; } });
    await expect(caller().admin.staffLearners()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not delegate archive or bulk reminder email even to granted agents", async () => {
    await expect(caller().admin.archiveActionPlan({ planId: 41 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().admin.remindActionPlanAgents({ planId: 41 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.email).not.toHaveBeenCalled();
  });

  it("returns picker id/name only and excludes inactive, non-agent, archived and non-current CRM learners in SQL", async () => {
    authorised([{ ...learner, email: "private@example.test", tempPassword: "never-return", commissionRatePct: 80 }]);
    expect(await caller().admin.staffLearners()).toEqual([learner]);
    expect(Object.keys(selections.at(-1))).toEqual(["id", "name"]);
    const filter = dialect.sqlToQuery(await currentEngagementAgentFilter());
    expect(filter.sql).toContain("not in"); expect(filter.sql).toContain("portalStatus");
    expect(filter.sql).toContain("agentStatus"); expect(filter.params).toContain(99); expect(filter.params).toContain("agent");
  });

  it("rejects arbitrary unavailable learner IDs before any privileged write", async () => {
    authorised([]);
    await expect(caller().admin.createEngagementCase({ agentId: 99, riskReason: "Check in" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(nativeWrites).toHaveLength(0);
    rows.push([]);
    await expect(requireCurrentEngagementAgents([33])).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("selects minimal case/profile/staff DTOs and never queries general CRM notes", async () => {
    authorised([{ case: caseRecord, agent: { ...learner, email: "private@example.test", tempPassword: "hash" }, profile: { trainingStage: "Training", bankSortCode: "secret", adminNotes: "private" } }],
      [{ interaction: { id: 54, summary: "Learning check-in" }, staff: { id: 7, name: "Staff", email: "private@example.test" } }]);
    const result = await caller().admin.getEngagementCase({ caseId: 32 });
    expect(result.agent).toEqual(learner); expect(result.profile).toEqual({ trainingStage: "Training" });
    expect(result.interactions[0].staff).toEqual({ id: 7, name: "Staff" });
    expect(Object.keys(selections[2].agent)).toEqual(["id", "name"]);
    expect(Object.keys(selections[2].profile)).toEqual(["trainingStage"]);
    expect(Object.keys(selections[3].staff)).toEqual(["id", "name"]);
    expect(JSON.stringify(result)).not.toMatch(/secret|hash|private@example|bankSortCode|adminNotes/);
  });

  it("rejects own work before status grading, audit, points or notification", async () => {
    authorised([{ assignment: { id: 71, agentId: 7, status: "review" }, plan }]);
    await expect(caller().admin.reviewAction({ assignmentId: 71, outcome: "completed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(nativeWrites).toHaveLength(0); expect(auditRecords).toHaveLength(0);
    expect(mocks.rule).not.toHaveBeenCalled(); expect(mocks.award).not.toHaveBeenCalled();
  });

  it.each(["assigned", "completed", "needs_revision"])("cannot change pending/done status %s into an award", async (status) => {
    authorised([{ assignment: { id: 71, agentId: 12, status }, plan }], [learner]);
    await expect(caller().admin.reviewAction({ assignmentId: 71, outcome: "completed" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(nativeWrites).toHaveLength(0); expect(mocks.award).not.toHaveBeenCalled();
  });

  it("reuses configured reviewed award logic with actor unchanged and mandatory audit", async () => {
    authorised([{ assignment: { id: 71, agentId: 12, status: "review" }, plan }], [learner]);
    expect(await caller().admin.reviewAction({ assignmentId: 71, outcome: "completed" })).toEqual({ success: true });
    expect(nativeWrites[0].sql).toContain("AND status = ?");
    expect(nativeWrites[0].params[3]).toBe(7);
    expect(mocks.award).toHaveBeenCalledWith(expect.objectContaining({ agentId: 12, sourceId: 71, pointsOverride: 25 }));
    expect(auditRecords[0]).toMatchObject({ actorId: 7, action: "engagement.action.review" });
  });

  it("does not award on a concurrent review conflict", async () => {
    authorised([{ assignment: { id: 71, agentId: 12, status: "review" }, plan }], [learner]); writeAffectedRows = 0;
    await expect(caller().admin.reviewAction({ assignmentId: 71, outcome: "completed" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.award).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("logs email as an audited engagement interaction, never sends or mirrors to CRM", async () => {
    authorised([caseRecord], [learner]);
    expect(await caller().admin.logEngagementInteraction({ caseId: 32, channel: "email", summary: "Discussed the learning module", status: "monitoring" })).toEqual({ success: true });
    expect(nativeWrites.map(w => w.sql).join(" ")).toContain("agent_engagement_interactions");
    expect(nativeWrites.map(w => w.sql).join(" ")).not.toMatch(/agent_crm_notes|bookings|payment|commission|bank/);
    expect(auditRecords[0]).toMatchObject({ actorId: 7, action: "engagement.interaction.log", metadata: { caseId: 32, targetUserId: 12, channel: "email", status: "monitoring" } });
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it("requires audit storage before a restricted write", async () => {
    authorised([caseRecord], [learner]);
    mocks.getDb.mockResolvedValue({ ...fakeDb(), insert: () => ({ values: async () => { throw new Error("Audit unavailable"); } }) });
    await expect(caller().admin.logEngagementInteraction({ caseId: 32, channel: "call", summary: "Check in about learning", status: "active" })).rejects.toThrow("The staff operation could not be completed");
    expect(nativeWrites).toHaveLength(0);
  });

  it("redacts unexpected database messages and private causes for restricted staff", async () => {
    authorised([caseRecord], [learner]);
    mocks.getRawDbPool.mockRejectedValue(new Error("Failed query SELECT bankAccountNumber WHERE email=private@example.test"));
    const error = await caller().admin.logEngagementInteraction({ caseId: 32, channel: "call", summary: "Learning discussion", status: "active" }).catch(e => e);
    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.message).not.toMatch(/SELECT|bankAccount|private@example/);
    expect(error.cause).toBeUndefined();
  });

  it("creates check-ins in engagement records only for staff, retains admin CRM mirroring", async () => {
    authorised([learner]);
    expect(await caller().admin.createEngagementCase({ agentId: 12, riskReason: "Needs learning support" })).toEqual({ id: 61 });
    expect(nativeWrites.map(w => w.sql).join(" ")).not.toContain("agent_crm_notes");
    expect(auditRecords[0].action).toBe("engagement.case.create");
    nativeWrites = [];
    await caller("admin").admin.createEngagementCase({ agentId: 12, riskReason: "Admin check-in" });
    expect(nativeWrites.map(w => w.sql).join(" ")).toContain("agent_crm_notes");
  });

  it("rejects arbitrary owner assignment and audits supported case updates", async () => {
    authorised([caseRecord], [learner]);
    await expect(caller().admin.updateEngagementCase({ caseId: 32, status: "active", ownerId: 90 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(nativeWrites).toHaveLength(0);
    authorised([caseRecord], [learner]);
    await caller().admin.updateEngagementCase({ caseId: 32, status: "monitoring" });
    expect(auditRecords[0].action).toBe("engagement.case.update");
  });

  it("allows course-less ad-hoc creation with zero rewards, retains admin configured rewards on edit", async () => {
    authorised([learner]);
    expect(await caller().admin.saveActionPlan(newPlanInput)).toEqual({ id: 61 });
    const insert = nativeWrites.find(w => w.sql.includes("INSERT INTO academy_action_plans"))!;
    expect(insert.params[8]).toBeNull(); expect(insert.params[9]).toBeNull();
    expect(insert.params[14]).toBe("off"); expect(insert.params[15]).toBe(0);
    expect(auditRecords[0].action).toBe("engagement.action.save");
    nativeWrites = []; authorised([plan], [learner], [plan]);
    await caller().admin.saveActionPlan({ ...newPlanInput, id: 41 });
    const update = nativeWrites[0]; expect(update.params[14]).toBe("reviewed_completion"); expect(update.params[15]).toBe(25);
  });

  it.each([
    { momentumAwardMode: "reviewed_completion" }, { momentumPoints: 40 }, { courseId: 8, courseWeek: 2 },
    { assignmentTrigger: "on_accelerator_entry", audience: "agent_accelerator" }, { actionType: "weekly" },
  ])("rejects staff creation policy escalation %j", async (patch) => {
    authorised();
    await expect(caller().admin.saveActionPlan({ ...newPlanInput, ...patch } as any)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(nativeWrites).toHaveLength(0);
  });

  it("protects configured review requirement, reward points and journey coupling on existing plans", () => {
    const input = { ...newPlanInput };
    expect(applyEngagementActionPolicy(input, plan as any)).toMatchObject({ momentumPoints: 25, staffReviewRequired: true });
    for (const patch of [{ momentumPoints: 900 }, { momentumAwardMode: "off" }, { staffReviewRequired: false }, { courseId: 6 }, { courseWeek: 3 }, { assignmentTrigger: "on_accelerator_entry" }]) {
      expect(() => applyEngagementActionPolicy({ ...input, ...patch } as any, plan as any)).toThrow(/configuration require/);
    }
  });

  it("publishes and assigns through the real business helper, using safe current targets and the genuine staff actor", async () => {
    authorised([{ ...plan, momentumAwardMode: "off", momentumPoints: 0 }], [{ agentId: 12 }], [learner], [], [{ ...learner, email: null }]);
    const result = await caller().admin.publishActionPlan({ planId: 41 });
    expect(result.created).toBe(1);
    expect(nativeWrites.map(w => w.sql).join(" ")).toContain("INSERT INTO academy_action_assignments");
    expect(nativeWrites.find(w => w.sql.includes("UPDATE academy_action_plans"))!.params[2]).toBe(7);
    expect(auditRecords[0].action).toBe("engagement.action.publish");
  });

  it("keeps delayed staff publication scoped and audited without a synthetic administrator", async () => {
    rows.push([{ ...plan, createdById: 7, status: "scheduled", publishAt: new Date("2020-01-01") }], [{ id: 7, role: "agent", name: "Staff" }]);
    authorised([{ ...plan, createdById: 7, status: "scheduled", publishAt: new Date("2020-01-01") }], [{ agentId: 12 }], [learner], [], [{ ...learner, email: null }]);
    expect(await publishScheduledAcademyActionPlans()).toEqual({ published: 1, assignments: 1 });
    expect(auditRecords[0]).toMatchObject({ actorId: 7, action: "engagement.action.publish" });
    expect(nativeWrites.find(w => w.sql.includes("UPDATE academy_action_plans"))!.params[2]).toBe(7);
  });

  it("defers delayed staff publication when the engagement grant was revoked", async () => {
    rows.push([{ ...plan, createdById: 7, status: "scheduled" }], [{ id: 7, role: "agent", name: "Staff" }], []);
    expect(await publishScheduledAcademyActionPlans()).toEqual({ published: 0, assignments: 0 });
    expect(nativeWrites).toHaveLength(0); expect(auditRecords).toHaveLength(0); expect(mocks.email).not.toHaveBeenCalled();
  });

  it("returns an academic/activity-only briefing without CRM, payment or raw assessment/evidence records", async () => {
    authorised([learner], [{ ...learner, lastSignedIn: new Date("2026-01-01") }], [], [{ completedLessons: 3, lessonActiveSeconds: 120, assessmentActiveSeconds: 60, lastActivityAt: null }], [], []);
    const result = await caller().admin.staffActivity({ agentId: 12 });
    expect(result.activity).toMatchObject({ completedLessons: 3, lessonActiveSeconds: 120 });
    expect(result.agent).toEqual({ ...learner, lastSignedIn: new Date("2026-01-01") });
    const selectionKeys = selections.slice(2).flatMap(s => Object.keys(s ?? {})).join(" ");
    expect(selectionKeys).not.toMatch(/email|bank|password|payment|commission|contract|completionNote|evidence|answers|profile|adminNotes/i);
  });
});
