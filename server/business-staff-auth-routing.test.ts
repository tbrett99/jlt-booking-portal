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
const retry = vi.fn();
const link = ({ children }: any) => React.createElement("span", null, children);
const route = ({ children, component: Component }: any) => Component ? React.createElement(Component) : children;
const select = ({ children }: any) => React.Children.toArray(children).find((child: any) => child.props.path === path) ?? null;
const dependencies: Record<string, any> = {
  React, useAuth: () => ({ user: identity, loading: false }), useViewMode: () => ({ isAgentView: false }), useLocation: () => [path],
  trpc: { businessStaff: { mine: { useQuery: () => response } } }, Loader2: () => React.createElement("span", null, "Loading"),
  BusinessStaffWorkspace: staff, AcademyHome: academy, AcademyCourse: academy, ChangePasswordPage: password,
  MyAgreements: () => React.createElement("p", null, "Self-owned agreements"), Link: link, Switch: select, Route: route, NotFound: () => null,
  PortalLayout: legacy, StaffWorkspace: legacy, OnboardingGuard: legacy, SuspendedGuard: legacy,
};
const ActualRouter = new Function(...Object.keys(dependencies), script + "return AuthRouter;")(...Object.values(dependencies));
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  identity.mustChangePassword = false; path = "/bookings/100";
  response = { data: { managed: true, active: true, membership: { permissions: { academyAccess: true } } }, isLoading: false, error: null, refetch: retry };
  [staff, legacy, academy, password, retry].forEach(mock => mock.mockClear());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async () => { await act(async () => root.render(React.createElement(ActualRouter))); };
describe("actual AuthRouter classification branch with network-free dependencies", () => {
  it("routes an old booking deep link to restricted staff, not the financial shell", async () => { await render(); expect(host.textContent).toContain("Restricted staff"); expect(legacy).not.toHaveBeenCalled(); });
  it("does not fall back for revoked membership", async () => { response.data.active = false; await render(); expect(host.textContent).toContain("Restricted staff"); expect(legacy).not.toHaveBeenCalled(); });
  it("withholds all Portal components while the registry loads", async () => { response = { ...response, data: undefined, isLoading: true }; await render(); expect(host.textContent).toContain("Checking Portal access"); expect(staff).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
  it("withholds cached data on registry error and provides a safe retry", async () => { response.error = new Error("Synthetic failure"); await render(); expect(host.textContent).toContain("No business or financial data has been loaded"); await act(async () => host.querySelector("button")!.click()); expect(retry).toHaveBeenCalledOnce(); expect(staff).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
  it("permits the existing own Academy branch without a legacy shell", async () => { path = "/academy"; await render(); expect(host.textContent).toContain("Own Academy"); expect(legacy).not.toHaveBeenCalled(); });
  it("denies the Academy branch when its permission is removed", async () => { path = "/academy"; response.data.membership.permissions.academyAccess = false; await render(); expect(host.textContent).toContain("Restricted staff"); expect(academy).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
  it("keeps required password setup ahead of all business and finance views", async () => { identity.mustChangePassword = true; await render(); expect(host.textContent).toContain("Password setup"); expect(staff).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
});
