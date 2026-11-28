import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  createPool: vi.fn(),
  execute: vi.fn(),
  pool: null as any,
}));
vi.mock("mysql2/promise", () => ({ createPool: m.createPool }));
const URI = "mysql://synthetic-unused@invalid.invalid/synthetic";
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", URI);
  m.pool = { execute: m.execute };
  m.createPool.mockReturnValue(m.pool);
  m.execute.mockResolvedValue([
    [{ id: 47, role: "super_admin", isActive: 1, portalStatus: "active" }],
  ]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const load = () => import("./management-hq-background-pool");
describe("background reporting pool binding", () => {
  it("module import creates no pool, performs no SQL and starts no operational migration", async () => {
    await load();
    expect(m.createPool).not.toHaveBeenCalled();
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("lazily owns one bounded pool for the unchanged startup database URL", async () => {
    const api = await load();
    expect(api.getHqBackgroundPool()).toBe(m.pool);
    expect(api.getHqBackgroundPool()).toBe(m.pool);
    expect(m.createPool).toHaveBeenCalledTimes(1);
    expect(m.createPool).toHaveBeenCalledWith({
      uri: URI,
      connectionLimit: 3,
      waitForConnections: true,
      queueLimit: 10,
      connectTimeout: 10000,
      timezone: "Z",
    });
  });
  it("missing startup URL cannot be supplied later to silently switch databases", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    const api = await load();
    vi.stubEnv("DATABASE_URL", URI);
    expect(() => api.getHqBackgroundPool()).toThrow();
    expect(m.createPool).not.toHaveBeenCalled();
  });
  it("cached pool cannot survive a URL rotation, or create a second pool for a new database", async () => {
    const api = await load();
    api.getHqBackgroundPool();
    vi.stubEnv("DATABASE_URL", URI + "-changed");
    expect(() => api.getHqBackgroundPool()).toThrow();
    expect(m.createPool).toHaveBeenCalledTimes(1);
    await expect(api.requireHqBackgroundActor(m.pool, 47)).rejects.toThrow();
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("queries fresh actor authority in the supplied reporting pool using only the exact ID and four fields", async () => {
    const api = await load();
    await api.requireHqBackgroundActor(m.pool, 47);
    expect(m.execute).toHaveBeenCalledWith(
      "SELECT id,role,isActive,portalStatus FROM users WHERE id = ? LIMIT 2",
      [47]
    );
  });
  it.each([0, -1, 1.5, NaN, "47", null])(
    "rejects malformed actor ID %s before SQL",
    async id => {
      const api = await load();
      await expect(
        api.requireHqBackgroundActor(m.pool, id as any)
      ).rejects.toThrow();
      expect(m.execute).not.toHaveBeenCalled();
    }
  );
  it.each([
    { id: 48, role: "super_admin", isActive: 1, portalStatus: "active" },
    { id: 47, role: "admin", isActive: 1, portalStatus: "active" },
    { id: 47, role: "super_admin", isActive: 0, portalStatus: "active" },
    { id: 47, role: "super_admin", isActive: 1, portalStatus: "cancelled" },
  ])("rejects fresh missing authority %j", async row => {
    const api = await load();
    m.execute.mockResolvedValue([[row]]);
    await expect(api.requireHqBackgroundActor(m.pool, 47)).rejects.toThrow();
  });
  it("rejects zero or duplicate rows", async () => {
    const api = await load();
    for (const rows of [[], [{ id: 47 }, { id: 47 }]]) {
      m.execute.mockResolvedValue([rows]);
      await expect(api.requireHqBackgroundActor(m.pool, 47)).rejects.toThrow();
    }
  });
  it.each([false, true])(
    "checks database binding after a %s-rejected read",
    async reject => {
      const api = await load();
      m.execute.mockImplementation(async () => {
        process.env.DATABASE_URL = URI + "-changed";
        if (reject) throw new Error("raw-provider-password SELECT private");
        return [
          [
            {
              id: 47,
              role: "super_admin",
              isActive: 1,
              portalStatus: "active",
            },
          ],
        ];
      });
      let caught: any;
      try {
        await api.requireHqBackgroundActor(m.pool, 47);
      } catch (e) {
        caught = e;
      }
      expect(caught.code).toBe("STORE_UNAVAILABLE");
      expect(caught.message).not.toMatch(
        /raw-provider-password|SELECT|private/
      );
    }
  );
});
