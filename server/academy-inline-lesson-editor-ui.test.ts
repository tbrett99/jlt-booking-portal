// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const savePath = "academy.admin.saveLesson";
const questionPath = "academy.admin.replaceQuestions";
const mock = vi.hoisted(() => ({
  data: {} as Record<string, any>,
  calls: [] as { path: string; input: any }[],
  waitFor: {} as Record<string, Promise<void>>,
  reject: {} as Record<string, string>,
  newId: 80 as any,
  scroll: [] as string[],
  error: vi.fn(), success: vi.fn(), warning: vi.fn(), fetch: vi.fn(),
}));
vi.mock("@/contexts/ViewModeContext", () => ({
  useViewMode: () => ({ setViewMode: vi.fn(), isAdminView: true }),
}));
vi.mock("sonner", () => ({ toast: { success: mock.success, error: mock.error, warning: mock.warning } }));
vi.mock("@/lib/trpc", async () => {
  const react = await import("react");
  const node = (path = ""): any => new Proxy({}, {
    get: (_target, key: string) => {
      if (key === "useUtils") return () => node("utils");
      if (key === "invalidate") return vi.fn(async () => undefined);
      if (key === "useQuery") return () => ({
        data: mock.data[path], isLoading: false, isRefetching: false,
        dataUpdatedAt: 1, error: null, refetch: vi.fn(async () => undefined),
      });
      if (key === "useMutation") return (options: any = {}) => {
        const [isPending, setPending] = react.useState(false);
        const mutateAsync = async (input: any) => {
          mock.calls.push({ path, input: structuredClone(input) });
          setPending(true);
          try {
            await mock.waitFor[path];
            if (mock.reject[path]) throw new Error(mock.reject[path]);
            const result = { success: true, id: input.id ?? mock.newId };
            await options.onSuccess?.(result, input);
            return result;
          } catch (error) {
            options.onError?.(error);
            throw error;
          } finally { setPending(false); }
        };
        return { isPending, mutateAsync, mutate: (input: any) => { void mutateAsync(input).catch(() => undefined); } };
      };
      return node(path ? `${path}.${key}` : key);
    },
  });
  return { trpc: node() };
});
import AdminAcademy from "../client/src/pages/admin/AdminAcademy";

function syntheticLesson(id: number, moduleId: number, title: string, assessment = true) {
  return {
    id, moduleId, title, summary: "", contentHtml: "<p>Synthetic guidance.</p>",
    archivedAt: null, estimatedMinutes: 5, isRequired: true,
    requiresAcknowledgement: false, requiresAssessment: assessment,
    assessmentMode: "quiz", assessmentPassMark: 90,
    questions: assessment ? [{
      id: id + 100, prompt: "## Task\n\nExplain **evidence**.\n\n- First check\n- Second check",
      explanation: "## Staff criteria\n\n- Evidence checked", questionType: "free_text",
      answerOptions: [], correctAnswerIndex: 0, maxWords: 250, allowPaste: true,
    }] : [],
  };
}
function fixture() {
  return {
    course: { id: 7, title: "Synthetic course", summary: "", status: "published", estimatedMinutes: 20,
      isCoreAcademy: false, isAcceleratorJourney: false, updatedAt: new Date("2026-11-01T12:00:00Z") },
    modules: [
      { id: 9, title: "Early module", summary: "", courseId: 7, lessons: [syntheticLesson(14, 9, "Early assessment")] },
      { id: 19, title: "Later module", summary: "", courseId: 7, lessons: [syntheticLesson(24, 19, "Later lesson", false)] },
      { id: 29, title: "Empty module", summary: "", courseId: 7, lessons: [] },
    ],
  };
}
let root: Root;
let container: HTMLDivElement;
let confirm: ReturnType<typeof vi.spyOn>;
let previousIframeSetting: boolean;
async function render() {
  await act(async () => root.render(React.createElement(AdminAcademy)));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}
