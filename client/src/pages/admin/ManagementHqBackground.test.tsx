// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Page, React DOM, Wouter links and Buttons are real. Only auth/tRPC are mocked.
const mock = vi.hoisted(() => ({
  user: null as any,
  loading: false,
  authError: null as any,
  data: {} as Record<string, any>,
  errors: {} as Record<string, any>,
  fetching: {} as Record<string, boolean>,
  queryWait: {} as Record<string, Promise<void>>,
  hooks: [] as { path: string; input: any; options: any }[],
  calls: [] as { path: string; input: any; actorId: number }[],
  refetch: vi.fn(),
  mutate: vi.fn(),
  network: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mock.user,
    loading: mock.loading,
    error: mock.authError,
  }),
}));
vi.mock("@/lib/trpc", async () => {
  const react = await import("react");
  const read = (path: string) =>
    path === "auth.me" ? (mock.data[path] ?? mock.user) : mock.data[path];
  const nodes = new Map<string, any>();
  function node(path = ""): any {
    if (nodes.has(path)) return nodes.get(path);
    const proxy = new Proxy(
      {},
      {
        get: (_target, key: string) => {
          if (key === "useQuery")
            return (input: any, options: any = {}) => {
              mock.hooks.push({ path, input, options });
              const [fresh, setFresh] = react.useState(false);
              const [, tick] = react.useState(0);
              react.useEffect(() => {
                let mounted = true;
                void Promise.resolve(mock.queryWait[path]).then(() => {
                  if (mounted) setFresh(true);
                });
                return () => {
                  mounted = false;
                };
              }, []);
              return {
                data: read(path),
                error: mock.errors[path] ?? null,
                isLoading: false,
                isFetching: !!mock.fetching[path],
                isFetchedAfterMount: fresh,
                refetch: async (options: any) => {
                  const override = await mock.refetch(path, options);
                  const value = override ?? {
                    data: read(path),
                    error: mock.errors[path] ?? null,
                  };
                  if (value.data !== undefined) mock.data[path] = value.data;
                  tick(value => value + 1);
                  return value;
                },
              };
            };
          if (key === "useMutation")
            return () => {
              const actorId = react.useRef(mock.user?.id).current;
              return {
                mutateAsync: async (input?: any) => {
                  mock.calls.push({ path, input, actorId });
                  return await mock.mutate(path, input);
                },
              };
            };
          return node(path ? `${path}.${key}` : key);
        },
      }
    );
    nodes.set(path, proxy);
    return proxy;
  }
  return { trpc: node() };
});
import ManagementHqBackground from "./ManagementHqBackground";
const BG = "managementHq.backgroundInitialImportStatus";
const HQ = "managementHq.status";
const START = "managementHq.startBackgroundInitialImport";
const PAUSE = "managementHq.pauseBackgroundInitialImport";
const progressLabel = '[aria-label="Saved initial import progress"]';
function job(status = "queued", patch: Record<string, any> = {}) {
  return {
    status,
    startedAt: "2026-11-28T10:48:00.000Z",
    expiresAt: "2026-11-29T10:48:00.000Z",
    nextDueAt: "2026-11-28T10:49:00.000Z",
    attempts: status === "running" ? 1 : 0,
    consecutiveErrors: 0,
    lastErrorCode: null,
    ...patch,
  };
}
function hq() {
  return {
    reportMode: "live",
    liveConfigured: true,
    stateVersion: 4,
    live: {
      configured: true,
      configurationCode: null,
      syncEnabled: true,
      readEnabled: false,
      intervalSeconds: 300,
      freshnessSeconds: 900,
      health: "progress",
      stageStatus: "progress",
      hasPublished: false,
      lastErrorCode: null,
      nextDueAt: "2026-11-28T10:49:00.000Z",
      progress: {
        kind: "backfill",
        phase: "NEVER-RENDER-phase",
        pages: 4,
        recordsRead: 300,
      },
    },
  };
}
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let actorSequence = 400;
let container: HTMLDivElement;
let root: Root;
async function render() {
  await act(async () => {
    root.render(React.createElement(ManagementHqBackground));
  });
  await act(async () => {
    await Promise.resolve();
  });
}
function button(text: string) {
  const found = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button")
  ).filter(value => value.textContent?.trim() === text);
  expect(found, text).toHaveLength(1);
  return found[0]!;
}
async function click(text: string) {
  await act(async () => {
    button(text).click();
  });
}
function expectFreshPair() {
  expect(mock.refetch.mock.calls).toEqual([
    [BG, { cancelRefetch: false }],
    [HQ, { cancelRefetch: false }],
  ]);
}
function expectHidden() {
  expect(container.querySelector(progressLabel)).toBeNull();
  expect(container.textContent).not.toContain("First import completed.");
  expect(container.textContent).not.toContain("300 records read");
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mock.network);
  mock.network.mockImplementation(() => {
    throw new Error("Real network forbidden in offline HQ UI tests");
  });
  mock.user = {
    id: ++actorSequence,
    role: "super_admin",
    isActive: true,
    portalStatus: "active",
  };
  mock.loading = false;
  mock.authError = null;
  mock.errors = {};
  mock.fetching = {};
  mock.queryWait = {};
  mock.hooks = [];
  mock.calls = [];
  mock.data = { [HQ]: hq(), [BG]: { enabled: true, job: null } };
  mock.refetch.mockReset();
  mock.refetch.mockResolvedValue(undefined);
  mock.mutate.mockReset();
  mock.mutate.mockImplementation(async (path: string) => {
    const value = {
      enabled: true,
      job: job(path === PAUSE ? "paused" : "queued"),
    };
    mock.data[BG] = value;
    return value;
  });
  window.history.replaceState({}, "", "/admin/management-hq/background");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  expect(mock.network).not.toHaveBeenCalled();
  expect(
    mock.hooks.every(value => ["auth.me", BG, HQ].includes(value.path))
  ).toBe(true);
  expect(mock.calls.every(value => [START, PAUSE].includes(value.path))).toBe(
    true
  );
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Management HQ background initial import", () => {
  it("only reads fresh auth and saved status on mount, without mutations, polling or source requests", async () => {
    await render();
    expect(container.querySelector("h1")?.textContent).toBe(
      "Background initial import"
    );
    expect(
      container.querySelector('a[href="/admin/management-hq"]')?.textContent
    ).toContain("Back to Management HQ");
    expect(container.textContent).toContain("4 pages · 300 records read");
    expect(container.textContent).toContain(
      "You can close this page once the background request is confirmed."
    );
    expect(container.textContent).toContain(
      "regular updates and dashboard reading remain off."
    );
    expect(container.textContent).not.toContain("NEVER-RENDER");
    expect(mock.calls).toHaveLength(0);
    expect(mock.refetch).not.toHaveBeenCalled();
    for (const hook of mock.hooks) {
      expect(hook.input).toBeUndefined();
      expect(hook.options).toMatchObject({
        retry: false,
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      });
      expect(hook.options).not.toHaveProperty("refetchInterval");
      expect(hook.options).not.toHaveProperty("placeholderData");
    }
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    });
    vi.useRealTimers();
    expect(mock.calls).toHaveLength(0);
    expect(mock.refetch).not.toHaveBeenCalled();
    expect(container.querySelector("input,select,textarea,form")).toBeNull();
  });
  it("Refresh progress reads both statuses once and does no import work", async () => {
    await render();
    await click("Refresh progress");
    expectFreshPair();
    expect(mock.calls).toHaveLength(0);
    expect(container.querySelector(progressLabel)).toBeTruthy();
  });
  it("starts with exactly one void mutation then one fresh pair, and queued is not running", async () => {
    await render();
    await click("Run import in background");
    expect(mock.calls).toEqual([
      { path: START, input: undefined, actorId: mock.user.id },
    ]);
    expectFreshPair();
    expect(container.textContent).toContain("Queued for the Railway worker");
    expect(container.textContent).not.toContain("Background import is running");
    expect(button("Run import in background").disabled).toBe(true);
    expect(button("Pause background import").disabled).toBe(false);
  });
  it("pauses an active saved job with one void mutation and one fresh pair", async () => {
    mock.data[BG].job = job("running");
    await render();
    expect(container.textContent).toContain(
      "Railway worker claimed the background import."
    );
    expect(container.textContent).toContain(
      "does not prove the worker is still active"
    );
    await click("Pause background import");
    expect(mock.calls).toEqual([
      { path: PAUSE, input: undefined, actorId: mock.user.id },
    ]);
    expectFreshPair();
    expect(container.textContent).toContain("Background import is paused.");
    expect(button("Pause background import").disabled).toBe(true);
  });
  it("revisits a persisted queued job without starting it again", async () => {
    mock.data[BG].job = job();
    await render();
    await act(async () => {
      root.render(null);
    });
    await render();
    expect(container.textContent).toContain("Queued for the Railway worker");
    expect(button("Run import in background").disabled).toBe(true);
    expect(mock.calls).toHaveLength(0);
    expect(mock.refetch).not.toHaveBeenCalled();
  });
  it("does not display mutation success before both fresh reads actually settle", async () => {
    const pending = deferred<any>();
    const firstRead = deferred<any>();
    const secondRead = deferred<any>();
    mock.mutate.mockReturnValue(pending.promise);
    mock.refetch.mockImplementation((path: string) =>
      path === BG ? firstRead.promise : secondRead.promise
    );
    await render();
    await click("Run import in background");
    expect(mock.refetch).not.toHaveBeenCalled();
    expectHidden();
    await act(async () => {
      pending.resolve({ enabled: true, job: job() });
    });
    expectFreshPair();
    expectHidden();
    await act(async () => {
      firstRead.resolve({ data: { enabled: true, job: job() }, error: null });
    });
    expect(button("Pause background import").disabled).toBe(true);
    await act(async () => {
      secondRead.resolve({ data: hq(), error: null });
    });
    expect(container.textContent).toContain("Queued for the Railway worker");
  });
  it("locks same-tick competing start, pause and refresh clicks synchronously", async () => {
    const pending = deferred<any>();
    mock.mutate.mockReturnValue(pending.promise);
    await render();
    await act(async () => {
      button("Run import in background").click();
      button("Run import in background").click();
      button("Pause background import").click();
      button("Refresh progress").click();
    });
    expect(mock.calls).toHaveLength(1);
    expect(mock.refetch).not.toHaveBeenCalled();
    for (const label of [
      "Run import in background",
      "Pause background import",
      "Refresh progress",
    ])
      expect(button(label).disabled).toBe(true);
    await act(async () => {
      pending.resolve({ enabled: true, job: job() });
    });
    expectFreshPair();
  });
  it("locks all controls through a rejected fresh read until the other read settles", async () => {
    const waiting = deferred<any>();
    mock.refetch.mockImplementation((path: string) =>
      path === BG
        ? Promise.reject(new Error("NEVER-RENDER-provider"))
        : waiting.promise
    );
    await render();
    await click("Run import in background");
    expect(button("Refresh progress").disabled).toBe(true);
    await act(async () => {
      waiting.resolve({ data: hq(), error: null });
    });
    expectHidden();
    expect(container.textContent).not.toContain("NEVER-RENDER");
    expect(button("Run import in background").disabled).toBe(true);
    expect(button("Refresh progress").disabled).toBe(false);
  });
  it("closing a pending start leaves server continuation alone, performs no detached callbacks, and blocks same-actor remount", async () => {
    const pending = deferred<any>();
    mock.mutate.mockReturnValue(pending.promise);
    await render();
    await click("Run import in background");
    await act(async () => {
      root.render(null);
    });
    await render();
    expect(button("Run import in background").disabled).toBe(true);
    expect(button("Pause background import").disabled).toBe(true);
    expect(button("Refresh progress").disabled).toBe(true);
    expect(container.textContent).toContain(
      "Closing this page does not cancel a saved Railway job."
    );
    await click("Run import in background");
    expect(mock.calls).toHaveLength(1);
    mock.data[BG].job = job();
    await act(async () => {
      pending.resolve({ enabled: true, job: job() });
    });
    expect(mock.refetch).not.toHaveBeenCalled();
    expectHidden();
    expect(button("Run import in background").disabled).toBe(true);
    expect(button("Refresh progress").disabled).toBe(false);
    await click("Refresh progress");
    expectFreshPair();
    expect(container.textContent).toContain("Queued for the Railway worker");
    expect(mock.calls).toHaveLength(1);
  });
  it("closing after confirmed queue does not send a pause, cancellation or another batch", async () => {
    await render();
    await click("Run import in background");
    await act(async () => {
      root.render(null);
    });
    expect(mock.calls.map(value => value.path)).toEqual([START]);
    expectFreshPair();
  });
  it.each([
    { role: "admin" },
    { role: "agent" },
    { isActive: false },
    { portalStatus: "suspended" },
    { portalStatus: "pending" },
  ])("fails closed before HQ queries for changed authority %j", async patch => {
    Object.assign(mock.user, patch);
    await render();
    expect(container.textContent).toContain("Access denied");
    expectHidden();
    expect(mock.hooks).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });
  it("withholds cached progress until fresh auth and both status observers finish", async () => {
    const auth = deferred();
    const bg = deferred();
    const saved = deferred();
    mock.queryWait = {
      "auth.me": auth.promise,
      [BG]: bg.promise,
      [HQ]: saved.promise,
    };
    await render();
    expectHidden();
    expect(mock.hooks.every(value => value.path === "auth.me")).toBe(true);
    await act(async () => {
      auth.resolve();
    });
    expectHidden();
    await act(async () => {
      bg.resolve();
    });
    expectHidden();
    await act(async () => {
      saved.resolve();
    });
    expect(container.querySelector(progressLabel)).toBeTruthy();
  });
  it("rejects a fresh auth identity that disagrees with useAuth", async () => {
    mock.data["auth.me"] = { ...mock.user, id: mock.user.id + 1 };
    await render();
    expect(container.textContent).toContain("Access denied");
    expect(
      mock.hooks.filter(value => value.path.startsWith("managementHq."))
    ).toHaveLength(0);
  });
  it("requires a fresh observer for actor B and suppresses actor A's late settlement", async () => {
    const pending = deferred<any>();
    mock.mutate.mockReturnValue(pending.promise);
    await render();
    await click("Run import in background");
    const verify = deferred();
    mock.queryWait["auth.me"] = verify.promise;
    mock.user = { ...mock.user, id: ++actorSequence };
    await render();
    expectHidden();
    await act(async () => {
      pending.resolve({ enabled: true, job: job("completed") });
    });
    expect(mock.refetch).not.toHaveBeenCalled();
    expectHidden();
    await act(async () => {
      verify.resolve();
    });
    expect(
      container.querySelector("[data-actor]")?.getAttribute("data-actor")
    ).toBe(String(mock.user.id));
    expect(container.textContent).not.toContain("First import completed.");
  });
  it("anonymous authority suppresses cached success and detached callbacks", async () => {
    const pending = deferred<any>();
    mock.mutate.mockReturnValue(pending.promise);
    await render();
    await click("Run import in background");
    mock.user = null;
    await render();
    await act(async () => {
      pending.resolve({ enabled: true, job: job("completed") });
    });
    expectHidden();
    expect(mock.refetch).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Access denied");
  });
  it.each([BG, HQ, "auth.me"])(
    "suppresses cached progress and success after %s authority errors",
    async path => {
      mock.data[BG].job = job("completed");
      mock.data[HQ].live.hasPublished = true;
      await render();
      expect(container.textContent).toContain("First import completed.");
      mock.errors[path] = {
        data: { code: "FORBIDDEN" },
        message: "NEVER-RENDER-secret",
      };
      await render();
      expectHidden();
      expect(container.textContent).not.toContain("NEVER-RENDER");
      expect(mock.calls).toHaveLength(0);
      if (path !== "auth.me") {
        delete mock.errors[path];
        await render();
        expectHidden();
        expect(button("Run import in background").disabled).toBe(true);
        await click("Refresh progress");
        expect(container.textContent).toContain("First import completed.");
      }
    }
  );
  it.each(["actor", "inactive", "settings", "route", "query-error"])(
    "suppresses late outcomes and fresh callbacks after %s invalidation",
    async kind => {
      const pending = deferred<any>();
      mock.mutate.mockReturnValue(pending.promise);
      await render();
      await click("Run import in background");
      if (kind === "actor") mock.user = { ...mock.user, id: ++actorSequence };
      if (kind === "inactive") mock.user = { ...mock.user, isActive: false };
      if (kind === "settings") mock.data[HQ].live.readEnabled = true;
      if (kind === "route")
        await act(async () => {
          window.history.replaceState({}, "", "/super-admin");
        });
      if (kind === "query-error")
        mock.errors[BG] = { data: { code: "UNAUTHORIZED" } };
      await render();
      await act(async () => {
        pending.resolve({ enabled: true, job: job("completed") });
      });
      expect(mock.refetch).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain("First import completed.");
    }
  );
  it("reads once after an ordinary mutation failure, renders fixed copy and requires explicit fresh verification", async () => {
    mock.mutate.mockRejectedValue(
      new Error("NEVER-RENDER https://secret.invalid?token=hidden")
    );
    await render();
    await click("Run import in background");
    expectFreshPair();
    expectHidden();
    expect(container.textContent).toContain(
      "The background request could not be verified."
    );
    expect(container.textContent).not.toContain("NEVER-RENDER");
    expect(button("Run import in background").disabled).toBe(true);
    mock.refetch.mockClear();
    await click("Refresh progress");
    expectFreshPair();
    expect(button("Run import in background").disabled).toBe(false);
  });
  it.each([
    { status: "unknown" },
    { status: "__proto__" },
    { startedAt: "2026-02-30T10:48:00Z" },
    { nextDueAt: "<script>NEVER-RENDER</script>" },
    { expiresAt: "bad" },
    { expiresAt: "2026-11-27T10:48:00.000Z" },
    { attempts: -1 },
    { attempts: 1.5 },
    { attempts: Number.MAX_SAFE_INTEGER + 1 },
    { consecutiveErrors: 4 },
    { attempts: 201 },
    { status: "running", attempts: 0 },
    { expiresAt: "2026-11-30T10:48:00.000Z" },
    { consecutiveErrors: 1, attempts: 0 },
    { lastErrorCode: "NEVER-RENDER-token" },
  ])(
    "rejects malformed jobs without rendering arbitrary fields %j",
    async patch => {
      mock.data[BG].job = job("queued", patch);
      await render();
      expectHidden();
      expect(button("Run import in background").disabled).toBe(true);
      expect(button("Pause background import").disabled).toBe(true);
      expect(container.textContent).not.toContain("NEVER-RENDER");
    }
  );
  it.each([{ enabled: "true", job: null }, { enabled: true }, null, []])(
    "rejects malformed envelopes %j",
    async value => {
      mock.data[BG] = value;
      await render();
      expectHidden();
      expect(button("Run import in background").disabled).toBe(true);
    }
  );
  it("rejects a malformed mutation response even when the fresh saved job looks valid", async () => {
    mock.mutate.mockImplementation(async () => {
      mock.data[BG].job = job();
      return { enabled: true, job: job("unknown") };
    });
    await render();
    await click("Run import in background");
    expectFreshPair();
    expectHidden();
    expect(container.textContent).toContain(
      "The background request could not be verified."
    );
  });
  it.each([{ pages: -1 }, { recordsRead: "300" }, { kind: "unknown" }])(
    "rejects malformed saved progress %j",
    async patch => {
      Object.assign(mock.data[HQ].live.progress, patch);
      await render();
      expectHidden();
      expect(button("Run import in background").disabled).toBe(true);
    }
  );
  it("does not retain or render extra DTO fields or raw reference/error strings", async () => {
    mock.data[BG].job = job("failed", {
      actorId: "NEVER-RENDER-actor",
      token: "NEVER-RENDER-token",
      sourceBinding: "NEVER-RENDER-binding",
      message: "NEVER-RENDER-provider",
      lastErrorCode: "STORE_UNAVAILABLE",
    });
    mock.data[HQ].live.url = "NEVER-RENDER-source";
    await render();
    expect(container.textContent).toContain(
      "Background import stopped and needs attention."
    );
    expect(container.textContent).not.toContain("NEVER-RENDER");
    expect(container.textContent).not.toContain("STORE_UNAVAILABLE");
  });
  it("disabled setup copy denies start and pause", async () => {
    mock.data[BG].enabled = false;
    await render();
    expect(container.textContent).toContain(
      "Background import is not enabled yet. The Railway worker setup is required."
    );
    expect(button("Run import in background").disabled).toBe(true);
    expect(button("Pause background import").disabled).toBe(true);
  });
  it.each([
    { configured: false },
    { syncEnabled: false },
    { readEnabled: true },
    { hasPublished: true },
    { health: "needs_attention" },
    { stageStatus: "needs_attention" },
    { configurationCode: "CONFIG_INVALID" },
    { lastErrorCode: "INVALID_PERSISTED_STATE" },
    { progress: null },
    { progress: { kind: "catchup", pages: 2, recordsRead: 3 } },
    { progress: { kind: "backfill", pages: 0, recordsRead: 0 } },
  ])("denies start for unsafe or noninitial HQ state %j", async patch => {
    Object.assign(mock.data[HQ].live, patch);
    await render();
    expect(button("Run import in background").disabled).toBe(true);
    await click("Run import in background");
    expect(mock.calls).toHaveLength(0);
  });
  it("explicit TIMEOUT backoff start is allowed and never bypasses the server wait", async () => {
    Object.assign(mock.data[HQ].live, {
      health: "backoff",
      stageStatus: "backoff",
      lastErrorCode: "TIMEOUT",
      nextDueAt: "2099-01-01T00:00:00.000Z",
    });
    await render();
    expect(button("Run import in background").disabled).toBe(false);
    expect(container.textContent).toContain("respects this wait");
    await click("Run import in background");
    expect(mock.calls.map(value => value.input)).toEqual([undefined]);
    expectFreshPair();
  });
  it.each([
    "TIMEOUT",
    "RATE_LIMITED",
    "UNAVAILABLE",
    "TRANSPORT_FAILURE",
    "SOURCE_NOT_READY",
    "SOURCE_OR_STORE_UNAVAILABLE",
  ])("admits %s only as an explicit saved valid backoff", async code => {
    Object.assign(mock.data[HQ].live, {
      health: "backoff",
      stageStatus: "backoff",
      lastErrorCode: code,
    });
    await render();
    expect(button("Run import in background").disabled).toBe(false);
    expect(mock.calls).toHaveLength(0);
    mock.data[HQ].live.nextDueAt = null;
    await click("Refresh progress");
    expect(button("Run import in background").disabled).toBe(true);
    mock.data[HQ].live.nextDueAt = "2026-11-28T10:49:00.000Z";
    mock.data[HQ].live.health = "progress";
    await click("Refresh progress");
    expect(button("Run import in background").disabled).toBe(true);
    expect(mock.calls).toHaveLength(0);
  });
  it.each(["paused", "failed", "completed"])(
    "pause is unavailable for terminal %s jobs",
    async status => {
      mock.data[BG].job = job(status);
      await render();
      expect(button("Pause background import").disabled).toBe(true);
      await click("Pause background import");
      expect(mock.calls).toHaveLength(0);
    }
  );
  it("completed copy requires the saved publication and never says dashboards are enabled", async () => {
    mock.data[BG].job = job("completed");
    await render();
    expect(container.textContent).not.toContain("First import completed.");
    mock.data[HQ].live.hasPublished = true;
    await click("Refresh progress");
    expect(container.textContent).toContain(
      "First import completed. Return to Management HQ to check imported figures; dashboards remain off."
    );
  });
  it("same-actor remount retains ownership while post-mutation status reads are still unresolved", async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    mock.refetch.mockImplementation((path: string) =>
      path === BG ? first.promise : second.promise
    );
    await render();
    await click("Run import in background");
    expectFreshPair();
    await act(async () => {
      root.render(null);
    });
    await render();
    expect(button("Run import in background").disabled).toBe(true);
    await act(async () => {
      first.resolve({ data: { enabled: true, job: job() }, error: null });
    });
    expect(button("Pause background import").disabled).toBe(true);
    await act(async () => {
      second.resolve({ data: hq(), error: null });
    });
    expectHidden();
    expect(button("Refresh progress").disabled).toBe(false);
    expect(mock.calls).toHaveLength(1);
    expectFreshPair();
    mock.refetch.mockClear();
    mock.refetch.mockResolvedValue(undefined);
    await click("Refresh progress");
    expectFreshPair();
    expect(container.textContent).toContain("Queued for the Railway worker");
  });
  it("competing pause and refresh clicks send only one pause request", async () => {
    mock.data[BG].job = job("running");
    const waiting = deferred<any>();
    mock.mutate.mockReturnValue(waiting.promise);
    await render();
    await act(async () => {
      button("Pause background import").click();
      button("Pause background import").click();
      button("Run import in background").click();
      button("Refresh progress").click();
    });
    expect(mock.calls.map(value => value.path)).toEqual([PAUSE]);
    expect(mock.refetch).not.toHaveBeenCalled();
    mock.data[BG].job = job("paused");
    await act(async () => {
      waiting.resolve(mock.data[BG]);
    });
    expectFreshPair();
  });
  it("multiple explicit refresh clicks are a single-flight read pair", async () => {
    const waiting = deferred<any>();
    mock.refetch.mockReturnValue(waiting.promise);
    await render();
    await act(async () => {
      button("Refresh progress").click();
      button("Refresh progress").click();
      button("Run import in background").click();
    });
    expectFreshPair();
    expect(mock.calls).toHaveLength(0);
    await act(async () => {
      waiting.resolve(undefined);
    });
    expect(button("Run import in background").disabled).toBe(false);
  });
  it("settings changes after settlement suppress success and require explicit fresh status", async () => {
    const waiting = deferred<any>();
    mock.refetch.mockImplementation((path: string) =>
      path === HQ ? waiting.promise : undefined
    );
    await render();
    await click("Run import in background");
    mock.data[HQ].live.readEnabled = true;
    await act(async () => {
      waiting.resolve({ data: mock.data[HQ], error: null });
    });
    expectHidden();
    expect(button("Run import in background").disabled).toBe(true);
    expect(button("Refresh progress").disabled).toBe(false);
    mock.data[HQ].live.readEnabled = false;
    await render();
    expectHidden();
    mock.refetch.mockClear();
    mock.refetch.mockResolvedValue(undefined);
    await click("Refresh progress");
    expectFreshPair();
    expect(container.textContent).toContain("Queued for the Railway worker");
  });
  it("cached HQ attention changes do not leave prior verified start admission active", async () => {
    await render();
    expect(button("Run import in background").disabled).toBe(false);
    mock.data[HQ].live.health = "needs_attention";
    await render();
    expectHidden();
    expect(button("Run import in background").disabled).toBe(true);
    await click("Run import in background");
    expect(mock.calls).toHaveLength(0);
    await click("Refresh progress");
    expect(button("Run import in background").disabled).toBe(true);
  });
  it("a newly cached active job cannot permit a duplicate start from an older snapshot", async () => {
    await render();
    mock.data[BG].job = job("running");
    await render();
    expectHidden();
    expect(button("Run import in background").disabled).toBe(true);
    await click("Run import in background");
    expect(mock.calls).toHaveLength(0);
    await click("Refresh progress");
    expect(container.textContent).toContain(
      "Railway worker claimed the background import."
    );
    expect(button("Pause background import").disabled).toBe(false);
  });
});
