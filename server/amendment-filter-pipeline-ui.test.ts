// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only auth and transport are synthetic: render the real pipeline, shared
// toolbar, cards, dialogs, assignment controls and amendment message thread.
const transport = vi.hoisted(() => ({
  user: { id: 60, role: "admin", name: "Synthetic Admin" } as any,
  rows: [] as any[],
  error: null as Error | null,
  wait: undefined as Promise<void> | undefined,
  release: undefined as (() => void) | undefined,
  requests: [] as { path: string; input: any }[],
  writes: [] as { path: string; input: any }[],
  queryOptions: [] as any[],
  forbidden: [] as string[],
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: transport.user, loading: false }),
}));
vi.mock("@/lib/trpc", async () => {
  const { useQuery, useMutation, useQueryClient } = await import("@tanstack/react-query");
  const deny = (path: string): never => {
    transport.forbidden.push(path);
    throw new Error(`Unexpected synthetic operation: ${path}`);
  };
  const proxy = (parts: string[] = []): any => new Proxy(() => undefined, {
    get: (_target, key: string | symbol) => {
      if (key === "then" || typeof key === "symbol") return undefined;
      if (key === "useQuery") return (input: any, options: any = {}) => {
        const path = parts.join(".");
        if (!["amendments.all", "users.listAdmins", "amendments.getLineItems", "notes.byAmendment"].includes(path)) deny(`${path}.useQuery`);
        if (path === "amendments.all") transport.queryOptions.push(options);
        return useQuery({
          ...options,
          queryKey: [path, input ?? null],
          queryFn: async () => {
            transport.requests.push({ path, input: structuredClone(input) });
            if (path === "amendments.all") {
              await transport.wait;
              if (transport.error) throw transport.error;
              return structuredClone(transport.rows);
            }
            if (path === "users.listAdmins") return [{ id: 60, name: "Synthetic Admin" }, { id: 61, name: "Synthetic Colleague" }];
            return [];
          },
        });
      };
      if (key === "useMutation") return (options: any = {}) => {
        const path = parts.join(".");
        if (!["amendments.updatePipeline", "amendments.reject", "notes.add"].includes(path)) deny(`${path}.useMutation`);
        return useMutation({
          ...options,
          mutationFn: async (input: any) => {
            transport.writes.push({ path, input: structuredClone(input) });
            return { success: true };
          },
        });
      };
      if (key === "useUtils") return () => {
        const client = useQueryClient();
        return { notes: {
          byAmendment: { invalidate: (input: any) => client.invalidateQueries({ queryKey: ["notes.byAmendment", input] }) },
          list: { invalidate: () => Promise.resolve() },
          allThreads: { invalidate: () => Promise.resolve() },
        } };
      };
      return proxy([...parts, key]);
    },
    apply: () => deny(`${parts.join(".")}:direct-call`),
  });
  return { trpc: proxy() };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AdminAmendmentKanban, { AmendmentBookingContext } from "../client/src/pages/admin/AdminAmendmentKanban";

const ALL_KEY = ["amendments.all", null];
const NOW = new Date(2026, 10, 19, 12, 0, 0);
const departure = (offset: number) => new Date(2026, 10, 19 + offset, 12).toISOString();
function row(id: number, offset: number | null, overrides: Record<string, any> = {}) {
  return {
    id, bookingId: 1000 + id, clientName: `Synthetic Client ${id}`,
    agentId: 42, bookingAgentId: 42, agentName: "Synthetic Agent A",
    assignedToId: 60, assignedToName: "Synthetic Admin",
    status: "pending", pipelineStage: "To Do", details: `Request details ${id}`,
    ptsRef: `PTS-${id}`, topdogRef: `TD-${id}`, crmRef: "CRM-TARGET",
    createdAt: new Date(2026, 10, id, 10).toISOString(),
    departureDate: offset == null ? null : departure(offset),
    ...overrides,
  };
}
function fixture() {
  return [
    row(8, null, { createdAt: "2020-01-01T10:00:00Z" }),
    row(2, 7),
    row(6, -4),
    row(3, 0, { agentId: 999, isReimbursementDoc: true, clientName: "Urgent reimbursement", details: "Reimbursement documents need review" }),
    row(30, 30),
    row(5, 1, { assignedToId: null, assignedToName: null }),
    row(4, -1),
    row(7, 6),
    row(9, null, { departureDate: "not-a-date", createdAt: "also-invalid" }),
    row(14, 14),
    row(13, 13),
    row(29, 29),
    row(12, 9, { pipelineStage: "In Progress", bookingAgentId: 77, agentName: "Synthetic Agent B", assignedToId: 61, assignedToName: "Synthetic Colleague" }),
    row(11, 2, { pipelineStage: "In Progress", bookingAgentId: 77, agentName: "Synthetic Agent B" }),
    row(21, 3, { pipelineStage: "Actioned", status: "actioned", bookingAgentId: 77, agentName: "Synthetic Agent B" }),
    row(20, 0, { pipelineStage: "Actioned", status: "actioned" }),
    row(32, 2, { status: "rejected", rejectionReason: "Synthetic reason", bookingAgentId: 77, agentName: "Synthetic Agent B" }),
    row(31, 1, { status: "rejected", rejectionReason: "Synthetic reason" }),
  ];
}
const TODO_DEFAULT = [3, 5, 7, 2, 13, 14, 29, 30, 4, 6, 8, 9];
let client: QueryClient;
let host: HTMLDivElement;
let root: Root;
let previousReact: unknown;
let previousAct: unknown;
async function flush(milliseconds = 30) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 5) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(5, milliseconds - elapsed)); });
  }
}
async function render(element = React.createElement(AdminAmendmentKanban)) {
  await act(async () => { root.render(React.createElement(QueryClientProvider, { client }, element)); });
  await flush();
}
function ids(scope: ParentNode = host) {
  return [...scope.querySelectorAll("[data-amendment-id]")].map(card => Number(card.getAttribute("data-amendment-id")));
}
function column(stage: string) {
  const element = host.querySelector(`[data-amendment-stage="${stage}"]`);
  expect(element, `Expected ${stage} column`).not.toBeNull();
  return element!;
}
function field(label: string): HTMLInputElement | HTMLSelectElement {
  const labelElement = [...host.querySelectorAll("label")].find(element => element.textContent === label && element.htmlFor);
  expect(labelElement, `Accessible toolbar label ${label}`).toBeTruthy();
  const input = document.getElementById(labelElement!.htmlFor);
  expect(input).toBeTruthy();
  return input as HTMLInputElement | HTMLSelectElement;
}
async function choose(label: string, value: string) {
  const input = field(label);
  expect(input.tagName).toBe("SELECT");
  await act(async () => { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
}
async function search(value: string) {
  const input = field("Search amendments") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}
async function click(text: string, scope: ParentNode = host) {
  const button = [...scope.querySelectorAll("button")].find(element => element.textContent === text);
  expect(button, `Expected button ${text}`).toBeTruthy();
  await act(async () => { button!.click(); });
  await flush();
}
function noWrites() {
  expect(transport.writes).toEqual([]);
  expect(globalThis.fetch).not.toHaveBeenCalled();
}
function holdRequest() {
  transport.wait = new Promise<void>(resolve => { transport.release = resolve; });
}
const requestCount = () => transport.requests.filter(request => request.path === "amendments.all").length;

beforeEach(() => {
  previousReact = (globalThis as any).React;
  previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn(() => { transport.forbidden.push("fetch"); throw new Error("Real network forbidden"); }));
  vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => { transport.forbidden.push("XHR"); throw new Error("Real XHR forbidden"); });
  transport.user = { id: 60, role: "admin", name: "Synthetic Admin" };
  transport.rows = fixture();
  transport.error = null;
  transport.wait = undefined;
  transport.release = undefined;
  transport.requests = [];
  transport.writes = [];
  transport.queryOptions = [];
  transport.forbidden = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  transport.release?.();
  await act(async () => { root.unmount(); client.clear(); });
  host.remove();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  (globalThis as any).React = previousReact;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
  expect(transport.forbidden).toEqual([]);
});

