// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import ts from "typescript";

const text = fs.readFileSync("client/src/App.tsx", "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let target: ts.FunctionDeclaration | undefined;
ts.forEachChild(source, node => { if (ts.isFunctionDeclaration(node) && node.name?.text === "AuthRouter") target = node; });
if (!target) throw new Error("Actual AuthRouter missing");
const script = ts.transpileModule(target.getText(source).replace("export function", "function"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
const identity = { id: 20, role: "agent", name: "Synthetic Employee", portalStatus: "active", mustChangePassword: false };
let response: any, path: string, host: HTMLDivElement, root: Root;
const staff = vi.fn(() => React.createElement("p", null, "Restricted staff workspace"));
const legacy = vi.fn(() => React.createElement("p", null, "Legacy financial shell"));
const academy = vi.fn(() => React.createElement("p", null, "Own Academy view"));
const password = vi.fn(() => React.createElement("p", null, "Password setup"));
const suppliers = vi.fn((props: any) => React.createElement("p", null, props.businessStaffMode ? "Supplier resource-only view" : "Ordinary supplier view"));
const knowledge = vi.fn(() => React.createElement("p", null, "Published Knowledge Base"));
const webinars = vi.fn(() => React.createElement("p", null, "Published webinar library"));
const retry = vi.fn();
const link = ({ children }: any) => React.createElement("span", null, children);
const route = ({ children, component: Component }: any) => Component ? React.createElement(Component) : typeof children === "function" ? children({ enrollmentId: "70" }) : children;
const select = ({ children }: any) => {
  const items = React.Children.toArray(children) as any[];
  return items.find(child => child.props.path === path || (child.props.path === "/academy/course/:enrollmentId" && /^\/academy\/course\/\d+$/.test(path))) ?? items.find(child => !child.props.path) ?? null;
};
const provider = ({ children }: any) => children;
const familiar = ({ children }: any) => React.createElement("section", { "data-familiar-staff-shell": true }, children);
const dependencies: Record<string, any> = {
  React, useAuth: () => ({ user: identity, loading: false }), useViewMode: () => ({ isAgentView: false }), useLocation: () => [path],
  trpc: { businessStaff: { mine: { useQuery: () => response } } }, Loader2: () => React.createElement("span", null, "Loading"),
  BusinessStaffWorkspace: staff, BusinessStaffPortalProvider: provider, BusinessStaffPortalLayout: familiar,
  AcademyHome: academy, AcademyCourse: academy, ChangePasswordPage: password,
  SupplierDirectory: suppliers, KnowledgeBase: knowledge, WebinarLibrary: webinars,
  MyAgreements: () => React.createElement("p", null, "Self-owned agreements"), TermsAndPolicies: () => React.createElement("p", null, "Public policies"), Link: link, Switch: select, Route: route, NotFound: () => null,
  PortalLayout: legacy, StaffWorkspace: legacy, OnboardingGuard: legacy, SuspendedGuard: legacy,
};
const ActualRouter = new Function(...Object.keys(dependencies), script + "return AuthRouter;")(...Object.values(dependencies));
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  identity.mustChangePassword = false; path = "/bookings/100";
  response = { data: { managed: true, active: true, membership: { permissions: { academyAccess: true, resourceAccess: true } } }, isLoading: false, isFetching: false, error: null, refetch: retry };
  [staff, legacy, academy, password, suppliers, knowledge, webinars, retry].forEach(mock => mock.mockClear());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async () => { await act(async () => root.render(React.createElement(ActualRouter))); };
describe("actual AuthRouter staff classification and resource routes", () => {
  it("routes an old booking deep link to restricted staff, not the financial shell", async () => { await render(); expect(host.textContent).toContain("Restricted staff"); expect(legacy).not.toHaveBeenCalled(); });
  it("does not fall back for revoked membership", async () => { response.data.active = false; await render(); expect(host.textContent).toContain("Restricted staff"); expect(legacy).not.toHaveBeenCalled(); });
  it("withholds all Portal components while the registry loads", async () => { response = { ...response, data: undefined, isLoading: true }; await render(); expect(host.textContent).toContain("Checking Portal access"); expect(staff).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
  it("withholds stale managed data during a fresh authority check", async () => { path = "/knowledge-base"; response.isFetching = true; await render(); expect(host.textContent).toContain("Checking Portal access"); expect(knowledge).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
  it("withholds cached data on registry error and provides a safe retry", async () => { response.error = new Error("Synthetic failure"); await render(); expect(host.textContent).toContain("No business or financial data has been loaded"); await act(async () => host.querySelector("button")!.click()); expect(retry).toHaveBeenCalledOnce(); expect(staff).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
  it("permits the own Academy branch inside the familiar staff shell", async () => { path = "/academy"; await render(); expect(host.textContent).toContain("Own Academy"); expect(host.querySelector("[data-familiar-staff-shell]")).not.toBeNull(); expect(legacy).not.toHaveBeenCalled(); });
  it("denies Academy when its independent permission is removed", async () => { path = "/academy"; response.data.membership.permissions.academyAccess = false; await render(); expect(host.textContent).toContain("Restricted staff"); expect(academy).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
  it("keeps required password setup ahead of all business and finance views", async () => { identity.mustChangePassword = true; await render(); expect(host.textContent).toContain("Password setup"); expect(staff).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
  it.each([["/knowledge-base", knowledge, "Published Knowledge Base"], ["/webinars", webinars, "Published webinar"], ["/suppliers", suppliers, "Supplier resource-only"]] as const)("opens the real %s resource with the staff shell", async (url, component, label) => {
    path = url; await render(); expect(host.textContent).toContain(label); expect(component).toHaveBeenCalled(); expect(host.querySelector("[data-familiar-staff-shell]")).not.toBeNull(); expect(legacy).not.toHaveBeenCalled();
  });
  it.each(["/knowledge-base", "/webinars", "/suppliers"])("denies %s if resource access is disabled", async url => {
    path = url; response.data.membership.permissions.resourceAccess = false; await render(); expect(host.textContent).toContain("Restricted staff"); expect(suppliers).not.toHaveBeenCalled(); expect(knowledge).not.toHaveBeenCalled(); expect(webinars).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled();
  });
  it.each(["/knowledge-base", "/suppliers", "/academy"])("does not mount %s after revocation", async url => {
    path = url; response.data.active = false; await render(); expect(host.textContent).toContain("Restricted staff"); expect(suppliers).not.toHaveBeenCalled(); expect(knowledge).not.toHaveBeenCalled(); expect(academy).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled();
  });
  it.each(["/commissions", "/my-margin", "/pricing-calculator", "/crm/agents", "/messages", "/bookings/new"])("keeps legacy %s outside the staff workspace", async url => {
    path = url; await render(); expect(host.textContent).toContain("Restricted staff"); expect(legacy).not.toHaveBeenCalled(); expect(suppliers).not.toHaveBeenCalled();
  });
  it("retains only self-owned agreements and public policies", async () => { path = "/my-agreements"; await render(); expect(host.textContent).toContain("Self-owned agreements"); path = "/terms"; await render(); expect(host.textContent).toContain("Public policies"); expect(legacy).not.toHaveBeenCalled(); });
});
