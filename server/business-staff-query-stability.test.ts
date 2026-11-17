// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, Route, Switch, useLocation } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import { DEFAULT_BUSINESS_STAFF_PERMISSIONS } from "../shared/business-staff";

// Only authentication and transport are synthetic. In particular, never mock
// useQuery's flags, the root fetching guard, Workspace or its authority context.
const transport = vi.hoisted(() => ({
  user: { id: 60, role: "agent", name: "Synthetic Assistant", portalStatus: "active", mustChangePassword: false },
  authority: undefined as any,
  mineError: null as Error | null,
  mineWait: undefined as Promise<void> | undefined,
  release: undefined as (() => void) | undefined,
  requests: [] as { path: string; input: any }[],
  hooks: [] as { path: string; enabled: boolean }[],
  forbidden: [] as string[],
  mounts: 0,
  unmounts: 0,
  ordinaryShell: vi.fn((_props?: any) => React.createElement("p", null, "Ordinary financial shell")),
  // The mock factory cannot access React until invocation, after imports resolve.
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: transport.user, loading: false, logout: async () => undefined }),
}));
vi.mock("@/lib/trpc", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const deny = (operation: string): never => {
    transport.forbidden.push(operation);
    throw new Error(`Forbidden synthetic operation: ${operation}`);
  };
  const proxy = (parts: string[] = []): any => new Proxy(() => undefined, {
    get: (_target, key: string | symbol) => {
      if (key === "then" || typeof key === "symbol") return undefined;
      if (key === "useQuery") return (input: any, options: any = {}) => {
        const path = parts.join(".");
        if (path !== "businessStaff.mine" && path !== "businessBookings.list") deny(`${path}.useQuery`);
        if (path === "businessStaff.mine" && input !== undefined) deny(`${path}:unexpected-input`);
        if (path === "businessBookings.list" && JSON.stringify(input) !== JSON.stringify({ page: 1, pageSize: 50 })) deny(`${path}:unexpected-input`);
        transport.hooks.push({ path, enabled: options.enabled !== false });
        // Options come verbatim from the actual components. Both mine observers
        // share the same cache entry, just as the actual tRPC hooks do. Do not
        // add staleTime/refetchOnMount overrides to make the regression pass.
        return useQuery({
          ...options,
          queryKey: [path, input ?? null],
          queryFn: async () => {
            transport.requests.push({ path, input: structuredClone(input) });
            await Promise.resolve();
            if (path === "businessStaff.mine") {
              await transport.mineWait;
              if (transport.mineError) throw transport.mineError;
              return structuredClone(transport.authority);
            }
            return { items: [], page: 1, pageSize: 50, hasMore: false };
          },
        });
      };
      if (key === "useMutation" || key === "useUtils" || key === "mutate" || key === "mutateAsync" || key === "query" || key === "invalidate") {
        return () => deny(`${parts.join(".")}.${key}`);
      }
      return proxy([...parts, key]);
    },
    apply: () => deny(`${parts.join(".")}:direct-call`),
  });
  return { trpc: proxy() };
});
vi.mock("@/components/PortalLayout", async importOriginal => {
  // Preserve the real SidebarGroup export used by the actual staff shell. A
  // replacement provider/context here would mask the original observer bug.
  const actual = await importOriginal<any>();
  return { ...actual, default: (props: any) => transport.ordinaryShell(props) };
});

import { trpc } from "../client/src/lib/trpc";
import BusinessStaffWorkspace from "../client/src/pages/business/BusinessStaffWorkspace";
import BusinessStaffPortalLayout, { BusinessStaffPortalProvider } from "../client/src/pages/business/BusinessStaffPortalLayout";

function WorkspaceProbe() {
  React.useEffect(() => {
    transport.mounts++;
    return () => { transport.unmounts++; };
  }, []);
  return React.createElement(BusinessStaffWorkspace);
}

