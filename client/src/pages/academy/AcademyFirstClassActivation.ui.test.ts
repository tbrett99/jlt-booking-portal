// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real Manager, switches, resource controls and TipTap editors; only tRPC,
// view context, notifications and controlled file I/O are synthetic. No network.
const mock = vi.hoisted(() => ({
  data: {} as Record<string, any>, errors: {} as Record<string, any>,
  calls: [] as { path: string; input: any }[],
  waits: {} as Record<string, Promise<void>>, results: {} as Record<string, any>,
  mutationErrors: {} as Record<string, any>, mountedMutations: [] as string[],
  invalidate: vi.fn(), editorFetch: vi.fn(), fetch: vi.fn(),
}));
vi.mock("@/contexts/ViewModeContext", () => ({ useViewMode: () => ({ setViewMode: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/trpc", async () => {
  const react = await import("react");
  const node = (path = ""): any => new Proxy({}, { get: (_target, key: string) => {
    if (key === "useUtils") return () => node("utils");
    if (key === "invalidate") return (input: any) => mock.invalidate(path, input);
    if (key === "fetch") return (input: any, options: any) => mock.editorFetch(path, input, options);
    if (key === "useQuery") return (_input: any, options: any) => ({
      data: options?.enabled === false ? undefined : mock.data[path], error: mock.errors[path] ?? null,
      isLoading: false, isRefetching: false, dataUpdatedAt: 1, refetch: vi.fn(),
    });
    if (key === "useMutation") return (options: any = {}) => {
      mock.mountedMutations.push(path);
      const [isPending, setPending] = react.useState(false);
      const mutateAsync = async (input: any) => {
        mock.calls.push({ path, input: structuredClone(input) });
        setPending(true);
        try {
          await mock.waits[path];
          if (mock.mutationErrors[path]) throw mock.mutationErrors[path];
          const result = mock.results[path] ?? { id: input.id ?? 80 };
          await options.onSuccess?.(result, input);
          return result;
        } catch (error) {
          await options.onError?.(error, input);
          throw error;
        } finally { setPending(false); }
      };
      return { isPending, mutateAsync, mutate: (input: any) => { void mutateAsync(input).catch(() => undefined); } };
    };
    return node(path ? `${path}.${key}` : key);
  } });
  return { trpc: node() };
});
import AdminAcademy from "../admin/AdminAcademy";
import { toast } from "sonner";

const savePath = "academy.admin.saveCourse";
const uploadPath = "academy.admin.uploadAttachment";
const helper = "Existing uploaded teaching resources are secured automatically when you save.";
const oldResource = {
  attachmentKey: "academy/7/12345678-1234-1234-1234-123456789abc-guide.pdf",
  attachmentUrl: "https://objects.example.test/files/academy/7/12345678-1234-1234-1234-123456789abc-guide.pdf",
  attachmentName: "Existing guide.pdf", embedPdf: true,
};
const privateKey = "academy/42/87654321-4321-4321-4321-cba987654321-guide.pdf";
const privateResource = { attachmentKey: privateKey,
  attachmentUrl: `https://portal.thejltgroup.co.uk/api/academy/course-attachment/${encodeURIComponent(privateKey)}` };
function freshEditor() {
  const next = structuredClone(mock.data["academy.admin.editor"]);
  next.course.isFirstClassTraining = true;
  // Deliberately preserve both course and lesson versions: reconciliation must
  // use the returned authoritative tuple, not a timestamp or cached query effect.
  Object.assign(next.modules[0].lessons[0], privateResource);
  return next;
}
function fixture(firstClass = false) {
  return {
    course: { id: 7, title: "Existing teaching course", summary: "Original course summary", estimatedMinutes: 24,
      status: "published", isCoreAcademy: false, isAcceleratorJourney: false, isFirstClassTraining: firstClass,
      updatedAt: new Date("2026-11-01T12:00:00Z") },
    modules: [{ id: 9, courseId: 7, title: "Preparation", summary: "", sortOrder: 0, releaseWeek: 0,
      lessons: [{ id: 14, moduleId: 9, title: "Existing lesson", summary: "Original lesson summary",
        contentHtml: "<h2>Original instructions</h2><p>Preserve practical teaching.</p>",
        videoUrl: "https://www.youtube.com/watch?v=abcdefghijk", videoTranscript: "Original private transcript",
        ...oldResource, estimatedMinutes: 8, isRequired: true, requiresAcknowledgement: true,
        requiresAssessment: false, assessmentMode: "quiz", assessmentPassMark: 90,
        assessmentTemplateKey: null, assessmentTemplateName: null, assessmentTemplateMimeType: null,
        assessmentTemplateSize: null, archivedAt: null, questions: [] }],
    }],
  };
}
class ControlledReader {
  static readers: ControlledReader[] = [];
  result: string | null = null;
  onload: (() => void) | null = null;
  readAsDataURL(_file: File) { ControlledReader.readers.push(this); }
  finish() { this.result = "data:application/pdf;base64,JVBERi0xLjc="; this.onload?.(); }
}
let root: Root;
let container: HTMLDivElement;
let previousIframeSetting: boolean;
async function render() {
  await act(async () => root.render(React.createElement(AdminAcademy)));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}
function button(text: string, scope: ParentNode = container) {
  const matches = [...scope.querySelectorAll<HTMLButtonElement>("button")].filter(item => item.textContent?.trim() === text);
  expect(matches, text).toHaveLength(1); return matches[0]!;
}
function designation(label = "First Class training") {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}
function settings() { return container.querySelector<HTMLInputElement>('input[placeholder="e.g. JLT Academy"]')!.closest("section")!; }
function lessonEditor() { return container.querySelector<HTMLElement>("#academy-module-9-lesson-editor")!; }
function field(placeholder: string, scope: ParentNode = container) { return scope.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!; }
async function click(control: HTMLButtonElement) { expect(control).toBeTruthy(); await act(async () => control.click()); }
async function change(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  expect(control).toBeTruthy();
  await act(async () => {
    const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function openLesson() {
  await click(container.querySelector<HTMLButtonElement>('button[title="Edit lesson name and content"]')!);
  expect(lessonEditor()).toBeTruthy();
}
function selectFile(control: HTMLInputElement) {
  Object.defineProperty(control, "files", { configurable: true, value: [new File(["%PDF-1.7"], "new-guide.pdf", { type: "application/pdf" })] });
  control.dispatchEvent(new Event("change", { bubbles: true }));
}
function defer(path: string) {
  let finish!: () => void;
  mock.waits[path] = new Promise<void>(resolve => { finish = resolve; });
  return async () => { await act(async () => finish()); };
}
function saved() { return mock.calls.filter(call => call.path === savePath); }
function markServerSaved(input: any = saved()[0]!.input) {
  const next = structuredClone(mock.data["academy.admin.editor"]);
  Object.assign(next.course, input, { updatedAt: new Date("2026-11-20T18:00:00Z") });
  Object.assign(next.modules[0].lessons[0], {
    ...privateResource, attachmentName: oldResource.attachmentName,
  });
  mock.data["academy.admin.editor"] = next;
  mock.data["academy.admin.courses"] = [{ ...next.course, completionCount: 0, enrolmentCount: 1 }];
}

beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mock.fetch);
  mock.fetch.mockImplementation(() => { throw new Error("Network forbidden in offline activation UI tests"); });
  vi.stubGlobal("FileReader", ControlledReader); ControlledReader.readers = [];
  previousIframeSetting = (window as any).happyDOM.settings.disableIframePageLoading;
  (window as any).happyDOM.settings.disableIframePageLoading = true;
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mock.errors = {}; mock.calls = []; mock.waits = {}; mock.mutationErrors = {}; mock.results = {}; mock.mountedMutations = [];
  mock.invalidate.mockResolvedValue(undefined);
  mock.editorFetch.mockImplementation(async () => mock.data["academy.admin.editor"]);
  mock.data = {
    "academy.admin.courses": [{ ...fixture().course, completionCount: 0, enrolmentCount: 1 }],
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

describe("First Class automatic activation on actual Manager DOM", () => {
  it("uses one short associated helper and the ordinary Save course, not a reupload wall or wizard", async () => {
    await render();
    const description = container.querySelector("#academy-first-class-training-description")!;
    expect(description.textContent).toContain(helper);
    expect(designation().getAttribute("aria-describedby")).toBe(description.id);
    expect(description.textContent).not.toMatch(/public URL|encrypt|atomic|re-upload|remove the old/i);
    expect(button("Save course").disabled).toBe(false);
    expect([...container.querySelectorAll("button")].some(item => /activate|convert resources|confirm First Class/i.test(item.textContent ?? ""))).toBe(false);
    await click(designation());
    expect(window.confirm).not.toHaveBeenCalled(); expect(mock.calls).toEqual([]);
  });

  it("preserves all course draft fields and sends the unchanged save payload without touching lessons or uploads", async () => {
    await render(); const originalLessons = structuredClone(mock.data["academy.admin.editor"].modules);
    await change(field("e.g. JLT Academy"), "My edited course");
    await change(settings().querySelector<HTMLTextAreaElement>("textarea")!, "My edited summary");
    await change(settings().querySelector<HTMLInputElement>('input[type="number"]')!, "47");
    await click(designation()); await click(button("Save course"));
    expect(saved()).toEqual([{ path: savePath, input: { id: 7, title: "My edited course", summary: "My edited summary", estimatedMinutes: 47,
      isCoreAcademy: false, isAcceleratorJourney: false, isFirstClassTraining: true } }]);
    expect(mock.calls.map(call => call.path)).toEqual([savePath]);
    expect(mock.data["academy.admin.editor"].modules).toEqual(originalLessons);
    expect(toast.success).toHaveBeenCalledWith("First Class training saved");
    expect(mock.invalidate).toHaveBeenCalledWith("utils.academy.admin.courses", undefined);
    expect(mock.invalidate).toHaveBeenCalledWith("utils.academy.admin.editor", { courseId: 7 });
  });

  it.each(["Core JLT Academy pathway", "Agent Accelerator journey"])("retains mutually exclusive %s flags when switching to and from First Class", async label => {
    await render(); await click(designation(label)); await click(designation());
    await click(button("Save course"));
    expect(saved()[0]!.input).toMatchObject({ isFirstClassTraining: true, isCoreAcademy: false, isAcceleratorJourney: false });
    await click(designation(label)); await click(button("Save course"));
    expect(saved()[1]!.input).toMatchObject({ isFirstClassTraining: false, isCoreAcademy: label === "Core JLT Academy pathway", isAcceleratorJourney: label === "Agent Accelerator journey" });
  });

  it("locks pending conversion controls and same-tick double clicks to one save request", async () => {
    await render(); await openLesson(); await click(designation());
    const release = defer(savePath), save = button("Save course"), archive = button("Archive", settings());
    const originalCourse = structuredClone(mock.data["academy.admin.editor"].course);
    await act(async () => { save.click(); save.click(); archive.click(); designation().click(); });
    expect(saved()).toHaveLength(1); expect(mock.calls.map(call => call.path)).toEqual([savePath]);
    expect(button("Securing resources…").disabled).toBe(true);
    for (const label of ["First Class training", "Core JLT Academy pathway", "Agent Accelerator journey"]) expect(designation(label).disabled).toBe(true);
    for (const control of settings().querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("input, textarea, button")) expect(control.disabled).toBe(true);
    const pending = container.querySelector<HTMLFieldSetElement>('fieldset[aria-busy="true"]')!;
    expect(pending.disabled).toBe(true);
    for (const control of container.querySelectorAll("input, select, textarea, button")) {
      expect(control.hasAttribute("disabled") || control.closest("fieldset[disabled]")).toBeTruthy();
    }
    expect(lessonEditor().querySelector('[contenteditable="true"]')).toBeNull();
    const resourceUpload = lessonEditor().querySelector<HTMLInputElement>('[aria-label="Upload lesson resource"]')!;
    expect(resourceUpload.disabled).toBe(true);
    await act(async () => { selectFile(resourceUpload); save.click(); });
    expect(ControlledReader.readers).toHaveLength(0); expect(saved()).toHaveLength(1);
    expect(mock.data["academy.admin.editor"].course).toEqual(originalCourse);
    expect(toast.success).not.toHaveBeenCalled();
    await release(); expect(button("Save course").disabled).toBe(false);
  });

  it.each(["Server could not secure the resources", "Request timed out"])("keeps every draft field and the saved course unchanged after %s", async message => {
    await render(); await openLesson();
    await change(field("e.g. JLT Academy"), "Retained course edit");
    await change(settings().querySelector<HTMLTextAreaElement>("textarea")!, "Retained summary");
    await change(settings().querySelector<HTMLInputElement>('input[type="number"]')!, "39");
    await change(field("e.g. How the JLT booking workflow works", lessonEditor()), "Retained lesson edit");
    await click(designation()); mock.mutationErrors[savePath] = new Error(message);
    await click(button("Save course")); await render();
    expect(field("e.g. JLT Academy").value).toBe("Retained course edit");
    expect(settings().querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Retained summary");
    expect(settings().querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe("39");
    expect(field("e.g. How the JLT booking workflow works", lessonEditor()).value).toBe("Retained lesson edit");
    expect(field("No resource uploaded", lessonEditor()).value).toBe(oldResource.attachmentName);
    expect(designation().getAttribute("aria-checked")).toBe("true"); // Unsaved draft, not server state.
    expect(mock.data["academy.admin.editor"].course.isFirstClassTraining).toBe(false);
    expect(mock.data["academy.admin.courses"][0].isFirstClassTraining).toBe(false);
    expect(toast.success).not.toHaveBeenCalled(); expect(mock.invalidate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining(message));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("refresh and check the course before trying again"));
    expect(button("Save course").disabled).toBe(false); expect(saved()).toHaveLength(1);
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it("hydrates eventual saved editor data, including secured resource metadata, without leaving a phantom unsaved course", async () => {
    await render(); await change(field("e.g. JLT Academy"), "Confirmed course edit"); await click(designation());
    const releaseSave = defer(savePath); await click(button("Save course"));
    let finishRefresh!: () => void;
    const refreshWait = new Promise<void>(resolve => { finishRefresh = resolve; });
    mock.invalidate.mockImplementation(async (path: string) => {
      if (path === "utils.academy.admin.editor") { markServerSaved(); await refreshWait; }
    });
    await releaseSave(); await render(); // New data arrives before onSuccess refresh completes.
    expect(container.querySelector('fieldset[aria-busy="true"]')).toBeTruthy();
    expect(button("Securing resources…").disabled).toBe(true);
    await act(async () => finishRefresh()); await render();
    expect(field("e.g. JLT Academy").value).toBe("Confirmed course edit");
    expect(designation().getAttribute("aria-checked")).toBe("true");
    expect(button("Save course").disabled).toBe(false);
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    await openLesson();
    expect(lessonEditor().querySelector(`a[href="${privateResource.attachmentUrl}"]`)).toBeTruthy();
    expect(lessonEditor().querySelector(`a[href="${oldResource.attachmentUrl}"]`)).toBeNull();
    expect(saved()).toHaveLength(1);
  });

  it("keeps confirmed saves distinct from refresh failures and recommends checking before further changes", async () => {
    await render(); await change(field("e.g. JLT Academy"), "Saved but stale view"); await click(designation());
    mock.invalidate.mockRejectedValue(new Error("Synthetic refresh unavailable"));
    await click(button("Save course"));
    expect(toast.success).toHaveBeenCalledWith("First Class training saved");
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("Refresh the page to check the saved course"));
    expect(field("e.g. JLT Academy").value).toBe("Saved but stale view"); expect(saved()).toHaveLength(1);
    markServerSaved(); await render();
    expect(designation().getAttribute("aria-checked")).toBe("true");
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it.each([false, true])("uses ordinary Saving... for new courses or already-First-Class saves (existing %s)", async existing => {
    if (existing) {
      mock.data["academy.admin.editor"] = fixture(true);
      mock.data["academy.admin.courses"] = [{ ...fixture(true).course, completionCount: 0, enrolmentCount: 1 }];
    } else { mock.data["academy.admin.courses"] = []; }
    await render();
    if (!existing) { await change(field("e.g. JLT Academy"), "New First Class course"); await click(designation()); }
    const release = defer(savePath); await click(button(existing ? "Save course" : "Create course", settings()));
    expect(button("Saving...").disabled).toBe(true);
    expect(container.textContent).not.toContain("Securing resources…");
    if (!existing) expect(container.textContent).not.toContain(helper);
    await release();
  });

  it("saves the edited open lesson with the fresh private tuple, retaining content and the course-ID upload contract without inline images", async () => {
    await render(); await openLesson();
    await change(field("e.g. How the JLT booking workflow works", lessonEditor()), "My lesson draft");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => type === "text/html" ? "<p>My unsaved practical guidance</p>" : "", files: [] } });
    await act(async () => lessonEditor().querySelector<HTMLElement>(".ProseMirror")!.dispatchEvent(paste));
    const draftBody = lessonEditor().querySelector<HTMLElement>(".ProseMirror")!.innerHTML;
    expect(draftBody).toContain("My unsaved practical guidance");
    await change(field("A short introduction shown before the lesson.", lessonEditor()), "My unsaved lesson summary");
    await change(lessonEditor().querySelector<HTMLTextAreaElement>("#academy-video-transcript")!, "My unsaved transcript");
    mock.editorFetch.mockImplementation(async () => {
      const next = freshEditor();
      Object.assign(next.modules[0].lessons[0], { title: "Concurrent stored title", contentHtml: "<p>Concurrent stored body</p>",
        attachmentName: "Concurrent stored resource name.pdf", embedPdf: false });
      return next;
    });
    await click(designation());
    mock.mountedMutations = []; await render();
    expect(lessonEditor().querySelector('button[title="Upload Image from Computer"]')).toBeNull();
    expect(lessonEditor().querySelector('button[title="Insert Image from URL"]')).toBeNull();
    expect(lessonEditor().querySelector('input[accept="image/*"]')).toBeNull();
    expect(mock.mountedMutations.filter(path => path === "crm.emailBranding.uploadImage")).toHaveLength(1); // Ordinary alert email only.
    expect(lessonEditor().textContent).toContain("For YouTube, use Public or Unlisted visibility and allow embedding.");
    expect(lessonEditor().textContent).toContain("Unlisted links are shareable, not private to the Portal.");
    await click(button("Save course"));
    expect(field("e.g. How the JLT booking workflow works", lessonEditor()).value).toBe("My lesson draft");
    expect(field("No resource uploaded", lessonEditor()).value).toBe(oldResource.attachmentName);
    expect(lessonEditor().querySelector(`a[href="${privateResource.attachmentUrl}"]`)).toBeTruthy();
    expect(lessonEditor().querySelector(`a[href="${oldResource.attachmentUrl}"]`)).toBeNull();
    expect(mock.editorFetch).toHaveBeenCalledWith("utils.academy.admin.editor", { courseId: 7 }, { staleTime: 0 });
    // The cached editor remains old: only the actual returned result is authoritative.
    expect(mock.data["academy.admin.editor"].modules[0].lessons[0]).toMatchObject(oldResource);
    expect(mock.calls.map(call => call.path)).toEqual([savePath]);
    expect(ControlledReader.readers).toHaveLength(0);
    await click(button("Save lesson", lessonEditor()));
    expect(mock.calls.filter(call => call.path === "academy.admin.saveLesson")).toEqual([{ path: "academy.admin.saveLesson", input: expect.objectContaining({
      id: 14, moduleId: 9, title: "My lesson draft", contentHtml: draftBody, summary: "My unsaved lesson summary",
      videoTranscript: "My unsaved transcript", ...privateResource, attachmentName: oldResource.attachmentName, embedPdf: true,
      videoUrl: fixture().modules[0].lessons[0].videoUrl, questions: [], estimatedMinutes: 8, isRequired: true,
      requiresAcknowledgement: true, requiresAssessment: false, assessmentMode: "quiz", assessmentPassMark: 90,
    }) }]);
    expect(toast.success).toHaveBeenCalledWith("Lesson saved");
    expect(mock.calls.some(call => call.path === uploadPath)).toBe(false);
    await openLesson();
    await change(field("e.g. How the JLT booking workflow works", lessonEditor()), "My lesson draft");
    const upload = lessonEditor().querySelector<HTMLInputElement>('[aria-label="Upload lesson resource"]')!;
    mock.results[uploadPath] = { key: privateKey.replace("guide.pdf", "new-guide.pdf"), url: privateResource.attachmentUrl.replace("guide.pdf", "new-guide.pdf"), name: "new-guide.pdf" };
    const release = defer(uploadPath);
    const save = button("Save course");
    await act(async () => { selectFile(upload); save.click(); });
    expect(saved()).toHaveLength(1); expect(ControlledReader.readers).toHaveLength(1);
    await act(async () => ControlledReader.readers[0]!.finish());
    expect(mock.calls.filter(call => call.path === uploadPath)).toEqual([{ path: uploadPath, input: {
      courseId: 7, fileName: "new-guide.pdf", fileBase64: "JVBERi0xLjc=", mimeType: "application/pdf",
    } }]);
    expect(button("Save course").disabled).toBe(true);
    await release();
    expect(field("No resource uploaded", lessonEditor()).value).toBe("new-guide.pdf");
    expect(field("e.g. How the JLT booking workflow works", lessonEditor()).value).toBe("My lesson draft");
    expect(mock.calls.filter(call => call.path === "academy.admin.saveLesson")).toHaveLength(1);
  });

  it.each(["removed", "uploaded"])("does not overwrite an independently %s resource tuple when activation rewrites the stored resource", async kind => {
    await render(); await openLesson();
    await change(field("e.g. How the JLT booking workflow works", lessonEditor()), "Independent lesson edit");
    const newKey = privateKey.replace("guide.pdf", "independent-guide.pdf");
    const newUrl = privateResource.attachmentUrl.replace("guide.pdf", "independent-guide.pdf");
    if (kind === "removed") {
      await click(button("Remove resource", lessonEditor()));
    } else {
      mock.results[uploadPath] = { key: newKey, url: newUrl, name: "My independent guide.pdf" };
      await act(async () => selectFile(lessonEditor().querySelector<HTMLInputElement>('[aria-label="Upload lesson resource"]')!));
      await act(async () => ControlledReader.readers[0]!.finish());
    }
    mock.editorFetch.mockResolvedValue(freshEditor());
    await click(designation()); await click(button("Save course"));
    expect(field("No resource uploaded", lessonEditor()).value).toBe(kind === "removed" ? "" : "My independent guide.pdf");
    expect(lessonEditor().querySelector(`a[href="${privateResource.attachmentUrl}"]`)).toBeNull();
    expect(button("Save lesson", lessonEditor()).disabled).toBe(false);
    await click(button("Save lesson", lessonEditor()));
    expect(mock.calls.find(call => call.path === "academy.admin.saveLesson")!.input).toMatchObject({
      title: "Independent lesson edit", attachmentKey: kind === "removed" ? null : newKey,
      attachmentUrl: kind === "removed" ? null : newUrl,
      attachmentName: kind === "removed" ? null : "My independent guide.pdf", embedPdf: false,
    });
  });

  it("keeps the draft and blocks the old tuple after failed invalidation/fresh read, then recovers without another save or upload", async () => {
    await render(); await openLesson();
    await change(field("e.g. How the JLT booking workflow works", lessonEditor()), "Retained while refresh fails");
    mock.invalidate.mockRejectedValue(new Error("Synthetic invalidation unavailable"));
    mock.editorFetch.mockRejectedValue(new Error("Synthetic fresh editor unavailable"));
    await click(designation()); await click(button("Save course"));
    expect(toast.success).toHaveBeenCalledWith("First Class training saved");
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("Refresh the page to check the saved course"));
    expect(field("e.g. How the JLT booking workflow works", lessonEditor()).value).toBe("Retained while refresh fails");
    expect(lessonEditor().querySelector(`a[href="${oldResource.attachmentUrl}"]`)).toBeTruthy();
    expect(button("Save lesson", lessonEditor()).disabled).toBe(true);
    await click(button("Save lesson", lessonEditor()));
    expect(mock.calls.map(call => call.path)).toEqual([savePath]);
    // A background cache update is not a successful authoritative fresh check.
    mock.data["academy.admin.editor"] = freshEditor(); await render();
    expect(button("Save lesson", lessonEditor()).disabled).toBe(true);
    let finish!: (result: any) => void;
    mock.editorFetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const retry = button("Refresh saved resource", lessonEditor()), courseSave = button("Save course");
    await act(async () => { retry.click(); retry.click(); courseSave.click(); });
    expect(mock.editorFetch).toHaveBeenCalledTimes(2);
    expect(saved()).toHaveLength(1);
    expect(container.querySelector('fieldset[aria-busy="true"]')).toBeTruthy();
    const next = freshEditor();
    await act(async () => finish(next));
    expect(button("Save lesson", lessonEditor()).disabled).toBe(false);
    expect(field("e.g. How the JLT booking workflow works", lessonEditor()).value).toBe("Retained while refresh fails");
    mock.invalidate.mockResolvedValue(undefined);
    await click(button("Save lesson", lessonEditor()));
    expect(mock.calls.find(call => call.path === "academy.admin.saveLesson")!.input).toMatchObject({
      title: "Retained while refresh fails", ...privateResource,
    });
    expect(toast.success).toHaveBeenCalledWith("Lesson saved");
    expect(mock.calls.filter(call => call.path === uploadPath)).toHaveLength(0);
    expect(ControlledReader.readers).toHaveLength(0);
  });

  it("uses a fresh returned tuple even when editor invalidation fails", async () => {
    await render(); await openLesson();
    mock.invalidate.mockImplementation(async (path: string) => {
      if (path === "utils.academy.admin.editor") throw new Error("Invalidation unavailable");
    });
    mock.editorFetch.mockResolvedValue(freshEditor());
    await click(designation()); await click(button("Save course"));
    expect(lessonEditor().querySelector(`a[href="${privateResource.attachmentUrl}"]`)).toBeTruthy();
    expect(button("Save lesson", lessonEditor()).disabled).toBe(false);
    await click(button("Save lesson", lessonEditor()));
    expect(mock.calls.find(call => call.path === "academy.admin.saveLesson")!.input).toMatchObject(privateResource);
  });

  it.each(["old cached tuple", "wrong course", "wrong module", "wrong lesson", "unsafe key", "public URL", "mismatched URL"])(
    "does not reconcile or save a stale resource after an unverified fresh result: %s", async kind => {
      await render(); await openLesson();
      await change(field("e.g. How the JLT booking workflow works", lessonEditor()), "Keep this draft");
      const next = freshEditor();
      if (kind === "old cached tuple") Object.assign(next.modules[0].lessons[0], oldResource);
      if (kind === "wrong course") next.course.id = 8;
      if (kind === "wrong module") next.modules[0].courseId = 8;
      if (kind === "wrong lesson") next.modules[0].lessons[0].id = 15;
      if (kind === "unsafe key") {
        const key = "academy/42/../../private-guide.pdf";
        Object.assign(next.modules[0].lessons[0], { attachmentKey: key,
          attachmentUrl: `https://portal.thejltgroup.co.uk/api/academy/course-attachment/${encodeURIComponent(key)}` });
      }
      if (kind === "public URL") next.modules[0].lessons[0].attachmentUrl = `https://objects.example.test/${privateKey}`;
      if (kind === "mismatched URL") next.modules[0].lessons[0].attachmentUrl = `${privateResource.attachmentUrl}?untrusted=1`;
      mock.editorFetch.mockResolvedValue(next);
      await click(designation()); await click(button("Save course"));
      expect(field("e.g. How the JLT booking workflow works", lessonEditor()).value).toBe("Keep this draft");
      expect(lessonEditor().querySelector(`a[href="${oldResource.attachmentUrl}"]`)).toBeTruthy();
      expect(button("Save lesson", lessonEditor()).disabled).toBe(true);
      await click(button("Save lesson", lessonEditor()));
      expect(mock.calls.map(call => call.path)).toEqual([savePath]);
      expect(button("Refresh saved resource", lessonEditor()).disabled).toBe(false);
    });

  it("rebinds verification after Cancel/reopen, blocks stale saves and refreshes only the new draft session", async () => {
    await render(); await openLesson();
    mock.editorFetch.mockRejectedValueOnce(new Error("Fresh editor unavailable"));
    await click(designation()); await click(button("Save course"));
    expect(button("Save lesson", lessonEditor()).disabled).toBe(true);
    // The confirmed designation arrives without a fresh resource check. The
    // next course save must not create a new activation target for this session.
    mock.data["academy.admin.editor"].course.isFirstClassTraining = true;
    await render();
    await click(button("Cancel", lessonEditor()));
    await openLesson();
    await change(field("e.g. How the JLT booking workflow works", lessonEditor()), "New draft session");
    expect(button("Save lesson", lessonEditor()).disabled).toBe(true);
    expect(lessonEditor().textContent).toContain("Refresh the saved resource before saving this lesson.");
    expect(button("Refresh saved resource", lessonEditor()).disabled).toBe(false);
    await click(button("Save lesson", lessonEditor()));
    expect(mock.calls.map(call => call.path)).toEqual([savePath]);
    expect(field("e.g. How the JLT booking workflow works", lessonEditor()).value).toBe("New draft session");
    expect(lessonEditor().querySelector(`a[href="${oldResource.attachmentUrl}"]`)).toBeTruthy();
    expect(lessonEditor().querySelector(`a[href="${privateResource.attachmentUrl}"]`)).toBeNull();
    mock.editorFetch.mockResolvedValue(freshEditor());
    await click(button("Refresh saved resource", lessonEditor()));
    expect(mock.editorFetch).toHaveBeenCalledTimes(2);
    expect(button("Save lesson", lessonEditor()).disabled).toBe(false);
    expect(field("e.g. How the JLT booking workflow works", lessonEditor()).value).toBe("New draft session");
    await click(button("Save lesson", lessonEditor()));
    expect(mock.calls.find(call => call.path === "academy.admin.saveLesson")!.input).toMatchObject({
      title: "New draft session", ...privateResource,
    });
  });

  it("keeps another converted lesson blocked in the stale course cache and verifies the whole course for later opens", async () => {
    const otherKey = oldResource.attachmentKey.replace("guide.pdf", "other-guide.pdf");
    const otherUrl = oldResource.attachmentUrl.replace("guide.pdf", "other-guide.pdf");
    const lessons = mock.data["academy.admin.editor"].modules[0].lessons;
    lessons.push({ ...structuredClone(lessons[0]), id: 15, title: "Another lesson",
      attachmentKey: otherKey, attachmentUrl: otherUrl });
    const fresh = freshEditor();
    const otherPrivate = { attachmentKey: privateKey.replace("guide.pdf", "other-guide.pdf"),
      attachmentUrl: privateResource.attachmentUrl.replace("guide.pdf", "other-guide.pdf") };
    Object.assign(fresh.modules[0].lessons[1], otherPrivate, { title: "Fresh other lesson" });
    await render(); await openLesson();
    mock.editorFetch.mockRejectedValueOnce(new Error("Fresh editor unavailable"));
    await click(designation()); await click(button("Save course"));
    await click(button("Cancel", lessonEditor()));
    await click(container.querySelectorAll<HTMLButtonElement>('button[title="Edit lesson name and content"]')[1]!);
    await change(field("e.g. How the JLT booking workflow works", lessonEditor()), "Other local draft");
    expect(button("Save lesson", lessonEditor()).disabled).toBe(true);
    expect(button("Refresh saved resource", lessonEditor()).disabled).toBe(false);
    await click(button("Save lesson", lessonEditor()));
    expect(mock.calls.map(call => call.path)).toEqual([savePath]);
    const incomplete = structuredClone(fresh);
    Object.assign(incomplete.modules[0].lessons[0], oldResource);
    mock.editorFetch.mockResolvedValueOnce(incomplete);
    await click(button("Refresh saved resource", lessonEditor()));
    expect(button("Save lesson", lessonEditor()).disabled).toBe(true);
    mock.editorFetch.mockResolvedValue(fresh);
    await click(button("Refresh saved resource", lessonEditor()));
    expect(field("e.g. How the JLT booking workflow works", lessonEditor()).value).toBe("Other local draft");
    await click(button("Save lesson", lessonEditor()));
    expect(mock.calls.find(call => call.path === "academy.admin.saveLesson")!.input).toMatchObject({
      id: 15, title: "Other local draft", ...otherPrivate,
    });
    // The query cache is still public, but the verified FULL result hydrates future opens.
    expect(mock.data["academy.admin.editor"].modules[0].lessons[0]).toMatchObject(oldResource);
    await openLesson();
    expect(button("Save lesson", lessonEditor()).disabled).toBe(false);
    expect(lessonEditor().querySelector(`a[href="${privateResource.attachmentUrl}"]`)).toBeTruthy();
    await click(button("Cancel", lessonEditor()));
    await click(container.querySelectorAll<HTMLButtonElement>('button[title="Edit lesson name and content"]')[1]!);
    expect(field("e.g. How the JLT booking workflow works", lessonEditor()).value).toBe("Fresh other lesson");
    expect(lessonEditor().querySelector(`a[href="${otherPrivate.attachmentUrl}"]`)).toBeTruthy();
    await click(button("Cancel", lessonEditor()));
    Object.assign(mock.data["academy.admin.editor"].modules[0].lessons[1], otherPrivate, { title: "Later authoritative edit" });
    await render();
    await click(container.querySelectorAll<HTMLButtonElement>('button[title="Edit lesson name and content"]')[1]!);
    expect(field("e.g. How the JLT booking workflow works", lessonEditor()).value).toBe("Later authoritative edit");
  });

  it("allows independently removed or uploaded tuples after a failed activation refresh", async () => {
    await render(); await openLesson();
    mock.editorFetch.mockRejectedValue(new Error("Fresh editor unavailable"));
    await click(designation()); await click(button("Save course"));
    await click(button("Remove resource", lessonEditor()));
    expect(button("Save lesson", lessonEditor()).disabled).toBe(false);
    mock.results[uploadPath] = { key: privateKey, url: privateResource.attachmentUrl, name: "New independent guide.pdf" };
    await act(async () => selectFile(lessonEditor().querySelector<HTMLInputElement>('[aria-label="Upload lesson resource"]')!));
    await act(async () => ControlledReader.readers[0]!.finish());
    expect(button("Save lesson", lessonEditor()).disabled).toBe(false);
    await click(button("Save lesson", lessonEditor()));
    expect(mock.calls.find(call => call.path === "academy.admin.saveLesson")!.input).toMatchObject(privateResource);
  });
});
