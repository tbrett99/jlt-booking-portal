// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TermsReviewDraft } from "../shared/terms-review";

const mocks = vi.hoisted(() => ({
  user: { id: 99, role: "admin", mustChangePassword: false } as { id: number; role: string; mustChangePassword: boolean } | null,
  authLoading: false,
  isAgentView: false,
  result: {} as { data?: TermsReviewDraft; isLoading?: boolean; isError?: boolean; isFetching?: boolean },
  queries: [] as { path: string; input: unknown; options: unknown }[],
  mutationHooks: [] as string[],
  mutate: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@/lib/trpc", () => {
  const node = (path = ""): any => new Proxy({}, { get: (_target, key: string) => {
    if (key === "useQuery") return (input: unknown, options: unknown) => {
      mocks.queries.push({ path, input, options });
      if (path === "termsReview.draft") return { ...mocks.result, refetch: mocks.refetch };
      if (path === "crm.agentCrm.getMyProfile") return { data: { profile: {} } };
      if (path === "terms.getSigningTracker") return { data: { activeVersion: null, agents: [], signedCount: 0, totalCount: 0 }, isLoading: false, refetch: mocks.refetch };
      throw new Error(`Unexpected query: ${path}`);
    };
    if (key === "useMutation") return () => {
      mocks.mutationHooks.push(path);
      // These are pre-existing tracker hooks, never draft-review hooks.
      if (!["terms.sendVersion", "terms.deactivateVersion"].includes(path)) throw new Error(`Unexpected mutation hook: ${path}`);
      return { mutate: mocks.mutate, isPending: false };
    };
    return node(path ? `${path}.${key}` : key);
  } });
  return { trpc: node() };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user, loading: mocks.authLoading }) }));