// Extract the production AuthRouter, not a test reimplementation of its guard.
// This mirrors business-staff-auth-routing.test.ts, but supplies real queries,
// Wouter routes, Workspace, provider and restricted shell instead of flag mocks.
const appText = fs.readFileSync("client/src/App.tsx", "utf8");
const appSource = ts.createSourceFile("App.tsx", appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let authRouter: ts.FunctionDeclaration | undefined;
ts.forEachChild(appSource, node => {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "AuthRouter") authRouter = node;
});
if (!authRouter) throw new Error("Actual AuthRouter missing");
const script = ts.transpileModule(authRouter.getText(appSource).replace("export function", "function"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
}).outputText;
const dependencies: Record<string, any> = {};
const stubPage = () => React.createElement("p", { "data-unrelated-page": true }, "Unrelated page");
// Unrelated page references in the ordinary branch must be defined even though
// none may be mounted for managed staff. This keeps the whole real function.
function collectComponents(node: ts.Node) {
  if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && /^[A-Z]/.test(node.tagName.text)) {
    dependencies[node.tagName.text] = stubPage;
  }
  if (ts.isJsxAttribute(node) && node.name.getText(appSource) === "component" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isIdentifier(node.initializer.expression)) {
    dependencies[node.initializer.expression.text] = stubPage;
  }
  ts.forEachChild(node, collectComponents);
}
collectComponents(authRouter);
Object.assign(dependencies, {
  React,
  useAuth: () => ({ user: transport.user, loading: false }),
  useViewMode: () => ({ isAgentView: false }),
  useLocation, trpc, Link, Route, Switch,
  BusinessStaffWorkspace: WorkspaceProbe,
  BusinessStaffPortalProvider,
  BusinessStaffPortalLayout,
  PortalLayout: (props: any) => transport.ordinaryShell(props),
});
const ActualAuthRouter = new Function(...Object.keys(dependencies), `${script}\nreturn AuthRouter;`)(...Object.values(dependencies));

const MINE_KEY = ["businessStaff.mine", null];
const LIST_KEY = ["businessBookings.list", { page: 1, pageSize: 50 }];
const CACHED_RECORD = "SYNTHETIC_CACHED_BOOKING";
function syntheticAuthority() {
  return {
    managed: true,
    active: true,
    owner: { id: 40, name: "Synthetic Owner", email: null },
    membership: {
      id: 11, membershipId: 11, ownerUserId: 40, staffUserId: 60,
      status: "active", revision: 4,
      permissions: { ...DEFAULT_BUSINESS_STAFF_PERMISSIONS },
      orbitRequested: false, orbitReady: false,
    },
    orbitReady: false,
  };
}
let client: QueryClient;
let host: HTMLDivElement;
let root: Root;
let previousReact: unknown;
let previousActEnvironment: unknown;
let previousSettings: Record<string, unknown>;

// Fixed-duration, incremental async act boundaries let real observer effects
// and notifyManager timers run. Never runAllTimers: the unfixed implementation
// schedules forever. A regression must fail by its request count, not timeout.
async function flush(milliseconds = 25) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 5) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(5, milliseconds - elapsed)); });
  }
}
async function render(path = "/business-staff", element = React.createElement(ActualAuthRouter)) {
  window.history.replaceState(null, "", path);
  await act(async () => { root.render(React.createElement(QueryClientProvider, { client }, element)); });
  await flush();
}
const requests = (path: string) => transport.requests.filter(request => request.path === path).length;
function assertNoFallback() {
  expect(transport.ordinaryShell).not.toHaveBeenCalled();
  expect(host.querySelector("[data-unrelated-page]")).toBeNull();
  expect(transport.forbidden).toEqual([]);
  expect(globalThis.fetch).not.toHaveBeenCalled();
}
function assertStableContent(path: string) {
  expect(host.querySelector("[data-business-staff-portal]")).not.toBeNull();
  expect(host.querySelector("[data-portal-route-content]")).not.toBeNull();
  expect(host.textContent).not.toMatch(/Checking (Portal|your business-staff) access|Loading records/);
  expect(host.textContent).toContain("Working with Synthetic Owner");
  if (path === "/business-staff") {
    expect(host.querySelector("h1")?.textContent).toBe("Welcome, Synthetic");
    expect(host.textContent).toContain("Everything you need, in one place");
    expect(host.querySelector('[aria-label="Portal shortcuts"]')).not.toBeNull();
  } else {
    expect(host.querySelector("h1")?.textContent).toBe("My Bookings");
    expect(host.textContent).toContain("Business bookings");
    expect(host.textContent).toContain("No matching records");
    expect(host.querySelector('input[placeholder="Customer, destination or reference"]')).not.toBeNull();
  }
  assertNoFallback();
}
function holdMine() {
  transport.mineWait = new Promise<void>(resolve => { transport.release = resolve; });
}
async function seedVisibleCachedBooking() {
  await act(async () => {
    client.setQueryData(LIST_KEY, {
      items: [{ id: 701, clientName: CACHED_RECORD, destination: "Synthetic destination", departureDate: null, bookedDate: null, topdogRef: null, ptsRef: null, crmRef: null, currentStage: "Booked", passengers: 1, numberOfNights: 1 }],
      page: 1, pageSize: 50, hasMore: false,
    });
  });
  await flush();
  expect(host.textContent).toContain(CACHED_RECORD);
}

