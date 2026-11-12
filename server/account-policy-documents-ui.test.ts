// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLICY_TABS, policyTabFromSearch, policyTabLink, policyVersionFromSearch } from "../shared/policy-navigation";
import { FULL_TERMS_SECTIONS, CODE_OF_CONDUCT_SECTIONS, APPENDIX_SECTIONS } from "../client/src/pages/policyData";
import { FULL_TERMS_SECTIONS as MAY_TERMS, CODE_OF_CONDUCT_SECTIONS as MAY_CONDUCT, APPENDIX_SECTIONS as MAY_APPENDICES } from "../shared/policyDataMay2026";

const mocks = vi.hoisted(() => ({
  search: "",
  mutate: vi.fn(),
  queries: [] as string[],
  mutationHooks: [] as string[],
  signedCard: vi.fn(),
  user: { id: 99, name: "Account holder", email: "account@example.invalid", phone: "" },
}));
vi.mock("@/lib/trpc", () => {
  const node = (path = ""): any => new Proxy({}, { get: (_target, key: string) => {
    if (key === "useUtils") return () => node();
    if (key === "invalidate") return vi.fn();
    if (key === "useMutation") return () => {
      mocks.mutationHooks.push(path);
      return { mutate: mocks.mutate, mutateAsync: mocks.mutate, isPending: false };
    };
    if (key === "useQuery") return () => {
      mocks.queries.push(path);
      if (path === "crm.agentCrm.getMyProfile") return {
        data: { profile: {}, tags: [], suppliers: [] }, isLoading: false, refetch: vi.fn(),
      };
      if (path === "crm.agentCrm.getMyChangeRequests") return { data: [], refetch: vi.fn() };
      throw new Error(`Unexpected query: ${path}`);
    };
    return node(path ? `${path}.${key}` : key);
  } });
  return { trpc: node() };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user, loading: false, isAuthenticated: true }) }));
