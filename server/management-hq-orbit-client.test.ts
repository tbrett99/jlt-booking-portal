import {
  afterEach,
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createServer, type Server } from "node:http";
import { inspect } from "node:util";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import {
  HqOrbitClient,
  safeHqRetryAfter,
  HqContractError,
} from "./management-hq-orbit-client";
import { HQ_WIRE_MAX_PAYLOAD_BYTES as HQ_MAX_PAYLOAD_BYTES } from "./management-hq-wire-contract";
const examples = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/management-hq-wire-http-examples.json",
      import.meta.url
    ),
    "utf8"
  )
);
const fixture = (): any => structuredClone(examples.beforeAmendment.body);
const changed = (): any => structuredClone(examples.afterAmendment.body);
const COMPANY_SCOPE = "company_all_real_and_unattributed";
const TEST_KEY = "SYNTHETIC-REPORTING-KEY-32-CHARS-ONLY";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const jsonResponse = (value: unknown = fixture()) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
function injected(fetcher: typeof fetch, enabled = true): HqOrbitClient {
  return new HqOrbitClient({
    baseUrl: "https://fixture.test/api/reporting/v1",
    apiKey: "SYNTHETIC-REPORTING-KEY-32-CHARS-ONLY",
    scopeId: COMPANY_SCOPE,
    fetcher,
    allowFixtureTransport: true,
    enabled,
  });
}
describe("isolated reporting transport: no live provider calls", () => {
  it("requires explicit enabled:true without touching transport", async () => {
    const f = vi.fn(async () => jsonResponse());
    await expect(injected(f, false).bookings()).rejects.toMatchObject({
      code: "CLIENT_DISABLED",
    });
    expect(f).not.toHaveBeenCalled();
    const liveDisabled = new HqOrbitClient({
      baseUrl: "https://approved-server.example.org/api/reporting/v1",
      apiKey: TEST_KEY,
      scopeId: COMPANY_SCOPE,
    });
    await expect(liveDisabled.bookings()).rejects.toMatchObject({
      code: "CLIENT_DISABLED",
    });
  });
  it("never exposes credentials to serialize/inspect", () => {
    const client = injected(vi.fn(async () => jsonResponse()));
    expect(JSON.stringify(client)).toBe("{}");
    expect(inspect(client, { showHidden: true })).not.toMatch(
      /SYNTHETIC|fixture.test|scopeId/
    );
  });
  it.each([
    "https://orbit.example.invalid/api",
    "https://user:password@fixture.test/api",
    "https://fixture.test/api?secret=KEY",
    "https://fixture.test/api#secret",
    "http://evil.example.com/api",
    "https://evil.example.com/api",
    "https://169.254.169.254/api",
    "https://fixture.test/api\\admin",
    "https://fixture.test/api?",
    "https://fixture.test/api#",
  ])("rejects unsafe fixture configuration %s", baseUrl => {
    expect(
      () =>
        new HqOrbitClient({
          baseUrl,
          apiKey: TEST_KEY,
          scopeId: COMPANY_SCOPE,
          fetcher: vi.fn(),
          allowFixtureTransport: true,
        })
    ).toThrow(HqContractError);
  });
  it("rejects ordinary client override and fixture gate without injected transport", () => {
    expect(
      () =>
        new HqOrbitClient({
          baseUrl: "https://approved.example.org/api",
          apiKey: TEST_KEY,
          scopeId: COMPANY_SCOPE,
          fetcher: vi.fn(),
        })
    ).toThrow(HqContractError);
    expect(
      () =>
        new HqOrbitClient({
          baseUrl: "https://fixture.test/api",
          apiKey: TEST_KEY,
          scopeId: COMPANY_SCOPE,
          allowFixtureTransport: true,
        })
    ).toThrow(HqContractError);
    expect(
      () =>
        new HqOrbitClient({
          baseUrl: "http://localhost:4444/api",
          apiKey: TEST_KEY,
          scopeId: COMPANY_SCOPE,
        })
    ).toThrow(HqContractError);
  });
  it("sends dedicated header and GET only fixed paths with manual redirects", async () => {
    const f = vi.fn(async (...args: Parameters<typeof fetch>) =>
      String(args[0]).includes("/changes")
        ? jsonResponse(changed())
        : jsonResponse()
    );
    const c = injected(f);
    await c.bookings({ cursor: "opaque?foo=1&evil=https://elsewhere.test" });
    await c.changes("checkpoint#opaque");
    await c.changes("cursor&opaque", 100);
    for (const [input, init] of f.mock.calls) {
      expect(init!.method).toBe("GET");
      expect(init!.body).toBeUndefined();
      expect(init!.redirect).toBe("manual");
      expect(init!.credentials).toBe("omit");
      const h = new Headers(init!.headers);
      expect(h.get("X-Orbit-Reporting-Key")).toBe(
        "SYNTHETIC-REPORTING-KEY-32-CHARS-ONLY"
      );
      expect(h.get("Authorization")).toBeNull();
      const u = new URL(String(input));
      expect(u.origin).toBe("https://fixture.test");
      expect(u.pathname).toMatch(/^\/api\/reporting\/v1\/(bookings|changes)$/);
    }
    expect(new URL(String(f.mock.calls[0][0])).searchParams.get("cursor")).toBe(
      "opaque?foo=1&evil=https://elsewhere.test"
    );
    expect(new URL(String(f.mock.calls[2][0])).searchParams.has("after")).toBe(
      false
    );
    expect(() => c.bookings({ cursor: "x".repeat(2049) })).toThrow(
      HqContractError
    );
    expect(() => c.changes("")).toThrow(HqContractError);
  });
  it.each([
    [401, "AUTH_DENIED"],
    [403, "AUTH_DENIED"],
    [410, "RESTART_REQUIRED"],
    [429, "RATE_LIMITED"],
    [503, "UNAVAILABLE"],
    [422, "TRANSPORT_FAILURE"],
    [500, "TRANSPORT_FAILURE"],
  ])("sanitizes HTTP %s without retry", async (status, code) => {
    const f = vi.fn(
      async () =>
        new Response("KEY secret raw URL https://secret.test", {
          status: Number(status),
          headers: { "Retry-After": "120" },
        })
    );
    await expect(injected(f).bookings()).rejects.toMatchObject({
      code,
      message: code,
    });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("bounds Retry-After without retry or unsafe strings", async () => {
    const f = vi.fn(
      async () =>
        new Response("SECRET", {
          status: 429,
          headers: { "Retry-After": "9999999999" },
        })
    );
    await expect(injected(f).bookings()).rejects.toMatchObject({
      code: "RATE_LIMITED",
      safeRetryAfter: 3600,
    });
    expect(safeHqRetryAfter("https://secret.test")).toBeUndefined();
    expect(safeHqRetryAfter("-1")).toBeUndefined();
    expect(
      safeHqRetryAfter(
        "Sun, 22 Nov 2026 11:02:00 GMT",
        Date.parse("2026-11-22T11:00:00Z")
      )
    ).toBe(120);
  });
  it.each([301, 302, 307, 308])(
    "rejects redirect %s without following",
    async status => {
      const f = vi.fn(
        async () =>
          new Response(null, {
            status,
            headers: { Location: "https://private.test/secret" },
          })
      );
      await expect(injected(f).bookings()).rejects.toMatchObject({
        code: "REDIRECT_REJECTED",
      });
      expect(f).toHaveBeenCalledTimes(1);
    }
  );
  it("rejects followed redirect or changed final origin", async () => {
    for (const property of ["redirected", "url"] as const) {
      const r = jsonResponse();
      Object.defineProperty(r, property, {
        value: property === "url" ? "https://other.test/private" : true,
      });
      await expect(
        injected(vi.fn(async () => r)).bookings()
      ).rejects.toMatchObject({ code: "REDIRECT_REJECTED" });
    }
  });
  it("rejects advertised and streamed oversize, canceling response", async () => {
    await expect(
      injected(
        vi.fn(
          async () =>
            new Response("{}", {
              headers: {
                "Content-Type": "application/json",
                "Content-Length": String(HQ_MAX_PAYLOAD_BYTES + 1),
              },
            })
        )
      ).bookings()
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(HQ_MAX_PAYLOAD_BYTES));
        c.enqueue(new Uint8Array(1));
      },
      cancel: cancelled,
    });
    await expect(
      injected(
        vi.fn(
          async () =>
            new Response(body, {
              headers: { "Content-Type": "application/json" },
            })
        )
      ).bookings()
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(cancelled).toHaveBeenCalled();
  });
  it("rejects invalid JSON/UTF-8/MIME and wrong scope", async () => {
    for (const r of [
      new Response("{SECRET}", {
        headers: { "Content-Type": "application/json" },
      }),
      new Response(new Uint8Array([0xff]), {
        headers: { "Content-Type": "application/json" },
      }),
      new Response("{}", { headers: { "Content-Type": "text/html" } }),
    ])
      await expect(
        injected(vi.fn(async () => r)).bookings()
      ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    const p = fixture();
    p.scope = "other-scope";
    await expect(
      injected(vi.fn(async () => jsonResponse(p))).bookings()
    ).rejects.toMatchObject({ code: "SCOPE_MISMATCH" });
  });
  it("sanitizes transport exceptions", async () => {
    const f = vi.fn(async () => {
      throw new Error("KEY https://secret.test private@email.test");
    });
    await expect(injected(f).bookings()).rejects.toMatchObject({
      code: "TRANSPORT_FAILURE",
      message: "TRANSPORT_FAILURE",
    });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("sanitizes synchronous injected failures without an unhandled cleanup rejection", async () => {
    const f = vi.fn(() => {
      throw new Error("KEY https://secret.test");
    });
    await expect(injected(f).bookings()).rejects.toMatchObject({
      code: "TRANSPORT_FAILURE",
      message: "TRANSPORT_FAILURE",
    });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("enforces 10s timeout even if transport ignores abort", async () => {
    vi.useFakeTimers();
    const f = vi.fn(
      (..._args: Parameters<typeof fetch>) =>
        new Promise<Response>(() => undefined)
    );
    const pending = injected(f).bookings();
    const assertion = expect(pending).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
  it("includes streamed body completion in timeout", async () => {
    vi.useFakeTimers();
    const f = vi.fn(
      async () =>
        new Response(new ReadableStream({ start() {} }), {
          headers: { "Content-Type": "application/json" },
        })
    );
    const assertion = expect(injected(f).bookings()).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
  });
});

describe("controlled localhost only", () => {
  let server: Server;
  let baseUrl: string;
  const seen: {
    method?: string;
    url?: string;
    key?: string;
    authorization?: string;
  }[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({
        method: req.method,
        url: req.url,
        key: req.headers["x-orbit-reporting-key"] as string | undefined,
        authorization: req.headers.authorization,
      });
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(req.url!.includes("/changes") ? changed() : fixture())
      );
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/reporting/v1`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  it("makes only localhost GETs with explicit injected gate and dedicated key", async () => {
    const c = new HqOrbitClient({
      baseUrl,
      apiKey: "LOCAL-SYNTHETIC-KEY-32-CHARS-ONLY-TEST",
      scopeId: COMPANY_SCOPE,
      enabled: true,
      allowFixtureTransport: true,
      fetcher: globalThis.fetch,
    });
    expect((await c.bookings()).items).toHaveLength(1);
    expect((await c.changes("durable")).items).toHaveLength(1);
    expect(seen).toHaveLength(2);
    for (const r of seen) {
      expect(r.method).toBe("GET");
      expect(r.key).toBe("LOCAL-SYNTHETIC-KEY-32-CHARS-ONLY-TEST");
      expect(r.authorization).toBeUndefined();
      expect(r.url).toMatch(/^\/api\/reporting\/v1\/(bookings|changes)/);
    }
  });
});

describe("implemented six-endpoint offline reader", () => {
  const businessPage = (): any => {
    const p = fixture();
    p.entityType = "business";
    p.items = [
      {
        entityType: "business",
        entityId: 90052,
        revision: 1,
        payload: {
          orbitTenantId: 90052,
          isActive: true,
          account: {},
          identity: p.items[0].payload.identity,
          configuredCardFeeRates: {},
          membershipHistoryAvailable: false,
          portalMembershipJoinDate: null,
        },
      },
    ];
    return p;
  };
  const responseFor = (input: string): any => {
    const u = new URL(input);
    if (u.pathname.endsWith("/business-mappings")) return businessPage();
    if (u.pathname.endsWith("/changes")) return changed();
    if (u.pathname.endsWith("/catalogue")) {
      const p =
        u.searchParams.get("entityType") === "business"
          ? businessPage()
          : fixture();
      p.items = p.items.map(({ entityType, entityId, revision }: any) => ({
        entityType,
        entityId,
        revision,
      }));
      return p;
    }
    if (u.pathname.endsWith("/status")) {
      const p = fixture();
      delete p.items;
      return { ...p, ready: true };
    }
    if (u.pathname.endsWith("/capabilities"))
      return {
        apiVersion: "1.0.0",
        endpoints: [
          "bookings",
          "business-mappings",
          "catalogue",
          "changes",
          "status",
          "capabilities",
        ],
        quotes: false,
        sourceWrites: false,
        providerCalls: false,
      };
    return fixture();
  };
  it("calls all six implemented GET routes and both catalogue kinds with encoded opaque cursors and no after", async () => {
    const f = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
      jsonResponse(responseFor(String(input)))
    );
    const c = injected(f);
    await c.bookings({ generationId: 1, limit: 100 });
    await c.businessMappings({ generationId: 1 });
    await c.catalogue("booking", {
      cursor: "opaque?x=1&path=/evil#token",
      limit: 50,
    });
    await c.catalogue("business", { generationId: 1 });
    await c.changes("checkpoint?after=999&url=https://private.test", 100);
    await c.status();
    await c.capabilities();
    expect(f).toHaveBeenCalledTimes(7);
    const paths = new Set(
      f.mock.calls.map(([input]) => new URL(String(input)).pathname)
    );
    expect(paths.size).toBe(6);
    for (const [input, init] of f.mock.calls as unknown as Parameters<
      typeof fetch
    >[]) {
      const u = new URL(String(input));
      const h = new Headers(init!.headers);
      expect(u.origin).toBe("https://fixture.test");
      expect(u.searchParams.has("after")).toBe(false);
      expect(init).toMatchObject({
        method: "GET",
        credentials: "omit",
        redirect: "manual",
        cache: "no-store",
      });
      expect(init!.body).toBeUndefined();
      expect(h.get("X-Orbit-Reporting-Key")).toBe(TEST_KEY);
      for (const name of ["Cookie", "Origin", "Authorization"])
        expect(h.get(name)).toBeNull();
    }
    expect(new URL(String(f.mock.calls[2][0])).searchParams.get("cursor")).toBe(
      "opaque?x=1&path=/evil#token"
    );
    expect(new URL(String(f.mock.calls[4][0])).searchParams.get("cursor")).toBe(
      "checkpoint?after=999&url=https://private.test"
    );
    for (const call of f.mock.calls.slice(-2))
      expect(new URL(String(call[0])).search).toBe("");
  });
  it.each([
    "beforeAmendment",
    "afterAmendment",
    "afterCancellation",
    "afterLaterRegistration",
  ])("reads actual supplied 200 %s through injected transport", async name => {
    const f = vi.fn(async () => jsonResponse(examples[name].body));
    const c = injected(f);
    const result =
      name === "afterAmendment"
        ? await c.changes(examples.beforeAmendment.body.resumeCursor)
        : await c.bookings();
    expect(result).toEqual(examples[name].body);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 403, 405, 410, 429, 503])(
    "sanitizes nested implemented HTTP error %s",
    async status => {
      const f = vi.fn(
        async () =>
          new Response(JSON.stringify(examples.unauthorized.body), {
            status,
            headers: { "Content-Type": "application/json" },
          })
      );
      const codes: Record<number, string> = {
        400: "INVALID_QUERY",
        401: "AUTH_DENIED",
        403: "AUTH_DENIED",
        405: "TRANSPORT_FAILURE",
        410: "RESTART_REQUIRED",
        429: "RATE_LIMITED",
        503: "UNAVAILABLE",
      };
      await expect(injected(f).status()).rejects.toMatchObject({
        code: codes[status],
        message: codes[status],
      });
      expect(f).toHaveBeenCalledTimes(1);
    }
  );
  it.each([
    { cursor: "x", generationId: 1 },
    { cursor: "" },
    { cursor: "x".repeat(2049) },
    { cursor: "x\n" },
    { generationId: 0 },
    { generationId: 1.5 },
    { generationId: Number.MAX_SAFE_INTEGER + 1 },
    { generationId: "1" },
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { limit: "100" },
    { after: "legacy" },
    [],
    "cursor",
    null,
  ])("rejects invalid page query %j before transport", query => {
    const f = vi.fn(async () => jsonResponse());
    const c = injected(f);
    for (const run of [
      () => c.bookings(query as any),
      () => c.businessMappings(query as any),
      () => c.catalogue("booking", query as any),
    ])
      expect(run).toThrow("INVALID_QUERY");
    expect(f).not.toHaveBeenCalled();
  });
  it("rejects query getters without invoking them, illegal entity type and illegal changes inputs", () => {
    const f = vi.fn(async () => jsonResponse());
    const c = injected(f);
    const getter = vi.fn(() => "SECRET");
    const query = {};
    Object.defineProperty(query, "cursor", { enumerable: true, get: getter });
    expect(() => c.bookings(query)).toThrow("INVALID_QUERY");
    expect(getter).not.toHaveBeenCalled();
    expect(() => c.catalogue("quote" as any)).toThrow("INVALID_QUERY");
    for (const limit of [0, 101, 1.5, "2"])
      expect(() => c.changes("opaque", limit as any)).toThrow("INVALID_QUERY");
    expect(() => c.changes(undefined as any)).toThrow("INVALID_QUERY");
    expect(f).not.toHaveBeenCalled();
  });
  it("pins a requested generation, page limit and requested catalogue kind", async () => {
    const c = injected(vi.fn(async () => jsonResponse()));
    await expect(c.bookings({ generationId: 2 })).rejects.toMatchObject({
      code: "INVALID_SEMANTICS",
    });
    const p = fixture();
    p.items.push({
      ...structuredClone(p.items[0]),
      entityId: 2,
      payload: { ...structuredClone(p.items[0].payload), orbitBookingId: 2 },
    });
    await expect(
      injected(vi.fn(async () => jsonResponse(p))).bookings({ limit: 1 })
    ).rejects.toMatchObject({ code: "INVALID_SEMANTICS" });
    const cat = fixture();
    cat.items = [];
    await expect(
      injected(vi.fn(async () => jsonResponse(cat))).catalogue("business")
    ).rejects.toMatchObject({ code: "INVALID_SEMANTICS" });
  });
  it("is default-disabled on every API and rejects custom scopes and out-of-range credentials", async () => {
    const f = vi.fn(async () => jsonResponse());
    const c = new HqOrbitClient({
      baseUrl: "https://fixture.test/api/reporting/v1",
      apiKey: TEST_KEY,
      scopeId: COMPANY_SCOPE,
      allowFixtureTransport: true,
      fetcher: f,
    });
    for (const pending of [
      c.bookings(),
      c.businessMappings(),
      c.catalogue("booking"),
      c.changes("opaque"),
      c.status(),
      c.capabilities(),
    ])
      await expect(pending).rejects.toMatchObject({ code: "CLIENT_DISABLED" });
    expect(f).not.toHaveBeenCalled();
    const options = {
      baseUrl: "https://fixture.test/api/reporting/v1",
      apiKey: TEST_KEY,
      scopeId: COMPANY_SCOPE,
      allowFixtureTransport: true,
      fetcher: f,
    };
    for (const apiKey of [
      "x".repeat(31),
      "x".repeat(257),
      "x".repeat(31) + " ",
      "x".repeat(31) + "\n",
    ])
      expect(() => new HqOrbitClient({ ...options, apiKey })).toThrow(
        "INVALID_CONFIGURATION"
      );
    for (const length of [32, 256])
      expect(
        () => new HqOrbitClient({ ...options, apiKey: "x".repeat(length) })
      ).not.toThrow();
    for (const scopeId of ["tenant", "company_all_real_and_unattributed ", ""])
      expect(() => new HqOrbitClient({ ...options, scopeId })).toThrow(
        "INVALID_CONFIGURATION"
      );
  });
  it("rejects malformed mixed payloads, malformed nested errors returned as success, and bad cursors", async () => {
    const p = changed();
    p.items[0].entityType = "business";
    for (const raw of [p, examples.unauthorized.body, { error: { code: 401 } }])
      await expect(
        injected(vi.fn(async () => jsonResponse(raw))).changes("opaque")
      ).rejects.toBeInstanceOf(HqContractError);
    const b = fixture();
    b.complete = false;
    b.nextCursor = "";
    await expect(
      injected(vi.fn(async () => jsonResponse(b))).bookings()
    ).rejects.toMatchObject({ code: "INVALID_SEMANTICS" });
  });
  it.each([
    "http://approved.example.org/api",
    "https://127.0.0.1/api",
    "https://localhost/api",
    "https://host.internal/api",
    "https://host.test/api",
    "https://approved.example.org:444/api",
    "https://approved.example.org/api/%2e%2e/secret",
  ])("rejects unsafe normal server configuration %s", baseUrl => {
    expect(
      () =>
        new HqOrbitClient({ baseUrl, apiKey: TEST_KEY, scopeId: COMPANY_SCOPE })
    ).toThrow("INVALID_CONFIGURATION");
  });
});