beforeEach(() => {
  previousReact = (globalThis as any).React;
  previousActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const settings = (window as any).happyDOM.settings;
  previousSettings = {};
  for (const key of ["disableIframePageLoading", "enableFileSystemHttpRequests", "disableCSSFileLoading", "disableJavaScriptFileLoading"]) previousSettings[key] = settings[key];
  Object.assign(settings, { disableIframePageLoading: true, enableFileSystemHttpRequests: false, disableCSSFileLoading: true, disableJavaScriptFileLoading: true });
  vi.stubGlobal("fetch", vi.fn(() => { transport.forbidden.push("fetch"); throw new Error("Network forbidden"); }));
  vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => { transport.forbidden.push("XHR"); throw new Error("XHR forbidden"); });
  vi.useFakeTimers();
  transport.authority = syntheticAuthority();
  transport.mineError = null;
  transport.mineWait = undefined;
  transport.release = undefined;
  transport.requests = [];
  transport.hooks = [];
  transport.forbidden = [];
  transport.mounts = 0;
  transport.unmounts = 0;
  transport.ordinaryShell.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  transport.release?.();
  await act(async () => { root.unmount(); client.clear(); });
  host.remove();
  vi.useRealTimers();
  Object.assign((window as any).happyDOM.settings, previousSettings);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  (globalThis as any).React = previousReact;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  expect(transport.forbidden).toEqual([]);
});

