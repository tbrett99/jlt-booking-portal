// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mount the actual Academy Manager and UI controls. Only its tRPC transport and
// view-mode context are synthetic; no server, learner records or network access.
const archivePath = "academy.admin.setLessonArchived";
const mock = vi.hoisted(() => ({
  data: {} as Record<string, any>,
  dataUpdatedAt: {} as Record<string, number>,
  mutations: [] as { path: string; input: any }[],
  operations: [] as string[],
  invalidations: [] as { path: string; options: any }[],
  reject: {} as Record<string, string>,
  waitFor: {} as Record<string, Promise<void>>,
  refreshReject: {} as Record<string, string>,
  archiveResults: {} as Record<number, Date | null>,
  academyRefresh: null as null | (() => void),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/contexts/ViewModeContext", () => ({
  useViewMode: () => ({ setViewMode: vi.fn(), isAdminView: true }),
}));
vi.mock("sonner", () => ({
  toast: { success: mock.success, error: mock.error, warning: mock.warning },
}));
vi.mock("@/lib/trpc", async () => {
  const react = await import("react");
  const node = (path = ""): any => new Proxy({}, {
    get: (_target, key: string) => {
      if (key === "useUtils") return () => node("utils");
      if (key === "useQuery") return () => ({
        data: mock.data[path], isLoading: false, isRefetching: false,
        dataUpdatedAt: mock.dataUpdatedAt[path] ?? 0,
        error: null, refetch: vi.fn(async () => undefined),
      });
      if (key === "useMutation") return (options: any = {}) => {
        const [isPending, setPending] = react.useState(false);
        const mutateAsync = async (input: any) => {
          mock.mutations.push({ path, input: structuredClone(input) });
          setPending(true);
          try {
            await mock.waitFor[path];
            if (mock.reject[path]) throw new Error(mock.reject[path]);
            const result = path === "academy.admin.setLessonArchived"
              ? {
                  success: true, lessonId: input.lessonId, changed: true,
                  archivedAt: input.archived ? new Date("2026-11-01T12:00:00Z") : null,
                }
              : { success: true, id: input.id ?? 31 };
            if (path === "academy.admin.setLessonArchived") {
              mock.archiveResults[input.lessonId] = result.archivedAt!;
            }
            await options.onSuccess?.(result, input);
            return result;
          } catch (error) {
            options.onError?.(error);
            throw error;
          } finally {
            setPending(false);
          }
        };
        return {
          isPending, mutateAsync,
          mutate: (input: any) => { void mutateAsync(input).catch(() => undefined); },
        };
      };
      if (key === "invalidate") return async (_input: unknown, _filters: unknown, options: any) => {
        mock.operations.push(`${path}.invalidate`);
        mock.invalidations.push({ path, options });
        await mock.waitFor[path];
        // TanStack Query normally swallows refetch errors unless explicitly requested.
        if (mock.refreshReject[path]) {
          if (options?.throwOnError) throw new Error(mock.refreshReject[path]);
          return;
        }
        if (path === "utils.academy") {
          if (mock.academyRefresh) {
            mock.academyRefresh();
            return;
          }
          const editor = structuredClone(mock.data["academy.admin.editor"]);
          for (const lesson of editor.modules.flatMap((module: any) => module.lessons)) {
            if (Object.prototype.hasOwnProperty.call(mock.archiveResults, lesson.id)) {
              lesson.archivedAt = mock.archiveResults[lesson.id];
            }
          }
          mock.data["academy.admin.editor"] = editor;
          mock.dataUpdatedAt["academy.admin.editor"] += 1;
        }
      };
      return node(path ? `${path}.${key}` : key);
    },
  });
  return { trpc: node() };
});

import AdminAcademy from "../client/src/pages/admin/AdminAcademy";

