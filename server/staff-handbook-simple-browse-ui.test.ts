// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRouter } from "./routers";
import {
  emptyHandbookContent,
  type HandbookContent,
} from "../shared/staff-handbook";
import { trpc } from "../client/src/lib/trpc";
import type {
  ArticleDetail,
  HandbookBrowseItem,
  RequestDto,
} from "../client/src/pages/admin/StaffHandbookComponents";

const auth = vi.hoisted(() => ({ user: null as any, loading: false }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: auth.user, loading: auth.loading, error: null }),
}));
// Only the rich-text widget is substituted; the workspace, article/request
// panels, actual tRPC hooks, query cache, controls, and routing are real.
vi.mock("@/components/RichEmailEditor", async () => {
  const { createElement } = await import("react");
  return {
    RichEmailEditor: (props: any) =>
      createElement("textarea", {
        "aria-label": props.ariaLabel,
        disabled: props.disabled,
        value: props.value,
        onChange: (event: any) => props.onChange(event.target.value),
      }),
  };
});
import StaffHandbook from "../client/src/pages/admin/StaffHandbook";

const stamp = new Date("2026-11-01T12:00:00Z");
type Call = { path: string; type: string; input: any };
let root: Root;
let container: HTMLDivElement;
let cache: QueryClient;
let client: ReturnType<typeof trpc.createClient>;
let location: ReturnType<typeof memoryLocation>;
let calls: Call[];
let guides: HandbookBrowseItem[];
let details: Map<number, ArticleDetail>;
let requestRows: RequestDto[];
let errors: Map<string, TRPCClientError<AppRouter>>;
let network: ReturnType<typeof vi.fn>;