vi.mock("@/contexts/ViewModeContext", () => ({ useViewMode: () => ({ isAgentView: mocks.isAgentView }), ViewModeProvider: ({ children }: any) => children }));
vi.mock("@/components/PortalLayout", async () => {
  const { createElement } = await import("react");
  return { default: ({ children }: any) => createElement("main", { "data-testid": "portal-layout" }, children) };
});
// Keep the real AuthRouter, Wouter matching and lazy review import; do not mount
// unrelated sign-up/payment/login workflows or their side-effecting hooks.
vi.mock("../client/src/pages/LoginPage", async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("p", null, "Login required") };
});
vi.mock("../client/src/pages/OAuthLoginPage", () => ({ default: () => null }));
vi.mock("../client/src/pages/RegisterPage", () => ({ default: () => null }));
vi.mock("../client/src/pages/ChangePasswordPage", () => ({ default: () => null }));
vi.mock("../client/src/pages/ResetPasswordPage", () => ({ default: () => null }));
vi.mock("../client/src/pages/UnsubscribePage", () => ({ default: () => null }));
vi.mock("../client/src/pages/PaymentResult", () => ({ default: () => null }));
vi.mock("../client/src/pages/PaymentRedirect", () => ({ default: () => null }));
vi.mock("../client/src/pages/JoinFlow", () => ({ default: () => null }));
vi.mock("../client/src/pages/JoinAccept", () => ({ default: () => null }));
vi.mock("../client/src/pages/recruitment/ApplyPage", () => ({ default: () => null, ApplyEmbedPage: () => null }));
vi.mock("../client/src/pages/recruitment/ApplicationFormPage", () => ({ default: () => null }));
vi.mock("../client/src/pages/InfoFunnelPage", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import TermsRevisionReview from "../client/src/pages/admin/TermsRevisionReview";
import AdminTermsTracker from "../client/src/pages/admin/AdminTermsTracker";
import { AuthRouter } from "../client/src/App";

function syntheticDraft(): TermsReviewDraft {
  const conduct = Array.from({ length: 12 }, (_, index) => ({ title: `${index + 1}. Conduct section`, content: `<p><strong>${index + 1}.1</strong> Synthetic conduct wording ${index + 1}.</p>` }));
  return {
    id: "2026-11-12-clause-and-appendix-review",
    status: "draft_not_published",
    preparedDate: "2026-11-12",
    publishedBaseline: "May 2026",
    publicationDate: null,
    effectiveDate: null,
    baselineSha256: "a".repeat(64),
    draftSha256: "b".repeat(64),
    terms: Array.from({ length: 49 }, (_, index) => ({ title: `${index + 1}. Synthetic term section`, content: `<p><strong>${index + 1}.1</strong> Synthetic draft wording ${index + 1}.</p><ul><li>Preserve list formatting.</li></ul>` })),
    conduct,
    appendices: Array.from({ length: 12 }, (_, index) => ({ title: `Appendix ${String.fromCharCode(65 + index)}: Synthetic appendix`, content: index === 11 ? conduct.map(section => `<h3>${section.title}</h3>${section.content}`).join("") : `<p>Synthetic appendix ${index + 1} wording.</p>` })),
    changes: [
      { id: "fees", title: "Membership payment changes", summary: "Synthetic change summary supplied by the server.", references: ["6.2", "Appendix A"] },
      { id: "commission", title: "Commission changes", summary: "Another synthetic server summary.", references: ["26.4", "Appendix E"] },
    ],
    approvals: [
      { id: "calculation", title: "Monthly calculation basis", details: "Synthetic approval detail: no formula chosen.", references: ["43.3", "Appendix J"], status: "pending" },
      { id: "pricing", title: "Exceptional pricing controls", details: "Synthetic pricing approval detail.", references: ["43.10"], status: "pending" },
      { id: "legal", title: "Solicitor review", details: "Synthetic liability and departure approval detail.", references: ["11", "16", "21"], status: "pending" },
      { id: "caa", title: "CAA Schedule", details: "Synthetic CAA approval detail: alternative not selected.", references: ["10", "Appendix D"], status: "pending" },
    ],
    unchangedComplianceReferences: ["Section 10", "Clauses 6.8 and 6.9", "Appendix H", "Appendix I", "Code of Conduct 5.2"],
    notice: "Synthetic notice: proposed wording is pending legal and CAA approvals; published terms remain unchanged.",
  };
}

let root: Root;
let container: HTMLDivElement;
const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
function sourceText(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return normalize(template.content.textContent);
}
async function render(Component: React.ComponentType = TermsRevisionReview, path = "/admin/terms-review") {
  const location = memoryLocation({ path, static: true });
  await act(async () => {
    root.render(React.createElement(Router, { hook: location.hook }, React.createElement(React.Suspense, { fallback: "Loading page…" }, React.createElement(Component))));
  });
}
function control(scope: Element, label: string) {
  const result = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(button => normalize(button.textContent) === label);
  expect(result, `button ${label}`).toBeTruthy();
  return result!;
}
function activePanel() {
  const tab = container.querySelector('[role="tab"][aria-selected="true"]')!;
  const panel = document.getElementById(tab.getAttribute("aria-controls")!)!;
  expect(panel.getAttribute("role")).toBe("tabpanel");
  expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
  expect(panel.hidden).toBe(false);
  return panel;
}
async function clickTab(label: string) {
  const tab = control(container, label);
  await act(async () => {
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: false }));
    tab.click();
  });
}
function sectionTriggers(panel: Element) {
  return Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-slot="accordion-trigger"]'));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React); // Project JSX uses the classic runtime in Vitest.
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network permitted in synthetic draft UI tests"); }));
  window.happyDOM.settings.disableJavaScriptFileLoading = true;
  window.happyDOM.settings.disableCSSFileLoading = true;
  window.happyDOM.settings.enableJavaScriptEvaluation = false;
  mocks.user = { id: 99, role: "admin", mustChangePassword: false };
  mocks.authLoading = false;
  mocks.isAgentView = false;
  mocks.result = { data: syntheticDraft(), isLoading: false, isError: false, isFetching: false };
  mocks.queries = [];
  mocks.mutationHooks = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(mocks.mutate).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("read-only terms revision review", () => {
  it("identifies a prepared, unpublished draft separately from publication and effective dates", async () => {
    await render();
    expect(normalize(container.querySelector("h1")?.textContent)).toBe("Terms revision review");
    expect(normalize(container.querySelector("#draft-status-heading")?.textContent)).toBe("Draft — not published");
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-12");
    expect(normalize(container.querySelector("time")?.textContent)).toBe("12 November 2026");
    const metadata = Array.from(container.querySelectorAll("#draft-status-heading ~ dl > div")).map(item => [normalize(item.querySelector("dt")?.textContent), normalize(item.querySelector("dd")?.textContent)]);
    expect(metadata).toEqual([
      ["Draft prepared", "12 November 2026"],
      ["Published baseline", "May 2026"],
      ["Publication date", "Not set — approval required"],
      ["Effective date", "Not set — approval required"],
    ]);
    expect(normalize(container.textContent)).not.toMatch(/last updated|published on|effective on/i);
    expect(normalize(container.textContent)).toContain(mocks.result.data!.notice);
    expect(normalize(container.textContent)).toContain("does not publish terms, change signed agreements or acceptance records, or change billing");
    expect(mocks.queries).toEqual([{ path: "termsReview.draft", input: undefined, options: { refetchOnMount: "always" } }]);
    expect(mocks.mutationHooks).toEqual([]);
    expect(container.querySelector("input, textarea, canvas, form, [contenteditable], iframe, img")).toBeNull();
    expect(Array.from(container.querySelectorAll("button")).some(button => /^(publish|accept|sign|approve|send|activate)\b/i.test(normalize(button.textContent)))).toBe(false);
  });

  it("shows every server approval as Pending and preserves supplied summaries and references", async () => {
    await render();
    expect(normalize(container.textContent)).toContain("All 4 approvals are Pending");
    const approvals = container.querySelectorAll("[data-approval-id]");
    expect(approvals).toHaveLength(4);
    for (const [index, item] of Array.from(approvals).entries()) {
      const approval = mocks.result.data!.approvals[index];
      expect(item.getAttribute("data-approval-id")).toBe(approval.id);
      expect(normalize(item.querySelector("[data-slot=badge]")?.textContent)).toBe("Pending");
      expect(normalize(item.textContent)).toContain(approval.details);
      expect(normalize(item.textContent)).toContain(approval.references.join("; "));
    }
    const changes = container.querySelector<HTMLDetailsElement>("[data-review-changes]")!;
    expect(changes.open).toBe(false);
    expect(normalize(changes.querySelector("summary")?.textContent)).toBe("Proposed changes (2)");
    await act(async () => changes.querySelector("summary")!.click());
    expect(changes.open).toBe(true);
    for (const change of mocks.result.data!.changes) {
      const item = changes.querySelector(`[data-change-id="${change.id}"]`)!;
      expect(normalize(item.textContent)).toContain(change.summary);
      expect(normalize(item.textContent)).toContain(change.references.join("; "));
    }
  });

  it("exposes only the three requested real Radix tabs and renders server content in stable section accordions", async () => {
    await render();
    expect(Array.from(container.querySelectorAll('[role="tab"]')).map(tab => normalize(tab.textContent))).toEqual(["Full Terms & Conditions", "Code of Conduct", "Appendices"]);
    expect(normalize(container.textContent)).toContain("Privacy Policy is unchanged");
    for (const [label, tab] of [["Full Terms & Conditions", "terms"], ["Code of Conduct", "conduct"], ["Appendices", "appendices"]] as const) {
      await clickTab(label);
      const panel = activePanel();
      const sections = mocks.result.data![tab];
      expect(Array.from(panel.querySelectorAll("[data-review-section-title]")).map(title => normalize(title.textContent))).toEqual(sections.map(section => section.title));
      expect(sectionTriggers(panel).every(trigger => trigger.getAttribute("aria-expanded") === "false")).toBe(true);
      await act(async () => control(panel, "Expand all").click());
      for (const [index, trigger] of sectionTriggers(panel).entries()) {
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(panel.querySelector(`#${tab}-${index}`)).toBeTruthy();
        const region = document.getElementById(trigger.getAttribute("aria-controls")!)!;
        expect(normalize(region.querySelector(".prose")?.textContent)).toBe(sourceText(sections[index].content));
      }
      if (tab === "terms") {
        expect(panel.querySelector("#terms-section-6 #terms-5")).toBeTruthy();
        expect(panel.querySelector("#terms-section-10 #terms-9")).toBeTruthy();
        expect(panel.querySelector("#terms-section-26 #terms-25")).toBeTruthy();
      }
      if (tab === "appendices") expect(panel.querySelector("#appendix-l #appendices-11")).toBeTruthy();
      await act(async () => control(panel, "Collapse all").click());
      expect(sectionTriggers(panel).every(trigger => trigger.getAttribute("aria-expanded") === "false")).toBe(true);
      await act(async () => sectionTriggers(panel)[0].click());
      expect(sectionTriggers(panel)[0].getAttribute("aria-expanded")).toBe("true");
    }
    expect(mocks.mutationHooks).toEqual([]);
  });

  it("distinguishes unchanged CAA and related compliance wording in both summary and relevant sections", async () => {
    await render();
    const summary = container.querySelector("#unchanged-compliance-heading")!.parentElement!;
    for (const reference of mocks.result.data!.unchangedComplianceReferences) expect(normalize(summary.textContent)).toContain(reference);
    const panel = activePanel();
    await act(async () => control(panel, "Expand all").click());
    expect(normalize(panel.querySelector("#terms-9 [data-compliance-note]")?.textContent)).toContain("Section 10 has not been replaced");
    expect(normalize(panel.querySelector("#terms-0 [data-compliance-note]")?.textContent)).toContain("clause 1.1 is proposed compliance wording, not approved");
    expect(normalize(panel.querySelector("#terms-0 [data-slot=accordion-trigger]")?.textContent)).toContain("Proposed compliance wording — not approved");
    expect(normalize(panel.querySelector("#terms-9 [data-compliance-note]")?.textContent)).toContain("Agency Term 10A or 10B");
    expect(normalize(panel.querySelector("#terms-5 [data-compliance-note]")?.textContent)).toContain("Clauses 6.8 and 6.9");
    await clickTab("Code of Conduct");
    await act(async () => control(activePanel(), "Expand all").click());
    expect(normalize(activePanel().querySelector("#conduct-4 [data-compliance-note]")?.textContent)).toContain("Code of Conduct 5.2");
    await clickTab("Appendices");
    await act(async () => control(activePanel(), "Expand all").click());
    expect(normalize(activePanel().querySelector("#appendices-3 [data-compliance-note]")?.textContent)).toContain("proposed ATOL Certificate wording, not an approved compliance update");
    expect(normalize(activePanel().querySelector("#appendices-3 [data-slot=accordion-trigger]")?.textContent)).toContain("Proposed compliance wording — not approved");
    for (const index of [7, 8, 11]) expect(activePanel().querySelector(`#appendices-${index} [data-compliance-note]`)).toBeTruthy();
    // Appendix L is rendered verbatim from the API's shared conduct synthesis.
    expect(normalize(activePanel().querySelector("#appendices-11 .prose")?.textContent)).toBe(sourceText(mocks.result.data!.appendices[11].content));
  });

  it("preserves existing Section 15 heading and alias anchors without permitting arbitrary attributes", async () => {
    mocks.result.data!.terms[14].content = '<h2 id="section-15">Synthetic Section 15 heading</h2><p id="151-agent-responsibility-for-chargebacks"><strong>15.1 Synthetic scope</strong> Server-owned draft prose.</p><p id="151a-client-chargebacks"><strong>15.1A Synthetic client chargebacks</strong></p><span id="1512"></span><h3 id="1512-immediate-termination-for-fraudulent-chargebacks">15.12 Synthetic clause</h3><span id="1513"></span><h3 id="1513-survival">15.13 Synthetic survival</h3><a href="#151a-client-chargebacks">Read clause</a><h3 id="invalid anchor" onclick="bad()">Invalid identifier stripped</h3>';
    await render();
    await act(async () => sectionTriggers(activePanel())[14].click());
    const prose = activePanel().querySelector("#terms-14 .prose")!;
    for (const id of ["section-15", "151-agent-responsibility-for-chargebacks", "151a-client-chargebacks", "1512", "1512-immediate-termination-for-fraudulent-chargebacks", "1513", "1513-survival"]) expect(prose.querySelector(`[id="${id}"]`)).toBeTruthy();
    expect(prose.querySelector('a[href="#151a-client-chargebacks"]')).toBeTruthy();
    expect(prose.querySelector('[id="invalid anchor"], [onclick]')).toBeNull();
    expect(mocks.mutationHooks).toEqual([]);
  });

  it("sanitizes executable HTML and remote embeds while retaining draft prose, tables and safe links", async () => {
    mocks.result.data!.terms[0].content = '<p onclick="bad()">Safe <strong>wording</strong>.</p><script>bad()</script><iframe src="https://example.invalid"></iframe><img src="https://example.invalid/track" onerror="bad()"><a href="javascript:bad()">Unsafe link</a><a href="https://hub.thejltgroup.co.uk/bookingterms" onclick="bad()">Booking terms</a><table><tbody><tr><td colspan="2">Table content</td></tr></tbody></table>';
    await render();
    await act(async () => sectionTriggers(activePanel())[0].click());
    const prose = activePanel().querySelector("#terms-0 .prose")!;
    expect(prose.querySelector("script, iframe, img, [onclick], [onerror], [style]")).toBeNull();
    expect(prose.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(prose.querySelector('a[href="https://hub.thejltgroup.co.uk/bookingterms"]')).toBeTruthy();
    expect(prose.querySelector("strong")?.textContent).toBe("wording");
    expect(prose.querySelector("td")?.getAttribute("colspan")).toBe("2");
    expect(normalize(prose.textContent)).toContain("Table content");
  });

  it("refreshes through the same read query and labels navigation to the current published baseline", async () => {
    await render();
    expect(normalize(container.querySelector('a[href="/admin/terms-tracker"]')?.textContent)).toBe("Back to terms tracker");
    expect(normalize(container.querySelector('a[href="/terms"]')?.textContent)).toBe("Published terms — May 2026");
    const bookingTerms = container.querySelector('a[href="https://hub.thejltgroup.co.uk/bookingterms"]')!;
    expect(normalize(bookingTerms.textContent)).toBe("Official booking terms");
    expect(bookingTerms.getAttribute("rel")).toBe("noopener noreferrer");
    expect(bookingTerms.closest(".prose")).toBeNull();
    await act(async () => control(container, "Refresh draft").click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
    mocks.result.isFetching = true;
    await render();
    expect(control(container, "Refreshing…").disabled).toBe(true);
    expect(container.querySelector("[data-terms-review-draft]")).toBeTruthy();
    expect(mocks.mutationHooks).toEqual([]);
  });

  it.each(["loading", "error", "error-with-stale-data", "missing", "invalid-status", "invalid-dates", "no-approvals", "approved-status"])("fails closed for %s without a fallback preview", async state => {
    if (state === "loading") mocks.result = { isLoading: true };
    if (state === "error") mocks.result = { isError: true };
    if (state === "error-with-stale-data") mocks.result.isError = true;
    if (state === "missing") mocks.result = {};
    if (state === "invalid-status") (mocks.result.data as any).status = "published";
    if (state === "invalid-dates") (mocks.result.data as any).publicationDate = "2026-11-12";
    if (state === "no-approvals") mocks.result.data!.approvals = [];
    if (state === "approved-status") (mocks.result.data!.approvals[0] as any).status = "approved";
    await render();
    expect(container.querySelector("[data-terms-review-draft], [role=tab], [data-slot=accordion], .prose")).toBeNull();
    expect(normalize(container.textContent)).not.toContain("Synthetic draft wording");
    expect(container.querySelector(state === "loading" ? '[role="status"]' : '[role="alert"]')).toBeTruthy();
    expect(mocks.mutationHooks).toEqual([]);
  });
});

describe("protected admin draft route and tracker navigation", () => {
  it.each(["admin", "super_admin"])("mounts the real lazy draft page for %s in admin view", async role => {
    mocks.user!.role = role;
    await render(AuthRouter);
    expect(container.querySelector("[data-terms-review-draft]")).toBeTruthy();
    expect(mocks.queries.map(query => query.path)).toEqual(["termsReview.draft"]);
    expect(mocks.mutationHooks).toEqual([]);
  });
  it.each(["unauthenticated", "agent", "admin-agent-view", "super-admin-agent-view", "other-role", "auth-loading"])("never mounts or queries the draft for %s", async state => {
    if (state === "unauthenticated") mocks.user = null;
    if (state === "agent") mocks.user!.role = "agent";
    if (state === "admin-agent-view") mocks.isAgentView = true;
    if (state === "super-admin-agent-view") { mocks.user!.role = "super_admin"; mocks.isAgentView = true; }
    if (state === "other-role") mocks.user!.role = "unrecognised";
    if (state === "auth-loading") mocks.authLoading = true;
    await render(AuthRouter);
    expect(container.querySelector("[data-terms-review-draft]")).toBeNull();
    expect(mocks.queries.some(query => query.path === "termsReview.draft")).toBe(false);
    expect(mocks.mutationHooks).toEqual([]);
    if (state === "unauthenticated") expect(normalize(container.textContent)).toBe("Login required");
  });
  it("adds only a navigation link to the existing tracker without invoking its mutations", async () => {
    await render(AdminTermsTracker, "/admin/terms-tracker");
    const link = container.querySelector('a[href="/admin/terms-review"]')!;
    expect(normalize(link.textContent)).toBe("Terms revision review");
    expect(link.getAttribute("data-slot")).toBe("button");
    expect(mocks.queries.map(query => query.path)).toEqual(["terms.getSigningTracker"]);
    expect(mocks.mutationHooks).toEqual(["terms.sendVersion", "terms.deactivateVersion"]);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
