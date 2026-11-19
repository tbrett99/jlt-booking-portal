// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyHandbookContent } from "../shared/staff-handbook";

const mocks = vi.hoisted(() => ({
  detail: null as any,
  queryError: null as unknown,
  mutationErrors: {} as Record<string, unknown>,
  mutate: vi.fn(),
  fetchArticle: vi.fn(),
  invalidate: vi.fn(),
  editors: [] as any[],
}));
vi.mock("@/lib/trpc", () => {
  const node = (path = ""): any =>
    new Proxy(
      {},
      {
        get: (_target, key: string) => {
          if (key === "useUtils") return () => node();
          if (key === "useQuery")
            return () => ({
              data: mocks.detail,
              isError: !!mocks.queryError,
              error: mocks.queryError,
              isLoading: false,
              refetch: vi.fn(),
            });
          if (key === "useMutation")
            return () => ({
              isPending: false,
              error: mocks.mutationErrors[path],
              mutateAsync: (input: any) => mocks.mutate(path, input),
            });
          if (key === "fetch")
            return (...args: any[]) => mocks.fetchArticle(path, ...args);
          if (key === "invalidate")
            return (...args: any[]) => mocks.invalidate(path, ...args);
          return node(path ? `${path}.${key}` : key);
        },
      }
    );
  return { trpc: node() };
});
vi.mock("@/components/RichEmailEditor", async () => {
  const { createElement } = await import("react");
  return {
    RichEmailEditor: (props: any) => {
      mocks.editors.push(props);
      return createElement("textarea", {
        "aria-label": props.ariaLabel,
        disabled: props.disabled,
        value: props.value,
        onChange: (event: any) => props.onChange(event.target.value),
      });
    },
  };
});
import { ArticlePanel } from "../client/src/pages/admin/StaffHandbookArticle";

