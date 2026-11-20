// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Actual Manager, Instructor (including authority boundary), learner and rich editors.
// Only auth, tRPC and controlled file I/O are synthetic. No network or iframe loads.
const savePath = "academy.admin.saveLesson";
const questionsPath = "academy.admin.replaceQuestions";
const templatePath = "academy.admin.uploadDocumentAssessmentTemplate";
const attachmentPath = "academy.admin.uploadAttachment";
const submitPath = "academy.agent.submitDocumentAssessment";
const downloadPath = "academy.agent.getDocumentAssessmentTemplate";
const acknowledgePath = "academy.agent.acknowledgeAssessmentFeedback";
const mock = vi.hoisted(() => ({
  data: {} as Record<string, any>, calls: [] as { path: string; input: any }[],
  waitFor: {} as Record<string, Promise<void>>, reject: {} as Record<string, string>,
  results: {} as Record<string, any>, isAgentView: false,
  fetch: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({
  user: { id: 9, role: "agent", name: "Synthetic instructor", isActive: true,
    portalStatus: "active", mustChangePassword: false }, loading: false, logout: vi.fn(),
}) }));
vi.mock("@/contexts/ViewModeContext", () => ({ useViewMode: () => ({
  setViewMode: vi.fn(), isAdminView: !mock.isAgentView, isAgentView: mock.isAgentView,
}) }));
vi.mock("sonner", () => ({ toast: {
  success: mock.success, error: mock.error, info: mock.info, warning: mock.warning,
} }));
vi.mock("@/lib/trpc", async () => {
  const react = await import("react");
  const node = (path = ""): any => new Proxy({}, { get: (_target, key: string) => {
    if (key === "useUtils") return () => node("utils");
    if (key === "invalidate") return vi.fn(async () => undefined);
    if (key === "useQuery") return () => ({ data: mock.data[path], isLoading: false,
      isFetching: false, isRefetching: false, dataUpdatedAt: 1, error: null,
      refetch: vi.fn(async () => undefined) });
    if (key === "useMutation") return (options: any = {}) => {
      const [isPending, setPending] = react.useState(false);
      const [error, setError] = react.useState<any>(null);
      const mutateAsync = async (input: any) => {
        mock.calls.push({ path, input: structuredClone(input) }); setPending(true);
        try {
          await mock.waitFor[path];
          if (mock.reject[path]) throw new Error(mock.reject[path]);
          const result = mock.results[path] ?? { id: input.id ?? 80, success: true };
          await options.onSuccess?.(result, input); return result;
        } catch (failure) {
          setError(failure); options.onError?.(failure); throw failure;
        } finally { setPending(false); }
      };
      return { isPending, error, mutateAsync, reset: () => setError(null),
        mutate: (input: any) => { void mutateAsync(input).catch(() => undefined); } };
    };
    return node(path ? `${path}.${key}` : key);
  } });
  return { trpc: node() };
});
import AdminAcademy from "../client/src/pages/admin/AdminAcademy";
import StaffWorkspace from "../client/src/pages/staff/StaffWorkspace";
import AcademyCourse from "../client/src/pages/academy/AcademyCourse";

const template = { assessmentTemplateKey: "academy/document-assessments/templates/7/private-template.pdf",
  assessmentTemplateName: "Private template.pdf", assessmentTemplateMimeType: "application/pdf", assessmentTemplateSize: 2048 };
const noTemplate = { assessmentTemplateKey: null, assessmentTemplateName: null,
  assessmentTemplateMimeType: null, assessmentTemplateSize: null };
const pdfKey = "academy/7/12345678-1234-1234-1234-123456789abc-guide.pdf";
const resource = { attachmentKey: pdfKey, attachmentUrl: `https://objects.example.test/files/${pdfKey}`,
  attachmentName: "Ordinary lesson resource.pdf", embedPdf: true };
const question = { id: 114, prompt: "## Task\n\nExplain **evidence**.\n\n- First check\n- Second check",
  questionType: "free_text", explanation: "## Private guide\n\n- Evidence checked", answerOptions: [],
  correctAnswerIndex: 0, maxWords: 250, allowPaste: true };
