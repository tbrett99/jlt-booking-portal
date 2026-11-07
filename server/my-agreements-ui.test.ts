// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MyAgreementDetail, MyAgreementSummary } from "../shared/my-agreements";

const mocks = vi.hoisted(() => ({
  mine: { data: undefined, isLoading: false, isError: false } as any,
  detail: null as any,
  records: {} as Record<string, unknown>,
  queries: [] as { path: string; input: unknown }[],
  mutationHooks: [] as string[],
  mutate: vi.fn(), refetchMine: vi.fn(), refetchDetail: vi.fn(), print: vi.fn(), toastError: vi.fn(),
  user: { id: 99, name: "Account holder", email: "private-account@example.invalid", phone: "PRIVATE_PHONE" },
}));
vi.mock("@/lib/trpc", () => {
  const node = (path = ""): any => new Proxy({}, { get: (_target, key: string) => {
    if (key === "useUtils") return () => node();
    if (key === "invalidate") return vi.fn();
    if (key === "useMutation") return () => {
      mocks.mutationHooks.push(path);
      return { mutate: mocks.mutate, mutateAsync: mocks.mutate, isPending: false };
    };
    if (key === "useQuery") return (input: any) => {
      mocks.queries.push({ path, input });
      if (path === "myAgreements.mine") return { ...mocks.mine, refetch: mocks.refetchMine };
      if (path === "myAgreements.detail") return {
        data: mocks.records[`${input.source}:${input.id}`], isLoading: false, isError: false,
        ...mocks.detail, refetch: mocks.refetchDetail,
      };
      if (path === "crm.agentCrm.getMyProfile") return {
        data: { profile: { personalEmail: "PRIVATE_CRM_EMAIL", bankAccountName: "PRIVATE_BANK_HOLDER", bankAccountNumber: "87654321", bankSortCode: "12-34-56" }, tags: [], suppliers: [] },
        isLoading: false, refetch: vi.fn(),
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
  return { Link: ({ href, children, ...props }: any) => createElement("a", { href, ...props }, children), useLocation: () => ["/my-agreements", vi.fn()], useRoute: () => [false, null] };
});
vi.mock("@/components/DashboardLayout", async () => {
  const { createElement } = await import("react");
  return { default: ({ children }: any) => createElement("main", null, children) };
});
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));
vi.mock("@/lib/print-my-agreement", () => ({ printMyAgreement: mocks.print }));

import MySignedAgencyTerms from "../client/src/components/MySignedAgencyTerms";
import MyAgreements from "../client/src/pages/MyAgreements";
import MyProfile from "../client/src/pages/MyProfile";
import ProfilePage from "../client/src/pages/ProfilePage";

const signedAt = "2026-07-03T14:25:00.000Z";
const localDate = () => new Date(signedAt).toLocaleString("en-GB", {
  day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
});
// This is already-sanitized server output, not a client-side sanitizer fixture.
const savedHtml = "<h4>Saved agency provision</h4><p>Recorded signing content only.</p>";
const signature = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
function record(source: MyAgreementSummary["source"] = "join", overrides: Partial<MyAgreementDetail> = {}): MyAgreementDetail {
  return {
    source, id: 7, reference: `${source}:7`, title: `${source} agency agreement`, signerName: "Recorded signer",
    signedAt, versionLabel: "Signing version A", snapshotAvailable: true, snapshotKind: "text_snapshot",
    signatureAvailable: true, versionDocumentAvailable: false, historicalAccount: false,
    signerAddress: "Saved signing address", signatureImage: signature, snapshotHtml: savedHtml,
    consentConfirmed: true, signingIpRecorded: true, signingDeviceRecorded: true, storedHash: "a".repeat(64),
    versionDocumentUrl: null, ...overrides,
  };
}
function supply(...records: MyAgreementDetail[]) {
  mocks.mine.data = records;
  mocks.records = Object.fromEntries(records.map(item => [`${item.source}:${item.id}`, item]));
}
let root: Root;
let container: HTMLDivElement;
async function render(Component: React.ComponentType = MyAgreements) {
  await act(async () => root.render(React.createElement(Component)));
}
const text = () => container.textContent ?? "";
const normalize = (value: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
function assertAgreementsHub() {
  expect(Array.from(container.querySelectorAll("h1")).map(heading => normalize(heading.textContent))).toEqual(["Agreements & Policies"]);
  const back = container.querySelector('a[href="/dashboard"]');
  expect(back).toBeTruthy();
  expect(normalize(back!.textContent)).toMatch(/^Back/);
  expect(container.querySelector('a[href="/my-profile"]')).toBeNull();
  const card = container.querySelector('a[href="/terms?section=terms"]')?.closest('[data-slot="card"]');
  expect(card).toBeTruthy();
  expect(normalize(card!.querySelector('[data-slot="card-title"]')?.textContent ?? null)).toBe("Current policy documents");
  const links = Array.from(card!.querySelectorAll("a"));
  expect(links.map(link => link.getAttribute("href"))).toEqual([
    "/terms?section=terms", "/terms?section=conduct", "/terms?section=privacy", "/terms?section=appendices",
  ]);
  for (const link of links) {
    expect(normalize(link.textContent)).toMatch(/^Read\s+\S/);
    expect(link.getAttribute("data-slot")).toBe("button");
  }
  expect(card!.querySelector('[data-slot="card-content"] .grid')?.classList.contains("sm:grid-cols-2")).toBe(true);
  expect(card!.querySelectorAll("h3")).toHaveLength(4);
  expect(card!.querySelector('input, textarea, canvas, form, img, [data-slot="badge"]')).toBeNull();
  expect(normalize(card!.textContent)).not.toMatch(/you (?:have )?signed|signed by|accepted on|acknowledged on|signature verified/i);
  const signedHeading = Array.from(container.querySelectorAll("h2")).find(heading => normalize(heading.textContent) === "Your signed agency agreement");
  expect(signedHeading).toBeTruthy();
  expect(card!.compareDocumentPosition(signedHeading!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.querySelector('article a[href^="/terms?section="]')).toBeNull();
  expect(mocks.mutationHooks).toEqual([]);
  return card!;
}
function button(label: RegExp) {
  const found = Array.from(container.querySelectorAll("button")).find(item => label.test(item.textContent ?? ""));
  expect(found, `button ${label}`).toBeTruthy();
  return found!;
}
async function click(label: RegExp) { await act(async () => button(label).click()); }
function noRecordOrPrint() {
  expect(container.querySelector("article")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(text()).not.toContain("Recorded signer");
  expect(text()).not.toContain("Saved agency provision");
  expect(text()).not.toMatch(/Print record|Save PDF/);
  expect(mocks.print).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React); // Project JSX uses the classic runtime in Vitest.
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is forbidden in UI tests"); }));
  window.happyDOM.settings.disableJavaScriptFileLoading = true;
  window.happyDOM.settings.disableCSSFileLoading = true;
  window.happyDOM.settings.enableJavaScriptEvaluation = false;
  mocks.mine = { data: undefined, isLoading: false, isError: false };
  mocks.detail = null; mocks.records = {}; mocks.queries = []; mocks.mutationHooks = [];
  mocks.refetchMine.mockResolvedValue({ data: undefined, isError: true });
  mocks.refetchDetail.mockResolvedValue({ data: undefined, isError: true });
  mocks.print.mockResolvedValue(undefined);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  expect(mocks.mutate).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("compact signed-agency-terms account card", () => {
  it("shows the recorded name, record count, local timestamp and distinct personal/general links", async () => {
    supply(record(), record("legacy", { id: 8 }));
    await render(MySignedAgencyTerms);
    expect(text()).toContain("2 records");
    expect(text()).toContain("Recorded signer");
    expect(text()).toContain(localDate());
    expect(text()).toContain("Signing record held by JLT");
    expect(container.querySelector('a[href="/my-agreements"]')?.textContent).toMatch(/agreement records/i);
    expect(container.querySelector('a[href="/terms"]')?.textContent).toMatch(/not your personal signing record/i);
    expect(container.querySelector("article, img, select, input, textarea")).toBeNull();
    expect(mocks.queries).toEqual([{ path: "myAgreements.mine", input: undefined }]);
  });

  it.each([["MyProfile", MyProfile], ["ProfilePage", ProfilePage]] as const)("does not render agreement or policy cards or query agreement APIs inside %s", async (_name, Component) => {
    supply(record()); await render(Component);
    expect(container.querySelector('a[href="/my-agreements"], a[href="/terms"], a[href^="/terms?section="]')).toBeNull();
    expect(text()).not.toContain("Current policy documents");
    expect(text()).not.toContain("Signing record held by JLT");
    expect(text()).not.toContain("Recorded signer");
    expect(text()).not.toContain(localDate());
    expect(container.querySelector("article")).toBeNull();
    expect(mocks.queries.some(query => query.path.startsWith("myAgreements.") || query.path.startsWith("terms."))).toBe(false);
  });
});

describe("Agreements & Policies hub", () => {
  it("always offers all four current policy documents with no linked records or fake signing", async () => {
    supply(); await render();
    const card = assertAgreementsHub();
    expect(normalize(card.textContent)).toContain("Opening these documents does not create a new signature or acknowledgement record.");
    expect(text()).toMatch(/No signed record linked to this account/i);
    expect(text()).toMatch(/does not mean no agreement exists/i);
    expect(text()).not.toMatch(/never signed|no legally binding agreement|you have accepted|you have signed/i);
    expect(mocks.queries).toEqual([{ path: "myAgreements.mine", input: undefined }]);
    expect(container.querySelector('input, textarea, canvas, form, select, [contenteditable="true"]')).toBeNull();
    noRecordOrPrint();
  });
});

describe("loading, stale errors and absence do not rewrite signing history", () => {
  it.each([["card", MySignedAgencyTerms], ["page", MyAgreements]] as const)("shows loading in the %s without exposing stale data", async (_name, Component) => {
    supply(record()); mocks.mine.isLoading = true; await render(Component);
    if (Component === MyAgreements) assertAgreementsHub();
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/Loading your agreement records/);
    noRecordOrPrint();
  });
  it.each([["card", MySignedAgencyTerms], ["page", MyAgreements]] as const)("hides stale valid mine data on a %s error and retries safely", async (_name, Component) => {
    supply(record()); mocks.mine.isError = true; await render(Component);
    if (Component === MyAgreements) assertAgreementsHub();
    expect(text()).toMatch(/does not mean there is no signed record/i); noRecordOrPrint();
    expect(container.querySelector('a[href="/my-agreements"]')).toBeNull();
    await click(/Retry agreement records/);
    if (Component === MyAgreements) assertAgreementsHub();
    expect(mocks.refetchMine).toHaveBeenCalledOnce(); noRecordOrPrint();
    expect(mocks.queries.some(query => query.path === "myAgreements.detail")).toBe(false);
  });
  it.each([["card", MySignedAgencyTerms], ["page", MyAgreements]] as const)("explains an empty linked record set in the %s without claiming never signed", async (_name, Component) => {
    supply(); await render(Component);
    if (Component === MyAgreements) assertAgreementsHub();
    expect(text()).toMatch(/signed outside the Portal/i);
    expect(text()).toMatch(/does not mean no agreement exists/i);
    expect(text()).not.toMatch(/never signed|no legally binding agreement/i);
    expect(container.querySelector('a[href="mailto:support@thejltgroup.co.uk"]')).toBeTruthy();
    noRecordOrPrint();
  });
});

describe("read-only personal agreement list and authorized detail", () => {
  it("selects all signed families, requests only source/id, and offers no signing mutation or editor", async () => {
    const records = (["join", "prospect", "legacy", "terms"] as const).map(source => record(source));
    supply(...records); await render();
    assertAgreementsHub();
    const select = container.querySelector("select")!;
    expect(Array.from(select.options).map(option => option.value)).toEqual(records.map(item => `${item.source}:${item.id}`));
    for (const item of records) {
      await act(async () => { select.value = `${item.source}:${item.id}`; select.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(container.querySelector("article h2")?.textContent).toBe(item.title);
      expect(mocks.queries.filter(query => query.path === "myAgreements.detail").at(-1)?.input).toEqual({ source: item.source, id: item.id });
    }
    expect(mocks.queries.every(query => ["myAgreements.mine", "myAgreements.detail"].includes(query.path))).toBe(true);
    expect(mocks.mutationHooks).toEqual([]);
    expect(container.querySelector('input, textarea, canvas, form, [contenteditable="true"]')).toBeNull();
    expect(text()).toMatch(/does not sign or accept any new terms/i);
  });

  it("renders only simple, already-sanitized server signing HTML and the stored signature", async () => {
    supply(record()); await render();
    const article = container.querySelector("article")!;
    expect(article.textContent).not.toMatch(/PRIVATE_|87654321|12-34-56|private-account|Current policy documents/);
    expect(article.querySelector("h4")?.textContent).toBe("Saved agency provision");
    expect(article.querySelector("script, iframe, object, embed, [onclick], [onerror]")).toBeNull();
    const image = article.querySelector("img")!;
    expect(image.getAttribute("src")).toBe(signature);
    expect(image.alt).toBe("Recorded signature of Recorded signer");
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(article.querySelector("time")?.getAttribute("datetime")).toBe(signedAt);
    expect(text()).toContain(localDate());
    expect(text()).toContain("Saved signing content");
  });

  it("does not substitute current policy for missing content and labels a linked version as not frozen", async () => {
    supply(record("legacy", { snapshotHtml: null, snapshotAvailable: false, snapshotKind: null, signatureImage: null,
      signatureAvailable: false, versionDocumentAvailable: true, versionDocumentUrl: "https://documents.example.invalid/version-A.pdf" }));
    await render();
    expect(text()).toMatch(/snapshot not available/i);
    expect(text()).toMatch(/today.s terms are not substituted/i);
    expect(container.querySelector("article")?.textContent).toMatch(/Saved signing content/i);
    const link = container.querySelector('article a[href="https://documents.example.invalid/version-A.pdf"]')!;
    expect(link.textContent).toMatch(/document linked to this version/i);
    expect(text()).toMatch(/not a separately captured signing-time snapshot/i);
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(container.querySelector("article")?.textContent).not.toContain("Saved agency provision");
    expect(mocks.queries.map(query => query.path)).not.toContain("terms.latest");
  });

  it("labels a document_reference as saved reference content rather than claiming a full terms snapshot", async () => {
    supply(record("terms", { snapshotKind: "document_reference", snapshotHtml: "<p>Recorded reference: version A document.</p>" }));
    await render();
    expect(text()).toContain("Saved signing content");
    expect(text()).toMatch(/document reference/i);
    expect(text()).toMatch(/rather than the full agreement text/i);
    expect(text()).toMatch(/does not verify that the linked file is unchanged since signing/i);
    expect(text()).not.toMatch(/the saved text snapshot from this signing record/i);
    expect(text()).toContain("Recorded reference: version A document.");
  });

  it("reports unknown versions, missing evidence and hashes honestly, without legal or verification claims", async () => {
    supply(record("legacy", { versionLabel: null, signatureImage: null, signatureAvailable: false,
      consentConfirmed: null, signingIpRecorded: false, signingDeviceRecorded: false, storedHash: null, historicalAccount: true }));
    await render();
    expect(text()).toContain("Not recorded — see record reference");
    expect(text()).toContain("Not recorded as confirmed in this record");
    expect(text()).toContain("No stored integrity hash is available");
    expect(text()).toMatch(/displayable signature image is not available/i);
    expect(text()).toMatch(/preserved.*duplicate agent accounts were merged/i);
    expect(text()).not.toMatch(/legally binding|admissib|verified hash|hash verified|integrity verified/i);
  });

  it("shows a stored hash only as an unverified reference and falls back when the signature cannot load", async () => {
    supply(record()); await render();
    expect(text()).toContain("a".repeat(64));
    expect(text()).toMatch(/not re-verified by this view/i);
    expect(text()).not.toMatch(/legally binding|admissib|verified hash|hash verified/i);
    await act(async () => container.querySelector("article img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector("article img")).toBeNull();
    expect(text()).toMatch(/signature image could not be loaded/i);
    expect(text()).toMatch(/signing record remains available/i);
    expect(text()).toContain("Saved agency provision");
  });

  it("keeps current policy documents visible during detail loading without exposing matching stale detail or printing", async () => {
    supply(record()); mocks.detail = { data: record(), isLoading: true }; await render();
    assertAgreementsHub();
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/Loading your signing record/);
    noRecordOrPrint();
    expect(mocks.queries.filter(query => query.path === "myAgreements.detail").at(-1)?.input).toEqual({ source: "join", id: 7 });
  });

  it.each([
    ["different source", { data: record("terms") }],
    ["different id", { data: record("join", { id: 800 }) }],
    ["refetch error with matching stale data", { data: record(), isError: true }],
    ["missing detail", { data: undefined }],
  ])("denies %s detail, offers retry and cannot print", async (_name, detail) => {
    supply(record()); mocks.detail = detail; await render(); noRecordOrPrint();
    assertAgreementsHub();
    expect(text()).toMatch(/record could not be loaded/i);
    expect(text()).toMatch(/No signing data has been changed/i);
    await click(/Retry signing record/);
    assertAgreementsHub();
    expect(mocks.refetchDetail).toHaveBeenCalledOnce(); noRecordOrPrint();
  });

  it("passes only the authorized article to print, excluding account and bank surroundings", async () => {
    const outside = document.createElement("aside");
    outside.textContent = "PRIVATE_BANK_HOLDER 87654321 12-34-56 private-account@example.invalid PRIVATE_PHONE";
    container.appendChild(outside);
    supply(record()); await render();
    // Deliberately place sensitive Portal content beside the selected record.
    container.appendChild(outside);
    await click(/Print record \/ Save PDF/);
    expect(mocks.print).toHaveBeenCalledOnce();
    const printed = mocks.print.mock.calls[0][0] as HTMLElement;
    expect(printed).toBe(container.querySelector("article"));
    expect(printed.textContent).toContain("Saved agency provision");
    expect(printed.textContent).not.toMatch(/PRIVATE_|87654321|12-34-56|private-account/);
    expect(printed.textContent).not.toContain("Current policy documents");
    expect(printed.textContent).not.toContain("Your signed agency agreement");
    expect(printed.querySelector('a[href^="/terms?section="]')).toBeNull();
    expect(printed.querySelector("button, select, input")).toBeNull();
  });

  it("disables duplicate prints while pending and reports print failure without mutating the record", async () => {
    let reject!: (reason: Error) => void;
    mocks.print.mockImplementation(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    supply(record()); await render(); await click(/Print record \/ Save PDF/);
    expect(button(/Preparing print/).disabled).toBe(true);
    await act(async () => button(/Preparing print/).click());
    expect(mocks.print).toHaveBeenCalledOnce();
    await act(async () => reject(new Error("Printing could not be opened.")));
    expect(mocks.toastError).toHaveBeenCalledWith("Printing could not be opened.");
    expect(button(/Print record \/ Save PDF/).disabled).toBe(false);
    expect(container.querySelector("article")?.textContent).toContain("Saved agency provision");
  });
});
