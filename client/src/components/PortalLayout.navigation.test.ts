// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "agent",
  isAgentView: false,
  location: "/my-agreements",
  logout: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 99, name: "Account holder", role: state.role }, logout: state.logout }),
}));
vi.mock("@/contexts/ViewModeContext", () => ({
  useViewMode: () => ({ isAgentView: state.isAgentView, setViewMode: vi.fn() }),
}));
vi.mock("@/components/GlobalSearch", () => ({ default: () => null }));
vi.mock("@/components/TermsSigningBanner", () => ({ TermsSigningBanner: () => null }));
vi.mock("@/pages/staff/StaffWorkspace", () => ({
  useStaffAccess: () => ({ access: { instructor: false, engagement: false } }),
}));
vi.mock("wouter", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({ href, children, ...props }: any) => createElement("a", { href, ...props }, children),
    useLocation: () => [state.location, vi.fn()],
  };
});
vi.mock("@/lib/trpc", () => {
  const node = (path = ""): any => new Proxy({}, {
    get: (_target, key: string) => {
      if (key === "useMutation") return () => ({ mutate: state.mutate, mutateAsync: state.mutate, isPending: false });
      if (key === "useQuery") return () => ({
        data: path === "notes.myUnansweredThreads" ? [] : undefined,
        refetch: vi.fn(),
      });
      return node(path ? `${path}.${key}` : key);
    },
  });
  return { trpc: node() };
});

import PortalLayout from "./PortalLayout";

const source = readFileSync(resolve(process.cwd(), "client/src/components/PortalLayout.tsx"), "utf8");
const app = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");

describe("Portal sidebar navigation", () => {
  it("keeps daily work visible and groups staff destinations by operating purpose", () => {
    expect(source).toContain('label: "Daily Work"');
    expect(source).toContain("pinned: true");
    expect(source).toContain('label: "Operations"');
    expect(source).toContain('label: "Commissions & Payments"');
    expect(source).toContain('label: "Agents & Membership"');
    expect(source).toContain('label: "Marketing & Recruitment"');
    expect(source).toContain('label: "System Settings"');
    expect(source).toContain('{ label: "Tasks", href: "/admin/tasks"');
    expect(source).toContain('{ label: "Calendar", href: "/admin/calendar"');
  });

  it("puts sign-up tools in Marketing & Recruitment and keeps Agent Engagement with agent operations", () => {
    const agentGroup = source.slice(source.indexOf('label: "Agents & Membership"'), source.indexOf('label: "Marketing & Recruitment"'));
    const marketingGroup = source.slice(source.indexOf('label: "Marketing & Recruitment"'), source.indexOf('label: "Academy"'));

    expect(agentGroup).toContain('{ label: "Agent Engagement", href: "/admin/agent-engagement"');
    expect(agentGroup).not.toContain('href: "/crm/join-sessions"');
    expect(agentGroup).not.toContain('href: "/crm/abandoned-signups"');
    expect(marketingGroup).toContain('{ label: "Sign-Up Applications", href: "/crm/join-sessions"');
    expect(marketingGroup).toContain('{ label: "Abandoned Sign-Ups", href: "/crm/abandoned-signups"');
  });

  it("retires standalone remittance and booking-document destinations without touching in-file documents", () => {
    expect(source).not.toContain('href: "/crm/remittances"');
    expect(source).not.toContain('href: "/booking-documents"');
    expect(app).not.toContain('path="/crm/remittances"');
    expect(app).not.toContain('path="/booking-documents"');
  });

  it("persists each person’s sidebar section choices and keeps direct destinations visible", () => {
    expect(source).toContain('const sidebarPreferenceScope = `jlt-sidebar:${user?.id ?? "anonymous"}');
    expect(source).toContain("window.localStorage.getItem(groupPreferenceKey)");
    expect(source).toContain("window.localStorage.setItem(groupPreferenceKey");
    expect(source).toContain("if (!group.pinned && isAnyActive)");
  });

  it("starts the desktop sidebar collapsed for agents and gives them a clear way to expand it", () => {
    expect(source).toContain('useState(() => user?.role === "agent")');
    expect(source).toContain("const isAgentNavigation = isAgent || isAgentView");
    expect(source).toContain('setCollapsed(false)');
    expect(source).toContain("Explore portal");
  });

  it("keeps the live JLT Academy route available in agent navigation", () => {
    const learningGroup = source.slice(source.indexOf('label: "Learning"'), source.indexOf('label: "Community & Events"'));
    expect(learningGroup).toContain('{ label: "JLT Academy", href: "/academy"');
  });

  it("mounts the same personal agreements page once in each authenticated branch, never publicly", () => {
    const route = '<Route path="/my-agreements" component={MyAgreements} />';
    const publicStart = app.indexOf("if (!user) {");
    const agentStart = app.indexOf('if (user.role === "agent") {');
    const agentViewStart = app.indexOf("if (isAdminUser && isAgentView) {");
    const adminStart = app.indexOf("// Admin / Super Admin — default admin view");
    expect(publicStart).toBeGreaterThan(-1);
    expect(agentStart).toBeGreaterThan(publicStart);
    expect(agentViewStart).toBeGreaterThan(agentStart);
    expect(adminStart).toBeGreaterThan(agentViewStart);
    expect(app.match(/<Route\s+path="\/my-agreements"/g)).toHaveLength(3);
    expect(app.slice(publicStart, agentStart)).not.toContain('path="/my-agreements"');
    for (const branch of [
      app.slice(agentStart, agentViewStart),
      app.slice(agentViewStart, adminStart),
      app.slice(adminStart),
    ]) {
      expect(branch.split(route)).toHaveLength(2);
      expect(branch).toContain("<PortalLayout>");
    }
  });

  it("keeps personal agreements out of both grouped menus and retains the separate admin terms tracker", () => {
    const groups = source.slice(source.indexOf("const agentNavGroups"), source.indexOf("const handleBellClick"));
    expect(groups).not.toContain('"/my-agreements"');
    expect(groups).toContain('{ label: "Terms Tracker", href: "/admin/terms-tracker"');
    expect(source.match(/href="\/my-agreements"/g)).toHaveLength(1);
  });
});