vi.mock("wouter", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({ href, children, ...props }: any) => createElement("a", { href, ...props }, children),
    useSearch: () => mocks.search,
    useLocation: () => ["/terms", vi.fn()],
  };
});
vi.mock("@/components/DashboardLayout", async () => {
  const { createElement } = await import("react");
  return { default: ({ children }: any) => createElement("main", null, children) };
});
// Signing-history behavior is covered by my-agreements-ui.test.ts; this stub
// detects any accidental reintroduction of the signing card on profile pages.
vi.mock("@/components/MySignedAgencyTerms", async () => {
  const { createElement } = await import("react");
  return { default: () => {
    mocks.signedCard();
    return createElement("section", { "data-testid": "signed-agency-records" }, "Personal signing history");
  } };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import MyPolicyDocuments from "../client/src/components/MyPolicyDocuments";
import MyProfile from "../client/src/pages/MyProfile";
import ProfilePage from "../client/src/pages/ProfilePage";
import TermsAndPolicies, { PRIVACY_SECTIONS } from "../client/src/pages/TermsAndPolicies";

let root: Root;
let container: HTMLDivElement;
async function render(Component: React.ComponentType = TermsAndPolicies) {
  await act(async () => root.render(React.createElement(Component)));
}
const normalize = (value: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
function sourceText(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return normalize(template.content.textContent);
}
function policyCard() {
  const card = container.querySelector('a[href="/terms?section=conduct"]')?.closest('[data-slot="card"]');
  expect(card).toBeTruthy();
  return card!;
}
function assertPolicyCard(card: Element) {
  expect(normalize(card.querySelector('[data-slot="card-title"]')?.textContent ?? null)).toBe("Current policy documents");
  const links = Array.from(card.querySelectorAll("a"));
  expect(links.map(link => [normalize(link.textContent), link.getAttribute("href")])).toEqual([
    ["Read Full Agent Terms", "/terms?section=terms"],
    ["Read Code of Conduct", "/terms?section=conduct"],
    ["Read Privacy Policy", "/terms?section=privacy"],
    ["Read Policy Appendices", "/terms?section=appendices"],
  ]);
  for (const link of links) {
    expect(normalize(link.textContent)).toMatch(/^Read\s+\S/);
    expect(link.getAttribute("data-slot")).toBe("button");
  }
  const grid = card.querySelector('[data-slot="card-content"] .grid')!;
  expect(grid.classList.contains("sm:grid-cols-2")).toBe(true);
  expect(grid.querySelectorAll("h3")).toHaveLength(4);
  expect(card.querySelector('[data-slot="card-title"]')?.classList.contains("text-base")).toBe(true);
  expect(card.querySelector('[data-slot="badge"], input, textarea, canvas, form, button, img')).toBeNull();
  const paragraphs = Array.from(card.querySelectorAll("p")).map(item => normalize(item.textContent));
  expect(paragraphs).toContain("Read the current published policies. These are separate from your personal signed agency agreement and signing history below.");
  expect(paragraphs).toContain("Opening these documents does not create a new signature or acknowledgement record.");
  expect(normalize(card.textContent)).not.toMatch(/you (?:have )?signed|signed by|signing record held|accepted on|acknowledged on|signature verified/i);
}
function activePanel(tab: typeof POLICY_TABS[number]) {
  const selected = container.querySelector('[role="tab"][aria-selected="true"]')!;
  expect(selected, `selected tab ${tab}`).toBeTruthy();
  expect(selected.getAttribute("data-state")).toBe("active");
  const labels = { terms: "Full Terms & Conditions", conduct: "Code of Conduct", privacy: "Privacy Policy", appendices: "Appendices" };
  expect(normalize(selected.textContent)).toBe(labels[tab]);
  const panel = document.getElementById(selected.getAttribute("aria-controls")!)!;
  expect(panel.getAttribute("role")).toBe("tabpanel");
  expect(panel.getAttribute("aria-labelledby")).toBe(selected.id);
  expect(panel.getAttribute("data-state")).toBe("active");
  expect(panel.hidden).toBe(false);
  expect(container.querySelectorAll('[role="tab"][aria-selected="true"]')).toHaveLength(1);
  return panel;
}
async function clickTab(label: string) {
  const tab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find(item => normalize(item.textContent) === label)!;
  expect(tab).toBeTruthy();
  // Radix activates mouse tabs on primary mousedown, not the synthetic click alone.
  await act(async () => {
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: false }));
    tab.click();
  });
}
async function clickControl(panel: Element, label: string) {
  const button = Array.from(panel.querySelectorAll<HTMLButtonElement>("button")).find(item => normalize(item.textContent) === label)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
function accordionTriggers(panel: Element) {
  return Array.from(panel.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'));
}
function assertSourceSections(panel: Element, sections: readonly { title: string; content: string }[]) {
  const triggers = accordionTriggers(panel);
  expect(triggers.map(trigger => normalize(trigger.textContent))).toEqual(sections.map(section => normalize(section.title)));
  for (const [index, trigger] of triggers.entries()) {
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const region = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    expect(region).toBeTruthy();
    expect(panel.contains(region)).toBe(true);
    expect(region.hidden).toBe(false);
    expect(normalize(region.textContent)).toBe(sourceText(sections[index].content));
    expect(region.querySelector(".prose")).toBeTruthy();
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React); // Project JSX uses the classic runtime in Vitest.
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is forbidden in UI tests"); }));
  window.happyDOM.settings.disableJavaScriptFileLoading = true;
  window.happyDOM.settings.disableCSSFileLoading = true;
  window.happyDOM.settings.enableJavaScriptEvaluation = false;
  mocks.search = "";
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

describe("allowlisted policy navigation helpers", () => {
  it.each(POLICY_TABS)("builds the exact internal link and accepts %s", tab => {
    expect(policyTabLink(tab)).toBe(`/terms?section=${tab}`);
    expect(policyTabFromSearch(`section=${tab}`)).toBe(tab);
    expect(policyTabFromSearch(`?other=ignored&section=${tab}`)).toBe(tab);
  });
  it("decodes a valid section once without permitting arbitrary encoded selections", () => {
    expect(policyTabFromSearch("section=%63onduct")).toBe("conduct");
    expect(policyTabFromSearch("section=pri%76acy")).toBe("privacy");
    for (const value of ["%2563onduct", "%2Fprivacy", "%3Cscript%3E", "%00conduct", "conduct%26section%3Dprivacy", "%E0%A4%A"]) {
      expect(policyTabFromSearch(`section=${value}`)).toBe("terms");
    }
  });
  it.each(["", "?", "other=privacy", "section=", "section=unknown", "section=Privacy", "section=conduct-extra", "section=privacy+", "section=https%3A%2F%2Fevil.invalid", "section=unknown&section=privacy"])("defaults safely for %j", search => {
    expect(policyTabFromSearch(search)).toBe("terms");
  });
  it("does not select arbitrary deterministic random-looking query values", () => {
    for (let index = 0; index < 20; index++) {
      const unknown = `unlisted-${index.toString(36)}-${(index * 7919).toString(36)}`;
      expect(policyTabFromSearch(`section=${encodeURIComponent(unknown)}`)).toBe("terms");
    }
  });
});

describe("read-only account policy documents", () => {
  it("renders all four current policy documents in two columns without acceptance queries, mutations or signing controls", async () => {
    await render(MyPolicyDocuments);
    assertPolicyCard(policyCard());
    expect(mocks.queries).toEqual([]);
    expect(mocks.mutationHooks).toEqual([]);
  });
  it.each([["MyProfile", MyProfile], ["ProfilePage", ProfilePage]] as const)("keeps signing history and policy documents off %s without querying agreement APIs", async (_name, Component) => {
    await render(Component);
    expect(container.querySelector('[data-testid="signed-agency-records"]')).toBeNull();
    expect(mocks.signedCard).not.toHaveBeenCalled();
    expect(container.querySelector('a[href="/my-agreements"], a[href="/terms"], a[href^="/terms?section="]')).toBeNull();
    expect(normalize(container.textContent)).not.toMatch(/Current policy documents|Personal signing history|Signing record held by JLT/);
    expect(mocks.queries.some(path => path.startsWith("myAgreements.") || path.startsWith("terms."))).toBe(false);
  });
});

describe("real Radix policy tabs and accordions", () => {
  it("labels the November terms, code and appendices publication separately from unchanged May privacy", async () => {
    await render();
    expect(normalize(container.querySelector('[data-policy-revision="2026-11-12-agent-terms"]')?.textContent ?? null)).toBe("Full Terms & Conditions, Code of Conduct and Appendices published: 12 November 2026");
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-12");
    expect(normalize(container.textContent)).toContain("Privacy Policy last updated: May 2026");
    expect(normalize(container.textContent)).toContain("Publication does not automatically replace an existing signed or accepted agreement");
    expect(normalize(container.textContent)).not.toMatch(/These documents govern your membership|effective (?:on|from)/i);
    expect(mocks.queries).toEqual([]);
    expect(mocks.mutationHooks).toEqual([]);
  });
  it.each([["terms", MAY_TERMS], ["conduct", MAY_CONDUCT], ["appendices", MAY_APPENDICES], ["privacy", PRIVACY_SECTIONS]] as const)("renders exact May %s content through the pinned historical URL", async (tab, sections) => {
    mocks.search = `version=2026-05&section=${tab}`;
    await render();
    const panel = activePanel(tab);
    if (tab === "appendices") {
      for (const trigger of accordionTriggers(panel)) await act(async () => trigger.click());
    } else {
      await clickControl(panel, "Expand all");
    }
    assertSourceSections(panel, sections);
    expect(normalize(container.querySelector('[data-policy-revision="2026-05"]')?.textContent ?? null)).toContain("Archived Full Terms & Conditions, Code of Conduct and Appendices: May 2026");
    expect(container.querySelector('[data-policy-revision="2026-11-12-agent-terms"]')).toBeNull();
    expect(container.querySelector('a[href="/terms?version=2026-11"]')).toBeTruthy();
    expect(normalize(container.textContent)).toContain("Privacy Policy last updated: May 2026");
    expect(mocks.queries).toEqual([]);
    expect(mocks.mutationHooks).toEqual([]);
  });
  it("uses only allowlisted archive versions and switches same-mounted content on version changes", async () => {
    expect(policyVersionFromSearch("version=2026-05")).toBe("2026-05");
    for (const search of ["", "version=2026-11", "version=unknown", "version=%2F2026-05", "version=2026-05-extra"]) {
      expect(policyVersionFromSearch(search)).toBe("2026-11");
    }
    mocks.search = "version=2026-05&section=terms";
    await render();
    await clickControl(activePanel("terms"), "Expand all");
    assertSourceSections(activePanel("terms"), MAY_TERMS);
    mocks.search = "version=2026-11&section=terms";
    await render();
    assertSourceSections(activePanel("terms"), FULL_TERMS_SECTIONS);
    expect(mocks.queries).toEqual([]);
    expect(mocks.mutationHooks).toEqual([]);
  });
  it("offers an internal return link to Agreements & Policies without accepting anything", async () => {
    await render();
    const link = container.querySelector('a[href="/my-agreements"]');
    expect(link).toBeTruthy();
    expect(normalize(link!.textContent)).toBe("Back to Agreements & Policies");
    expect(mocks.queries).toEqual([]);
    expect(mocks.mutationHooks).toEqual([]);
  });
  it.each(POLICY_TABS)("opens the actual %s panel from its hub deep link", async tab => {
    mocks.search = policyTabLink(tab).split("?")[1];
    await render();
    const panel = activePanel(tab);
    const source = { terms: FULL_TERMS_SECTIONS, conduct: CODE_OF_CONDUCT_SECTIONS, privacy: PRIVACY_SECTIONS, appendices: APPENDIX_SECTIONS }[tab];
    expect(accordionTriggers(panel).map(item => normalize(item.textContent))).toEqual(source.map(item => normalize(item.title)));
  });
  it.each(["", "section=not-a-policy", "section=%2Fprivacy"])("renders full terms when query %j is missing or invalid", async search => {
    mocks.search = search;
    await render();
    const panel = activePanel("terms");
    expect(accordionTriggers(panel).map(item => normalize(item.textContent))).toEqual(FULL_TERMS_SECTIONS.map(item => normalize(item.title)));
  });
  it("switches the controlled tab when the query changes on the same mounted page", async () => {
    mocks.search = "section=conduct";
    await render();
    activePanel("conduct");
    for (const [search, tab] of [["section=privacy", "privacy"], ["section=unknown", "terms"], ["section=conduct", "conduct"], ["", "terms"]] as const) {
      mocks.search = search;
      await render();
      activePanel(tab);
    }
  });
  it("still lets users switch every tab after a deep link without resetting on an unchanged query", async () => {
    mocks.search = "section=conduct";
    await render();
    for (const [label, tab] of [["Privacy Policy", "privacy"], ["Appendices", "appendices"], ["Full Terms & Conditions", "terms"], ["Code of Conduct", "conduct"]] as const) {
      await clickTab(label);
      activePanel(tab);
      await render();
      activePanel(tab);
    }
  });
  it.each([["terms", FULL_TERMS_SECTIONS], ["conduct", CODE_OF_CONDUCT_SECTIONS], ["privacy", PRIVACY_SECTIONS]] as const)("keeps %s Expand all / Collapse all and renders the current source in each proper section", async (tab, sections) => {
    mocks.search = `section=${tab}`;
    await render();
    const panel = activePanel(tab);
    expect(accordionTriggers(panel).every(trigger => trigger.getAttribute("aria-expanded") === "false")).toBe(true);
    await clickControl(panel, "Expand all");
    // Compare against live source rather than freezing wording or section counts.
    assertSourceSections(panel, sections);
    await clickControl(panel, "Collapse all");
    expect(accordionTriggers(panel).every(trigger => trigger.getAttribute("aria-expanded") === "false")).toBe(true);
    for (const trigger of accordionTriggers(panel)) {
      const region = document.getElementById(trigger.getAttribute("aria-controls")!);
      expect(!region || region.hidden || normalize(region.textContent) === "").toBe(true);
    }
    await act(async () => accordionTriggers(panel)[0].click());
    expect(accordionTriggers(panel)[0].getAttribute("aria-expanded")).toBe("true");
    const firstRegion = document.getElementById(accordionTriggers(panel)[0].getAttribute("aria-controls")!)!;
    expect(normalize(firstRegion.textContent)).toBe(sourceText(sections[0].content));
  });
  it("preserves readable appendices with their real individual accordion controls", async () => {
    mocks.search = "section=appendices";
    await render();
    const panel = activePanel("appendices");
    for (const trigger of accordionTriggers(panel)) await act(async () => trigger.click());
    assertSourceSections(panel, APPENDIX_SECTIONS);
  });
});
