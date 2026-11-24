import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
// This suite never uses the application's DB binding, even when invoked alone.
vi.hoisted(() => {
  delete process.env.DATABASE_URL;
});
import {
  captureHqConnectionBinding,
  checkHqConnection,
  HQ_DEFAULT_REPORTING_BASE_URL,
  type HqConnectionCheckEnv,
} from "./management-hq-connection-check";
import { HqContractError, HqOrbitClient } from "./management-hq-orbit-client";
import { HQ_LIVE_SCOPE } from "./management-hq-live-config";
import type { HqWireStatus } from "../shared/management-hq-wire";
import type { HqConnectionCheckOutcome } from "../shared/management-hq-connection-check";

const KEY = "SYNTHETIC-REPORTING-KEY-32-CHARS-ONLY";
const NOW = "2026-11-24T12:00:00.000Z";
const PRIVATE =
  "private-key https://private.test/key?token=private customer@example.test SELECT private_payload hash-deadbeef";
const messages: Record<HqConnectionCheckOutcome, string> = {
  ready:
    "Portal can connect to Orbit. No bookings have been imported or HQ switched on.",
  stale: "Orbit is connected, but its latest reporting data is out of date.",
  not_ready:
    "Orbit’s reporting data is not ready yet. No bookings have been imported.",
  missing_key:
    "Orbit reporting key is not configured (HQ_ORBIT_REPORTING_API_KEY).",
  invalid_settings:
    "Orbit connection settings are invalid. No bookings have been imported.",
  key_rejected: "Orbit reporting key was rejected.",
  unavailable:
    "Portal could not complete the Orbit connection check. No bookings have been imported.",
};
function status(): HqWireStatus {
  return {
    generationId: 47,
    projectionVersion: "1.0.0",
    scope: HQ_LIVE_SCOPE,
    sourceObservationWindow: {
      from: "2026-11-24T11:59:49.000Z",
      to: "2026-11-24T11:59:50.000Z",
    },
    publishedAt: "2026-11-24T11:59:55.000Z",
    expiresAt: "2026-11-25T11:59:55.000Z",
    changeUpper: 989,
    sourceAgeSeconds: 10,
    freshnessTargetSeconds: 900,
    stale: false,
    consistency: "sealed_reporting_generation_with_per_page_source_snapshot",
    counts: { bookingCount: 12345, businessCount: 67890, diagnostic: PRIVATE },
    ready: true,
    diagnostic: PRIVATE,
  };
}
const capabilities = () => ({
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
  diagnostic: PRIVATE,
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
const settings = (): HqConnectionCheckEnv => ({
  HQ_ORBIT_REPORTING_API_KEY: KEY,
  HQ_LIVE_SYNC_ENABLED: "false",
  HQ_LIVE_READ_ENABLED: "false",
});
function readerSeam() {
  return {
    status: vi.fn(async () => status()),
    capabilities: vi.fn(async () => capabilities()),
  };
}
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
function assertSafe(
  value: Awaited<ReturnType<typeof checkHqConnection>>,
  outcome: HqConnectionCheckOutcome
) {
  expect(value).toEqual({
    outcome,
    message: messages[outcome],
    checkedAt: NOW,
    generationId: outcome === "ready" || outcome === "stale" ? 47 : null,
    sourcePublishedAt:
      outcome === "ready" || outcome === "stale" ? status().publishedAt : null,
    sourceObservationAt:
      outcome === "ready" || outcome === "stale"
        ? status().sourceObservationWindow.to
        : null,
  });
  expect(JSON.stringify(value)).not.toMatch(
    /private|customer@|SELECT|hash-deadbeef|12345|67890|changeUpper|scope|sourceAgeSeconds|bookingCount|apiKey|https:/
  );
}
let forbiddenFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  expect(process.env.DATABASE_URL).toBeUndefined();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  forbiddenFetch = vi.fn(() => {
    throw new Error("Live transport forbidden");
  });
  vi.stubGlobal("fetch", forbiddenFetch);
});
afterEach(() => {
  expect(forbiddenFetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("synthetic health-only connection settings; no activation or real-health evidence", () => {
  it("import and construction are inert, including enabled and disabled strict clients", async () => {
    await import("./management-hq-connection-check");
    new HqOrbitClient({
      baseUrl: HQ_DEFAULT_REPORTING_BASE_URL,
      apiKey: KEY,
      scopeId: HQ_LIVE_SCOPE,
      enabled: true,
    });
    new HqOrbitClient({
      baseUrl: HQ_DEFAULT_REPORTING_BASE_URL,
      apiKey: KEY,
      scopeId: HQ_LIVE_SCOPE,
      enabled: false,
    });
    expect(forbiddenFetch).not.toHaveBeenCalled();
  });
  it.each([undefined, ""])(
    "missing key %s returns only fixed unhealthy metadata without creating a reader",
    async key => {
      const createReader = vi.fn();
      const beforeRequest = vi.fn();
      assertSafe(
        await checkHqConnection({
          env: { HQ_ORBIT_REPORTING_API_KEY: key },
          createReader,
          beforeRequest,
        }),
        "missing_key"
      );
      expect(createReader).not.toHaveBeenCalled();
      expect(beforeRequest).not.toHaveBeenCalled();
    }
  );
  const invalid: [keyof HqConnectionCheckEnv, string][] = [
    ...[
      "x".repeat(31),
      "x".repeat(257),
      " ".repeat(32),
      KEY + " ",
      KEY + "\n",
      KEY + "\t",
      KEY + "\u007f",
      KEY + "é",
    ].map(
      v =>
        ["HQ_ORBIT_REPORTING_API_KEY", v] as [
          keyof HqConnectionCheckEnv,
          string,
        ]
    ),
    ...["", "TRUE", "False", "1", "0", " true", "false "].flatMap(v =>
      ["HQ_LIVE_SYNC_ENABLED", "HQ_LIVE_READ_ENABLED"].map(
        k => [k, v] as [keyof HqConnectionCheckEnv, string]
      )
    ),
    ...[
      "",
      "0",
      "59",
      "3601",
      "060",
      "60.0",
      "1e2",
      "+60",
      " 60",
      "9007199254740992",
    ].map(
      v =>
        ["HQ_LIVE_INTERVAL_SECONDS", v] as [keyof HqConnectionCheckEnv, string]
    ),
    ...[
      "",
      "0",
      "59",
      "86401",
      "060",
      "60.5",
      "Infinity",
      "900 ",
      "-60",
      "9007199254740992",
    ].map(
      v =>
        ["HQ_LIVE_FRESHNESS_SECONDS", v] as [keyof HqConnectionCheckEnv, string]
    ),
    ...[
      "",
      "not-a-url",
      "http://orbit.thejltgroup.co.uk/api",
      "https://user:pass@orbit.thejltgroup.co.uk/api",
      "https://orbit.thejltgroup.co.uk/api?key=private",
      "https://orbit.thejltgroup.co.uk/api#private",
      "https://orbit.thejltgroup.co.uk/api?",
      "https://orbit.thejltgroup.co.uk/api#",
      "https://127.0.0.1/api",
      "https://169.254.169.254/api",
      "https://[::1]/api",
      "https://localhost/api",
      "https://host.internal/api",
      "https://fixture.test/api",
      "https://orbit.thejltgroup.co.uk:444/api",
      "https://orbit.thejltgroup.co.uk/api/%2e%2e",
      "https://orbit.thejltgroup.co.uk/api\\bad",
      " https://orbit.thejltgroup.co.uk/api",
      "https://orbit.thejltgroup.co.uk./api",
    ].map(
      v =>
        ["HQ_ORBIT_REPORTING_BASE_URL", v] as [
          keyof HqConnectionCheckEnv,
          string,
        ]
    ),
  ];
  it.each(invalid)(
    "rejects strict %s setting %s without source calls",
    async (field, value) => {
      const createReader = vi.fn();
      assertSafe(
        await checkHqConnection({
          env: { ...settings(), [field]: value },
          createReader,
        }),
        "invalid_settings"
      );
      expect(createReader).not.toHaveBeenCalled();
    }
  );
  it.each([
    {
      HQ_ORBIT_REPORTING_API_KEY: "x".repeat(32),
      HQ_LIVE_INTERVAL_SECONDS: "60",
      HQ_LIVE_FRESHNESS_SECONDS: "60",
    },
    {
      HQ_ORBIT_REPORTING_API_KEY: "x".repeat(256),
      HQ_LIVE_INTERVAL_SECONDS: "3600",
      HQ_LIVE_FRESHNESS_SECONDS: "86400",
    },
    { HQ_LIVE_SYNC_ENABLED: undefined, HQ_LIVE_READ_ENABLED: undefined },
    { HQ_LIVE_SYNC_ENABLED: "true", HQ_LIVE_READ_ENABLED: "true" },
    {
      HQ_ORBIT_REPORTING_BASE_URL:
        "https://approved.example.org/api/reporting/v1/",
    },
  ])(
    "valid bounded settings %j perform only two internal source reads",
    async patch => {
      const env = { ...settings(), ...patch };
      const before = { ...env };
      const reader = readerSeam();
      const factory = vi.fn(() => reader);
      assertSafe(
        await checkHqConnection({ env, createReader: factory }),
        "ready"
      );
      expect(factory).toHaveBeenCalledWith(
        env.HQ_ORBIT_REPORTING_BASE_URL ?? HQ_DEFAULT_REPORTING_BASE_URL,
        env.HQ_ORBIT_REPORTING_API_KEY
      );
      expect(reader.status).toHaveBeenCalledOnce();
      expect(reader.capabilities).toHaveBeenCalledOnce();
      expect(env).toEqual(before);
    }
  );
  it("default confirmed Orbit URL is used solely for health with flags still off", async () => {
    const reader = readerSeam();
    const factory = vi.fn(() => reader);
    const env = settings();
    assertSafe(
      await checkHqConnection({ env, createReader: factory }),
      "ready"
    );
    expect(factory).toHaveBeenCalledWith(
      "https://orbit.thejltgroup.co.uk/api/reporting/v1",
      KEY
    );
    expect(env.HQ_LIVE_SYNC_ENABLED).toBe("false");
    expect(env.HQ_LIVE_READ_ENABLED).toBe("false");
  });
  it("ready wording claims connectivity, not publication/report acceptance or activation", () => {
    expect(messages.ready).toContain(
      "No bookings have been imported or HQ switched on"
    );
    expect(messages.ready).not.toMatch(
      /report.*accepted|live.*ready|reporting.*enabled/i
    );
  });
});

describe("real strict Orbit adapter with in-memory transport, never live", () => {
  it("validates real metadata shape and permits only status then capabilities GETs", async () => {
    const transport = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
      json(String(input).endsWith("/status") ? status() : capabilities())
    );
    assertSafe(
      await checkHqConnection({
        env: settings(),
        createReader: () => adapter(transport),
      }),
      "ready"
    );
    expect(transport).toHaveBeenCalledTimes(2);
    expect(
      transport.mock.calls.map(([u]) => new URL(String(u)).pathname)
    ).toEqual(["/api/reporting/v1/status", "/api/reporting/v1/capabilities"]);
    for (const [u, init] of transport.mock.calls as unknown as Parameters<
      typeof fetch
    >[]) {
      expect(new URL(String(u)).search).toBe("");
      expect(init).toMatchObject({
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
      });
      expect(init!.body).toBeUndefined();
      const headers = new Headers(init!.headers);
      expect(headers.get("X-Orbit-Reporting-Key")).toBe(KEY);
      for (const field of ["Authorization", "Cookie", "Origin"])
        expect(headers.get(field)).toBeNull();
    }
  });
  it.each(["status", "capabilities"])(
    "sanitizes actual adapter errors at %s and retains null unhealthy metadata",
    async endpoint => {
      for (const [httpStatus, outcome] of [
        [401, "key_rejected"],
        [403, "key_rejected"],
        [503, "unavailable"],
        [429, "unavailable"],
        [500, "unavailable"],
        [302, "unavailable"],
      ] as const) {
        const transport = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
          String(input).endsWith(`/${endpoint}`)
            ? new Response(PRIVATE, { status: httpStatus })
            : json(status())
        );
        assertSafe(
          await checkHqConnection({
            env: settings(),
            createReader: () => adapter(transport),
          }),
          outcome
        );
        expect(transport).toHaveBeenCalledTimes(endpoint === "status" ? 1 : 2);
      }
    }
  );
  it.each([
    [
      "ready false",
      "status",
      (s: any) => {
        s.ready = false;
      },
    ],
    [
      "unsafe generation",
      "status",
      (s: any) => {
        s.generationId = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      "missing generation",
      "status",
      (s: any) => {
        delete s.generationId;
      },
    ],
    [
      "invalid instant",
      "status",
      (s: any) => {
        s.publishedAt = PRIVATE;
      },
    ],
    [
      "reversed observation",
      "status",
      (s: any) => {
        s.sourceObservationWindow.from = s.expiresAt;
      },
    ],
    [
      "invalid expiry",
      "status",
      (s: any) => {
        s.expiresAt = s.publishedAt;
      },
    ],
    [
      "string age",
      "status",
      (s: any) => {
        s.sourceAgeSeconds = "10";
      },
    ],
    [
      "wrong version",
      "capabilities",
      (s: any) => {
        s.apiVersion = "2.0.0";
      },
    ],
    [
      "source writes",
      "capabilities",
      (s: any) => {
        s.sourceWrites = true;
      },
    ],
    [
      "provider calls",
      "capabilities",
      (s: any) => {
        s.providerCalls = true;
      },
    ],
    [
      "quotes",
      "capabilities",
      (s: any) => {
        s.quotes = true;
      },
    ],
    [
      "missing endpoints",
      "capabilities",
      (s: any) => {
        delete s.endpoints;
      },
    ],
  ] as const)(
    "rejects %s using real shape validators",
    async (_label, endpoint, mutate) => {
      const body = endpoint === "status" ? status() : capabilities();
      mutate(body);
      const transport = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
        json(String(input).endsWith(`/${endpoint}`) ? body : status())
      );
      assertSafe(
        await checkHqConnection({
          env: settings(),
          createReader: () => adapter(transport),
        }),
        "not_ready"
      );
      expect(transport).toHaveBeenCalledTimes(endpoint === "status" ? 1 : 2);
    }
  );
  it("wrong company scope fails closed without projecting its generation", async () => {
    const transport = vi.fn(async () =>
      json({ ...status(), scope: "other_company" })
    );
    assertSafe(
      await checkHqConnection({
        env: settings(),
        createReader: () => adapter(transport),
      }),
      "unavailable"
    );
    expect(transport).toHaveBeenCalledOnce();
  });
  it.each(["status", "capabilities"])(
    "raw transport exception at %s is fixed plain English",
    async endpoint => {
      const transport = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        if (String(input).endsWith(`/${endpoint}`)) throw new Error(PRIVATE);
        return json(status());
      });
      assertSafe(
        await checkHqConnection({
          env: settings(),
          createReader: () => adapter(transport),
        }),
        "unavailable"
      );
      expect(transport).toHaveBeenCalledTimes(endpoint === "status" ? 1 : 2);
    }
  );
  it("a bounded timeout has no retry or second read", async () => {
    const transport = vi.fn(() => new Promise<Response>(() => undefined));
    const pending = checkHqConnection({
      env: settings(),
      createReader: () => adapter(transport),
    });
    await vi.advanceTimersByTimeAsync(10000);
    const value = await pending;
    expect(value.outcome).toBe("unavailable");
    expect(value.generationId).toBeNull();
    expect(value.message).toBe(messages.unavailable);
    expect(transport).toHaveBeenCalledOnce();
  });
});

