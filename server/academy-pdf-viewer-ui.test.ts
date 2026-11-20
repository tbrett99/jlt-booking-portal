// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { academyPdfViewerUrl, isAcademyPdfResource } from "../shared/academy-pdf";
import { AcademyLessonResource } from "../client/src/components/AcademyLessonResource";

const mock = vi.hoisted(() => ({ data: null as any, preview: false, calls: [] as string[], fetch: vi.fn() }));
vi.mock("@/contexts/ViewModeContext", () => ({ useViewMode: () => ({ isAgentView: mock.preview }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => {
  const node = (path = ""): any => new Proxy({}, { get: (_target, key: string) => {
    if (key === "useUtils") return () => node("utils");
    if (key === "invalidate") return vi.fn();
    if (key === "useQuery") return () => ({ data: mock.data, isLoading: false, error: null });
    if (key === "useMutation") return () => ({ isPending: false, mutate: () => { mock.calls.push(path); } });
    return node(path ? `${path}.${key}` : key);
  } });
  return { trpc: node() };
});
import AcademyCourse from "../client/src/pages/academy/AcademyCourse";
const key = "academy/47/12345678-abcd-1234-abcd-123456789abc-guidance.pdf";
const publicUrl = `https://objects.example.test/${key}`;
const privateUrl = `https://portal.thejltgroup.co.uk/api/academy/course-attachment/${encodeURIComponent(key)}`;
const resource = { id: 14, title: "PDF lesson", attachmentKey: key, attachmentUrl: publicUrl, attachmentName: "Practical guidance", embedPdf: true };
function course(overrides: Record<string, unknown> = {}) {
  return {
    course: { id: 7, title: "Synthetic course", summary: "", isAcceleratorJourney: false },
    enrollment: { id: 20 }, progress: { percentage: 0, completedRequiredLessons: 0, requiredLessons: 1 },
    modules: [{ id: 9, title: "Synthetic module", releaseLocked: false, lessons: [{
      ...resource, moduleId: 9, summary: null, contentHtml: null, videoUrl: null, locked: false,
      isRequired: true, requiresAssessment: false, requiresAcknowledgement: false,
      assessmentMode: "quiz", assessmentPassMark: 90, progress: null, attempts: [], questions: [], ...overrides,
    }] }],
  };
}
let root: Root;
let container: HTMLDivElement;
let previousIframeSetting: boolean;
async function render(element = React.createElement(AcademyLessonResource, resource)) {
  await act(async () => root.render(element));
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mock.fetch);
  mock.fetch.mockImplementation(() => { throw new Error("Network forbidden in PDF DOM tests"); });
  mock.data = course(); mock.preview = false; mock.calls = [];
  previousIframeSetting = (window as any).happyDOM.settings.disableIframePageLoading;
  (window as any).happyDOM.settings.disableIframePageLoading = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  expect(mock.fetch).not.toHaveBeenCalled(); mock.fetch.mockReset();
  (window as any).happyDOM.settings.disableIframePageLoading = previousIframeSetting;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("narrow ordinary uploaded PDF viewer contract", () => {
  it("uses the uploaded key rather than the visible resource title", () => {
    expect(isAcademyPdfResource(resource)).toBe(true);
    expect(academyPdfViewerUrl(resource)).toBe(publicUrl);
    expect(isAcademyPdfResource({ ...resource, attachmentKey: key.replace(/pdf$/, "docx"), attachmentUrl: publicUrl.replace(/pdf$/, "docx") })).toBe(false);
  });
  it("binds private viewing to the current lesson on the current Portal origin", () => {
    expect(academyPdfViewerUrl({ ...resource, attachmentUrl: privateUrl })).toBe(`/api/academy/course-attachment/${encodeURIComponent(key)}?view=inline&lessonId=14`);
    expect(academyPdfViewerUrl({ ...resource, attachmentUrl: privateUrl, id: undefined })).toBeNull();
  });
  it.each([undefined, false, null, 1, "true"])("requires explicit boolean opt-in: %s", embedPdf => {
    expect(academyPdfViewerUrl({ ...resource, embedPdf } as any)).toBeNull();
  });
  it.each([
    "javascript:alert(1)", "data:application/pdf;base64,JVBERg==", "http://objects.example.test/file.pdf",
    `https://user:secret@objects.example.test/${key}`, `${publicUrl}?redirect=evil`, `${publicUrl}#html`,
    `https://objects.example.test/not-the-key.pdf`, `https://evil.example.test/api/academy/course-attachment/${encodeURIComponent(key)}`,
    "https://portal.thejltgroup.co.uk/api/academy/assessment-document/private-token",
    "https://portal.thejltgroup.co.uk/api/staff-handbook/attachment/private",
  ])("rejects arbitrary/unsafe embed source %s", attachmentUrl => {
    expect(academyPdfViewerUrl({ ...resource, attachmentUrl })).toBeNull();
  });
  it.each(["academy/templates/47/file.pdf", "academy/submissions/47/file.pdf", "staff-handbook/private.pdf", "untrusted.pdf"])("never treats non-teaching key %s as an embed", attachmentKey => {
    expect(academyPdfViewerUrl({ ...resource, attachmentKey, attachmentUrl: `https://objects.example.test/${attachmentKey}` })).toBeNull();
  });
});
describe("actual lesson resource and learner DOM", () => {
  it("shows an accessible responsive native PDF with an always-visible fallback", async () => {
    await render();
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(publicUrl);
    expect(frame.title).toBe("PDF: Practical guidance");
    expect(frame.className).toContain("w-full"); expect(frame.className).toContain("h-[65vh]");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    const link = container.querySelector("a")!;
    expect(link.textContent).toContain("Open or download PDF"); expect(link.href).toBe(publicUrl);
    expect(link.rel).toContain("noopener"); expect(container.textContent).toContain("If the PDF is blank");
  });
  it("retains a download-only resource for existing PDFs without opt-in and for non-PDFs", async () => {
    await render(React.createElement(AcademyLessonResource, { ...resource, embedPdf: false }));
    expect(container.querySelector("iframe")).toBeNull(); expect(container.textContent).toContain("Open or save your copy");
    await render(React.createElement(AcademyLessonResource, { ...resource, attachmentKey: key.replace(/pdf$/, "docx"), attachmentUrl: publicUrl.replace(/pdf$/, "docx"), attachmentName: "Misleading.pdf" }));
    expect(container.querySelector("iframe")).toBeNull(); expect(container.querySelector("a")!.href).toContain(".docx");
  });
  it("withholds locked or absent resources even if stale props carry a PDF URL", async () => {
    await render(React.createElement(AcademyLessonResource, { ...resource, locked: true }));
    expect(container.innerHTML).toBe("");
    await render(React.createElement(AcademyLessonResource, { ...resource, attachmentUrl: null }));
    expect(container.innerHTML).toBe("");
  });
  it("does not render unsafe legacy protocols even as fallback links", async () => {
    await render(React.createElement(AcademyLessonResource, { ...resource, attachmentUrl: "javascript:alert(1)" }));
    expect(container.innerHTML).toBe("");
  });
  it("uses truthful fallback on frame errors and resets it for another PDF", async () => {
    await render();
    await act(async () => container.querySelector("iframe")!.dispatchEvent(new Event("error", { bubbles: true })));
    expect(container.querySelector("iframe")).toBeNull(); expect(container.querySelector('[role="status"]')?.textContent).toContain("cannot display");
    expect(container.querySelector("a")!.textContent).toContain("Open or download PDF");
    await render(React.createElement(AcademyLessonResource, { ...resource, attachmentKey: key.replace("guidance", "other"), attachmentUrl: publicUrl.replace("guidance", "other") }));
    expect(container.querySelector("iframe")).not.toBeNull();
  });
  it("uses fallback instead of an iframe when the browser reports no PDF viewer", async () => {
    vi.stubGlobal("navigator", { pdfViewerEnabled: false });
    await render(); expect(container.querySelector("iframe")).toBeNull(); expect(container.textContent).toContain("cannot display");
  });
  it.each([false, true])("renders the same approved PDF in actual learner/preview page: preview=%s", async preview => {
    mock.preview = preview;
    await render(React.createElement(AcademyCourse, preview ? { previewCourseId: "7" } : { enrollmentId: "20" }));
    expect(container.querySelector("main iframe")?.getAttribute("src")).toBe(publicUrl);
    expect(container.textContent).toContain("Open or download PDF");
    expect(mock.calls.every(path => path.endsWith("viewLesson") || path.endsWith("recordActivity"))).toBe(true);
  });
  it("renders a private learner PDF through the row-bound inline route, not an assessment token", async () => {
    mock.data = course({ attachmentUrl: privateUrl });
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    expect(container.querySelector("main iframe")?.getAttribute("src")).toBe(`/api/academy/course-attachment/${encodeURIComponent(key)}?view=inline&lessonId=14`);
  });
  it("displays resource titles literally rather than executing HTML", async () => {
    await render(React.createElement(AcademyLessonResource, { ...resource, attachmentName: '<img src=x onerror="alert(1)">' }));
    expect(container.querySelector("img,script,object,embed")).toBeNull(); expect(container.textContent).toContain("<img src=x");
  });
});
