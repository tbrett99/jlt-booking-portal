// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ staff: true, canManage: true, queries: [] as any[], mutations: [] as any[], data: {} as Record<string, any>, error: null as Error | null }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 20, role: "agent", name: "Synthetic Employee" } }) }));
vi.mock("@/pages/business/BusinessStaffPortalLayout", () => ({ useBusinessStaffBookingAccess: () => ({ isBusinessStaff: state.staff, canView: true, canManage: state.canManage }) }));
vi.mock("@/pages/business/BusinessStaffOwnerPanel", () => ({ default: () => null }));
vi.mock("wouter", () => ({ useParams: () => ({ id: "100" }), Link: ({ href, children, ...props }: any) => React.createElement("a", { ...props, href }, children) }));
vi.mock("@/components/FlightRequestForm", () => ({ FlightRequestForm: ({ open }: any) => open ? React.createElement("p", { "data-normal-ticketing-form": true }, "Normal flight request form") : null }));
vi.mock("@/lib/trpc", () => {
 const proxy = (parts: string[] = []): any => new Proxy(() => undefined, {
  get: (_target, key: string | symbol) => {
   if (typeof key === "symbol" || key === "then") return undefined;
   if (key === "useQuery") return (input: any, options: any = {}) => { const path = parts.join("."); state.queries.push({ path, input, enabled: options.enabled !== false }); return { data: state.data[path] ?? [], isLoading: false, isError: false, isFetching: false, error: null, refetch: async () => undefined }; };
   if (key === "useMutation") return (options: any = {}) => { const path = parts.join("."); const mutateAsync = async (input: any) => { state.mutations.push({ path, input }); if (state.error) throw state.error; const result = path === "bookings.uploadMessageDoc" ? { url: "/api/booking-documents/200/download" } : {}; options.onSuccess?.(result); return result; }; return { mutateAsync, mutate: (input: any) => { void mutateAsync(input).catch(error => options.onError?.(error)); }, isPending: false, error: null, reset: () => undefined }; };
   if (key === "useUtils") return () => proxy();
   if (key === "invalidate") return async () => undefined;
   return proxy([...parts, key]);
  },
 }); return { trpc: proxy() };
});
import AgentBookingDetail from "../client/src/pages/agent/AgentBookingDetail";
let host: HTMLDivElement, root: Root;
const epoch = new Date("2026-11-17T00:00:00Z");
beforeEach(() => {
 (globalThis as any).React = React; (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
 Object.assign((window as any).happyDOM.settings, { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableComputedStyleRendering: true });
 state.staff = true; state.canManage = true; state.queries = []; state.mutations = []; state.error = null;
 state.data = {
  "bookings.byId": { id: 100, agentId: 10, clientName: "Synthetic Traveller", destination: "Synthetic Island", departureDate: epoch, bookedDate: epoch, createdAt: epoch, updatedAt: epoch, passengers: 2, numberOfNights: 7, currentStage: "Commission Claimable", ptsRef: "PTS-SYNTHETIC", topdogRef: null, crmRef: "ORBIT-SYNTHETIC", isPersonalBooking: false, expectedCommission: "120.00", grossCost: "1200.00", commissionRate: "80", fnfVoucherUsed: false, commissionPreAuthorised: true, finalSupplierPaymentDate: epoch },
  "commissionClaims.myTopUpRequests": [{ id: 9, bookingId: 100 }],
  "notes.list": [{ id: 1, content: "Owner shared message", authorId: 10, authorName: "Synthetic Owner", authorRole: "agent", createdAt: epoch, isInternal: false }, { id: 2, content: "Support shared reply", authorId: 30, authorName: "JLT Support", authorRole: "admin", createdAt: epoch, isInternal: false }],
 };
 host = document.createElement("div"); document.body.append(host); root = createRoot(host);
 vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network forbidden"); }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
const render = () => act(async () => { root.render(React.createElement(AgentBookingDetail)); });
const setValue = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => { const setter = Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!; setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); };
const button = (label: RegExp) => Array.from(host.querySelectorAll("button")).find(node => label.test(node.textContent ?? ""));
describe("actual normal booking detail for business staff", () => {
 it("uses the full booking page and retains shared owner/support correspondence", async () => { await render(); expect(host.textContent).toContain("Synthetic Traveller"); expect(host.textContent).toContain("Owner shared message"); expect(host.textContent).toContain("Support shared reply"); expect(host.textContent).not.toContain("Legacy booking notes and documents are withheld"); expect(state.queries).toContainEqual({ path: "notes.list", input: { bookingId: 100 }, enabled: true }); });
 it("does not fetch or render commission top-up and claim controls", async () => { await render(); expect(state.queries.filter(query => query.path.startsWith("commissionClaims.") && query.enabled)).toEqual([]); expect(host.querySelector('a[href="/commissions"]')).toBeNull(); expect(host.textContent).not.toContain("Claim Now"); expect(host.textContent).not.toContain("Notify JLT to review"); expect(button(/Pre-authoris/)).toBeUndefined(); });
 it("retains normal booking figures rather than removing booking administration", async () => { await render(); expect(host.textContent).toContain("Gross Selling Price"); expect(host.textContent).toMatch(/1,200|1200/); expect(host.textContent).toContain("My Reimbursements"); expect(host.textContent).toMatch(/Amendment|Refund/); });
 it("submits normal support messages as the actual employee, with no owner ID supplied by the browser", async () => { await render(); const field = host.querySelector("textarea")!; await act(async () => setValue(field, "Synthetic booking question")); const send = (host.querySelector('button[aria-label="Send message"]') as HTMLButtonElement)!; await act(async () => send.click()); expect(state.mutations).toContainEqual({ path: "notes.add", input: { bookingId: 100, content: "Synthetic booking question", isInternal: false } }); expect(state.mutations.some(mutation => "agentId" in mutation.input || "ownerUserId" in mutation.input)).toBe(false); });
 it("retains a message draft if the normal server mutation fails", async () => { state.error = new Error("Synthetic permission changed"); await render(); const field = host.querySelector("textarea")!; await act(async () => setValue(field, "Retained synthetic question")); await act(async () => (host.querySelector('button[aria-label="Send message"]') as HTMLButtonElement)!.click()); expect(field.value).toBe("Retained synthetic question"); });
 it("opens the normal flight request form rather than a separate staff-only request modal", async () => { await render(); const ticket = button(/Ticketing|Flight Request/i)!; expect(ticket).toBeDefined(); await act(async () => ticket.click()); expect(host.querySelector("[data-normal-ticketing-form]")).not.toBeNull(); });
 it("keeps read-only staff message and upload controls disabled", async () => { state.canManage = false; await render(); expect((host.querySelector('button[aria-label="Send message"]') as HTMLButtonElement)?.disabled).toBe(true); const upload = button(/Upload document|Upload Document/); if (upload) expect(upload.disabled).toBe(true); const field = host.querySelector("textarea")!; await act(async () => setValue(field, "Attempted synthetic write")); field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })); expect(state.mutations).toEqual([]); expect(host.textContent).toContain("Support shared reply"); });
 it("retains ordinary-agent claim capability without granting it to staff", async () => { state.staff = false; await render(); expect(state.queries.some(query => query.path === "commissionClaims.myTopUpRequests" && query.enabled)).toBe(true); expect(host.textContent).toContain("Claim Now"); });
});