describe("rendered amendment pipeline filtering and sorting", () => {
  it("defaults to urgent upcoming departures, then recent departed, then unknown dates within each column", async () => {
    await render();
    expect(ids(column("To Do"))).toEqual(TODO_DEFAULT);
    expect(ids(column("In Progress"))).toEqual([11, 12]);
    expect(host.querySelector('[data-amendment-stage="Actioned"]')).toBeNull();
    expect(ids().slice(-2)).toEqual([31, 32]);
    expect(host.textContent).toContain("Show Actioned (2)");
    expect(host.textContent).toContain("16 of 18 amendments shown");
    expect(host.textContent).toContain("including today");
    const urgent = host.querySelector('[data-amendment-id="3"]')!;
    expect(urgent.textContent).toContain("REIMBURSEMENT DOCS UPLOADED");
    expect(urgent.textContent).toContain("Departs today");
    expect(urgent.textContent).toContain("19 Nov 2026");
    expect(host.querySelector('[data-amendment-id="5"]')!.textContent).toContain("Departs tomorrow");
    expect(transport.requests.some(request => request.path === "amendments.getLineItems" && request.input.amendmentId === 3)).toBe(false);
    for (const label of ["Search amendments", "Stage", "Agent", "Assigned to", "Departure window", "Sort by"]) field(label);
    noWrites();
  });

  it("groups a legacy actioned request with no stage into the Actioned column", async () => {
    transport.rows = [row(50, 0, { status: "actioned", pipelineStage: null })];
    await render();
    expect(ids(column("To Do"))).toEqual([]);
    expect(host.textContent).toContain("Show Actioned (1)");
    await choose("Stage", "Actioned");
    expect(ids(column("Actioned"))).toEqual([50]);
    expect(host.textContent).toContain("1 of 1 amendments shown");
    noWrites();
  });

  it("combines stage, booking-owner agent, current assignee, departure and tokenized search without changing membership", async () => {
    await render();
    await choose("Stage", "pending");
    await choose("Agent", "42");
    await choose("Assigned to", "me");
    await choose("Departure window", "next_7");
    await search(" crm-target  synthetic ");
    expect(ids()).toEqual([3, 7]);
    await search("crm-target reimbursement");
    expect(ids()).toEqual([3]);
    expect(host.textContent).toContain("1 of 18 amendments shown");
    expect(host.textContent).toContain("REIMBURSEMENT DOCS UPLOADED");
    expect(host.querySelector('[data-amendment-id="31"]')).toBeNull();
    expect(host.querySelector('[data-amendment-id="32"]')).toBeNull();
    const agentValues = [...(field("Agent") as HTMLSelectElement).options].map(option => option.value);
    expect(agentValues).toEqual(["all", "42", "77"]);
    noWrites();
  });

  it("filters unassigned and explicit assignee IDs and keeps stable agent dropdown options", async () => {
    await render();
    await choose("Assigned to", "unassigned");
    expect(ids()).toEqual([5]);
    await choose("Assigned to", "61");
    expect(ids()).toEqual([12]);
    expect((field("Agent") as HTMLSelectElement).options.length).toBe(3);
    await choose("Stage", "In Progress");
    expect(host.querySelector('[data-amendment-stage="To Do"]')).toBeNull();
    expect(ids(column("In Progress"))).toEqual([12]);
    noWrites();
  });

  it.each([
    ["today", [3]],
    ["next_7", [3, 5, 7]],
    ["next_14", [3, 5, 7, 2, 13]],
    ["next_30", [3, 5, 7, 2, 13, 14, 29]],
    ["departed", [4, 6]],
    ["missing", [8, 9]],
  ])("uses inclusive-today calendar boundaries for %s", async (value, expected) => {
    await render();
    await choose("Stage", "To Do");
    await choose("Departure window", value as string);
    expect(ids()).toEqual(expected);
    noWrites();
  });

  it("renders oldest/newest submitted and latest departure orders from the shared sorter", async () => {
    await render();
    await choose("Stage", "To Do");
    await choose("Sort by", "submitted_oldest");
    expect(ids()).toEqual([8, 2, 3, 4, 5, 6, 7, 13, 14, 29, 30, 9]);
    await choose("Sort by", "submitted_newest");
    expect(ids()).toEqual([30, 29, 14, 13, 7, 6, 5, 4, 3, 2, 8, 9]);
    await choose("Sort by", "departure_latest");
    expect(ids()).toEqual([30, 29, 14, 13, 2, 7, 5, 3, 4, 6, 8, 9]);
    noWrites();
  });

  it("clear restores every filter and the default urgency sort without making a write", async () => {
    await render();
    await choose("Stage", "In Progress");
    await choose("Agent", "77");
    await choose("Assigned to", "61");
    await choose("Departure window", "next_14");
    await choose("Sort by", "submitted_newest");
    await search("td-12");
    expect(ids()).toEqual([12]);
    await click("Clear filters");
    expect(field("Search amendments").value).toBe("");
    for (const label of ["Stage", "Agent", "Assigned to", "Departure window"]) expect(field(label).value).toBe("all");
    expect(field("Sort by").value).toBe("departure_soonest");
    expect(ids(column("To Do"))).toEqual(TODO_DEFAULT);
    expect(host.textContent).toContain("16 of 18 amendments shown");
    noWrites();
  });

  it("shows Actioned for an explicit filter regardless of the toggle and shows only rejected for Rejected", async () => {
    await render();
    await choose("Stage", "Actioned");
    expect(ids()).toEqual([20, 21]);
    expect(host.querySelector('[data-amendment-stage="To Do"]')).toBeNull();
    await click("Clear filters");
    expect(host.querySelector('[data-amendment-stage="Actioned"]')).toBeNull();
    await choose("Agent", "42");
    expect(host.textContent).toContain("Show Actioned (1)");
    await click("Show Actioned (1)");
    expect(ids(column("Actioned"))).toEqual([20]);
    await choose("Stage", "rejected");
    expect(ids()).toEqual([31]);
    expect(host.querySelectorAll("[data-amendment-stage]").length).toBe(0);
    expect(host.textContent).toContain("Synthetic reason");
    await choose("Stage", "pending");
    expect(host.querySelector('[data-amendment-stage="Actioned"]')).toBeNull();
    expect(ids()).not.toContain(31);
    noWrites();
  });

  it("handles invalid and missing dates in real card contexts without NaN or date-format crashes", async () => {
    await render();
    await choose("Departure window", "missing");
    expect(ids()).toEqual([8, 9]);
    expect(host.querySelector('[data-amendment-id="9"]')!.textContent).toContain("Not recorded");
    expect(host.textContent).toContain("No departure date");
    expect(host.textContent).not.toMatch(/NaN|Invalid Date/);
    await render(React.createElement(AmendmentBookingContext, { amendment: row(90, null, { createdAt: null }), now: NOW }));
    expect(host.textContent?.match(/Not recorded/g)?.length).toBe(2);
    noWrites();
  });

  it("refreshes calendar filters and urgency badges after local midnight using one page clock", async () => {
    vi.setSystemTime(new Date(2026, 10, 19, 23, 59, 40));
    await render();
    await choose("Departure window", "today");
    expect(ids(column("To Do"))).toEqual([3]);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await flush();
    expect(ids(column("To Do"))).toEqual([5]);
    expect(host.querySelector('[data-amendment-id="5"]')!.textContent).toContain("Departs today");
    expect(requestCount()).toBe(1);
    noWrites();
  });

  it("preserves the existing stage button mutation while filter and sort interaction remains read-only", async () => {
    await render();
    await choose("Stage", "To Do");
    await choose("Departure window", "today");
    await choose("Sort by", "submitted_oldest");
    noWrites();
    await click("In Progress", host.querySelector('[data-amendment-id="3"]')!);
    expect(transport.writes).toEqual([{ path: "amendments.updatePipeline", input: { amendmentId: 3, pipelineStage: "In Progress" } }]);
    expect(requestCount()).toBe(2);
  });
});