describe("synthetic freshness never weakens source or Portal limits", () => {
  it.each([
    ["source says stale", { stale: true, sourceAgeSeconds: 1 }, {}, "stale"],
    ["source age too old", { sourceAgeSeconds: 901 }, {}, "stale"],
    [
      "Portal stricter than source",
      { sourceAgeSeconds: 61 },
      { HQ_LIVE_FRESHNESS_SECONDS: "60" },
      "stale",
    ],
    [
      "Portal cannot weaken source",
      { sourceAgeSeconds: 901 },
      { HQ_LIVE_FRESHNESS_SECONDS: "86400" },
      "stale",
    ],
    [
      "exact ceiling remains fresh",
      { sourceAgeSeconds: 60 },
      { HQ_LIVE_FRESHNESS_SECONDS: "60" },
      "ready",
    ],
  ] as const)("%s", async (_label, patch, envPatch, outcome) => {
    const reader = readerSeam();
    reader.status.mockResolvedValue({ ...status(), ...patch });
    assertSafe(
      await checkHqConnection({
        env: { ...settings(), ...envPatch },
        createReader: () => reader,
      }),
      outcome
    );
  });
  it.each(["old observation", "expired generation", "expiry exactly now"])(
    "false source stale still becomes stale for %s",
    async reason => {
      const s = status();
      if (reason === "old observation")
        s.sourceObservationWindow = {
          from: "2026-11-24T11:00:00.000Z",
          to: "2026-11-24T11:00:01.000Z",
        };
      else {
        s.publishedAt = "2026-11-24T11:59:51.000Z";
        s.expiresAt =
          reason === "expiry exactly now" ? NOW : "2026-11-24T11:59:59.000Z";
      }
      const transport = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
        json(String(input).endsWith("/status") ? s : capabilities())
      );
      const value = await checkHqConnection({
        env: settings(),
        createReader: () => adapter(transport),
      });
      expect(value.outcome).toBe("stale");
      expect(value.generationId).toBe(47);
      expect(transport).toHaveBeenCalledTimes(2);
    }
  );
});

