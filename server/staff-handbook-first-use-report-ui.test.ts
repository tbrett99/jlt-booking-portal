// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestDto } from "../client/src/pages/admin/StaffHandbookComponents";

type LinkInput = {
  type: "guides" | "reports";
  scope: "active" | "published";
  search?: string;
  selectedId?: number | null;
  excludeId?: number;
  page: number;
};
type LinkOption = {
  id: number;
  title: string;
  category: string;
  state: string;
};
type LinkResult = {
  items: LinkOption[];
  selected: LinkOption | null;
  total: number;
  page: number;
  pageSize: number;
};
type QueryResult<T> = {
  data?: T;
  isError?: boolean;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
};
type Detail = {
  request: RequestDto;
  comments: {
    id: number;
    authorId: number;
    body: string;
    createdAt: Date | string;
  }[];
  audit: [];
};
type MutationInput = Partial<RequestDto> & {
  expectedVersion?: number;
  createToken?: string;
  body?: string;
};
const mocks = vi.hoisted(() => ({
  detail: undefined as unknown as Detail,
  requestState: {} as QueryResult<Detail>,
  linkState: {} as QueryResult<LinkResult>,
  // Separate revision labels: a published query must never get a draft title.
  activeGuides: [] as LinkOption[],
  publishedGuides: [] as LinkOption[],
  reports: [] as LinkOption[],
  queries: [] as {
    path: string;
    input: LinkInput | { id: number };
    options: { enabled?: boolean; placeholderData?: unknown };
  }[],
  mutate: vi.fn(),
  recover: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  pending: {} as Record<string, boolean>,
  errors: {} as Record<string, unknown>,
}));
vi.mock("@/lib/trpc", () => {
  function linkResult(input: LinkInput): LinkResult {
    const source =
      input.type === "reports"
        ? mocks.reports
        : input.scope === "published"
          ? mocks.publishedGuides
          : mocks.activeGuides;
    const eligible = source.filter(item => item.id !== input.excludeId);
    const matching = eligible.filter(
      item =>
        !input.search ||
        `${item.title} ${item.category}`
          .toLowerCase()
          .includes(input.search.toLowerCase())
    );
    const pageSize = 20;
    return {
      items: matching.slice((input.page - 1) * pageSize, input.page * pageSize),
      selected: eligible.find(item => item.id === input.selectedId) ?? null,
      total: matching.length,
      page: input.page,
      pageSize,
    };
  }
  const node = (path = ""): object =>
    new Proxy(
      {},
      {
        get: (_target, key: string): unknown => {
          if (key === "useUtils") return () => node();
          if (key === "useQuery")
            return (
              input: LinkInput | { id: number },
              options: { enabled?: boolean; placeholderData?: unknown }
            ) => {
              mocks.queries.push({ path, input, options });
              if (
                path !== "staffHandbook.request" &&
                path !== "staffHandbook.linkOptions"
              )
                throw new Error(`Unexpected/network query ${path}`);
              const state =
                path === "staffHandbook.request"
                  ? mocks.requestState
                  : mocks.linkState;
              return {
                isError: false,
                isLoading: false,
                isFetching: false,
                refetch: mocks.refetch,
                data:
                  options?.enabled === false
                    ? undefined
                    : path === "staffHandbook.request"
                      ? mocks.detail
                      : linkResult(input as LinkInput),
                ...state,
              };
            };
          if (key === "useMutation")
            return () => {
              if (
                ![
                  "staffHandbook.createRequest",
                  "staffHandbook.updateRequest",
                  "staffHandbook.updateRecoveredRequest",
                  "staffHandbook.createGuideFromRequest",
                  "staffHandbook.addComment",
                ].includes(path)
              )
                throw new Error(`Unexpected mutation ${path}`);
              return {
                isPending: mocks.pending[path] ?? false,
                error: mocks.errors[path],
                mutateAsync: (input: MutationInput) =>
                  mocks.mutate(path, input),
              };
            };
          if (key === "fetch") {
            if (path !== "staffHandbook.recoverRequest")
              throw new Error(`Unexpected/network fetch ${path}`);
            return (...args: unknown[]) => mocks.recover(...args);
          }
          if (key === "invalidate")
            return (...args: unknown[]) => mocks.invalidate(path, ...args);
          return node(path ? `${path}.${key}` : key);
        },
      }
    );
  return { trpc: node() };
});
import {
  ReportKnowledge,
  RequestPanel,
} from "../client/src/pages/admin/StaffHandbookRequests";

