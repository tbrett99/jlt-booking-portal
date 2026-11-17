// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUSINESS_STAFF_ORBIT_NOTICE,
  DEFAULT_BUSINESS_STAFF_PERMISSIONS,
  BUSINESS_STAFF_PERMISSION_LABELS,
} from "../shared/business-staff";

// Render real React forms, shadcn tables/tabs/dialogs and native inputs. Only
// authentication/tRPC are mocked; no server, database, provider or network runs.
const mock = vi.hoisted(() => ({
  user: { id: 1, role: "super_admin", name: "Synthetic administrator" } as any,
  data: {} as Record<string, any>,
  errors: {} as Record<string, any>,
  fetching: {} as Record<string, boolean>,
  loading: {} as Record<string, boolean>,
  results: {} as Record<string, any>,
  rejects: {} as Record<string, string>,
  waits: {} as Record<string, Promise<unknown>>,
  hooks: [] as { kind: string; path: string; input?: any; enabled?: boolean }[],
  mutations: [] as { path: string; input: any }[],
  operations: [] as string[],
  logout: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: mock.user, loading: false, logout: mock.logout }),
}));
vi.mock("@/lib/trpc", async () => {
  const react = await import("react");
  const proxy = (parts: string[] = []): any =>
    new Proxy(() => undefined, {
      get: (_target, key: string) => {
        if (key === "useQuery")
          return (input: any, options: any = {}) => {
            const path = parts.join(".");
            mock.hooks.push({
              kind: "query",
              path,
              input: structuredClone(input),
              enabled: options.enabled !== false,
            });
            return {
              data: mock.data[path],
              error: mock.errors[path] ?? null,
              isLoading: mock.loading[path] ?? false,
              isFetching: mock.fetching[path] ?? false,
              refetch: vi.fn(async () => {
                mock.operations.push(`${path}.refetch`);
              }),
            };
          };
        if (key === "useMutation")
          return () => {
            const path = parts.join(".");
            mock.hooks.push({ kind: "mutation", path });
            const [error, setError] = react.useState<any>(null);
            const [isPending, setPending] = react.useState(false);
            const mutateAsync = async (input: any) => {
              mock.mutations.push({ path, input: structuredClone(input) });
              setPending(true);
              try {
                await mock.waits[path];
                if (mock.rejects[path]) throw new Error(mock.rejects[path]);
                return (
                  mock.results[path] ?? {
                    success: true,
                    noteId: 99,
                    membership: { id: 11, revision: 5 },
                  }
                );
              } catch (failure) {
                setError(failure);
                throw failure;
              } finally {
                setPending(false);
              }
            };
            return {
              mutateAsync,
              mutate: (input: any) => {
                void mutateAsync(input).catch(() => undefined);
              },
              isPending,
              error,
              reset: () => setError(null),
            };
          };
        if (key === "useUtils") return () => proxy(["utils"]);
        if (key === "invalidate")
          return vi.fn(async () => {
            mock.operations.push(`${parts.join(".")}.invalidate`);
          });
        return proxy([...parts, key]);
      },
    });
  return { trpc: proxy() };
});

import AdminBusinessStaff, {
  privateSetupUrl,
} from "../client/src/pages/business/AdminBusinessStaff";
import BusinessStaffWorkspace from "../client/src/pages/business/BusinessStaffWorkspace";
import BusinessStaffPortalLayout, {
  BusinessStaffPortalProvider,
} from "../client/src/pages/business/BusinessStaffPortalLayout";
import PortalLayout from "../client/src/components/PortalLayout";
import { ViewModeProvider } from "../client/src/contexts/ViewModeContext";
import { useStaffAccess } from "../client/src/pages/staff/StaffWorkspace";
import BusinessStaffOwnerNotes from "../client/src/pages/business/BusinessStaffOwnerNotes";

