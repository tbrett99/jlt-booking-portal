// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalCrmMembership, currentCrmMembership, currentCrmStatus, matchesCrmListFilters } from "@shared/crm-list-filters";

const mock = vi.hoisted(() => ({
  agents: [] as any[],
  teams: [] as any[],
  listLoading: false,
  listError: false,
  teamsError: false,
  mutations: [] as string[],
  refetch: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 901, role: "admin" } }) }));
vi.mock("wouter", () => ({ useSearch: () => "", useLocation: () => ["/crm/agents", vi.fn()], Link: ({ children, href }: any) => React.createElement("a", { href }, children) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => {
  const proxy = (parts: string[] = []): any => new Proxy(() => undefined, {
    get: (_target, property: string) => {
      const path = parts.join(".");
      if (property === "useQuery") return () => {
        if (path === "crm.agentCrm.list") return { data: mock.agents, isLoading: mock.listLoading, isError: mock.listError, isFetching: false, refetch: mock.refetch };
        if (path === "crm.agentCrm.listTeams") return { data: mock.teams, isLoading: false, isError: mock.teamsError, refetch: mock.refetch };
        if (path === "crm.agentCrm.get") return { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
        return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
      };
      if (property === "useMutation") return () => ({ isPending: false, mutate: () => { mock.mutations.push(path); } });
      if (property === "useUtils") return () => proxy(["utils"]);
      if (property === "invalidate") return vi.fn();
      return proxy([...parts, property]);
    },
  });
  return { trpc: proxy() };
});

import AgentCrm from "./AgentCrm";

let container: HTMLDivElement;
let root: Root;
function agent(id: number, name: string, tier: string | null = "First Class", status: string | null = "active", extra: Record<string, any> = {}) {
  return { id, name, email: `agent-${id}@example.test`, phone: null, isActive: true, portalStatus: "active", createdAt: new Date("2026-01-01T12:00:00Z"), tags: [], crmProfile: { membershipTier: tier, agentStatus: status, uniqueAgentId: `TEST-${id}`, jltEmail: null, businessName: null, ukRegion: null }, ...extra };
}
async function render() { await act(async () => root.render(React.createElement(AgentCrm))); }
async function clickButton(prefix: string, scope: ParentNode = container) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(item => (item.getAttribute("aria-label") ?? item.textContent?.trim() ?? "").startsWith(prefix));
  expect(button, prefix).toBeTruthy();
  await act(async () => button!.click());
  // Radix restores focus on a deferred timer; settle it before opening the next popover.
  await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
}
async function toggleGroup(label: string) { await clickButton(`${label}:`); }
async function check(label: string) {
  const option = [...document.querySelectorAll<HTMLLabelElement>('[data-slot="popover-content"] label')].find(item => item.textContent?.trim() === label);
  expect(option, label).toBeTruthy();
  await act(async () => option!.querySelector<HTMLInputElement>("input")!.click());
}
async function inputSearch(value: string) {
  const input = container.querySelector<HTMLInputElement>('[aria-label="Search agents"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function names() {
  return [...container.querySelectorAll("tbody tr")].map(row => row.querySelector("td .font-medium")?.textContent).filter(Boolean);
}
function count() { return container.querySelector('[role="status"]')?.textContent; }

beforeEach(() => {
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mock.agents = [];
  mock.teams = [];
  mock.listLoading = false;
  mock.listError = false;
  mock.teamsError = false;
  mock.mutations = [];
  mock.refetch.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(mock.mutations).toEqual([]);
});

describe("rendered CRM multi-select filters", () => {
  it("matches (First Class OR First Class Duo) AND Active, excluding all other lifecycle statuses", async () => {
    mock.agents = [agent(1, "Solo"), agent(2, "Duo", "first_class_duo"), agent(3, "Cancelled solo", "First Class", "cancelled"), agent(4, "Cancelled duo", "First Class Duo", "cancelled"), agent(5, "Paused", "First Class", "paused"), agent(6, "Suspended", "First Class Duo", "suspended"), agent(7, "In notice", "First Class", "in_notice"), agent(8, "Business", "business_class"), agent(9, "Trio", "First Class Trio")];
    const original = structuredClone(mock.agents);
    await render();
    await toggleGroup("Membership");
    await check("First Class");
    await check("First Class Duo");
    expect(document.querySelectorAll('[data-slot="popover-content"] input:checked')).toHaveLength(2);
    await toggleGroup("Membership");
    await toggleGroup("Status");
    await check("Active");
    await toggleGroup("Status");
    expect(names()).toEqual(["Solo", "Duo"]);
    expect(count()).toBe("2 of 9 agents match · Showing 1–2");
    expect(container.textContent).toContain("Membership: (First Class OR First Class Duo) AND Status: (Active)");
    expect(container.querySelector('[aria-label="Membership: First Class OR First Class Duo"]')).toBeTruthy();
    expect(mock.agents).toEqual(original);
  });

  it("ORs multiple statuses, and clears a group without clearing membership or search", async () => {
    mock.agents = [agent(1, "Match active"), agent(2, "Match paused", "First Class", "paused"), agent(3, "Match notice", "First Class", "in_notice"), agent(4, "Other active"), agent(5, "Match business", "Business Class")];
    await render();
    await inputSearch("Match");
    await toggleGroup("Membership"); await check("First Class"); await toggleGroup("Membership");
    await toggleGroup("Status"); await check("Active"); await check("Paused"); await toggleGroup("Status");
    expect(names()).toEqual(["Match active", "Match paused"]);
    await toggleGroup("Status"); await clickButton("Clear status", document.body); await toggleGroup("Status");
    expect(names()).toEqual(["Match active", "Match paused", "Match notice"]);
    await clickButton("Clear filters");
    expect(names()).toHaveLength(5);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Search agents"]')!.value).toBe("");
    expect(container.querySelector('[aria-label="Membership: All"]')).toBeTruthy();
  });

  it("keeps unknown and missing-profile records visible by default and explicitly filterable", async () => {
    mock.agents = [agent(1, "Unknown", "First Class VIP"), agent(2, "Missing profile", null, null, { crmProfile: null, portalStatus: "onboarding" }), agent(3, "Missing cancelled", null, null, { crmProfile: null, portalStatus: "cancelled" }), agent(4, "Unset", "  "), agent(5, "Charter", "charter")];
    await render();
    expect(names()).toHaveLength(5);
    expect(container.textContent).toContain("First Class VIP");
    await toggleGroup("Membership"); await check("Other / unknown"); await toggleGroup("Membership");
    expect(names()).toEqual(["Unknown"]);
    await toggleGroup("Membership"); await check("Not set"); await toggleGroup("Membership");
    expect(names()).toEqual(["Unknown", "Missing profile", "Missing cancelled", "Unset"]);
    await toggleGroup("Status"); await check("Active"); await toggleGroup("Status");
    expect(names()).toEqual(["Unknown", "Missing profile", "Unset"]);
    await clickButton("Clear filters");
    expect(names()).toHaveLength(5);
  });

  it("uses only the current linked team tier, falls back to CRM, and never infers from signed history", async () => {
    mock.teams = [{ id: 20, membershipTier: "First Class Duo" }, { id: 21, membershipTier: null }];
    mock.agents = [agent(1, "Current team", "Business Class", "active", { crmProfile: { membershipTier: "Business Class", agentStatus: "active", teamId: 20 }, joinSession: { membershipTier: "business_class", membershipType: "solo" } }), agent(2, "Current solo", "first_class", "active", { joinSession: { membershipTier: "first_class", membershipType: "duo" } }), agent(3, "Historic only", null, null, { crmProfile: null, joinSession: { membershipTier: "first_class", membershipType: "duo" } }), agent(4, "CRM fallback", "First Class Duo", "active", { crmProfile: { membershipTier: "First Class Duo", agentStatus: "active", teamId: 21 } })];
    await render();
    await toggleGroup("Membership"); await check("First Class Duo"); await toggleGroup("Membership");
    expect(names()).toEqual(["Current team", "CRM fallback"]);
    expect(container.querySelector('[title="Current linked team membership"]')?.textContent).toBe("First Class Duo");
  });

  it("resets pagination for membership, status, search and clear, preserving original list order", async () => {
    mock.agents = Array.from({ length: 102 }, (_, index) => agent(index + 1, `Synthetic ${index + 1}`, "First Class", index === 0 ? "paused" : "active"));
    await render();
    expect(names()).toHaveLength(50);
    await clickButton("Next page");
    expect(names()[0]).toBe("Synthetic 51");
    await toggleGroup("Membership"); await check("First Class"); await toggleGroup("Membership");
    expect(names()[0]).toBe("Synthetic 1");
    await clickButton("Next page");
    await toggleGroup("Status"); await check("Active"); await toggleGroup("Status");
    expect(names()[0]).toBe("Synthetic 2");
    await clickButton("Next page");
    await inputSearch("Synthetic");
    expect(names()[0]).toBe("Synthetic 2");
    await clickButton("Next page");
    await clickButton("Clear filters");
    expect(names()[0]).toBe("Synthetic 1");
    expect(container.textContent).toContain("Export CSV (102)");
  });

  it("returns from the actual record sheet with filter, search and page state intact", async () => {
    mock.agents = Array.from({ length: 70 }, (_, index) => agent(index + 1, `Return ${index + 1}`));
    await render();
    await inputSearch("Return");
    await toggleGroup("Membership"); await check("First Class"); await toggleGroup("Membership");
    await clickButton("Next page");
    const before = names();
    await clickButton("View", container.querySelector("tbody")!);
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeTruthy();
    await clickButton("Close", document.querySelector('[data-slot="sheet-content"]')!);
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
    expect(names()).toEqual(before);
    expect(container.textContent).toContain("Page 2 of 2");
    expect(container.querySelector('[aria-label="Membership: First Class"]')).toBeTruthy();
    expect(container.querySelector<HTMLInputElement>('[aria-label="Search agents"]')!.value).toBe("Return");
  });

  it("exposes labeled native checkboxes and dismisses the real popover with Escape", async () => {
    mock.agents = [agent(1, "Keyboard record")];
    await render();
    await toggleGroup("Membership");
    const group = document.querySelector<HTMLFieldSetElement>('[data-slot="popover-content"] fieldset')!;
    expect(group.querySelector("legend")?.textContent).toBe("Membership");
    expect(group.getAttribute("aria-describedby")).toBeTruthy();
    const checkbox = group.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => checkbox.focus());
    expect(document.activeElement).toBe(checkbox);
    await act(async () => checkbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    expect(names()).toEqual(["Keyboard record"]);
  });

  it("exports every filtered row, not just the visible page, with effective current membership/status", async () => {
    mock.agents = Array.from({ length: 63 }, (_, index) => agent(index + 1, `CSV ${index + 1}`, "first_class", index === 0 ? "cancelled" : "active"));
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-crm-export");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    try {
      await render();
      await toggleGroup("Membership"); await check("First Class"); await toggleGroup("Membership");
      await toggleGroup("Status"); await check("Active"); await toggleGroup("Status");
      expect(names()).toHaveLength(50);
      await clickButton("Export CSV (62)");
      const csv = await (createUrl.mock.calls[0][0] as Blob).text();
      expect(csv.split("\n")).toHaveLength(63); // Header plus all 62 matches.
      expect(csv).toContain('"CSV 63"');
      expect(csv).not.toContain('"CSV 1"');
      expect(csv).toContain('"First Class","active"');
      expect(anchorClick.mock.instances[0].download).toMatch(/^agents-first-class-active-/);
      expect(revokeUrl).toHaveBeenCalledWith("blob:synthetic-crm-export");
    } finally {
      createUrl.mockRestore(); revokeUrl.mockRestore(); anchorClick.mockRestore();
    }
  });

  it("preserves loading, error/retry and empty states while filtering", async () => {
    mock.listLoading = true;
    await render();
    expect(container.textContent).toContain("Loading registered agents…");
    expect(container.textContent).not.toContain("No agents found");
    mock.listLoading = false; mock.listError = true;
    await render();
    expect(container.textContent).toContain("The CRM list could not be loaded.");
    expect(container.textContent).not.toContain("No agents found");
    await clickButton("Retry CRM list"); expect(mock.refetch).toHaveBeenCalledOnce();
    mock.listError = false; await render();
    expect(container.textContent).toContain("No agents found");
    expect(count()).toBe("0 of 0 agents match · Showing 0–0");
  });

  it("discloses unavailable team data and offers retry without hiding historic rows", async () => {
    mock.agents = [agent(1, "CRM-only historical", "First Class Duo", "cancelled")];
    mock.teamsError = true;
    await render();
    expect(names()).toEqual(["CRM-only historical"]);
    expect(container.textContent).toContain("Team memberships unavailable; using saved CRM memberships.");
    await clickButton("Retry team memberships");
    expect(mock.refetch).toHaveBeenCalledOnce();
  });
});

describe("CRM-only exact canonical filtering", () => {
  it("normalizes only known exact variants, not substrings or signed membership types", () => {
    for (const value of ["First Class", "FIRST_CLASS", " first-class "]) expect(canonicalCrmMembership(value)).toBe("first_class");
    expect(canonicalCrmMembership("First Class Duo")).toBe("first_class_duo");
    expect(canonicalCrmMembership("first_class_trio")).toBe("first_class_trio");
    expect(canonicalCrmMembership("Business Class Duo")).toBe("business_duo");
    expect(canonicalCrmMembership("business_class_trio")).toBe("business_trio");
    expect(canonicalCrmMembership("First Class VIP")).toBe("unknown");
    expect(canonicalCrmMembership(null)).toBe("unset");
    expect(currentCrmMembership({ crmProfile: null })).toEqual({ value: "unset", label: "Not set", source: "crm" });
  });

  it("respects CRM status over portal access, but never defaults a cancelled missing-profile portal to active", () => {
    expect(currentCrmStatus({ crmProfile: { agentStatus: "cancelled" }, portalStatus: "active" })).toBe("cancelled");
    expect(currentCrmStatus({ crmProfile: { agentStatus: "active" }, portalStatus: "cancelled" })).toBe("active");
    expect(currentCrmStatus({ crmProfile: null, portalStatus: "cancelled" })).toBe("cancelled");
    expect(currentCrmStatus({ crmProfile: null, portalStatus: "onboarding" })).toBe("active");
    expect(currentCrmStatus({ crmProfile: { agentStatus: "unexpected" } })).toBe("unknown");
    expect(matchesCrmListFilters({ crmProfile: null, portalStatus: "cancelled" }, { search: "", memberships: [], statuses: ["active"] })).toBe(false);
  });
});
