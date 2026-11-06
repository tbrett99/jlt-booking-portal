import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getRawDbPool: vi.fn(),
  getCatalog: vi.fn(),
  addOption: vi.fn(),
  staffSnapshot: vi.fn(),
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
  addSupplierLogin: vi.fn(),
  updateSupplierLogin: vi.fn(),
  deleteSupplierLogin: vi.fn(),
  email: vi.fn(),
  notification: vi.fn(),
  visibility: vi.fn(),
}));

// Follow the actual crm-memberships-offboarding router-test convention: replace
// entire DB/provider modules, and leave unrelated helpers unavailable. Do not
// import appRouter (which would bring unrelated routers and integrations in).
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
  addAgentSupplierLogin: mocks.addSupplierLogin,
  updateAgentSupplierLogin: mocks.updateSupplierLogin,
  deleteAgentSupplierLogin: mocks.deleteSupplierLogin,
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
// Positive additive grants are deliberately available. They must not be consulted
// to broaden this router's full-admin guard (nor reach any real grant storage).
vi.mock("./staff-access", () => ({
  getStaffAccessSnapshot: mocks.staffSnapshot,
}));
vi.mock("./supplier-access-catalog", () => ({
  getSupplierAccessCatalog: mocks.getCatalog,
  addSupplierAccessOption: mocks.addOption,
}));

import { crmRouter } from "./crm-router";

type Role = "admin" | "super_admin" | "agent" | null;
type StaffAccess = {
  instructor: boolean;
  engagement: boolean;
  courseIds: number[];
  schemaAvailable: boolean;
};
function caller(role: Role, staffAccess?: StaffAccess) {
  return crmRouter.createCaller({
    user: role
      ? {
          id: 9000,
          role,
          name: "Synthetic Staff",
          isActive: true,
          portalStatus: "active",
          mustChangePassword: false,
          crmAccess: true,
        }
      : null,
    // Client-provided additive flags must never replace the persisted base role.
    ...(staffAccess ? { staffAccess } : {}),
    req: {},
    res: {},
  } as TrpcContext).agentCrm;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getDb.mockImplementation(() => {
    throw new Error("No DB calls are allowed in catalog procedure tests");
  });
  mocks.getRawDbPool.mockImplementation(() => {
    throw new Error("No raw queries are allowed in catalog procedure tests");
  });
  mocks.getCatalog.mockResolvedValue({
    names: ["Global Tours", "Shared Holidays"],
  });
  mocks.addOption.mockResolvedValue({
    name: "New Supplier",
    alreadyExists: false,
  });
});

function expectNoUnrelatedSideEffects() {
  for (const spy of [
    mocks.getDb,
    mocks.getRawDbPool,
    mocks.getProfile,
    mocks.saveProfile,
    mocks.addSupplierLogin,
    mocks.updateSupplierLogin,
    mocks.deleteSupplierLogin,
    mocks.email,
    mocks.notification,
    mocks.visibility,
  ])
    expect(spy).not.toHaveBeenCalled();
}

const DENIED = [
  {
    label: "anonymous",
    role: null,
    code: "UNAUTHORIZED",
    instructor: false,
    engagement: false,
  },
  {
    label: "ordinary agent with CRM access",
    role: "agent",
    code: "FORBIDDEN",
    instructor: false,
    engagement: false,
  },
  {
    label: "agent with Instructor grant and an assigned course",
    role: "agent",
    code: "FORBIDDEN",
    instructor: true,
    engagement: false,
  },
  {
    label: "agent with Agent Engagement grant",
    role: "agent",
    code: "FORBIDDEN",
    instructor: false,
    engagement: true,
  },
  {
    label: "agent with both additive staff grants",
    role: "agent",
    code: "FORBIDDEN",
    instructor: true,
    engagement: true,
  },
] as const;

