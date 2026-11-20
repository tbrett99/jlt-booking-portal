// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real pages, Switch controls and TipTap editors; only auth/tRPC and file I/O are synthetic.
const savePath = "academy.admin.saveLesson";
const uploadPath = "academy.admin.uploadAttachment";
const questionPath = "academy.admin.replaceQuestions";
const mock = vi.hoisted(() => ({
  data: {} as Record<string, any>,
  calls: [] as { path: string; input: any }[],
  waitFor: {} as Record<string, Promise<void>>,
  reject: {} as Record<string, string>,
  results: {} as Record<string, any>,
  user: { id: 9, role: "agent", name: "Synthetic instructor", isActive: true,
    portalStatus: "active", mustChangePassword: false },
  fetch: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: mock.user, loading: false, logout: vi.fn() }),
}));
vi.mock("@/contexts/ViewModeContext", () => ({
  useViewMode: () => ({ setViewMode: vi.fn(), isAdminView: true }),
}));
vi.mock("sonner", () => ({ toast: {
  success: mock.success, error: mock.error, info: mock.info, warning: mock.warning,
} }));
vi.mock("@/lib/trpc", async () => {
  const react = await import("react");
  const node = (path = ""): any => new Proxy({}, {
    get: (_target, key: string) => {
      if (key === "useUtils") return () => node("utils");
      if (key === "invalidate") return vi.fn(async () => undefined);
      if (key === "useQuery") return () => ({
        data: mock.data[path], isLoading: false, isFetching: false, isRefetching: false,
        dataUpdatedAt: 1, error: null, refetch: vi.fn(async () => undefined),
      });
      if (key === "useMutation") return (options: any = {}) => {
        const [isPending, setPending] = react.useState(false);
        const [error, setError] = react.useState<any>(null);
        const mutateAsync = async (input: any) => {
          mock.calls.push({ path, input: structuredClone(input) });
          setPending(true);
          try {
            await mock.waitFor[path];
            if (mock.reject[path]) throw new Error(mock.reject[path]);
            const result = mock.results[path] ?? { success: true, id: input.id ?? 80 };
            await options.onSuccess?.(result, input);
            return result;
          } catch (failure) {
            setError(failure);
            options.onError?.(failure);
            throw failure;
          } finally { setPending(false); }
        };
        return { isPending, error, mutateAsync, reset: () => setError(null),
          mutate: (input: any) => { void mutateAsync(input).catch(() => undefined); } };
      };
      return node(path ? `${path}.${key}` : key);
    },
  });
  return { trpc: node() };
});
import AdminAcademy from "../client/src/pages/admin/AdminAcademy";
import StaffWorkspace from "../client/src/pages/staff/StaffWorkspace";

const key = "academy/7/12345678-1234-1234-1234-123456789abc-safety.pdf";
const replacementKey = "academy/7/abcdefab-1234-1234-1234-abcdefabcdef-replacement.pdf";
const pdf = { attachmentKey: key, attachmentUrl: `https://objects.example.test/files/${key}`,
  attachmentName: "Safety resource.pdf" };
const privatePdf = { ...pdf,
  attachmentUrl: `https://portal.thejltgroup.co.uk/api/academy/course-attachment/${encodeURIComponent(key)}` };
const template = { assessmentTemplateKey: "academy-document-templates/private-template.pdf",
  assessmentTemplateName: "Private template.pdf", assessmentTemplateMimeType: "application/pdf",
  assessmentTemplateSize: 2048 };
const question = { id: 114, prompt: "## Task\n\nExplain **evidence**.\n\n- First check\n- Second check",
  explanation: "## Private guide\n\n- Evidence checked", questionType: "free_text",
  answerOptions: [], correctAnswerIndex: 0, maxWords: 250, allowPaste: true };
