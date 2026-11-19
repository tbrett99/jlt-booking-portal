// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyHandbookContent } from "../shared/staff-handbook";

const mocks = vi.hoisted(() => ({
  user: {
    id: 99,
    role: "admin",
    isActive: true,
    portalStatus: "active",
    mustChangePassword: false,
  } as any,
  loading: false,
  results: {} as Record<string, any>,
  queries: [] as { path: string; input: any; options: any }[],
  mutationHooks: [] as string[],
  mutate: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  editors: [] as any[],
  pending: false,
  mutationErrors: {} as Record<string, unknown>,
  authError: null as unknown,
}));
vi.mock("@/lib/trpc", () => {
  const node = (path = ""): any =>
    new Proxy(
      {},
      {
        get: (_target, key: string) => {
          if (key === "useUtils") return () => node();
          if (key === "useQuery")
            return (input: any, options: any) => {
              mocks.queries.push({ path, input, options });
              if (!path.startsWith("staffHandbook."))
                throw new Error(`Forbidden query ${path}`);
              return {
                isError: false,
                isLoading: false,
                isFetching: false,
                refetch: mocks.refetch,
                ...mocks.results[path],
              };
            };
          if (key === "useMutation")
            return () => {
              mocks.mutationHooks.push(path);
              if (!path.startsWith("staffHandbook."))
                throw new Error(`Forbidden mutation ${path}`);
              return {
                isPending: mocks.pending,
                error: mocks.mutationErrors[path],
                mutateAsync: (input: any) => mocks.mutate(path, input),
              };
            };
          if (key === "invalidate")
            return (...args: any[]) => mocks.invalidate(path, ...args);
          return node(path ? `${path}.${key}` : key);
        },
      }
    );
  return { trpc: node() };
});
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mocks.user,
    loading: mocks.loading,
    error: mocks.authError,
  }),
}));
vi.mock("@/components/RichEmailEditor", async () => {
  const { createElement } = await import("react");
  return {
    RichEmailEditor: (props: any) => {
      mocks.editors.push(props);
      return createElement("textarea", {
        "aria-label": props.ariaLabel,
        disabled: props.disabled,
        value: props.value,
        onChange: (e: any) => props.onChange(e.target.value),
      });
    },
  };
});
import StaffHandbook from "../client/src/pages/admin/StaffHandbook";
import { ArticlePanel } from "../client/src/pages/admin/StaffHandbookArticle";
import { RequestPanel } from "../client/src/pages/admin/StaffHandbookRequests";
import {
  GuideReading,
  safeInternalHandbookHref,
} from "../client/src/pages/admin/StaffHandbookComponents";

let root: Root;
let container: HTMLDivElement;
let cache: QueryClient;
let location: ReturnType<typeof memoryLocation>;
const content = (extra: any = {}) => ({
  ...emptyHandbookContent(99),
  title: "Synthetic refunds process",
  summary: "Synthetic guidance",
  format: "article",
  contentHtml: "<p>Saved draft body</p>",
  ...extra,
});
function article(extra: any = {}) {
  const draft = {
    id: 12,
    articleId: 7,
    revisionNumber: 2,
    content: content(),
    resourceIds: [4],
    contributorIds: [99],
    createdById: 99,
    changeSummary: "Draft change",
    createdAt: new Date("2026-11-01"),
  };
  const published = {
    ...draft,
    id: 11,
    revisionNumber: 1,
    content: content({ contentHtml: "<p>Published baseline body</p>" }),
    changeSummary: "Published baseline",
  };
  return {
    article: {
      id: 7,
      version: 3,
      draftRevisionId: 12,
      publishedRevisionId: 11,
      reviewedRevisionId: null,
      reviewedById: null,
      submittedAt: null,
      archivedAt: null,
      createdById: 99,
      updatedAt: new Date("2026-11-01"),
      requiresIndependentReview: [
        extra.draft?.content?.sensitivity,
        extra.published?.content?.sensitivity,
      ].some(value => ["financial", "legal", "policy"].includes(value)),
      ...extra.article,
    },
    draft: { ...draft, ...extra.draft },
    published:
      extra.published === null ? null : { ...published, ...extra.published },
    revisions: [draft, published],
    resources: [
      {
        id: 4,
        fileName: "private.png",
        mimeType: "image/png",
        byteSize: 1024,
        url: "/api/staff-handbook/resource/4",
        available: true,
      },
    ],
    audit: [
      {
        id: 1,
        action: "saved",
        actorId: 99,
        summary: "Synthetic audit",
        createdAt: new Date("2026-11-01"),
      },
    ],
    ...Object.fromEntries(
      Object.entries(extra).filter(
        ([key]) => !["article", "draft", "published"].includes(key)
      )
    ),
  };
}
function request(extra: any = {}) {
  return {
    request: {
      id: 8,
      version: 2,
      title: "Synthetic knowledge gap",
      description: "Missing staff process",
      category: "General",
      kind: "missing_process",
      checkedGuidance: "Handbook searched",
      impact: "Service delayed",
      priority: "normal",
      status: "new",
      reporterId: 99,
      assigneeId: null,
      articleId: null,
      duplicateOfId: null,
      closureReason: null,
      resolvedRevisionId: null,
      createdAt: new Date("2026-11-01"),
      updatedAt: new Date("2026-11-01"),
      ...extra,
    },
    comments: [],
    audit: [],
  };
}
async function render(
  path = "/admin/staff-handbook?tab=handbook",
  element = React.createElement(StaffHandbook)
) {
  location = memoryLocation({ path, record: true });
  await act(async () => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: cache },
        React.createElement(
          Router,
          { hook: location.hook, searchHook: location.searchHook },
          element
        )
      )
    );
  });
}
async function rerender(element = React.createElement(StaffHandbook)) {
  await act(async () => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: cache },
        React.createElement(
          Router,
          { hook: location.hook, searchHook: location.searchHook },
          element
        )
      )
    );
  });
}
function button(label: string) {
  const result = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button")
  ).find(b => b.textContent?.replace(/\s+/g, " ").trim() === label);
  expect(result, `button ${label}`).toBeTruthy();
  return result!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
