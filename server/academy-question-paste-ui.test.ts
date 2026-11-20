// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Canonical Academy DOM transport mocks (completed-assessment, lesson-archive,
// staff-instructor-formatting). All records are synthetic; the actual pages,
// textarea/checkbox controls, staff authority boundary and rich editors render.
const mock = vi.hoisted(() => ({
  data: {} as Record<string, any>,
  calls: [] as { path: string; input: any }[],
  isAgentView: false,
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: 9,
      role: "agent",
      name: "Synthetic instructor",
      isActive: true,
      portalStatus: "active",
      mustChangePassword: false,
    },
    loading: false,
    logout: vi.fn(),
  }),
}));
vi.mock("@/contexts/ViewModeContext", () => ({
  useViewMode: () => ({
    isAgentView: mock.isAgentView,
    isAdminView: !mock.isAgentView,
    setViewMode: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({
  toast: {
    error: mock.error,
    success: mock.success,
    info: mock.info,
    warning: mock.warning,
  },
}));
vi.mock("@/lib/trpc", async () => {
  const react = await import("react");
  const node = (path = ""): any =>
    new Proxy(
      {},
      {
        get: (_target, key: string) => {
          if (key === "useUtils") return () => node("utils");
          if (key === "invalidate") return vi.fn(async () => undefined);
          if (key === "useQuery")
            return () => ({
              data: mock.data[path],
              isLoading: false,
              isFetching: false,
              isRefetching: false,
              dataUpdatedAt: 1,
              error: null,
              refetch: vi.fn(async () => undefined),
            });
          if (key === "useMutation")
            return (options: any = {}) => {
              const [isPending, setPending] = react.useState(false);
              const mutateAsync = async (input: any) => {
                mock.calls.push({ path, input: structuredClone(input) });
                setPending(true);
                try {
                  await Promise.resolve();
                  const result = { id: input.id ?? 14, success: true };
                  await options.onSuccess?.(result, input);
                  return result;
                } finally {
                  setPending(false);
                }
              };
              return {
                isPending,
                error: null,
                reset: vi.fn(),
                mutateAsync,
                mutate: (input: any) => {
                  void mutateAsync(input);
                },
              };
            };
          return node(path ? `${path}.${key}` : key);
        },
      }
    );
  return { trpc: node() };
});
import AcademyCourse from "../client/src/pages/academy/AcademyCourse";
import AdminAcademy from "../client/src/pages/admin/AdminAcademy";
import StaffWorkspace from "../client/src/pages/staff/StaffWorkspace";

const blockedMessage = "Pasting is disabled for written Academy answers.";
const dropMessage = "Dropping text is disabled for written Academy answers.";
const submitPath = "academy.agent.submitAssessment";
const replacePath = "academy.admin.replaceQuestions";
const completedAt = new Date("2026-10-01T12:00:00Z");
const markup =
  '<img src="https://clipboard.example.test/tracker" onerror="alert(1)"><script>alert(1)</script><a href="https://clipboard.example.test/link">remote link</a>';
function questions() {
  return [
    {
      id: 31,
      prompt: "Explain the checks in your own words.",
      questionType: "free_text",
      answerOptions: [],
      correctAnswerIndex: 0,
      maxWords: 10,
      explanation: "Private first guide",
      allowPaste: false,
      resit: { passed: false, attemptCount: 0, supportRequired: false },
    },
    {
      id: 32,
      prompt: "Provide a reference link and explanation.",
      questionType: "free_text",
      answerOptions: [],
      correctAnswerIndex: 0,
      maxWords: 10,
      explanation: "Private second guide",
      allowPaste: true,
      resit: { passed: false, attemptCount: 0, supportRequired: false },
    },
    {
      id: 33,
      prompt: "Which check is correct?",
      questionType: "multiple_choice",
      answerOptions: ["Check the details", "Skip all checks"],
      correctAnswerIndex: 0,
      maxWords: 250,
      explanation: "Private MC guide",
      allowPaste: false,
      resit: { passed: false, attemptCount: 0, supportRequired: false },
    },
  ];
}
function lesson(overrides: Record<string, unknown> = {}) {
  return {
    id: 14,
    moduleId: 9,
    title: "Synthetic paste lesson",
    summary: null,
    contentHtml: "<p>Synthetic guidance only.</p>",
    videoUrl: null,
    videoTranscript: null,
    attachmentUrl: null,
    attachmentKey: null,
    attachmentName: null,
    estimatedMinutes: 5,
    requiresAcknowledgement: false,
    requiresAssessment: true,
    assessmentMode: "quiz",
    assessmentTemplateName: null,
    hasAssessmentTemplate: false,
    assessmentPassMark: 90,
    isRequired: true,
    locked: false,
    lockedReason: "",
    progress: null,
    attempts: [],
    questions: questions(),
    ...overrides,
  };
}
function courseData(currentLesson = lesson()) {
  return {
    course: {
      id: 7,
      title: "Synthetic paste course",
      summary: "",
      status: "draft",
      estimatedMinutes: 20,
      isCoreAcademy: false,
      isAcceleratorJourney: false,
      coverImageUrl: null,
    },
    enrollment: { id: 20 },
    progress: {
      percentage: 0,
      completedRequiredLessons: 0,
      requiredLessons: 1,
      isComplete: false,
    },
    modules: [
      {
        id: 9,
        courseId: 7,
        title: "Synthetic paste module",
        summary: null,
        releaseWeek: 0,
        releaseLocked: false,
        releaseLabel: null,
        lessons: [currentLesson],
      },
    ],
  };
}
let root: Root;
let container: HTMLDivElement;
let previousSettings: {
  disableIframePageLoading: boolean;
  enableFileSystemHttpRequests: boolean;
};
async function render(element: React.ReactElement) {
  await act(async () => {
    root.render(element);
  });
}
async function renderLearner(currentLesson = lesson(), preview = false) {
  mock.data["academy.agent.course"] = courseData(currentLesson);
  mock.data["academy.agent.previewCourse"] = mock.data["academy.agent.course"];
  mock.isAgentView = preview;
  await render(
    React.createElement(
      AcademyCourse,
      preview ? { previewCourseId: "7" } : { enrollmentId: "20" }
    )
  );
}
function button(text: string, scope: ParentNode = container) {
  const matches = [
    ...scope.querySelectorAll<HTMLButtonElement>("button"),
  ].filter(el => el.textContent?.trim() === text);
  expect(matches, `actual button '${text}'`).toHaveLength(1);
  return matches[0]!;
}
async function click(control: HTMLElement) {
  await act(async () => {
    control.click();
  });
}
async function change(
  element: HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement,
  value: string
) {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  // Native setter bypasses React's value tracker; the dispatched input exercises
  // the real onChange handler, rather than poking component state or JSX props.
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value
    );
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      })
    );
    if (!(element instanceof HTMLSelectElement))
      element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function learnerCards() {
  return [...container.querySelectorAll<HTMLFieldSetElement>("fieldset")];
}
function textarea(index: number) {
  const control =
    learnerCards()[index]?.querySelector<HTMLTextAreaElement>("textarea");
  expect(control, `actual answer textarea ${index + 1}`).toBeTruthy();
  return control!;
}
async function clipboard(
  element: HTMLElement,
  type: "paste" | "drop" = "paste"
) {
  const transfer = new DataTransfer();
  transfer.setData(
    "text/plain",
    "https://clipboard.example.test/reference pasted words"
  );
  transfer.setData("text/html", markup);
  transfer.items.add(
    new File(["synthetic"], "clipboard.txt", { type: "text/plain" })
  );
  const event =
    type === "paste"
      ? new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        })
      : new Event("drop", { bubbles: true, cancelable: true });
  if (type === "drop")
    Object.defineProperty(event, "dataTransfer", { value: transfer });
  let accepted = true;
  await act(async () => {
    accepted = element.dispatchEvent(event);
  });
  return { event, accepted };
}
function submissions() {
  return mock.calls.filter(call => call.path === submitPath);
}
function replacements() {
  return mock.calls.filter(call => call.path === replacePath);
}
async function completeAnswers() {
  await change(textarea(0), "First typed answer");
  await change(
    textarea(1),
    "https://clipboard.example.test/reference useful evidence"
  );
  await click(
    container.querySelector<HTMLInputElement>('input[name="question-33"]')!
  );
}
function editorCard(index: number, instructor: boolean) {
  const heading = [...container.querySelectorAll(instructor ? "h4" : "p")].find(
    el => el.textContent?.trim() === `Question ${index + 1}`
  );
  expect(heading, `actual editor question ${index + 1}`).toBeTruthy();
  return heading!.parentElement!.parentElement!;
}
function pasteToggle(index: number, instructor: boolean) {
  // Radix renders a hidden input mirror inside forms; only count the actual
  // accessible control, not both representations of the same checkbox.
  const controls = [
    ...editorCard(index, instructor).querySelectorAll<HTMLElement>(
      'input[type="checkbox"]:not([aria-hidden="true"]), [role="checkbox"], [role="switch"]'
    ),
  ];
  expect(controls, `written question ${index + 1} paste toggle`).toHaveLength(
    1
  );
  return controls[0]!;
}
function checked(control: HTMLElement) {
  return control instanceof HTMLInputElement
    ? control.checked
    : control.getAttribute("aria-checked") === "true";
}
function labelledSelect(label: string) {
  const item = [...container.querySelectorAll("label")].find(
    el => el.querySelector("span")?.textContent === label
  );
  const control = item?.querySelector<HTMLSelectElement>("select");
  expect(control, `labelled select '${label}'`).toBeTruthy();
  return control!;
}
async function openEditor(instructor: boolean) {
  if (instructor) {
    window.history.replaceState(null, "", "/staff/instructor");
    await render(React.createElement(StaffWorkspace));
    // Flush the lazily loaded actual instructor page without any remote request.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    await change(labelledSelect("Assigned course"), "7");
    await click(button("Synthetic paste lesson"));
  } else {
    window.history.replaceState(null, "", "/admin/academy");
    await render(React.createElement(AdminAcademy));
    const moduleHeader = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="academy-module-9"]'
    );
    expect(moduleHeader).toBeTruthy();
    if (moduleHeader!.getAttribute("aria-expanded") !== "true")
      await click(moduleHeader!);
    const edit = container.querySelector<HTMLButtonElement>(
      'button[title="Edit lesson name and content"]'
    );
    expect(edit).toBeTruthy();
    await click(edit!);
  }
}
async function saveQuestions(instructor: boolean) {
  await click(button(instructor ? "Save questions" : "Save lesson"));
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.fetch.mockImplementation(() => {
    throw new Error(
      "External network is forbidden in offline Academy paste tests"
    );
  });
  vi.stubGlobal("fetch", mock.fetch);
  const settings = (window as any).happyDOM.settings;
  previousSettings = {
    disableIframePageLoading: settings.disableIframePageLoading,
    enableFileSystemHttpRequests: settings.enableFileSystemHttpRequests,
  };
  settings.disableIframePageLoading = true;
  settings.enableFileSystemHttpRequests = false;
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mock.isAgentView = false;
  mock.calls = [];
  const data = courseData();
  mock.data = {
    "academy.admin.courses": [
      { ...data.course, completionCount: 0, enrolmentCount: 0 },
    ],
    "academy.admin.editor": data,
    "academy.admin.emailAlerts": [],
    "academy.admin.emailAlertActivity": [],
    "staffAccess.mine": {
      instructor: true,
      engagement: false,
      courseIds: [7],
      schemaAvailable: true,
    },
  };
  await import("../client/src/pages/staff/StaffInstructor");
  window.history.replaceState(null, "", "/academy/course/20");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Object.assign((window as any).happyDOM.settings, previousSettings);
  expect(
    mock.fetch,
    "no remote fetching for pasted URLs, markup or files"
  ).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Academy learner question-specific paste permissions on the actual DOM", () => {
  it.each([false, undefined])(
    "cancels paste and retains the existing toast when allowPaste is %s",
    async allowPaste => {
      const list = questions();
      if (allowPaste === undefined) delete (list[0] as any).allowPaste;
      else list[0].allowPaste = allowPaste;
      await renderLearner(lesson({ questions: list }));
      await change(textarea(0), "Existing typed answer");
      const { event, accepted } = await clipboard(textarea(0));
      expect(event.defaultPrevented).toBe(true);
      expect(accepted).toBe(false);
      expect(mock.error).toHaveBeenCalledTimes(1);
      expect(mock.error).toHaveBeenCalledWith(blockedMessage);
      expect(textarea(0).value).toBe("Existing typed answer");
      expect(textarea(1).value).toBe("");
      expect(submissions()).toEqual([]);
    }
  );
  it("allows true without cancellation, HTML insertion, eager fetch or state/submission shortcuts", async () => {
    await renderLearner();
    const { event, accepted } = await clipboard(textarea(1));
    expect(event.defaultPrevented).toBe(false);
    expect(accepted).toBe(true);
    expect(mock.error).not.toHaveBeenCalled();
    // happy-dom does not emulate native clipboard insertion: the event must not
    // synthesize rich DOM/state. The following tests supply native input separately.
    expect(textarea(1).value).toBe("");
    expect(
      container.querySelector(
        'script, img, iframe, a[href*="clipboard.example.test"]'
      )
    ).toBeNull();
    expect(button("Submit outstanding answers for marking").disabled).toBe(
      true
    );
    expect(submissions()).toEqual([]);
  });
  it("shows accurate per-question placeholder/counter hints and leaves multiple choice alone", async () => {
    await renderLearner();
    expect(textarea(0).placeholder).toMatch(/past(?:e|ing).*disabled/i);
    expect(learnerCards()[0].textContent).toContain("Paste disabled");
    expect(textarea(1).placeholder).not.toMatch(/past(?:e|ing).*disabled/i);
    expect(learnerCards()[1].textContent).toMatch(
      /past(?:e|ing).*(?:allowed|enabled)/i
    );
    expect(learnerCards()[1].textContent).not.toContain("Paste disabled");
    expect(learnerCards()[2].querySelector("textarea")).toBeNull();
    expect(
      learnerCards()[2].querySelectorAll('input[type="radio"]')
    ).toHaveLength(2);
    expect(learnerCards()[2].textContent).not.toMatch(
      /paste (?:allowed|enabled|disabled)/i
    );
  });
  it.each([0, 1])(
    "still cancels drops for written question index %s regardless of paste permission",
    async index => {
      await renderLearner();
      const { event, accepted } = await clipboard(textarea(index), "drop");
      expect(event.defaultPrevented).toBe(true);
      expect(accepted).toBe(false);
      expect(mock.error).toHaveBeenCalledTimes(1);
      expect(mock.error).toHaveBeenCalledWith(dropMessage);
      expect(textarea(index).value).toBe("");
      expect(submissions()).toEqual([]);
    }
  );
  it("routes allowed plain text through normal onChange, counters, answer completeness and ID-scoped submission", async () => {
    await renderLearner();
    await clipboard(textarea(1));
    await change(
      textarea(1),
      "https://clipboard.example.test/reference useful evidence"
    );
    expect(textarea(1).value).toBe(
      "https://clipboard.example.test/reference useful evidence"
    );
    expect(learnerCards()[1].textContent).toContain("3 / 10 words");
    expect(textarea(0).value).toBe("");
    expect(button("Submit outstanding answers for marking").disabled).toBe(
      true
    );
    await change(textarea(0), "First typed answer");
    expect(button("Submit outstanding answers for marking").disabled).toBe(
      true
    );
    await click(
      container.querySelector<HTMLInputElement>('input[name="question-33"]')!
    );
    expect(button("Submit outstanding answers for marking").disabled).toBe(
      false
    );
    await click(button("Submit outstanding answers for marking"));
    expect(submissions()).toEqual([
      {
        path: submitPath,
        input: {
          enrollmentId: 20,
          lessonId: 14,
          answers: [
            { questionId: 31, responseText: "First typed answer" },
            {
              questionId: 32,
              responseText:
                "https://clipboard.example.test/reference useful evidence",
            },
            { questionId: 33, selectedIndex: 0 },
          ],
        },
      },
    ]);
    expect(
      container.querySelector('a[href*="clipboard.example.test"]')
    ).toBeNull();
  });
  it("treats markup arriving through normal textarea input as plain evidence, never rendered HTML", async () => {
    const list = questions();
    list[1].maxWords = 250;
    await renderLearner(lesson({ questions: list }));
    expect((await clipboard(textarea(1))).event.defaultPrevented).toBe(false);
    await change(textarea(1), markup);
    expect(textarea(1).value).toBe(markup);
    expect(
      container.querySelector(
        'script, img, iframe, [onerror], a[href*="clipboard.example.test"]'
      )
    ).toBeNull();
    await change(textarea(0), "First typed answer");
    await click(
      container.querySelector<HTMLInputElement>('input[name="question-33"]')!
    );
    await click(button("Submit outstanding answers for marking"));
    expect(
      submissions()[0].input.answers.find(
        (answer: any) => answer.questionId === 32
      ).responseText
    ).toBe(markup);
  });
  it.each([0, 1])(
    "cannot bypass the word limit through normal input on written question index %s",
    async index => {
      await renderLearner();
      await change(textarea(index), "Short valid answer");
      if (index === 1)
        expect((await clipboard(textarea(index))).event.defaultPrevented).toBe(
          false
        );
      await change(
        textarea(index),
        "one two three four five six seven eight nine ten eleven"
      );
      expect(mock.error).toHaveBeenCalledWith(
        "This answer is limited to 10 words."
      );
      expect(learnerCards()[index].textContent).toContain("3 / 10 words");
      // Controlled DOM retains the prior valid state, including outgoing evidence.
      expect(textarea(index).value).toBe("Short valid answer");
      await change(textarea(index === 0 ? 1 : 0), "Other valid answer");
      await click(
        container.querySelector<HTMLInputElement>('input[name="question-33"]')!
      );
      await click(button("Submit outstanding answers for marking"));
      expect(
        submissions()[0].input.answers.find(
          (answer: any) => answer.questionId === 31 + index
        ).responseText
      ).toBe("Short valid answer");
    }
  );
  it("preserves targeted-resit filtering and submits only outstanding questions", async () => {
    const list = questions();
    list[0].resit.passed = true;
    list[2].resit.passed = true;
    list[1].resit.attemptCount = 1;
    await renderLearner(lesson({ questions: list }));
    expect(learnerCards()).toHaveLength(1);
    expect(container.textContent).toContain(
      "2 questions are already complete."
    );
    expect(container.textContent).toContain("Attempt 2 of 3");
    expect(container.textContent).not.toContain(list[0].prompt);
    expect((await clipboard(textarea(0))).event.defaultPrevented).toBe(false);
    await change(textarea(0), "Revised reference answer");
    await click(button("Submit outstanding answers for marking"));
    expect(submissions()).toEqual([
      {
        path: submitPath,
        input: {
          enrollmentId: 20,
          lessonId: 14,
          answers: [
            { questionId: 32, responseText: "Revised reference answer" },
          ],
        },
      },
    ]);
  });
  it("does not reopen passed or support-locked questions because paste is permitted", async () => {
    const list = questions();
    list.forEach(question => {
      question.resit.supportRequired = true;
    });
    await renderLearner(lesson({ questions: list }));
    expect(container.textContent).toContain("JLT team support required");
    expect(container.querySelector("textarea")).toBeNull();
    expect(submissions()).toEqual([]);
  });
  it("keeps preview interactive but records no answers, views or learning activity", async () => {
    await renderLearner(lesson(), true);
    expect((await clipboard(textarea(0))).event.defaultPrevented).toBe(true);
    expect((await clipboard(textarea(1))).event.defaultPrevented).toBe(false);
    await completeAnswers();
    await click(button("Preview submission (not recorded)"));
    expect(mock.info).toHaveBeenCalledWith(
      "Preview only — no assessment answer or learning record was created."
    );
    expect(mock.calls).toEqual([]);
  });
  it("keeps a completed assessment read-only even when a question permits paste", async () => {
    await renderLearner(lesson({ progress: { completedAt } }));
    expect(container.textContent).toContain("Knowledge check — review");
    expect(container.textContent).toContain(questions()[1].prompt);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('input[type="radio"]')).toBeNull();
    expect(submissions()).toEqual([]);
  });
});