function guide(
  id: number,
  title: string,
  state: HandbookBrowseItem["state"]
): HandbookBrowseItem {
  return {
    id,
    title,
    state,
    version: 1,
    summary: "Synthetic internal guide",
    category: "General",
    tags: [],
    sensitivity: "operational",
    format: "article",
    isPinned: false,
    nextReviewAt: null,
    updatedAt: stamp,
  };
}
function detail(
  item: HandbookBrowseItem,
  saved?: HandbookContent
): ArticleDetail {
  const content = saved ?? {
    ...emptyHandbookContent(99),
    title: item.title,
    format: "article" as const,
    summary: item.summary,
    contentHtml: "<p>Synthetic saved body</p>",
  };
  const draft = {
    id: item.id * 10,
    articleId: item.id,
    revisionNumber: 1,
    content,
    resourceIds: [],
    contributorIds: [99],
    createdById: 99,
    changeSummary: "Synthetic draft",
    createdAt: stamp,
  };
  const published = ["published", "changes"].includes(item.state)
    ? draft
    : null;
  return {
    article: {
      id: item.id,
      version: 1,
      draftRevisionId: draft.id,
      publishedRevisionId: published?.id ?? null,
      reviewedRevisionId: null,
      reviewedById: null,
      submittedAt: null,
      archivedAt: item.state === "archived" ? stamp : null,
      createdById: 99,
      updatedAt: stamp,
      requiresIndependentReview: false,
    },
    draft,
    published,
    revisions: [draft],
    resources: [],
    audit: [],
  };
}
function requestRow(
  id: number,
  title: string,
  status: RequestDto["status"],
  assigneeId: number | null
): RequestDto {
  return {
    id,
    title,
    status,
    assigneeId,
    version: 1,
    description: "Synthetic knowledge gap",
    category: "General",
    kind: "missing_process",
    checkedGuidance: "Checked handbook",
    impact: "Staff blocked",
    priority: "normal",
    reporterId: 99,
    articleId: null,
    resolvedRevisionId: null,
    duplicateOfId: null,
    closureReason: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
}
function authorityError(code: "FORBIDDEN" | "UNAUTHORIZED") {
  return TRPCClientError.from<AppRouter>({
    error: {
      message: "Synthetic access revoked",
      code: code === "FORBIDDEN" ? -32003 : -32001,
      data: { code, httpStatus: code === "FORBIDDEN" ? 403 : 401 },
    },
  });
}
function respond(path: string, input: any) {
  const error = errors.get(path);
  if (error) throw error;
  if (path === "staffHandbook.overview")
    return {
      metrics: {
        newRequests: 1,
        unassignedRequests: 1,
        awaitingReview: 1,
        overdueGuides: 0,
        openRequests: 2,
        publishedGuides: 1,
      },
      categories: ["General", "Synthetic category"],
      staff: [{ id: 99, name: "Synthetic staff" }],
      byAssignee: [{ id: null, name: "Unassigned", count: 1 }],
      byCategory: [{ category: "General", count: 1 }],
    };
  if (path === "staffHandbook.browse") {
    let items = guides.filter(item => {
      if (input.view === "archived") return item.state === "archived";
      if (item.state === "archived") return false;
      if (input.view === "published")
        return ["published", "changes"].includes(item.state);
      if (input.view === "drafts")
        return ["draft", "in_review", "changes"].includes(item.state);
      if (input.view !== "all")
        throw new Error("Expected an explicit guide view");
      return true;
    });
    if (input.category)
      items = items.filter(item => item.category === input.category);
    if (input.search)
      items = items.filter(item =>
        item.title.toLowerCase().includes(input.search.toLowerCase())
      );
    const page = input.page ?? 1;
    return {
      items: items.slice((page - 1) * 20, page * 20),
      total: items.length,
      page,
      pageSize: 20,
    };
  }
  if (path === "staffHandbook.requests") {
    let items = requestRows.filter(
      item => !input.category || item.category === input.category
    );
    if (input.search)
      items = items.filter(item =>
        item.title.toLowerCase().includes(input.search.toLowerCase())
      );
    if (input.status === "open")
      items = items.filter(
        item => !["resolved", "closed"].includes(item.status)
      );
    else if (input.status !== "all")
      items = items.filter(item => item.status === input.status);
    if (Object.hasOwn(input, "assigneeId"))
      items = items.filter(item => item.assigneeId === input.assigneeId);
    return { items, total: items.length, page: input.page ?? 1, pageSize: 20 };
  }
  if (path === "staffHandbook.article") {
    const result = details.get(input.id);
    if (!result) throw new Error("Unknown synthetic guide");
    return result;
  }
  if (path === "staffHandbook.request") {
    const result = requestRows.find(item => item.id === input.id);
    if (!result) throw new Error("Unknown synthetic request");
    return { request: result, comments: [], audit: [] };
  }
  if (path === "staffHandbook.saveArticle") {
    if (input.id) throw new Error("This fixture only creates a guide");
    const item = guide(77, input.content.title, "draft");
    guides.unshift(item);
    details.set(item.id, detail(item, input.content));
    return { id: item.id, version: 1 };
  }
  if (path === "staffHandbook.createRequest") {
    const item = requestRow(88, input.title, "new", null);
    requestRows.unshift({ ...item, ...input, id: 88, version: 1 });
    return { id: 88, version: 1 };
  }
  throw new Error(`Unexpected transport operation: ${path}`);
}
const syntheticTransport: TRPCLink<AppRouter> =
  () =>
  ({ op }) =>
    observable(observer => {
      calls.push({ path: op.path, type: op.type, input: op.input });
      let stopped = false;
      queueMicrotask(() => {
        if (stopped) return;
        try {
          observer.next({ result: { data: respond(op.path, op.input) } });
          observer.complete();
        } catch (error) {
          observer.error(TRPCClientError.from(error as Error));
        }
      });
      return () => {
        stopped = true;
      };
    });
function element() {
  return React.createElement(
    QueryClientProvider,
    { client: cache },
    React.createElement(
      trpc.Provider,
      { client, queryClient: cache },
      React.createElement(
        Router,
        { hook: location.hook, searchHook: location.searchHook },
        React.createElement(StaffHandbook)
      )
    )
  );
}
async function settle(assertion: () => void) {
  // Flush actual React Query observer updates rather than substituting hook results.
  for (let attempt = 0; attempt < 50; attempt++) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === 49) throw error;
    }
  }
}
async function render(path = "/admin/staff-handbook?tab=handbook") {
  location = memoryLocation({ path, record: true });
  await act(async () => root.render(element()));
  await settle(() =>
    expect(
      container.querySelector('[data-staff-handbook], [role="alert"]')
    ).toBeTruthy()
  );
}
async function rerender() {
  await act(async () => root.render(element()));
}
const normalize = (text: string | null) => text?.replace(/\s+/g, " ").trim();
function button(label: string): HTMLButtonElement {
  const result = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button")
  ).find(item => normalize(item.textContent) === label);
  expect(result, `button: ${label}`).toBeTruthy();
  return result!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
