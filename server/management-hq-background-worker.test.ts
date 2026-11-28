import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const m = vi.hoisted(() => ({
  createPool: vi.fn(),
  execute: vi.fn(),
  end: vi.fn(),
  createCoordinator: vi.fn(),
  run: vi.fn(),
  options: null as any,
}));
vi.mock("mysql2/promise", () => ({ createPool: m.createPool }));
vi.mock("dotenv/config", () => ({}));
vi.mock("./management-hq-background", async () => {
  const actual = await vi.importActual<any>("./management-hq-background");
  return {
    ...actual,
    createHqBackgroundCoordinator: (options: any) => {
      m.options = options;
      m.createCoordinator(options);
      return { run: m.run };
    },
  };
});
let info: ReturnType<typeof vi.spyOn>, errors: ReturnType<typeof vi.spyOn>;
let oldExit: number | string | undefined;
let oldTerm: NodeJS.SignalsListener[], oldInt: NodeJS.SignalsListener[];
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  oldExit = process.exitCode;
  process.exitCode = undefined;
  oldTerm = process.listeners("SIGTERM") as NodeJS.SignalsListener[];
  oldInt = process.listeners("SIGINT") as NodeJS.SignalsListener[];
  vi.stubEnv(
    "DATABASE_URL",
    "mysql://synthetic-not-used@invalid.invalid/synthetic"
  );
  vi.stubEnv("HQ_INITIAL_BACKGROUND_ENABLED", "true");
  m.createPool.mockReturnValue({ execute: m.execute, end: m.end });
  m.end.mockResolvedValue(undefined);
  m.execute.mockResolvedValue([
    [{ id: 47, role: "super_admin", isActive: 1, portalStatus: "active" }],
  ]);
  m.run.mockResolvedValue({ status: "idle", batches: 0 });
  m.options = null;
  info = vi.spyOn(console, "log").mockImplementation(() => {});
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const f of process.listeners("SIGTERM"))
    if (!oldTerm.includes(f as NodeJS.SignalsListener))
      process.removeListener("SIGTERM", f);
  for (const f of process.listeners("SIGINT"))
    if (!oldInt.includes(f as NodeJS.SignalsListener))
      process.removeListener("SIGINT", f);
  process.exitCode = oldExit;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const load = async () => {
  await import("../scripts/management-hq-background-worker");
};
const settled = () => vi.waitFor(() => expect(m.end).toHaveBeenCalledTimes(1));

describe("finite background worker entry", () => {
  it.each([undefined, "false"])(
    "defaults off with flag %s and does not create a pool or import",
    async flag => {
      vi.stubEnv("HQ_INITIAL_BACKGROUND_ENABLED", flag);
      await load();
      expect(m.createPool).not.toHaveBeenCalled();
      expect(m.run).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(
        "[HQ initial background] disabled; no import started."
      );
    }
  );
  it("invalid flag fails safely before creating any database pool", async () => {
    vi.stubEnv("HQ_INITIAL_BACKGROUND_ENABLED", "TRUE");
    await load();
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(m.createPool).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      "[HQ initial background] stopped; check protected Management HQ status."
    );
  });
  it("closes the bounded private pool after a normal finite run", async () => {
    await load();
    await settled();
    expect(m.createPool).toHaveBeenCalledWith({
      uri: process.env.DATABASE_URL,
      connectionLimit: 3,
      waitForConnections: true,
      queueLimit: 10,
      connectTimeout: 10000,
      timezone: "Z",
    });
    expect(m.run).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
    expect(process.listeners("SIGTERM")).toEqual(oldTerm);
    expect(process.listeners("SIGINT")).toEqual(oldInt);
  });
  it("uses only parameterized fresh initiating-user authority, not email or booking attribution", async () => {
    m.run.mockImplementation(async () => {
      await m.options.authorize(47);
      return { status: "queued", batches: 1 };
    });
    await load();
    await settled();
    expect(m.execute).toHaveBeenCalledWith(
      "SELECT id,role,isActive,portalStatus FROM users WHERE id = ? LIMIT 2",
      [47]
    );
    expect(errors).not.toHaveBeenCalled();
  });
  it.each([
    [],
    [{ id: 47, role: "admin", isActive: 1, portalStatus: "active" }],
    [{ id: 47, role: "super_admin", isActive: 0, portalStatus: "active" }],
    [{ id: 47, role: "super_admin", isActive: 1, portalStatus: "cancelled" }],
    [{ id: 48, role: "super_admin", isActive: 1, portalStatus: "active" }],
  ])(
    "fresh revoked/missing/mismatched actor fails and closes the pool: %j",
    async (...rowArgs) => {
      const rows =
        rowArgs.length === 1 && Array.isArray(rowArgs[0])
          ? rowArgs[0]
          : rowArgs;
      m.execute.mockResolvedValue([rows]);
      m.run.mockImplementation(async () => {
        await m.options.authorize(47);
        return { status: "completed", batches: 1 };
      });
      await load();
      await settled();
      await vi.waitFor(() => expect(process.exitCode).toBe(1));
      expect(info).not.toHaveBeenCalled();
    }
  );
  it.each(["SIGTERM", "SIGINT"] as const)(
    "%s latches stopped authority and is removed on settlement",
    async signal => {
      m.run.mockImplementation(async () => {
        const original = signal === "SIGTERM" ? oldTerm : oldInt;
        const handler = process
          .listeners(signal)
          .find(f => !original.includes(f as NodeJS.SignalsListener));
        expect(handler).toBeDefined();
        handler!(signal);
        await expect(m.options.authorize(47)).rejects.toThrow();
        expect(m.execute).not.toHaveBeenCalled();
        return { status: "failed", batches: 0 };
      });
      await load();
      await settled();
      expect(process.exitCode).toBe(1);
    }
  );
  it("never logs arbitrary database/provider details even when run and pool shutdown reject", async () => {
    m.run.mockRejectedValue(
      new Error(
        "private-key person@example.test SELECT https://private.invalid"
      )
    );
    m.end.mockRejectedValue(
      new Error("mysql://private-password@private.invalid")
    );
    await load();
    await settled();
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(
      /private-key|person@|SELECT|https:|mysql:|private-password/
    );
  });
  it("the worker imports no web bootstrap, operational database helper, scheduler or migration", () => {
    const text = readFileSync(
      new URL("../scripts/management-hq-background-worker.ts", import.meta.url),
      "utf8"
    );
    const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map(
      m => m[1]
    );
    expect(imports).toEqual([
      "mysql2/promise",
      "../server/management-hq-background",
      "../server/management-hq-live-store",
      "../server/management-hq-read-deadline",
    ]);
    expect(text).not.toMatch(/(?:setInterval|setTimeout|node-cron)\s*\(/);
  });
});
