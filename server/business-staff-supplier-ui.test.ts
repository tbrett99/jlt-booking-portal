// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ queries: [] as Array<{ path: string; input: any; enabled: boolean }>, mutate: vi.fn() }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 20, role: "agent", name: "Synthetic employee" } }) }));
const supplier: any = {
  id: 10, name: "Synthetic Supplier", description: "Published supplier guidance", shortDescription: "Published overview", categories: "Cruises", locations: "Worldwide",
  phone: "01234 000000", email: "help@example.test", outOfHoursPhone: "01234 000001", outOfHoursNotes: "Emergency help", credentialStage: 1, isActive: 1,
  publicWebsite: "https://example.test", loginUsername: "SYNTHETIC-PRIVATE-USERNAME", loginPassword: "SYNTHETIC-PRIVATE-PASSWORD", agencyId: "SYNTHETIC-PRIVATE-AGENCY",
  requiresLoginRequest: true, loginRequestNotes: "SYNTHETIC-PRIVATE-REQUEST", adminUsername: "SYNTHETIC-ADMIN", adminPassword: "SYNTHETIC-ADMIN-SECRET", adminNotes: "SYNTHETIC-ADMIN-NOTE",
};
vi.mock("@/lib/trpc", () => {
  const proxy = (parts: string[] = []): any => new Proxy(() => undefined, {
    get: (_target, key: string) => {
      if (key === "useQuery") return (input: any, options: any = {}) => {
        const path = parts.join(".");
        mock.queries.push({ path, input, enabled: options.enabled !== false });
        const data = path === "suppliers.list" ? { suppliers: [supplier], agentStage: 3, total: 1, totalPages: 1 }
          : path === "suppliers.get" ? supplier : path === "suppliers.categories" ? ["Cruises"] : [];
        return { data, isLoading: false, isFetching: false, error: null, refetch: vi.fn() };
      };
      if (key === "useMutation") return () => ({ mutate: mock.mutate, isPending: false });
      return proxy([...parts, key]);
    },
  });
  return { trpc: proxy() };
});
import SupplierDirectory from "../client/src/pages/SupplierDirectory";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).React = React;
  mock.queries.length = 0; mock.mutate.mockClear();
  window.history.replaceState({}, "", "/suppliers");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); window.history.replaceState({}, "", "/"); });
const render = async (staff = true) => { await act(async () => root.render(React.createElement(SupplierDirectory, { businessStaffMode: staff }))); };
const screen = () => document.body.textContent ?? "";
describe("real supplier resource page in staff mode", () => {
  it("keeps familiar searchable supplier cards and public information", async () => {
    await render(); expect(screen()).toContain("Supplier Directory"); expect(screen()).toContain("Synthetic Supplier");
    expect(host.querySelector('input[placeholder="Search by supplier name..."]')).not.toBeNull();
    expect(mock.queries.some(q => q.path === "suppliers.list" && q.enabled)).toBe(true);
    expect(mock.queries.some(q => q.path === "suppliers.categories" && q.enabled)).toBe(true);
  });
  it("does not suggest owner credentials or the independent-agent unlock stages", async () => {
    await render(); expect(screen()).toContain("Supplier information, contacts and training resources"); expect(screen()).not.toContain("Stage 3 — Full access");
  });
  it("does not render or invoke AI features", async () => {
    await render(); expect(screen()).not.toContain("AI Chat"); expect(screen()).not.toContain("Use AI Search");
    expect(mock.queries.some(q => q.path === "suppliers.aiSearch" && q.enabled)).toBe(false); expect(mock.mutate).not.toHaveBeenCalled();
  });
  it("passes keyword search through the normal published resource list", async () => {
    await render(); const input = host.querySelector('input[placeholder="Search by supplier name..."]') as HTMLInputElement;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(input, "cruise"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(mock.queries.some(q => q.path === "suppliers.list" && q.input.search === "cruise")).toBe(true);
  });
  it("keeps public supplier contact and emergency guidance in a direct detail view", async () => {
    window.history.replaceState({}, "", "/suppliers?supplierId=10"); await render();
    expect(screen()).toContain("01234 000001"); expect(screen()).toContain("Emergency help");
    expect(mock.queries.some(q => q.path === "suppliers.get" && q.input.id === 10 && q.enabled)).toBe(true);
    expect(mock.queries.some(q => q.path === "suppliers.listAttachments" && q.enabled)).toBe(true);
  });
  it("withholds credential panels and login requests even if a stale cache contains them", async () => {
    window.history.replaceState({}, "", "/suppliers?supplierId=10"); await render();
    for (const privateText of ["SYNTHETIC-PRIVATE-USERNAME", "SYNTHETIC-PRIVATE-PASSWORD", "SYNTHETIC-PRIVATE-AGENCY", "SYNTHETIC-PRIVATE-REQUEST", "SYNTHETIC-ADMIN-SECRET", "Request Access"]) expect(screen()).not.toContain(privateText);
    expect(mock.queries.some(q => q.path === "suppliers.getMyLoginRequests" && q.enabled)).toBe(false);
    expect(mock.mutate).not.toHaveBeenCalled();
  });
  it("preserves the existing ordinary-agent AI controls", async () => {
    await render(false); expect(screen()).toContain("AI Chat"); expect(screen()).toContain("Use AI Search");
  });
});