function button(text: string, scope: ParentNode = container) {
  const matches = [...scope.querySelectorAll<HTMLButtonElement>("button")].filter(item => item.textContent?.trim() === text);
  expect(matches, text).toHaveLength(1);
  return matches[0]!;
}
function header(id: number) {
  return container.querySelector<HTMLButtonElement>(`button[aria-controls="academy-module-${id}"]`)!;
}
function region(id = 9) {
  return container.querySelector<HTMLElement>(`#academy-module-${id}-lesson-editor`);
}
function edit(id = 9) {
  return container.querySelector<HTMLButtonElement>(`#academy-module-${id} button[title="Edit lesson name and content"]`)!;
}
async function click(control: HTMLButtonElement) { await act(async () => control.click()); }
async function input(control: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function titleInput(id = 9) {
  return region(id)!.querySelector<HTMLInputElement>('input[placeholder="e.g. How the JLT booking workflow works"]')!;
}
function pending(path: string) {
  let resolve!: () => void;
  mock.waitFor[path] = new Promise<void>(done => { resolve = done; });
  return async () => { await act(async () => resolve()); };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mock.fetch);
  mock.fetch.mockImplementation(() => { throw new Error("Network forbidden in offline inline editor tests"); });
  previousIframeSetting = (window as any).happyDOM.settings.disableIframePageLoading;
  (window as any).happyDOM.settings.disableIframePageLoading = true;
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function(this: Element) { mock.scroll.push(this.id); });
  confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  mock.calls = []; mock.waitFor = {}; mock.reject = {}; mock.newId = 80; mock.scroll = [];
  mock.data = {
    "academy.admin.courses": [{ id: 7, title: "Synthetic course", status: "published", completionCount: 1, enrolmentCount: 2 }],
    "academy.admin.editor": fixture(), "academy.admin.emailAlerts": [], "academy.admin.emailAlertActivity": [],
  };
  window.history.replaceState({}, "", "/admin/academy");
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  expect(mock.fetch).not.toHaveBeenCalled();
  (window as any).happyDOM.settings.disableIframePageLoading = previousIframeSetting;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("Academy inline lesson authoring on the actual manager", () => {
  it("opens exactly one editor under its early module, before later modules, with local focus", async () => {
    await render(); await click(edit());
    const editor = region()!;
    expect(editor.closest("section")!.contains(header(9))).toBe(true);
    expect(editor.compareDocumentPosition(header(19)) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(container.querySelectorAll('[role="region"][aria-label^="Lesson editor for"]')).toHaveLength(1);
    expect(titleInput().value).toBe("Early assessment");
    expect(document.activeElement).toBe(editor);
    expect(mock.scroll).toEqual(["academy-module-9-lesson-editor"]);
    expect(mock.calls).toEqual([]);
  });
  it("uses one formatted box per written prompt and private guide, without duplicate previews", async () => {
    await render(); await click(edit());
    const editor = region()!;
    expect(editor.querySelectorAll('[aria-label="Written question 1"]')).toHaveLength(1);
    expect(editor.querySelectorAll('[aria-label="Private marking guide for question 1"]')).toHaveLength(1);
    expect(editor.querySelector('[aria-label="Written question 1"] h2')?.textContent).toBe("Task");
    expect(editor.querySelector('[aria-label="Written question 1"] ul li')?.textContent).toBe("First check");
    expect(editor.textContent).not.toContain("Agent preview");
    expect(editor.textContent).not.toContain("Staff marking-guide preview");
    expect(editor.textContent).toContain("It is never shown to agents.");
    expect(mock.calls).toEqual([]);
  });
  it("keeps a dirty draft on same-lesson clicks, current-module collapse and ordinary data refresh", async () => {
    await render(); await click(edit()); await input(titleInput(), "Unsaved title");
    const existing = region();
    await click(edit()); await click(header(9));
    mock.data["academy.admin.editor"] = structuredClone(mock.data["academy.admin.editor"]);
    mock.scroll = []; await render();
    expect(region()).toBe(existing); expect(titleInput().value).toBe("Unsaved title");
    expect(header(9).getAttribute("aria-expanded")).toBe("true");
    expect(confirm).not.toHaveBeenCalled(); expect(mock.scroll).toEqual([]); expect(mock.calls).toEqual([]);
  });
  it("keeps the current editor visible while browsing another module and refuses declined draft replacement", async () => {
    await render(); await click(edit()); await input(titleInput(), "Keep my work");
    await click(header(19));
    expect(region()).toBeTruthy(); expect(header(9).getAttribute("aria-expanded")).toBe("true");
    confirm.mockReturnValue(false); await click(edit(19));
    expect(titleInput().value).toBe("Keep my work"); expect(region(19)).toBeNull();
    await click(button("Add lesson", document.getElementById("academy-module-19")!));
    expect(titleInput().value).toBe("Keep my work"); expect(region(19)).toBeNull(); expect(mock.calls).toEqual([]);
  });
  it("allows an explicitly confirmed switch and mounts the editor beneath the selected module only", async () => {
    await render(); await click(edit()); await input(titleInput(), "Old draft"); await click(header(19)); await click(edit(19));
    expect(confirm).toHaveBeenCalledTimes(1); expect(region()).toBeNull(); expect(region(19)).toBeTruthy();
    expect(titleInput(19).value).toBe("Later lesson"); expect(mock.scroll.at(-1)).toBe("academy-module-19-lesson-editor");
  });
  it("declines cancellation without losing a draft, then returns directly to that module's lessons", async () => {
    await render(); await click(edit()); await input(titleInput(), "Draft to retain");
    confirm.mockReturnValue(false); await click(button("Back to lessons")); expect(titleInput().value).toBe("Draft to retain");
    confirm.mockReturnValue(true); await click(button("Cancel", region()!));
    expect(region()).toBeNull(); expect(document.activeElement?.id).toBe("academy-module-9-lessons");
    expect(mock.scroll.at(-1)).toBe("academy-module-9-lessons"); expect(header(9).getAttribute("aria-expanded")).toBe("true");
    expect(mock.calls).toEqual([]);
  });
  it("adds and saves a lesson in an empty selected module and returns to its own list", async () => {
    await render(); await click(header(29)); await click(button("Add lesson", document.getElementById("academy-module-29")!));
    expect(region(29)).toBeTruthy(); await input(titleInput(29), "New synthetic lesson"); await click(button("Save lesson"));
    expect(mock.calls.filter(item => item.path === savePath)).toHaveLength(1);
    expect(mock.calls.find(item => item.path === savePath)!.input).toMatchObject({ moduleId: 29, title: "New synthetic lesson" });
    expect(mock.calls.find(item => item.path === savePath)!.input.id).toBeUndefined();
    expect(region(29)).toBeNull(); expect(document.activeElement?.id).toBe("academy-module-29-lessons");
  });
  it("saves an existing lesson without resubmitting unchanged questions or changing the paste policy", async () => {
    await render(); await click(edit()); await input(titleInput(), "Updated lesson title"); await click(button("Save lesson"));
    expect(mock.calls.filter(item => item.path === questionPath)).toEqual([]);
    expect(mock.calls.find(item => item.path === savePath)!.input).toMatchObject({ id: 14, moduleId: 9, title: "Updated lesson title" });
    expect(mock.calls.find(item => item.path === savePath)!.input.questions[0]).toMatchObject({ id: 114, allowPaste: true, maxWords: 250 });
    expect(region()).toBeNull(); expect(document.activeElement?.id).toBe("academy-module-9-lessons");
  });
  it("preserves question identities and private guides when saving a deliberate paste-toggle-only change", async () => {
    await render(); await click(edit()); await click(region()!.querySelector<HTMLButtonElement>('[aria-label="Allow pasting for question 1"]')!);
    await click(button("Save lesson"));
    expect(mock.calls.filter(item => item.path === questionPath)).toHaveLength(1);
    expect(mock.calls.find(item => item.path === questionPath)!.input).toMatchObject({ lessonId: 14, questions: [{ id: 114, allowPaste: false, maxWords: 250, explanation: "## Staff criteria\n\n- Evidence checked" }] });
  });
  it("freezes the draft and blocks replacement, cancellation and rapid duplicate saves while saving", async () => {
    await render(); await click(edit()); const settle = pending(savePath);
    const save = button("Save lesson"); await act(async () => { save.click(); save.click(); });
    expect(mock.calls.filter(item => item.path === savePath)).toHaveLength(1);
    expect(button("Back to lessons").disabled).toBe(true);
    expect(titleInput().disabled).toBe(false); // Native inherited fieldset state, not an individual attribute.
    expect(region()!.querySelector("fieldset")!.disabled).toBe(true);
    expect(region()!.querySelector('[aria-label="Written question 1"]')!.getAttribute("contenteditable")).toBe("false");
    await click(header(19)); expect(edit(19).disabled).toBe(true);
    expect(button("Add lesson", document.getElementById("academy-module-19")!).disabled).toBe(true);
    expect(region()).toBeTruthy(); expect(confirm).not.toHaveBeenCalled();
    await settle(); expect(region()).toBeNull(); expect(mock.calls.filter(item => item.path === savePath)).toHaveLength(1);
  });
  it("retains the lesson and question draft on save failure and permits a deliberate retry", async () => {
    await render(); await click(edit()); await input(titleInput(), "Retry this draft"); mock.reject[savePath] = "Synthetic save failure";
    await click(button("Save lesson")); expect(mock.error).toHaveBeenCalledWith("Synthetic save failure");
    expect(titleInput().value).toBe("Retry this draft"); expect(mock.success).not.toHaveBeenCalled();
    delete mock.reject[savePath]; await click(button("Save lesson")); expect(region()).toBeNull();
    expect(mock.calls.filter(item => item.path === savePath)).toHaveLength(2);
    expect(mock.calls.filter(item => item.path === questionPath)).toEqual([]);
  });
  it("retains original question identity and a retryable draft if the question save fails after the lesson saves", async () => {
    await render(); await click(edit()); await click(region()!.querySelector<HTMLButtonElement>('[aria-label="Allow pasting for question 1"]')!);
    mock.reject[questionPath] = "Synthetic question failure"; await click(button("Save lesson"));
    expect(region()).toBeTruthy(); expect(mock.error).toHaveBeenCalledWith("Synthetic question failure");
    delete mock.reject[questionPath]; await click(button("Save lesson"));
    expect(region()).toBeNull(); expect(mock.calls.filter(item => item.path === savePath).map(item => item.input.id)).toEqual([14, 14]);
    expect(mock.calls.filter(item => item.path === questionPath).map(item => item.input.questions[0].id)).toEqual([114, 114]);
  });
  it("does not hide or reset a dirty draft when the already-selected course is clicked", async () => {
    await render(); await click(edit()); await input(titleInput(), "Keep selected-course draft");
    const selectedCourse = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find(item => item.querySelector("span")?.textContent === "Synthetic course")!;
    expect(selectedCourse).toBeTruthy();
    await click(selectedCourse);
    expect(region()).toBeTruthy(); expect(titleInput().value).toBe("Keep selected-course draft");
    expect(confirm).not.toHaveBeenCalled(); expect(mock.calls).toEqual([]);
  });
  it("keeps a pending selected-course draft visible and retryable after a save failure", async () => {
    await render(); await click(edit()); await input(titleInput(), "Pending selected-course draft");
    const settle = pending(savePath); await click(button("Save lesson"));
    const selectedCourse = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find(item => item.querySelector("span")?.textContent === "Synthetic course")!;
    await click(selectedCourse); expect(region()).toBeTruthy();
    mock.reject[savePath] = "Selected-course save failed"; await settle();
    expect(region()).toBeTruthy(); expect(titleInput().value).toBe("Pending selected-course draft");
    expect(mock.error).toHaveBeenCalledWith("Selected-course save failed");
    delete mock.reject[savePath]; await click(button("Save lesson"));
    expect(region()).toBeNull(); expect(mock.calls.filter(item => item.path === savePath)).toHaveLength(2);
  });
});