const completedAt = new Date("2026-11-01T12:00:00Z");
function lesson(overrides: Record<string, any> = {}) {
  return { id: 14, moduleId: 9, title: "Synthetic assessment", summary: "Practical assessment",
    contentHtml: "<h2>Instructions</h2><p>Upload your own evidence.</p>",
    videoUrl: null, videoTranscript: "Private transcript", attachmentUrl: null, attachmentKey: null,
    attachmentName: null, embedPdf: false, archivedAt: null, estimatedMinutes: 12,
    isRequired: true, requiresAcknowledgement: true, requiresAssessment: true,
    assessmentMode: "document_upload", assessmentPassMark: 85, ...template,
    questions: [structuredClone(question)], ...overrides };
}
function editorFixture() {
  return { course: { id: 7, title: "Synthetic course", summary: "Course summary", status: "draft",
    estimatedMinutes: 20, isCoreAcademy: false, isAcceleratorJourney: false, coverImageUrl: null,
    updatedAt: completedAt }, modules: [{ id: 9, courseId: 7, title: "Preparation module", summary: "",
    releaseWeek: 0, lessons: [lesson(), lesson({ id: 24, title: "Another lesson" })] }] };
}
function learnerLesson(overrides: Record<string, any> = {}) {
  return { ...lesson(), ...noTemplate, hasAssessmentTemplate: false, locked: false, lockedReason: "",
    progress: null, attempts: [], questions: [], ...overrides };
}
function attempt(overrides: Record<string, any> = {}) {
  return { id: 100, status: "feedback_pending", score: 95, passed: true,
    graderFeedback: "Good recorded evidence", feedbackAcknowledgedAt: null,
    takenAt: completedAt, responses: [], ...overrides };
}
function learnerFixture(currentLesson: any) {
  return { course: { id: 7, title: "Synthetic course", summary: "Course summary", isAcceleratorJourney: false },
    enrollment: { id: 20 }, progress: { percentage: currentLesson.progress?.completedAt ? 100 : 0,
      completedRequiredLessons: currentLesson.progress?.completedAt ? 1 : 0, requiredLessons: 1,
      isComplete: !!currentLesson.progress?.completedAt }, modules: [{ id: 9, title: "Preparation module",
      releaseWeek: 0, releaseLocked: false, releaseLabel: null, lessons: [currentLesson] }] };
}
class ControlledReader {
  static readers: ControlledReader[] = [];
  result: string | null = null;
  file!: File;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readAsDataURL(file: File) { this.file = file; ControlledReader.readers.push(this); }
  async succeed() {
    this.result = `data:${this.file.type};base64,${Buffer.from(await this.file.arrayBuffer()).toString("base64")}`;
    this.onload?.();
  }
  fail() { this.onerror?.(); }
}
type Mode = "admin" | "staff";
let root: Root;
let container: HTMLDivElement;
let confirm: ReturnType<typeof vi.spyOn>;
let previousIframeSetting: boolean;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function render(mode: Mode) {
  await act(async () => root.render(React.createElement(mode === "admin" ? AdminAcademy : StaffWorkspace)));
  await flush();
}
function button(text: string, scope: ParentNode = container) {
  const matches = [...scope.querySelectorAll<HTMLButtonElement>("button")].filter(item => item.textContent?.trim() === text);
  expect(matches, text).toHaveLength(1); return matches[0]!;
}
function hasButton(text: string, scope: ParentNode = container) {
  return [...scope.querySelectorAll("button")].some(item => item.textContent?.trim() === text);
}
async function click(control: HTMLButtonElement) { await act(async () => control.click()); await flush(); }
function staffField(label: string) {
  const field = [...container.querySelectorAll("label")].find(item => item.querySelector("span")?.textContent === label);
  expect(field, label).toBeTruthy(); return field!.querySelector<HTMLInputElement | HTMLSelectElement>("input,select")!;
}
async function change(control: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  }); await flush();
}
function editor(mode: Mode) {
  return mode === "admin" ? container.querySelector<HTMLElement>("#academy-module-9-lesson-editor")! : container.querySelector<HTMLElement>("form")!;
}
function modeSelect(mode: Mode) {
  return mode === "admin" ? container.querySelector<HTMLSelectElement>("#academy-assessment-mode")! : staffField("Assessment type");
}
function templateInput(mode: Mode) {
  return mode === "admin" ? container.querySelector<HTMLInputElement>('[aria-label="Upload private assessment template (optional)"]')! : staffField("Private assessment template (optional)") as HTMLInputElement;
}
function resourceInput(mode: Mode) {
  return mode === "admin" ? container.querySelector<HTMLInputElement>('[aria-label="Upload lesson resource"]')! : staffField("Lesson resource (up to 10 MB)") as HTMLInputElement;
}
function saved() { return mock.calls.filter(call => call.path === savePath).at(-1)!.input; }
async function open(mode: Mode, overrides: Record<string, any> = {}, isNew = false) {
  Object.assign(mock.data["academy.admin.editor"].modules[0].lessons[0], overrides);
  await render(mode);
  if (mode === "staff") {
    await change(staffField("Assigned course"), "7");
    await click(button(isNew ? "Add lesson" : "Synthetic assessment"));
  } else if (isNew) await click(button("Add lesson", container.querySelector("#academy-module-9")!));
  else await click(container.querySelector<HTMLButtonElement>('#academy-module-9 button[title="Edit lesson name and content"]')!);
}
function selectFile(control: HTMLInputElement, file = new File(["%PDF-1.7\nSynthetic work"], "my-work.pdf", { type: "application/pdf" })) {
  Object.defineProperty(control, "files", { configurable: true, value: [file] });
  control.dispatchEvent(new Event("change", { bubbles: true })); return file;
}
async function fileSelection(control: HTMLInputElement, file?: File) {
  await act(async () => { selectFile(control, file); }); await flush();
}
async function completeRead(fail = false) {
  expect(ControlledReader.readers).toHaveLength(1);
  await act(async () => fail ? ControlledReader.readers[0]!.fail() : ControlledReader.readers[0]!.succeed());
  await flush();
}
function defer(path: string) {
  let release!: () => void; mock.waitFor[path] = new Promise<void>(resolve => { release = resolve; });
  return async () => { await act(async () => release()); await flush(); };
}
function assertQuestionsUntouched(mode: Mode, input = saved()) {
  expect(mock.calls.filter(call => call.path === questionsPath)).toEqual([]);
  if (mode === "admin") expect(input.questions).toEqual([question]);
  else expect(input).not.toHaveProperty("questions");
  expect(mock.data["academy.admin.editor"].modules[0].lessons[0].questions).toEqual([question]);
}
async function renderLearner(overrides: Record<string, any> = {}, preview = false) {
  mock.isAgentView = preview;
  const data = learnerFixture(learnerLesson(overrides));
  mock.data["academy.agent.course"] = data; mock.data["academy.agent.previewCourse"] = data;
  await act(async () => root.render(React.createElement(AcademyCourse, preview ? { previewCourseId: "7" } : { enrollmentId: "20" })));
  await flush(); return data;
}
function uploadInput() { return container.querySelector<HTMLInputElement>('input[type="file"]')!; }
function assertNoLearnerEvidence() {
  expect(mock.calls.filter(call => [submitPath, "academy.agent.submitAssessment", "academy.agent.completeLesson", acknowledgePath].includes(call.path))).toEqual([]);
}
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mock.fetch); mock.fetch.mockImplementation(() => { throw new Error("Network forbidden in offline upload-only tests"); });
  vi.stubGlobal("FileReader", ControlledReader); ControlledReader.readers = [];
  previousIframeSetting = (window as any).happyDOM.settings.disableIframePageLoading;
  (window as any).happyDOM.settings.disableIframePageLoading = true;
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
  confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  mock.calls = []; mock.waitFor = {}; mock.reject = {}; mock.isAgentView = false;
  mock.results = { [templatePath]: { key: "private-new-template", name: "New template.pdf", mimeType: "application/pdf", size: 4096 },
    [acknowledgePath]: { passed: true }, [downloadPath]: { url: "https://portal.example.test/synthetic-download" },
    [attachmentPath]: { key: pdfKey, url: resource.attachmentUrl, name: resource.attachmentName } };
  mock.data = { "academy.admin.courses": [{ id: 7, title: "Synthetic course", status: "draft", completionCount: 1, enrolmentCount: 2 }],
    "academy.admin.editor": editorFixture(), "academy.admin.emailAlerts": [], "academy.admin.emailAlertActivity": [],
    "staffAccess.mine": { instructor: true, engagement: false, courseIds: [7], schemaAvailable: true } };
  await import("../client/src/pages/staff/StaffInstructor");
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); expect(mock.fetch).not.toHaveBeenCalled();
  (window as any).happyDOM.settings.disableIframePageLoading = previousIframeSetting;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe.each<Mode>(["admin", "staff"])("%s optional-template document authoring", mode => {
  beforeEach(() => window.history.replaceState(null, "", mode === "admin" ? "/admin/academy" : "/staff/instructor"));
  it("saves a new upload-only assessment without a template or quiz mutation", async () => {
    await open(mode, {}, true);
    await change(mode === "admin" ? editor(mode).querySelector<HTMLInputElement>('input[placeholder="e.g. How the JLT booking workflow works"]')! : staffField("Lesson title"), "New upload-only assessment");
    const label = [...editor(mode).querySelectorAll("label")].find(item => item.textContent?.includes(mode === "admin" ? "Add an assessment" : "Require assessment"))!;
    await act(async () => (label.querySelector("button,input") as HTMLElement).click()); await flush();
    await change(modeSelect(mode), "document_upload");
    expect(editor(mode).textContent).toContain("Private assessment template (optional)");
    expect(editor(mode).textContent).toContain("no download is needed");
    expect(button("Save lesson", editor(mode)).disabled).toBe(false);
    await click(button("Save lesson", editor(mode)));
    expect(saved()).toMatchObject({ moduleId: 9, title: "New upload-only assessment", requiresAssessment: true,
      assessmentMode: "document_upload", ...noTemplate, embedPdf: false });
    expect(mock.calls.map(call => call.path)).toEqual([savePath]);
  });
  it("hydrates and saves all four existing template fields unchanged", async () => {
    await open(mode, resource);
    expect(editor(mode).textContent).toContain(template.assessmentTemplateName);
    expect(modeSelect(mode).value).toBe("document_upload");
    expect(editor(mode).textContent).toContain("Adding or replacing a template after learner activity is blocked");
    await click(button("Save lesson", editor(mode)));
    expect(saved()).toMatchObject({ id: 14, assessmentMode: "document_upload", ...template, ...resource,
      requiresAcknowledgement: true, requiresAssessment: true, assessmentPassMark: 85 });
    assertQuestionsUntouched(mode);
  });
  it("clears ALL4 template fields only on confirmed removal, preserving PDF, resources, questions and private settings", async () => {
    await open(mode, resource);
    await click(button("Remove template", editor(mode)));
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("original template snapshots are kept"));
    expect(mock.calls).toEqual([]); expect(hasButton("Remove template", editor(mode))).toBe(false);
    expect(editor(mode).textContent).toContain("no download is needed");
    expect(container.querySelector('[aria-label="Display PDF inside lesson"]')!.getAttribute("aria-checked")).toBe("true");
    await change(modeSelect(mode), "quiz");
    const promptLabel = mode === "admin" ? "Written question 1" : "Question 1 prompt";
    const guideLabel = mode === "admin" ? "Private marking guide for question 1" : "Question 1 explanation / private marking guide";
    expect(container.querySelector(`[aria-label="${promptLabel}"]`)!.textContent).toContain("Explain evidence");
    expect(container.querySelector(`[aria-label="${guideLabel}"]`)!.textContent).toContain("Evidence checked");
    await change(modeSelect(mode), "document_upload"); await click(button("Save lesson", editor(mode)));
    expect(saved()).toMatchObject({ id: 14, ...noTemplate, ...resource, assessmentMode: "document_upload",
      videoTranscript: "Private transcript", requiresAcknowledgement: true, isRequired: true, assessmentPassMark: 85 });
    assertQuestionsUntouched(mode);
    expect(mock.data["academy.admin.editor"].modules[0].lessons[0]).toMatchObject(template);
  });
  it("preserves the existing template on cancelled removal", async () => {
    await open(mode, resource); confirm.mockReturnValue(false);
    await click(button("Remove template", editor(mode)));
    expect(confirm).toHaveBeenCalledOnce(); expect(hasButton("Remove template", editor(mode))).toBe(true);
    expect(editor(mode).textContent).toContain(template.assessmentTemplateName);
    await click(button("Save lesson", editor(mode))); expect(saved()).toMatchObject({ ...template, ...resource });
    assertQuestionsUntouched(mode);
  });
  it("does not implicitly remove a template when changing assessment mode or requirement", async () => {
    await open(mode); await change(modeSelect(mode), "quiz"); await change(modeSelect(mode), "document_upload");
    const requirement = [...editor(mode).querySelectorAll("label")].find(item => item.textContent?.includes(mode === "admin" ? "Add an assessment" : "Require assessment"))!;
    await act(async () => (requirement.querySelector("button,input") as HTMLElement).click()); await flush();
    expect(editor(mode).textContent).not.toContain("Private assessment template (optional)");
    await act(async () => (requirement.querySelector("button,input") as HTMLElement).click()); await flush();
    expect(editor(mode).textContent).toContain(template.assessmentTemplateName);
    await click(button("Save lesson", editor(mode))); expect(saved()).toMatchObject(template);
    assertQuestionsUntouched(mode);
  });
  it("saves a quiz format switch with all-null template metadata while preserving other draft fields", async () => {
    await open(mode, resource);
    await change(modeSelect(mode), "quiz");
    await click(button("Save lesson", editor(mode)));
    expect(saved()).toMatchObject({ id: 14, assessmentMode: "quiz", ...noTemplate, ...resource,
      requiresAssessment: true, requiresAcknowledgement: true, assessmentPassMark: 85 });
    expect(mock.data["academy.admin.editor"].modules[0].lessons[0]).toMatchObject(template);
    assertQuestionsUntouched(mode);
  });
  it("keeps confirmed removal disabled on a pending save, and a rejected save keeps its template draft", async () => {
    await open(mode, resource);
    const release = defer(savePath); mock.reject[savePath] = "Synthetic save rejected";
    await click(button("Save lesson", editor(mode)));
    expect(button("Remove template", editor(mode)).disabled).toBe(true);
    await click(button("Remove template", editor(mode))); expect(confirm).not.toHaveBeenCalled();
    expect(saved()).toMatchObject(template); await release();
    expect(editor(mode).textContent).toContain(template.assessmentTemplateName);
    expect(button("Remove template", editor(mode)).disabled).toBe(false);
    assertQuestionsUntouched(mode);
  });
  it.each(["template", "attachment"])("freezes removal and same-tick save while %s file reading/uploading is pending", async kind => {
    await open(mode, resource);
    const path = kind === "template" ? templatePath : attachmentPath;
    const release = defer(path);
    const save = button("Save lesson", editor(mode)), remove = button("Remove template", editor(mode));
    await act(async () => {
      selectFile(kind === "template" ? templateInput(mode) : resourceInput(mode)); remove.click();
      if (mode === "staff") editor(mode).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      else save.click();
    }); await flush();
    expect(mock.calls).toEqual([]); expect(confirm).not.toHaveBeenCalled();
    expect(button("Remove template", editor(mode)).disabled).toBe(true);
    expect(templateInput(mode).disabled).toBe(true); expect(templateInput(mode).value).toBe("");
    await completeRead(); expect(mock.calls.map(call => call.path)).toEqual([path]);
    await click(button("Remove template", editor(mode))); expect(confirm).not.toHaveBeenCalled();
    expect(editor(mode).textContent).toContain(template.assessmentTemplateName);
    await release(); await click(button("Save lesson", editor(mode)));
    expect(saved()).toMatchObject({ ...resource, ...(kind === "template" ? {
      assessmentTemplateKey: "private-new-template", assessmentTemplateName: "New template.pdf",
      assessmentTemplateMimeType: "application/pdf", assessmentTemplateSize: 4096,
    } : { ...template, embedPdf: false }) });
    assertQuestionsUntouched(mode);
  });
  it.each(["read", "upload"])("retains all prior template metadata on a %s failure", async failure => {
    await open(mode, resource);
    if (failure === "upload") mock.reject[templatePath] = "Synthetic upload rejected";
    await fileSelection(templateInput(mode)); await completeRead(failure === "read");
    expect(templateInput(mode).disabled).toBe(false); expect(editor(mode).textContent).toContain(template.assessmentTemplateName);
    await click(button("Save lesson", editor(mode))); expect(saved()).toMatchObject({ ...template, ...resource });
    assertQuestionsUntouched(mode);
  });
  it("does not mistake an ordinary public resource PDF for an assessment template", async () => {
    await open(mode, { ...resource, ...noTemplate });
    expect(hasButton("Remove resource", editor(mode))).toBe(true); expect(hasButton("Remove template", editor(mode))).toBe(false);
    expect(editor(mode).textContent).toContain("no download is needed");
    await click(button("Save lesson", editor(mode))); expect(saved()).toMatchObject({ ...resource, ...noTemplate });
    assertQuestionsUntouched(mode);
  });
});