const hiddenAt = new Date("2026-10-01T12:00:00Z");
function lesson(id: number, title: string, archivedAt?: Date | null, videoUrl = "") {
  return {
    id, moduleId: 9, title, archivedAt, videoUrl, summary: null,
    contentHtml: "<p>Synthetic training guidance.</p>", estimatedMinutes: 5,
    isRequired: true, requiresAssessment: false, requiresAcknowledgement: false,
    questions: [],
  };
}
function syntheticEditor() {
  return {
    course: {
      id: 7, title: "Synthetic course", summary: "", status: "published",
      estimatedMinutes: 20, isCoreAcademy: false, isAcceleratorJourney: false,
      updatedAt: new Date("2026-09-01T12:00:00Z"),
    },
    modules: [{
      id: 9, courseId: 7, title: "Synthetic module", summary: null,
      lessons: [
        lesson(11, "Hidden first lesson", hiddenAt, "https://video.example.test/hidden-1"),
        lesson(14, "Active safety lesson", null, "https://video.example.test/active"),
        lesson(15, "Hidden middle lesson", hiddenAt, "https://video.example.test/hidden-2"),
        lesson(16, "Legacy active lesson"), // Old mocks with undefined archivedAt are active.
      ],
    }],
  };
}
const historicEvidence = {
  attempts: [{ id: 41, lessonId: 14, answers: ["Prior answer"], grade: 92 }],
  progress: [{ lessonId: 14, completedAt: new Date("2026-09-20T12:00:00Z") }],
};
let root: Root;
let container: HTMLDivElement;
let previousIframeSetting: boolean;
let confirm: ReturnType<typeof vi.spyOn>;
let evidenceBefore: string;

async function render() {
  await act(async () => root.render(React.createElement(AdminAcademy)));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}
