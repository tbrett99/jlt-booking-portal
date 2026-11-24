import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { createHqLiveConfig } from "./management-hq-live-config";
import { createHqLiveService } from "./management-hq-live-service";
import {
  createManagementHqSyncHandler,
  registerManagementHqSyncRoute,
  HQ_SYNC_PATH,
} from "./management-hq-sync-route";
const token = "offline-portal-token-" + "t".repeat(40);
const env = {
  HQ_LIVE_SYNC_ENABLED: "true",
  HQ_LIVE_READ_ENABLED: "false",
  HQ_ORBIT_REPORTING_BASE_URL:
    "https://reporting.orbittravel.co.uk/api/management-hq",
  HQ_ORBIT_REPORTING_API_KEY: "offline-orbit-key-" + "k".repeat(40),
  HQ_PORTAL_SYNC_TOKEN: token,
};
function request(patch: Record<string, any> = {}, chunks: string[] = []) {
  const req: any = Readable.from(chunks.map(chunk => Buffer.from(chunk)));
  Object.assign(
    req,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      rawHeaders: ["Authorization", `Bearer ${token}`],
    },
    patch
  );
  return req;
}
function response() {
  return {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any;
}
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  expect(process.env.DATABASE_URL).toBeUndefined();
  network = vi.fn(() => {
    throw new Error("provider forbidden");
  });
  vi.stubGlobal("fetch", network);
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
function setup(settings: Record<string, string> = env) {
  const config = createHqLiveConfig(settings);
  const createStore = vi.fn(() => {
    throw new Error("dependency forbidden before authorization");
  });
  const service = createHqLiveService({ config, createStore });
  const invoke = vi
    .spyOn(service, "invoke")
    .mockResolvedValue({ status: "applied" });
  return {
    service,
    invoke,
    createStore,
    handle: createManagementHqSyncHandler(() => service),
  };
}
describe("finite protected Management HQ external callback", () => {
  it.each([
    {},
    { HQ_LIVE_SYNC_ENABLED: "true" },
    { ...env, HQ_LIVE_SYNC_ENABLED: "TRUE" },
    { ...env, HQ_PORTAL_SYNC_TOKEN: "short" },
    { ...env, HQ_LIVE_SYNC_ENABLED: "false" },
  ])(
    "disabled/missing/invalid configuration denies before invoke or dependency reads %j",
    async settings => {
      const s = setup(settings),
        res = response();
      await s.handle(request(), res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(s.invoke).not.toHaveBeenCalled();
      expect(s.createStore).not.toHaveBeenCalled();
    }
  );
  it.each([
    undefined,
    "bearer " + token,
    "Bearer wrong-token-" + "w".repeat(40),
    ["Bearer " + token],
    "Bearer " + "a".repeat(257),
    "Bearer " + token + " ",
  ])("strict bearer header denies %j before invoke", async header => {
    const s = setup(),
      res = response();
    await s.handle(request({ headers: { authorization: header } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(s.invoke).not.toHaveBeenCalled();
    expect(s.createStore).not.toHaveBeenCalled();
  });
  it("rejects duplicate Authorization headers", async () => {
    const s = setup(),
      res = response();
    await s.handle(
      request({
        rawHeaders: [
          "Authorization",
          `Bearer ${token}`,
          "authorization",
          `Bearer ${token}`,
        ],
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(s.invoke).not.toHaveBeenCalled();
  });
  it.each(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"])(
    "only exact POST is handled, not %s",
    async method => {
      const s = setup(),
        res = response();
      await s.handle(request({ method }), res);
      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith("Allow", "POST");
      expect(s.invoke).not.toHaveBeenCalled();
    }
  );
  it.each(["notdue", "busy", "progress", "applied"] as const)(
    "handled %s returns minimal safe 200",
    async status => {
      const s = setup();
      s.invoke.mockResolvedValue({ status, errorCode: "TIMEOUT" });
      const res = response();
      await s.handle(request(), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ok: true, status });
      expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
      expect(res.setHeader).toHaveBeenCalledWith(
        "X-Content-Type-Options",
        "nosniff"
      );
    }
  );
  it.each([
    "{malformed JSON",
    JSON.stringify({
      ownerUserId: 47,
      datasetId: "sample:47",
      limits: 999999,
      sourceURL: "https://evil.test",
      cursor: "private",
      keys: "secret",
    }),
  ])("body is never parsed or passed to the runner %s", async body => {
    const s = setup(),
      res = response();
    await s.handle(request({}, [body]), res);
    expect(s.invoke.mock.calls).toEqual([[]]);
    expect(res.json).toHaveBeenCalledWith({ ok: true, status: "applied" });
  });
  it.each(["1025", "-1", "1e4", "1.5"])(
    "invalid or oversized Content-Length %s denies before invoke",
    async length => {
      const s = setup(),
        res = response();
      await s.handle(
        request({
          headers: {
            authorization: `Bearer ${token}`,
            "content-length": length,
          },
        }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(413);
      expect(s.invoke).not.toHaveBeenCalled();
    }
  );
  it("counts raw streamed body bytes with no Content-Length", async () => {
    const s = setup(),
      res = response();
    await s.handle(request({}, ["a".repeat(1024), "b"]), res);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(s.invoke).not.toHaveBeenCalled();
  });
  it("needs_attention returns 503 with whitelist code and fixed minimal message", async () => {
    const s = setup();
    s.invoke.mockResolvedValue({
      status: "needs_attention",
      errorCode: "INVALID_PERSISTED_STATE",
    });
    const res = response();
    await s.handle(request(), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      status: "needs_attention",
      errorCode: "INVALID_PERSISTED_STATE",
      message: "Management HQ synchronisation needs attention.",
    });
  });
  it("runner exceptions and unknown diagnostic codes disclose no raw source or SQL errors", async () => {
    const s = setup(),
      res = response();
    s.invoke.mockRejectedValue(
      new Error(
        "provider key secret customer@example.test SELECT state FROM private"
      )
    );
    await s.handle(request(), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(res.json.mock.calls)).not.toMatch(
      /secret|customer@|SELECT|private/
    );
    s.invoke.mockResolvedValue({
      status: "needs_attention",
      errorCode: "SECRET_SQL" as any,
    });
    const second = response();
    await s.handle(request(), second);
    expect(JSON.stringify(second.json.mock.calls)).not.toContain("SECRET_SQL");
  });
  it("registers exact route and mount precedes general body parser and static fallback", () => {
    const app: any = { all: vi.fn() };
    registerManagementHqSyncRoute(app);
    expect(app.all.mock.calls[0][0]).toBe(HQ_SYNC_PATH);
    const index = readFileSync(
      new URL("./_core/index.ts", import.meta.url),
      "utf8"
    );
    expect(index.indexOf("registerManagementHqSyncRoute(app)")).toBeLessThan(
      index.indexOf("app.use(express.json")
    );
    expect(index.indexOf("registerManagementHqSyncRoute(app)")).toBeLessThan(
      index.indexOf("await setupVite")
    );
    const health = readFileSync(
      new URL("./_core/systemRouter.ts", import.meta.url),
      "utf8"
    );
    expect(health).toContain("managementHqProductionWiring: 1");
    expect(health).not.toContain("HQ_LIVE_");
  });
});
