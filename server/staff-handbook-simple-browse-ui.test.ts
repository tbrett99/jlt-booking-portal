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
  KNOWLEDGE_REQUEST_KINDS,
  KNOWLEDGE_REQUEST_KIND_LABELS,
  KNOWLEDGE_REQUEST_STATUSES,
  KNOWLEDGE_REQUEST_STATUS_LABELS,
  type HandbookContent,
} from "../shared/staff-handbook";
import { trpc } from "../client/src/lib/trpc";
import type {
  ArticleDetail,
  HandbookBrowseItem,
  RequestDto,
  Staff,
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
let staffRows: Staff[];
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
      staff: staffRows,
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
  if (path === "staffHandbook.linkOptions") {
    const available =
      input.type === "guides"
        ? guides.flatMap(item => {
            const current = details.get(item.id);
            const revision =
              input.scope === "published"
                ? current?.published
                : (current?.draft ?? current?.published);
            if (!current || current.article.archivedAt || !revision) return [];
            return [
              {
                id: item.id,
                title: revision.content.title,
                category: revision.content.category,
                state: input.scope === "published" ? "published" : item.state,
              },
            ];
          })
        : requestRows.map(item => ({
            id: item.id,
            title: item.title,
            category: item.category,
            state: item.status,
          }));
    const eligible = available.filter(item => item.id !== input.excludeId);
    const matching = eligible.filter(
      item =>
        !input.search ||
        `${item.title} ${item.category}`
          .toLowerCase()
          .includes(input.search.toLowerCase())
    );
    const page = input.page ?? 1;
    return {
      items: matching.slice((page - 1) * 20, page * 20),
      selected: eligible.find(item => item.id === input.selectedId) ?? null,
      total: matching.length,
      page,
      pageSize: 20,
    };
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
  if (path === "staffHandbook.createGuideFromRequest") {
    const report = requestRows.find(item => item.id === input.id)!;
    const item = guide(78, report.title, "draft");
    guides.unshift(item);
    details.set(item.id, detail(item));
    report.articleId = item.id;
    report.version++;
    return { articleId: item.id };
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
  staffRows = [{ id: 99, name: "Synthetic staff" }];
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
    expect(container.textContent).toContain(
      "Shared instructions for JLT staff. Staff only — not visible to agents."
    );
    const sections = container.querySelector(
      '[aria-label="Handbook sections"]'
    )!;
    expect(
      Array.from(sections.querySelectorAll("button")).map(item =>
        normalize(item.textContent)
      )
    ).toEqual(["Guides", "Missing guidance"]);
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
    expect(guideResults().textContent).not.toMatch(
      /operational|financial|legal|policy|Guide #|Staff #/
    );
    expect(normalize(container.textContent)).toContain(
      "Published guides are ready to use. Drafts and unpublished changes are still being worked on."
    );
    expect(container.textContent).not.toMatch(
      /New requests|Awaiting review|Request workload|Overview counts/
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
    await input("Category", "General");
    await settle(() =>
      expect(
        container.querySelector('[aria-label="List pagination"]')?.textContent
      ).toContain("Page 1")
    );
    await input("Search guides", "saved draft");
    expect(lastCall("staffHandbook.browse").input.search).toBeUndefined();
    await submit("Search guides");
    await settle(() =>
      expect(guideResults()?.querySelectorAll("li").length).toBe(1)
    );
    expect(lastCall("staffHandbook.browse").input).toMatchObject({
      view: "all",
      category: "General",
      search: "saved draft",
      page: 1,
    });
    await input("Search guides", "");
    await submit("Search guides");
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

  it("uses the unchanged requests route with plainly named visible report filters", async () => {
    await render();
    await click("Missing guidance");
    await settle(() =>
      expect(
        container.querySelector('[aria-label="Report results"]')?.textContent
      ).toContain("Synthetic unassigned gap")
    );
    expect(location.history?.at(-1)).toBe("/admin/staff-handbook?tab=requests");
    expect(button("Missing guidance").getAttribute("aria-current")).toBe(
      "page"
    );
    expect(container.querySelector("details")).toBeNull();
    expect(field("Status").value).toBe("all");
    expect(field("Who's helping").value).toBe("");
    expect(field("Search reports").getAttribute("placeholder")).toBe(
      "Find a report"
    );
    expect(container.textContent).not.toMatch(
      /Advanced filters|requests|assignees/i
    );
    expect(
      Array.from((field("Status") as HTMLSelectElement).options).map(option => [
        option.value,
        option.textContent,
      ])
    ).toEqual([
      ["all", "All statuses"],
      ["open", "Open reports"],
      ["new", "New"],
      ["triaged", "Ready to write"],
      ["assigned", "Someone is working on it"],
      ["drafting", "Guide being written"],
      ["in_review", "Guide being checked"],
      ["resolved", "Answered"],
      ["closed", "Closed"],
    ]);
    await input("Status", "open");
    await input("Who's helping", "unassigned");
    await settle(() =>
      expect(
        container
          .querySelector('[aria-label="Report results"]')
          ?.querySelectorAll("li").length
      ).toBe(1)
    );
    expect(lastCall("staffHandbook.requests").input).toMatchObject({
      status: "open",
      assigneeId: null,
      page: 1,
    });
    expect(button("Clear filters")).toBeTruthy();
    await click("Guides");
    await settle(() => expect(guideResults()).toBeTruthy());
    expect(field("Guide view").value).toBe("all");
    expect(container.querySelector("details")).toBeNull();
  });

  it("keeps backend status and kind enums unchanged while using everyday labels", () => {
    expect(KNOWLEDGE_REQUEST_STATUSES).toEqual([
      "new",
      "triaged",
      "assigned",
      "drafting",
      "in_review",
      "resolved",
      "closed",
    ]);
    expect(KNOWLEDGE_REQUEST_STATUS_LABELS).toEqual({
      new: "New",
      triaged: "Ready to write",
      assigned: "Someone is working on it",
      drafting: "Guide being written",
      in_review: "Guide being checked",
      resolved: "Answered",
      closed: "Closed",
    });
    expect(KNOWLEDGE_REQUEST_KINDS).toEqual([
      "missing_process",
      "unclear",
      "outdated",
      "conflicting",
      "recurring_question",
    ]);
    expect(KNOWLEDGE_REQUEST_KIND_LABELS).toEqual({
      missing_process: "Missing guidance",
      unclear: "Hard to understand",
      outdated: "Needs updating",
      conflicting: "Instructions disagree",
      recurring_question: "Frequently asked question",
    });
  });

  it("shows report titles, category, dates and actual helper names without internal identifiers or priority jargon", async () => {
    requestRows[1].updatedAt = new Date("2026-11-02T12:00:00Z");
    requestRows.push(
      requestRow(145, "Synthetic unnamed helper gap", "assigned", 145)
    );
    requestRows.push(
      requestRow(146, "Synthetic former helper gap", "drafting", 146)
    );
    staffRows.push({ id: 145, name: " " });
    await render("/admin/staff-handbook?tab=requests");
    await settle(() =>
      expect(
        container
          .querySelector('[aria-label="Report results"]')
          ?.querySelectorAll("li")
      ).toHaveLength(4)
    );
    const rows = Array.from(
      container.querySelectorAll('[aria-label="Report results"] li')
    );
    expect(rows[0].querySelector("h3")?.textContent).toBe(
      "Synthetic unassigned gap"
    );
    expect(rows[0].textContent).toContain("General · Reported");
    expect(rows[0].textContent).not.toContain("Helping:");
    expect(rows[1].textContent).toContain("Someone is working on it");
    expect(rows[1].textContent).toContain("Updated");
    expect(rows[1].textContent).toContain("Helping: Synthetic staff");
    expect(rows[2].textContent).not.toContain("Helping:");
    expect(rows[3].textContent).not.toContain("Helping:");
    expect(normalize(container.textContent)).not.toMatch(
      /#\d+|Staff #|Request #|\b(?:report|request|staff|assignee) ID\b|priority|operational/i
    );
    const options = Array.from(
      (field("Who's helping") as HTMLSelectElement).options
    );
    expect(options.map(option => option.textContent)).toEqual([
      "Anyone",
      "No one yet",
      "Synthetic staff",
      "Staff member",
    ]);
    await input("Who's helping", "145");
    await settle(() =>
      expect(lastCall("staffHandbook.requests").input.assigneeId).toBe(145)
    );
    expect(calls.filter(call => call.type === "mutation")).toEqual([]);
  });

  it("clears guide filters and unfinished search text and helps staff recover from no results", async () => {
    await render();
    await settle(() => expect(guideResults()).toBeTruthy());
    expect(container.textContent).not.toContain("Clear filters");
    await input("Search guides", "unfinished search");
    expect(button("Clear filters")).toBeTruthy();
    expect(lastCall("staffHandbook.browse").input.search).toBeUndefined();
    await click("Clear filters");
    expect(field("Search guides").value).toBe("");
    await input("Guide view", "archived");
    await input("Category", "Synthetic category");
    await input("Search guides", "nothing here");
    await submit("Search guides");
    await settle(() =>
      expect(guideResults()?.querySelectorAll("li")).toHaveLength(0)
    );
    expect(container.textContent).toContain("No guides match these filters.");
    const emptyState = Array.from(container.querySelectorAll("p")).find(item =>
      item.textContent?.includes("No guides match")
    )!.parentElement!;
    expect(
      Array.from(emptyState.querySelectorAll("button")).map(item =>
        normalize(item.textContent)
      )
    ).toEqual(["New guide", "Report missing guidance"]);
    await click("Clear filters");
    await settle(() =>
      expect(guideResults()?.textContent).toContain("Synthetic saved draft")
    );
    expect(field("Search guides").value).toBe("");
    expect(field("Category").value).toBe("");
    expect(field("Guide view").value).toBe("all");
    expect(container.textContent).not.toContain("Clear filters");
    expect(lastCall("staffHandbook.browse").input).toMatchObject({
      view: "all",
      page: 1,
    });
    expect(lastCall("staffHandbook.browse").input.search).toBeUndefined();
    expect(lastCall("staffHandbook.browse").input.category).toBeUndefined();
    expect(calls.filter(call => call.type === "mutation")).toEqual([]);
  });

  it("clears every report filter and offers a report action when nothing matches", async () => {
    await render("/admin/staff-handbook?tab=requests");
    await settle(() =>
      expect(
        container.querySelector('[aria-label="Report results"]')
      ).toBeTruthy()
    );
    for (const [label, value] of [
      ["Status", "closed"],
      ["Who's helping", "unassigned"],
      ["Category", "Synthetic category"],
    ]) {
      await input(label, value);
      expect(button("Clear filters")).toBeTruthy();
      await click("Clear filters");
      expect(field("Status").value).toBe("all");
      expect(field("Who's helping").value).toBe("");
      expect(field("Category").value).toBe("");
    }
    await input("Status", "closed");
    await input("Who's helping", "unassigned");
    await input("Category", "Synthetic category");
    await input("Search reports", "nothing here");
    await submit("Search reports");
    await settle(() =>
      expect(
        container
          .querySelector('[aria-label="Report results"]')
          ?.querySelectorAll("li")
      ).toHaveLength(0)
    );
    expect(container.textContent).toContain("No reports match these filters.");
    const emptyState = Array.from(container.querySelectorAll("p")).find(item =>
      item.textContent?.includes("No reports match")
    )!.parentElement!;
    const reportButton = emptyState.querySelector<HTMLButtonElement>("button")!;
    expect(normalize(reportButton.textContent)).toBe("Report missing guidance");
    await click("Clear filters");
    await settle(() =>
      expect(
        container
          .querySelector('[aria-label="Report results"]')
          ?.querySelectorAll("li")
      ).toHaveLength(2)
    );
    expect(field("Search reports").value).toBe("");
    expect(container.textContent).not.toContain("Clear filters");
    expect(lastCall("staffHandbook.requests").input).toMatchObject({
      status: "all",
      page: 1,
    });
    expect(lastCall("staffHandbook.requests").input.search).toBeUndefined();
    expect(lastCall("staffHandbook.requests").input.category).toBeUndefined();
    expect(lastCall("staffHandbook.requests").input.assigneeId).toBeUndefined();
    expect(calls.filter(call => call.type === "mutation")).toEqual([]);
  });

  it("opens a newly saved guide and keeps its draft visible on return even after starting in a filtered view", async () => {
    await render();
    await input("Guide view", "archived");
    await input("Category", "Synthetic category");
    await input("Search guides", "old title");
    await submit("Search guides");
    await click("New guide");
    expect(button("New guide").disabled).toBe(true);
    expect(button("Report missing guidance").disabled).toBe(true);
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
    await settle(() => expect(field("Title").value).toBe("newtestguide"));
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
    expect(field("Search guides").value).toBe("");
    expect(field("Category").value).toBe("");
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
    await click("Report missing guidance");
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

  it("opens the missing-guidance report from the compact action and returns to the saved report", async () => {
    await render();
    await click("Report missing guidance");
    expect(button("New guide").disabled).toBe(true);
    expect(button("Report missing guidance").disabled).toBe(true);
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
    await click("Back to reports");
    await settle(() =>
      expect(
        container.querySelector('[aria-label="Report results"]')?.textContent
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
    await click("Missing guidance");
    await settle(() =>
      expect(
        container.querySelector('[aria-label="Report results"]')
      ).toBeTruthy()
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Report results"] button'
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
    requestRows[0].articleId = 8;
    await render();
    await input("Guide view", "archived");
    await click("Missing guidance");
    await input("Search reports", "unassigned gap");
    await submit("Search reports");
    await settle(() =>
      expect(
        container
          .querySelector('[aria-label="Report results"]')
          ?.querySelectorAll("li").length
      ).toBe(1)
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Report results"] button'
        )!
        .click()
    );
    await settle(() =>
      expect(container.querySelector("[data-knowledge-request]")).toBeTruthy()
    );
    await settle(() =>
      expect(button("Read Synthetic published guide").disabled).toBe(false)
    );
    expect(lastCall("staffHandbook.linkOptions").input).toMatchObject({
      type: "guides",
      scope: "active",
      selectedId: 8,
      page: 1,
    });
    await click("Read Synthetic published guide");
    await settle(() =>
      expect(
        container.querySelector("[data-handbook-reading]")?.textContent
      ).toContain("Synthetic published guide")
    );
    expect(location.history?.at(-1)).toBe(
      "/admin/staff-handbook?tab=handbook&article=8"
    );
    await click("Back to guides");
    await settle(() =>
      expect(guideResults()?.textContent).toContain("Synthetic saved draft")
    );
    expect(field("Guide view").value).toBe("all");
    expect(field("Search guides").value).toBe("");
    expect(lastCall("staffHandbook.browse").input).toMatchObject({
      view: "all",
      page: 1,
    });
    expect(lastCall("staffHandbook.browse").input.search).toBeUndefined();
  });

  it("opens a guide created from a report in the editor and keeps its draft in the guide list", async () => {
    await render("/admin/staff-handbook?tab=requests&request=11");
    await settle(() => expect(button("Write a guide").disabled).toBe(false));
    await click("Write a guide");
    await settle(() =>
      expect(location.history?.at(-1)).toBe(
        "/admin/staff-handbook?tab=handbook&article=78"
      )
    );
    await settle(() =>
      expect(field("Title").value).toBe("Synthetic unassigned gap")
    );
    expect(container.querySelector("[data-handbook-reading]")).toBeNull();
    expect(details.get(78)?.published).toBeNull();
    expect(requestRows[0].status).toBe("new");
    expect(
      lastCall("staffHandbook.createGuideFromRequest").input
    ).toMatchObject({ id: 11, expectedVersion: 1 });
    expect(
      calls.filter(call => call.type === "mutation").map(call => call.path)
    ).toEqual(["staffHandbook.createGuideFromRequest"]);
    await click("Back to guides");
    await settle(() =>
      expect(guideResults()?.textContent).toContain("Synthetic unassigned gap")
    );
    expect(guideResults().querySelector("li")?.textContent).toContain("Draft");
    expect(field("Guide view").value).toBe("all");
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
