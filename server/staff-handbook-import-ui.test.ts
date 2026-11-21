// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRouter } from "./routers";
import { emptyHandbookContent } from "../shared/staff-handbook";
import {
  handbookImportTemplate,
  HANDBOOK_IMPORT_MAX_BYTES,
  type HandbookImportPreview,
  type HandbookImportReceipt,
} from "../shared/staff-handbook-import";
import { trpc } from "../client/src/lib/trpc";
const auth = vi.hoisted(() => ({ user: null as any, loading: false }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: auth.user, loading: auth.loading, error: null }),
}));
vi.mock("@/components/RichEmailEditor", async () => {
  const { createElement } = await import("react");
  return {
    RichEmailEditor: (props: any) =>
      createElement("textarea", {
        "aria-label": props.ariaLabel,
        value: props.value,
        onChange: (e: any) => props.onChange(e.target.value),
      }),
  };
});
import StaffHandbook from "../client/src/pages/admin/StaffHandbook";
let root: Root;
let container: HTMLDivElement;
let cache: QueryClient;
let client: ReturnType<typeof trpc.createClient>;
let calls: { path: string; input: any }[];
let handlers: Map<string, (input: any) => any>;
let network: ReturnType<typeof vi.fn>;
let downloads: ReturnType<typeof vi.fn>;
let blobs: Blob[];
let downloadCleanups: (() => void)[];
let preview: HandbookImportPreview;
let receipt: HandbookImportReceipt;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function denied(code: "FORBIDDEN" | "UNAUTHORIZED" = "FORBIDDEN") {
  return TRPCClientError.from<AppRouter>({
    error: {
      message: "Access revoked",
      code: -32003,
      data: { code, httpStatus: code === "FORBIDDEN" ? 403 : 401 },
    },
  });
}
const transport: TRPCLink<AppRouter> =
  () =>
  ({ op }) =>
    observable(observer => {
      calls.push({ path: op.path, input: op.input });
      let stopped = false;
      Promise.resolve()
        .then(() => {
          const handler = handlers.get(op.path);
          if (!handler) throw new Error(`Unexpected operation ${op.path}`);
          return handler(op.input);
        })
        .then(
          data => {
            if (!stopped) {
              observer.next({ result: { data } });
              observer.complete();
            }
          },
          error => {
            if (!stopped) observer.error(TRPCClientError.from(error));
          }
        );
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
      React.createElement(StaffHandbook)
    )
  );
}
async function render() {
  await act(async () => root.render(element()));
}
async function settle(check: () => void) {
  for (let n = 0; n < 70; n++) {
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    try {
      check();
      return;
    } catch (error) {
      if (n === 69) throw error;
    }
  }
}
const text = (el: Element) => el.textContent?.replace(/\s+/g, " ").trim();
function button(label: string) {
  const result = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button")
  ).find(el => text(el) === label);
  expect(result, label).toBeTruthy();
  return result!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