for (const instructor of [false, true])
  describe(`${instructor ? "Assigned instructor" : "Academy manager"} actual paste-policy editor`, () => {
    it("hydrates separate false/true written policies, hides the MC toggle, and makes no mount-time write", async () => {
      await openEditor(instructor);
      expect(checked(pasteToggle(0, instructor))).toBe(false);
      expect(checked(pasteToggle(1, instructor))).toBe(true);
      expect(
        editorCard(2, instructor).querySelector(
          'input[type="checkbox"], [role="checkbox"], [role="switch"]'
        )
      ).toBeNull();
      expect(mock.calls).toEqual([]);
      expect(editorCard(1, instructor).textContent).not.toMatch(
        /paste and drag\/drop are\s+disabled/i
      );
    });
    it("persists a toggle-only true change including IDs, without leaking into the other questions", async () => {
      await openEditor(instructor);
      await click(pasteToggle(0, instructor));
      expect(checked(pasteToggle(0, instructor))).toBe(true);
      expect(checked(pasteToggle(1, instructor))).toBe(true);
      await saveQuestions(instructor);
      expect(replacements()).toHaveLength(1);
      expect(replacements()[0].input).toMatchObject({
        lessonId: 14,
        questions: [
          { id: 31, allowPaste: true },
          { id: 32, allowPaste: true },
          { id: 33, allowPaste: false },
        ],
      });
      expect(
        mock.data["academy.admin.editor"].modules[0].lessons[0].questions[0]
          .allowPaste
      ).toBe(false);
    });
    it("restores false explicitly in the outgoing payload without leaking to an adjacent question", async () => {
      await openEditor(instructor);
      await click(pasteToggle(1, instructor));
      expect(checked(pasteToggle(1, instructor))).toBe(false);
      expect(checked(pasteToggle(0, instructor))).toBe(false);
      await saveQuestions(instructor);
      expect(replacements()).toHaveLength(1);
      expect(replacements()[0].input).toMatchObject({
        lessonId: 14,
        questions: [
          { id: 31, allowPaste: false },
          { id: 32, allowPaste: false },
          { id: 33, allowPaste: false },
        ],
      });
    });
    it("hydrates a legacy missing flag as false and defaults a new written question to false", async () => {
      delete mock.data["academy.admin.editor"].modules[0].lessons[0]
        .questions[0].allowPaste;
      await openEditor(instructor);
      expect(checked(pasteToggle(0, instructor))).toBe(false);
      await click(button(instructor ? "Add question" : "Question"));
      const type = instructor
        ? labelledSelect("Question 4 type")
        : container.querySelector<HTMLSelectElement>(
            'select[aria-label="Question 4 type"]'
          )!;
      await change(type, "free_text");
      expect(checked(pasteToggle(3, instructor))).toBe(false);
      expect(checked(pasteToggle(1, instructor))).toBe(true);
      expect(mock.calls).toEqual([]);
      const label = instructor ? "Question 4 prompt" : "Written question 4";
      const prompt = container.querySelector<HTMLElement>(
        `.ProseMirror[aria-label="${label}"]`
      );
      expect(prompt, "actual new-question rich editor").toBeTruthy();
      // Canonical question-editability tests use TipTap's attached actual editor
      // to type; the rich editor's real onChange updates the surrounding form.
      await act(async () => {
        (prompt as any).editor.commands.insertContent("New written question");
      });
      await saveQuestions(instructor);
      expect(replacements()).toHaveLength(1);
      expect(replacements()[0].input).toMatchObject({
        lessonId: 14,
        questions: [
          { id: 31, allowPaste: false },
          { id: 32, allowPaste: true },
          { id: 33, allowPaste: false },
          {
            prompt: "New written question",
            questionType: "free_text",
            allowPaste: false,
          },
        ],
      });
      expect(replacements()[0].input.questions[3].id).toBeUndefined();
    });
  });

describe("Academy retained source contracts", () => {
  it("retains the legacy paste-block message and drop safeguard while policy is question-scoped", () => {
    const source = readFileSync(
      resolve(process.cwd(), "client/src/pages/academy/AcademyCourse.tsx"),
      "utf8"
    );
    expect(source).toContain(blockedMessage);
    expect(source).toContain(dropMessage);
    expect(source).toContain("question.allowPaste");
    // Keep this message assertion source-based because the canonical legacy
    // static suite checks source wording; behavior is exercised on the DOM above.
    expect(source).toContain("onDrop={(event) => { event.preventDefault();");
  });
});