function field(
  label: string
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const result = Array.from(container.querySelectorAll("label")).find(
    item => normalize(item.textContent) === label
  );
  expect(result, `field: ${label}`).toBeTruthy();
  return document.getElementById(result!.htmlFor)! as any;
}
async function input(label: string, value: string) {
  const control = field(label);
  const prototype =
    control.tagName === "SELECT"
      ? HTMLSelectElement.prototype
      : control.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
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
async function submit(label: string) {
  await act(async () => {
    field(label)
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
function lastCall(path: string) {
  return calls.filter(call => call.path === path).at(-1)!;
}
function guideResults() {
  return container.querySelector('[aria-label="Guide results"]')!;
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  network = vi.fn(() => {
    throw new Error("Network is forbidden in this UI-only test");
  });
  vi.stubGlobal("fetch", network);
  window.happyDOM.settings.disableJavaScriptFileLoading = true;
  window.happyDOM.settings.disableCSSFileLoading = true;
  window.happyDOM.settings.enableJavaScriptEvaluation = false;
  vi.spyOn(window, "confirm").mockReturnValue(false);
  auth.user = {
    id: 99,
    role: "admin",
    isActive: true,
    portalStatus: "active",
    mustChangePassword: false,
  };
  auth.loading = false;
  calls = [];
  errors = new Map();
  guides = [
    guide(7, "Synthetic saved draft", "draft"),
    guide(8, "Synthetic published guide", "published"),
    guide(9, "Synthetic changed guide", "changes"),
    guide(10, "Synthetic review guide", "in_review"),
    ...Array.from({ length: 20 }, (_, index) =>
      guide(20 + index, `Synthetic guide ${index + 1}`, "published")
    ),
    guide(60, "Synthetic archived guide", "archived"),
  ];
  details = new Map(guides.map(item => [item.id, detail(item)]));
  requestRows = [
    requestRow(11, "Synthetic unassigned gap", "new", null),
    requestRow(12, "Synthetic assigned gap", "assigned", 99),
  ];
  cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  client = trpc.createClient({ links: [syntheticTransport] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  cache.clear();
  container.remove();
  expect(network).not.toHaveBeenCalled();
  expect(calls.every(call => call.path.startsWith("staffHandbook."))).toBe(
    true
  );
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("simple handbook browse with synthetic tRPC transport", () => {
  it("defaults to all active guides with clear state labels and two simple sections, not a dashboard", async () => {
    await render();
    await settle(() =>
      expect(guideResults()?.textContent).toContain("Synthetic saved draft")
    );
    expect(container.querySelector("h1")?.textContent).toBe("Staff Handbook");
    expect(container.textContent).toContain("Internal guides for JLT staff.");
    const sections = container.querySelector(
      '[aria-label="Handbook sections"]'
    )!;
    expect(
      Array.from(sections.querySelectorAll("button")).map(item =>
        normalize(item.textContent)
      )
    ).toEqual(["Guides", "Missing knowledge"]);
    expect(button("Guides").getAttribute("aria-current")).toBe("page");
    expect(field("Guide view").value).toBe("all");
    expect(lastCall("staffHandbook.browse").input).toMatchObject({
      view: "all",
      page: 1,
    });
    expect(
      Array.from((field("Guide view") as HTMLSelectElement).options).map(
        option => [option.value, option.textContent]
      )
    ).toEqual([
      ["all", "All active guides"],
      ["published", "Published"],
      ["drafts", "Drafts"],
      ["archived", "Archived"],
    ]);
    const rows = Array.from(guideResults().querySelectorAll("li"));
    expect(rows[0].textContent).toContain("Draft");
    expect(rows[1].textContent).toContain("Published");
    expect(rows[2].textContent).toContain("Unpublished changes");
    expect(rows[3].textContent).toContain("In review");
    expect(guideResults().textContent).not.toContain(
      "Synthetic archived guide"
    );
    expect(container.textContent).not.toMatch(
      /New requests|Awaiting review|Published guides|Request workload|Overview counts/
    );
    expect(calls.filter(call => call.type === "mutation")).toEqual([]);
  });

  it("retains explicit search, category filters, pagination and the three optional guide views", async () => {
    await render();
    await settle(() => expect(button("Next").disabled).toBe(false));
    await click("Next");
    await settle(() =>
      expect(
        container.querySelector('[aria-label="List pagination"]')?.textContent
      ).toContain("Page 2")
    );
    expect(lastCall("staffHandbook.browse").input.page).toBe(2);
    await input("Filter category", "General");
    await settle(() =>
      expect(
        container.querySelector('[aria-label="List pagination"]')?.textContent
      ).toContain("Page 1")
    );
    await input("Search guidance", "saved draft");
    expect(lastCall("staffHandbook.browse").input.search).toBeUndefined();
    await submit("Search guidance");
    await settle(() =>
      expect(guideResults()?.querySelectorAll("li").length).toBe(1)
    );
    expect(lastCall("staffHandbook.browse").input).toMatchObject({
      view: "all",
      category: "General",
      search: "saved draft",
      page: 1,
    });
    await input("Search guidance", "");
    await submit("Search guidance");
    for (const [view, visible, hidden] of [
      ["published", "Synthetic published guide", "Synthetic saved draft"],
      ["drafts", "Synthetic saved draft", "Synthetic published guide"],
      ["archived", "Synthetic archived guide", "Synthetic changed guide"],
    ]) {
      await input("Guide view", view);
      await settle(() =>
        expect(guideResults()?.textContent).toContain(visible)
      );
      expect(guideResults().textContent).not.toContain(hidden);
      expect(lastCall("staffHandbook.browse").input).toMatchObject({
        view,
        page: 1,
      });
    }
  });

  it("uses the unchanged requests route and collapsed native Advanced filters for status and assignee", async () => {
    await render();
    await click("Missing knowledge");
    await settle(() =>
      expect(
        container.querySelector('[aria-label="Request results"]')?.textContent
      ).toContain("Synthetic unassigned gap")
    );
    expect(location.history?.at(-1)).toBe("/admin/staff-handbook?tab=requests");
    expect(button("Missing knowledge").getAttribute("aria-current")).toBe(
      "page"
    );
    const advanced = container.querySelector("details")!;
    expect(
      normalize(advanced.querySelector("summary")?.textContent ?? "")
    ).toBe("Advanced filters");
    expect(advanced.open).toBe(false);
    expect(field("Filter request status").closest("details")).toBe(advanced);
    expect(field("Filter assignee").closest("details")).toBe(advanced);
    await act(async () => advanced.querySelector("summary")!.click());
    expect(advanced.open).toBe(true);
    await input("Filter request status", "open");
    await input("Filter assignee", "unassigned");
    await settle(() =>
      expect(
        container
          .querySelector('[aria-label="Request results"]')
          ?.querySelectorAll("li").length
      ).toBe(1)
    );
    expect(lastCall("staffHandbook.requests").input).toMatchObject({
      status: "open",
      assigneeId: null,
      page: 1,
    });
    expect(container.textContent).toContain("Advanced filters (active)");
    await click("Guides");
    await settle(() => expect(guideResults()).toBeTruthy());
    expect(field("Guide view").value).toBe("all");
    expect(container.querySelector("details")).toBeNull();
  });

  it("opens a newly saved guide and keeps its draft visible on return even after starting in a filtered view", async () => {
    await render();
    await input("Guide view", "archived");
    await input("Filter category", "Synthetic category");
    await input("Search guidance", "old title");
    await submit("Search guidance");
    await click("New guide");
    expect(button("New guide").disabled).toBe(true);
    expect(button("Report missing knowledge").disabled).toBe(true);
    expect(
      container.querySelector('[aria-label="Handbook sections"]')
    ).toBeNull();
    await input("Title", "newtestguide");
    await submit("Title");
    await settle(() =>
      expect(location.history?.at(-1)).toBe(
        "/admin/staff-handbook?tab=handbook&article=77"
      )
    );
    await settle(() =>
      expect(
        container.querySelector("[data-handbook-article]")?.textContent
      ).toContain("Guide #77")
    );
    expect(
      calls.filter(call => call.type === "mutation").map(call => call.path)
    ).toEqual(["staffHandbook.saveArticle"]);
    expect(details.get(77)?.draft?.content.title).toBe("newtestguide");
    expect(details.get(77)?.published).toBeNull();
    await click("Back to guides");
    await settle(() =>
      expect(guideResults()?.textContent).toContain("newtestguide")
    );
    expect(field("Guide view").value).toBe("all");
    expect(field("Search guidance").value).toBe("");
    expect(field("Filter category").value).toBe("");
    expect(lastCall("staffHandbook.browse").input).toMatchObject({
      view: "all",
      page: 1,
    });
    expect(guideResults().querySelector("li")?.textContent).toContain("Draft");
  });

  it("does not offer header or tab navigation that silently discards an unsaved new guide", async () => {
    await render();
    await click("New guide");
    await input("Title", "Unsaved synthetic guide");
    await click("Report missing knowledge");
    await click("New guide");
    expect(field("Title").value).toBe("Unsaved synthetic guide");
    expect(
      container.querySelector('[aria-label="Handbook sections"]')
    ).toBeNull();
    await click("Back to guides");
    expect(window.confirm).toHaveBeenCalledWith(
      "Discard your unsaved guide edits?"
    );
    expect(field("Title").value).toBe("Unsaved synthetic guide");
    expect(calls.filter(call => call.type === "mutation")).toEqual([]);
  });

  it("opens the reused missing-knowledge report from the compact action and returns to the saved request", async () => {
    await render();
    await click("Report missing knowledge");
    expect(button("New guide").disabled).toBe(true);
    expect(button("Report missing knowledge").disabled).toBe(true);
    await input("What guidance is missing?", "Synthetic new report");
    await input("What do staff need to know?", "Synthetic staff process gap");
    await submit("What guidance is missing?");
    await settle(() =>
      expect(location.history?.at(-1)).toBe(
        "/admin/staff-handbook?tab=requests&request=88"
      )
    );
    await settle(() =>
      expect(container.querySelector("[data-knowledge-request]")).toBeTruthy()
    );
    expect(
      calls.filter(call => call.type === "mutation").map(call => call.path)
    ).toEqual(["staffHandbook.createRequest"]);
    expect(lastCall("staffHandbook.createRequest").input).toMatchObject({
      title: "Synthetic new report",
      description: "Synthetic staff process gap",
      category: "General",
    });
    await click("Back to requests");
    await settle(() =>
      expect(
        container.querySelector('[aria-label="Request results"]')?.textContent
      ).toContain("Synthetic new report")
    );
  });

  it("retains article and request deep-link hooks with the existing panels", async () => {
    await render("/admin/staff-handbook?tab=handbook&article=8");
    await settle(() =>
      expect(
        container.querySelector("[data-handbook-reading]")?.textContent
      ).toContain("Synthetic published guide")
    );
    expect(lastCall("staffHandbook.article").input).toEqual({ id: 8 });
    expect(button("New guide").disabled).toBe(true);
    await click("Back to guides");
    await click("Missing knowledge");
    await settle(() =>
      expect(
        container.querySelector('[aria-label="Request results"]')
      ).toBeTruthy()
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Request results"] button'
        )!
        .click()
    );
    await settle(() =>
      expect(container.querySelector("[data-knowledge-request]")).toBeTruthy()
    );
    expect(location.history?.at(-1)).toBe(
      "/admin/staff-handbook?tab=requests&request=11"
    );
    expect(lastCall("staffHandbook.request").input).toEqual({ id: 11 });
  });

  it("clears request-only search and a previous archive view before opening a linked guide", async () => {
    requestRows[0].articleId = 7;
    await render();
    await input("Guide view", "archived");
    await click("Missing knowledge");
    await input("Search requests", "unassigned gap");
    await submit("Search requests");
    await settle(() =>
      expect(
        container
          .querySelector('[aria-label="Request results"]')
          ?.querySelectorAll("li").length
      ).toBe(1)
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Request results"] button'
        )!
        .click()
    );
    await settle(() =>
      expect(container.querySelector("[data-knowledge-request]")).toBeTruthy()
    );
    await click("Open linked guide #7");
    await settle(() =>
      expect(container.querySelector("[data-handbook-article]")).toBeTruthy()
    );
    expect(location.history?.at(-1)).toBe(
      "/admin/staff-handbook?tab=handbook&article=7"
    );
    await click("Back to guides");
    await settle(() =>
      expect(guideResults()?.textContent).toContain("Synthetic saved draft")
    );
    expect(field("Guide view").value).toBe("all");
    expect(field("Search guidance").value).toBe("");
    expect(lastCall("staffHandbook.browse").input).toMatchObject({
      view: "all",
      page: 1,
    });
    expect(lastCall("staffHandbook.browse").input.search).toBeUndefined();
  });

  it.each([
    "agent",
    "business_staff",
    "inactive",
    "password-change",
    "missing",
  ])("does not send handbook operations for denied %s access", async role => {
    if (role === "inactive") auth.user.isActive = false;
    else if (role === "password-change") auth.user.mustChangePassword = true;
    else if (role === "missing") auth.user = null;
    else auth.user.role = role;
    await render();
    expect(container.querySelector("[data-staff-handbook]")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("clears old handbook cache and local editor state across staff identity changes and logout", async () => {
    await render();
    await settle(() => expect(guideResults()).toBeTruthy());
    await click("New guide");
    await input("Title", "Previous identity private edit");
    const privateKey = [
      ["staffHandbook", "privateIdentityTest"],
      { type: "query" },
    ];
    cache.setQueryData(privateKey, { secret: "Synthetic old identity" });
    cache.setQueryData([["nonHandbook"]], { retained: true });
    auth.user = { ...auth.user, id: 100 };
    await rerender();
    await settle(() =>
      expect(
        container.querySelector('[aria-label="Guide results"]')
      ).toBeTruthy()
    );
    expect(container.textContent).not.toContain(
      "Previous identity private edit"
    );
    expect(cache.getQueryData(privateKey)).toBeUndefined();
    expect(cache.getQueryData([["nonHandbook"]])).toEqual({ retained: true });
    auth.user = null;
    await rerender();
    await settle(() =>
      expect(
        cache.getQueryCache().findAll({ queryKey: [["staffHandbook"]] })
      ).toHaveLength(0)
    );
    expect(container.querySelector("[data-staff-handbook]")).toBeNull();
    expect(cache.getQueryData([["nonHandbook"]])).toEqual({ retained: true });
  });

  it.each(["FORBIDDEN", "UNAUTHORIZED"] as const)(
    "fails closed and stays revoked after a %s browse refetch",
    async code => {
      await render();
      await settle(() =>
        expect(guideResults()?.textContent).toContain("Synthetic saved draft")
      );
      errors.set("staffHandbook.browse", authorityError(code));
      await act(async () => {
        await cache.invalidateQueries({
          queryKey: [["staffHandbook", "browse"]],
        });
      });
      await settle(() =>
        expect(container.querySelector("[data-staff-handbook]")).toBeNull()
      );
      expect(container.textContent).not.toMatch(
        /Synthetic saved draft|Synthetic published guide/
      );
      expect(container.querySelector("input, textarea, select")).toBeNull();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "could not be authorized"
      );
      await settle(() =>
        expect(
          cache.getQueryCache().findAll({ queryKey: [["staffHandbook"]] })
        ).toHaveLength(0)
      );
      errors.clear();
      await rerender();
      expect(container.querySelector("[data-staff-handbook]")).toBeNull();
    }
  );
});