function field(
  label: string
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const l = Array.from(container.querySelectorAll("label")).find(
    l => l.textContent?.trim() === label
  );
  expect(l, `field ${label}`).toBeTruthy();
  return document.getElementById(l!.htmlFor)! as any;
}
async function input(label: string, value: string) {
  const el = field(label);
  await act(async () => {
    const prototype =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : el.tagName === "SELECT"
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })
    );
  });
}
async function submitContaining(label: string) {
  const form = field(label).closest("form")!;
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
}
const articleElement = () =>
  React.createElement(ArticlePanel, {
    id: 7,
    userId: 99,
    categories: ["General"],
    staff: [{ id: 99, name: "Synthetic staff" }],
    onSaved: vi.fn(),
    onClose: vi.fn(),
  });
const requestElement = (onGuide = vi.fn()) =>
  React.createElement(RequestPanel, {
    id: 8,
    categories: ["General"],
    staff: [{ id: 99, name: "Synthetic staff" }],
    onGuide,
    onClose: vi.fn(),
    onReload: vi.fn(),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No network permitted");
    })
  );
  window.happyDOM.settings.disableJavaScriptFileLoading = true;
  window.happyDOM.settings.disableCSSFileLoading = true;
  window.happyDOM.settings.enableJavaScriptEvaluation = false;
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mocks.user = {
    id: 99,
    role: "admin",
    isActive: true,
    portalStatus: "active",
    mustChangePassword: false,
  };
  mocks.loading = false;
  mocks.pending = false;
  mocks.authError = null;
  mocks.mutationErrors = {};
  mocks.queries = [];
  mocks.editors = [];
  mocks.mutationHooks = [];
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.mutate.mockResolvedValue({ id: 7, version: 4 });
  mocks.results = {
    "staffHandbook.overview": {
      data: {
        metrics: {
          newRequests: 1,
          unassignedRequests: 1,
          awaitingReview: 1,
          overdueGuides: 0,
          openRequests: 1,
          publishedGuides: 1,
        },
        categories: ["General"],
        staff: [{ id: 99, name: "Synthetic staff" }],
        byAssignee: [{ id: null, name: "Unassigned", count: 1 }],
        byCategory: [{ category: "General", count: 1 }],
      },
    },
    "staffHandbook.browse": {
      data: {
        items: [
          {
            id: 7,
            version: 3,
            title: "Synthetic refunds process",
            summary: "Guide summary",
            category: "General",
            tags: [],
            sensitivity: "operational",
            format: "article",
            isPinned: false,
            state: "published",
            nextReviewAt: null,
            updatedAt: new Date("2026-11-01"),
          },
        ],
        total: 31,
        page: 1,
        pageSize: 20,
      },
    },
    "staffHandbook.requests": {
      data: { items: [request().request], total: 1, page: 1, pageSize: 20 },
    },
    "staffHandbook.article": { data: article() },
    "staffHandbook.request": { data: request() },
  };
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  cache.clear();
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("internal handbook rendered UI", () => {
  it("renders compact real results, explicit search and server pagination", async () => {
    await render();
    expect(container.querySelector("h1")?.textContent).toBe("Staff Handbook");
    expect(
      container.querySelector('[aria-label="Guide results"]')?.textContent
    ).toContain("Synthetic refunds process");
    await input("Search guidance", "refund");
    await submitContaining("Search guidance");
    expect(
      mocks.queries.filter(q => q.path === "staffHandbook.browse").at(-1)?.input
    ).toMatchObject({ search: "refund", view: "published", page: 1 });
    await click("Next");
    expect(
      mocks.queries.filter(q => q.path === "staffHandbook.browse").at(-1)?.input
        .page
    ).toBe(2);
    await input("Filter category", "General");
    expect(
      mocks.queries.filter(q => q.path === "staffHandbook.browse").at(-1)?.input
        .page
    ).toBe(1);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("clickable metrics open explicit request filters and workload counts", async () => {
    await render();
    const metric = Array.from(container.querySelectorAll("button")).find(b =>
      b.textContent?.includes("New requests")
    )!;
    await act(async () => metric.click());
    expect(field("Filter request status").value).toBe("new");
    expect(location.history?.at(-1)).toBe("/admin/staff-handbook?tab=requests");
    expect(container.textContent).toContain(
      "Request workload by assignee & category"
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("offers report on empty search and submits only a real internal request", async () => {
    mocks.results["staffHandbook.browse"].data.items = [];
    mocks.results["staffHandbook.browse"].data.total = 0;
    mocks.mutate.mockResolvedValue({ id: 8, version: 1 });
    await render();
    await input("Search guidance", "missing");
    await submitContaining("Search guidance");
    expect(container.textContent).toContain("No guidance matches your search");
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .filter(b => b.textContent?.trim() === "Report missing knowledge")
        .at(-1)!
        .click();
    });
    expect(button("Submit knowledge request").disabled).toBe(true);
    await input("Request title", "New missing guide");
    await input("What knowledge is missing?", "Synthetic process description");
    await input("Guidance already checked", "Search returned none");
    await input("Impact on staff or service", "Staff unable to proceed");
    await submitContaining("Request title");
    expect(mocks.mutate).toHaveBeenCalledWith(
      "staffHandbook.createRequest",
      expect.objectContaining({
        title: "New missing guide",
        description: "Synthetic process description",
        category: "General",
        kind: "missing_process",
        checkedGuidance: "Search returned none",
        impact: "Staff unable to proceed",
        priority: "normal",
        articleId: null,
        createToken: expect.any(String),
      })
    );
    expect(location.history?.at(-1)).toContain("request=8");
  });
  it("preserves a report after mutation failure and uses the same retry token", async () => {
    mocks.mutate.mockRejectedValue(new Error("Conflict synthetic"));
    await render();
    await click("Report missing knowledge");
    await input("Request title", "Keep report");
    await input("What knowledge is missing?", "Missing");
    await input("Guidance already checked", "Checked");
    await input("Impact on staff or service", "Impact");
    await submitContaining("Request title");
    const first = mocks.mutate.mock.calls[0][1].createToken;
    expect(field("Request title").value).toBe("Keep report");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Conflict synthetic"
    );
    await submitContaining("Request title");
    expect(mocks.mutate.mock.calls[1][1].createToken).toBe(first);
  });
  it("distinguishes a saved report from failed refresh and prevents duplicate submission", async () => {
    mocks.invalidate.mockRejectedValue(new Error("Refresh unavailable"));
    mocks.mutate.mockResolvedValue({ id: 8, version: 1 });
    await render();
    await click("Report missing knowledge");
    await input("Request title", "Saved report");
    await input("What knowledge is missing?", "Missing");
    await input("Guidance already checked", "Checked");
    await input("Impact on staff or service", "Impact");
    await submitContaining("Request title");
    expect(container.textContent).toContain("was saved, but refresh failed");
    expect(button("Open saved request #8")).toBeTruthy();
    expect(container.querySelector("form")).toBeNull();
    expect(mocks.invalidate.mock.calls[0][3]).toEqual({ throwOnError: true });
  });
  it("creates a guide draft from a request without publishing or resolving", async () => {
    const onGuide = vi.fn();
    mocks.mutate.mockResolvedValue({ articleId: 7 });
    await render(
      "/admin/staff-handbook?tab=requests&request=8",
      requestElement(onGuide)
    );
    await click("Create guide from request");
    expect(mocks.mutate).toHaveBeenCalledWith(
      "staffHandbook.createGuideFromRequest",
      { id: 8, expectedVersion: 2, createToken: expect.any(String) }
    );
    expect(onGuide).toHaveBeenCalledWith(7);
    expect(mocks.mutate.mock.calls.map(c => c[0])).toEqual([
      "staffHandbook.createGuideFromRequest",
    ]);
  });
  it("validates assignment, duplicates and closure before explicit updates", async () => {
    await render(
      "/admin/staff-handbook?tab=requests&request=8",
      requestElement()
    );
    await input("Request status", "assigned");
    expect(button("Save request changes").disabled).toBe(true);
    await input("Assign to staff", "99");
    await submitContaining("Request status");
    expect(mocks.mutate).toHaveBeenCalledWith(
      "staffHandbook.updateRequest",
      expect.objectContaining({
        id: 8,
        expectedVersion: 2,
        status: "assigned",
        assigneeId: 99,
      })
    );
  });
  it("posts comments with optimistic version and keeps the body on errors", async () => {
    mocks.mutate.mockRejectedValue(new Error("Record changed"));
    await render(
      "/admin/staff-handbook?tab=requests&request=8",
      requestElement()
    );
    await input("Add internal comment", "Synthetic internal comment");
    await submitContaining("Add internal comment");
    expect(mocks.mutate).toHaveBeenCalledWith("staffHandbook.addComment", {
      id: 8,
      expectedVersion: 2,
      body: "Synthetic internal comment",
    });
    expect(field("Add internal comment").value).toBe(
      "Synthetic internal comment"
    );
  });
  it("reads published baseline by default and draft editing does not overwrite it", async () => {
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    expect(
      container.querySelector("[data-handbook-reading]")?.textContent
    ).toContain("Published baseline body");
    expect(container.querySelector("form")).toBeNull();
    await click("Edit draft");
    expect(field("Guide title").value).toBe("Synthetic refunds process");
    await input("Guide title", "Unsaved title");
    await click("Read published");
    expect(
      container.querySelector("[data-handbook-reading]")?.textContent
    ).toContain("Published baseline body");
    await click("Edit draft");
    expect(field("Guide title").value).toBe("Unsaved title");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("saves explicit draft with expected version; disables publish/upload while dirty", async () => {
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    await click("Edit draft");
    await input("Guide title", "Updated synthetic title");
    await input("Change summary", "Changed title");
    expect(button("Publish internally").disabled).toBe(true);
    expect(field("Upload private attachment").disabled).toBe(true);
    await submitContaining("Guide title");
    expect(mocks.mutate).toHaveBeenCalledWith(
      "staffHandbook.saveArticle",
      expect.objectContaining({
        id: 7,
        expectedVersion: 3,
        content: expect.objectContaining({ title: "Updated synthetic title" }),
        changeSummary: "Changed title",
      })
    );
    expect(container.textContent).toContain(
      "Draft saved. Published guidance is unchanged."
    );
  });
  it("keeps unsaved draft inputs after mutation conflicts and background refetch", async () => {
    mocks.mutate.mockRejectedValue(new Error("This record changed"));
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    await click("Edit draft");
    await input("Guide title", "Do not overwrite");
    await input("Change summary", "Synthetic change");
    await submitContaining("Guide title");
    expect(field("Guide title").value).toBe("Do not overwrite");
    expect(container.textContent).toContain("unsaved edits are retained");
    mocks.results["staffHandbook.article"].data = article({
      article: { version: 4 },
      draft: { content: content({ title: "Other staff title" }) },
    });
    await rerender(articleElement());
    expect(field("Guide title").value).toBe("Do not overwrite");
    expect(button("Publish internally").disabled).toBe(true);
  });
  it("requires independent approval of the exact sensitive revision and rejects contributors", async () => {
    mocks.results["staffHandbook.article"].data = article({
      article: { submittedAt: new Date() },
      draft: { content: content({ sensitivity: "financial" }) },
    });
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    expect(
      Array.from(container.querySelectorAll("button")).some(b =>
        b.textContent?.includes("Approve exact revision")
      )
    ).toBe(false);
    expect(button("Publish internally").disabled).toBe(true);
    expect(container.textContent).toContain("You contributed to this revision");
    expect(container.textContent).toContain(
      "exact saved revision has not been approved"
    );
  });
  it("sensitive downgrade and outdated review cannot bypass review", async () => {
    mocks.results["staffHandbook.article"].data = article({
      article: { reviewedRevisionId: 11, reviewedById: 100 },
      published: { content: content({ sensitivity: "policy" }) },
    });
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    expect(button("Publish internally").disabled).toBe(true);
    expect(container.textContent).toContain("previously sensitive publication");
  });
  it("independent staff reviewer approves the exact saved revision explicitly", async () => {
    mocks.results["staffHandbook.article"].data = article({
      article: { submittedAt: new Date() },
      draft: {
        createdById: 100,
        contributorIds: [100],
        content: content({ sensitivity: "legal" }),
      },
    });
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    await click("Approve exact revision 2");
    expect(mocks.mutate).toHaveBeenCalledWith("staffHandbook.articleAction", {
      id: 7,
      expectedVersion: 3,
      action: "approve",
    });
    expect(mocks.mutate.mock.calls).toHaveLength(1);
  });
  it("publishes internally only after confirmation with saved revision version", async () => {
    mocks.results["staffHandbook.article"].data = article({
      article: { reviewedRevisionId: 12, reviewedById: 100 },
      draft: { content: content({ sensitivity: "financial" }) },
    });
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    await click("Publish internally");
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Agents will not have access")
    );
    expect(mocks.mutate).toHaveBeenCalledWith("staffHandbook.articleAction", {
      id: 7,
      expectedVersion: 3,
      action: "publish",
    });
  });
  it("does not publish after cancelled confirmation and exposes no agent calls", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    await click("Publish internally");
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.queries.every(q => q.path.startsWith("staffHandbook."))).toBe(
      true
    );
  });
  it("renders read-only revision and audit history without mutation controls", async () => {
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    await click("Revision 1 · 1 Nov 2026 · Published baseline");
    const history = container.querySelector("[data-handbook-history]")!;
    expect(history.textContent).toContain("read-only history");
    expect(
      history.querySelector("input, textarea, form, [contenteditable]")
    ).toBeNull();
    expect(container.textContent).toContain("Synthetic audit");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        b => b.textContent === "Publish internally"
      )
    ).toBe(false);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("private files are exact authenticated download links and untrusted inline images never render", async () => {
    const data = article();
    data.published.content.contentHtml =
      '<p onclick="bad()">Safe <strong>body</strong></p><img src="https://example.invalid/track"><iframe src="https://example.invalid"></iframe><script>bad()</script><a href="javascript:bad()">Bad</a><a href="/api/staff-handbook/resource/4">Private</a><a href="//example.invalid">External</a><a href="/api/staff-handbook/resource/5">Other private</a>';
    data.resources.push({
      id: 5,
      fileName: "bad.png",
      mimeType: "image/png",
      byteSize: 1,
      url: "https://example.invalid/bad.png",
      available: true,
    });
    data.published.resourceIds.push(5);
    await render(
      "/admin/staff-handbook",
      React.createElement(GuideReading, {
        revision: data.published,
        resources: data.resources,
      })
    );
    expect(
      container.querySelector("img, iframe, script, [onclick], [onerror]")
    ).toBeNull();
    expect(
      container.querySelector('a[href="/api/staff-handbook/resource/4"]')
    ).toBeTruthy();
    expect(
      container.querySelector('a[href="/api/staff-handbook/resource/5"]')
    ).toBeNull();
    expect(
      container.querySelector(
        'a[href^="javascript:"], a[href^="//"], a[href^="https:"]'
      )
    ).toBeNull();
    expect(container.textContent).toContain("invalid private link");
  });
  it("all six process sections reuse restricted editor without remote tools and block image paste", async () => {
    mocks.results["staffHandbook.article"].data = article({
      published: null,
      draft: { content: content({ format: "process" }) },
    });
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    expect(mocks.editors.length).toBeGreaterThanOrEqual(6);
    expect(
      mocks.editors.every(
        p =>
          p.internalHandbook === true &&
          p.restrictedAcademy === true &&
          p.preserveClipboardFormatting === true
      )
    ).toBe(true);
    const editor = container.querySelector(
      'textarea[aria-label="When to use"]'
    )!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        files: [],
        getData: () => '<img src="https://example.invalid/private">',
      },
    });
    await act(async () => editor.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);
    expect(container.textContent).toContain(
      "Inline images and embeds are blocked"
    );
    expect(container.querySelector("img")).toBeNull();
  });
  it("uploads only allowed private attachments with optimistic version", async () => {
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    const file = new File(["synthetic text"], "note.txt", {
      type: "text/plain",
    });
    const upload = field("Upload private attachment") as HTMLInputElement;
    Object.defineProperty(upload, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () => {
      upload.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    expect(mocks.mutate).toHaveBeenCalledWith(
      "staffHandbook.uploadResource",
      expect.objectContaining({
        articleId: 7,
        expectedVersion: 3,
        fileName: "note.txt",
        mimeType: "text/plain",
        fileBase64: expect.any(String),
      })
    );
    expect(container.textContent).toContain("Private attachment saved");
  });
  it("rejects unsupported file types without a mutation", async () => {
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    const upload = field("Upload private attachment") as HTMLInputElement;
    Object.defineProperty(upload, "files", {
      value: [new File(["bad"], "unsafe.html", { type: "text/html" })],
    });
    await act(async () =>
      upload.dispatchEvent(new Event("change", { bubbles: true }))
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("correct file type");
  });
  it("disables mutable actions while pending and never fabricates a successful loading state", async () => {
    mocks.pending = true;
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    expect(button("Publish internally").disabled).toBe(true);
    expect(field("Upload private attachment").disabled).toBe(true);
    await click("Publish internally");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it.each([
    "agent",
    "business_staff",
    "inactive",
    "password-change",
    "missing-password-flag",
    "missing",
    "auth-loading",
  ])("denies %s without mounting any handbook hooks", async role => {
    if (role === "inactive") mocks.user.isActive = false;
    else if (role === "password-change") mocks.user.mustChangePassword = true;
    else if (role === "missing-password-flag")
      delete mocks.user.mustChangePassword;
    else if (role === "missing") mocks.user = null;
    else if (role === "auth-loading") mocks.loading = true;
    else mocks.user.role = role;
    await render();
    expect(container.querySelector("[data-staff-handbook]")).toBeNull();
    expect(mocks.queries).toHaveLength(0);
    expect(mocks.mutationHooks).toHaveLength(0);
  });
  it("clears handbook query cache across logout and prevents cross-id cached detail display", async () => {
    await render();
    cache.setQueryData(
      [["staffHandbook", "article"], { input: { id: 7 }, type: "query" }],
      { secret: "synthetic" }
    );
    mocks.user = null;
    await rerender();
    expect(
      cache.getQueryCache().findAll({ queryKey: [["staffHandbook"]] })
    ).toHaveLength(0);
    mocks.results["staffHandbook.article"].data = article({
      article: { id: 99 },
    });
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    expect(container.querySelector("[data-handbook-reading]")).toBeNull();
  });
  it.each(["loading", "error"])(
    "does not show list success or zero counts on %s",
    async state => {
      mocks.results["staffHandbook.overview"] =
        state === "loading" ? { isLoading: true } : { isError: true };
      mocks.results["staffHandbook.browse"] =
        state === "loading"
          ? { isLoading: true }
          : { isError: true, data: mocks.results["staffHandbook.browse"].data };
      await render();
      expect(container.textContent).not.toContain("Synthetic refunds process");
      expect(
        container.querySelector('[aria-label="Guide results"]')
      ).toBeNull();
      expect(
        container.querySelector(
          state === "loading" ? '[role="status"]' : '[role="alert"]'
        )
      ).toBeTruthy();
    }
  );
  it("fails closed on an initial article/request error even if cached data exists", async () => {
    mocks.results["staffHandbook.article"].isError = true;
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    expect(container.querySelector("[data-handbook-article]")).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to load guide"
    );
    mocks.results["staffHandbook.request"].isError = true;
    await render(
      "/admin/staff-handbook?tab=requests&request=8",
      requestElement()
    );
    expect(container.querySelector("[data-knowledge-request]")).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("preserves article and request inputs on refetch failures without silently rewriting", async () => {
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    await click("Edit draft");
    await input("Guide title", "Keep draft after refetch error");
    mocks.results["staffHandbook.article"] = { isError: true };
    await rerender(articleElement());
    expect(field("Guide title").value).toBe("Keep draft after refetch error");
    expect(button("Publish internally").disabled).toBe(true);
    await render(
      "/admin/staff-handbook?tab=requests&request=8",
      requestElement()
    );
    await input("Edit request title", "Keep request after refetch error");
    mocks.results["staffHandbook.request"] = { isError: true };
    await rerender(requestElement());
    expect(field("Edit request title").value).toBe(
      "Keep request after refetch error"
    );
    expect(button("Save request changes").disabled).toBe(true);
  });
  it("saved new guide plus failed refresh is explicit and cannot create a duplicate", async () => {
    mocks.invalidate.mockRejectedValue(new Error("Synthetic refresh failure"));
    await render();
    await click("New guide");
    await input("Guide title", "New saved guide");
    await input("Change summary", "Initial draft");
    await submitContaining("Guide title");
    expect(container.textContent).toContain(
      "Refresh failed; the action was saved"
    );
    expect(button("Open saved guide #7")).toBeTruthy();
    expect(field("Guide title").closest("fieldset")?.disabled).toBe(true);
    await submitContaining("Guide title");
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
  it("requires body/steps before review or publication", async () => {
    mocks.results["staffHandbook.article"].data = article({
      draft: { content: content({ contentHtml: "<p></p>" }) },
    });
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    expect(button("Publish internally").disabled).toBe(true);
    expect(button("Submit for review").disabled).toBe(true);
    expect(container.textContent).toContain(
      "save an article body or process steps first"
    );
  });
  it("archive and restore are confirmed explicit versioned actions, never publication", async () => {
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    await click("Archive guide");
    expect(mocks.mutate).toHaveBeenCalledWith("staffHandbook.articleAction", {
      id: 7,
      expectedVersion: 3,
      action: "archive",
    });
    mocks.results["staffHandbook.article"].data = article({
      article: { version: 4, archivedAt: new Date() },
    });
    await rerender(articleElement());
    expect(button("Publish internally").disabled).toBe(true);
    expect(button("Edit draft").disabled).toBe(true);
    await click("Restore guide");
    expect(mocks.mutate).toHaveBeenCalledWith("staffHandbook.articleAction", {
      id: 7,
      expectedVersion: 4,
      action: "restore",
    });
    expect(mocks.mutate.mock.calls.map(call => call[1].action)).toEqual([
      "archive",
      "restore",
    ]);
  });
  it("duplicate closure requires closed status and a reason", async () => {
    await render(
      "/admin/staff-handbook?tab=requests&request=8",
      requestElement()
    );
    await input("Duplicate of request ID (optional)", "9");
    expect(button("Save request changes").disabled).toBe(true);
    await input("Request status", "closed");
    expect(button("Save request changes").disabled).toBe(true);
    await input("Closure / resolution reason", "Covered by request 9");
    await submitContaining("Request status");
    expect(mocks.mutate).toHaveBeenCalledWith(
      "staffHandbook.updateRequest",
      expect.objectContaining({
        status: "closed",
        duplicateOfId: 9,
        closureReason: "Covered by request 9",
        expectedVersion: 2,
      })
    );
  });
  it("identity changes clear handbook cached entries before another administrator mounts", async () => {
    await render();
    cache.setQueryData(
      [["staffHandbook", "article"], { input: { id: 7 }, type: "query" }],
      { private: "synthetic" }
    );
    mocks.user = { ...mocks.user, id: 100 };
    await rerender();
    expect(
      cache.getQueryCache().findAll({ queryKey: [["staffHandbook"]] })
    ).toHaveLength(0);
    expect(container.querySelector("[data-staff-handbook]")).toBeTruthy();
  });
  const authorityError = (code: "FORBIDDEN" | "UNAUTHORIZED") =>
    Object.assign(new Error("Synthetic authority denied"), { data: { code } });
  function expectNoPrivateContent() {
    expect(
      container.querySelector(
        "[data-handbook-reading], [data-handbook-article], [data-handbook-history], [data-knowledge-request], input, textarea, form, a"
      )
    ).toBeNull();
    expect(container.textContent).not.toMatch(
      /Synthetic refunds|Published baseline body|Saved draft body|Synthetic audit|Synthetic knowledge gap|Missing staff process|Private unsaved|Private comment/
    );
    expect(container.textContent).toContain("access could not be authorized");
  }
  function cachePrivateEntry() {
    cache.setQueryData(
      [["staffHandbook", "article"], { input: { id: 7 }, type: "query" }],
      { private: "synthetic" }
    );
    cache.setQueryData([["unrelated"]], "preserved");
  }
  function expectCacheSafe() {
    expect(
      cache.getQueryCache().findAll({ queryKey: [["staffHandbook"]] })
    ).toHaveLength(0);
    expect(cache.getQueryData([["unrelated"]])).toBe("preserved");
    expect(mocks.invalidate).toHaveBeenCalledWith(
      "auth.me",
      undefined,
      undefined,
      { throwOnError: true }
    );
  }
  it.each(["FORBIDDEN", "UNAUTHORIZED"] as const)(
    "immediately hides loaded article/history/unsaved locals on %s refresh before effects",
    async code => {
      let committedText = "";
      let committedSensitive = false;
      function Probe() {
        React.useLayoutEffect(() => {
          committedText = container.textContent ?? "";
          committedSensitive = !!container.querySelector(
            "[data-handbook-article], [data-handbook-history], input, textarea"
          );
        });
        return null;
      }
      const element = () =>
        React.createElement(
          React.Fragment,
          null,
          articleElement(),
          React.createElement(Probe)
        );
      await render("/admin/staff-handbook?tab=handbook&article=7", element());
      await click("Edit draft");
      await input("Guide title", "Private unsaved title");
      await click("Revision 1 · 1 Nov 2026 · Published baseline");
      cachePrivateEntry();
      mocks.results["staffHandbook.article"] = {
        isError: true,
        error: authorityError(code),
        data: article(),
      };
      await rerender(element());
      expect(committedSensitive).toBe(false);
      expect(committedText).not.toMatch(
        /Published baseline|Private unsaved|Synthetic audit/
      );
      expectNoPrivateContent();
      expectCacheSafe();
      mocks.results["staffHandbook.article"] = { data: article() };
      await rerender(element());
      expectNoPrivateContent();
    }
  );
  it.each(["FORBIDDEN", "UNAUTHORIZED"] as const)(
    "clears article editors and cache on %s save rejection",
    async code => {
      await render(
        "/admin/staff-handbook?tab=handbook&article=7",
        articleElement()
      );
      await click("Edit draft");
      await input("Guide title", "Private unsaved title");
      await input("Change summary", "Private unsaved reason");
      cachePrivateEntry();
      mocks.mutate.mockRejectedValue(authorityError(code));
      await submitContaining("Guide title");
      expectNoPrivateContent();
      expectCacheSafe();
      expect(container.textContent).not.toContain("retained");
    }
  );
  it.each([
    "staffHandbook.saveArticle",
    "staffHandbook.articleAction",
    "staffHandbook.uploadResource",
    "staffHandbook.removeResource",
  ])(
    "hides loaded article immediately for mutation hook authority errors: %s",
    async path => {
      await render(
        "/admin/staff-handbook?tab=handbook&article=7",
        articleElement()
      );
      cachePrivateEntry();
      mocks.mutationErrors[path] = authorityError("FORBIDDEN");
      await rerender(articleElement());
      expectNoPrivateContent();
      expectCacheSafe();
    }
  );
  it.each([
    "staffHandbook.overview",
    "staffHandbook.browse",
    "staffHandbook.requests",
  ])(
    "blocks all cached overview/list rows when %s authority is denied",
    async path => {
      await render(
        path.endsWith("requests")
          ? "/admin/staff-handbook?tab=requests"
          : undefined
      );
      cachePrivateEntry();
      mocks.results[path] = {
        ...mocks.results[path],
        isError: true,
        error: authorityError("FORBIDDEN"),
      };
      await rerender();
      expectNoPrivateContent();
      expect(container.querySelector("[data-staff-handbook]")).toBeNull();
      expectCacheSafe();
      mocks.results[path] = { data: mocks.results[path].data };
      await rerender();
      expectNoPrivateContent();
    }
  );
  it("an overview denial unmounts the selected article even with cached eligible auth", async () => {
    await render("/admin/staff-handbook?tab=handbook&article=7");
    await click("Edit draft");
    await input("Guide title", "Private unsaved title");
    cachePrivateEntry();
    mocks.results["staffHandbook.overview"].error =
      authorityError("UNAUTHORIZED");
    mocks.results["staffHandbook.overview"].isError = true;
    await rerender();
    expectNoPrivateContent();
    expectCacheSafe();
    expect(mocks.user.role).toBe("admin");
  });
  it.each(["FORBIDDEN", "UNAUTHORIZED"] as const)(
    "hides request details/comments/audit/editors on %s refresh",
    async code => {
      mocks.results["staffHandbook.request"].data.comments = [
        {
          id: 1,
          authorId: 99,
          body: "Private comment history",
          createdAt: new Date(),
        },
      ];
      mocks.results["staffHandbook.request"].data.audit = article().audit;
      await render(
        "/admin/staff-handbook?tab=requests&request=8",
        requestElement()
      );
      await input("Edit request title", "Private unsaved request");
      await input("Add internal comment", "Private comment local");
      cachePrivateEntry();
      mocks.results["staffHandbook.request"] = {
        ...mocks.results["staffHandbook.request"],
        isError: true,
        error: authorityError(code),
      };
      await rerender(requestElement());
      expectNoPrivateContent();
      expectCacheSafe();
    }
  );
  it.each(["update", "comment", "guide"] as const)(
    "clears request locals on authority failure from %s mutation",
    async kind => {
      await render(
        "/admin/staff-handbook?tab=requests&request=8",
        requestElement()
      );
      cachePrivateEntry();
      mocks.mutate.mockRejectedValue(authorityError("UNAUTHORIZED"));
      if (kind === "update") {
        await input("Edit request title", "Private unsaved request");
        await submitContaining("Request status");
      } else if (kind === "comment") {
        await input("Add internal comment", "Private comment local");
        await submitContaining("Add internal comment");
      } else await click("Create guide from request");
      expectNoPrivateContent();
      expectCacheSafe();
    }
  );
  it.each(["FORBIDDEN", "UNAUTHORIZED"] as const)(
    "clears an unsaved report on %s creation failure",
    async code => {
      await render();
      await click("Report missing knowledge");
      await input("Request title", "Private unsaved report");
      await input("What knowledge is missing?", "Private unsaved description");
      await input("Guidance already checked", "Checked");
      await input("Impact on staff or service", "Impact");
      cachePrivateEntry();
      mocks.mutate.mockRejectedValue(authorityError(code));
      await submitContaining("Request title");
      expectNoPrivateContent();
      expectCacheSafe();
    }
  );
  it.each(["article", "request", "report"] as const)(
    "an auth failure during post-save %s refresh does not show success or saved links",
    async kind => {
      await render(
        kind === "request"
          ? "/admin/staff-handbook?tab=requests&request=8"
          : "/admin/staff-handbook?tab=handbook&article=7"
      );
      if (kind === "article") {
        await click("Edit draft");
        await input("Change summary", "Private unsaved change");
      } else if (kind === "request")
        await input("Edit request title", "Private unsaved request");
      else {
        await click("Back to guides");
        await click("Report missing knowledge");
        await input("Request title", "Private unsaved report");
        await input("What knowledge is missing?", "Missing");
        await input("Guidance already checked", "Checked");
        await input("Impact on staff or service", "Impact");
      }
      cachePrivateEntry();
      mocks.invalidate.mockImplementation((path: string) =>
        path === "auth.me"
          ? Promise.resolve()
          : Promise.reject(authorityError("FORBIDDEN"))
      );
      await submitContaining(
        kind === "article"
          ? "Guide title"
          : kind === "request"
            ? "Request status"
            : "Request title"
      );
      expectNoPrivateContent();
      expectCacheSafe();
      expect(container.textContent).not.toMatch(
        /Draft saved|Request updated|Open saved|action was saved/
      );
    }
  );
  it("changed administrator cannot see the previous identity's loaded or unsaved detail", async () => {
    await render("/admin/staff-handbook?tab=handbook&article=7");
    await click("Edit draft");
    await input("Guide title", "Private unsaved old identity");
    cachePrivateEntry();
    mocks.user = { ...mocks.user, id: 100 };
    mocks.results["staffHandbook.article"] = { isLoading: true };
    await rerender();
    expect(container.textContent).not.toMatch(
      /Private unsaved|Published baseline|Synthetic audit/
    );
    expect(container.querySelector("[data-handbook-article]")).toBeNull();
    expect(
      cache.getQueryCache().findAll({ queryKey: [["staffHandbook"]] })
    ).toHaveLength(0);
    expect(cache.getQueryData([["unrelated"]])).toBe("preserved");
    mocks.results["staffHandbook.article"] = {
      data: article({
        draft: { content: content({ title: "New identity guide" }) },
      }),
    };
    await rerender();
    await click("Edit draft");
    expect(field("Guide title").value).toBe("New identity guide");
  });
  it("cached auth.me authorization error denies access even while its user remains eligible", async () => {
    await render("/admin/staff-handbook?tab=handbook&article=7");
    cachePrivateEntry();
    mocks.authError = authorityError("FORBIDDEN");
    await rerender();
    expect(
      container.querySelector("[data-staff-handbook], [data-handbook-article]")
    ).toBeNull();
    expect(container.textContent).not.toContain("Synthetic refunds");
    expect(
      cache.getQueryCache().findAll({ queryKey: [["staffHandbook"]] })
    ).toHaveLength(0);
  });
  it("cache-level authority denials from sibling queries fail closed without any render setter", async () => {
    await render();
    cachePrivateEntry();
    const cached = cache
      .getQueryCache()
      .find({
        queryKey: [
          ["staffHandbook", "article"],
          { input: { id: 7 }, type: "query" },
        ],
      })!;
    await act(async () =>
      cached.setState({ error: authorityError("FORBIDDEN"), status: "error" })
    );
    expectNoPrivateContent();
    expectCacheSafe();
  });
  it("a loaded request denial removes all cached content in its first commit before effects", async () => {
    let leaked = false;
    function Probe() {
      React.useLayoutEffect(() => {
        leaked =
          !!container.querySelector(
            "[data-knowledge-request], input, textarea, form"
          ) ||
          /Synthetic knowledge gap|Private comment/.test(
            container.textContent ?? ""
          );
      });
      return null;
    }
    const element = () =>
      React.createElement(
        React.Fragment,
        null,
        requestElement(),
        React.createElement(Probe)
      );
    await render("/admin/staff-handbook?tab=requests&request=8", element());
    await input("Add internal comment", "Private comment local");
    mocks.results["staffHandbook.request"] = {
      ...mocks.results["staffHandbook.request"],
      error: authorityError("FORBIDDEN"),
    };
    await rerender(element());
    expect(leaked).toBe(false);
    expectNoPrivateContent();
  });
  it.each([
    "staffHandbook.updateRequest",
    "staffHandbook.addComment",
    "staffHandbook.createGuideFromRequest",
  ])(
    "request mutation hooks fail closed immediately even with retained DTO data: %s",
    async path => {
      await render(
        "/admin/staff-handbook?tab=requests&request=8",
        requestElement()
      );
      cachePrivateEntry();
      mocks.mutationErrors[path] = authorityError("UNAUTHORIZED");
      await rerender(requestElement());
      expectNoPrivateContent();
      expectCacheSafe();
    }
  );
  it("report mutation hook authority errors clear unsaved fields without preserving a report", async () => {
    await render();
    await click("Report missing knowledge");
    await input("Request title", "Private unsaved report");
    cachePrivateEntry();
    mocks.mutationErrors["staffHandbook.createRequest"] =
      authorityError("FORBIDDEN");
    await rerender();
    expectNoPrivateContent();
    expectCacheSafe();
  });
  it("handbook mutation-cache denials unmount content, clear only handbook entries, and revalidate once", async () => {
    await render();
    cachePrivateEntry();
    const unrelated = cache
      .getMutationCache()
      .build(cache, {
        mutationKey: [["unrelated"], { label: "staffHandbook" }],
      });
    const mutation = cache
      .getMutationCache()
      .build(cache, { mutationKey: [["staffHandbook", "saveArticle"]] });
    await act(async () => {
      mutation.state.error = authorityError("UNAUTHORIZED");
      cache
        .getMutationCache()
        .notify({
          type: "updated",
          mutation,
          action: { type: "error", error: mutation.state.error },
        });
    });
    expectNoPrivateContent();
    expectCacheSafe();
    expect(cache.getMutationCache().getAll()).toEqual([unrelated]);
    expect(
      mocks.invalidate.mock.calls.filter(call => call[0] === "auth.me")
    ).toHaveLength(1);
    await rerender();
    await rerender();
    expectNoPrivateContent();
    expect(
      mocks.invalidate.mock.calls.filter(call => call[0] === "auth.me")
    ).toHaveLength(1);
  });
  it("unrelated query and mutation authority errors never revoke handbook access", async () => {
    await render();
    const query = cache
      .getQueryCache()
      .build(cache, { queryKey: [["unrelated"]] });
    const mutation = cache
      .getMutationCache()
      .build(cache, {
        mutationKey: [["unrelated"], { label: "staffHandbook" }],
      });
    await act(async () => {
      query.setState({ error: authorityError("FORBIDDEN"), status: "error" });
      mutation.state.error = authorityError("UNAUTHORIZED");
      cache
        .getMutationCache()
        .notify({
          type: "updated",
          mutation,
          action: { type: "error", error: mutation.state.error },
        });
    });
    expect(container.querySelector("[data-staff-handbook]")).toBeTruthy();
    expect(container.textContent).toContain("Synthetic refunds process");
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
  it("sticky independent-review metadata blocks an operational draft with an earlier sensitive draft in its cycle", async () => {
    mocks.results["staffHandbook.article"].data = article({
      article: { requiresIndependentReview: true },
      published: null,
    });
    await render(
      "/admin/staff-handbook?tab=handbook&article=7",
      articleElement()
    );
    expect(button("Publish internally").disabled).toBe(true);
    expect(container.textContent).toContain(
      "exact saved revision has not been approved"
    );
  });
  it("historical retired attachments render metadata but never invent or retain a clickable URL", async () => {
    const data = article();
    data.resources[0] = {
      ...data.resources[0],
      available: false,
      url: undefined,
    };
    data.published.content.contentHtml =
      '<p>Historic body</p><a href="/api/staff-handbook/resource/4">Old embedded attachment</a>';
    await render(
      "/admin/staff-handbook",
      React.createElement(GuideReading, {
        revision: data.published,
        resources: data.resources,
      })
    );
    expect(container.textContent).toContain("Attachment no longer available");
    expect(container.textContent).toContain("private.png");
    expect(container.querySelector("a[href]")).toBeNull();
  });
  it("only canonical bounded internal handbook links survive sanitized rich text", async () => {
    const valid = [
      "/admin/staff-handbook?tab=handbook&article=7",
      "/admin/staff-handbook?tab=requests&request=8",
      "/admin/staff-handbook?tab=handbook",
    ];
    const invalid = [
      "/admin/staff-handbook?article=7",
      "/admin/staff-handbook?tab=handbook&article=0",
      "/admin/staff-handbook?tab=handbook&article=2147483648",
      "/admin/staff-handbook?tab=handbook&article=1&url=https://example.invalid",
      "/admin/staff-handbook?tab=handbook&article=https://example.invalid",
      "/admin/staff-handbook?tab=evil&article=7",
      "/admin/staff-handbook?tab=requests&article=7",
      "/admin/staff-handbook?tab=handbook&article=%37",
      "/admin/staff-handbook?tab=handbook&article=7#https://example.invalid",
      "//example.invalid/admin/staff-handbook?tab=handbook&article=7",
    ];
    valid.forEach(href => expect(safeInternalHandbookHref(href)).toBe(true));
    invalid.forEach(href => expect(safeInternalHandbookHref(href)).toBe(false));
    const data = article();
    data.published.content.contentHtml = [...valid, ...invalid]
      .map(
        (href, i) => `<a href="${href.replaceAll("&", "&amp;")}">Link ${i}</a>`
      )
      .join("");
    await render(
      "/admin/staff-handbook",
      React.createElement(GuideReading, {
        revision: data.published,
        resources: [],
      })
    );
    expect(
      Array.from(container.querySelectorAll("a[href]")).map(a =>
        a.getAttribute("href")
      )
    ).toEqual(valid);
  });
  it("overview review/due/open/assignee/category drilldowns pass exact server queue filters", async () => {
    await render();
    async function metricClick(label: string) {
      await act(async () =>
        Array.from(container.querySelectorAll("button"))
          .find(b => b.textContent?.includes(label))!
          .click()
      );
    }
    const latest = (path: string) =>
      mocks.queries.filter(q => q.path === `staffHandbook.${path}`).at(-1)!
        .input;
    await metricClick("Awaiting review");
    expect(latest("browse")).toMatchObject({
      view: "drafts",
      needsReview: true,
      page: 1,
    });
    expect(latest("browse").dueReview).toBeUndefined();
    await metricClick("Due review");
    expect(latest("browse")).toMatchObject({
      view: "published",
      dueReview: true,
      page: 1,
    });
    expect(latest("browse").needsReview).toBeUndefined();
    await metricClick("Open requests");
    expect(latest("requests")).toMatchObject({ status: "open", page: 1 });
    expect(field("Filter request status").value).toBe("open");
    await metricClick("Unassigned");
    expect(latest("requests")).toMatchObject({
      status: "open",
      assigneeId: null,
    });
    await input("Search requests", "stale search");
    await submitContaining("Search requests");
    await click("General1");
    expect(latest("requests")).toMatchObject({
      status: "open",
      category: "General",
      page: 1,
    });
    expect(latest("requests").search).toBeUndefined();
    await click("Unassigned1");
    expect(latest("requests")).toMatchObject({
      status: "open",
      assigneeId: null,
      page: 1,
    });
    expect(latest("requests").category).toBeUndefined();
    await click("Handbook");
    expect(latest("browse").needsReview).toBeUndefined();
    expect(latest("browse").dueReview).toBeUndefined();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
