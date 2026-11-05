import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: mocks.authenticate } }));
import { createContext } from "./_core/context";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";

const options = { req: { headers: {} }, res: {} } as any;
const api = router({ public: publicProcedure.query(() => true), private: protectedProcedure.query(() => true), admin: adminProcedure.query(() => true) });
const account = (role = "super_admin") => ({ id: 47, openId: "synthetic-account", name: "Synthetic User", role,
  isActive: true, portalStatus: "active", mustChangePassword: false } as any);
beforeEach(() => { vi.resetAllMocks(); mocks.authenticate.mockResolvedValue(account()); });

describe("disabled-account session deactivation", () => {
  it.each(["super_admin", "admin", "agent"])("rejects old %s sessions when the fresh account is inactive", async role => {
    mocks.authenticate.mockResolvedValue({ ...account(role), isActive: false });
    const context = await createContext(options); expect(context.user).toBeNull();
    await expect(api.createCaller(context).private()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(api.createCaller(context).admin()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.createCaller(context).public()).resolves.toBe(true);
  });
  it.each(["super_admin", "admin", "agent"])("preserves an active %s's authenticated identity", async role => {
    const user = account(role); mocks.authenticate.mockResolvedValue(user);
    const context = await createContext(options); expect(context.user).toBe(user);
    await expect(api.createCaller(context).private()).resolves.toBe(true);
  });
  it.each(["paused", "suspended", "cancelled"])("retains the existing %s access block", async portalStatus => {
    mocks.authenticate.mockResolvedValue({ ...account(), portalStatus });
    expect((await createContext(options)).user).toBeNull();
  });
  it("fails closed for missing real-account active state", async () => {
    mocks.authenticate.mockResolvedValue({ ...account(), isActive: undefined });
    expect((await createContext(options)).user).toBeNull();
  });
  it("preserves the SDK's already-verified synthetic cron identity without widening its role", async () => {
    const cron = { id: -1, openId: "cron_test", role: "agent", isCron: true, taskUid: "synthetic-task" };
    mocks.authenticate.mockResolvedValue(cron); const context = await createContext(options);
    expect(context.user).toBe(cron); await expect(api.createCaller(context).private()).resolves.toBe(true);
    await expect(api.createCaller(context).admin()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps unauthenticated public calls available when authentication fails", async () => {
    mocks.authenticate.mockRejectedValue(new Error("Synthetic authentication error"));
    const context = await createContext(options); expect(context.user).toBeNull();
    await expect(api.createCaller(context).public()).resolves.toBe(true);
  });
});
