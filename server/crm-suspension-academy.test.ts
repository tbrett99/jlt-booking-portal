import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
vi.mock("./agent-merge-identity", () => ({ assertAgentNotMerged: vi.fn(async () => undefined), getAgentMergeTarget: vi.fn(async () => null) }));

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  save: vi.fn(),
  enrol: vi.fn(),
  grant: vi.fn(),
  getDb: vi.fn(),
  execute: vi.fn(),
  visibility: vi.fn(),
}));

vi.mock("./agent-crm-db", async (importOriginal) => ({
  ...await importOriginal<typeof import("./agent-crm-db")>(),
  getAgentCrmProfile: mocks.profile,
  upsertAgentCrmProfile: mocks.save,
}));
vi.mock("./academy-router", () => ({
  enrolAgentInAcceleratorJourneys: mocks.enrol,
  grantAcademyAccess: mocks.grant,
}));
vi.mock("./db", async (importOriginal) => ({
  ...await importOriginal<typeof import("./db")>(),
  getDb: mocks.getDb,
  getRawDbPool: vi.fn(async () => ({ execute: mocks.execute })),
}));
vi.mock("./consumer-site-router", () => ({
  enforcePublicProfileVisibilityForStatus: mocks.visibility,
  enforcePublicProfileVisibilityForInContract: vi.fn(),
}));

import { crmRouter } from "./crm-router";

const caller = () => crmRouter.createCaller({
  user: { id: 47, role: "admin", name: "Test Staff", isActive: true },
  req: {}, res: {},
} as any).agentCrm;

function accountDb(account: Record<string, unknown>) {
  const limit = vi.fn(async () => [account]);
  const where = vi.fn(() => Object.assign(Promise.resolve([account]), { limit }));
  const from = vi.fn(() => ({ where }));
  const updateWhere = vi.fn(async () => undefined);
  const set = vi.fn(() => ({ where: updateWhere }));
  return { select: vi.fn(() => ({ from })), update: vi.fn(() => ({ set })), set };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mockResolvedValue({ agentStatus: "suspended", trainingStage: "Agent Accelerator" });
  mocks.save.mockResolvedValue(undefined);
  mocks.enrol.mockResolvedValue({ enrolled: 0 });
  mocks.execute.mockResolvedValue([{ insertId: 1 }]);
  mocks.visibility.mockResolvedValue(undefined);
  mocks.getDb.mockResolvedValue(accountDb({ name: "Test Agent", role: "agent", isActive: false, portalStatus: "suspended" }));
});

describe("CRM suspension and Academy isolation", () => {
  it.each(["suspended", "paused", "cancelled", "in_notice", "active"])(
    "saves ordinary %s profile details without re-enrolling an unchanged Accelerator stage", async (agentStatus) => {
      mocks.profile.mockResolvedValue({ agentStatus, trainingStage: "Agent Accelerator" });
      await expect(caller().updateProfile({ userId: 9001, trainingStage: "Agent Accelerator", mobile: "test" })).resolves.toEqual({ success: true });
      expect(mocks.save).toHaveBeenCalledWith(9001, { trainingStage: "Agent Accelerator", mobile: "test" });
      expect(mocks.enrol).not.toHaveBeenCalled();
      expect(mocks.grant).not.toHaveBeenCalled();
    },
  );

  it("accepts an unchanged status from an old tab without writing it through the general profile endpoint", async () => {
    await caller().updateProfile({ userId: 9001, agentStatus: "suspended", trainingStage: "Agent Accelerator" });
    expect(mocks.save).toHaveBeenCalledWith(9001, { trainingStage: "Agent Accelerator" });
    expect(mocks.enrol).not.toHaveBeenCalled();
  });

  it("prevents a stale profile save from silently reactivating a suspended CRM record", async () => {
    await expect(caller().updateProfile({ userId: 9001, agentStatus: "active" })).rejects.toThrow("Agent Status control");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("blocks starting Accelerator for a suspended account before changing its saved training stage", async () => {
    mocks.profile.mockResolvedValue({ agentStatus: "suspended", trainingStage: "Training" });
    await expect(caller().updateProfile({ userId: 9001, trainingStage: "Agent Accelerator" })).rejects.toThrow("Only current active agents");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.enrol).not.toHaveBeenCalled();
  });

  it("still starts Accelerator on a real stage transition for an eligible active agent", async () => {
    mocks.profile.mockResolvedValue({ agentStatus: "active", trainingStage: "Training" });
    mocks.getDb.mockResolvedValue(accountDb({ role: "agent", isActive: true, portalStatus: "active" }));
    await caller().updateProfile({ userId: 9001, trainingStage: "Agent Accelerator" });
    expect(mocks.save).toHaveBeenCalledWith(9001, { trainingStage: "Agent Accelerator" });
    expect(mocks.enrol).toHaveBeenCalledTimes(1);
    expect(mocks.enrol).toHaveBeenCalledWith({ agentId: 9001, actorId: 47 });
  });

  it("suspends an Accelerator account through the status route without any Academy assignment", async () => {
    mocks.profile.mockResolvedValue({ agentStatus: "active", trainingStage: "Agent Accelerator" });
    const db = accountDb({ name: "Test Agent", email: null });
    mocks.getDb.mockResolvedValue(db);
    await expect(caller().updateAgentStatus({ userId: 9001, newStatus: "suspended", notes: "Test suspension" })).resolves.toEqual({ success: true });
    expect(mocks.save).toHaveBeenCalledWith(9001, expect.objectContaining({ agentStatus: "suspended", suspensionReason: "manual" }));
    expect(db.set).toHaveBeenCalledWith({ portalStatus: "suspended", isActive: false });
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO agent_status_events"), expect.arrayContaining([9001, "active", "suspended", 47, "Test suspension"]));
    expect(mocks.enrol).not.toHaveBeenCalled();
    expect(mocks.grant).not.toHaveBeenCalled();
  });

  it("keeps status changes out of general profile saves in the interface", () => {
    const ui = readFileSync(resolve(process.cwd(), "client/src/pages/crm/AgentCrm.tsx"), "utf8");
    expect(ui).toContain("Status changes are saved separately from profile details.");
    expect(ui).not.toContain("agentStatus: form.agentStatus");
    expect(ui).toContain('value={profile?.agentStatus ?? "active"} onValueChange={handleStatusChange}');
  });
});
