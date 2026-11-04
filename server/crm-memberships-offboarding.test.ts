import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";
import { agentCrmProfiles, agentSupplierLogins, users } from "../drizzle/schema";
import {
  OFFBOARDING_SYSTEM_ITEMS,
  getOffboardingChecklist,
  readOffboardingChecklist,
  toggleOffboardingItem,
} from "../shared/offboarding-checklist";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getRawDbPool: vi.fn(),
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
  execute: vi.fn(),
  visibility: vi.fn(),
  email: vi.fn(),
  notification: vi.fn(),
}));

// Never import the live DB or provider implementations. The actual procedures
// operate only on synthetic doubles; unrelated helpers are unavailable.
vi.mock("./db", () => ({
  getDb: mocks.getDb,
  getRawDbPool: mocks.getRawDbPool,
  getAllUsers: vi.fn(),
  getUserByEmail: vi.fn(),
  createInAppNotification: mocks.notification,
}));
vi.mock("./crm-db", () => ({}));
vi.mock("./agent-crm-db", () => ({
  getAgentCrmProfile: mocks.getProfile,
  upsertAgentCrmProfile: mocks.saveProfile,
}));
vi.mock("./recruitment-db", () => ({}));
vi.mock("./agent-merge-identity", () => ({
  assertAgentNotMerged: vi.fn(),
  getAgentMergeTarget: vi.fn(),
}));
vi.mock("./academy-router", () => ({
  enrolAgentInAcceleratorJourneys: vi.fn(),
  grantAcademyAccess: vi.fn(),
}));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));
vi.mock("./email", () => ({ sendDirectEmail: mocks.email }));
vi.mock("./resend-email", () => ({}));
vi.mock("./consumer-site-router", () => ({
  enforcePublicProfileVisibilityForStatus: mocks.visibility,
}));

import { crmRouter } from "./crm-router";

const SYSTEM_ITEMS = [
  "Topdog login removed",
  "WhatsApp access removed",
  "Learnworlds access removed",
  "JLT email deactivated",
  "Portal access removed",
];
const SUPPLIERS = [
  { id: 101, supplierName: "Atlas Travel" },
  { id: 102, supplierName: "Beacon Holidays" },
  { id: 103, supplierName: "Atlas Travel" },
  { id: 104, supplierName: "Coral Tours" },
  { id: 105, supplierName: "Delta Escapes" },
  { id: 106, supplierName: "Evergreen Trips" },
];
const SUPPLIER_ITEMS = [
  "Revoke: Atlas Travel",
  "Revoke: Beacon Holidays",
  "Revoke: Coral Tours",
  "Revoke: Delta Escapes",
  "Revoke: Evergreen Trips",
];
const ALL_ITEMS = [...SUPPLIER_ITEMS, ...SYSTEM_ITEMS];
const LEGACY_ITEMS = ["Supplier logins revoked", "Revoke: Former Supplier", "Unknown old step"];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getDb.mockImplementation(() => {
    throw new Error("This test must explicitly install its synthetic database");
  });
});

