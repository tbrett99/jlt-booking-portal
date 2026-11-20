// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Render the real pages, controls and existing editors. Only auth and tRPC are synthetic.
const mock = vi.hoisted(() => ({
  data: {} as Record<string, any>, errors: {} as Record<string, any>,
  calls: [] as { path: string; input: any }[],
  queryOptions: {} as Record<string, any>, updatedAt: {} as Record<string, number>,
  mutationErrors: {} as Record<string, any>, mutationResults: {} as Record<string, any>,
  mutate: {} as Record<string, (input: any) => void>,
  refetch: vi.fn(), invalidate: vi.fn(),
  waitFor: {} as Record<string, Promise<void>>,
  agentView: false, user: { id: 9, role: "admin", name: "Synthetic admin", isActive: true, portalStatus: "active", mustChangePassword: false },
  fetch: vi.fn(), setViewMode: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: mock.user, loading: false, logout: vi.fn() }) }));
vi.mock("@/contexts/ViewModeContext", () => ({ useViewMode: () => ({ isAgentView: mock.agentView, isAdminView: !mock.agentView, setViewMode: mock.setViewMode }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/trpc", async () => {
  const react = await import("react");
  const node = (path = ""): any => new Proxy({}, {
    get: (_target, key: string) => {
      if (key === "useUtils") return () => node("utils");
      if (key === "invalidate") return (input: any) => mock.invalidate(path, input);
      if (key === "useQuery") return (_input: any, options: any) => {
        mock.queryOptions[path] = options;
        return { data: mock.data[path], error: mock.errors[path] ?? null, isLoading: false, isFetching: false, isRefetching: false, isSuccess: !mock.errors[path], dataUpdatedAt: mock.updatedAt[path] ?? 1, refetch: (options: any) => mock.refetch(path, options) };
      };
      if (key === "useMutation") return (options: any = {}) => {
        const [isPending, setPending] = react.useState(false);
        const mutateAsync = async (input: any) => {
          mock.calls.push({ path, input: structuredClone(input) });
          setPending(true);
          try {
            await mock.waitFor[path];
            if (mock.mutationErrors[path]) throw mock.mutationErrors[path];
            const result = mock.mutationResults[path] ?? { id: input.id ?? 80, success: true };
            await options.onSuccess?.(result, input);
            return result;
          } catch (error) {
            await options.onError?.(error, input);
            throw error;
          } finally { setPending(false); }
        };
        const mutate = (input: any) => { void mutateAsync(input).catch(() => undefined); };
        mock.mutate[path] = mutate;
        return { isPending, error: null, mutateAsync, mutate };
      };
      return node(path ? `${path}.${key}` : key);
    },
  });
  return { trpc: node() };
});
import AdminAcademy from "../admin/AdminAcademy";
import StaffWorkspace from "../staff/StaffWorkspace";
import AcademyHome from "./AcademyHome";
import AcademyCourse from "./AcademyCourse";
import { toast } from "sonner";

function editor(firstClass = true) {
  return {
    course: { id: 7, title: "Synthetic course", summary: "Public course summary", status: "published", coverImageUrl: null,
      estimatedMinutes: 20, isCoreAcademy: false, isAcceleratorJourney: false, isFirstClassTraining: firstClass,
      updatedAt: new Date("2026-11-01T12:00:00Z") },
    // Deliberately unsorted; equal sort orders use the module ID as the tie-breaker.
    modules: [
      { id: 29, courseId: 7, title: "Third module", summary: "", sortOrder: 3, releaseWeek: 0, lessons: [] },
      { id: 19, courseId: 7, title: "Second module", summary: "", sortOrder: 1, releaseWeek: 0, lessons: [] },
      { id: 9, courseId: 7, title: "First module", summary: "", sortOrder: 1, releaseWeek: 0, lessons: [] },
    ],
  };
}
function lesson(id: number, overrides: Record<string, any> = {}) {
  return { id, title: `Lesson ${id}`, summary: null, contentHtml: `<p>Private lesson material ${id}</p>`,
    videoUrl: null, attachmentUrl: null, questions: [], attempts: [], progress: null,
    requiresAcknowledgement: false, requiresAssessment: false, assessmentMode: "quiz", isRequired: true,
    locked: false, ...overrides };
}
function course() {
  return { course: { id: 7, title: "Private enrolled course title", summary: "Private enrolled summary", isFirstClassTraining: true, isAcceleratorJourney: false },
    enrollment: { id: 20, status: "active" }, progress: { percentage: 0, completedRequiredLessons: 0, requiredLessons: 2, isComplete: false },
    modules: [
      { id: 9, title: "Immediate module", releaseWeek: 0, releaseLocked: false, releaseLabel: "20 Nov 2026", lessons: [lesson(11)] },
      { id: 19, title: "Scheduled module", releaseWeek: 0, releaseLocked: true, releaseLabel: "27 Nov 2026", lessons: [lesson(21, { locked: true, lockedReason: "Available 27 Nov 2026", contentHtml: null })] },
    ],
  };
}
function enrolment(status = "active") {
  return { id: 20, status, course: { id: 7, title: "Enrolled First Class training", summary: "My learning", status: "published", isFirstClassTraining: true },
    nextLesson: status === "active" ? { id: 11, title: "Immediate lesson" } : null,
    progress: { percentage: status === "active" ? 50 : 100, requiredLessons: 2, completedRequiredLessons: status === "active" ? 1 : 2 },
    dueDate: null, completedAt: new Date("2026-11-20T12:00:00Z"), isOverdue: false, nextReleaseLabel: "27 Nov 2026" };
}
function home(catalogue: any[] = []) {
  return { hasAccess: true, enrolments: [], upcomingSessions: [], firstClassCourses: catalogue };
}
function catalogue(accessState = "upgrade_required") {
  return { id: 8, title: "Public First Class catalogue course", summary: "Published course introduction", coverImageUrl: null, accessState };
}
function question(id = 31, overrides: Record<string, any> = {}) {
  return { id, prompt: `Written question ${id}`, questionType: "free_text", answerOptions: [], maxWords: 250, allowPaste: true,
    resit: { passed: false, attemptCount: 1, supportRequired: false }, ...overrides };
}
function oldFeedback(overrides: Record<string, any> = {}) {
  return { id: 80, status: "feedback_pending", score: 45, passed: false, graderFeedback: "Preserved staff feedback", feedbackAcknowledgedAt: null,
    takenAt: new Date("2026-10-01T12:00:00Z"), responses: [{ questionId: 31, responseText: "Preserved written answer", score: 45, feedback: "Preserved question feedback" }], ...overrides };
}
let root: Root;
let container: HTMLDivElement;
let previousIframeSetting: boolean;
async function render(element: React.ReactNode = React.createElement(AdminAcademy)) {
  await act(async () => root.render(element));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
}
async function click(control: HTMLButtonElement) { expect(control).toBeTruthy(); await act(async () => control.click()); }
function button(text: string) {
  const controls = [...container.querySelectorAll<HTMLButtonElement>("button")].filter(item => item.textContent?.trim() === text);
  expect(controls, text).toHaveLength(1); return controls[0]!;
}
function mode(label: string) { return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!; }
function moduleHeader(id: number) { return container.querySelector<HTMLButtonElement>(`button[aria-controls="academy-module-${id}"]`)!; }
async function change(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
function saved() { return mock.calls.filter(item => item.path === "academy.admin.saveCourse"); }

beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mock.fetch);
  mock.fetch.mockImplementation(() => { throw new Error("Network forbidden in offline First Class UI tests"); });
  previousIframeSetting = (window as any).happyDOM.settings.disableIframePageLoading;
  (window as any).happyDOM.settings.disableIframePageLoading = true;
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mock.agentView = false; mock.user.role = "admin"; mock.calls = []; mock.errors = {}; mock.waitFor = {};
  mock.queryOptions = {}; mock.updatedAt = {}; mock.mutationErrors = {}; mock.mutationResults = {}; mock.mutate = {};
  mock.refetch.mockImplementation(async () => undefined); mock.invalidate.mockResolvedValue(undefined);
  mock.data = { "academy.admin.courses": [{ id: 7, title: "Synthetic course", status: "published", completionCount: 0, enrolmentCount: 1 }],
    "academy.admin.editor": editor(), "academy.admin.emailAlerts": [], "academy.admin.emailAlertActivity": [],
    "academy.agent.home": home(), "academy.agent.course": course(), "agentDevelopment.actions.mine": [],
    "staffAccess.mine": { instructor: true, engagement: false, courseIds: [7], schemaAvailable: true } };
  window.history.replaceState({}, "", "/admin/academy");
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  expect(mock.fetch).not.toHaveBeenCalled();
  (window as any).happyDOM.settings.disableIframePageLoading = previousIframeSetting;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("First Class Academy administration on actual DOM", () => {
  it("hydrates the saved designation and persists it on an ordinary course save", async () => {
    await render();
    expect(mode("First Class training").getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain("First Class members only. First module available at enrolment, then one module every seven days.");
    await click(button("Save course"));
    expect(saved()[0]?.input).toMatchObject({ id: 7, isFirstClassTraining: true, isCoreAcademy: false, isAcceleratorJourney: false });
  });
  it("defaults old courses without a designation to false and permits toggling and saving", async () => {
    delete mock.data["academy.admin.editor"].course.isFirstClassTraining;
    await render(); expect(mode("First Class training").getAttribute("aria-checked")).toBe("false");
    await click(mode("First Class training")); await click(button("Save course"));
    expect(saved()[0]?.input.isFirstClassTraining).toBe(true);
  });
  it("disables First Class explicitly when the full admin chooses core or Accelerator", async () => {
    await render(); await click(mode("Core JLT Academy pathway"));
    expect(mode("First Class training").getAttribute("aria-checked")).toBe("false");
    await click(button("Save course"));
    expect(saved()[0]?.input).toMatchObject({ isFirstClassTraining: false, isCoreAcademy: true, isAcceleratorJourney: false });
    await click(mode("Agent Accelerator journey")); await click(button("Save course"));
    expect(saved()[1]?.input).toMatchObject({ isFirstClassTraining: false, isCoreAcademy: false, isAcceleratorJourney: true });
    await click(mode("First Class training")); await click(button("Save course"));
    expect(saved()[2]?.input).toMatchObject({ isFirstClassTraining: true, isCoreAcademy: false, isAcceleratorJourney: false });
  });
  it("allows switching off First Class and tracks a designation-only unsaved draft", async () => {
    await render(); await click(mode("First Class training"));
    const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await click(button("Save course")); expect(saved()[0]?.input.isFirstClassTraining).toBe(false);
  });
  it("freezes all designation controls while saving and prevents another button save", async () => {
    await render(); let resolve!: () => void;
    mock.waitFor["academy.admin.saveCourse"] = new Promise<void>(done => { resolve = done; });
    await click(button("Save course"));
    for (const label of ["First Class training", "Core JLT Academy pathway", "Agent Accelerator journey"]) expect(mode(label).disabled).toBe(true);
    expect(button("Saving...").disabled).toBe(true);
    await click(button("Saving...")); expect(saved()).toHaveLength(1);
    await act(async () => resolve()); expect(mode("First Class training").disabled).toBe(false);
  });
  it("numbers the actual sortOrder/id module order by week and uses that order for reordering", async () => {
    await render();
    const headers = [...container.querySelectorAll<HTMLButtonElement>('button[aria-controls^="academy-module-"]')];
    expect(headers.map(item => item.getAttribute("aria-controls"))).toEqual(["academy-module-9", "academy-module-19", "academy-module-29"]);
    expect(moduleHeader(9).textContent).toContain("Week 1 · available at enrolment");
    expect(moduleHeader(19).textContent).toContain("Week 2 · weekly release");
    expect(moduleHeader(29).textContent).toContain("Week 3 · weekly release");
    expect(container.textContent).toContain("Reordering modules changes their weekly release order");
    await click(moduleHeader(9).closest("section")!.querySelector<HTMLButtonElement>('button[title="Move module down"]')!);
    expect(mock.calls.find(item => item.path === "academy.admin.reorderModules")?.input.moduleIds).toEqual([19, 9, 29]);
  });
  it("never enables an Accelerator week selector for a saved or newly toggled First Class course", async () => {
    mock.data["academy.admin.editor"].course.isFirstClassTraining = false;
    mock.data["academy.admin.editor"].course.isAcceleratorJourney = true;
    await render(); expect(container.querySelector('[aria-label="Accelerator release week"]')).toBeTruthy();
    await click(mode("First Class training"));
    expect(container.querySelector('[aria-label="Accelerator release week"]')).toBeNull();
    await click(moduleHeader(9).closest("section")!.querySelector<HTMLButtonElement>('button[title="Edit module name or summary"]')!);
    expect(container.querySelector('[aria-label="Module release week"]')).toBeNull();
  });
  it("keeps assigned instructors out of designation controls and omits the flag when saving teaching details", async () => {
    mock.user.role = "agent"; window.history.replaceState({}, "", "/staff/instructor");
    await render(React.createElement(StaffWorkspace));
    for (let attempt = 0; attempt < 20 && !container.querySelector("select"); attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    }
    await change(container.querySelector<HTMLSelectElement>("select")!, "7");
    await render(React.createElement(StaffWorkspace));
    expect(mode("First Class training")).toBeNull();
    const title = [...container.querySelectorAll("label")].find(item => item.querySelector("span")?.textContent === "Course title")!.querySelector<HTMLInputElement>("input")!;
    await change(title, "Updated assigned teaching"); await click(button("Save course details"));
    expect(saved()[0]?.input).toMatchObject({ id: 7, title: "Updated assigned teaching", isCoreAcademy: false, isAcceleratorJourney: false });
    expect(saved()[0]?.input).not.toHaveProperty("isFirstClassTraining");
    expect(mock.data["academy.admin.editor"].course.isFirstClassTraining).toBe(true);
  });
});

describe("First Class catalogue and enrolments on actual DOM", () => {
  it("renders minimal locked catalogue data with an accessible badge and upgrade mailto only", async () => {
    mock.data["academy.agent.home"] = home([catalogue()]); await render(React.createElement(AcademyHome));
    const card = container.querySelector('[aria-label="First Class training catalogue"] article')!;
    expect(card.textContent).toContain("First Class members only");
    expect(card.textContent).toContain("First Class training is included with First Class memberships. Contact support to upgrade.");
    expect([...card.querySelectorAll("a")].map(item => item.getAttribute("href"))).toEqual(["mailto:support@thejltgroup.co.uk"]);
    expect(card.querySelector("button")).toBeNull();
    expect(container.querySelector('a[href^="/academy/course/"]')).toBeNull();
    expect(container.querySelector('a[href^="/academy/preview/course/"]')).toBeNull();
  });
  it("directs nonenrolled members to enrolment support without upgrade wording", async () => {
    mock.data["academy.agent.home"] = home([catalogue("not_enrolled")]); await render(React.createElement(AcademyHome));
    const card = container.querySelector('[aria-label="First Class training catalogue"] article')!;
    expect(card.textContent).toContain("Contact support for enrolment"); expect(card.textContent).not.toContain("upgrade");
    expect(card.querySelector("a")!.getAttribute("href")).toBe("mailto:support@thejltgroup.co.uk");
  });
  it("can show the catalogue without ordinary Academy access and tolerates an absent optional array", async () => {
    mock.data["academy.agent.home"] = { ...home([catalogue()]), hasAccess: false };
    await render(React.createElement(AcademyHome)); expect(container.querySelector('[aria-label="First Class training catalogue"]')).toBeTruthy();
    delete mock.data["academy.agent.home"].firstClassCourses; await render(React.createElement(AcademyHome));
    expect(container.querySelector('[aria-label="First Class training catalogue"]')).toBeNull();
  });
  it("retains enrolled First Class continue links and displays the next backend release label", async () => {
    mock.data["academy.agent.home"] = { ...home(), enrolments: [enrolment()] }; await render(React.createElement(AcademyHome));
    expect(container.querySelector('a[href="/academy/course/20"]')).toBeTruthy();
    expect(container.textContent).toContain("Next module available 27 Nov 2026");
  });
  it.each(["completed", "waived"])("retains eligible %s enrolments as recap links", async status => {
    mock.data["academy.agent.home"] = { ...home(), enrolments: [enrolment(status)] }; await render(React.createElement(AcademyHome));
    expect(container.querySelector('a[aria-label="Revisit course: Enrolled First Class training"]')?.getAttribute("href")).toBe("/academy/course/20");
    expect(container.textContent).toContain("Revisit the course content");
  });
  it("withholds cached enrolled and catalogue titles after any home-query failure", async () => {
    mock.data["academy.agent.home"] = { ...home([catalogue()]), enrolments: [enrolment()] }; await render(React.createElement(AcademyHome));
    mock.errors["academy.agent.home"] = { message: "Membership changed", data: { code: "FORBIDDEN" } }; await render(React.createElement(AcademyHome));
    expect(container.textContent).not.toContain("Enrolled First Class training");
    expect(container.textContent).not.toContain("Public First Class catalogue course");
    expect(container.querySelector('a[href^="/academy/course/"]')).toBeNull();
  });
  it("keeps full-admin preview course links instead of enrolment links", async () => {
    mock.agentView = true; mock.data["academy.agent.previewHome"] = { ...home(), enrolments: [enrolment()] };
    await render(React.createElement(AcademyHome));
    expect(container.querySelector('a[href="/academy/preview/course/7"]')).toBeTruthy();
    expect(container.querySelector('a[href="/academy/course/20"]')).toBeNull();
  });
});

describe("First Class releases and cache denial on actual course DOM", () => {
  it("shows Week 1 immediately and the backend Week 2 date, keeping locked lessons disabled", async () => {
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    const first = container.querySelector<HTMLButtonElement>('button[aria-controls="academy-course-module-9"]')!;
    const second = container.querySelector<HTMLButtonElement>('button[aria-controls="academy-course-module-19"]')!;
    expect(first.textContent).toContain("Week 1"); expect(first.textContent).toContain("Available now");
    expect(second.textContent).toContain("Week 2"); expect(second.textContent).toContain("Available 27 Nov 2026");
    await click(second);
    const locked = container.querySelector<HTMLButtonElement>("#academy-course-module-19 button")!;
    expect(locked.disabled).toBe(true); expect(locked.getAttribute("aria-disabled")).toBe("true");
    await click(locked); expect(container.textContent).toContain("Private lesson material 11");
    expect(container.textContent).not.toContain("Private lesson material 21");
  });
  it.each(["FORBIDDEN", "INTERNAL_SERVER_ERROR"])("withholds all cached content and activity when a refresh returns %s", async code => {
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    expect(container.textContent).toContain("Private lesson material 11");
    mock.calls = []; mock.errors["academy.agent.course"] = { message: code === "FORBIDDEN" ? "First Class membership is required" : "Synthetic unavailable", data: { code } };
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    for (const text of ["Private enrolled course title", "Private enrolled summary", "Private lesson material", "Immediate module", "Scheduled module"]) expect(container.textContent).not.toContain(text);
    expect(container.querySelector("main")).toBeNull(); expect(container.querySelector("iframe")).toBeNull();
    expect(mock.calls).toEqual([]);
    if (code === "FORBIDDEN") {
      expect(container.textContent).toContain("Contact support to upgrade");
      expect(container.querySelector('a[href="mailto:support@thejltgroup.co.uk"]')).toBeTruthy();
    }
  });
  it("withholds a selected lesson that becomes locked during a successful access refresh", async () => {
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    mock.data["academy.agent.course"].modules[0].lessons[0].locked = true;
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    expect(container.textContent).not.toContain("Private lesson material 11");
  });
  it("retains the read-only lesson recap when eligible completion is already recorded", async () => {
    mock.data["academy.agent.course"].modules[0].lessons[0].progress = { completedAt: new Date("2026-11-20T12:00:00Z") };
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    expect(container.textContent).toContain("Private lesson material 11"); expect(container.textContent).toContain("Completed");
    expect([...container.querySelectorAll("button")].some(item => item.textContent === "Mark lesson complete")).toBe(false);
  });
  it("keeps full-admin preview usable with no learner activity mutation", async () => {
    mock.agentView = true; mock.data["academy.agent.previewCourse"] = course();
    mock.data["academy.agent.previewCourse"].modules[1].releaseLocked = false;
    mock.data["academy.agent.previewCourse"].modules[1].lessons[0] = lesson(21);
    await render(React.createElement(AcademyCourse, { previewCourseId: "7" }));
    expect(container.textContent).toContain("Academy preview:"); expect(container.textContent).toContain("Private lesson material 11");
    expect(mock.calls).toEqual([]);
  });
});

describe("First Class read-only course recaps", () => {
  it.each(["completed", "waived"])("keeps every returned lesson readable for %s with missing progress and old pending feedback", async status => {
    const data = mock.data["academy.agent.course"];
    data.enrollment.status = status;
    data.modules[0].lessons = [lesson(11, { requiresAcknowledgement: true, requiresAssessment: true, questions: [question()], attempts: [oldFeedback()] }),
      lesson(12, { requiresAcknowledgement: true, requiresAssessment: true, assessmentMode: "document_upload", hasAssessmentTemplate: true, assessmentTemplateName: "Preserved template.docx", attempts: [oldFeedback()] })];
    data.modules[1].releaseLocked = false;
    data.modules[1].lessons = [lesson(21, { requiresAcknowledgement: true, attachmentUrl: "https://resources.example.test/guide.pdf", attachmentName: "Recap guide.pdf" })];
    const preserved = structuredClone(data);
    const intervals = vi.spyOn(window, "setInterval");
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    expect(container.textContent).toContain("Read-only course recap");
    expect(container.textContent).toContain("Preserved staff feedback");
    expect(container.textContent).toContain("Preserved written answer");
    expect(container.textContent).toContain("Preserved question feedback");
    expect(container.textContent).not.toContain("This lesson is already recorded as complete");
    expect(container.textContent).not.toContain("Your feedback needs acknowledgement");
    expect(container.textContent).not.toContain("In progress");
    expect(container.textContent).toContain("0 / 2 required");
    expect(container.querySelector("textarea, input[type=radio], input[type=file]")).toBeNull();
    expect(mock.calls).toEqual([]);
    const documentLesson = [...container.querySelectorAll<HTMLButtonElement>("#academy-course-module-9 button")].find(item => item.textContent?.includes("Lesson 12"))!;
    expect(documentLesson.disabled).toBe(false);
    await click(documentLesson);
    expect(container.textContent).toContain("Private lesson material 12");
    expect(container.textContent).toContain("Preserved template.docx");
    expect(button("Download template").disabled).toBe(false);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    mock.mutationResults["academy.agent.getDocumentAssessmentTemplate"] = { url: "/synthetic-template" };
    await click(button("Download template"));
    await click(container.querySelector<HTMLButtonElement>('button[aria-controls="academy-course-module-19"]')!);
    const laterLesson = container.querySelector<HTMLButtonElement>("#academy-course-module-19 button")!;
    expect(laterLesson.disabled).toBe(false);
    await click(laterLesson);
    expect(container.textContent).toContain("Private lesson material 21");
    expect(container.querySelector('a[href="https://resources.example.test/guide.pdf"]')).toBeTruthy();
    expect(container.querySelector("textarea, input[type=radio], input[type=file]")).toBeNull();
    expect([...container.querySelectorAll("button")].some(item => /acknowledge|submit|complete lesson|retry knowledge check/i.test(item.textContent ?? ""))).toBe(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(intervals.mock.calls.some(call => call[1] === 30_000)).toBe(false);
    expect(mock.calls.map(item => item.path)).toEqual(["academy.agent.getDocumentAssessmentTemplate"]);
    expect(data).toEqual(preserved);
  });
  it("reuses completed assessment review only for a genuinely recorded lesson completion", async () => {
    mock.data["academy.agent.course"].enrollment.status = "waived";
    mock.data["academy.agent.course"].modules[0].lessons[0] = lesson(11, { progress: { completedAt: new Date("2026-11-01T12:00:00Z") }, requiresAssessment: true, questions: [question()], attempts: [oldFeedback()] });
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    expect(container.querySelector('[aria-label="Completed assessment review"]')).toBeTruthy();
    expect(container.textContent).toContain("Preserved written answer");
    expect(container.textContent).toContain("Preserved staff feedback");
    expect(mock.calls).toEqual([]);
  });
  it.each([true, false])("does not bypass active/non-First-Class operational feedback locks (First Class %s)", async firstClass => {
    const data = mock.data["academy.agent.course"];
    data.course.isFirstClassTraining = firstClass;
    data.enrollment.status = firstClass ? "active" : "waived";
    data.modules[0].lessons[0] = lesson(11, { requiresAssessment: true, questions: [question()], attempts: [oldFeedback()] });
    data.modules[1].releaseLocked = false; data.modules[1].lessons[0] = lesson(21);
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    expect(container.textContent).toContain("Your feedback needs acknowledgement");
    expect(button("I have read and acknowledge this feedback").disabled).toBe(false);
    await click(container.querySelector<HTMLButtonElement>('button[aria-controls="academy-course-module-19"]')!);
    expect(container.querySelector<HTMLButtonElement>("#academy-course-module-19 button")!.disabled).toBe(true);
  });
});

describe("Learner access freshness without global cache changes", () => {
  it("opts learner home/course into always-focus and bounded visible-window polling only", async () => {
    await render(React.createElement(AcademyHome));
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    for (const path of ["academy.agent.home", "academy.agent.course"]) expect(mock.queryOptions[path]).toMatchObject({ enabled: true, refetchOnWindowFocus: "always", refetchInterval: 60_000, refetchIntervalInBackground: false });
    for (const path of ["academy.agent.previewHome", "academy.agent.previewCourse"]) {
      expect(mock.queryOptions[path]).not.toHaveProperty("refetchOnWindowFocus");
      expect(mock.queryOptions[path]).not.toHaveProperty("refetchInterval");
    }
    mock.agentView = true; mock.data["academy.agent.previewHome"] = home(); mock.data["academy.agent.previewCourse"] = course();
    await render(React.createElement(AcademyHome));
    expect(mock.queryOptions["academy.agent.home"].enabled).toBe(false);
    await render(React.createElement(AcademyCourse, { previewCourseId: "7" }));
    expect(mock.queryOptions["academy.agent.course"].enabled).toBe(false);
    expect(mock.queryOptions["academy.agent.previewCourse"]).toEqual({ enabled: true });
    expect(mock.queryOptions["academy.agent.previewHome"]).toEqual({ enabled: true });
  });
  it.each(["FORBIDDEN", "UNAUTHORIZED"])("withholds old successful data and stops activity after an actual completion mutation returns %s", async code => {
    let tick!: () => void;
    vi.spyOn(window, "setInterval").mockImplementation(((callback: () => void, milliseconds: number) => {
      if (milliseconds === 30_000) tick = callback;
      return 123;
    }) as any);
    const clear = vi.spyOn(window, "clearInterval");
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    expect(tick).toBeTypeOf("function");
    expect(container.textContent).toContain("Private lesson material 11");
    const old = mock.data["academy.agent.course"];
    let finish!: (result: any) => void;
    mock.refetch.mockImplementation(() => {
      // This runs synchronously in onError, before React commits denial.
      tick(); document.dispatchEvent(new Event("visibilitychange"));
      return new Promise(resolve => { finish = resolve; });
    });
    mock.calls = [];
    mock.mutationErrors["academy.agent.completeLesson"] = { message: "Membership changed", data: { code } };
    await click(button("Complete lesson"));
    expect(container.querySelector("main, iframe, textarea")).toBeNull();
    expect(container.textContent).toContain("Course access unavailable");
    expect(container.textContent).not.toContain("Private enrolled course title");
    expect(container.textContent).not.toContain("Private lesson material");
    expect(mock.calls.map(item => item.path)).toEqual(["academy.agent.completeLesson"]);
    expect(clear).toHaveBeenCalledWith(123);
    expect(mock.refetch).toHaveBeenCalledTimes(1);
    expect(mock.refetch).toHaveBeenCalledWith("academy.agent.course", { cancelRefetch: true });
    await click(button("Retry access check"));
    expect(mock.refetch).toHaveBeenCalledTimes(1);
    await act(async () => mock.mutate["academy.agent.recordActivity"]!({ enrollmentId: 20, lessonId: 11 }));
    expect(mock.refetch).toHaveBeenCalledTimes(1);
    // Cached-success flags and the same object are not authorization evidence.
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    await act(async () => finish({ data: old, isSuccess: true, error: null, dataUpdatedAt: 1 }));
    expect(container.querySelector("main")).toBeNull();
    expect(mock.refetch).toHaveBeenCalledTimes(1);
    // Even a new object/new timestamp in the cache alone cannot reset the latch.
    mock.data["academy.agent.course"] = structuredClone(old); mock.updatedAt["academy.agent.course"] = 2;
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    expect(container.querySelector("main")).toBeNull();
    mock.refetch.mockResolvedValue({ data: mock.data["academy.agent.course"], isSuccess: false, error: { message: "Still denied" }, dataUpdatedAt: 2 });
    await click(button("Retry access check"));
    expect(container.querySelector("main")).toBeNull();
    // Structural sharing may preserve object identity after a real successful fetch.
    mock.data["academy.agent.course"] = old; mock.updatedAt["academy.agent.course"] = 3;
    mock.refetch.mockResolvedValue({ data: old, isSuccess: true, error: null, dataUpdatedAt: 3 });
    await click(button("Retry access check"));
    expect(container.textContent).toContain("Private lesson material 11");
    expect(mock.refetch).toHaveBeenCalledTimes(3);
    expect(mock.invalidate).not.toHaveBeenCalled();
    mock.calls = [];
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(mock.calls.map(item => item.path)).toEqual(["academy.agent.recordActivity"]);
  });
  it.each(["viewLesson", "recordActivity", "acknowledgeLesson", "submitAssessment", "getDocumentAssessmentTemplate", "submitDocumentAssessment", "acknowledgeAssessmentFeedback"])("latches denial from the actual %s mutation onError rather than a query error", async mutation => {
    if (mutation === "viewLesson") mock.mutationErrors[`academy.agent.${mutation}`] = { message: "Access revoked", data: { code: "FORBIDDEN" } };
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    if (mutation !== "viewLesson") {
      expect(container.querySelector("main")).toBeTruthy();
      mock.mutationErrors[`academy.agent.${mutation}`] = { message: "Access revoked", data: { code: "UNAUTHORIZED" } };
      await act(async () => mock.mutate[`academy.agent.${mutation}`]!({ enrollmentId: 20, lessonId: 11, attemptId: 80 }));
    }
    expect(mock.errors["academy.agent.course"]).toBeUndefined();
    expect(mock.data["academy.agent.course"]).toBeTruthy();
    expect(container.querySelector("main")).toBeNull();
    expect(container.textContent).toContain("Course access unavailable");
    expect(mock.refetch).toHaveBeenCalledTimes(1);
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    expect(container.querySelector("main")).toBeNull();
    expect(mock.refetch).toHaveBeenCalledTimes(1);
  });
  it("preserves pasted/typed targeted-resit answers and the existing refresh toast for non-auth submission errors", async () => {
    const data = mock.data["academy.agent.course"];
    data.modules[0].lessons[0] = lesson(11, { requiresAssessment: true, questions: [question(30, { resit: { passed: true, attemptCount: 1, supportRequired: false } }), question()] });
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    const answer = container.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    await act(async () => answer.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(false);
    await change(answer, "Preserve my revised answer");
    mock.mutationErrors["academy.agent.submitAssessment"] = { message: "Please answer each outstanding question before submitting", data: { code: "BAD_REQUEST" } };
    await click(button("Submit outstanding answers for marking"));
    expect(answer.value).toBe("Preserve my revised answer");
    expect(container.querySelector("main")).toBeTruthy();
    expect(container.textContent).toContain("1 question is already complete");
    expect(mock.calls.find(item => item.path === "academy.agent.submitAssessment")?.input.answers).toEqual([{ questionId: 31, responseText: "Preserve my revised answer" }]);
    expect(toast.error).toHaveBeenCalledWith("Your question list has been refreshed. Please check the outstanding questions and submit again.");
    expect(mock.refetch).not.toHaveBeenCalled();
    expect(mock.invalidate).toHaveBeenCalledWith("utils.academy.agent.course", { enrollmentId: 20 });
  });
  it("keeps generic submission-error toast and typed resit state without denying content or triggering access checks", async () => {
    mock.data["academy.agent.course"].modules[0].lessons[0] = lesson(11, { requiresAssessment: true, questions: [question()] });
    await render(React.createElement(AcademyCourse, { enrollmentId: "20" }));
    await change(container.querySelector<HTMLTextAreaElement>("textarea")!, "Keep this draft response");
    mock.mutationErrors["academy.agent.submitAssessment"] = { message: "Temporary marking issue", data: { code: "INTERNAL_SERVER_ERROR" } };
    await click(button("Submit outstanding answers for marking"));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Keep this draft response");
    expect(container.textContent).toContain("Attempt 2 of 3");
    expect(container.textContent).toContain("Private lesson material 11");
    expect(toast.error).toHaveBeenCalledWith("Temporary marking issue");
    expect(mock.refetch).not.toHaveBeenCalled();
    expect(mock.invalidate).not.toHaveBeenCalled();
  });
});