function field(label: string) {
  const result = Array.from(
    container.querySelectorAll<HTMLLabelElement>("label")
  ).find(el => text(el) === label);
  expect(result, label).toBeTruthy();
  return document.getElementById(result!.htmlFor)! as
    | HTMLInputElement
    | HTMLSelectElement;
}
async function input(label: string, value: string) {
  const el = field(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      el.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      "value"
    )!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })
    );
  });
}
async function submit(label: string) {
  await act(async () =>
    field(label)
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
}
function file(name = "synthetic.csv", contents = handbookImportTemplate()) {
  const result = new File([contents], name, { type: "text/csv" });
  // Happy DOM File does not expose arrayBuffer in every version. Supply bytes,
  // not a text mock: production's fatal UTF-8 decoder still runs.
  Object.defineProperty(result, "arrayBuffer", {
    configurable: true,
    value: () => Promise.resolve(new TextEncoder().encode(contents).buffer),
  });
  return result;
}
async function choose(result: File | undefined) {
  const el = field("CSV file");
  await act(async () => {
    Object.defineProperty(el, "files", {
      configurable: true,
      value: result ? [result] : [],
    });
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function start() {
  await render();
  await settle(() =>
    expect(container.querySelector("[data-staff-handbook]")).toBeTruthy()
  );
  await click("Import guides");
}
async function ready() {
  await start();
  await choose(file());
  await click("Preview");
  await settle(() =>
    expect(container.querySelector("[data-import-preview]")).toBeTruthy()
  );
}
async function check(label: string) {
  await act(async () =>
    container
      .querySelector<HTMLInputElement>(`input[aria-label='${label}']`)!
      .click()
  );
}
function last(path: string) {
  return calls.filter(c => c.path === `staffHandbook.${path}`).at(-1)!;
}
function beforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  network = vi.fn(() => {
    throw new Error("No network or providers permitted");
  });
  vi.stubGlobal("fetch", network);
  window.happyDOM.settings.disableJavaScriptFileLoading = true;
  window.happyDOM.settings.disableCSSFileLoading = true;
  window.happyDOM.settings.enableJavaScriptEvaluation = false;
  window.happyDOM.setURL(
    "https://portal.example.test/admin/staff-handbook?tab=handbook"
  );
  history.replaceState({}, "", "/admin/staff-handbook?tab=handbook");
  vi.spyOn(window, "confirm").mockReturnValue(false);
  downloads = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  blobs = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation(blob => {
    blobs.push(blob as Blob);
    return `blob:synthetic-${blobs.length}`;
  });
  downloadCleanups = [];
  const nativeTimeout = window.setTimeout.bind(window);
  vi.spyOn(window, "setTimeout").mockImplementation(((
    callback: any,
    delay?: number,
    ...args: any[]
  ) => {
    if (delay === 1000) {
      downloadCleanups.push(() => callback(...args));
      return 0;
    }
    return nativeTimeout(callback, delay, ...args);
  }) as typeof window.setTimeout);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  auth.user = {
    id: 99,
    role: "admin",
    isActive: true,
    portalStatus: "active",
    mustChangePassword: false,
  };
  auth.loading = false;
  calls = [];
  handlers = new Map();
  const content = {
    ...emptyHandbookContent(99),
    title: "Synthetic draft",
    format: "article" as const,
    contentHtml:
      '<h2>Safe preview</h2><p>Retained body</p><script>evil()</script><img src="https://bad.test/track"><p onclick="evil()">Cleaned</p>',
  };
  preview = {
    previewHash: "signed-preview",
    readyCount: 2,
    skippedCount: 1,
    errorCount: 2,
    rows: [
      {
        rowNumber: 2,
        externalReference: "JLT-001",
        title: content.title,
        status: "ready",
        errors: [],
        warnings: [],
        articleId: null,
        guideUrl: null,
        content,
      },
      {
        rowNumber: 3,
        externalReference: "JLT-002",
        title: "Warning draft",
        status: "ready",
        errors: [],
        warnings: ["Unsafe markup removed"],
        articleId: null,
        guideUrl: null,
        content,
      },
      {
        rowNumber: 4,
        externalReference: "JLT-003",
        title: "Existing draft",
        status: "already_imported",
        errors: [],
        warnings: [],
        articleId: 8,
        guideUrl: "https://evil.test/wrong",
        content: null,
      },
      {
        rowNumber: 5,
        externalReference: "JLT-004",
        title: "Invalid draft",
        status: "invalid",
        errors: ["Category is required"],
        warnings: [],
        articleId: null,
        guideUrl: null,
        content: null,
      },
      {
        rowNumber: 6,
        externalReference: "JLT-005",
        title: "Conflict draft",
        status: "conflict",
        errors: ["Reference content changed"],
        warnings: [],
        articleId: 8,
        guideUrl: null,
        content: null,
      },
    ],
  };
  receipt = {
    createdCount: 1,
    skippedCount: 3,
    errorCount: 1,
    rows: [
      {
        rowNumber: 2,
        externalReference: "=EXTERNAL",
        title: "Saved draft",
        outcome: "created",
        articleId: 77,
        guideUrl: "https://evil.test",
        message: "Draft saved",
      },
      {
        rowNumber: 3,
        externalReference: "JLT-002",
        title: "Warning draft",
        outcome: "not_selected",
        articleId: null,
        guideUrl: null,
        message: "Not selected",
      },
      {
        rowNumber: 4,
        externalReference: "JLT-003",
        title: "Existing draft",
        outcome: "already_imported",
        articleId: 8,
        guideUrl: "https://evil.test",
        message: "Already imported",
      },
      {
        rowNumber: 5,
        externalReference: "JLT-004",
        title: "Invalid draft",
        outcome: "invalid",
        articleId: null,
        guideUrl: null,
        message: "Invalid row",
      },
      {
        rowNumber: 6,
        externalReference: "JLT-005",
        title: "Conflict draft",
        outcome: "conflict",
        articleId: null,
        guideUrl: null,
        message: "Conflicting content",
      },
    ],
  };
  handlers.set("staffHandbook.overview", () => ({
    categories: ["General"],
    staff: [{ id: 99, name: "Synthetic staff" }],
    metrics: {},
    byAssignee: [],
    byCategory: [],
  }));
  handlers.set("staffHandbook.browse", input => ({
    items: [],
    total: 70,
    page: input.page ?? 1,
    pageSize: 25,
  }));
  handlers.set("staffHandbook.requests", input => ({
    items: [],
    total: 70,
    page: input.page ?? 1,
    pageSize: 25,
  }));
  handlers.set("staffHandbook.previewImport", () => preview);
  handlers.set("staffHandbook.commitImport", () => receipt);
  handlers.set("staffHandbook.exportGuides", () => ({
    csv: '\uFEFF"guide_url"\r\n"https://portal.example.test/admin/staff-handbook?tab=handbook&article=8"\r\n',
    rowCount: 70,
    snapshot: "draft_or_published",
    generatedAt: new Date().toISOString(),
  }));
  handlers.set("staffHandbook.exportRequests", () => ({
    csv: '\uFEFF"title"\r\n"Synthetic report"\r\n',
    rowCount: 70,
    snapshot: "all_matching",
    generatedAt: new Date().toISOString(),
  }));
  handlers.set("auth.me", () => auth.user);
  handlers.set("staffHandbook.article", ({ id }) => ({
    article: {
      id,
      version: 1,
      archivedAt: null,
      draftRevisionId: 1,
      publishedRevisionId: null,
    },
    draft: {
      id: 1,
      articleId: id,
      revisionNumber: 1,
      content,
      resourceIds: [],
      contributorIds: [],
      createdAt: new Date(),
      createdById: 99,
      changeSummary: "Saved",
    },
    published: null,
    revisions: [],
    resources: [],
    audit: [],
  }));
  cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  client = trpc.createClient({ links: [transport] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  downloadCleanups.forEach(cleanup => cleanup());
  cache.clear();
  container.remove();
  expect(network).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("staff handbook CSV import with actual DOM and tRPC hooks", () => {
  it("opens inline without competing forms/actions, reads only on file choice and previews explicitly", async () => {
    await start();
    expect(
      container.querySelector('[aria-label="Handbook sections"]')
    ).toBeNull();
    expect(container.querySelector("[data-handbook-export]")).toBeNull();
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(container.textContent).not.toContain("New guide");
    await choose(file());
    expect(last("previewImport")).toBeUndefined();
    expect(last("commitImport")).toBeUndefined();
    expect(beforeUnload()).toBe(true);
    await click("Preview");
    await settle(() =>
      expect(container.querySelector("[data-import-preview]")).toBeTruthy()
    );
    expect(last("previewImport").input.csv).toBe(handbookImportTemplate());
    expect(last("commitImport")).toBeUndefined();
    expect(container.textContent).toContain("drafts only");
  });
  it("selects ready rows only, shows all statuses/errors/warnings and sanitises expandable HTML", async () => {
    await ready();
    const boxes = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        'input[aria-label^="Select row"]'
      )
    );
    expect(boxes.map(el => [el.checked, el.disabled])).toEqual([
      [true, false],
      [true, false],
      [false, true],
      [false, true],
      [false, true],
    ]);
    for (const message of [
      "Already imported",
      "Invalid",
      "Conflict",
      "Category is required",
      "Unsafe markup removed",
      "Reference content changed",
    ])
      expect(container.textContent).toContain(message);
    expect(container.querySelectorAll("details")).toHaveLength(2);
    expect(
      container.querySelector(
        "[data-import-preview] script, [data-import-preview] img, [onclick]"
      )
    ).toBeNull();
    expect(
      container.querySelector("[data-handbook-reading]")?.textContent
    ).toContain("Retained body");
    expect(button("Import selected drafts").disabled).toBe(true);
    await check("Acknowledge selected row warnings");
    expect(button("Import selected drafts").disabled).toBe(false);
    await click("Import selected drafts");
    await settle(() =>
      expect(container.querySelector("[data-import-receipt]")).toBeTruthy()
    );
    expect(last("commitImport").input).toEqual({
      csv: handbookImportTemplate(),
      previewHash: "signed-preview",
      rows: [2, 3],
    });
  });
  it("requires a non-empty selection and updates warning acknowledgement on selection changes", async () => {
    await ready();
    await check("Acknowledge selected row warnings");
    await check("Select row 2");
    expect(button("Import selected drafts").disabled).toBe(true);
    await check("Select row 3");
    expect(button("Import selected drafts").disabled).toBe(true);
    await check("Select row 2");
    expect(button("Import selected drafts").disabled).toBe(false);
    await click("Import selected drafts");
    await settle(() => expect(last("commitImport")).toBeTruthy());
    expect(last("commitImport").input.rows).toEqual([2]);
  });
  it("guards Back/Cancel while retaining work if declined and clears on confirmed close", async () => {
    await ready();
    await click("Back to guides");
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-import-preview]")).toBeTruthy();
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("Cancel import");
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[data-handbook-import]")).toBeNull();
    expect(beforeUnload()).toBe(false);
    expect(
      cache
        .getMutationCache()
        .getAll()
        .filter(m => String(m.options.mutationKey).includes("previewImport"))
    ).toHaveLength(0);
  });
  it("rejects files over 5 MiB and malformed UTF-8 without sending CSV to the server", async () => {
    await start();
    const big = file();
    Object.defineProperty(big, "size", {
      value: HANDBOOK_IMPORT_MAX_BYTES + 1,
    });
    await choose(big);
    expect(container.textContent).toContain("no larger than 5 MiB");
    expect(button("Preview").disabled).toBe(true);
    const invalid = file();
    Object.defineProperty(invalid, "arrayBuffer", {
      value: () => Promise.resolve(new Uint8Array([0xc3, 0x28]).buffer),
    });
    await choose(invalid);
    expect(container.textContent).toContain("not valid UTF-8");
    expect(last("previewImport")).toBeUndefined();
  });
  it("ignores stale file read success/error and invalidates preview immediately when file changes", async () => {
    await ready();
    const slow = deferred<ArrayBuffer>();
    const first = file("old.csv");
    Object.defineProperty(first, "arrayBuffer", { value: () => slow.promise });
    await choose(first);
    expect(container.querySelector("[data-import-preview]")).toBeNull();
    expect(button("Reading file…").disabled).toBe(true);
    await choose(file("new.csv", "new exact csv"));
    await act(async () =>
      slow.resolve(new TextEncoder().encode("old wrong csv").buffer)
    );
    expect(container.textContent).toContain("new.csv");
    await click("Preview");
    await settle(() =>
      expect(last("previewImport").input.csv).toBe("new exact csv")
    );
  });
  it("discards stale read errors and keeps prior reviewed selections on recoverable re-preview failure", async () => {
    await start();
    const slow = deferred<ArrayBuffer>();
    const old = file("old.csv");
    Object.defineProperty(old, "arrayBuffer", { value: () => slow.promise });
    await choose(old);
    await choose(file());
    await act(async () => slow.reject(new Error("Old failed file")));
    expect(container.textContent).not.toContain("Old failed file");
    await click("Preview");
    await settle(() =>
      expect(container.querySelector("[data-import-preview]")).toBeTruthy()
    );
    await check("Select row 3");
    handlers.set("staffHandbook.previewImport", () => {
      throw new Error("Preview response lost");
    });
    await click("Preview");
    await settle(() =>
      expect(container.textContent).toContain("Preview response lost")
    );
    expect(container.querySelector("[data-import-preview]")).toBeTruthy();
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="Select row 2"]')!
        .checked
    ).toBe(true);
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="Select row 3"]')!
        .checked
    ).toBe(false);
    await click("Import selected drafts");
    await settle(() => expect(last("commitImport")).toBeTruthy());
    expect(last("commitImport").input.rows).toEqual([2]);
  });
  it("ignores an old preview response after file replacement and permits a new preview", async () => {
    const slow = deferred<HandbookImportPreview>();
    handlers.set("staffHandbook.previewImport", () => slow.promise);
    await start();
    await choose(file());
    await click("Preview");
    await choose(file("new.csv", "replacement csv"));
    handlers.set("staffHandbook.previewImport", () => preview);
    await click("Preview");
    await settle(() =>
      expect(container.querySelector("[data-import-preview]")).toBeTruthy()
    );
    await act(async () =>
      slow.resolve({ ...preview, rows: [], readyCount: 0 })
    );
    expect(
      container.querySelectorAll('[aria-label="Import preview rows"] > li')
    ).toHaveLength(5);
    expect(last("previewImport").input.csv).toBe("replacement csv");
  });
  it("blocks double commit synchronously and freezes file and selection while pending", async () => {
    const slow = deferred<HandbookImportReceipt>();
    handlers.set("staffHandbook.commitImport", () => slow.promise);
    await ready();
    await check("Select row 3");
    const commit = button("Import selected drafts");
    await act(async () => {
      commit.click();
      commit.click();
    });
    expect(
      calls.filter(c => c.path === "staffHandbook.commitImport")
    ).toHaveLength(1);
    expect(field("CSV file").disabled).toBe(true);
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="Select row 2"]')!
        .disabled
    ).toBe(true);
    expect(beforeUnload()).toBe(true);
    await click("Cancel import");
    expect(container.querySelector("[data-handbook-import]")).toBeTruthy();
    await act(async () => slow.resolve(receipt));
    await settle(() =>
      expect(container.querySelector("[data-import-receipt]")).toBeTruthy()
    );
  });
  it("retains exact file/hash/selection after a lost commit response for a safe same-file retry", async () => {
    handlers.set("staffHandbook.commitImport", () => {
      throw new Error("Lost response");
    });
    await ready();
    await check("Select row 3");
    await click("Import selected drafts");
    await settle(() => expect(container.textContent).toContain("retry safely"));
    expect(container.querySelector("[data-import-receipt]")).toBeNull();
    const original = last("commitImport").input;
    handlers.set("staffHandbook.commitImport", () => ({
      ...receipt,
      createdCount: 0,
      rows: receipt.rows.map(row =>
        row.outcome === "created"
          ? { ...row, outcome: "already_imported" }
          : row
      ),
    }));
    await click("Import selected drafts");
    await settle(() =>
      expect(container.querySelector("[data-import-receipt]")).toBeTruthy()
    );
    expect(last("commitImport").input).toEqual(original);
    expect(container.textContent).toContain("Already imported");
  });
  it("retains receipt when list refresh fails and invalidates only handbook queries", async () => {
    cache.setQueryData([["unrelated"], { type: "query" }], { preserved: true });
    await ready();
    await check("Select row 3");
    handlers.set("staffHandbook.browse", () => {
      throw new Error("List unavailable");
    });
    await click("Import selected drafts");
    await settle(() =>
      expect(container.textContent).toContain(
        "Import completed, but the guide list could not refresh"
      )
    );
    expect(
      container.querySelector("[data-import-receipt]")?.textContent
    ).toContain("1 drafts created");
    expect(container.textContent).not.toContain("retry safely");
    expect(cache.getQueryData([["unrelated"], { type: "query" }])).toEqual({
      preserved: true,
    });
  });
  it("downloads a spreadsheet-safe receipt with canonical origin URLs, not server-supplied links", async () => {
    await ready();
    await check("Select row 3");
    await click("Import selected drafts");
    await settle(() =>
      expect(container.querySelector("[data-import-receipt]")).toBeTruthy()
    );
    await click("Download import results (CSV)");
    expect(downloads).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(downloadCleanups).toHaveLength(1);
    downloadCleanups.shift()!();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    const csv = await blobs[0].text();
    expect(csv).toContain(
      "https://portal.example.test/admin/staff-handbook?tab=handbook&article=77"
    );
    expect(csv).not.toContain("evil.test");
    expect(csv).toContain("'=EXTERNAL");
    expect(
      container.querySelector("[data-import-receipt] a")?.getAttribute("href")
    ).toBe("/admin/staff-handbook?tab=handbook&article=77");
    expect(container.textContent).not.toContain("Nothing is saved");
    expect(container.textContent).toContain("Original reviewed preview");
    expect(
      container.querySelector('[aria-label="Import result rows"]')?.className
    ).toContain("overflow-y-auto");
  });
  it("opens receipt guide IDs through the existing guide callback after a single confirmation", async () => {
    await ready();
    await check("Select row 3");
    await click("Import selected drafts");
    await settle(() =>
      expect(container.querySelector("[data-import-receipt]")).toBeTruthy()
    );
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () =>
      container
        .querySelector<HTMLAnchorElement>("[data-import-receipt] a")!
        .dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            button: 0,
          })
        )
    );
    await settle(() => expect(location.search).toContain("article=77"));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-handbook-import]")).toBeNull();
    expect(last("article").input.id).toBe(77);
  });
  it.each(["previewImport", "commitImport"])(
    "clears private file/preview/receipt immediately on %s authority denial",
    async path => {
      if (path === "previewImport") {
        await start();
        await choose(file());
        handlers.set(`staffHandbook.${path}`, () => {
          throw denied();
        });
        await click("Preview");
      } else {
        await ready();
        await check("Select row 3");
        handlers.set(`staffHandbook.${path}`, () => {
          throw denied();
        });
        await click("Import selected drafts");
      }
      await settle(() =>
        expect(container.querySelector("[data-handbook-import]")).toBeNull()
      );
      expect(container.textContent).toContain(
        "unsaved edits have been cleared"
      );
      expect(beforeUnload()).toBe(false);
      expect(window.confirm).not.toHaveBeenCalled();
    }
  );
  it("does not keep preview or storage after identity change, or finish a stale read after unmount", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    await ready();
    auth.user = { ...auth.user, id: 100 };
    await render();
    await settle(() =>
      expect(container.querySelector("[data-handbook-import]")).toBeNull()
    );
    await click("Import guides");
    expect(container.querySelector("[data-import-preview]")).toBeNull();
    const slow = deferred<ArrayBuffer>();
    const pending = file();
    Object.defineProperty(pending, "arrayBuffer", {
      value: () => slow.promise,
    });
    await choose(pending);
    auth.user = null;
    await render();
    await act(async () =>
      slow.resolve(new TextEncoder().encode("private stale csv").buffer)
    );
    expect(container.querySelector("[data-handbook-import]")).toBeNull();
    expect(storage).not.toHaveBeenCalled();
    expect(beforeUnload()).toBe(false);
  });
});