describe("supplier-wide offboarding checklist", () => {
  it("keeps exactly the five established system item keys", () => {
    expect(OFFBOARDING_SYSTEM_ITEMS).toEqual(SYSTEM_ITEMS);
  });

  it("groups six login rows with five names into five supplier tasks and completes at 10/10", () => {
    const checklist = getOffboardingChecklist(SUPPLIERS, ALL_ITEMS);
    expect(checklist.supplierTasks).toEqual([
      { key: "Revoke: Atlas Travel", supplierName: "Atlas Travel", loginIds: [101, 103] },
      { key: "Revoke: Beacon Holidays", supplierName: "Beacon Holidays", loginIds: [102] },
      { key: "Revoke: Coral Tours", supplierName: "Coral Tours", loginIds: [104] },
      { key: "Revoke: Delta Escapes", supplierName: "Delta Escapes", loginIds: [105] },
      { key: "Revoke: Evergreen Trips", supplierName: "Evergreen Trips", loginIds: [106] },
    ]);
    expect(checklist.items).toEqual(ALL_ITEMS);
    expect(checklist).toMatchObject({ completed: 10, total: 10, complete: true });
    expect(getOffboardingChecklist(SUPPLIERS, JSON.stringify(ALL_ITEMS))).toEqual(checklist);
  });

  it("requires one supplier-wide tick covering both login IDs rather than per-login keys", () => {
    const evidence = ALL_ITEMS.filter(item => item !== "Revoke: Atlas Travel");
    expect(getOffboardingChecklist(SUPPLIERS, [...evidence, "Revoke: 101", "Revoke: 103"]))
      .toMatchObject({ completed: 9, total: 10, complete: false });
    expect(getOffboardingChecklist(SUPPLIERS, [...evidence, "Revoke: Atlas Travel"]))
      .toMatchObject({ completed: 10, total: 10, complete: true });
  });

  it.each(ALL_ITEMS)("legacy and duplicate ticks cannot hide the missing required item: %s", missing => {
    const remaining = ALL_ITEMS.filter(item => item !== missing);
    const evidence = [...remaining, ...remaining, ...LEGACY_ITEMS, ...LEGACY_ITEMS];
    expect(getOffboardingChecklist(SUPPLIERS, evidence))
      .toMatchObject({ completed: 9, total: 10, complete: false });
  });

  it("does not overcount duplicates or unknown ticks even after completion", () => {
    expect(getOffboardingChecklist(SUPPLIERS, [...ALL_ITEMS, ...ALL_ITEMS, ...LEGACY_ITEMS]))
      .toMatchObject({ completed: 10, total: 10, complete: true });
    expect(getOffboardingChecklist(SUPPLIERS, Array(20).fill(SYSTEM_ITEMS[0])))
      .toMatchObject({ completed: 1, total: 10, complete: false });
  });

  it("does not convert the generic legacy supplier tick into supplier-specific evidence", () => {
    const evidence = [...SYSTEM_ITEMS, "Supplier logins revoked"];
    expect(readOffboardingChecklist(evidence)).toEqual(evidence);
    expect(getOffboardingChecklist(SUPPLIERS, evidence))
      .toMatchObject({ completed: 5, total: 10, complete: false });
  });

  it("makes a newly recorded supplier pending even when an old checklist was complete", () => {
    const suppliers = [...SUPPLIERS, { id: 107, supplierName: "Fresh Supplier" }];
    const checklist = getOffboardingChecklist(suppliers, [...ALL_ITEMS, ...LEGACY_ITEMS]);
    expect(checklist).toMatchObject({ completed: 10, total: 11, complete: false });
    expect(checklist.supplierTasks).toContainEqual({
      key: "Revoke: Fresh Supplier", supplierName: "Fresh Supplier", loginIds: [107],
    });
    expect(getOffboardingChecklist(suppliers, [...ALL_ITEMS, "Revoke: Fresh Supplier"]))
      .toMatchObject({ completed: 11, total: 11, complete: true });
  });

  it("does not conflate exact supplier names by case or whitespace", () => {
    const suppliers = [
      { id: 1, supplierName: "Atlas Travel" },
      { id: 2, supplierName: "atlas travel" },
      { id: 3, supplierName: "Atlas Travel " },
    ];
    const evidence = [...SYSTEM_ITEMS, "Revoke: Atlas Travel"];
    const checklist = getOffboardingChecklist(suppliers, evidence);
    expect(checklist.supplierTasks.map(task => task.key)).toEqual([
      "Revoke: Atlas Travel", "Revoke: atlas travel", "Revoke: Atlas Travel ",
    ]);
    expect(checklist).toMatchObject({ completed: 6, total: 8, complete: false });
    expect(getOffboardingChecklist(suppliers, [...evidence, "Revoke: atlas travel", "Revoke: Atlas Travel "]))
      .toMatchObject({ completed: 8, total: 8, complete: true });
  });

  it("still requires every system item when no supplier logins exist", () => {
    expect(getOffboardingChecklist([], SYSTEM_ITEMS))
      .toMatchObject({ supplierTasks: [], completed: 5, total: 5, complete: true });
    expect(getOffboardingChecklist([], LEGACY_ITEMS))
      .toMatchObject({ completed: 0, total: 5, complete: false });
  });

  it.each([undefined, null, "", "not JSON", '["Revoke: Atlas Travel",', "null", "{}", 42, { checklist: ALL_ITEMS }])(
    "safely treats invalid or non-array evidence as incomplete: %j", evidence => {
      expect(readOffboardingChecklist(evidence)).toEqual([]);
      expect(getOffboardingChecklist(SUPPLIERS, evidence))
        .toMatchObject({ completed: 0, total: 10, complete: false });
    },
  );

  it("reads JSON arrays while preserving string duplicates and discarding non-string entries", () => {
    const evidence = [SYSTEM_ITEMS[0], null, 7, {}, SYSTEM_ITEMS[0], "Unknown old step"];
    const expected = [SYSTEM_ITEMS[0], SYSTEM_ITEMS[0], "Unknown old step"];
    expect(readOffboardingChecklist(evidence)).toEqual(expected);
    expect(readOffboardingChecklist(JSON.stringify(evidence))).toEqual(expected);
    expect(getOffboardingChecklist(SUPPLIERS, JSON.stringify(evidence)))
      .toMatchObject({ completed: 1, total: 10, complete: false });
  });
});

