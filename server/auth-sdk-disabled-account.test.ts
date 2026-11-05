import { beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "../shared/const";
const mocks = vi.hoisted(() => ({ user: vi.fn(), upsert: vi.fn(), archived: vi.fn() }));
vi.mock("./db", () => ({ getUserByOpenId: mocks.user, upsertUser: mocks.upsert }));
vi.mock("./agent-merge-identity", () => ({ assertAgentNotMerged: mocks.archived }));
vi.mock("./_core/env", () => ({ ENV: { oAuthServerUrl: "https://auth.example.test", appId: "synthetic-app" } }));
import { sdk } from "./_core/sdk";

const request = { headers: { cookie: `${COOKIE_NAME}=INERT_SESSION` } } as any;
const user = { id: 47, openId: "synthetic-open-id", name: "Synthetic admin", role: "super_admin", isActive: true, portalStatus: "active" } as any;
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks();
  vi.spyOn(sdk, "verifySession").mockResolvedValue({ openId: user.openId, appId: "synthetic-app", name: user.name });
  mocks.user.mockResolvedValue(user); mocks.archived.mockResolvedValue(undefined); mocks.upsert.mockResolvedValue(undefined);
});
describe("SDK session boundary uses current account deactivation", () => {
  it.each(["super_admin", "admin", "agent"])("rejects inactive %s before sign-in updates or downstream access", async role => {
    mocks.user.mockResolvedValue({ ...user, role, isActive: false });
    await expect(sdk.authenticateRequest(request)).rejects.toThrow("This account is inactive");
    expect(mocks.upsert).not.toHaveBeenCalled(); expect(mocks.archived).not.toHaveBeenCalled();
  });
  it("fails closed when a real account's active state is not verified", async () => {
    mocks.user.mockResolvedValue({ ...user, isActive: undefined });
    await expect(sdk.authenticateRequest(request)).rejects.toThrow("This account is inactive");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("preserves an active Super Admin session and identity", async () => {
    await expect(sdk.authenticateRequest(request)).resolves.toBe(user);
    expect(mocks.archived).toHaveBeenCalledWith(47);
    expect(mocks.upsert).toHaveBeenCalledWith({ openId: user.openId, lastSignedIn: expect.any(Date) });
  });
});