describe("all-matching CSV export guards with actual tRPC", () => {
  it("exports guide filters across all pages without sending page or silently exporting on load", async () => {
    await render();
    await settle(() =>
      expect(container.querySelector("[data-handbook-export]")).toBeTruthy()
    );
    expect(last("exportGuides")).toBeUndefined();
    await input("Guide view", "drafts");
    await input("Category", "General");
    await input("Search guides", "confirmed search");
    await submit("Search guides");
    await settle(() => expect(button("Next").disabled).toBe(false));
    await click("Next");
    await click("Export all matching guides (CSV)");
    await settle(() => expect(downloads).toHaveBeenCalledTimes(1));
    expect(last("exportGuides").input).toEqual({
      view: "drafts",
      category: "General",
      search: "confirmed search",
    });
    expect(last("exportGuides").input).not.toHaveProperty("page");
    expect(container.textContent).toContain("Exported 70 matching guides");
    expect(container.textContent).toContain("CSV snapshot: Working draft");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    downloadCleanups.shift()!();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
  it("exports report status/assignee/search/category filters with no page", async () => {
    await render();
    await settle(() =>
      expect(container.querySelector("[data-handbook-export]")).toBeTruthy()
    );
    await click("Missing guidance");
    await input("Status", "open");
    await input("Who's helping", "unassigned");
    await input("Category", "General");
    await input("Search reports", "gap");
    await submit("Search reports");
    await click("Export all matching reports (CSV)");
    await settle(() => expect(downloads).toHaveBeenCalledTimes(1));
    expect(last("exportRequests").input).toEqual({
      search: "gap",
      category: "General",
      status: "open",
      assigneeId: null,
    });
  });
  it.each(["filter", "route", "identity", "denial"])(
    "discards delayed export after %s context change",
    async change => {
      const slow = deferred<any>();
      handlers.set("staffHandbook.exportGuides", () => slow.promise);
      await render();
      await settle(() =>
        expect(container.querySelector("[data-handbook-export]")).toBeTruthy()
      );
      await click("Export all matching guides (CSV)");
      if (change === "filter")
        await input("Search guides", "unfinished new search");
      if (change === "route") await click("Import guides");
      if (change === "identity") {
        auth.user = null;
        await render();
      }
      if (change === "denial") {
        handlers.set("staffHandbook.overview", () => {
          throw denied();
        });
        await act(async () => {
          await cache.invalidateQueries({
            queryKey: [["staffHandbook", "overview"]],
          });
        });
        await settle(() =>
          expect(container.querySelector("[data-staff-handbook]")).toBeNull()
        );
      }
      await act(async () =>
        slow.resolve({
          csv: "private delayed export",
          rowCount: 70,
          snapshot: "all",
          generatedAt: "now",
        })
      );
      await new Promise(r => setTimeout(r, 5));
      expect(downloads).not.toHaveBeenCalled();
      expect(blobs).toHaveLength(0);
    }
  );
  it("does not download on export denial and strips the whole private workspace", async () => {
    handlers.set("staffHandbook.exportGuides", () => {
      throw denied("UNAUTHORIZED");
    });
    await render();
    await settle(() =>
      expect(container.querySelector("[data-handbook-export]")).toBeTruthy()
    );
    await click("Export all matching guides (CSV)");
    await settle(() =>
      expect(container.querySelector("[data-staff-handbook]")).toBeNull()
    );
    expect(downloads).not.toHaveBeenCalled();
  });
});
