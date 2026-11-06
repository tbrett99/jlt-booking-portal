// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// All records are synthetic. Keep the actual workspace, forms and TipTap editors:
// a mocked rich editor would not catch lost formatting or CRM hook initialization.
const mock = vi.hoisted(() => ({
  user: {
    id: 9,
    role: "agent",
    name: "Assigned Instructor",
    isActive: true,
    portalStatus: "active",
    mustChangePassword: false,
  } as any,
  data: {} as Record<string, any>,
  errors: {} as Record<string, any>,
  hooks: [] as {
    kind: "query" | "mutation";
    path: string;
    enabled?: boolean;
    input?: unknown;
  }[],
  mutations: [] as { path: string; input: any }[],
  operations: [] as string[],
  reject: {} as Record<string, string>,
  waitFor: {} as Record<string, Promise<void>>,
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: mock.user, loading: false, logout: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", async () => {
  const react = await import("react");
  const proxy = (parts: string[] = []): any =>
    new Proxy(() => undefined, {
      get: (_target, property: string) => {
        if (property === "useQuery")
          return (input: unknown, options: { enabled?: boolean } = {}) => {
            const path = parts.join(".");
            mock.hooks.push({
              kind: "query",
              path,
              enabled: options.enabled !== false,
              input,
            });
            return {
              data: mock.data[path],
              error: mock.errors[path] ?? null,
              isLoading: false,
              isFetching: false,
              refetch: vi.fn(async () => {
                mock.operations.push(`${path}.refetch`);
              }),
            };
          };
        if (property === "useMutation")
          return (options: any = {}) => {
            const path = parts.join(".");
            mock.hooks.push({ kind: "mutation", path });
            const [error, setError] = react.useState<any>(null);
            const [isPending, setPending] = react.useState(false);
            const mutateAsync = async (input: any) => {
              mock.mutations.push({ path, input: structuredClone(input) });
              setPending(true);
              try {
                await mock.waitFor[path];
                if (mock.reject[path]) throw new Error(mock.reject[path]);
                const result = { id: input.id ?? 31, success: true };
                await options.onSuccess?.(result);
                return result;
              } catch (failure) {
                setError(failure);
                options.onError?.(failure);
                throw failure;
              } finally {
                setPending(false);
              }
            };
            return {
              isPending,
              error,
              reset: () => setError(null),
              mutateAsync,
              mutate: (input: unknown) => {
                void mutateAsync(input).catch(() => undefined);
              },
            };
          };
        if (property === "useUtils") return () => proxy(["utils"]);
        if (property === "invalidate")
          return vi.fn(async () => {
            mock.operations.push(`${parts.join(".")}.invalidate`);
          });
        return proxy([...parts, property]);
      },
    });
  return { trpc: proxy() };
});

import StaffWorkspace from "../client/src/pages/staff/StaffWorkspace";
import {
  lessonHtmlToPlainText,
  plainTextToLessonHtml,
} from "../client/src/components/RichEmailEditor";

const richLessonHtml =
  "<h2>Travel Safety</h2><p><strong>Check the facts</strong> and <u>verify details</u>.</p>" +
  "<ul><li><p>Confirm the destination</p></li><li><p>Check the traveller</p></li></ul>" +
  "<ol><li><p>Read the guidance</p></li><li><p>Record the checks</p></li></ol>" +
  "<table><tbody><tr><th>Check</th><th>Evidence</th></tr><tr><td>Passport</td><td>Valid document</td></tr></tbody></table>";
const originalQuestion = {
  id: 41,
  prompt:
    "## Before You Travel\n\nChoose the **safe approach**.\n\n- Check facts\n- Confirm details",
  questionType: "multiple_choice",
  answerOptions: ["Check facts", "Skip checks"],
  correctAnswerIndex: 0,
  maxWords: 250,
  explanation:
    "## Private Guide\n\nReward **accurate checks** and *clear reasoning*.\n\n1. Identify risks\n2. Verify evidence",
};
function syntheticEditor() {
  return {
    course: {
      id: 7,
      title: "Assigned safety course",
      summary: "Course summary stays plain text.",
      status: "draft",
      coverImageUrl: null,
      estimatedMinutes: 45,
      isCoreAcademy: false,
      isAcceleratorJourney: false,
    },
    modules: [
      {
        id: 9,
        courseId: 7,
        title: "Preparation module",
        summary: "Module summary stays plain text.",
        releaseWeek: 0,
        lessons: [
          {
            id: 14,
            moduleId: 9,
            title: "Safety lesson",
            summary: "Lesson summary stays plain text.",
            contentHtml: richLessonHtml,
            videoUrl: "https://www.youtube.com/watch?v=AbCdEfGhI12",
            videoTranscript: "Private transcript remains unchanged.",
            attachmentUrl: "https://files.example.test/safety-resource.pdf",
            attachmentKey: "academy/course-7/safety-resource.pdf",
            attachmentName: "Safety resource.pdf",
            estimatedMinutes: 12,
            isRequired: true,
            requiresAcknowledgement: true,
            requiresAssessment: true,
            assessmentMode: "quiz",
            assessmentPassMark: 85,
            assessmentTemplateKey: "academy/course-7/existing-template.pdf",
            assessmentTemplateName: "Existing template.pdf",
            assessmentTemplateMimeType: "application/pdf",
            assessmentTemplateSize: 1024,
            questions: [structuredClone(originalQuestion)],
          },
        ],
      },
    ],
  };
}

let container: HTMLDivElement;
let root: Root;
let previousIframeSetting: boolean;
let previousImageSetting: boolean;

async function flush() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 25));
  });
}
async function render() {
  await act(async () => {
    root.render(React.createElement(StaffWorkspace));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  await flush();
}
function button(text: string, scope: ParentNode = container) {
  const control = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    item => item.textContent?.trim() === text
  );
  expect(control, `button '${text}'`).toBeTruthy();
  return control!;
}
async function click(text: string, scope: ParentNode = container) {
  await act(async () => button(text, scope).click());
  await flush();
}
function labelledField(label: string) {
  const item = [...container.querySelectorAll("label")].find(
    entry => entry.querySelector("span")?.textContent === label
  );
  expect(item, `field '${label}'`).toBeTruthy();
  return item!;
}
function field(label: string) {
  const control = labelledField(label).querySelector<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >("input, select, textarea");
  expect(control, `plain field '${label}'`).toBeTruthy();
  return control!;
}
async function change(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string
) {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
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
  await flush();
}
function richField(label: string) {
  const element = container.querySelector<HTMLElement>(
    `.ProseMirror[aria-label="${label}"]`
  );
  expect(element, `actual TipTap editor '${label}'`).toBeTruthy();
  return element!;
}
function actualEditor(element: HTMLElement): Editor {
  // TipTap attaches its actual Editor instance to its view DOM. Use it only to
  // arrange selection; edits go through the rendered toolbar or clipboard event.
  const editor = (element as HTMLElement & { editor?: Editor }).editor;
  expect(editor, "real TipTap Editor attached to DOM").toBeTruthy();
  return editor!;
}
async function paste(element: HTMLElement, html: string, text = "") {
  const clipboardData = new DataTransfer();
  if (html) clipboardData.setData("text/html", html);
  if (text) clipboardData.setData("text/plain", text);
  await act(async () => {
    actualEditor(element).commands.selectAll();
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await flush();
}
async function toolbar(element: HTMLElement, title: string) {
  const scope =
    element.closest('[aria-label="Lesson content editor"]') ??
    labelledField(element.getAttribute("aria-label")!);
  const control = scope.querySelector<HTMLButtonElement>(
    `button[title="${title}"]`
  );
  expect(control, `actual toolbar '${title}'`).toBeTruthy();
  expect(control!.type).toBe("button");
  await act(async () => control!.click());
  await flush();
}
async function openLesson() {
  await render();
  await change(field("Assigned course"), "7");
  await click("Safety lesson");
  return richField("Lesson content");
}
function savedLesson(
  contentHtml: string,
  overrides: Record<string, unknown> = {}
) {
  const { questions: _questions, ...lesson } =
    mock.data["academy.admin.editor"].modules[0].lessons[0];
  return { ...lesson, contentHtml, ...overrides };
}
function assertFormatting(element: ParentNode) {
  expect(element.querySelector("h2")?.textContent).toBe("Travel Safety");
  expect(element.querySelector("strong")?.textContent).toBe("Check the facts");
  expect(element.querySelector("u")?.textContent).toBe("verify details");
  expect(element.querySelectorAll("ul li")).toHaveLength(2);
  expect(element.querySelectorAll("ol li")).toHaveLength(2);
  expect(element.querySelectorAll("table tr")).toHaveLength(2);
  expect(element.querySelector("th")?.textContent).toBe("Check");
  expect(element.querySelector("td")?.textContent).toBe("Passport");
}
function assertNoCrmOrUnrelatedWork() {
  // Inspect hook instantiation, not just enabled queries or executed writes.
  const paths = [
    ...mock.hooks.map(hook => hook.path),
    ...mock.mutations.map(mutation => mutation.path),
    ...mock.operations,
  ];
  expect(
    paths.filter(path =>
      /crm|users\.|dashboard|insights|finance|emailBranding/i.test(path)
    )
  ).toEqual([]);
  expect(
    mock.mutations.filter(
      mutation =>
        ![
          "academy.admin.saveLesson",
          "academy.admin.replaceQuestions",
        ].includes(mutation.path)
    )
  ).toEqual([]);
  expect(mock.user).toMatchObject({
    id: 9,
    role: "agent",
    portalStatus: "active",
  });
}

beforeEach(async () => {
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const settings = (window as any).happyDOM.settings;
  previousIframeSetting = settings.disableIframePageLoading;
  previousImageSetting = settings.enableFileSystemHttpRequests;
  settings.disableIframePageLoading = true;
  settings.enableFileSystemHttpRequests = false;
  // happy-dom does not load ordinary <img> resources; prohibit explicit fetches
  // as well, and disable iframe loading before mounting any actual page content.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network is forbidden in synthetic instructor tests");
    })
  );
  const rect = () => new DOMRect(0, 0, 800, 20);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(rect);
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(
    () => [rect()] as any
  );
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: rect,
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [rect()],
  });
  await import("../client/src/pages/staff/StaffInstructor");
  mock.user = {
    id: 9,
    role: "agent",
    name: "Assigned Instructor",
    isActive: true,
    portalStatus: "active",
    mustChangePassword: false,
  };
  mock.data = {
    "staffAccess.mine": {
      instructor: true,
      engagement: false,
      courseIds: [7],
      schemaAvailable: true,
    },
    "academy.admin.courses": [
      { id: 7, title: "Assigned safety course", status: "draft" },
      { id: 12, title: "Unassigned private course", status: "published" },
    ],
    "academy.admin.editor": syntheticEditor(),
  };
  mock.errors = {};
  mock.hooks = [];
  mock.mutations = [];
  mock.operations = [];
  mock.reject = {};
  mock.waitFor = {};
  window.history.replaceState(null, "", "/staff/instructor");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  const settings = (window as any).happyDOM.settings;
  settings.disableIframePageLoading = previousIframeSetting;
  settings.enableFileSystemHttpRequests = previousImageSetting;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("assigned instructor rich formatting on the actual staff page", () => {
  it("requires explicit assigned-course selection, renders rich lesson HTML, and leaves summaries plaintext", async () => {
    await render();
    expect(window.location.pathname).toBe("/staff/instructor");
    expect(container.textContent).toContain("Assigned safety course");
    expect(container.textContent).not.toContain("Unassigned private course");
    expect(field("Assigned course").value).toBe("");
    expect(mock.hooks.some(hook => hook.path === "academy.admin.editor")).toBe(
      false
    );
    await change(field("Assigned course"), "7");
    expect(field("Course summary")).toBeInstanceOf(HTMLTextAreaElement);
    await click("Preparation module");
    expect(field("Module summary")).toBeInstanceOf(HTMLTextAreaElement);
    await click("Safety lesson");
    assertFormatting(richField("Lesson content"));
    expect(field("Lesson summary")).toBeInstanceOf(HTMLTextAreaElement);
    expect(field("Lesson summary").value).toBe(
      "Lesson summary stays plain text."
    );
    expect(container.querySelector("textarea.font-mono")).toBeNull();
    expect(
      container.querySelector('textarea[aria-label="Lesson content"]')
    ).toBeNull();
    expect(
      mock.hooks.filter(
        hook => hook.kind === "query" && hook.path === "academy.admin.editor"
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ enabled: true, input: { courseId: 7 } }),
      ])
    );
    expect(mock.mutations).toEqual([]);
    expect(mock.operations).toEqual([]);
    assertNoCrmOrUnrelatedWork();
  });

  it("preserves semantic clipboard formatting and saves only lesson 14 in module 9 with existing assessment and resources", async () => {
    const content = await openLesson();
    const unsafeClipboard =
      richLessonHtml.replace(
        "<h2>",
        '<h2 onclick="alert(1)" class="word-wrapper">'
      ) +
      '<p>New pasted guidance.</p><script>alert(1)</script><iframe src="https://external.example.test"></iframe>';
    await paste(content, unsafeClipboard, "Travel Safety\nCheck the facts");
    assertFormatting(content);
    expect(content.querySelector("script, iframe, [onclick]")).toBeNull();
    expect(mock.mutations).toEqual([]);
    const draftHtml = actualEditor(content).getHTML();
    await click("Save lesson");
    expect(mock.mutations).toEqual([
      { path: "academy.admin.saveLesson", input: savedLesson(draftHtml) },
    ]);
    expect(mock.mutations[0].input).not.toHaveProperty("courseId");
    expect(mock.mutations[0].input).not.toHaveProperty("status");
    expect(mock.mutations[0].input).not.toHaveProperty("questions");
    expect(mock.data["academy.admin.editor"].course.status).toBe("draft");
    expect(mock.data["staffAccess.mine"].courseIds).toEqual([7]);
    expect(
      mock.data["academy.admin.editor"].modules[0].lessons[0].contentHtml
    ).toBe(richLessonHtml);
    assertNoCrmOrUnrelatedWork();
  });

  it("uses real non-submit toolbar controls and retains typed bold/underlined HTML after a failed save", async () => {
    mock.reject["academy.admin.saveLesson"] =
      "Lesson update denied by the server";
    const content = await openLesson();
    await paste(
      content,
      "<p>Typed draft guidance.</p>",
      "Typed draft guidance."
    );
    await act(async () =>
      actualEditor(content).commands.setTextSelection({ from: 1, to: 12 })
    );
    await toolbar(content, "Bold");
    await toolbar(content, "Underline");
    expect(content.querySelector("strong u, u strong")?.textContent).toBe(
      "Typed draft"
    );
    const editorSection = content.closest(
      '[aria-label="Lesson content editor"]'
    )!;
    for (const control of editorSection.querySelectorAll<HTMLButtonElement>(
      "button"
    )) {
      expect(
        control.type,
        control.title || control.textContent || "editor button"
      ).toBe("button");
    }
    expect(mock.mutations).toEqual([]);
    const typedHtml = actualEditor(content).getHTML();
    await click("Save lesson");
    expect(container.textContent).toContain(
      "Lesson update denied by the server"
    );
    expect(container.textContent).toContain("Your draft is retained");
    expect(actualEditor(richField("Lesson content")).getHTML()).toBe(typedHtml);
    expect(mock.operations).toEqual([]);
    expect(mock.mutations).toEqual([
      { path: "academy.admin.saveLesson", input: savedLesson(typedHtml) },
    ]);
    mock.reject = {};
    await click("Save lesson");
    expect(mock.mutations[1]).toEqual(mock.mutations[0]);
    assertNoCrmOrUnrelatedWork();
  });

  it("smart-formats existing plain lines with the regular builder helper, changing only the current lesson draft", async () => {
    const initial =
      "<p>Travel Safety<br>Check the facts before travel.<br><br>Remember:<br>confirm passport<br>check insurance</p>";
    mock.data["academy.admin.editor"].modules[0].lessons[0].contentHtml =
      initial;
    const content = await openLesson();
    expect(content.querySelector("h2, ul")).toBeNull();
    const formatted = plainTextToLessonHtml(lessonHtmlToPlainText(initial));
    const smart = button("Smart format pasted text");
    expect(smart.type).toBe("button");
    await click("Smart format pasted text");
    expect(content.querySelector("h2")?.textContent).toBe("Travel Safety");
    expect(
      [...content.querySelectorAll("ul li")].map(item => item.textContent)
    ).toEqual(["confirm passport", "check insurance"]);
    expect(field("Lesson summary").value).toBe(
      "Lesson summary stays plain text."
    );
    expect(field("Video HTTPS URL").value).toBe(
      "https://www.youtube.com/watch?v=AbCdEfGhI12"
    );
    expect(mock.mutations).toEqual([]);
    expect(mock.operations).toEqual([]);
    expect(
      mock.data["academy.admin.editor"].modules[0].lessons[0].contentHtml
    ).toBe(initial);
    await click("Save lesson");
    expect(mock.mutations).toEqual([
      { path: "academy.admin.saveLesson", input: savedLesson(formatted) },
    ]);
    assertNoCrmOrUnrelatedWork();
  });

  it("handles a text-only clipboard as structured Academy content without sending a mutation", async () => {
    const content = await openLesson();
    await paste(
      content,
      "",
      "Travel Safety\n\nCheck every detail.\n\n- confirm passport\n- check insurance"
    );
    expect(content.querySelector("h2")?.textContent).toBe("Travel Safety");
    expect(
      [...content.querySelectorAll("ul li")].map(item => item.textContent)
    ).toEqual(["confirm passport", "check insurance"]);
    expect(mock.mutations).toEqual([]);
    expect(mock.operations).toEqual([]);
    assertNoCrmOrUnrelatedWork();
  });

  it("changing builder selection never silently saves or changes the existing lesson identity", async () => {
    const content = await openLesson();
    await paste(
      content,
      "<p>Unsaved lesson draft.</p>",
      "Unsaved lesson draft."
    );
    await click("Preparation module");
    expect(field("Module title").value).toBe("Preparation module");
    await click("Course details");
    expect(field("Course title").value).toBe("Assigned safety course");
    await click("Safety lesson");
    assertFormatting(richField("Lesson content"));
    expect(mock.mutations).toEqual([]);
    await change(field("Lesson title"), "Updated safety wording");
    await click("Save lesson");
    expect(mock.mutations).toEqual([
      {
        path: "academy.admin.saveLesson",
        input: savedLesson(richLessonHtml, { title: "Updated safety wording" }),
      },
    ]);
    assertNoCrmOrUnrelatedWork();
  });

  it("renders prompt/private guide in the existing real question editors and saves safe formatted text separately", async () => {
    await openLesson();
    const promptLabel = "Question 1 prompt";
    const guideLabel = "Question 1 explanation / private marking guide";
    const prompt = richField(promptLabel);
    const guide = richField(guideLabel);
    expect(labelledField(promptLabel).querySelector("textarea")).toBeNull();
    expect(labelledField(guideLabel).querySelector("textarea")).toBeNull();
    expect(prompt.querySelector("h2")?.textContent).toBe("Before You Travel");
    expect(prompt.querySelector("strong")?.textContent).toBe("safe approach");
    expect(guide.querySelector("strong")?.textContent).toBe("accurate checks");
    expect(guide.querySelector("em")?.textContent).toBe("clear reasoning");
    expect(field("Question 1 answer options (one per line)")).toBeInstanceOf(
      HTMLTextAreaElement
    );
    await paste(
      prompt,
      "<h2>Safety Scenario</h2><p>Choose the <strong>safe option</strong>.</p><ul><li>Check facts</li><li>Confirm details</li></ul>"
    );
    await paste(
      guide,
      "<h2>Private Rubric</h2><p>Reward <strong>accurate evidence</strong> and <em>clear reasoning</em>.</p><ol><li>Verify facts</li><li>Explain risks</li></ol>"
    );
    for (const scope of [
      labelledField(promptLabel),
      labelledField(guideLabel),
    ]) {
      for (const control of scope.querySelectorAll<HTMLButtonElement>("button"))
        expect(control.type).toBe("button");
    }
    expect(mock.mutations).toEqual([]);
    await click("Save questions");
    expect(mock.mutations).toEqual([
      {
        path: "academy.admin.replaceQuestions",
        input: {
          lessonId: 14,
          questions: [
            {
              ...originalQuestion,
              prompt:
                "## Safety Scenario\n\nChoose the **safe option**.\n\n- Check facts\n- Confirm details",
              explanation:
                "## Private Rubric\n\nReward **accurate evidence** and *clear reasoning*.\n\n1. Verify facts\n2. Explain risks",
            },
          ],
        },
      },
    ]);
    expect(mock.mutations[0].input.questions[0].prompt).not.toMatch(
      /<\/?(?:h2|p|strong|ul|li)\b/
    );
    expect(mock.mutations[0].input.questions[0].explanation).not.toMatch(
      /<\/?(?:h2|p|strong|em|ol|li)\b/
    );
    assertNoCrmOrUnrelatedWork();
  });

  it("sets lesson content non-editable while save is pending, without permitting toolbar or paste changes", async () => {
    let release!: () => void;
    mock.waitFor["academy.admin.saveLesson"] = new Promise<void>(resolve => {
      release = resolve;
    });
    const content = await openLesson();
    try {
      await click("Save lesson");
      expect(content.getAttribute("contenteditable")).toBe("false");
      expect(actualEditor(content).isEditable).toBe(false);
      expect(button("Smart format pasted text").disabled).toBe(true);
      const before = actualEditor(content).getHTML();
      await paste(
        content,
        "<p>Must not edit pending save.</p>",
        "Must not edit pending save."
      );
      expect(actualEditor(content).getHTML()).toBe(before);
      expect(mock.mutations).toHaveLength(1);
    } finally {
      await act(async () => release());
      await flush();
    }
    expect(richField("Lesson content").getAttribute("contenteditable")).toBe(
      "true"
    );
    assertNoCrmOrUnrelatedWork();
  });

  it("revoking the page-boundary permission unmounts rich editors and prevents further editing or saving", async () => {
    const content = await openLesson();
    await paste(
      content,
      "<p>Unsaved formatted draft.</p>",
      "Unsaved formatted draft."
    );
    mock.data["staffAccess.mine"] = {
      instructor: false,
      engagement: false,
      courseIds: [],
      schemaAvailable: true,
    };
    mock.hooks = [];
    await render();
    expect(container.textContent).toContain("Staff workspace unavailable");
    expect(container.querySelector(".ProseMirror")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('a[href="/staff/instructor"]')).toBeNull();
    expect(mock.hooks.map(hook => hook.path)).toEqual(["staffAccess.mine"]);
    expect(mock.mutations).toEqual([]);
    expect(mock.operations).toEqual([]);
    assertNoCrmOrUnrelatedWork();
  });
});