describe("shared personal agreements footer", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is forbidden in navigation tests"); }));
    window.localStorage.clear();
    window.sessionStorage.clear();
    state.role = "agent";
    state.isAgentView = false;
    state.location = "/my-agreements";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    expect(state.mutate).not.toHaveBeenCalled();
    expect(state.logout).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  async function render(collapsed: boolean) {
    await act(async () => root.render(React.createElement(PortalLayout, { children: React.createElement("main", null, "Personal page") })));
    const aside = container.querySelector("aside")!;
    if (aside.classList.contains("w-14") !== collapsed) {
      const toggle = Array.from(aside.querySelectorAll("button")).find(button => button.classList.contains("lg:flex"))!;
      await act(async () => toggle.click());
    }
    return aside;
  }
  function agreementsLink() {
    const links = container.querySelectorAll<HTMLAnchorElement>('a[href="/my-agreements"]');
    expect(links).toHaveLength(1);
    return links[0];
  }

  const roles = [
    ["agent", false], ["admin", false], ["admin", true],
    ["super_admin", false], ["super_admin", true],
  ] as const;
  it.each(roles.flatMap(([role, agentView]) => [true, false].map(collapsed => ({ role, agentView, collapsed }))))(
    "shows the same self-only footer for $role, agent view=$agentView, collapsed=$collapsed",
    async ({ role, agentView, collapsed }) => {
      state.role = role;
      state.isAgentView = agentView;
      const aside = await render(collapsed);
      const link = agreementsLink();
      expect(aside.contains(link)).toBe(true);
      expect(link.closest("nav")).toBeNull();
      expect(link.parentElement?.querySelector('a[href="/profile"]')).toBeTruthy();
      expect(link.parentElement?.querySelector("button")?.textContent).toBe(collapsed ? "" : "Sign Out");
      expect(link.getAttribute("title")).toBe("Agreements & Policies");
      expect(link.getAttribute("aria-label")).toBe("Agreements & Policies");
      expect(link.querySelector("svg")).toBeTruthy();
      expect(link.textContent).toBe(collapsed ? "" : "Agreements & Policies");
      expect(link.classList.contains("justify-center")).toBe(collapsed);
      expect(link.classList.contains("bg-sidebar-primary")).toBe(true);
      expect(link.classList.contains("text-sidebar-primary-foreground")).toBe(true);
      expect(link.getAttribute("aria-current")).toBe("page");
    },
  );

  it.each(["/profile", "/terms", "/my-agreements/record", "/crm/agents/99/contract-evidence"])(
    "does not mark the personal link active at %s", async location => {
      state.location = location;
      await render(false);
      const link = agreementsLink();
      expect(link.classList.contains("bg-sidebar-primary")).toBe(false);
      expect(link.classList.contains("text-sidebar-foreground")).toBe(true);
      expect(link.getAttribute("aria-current")).toBeNull();
    },
  );

  it.each([true, false])("closes an open mobile sidebar when the agreements link is clicked, collapsed=%s", async collapsed => {
    const aside = await render(collapsed);
    const open = container.querySelector<HTMLButtonElement>("header button.lg\\:hidden")!;
    await act(async () => open.click());
    expect(aside.classList.contains("translate-x-0")).toBe(true);
    await act(async () => agreementsLink().click());
    expect(aside.classList.contains("-translate-x-full")).toBe(true);
    expect(aside.classList.contains("w-14")).toBe(collapsed);
  });
});