function guide(extra: any = {}) {
  const content = {
    ...emptyHandbookContent(99),
    format: "article" as const,
    title: "Synthetic guide",
    contentHtml: "<p>Saved body</p>",
    ...extra.content,
  };
  const draft = {
    id: 12,
    articleId: 7,
    revisionNumber: 2,
    content,
    resourceIds: [4],
    contributorIds: [99],
    createdById: 99,
    changeSummary: "Previous note",
    createdAt: new Date("2026-11-01"),
    ...extra.draft,
  };
  const published = {
    ...draft,
    id: 11,
    revisionNumber: 1,
    content: { ...content, contentHtml: "<p>Published body</p>" },
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
      requiresIndependentReview: content.sensitivity !== "operational",
      ...extra.article,
    },
    draft,
    published: extra.published === null ? null : (extra.published ?? published),
    revisions: [draft, published],
    resources: [
      {
        id: 4,
        fileName: "private.txt",
        mimeType: "text/plain",
        byteSize: 5,
        available: true,
        url: "/api/staff-handbook/resource/4",
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
  };
}
let root: Root;
let container: HTMLDivElement;
let cache: QueryClient;
let onSaved: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;
function element(id: number | "new" = "new", key = String(id)) {
  return React.createElement(ArticlePanel, {
    key,
    id,
    userId: 99,
    categories: ["General", "Academy"],
    staff: [{ id: 99, name: "Synthetic staff" }],
    startEditing: true,
    onSaved,
    onClose,
  });
}
async function render(id: number | "new" = "new", key = String(id)) {
  await act(async () =>
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: cache },
        element(id, key)
      )
    )
  );
}
function findButton(label: string) {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button")
  ).find(b => b.textContent?.replace(/\s+/g, " ").trim() === label);
}
function button(label: string) {
  const result = findButton(label);
  expect(result, `Button ${label}`).toBeTruthy();
  return result!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
function field(
  label: string
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const labelled = Array.from(
    container.querySelectorAll<HTMLLabelElement>("label")
  ).find(l => l.textContent?.trim() === label);
  const result = labelled
    ? document.getElementById(labelled.htmlFor)
    : container.querySelector(`[aria-label="${label}"]`);
  expect(result, `Field ${label}`).toBeTruthy();
  return result as any;
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
async function submit() {
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
}
function details(label: string) {
  const summary = Array.from(container.querySelectorAll("summary")).find(
    el => el.textContent?.trim() === label
  );
  expect(summary, `Details ${label}`).toBeTruthy();
  return summary!.parentElement as HTMLDetailsElement;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
async function titleAndBody() {
  await input("Title", "Simple new guide");
  await input("Content", "<p>Just write the guidance.</p>");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No production network permitted");
    })
  );
  window.happyDOM.settings.disableJavaScriptFileLoading = true;
  window.happyDOM.settings.disableCSSFileLoading = true;
  window.happyDOM.settings.enableJavaScriptEvaluation = false;
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mocks.detail = guide();
  mocks.queryError = null;
  mocks.mutationErrors = {};
  mocks.editors = [];
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.mutate.mockImplementation(async (path: string, input: any) => {
    const previous = mocks.detail;
    const draft = {
      ...previous.draft,
      id: 13,
      content: input.content ?? previous.draft.content,
      revisionNumber: 3,
      changeSummary: input.changeSummary ?? previous.draft.changeSummary,
    };
    mocks.detail = {
      ...previous,
      article: {
        ...previous.article,
        version: 4,
        draftRevisionId: 13,
        requiresIndependentReview:
          draft.content.sensitivity !== "operational" ||
          previous.article.requiresIndependentReview,
      },
      draft,
      published:
        path === "staffHandbook.saveAndPublishArticle"
          ? draft
          : previous.published,
      revisions: [draft, ...previous.revisions],
    };
    return { id: 7, version: 4 };
  });
  mocks.fetchArticle.mockImplementation(async () => mocks.detail);
  onSaved = vi.fn();
  onClose = vi.fn();
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

describe("simple staff handbook editor in the DOM", () => {
  it("starts with ordinary article content and keeps all optional advanced fields collapsed", async () => {
    await render();
    expect(field("Editor format").value).toBe("article");
    expect(emptyHandbookContent(99).format).toBe("process");
    expect(details("Advanced options (optional)").open).toBe(false);
    for (const label of [
      "Summary (optional)",
      "Owner",
      "Tags (comma separated)",
      "Sensitivity",
      "Last reviewed date",
      "Next review date",
      "Editor format",
      "Change note (optional)",
    ])
      expect(field(label).closest("details")).toBe(
        details("Advanced options (optional)")
      );
    expect(field("Category").closest("details")).toBeNull();
    expect(field("Content").closest("details")).toBeNull();
    expect(container.querySelector("[required]")).toBeNull();
    expect(container.textContent).not.toContain(
      "Review & internal publication"
    );
  });
  it("saves using only title and content with an automatic creation note", async () => {
    await render();
    await titleAndBody();
    await click("Save draft");
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith(
      "staffHandbook.saveArticle",
      expect.objectContaining({
        createToken: expect.any(String),
        changeSummary: "Guide created",
        content: expect.objectContaining({
          title: "Simple new guide",
          format: "article",
          contentHtml: "<p>Just write the guidance.</p>",
          category: "General",
          ownerId: 99,
        }),
      })
    );
    expect(mocks.fetchArticle).toHaveBeenCalledWith(
      "staffHandbook.article",
      { id: 7 },
      { staleTime: 0 }
    );
    expect(onSaved).toHaveBeenCalledWith(7);
    expect(container.textContent).toContain("Draft saved. Not published");
  });
  it("keeps Save enabled for a blank title and explains validation inline", async () => {
    await render();
    expect(button("Save draft").disabled).toBe(false);
    await click("Save draft");
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(field("Title").getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Enter a title"
    );
    await input("Title", "Now titled");
    expect(field("Title").getAttribute("aria-invalid")).toBe("false");
  });
  it("submitting by Enter means draft, while Save & publish is one explicit atomic mutation", async () => {
    await render(7);
    await input("Title", "Changed title");
    await submit();
    expect(mocks.mutate.mock.calls.map(call => call[0])).toEqual([
      "staffHandbook.saveArticle",
    ]);
    expect(mocks.mutate.mock.calls[0][1]).toMatchObject({
      id: 7,
      expectedVersion: 3,
      changeSummary: "Guide updated",
    });
    // The proxy does not subscribe to React Query's fetch cache updates.
    await render(7);
    await click("Save & publish");
    expect(mocks.mutate.mock.calls.map(call => call[0])).toEqual([
      "staffHandbook.saveArticle",
      "staffHandbook.saveAndPublishArticle",
    ]);
    expect(mocks.mutate.mock.calls[1][1]).toMatchObject({
      id: 7,
      expectedVersion: 4,
    });
    expect(container.textContent).toContain("saved and published internally");
  });
  it("retains edits when atomic publish fails and never falls back to a draft or separate publication", async () => {
    mocks.mutate.mockRejectedValue(new Error("Synthetic publish conflict"));
    await render();
    await titleAndBody();
    await click("Save & publish");
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate.mock.calls[0][0]).toBe(
      "staffHandbook.saveAndPublishArticle"
    );
    expect(field("Title").value).toBe("Simple new guide");
    expect(field("Content").value).toContain("Just write the guidance");
    expect(container.textContent).toContain("Synthetic publish conflict");
    expect(onSaved).not.toHaveBeenCalled();
    expect(mocks.fetchArticle).not.toHaveBeenCalled();
  });
  it("preserves edits, optional note and the creation token across save failure retries", async () => {
    mocks.mutate.mockRejectedValue(new Error("Synthetic save failure"));
    await render();
    await titleAndBody();
    await input("Change note (optional)", "Explicit note");
    await submit();
    const token = mocks.mutate.mock.calls[0][1].createToken;
    expect(field("Title").value).toBe("Simple new guide");
    expect(field("Change note (optional)").value).toBe("Explicit note");
    await submit();
    expect(mocks.mutate.mock.calls[1][1]).toMatchObject({
      createToken: token,
      changeSummary: "Explicit note",
    });
    expect(container.textContent).toContain("unsaved edits are retained");
  });
  it("does not navigate a new save until its returned id and exact version are freshly verified", async () => {
    const reload = deferred<any>();
    mocks.fetchArticle.mockReturnValue(reload.promise);
    await render();
    await titleAndBody();
    await submit();
    expect(onSaved).not.toHaveBeenCalled();
    expect(button("Save & publish").closest("fieldset")?.disabled).toBe(true);
    await act(async () => reload.resolve(mocks.detail));
    expect(onSaved).toHaveBeenCalledWith(7);
  });
  it("a list refresh failure cannot strand the saved guide and feedback survives the navigation remount", async () => {
    mocks.invalidate.mockRejectedValue(
      new Error("Synthetic list refresh failure")
    );
    await render();
    await titleAndBody();
    await submit();
    expect(onSaved).toHaveBeenCalledWith(7);
    await render(7, "newly-opened-saved-guide");
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Draft saved. Not published"
    );
    expect(container.textContent).toContain("some lists could not refresh");
    expect(field("Title").value).toBe("Simple new guide");
  });
  it("keeps saved id and edits after failed readback and retries only that read, without duplicates", async () => {
    mocks.fetchArticle.mockRejectedValue(
      new Error("Synthetic article refresh failure")
    );
    await render();
    await titleAndBody();
    await submit();
    expect(onSaved).not.toHaveBeenCalled();
    expect(container.textContent).toContain("the action was saved as guide #7");
    expect(field("Title").value).toBe("Simple new guide");
    expect(field("Title").closest("fieldset")?.disabled).toBe(true);
    await submit();
    await click("Open saved guide #7");
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    mocks.fetchArticle.mockResolvedValue(mocks.detail);
    await click("Open saved guide #7");
    expect(onSaved).toHaveBeenCalledWith(7);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.fetchArticle.mock.calls.every(call => call[1].id === 7)).toBe(
      true
    );
  });
  it.each([
    { id: 8, version: 4 },
    { id: 7, version: 5 },
  ])("rejects wrong saved record/version %j", async record => {
    mocks.fetchArticle.mockResolvedValue(guide({ article: record }));
    await render();
    await titleAndBody();
    await submit();
    expect(onSaved).not.toHaveBeenCalled();
    expect(button("Open saved guide #7")).toBeTruthy();
    expect(container.textContent).toContain("Refresh failed");
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
  it("guards same-tick double submissions and retains the guard through readback", async () => {
    const mutation = deferred<{ id: number; version: number }>();
    mocks.mutate.mockReturnValue(mutation.promise);
    await render();
    await titleAndBody();
    await act(async () => {
      const form = container.querySelector("form")!;
      for (let i = 0; i < 2; i++)
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true })
        );
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(button("Save & publish").disabled).toBe(true);
    expect(button("Back to guides").disabled).toBe(true);
    mocks.detail = guide({ article: { version: 4 } });
    await act(async () => mutation.resolve({ id: 7, version: 4 }));
  });
  it("preserves all values and six sections of an existing process instead of converting it", async () => {
    const sections = {
      whenToUse: "<p>When</p>",
      checks: "<p>Check</p>",
      steps: "<p>Steps</p>",
      agentWording: "<p>Wording</p>",
      exceptions: "<p>Exceptions</p>",
      related: "<p>Related</p>",
    };
    const content = {
      format: "process",
      sections,
      summary: "Keep summary",
      tags: ["one", "two"],
      ownerId: 100,
      isPinned: true,
      reviewedAt: new Date("2026-11-01"),
      nextReviewAt: new Date("2027-01-01"),
      contentHtml: "<p>Inactive article body stays intact</p>",
    };
    mocks.detail = guide({ content, published: null });
    await render(7);
    expect(field("Editor format").value).toBe("process");
    expect(container.querySelectorAll("textarea[aria-label]")).toHaveLength(6);
    await input("Title", "Only title changed");
    await submit();
    expect(mocks.mutate.mock.calls[0][1].content).toMatchObject(content);
    expect(mocks.mutate.mock.calls[0][1].changeSummary).toBe("Guide updated");
  });
  it.each(["financial", "legal", "policy"])(
    "hides quick publication for new %s guidance",
    async sensitivity => {
      await render();
      await input("Sensitivity", sensitivity);
      expect(findButton("Save & publish")).toBeUndefined();
      expect(container.textContent).toContain("Independent review required");
      expect(container.textContent).not.toContain(
        "Review & internal publication"
      );
      await titleAndBody();
      await submit();
      expect(mocks.mutate.mock.calls[0][0]).toBe("staffHandbook.saveArticle");
    }
  );
  it("never offers quick publication for an operational downgrade in a sensitive cycle", async () => {
    mocks.detail = guide({ article: { requiresIndependentReview: true } });
    await render(7);
    expect(findButton("Save & publish")).toBeUndefined();
    expect(details("Required independent review").open).toBe(true);
    expect(button("Publish internally").disabled).toBe(true);
    expect(findButton("Approve exact revision 2")).toBeUndefined();
    expect(container.textContent).toContain("previously sensitive publication");
    await click("Request review");
    expect(mocks.mutate.mock.calls[0]).toEqual([
      "staffHandbook.articleAction",
      { id: 7, expectedVersion: 3, action: "submit_review" },
    ]);
  });
  it("publishes an exact independently reviewed sensitive saved draft through articleAction only", async () => {
    mocks.detail = guide({
      content: { sensitivity: "financial" },
      article: { reviewedRevisionId: 12, reviewedById: 100 },
    });
    await render(7);
    expect(button("Publish internally").disabled).toBe(false);
    await click("Publish internally");
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Agents will not have access")
    );
    expect(mocks.mutate.mock.calls[0]).toEqual([
      "staffHandbook.articleAction",
      { id: 7, expectedVersion: 3, action: "publish" },
    ]);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
  it("editing sensitive reviewed content disables its publication until a new exact review", async () => {
    mocks.detail = guide({
      content: { sensitivity: "legal" },
      article: { reviewedRevisionId: 12, reviewedById: 100 },
    });
    await render(7);
    await input("Content", "<p>Changed sensitive content</p>");
    expect(button("Publish internally").disabled).toBe(true);
    expect(button("Request review").disabled).toBe(true);
    expect(field("Upload private attachment").disabled).toBe(true);
    expect(findButton("Save & publish")).toBeUndefined();
    await click("Publish internally");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("lets a noncontributing independent staff member approve the exact submitted revision", async () => {
    mocks.detail = guide({
      content: { sensitivity: "policy" },
      article: { submittedAt: new Date() },
      draft: { createdById: 100, contributorIds: [100] },
    });
    await render(7);
    await click("Approve exact revision 2");
    expect(mocks.mutate.mock.calls[0]).toEqual([
      "staffHandbook.articleAction",
      { id: 7, expectedVersion: 3, action: "approve" },
    ]);
  });
  it("retains drafts and disables actions after background version conflict or refresh failure", async () => {
    await render(7);
    await input("Title", "Keep unsaved title");
    mocks.detail = guide({ article: { version: 5 } });
    await render(7);
    expect(field("Title").value).toBe("Keep unsaved title");
    expect(button("Save draft").disabled).toBe(true);
    expect(button("Save & publish").disabled).toBe(true);
    mocks.queryError = new Error("Background refresh failed");
    await render(7);
    expect(field("Title").value).toBe("Keep unsaved title");
    expect(container.textContent).toContain("your edits are retained");
  });
  it("does not allow a successful existing save to be repeated after its readback fails", async () => {
    mocks.fetchArticle.mockRejectedValue(new Error("Readback unavailable"));
    await render(7);
    await input("Title", "Saved but not verified");
    await submit();
    // A background cache update alone must not bypass explicit reload.
    await render(7);
    expect(field("Title").value).toBe("Saved but not verified");
    expect(button("Save draft").disabled).toBe(true);
    expect(button("Save & publish").disabled).toBe(true);
    await submit();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    mocks.fetchArticle.mockResolvedValue(mocks.detail);
    await click("Reload latest");
    expect(onSaved).toHaveBeenCalledWith(7);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
  it("shows clear content validation for publication while allowing an empty draft", async () => {
    await render();
    await input("Title", "Empty draft allowed");
    await click("Save & publish");
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Add content before publishing");
    await click("Save draft");
    expect(mocks.mutate.mock.calls[0][0]).toBe("staffHandbook.saveArticle");
  });
  it("keeps archive optional and versioned without invoking publication", async () => {
    mocks.detail = guide({ content: { sensitivity: "financial" } });
    await render(7);
    expect(details("More options (archive & restore)").open).toBe(false);
    expect(button("Archive guide").closest("details")).toBe(
      details("More options (archive & restore)")
    );
    await click("Archive guide");
    expect(mocks.mutate.mock.calls[0]).toEqual([
      "staffHandbook.articleAction",
      { id: 7, expectedVersion: 3, action: "archive" },
    ]);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
  it("keeps unsaved-close confirmation and allows cancellation", async () => {
    await render();
    await input("Title", "Keep it");
    vi.mocked(window.confirm).mockReturnValue(false);
    await click("Back to guides");
    expect(window.confirm).toHaveBeenCalledWith(
      "Discard your unsaved guide edits?"
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(field("Title").value).toBe("Keep it");
  });
  it("blocks inline image paste and keeps all editors internal and restricted", async () => {
    await render();
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        files: [],
        getData: () => '<img src="https://example.invalid/private">',
      },
    });
    await act(async () => field("Content").dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);
    expect(container.querySelector("img, iframe")).toBeNull();
    expect(
      mocks.editors.every(
        props =>
          props.internalHandbook &&
          props.restrictedAcademy &&
          props.preserveClipboardFormatting
      )
    ).toBe(true);
  });
  it("keeps revision history immutable and private attachments collapsed", async () => {
    await render(7);
    expect(details("Private attachments (1)").open).toBe(false);
    expect(details("Revision history (read-only)").open).toBe(false);
    expect(details("Audit history (read-only)").open).toBe(false);
    await click("Revision 2 · 1 Nov 2026 · Previous note");
    const historic = container.querySelector("[data-handbook-history]")!;
    expect(
      historic.querySelector("input, textarea, form, [contenteditable]")
    ).toBeNull();
    expect(
      historic.querySelector('a[href="/api/staff-handbook/resource/4"]')
    ).toBeTruthy();
    expect(findButton("Save & publish")).toBeUndefined();
  });
  it("fails closed and removes cached private content on atomic save permission denial", async () => {
    const denied = Object.assign(new Error("Staff access removed"), {
      data: { code: "FORBIDDEN" },
    });
    mocks.mutate.mockRejectedValue(denied);
    await render();
    await titleAndBody();
    cache.setQueryData(
      [["staffHandbook", "article"], { input: { id: 7 }, type: "query" }],
      mocks.detail
    );
    await click("Save & publish");
    expect(container.querySelector("[data-handbook-article]")).toBeNull();
    expect(container.textContent).toContain(
      "All handbook content and unsaved edits have been cleared"
    );
    expect(
      cache.getQueryCache().findAll({ queryKey: [["staffHandbook"]] })
    ).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });
  it("does not open a saved guide when fresh readback denies authority", async () => {
    mocks.fetchArticle.mockRejectedValue(
      Object.assign(new Error("Access revoked"), {
        data: { code: "FORBIDDEN" },
      })
    );
    await render();
    await titleAndBody();
    await submit();
    expect(container.querySelector("[data-handbook-article]")).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Simple new guide");
  });
  it("denies cached detail on an initial permission error", async () => {
    mocks.queryError = Object.assign(new Error("Unauthorized"), {
      data: { code: "UNAUTHORIZED" },
    });
    await render(7);
    expect(container.querySelector("[data-handbook-article]")).toBeNull();
    expect(container.textContent).not.toContain("Saved body");
  });
});

it("retains changed edits after a lost-response creation retry conflicts with the already saved draft", async () => {
  const conflict = Object.assign(new Error("Guide #7 already exists from this save attempt, but these changed edits have not been saved. Your edits are retained."), { data: { code: "CONFLICT" } });
  mocks.mutate.mockRejectedValueOnce(new Error("Synthetic save response was lost")).mockRejectedValueOnce(conflict);
  await render(); await titleAndBody(); await submit();
  const token = mocks.mutate.mock.calls[0][1].createToken;
  await input("Title", "Changed after lost response");
  await input("Content", "<p>Newer edits must not be discarded.</p>");
  await submit();
  expect(mocks.mutate.mock.calls[1][1]).toMatchObject({ createToken: token, content: expect.objectContaining({ title: "Changed after lost response", contentHtml: "<p>Newer edits must not be discarded.</p>" }) });
  expect(field("Title").value).toBe("Changed after lost response");
  expect(field("Content").value).toContain("Newer edits must not be discarded");
  expect(container.textContent).toContain("these changed edits have not been saved");
  expect(container.textContent).toContain("Unsaved changes");
  expect(onSaved).not.toHaveBeenCalled();
  expect(mocks.fetchArticle).not.toHaveBeenCalled();
});
