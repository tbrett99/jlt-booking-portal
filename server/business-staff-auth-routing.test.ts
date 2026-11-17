// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import ts from "typescript";
import { DEFAULT_BUSINESS_STAFF_PERMISSIONS, readBusinessStaffPermissions } from "../shared/business-staff";
const text = fs.readFileSync("client/src/App.tsx", "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let target: ts.FunctionDeclaration | undefined;
ts.forEachChild(source, node => { if (ts.isFunctionDeclaration(node) && node.name?.text === "AuthRouter") target = node; });
if (!target) throw new Error("Actual AuthRouter missing");
const script = ts.transpileModule(target.getText(source).replace("export function", "function"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
const identity = { id: 20, role: "agent", name: "Synthetic Employee", portalStatus: "active", mustChangePassword: false };
let response: any, path: string, host: HTMLDivElement, root: Root;
const page = (label: string) => vi.fn(() => React.createElement("p", null, label));
const staff = page("Staff home"), legacy = page("Legacy financial shell"), academy = page("Own Academy view"), password = page("Password setup"), knowledge = page("Published Knowledge Base"), webinars = page("Published webinar library"), bookings = page("Normal booking list"), detail = page("Normal booking detail"), messages = page("Normal booking messages"), registration = page("Normal booking registration"), amendment = page("Normal amendment request"), cancellation = page("Normal cancellation request"), refund = page("Normal refund request"), flights = page("Normal flight requests");
const suppliers = vi.fn((props: any) => React.createElement("p", null, props.businessStaffMode ? "Supplier resource-only view" : "Ordinary supplier view"));
const retry = vi.fn();
const route = ({ children, component: Component }: any) => Component ? React.createElement(Component) : typeof children === "function" ? children({ id: "100", enrollmentId: "70" }) : children;
const select = ({ children }: any) => {
 const items = React.Children.toArray(children) as any[];
 return items.find(child => child.props.path && new RegExp("^" + child.props.path.replace(/:[^/]+/g, "[^/]+") + "$").test(path)) ?? items.find(child => !child.props.path) ?? null;
};
const dependencies: Record<string, any> = {
 React, useAuth: () => ({ user: identity, loading: false }), useViewMode: () => ({ isAgentView: false }), useLocation: () => [path], readBusinessStaffPermissions,
 trpc: { businessStaff: { mine: { useQuery: () => response } } }, Loader2: () => React.createElement("span", null, "Loading"),
 BusinessStaffWorkspace: staff, BusinessStaffPortalProvider: ({ children }: any) => children, BusinessStaffPortalLayout: ({ children }: any) => React.createElement("section", { "data-familiar-staff-shell": true }, children),
 AcademyHome: academy, AcademyCourse: academy, ChangePasswordPage: password,
 SupplierDirectory: suppliers, KnowledgeBase: knowledge, WebinarLibrary: webinars,
 AgentRequestTracker: bookings, AgentBookings: bookings, AgentBookingDetail: detail, AgentMessages: messages, RegisterBooking: registration, AgentRequestAmendment: amendment, AgentCancelBooking: cancellation, RefundForm: refund, AmendmentForm: amendment, CancellationForm: cancellation, AgentFlightRequests: flights,
 StaffBookingWriteNotice: page("Booking management is disabled"),
 MyAgreements: page("Self-owned agreements"), TermsAndPolicies: page("Public policies"), Link: ({ children }: any) => React.createElement("span", null, children), Switch: select, Route: route, NotFound: () => null,
 PortalLayout: legacy, StaffWorkspace: legacy, OnboardingGuard: legacy, SuspendedGuard: legacy,
};
const ActualRouter = new Function(...Object.keys(dependencies), script + "return AuthRouter;")(...Object.values(dependencies));
const all = [staff, legacy, academy, password, suppliers, knowledge, webinars, bookings, detail, messages, registration, amendment, cancellation, refund, flights, retry];
beforeEach(() => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
 host = document.createElement("div"); document.body.append(host); root = createRoot(host);
 identity.mustChangePassword = false; path = "/bookings/100";
 response = { data: { managed: true, active: true, membership: { permissions: { ...DEFAULT_BUSINESS_STAFF_PERMISSIONS } } }, isLoading: false, isFetching: false, error: null, refetch: retry };
 all.forEach(mock => mock.mockClear());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async () => { await act(async () => root.render(React.createElement(ActualRouter))); };
describe("actual AuthRouter normal staff booking and resource routes", () => {
 it.each([["/bookings/100", detail], ["/my-bookings", bookings], ["/business-staff/bookings", bookings], ["/messages", messages], ["/my-requests", bookings]] as const)("opens normal %s within the familiar staff shell", async (url, component) => { path = url; await render(); expect(component).toHaveBeenCalled(); expect(host.querySelector("[data-familiar-staff-shell]")).not.toBeNull(); expect(legacy).not.toHaveBeenCalled(); });
 it.each([["/bookings/new", registration], ["/request-amendment", amendment], ["/cancel-booking", cancellation], ["/bookings/100/refund", refund], ["/flight-requests", flights]] as const)("opens normal permitted %s submission", async (url, component) => { path = url; await render(); expect(component).toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
 it.each(["/bookings/new", "/request-amendment", "/cancel-booking", "/bookings/100/refund"])("does not mount %s submission with management disabled", async url => { path = url; response.data.membership.permissions.manageBookings = false; await render(); expect(host.textContent).toContain("Booking management is disabled"); for (const component of [registration, amendment, cancellation, refund, flights, legacy]) expect(component).not.toHaveBeenCalled(); });
 it("retains normal read-only detail when management is disabled", async () => { response.data.membership.permissions.manageBookings = false; await render(); expect(detail).toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
 it("denies normal booking pages when visibility is removed", async () => { response.data.membership.permissions.viewBookings = false; await render(); expect(host.textContent).toContain("Staff home"); expect(detail).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
 it("does not fall back for revoked membership", async () => { response.data.active = false; await render(); expect(host.textContent).toContain("Staff home"); expect(detail).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
 it("withholds all Portal components while registry loads", async () => { response = { ...response, data: undefined, isLoading: true }; await render(); expect(host.textContent).toContain("Checking Portal access"); expect(staff).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
 it("withholds stale managed data during a fresh authority check", async () => { path = "/knowledge-base"; response.isFetching = true; await render(); expect(host.textContent).toContain("Checking Portal access"); expect(knowledge).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
 it("withholds cached data on registry error with safe retry", async () => { response.error = new Error("Synthetic failure"); await render(); expect(host.textContent).toContain("No business or financial data has been loaded"); await act(async () => host.querySelector("button")!.click()); expect(retry).toHaveBeenCalledOnce(); expect(staff).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
 it("keeps password setup ahead of business data", async () => { identity.mustChangePassword = true; await render(); expect(password).toHaveBeenCalled(); expect(detail).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
 it("permits own Academy, not owner learning", async () => { path = "/academy"; await render(); expect(academy).toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
 it("denies Academy when its separate permission is removed", async () => { path = "/academy"; response.data.membership.permissions.academyAccess = false; await render(); expect(academy).not.toHaveBeenCalled(); expect(staff).toHaveBeenCalled(); });
 it.each([["/knowledge-base", knowledge], ["/webinars", webinars], ["/suppliers", suppliers]] as const)("opens permitted %s resources", async (url, component) => { path = url; await render(); expect(component).toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
 it.each(["/knowledge-base", "/webinars", "/suppliers"])("denies %s with resource permission removed", async url => { path = url; response.data.membership.permissions.resourceAccess = false; await render(); for (const component of [suppliers, knowledge, webinars, legacy]) expect(component).not.toHaveBeenCalled(); expect(staff).toHaveBeenCalled(); });
 it.each(["/knowledge-base", "/suppliers", "/academy", "/bookings/100", "/messages"])("does not mount %s after revocation", async url => { path = url; response.data.active = false; await render(); for (const component of [suppliers, knowledge, academy, detail, messages, legacy]) expect(component).not.toHaveBeenCalled(); expect(staff).toHaveBeenCalled(); });
 it.each(["/commissions", "/commission-timeline", "/my-margin", "/pricing-calculator", "/crm/agents", "/pipeline"])("does not mount unrelated legacy %s", async url => { path = url; await render(); expect(staff).toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
 it("retains self-owned agreements and public policies", async () => { path = "/my-agreements"; await render(); expect(host.textContent).toContain("Self-owned agreements"); path = "/terms"; await render(); expect(host.textContent).toContain("Public policies"); expect(legacy).not.toHaveBeenCalled(); });
});