describe("Instructor template upload authority and draft protection", () => {
  beforeEach(() => window.history.replaceState(null, "", "/staff/instructor"));
  it.each(["read", "upload"])("does not mutate another draft on late template %s completion", async phase => {
    await open("staff", resource);
    const release = phase === "upload" ? defer(templatePath) : undefined;
    await fileSelection(templateInput("staff"));
    if (phase === "upload") await completeRead();
    await click(button("Another lesson"));
    expect(staffField("Lesson title").value).toBe("Another lesson");
    if (phase === "read") await completeRead(); else await release!();
    expect(container.textContent).not.toContain("New template.pdf");
    await click(button("Save lesson", editor("staff")));
    expect(saved()).toMatchObject({ id: 24, ...template, embedPdf: false });
    expect(mock.calls.filter(call => call.path === templatePath)).toHaveLength(phase === "read" ? 0 : 1);
    assertQuestionsUntouched("staff");
  });
  it.each(["read", "upload"])("does not write template metadata after authority is revoked during %s", async phase => {
    await open("staff", resource);
    const release = phase === "upload" ? defer(templatePath) : undefined;
    await fileSelection(templateInput("staff"));
    if (phase === "upload") await completeRead();
    mock.data["staffAccess.mine"] = { instructor: false, engagement: false, courseIds: [], schemaAvailable: true };
    await render("staff"); expect(container.querySelector("form")).toBeNull();
    if (phase === "read") await completeRead(); else await release!();
    expect(container.querySelector("form")).toBeNull(); expect(container.textContent).not.toContain("New template.pdf");
    expect(mock.calls.filter(call => call.path === templatePath)).toHaveLength(phase === "read" ? 0 : 1);
    expect(mock.calls.filter(call => call.path === savePath || call.path === questionsPath)).toEqual([]);
  });
});