describe("actual crmRouter.agentCrm supplier catalog full-admin guards", () => {
  it.each(DENIED)(
    "denies $label query before service or DB access",
    async ({ role, code, instructor, engagement }) => {
      const access = {
        instructor,
        engagement,
        courseIds: instructor ? [77] : [],
        schemaAvailable: true,
      };
      mocks.staffSnapshot.mockResolvedValue(access);
      await expect(
        caller(role, access).getSupplierAccessCatalog()
      ).rejects.toMatchObject({ code });
      expect(mocks.getCatalog).not.toHaveBeenCalled();
      expect(mocks.addOption).not.toHaveBeenCalled();
      expect(mocks.staffSnapshot).not.toHaveBeenCalled();
      expectNoUnrelatedSideEffects();
    }
  );

  it.each(DENIED)(
    "denies $label mutation before service or DB access",
    async ({ role, code, instructor, engagement }) => {
      const access = {
        instructor,
        engagement,
        courseIds: instructor ? [77] : [],
        schemaAvailable: true,
      };
      mocks.staffSnapshot.mockResolvedValue(access);
      await expect(
        caller(role, access).addSupplierAccessOption({ name: "New Supplier" })
      ).rejects.toMatchObject({ code });
      expect(mocks.getCatalog).not.toHaveBeenCalled();
      expect(mocks.addOption).not.toHaveBeenCalled();
      expect(mocks.staffSnapshot).not.toHaveBeenCalled();
      expectNoUnrelatedSideEffects();
    }
  );

  it("exposes the catalog read as a query and add as a mutation on the actual router", () => {
    const procedures = crmRouter._def.procedures;
    expect(procedures["agentCrm.getSupplierAccessCatalog"]._def.type).toBe(
      "query"
    );
    expect(procedures["agentCrm.addSupplierAccessOption"]._def.type).toBe(
      "mutation"
    );
  });

  it.each(["admin", "super_admin"] as const)(
    "allows %s catalog query and delegates directly to the service",
    async role => {
      await expect(caller(role).getSupplierAccessCatalog()).resolves.toEqual({
        names: ["Global Tours", "Shared Holidays"],
      });
      expect(mocks.getCatalog).toHaveBeenCalledTimes(1);
      expect(mocks.getCatalog).toHaveBeenCalledWith();
      expect(mocks.addOption).not.toHaveBeenCalled();
      expectNoUnrelatedSideEffects();
    }
  );

  it.each(["admin", "super_admin"] as const)(
    "allows %s add and passes the authenticated actor, not a supplied creator",
    async role => {
      const input = {
        name: "  New Supplier  ",
        createdById: 123,
        actorId: 456,
      };
      await expect(
        caller(role).addSupplierAccessOption(input)
      ).resolves.toEqual({ name: "New Supplier", alreadyExists: false });
      expect(mocks.addOption).toHaveBeenCalledTimes(1);
      expect(mocks.addOption).toHaveBeenCalledWith("  New Supplier  ", 9000);
      expect(mocks.getCatalog).not.toHaveBeenCalled();
      expectNoUnrelatedSideEffects();
    }
  );

  it("returns the service's existing-name result rather than claiming a new insert", async () => {
    mocks.addOption.mockResolvedValue({
      name: "Atlas Travel",
      alreadyExists: true,
    });
    await expect(
      caller("admin").addSupplierAccessOption({ name: "atlas travel" })
    ).resolves.toEqual({ name: "Atlas Travel", alreadyExists: true });
    expect(mocks.addOption).toHaveBeenCalledWith("atlas travel", 9000);
    expectNoUnrelatedSideEffects();
  });

  it.each([{ name: "" }, { name: "a".repeat(501) }, { name: 42 }, {}])(
    "rejects malformed mutation input %j before service access",
    async input => {
      await expect(
        caller("admin").addSupplierAccessOption(input as { name: string })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(mocks.addOption).not.toHaveBeenCalled();
      expectNoUnrelatedSideEffects();
    }
  );

  it("retains service validation ownership for whitespace/control/120-character checks", async () => {
    const { TRPCError } = await import("@trpc/server");
    mocks.addOption.mockRejectedValue(
      new TRPCError({
        code: "BAD_REQUEST",
        message: "Synthetic safe supplier name validation",
      })
    );
    for (const name of ["   ", "Atlas\nTravel", "a".repeat(121)]) {
      await expect(
        caller("admin").addSupplierAccessOption({ name })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(mocks.addOption).toHaveBeenLastCalledWith(name, 9000);
    }
    expectNoUnrelatedSideEffects();
  });

  it("preserves the service's sanitized catalog error without executing unrelated fallback work", async () => {
    const { TRPCError } = await import("@trpc/server");
    const message =
      "The supplier list is temporarily unavailable. Please retry; no agent access has been changed.";
    mocks.getCatalog.mockRejectedValue(
      new TRPCError({ code: "INTERNAL_SERVER_ERROR", message })
    );
    await expect(
      caller("admin").getSupplierAccessCatalog()
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message });
    expect(mocks.getCatalog).toHaveBeenCalledTimes(1);
    expectNoUnrelatedSideEffects();
  });
});