describe("actual managed-staff router/query observer stability (React 19 / React Query 5)", () => {
  it.each(["/business-staff", "/business-staff/bookings"])("keeps %s mounted for 250ms with exactly one root authority request", async path => {
    await render(path);
    assertStableContent(path);
    const content = host.querySelector("[data-portal-route-content]");
    await flush(250);
    assertStableContent(path);
    expect(host.querySelector("[data-portal-route-content]")).toBe(content);
    expect(transport.mounts).toBe(1);
    expect(transport.unmounts).toBe(0);
    expect(requests("businessStaff.mine")).toBe(1);
    expect(requests("businessBookings.list")).toBe(path.endsWith("/bookings") ? 1 : 0);
    expect(client.getQueryCache().find({ queryKey: MINE_KEY, exact: true })?.getObserversCount()).toBe(2);
    expect(transport.hooks.filter(hook => hook.path === "businessStaff.mine").some(hook => hook.enabled)).toBe(true);
    expect(transport.hooks.filter(hook => hook.path === "businessStaff.mine").some(hook => !hook.enabled)).toBe(true);
    console.info(`[query-stability] ${path}: mine=${requests("businessStaff.mine")}, list=${requests("businessBookings.list")}, mounts=${transport.mounts}, unmounts=${transport.unmounts} after 250ms`);
  });

  it("still performs one explicit fresh root check, then remounts bookings without an authority refetch loop", async () => {
    await render("/business-staff/bookings");
    assertStableContent("/business-staff/bookings");
    holdMine();
    let refetch!: Promise<void>;
    await act(async () => { refetch = client.refetchQueries({ queryKey: MINE_KEY, exact: true, type: "active" }); });
    await flush();
    expect(host.textContent).toContain("Checking Portal access");
    expect(host.querySelector("[data-portal-route-content]")).toBeNull();
    expect(host.querySelector('input[placeholder="Customer, destination or reference"]')).toBeNull();
    expect(client.getQueryData(MINE_KEY)).toMatchObject({ active: true, managed: true });
    expect(client.isFetching({ queryKey: MINE_KEY, exact: true })).toBe(1);
    assertNoFallback();
    await act(async () => { transport.release!(); await refetch; });
    await flush(250);
    assertStableContent("/business-staff/bookings");
    expect(requests("businessStaff.mine")).toBe(2);
    // A new booking observer may legitimately refresh its stale list once.
    expect(requests("businessBookings.list")).toBe(2);
    expect(transport.mounts).toBe(2);
    expect(transport.unmounts).toBe(1);
    console.info(`[query-stability] explicit active refetch: mine=2, list=2, mounts=2, unmounts=1`);
  });

  it("withholds cached records during root invalidation and stays restricted after fresh revocation", async () => {
    await render("/business-staff/bookings");
    await seedVisibleCachedBooking();
    holdMine();
    transport.authority = { ...syntheticAuthority(), active: false, membership: { ...syntheticAuthority().membership, status: "revoked", revision: 5 } };
    let invalidation!: Promise<void>;
    await act(async () => { invalidation = client.invalidateQueries({ queryKey: MINE_KEY, exact: true }); });
    await flush();
    expect(host.textContent).toContain("Checking Portal access");
    expect(host.textContent).not.toContain(CACHED_RECORD);
    expect(host.querySelector("[data-business-staff-portal]")).toBeNull();
    expect(client.getQueryData(MINE_KEY)).toMatchObject({ active: true, managed: true });
    expect(client.isFetching({ queryKey: MINE_KEY, exact: true })).toBe(1);
    assertNoFallback();
    await act(async () => { transport.release!(); await invalidation; });
    await flush(250);
    expect(host.textContent).toContain("Business-staff access revoked or inactive");
    expect(host.textContent).not.toContain(CACHED_RECORD);
    expect(host.textContent).not.toContain("Checking Portal access");
    expect(host.querySelector('input[placeholder="Customer, destination or reference"]')).toBeNull();
    expect(client.getQueryData(MINE_KEY)).toMatchObject({ managed: true, active: false });
    expect(client.getQueryData(LIST_KEY)).toMatchObject({ items: [{ clientName: CACHED_RECORD }] });
    expect(requests("businessStaff.mine")).toBe(2);
    expect(requests("businessBookings.list")).toBe(1);
    assertNoFallback();
    console.info(`[query-stability] root revocation: mine=2, list=1; cached booking retained in memory but withheld from DOM`);
  });

  it("fails closed on a real query-cache refetch error despite cached active authority, then safely retries", async () => {
    await render("/business-staff/bookings");
    await seedVisibleCachedBooking();
    holdMine();
    transport.mineError = new Error("Synthetic authority lookup unavailable");
    let refetch!: Promise<void>;
    await act(async () => { refetch = client.refetchQueries({ queryKey: MINE_KEY, exact: true, type: "active" }); });
    await flush();
    expect(host.textContent).toContain("Checking Portal access");
    expect(host.textContent).not.toContain(CACHED_RECORD);
    assertNoFallback();
    await act(async () => { transport.release!(); await refetch; });
    await flush(250);
    expect(client.getQueryState(MINE_KEY)).toMatchObject({ status: "error", fetchStatus: "idle", error: transport.mineError });
    expect(client.getQueryData(MINE_KEY)).toMatchObject({ managed: true, active: true });
    expect(host.textContent).toContain("Access could not be verified. No business or financial data has been loaded.");
    expect(host.querySelector("[data-business-staff-portal]")).toBeNull();
    expect(host.textContent).not.toContain(CACHED_RECORD);
    expect(requests("businessStaff.mine")).toBe(2);
    expect(requests("businessBookings.list")).toBe(1);
    assertNoFallback();
    transport.mineError = null;
    transport.mineWait = undefined;
    const retry = [...host.querySelectorAll("button")].find(button => button.textContent === "Try again");
    expect(retry).toBeTruthy();
    await act(async () => { retry!.click(); });
    await flush(250);
    assertStableContent("/business-staff/bookings");
    expect(client.getQueryState(MINE_KEY)?.status).toBe("success");
    expect(requests("businessStaff.mine")).toBe(3);
    expect(requests("businessBookings.list")).toBe(2);
    expect(transport.mounts).toBe(2);
    expect(transport.unmounts).toBe(1);
    console.info(`[query-stability] cache error/retry: mine=3, list=2; error withheld cached authority and booking`);
  });

  it("retains a functional standalone authority query when Workspace has no root provider", async () => {
    await render("/business-staff", React.createElement(BusinessStaffWorkspace));
    await flush(250);
    expect(host.querySelector("h1")?.textContent).toBe("Welcome, Synthetic");
    expect(host.textContent).toContain("Everything you need, in one place");
    expect(host.textContent).not.toMatch(/Checking|Loading records|access denied/);
    expect(requests("businessStaff.mine")).toBe(1);
    expect(requests("businessBookings.list")).toBe(0);
    expect(transport.hooks.filter(hook => hook.path === "businessStaff.mine").every(hook => hook.enabled)).toBe(true);
    expect(client.getQueryCache().find({ queryKey: MINE_KEY, exact: true })?.getObserversCount()).toBe(1);
    assertNoFallback();
    console.info(`[query-stability] standalone Workspace: mine=1, list=0 after 250ms`);
  });
});
