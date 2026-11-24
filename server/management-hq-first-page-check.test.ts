import { readFileSync } from "node:fs";
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Never consume a real database binding, including when this suite is run alone.
vi.hoisted(() => {
  delete process.env.DATABASE_URL;
});
import {
  checkHqFirstPage,
  type HqFirstPageCheckResult,
} from "./management-hq-first-page-check";
import { HqContractError, HqOrbitClient } from "./management-hq-orbit-client";
import { HQ_LIVE_SCOPE } from "./management-hq-live-config";
import type { HqContractErrorCode } from "./management-hq-contract";
import type {
  HqWireBookingPage,
  HqWireCapabilities,
  HqWirePageQuery,
  HqWireStatus,
} from "../shared/management-hq-wire";

const KEY = "SYNTHETIC-REPORTING-KEY-" + "a".repeat(32);
const TOKEN = "SYNTHETIC-PORTAL-TOKEN-" + "b".repeat(32);
const BASE_URL = "https://approved.example.org/api/reporting/v1";
const NOW = "2026-11-24T19:00:00.000Z";
const PRIVATE =
  "private-key https://private.test/key?token=private customer@example.test SELECT private_payload hash-deadbeef";
const examples = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/management-hq-wire-http-examples.json",
      import.meta.url
    ),
    "utf8"
  )
);
const settings = (patch: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  HQ_ORBIT_REPORTING_BASE_URL: BASE_URL,
  HQ_ORBIT_REPORTING_API_KEY: KEY,
  HQ_PORTAL_SYNC_TOKEN: TOKEN,
  HQ_LIVE_SYNC_ENABLED: "true",
  HQ_LIVE_READ_ENABLED: "false",
  HQ_LIVE_INTERVAL_SECONDS: "300",
  HQ_LIVE_FRESHNESS_SECONDS: "900",
  ...patch,
});
function bookingPage(): HqWireBookingPage {
  const page: HqWireBookingPage = structuredClone(
    examples.beforeAmendment.body
  );
  page.generationId = 76;
  page.publishedAt = "2026-11-24T18:59:59.000Z";
  page.expiresAt = "2026-11-25T18:59:59.000Z";
  page.sourceObservationWindow = {
    from: "2026-11-24T18:59:50.000Z",
    to: "2026-11-24T18:59:55.000Z",
  };
  page.counts = {
    bookingCount: 12345,
    businessCount: 67890,
    diagnostic: PRIVATE,
  };
  page.diagnostic = PRIVATE;
  page.items[0].payload.diagnostic = PRIVATE;
  return page;
}
function status(): HqWireStatus {
  const page = bookingPage();
  const {
    items: _items,
    entityType: _type,
    nextCursor: _next,
    resumeCursor: _resume,
    complete: _complete,
    checkpointInstructions: _instructions,
    ...metadata
  } = page;
  return { ...metadata, generationId: 47, ready: true };
}
const capabilities = (): HqWireCapabilities => ({
  apiVersion: "1.0.0",
  endpoints: [
    "status",
    "capabilities",
    "bookings",
    "business-mappings",
    "catalogue",
    "changes",
  ],
  quotes: false,
  sourceWrites: false,
  providerCalls: false,
  diagnostic: PRIVATE,
});
const stages = ["status", "capabilities", "bookings"] as const;
function readerSeam() {
  return {
    status: vi.fn(async () => status()),
    capabilities: vi.fn(async () => capabilities()),
    bookings: vi.fn(async (_query?: HqWirePageQuery) => bookingPage()),
  };
}
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
function adapter(fetcher: typeof fetch) {
  return new HqOrbitClient({
    baseUrl: "https://fixture.test/api/reporting/v1",
    apiKey: KEY,
    scopeId: HQ_LIVE_SCOPE,
    enabled: true,
    allowFixtureTransport: true,
    fetcher,
  });
}
const bodyFor = (input: Parameters<typeof fetch>[0]) => {
  const endpoint = new URL(String(input)).pathname.split("/").at(-1);
  return endpoint === "status"
    ? status()
    : endpoint === "capabilities"
      ? capabilities()
      : bookingPage();
};
const messages: Record<HqFirstPageCheckResult["outcome"], string> = {
  page_valid:
    "Only the current first bookings page passed strict source validation. This diagnostic does not establish the cause of an earlier import failure or accept the whole import or reporting reads. No import, retry, reset, dashboard activation or automatic update was performed.",
  needs_attention:
    "The current first-page diagnostic needs attention. No import, retry, reset, dashboard activation or automatic update was performed.",
  invalid_settings:
    "The first-page diagnostic requires valid configured sync-on/read-off settings. No import, retry, reset, dashboard activation or automatic update was performed.",
};
function assertSafe(
  dto: HqFirstPageCheckResult,
  outcome: HqFirstPageCheckResult["outcome"],
  stage: HqFirstPageCheckResult["stage"],
  errorCode: HqContractErrorCode | null = null,
  failedRule: HqFirstPageCheckResult["failedRule"] = null,
  checkedAt: string = NOW
) {
  expect(dto).toEqual({
    outcome,
    checkedAt,
    message: messages[outcome],
    stage,
    errorCode,
    failedRule,
    generationId: outcome === "page_valid" ? 76 : null,
    sourcePublishedAt:
      outcome === "page_valid" ? bookingPage().publishedAt : null,
    sourceObservationAt:
      outcome === "page_valid"
        ? bookingPage().sourceObservationWindow.to
        : null,
  });
  expect(JSON.stringify(dto)).not.toMatch(
    /private|customer@|SELECT|hash-deadbeef|12345|67890|changeUpper|scope|sourceAgeSeconds|bookingCount|apiKey|https:|bookingRef|payload|nextCursor|resumeCursor|SYNTHETIC/
  );
}
let forbiddenFetch: ReturnType<typeof vi.fn>;
let forbiddenLogs: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  expect(process.env.DATABASE_URL).toBeUndefined();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  forbiddenFetch = vi.fn(() => {
    throw new Error("Live transport forbidden");
  });
  vi.stubGlobal("fetch", forbiddenFetch);
  forbiddenLogs = ["log", "warn", "error", "info", "debug"].map(method =>
    vi.spyOn(console, method as "log").mockImplementation(() => undefined)
  );
});
afterEach(() => {
  expect(forbiddenFetch).not.toHaveBeenCalled();
  for (const log of forbiddenLogs) expect(log).not.toHaveBeenCalled();
  expect(process.env.DATABASE_URL).toBeUndefined();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("bounded current first-page diagnostic, never import or acceptance", () => {
  it("module import and strict client construction are inert", async () => {
    await import("./management-hq-first-page-check");
    new HqOrbitClient({
      baseUrl: BASE_URL,
      apiKey: KEY,
      scopeId: HQ_LIVE_SCOPE,
      enabled: true,
    });
    expect(forbiddenFetch).not.toHaveBeenCalled();
  });
  it("reads only status then capabilities then the first bookings page, limit 100, no generation pin", async () => {
    const events: string[] = [];
    const reader = readerSeam();
    for (const stage of stages) {
      const original = reader[stage].getMockImplementation()!;
      reader[stage].mockImplementation((async () => {
        events.push(stage);
        return original();
      }) as never);
    }
    const env = settings();
    const originalEnv = { ...env };
    const factory = vi.fn(() => {
      events.push("construct");
      return reader;
    });
    assertSafe(
      await checkHqFirstPage({
        env,
        createReader: factory,
        guard: async () => {
          events.push("gate");
        },
      }),
      "page_valid",
      "bookings"
    );
    expect(events).toEqual([
      "gate",
      "construct",
      "gate",
      "status",
      "gate",
      "gate",
      "capabilities",
      "gate",
      "gate",
      "bookings",
      "gate",
      "gate",
    ]);
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith(BASE_URL, KEY);
    expect(reader.bookings).toHaveBeenCalledOnce();
    expect(reader.bookings).toHaveBeenCalledWith({ limit: 100 });
    expect(reader.status).toHaveBeenCalledOnce();
    expect(reader.status).toHaveBeenCalledWith();
    expect(reader.capabilities).toHaveBeenCalledOnce();
    expect(reader.capabilities).toHaveBeenCalledWith();
    expect(env).toEqual(originalEnv);
  });
  it.each([true, false])(
    "valid complete=%s remains first-page-only and never follows a cursor",
    async complete => {
      const reader = readerSeam();
      reader.bookings.mockResolvedValue({
        ...bookingPage(),
        complete,
        nextCursor: complete ? null : "SYNTHETIC-NEXT-CURSOR",
      });
      assertSafe(
        await checkHqFirstPage({ env: settings(), createReader: () => reader }),
        "page_valid",
        "bookings"
      );
      expect(reader.bookings).toHaveBeenCalledOnce();
      expect(reader.bookings).toHaveBeenCalledWith({ limit: 100 });
    }
  );
  it("success claims current first page only, not earlier cause, whole import, freshness acceptance or activation", async () => {
    const reader = readerSeam();
    reader.bookings.mockResolvedValue({
      ...bookingPage(),
      stale: true,
      sourceAgeSeconds: 1000,
      expiresAt: "2026-11-24T18:59:59.500Z",
    });
    const dto = await checkHqFirstPage({
      env: settings(),
      createReader: () => reader,
    });
    assertSafe(dto, "page_valid", "bookings");
    expect(dto.message).toContain("Only the current first bookings page");
    expect(dto.message).toContain("does not establish the cause");
    expect(dto.message).toContain(
      "or accept the whole import or reporting reads"
    );
    expect(dto.message).not.toMatch(/17:26|76c2103a|fresh|ready|accepted/);
  });
  it("does not invoke service, store, import, reporting, people or operational paths", () => {
    const source = readFileSync(
      new URL("./management-hq-first-page-check.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(
      /createHqLiveService|createHqLiveStore|createHqImplementedEngine|importHqInitialBatch|DATABASE_URL|readPublished|getHqReport|\.invoke\(|\.acquire\(|\.renew\(|\.catalogue\(|\.changes\(|\.businessMappings\(|console\.|setInterval|setTimeout/
    );
  });
});

describe("strict actual live configuration, never health-check fallback settings", () => {
  const invalid: NodeJS.ProcessEnv[] = [
    {},
    { HQ_ORBIT_REPORTING_BASE_URL: undefined },
    { HQ_ORBIT_REPORTING_BASE_URL: "" },
    { HQ_ORBIT_REPORTING_BASE_URL: "http://approved.example.org/api" },
    { HQ_ORBIT_REPORTING_BASE_URL: "https://fixture.test/api" },
    {
      HQ_ORBIT_REPORTING_BASE_URL:
        "https://approved.example.org/api?key=private",
    },
    { HQ_ORBIT_REPORTING_BASE_URL: "https://127.0.0.1/api" },
    { HQ_ORBIT_REPORTING_API_KEY: undefined },
    { HQ_ORBIT_REPORTING_API_KEY: "short" },
    { HQ_ORBIT_REPORTING_API_KEY: KEY + " " },
    { HQ_ORBIT_REPORTING_API_KEY: KEY + "\n" },
    { HQ_PORTAL_SYNC_TOKEN: undefined },
    { HQ_PORTAL_SYNC_TOKEN: "short" },
    { HQ_PORTAL_SYNC_TOKEN: KEY },
    { HQ_PORTAL_SYNC_TOKEN: TOKEN + "\n" },
    { HQ_LIVE_SYNC_ENABLED: undefined },
    { HQ_LIVE_SYNC_ENABLED: "false" },
    { HQ_LIVE_SYNC_ENABLED: "TRUE" },
    { HQ_LIVE_READ_ENABLED: "true" },
    { HQ_LIVE_READ_ENABLED: "False" },
    { HQ_LIVE_INTERVAL_SECONDS: "59" },
    { HQ_LIVE_INTERVAL_SECONDS: "3601" },
    { HQ_LIVE_INTERVAL_SECONDS: "060" },
    { HQ_LIVE_FRESHNESS_SECONDS: "59" },
    { HQ_LIVE_FRESHNESS_SECONDS: "86401" },
    { HQ_LIVE_FRESHNESS_SECONDS: "900 " },
  ];
  it.each(invalid.map((patch, index) => [index, patch] as const))(
    "rejects invalid case %s before reader construction and still gates the returned DTO",
    async (index, patch) => {
      const factory = vi.fn();
      const guard = vi.fn(async () => undefined);
      assertSafe(
        await checkHqFirstPage({
          env: index === 0 ? {} : settings(patch),
          guard,
          createReader: factory,
        }),
        "invalid_settings",
        "settings",
        "INVALID_CONFIGURATION"
      );
      expect(factory).not.toHaveBeenCalled();
      expect(guard).toHaveBeenCalledTimes(2);
    }
  );
  it("uses process env only when explicitly omitted and has no default URL fallback", async () => {
    for (const key of Object.keys(settings())) vi.stubEnv(key, "");
    assertSafe(
      await checkHqFirstPage(),
      "invalid_settings",
      "settings",
      "INVALID_CONFIGURATION"
    );
  });
  it.each([
    { HQ_LIVE_READ_ENABLED: undefined },
    {
      HQ_LIVE_INTERVAL_SECONDS: undefined,
      HQ_LIVE_FRESHNESS_SECONDS: undefined,
    },
    { HQ_LIVE_INTERVAL_SECONDS: "60", HQ_LIVE_FRESHNESS_SECONDS: "60" },
    { HQ_LIVE_INTERVAL_SECONDS: "3600", HQ_LIVE_FRESHNESS_SECONDS: "86400" },
  ])(
    "preserves actual createHqLiveConfig valid defaults and bounds",
    async patch => {
      assertSafe(
        await checkHqFirstPage({
          env: settings(patch),
          createReader: () => readerSeam(),
        }),
        "page_valid",
        "bookings"
      );
    }
  );
});

describe("strict reserved .test transport and fixed failure privacy", () => {
  it("strict adapter makes exactly three GETs with the actual first-page query, never pagination", async () => {
    const transport = vi.fn(
      async (input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
        const body = bodyFor(input);
        if (new URL(String(input)).pathname.endsWith("/bookings")) {
          Object.assign(body, { complete: false, nextCursor: PRIVATE });
        }
        return json(body);
      }
    );
    assertSafe(
      await checkHqFirstPage({
        env: settings(),
        createReader: () => adapter(transport),
      }),
      "page_valid",
      "bookings"
    );
    expect(
      transport.mock.calls.map(([input]) => {
        const url = new URL(String(input));
        return url.pathname + url.search;
      })
    ).toEqual([
      "/api/reporting/v1/status",
      "/api/reporting/v1/capabilities",
      "/api/reporting/v1/bookings?limit=100",
    ]);
    for (const [, init] of transport.mock.calls) {
      expect(init).toMatchObject({
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
      });
      expect(init?.body).toBeUndefined();
      const headers = new Headers(init?.headers);
      expect(headers.get("X-Orbit-Reporting-Key")).toBe(KEY);
      for (const name of ["Cookie", "Origin", "Authorization"])
        expect(headers.get(name)).toBeNull();
    }
  });
  it.each(stages)(
    "raw provider error at %s is generic, metadata-free, no later source calls",
    async stage => {
      const transport = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        if (new URL(String(input)).pathname.endsWith(`/${stage}`))
          throw new Error(PRIVATE);
        return json(bodyFor(input));
      });
      assertSafe(
        await checkHqFirstPage({
          env: settings(),
          createReader: () => adapter(transport),
        }),
        "needs_attention",
        stage,
        "TRANSPORT_FAILURE"
      );
      expect(transport).toHaveBeenCalledTimes(stages.indexOf(stage) + 1);
    }
  );
  it.each(stages)(
    "HTTP failure at %s exposes only actual fixed contract codes, never provider body",
    async stage => {
      for (const [httpStatus, code] of [
        [401, "AUTH_DENIED"],
        [403, "AUTH_DENIED"],
        [429, "RATE_LIMITED"],
        [503, "UNAVAILABLE"],
        [500, "TRANSPORT_FAILURE"],
      ] as const) {
        const transport = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
          new URL(String(input)).pathname.endsWith(`/${stage}`)
            ? new Response(PRIVATE, { status: httpStatus })
            : json(bodyFor(input))
        );
        assertSafe(
          await checkHqFirstPage({
            env: settings(),
            createReader: () => adapter(transport),
          }),
          "needs_attention",
          stage,
          code
        );
        expect(transport).toHaveBeenCalledTimes(stages.indexOf(stage) + 1);
      }
    }
  );
  it.each(stages)(
    "non-JSON bad payload at %s has no guessed failure rule",
    async stage => {
      const transport = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
        new URL(String(input)).pathname.endsWith(`/${stage}`)
          ? new Response(PRIVATE, {
              headers: { "Content-Type": "application/json" },
            })
          : json(bodyFor(input))
      );
      assertSafe(
        await checkHqFirstPage({
          env: settings(),
          createReader: () => adapter(transport),
        }),
        "needs_attention",
        stage,
        "INVALID_PAYLOAD"
      );
    }
  );
  it("strict source-ready false never reads capabilities or bookings and never projects status metadata", async () => {
    const transport = vi.fn(async () => json({ ...status(), ready: false }));
    const dto = await checkHqFirstPage({
      env: settings(),
      createReader: () => adapter(transport),
    });
    assertSafe(
      dto,
      "needs_attention",
      "status",
      "INVALID_PAYLOAD",
      "declared_schema"
    );
    expect(transport).toHaveBeenCalledOnce();
  });
  it("strict capabilities refusal stops before bookings", async () => {
    const transport = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
      json(
        new URL(String(input)).pathname.endsWith("/capabilities")
          ? { ...capabilities(), sourceWrites: true }
          : bodyFor(input)
      )
    );
    assertSafe(
      await checkHqFirstPage({
        env: settings(),
        createReader: () => adapter(transport),
      }),
      "needs_attention",
      "capabilities",
      "INVALID_PAYLOAD",
      "declared_schema"
    );
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("only wire-validator-attached declared_schema label is returned for rejected page", async () => {
    const transport = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const body = bodyFor(input);
      if (new URL(String(input)).pathname.endsWith("/bookings"))
        delete (body as Partial<HqWireBookingPage>).items;
      return json(body);
    });
    assertSafe(
      await checkHqFirstPage({
        env: settings(),
        createReader: () => adapter(transport),
      }),
      "needs_attention",
      "bookings",
      "INVALID_PAYLOAD",
      "declared_schema"
    );
  });
  it("only wire-validator-attached exact_money_pence label is returned for rejected page", async () => {
    const page = bookingPage();
    page.items[0].payload.bookingTotal = "10000.001";
    const transport = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
      json(
        new URL(String(input)).pathname.endsWith("/bookings")
          ? page
          : bodyFor(input)
      )
    );
    assertSafe(
      await checkHqFirstPage({
        env: settings(),
        createReader: () => adapter(transport),
      }),
      "needs_attention",
      "bookings",
      "INVALID_SEMANTICS",
      "exact_money_pence"
    );
  });
  it("a bounded strict transport timeout stops after one read, without retry", async () => {
    const transport = vi.fn(() => new Promise<Response>(() => undefined));
    const pending = checkHqFirstPage({
      env: settings(),
      createReader: () => adapter(transport),
    });
    await vi.advanceTimersByTimeAsync(10000);
    assertSafe(
      await pending,
      "needs_attention",
      "status",
      "TIMEOUT",
      null,
      "2026-11-24T19:00:10.000Z"
    );
    expect(transport).toHaveBeenCalledOnce();
  });
  const codes: HqContractErrorCode[] = [
    "INVALID_PAYLOAD",
    "PAYLOAD_TOO_LARGE",
    "CONTRACT_VERSION_MISMATCH",
    "INVALID_SEMANTICS",
    "SCOPE_MISMATCH",
    "CLIENT_DISABLED",
    "INVALID_CONFIGURATION",
    "INVALID_QUERY",
    "AUTH_DENIED",
    "RESTART_REQUIRED",
    "RATE_LIMITED",
    "UNAVAILABLE",
    "REDIRECT_REJECTED",
    "TIMEOUT",
    "TRANSPORT_FAILURE",
  ];
  it.each(codes)(
    "actual contract error %s is fixed and has no inferred rule",
    async code => {
      const reader = readerSeam();
      reader.status.mockRejectedValue(new HqContractError(code));
      assertSafe(
        await checkHqFirstPage({ env: settings(), createReader: () => reader }),
        "needs_attention",
        "status",
        code
      );
      expect(reader.capabilities).not.toHaveBeenCalled();
    }
  );
  it.each([
    new Error(PRIVATE),
    Object.assign(new Error(PRIVATE), {
      code: "AUTH_DENIED",
      failedRule: "exact_money_pence",
    }),
    {
      name: "HqContractError",
      code: "INVALID_PAYLOAD",
      message: PRIVATE,
      failedRule: "declared_schema",
    },
    {
      get code() {
        throw new Error("must not inspect arbitrary properties");
      },
    },
  ])(
    "unknown errors are fixed transport failure without arbitrary code/message/property access",
    async error => {
      const reader = readerSeam();
      reader.status.mockRejectedValue(error);
      assertSafe(
        await checkHqFirstPage({ env: settings(), createReader: () => reader }),
        "needs_attention",
        "status",
        "TRANSPORT_FAILURE"
      );
    }
  );
  it("even an actual contract error with an unexpected mutated code is generic", async () => {
    const error = new HqContractError("INVALID_PAYLOAD");
    Object.defineProperty(error, "code", { value: PRIVATE });
    const reader = readerSeam();
    reader.status.mockRejectedValue(error);
    assertSafe(
      await checkHqFirstPage({ env: settings(), createReader: () => reader }),
      "needs_attention",
      "status",
      "TRANSPORT_FAILURE"
    );
  });
  it("reader-construction failure is sanitized and gets a final authority check", async () => {
    const guard = vi.fn(async () => undefined);
    assertSafe(
      await checkHqFirstPage({
        env: settings(),
        guard,
        createReader: () => {
          throw new Error(PRIVATE);
        },
      }),
      "needs_attention",
      "settings",
      "TRANSPORT_FAILURE"
    );
    expect(guard).toHaveBeenCalledTimes(2);
  });
});

describe("latched fresh authority and every captured setting around successful and failed awaits", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "revocation at gate %s rejects, including the final serialization gate",
    async deniedAt => {
      const reader = readerSeam();
      const denied = new TRPCError({
        code: "FORBIDDEN",
        message: "Active Super Admin access required.",
      });
      let gates = 0;
      await expect(
        checkHqFirstPage({
          env: settings(),
          createReader: () => reader,
          guard: async () => {
            if (++gates === deniedAt) throw denied;
          },
        })
      ).rejects.toBe(denied);
      expect(reader.status).toHaveBeenCalledTimes(deniedAt > 2 ? 1 : 0);
      expect(reader.capabilities).toHaveBeenCalledTimes(deniedAt > 4 ? 1 : 0);
      expect(reader.bookings).toHaveBeenCalledTimes(deniedAt > 6 ? 1 : 0);
    }
  );
  it.each(stages)(
    "authority revoked during resolved %s await denies rather than returning a diagnostic",
    async stage => {
      const reader = readerSeam();
      let revoked = false;
      const denied = new TRPCError({ code: "FORBIDDEN" });
      reader[stage].mockImplementation((async () => {
        revoked = true;
        return stage === "status"
          ? status()
          : stage === "capabilities"
            ? capabilities()
            : bookingPage();
      }) as never);
      await expect(
        checkHqFirstPage({
          env: settings(),
          createReader: () => reader,
          guard: async () => {
            if (revoked) throw denied;
          },
        })
      ).rejects.toBe(denied);
    }
  );
  it.each(stages)(
    "late failed %s await still performs post-read authority and rejects revocation",
    async stage => {
      const reader = readerSeam();
      let revoked = false;
      const denied = new TRPCError({ code: "FORBIDDEN" });
      const guard = vi.fn(async () => {
        if (revoked) throw denied;
      });
      reader[stage].mockImplementation(async () => {
        await Promise.resolve();
        revoked = true;
        throw new HqContractError("UNAVAILABLE");
      });
      await expect(
        checkHqFirstPage({ env: settings(), createReader: () => reader, guard })
      ).rejects.toBe(denied);
      expect(guard).toHaveBeenCalledTimes((stages.indexOf(stage) + 1) * 2 + 2);
    }
  );
  it.each(stages)(
    "failed %s await still receives its post-source and final fresh gates without revocation",
    async stage => {
      const reader = readerSeam();
      reader[stage].mockRejectedValue(new Error(PRIVATE));
      const guard = vi.fn(async () => undefined);
      assertSafe(
        await checkHqFirstPage({
          env: settings(),
          createReader: () => reader,
          guard,
        }),
        "needs_attention",
        stage,
        "TRANSPORT_FAILURE"
      );
      expect(guard).toHaveBeenCalledTimes((stages.indexOf(stage) + 1) * 2 + 2);
    }
  );
  const rotations: [string, string][] = [
    [
      "HQ_ORBIT_REPORTING_BASE_URL",
      "https://rotated.example.org/api/reporting/v1",
    ],
    ["HQ_ORBIT_REPORTING_API_KEY", "ROTATED-REPORTING-" + "c".repeat(32)],
    ["HQ_PORTAL_SYNC_TOKEN", "ROTATED-PORTAL-" + "d".repeat(32)],
    ["HQ_LIVE_SYNC_ENABLED", "false"],
    ["HQ_LIVE_READ_ENABLED", "true"],
    ["HQ_LIVE_INTERVAL_SECONDS", "600"],
    ["HQ_LIVE_FRESHNESS_SECONDS", "60"],
  ];
  it.each(rotations)(
    "captured %s rotation during every resolved and failed source await",
    async (key, value) => {
      for (const stage of stages) {
        for (const rejectSource of [false, true]) {
          const env = settings();
          const reader = readerSeam();
          reader[stage].mockImplementation((async () => {
            await Promise.resolve();
            env[key] = value;
            if (rejectSource) throw new Error(PRIVATE);
            return stage === "status"
              ? status()
              : stage === "capabilities"
                ? capabilities()
                : bookingPage();
          }) as never);
          await expect(
            checkHqFirstPage({ env, createReader: () => reader })
          ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
        }
      }
    }
  );
  it.each(rotations)(
    "latches %s drift before the next authority guard restores it for resolved and failed source awaits",
    async (key, value) => {
      for (const stage of stages) {
        for (const rejectSource of [false, true]) {
          const env = settings();
          const reader = readerSeam();
          let restore = false;
          reader[stage].mockImplementation((async () => {
            env[key] = value;
            restore = true;
            if (rejectSource) throw new Error(PRIVATE);
            return stage === "status"
              ? status()
              : stage === "capabilities"
                ? capabilities()
                : bookingPage();
          }) as never);
          await expect(
            checkHqFirstPage({
              env,
              createReader: () => reader,
              guard: async () => {
                if (restore) {
                  env[key] = settings()[key];
                  restore = false;
                }
              },
            })
          ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
          expect(env[key]).toBe(settings()[key]);
        }
      }
    }
  );
  it.each(rotations)(
    "captured %s rotation during construction rejects before source reads",
    async (key, value) => {
      const env = settings();
      const reader = readerSeam();
      await expect(
        checkHqFirstPage({
          env,
          createReader: () => {
            env[key] = value;
            return reader;
          },
        })
      ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(reader.status).not.toHaveBeenCalled();
    }
  );
  it.each(rotations)(
    "captured %s rotation at final DTO gate rejects even after validated page",
    async (key, value) => {
      const env = settings();
      const reader = readerSeam();
      let gates = 0;
      await expect(
        checkHqFirstPage({
          env,
          createReader: () => reader,
          guard: async () => {
            if (++gates === 8) env[key] = value;
          },
        })
      ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(reader.bookings).toHaveBeenCalledOnce();
    }
  );
  it("restored authority after a post-source denial cannot un-latch or allow later reads or a result", async () => {
    const reader = readerSeam();
    const denied = new TRPCError({ code: "FORBIDDEN" });
    let gates = 0;
    await expect(
      checkHqFirstPage({
        env: settings(),
        createReader: () => reader,
        guard: async () => {
          if (++gates === 3) throw denied;
        },
      })
    ).rejects.toBe(denied);
    expect(gates).toBe(4);
    expect(reader.capabilities).not.toHaveBeenCalled();
    expect(reader.bookings).not.toHaveBeenCalled();
  });
  it("restored token binding at final gate cannot clear a detected rotation latch", async () => {
    const env = settings();
    const reader = readerSeam();
    let gates = 0;
    reader.status.mockImplementation(async () => {
      env.HQ_PORTAL_SYNC_TOKEN = "rotated-" + "x".repeat(32);
      return status();
    });
    await expect(
      checkHqFirstPage({
        env,
        createReader: () => reader,
        guard: async () => {
          if (++gates === 4) env.HQ_PORTAL_SYNC_TOKEN = TOKEN;
        },
      })
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(env.HQ_PORTAL_SYNC_TOKEN).toBe(TOKEN);
    expect(reader.capabilities).not.toHaveBeenCalled();
  });
  it("simultaneous failed source, token drift and revocation preserves the first binding failure", async () => {
    const env = settings();
    const reader = readerSeam();
    const denied = new TRPCError({ code: "FORBIDDEN" });
    let revoked = false;
    reader.bookings.mockImplementation(async () => {
      env.HQ_PORTAL_SYNC_TOKEN = "rotated-" + "x".repeat(32);
      revoked = true;
      throw new Error(PRIVATE);
    });
    await expect(
      checkHqFirstPage({
        env,
        createReader: () => reader,
        guard: async () => {
          if (revoked) throw denied;
        },
      })
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });
  it("invalid-settings return still propagates authority denial at its final gate", async () => {
    const denied = new TRPCError({ code: "FORBIDDEN" });
    let gates = 0;
    await expect(
      checkHqFirstPage({
        env: {},
        guard: async () => {
          if (++gates === 2) throw denied;
        },
      })
    ).rejects.toBe(denied);
  });
});
