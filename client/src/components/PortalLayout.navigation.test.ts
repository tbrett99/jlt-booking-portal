import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./PortalLayout.tsx", import.meta.url)), "utf8");
const app = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

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
});