describe("internal reader seam fault, authorization and binding timing", () => {
  it("fresh authority surrounds every source await in exact order", async () => {
    const events: string[] = [];
    const reader = readerSeam();
    reader.status.mockImplementation(async () => {
      events.push("status");
      return status();
    });
    reader.capabilities.mockImplementation(async () => {
      events.push("capabilities");
      return capabilities();
    });
    await checkHqConnection({
      env: settings(),
      createReader: () => reader,
      beforeRequest: async () => {
        events.push("fresh authority");
      },
    });
    expect(events).toEqual([
      "fresh authority",
      "status",
      "fresh authority",
      "fresh authority",
      "capabilities",
      "fresh authority",
    ]);
  });
  it.each([1, 2, 3, 4])(
    "authority revocation at gate %s propagates rather than returning health",
    async gate => {
      const reader = readerSeam();
      let calls = 0;
      const denied = new TRPCError({
        code: "FORBIDDEN",
        message: "Active Super Admin access required.",
      });
      await expect(
        checkHqConnection({
          env: settings(),
          createReader: () => reader,
          beforeRequest: async () => {
            if (++calls === gate) throw denied;
          },
        })
      ).rejects.toBe(denied);
      expect(reader.status).toHaveBeenCalledTimes(gate === 1 ? 0 : 1);
      expect(reader.capabilities).toHaveBeenCalledTimes(gate === 4 ? 1 : 0);
    }
  );
  it.each(["status", "capabilities"] as const)(
    "failed %s read still performs post-read fresh authority and propagates revocation",
    async endpoint => {
      const reader = readerSeam();
      reader[endpoint].mockRejectedValue(new HqContractError("UNAVAILABLE"));
      let gates = 0;
      const denied = new TRPCError({
        code: "FORBIDDEN",
        message: "Active Super Admin access required.",
      });
      await expect(
        checkHqConnection({
          env: settings(),
          createReader: () => reader,
          beforeRequest: async () => {
            if (++gates === (endpoint === "status" ? 2 : 4)) throw denied;
          },
        })
      ).rejects.toBe(denied);
      expect(gates).toBe(endpoint === "status" ? 2 : 4);
    }
  );
  const driftValues: [keyof HqConnectionCheckEnv, string][] = [
    ["HQ_ORBIT_REPORTING_API_KEY", "ROTATED-SYNTHETIC-KEY-" + "x".repeat(40)],
    [
      "HQ_ORBIT_REPORTING_BASE_URL",
      "https://approved.example.org/api/reporting/v1",
    ],
    ["HQ_LIVE_SYNC_ENABLED", "true"],
    ["HQ_LIVE_READ_ENABLED", "true"],
    ["HQ_LIVE_INTERVAL_SECONDS", "600"],
    ["HQ_LIVE_FRESHNESS_SECONDS", "60"],
  ];
  it.each(driftValues)(
    "source-binding %s drift is detected before, between and after source reads",
    async (field, value) => {
      for (const when of [
        "construction",
        "pre-status",
        "status",
        "post-status",
        "pre-capabilities",
        "capabilities",
        "post-capabilities",
      ]) {
        const env = settings();
        const reader = readerSeam();
        let gate = 0;
        reader.status.mockImplementation(async () => {
          if (when === "status") env[field] = value;
          return status();
        });
        reader.capabilities.mockImplementation(async () => {
          if (when === "capabilities") env[field] = value;
          return capabilities();
        });
        const result = await checkHqConnection({
          env,
          createReader: () => {
            if (when === "construction") env[field] = value;
            return reader;
          },
          beforeRequest: async () => {
            gate++;
            if (
              (when === "pre-status" && gate === 1) ||
              (when === "post-status" && gate === 2) ||
              (when === "pre-capabilities" && gate === 3) ||
              (when === "post-capabilities" && gate === 4)
            )
              env[field] = value;
          },
        });
        assertSafe(result, "invalid_settings");
        expect(reader.status).toHaveBeenCalledTimes(
          ["construction", "pre-status"].includes(when) ? 0 : 1
        );
        expect(reader.capabilities).toHaveBeenCalledTimes(
          ["capabilities", "post-capabilities"].includes(when) ? 1 : 0
        );
        expect(result.message).not.toContain("No source data was read");
      }
    }
  );
  it.each(["status", "capabilities"] as const)(
    "binding drift during a failed %s read outranks the raw source error",
    async endpoint => {
      const env = settings();
      const reader = readerSeam();
      reader[endpoint].mockImplementation(async () => {
        env.HQ_ORBIT_REPORTING_API_KEY = "rotated-" + "x".repeat(40);
        throw new Error(PRIVATE);
      });
      assertSafe(
        await checkHqConnection({ env, createReader: () => reader }),
        "invalid_settings"
      );
    }
  );
  it.each(["status", "capabilities"] as const)(
    "failed %s read plus binding drift still checks authority and propagates revocation",
    async endpoint => {
      const env = settings();
      const reader = readerSeam();
      let revoked = false;
      const denied = new TRPCError({
        code: "FORBIDDEN",
        message: "Active Super Admin access required.",
      });
      const gate = vi.fn(async () => {
        if (revoked) throw denied;
      });
      reader[endpoint].mockImplementation(async () => {
        env.HQ_ORBIT_REPORTING_API_KEY = "rotated-" + "x".repeat(40);
        revoked = true;
        throw new HqContractError("UNAVAILABLE");
      });
      await expect(
        checkHqConnection({
          env,
          createReader: () => reader,
          beforeRequest: gate,
        })
      ).rejects.toBe(denied);
      expect(gate).toHaveBeenCalledTimes(endpoint === "status" ? 2 : 4);
    }
  );
  it.each([
    ["AUTH_DENIED", "key_rejected"],
    ["INVALID_PAYLOAD", "not_ready"],
    ["INVALID_SEMANTICS", "not_ready"],
    ["SOURCE_NOT_READY", "not_ready"],
    ["INVALID_CONFIGURATION", "invalid_settings"],
    ["UNAVAILABLE", "unavailable"],
    ["TIMEOUT", "unavailable"],
  ] as const)(
    "source error code %s retains safe %s mapping and post-read gate",
    async (code, outcome) => {
      const reader = readerSeam();
      const gate = vi.fn(async () => undefined);
      reader.status.mockRejectedValue(
        Object.assign(new Error(PRIVATE), { code })
      );
      assertSafe(
        await checkHqConnection({
          env: settings(),
          createReader: () => reader,
          beforeRequest: gate,
        }),
        outcome
      );
      expect(gate).toHaveBeenCalledTimes(2);
      expect(reader.capabilities).not.toHaveBeenCalled();
    }
  );
  it("opaque source assertion returns no binding values and detects disabled-mode changes", () => {
    const env = settings();
    const assert = captureHqConnectionBinding(env);
    expect(assert()).toBeUndefined();
    expect(JSON.stringify(assert)).toBeUndefined();
    env.HQ_ORBIT_REPORTING_BASE_URL = "https://approved.example.org/api";
    expect(assert).toThrow("INVALID_CONFIGURATION");
  });
});