describe("rendered amendment pipeline query freshness and failure states", () => {
  it("shows loading, not an empty board, while the initial authorized query is pending", async () => {
    holdRequest();
    await render();
    expect(host.textContent).toContain("Loading amendments...");
    expect(ids()).toEqual([]);
    expect(host.textContent).not.toContain("No amendments match");
    await act(async () => { transport.release!(); });
    await flush();
    expect(ids(column("To Do"))).toEqual(TODO_DEFAULT);
    noWrites();
  });

  it("hides stale cached cards and actions after a refetch error, and an explicit retry restores fresh data", async () => {
    await render();
    transport.error = new Error("Synthetic list unavailable");
    await act(async () => { await client.refetchQueries({ queryKey: ALL_KEY, exact: true }); });
    await flush();
    expect(client.getQueryState(ALL_KEY)?.status).toBe("error");
    expect(client.getQueryData(ALL_KEY)).toHaveLength(18);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Unable to load amendments");
    expect(ids()).toEqual([]);
    expect(host.textContent).not.toContain("Urgent reimbursement");
    expect(host.textContent).not.toContain("Message agent");
    transport.error = null;
    transport.rows = [row(55, 0, { clientName: "Synthetic fresh record" })];
    await click("Try again");
    expect(ids()).toEqual([55]);
    expect(host.textContent).toContain("Synthetic fresh record");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(requestCount()).toBe(3);
    noWrites();
  });

  it("always refreshes a fresh mounted cache and refetches on window focus using production query options", async () => {
    client.setQueryData(ALL_KEY, [row(99, 0, { clientName: "Synthetic cached row" })]);
    await render();
    expect(requestCount()).toBe(1);
    expect(ids()).not.toContain(99);
    expect(transport.queryOptions.at(-1)).toMatchObject({ staleTime: 60_000, refetchOnMount: "always", refetchOnWindowFocus: true });
    await act(async () => { focusManager.setFocused(false); });
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    await act(async () => { focusManager.setFocused(true); });
    await flush();
    expect(requestCount()).toBe(2);
    noWrites();
  });
});