function moduleElement() {
  const element = document.getElementById("academy-module-9");
  expect(element, "actual open module").toBeTruthy();
  return element!;
}
function row(title: string) {
  const heading = [...moduleElement().querySelectorAll("p")]
    .find(item => item.textContent === title);
  expect(heading, `rendered lesson ${title}`).toBeTruthy();
  return heading!.closest("div.flex.flex-col")!;
}
function button(text: string, scope: ParentNode = container) {
  const matches = [...scope.querySelectorAll<HTMLButtonElement>("button")]
    .filter(control => control.textContent?.trim() === text);
  expect(matches, `button ${text}`).toHaveLength(1);
  return matches[0]!;
}
function titledButton(title: string, scope: ParentNode = container) {
  const control = [...scope.querySelectorAll<HTMLButtonElement>("button")]
    .find(item => item.title === title);
  expect(control, `button ${title}`).toBeTruthy();
  return control!;
}
async function click(control: HTMLButtonElement) {
  await act(async () => control.click());
}
function archiveToggle() {
  const label = [...container.querySelectorAll("label")]
    .find(item => item.textContent?.trim() === "Show archived lessons");
  expect(label, "labelled archive toggle").toBeTruthy();
  return label!.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
}
async function showArchived() {
  if (archiveToggle().getAttribute("aria-checked") !== "true") {
    await click(archiveToggle());
  }
}
function moduleHeader() {
  return moduleElement().parentElement!.querySelector<HTMLButtonElement>('button[aria-controls="academy-module-9"]')!;
}
function expectedRefreshes() {
  return [
    "utils.academy.invalidate",
    "utils.crm.agentCrm.getOverview.invalidate",
    "utils.crm.agentCrm.getCallSnapshot.invalidate",
    "utils.crm.agentCrm.list.invalidate",
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mock.fetch);
  mock.fetch.mockImplementation(() => { throw new Error("Network is forbidden in academy archive UI tests"); });
  previousIframeSetting = (window as any).happyDOM.settings.disableIframePageLoading;
  (window as any).happyDOM.settings.disableIframePageLoading = true;
  confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  mock.data = {
    "academy.admin.courses": [{ id: 7, title: "Synthetic course", status: "published", completionCount: 1, enrolmentCount: 2 }],
    "academy.admin.editor": syntheticEditor(),
    "academy.admin.emailAlerts": [],
    "academy.admin.emailAlertActivity": [],
    "academy.admin.learnerReview": structuredClone(historicEvidence),
  };
  mock.dataUpdatedAt = { "academy.admin.editor": 1 };
  evidenceBefore = JSON.stringify(mock.data["academy.admin.learnerReview"]);
  mock.mutations = [];
  mock.operations = [];
  mock.invalidations = [];
  mock.reject = {};
  mock.waitFor = {};
  mock.refreshReject = {};
  mock.archiveResults = {};
  mock.academyRefresh = null;
  window.history.replaceState({}, "", "/admin/academy");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(mock.fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(mock.data["academy.admin.learnerReview"])).toBe(evidenceBefore);
  (window as any).happyDOM.settings.disableIframePageLoading = previousIframeSetting;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Academy lesson archive controls on the actual admin page", () => {
  it("defaults to active-only rows and numbering/counts/videos, including legacy undefined archive dates, without automatic writes", async () => {
    await render();
    expect(archiveToggle().getAttribute("aria-checked")).toBe("false");
    expect(moduleElement().textContent).not.toContain("Hidden first lesson");
    expect(moduleElement().textContent).not.toContain("Hidden middle lesson");
    expect(moduleHeader().textContent).toContain("2 lessons");
    expect(moduleHeader().textContent).toContain("1 video");
    expect(row("Active safety lesson").querySelector("span")?.textContent).toBe("1");
    expect(row("Legacy active lesson").querySelector("span")?.textContent).toBe("2");
    expect(button("Archive", row("Active safety lesson")).title).toContain("retain staff history");
    expect(button("Archive", row("Active safety lesson")).className).not.toMatch(/bg-amber|min-h-12|w-full/);
    expect(mock.mutations).toEqual([]);
  });

  it("shows archived badges and restore controls only on request, keeps active counts, and permits editing historical content", async () => {
    await render();
    await showArchived();
    const hidden = row("Hidden first lesson");
    expect(hidden.textContent).toContain("Archived · Hidden from agents");
    expect(hidden.textContent).toContain("Not required while archived");
    expect(hidden.querySelector("span")?.textContent).toBe("—");
    expect(button("Restore", hidden).title).toBe("Restore Hidden first lesson for agents");
    expect(hidden.querySelector('[title^="Archived "]')?.getAttribute("title")).toContain("1 Oct 2026");
    expect(moduleHeader().textContent).toContain("2 lessons");
    expect(moduleHeader().textContent).toContain("1 video");
    await click(titledButton("Edit lesson name and content", hidden));
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Lesson title"]')?.value
      ?? [...container.querySelectorAll<HTMLInputElement>("input")].find(item => item.value === "Hidden first lesson")?.value).toBe("Hidden first lesson");
    expect(button("Save lesson")).toBeTruthy();
    expect(mock.mutations).toEqual([]);
  });

  it("names the lesson and explains preserved history in both confirmations; cancelling never mutates", async () => {
    confirm.mockReturnValue(false);
    await render();
    await click(button("Archive", row("Active safety lesson")));
    expect(confirm).toHaveBeenLastCalledWith("Hide Active safety lesson from agents? Prior answers, grades and progress remain in staff history. This lesson will no longer be required in the current course.");
    await showArchived();
    await click(button("Restore", row("Hidden first lesson")));
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/Restore Hidden first lesson for agents\?.*may become required again.*historic evidence will not be reset/));
    expect(mock.mutations).toEqual([]);
    expect(mock.operations).toEqual([]);
    expect(mock.success).not.toHaveBeenCalled();
  });

  it("archives only the explicitly confirmed lesson, updates rows/counts and invalidates all Academy plus supported CRM views", async () => {
    await render();
    await click(button("Archive", row("Active safety lesson")));
    expect(mock.mutations).toEqual([{ path: archivePath, input: { lessonId: 14, archived: true } }]);
    expect(moduleElement().textContent).not.toContain("Active safety lesson");
    expect(moduleHeader().textContent).toContain("1 lesson");
    expect(moduleHeader().textContent).not.toContain("video");
    expect(mock.operations).toEqual(expectedRefreshes());
    expect(mock.invalidations.every(call => call.options?.throwOnError === true)).toBe(true);
    expect(mock.success).toHaveBeenCalledWith("Lesson hidden from agents. Prior answers, grades and progress remain in staff history.");
    expect(mock.error).not.toHaveBeenCalled();
    expect(mock.warning).not.toHaveBeenCalled();
    await showArchived();
    expect(row("Active safety lesson").textContent).toContain("Archived · Hidden from agents");
  });

  it("restores only the selected lesson and returns it to active numbering/counts without touching historical evidence", async () => {
    await render();
    await showArchived();
    await click(button("Restore", row("Hidden first lesson")));
    expect(mock.mutations).toEqual([{ path: archivePath, input: { lessonId: 11, archived: false } }]);
    expect(row("Hidden first lesson").textContent).not.toContain("Hidden from agents");
    expect(button("Archive", row("Hidden first lesson"))).toBeTruthy();
    expect(moduleHeader().textContent).toContain("3 lessons");
    expect(moduleHeader().textContent).toContain("2 videos");
    expect(mock.operations).toEqual(expectedRefreshes());
    expect(mock.success).toHaveBeenCalledWith("Lesson restored for agents. Prior answers, grades and progress remain in staff history.");
    await click(archiveToggle());
    expect(row("Hidden first lesson")).toBeTruthy();
    expect(moduleElement().textContent).not.toContain("Hidden middle lesson");
  });

  it("guards two immediate clicks and disables archive/restore and hard delete until confirmed mutation and refresh settle", async () => {
    let release!: () => void;
    mock.waitFor[archivePath] = new Promise<void>(resolve => { release = resolve; });
    await render();
    const control = button("Archive", row("Active safety lesson"));
    try {
      await act(async () => { control.click(); control.click(); });
      expect(mock.mutations).toHaveLength(1);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(control.disabled).toBe(true);
      expect(titledButton("Delete Active safety lesson permanently").disabled).toBe(true);
      expect(button("Archive", row("Legacy active lesson")).disabled).toBe(true);
      await showArchived();
      expect(button("Restore", row("Hidden first lesson")).disabled).toBe(true);
      expect(mock.success).not.toHaveBeenCalled();
      expect(mock.operations).toEqual([]);
    } finally {
      await act(async () => release());
    }
    expect(mock.mutations).toHaveLength(1);
    expect(mock.success).toHaveBeenCalledTimes(1);
  });

  it("keeps confirmed visibility but blocks a second mutation until all cache refreshes settle", async () => {
    let release!: () => void;
    mock.waitFor["utils.academy"] = new Promise<void>(resolve => { release = resolve; });
    await render();
    await showArchived();
    try {
      await click(button("Archive", row("Active safety lesson")));
      const restore = button("Restore", row("Active safety lesson"));
      expect(restore.disabled).toBe(true);
      await click(restore);
      expect(mock.mutations).toHaveLength(1);
      expect(mock.success).not.toHaveBeenCalled();
      expect(mock.operations).toEqual(expectedRefreshes());
    } finally {
      await act(async () => release());
    }
    expect(button("Restore", row("Active safety lesson")).disabled).toBe(false);
    expect(mock.success).toHaveBeenCalledTimes(1);
    expect(mock.mutations).toHaveLength(1);
  });

  it.each([
    { title: "Active safety lesson", action: "Archive", archived: true, id: 14 },
    { title: "Hidden first lesson", action: "Restore", archived: false, id: 11 },
  ])("does not report success or change state after $action mutation failure, then permits an explicit retry", async ({ title, action, archived, id }) => {
    mock.reject[archivePath] = "Lesson visibility update denied";
    await render();
    await showArchived();
    await click(button(action, row(title)));
    expect(mock.error).toHaveBeenCalledWith("Lesson visibility update denied");
    expect(mock.success).not.toHaveBeenCalled();
    expect(mock.warning).not.toHaveBeenCalled();
    expect(mock.operations).toEqual([]);
    expect(button(action, row(title)).disabled).toBe(false);
    expect(mock.mutations).toEqual([{ path: archivePath, input: { lessonId: id, archived } }]);
    mock.reject = {};
    await click(button(action, row(title)));
    expect(mock.mutations).toHaveLength(2);
    expect(mock.mutations[1]).toEqual(mock.mutations[0]);
    expect(mock.success).toHaveBeenCalledTimes(1);
  });

  it.each([
    { title: "Active safety lesson", action: "Archive", archived: true, id: 14 },
    { title: "Hidden first lesson", action: "Restore", archived: false, id: 11 },
  ])("distinguishes a saved $action from refresh failure, keeps confirmed local visibility and never resubmits automatically", async ({ title, action, archived, id }) => {
    mock.refreshReject["utils.academy"] = "Synthetic refresh failure";
    await render();
    await showArchived();
    await click(button(action, row(title)));
    expect(mock.mutations).toEqual([{ path: archivePath, input: { lessonId: id, archived } }]);
    expect(mock.success).not.toHaveBeenCalled();
    expect(mock.error).not.toHaveBeenCalled();
    expect(mock.warning).toHaveBeenCalledWith(expect.stringMatching(/saved, but some views could not refresh.*do not repeat the change.*staff history/));
    expect(mock.operations).toEqual(expectedRefreshes());
    expect(button(archived ? "Restore" : "Archive", row(title))).toBeTruthy();
    await render(); // The stale query still has the old archive date.
    expect(button(archived ? "Restore" : "Archive", row(title))).toBeTruthy();
    expect(mock.mutations).toHaveLength(1);
    await click(archiveToggle());
    expect(moduleElement().textContent?.includes(title)).toBe(!archived);
  });

  it.each([
    { title: "Active safety lesson", action: "Archive", archived: true, id: 14, freshArchivedAt: null },
    { title: "Hidden first lesson", action: "Restore", archived: false, id: 11, freshArchivedAt: hiddenAt },
  ])("reconciles a saved $action after failed refresh with a later divergent fresh server editor, without automatic writes", async ({ title, action, archived, id, freshArchivedAt }) => {
    mock.refreshReject["utils.academy"] = "Synthetic refresh failure";
    await render();
    await showArchived();
    const staleEditor = mock.data["academy.admin.editor"];
    const staleUpdatedAt = mock.dataUpdatedAt["academy.admin.editor"];
    await click(button(action, row(title)));
    const savedToggle = archived ? "Restore" : "Archive";
    expect(button(savedToggle, row(title)).disabled).toBe(false);
    expect(mock.warning).toHaveBeenCalledTimes(1);
    expect(mock.data["academy.admin.editor"]).toBe(staleEditor);
    expect(mock.dataUpdatedAt["academy.admin.editor"]).toBe(staleUpdatedAt);
    await render(); // A failed refresh with identical data must retain the saved overlay.
    expect(button(savedToggle, row(title))).toBeTruthy();

    // Another administrator reversed the change. This is a new successful read,
    // not an acknowledgement matching our saved mutation result.
    delete mock.refreshReject["utils.academy"];
    const freshEditor = structuredClone(staleEditor);
    freshEditor.modules[0].lessons.find((item: any) => item.id === id).archivedAt = freshArchivedAt;
    mock.data["academy.admin.editor"] = freshEditor;
    mock.dataUpdatedAt["academy.admin.editor"] = staleUpdatedAt! + 1;
    await render();
    expect(mock.data["academy.admin.editor"]).not.toBe(staleEditor);
    expect(button(action, row(title)).disabled).toBe(false);
    expect(row(title).textContent?.includes("Archived · Hidden from agents")).toBe(!archived);
    expect(moduleHeader().textContent).toContain("2 lessons");
    expect(moduleHeader().textContent).toContain("1 video");
    await click(archiveToggle());
    expect(moduleElement().textContent?.includes(title)).toBe(archived);
    expect(mock.mutations).toEqual([{ path: archivePath, input: { lessonId: id, archived } }]);
    expect(mock.operations).toEqual(expectedRefreshes());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mock.success).not.toHaveBeenCalled();
    expect(mock.error).not.toHaveBeenCalled();
  });

  it("drops the saved overlay after Academy refresh succeeds with divergent structurally shared data even if CRM refresh fails", async () => {
    mock.refreshReject["utils.crm.agentCrm.getOverview"] = "Synthetic CRM refresh failure";
    // TanStack structural sharing can retain both object identity and data when
    // the server has already restored the lesson. Exercise the independent
    // fulfilled-Academy cleanup, rather than relying on the fresh-data effect.
    mock.academyRefresh = vi.fn(() => undefined);
    await render();
    await showArchived();
    const editor = mock.data["academy.admin.editor"];
    const updatedAt = mock.dataUpdatedAt["academy.admin.editor"];
    await click(button("Archive", row("Active safety lesson")));
    expect(mock.academyRefresh).toHaveBeenCalledTimes(1);
    expect(mock.data["academy.admin.editor"]).toBe(editor);
    expect(mock.dataUpdatedAt["academy.admin.editor"]).toBe(updatedAt);
    expect(button("Archive", row("Active safety lesson")).disabled).toBe(false);
    expect(row("Active safety lesson").textContent).not.toContain("Archived · Hidden from agents");
    await render();
    expect(button("Archive", row("Active safety lesson"))).toBeTruthy();
    expect(mock.warning).toHaveBeenCalledWith(expect.stringMatching(/saved, but some views could not refresh/));
    expect(mock.success).not.toHaveBeenCalled();
    expect(mock.error).not.toHaveBeenCalled();
    expect(mock.operations).toEqual(expectedRefreshes());
    expect(mock.invalidations.every(call => call.options?.throwOnError === true)).toBe(true);
    expect(mock.mutations).toEqual([{ path: archivePath, input: { lessonId: 14, archived: true } }]);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("reorders with every stored ID and original indexes even while archived rows are filtered out", async () => {
    await render();
    expect(titledButton("Move Active safety lesson up").disabled).toBe(false);
    expect(titledButton("Move Legacy active lesson down").disabled).toBe(true);
    await click(titledButton("Move Active safety lesson down"));
    expect(mock.mutations).toEqual([{
      path: "academy.admin.reorderLessons", input: { moduleId: 9, lessonIds: [11, 15, 14, 16] },
    }]);
    await click(titledButton("Move Legacy active lesson up"));
    expect(mock.mutations[1]).toEqual({
      path: "academy.admin.reorderLessons", input: { moduleId: 9, lessonIds: [11, 14, 16, 15] },
    });
  });

  it("keeps permanent delete separate and surfaces its learner-record protection error without silently archiving", async () => {
    mock.reject["academy.admin.deleteLesson"] = "Lesson has learner records; archive it instead";
    await render();
    await click(titledButton("Delete Active safety lesson permanently"));
    expect(confirm).toHaveBeenCalledWith("Delete Active safety lesson?");
    expect(mock.mutations).toEqual([{ path: "academy.admin.deleteLesson", input: { lessonId: 14 } }]);
    expect(mock.error).toHaveBeenCalledWith("Lesson has learner records; archive it instead");
    expect(mock.success).not.toHaveBeenCalled();
    expect(mock.operations).toEqual([]);
    expect(button("Archive", row("Active safety lesson"))).toBeTruthy();
  });

  it("explains an archived-only module without presenting it as active or cluttering the default lesson list", async () => {
    mock.data["academy.admin.editor"].modules[0].lessons = [lesson(11, "Hidden first lesson", hiddenAt, "https://video.example.test/hidden")];
    await render();
    expect(moduleHeader().textContent).toContain("0 lessons");
    expect(moduleHeader().textContent).not.toContain("video");
    expect(moduleElement().textContent).toContain("No active lessons. Turn on “Show archived lessons” to manage hidden lessons.");
    expect(moduleElement().textContent).not.toContain("Hidden first lesson");
    await showArchived();
    expect(row("Hidden first lesson")).toBeTruthy();
    expect(mock.mutations).toEqual([]);
  });
});