describe("learner actual upload-only document assessment", () => {
  beforeEach(() => window.history.replaceState(null, "", "/academy/20"));
  it("shows only the upload task, lesson instructions and pass mark with no template action or placeholder", async () => {
    const data = await renderLearner();
    expect(container.textContent).toContain("Document assessment — upload your document");
    expect(container.textContent).toContain("Upload your document for staff marking. Follow the instructions in this lesson.");
    expect(container.textContent).toContain("The pass mark is 85%");
    expect(container.textContent).not.toContain("Download the template"); expect(container.textContent).not.toContain("Assessment template");
    expect(container.textContent).not.toContain("2. Upload"); expect(hasButton("Download template")).toBe(false);
    expect(uploadInput().disabled).toBe(false); expect(button("Submit document for marking").disabled).toBe(true);
    expect(mock.calls.filter(call => call.path === downloadPath)).toEqual([]); assertNoLearnerEvidence();
    expect(data.modules[0].lessons[0].progress).toBeNull();
  });
  it("retains templated download step 1 and upload step 2 and the same scoped download payload", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    await renderLearner({ ...template, hasAssessmentTemplate: true });
    expect(container.textContent).toContain("1. Download the template"); expect(container.textContent).toContain("2. Upload your completed document");
    await click(button("Download template"));
    expect(mock.calls).toContainEqual({ path: downloadPath, input: { enrollmentId: 20, lessonId: 14, origin: window.location.origin } });
    expect(assign).toHaveBeenCalledWith("https://portal.example.test/synthetic-download"); assertNoLearnerEvidence();
  });
  it("validates a real selected file and submits its original payload without requiring download or awarding completion", async () => {
    const data = await renderLearner();
    await fileSelection(uploadInput(), new File(["unsupported"], "unsafe.txt", { type: "text/plain" }));
    expect(mock.error).toHaveBeenCalledWith("Choose a PDF, Word document or Excel workbook");
    expect(button("Submit document for marking").disabled).toBe(true);
    const tooBig = new File(["synthetic"], "large.pdf", { type: "application/pdf" });
    Object.defineProperty(tooBig, "size", { value: 10 * 1024 * 1024 + 1 });
    await fileSelection(uploadInput(), tooBig); expect(mock.error).toHaveBeenCalledWith("Assessment documents must be under 10 MB");
    expect(button("Submit document for marking").disabled).toBe(true);
    const bytes = "%PDF-1.7\nSynthetic upload-only evidence";
    await fileSelection(uploadInput(), new File([bytes], "my-work.pdf", { type: "application/pdf" }));
    expect(container.textContent).toContain("my-work.pdf"); expect(button("Submit document for marking").disabled).toBe(false);
    const release = defer(submitPath); await click(button("Submit document for marking")); await completeRead();
    expect(mock.calls.filter(call => call.path === submitPath)).toEqual([{ path: submitPath, input: {
      enrollmentId: 20, lessonId: 14, fileName: "my-work.pdf", fileBase64: Buffer.from(bytes).toString("base64"), mimeType: "application/pdf",
    } }]);
    expect(uploadInput().disabled).toBe(true); expect(button("Submitting...").disabled).toBe(true);
    await release(); expect(button("Submit document for marking").disabled).toBe(true);
    expect(mock.calls.filter(call => [downloadPath, "academy.agent.submitAssessment", "academy.agent.completeLesson"].includes(call.path))).toEqual([]);
    expect(data.modules[0].lessons[0].progress).toBeNull();
  });
  it.each(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"])("keeps Office file selection support for %s", async mimeType => {
    await renderLearner(); await fileSelection(uploadInput(), new File(["Synthetic Office content"], mimeType.includes("wordprocessingml") ? "work.docx" : "work.xlsx", { type: mimeType }));
    expect(button("Submit document for marking").disabled).toBe(false); assertNoLearnerEvidence();
  });
  it.each([false, true])("disables %s-template preview uploads/downloads and creates no recorded submissions", async hasAssessmentTemplate => {
    await renderLearner({ hasAssessmentTemplate, ...(hasAssessmentTemplate ? template : {}) }, true);
    expect(uploadInput().disabled).toBe(true); await fileSelection(uploadInput());
    expect(button("Submit document for marking").disabled).toBe(true); await click(button("Submit document for marking"));
    if (hasAssessmentTemplate) { expect(button("Download template").disabled).toBe(true); await click(button("Download template")); }
    else expect(hasButton("Download template")).toBe(false);
    expect(ControlledReader.readers).toEqual([]); expect(mock.calls).toEqual([]);
  });
  it("preserves the waiting-for-marking state without any new upload/download or completion", async () => {
    await renderLearner({ attempts: [attempt({ status: "awaiting_marking", score: null, passed: null, graderFeedback: null })] });
    expect(container.textContent).toContain("Document submitted for marking");
    expect(container.textContent).toContain("cannot continue to the next lesson");
    expect(container.querySelector('input[type="file"]')).toBeNull(); expect(hasButton("Download template")).toBe(false);
    assertNoLearnerEvidence();
  });
  it.each([true, false])("preserves feedback and acknowledgement payload for passed=%s without automatic completion", async passed => {
    await renderLearner({ attempts: [attempt({ passed, score: passed ? 95 : 60 })] });
    expect(container.textContent).toContain("Your feedback needs acknowledgement"); expect(container.textContent).toContain("Good recorded evidence");
    expect(container.querySelector('input[type="file"]')).toBeNull(); expect(hasButton("Download template")).toBe(false);
    const release = defer(acknowledgePath); await click(button("I have read and acknowledge this feedback"));
    expect(button("Recording acknowledgement...").disabled).toBe(true);
    expect(mock.calls.filter(call => call.path === acknowledgePath)).toEqual([{ path: acknowledgePath, input: { attemptId: 100 } }]);
    await release(); expect(mock.calls.filter(call => call.path === "academy.agent.completeLesson")).toEqual([]);
  });
  it("offers upload again only after failed feedback was already acknowledged", async () => {
    await renderLearner({ attempts: [attempt({ passed: false, score: 60, feedbackAcknowledgedAt: completedAt })] });
    expect(container.textContent).not.toContain("Your feedback needs acknowledgement"); expect(uploadInput()).not.toBeNull();
    expect(hasButton("Download template")).toBe(false); assertNoLearnerEvidence();
  });
  it("keeps lesson acknowledgement controls and recorded acknowledgement states independent of the template", async () => {
    await renderLearner(); await click(button("I acknowledge this lesson"));
    expect(mock.calls).toContainEqual({ path: "academy.agent.acknowledgeLesson", input: { enrollmentId: 20, lessonId: 14 } });
    await renderLearner({ progress: { acknowledgedAt: completedAt } });
    expect(container.textContent).toContain("Acknowledged"); expect(hasButton("I acknowledge this lesson")).toBe(false);
    expect(uploadInput()).not.toBeNull(); assertNoLearnerEvidence();
  });
  it("reviews upload-only historic completion and recorded feedback without a template error, new work or status drift", async () => {
    const data = await renderLearner({ progress: { completedAt }, attempts: [attempt()] });
    expect(container.textContent).toContain("Upload-only document assessment — review"); expect(container.textContent).toContain("No template download is needed");
    expect(container.textContent).toContain("This lesson is already recorded as complete"); expect(container.textContent).toContain("Recorded assessment feedback · 95%");
    expect(container.textContent).toContain("Good recorded evidence"); expect(container.textContent).not.toContain("Contact the JLT team to add");
    expect(container.textContent).not.toContain("Your feedback needs acknowledgement"); expect(hasButton("Download template")).toBe(false);
    expect(container.querySelector('input[type="file"]')).toBeNull(); assertNoLearnerEvidence();
    expect(data.modules[0].lessons[0].progress.completedAt).toBe(completedAt);
  });
  it("retains a separate ordinary PDF resource while never fabricating an assessment template", async () => {
    await renderLearner(resource);
    expect(container.querySelector(`a[href="${resource.attachmentUrl}"]`)).not.toBeNull();
    expect(container.querySelector('iframe[title^="PDF"]')).not.toBeNull();
    expect(container.textContent).toContain("Upload your document for staff marking"); expect(hasButton("Download template")).toBe(false);
    expect(mock.calls.filter(call => call.path === downloadPath)).toEqual([]); assertNoLearnerEvidence();
  });
});