function syntheticLesson(id = 14, title = "Safety lesson") {
  return { id, moduleId: 9, title, summary: "Plain summary", contentHtml: "<h2>Safety</h2><p>Read <strong>carefully</strong>.</p>",
    videoUrl: "https://www.youtube.com/watch?v=AbCdEfGhI12", videoTranscript: "Private transcript",
    attachmentUrl: null, attachmentKey: null, attachmentName: null,
    archivedAt: null, estimatedMinutes: 12, isRequired: true, requiresAcknowledgement: true,
    requiresAssessment: true, assessmentMode: "quiz", assessmentPassMark: 85,
    ...template, questions: [structuredClone(question)] };
}
function fixture() {
  return { course: { id: 7, title: "Synthetic course", summary: "Plain course summary", status: "draft",
    estimatedMinutes: 20, coverImageUrl: null, isCoreAcademy: false, isAcceleratorJourney: false,
    updatedAt: new Date("2026-11-01T12:00:00Z") },
    modules: [{ id: 9, courseId: 7, title: "Preparation module", summary: "", releaseWeek: 0,
      lessons: [syntheticLesson(), syntheticLesson(24, "Another lesson")] }] };
}

class ControlledReader {
  static readers: ControlledReader[] = [];
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readAsDataURL(_file: File) { ControlledReader.readers.push(this); }
  succeed() { this.result = "data:application/pdf;base64,c3ludGhldGlj"; this.onload?.(); }
  fail() { this.onerror?.(); }
  abort() { this.onabort?.(); }
}
type Mode = "admin" | "staff";
let root: Root;
let container: HTMLDivElement;
let previousIframeSetting: boolean;
let confirm: ReturnType<typeof vi.spyOn>;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function render(mode: Mode) {
  await act(async () => root.render(React.createElement(mode === "admin" ? AdminAcademy : StaffWorkspace)));
  await flush();
}
function button(text: string, scope: ParentNode = container) {
  const matches = [...scope.querySelectorAll<HTMLButtonElement>("button")].filter(item => item.textContent?.trim() === text);
  expect(matches, text).toHaveLength(1);
  return matches[0]!;
}
async function click(control: HTMLButtonElement) { await act(async () => control.click()); await flush(); }
function staffField(label: string) {
  const field = [...container.querySelectorAll("label")].find(item => item.querySelector("span")?.textContent === label);
  expect(field, label).toBeTruthy();
  return field!.querySelector<HTMLInputElement | HTMLSelectElement>("input,select")!;
}
async function change(control: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
  await flush();
}
async function open(mode: Mode, overrides: Record<string, any> = {}, isNew = false) {
  Object.assign(mock.data["academy.admin.editor"].modules[0].lessons[0], overrides);
  await render(mode);
  if (mode === "staff") {
    await change(staffField("Assigned course"), "7");
    await click(button(isNew ? "Add lesson" : "Safety lesson"));
  } else if (isNew) {
    await click(button("Add lesson", container.querySelector("#academy-module-9")!));
  } else {
    await click(container.querySelector<HTMLButtonElement>('#academy-module-9 button[title="Edit lesson name and content"]')!);
  }
}
function editor(mode: Mode) {
  return mode === "admin" ? container.querySelector<HTMLElement>("#academy-module-9-lesson-editor")! : container.querySelector<HTMLElement>("form")!;
}
function pdfSwitch() { return container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Display PDF inside lesson"]'); }
function resourceInput(mode: Mode) {
  return mode === "admin" ? container.querySelector<HTMLInputElement>('[aria-label="Upload lesson resource"]')! : staffField("Lesson resource (up to 10 MB)") as HTMLInputElement;
}
function saveControl(mode: Mode) { return button("Save lesson", editor(mode)); }
function saved() { return mock.calls.filter(item => item.path === savePath).at(-1)!.input; }
function resourceSelection(control: HTMLInputElement, name = "replacement.pdf", type = "") {
  const file = new File(["synthetic"], name, { type });
  Object.defineProperty(control, "files", { configurable: true, value: [file] });
  control.dispatchEvent(new Event("change", { bubbles: true }));
}
async function selectFile(mode: Mode, name = "replacement.pdf", type = "") {
  await act(async () => resourceSelection(resourceInput(mode), name, type)); await flush();
}
async function completeRead(fail = false) {
  expect(ControlledReader.readers).toHaveLength(1);
  await act(async () => fail ? ControlledReader.readers[0]!.fail() : ControlledReader.readers[0]!.succeed());
  await flush();
}
function waitFor(path: string) {
  let resolve!: () => void;
  mock.waitFor[path] = new Promise<void>(done => { resolve = done; });
  return async () => { await act(async () => resolve()); await flush(); };
}
function assertNoAssessmentDrift(mode: Mode, input = saved()) {
  expect(input).toMatchObject({ assessmentMode: "quiz", assessmentPassMark: 85,
    requiresAssessment: true, requiresAcknowledgement: true, ...template });
  expect(mock.calls.filter(item => item.path === questionPath)).toEqual([]);
  if (mode === "admin") expect(input.questions).toEqual([question]);
  else expect(input).not.toHaveProperty("questions");
  expect(mock.data["academy.admin.editor"].modules[0].lessons[0].questions).toEqual([question]);
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mock.fetch);
  mock.fetch.mockImplementation(() => { throw new Error("Network forbidden in offline PDF editor tests"); });
  vi.stubGlobal("FileReader", ControlledReader); ControlledReader.readers = [];
  previousIframeSetting = (window as any).happyDOM.settings.disableIframePageLoading;
  (window as any).happyDOM.settings.disableIframePageLoading = true;
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
  confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  mock.calls = []; mock.waitFor = {}; mock.reject = {};
  mock.results = { [uploadPath]: { key: replacementKey, url: `https://objects.example.test/files/${replacementKey}`, name: "replacement.pdf" } };
  mock.data = { "academy.admin.courses": [{ id: 7, title: "Synthetic course", status: "draft", completionCount: 1, enrolmentCount: 2 }],
    "academy.admin.editor": fixture(), "academy.admin.emailAlerts": [], "academy.admin.emailAlertActivity": [],
    "staffAccess.mine": { instructor: true, engagement: false, courseIds: [7], schemaAvailable: true } };
  await import("../client/src/pages/staff/StaffInstructor");
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  expect(mock.fetch).not.toHaveBeenCalled();
  (window as any).happyDOM.settings.disableIframePageLoading = previousIframeSetting;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe.each<Mode>(["admin", "staff"])("%s opt-in PDF lesson resource editor", mode => {
  beforeEach(() => window.history.replaceState(null, "", mode === "admin" ? "/admin/academy" : "/staff/instructor"));
  it("creates a lesson with embedding explicitly off and no switch without a PDF", async () => {
    await open(mode, {}, true);
    expect(pdfSwitch()).toBeNull();
    await change(mode === "admin" ? editor(mode).querySelector<HTMLInputElement>('input[placeholder="e.g. How the JLT booking workflow works"]')! : staffField("Lesson title"), "New synthetic lesson");
    await click(saveControl(mode));
    expect(saved()).toMatchObject({ moduleId: 9, embedPdf: false, attachmentKey: null, attachmentUrl: null });
    expect(mock.calls.filter(item => item.path === questionPath)).toEqual([]);
  });
  it.each([true, false, undefined, null, "true", 1])("hydrates embedPdf=%s strictly and saves its boolean value", async value => {
    await open(mode, { ...pdf, embedPdf: value });
    expect(pdfSwitch()).not.toBeNull();
    expect(pdfSwitch()!.getAttribute("aria-checked")).toBe(value === true ? "true" : "false");
    expect(editor(mode).textContent).toContain("Open and download remain available.");
    expect(container.querySelector("iframe, object, embed")).toBeNull();
    await click(saveControl(mode));
    expect(saved()).toMatchObject({ id: 14, moduleId: 9, ...pdf, embedPdf: value === true });
    assertNoAssessmentDrift(mode);
  });
  it("recognizes the canonical private uploaded PDF and ignores its misleading non-PDF title", async () => {
    await open(mode, { ...privatePdf, attachmentName: "Ordinary notes.txt", embedPdf: false });
    expect(pdfSwitch()!.getAttribute("aria-checked")).toBe("false");
    await click(pdfSwitch()!); await click(saveControl(mode));
    expect(saved()).toMatchObject({ ...privatePdf, attachmentName: "Ordinary notes.txt", embedPdf: true });
    assertNoAssessmentDrift(mode);
  });
  it.each([
    { ...pdf, attachmentKey: key.replace(/\.pdf$/, ".docx"), attachmentUrl: pdf.attachmentUrl.replace(/\.pdf$/, ".docx") },
    { ...pdf, attachmentKey: null },
    { ...pdf, attachmentUrl: "https://external.example.test/arbitrary.pdf" },
    { ...pdf, attachmentUrl: `${pdf.attachmentUrl}?unsafe=1` },
    { ...pdf, attachmentUrl: "javascript:alert(1)" },
  ])("does not enable the switch from a visible .pdf title or an unrecognized resource %#", async resource => {
    await open(mode, { ...resource, embedPdf: false });
    expect(pdfSwitch()).toBeNull();
    await click(saveControl(mode)); expect(saved().embedPdf).toBe(false);
  });
  it("does not offer lesson embedding for the private assessment PDF template", async () => {
    await open(mode, { requiresAssessment: true, assessmentMode: "document_upload" });
    expect(editor(mode).textContent).toContain("Private template.pdf");
    expect(pdfSwitch()).toBeNull();
    await click(saveControl(mode));
    expect(saved()).toMatchObject({ embedPdf: false, assessmentMode: "document_upload", ...template });
  });
  it.each([true, false])("saves a deliberate switch change from %s without question/history/assessment changes", async initial => {
    await open(mode, { ...pdf, embedPdf: initial });
    const promptLabel = mode === "admin" ? "Written question 1" : "Question 1 prompt";
    const guideLabel = mode === "admin" ? "Private marking guide for question 1" : "Question 1 explanation / private marking guide";
    expect(editor(mode).querySelectorAll(`[aria-label="${promptLabel}"]`)).toHaveLength(mode === "admin" ? 1 : 0);
    const scope = mode === "admin" ? editor(mode) : container;
    expect(scope.querySelectorAll(`[aria-label="${promptLabel}"]`)).toHaveLength(1);
    expect(scope.querySelectorAll(`[aria-label="${guideLabel}"]`)).toHaveLength(1);
    const prompt = scope.querySelector(`[aria-label="${promptLabel}"]`)!.innerHTML;
    const guide = scope.querySelector(`[aria-label="${guideLabel}"]`)!.innerHTML;
    await click(pdfSwitch()!);
    expect(scope.querySelector(`[aria-label="${promptLabel}"]`)!.innerHTML).toBe(prompt);
    expect(scope.querySelector(`[aria-label="${guideLabel}"]`)!.innerHTML).toBe(guide);
    if (mode === "admin") expect(container.querySelector('[aria-label="Allow pasting for question 1"]')!.getAttribute("aria-checked")).toBe("true");
    await click(saveControl(mode));
    expect(saved()).toMatchObject({ ...pdf, embedPdf: !initial }); assertNoAssessmentDrift(mode);
    expect(mock.calls.map(item => item.path)).toEqual([savePath]);
  });
  it("clears opt-in when removing the ordinary resource but retains the assessment template", async () => {
    await open(mode, { ...pdf, embedPdf: true });
    await click(button("Remove resource", editor(mode)));
    expect(pdfSwitch()).toBeNull();
    await click(saveControl(mode));
    expect(saved()).toMatchObject({ attachmentUrl: null, attachmentKey: null, attachmentName: null, embedPdf: false });
    assertNoAssessmentDrift(mode);
  });
  it("replaces an opted-in PDF with a blank-MIME PDF and resets opt-in only after success", async () => {
    await open(mode, { ...pdf, embedPdf: true });
    await selectFile(mode);
    expect(resourceInput(mode).value).toBe(""); expect(pdfSwitch()!.getAttribute("aria-checked")).toBe("true");
    expect(mock.calls).toEqual([]);
    await completeRead();
    expect(mock.calls).toEqual([{ path: uploadPath, input: { ...(mode === "staff" ? { courseId: 7 } : {}),
      fileName: "replacement.pdf", fileBase64: "c3ludGhldGlj", mimeType: "application/pdf" } }]);
    expect(pdfSwitch()!.getAttribute("aria-checked")).toBe("false");
    await click(saveControl(mode));
    expect(saved()).toMatchObject({ attachmentKey: replacementKey, attachmentUrl: `https://objects.example.test/files/${replacementKey}`,
      attachmentName: "replacement.pdf", embedPdf: false }); assertNoAssessmentDrift(mode);
  });
  it("uploads a new ordinary PDF without silently opting in", async () => {
    await open(mode);
    expect(pdfSwitch()).toBeNull();
    await selectFile(mode); await completeRead();
    expect(pdfSwitch()!.getAttribute("aria-checked")).toBe("false");
    await click(pdfSwitch()!); await click(saveControl(mode));
    expect(saved()).toMatchObject({ attachmentKey: replacementKey, embedPdf: true }); assertNoAssessmentDrift(mode);
  });
  it("replacing a PDF with a TXT hides the switch and saves embedding off", async () => {
    await open(mode, { ...pdf, embedPdf: true });
    const textKey = replacementKey.replace(/\.pdf$/, ".txt");
    mock.results[uploadPath] = { key: textKey, url: `https://objects.example.test/files/${textKey}`, name: "replacement.txt" };
    await selectFile(mode, "replacement.txt"); await completeRead();
    expect(pdfSwitch()).toBeNull(); await click(saveControl(mode));
    expect(saved()).toMatchObject({ attachmentKey: textKey, embedPdf: false }); assertNoAssessmentDrift(mode);
  });
  it.each(["read", "upload"])("retains the existing PDF and opt-in after a %s failure and permits retry", async failure => {
    await open(mode, { ...pdf, embedPdf: true });
    if (failure === "upload") mock.reject[uploadPath] = "Synthetic upload denied";
    await selectFile(mode); await completeRead(failure === "read");
    expect(pdfSwitch()!.getAttribute("aria-checked")).toBe("true");
    expect(resourceInput(mode).disabled).toBe(false);
    const message = failure === "read" ? "The file could not be read." : "Synthetic upload denied";
    if (mode === "admin") expect(mock.error).toHaveBeenCalledWith(message);
    else expect(container.textContent).toContain(message);
    await click(saveControl(mode)); expect(saved()).toMatchObject({ ...pdf, embedPdf: true }); assertNoAssessmentDrift(mode);
  });
  it("freezes resource controls during reading and guards stale same-tick save/removal/switch handlers", async () => {
    await open(mode, { ...pdf, embedPdf: true });
    const save = saveControl(mode), toggle = pdfSwitch()!, remove = button("Remove resource", editor(mode));
    await act(async () => {
      resourceSelection(resourceInput(mode));
      toggle.click(); remove.click();
      if (mode === "staff") editor(mode).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      else save.click();
    });
    await flush();
    expect(mock.calls).toEqual([]); expect(pdfSwitch()!.getAttribute("aria-checked")).toBe("true");
    expect(resourceInput(mode).disabled).toBe(true); expect(pdfSwitch()!.disabled).toBe(true);
    expect(button("Remove resource", editor(mode)).disabled || editor(mode).querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(true);
    if (mode === "admin") {
      expect(button("Back to lessons").disabled).toBe(true);
      const second = container.querySelectorAll<HTMLButtonElement>('#academy-module-9 button[title="Edit lesson name and content"]')[1]!;
      expect(second.disabled).toBe(true); await click(second);
      await click(button("Add lesson", container.querySelector("#academy-module-9")!));
      expect(editor(mode).textContent).toContain("Safety lesson"); expect(confirm).not.toHaveBeenCalled();
    }
    await completeRead(); expect(pdfSwitch()!.getAttribute("aria-checked")).toBe("false");
  });
  it("allows selecting the same file again after upload failure while preserving the existing resource", async () => {
    await open(mode, { ...pdf, embedPdf: true });
    mock.reject[uploadPath] = "Synthetic upload denied";
    await selectFile(mode); await completeRead();
    expect(pdfSwitch()!.getAttribute("aria-checked")).toBe("true");
    delete mock.reject[uploadPath];
    ControlledReader.readers = [];
    await selectFile(mode); await completeRead();
    expect(mock.calls.filter(item => item.path === uploadPath)).toHaveLength(2);
    expect(pdfSwitch()!.getAttribute("aria-checked")).toBe("false");
    await click(saveControl(mode));
    expect(saved()).toMatchObject({ attachmentKey: replacementKey, embedPdf: false });
    assertNoAssessmentDrift(mode);
  });
  it("catches a synchronous file-read exception, unfreezes controls and retains the old opt-in", async () => {
    await open(mode, { ...pdf, embedPdf: true });
    vi.spyOn(ControlledReader.prototype, "readAsDataURL").mockImplementationOnce(() => { throw new Error("Synthetic read denied"); });
    await selectFile(mode);
    expect(mock.calls).toEqual([]); expect(resourceInput(mode).disabled).toBe(false);
    expect(pdfSwitch()!.getAttribute("aria-checked")).toBe("true");
    if (mode === "admin") expect(mock.error).toHaveBeenCalledWith("Synthetic read denied");
    else expect(container.textContent).toContain("Synthetic read denied");
    await click(saveControl(mode)); expect(saved()).toMatchObject({ ...pdf, embedPdf: true });
  });
  it("rejects unsupported resource formats without mutating the existing draft", async () => {
    await open(mode, { ...pdf, embedPdf: true });
    await selectFile(mode, "unsafe.html", "text/html");
    if (mode === "staff") await completeRead();
    expect(mock.calls).toEqual([]); expect(resourceInput(mode).disabled).toBe(false);
    expect(pdfSwitch()!.getAttribute("aria-checked")).toBe("true");
    await click(saveControl(mode)); expect(saved()).toMatchObject({ ...pdf, embedPdf: true });
    assertNoAssessmentDrift(mode);
  });
  it("keeps controls frozen throughout the upload mutation and ignores duplicate file selection", async () => {
    await open(mode, { ...pdf, embedPdf: true });
    const release = waitFor(uploadPath); await selectFile(mode); await completeRead();
    expect(resourceInput(mode).disabled).toBe(true); expect(pdfSwitch()!.disabled).toBe(true);
    await act(async () => resourceSelection(resourceInput(mode), "duplicate.pdf"));
    expect(ControlledReader.readers).toHaveLength(1); expect(mock.calls).toHaveLength(1);
    await click(pdfSwitch()!); expect(pdfSwitch()!.getAttribute("aria-checked")).toBe("true");
    await release(); expect(resourceInput(mode).disabled).toBe(false);
    expect(pdfSwitch()!.getAttribute("aria-checked")).toBe("false");
  });
  it("freezes the switch on save, snapshots opt-in, and keeps it on a rejected save", async () => {
    await open(mode, { ...pdf, embedPdf: false }); await click(pdfSwitch()!);
    const release = waitFor(savePath); mock.reject[savePath] = "Synthetic save denied";
    await click(saveControl(mode));
    expect(pdfSwitch()!.disabled).toBe(true); expect(saved().embedPdf).toBe(true);
    await click(pdfSwitch()!); expect(saved().embedPdf).toBe(true);
    await release(); expect(pdfSwitch()!.disabled).toBe(false);
    expect(pdfSwitch()!.getAttribute("aria-checked")).toBe("true");
    delete mock.reject[savePath]; await click(saveControl(mode));
    expect(saved().embedPdf).toBe(true); assertNoAssessmentDrift(mode);
  });
});

describe("late instructor ordinary-resource completion", () => {
  beforeEach(() => window.history.replaceState(null, "", "/staff/instructor"));
  it.each(["read", "upload"])("does not write the old resource into another selected draft after late %s completion", async phase => {
    await open("staff", { ...pdf, embedPdf: true });
    const release = phase === "upload" ? waitFor(uploadPath) : undefined;
    await selectFile("staff");
    if (phase === "upload") await completeRead();
    await click(button("Another lesson"));
    expect(staffField("Lesson title").value).toBe("Another lesson"); expect(pdfSwitch()).toBeNull();
    if (phase === "read") await completeRead(); else await release!();
    expect(pdfSwitch()).toBeNull(); expect(container.textContent).not.toContain("replacement.pdf");
    await click(saveControl("staff"));
    expect(saved()).toMatchObject({ id: 24, attachmentKey: null, attachmentUrl: null, embedPdf: false });
    expect(mock.calls.filter(item => item.path === uploadPath)).toHaveLength(phase === "read" ? 0 : 1);
  });
  it("unmounts the editor on revoked scope and does not upload after a late read", async () => {
    await open("staff", { ...pdf, embedPdf: true }); await selectFile("staff");
    mock.data["staffAccess.mine"] = { instructor: false, engagement: false, courseIds: [], schemaAvailable: true };
    await render("staff"); expect(container.querySelector("form")).toBeNull();
    await completeRead(); expect(mock.calls).toEqual([]); expect(pdfSwitch()).toBeNull();
  });
});