const owner = {
  id: 40,
  name: "Synthetic Owner",
  email: "owner@example.test",
  status: "active",
};
const account = {
  id: 60,
  name: "Synthetic Assistant",
  email: "assistant@example.test",
  status: "active",
};
function member(status: "active" | "revoked" = "active") {
  return {
    id: 11,
    membershipId: 11,
    ownerUserId: owner.id,
    staffUserId: account.id,
    owner,
    staff: account,
    status,
    revision: 4,
    permissions: { ...DEFAULT_BUSINESS_STAFF_PERMISSIONS },
    orbitRequested: false,
    orbitReady: false,
    orbitNotice: BUSINESS_STAFF_ORBIT_NOTICE,
    createdAt: "2026-01-01T12:00:00Z",
  };
}
function authority(permissions = { ...DEFAULT_BUSINESS_STAFF_PERMISSIONS }) {
  return {
    managed: true,
    active: true,
    owner: { id: owner.id, name: owner.name, email: null },
    membership: { ...member(), permissions },
    orbitReady: false,
    orbitNotice: BUSINESS_STAFF_ORBIT_NOTICE,
  };
}
const booking = {
  id: 701,
  clientName: "Synthetic Customer",
  destination: "Test Island",
  departureDate: "2026-12-01",
  bookedDate: "2026-10-01",
  topdogRef: "REF-701",
  ptsRef: null,
  crmRef: null,
  currentStage: "Booked",
  passengers: 2,
  numberOfNights: 7,
};
const page = (items: any[], hasMore = false) => ({
  items,
  page: 1,
  pageSize: 50,
  hasMore,
});
let container: HTMLDivElement;
let root: Root;
let previousSettings: Record<string, unknown>;
async function flush() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
  });
}
async function render(component: React.ReactElement) {
  await act(async () => {
    root.render(component);
  });
  await flush();
}
async function renderStaffWorkspace(path = "/my-bookings") {
  window.history.replaceState(null, "", path);
  const current = mock.data["businessStaff.mine"] ?? {
    ...authority(),
    active: false,
    membership: null,
  };
  // Root classification withholds active authority while it cannot be verified.
  const checked =
    mock.errors["businessStaff.mine"] ||
    mock.loading["businessStaff.mine"] ||
    mock.fetching["businessStaff.mine"]
      ? { ...current, active: false }
      : current;
  await render(
    React.createElement(BusinessStaffPortalProvider, {
      authority: checked,
      children: React.createElement(BusinessStaffPortalLayout, {
        children: React.createElement(BusinessStaffWorkspace),
      }),
    })
  );
}
async function renderStaffShell(
  current = authority(),
  children: React.ReactNode = React.createElement(
    "p",
    null,
    "Resource content"
  ),
  viaPortal = false
) {
  await render(
    React.createElement(BusinessStaffPortalProvider, {
      authority: current,
      children: React.createElement(
        viaPortal ? PortalLayout : BusinessStaffPortalLayout,
        { children }
      ),
    })
  );
}
async function clickLabel(label: string) {
  const control = controls().querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`
  );
  expect(control, `button labelled ${label}`).toBeTruthy();
  await act(async () => control!.click());
  await flush();
}
function controls() {
  return document.body;
}
function button(text: string, scope: ParentNode = controls()) {
  const result = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    item => item.textContent?.trim() === text
  );
  expect(result, `button ${text}`).toBeTruthy();
  return result!;
}
async function click(text: string, scope?: ParentNode) {
  await act(async () => button(text, scope).click());
  await flush();
}
function field(label: string) {
  const scope = controls().querySelector('[role="dialog"]') ?? controls();
  const result = [...scope.querySelectorAll("label")]
    .find(item => item.querySelector("span")?.textContent === label)
    ?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea");
  expect(result, `labelled field ${label}`).toBeTruthy();
  return result!;
}
async function change(
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string
) {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      control,
      value
    );
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}
function checkbox(label: string) {
  const result = [...controls().querySelectorAll("label")]
    .find(item => item.textContent?.includes(label))
    ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  expect(result, `checkbox ${label}`).toBeTruthy();
  return result!;
}
async function toggle(label: string) {
  await act(async () => checkbox(label).click());
  await flush();
}
async function tab(label: string) {
  await act(async () => {
    const control = button(label);
    control.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 })
    );
    control.click();
  });
  await flush();
}
async function chooseOwner() {
  await render(React.createElement(AdminBusinessStaff));
  await change(field("Search business owners"), "Synthetic");
  await click("Find owner");
  await click("Choose owner");
}
async function chooseAccount() {
  await change(field("Search existing accounts"), "Assistant");
  await click("Find existing account");
  await act(async () => {
    controls().querySelector<HTMLInputElement>('input[type="radio"]')!.click();
  });
  await flush();
}
async function confirmations() {
  await toggle("I explicitly confirm");
  await toggle("I confirm existing fees");
  await change(
    field("Audit reason (at least 10 characters)"),
    "Approved separate staff access"
  );
}
function activeQueries() {
  return mock.hooks.filter(hook => hook.kind === "query" && hook.enabled);
}
function assertOnlyBusinessHooks() {
  expect(
    mock.hooks.filter(
      hook => !/^(businessStaff|businessBookings)\./.test(hook.path)
    )
  ).toEqual([]);
  expect(
    mock.mutations.filter(
      item => !/^(businessStaff|businessBookings)\./.test(item.path)
    )
  ).toEqual([]);
  expect(globalThis.fetch).not.toHaveBeenCalled();
}

beforeEach(() => {
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const settings = (window as any).happyDOM.settings;
  previousSettings = {
    disableIframePageLoading: settings.disableIframePageLoading,
    enableFileSystemHttpRequests: settings.enableFileSystemHttpRequests,
    disableCSSFileLoading: settings.disableCSSFileLoading,
    disableJavaScriptFileLoading: settings.disableJavaScriptFileLoading,
  };
  settings.disableIframePageLoading = true;
  settings.enableFileSystemHttpRequests = false;
  settings.disableCSSFileLoading = true;
  settings.disableJavaScriptFileLoading = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network forbidden in business staff UI tests");
    })
  );
  vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => {
    throw new Error("XHR forbidden in business staff UI tests");
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
  mock.user = { id: 1, role: "super_admin", name: "Synthetic administrator" };
  mock.data = {
    "businessStaff.searchOwners": page([owner]),
    "businessStaff.searchAccounts": page([account]),
    "businessStaff.adminList": page([member()]),
    "businessStaff.mine": authority(),
    "businessBookings.list": page([booking]),
    "businessBookings.detail": booking,
    "businessBookings.listNotes": page([]),
    "businessBookings.ownerNotes": page([]),
  };
  mock.errors = {};
  mock.fetching = {};
  mock.loading = {};
  mock.rejects = {};
  mock.results = {};
  mock.waits = {};
  mock.hooks = [];
  mock.mutations = [];
  mock.operations = [];
  window.localStorage.clear();
  mock.logout.mockReset();
  mock.logout.mockResolvedValue(undefined);
  window.history.replaceState(null, "", "/business-staff");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  Object.assign((window as any).happyDOM.settings, previousSettings);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Business-staff administration", () => {
  it("denies non-administrators without instantiating management hooks", async () => {
    mock.user = { id: 60, role: "agent" };
    await render(React.createElement(AdminBusinessStaff));
    expect(container.textContent).toContain("Administrator access required");
    expect(mock.hooks).toEqual([]);
    assertOnlyBusinessHooks();
  });
  it("allows the API's administrator role without loading an unsearched directory", async () => {
    mock.user = { id: 1, role: "admin" };
    await render(React.createElement(AdminBusinessStaff));
    expect(container.textContent).toContain("Choose the business owner");
    expect(activeQueries()).toEqual([]);
  });
  it("does not load an agent directory or memberships before an explicit owner search and choice", async () => {
    await render(React.createElement(AdminBusinessStaff));
    expect(activeQueries()).toEqual([]);
    expect(container.textContent).not.toContain(account.email);
    await change(field("Search business owners"), "S");
    expect(button("Find owner").disabled).toBe(true);
    await change(field("Search business owners"), "Synthetic");
    await click("Find owner");
    expect(
      activeQueries().every(hook => hook.path === "businessStaff.searchOwners")
    ).toBe(true);
    await click("Choose owner");
    expect(
      activeQueries().find(hook => hook.path === "businessStaff.adminList")
        ?.input
    ).toEqual({ page: 1, pageSize: 25, search: "40" });
    expect(mock.mutations).toEqual([]);
    assertOnlyBusinessHooks();
  });
  it("links a separate existing account with explicit safe defaults and both acknowledgements", async () => {
    await chooseOwner();
    await chooseAccount();
    expect(
      checkbox(BUSINESS_STAFF_PERMISSION_LABELS.viewBookings).checked
    ).toBe(true);
    expect(checkbox(BUSINESS_STAFF_PERMISSION_LABELS.manageBookings).checked).toBe(true);
    expect(controls().textContent).not.toContain(BUSINESS_STAFF_PERMISSION_LABELS.viewCustomerAmounts);
    expect(controls().textContent).not.toContain(BUSINESS_STAFF_PERMISSION_LABELS.addBookingNotes);
    expect(
      checkbox(BUSINESS_STAFF_PERMISSION_LABELS.academyAccess).checked
    ).toBe(true);
    expect(button("Confirm link existing account").disabled).toBe(true);
    await confirmations();
    await click("Confirm link existing account");
    expect(mock.mutations).toEqual([
      {
        path: "businessStaff.linkExisting",
        input: {
          ownerUserId: 40,
          staffUserId: 60,
          permissions: DEFAULT_BUSINESS_STAFF_PERMISSIONS,
          orbitRequested: false,
          reason: "Approved separate staff access",
          restrictedStaffOnlyConfirmed: true,
          preserveExistingDataConfirmed: true,
        },
      },
    ]);
    expect(container.textContent).toContain("not an account merge");
    expect(mock.operations).toContain("businessStaff.adminList.refetch");
    assertOnlyBusinessHooks();
  });
  it("saves permission changes with an Orbit request but never enables Orbit", async () => {
    await chooseOwner();
    await click("Adjust permissions");
    const dialog = controls().querySelector('[role="dialog"]')!;
    const label = [...dialog.querySelectorAll("label")].find(item =>
      item.textContent?.includes("Request Orbit")
    )!;
    await act(async () =>
      label.querySelector<HTMLInputElement>("input")!.click()
    );
    await change(
      field("Audit reason (at least 10 characters)"),
      "Approved Orbit access request"
    );
    await click("Confirm permission changes");
    expect(mock.mutations[0]).toEqual({
      path: "businessStaff.updatePermissions",
      input: {
        membershipId: 11,
        revision: 4,
        permissions: DEFAULT_BUSINESS_STAFF_PERMISSIONS,
        orbitRequested: true,
        reason: "Approved Orbit access request",
      },
    });
    expect(controls().querySelector('[role="dialog"]')).toBeNull();
    expect(mock.operations).toContain("businessStaff.adminList.refetch");
  });
  it("records an Orbit request only and clears dependent permissions when booking visibility is removed", async () => {
    await chooseOwner();
    await chooseAccount();
    await toggle(BUSINESS_STAFF_PERMISSION_LABELS.viewBookings);
    expect(checkbox(BUSINESS_STAFF_PERMISSION_LABELS.manageBookings).checked).toBe(false);
    expect(checkbox(BUSINESS_STAFF_PERMISSION_LABELS.manageBookings).disabled).toBe(true);
    await toggle("Request Orbit");
    await confirmations();
    await click("Confirm link existing account");
    expect(mock.mutations[0].input).toMatchObject({
      permissions: {
        viewBookings: false,
        viewCustomerAmounts: false,
        addBookingNotes: false,
        academyAccess: true,
      },
      orbitRequested: true,
    });
    expect(mock.mutations[0].input).not.toHaveProperty("orbitReady");
    expect(container.textContent).toContain("Pending the Orbit team");
  });
  it("retains a failed existing-account draft and does not show success", async () => {
    mock.rejects["businessStaff.linkExisting"] = "Account became ineligible";
    await chooseOwner();
    await chooseAccount();
    await confirmations();
    await click("Confirm link existing account");
    expect(field("Audit reason (at least 10 characters)").value).toBe(
      "Approved separate staff access"
    );
    expect(checkbox("I explicitly confirm").checked).toBe(true);
    expect(container.textContent).toContain("Account became ineligible");
    expect(container.textContent).not.toContain("Existing account linked as");
  });
  it("creates an own-login staff account and copies the private setup link once without sending email", async () => {
    mock.results["businessStaff.createStaff"] = {
      success: true,
      membership: member(),
      setupUrl: "/reset-password?token=synthetic-once",
    };
    await chooseOwner();
    await tab("Create staff");
    await change(field("New staff name"), "New Assistant");
    await change(field("New staff email"), "new.assistant@example.test");
    await confirmations();
    await click("Confirm create staff login");
    expect(mock.mutations[0]).toMatchObject({
      path: "businessStaff.createStaff",
      input: {
        ownerUserId: 40,
        name: "New Assistant",
        email: "new.assistant@example.test",
        permissions: DEFAULT_BUSINESS_STAFF_PERMISSIONS,
        restrictedStaffOnlyConfirmed: true,
        preserveExistingDataConfirmed: true,
      },
    });
    expect(mock.mutations[0].input).not.toHaveProperty("staffUserId");
    expect(field("Private setup link").value).toContain("synthetic-once");
    expect(controls().querySelector('[role="dialog"]')).toBeTruthy();
    await click("Copy private link once");
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(controls().textContent).not.toContain("synthetic-once");
    expect(controls().textContent).toContain(
      "The private link is no longer displayed"
    );
    assertOnlyBusinessHooks();
  });
  it("retains failed creation fields and never treats a duplicate email as a link", async () => {
    mock.rejects["businessStaff.createStaff"] = "Email already exists";
    await chooseOwner();
    await tab("Create staff");
    await change(field("New staff name"), "Duplicate Assistant");
    await change(field("New staff email"), "duplicate@example.test");
    await confirmations();
    await click("Confirm create staff login");
    expect(field("New staff email").value).toBe("duplicate@example.test");
    expect(controls().textContent).toContain("Email already exists");
    expect(mock.mutations.map(item => item.path)).toEqual([
      "businessStaff.createStaff",
    ]);
  });
  it("sends membership ID, current revision and reason for permission changes and retains conflict drafts", async () => {
    mock.rejects["businessStaff.updatePermissions"] =
      "Membership revision changed";
    await chooseOwner();
    await click("Adjust permissions");
    const dialog = controls().querySelector('[role="dialog"]')!;
    const input = [...dialog.querySelectorAll("label")]
      .find(item =>
        item.textContent?.includes(
          BUSINESS_STAFF_PERMISSION_LABELS.manageBookings
        )
      )!
      .querySelector<HTMLInputElement>("input")!;
    await act(async () => input.click());
    await change(
      field("Audit reason (at least 10 characters)"),
      "Explicit booking note approval"
    );
    await click("Confirm permission changes");
    expect(mock.mutations[0]).toEqual({
      path: "businessStaff.updatePermissions",
      input: {
        membershipId: 11,
        revision: 4,
        reason: "Explicit booking note approval",
        permissions: {
          ...DEFAULT_BUSINESS_STAFF_PERMISSIONS,
          manageBookings: false,
        },
        orbitRequested: false,
      },
    });
    expect(controls().textContent).toContain("Membership revision changed");
    expect(field("Audit reason (at least 10 characters)").value).toBe(
      "Explicit booking note approval"
    );
    expect(input.checked).toBe(false);
  });
  it.each(["active", "revoked"] as const)(
    "confirms %s membership status changes without a delete operation",
    async status => {
      mock.data["businessStaff.adminList"] = page([member(status)]);
      await chooseOwner();
      await click(status === "active" ? "Revoke access" : "Reactivate access");
      await change(
        field("Audit reason (at least 10 characters)"),
        "Explicit access status review"
      );
      await click(
        status === "active"
          ? "Confirm revoke access"
          : "Confirm reactivate access"
      );
      expect(mock.mutations[0]).toEqual({
        path: "businessStaff.setStatus",
        input: {
          membershipId: 11,
          revision: 4,
          reason: "Explicit access status review",
          status: status === "active" ? "revoked" : "active",
        },
      });
      expect(controls().textContent).not.toContain("Delete staff");
    }
  );
  it("requires an audited revision to issue a private setup link", async () => {
    mock.results["businessStaff.createSetupLink"] = {
      success: true,
      membership: member(),
      setupUrl: "/reset-password?token=synthetic-refresh",
    };
    await chooseOwner();
    await click("Create setup link");
    expect(button("Confirm create private link").disabled).toBe(true);
    await change(
      field("Audit reason (at least 10 characters)"),
      "Staff requested password setup"
    );
    await click("Confirm create private link");
    expect(mock.mutations[0]).toEqual({
      path: "businessStaff.createSetupLink",
      input: {
        membershipId: 11,
        revision: 4,
        reason: "Staff requested password setup",
      },
    });
    await click("Dismiss private link");
    expect(controls().querySelector('[role="dialog"]')).toBeNull();
  });
  it("keeps a setup link available for manual copy after clipboard failure and clears it on dismissal", async () => {
    mock.results["businessStaff.createSetupLink"] = {
      success: true,
      membership: member(),
      setupUrl: "/reset-password?token=synthetic-clipboard",
    };
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error("Clipboard denied")
    );
    await chooseOwner();
    await click("Create setup link");
    await change(
      field("Audit reason (at least 10 characters)"),
      "Staff requested password setup"
    );
    await click("Confirm create private link");
    await click("Copy private link once");
    expect(controls().textContent).toContain("Clipboard access failed");
    expect(field("Private setup link").value).toContain("synthetic-clipboard");
    await click("Dismiss private link");
    expect(controls().querySelector("input[readonly]")).toBeNull();
    expect(controls().textContent).not.toContain("synthetic-clipboard");
  });
  it("fails closed on owner search errors with stale candidates and paginates explicit searches", async () => {
    mock.data["businessStaff.searchOwners"] = page([owner], true);
    await render(React.createElement(AdminBusinessStaff));
    await change(field("Search business owners"), "Synthetic");
    await click("Find owner");
    await click(
      "Next",
      controls().querySelector('[aria-label="Owner search pagination"]')!
    );
    expect(activeQueries().at(-1)?.input.page).toBe(2);
    mock.errors["businessStaff.searchOwners"] = {
      message: "Owner search unavailable",
    };
    await render(React.createElement(AdminBusinessStaff));
    expect(container.textContent).toContain("Owner search unavailable");
    expect(
      [...controls().querySelectorAll("button")].some(
        item => item.textContent === "Choose owner"
      )
    ).toBe(false);
  });
});

describe("Business-staff home uses normal booking navigation", () => {
  it("offers the normal booking centre without the removed simplified modal", async () => {
    mock.user = { id: account.id, role: "agent", name: account.name, portalStatus: "active", mustChangePassword: false };
    mock.data["businessStaff.mine"] = { managed: true, active: true, owner: { name: "Synthetic Owner" }, membership: member() };
    await render(React.createElement(BusinessStaffWorkspace));
    expect(container.querySelector('a[href="/my-bookings"]')).not.toBeNull();
    expect(mock.hooks.some(hook => hook.path === "businessBookings.list")).toBe(false);
    expect(container.textContent).toContain("normal booking pages");
    expect(container.textContent).toContain("Commission claims remain with the business owner");
  });
  it("does not expose any booking shortcut after revocation", async () => {
    mock.user = { id: account.id, role: "agent", name: account.name, portalStatus: "active", mustChangePassword: false };
    mock.data["businessStaff.mine"] = { managed: true, active: false, owner: null, membership: member({ status: "revoked" }) };
    await render(React.createElement(BusinessStaffWorkspace));
    expect(container.querySelector('a[href="/my-bookings"]')).toBeNull();
    expect(container.textContent).toContain("revoked or inactive");
    expect(mock.hooks.every(hook => hook.path === "businessStaff.mine")).toBe(true);
  });
});

describe("Business-staff familiar Portal shell", () => {
  const resourceHrefs = [
    "/knowledge-base",
    "/webinars",
    "/suppliers",
    "https://fees.thejltgroup.co.uk",
    "https://fees.thejltgroup.co.uk/card-fees",
  ];
  const forbiddenHrefs = [
    "/my-profile",
    "/profile",
    "/pipeline",
    "/staff",
    "/academy/actions",
    "/admin/academy",
    "/pricing-calculator",
    "/commissions",
    "/commission-timeline",
    "/my-margin",
    "/crm/agents",
    "/users",
  ];
  function staffIdentity() {
    mock.user = {
      id: account.id,
      role: "agent",
      name: account.name,
      portalStatus: "active",
      isActive: true,
      mustChangePassword: false,
    };
  }
  function assertRestrictedShell() {
    for (const href of forbiddenHrefs)
      expect(container.querySelector(`a[href="${href}"]`), href).toBeNull();
    expect(
      container.querySelector('input[placeholder="Search bookings..."]')
    ).toBeNull();
    expect(
      container.querySelector('button[aria-label="Notifications"]')
    ).toBeNull();
    expect(container.textContent).not.toContain("Review & Sign");
    expect(container.textContent).not.toContain("Open Orbit");
    // Count every hook, not only enabled queries: ordinary mutation hooks and
    // disabled search/counter/terms hooks must never be instantiated either.
    expect(mock.hooks).toEqual([]);
    expect(mock.mutations).toEqual([]);
    assertOnlyBusinessHooks();
  }
  it.each([false, true])(
    "uses authoritative staff context through direct/wrapper shell (wrapper=%s), not users.role",
    async viaPortal => {
      // Even a broad role must not override authoritative staff classification.
      mock.user = { id: account.id, role: "super_admin", name: account.name };
      await renderStaffShell(authority(), undefined, viaPortal);
      expect(container.querySelectorAll("aside")).toHaveLength(1);
      expect(container.querySelector("aside")?.classList.contains("w-56")).toBe(
        true
      );
      expect(container.querySelector("aside")?.style.background).toBe(
        "var(--sidebar)"
      );
      expect(container.textContent).toContain("JLT Group");
      expect(container.textContent).toContain("Booking Portal");
      expect(container.textContent).toContain(`Working with ${owner.name}`);
      expect(container.textContent).toContain("Staff");
      for (const href of [
        "/business-staff",
        "/my-bookings",
        "/academy",
        "/my-agreements",
        ...resourceHrefs,
      ])
        expect(container.querySelector(`a[href="${href}"]`), href).toBeTruthy();
      for (const href of resourceHrefs.filter(href =>
        href.startsWith("https")
      )) {
        const link = container.querySelector(`a[href="${href}"]`)!;
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      }
      assertRestrictedShell();
    }
  );
  it("opens mobile navigation, closes on links, close button and overlay, and expands a previously collapsed sidebar", async () => {
    staffIdentity();
    await renderStaffShell();
    const sidebar = () => container.querySelector("aside")!;
    const openButton = () =>
      container.querySelector('button[aria-label="Open navigation"]')!;
    expect(sidebar().classList.contains("-translate-x-full")).toBe(true);
    expect(openButton().getAttribute("aria-expanded")).toBe("false");
    await clickLabel("Open navigation");
    expect(sidebar().classList.contains("translate-x-0")).toBe(true);
    expect(openButton().getAttribute("aria-expanded")).toBe("true");
    await act(async () =>
      container
        .querySelector<HTMLAnchorElement>('a[href="/suppliers"]')!
        .click()
    );
    await flush();
    expect(sidebar().classList.contains("-translate-x-full")).toBe(true);
    expect(
      container.querySelector('[aria-label="Close navigation overlay"]')
    ).toBeNull();
    await clickLabel("Open navigation");
    await clickLabel("Close navigation");
    expect(openButton().getAttribute("aria-expanded")).toBe("false");
    await clickLabel("Open navigation");
    await clickLabel("Close navigation overlay");
    expect(openButton().getAttribute("aria-expanded")).toBe("false");
    await clickLabel("Collapse sidebar");
    await clickLabel("Open navigation");
    expect(sidebar().classList.contains("w-56")).toBe(true);
    assertRestrictedShell();
  });
  it("collapses to accessible icons without changing external fee links and restores Explore portal navigation", async () => {
    staffIdentity();
    await renderStaffShell();
    await clickLabel("Collapse sidebar");
    expect(container.querySelector("aside")?.classList.contains("w-14")).toBe(
      true
    );
    expect(
      container
        .querySelector('button[aria-label="Expand sidebar"]')
        ?.getAttribute("aria-expanded")
    ).toBe("false");
    expect(
      container.querySelector('a[aria-label="Supplier Directory"]')
    ).toBeTruthy();
    for (const href of resourceHrefs.filter(href => href.startsWith("https"))) {
      const link = container.querySelector(`a[href="${href}"]`)!;
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("aria-label")).toMatch(/Fees/);
    }
    expect(
      container.querySelector('button[aria-label="Sign out"]')
    ).toBeTruthy();
    expect(
      container.querySelector('a[aria-label="Agreements & Policies"]')
    ).toBeTruthy();
    await click("Explore portal");
    expect(container.querySelector("aside")?.classList.contains("w-56")).toBe(
      true
    );
    expect(container.textContent).toContain("Knowledge Base");
    assertRestrictedShell();
  });
  it("uses shared group preferences scoped to staff and reopens a directly reached resource group", async () => {
    staffIdentity();
    window.localStorage.setItem(
      `jlt-sidebar:${account.id}:agent:learning`,
      "closed"
    );
    await renderStaffShell();
    expect(container.querySelector('a[href="/knowledge-base"]')).toBeTruthy();
    await click("Learning");
    expect(container.querySelector('a[href="/knowledge-base"]')).toBeNull();
    expect(
      window.localStorage.getItem(
        `jlt-sidebar:${account.id}:business-staff:learning`
      )
    ).toBe("closed");
    await act(async () =>
      window.history.pushState(null, "", "/knowledge-base")
    );
    await flush();
    expect(button("Learning").getAttribute("aria-expanded")).toBe("true");
    expect(
      container
        .querySelector('a[href="/knowledge-base"]')
        ?.getAttribute("aria-current")
    ).toBe("page");
    assertRestrictedShell();
  });
  it("removes all resource links when denied without removing own Academy or read-only booking access", async () => {
    staffIdentity();
    await renderStaffShell(
      authority({
        ...DEFAULT_BUSINESS_STAFF_PERMISSIONS,
        resourceAccess: false,
      })
    );
    for (const href of resourceHrefs)
      expect(container.querySelector(`a[href="${href}"]`)).toBeNull();
    expect(container.querySelector('a[href="/academy"]')).toBeTruthy();
    expect(
      container.querySelector('a[href="/my-bookings"]')
    ).toBeTruthy();
    expect(container.textContent).not.toContain("Pricing & Fees");
    assertRestrictedShell();
  });
  it("retains resources for valid legacy four-boolean permissions but rejects malformed grants", async () => {
    staffIdentity();
    const legacy = {
      viewBookings: true,
      viewCustomerAmounts: false,
      addBookingNotes: false,
      academyAccess: true,
    };
    await renderStaffShell(authority(legacy as any));
    for (const href of resourceHrefs)
      expect(container.querySelector(`a[href="${href}"]`)).toBeTruthy();
    await renderStaffShell(authority({ resourceAccess: "true" } as any));
    for (const href of [
      ...resourceHrefs,
      "/academy",
      "/my-bookings",
    ])
      expect(container.querySelector(`a[href="${href}"]`)).toBeNull();
    assertRestrictedShell();
  });
  it.each(["revoked", "ordinary", "no-membership", "unauthenticated"])(
    "never exposes capability navigation for %s authority",
    async state => {
      staffIdentity();
      const current = authority();
      if (state === "revoked") current.active = false;
      if (state === "ordinary") current.managed = false;
      if (state === "no-membership") current.membership = null as any;
      if (state === "unauthenticated") mock.user = null;
      await renderStaffShell(current, undefined, true);
      for (const href of [
        ...resourceHrefs,
        "/academy",
        "/my-bookings",
      ])
        expect(container.querySelector(`a[href="${href}"]`)).toBeNull();
      expect(container.querySelector('a[href="/my-agreements"]')).toBeTruthy();
      expect(container.textContent).not.toContain(`Working with ${owner.name}`);
      assertRestrictedShell();
    }
  );
  it.each([false, true])(
    "never renders double frames for nested PortalLayout resource children (root wrapper=%s)",
    async viaPortal => {
      staffIdentity();
      await renderStaffShell(
        authority(),
        React.createElement(PortalLayout, {
          children: React.createElement(PortalLayout, {
            children: React.createElement(
              "section",
              { "data-test-resource": true },
              "Own Academy resource"
            ),
          }),
        }),
        viaPortal
      );
      expect(container.querySelectorAll("aside")).toHaveLength(1);
      expect(container.querySelectorAll("main")).toHaveLength(1);
      expect(
        container.querySelectorAll("[data-business-staff-portal]")
      ).toHaveLength(1);
      expect(container.querySelectorAll("[data-test-resource]")).toHaveLength(
        1
      );
      assertRestrictedShell();
    }
  );
  it("has a familiar lightweight home with permitted shortcuts but no booking hooks or oversized Orbit warning", async () => {
    staffIdentity();
    await renderStaffWorkspace("/business-staff");
    expect(container.querySelector("h1")?.textContent).toBe(
      "Welcome, Synthetic"
    );
    expect(
      container.querySelector(
        '[aria-label="Portal shortcuts"] a[href="/suppliers"]'
      )
    ).toBeTruthy();
    expect(
      container.querySelector(
        '[aria-label="Portal shortcuts"] a[href="/my-bookings"]'
      )
    ).toBeTruthy();
    expect(container.textContent).toContain("normal booking pages");
    expect(container.textContent).toContain("Continue to use it directly");
    expect(container.textContent).not.toContain("Orbit access is not ready");
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelectorAll("aside")).toHaveLength(1);
    expect(mock.hooks.every(hook => hook.path === "businessStaff.mine")).toBe(
      true
    );
    assertOnlyBusinessHooks();
  });
  it("retains signout failure, blocks duplicate pending signout and allows retry without legacy mutations", async () => {
    staffIdentity();
    mock.logout.mockRejectedValueOnce(new Error("Signout failed"));
    await renderStaffShell();
    await clickLabel("Sign out");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Sign out failed. Please try again."
    );
    let finish!: () => void;
    mock.logout.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    );
    await clickLabel("Sign out");
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Sign out"]'
      )?.disabled
    ).toBe(true);
    await clickLabel("Sign out");
    expect(mock.logout).toHaveBeenCalledTimes(2);
    await act(async () => finish());
    await flush();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Sign out"]'
      )?.disabled
    ).toBe(false);
    assertRestrictedShell();
  });
  it("keeps the ordinary agent shell collapsed and its existing hooks available outside staff context", async () => {
    staffIdentity();
    await render(
      React.createElement(ViewModeProvider, {
        children: React.createElement(PortalLayout, {
          children: React.createElement("p", null, "Ordinary portal"),
        }),
      })
    );
    expect(container.querySelector("aside")?.classList.contains("w-14")).toBe(
      true
    );
    expect(button("Explore portal")).toBeTruthy();
    expect(
      mock.hooks.some(hook => hook.path === "staffAccess.mine" && hook.enabled)
    ).toBe(true);
    expect(
      mock.hooks.some(hook => hook.path === "crm.agentCrm.getMyProfile")
    ).toBe(true);
    expect(
      mock.hooks.some(hook => hook.path === "notifications.unreadCount")
    ).toBe(true);
    expect(
      mock.hooks.some(
        hook => hook.path === "bookings.quickSearch" && hook.enabled === false
      )
    ).toBe(true);
    expect(
      mock.hooks.some(
        hook => hook.path === "terms.sign" && hook.kind === "mutation"
      )
    ).toBe(true);
    expect(mock.mutations).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("allows root to disable the separate instructor capability lookup until ordinary authority is confirmed", async () => {
    staffIdentity();
    mock.data["staffAccess.mine"] = {
      instructor: true,
      engagement: true,
      schemaAvailable: true,
      courseIds: [99],
    };
    function DisabledLookup() {
      const query = useStaffAccess(false);
      return React.createElement(
        "p",
        null,
        `${query.eligible}:${query.access.instructor}:${query.access.engagement}`
      );
    }
    await render(React.createElement(DisabledLookup));
    expect(container.textContent).toBe("false:false:false");
    expect(mock.hooks).toEqual([
      {
        kind: "query",
        path: "staffAccess.mine",
        input: undefined,
        enabled: false,
      },
    ]);
    expect(mock.mutations).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("Owner business-staff channel", () => {
  it("renders text literally, warns staff-visible, and uses only owner notes APIs", async () => {
    const literal =
      '<script>alert(1)</script><img src="https://example.test/private">https://example.test';
    mock.data["businessBookings.ownerNotes"] = page(
      [
        {
          id: 8,
          text: literal,
          authorUserId: 60,
          createdAt: "2026-01-01T12:00:00Z",
        },
      ],
      true
    );
    await render(
      React.createElement(BusinessStaffOwnerNotes, { bookingId: 701 })
    );
    expect(container.textContent).toContain("Staff-visible");
    expect(container.textContent).toContain(literal);
    expect(container.querySelector("script,img,a")).toBeNull();
    await change(field("New business-staff note"), " Owner channel note ");
    await click("Post note");
    expect(mock.mutations).toEqual([
      {
        path: "businessBookings.ownerAddNote",
        input: { bookingId: 701, text: "Owner channel note" },
      },
    ]);
    expect(field("New business-staff note").value).toBe("");
    expect(container.textContent).toContain("Note posted");
    expect(mock.operations).toContain("businessBookings.ownerNotes.refetch");
    expect(
      mock.hooks.every(item =>
        [
          "businessBookings.ownerNotes",
          "businessBookings.ownerAddNote",
        ].includes(item.path)
      )
    ).toBe(true);
    assertOnlyBusinessHooks();
  });
  it("retains a failed owner note and clears drafts on booking change", async () => {
    mock.rejects["businessBookings.ownerAddNote"] = "Owner channel unavailable";
    await render(
      React.createElement(BusinessStaffOwnerNotes, { bookingId: 701 })
    );
    await change(field("New business-staff note"), "Keep owner draft");
    await click("Post note");
    expect(field("New business-staff note").value).toBe("Keep owner draft");
    expect(container.textContent).toContain("Owner channel unavailable");
    await render(
      React.createElement(BusinessStaffOwnerNotes, { bookingId: 702 })
    );
    expect(field("New business-staff note").value).toBe("");
    expect(
      mock.hooks
        .filter(item => item.path === "businessBookings.ownerNotes")
        .at(-1)?.input.bookingId
    ).toBe(702);
  });
  it("withholds stale owner channel data and posting on errors", async () => {
    mock.errors["businessBookings.ownerNotes"] = {
      message: "Not your booking",
    };
    mock.data["businessBookings.ownerNotes"] = page([
      {
        id: 1,
        text: "STALE_OWNER_NOTE",
        authorUserId: 40,
        createdAt: "2026-01-01",
      },
    ]);
    await render(
      React.createElement(BusinessStaffOwnerNotes, { bookingId: 701 })
    );
    expect(container.textContent).not.toContain("STALE_OWNER_NOTE");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("Not your booking");
  });
});

it("rejects non-portal and non-reset setup URLs", () => {
  expect(
    privateSetupUrl("https://evil.example/reset-password?token=secret")
  ).toBeNull();
  expect(privateSetupUrl("javascript:alert(1)")).toBeNull();
  expect(privateSetupUrl("/dashboard?token=secret")).toBeNull();
  expect(privateSetupUrl("/reset-password")).toBeNull();
  expect(privateSetupUrl("/reset-password?token=synthetic")).toContain(
    "/reset-password?token=synthetic"
  );
});