describe("offboarding checklist toggle evidence preservation", () => {
  it("adds a current item without removing, deduplicating or converting unrelated legacy evidence", () => {
    const evidence = [...LEGACY_ITEMS, LEGACY_ITEMS[0], SYSTEM_ITEMS[0], SYSTEM_ITEMS[0]];
    const original = [...evidence];
    const toggled = toggleOffboardingItem(evidence, "Revoke: Atlas Travel");
    expect(toggled).toEqual([...original, "Revoke: Atlas Travel"]);
    expect(evidence).toEqual(original);
    expect(toggleOffboardingItem(JSON.stringify(evidence), "Revoke: Atlas Travel")).toEqual(toggled);
    expect(getOffboardingChecklist(SUPPLIERS, toggled))
      .toMatchObject({ completed: 2, total: 10, complete: false });
  });

  it("removes all duplicates of only the toggled current item and preserves legacy duplicates", () => {
    const evidence = [LEGACY_ITEMS[0], "Revoke: Atlas Travel", LEGACY_ITEMS[0], SYSTEM_ITEMS[0], "Revoke: Atlas Travel"];
    expect(toggleOffboardingItem(evidence, "Revoke: Atlas Travel"))
      .toEqual([LEGACY_ITEMS[0], LEGACY_ITEMS[0], SYSTEM_ITEMS[0]]);
    expect(evidence).toHaveLength(5);
  });

  it("starts safely from malformed JSON and round-trips a current tick without disturbing legacy ticks", () => {
    expect(toggleOffboardingItem("malformed JSON", SYSTEM_ITEMS[0])).toEqual([SYSTEM_ITEMS[0]]);
    const evidence = [...LEGACY_ITEMS, ...LEGACY_ITEMS];
    expect(toggleOffboardingItem(toggleOffboardingItem(evidence, SYSTEM_ITEMS[0]), SYSTEM_ITEMS[0]))
      .toEqual(evidence);
  });
});

function caller(role: "admin" | "super_admin" | "agent" | null = "admin") {
  return crmRouter.createCaller({
    user: role ? { id: 9000, role, name: "Synthetic Staff", isActive: true } : null,
    req: {},
    res: {},
  } as TrpcContext).agentCrm;
}

function profile(userId: number, agentStatus: string | null, cancelChecklist: unknown = []) {
  return {
    userId, agentStatus, cancelChecklist,
    name: `Synthetic Agent ${userId}`,
    email: `agent${userId}@example.invalid`,
    membershipTier: "Synthetic Tier",
    pauseEndsAt: null,
    noticeEndsAt: null,
    cancelledAt: new Date("2026-01-01T00:00:00.000Z"),
    suspendedAt: null,
    suspensionReason: null,
    uniqueAgentId: `SYNTHETIC-${userId}`,
    ukRegion: null,
  };
}

function syntheticDb(
  profiles: ReturnType<typeof profile>[],
  loginRows: { userId: number; id: number; supplierName: string }[],
) {
  const innerJoin = vi.fn(async () => profiles);
  const where = vi.fn(async (_condition: unknown) => loginRows);
  const from = vi.fn((table: unknown) => {
    if (table === agentCrmProfiles) return { innerJoin };
    if (table === agentSupplierLogins) return { where };
    throw new Error("Unexpected table read in synthetic membership overview");
  });
  const select = vi.fn(() => ({ from }));
  // Deliberately no mutation or raw query API: this double can only read fixtures.
  return { select, from, innerJoin, where };
}