let root: Root;
let container: HTMLDivElement;
let cache: QueryClient;
let onCreated: ReturnType<typeof vi.fn>;
let onCancel: ReturnType<typeof vi.fn>;
let onGuide: ReturnType<typeof vi.fn>;
let onReport: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;
let onReload: ReturnType<typeof vi.fn>;
const titleLabel = "What guidance is missing?";
const descriptionLabel = "What do staff need to know?";
const managementLabel = "Update progress or edit this report";
const answeredLabel = "Mark this report answered by a published guide";
const duplicateLabel = "The same question is already in another report";
const publishedTitle = "Reimbursement documents checklist";
const draftTitle = "Unpublished supplier escalation notes";
const otherReportTitle = "Which reimbursement documents should we ask for?";
function detail(extra: Partial<RequestDto> = {}): Detail {
  return {
    request: {
      id: 8,
      version: 2,
      title: "Which documents are missing from our guidance?",
      description:
        "Staff need a checklist for requesting reimbursement documents.\nPlease explain what to collect.",
      category: "General",
      kind: "missing_process",
      checkedGuidance: null,
      impact: null,
      priority: "normal",
      status: "new",
      reporterId: 99,
      assigneeId: null,
      articleId: null,
      resolvedRevisionId: null,
      duplicateOfId: null,
      closureReason: null,
      createdAt: "2026-11-01T10:00:00Z",
      updatedAt: "2026-11-01T10:00:00Z",
      ...extra,
    },
    comments: [],
    audit: [],
  };
}
async function render(element: React.ReactElement) {
  await act(async () =>
    root.render(
      React.createElement(QueryClientProvider, { client: cache }, element)
    )
  );
}
async function report() {
  await render(
    React.createElement(ReportKnowledge, {
      categories: ["Operations"],
      onCreated,
      onCancel,
    })
  );
}
async function panel(withReportNavigation = false) {
  await render(
    React.createElement(RequestPanel, {
      id: 8,
      categories: ["General", "Operations"],
      staff: [{ id: 99, name: "Morgan Staff" }],
      onGuide,
      ...(withReportNavigation ? { onReport } : {}),
      onClose,
      onReload,
    })
  );
}
function field(
  label: string
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const found = Array.from(container.querySelectorAll("label")).find(
    el => el.textContent?.trim() === label
  );
  expect(found, `field ${label}`).toBeTruthy();
  const control = document.getElementById(found!.htmlFor);
  expect(control, `associated control ${label}`).toBeTruthy();
  return control as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
}
async function input(label: string, value: string) {
  const control = field(label);
  await act(async () => {
    const prototype =
      control.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : control.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      control,
      value
    );
    control.dispatchEvent(
      new Event(control.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      })
    );
  });
}
function button(label: string) {
  const found = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button")
  ).find(el => el.textContent?.replace(/\s+/g, " ").trim() === label);
  expect(found, `button ${label}`).toBeTruthy();
  return found!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function checkbox(label: string) {
  const found = Array.from(container.querySelectorAll("label"))
    .find(el => el.textContent?.trim() === label)
    ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  expect(found, `checkbox ${label}`).toBeTruthy();
  await act(async () => found!.click());
}
async function toggle(label: string, open = true) {
  const summary = Array.from(container.querySelectorAll("summary")).find(
    el => el.textContent?.trim() === label
  );
  expect(summary, `disclosure ${label}`).toBeTruthy();
  const disclosure = summary!.parentElement as HTMLDetailsElement;
  await act(async () => {
    disclosure.open = open;
    disclosure.dispatchEvent(new Event("toggle"));
  });
  return disclosure;
}
function submitEvent(form: HTMLFormElement) {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
async function submitContaining(label: string) {
  const form = field(label).closest("form")!;
  await act(async () => submitEvent(form));
}
async function primary() {
  await input(titleLabel, "  Missing guidance  ");
  await input(descriptionLabel, "  Staff need a document checklist.  ");
}
function lastLinkInput(): LinkInput {
  return mocks.queries
    .filter(query => query.path === "staffHandbook.linkOptions")
    .at(-1)!.input as LinkInput;
}
async function choose(type: "guides" | "reports", title: string) {
  await click(type === "guides" ? "Choose a guide" : "Choose a report");
  await input(
    type === "guides" ? "Find a guide by title" : "Find a report by title",
    title
  );
  const list = container.querySelector(
    `[aria-label="${type === "guides" ? "Guide" : "Report"} choices"]`
  )!;
  const choice = Array.from(
    list.querySelectorAll<HTMLButtonElement>("button")
  ).find(el => el.querySelector("span")?.textContent === title);
  expect(choice, `named option ${title}`).toBeTruthy();
  await act(async () => choice!.click());
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function expectNoVisibleIds() {
  expect(container.querySelector('input[type="number"]')).toBeNull();
  expect(
    Array.from(container.querySelectorAll("label"), el => el.textContent).join(
      " "
    )
  ).not.toMatch(/guide id|report id|request id|article id|duplicate.*id/i);
  expect(container.querySelector("header")?.textContent ?? "").not.toMatch(
    /#\d+|\bID\b|version\s*\d+/i
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No network permitted in first-use report tests");
    })
  );
  vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(() => {
    throw new Error("No XMLHttpRequest network permitted");
  });
  window.happyDOM.settings.disableJavaScriptFileLoading = true;
  window.happyDOM.settings.disableCSSFileLoading = true;
  window.happyDOM.settings.enableJavaScriptEvaluation = false;
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mocks.detail = detail();
  mocks.requestState = {};
  mocks.linkState = {};
  mocks.queries = [];
  mocks.pending = {};
  mocks.errors = {};
  mocks.activeGuides = [
    {
      id: 7,
      title: publishedTitle,
      category: "Operations",
      state: "published",
    },
    { id: 12, title: draftTitle, category: "General", state: "draft" },
    {
      id: 14,
      title: "Private unpublished change title",
      category: "Operations",
      state: "changes",
    },
  ];
  mocks.publishedGuides = [
    {
      id: 7,
      title: publishedTitle,
      category: "Operations",
      state: "published",
    },
    {
      id: 14,
      title: "Published supplier checklist",
      category: "Operations",
      state: "published",
    },
  ];
  mocks.reports = [
    {
      id: 8,
      title: mocks.detail.request.title,
      category: "General",
      state: "new",
    },
    {
      id: 9,
      title: otherReportTitle,
      category: "Operations",
      state: "assigned",
    },
  ];
  mocks.recover.mockResolvedValue({ request: null });
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue(undefined);
  mocks.mutate.mockImplementation(
    async (path: string, payload: MutationInput) => {
      if (path === "staffHandbook.createRequest") return { id: 8, version: 1 };
      if (path === "staffHandbook.createGuideFromRequest") {
        mocks.detail = detail({
          ...mocks.detail.request,
          articleId: 12,
          status: "drafting",
          assigneeId: 99,
          version: 3,
        });
        return { articleId: 12 };
      }
      const version =
        (payload.expectedVersion ?? mocks.detail.request.version) + 1;
      if (
        path === "staffHandbook.updateRequest" ||
        path === "staffHandbook.updateRecoveredRequest"
      ) {
        const {
          expectedVersion: _expected,
          createToken: _token,
          body: _body,
          ...saved
        } = payload;
        mocks.detail = {
          ...mocks.detail,
          request: { ...mocks.detail.request, ...saved, version },
        };
      } else if (path === "staffHandbook.addComment") {
        mocks.detail = {
          ...mocks.detail,
          request: { ...mocks.detail.request, version },
          comments: [
            ...mocks.detail.comments,
            {
              id: 1,
              authorId: 99,
              body: payload.body!,
              createdAt: "2026-11-02T10:00:00Z",
            },
          ],
        };
      }
      return { id: 8, version };
    }
  );
  onCreated = vi.fn();
  onCancel = vi.fn();
  onGuide = vi.fn();
  onReport = vi.fn();
  onClose = vi.fn();
  onReload = vi.fn();
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
  expect(XMLHttpRequest.prototype.open).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("first-use missing-guidance report journey", () => {
  it("starts with title, description, General and Submit report, with optional controls unmounted", async () => {
    await report();
    expect(container.querySelector("h2")?.textContent).toBe(
      "Report missing guidance"
    );
    expect(
      Array.from(container.querySelectorAll("label"), el =>
        el.textContent?.trim()
      )
    ).toEqual([titleLabel, descriptionLabel, "Category"]);
    expect(field("Category").value).toBe("General");
    expect(button("Submit report").disabled).toBe(false);
    expect(container.querySelector("details")?.open).toBe(false);
    expect(
      container.querySelector("details input, details textarea, details select")
    ).toBeNull();
    expect(mocks.queries).toHaveLength(0);
    expectNoVisibleIds();
    await toggle("Optional details");
    expect(field("How urgent is this?").value).toBe("normal");
    expect(field("What needs improving?").value).toBe("missing_process");
    expect(button("Choose a guide")).toBeTruthy();
    expect(lastLinkInput()).toMatchObject({
      type: "guides",
      scope: "active",
      selectedId: null,
      page: 1,
    });
    await toggle("Optional details", false);
    expect(
      container.querySelector("details input, details textarea, details select")
    ).toBeNull();
  });

  it("submits only primary fields once even for two same-tick events", async () => {
    const save = deferred<{ id: number; version: number }>();
    mocks.mutate.mockReturnValue(save.promise);
    await report();
    await primary();
    const form = container.querySelector("form")!;
    await act(async () => {
      submitEvent(form);
      submitEvent(form);
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith("staffHandbook.createRequest", {
      createToken: expect.any(String),
      title: "Missing guidance",
      description: "Staff need a document checklist.",
      category: "General",
      kind: "missing_process",
      checkedGuidance: "",
      impact: "",
      priority: "normal",
      articleId: null,
    });
    expect(button("Submitting…").disabled).toBe(true);
    await act(async () => {
      save.resolve({ id: 8, version: 1 });
      await save.promise;
    });
    expect(onCreated).toHaveBeenCalledWith(8);
    await act(async () => submitEvent(form));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it("retains inputs on uncertain save and keeps the same idempotency token for retry", async () => {
    mocks.mutate.mockRejectedValueOnce(
      new Error("Connection lost after submitting")
    );
    await report();
    await primary();
    await click("Submit report");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Your report is retained"
    );
    expect(field(titleLabel).value).toBe("  Missing guidance  ");
    expect(field(descriptionLabel).value).toBe(
      "  Staff need a document checklist.  "
    );
    const token = mocks.mutate.mock.calls[0][1].createToken;
    await click("Submit report");
    expect(mocks.mutate.mock.calls[1][1].createToken).toBe(token);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("shows saved-vs-refresh-failed status without offering another create", async () => {
    mocks.invalidate.mockRejectedValue(new Error("Refresh failed"));
    await report();
    await primary();
    await click("Submit report");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "was saved, but the page could not refresh"
    );
    expect(container.querySelector("form")).toBeNull();
    await report();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    await click("View your saved report");
    expect(onCreated).toHaveBeenCalledWith(8);
    expectNoVisibleIds();
  });
});

describe("recovering a report after losing the create response", () => {
  const recoverLabel = "Check whether my report was saved";
  const saveRecoveredLabel = "Save changes to my saved report";

  it("recovers the exact create token and saves all latest edits to the original ID/version without a duplicate", async () => {
    const savedByToken = new Map<string, RequestDto>();
    mocks.mutate.mockImplementation(
      async (path: string, payload: MutationInput) => {
        if (path === "staffHandbook.createRequest") {
          savedByToken.set(
            payload.createToken!,
            detail({
              ...payload,
              id: 73,
              version: 4,
              status: "new",
            }).request
          );
          throw new Error("Response lost after the report was committed");
        }
        if (path !== "staffHandbook.updateRecoveredRequest")
          throw new Error(`Unexpected mutation ${path}`);
        const saved = savedByToken.get(payload.createToken!)!;
        expect(payload.id).toBe(saved.id);
        expect(payload.expectedVersion).toBe(saved.version);
        savedByToken.set(payload.createToken!, {
          ...saved,
          ...payload,
          version: 5,
        });
        return { id: saved.id, version: 5 };
      }
    );
    mocks.recover.mockImplementation(
      async ({ createToken }: { createToken: string }) => ({
        request: savedByToken.get(createToken) ?? null,
      })
    );
    await report();
    await primary();
    const form = container.querySelector("form")!;
    const titleControl = field(titleLabel);
    const descriptionControl = field(descriptionLabel);
    await click("Submit report");
    const createToken = mocks.mutate.mock.calls[0][1].createToken;
    expect(savedByToken.get(createToken)?.title).toBe("Missing guidance");
    expect(button(recoverLabel).disabled).toBe(false);
    expect(mocks.recover).not.toHaveBeenCalled();
    await input(titleLabel, "  Latest missing guidance  ");
    await input(
      descriptionLabel,
      "  Latest checklist, not the earlier saved text.\nInclude escalation.  "
    );
    await input("Category", "Operations");
    await toggle("Optional details");
    await input("How urgent is this?", "high");
    await input("What needs improving?", "unclear");
    await input(
      "Where have you already looked? (optional)",
      "  Latest search notes  "
    );
    await input(
      "How is this affecting staff? (optional)",
      "  Latest staff impact  "
    );
    await choose("guides", publishedTitle);
    await click(recoverLabel);
    expect(mocks.recover).toHaveBeenCalledTimes(1);
    expect(mocks.recover).toHaveBeenCalledWith(
      { createToken },
      { staleTime: 0 }
    );
    expect(container.querySelector("form")).toBe(form);
    expect(field(titleLabel)).toBe(titleControl);
    expect(field(descriptionLabel)).toBe(descriptionControl);
    expect(titleControl.value).toBe("  Latest missing guidance  ");
    expect(descriptionControl.value).toBe(
      "  Latest checklist, not the earlier saved text.\nInclude escalation.  "
    );
    expect(container.textContent).toContain("Your latest text is still below");
    expect(onCreated).not.toHaveBeenCalled();
    expect(button(saveRecoveredLabel).disabled).toBe(false);
    expectNoVisibleIds();
    // Edits made after recovery must also be included, not a captured create payload.
    await input(
      "How is this affecting staff? (optional)",
      "  Final staff impact  "
    );
    await click(saveRecoveredLabel);
    expect(mocks.mutate.mock.calls).toEqual([
      ["staffHandbook.createRequest", expect.objectContaining({ createToken })],
      [
        "staffHandbook.updateRecoveredRequest",
        {
          id: 73,
          expectedVersion: 4,
          createToken,
          title: "Latest missing guidance",
          description:
            "Latest checklist, not the earlier saved text.\nInclude escalation.",
          category: "Operations",
          kind: "unclear",
          checkedGuidance: "Latest search notes",
          impact: "Final staff impact",
          priority: "high",
          articleId: 7,
        },
      ],
    ]);
    expect(savedByToken.size).toBe(1);
    expect(savedByToken.get(createToken)?.title).toBe(
      "Latest missing guidance"
    );
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(73);
    expect(container.querySelector("form")).toBeNull();
    await act(async () => submitEvent(form));
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
  });

  it("retains the same mounted latest inputs on a failed recovery query and can check again with the same token", async () => {
    mocks.mutate.mockRejectedValueOnce(new Error("Create response lost"));
    mocks.recover.mockRejectedValueOnce(
      new Error("Recovery connection unavailable")
    );
    await report();
    await primary();
    await click("Submit report");
    const createToken = mocks.mutate.mock.calls[0][1].createToken;
    await input(titleLabel, "Latest title retained while offline");
    await input(descriptionLabel, "Latest description retained while offline");
    const titleControl = field(titleLabel);
    const descriptionControl = field(descriptionLabel);
    await click(recoverLabel);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Your latest text is retained"
    );
    expect(field(titleLabel)).toBe(titleControl);
    expect(field(descriptionLabel)).toBe(descriptionControl);
    expect(titleControl.value).toBe("Latest title retained while offline");
    expect(descriptionControl.value).toBe(
      "Latest description retained while offline"
    );
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
    mocks.recover.mockResolvedValueOnce({
      request: detail({ id: 73, version: 4 }).request,
    });
    await click(recoverLabel);
    expect(mocks.recover.mock.calls).toEqual([
      [{ createToken }, { staleTime: 0 }],
      [{ createToken }, { staleTime: 0 }],
    ]);
    expect(titleControl.value).toBe("Latest title retained while offline");
    expect(button(saveRecoveredLabel).disabled).toBe(false);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it.each(["FORBIDDEN", "UNAUTHORIZED"])(
    "hides and clears all local/recovered/cache content on %s recovery denial",
    async code => {
      mocks.mutate.mockRejectedValueOnce(new Error("Create response lost"));
      mocks.recover.mockResolvedValueOnce({
        request: detail({
          id: 73,
          version: 4,
          title: "Private earlier saved report",
        }).request,
      });
      await report();
      await primary();
      await click("Submit report");
      await input(titleLabel, "Private latest local report title");
      await input(descriptionLabel, "Private latest local description");
      await click(recoverLabel);
      expect(container.textContent).toContain("Private earlier saved report");
      cache.setQueryData([["staffHandbook", "recoverRequest"]], {
        private: "Private cached recovery",
      });
      cache.setQueryData([["staffHandbook", "request"]], {
        private: "Private cached report",
      });
      mocks.recover.mockRejectedValueOnce({ data: { code } });
      const form = container.querySelector("form")!;
      await click(recoverLabel);
      expect(container.textContent).toContain("access could not be authorized");
      expect(
        container.querySelector("input, textarea, select, form")
      ).toBeNull();
      for (const privateText of [
        "Private earlier saved report",
        "Private latest local report title",
        "Private latest local description",
        "Private cached recovery",
        "Private cached report",
      ])
        expect(container.textContent).not.toContain(privateText);
      expect(
        cache.getQueryCache().findAll({ queryKey: [["staffHandbook"]] })
      ).toHaveLength(0);
      expect(mocks.invalidate).toHaveBeenCalledWith(
        "auth.me",
        undefined,
        undefined,
        { throwOnError: true }
      );
      await report();
      expect(
        container.querySelector("input, textarea, select, form")
      ).toBeNull();
      await act(async () => submitEvent(form));
      expect(mocks.mutate).toHaveBeenCalledTimes(1);
      expect(onCreated).not.toHaveBeenCalled();
    }
  );

  it.each(["assigned", "drafting", "in_review", "resolved", "closed"] as const)(
    "never overwrites a recovered %s report, and confirms before discarding local text to view it",
    async status => {
      mocks.mutate.mockRejectedValueOnce(new Error("Create response lost"));
      mocks.recover.mockResolvedValueOnce({
        request: detail({ id: 73, version: 6, status }).request,
      });
      await report();
      await primary();
      await click("Submit report");
      await input(titleLabel, "Keep my latest unsaved title");
      await input(descriptionLabel, "Keep my latest unsaved description");
      await click(recoverLabel);
      expect(button(saveRecoveredLabel).disabled).toBe(true);
      await click(saveRecoveredLabel);
      // Enter/programmatic submit must not bypass the progressed-status guard.
      await submitContaining(titleLabel);
      expect(mocks.mutate).toHaveBeenCalledTimes(1);
      expect(field(titleLabel).value).toBe("Keep my latest unsaved title");
      expect(field(descriptionLabel).value).toBe(
        "Keep my latest unsaved description"
      );
      expect(container.textContent).toContain(
        "Staff have already updated this report"
      );
      vi.mocked(window.confirm).mockReturnValue(false);
      await click("View the saved report");
      expect(window.confirm).toHaveBeenCalledWith(
        "Open the saved report? Your unsaved text here will be discarded. Cancel to keep or copy it first."
      );
      expect(onCreated).not.toHaveBeenCalled();
      expect(field(titleLabel).value).toBe("Keep my latest unsaved title");
      vi.mocked(window.confirm).mockReturnValue(true);
      await click("View the saved report");
      expect(onCreated).toHaveBeenCalledTimes(1);
      expect(onCreated).toHaveBeenCalledWith(73);
      expect(mocks.mutate).toHaveBeenCalledTimes(1);
    }
  );

  it("allows a safe retry with the same create token and latest text when recovery returns no saved report", async () => {
    mocks.mutate.mockRejectedValueOnce(
      new Error("Create failed before saving")
    );
    await report();
    await primary();
    await click("Submit report");
    const originalPayload = mocks.mutate.mock.calls[0][1];
    await input(titleLabel, "Latest title for a safe retry");
    await input(descriptionLabel, "Latest description for a safe retry");
    await click(recoverLabel);
    expect(mocks.recover).toHaveBeenCalledTimes(1);
    expect(mocks.recover).toHaveBeenCalledWith(
      { createToken: originalPayload.createToken },
      { staleTime: 0 }
    );
    expect(container.textContent).toContain("No saved report was found");
    expect(button("Submit report").disabled).toBe(false);
    expect(field(titleLabel).value).toBe("Latest title for a safe retry");
    expect(onCreated).not.toHaveBeenCalled();
    await click("Submit report");
    expect(mocks.mutate.mock.calls).toEqual([
      ["staffHandbook.createRequest", originalPayload],
      [
        "staffHandbook.createRequest",
        {
          ...originalPayload,
          title: "Latest title for a safe retry",
          description: "Latest description for a safe retry",
        },
      ],
    ]);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(8);
  });

  it("prevents same-tick recovery checks and submissions while checking, without clearing latest text", async () => {
    const recovery = deferred<{ request: RequestDto | null }>();
    mocks.mutate.mockRejectedValueOnce(new Error("Create response lost"));
    mocks.recover.mockReturnValue(recovery.promise);
    await report();
    await primary();
    await click("Submit report");
    await input(titleLabel, "Latest title during recovery");
    const check = button(recoverLabel);
    await act(async () => {
      check.click();
      check.click();
    });
    expect(mocks.recover).toHaveBeenCalledTimes(1);
    expect(button(recoverLabel).disabled).toBe(true);
    expect(button("Submitting…").disabled).toBe(true);
    expect(button("Cancel report").disabled).toBe(true);
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
    await submitContaining(titleLabel);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    await act(async () => {
      recovery.resolve({ request: detail({ id: 73, version: 4 }).request });
      await recovery.promise;
    });
    expect(field(titleLabel).value).toBe("Latest title during recovery");
    expect(button(saveRecoveredLabel).disabled).toBe(false);
  });
});

describe("first-use readable report and writing journey", () => {
  it("shows readable report content and an easy comment, not a mounted management form", async () => {
    mocks.detail.comments = [
      {
        id: 1,
        authorId: 99,
        body: "Existing staff suggestion",
        createdAt: "2026-11-01T11:00:00Z",
      },
    ];
    await panel();
    expect(container.querySelector("header h2")?.textContent).toBe(
      mocks.detail.request.title
    );
    expect(container.querySelector("header")?.textContent).toContain(
      "Reported by Morgan Staff"
    );
    expect(container.textContent).toContain(mocks.detail.request.description);
    expect(container.textContent).toContain("Existing staff suggestion");
    expect(
      Array.from(container.querySelectorAll("label"), el =>
        el.textContent?.trim()
      )
    ).toEqual(["Add a comment"]);
    expect(
      container.querySelector("details input, details textarea, details select")
    ).toBeNull();
    expect(button("Write a guide")).toBeTruthy();
    expect(button("Link an existing guide")).toBeTruthy();
    expect(button("Add comment").disabled).toBe(true);
    expect(mocks.queries.map(query => query.path)).toEqual([
      "staffHandbook.request",
    ]);
    expectNoVisibleIds();
    await input("Add a comment", "An easy staff suggestion");
    expect(button("Add comment").disabled).toBe(false);
    await click("Add comment");
    expect(mocks.mutate).toHaveBeenCalledWith("staffHandbook.addComment", {
      id: 8,
      expectedVersion: 2,
      body: "An easy staff suggestion",
    });
    expect(field("Add a comment").value).toBe("");
  });

  it("Write a guide is one click, creates only a draft, then opens its editor without publishing", async () => {
    await panel();
    await click("Write a guide");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(mocks.mutate.mock.calls).toEqual([
      [
        "staffHandbook.createGuideFromRequest",
        { id: 8, expectedVersion: 2, createToken: expect.any(String) },
      ],
    ]);
    expect(onGuide).toHaveBeenCalledTimes(1);
    expect(onGuide).toHaveBeenCalledWith(12, true);
    expect(mocks.detail.request.status).toBe("drafting");
    expect(container.textContent).toContain(
      "report stays open until the guide is published"
    );
  });

  it("blocks same-tick and in-flight duplicate draft creation", async () => {
    const draft = deferred<{ articleId: number }>();
    mocks.mutate.mockReturnValue(draft.promise);
    await panel();
    const write = button("Write a guide");
    await act(async () => {
      write.click();
      write.click();
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(button("Write a guide").disabled).toBe(true);
    await act(async () => {
      draft.resolve({ articleId: 12 });
      await draft.promise;
    });
    expect(onGuide).toHaveBeenCalledWith(12, true);
    expect(button("Open saved draft")).toBeTruthy();
    await act(async () => write.click());
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it("does not discard an unsent comment or create a draft after cancelled writing navigation", async () => {
    await panel();
    await input("Add a comment", "Keep this unsent suggestion");
    vi.mocked(window.confirm).mockReturnValue(false);
    await click("Write a guide");
    expect(window.confirm).toHaveBeenCalledWith(
      "Discard your unsent comment and start writing a guide?"
    );
    expect(field("Add a comment").value).toBe("Keep this unsent suggestion");
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(onGuide).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("Write a guide");
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(onGuide).toHaveBeenCalledWith(12, true);
  });

  it("retains unsent comment when uncertain draft creation fails and reuses its token", async () => {
    mocks.mutate.mockRejectedValueOnce(new Error("Uncertain draft save"));
    await panel();
    await input("Add a comment", "Keep comment on error");
    await click("Write a guide");
    expect(field("Add a comment").value).toBe("Keep comment on error");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Your report has not been cleared"
    );
    const token = mocks.mutate.mock.calls[0][1].createToken;
    await click("Write a guide");
    expect(mocks.mutate.mock.calls[1][1].createToken).toBe(token);
    expect(onGuide).toHaveBeenCalledWith(12, true);
  });

  it("keeps an already-saved draft accessible when refresh fails without creating another", async () => {
    mocks.invalidate.mockRejectedValue(new Error("Refresh lost"));
    await panel();
    await click("Write a guide");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "guide draft was created, but the page could not refresh"
    );
    expect(onGuide).not.toHaveBeenCalled();
    expect(
      Array.from(container.querySelectorAll("button")).some(
        el => el.textContent === "Write a guide"
      )
    ).toBe(false);
    await panel();
    await click("Open saved draft");
    expect(onGuide).toHaveBeenCalledWith(12, true);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it("guards open-saved-draft navigation when a comment is still unsent", async () => {
    mocks.invalidate.mockRejectedValue(new Error("Refresh lost"));
    await panel();
    await click("Write a guide");
    await input("Add a comment", "Unsent note before opening the saved draft");
    vi.mocked(window.confirm).mockReturnValue(false);
    await click("Open saved draft");
    expect(window.confirm).toHaveBeenCalledWith(
      "Discard unsaved report changes and open the guide?"
    );
    expect(onGuide).not.toHaveBeenCalled();
    expect(field("Add a comment").value).toBe(
      "Unsent note before opening the saved draft"
    );
  });
});

describe("named guide linking and published answers", () => {
  it("searches published labels and answers by internal selected ID, without a closure note", async () => {
    await panel();
    await click("Link an existing guide");
    expect(
      container.querySelector('[aria-label="Guide to link"]')
    ).toBeTruthy();
    expect(lastLinkInput()).toMatchObject({
      type: "guides",
      scope: "active",
      selectedId: null,
      page: 1,
    });
    await checkbox(answeredLabel);
    expect(lastLinkInput()).toMatchObject({
      type: "guides",
      scope: "published",
      selectedId: null,
      page: 1,
    });
    await click("Choose a guide");
    const list = container.querySelector('[aria-label="Guide choices"]')!;
    expect(list.textContent).toContain(publishedTitle);
    expect(list.textContent).toContain("Published supplier checklist");
    expect(list.textContent).not.toContain(draftTitle);
    expect(list.textContent).not.toContain("Private unpublished change title");
    await input("Find a guide by title", "Reimbursement");
    expect(lastLinkInput()).toMatchObject({
      type: "guides",
      scope: "published",
      search: "Reimbursement",
      page: 1,
    });
    const choice = container.querySelector<HTMLButtonElement>(
      '[aria-label="Guide choices"] button'
    )!;
    await act(async () => choice.click());
    expect(lastLinkInput().selectedId).toBe(7);
    expect(
      container.querySelector('[aria-label="Guide that answers this question"]')
        ?.textContent
    ).toContain(publishedTitle);
    expect(container.textContent).not.toContain(
      "Why are you closing this report?"
    );
    expectNoVisibleIds();
    await click("Save report changes");
    expect(mocks.mutate).toHaveBeenCalledWith("staffHandbook.updateRequest", {
      id: 8,
      expectedVersion: 2,
      title: detail().request.title,
      description: detail().request.description,
      category: "General",
      status: "resolved",
      priority: "normal",
      assigneeId: null,
      articleId: 7,
      duplicateOfId: null,
      closureReason: null,
    });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Report answered. The published guide is linked."
    );
  });

  it("linking a draft leaves the report open and never publishes or resolves it", async () => {
    await panel();
    await click("Link an existing guide");
    await choose("guides", draftTitle);
    expect(lastLinkInput()).toMatchObject({
      type: "guides",
      scope: "active",
      selectedId: 12,
    });
    expect(
      container.querySelector('[aria-label="Guide to link"]')?.textContent
    ).toContain("Draft");
    await click("Save report changes");
    expect(mocks.mutate.mock.calls).toEqual([
      [
        "staffHandbook.updateRequest",
        expect.objectContaining({
          articleId: 12,
          status: "new",
          closureReason: null,
        }),
      ],
    ]);
    expect(mocks.detail.request.status).toBe("new");
    expect(container.textContent).toContain("Linking a draft leaves it open");
  });

  it("requires a guide for the answered state rather than accepting a closure note", async () => {
    await panel();
    await click("Link an existing guide");
    await checkbox(answeredLabel);
    await click("Save report changes");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Choose a published guide before marking this report answered"
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(
      "Why are you closing this report?"
    );
  });

  it("a draft selection becomes unavailable in published scope and never leaks its title there", async () => {
    await panel();
    await click("Link an existing guide");
    await choose("guides", draftTitle);
    await checkbox(answeredLabel);
    expect(lastLinkInput()).toMatchObject({
      type: "guides",
      scope: "published",
      selectedId: 12,
    });
    expect(
      container.querySelector('[aria-label="Guide that answers this question"]')
        ?.textContent
    ).toContain("not currently available here");
    expect(container.textContent).not.toContain(draftTitle);
    await click("Change selection");
    expect(
      container.querySelector('[aria-label="Guide choices"]')?.textContent
    ).not.toContain(draftTitle);
    await click("Remove link");
    expect(lastLinkInput().selectedId).toBeNull();
  });

  it("shows a human unavailable-link message rather than an unknown numeric ID", async () => {
    mocks.detail = detail({ articleId: 404 });
    await panel();
    await click("Link an existing guide");
    expect(
      container.querySelector('[aria-label="Guide to link"]')?.textContent
    ).toContain("not currently available here");
    expect(container.textContent).not.toContain("404");
    expectNoVisibleIds();
    await click("Remove link");
    await click("Save report changes");
    expect(mocks.mutate).toHaveBeenCalledWith(
      "staffHandbook.updateRequest",
      expect.objectContaining({ articleId: null })
    );
  });

  it("suppresses cached choices and selected titles on a non-authority picker error", async () => {
    mocks.detail = detail({ articleId: 7 });
    await panel();
    await click("Link an existing guide");
    await click("Change selection");
    expect(container.textContent).toContain(publishedTitle);
    mocks.linkState = {
      isError: true,
      error: new Error("Private error title must not render"),
      data: {
        items: [
          {
            id: 7,
            title: "Cached confidential choice",
            category: "General",
            state: "published",
          },
        ],
        selected: {
          id: 7,
          title: "Cached confidential selection",
          category: "General",
          state: "published",
        },
        total: 1,
        page: 1,
        pageSize: 20,
      },
    };
    await panel();
    expect(container.textContent).toContain(
      "The linked item could not be loaded"
    );
    expect(container.textContent).toContain(
      "Unable to load guide choices. No cached content is shown"
    );
    for (const title of [
      publishedTitle,
      "Cached confidential choice",
      "Cached confidential selection",
      "Private error title must not render",
    ])
      expect(container.textContent).not.toContain(title);
    await click("Retry guide choices");
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it.each(["FORBIDDEN", "UNAUTHORIZED"])(
    "revokes all private report/choice content on %s picker denial",
    async code => {
      await panel();
      await click("Link an existing guide");
      await click("Choose a guide");
      cache.setQueryData([["staffHandbook", "linkOptions"]], {
        title: "Private cached label",
      });
      mocks.linkState = {
        isError: true,
        error: { data: { code } },
        data: {
          items: mocks.activeGuides,
          selected: mocks.activeGuides[0],
          total: 3,
          page: 1,
          pageSize: 20,
        },
      };
      await panel();
      expect(container.textContent).toContain("access could not be authorized");
      for (const title of [
        mocks.detail.request.title,
        publishedTitle,
        draftTitle,
        "Private cached label",
      ])
        expect(container.textContent).not.toContain(title);
      expect(container.querySelector("input, textarea, select")).toBeNull();
      expect(
        cache.getQueryCache().findAll({ queryKey: [["staffHandbook"]] })
      ).toHaveLength(0);
      expect(mocks.invalidate).toHaveBeenCalledWith(
        "auth.me",
        undefined,
        undefined,
        { throwOnError: true }
      );
      mocks.linkState = {};
      await panel();
      expect(container.textContent).toContain("access could not be authorized");
      expect(mocks.mutate).not.toHaveBeenCalled();
    }
  );

  it("keeps the selected published revision label independent of search and pagination", async () => {
    mocks.detail = detail({ articleId: 14, status: "resolved" });
    mocks.publishedGuides.push(
      ...Array.from({ length: 23 }, (_, index) => ({
        id: 100 + index,
        title: `Published reference ${index + 1}`,
        category: "General",
        state: "published",
      }))
    );
    await panel();
    await click("Link an existing guide");
    expect(lastLinkInput()).toMatchObject({
      type: "guides",
      scope: "published",
      selectedId: 14,
      page: 1,
    });
    expect(
      container.querySelector('[aria-label="Guide that answers this question"]')
        ?.textContent
    ).toContain("Published supplier checklist");
    expect(container.textContent).not.toContain(
      "Private unpublished change title"
    );
    await click("Change selection");
    await click("Next");
    expect(lastLinkInput().page).toBe(2);
    expect(
      container.querySelector('[aria-label="Guide that answers this question"]')
        ?.textContent
    ).toContain("Published supplier checklist");
    await input("Find a guide by title", "no matching reference");
    expect(lastLinkInput()).toMatchObject({
      scope: "published",
      selectedId: 14,
      search: "no matching reference",
      page: 1,
    });
    expect(container.textContent).toContain("No published guides match");
    expect(
      container.querySelector('[aria-label="Guide that answers this question"]')
        ?.textContent
    ).toContain("Published supplier checklist");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("disables stale choice buttons during fetching and does not expose cached choices while loading", async () => {
    await panel();
    await click("Link an existing guide");
    await click("Choose a guide");
    mocks.linkState = { isFetching: true };
    await panel();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Updating choices"
    );
    const choice = container.querySelector<HTMLButtonElement>(
      '[aria-label="Guide choices"] button'
    )!;
    expect(choice.disabled).toBe(true);
    await act(async () => choice.click());
    expect(lastLinkInput().selectedId).toBeNull();
    mocks.linkState = {
      isLoading: true,
      data: {
        items: mocks.activeGuides,
        selected: null,
        total: 3,
        page: 1,
        pageSize: 20,
      },
    };
    await panel();
    expect(container.textContent).toContain("Loading guide choices");
    expect(container.querySelector('[aria-label="Guide choices"]')).toBeNull();
    expect(container.textContent).not.toContain(publishedTitle);
    expect(container.textContent).not.toContain(draftTitle);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});

describe("read-only named links on saved reports", () => {
  it("shows an Answered report with its named current published guide, without opening editing controls", async () => {
    mocks.detail = detail({ articleId: 7, status: "resolved" });
    await panel();
    expect(container.textContent).toContain("Answered");
    const linked = container.querySelector('[aria-label="Linked guide"]')!;
    expect(linked.textContent).toContain(publishedTitle);
    expect(linked.textContent).toContain("Operations · Published");
    expect(button(`Read ${publishedTitle}`).disabled).toBe(false);
    expect(linked.querySelector("input, textarea, select")).toBeNull();
    expect(lastLinkInput()).toEqual({
      type: "guides",
      scope: "published",
      selectedId: 7,
      page: 1,
    });
    expect(container.querySelector('[aria-label="Guide choices"]')).toBeNull();
    expectNoVisibleIds();
    await click(`Read ${publishedTitle}`);
    expect(onGuide).toHaveBeenCalledWith(7, false);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("uses the published scope's current revision title even when an unpublished revision has changes", async () => {
    mocks.detail = detail({ articleId: 14, status: "resolved" });
    await panel();
    const linked = container.querySelector('[aria-label="Linked guide"]')!;
    expect(lastLinkInput()).toMatchObject({
      scope: "published",
      selectedId: 14,
    });
    expect(linked.textContent).toContain("Published supplier checklist");
    expect(container.textContent).not.toContain(
      "Private unpublished change title"
    );
    expect(button("Read Published supplier checklist").disabled).toBe(false);
    await click("Read Published supplier checklist");
    expect(onGuide).toHaveBeenCalledWith(14, false);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("does not claim a historical answer is available when its current guide is unpublished or gone", async () => {
    mocks.detail = detail({ articleId: 12, status: "resolved" });
    await panel();
    const linked = container.querySelector('[aria-label="Linked guide"]')!;
    expect(container.textContent).toContain("Answered");
    expect(linked.textContent).toContain("not currently published");
    expect(container.textContent).not.toContain(draftTitle);
    expect(container.textContent).not.toContain(
      "A published guide is available for this question"
    );
    expect(linked.querySelector("button")).toBeNull();
    expect(lastLinkInput()).toMatchObject({
      scope: "published",
      selectedId: 12,
    });
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("hides cached read-only linked titles on errors and offers an explicit retry", async () => {
    mocks.detail = detail({ articleId: 7, status: "resolved" });
    await panel();
    expect(container.textContent).toContain(publishedTitle);
    mocks.linkState = {
      isError: true,
      error: new Error("Private link error"),
      data: {
        items: mocks.publishedGuides,
        selected: mocks.publishedGuides[0],
        total: 2,
        page: 1,
        pageSize: 20,
      },
    };
    await panel();
    expect(container.textContent).not.toContain(publishedTitle);
    expect(container.textContent).not.toContain("Private link error");
    expect(
      container.querySelector('[aria-label="Linked guide"]')?.textContent
    ).toContain("No cached title is shown");
    await click("Retry linked guide");
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(onGuide).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it.each(["FORBIDDEN", "UNAUTHORIZED"])(
    "revokes the whole saved report and cache after read-only linked query %s denial",
    async code => {
      mocks.detail = detail({ articleId: 7, status: "resolved" });
      await panel();
      await input("Add a comment", "Private unsent linked-guide comment");
      cache.setQueryData([["staffHandbook", "linkOptions"]], {
        title: "Private linked cache",
      });
      mocks.linkState = {
        isError: true,
        error: { data: { code } },
        data: {
          items: mocks.publishedGuides,
          selected: mocks.publishedGuides[0],
          total: 2,
          page: 1,
          pageSize: 20,
        },
      };
      await panel();
      expect(container.textContent).toContain("access could not be authorized");
      expect(container.textContent).not.toContain(mocks.detail.request.title);
      expect(container.textContent).not.toContain(publishedTitle);
      expect(container.textContent).not.toContain(
        "Private unsent linked-guide comment"
      );
      expect(container.querySelector("input, textarea, select")).toBeNull();
      expect(
        cache.getQueryCache().findAll({ queryKey: [["staffHandbook"]] })
      ).toHaveLength(0);
      mocks.linkState = {};
      await panel();
      expect(container.querySelector("input, textarea, select")).toBeNull();
      expect(mocks.mutate).not.toHaveBeenCalled();
    }
  );

  it("shows the named duplicate report with shared Answered status and confirms before following with an unsent comment", async () => {
    mocks.detail = detail({
      status: "closed",
      duplicateOfId: 9,
      closureReason: "Follow the same question in the other report.",
    });
    mocks.reports[1].state = "resolved";
    await panel(true);
    const linked = container.querySelector('[aria-label="Linked report"]')!;
    expect(linked.textContent).toContain(otherReportTitle);
    expect(linked.textContent).toContain("Operations · Answered");
    expect(linked.querySelector("input, textarea, select")).toBeNull();
    expect(button(`Follow report ${otherReportTitle}`).disabled).toBe(false);
    expectNoVisibleIds();
    await input("Add a comment", "Keep my unsent duplicate-report comment");
    vi.mocked(window.confirm).mockReturnValue(false);
    await click(`Follow report ${otherReportTitle}`);
    expect(window.confirm).toHaveBeenCalledWith(
      "Discard unsaved report changes and open the other report?"
    );
    expect(onReport).not.toHaveBeenCalled();
    expect(field("Add a comment").value).toBe(
      "Keep my unsent duplicate-report comment"
    );
    vi.mocked(window.confirm).mockReturnValue(true);
    await click(`Follow report ${otherReportTitle}`);
    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledWith(9);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("keeps a duplicate's named follow action disabled when no report-navigation callback is provided", async () => {
    mocks.detail = detail({
      status: "closed",
      duplicateOfId: 9,
      closureReason: "Follow the other report.",
    });
    await panel();
    expect(button(`Follow report ${otherReportTitle}`).disabled).toBe(true);
    await click(`Follow report ${otherReportTitle}`);
    expect(onReport).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});

describe("closing duplicates and maintaining report edits", () => {
  it("selects another report by title with automatic closure reason and internal duplicate ID", async () => {
    await panel();
    await toggle(managementLabel);
    await input("Progress", "closed");
    await checkbox(duplicateLabel);
    expect(field("Why are you closing this report?").value).toBe("");
    await choose("reports", otherReportTitle);
    expect(lastLinkInput()).toEqual({
      type: "reports",
      scope: "active",
      search: otherReportTitle,
      selectedId: 9,
      excludeId: 8,
      page: 1,
    });
    expect(field("Why are you closing this report?").value).toBe(
      "The same question is being followed up in the linked report."
    );
    expect(
      container.querySelector('[aria-label="Report to follow instead"]')
        ?.textContent
    ).toContain(otherReportTitle);
    expectNoVisibleIds();
    await click("Save report changes");
    expect(window.confirm).toHaveBeenCalledWith(
      "Close this report with the note shown? It will remain in the report history."
    );
    expect(mocks.mutate).toHaveBeenCalledWith(
      "staffHandbook.updateRequest",
      expect.objectContaining({
        id: 8,
        expectedVersion: 2,
        status: "closed",
        duplicateOfId: 9,
        closureReason:
          "The same question is being followed up in the linked report.",
      })
    );
  });

  it("excludes the current report from duplicate choices and requires another target when ticked", async () => {
    await panel();
    await toggle(managementLabel);
    await input("Progress", "closed");
    await checkbox(duplicateLabel);
    await click("Choose a report");
    expect(
      container.querySelector('[aria-label="Report choices"]')?.textContent
    ).toContain(otherReportTitle);
    expect(
      container.querySelector('[aria-label="Report choices"]')?.textContent
    ).not.toContain(mocks.detail.request.title);
    await input(
      "Why are you closing this report?",
      "Already covered elsewhere"
    );
    await click("Save report changes");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Choose the other report to follow, or untick the same-question option"
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
    await checkbox(duplicateLabel);
    await click("Save report changes");
    expect(mocks.mutate).toHaveBeenCalledWith(
      "staffHandbook.updateRequest",
      expect.objectContaining({
        status: "closed",
        duplicateOfId: null,
        closureReason: "Already covered elsewhere",
      })
    );
  });

  it("keeps closure edits and does not close after the explicit confirmation is cancelled", async () => {
    await panel();
    await toggle(managementLabel);
    await input("Progress", "closed");
    await input("Why are you closing this report?", "No longer required");
    vi.mocked(window.confirm).mockReturnValue(false);
    await click("Save report changes");
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(field("Why are you closing this report?").value).toBe(
      "No longer required"
    );
  });

  it("prevents same-tick report updates and preserves edits on uncertain update failure", async () => {
    const save = deferred<{ id: number; version: number }>();
    mocks.mutate.mockReturnValue(save.promise);
    await panel();
    await toggle(managementLabel);
    await input(titleLabel, "Keep my revised title");
    const form = field(titleLabel).closest("form")!;
    await act(async () => {
      submitEvent(form);
      submitEvent(form);
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(button("Saving…").disabled).toBe(true);
    await act(async () => {
      save.reject(new Error("Concurrent save failed"));
      await save.promise.catch(() => undefined);
    });
    expect(field(titleLabel).value).toBe("Keep my revised title");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Your changes are retained"
    );
    expect(button("Save report changes").disabled).toBe(false);
  });

  it("guards all mutation paths after a concurrent version change and retains unsaved values", async () => {
    await panel();
    await toggle(managementLabel);
    await input(titleLabel, "Local title must survive");
    await input("Add a comment", "Local comment must survive");
    mocks.detail = detail({
      version: 3,
      title: "Someone else's updated title",
    });
    await panel();
    expect(field(titleLabel).value).toBe("Local title must survive");
    expect(field("Add a comment").value).toBe("Local comment must survive");
    expect(container.textContent).toContain(
      "Reload before making another change"
    );
    expect(button("Save report changes").disabled).toBe(true);
    expect(button("Write a guide").disabled).toBe(true);
    expect(button("Add comment").disabled).toBe(true);
    await submitContaining(titleLabel);
    await submitContaining("Add a comment");
    expect(mocks.mutate).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(false);
    await click("Reload report");
    expect(window.confirm).toHaveBeenCalledWith(
      "Reload and discard unsaved report changes and comment?"
    );
    expect(onReload).not.toHaveBeenCalled();
    expect(field(titleLabel).value).toBe("Local title must survive");
  });

  it("retains last readable report during refetch failure but forbids writes until reload", async () => {
    await panel();
    await input("Add a comment", "Keep while offline");
    mocks.requestState = {
      isError: true,
      error: new Error("Refetch unavailable"),
      data: undefined,
    };
    await panel();
    expect(container.querySelector("header h2")?.textContent).toBe(
      mocks.detail.request.title
    );
    expect(field("Add a comment").value).toBe("Keep while offline");
    expect(button("Write a guide").disabled).toBe(true);
    expect(button("Add comment").disabled).toBe(true);
    await submitContaining("Add a comment");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("keeps saved update status on refresh failure and guards a stale detail from repeating it", async () => {
    mocks.mutate.mockResolvedValue({ id: 8, version: 3 });
    mocks.invalidate.mockRejectedValue(new Error("Refresh failed"));
    await panel();
    await toggle(managementLabel);
    await input(titleLabel, "Saved revised title");
    await click("Save report changes");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "your change was saved. Reload the report; do not repeat the action"
    );
    expect(field(titleLabel).value).toBe("Saved revised title");
    await submitContaining(titleLabel);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      "Reload before making another change"
    );
  });

  it("dirty report edits disable guide writing and comments until explicitly saved", async () => {
    await panel();
    await toggle(managementLabel);
    await input("Category", "Operations");
    await input("Add a comment", "Save report first");
    expect(button("Write a guide").disabled).toBe(true);
    expect(button("Add comment").disabled).toBe(true);
    await submitContaining("Add a comment");
    expect(mocks.mutate).not.toHaveBeenCalled();
    await click("Save report changes");
    // The mocked hook has no query-cache subscription; deliver its committed
    // detail as the real invalidated request query would on its next render.
    await panel();
    expect(button("Add comment").disabled).toBe(false);
    expect(field("Add a comment").value).toBe("Save report first");
    await click("Add comment");
    expect(mocks.mutate.mock.calls[1]).toEqual([
      "staffHandbook.addComment",
      { id: 8, expectedVersion: 3, body: "Save report first" },
    ]);
  });

  it("retains comments on error and prevents same-tick duplicate comments", async () => {
    const comment = deferred<{ id: number; version: number }>();
    mocks.mutate.mockReturnValue(comment.promise);
    await panel();
    await input("Add a comment", "  Keep this useful suggestion  ");
    const form = field("Add a comment").closest("form")!;
    await act(async () => {
      submitEvent(form);
      submitEvent(form);
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith("staffHandbook.addComment", {
      id: 8,
      expectedVersion: 2,
      body: "Keep this useful suggestion",
    });
    expect(button("Add comment").disabled).toBe(true);
    await act(async () => {
      comment.reject(new Error("Report was changed"));
      await comment.promise.catch(() => undefined);
    });
    expect(field("Add a comment").value).toBe(
      "  Keep this useful suggestion  "
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Your changes are retained"
    );
  });

  it.each(["form", "comment"])(
    "asks before discarding unsaved %s on Back to reports",
    async kind => {
      await panel();
      if (kind === "form") {
        await toggle(managementLabel);
        await input(titleLabel, "Unsent report edit");
      } else await input("Add a comment", "Unsent comment");
      vi.mocked(window.confirm).mockReturnValue(false);
      await click("Back to reports");
      expect(window.confirm).toHaveBeenCalledWith(
        "Discard unsaved report changes and comment?"
      );
      expect(onClose).not.toHaveBeenCalled();
      expect(field(kind === "form" ? titleLabel : "Add a comment").value).toBe(
        kind === "form" ? "Unsent report edit" : "Unsent comment"
      );
      vi.mocked(window.confirm).mockReturnValue(true);
      await click("Back to reports");
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  );

  it("warns before reading a linked guide with an unsent comment", async () => {
    mocks.detail = detail({ articleId: 7 });
    await panel();
    await input("Add a comment", "Unsent guidance question");
    vi.mocked(window.confirm).mockReturnValue(false);
    await click(`Read ${publishedTitle}`);
    expect(window.confirm).toHaveBeenCalledWith(
      "Discard unsaved report changes and open the guide?"
    );
    expect(onGuide).not.toHaveBeenCalled();
    expect(field("Add a comment").value).toBe("Unsent guidance question");
    vi.mocked(window.confirm).mockReturnValue(true);
    await click(`Read ${publishedTitle}`);
    expect(onGuide).toHaveBeenCalledWith(7, false);
  });
});
