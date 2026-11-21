import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStaffCallsSyncHandler,
  staffCallSyncAuthorized,
} from "./staff-calls-sync-route";
const key = "synthetic-test-token-not-a-real-key-000000000";
afterEach(() => vi.unstubAllEnvs());
describe("staff call sync callback", () => {
  it.each([undefined, "", "short"])(
    "missing or weak configured token disables synchronization",
    secret => {
      expect(staffCallSyncAuthorized(`Bearer ${key}`, secret)).toBe(false);
    }
  );
  it.each([
    undefined,
    [key],
    key,
    `bearer ${key}`,
    `Bearer ${key}x`,
    `Bearer ${"x".repeat(600)}`,
  ])("rejects malformed or incorrect credentials", supplied => {
    expect(staffCallSyncAuthorized(supplied, key)).toBe(false);
  });
  it("accepts only the exact dedicated bearer token", () =>
    expect(staffCallSyncAuthorized(`Bearer ${key}`, key)).toBe(true));
  it("does not dispatch any work for unauthorized callers", async () => {
    vi.stubEnv("JLT_STAFF_CAL_SYNC_TOKEN", key);
    const run = vi.fn();
    const res: any = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    await createStaffCallsSyncHandler(run)({ headers: {} } as any, res);
    expect(run).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it("ignores caller body identifiers and provider URLs", async () => {
    vi.stubEnv("JLT_STAFF_CAL_SYNC_TOKEN", key);
    const run = vi.fn().mockResolvedValue({ privateNotes: "do not return" });
    const res: any = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    await createStaffCallsSyncHandler(run)(
      {
        headers: { authorization: `Bearer ${key}` },
        body: { actorId: 47, limit: 99999, url: "https://example.invalid" },
      } as any,
      res
    );
    expect(run).toHaveBeenCalledWith();
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
  it("does not serialize private provider/database failures", async () => {
    vi.stubEnv("JLT_STAFF_CAL_SYNC_TOKEN", key);
    const run = vi
      .fn()
      .mockRejectedValue(new Error("private-notes/api-key/SQL"));
    const res: any = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    await createStaffCallsSyncHandler(run)(
      { headers: { authorization: `Bearer ${key}` } } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(res.json.mock.calls)).not.toMatch(
      /private-notes|api-key|SQL/
    );
  });
});