describe("actual crmRouter.agentCrm.getMembershipsOverview with synthetic DB", () => {
  it.each(["admin", "super_admin"] as const)(
    "excludes complete agents and lists only cancelled agents with a genuinely missing item for %s", async role => {
      const missing = ALL_ITEMS.filter(item => item !== "Revoke: Atlas Travel");
      const profiles = [
        profile(1, "cancelled", ALL_ITEMS),
        profile(2, "cancelled", [...missing, ...missing, ...LEGACY_ITEMS]),
        profile(3, "cancelled", [...ALL_ITEMS, ...ALL_ITEMS, ...LEGACY_ITEMS]),
        profile(4, "cancelled", JSON.stringify(ALL_ITEMS)),
        profile(5, "cancelled", "invalid JSON"),
        profile(6, "cancelled", SYSTEM_ITEMS),
        profile(7, "active"),
        profile(8, "paused"),
        profile(9, "in_notice"),
        profile(10, "suspended"),
        profile(11, null),
        profile(12, "cancelled", ALL_ITEMS),
      ];
      const loginRows = [1, 2, 3, 4, 5, 12].flatMap(userId => SUPPLIERS.map(row => ({ ...row, userId })));
      loginRows.push({ userId: 12, id: 107, supplierName: "Fresh Supplier" });
      const db = syntheticDb(profiles, loginRows);
      mocks.getDb.mockResolvedValue(db);

      const result = await caller(role).getMembershipsOverview();

      expect(result.cancelledPendingOffboarding.map(p => p.userId)).toEqual([2, 5, 12]);
      expect(result.cancelledPendingOffboarding.every(p => p.agentStatus === "cancelled")).toBe(true);
      expect(result.cancelledPendingOffboarding[0].supplierLogins).toEqual(SUPPLIERS);
      expect(result.cancelledPendingOffboarding[0].cancelChecklist).toEqual([...missing, ...missing, ...LEGACY_ITEMS]);
      expect(result.checklistItems).toEqual(SYSTEM_ITEMS);
      expect(result.stats).toEqual({ total: 12, active: 2, paused: 1, in_notice: 1, cancelled: 7, suspended: 1 });
      expect(result.tierCounts).toEqual({ "Synthetic Tier": 2 });
      expect(result.paused.map(p => p.userId)).toEqual([8]);
      expect(result.inNotice.map(p => p.userId)).toEqual([9]);
      expect(result.suspended.map(p => p.userId)).toEqual([10]);
      expect(mocks.getDb).toHaveBeenCalledTimes(1);
      expect(db.select).toHaveBeenCalledTimes(2);
      expect(db.innerJoin).toHaveBeenCalledTimes(1);
      expect(db.where).toHaveBeenCalledTimes(1);
      const supplierFilter = db.where.mock.calls[0][0];
      expect(new MySqlDialect().sqlToQuery(supplierFilter as Parameters<MySqlDialect["sqlToQuery"]>[0]).params)
        .toEqual([1, 2, 3, 4, 5, 6, 12]);
    },
  );

  it("does not even query supplier logins when there are no cancelled profiles", async () => {
    const db = syntheticDb([profile(1, "active"), profile(2, "paused"), profile(3, "in_notice"), profile(4, "suspended")], []);
    mocks.getDb.mockResolvedValue(db);
    const result = await caller().getMembershipsOverview();
    expect(result.cancelledPendingOffboarding).toEqual([]);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.where).not.toHaveBeenCalled();
  });

  it.each([
    { role: null, code: "UNAUTHORIZED" },
    { role: "agent" as const, code: "FORBIDDEN" },
  ])("denies $role before any DB read", async ({ role, code }) => {
    await expect(caller(role).getMembershipsOverview()).rejects.toMatchObject({ code });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});

// This transaction double models staged writes, commit and rollback entirely in
// memory. It is not evidence of a live database's transaction implementation.
type TransactionOptions = { missing?: boolean; failWrite?: boolean; failCommit?: boolean };
type ChecklistPayload = { cancelChecklist: string[]; [key: string]: unknown };

function checklistTransactionDb(initial: unknown, options: TransactionOptions = {}) {
  const state: { checklist: unknown; profile: Record<string, unknown> | undefined } = {
    checklist: initial,
    profile: options.missing ? undefined : { cancelChecklist: initial },
  };
  let staged = initial;
  let stagedProfile = state.profile;
  const commit = vi.fn();
  const rollback = vi.fn();
  const lock = vi.fn(async (_mode: string) => options.missing ? [] : [{ cancelChecklist: state.checklist }]);
  const selectWhere = vi.fn((_condition: unknown) => ({ for: lock }));
  const from = vi.fn((_table: unknown) => ({ where: selectWhere }));
  const select = vi.fn((_projection: unknown) => ({ from }));
  const updateWhere = vi.fn(async (_condition: unknown) => {
    if (options.failWrite) throw new Error("Synthetic checklist write failure");
  });
  const set = vi.fn((value: ChecklistPayload) => {
    staged = [...value.cancelChecklist];
    stagedProfile = { ...state.profile, ...value, cancelChecklist: staged };
    return { where: updateWhere };
  });
  const update = vi.fn((_table: unknown) => ({ set }));
  const values = vi.fn(async (value: ChecklistPayload & { userId: number }) => {
    staged = [...value.cancelChecklist];
    stagedProfile = { ...value, cancelChecklist: staged };
    if (options.failWrite) throw new Error("Synthetic checklist write failure");
  });
  const insert = vi.fn((_table: unknown) => ({ values }));
  const tx = { select, update, insert };
  const transaction = vi.fn(async (work: (transactionContext: typeof tx) => Promise<unknown>) => {
    staged = state.checklist;
    stagedProfile = state.profile;
    try {
      const result = await work(tx);
      if (options.failCommit) throw new Error("Synthetic transaction commit failure");
      state.checklist = staged;
      state.profile = stagedProfile;
      commit();
      return result;
    } catch (error) {
      staged = state.checklist;
      stagedProfile = state.profile;
      rollback();
      throw error;
    }
  });
  return { transaction, state, tx, lock, from, selectWhere, set, values, updateWhere, commit, rollback };
}

describe("actual updateCancelChecklist optimistic concurrency with synthetic transaction", () => {
  it("locks the profile, accepts the exact expected evidence and persists precisely the submitted checklist", async () => {
    const current = [...LEGACY_ITEMS, SYSTEM_ITEMS[0], SYSTEM_ITEMS[0]];
    const next = [...current, "Revoke: Atlas Travel"];
    const db = checklistTransactionDb(JSON.stringify(current));
    mocks.getDb.mockResolvedValue(db);

    await expect(caller().updateCancelChecklist({ userId: 42, expectedChecklist: current, checklist: next }))
      .resolves.toEqual({ success: true, checklist: next });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.lock).toHaveBeenCalledWith("update");
    expect(db.tx.select).toHaveBeenCalledWith({ cancelChecklist: agentCrmProfiles.cancelChecklist });
    expect(db.from).toHaveBeenCalledWith(agentCrmProfiles);
    expect(db.tx.update).toHaveBeenCalledWith(agentCrmProfiles);
    expect(db.set).toHaveBeenCalledWith({ cancelChecklist: next });
    expect(db.state.checklist).toEqual(next);
    expect(db.commit).toHaveBeenCalledTimes(1);
    expect(db.rollback).not.toHaveBeenCalled();
    for (const condition of [db.selectWhere.mock.calls[0][0], db.updateWhere.mock.calls[0][0]]) {
      expect(new MySqlDialect().sqlToQuery(condition as Parameters<MySqlDialect["sqlToQuery"]>[0]).params).toEqual([42]);
    }
  });

  it("rejects stale evidence with CONFLICT, performs no write and rolls back", async () => {
    const current = [...LEGACY_ITEMS, SYSTEM_ITEMS[0], "Revoke: Atlas Travel"];
    const db = checklistTransactionDb(current);
    mocks.getDb.mockResolvedValue(db);
    await expect(caller().updateCancelChecklist({ userId: 42, expectedChecklist: LEGACY_ITEMS, checklist: SYSTEM_ITEMS }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.lock).toHaveBeenCalledWith("update");
    expect(db.tx.update).not.toHaveBeenCalled();
    expect(db.set).not.toHaveBeenCalled();
    expect(db.state.checklist).toEqual(current);
    expect(db.commit).not.toHaveBeenCalled();
    expect(db.rollback).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing profile with NOT_FOUND without creating or writing a row", async () => {
    const db = checklistTransactionDb(undefined, { missing: true });
    mocks.getDb.mockResolvedValue(db);
    await expect(caller().updateCancelChecklist({ userId: 42, expectedChecklist: [], checklist: SYSTEM_ITEMS }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.tx.update).not.toHaveBeenCalled();
    expect(db.set).not.toHaveBeenCalled();
    expect(db.state.checklist).toBeUndefined();
    expect(db.commit).not.toHaveBeenCalled();
    expect(db.rollback).toHaveBeenCalledTimes(1);
  });

  it("propagates a synthetic write failure and leaves the previous committed evidence unchanged", async () => {
    const current = [...LEGACY_ITEMS];
    const db = checklistTransactionDb(current, { failWrite: true });
    mocks.getDb.mockResolvedValue(db);
    await expect(caller().updateCancelChecklist({ userId: 42, expectedChecklist: current, checklist: ALL_ITEMS }))
      .rejects.toThrow("Synthetic checklist write failure");
    expect(db.set).toHaveBeenCalledWith({ cancelChecklist: ALL_ITEMS });
    expect(db.state.checklist).toEqual(current);
    expect(db.commit).not.toHaveBeenCalled();
    expect(db.rollback).toHaveBeenCalledTimes(1);
  });

  it("supports old callers without expectedChecklist while still locking the existing profile", async () => {
    const db = checklistTransactionDb(LEGACY_ITEMS);
    mocks.getDb.mockResolvedValue(db);
    await expect(caller().updateCancelChecklist({ userId: 42, checklist: ALL_ITEMS }))
      .resolves.toEqual({ success: true, checklist: ALL_ITEMS });
    expect(db.lock).toHaveBeenCalledWith("update");
    expect(db.state.checklist).toEqual(ALL_ITEMS);
  });

  it("treats an empty expected checklist as a real precondition, not as an absent one", async () => {
    const db = checklistTransactionDb([SYSTEM_ITEMS[0]]);
    mocks.getDb.mockResolvedValue(db);
    await expect(caller().updateCancelChecklist({ userId: 42, expectedChecklist: [], checklist: SYSTEM_ITEMS }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.tx.update).not.toHaveBeenCalled();
    expect(db.rollback).toHaveBeenCalledTimes(1);
  });

  it.each([
    { role: null, code: "UNAUTHORIZED" },
    { role: "agent" as const, code: "FORBIDDEN" },
  ])("denies $role checklist mutation before obtaining a database", async ({ role, code }) => {
    await expect(caller(role).updateCancelChecklist({ userId: 42, checklist: ALL_ITEMS }))
      .rejects.toMatchObject({ code });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});

function cancellationDb(initial: unknown = LEGACY_ITEMS, options: TransactionOptions = {}) {
  const transactionDb = checklistTransactionDb(initial, options);
  const readWhere = vi.fn(async (_condition: unknown) => [{ name: "Synthetic Agent", email: null }]);
  const from = vi.fn((table: unknown) => {
    if (table !== users) throw new Error("Unexpected unlocked read in synthetic cancellation DB");
    return { where: readWhere };
  });
  const writeWhere = vi.fn(async (_condition: unknown) => undefined);
  const set = vi.fn((_value: unknown) => ({ where: writeWhere }));
  const update = vi.fn((table: unknown) => {
    if (table !== users) throw new Error("Profile writes must use the synthetic transaction");
    return { set };
  });
  return {
    ...transactionDb,
    select: vi.fn(() => ({ from })),
    update,
    userSet: set,
    userWriteWhere: writeWhere,
  };
}

describe("actual cancellation status mutation persists evidence without live side effects", () => {
  beforeEach(() => {
    mocks.getDb.mockResolvedValue(cancellationDb());
    mocks.getRawDbPool.mockResolvedValue({ execute: mocks.execute });
    mocks.execute.mockResolvedValue([{ insertId: 1 }]);
    mocks.getProfile.mockResolvedValue({ agentStatus: "active", cancelChecklist: JSON.stringify(LEGACY_ITEMS) });
    mocks.saveProfile.mockResolvedValue(undefined);
    mocks.visibility.mockResolvedValue(undefined);
    mocks.email.mockResolvedValue(undefined);
    mocks.notification.mockResolvedValue(undefined);
  });

  it("merges dialog ticks under the profile row lock without deduplicating existing evidence or changing event evidence", async () => {
    const current = [...LEGACY_ITEMS, LEGACY_ITEMS[0], SYSTEM_ITEMS[0], SYSTEM_ITEMS[0]];
    const dialog = [SYSTEM_ITEMS[0], "Revoke: Atlas Travel", "Revoke: Atlas Travel"];
    const merged = [...current, "Revoke: Atlas Travel", "Revoke: Atlas Travel"];
    const db = cancellationDb(JSON.stringify(current));
    mocks.getDb.mockResolvedValue(db);
    mocks.getProfile.mockResolvedValue({ agentStatus: "active", cancelChecklist: JSON.stringify(current) });

    await expect(caller().updateAgentStatus({
      userId: 42,
      newStatus: "cancelled",
      cancelledAt: "2026-01-01T00:00:00.000Z",
      cancelChecklist: dialog,
    })).resolves.toEqual({ success: true });

    expect(mocks.getProfile).toHaveBeenCalledWith(42);
    expect(mocks.saveProfile).not.toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.tx.select).toHaveBeenCalledWith({ cancelChecklist: agentCrmProfiles.cancelChecklist });
    expect(db.from).toHaveBeenCalledWith(agentCrmProfiles);
    expect(db.lock).toHaveBeenCalledWith("update");
    expect(db.tx.update).toHaveBeenCalledWith(agentCrmProfiles);
    expect(db.tx.insert).not.toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith({
      agentStatus: "cancelled",
      cancelledAt: new Date("2026-01-01T00:00:00.000Z"),
      inContract: false,
      pauseEndsAt: null,
      noticeEndsAt: null,
      suspendedAt: null,
      cancelChecklist: merged,
    });
    expect(db.state.checklist).toEqual(merged);
    expect(db.state.profile).toEqual(db.set.mock.calls[0][0]);
    expect(db.commit).toHaveBeenCalledTimes(1);
    expect(db.rollback).not.toHaveBeenCalled();
    for (const condition of [db.selectWhere.mock.calls[0][0], db.updateWhere.mock.calls[0][0]]) {
      expect(new MySqlDialect().sqlToQuery(condition as Parameters<MySqlDialect["sqlToQuery"]>[0]).params).toEqual([42]);
    }
    expect(db.lock.mock.invocationCallOrder[0]).toBeLessThan(db.set.mock.invocationCallOrder[0]);
    expect(db.commit.mock.invocationCallOrder[0]).toBeLessThan(db.update.mock.invocationCallOrder[0]);
    expect(db.update).toHaveBeenCalledWith(users);
    expect(db.userSet).toHaveBeenCalledWith({ portalStatus: "cancelled", isActive: false });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const [query, params] = mocks.execute.mock.calls[0];
    expect(query).toContain("INSERT INTO agent_status_events");
    expect(params.slice(0, 4)).toEqual([42, "active", "cancelled", 9000]);
    expect(params[10]).toBe(JSON.stringify(dialog));
    expect(mocks.visibility).toHaveBeenCalledWith({ userId: 42, agentStatus: "cancelled", actorUserId: 9000 });
    // These are inert spies, not actual email/notification provider calls.
    expect(mocks.email).toHaveBeenCalledTimes(1);
    expect(mocks.notification).toHaveBeenCalledTimes(1);
  });

  it("uses fresh locked evidence rather than a stale unlocked profile, retaining concurrent additions without restoring a cleared tick", async () => {
    const clearedTick = SYSTEM_ITEMS[0];
    const concurrentTick = "Revoke: Beacon Holidays";
    const stale = [...LEGACY_ITEMS, LEGACY_ITEMS[0], clearedTick];
    const current = [...LEGACY_ITEMS, LEGACY_ITEMS[0], concurrentTick];
    const dialog = ["Revoke: Atlas Travel"];
    const db = cancellationDb(JSON.stringify(current));
    mocks.getDb.mockResolvedValue(db);
    mocks.getProfile.mockResolvedValue({ agentStatus: "paused", cancelChecklist: JSON.stringify(stale) });

    await caller().updateAgentStatus({ userId: 42, newStatus: "cancelled", cancelChecklist: dialog });

    expect(mocks.getProfile).toHaveBeenCalledWith(42);
    expect(mocks.getProfile.mock.invocationCallOrder[0]).toBeLessThan(db.lock.mock.invocationCallOrder[0]);
    expect(db.lock).toHaveBeenCalledWith("update");
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: "cancelled", cancelChecklist: [...current, ...dialog],
    }));
    expect(db.state.checklist).toEqual([...current, ...dialog]);
    expect(db.state.checklist).toContain(concurrentTick);
    expect(db.state.checklist).not.toContain(clearedTick);
    expect(mocks.saveProfile).not.toHaveBeenCalled();
    expect(db.commit).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][1].slice(0, 4)).toEqual([42, "paused", "cancelled", 9000]);
    expect(mocks.execute.mock.calls[0][1][10]).toBe(JSON.stringify(dialog));
  });

  it("inserts userId and the full cancellation payload inside the transaction when the locked profile is missing", async () => {
    const dialog = [SYSTEM_ITEMS[0], "Revoke: Atlas Travel", "Revoke: Atlas Travel"];
    const db = cancellationDb(undefined, { missing: true });
    mocks.getDb.mockResolvedValue(db);
    mocks.getProfile.mockResolvedValue(undefined);

    await caller().updateAgentStatus({
      userId: 42, newStatus: "cancelled", cancelledAt: "2026-01-01T00:00:00.000Z", cancelChecklist: dialog,
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.lock).toHaveBeenCalledWith("update");
    expect(db.tx.update).not.toHaveBeenCalled();
    expect(db.tx.insert).toHaveBeenCalledWith(agentCrmProfiles);
    expect(db.values).toHaveBeenCalledWith({
      userId: 42,
      agentStatus: "cancelled",
      cancelledAt: new Date("2026-01-01T00:00:00.000Z"),
      inContract: false,
      pauseEndsAt: null,
      noticeEndsAt: null,
      suspendedAt: null,
      cancelChecklist: dialog,
    });
    expect(db.state.profile).toEqual(db.values.mock.calls[0][0]);
    expect(db.state.checklist).toEqual(dialog);
    expect(db.commit).toHaveBeenCalledTimes(1);
    expect(db.rollback).not.toHaveBeenCalled();
    expect(mocks.saveProfile).not.toHaveBeenCalled();
  });

  it("treats an explicitly empty dialog checklist as transactional and preserves every locked legacy tick", async () => {
    const current = [...LEGACY_ITEMS, LEGACY_ITEMS[0], SYSTEM_ITEMS[0], SYSTEM_ITEMS[0]];
    const db = cancellationDb(current);
    mocks.getDb.mockResolvedValue(db);

    await caller().updateAgentStatus({ userId: 42, newStatus: "cancelled", cancelChecklist: [] });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.lock).toHaveBeenCalledWith("update");
    expect(db.state.checklist).toEqual(current);
    expect(mocks.saveProfile).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls[0][1][10]).toBe("[]");
  });

  it.each([
    { name: "update failure", options: { failWrite: true }, message: "Synthetic checklist write failure" },
    { name: "insert failure", options: { missing: true, failWrite: true }, message: "Synthetic checklist write failure" },
    { name: "commit failure", options: { failCommit: true }, message: "Synthetic transaction commit failure" },
  ])("rolls back $name without any committed profile write or subsequent status side effect", async ({ options, message }) => {
    const current = [...LEGACY_ITEMS, LEGACY_ITEMS[0]];
    const db = cancellationDb(current, options);
    const originalProfile = db.state.profile;
    mocks.getDb.mockResolvedValue(db);

    await expect(caller().updateAgentStatus({ userId: 42, newStatus: "cancelled", cancelChecklist: ALL_ITEMS }))
      .rejects.toThrow(message);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.lock).toHaveBeenCalledWith("update");
    expect(db.set.mock.calls.length + db.values.mock.calls.length).toBe(1);
    expect(db.state.checklist).toEqual(current);
    expect(db.state.profile).toEqual(originalProfile);
    expect(db.commit).not.toHaveBeenCalled();
    expect(db.rollback).toHaveBeenCalledTimes(1);
    expect(mocks.saveProfile).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(mocks.visibility).not.toHaveBeenCalled();
    expect(mocks.getRawDbPool).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
    expect(mocks.notification).not.toHaveBeenCalled();
  });

  it("does not overwrite the existing checklist when the cancellation dialog omits it", async () => {
    const db = cancellationDb();
    mocks.getDb.mockResolvedValue(db);
    await caller().updateAgentStatus({ userId: 42, newStatus: "cancelled" });
    expect(mocks.saveProfile).toHaveBeenCalledTimes(1);
    expect(mocks.saveProfile).toHaveBeenCalledWith(42, expect.objectContaining({ agentStatus: "cancelled" }));
    const saved = mocks.saveProfile.mock.calls[0][1];
    expect(saved).not.toHaveProperty("cancelChecklist");
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.tx.select).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls[0][1][10]).toBeNull();
  });

  it("does not persist submitted cancellation evidence on an unrelated status change", async () => {
    const db = cancellationDb();
    mocks.getDb.mockResolvedValue(db);
    await caller().updateAgentStatus({ userId: 42, newStatus: "suspended", cancelChecklist: ALL_ITEMS });
    expect(mocks.saveProfile).toHaveBeenCalledTimes(1);
    const saved = mocks.saveProfile.mock.calls[0][1];
    expect(saved).toMatchObject({ agentStatus: "suspended" });
    expect(saved).not.toHaveProperty("cancelChecklist");
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.tx.select).not.toHaveBeenCalled();
  });
});
