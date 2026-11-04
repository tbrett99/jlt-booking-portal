// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ data: null as any, calls: [] as { path: string; input: any }[] }));
vi.mock("@/contexts/ViewModeContext", () => ({ useViewMode: () => ({ isAgentView: false }) }));
vi.mock("@/lib/trpc", () => {
  const node = (path = ""): any => new Proxy({}, { get: (_target, key: string) => {
    if (key === "useUtils") return () => node();
    if (key === "invalidate") return vi.fn();
    if (key === "useQuery") return () => ({ data: mocks.data, isLoading: false, error: null });
    if (key === "useMutation") return () => ({ isPending: false, mutate: (input: any) => mocks.calls.push({ path, input }) });
    return node(path ? `${path}.${key}` : key);
  } });
  return { trpc: node() };
});
import AcademyCourse from "../client/src/pages/academy/AcademyCourse";
let root: Root;
let container: HTMLDivElement;
const completedAt = new Date("2026-10-01T12:00:00Z");
function lesson(overrides: Record<string, unknown> = {}) {
  return {
    id: 11, title: "Supplier Knowledge Assessment", summary: null, contentHtml: "<p>Answer the questions below.</p>",
    videoUrl: null, attachmentUrl: null, requiresAcknowledgement: false, requiresAssessment: true,
    assessmentMode: "quiz", assessmentTemplateName: null, hasAssessmentTemplate: true, assessmentPassMark: 80, isRequired: true,
    locked: false, lockedReason: "", progress: { completedAt }, attempts: [],
    questions: [
      { id: 31, prompt: "What should you check before choosing a supplier?", questionType: "free_text", answerOptions: [], maxWords: 250, resit: { passed: false, attemptCount: 0, supportRequired: false } },
      { id: 32, prompt: "Which supplier terms should be checked?", questionType: "multiple_choice", answerOptions: ["Payment deadlines", "No terms"], maxWords: 250, resit: { passed: true, attemptCount: 1, supportRequired: false } },
    ], ...overrides,
  };
}
async function render(currentLesson = lesson()) {
  mocks.data = {
    course: { id: 7, title: "Training course", summary: null, isAcceleratorJourney: false },
    enrollment: { id: 20 }, progress: { percentage: 50, completedRequiredLessons: 1, requiredLessons: 2, isComplete: false },
    modules: [{ id: 9, title: "Supplier Assessment", releaseLocked: false, releaseLabel: null, lessons: [currentLesson] }],
  };
  await act(async () => root.render(React.createElement(AcademyCourse, { enrollmentId: "20" })));
}
function button(text: string) {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === text);
  expect(found, text).toBeTruthy(); return found!;
}
beforeEach(() => {
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.calls = []; container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("agent completed assessment visibility", () => {
  it("shows all questions and options even for a recorded completion with no attempt history", async () => {
    await render();
    expect(container.textContent).toContain("Knowledge check — review");
    expect(container.textContent).toContain("What should you check before choosing a supplier?");
    expect(container.textContent).toContain("Which supplier terms should be checked?");
    expect(container.textContent).toContain("Payment deadlines");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('input[type="radio"]')).toBeNull();
    expect(container.textContent).not.toContain("All questions in this knowledge check have been passed");
    expect(mocks.calls.some(call => call.path.endsWith("submitAssessment"))).toBe(false);
    expect(mocks.data.modules[0].lessons[0].progress.completedAt).toBe(completedAt);
  });
  it("shows the learner's recorded written answer and feedback without a resit editor", async () => {
    await render(lesson({ attempts: [{ id: 100, status: "graded", score: 95, passed: true, graderFeedback: "Good work", feedbackAcknowledgedAt: completedAt, takenAt: completedAt, responses: [{ questionId: 31, responseText: "Check payment terms and protection", score: 95, feedback: "Covered the essentials" }] }] }));
    expect(container.textContent).toContain("Your recorded answer");
    expect(container.textContent).toContain("Check payment terms and protection");
    expect(container.textContent).toContain("Covered the essentials");
    expect(container.textContent).toContain("Good work");
    expect(container.querySelector("textarea")).toBeNull();
  });
  it("restores the fact-find template button while explaining why a completed lesson has no new upload", async () => {
    await render(lesson({ title: "Client Fact Find", assessmentMode: "document_upload", assessmentTemplateName: "Client Fact Find.docx", questions: [] }));
    expect(container.textContent).toContain("Document assessment — review");
    expect(container.textContent).toContain("Client Fact Find.docx");
    expect(container.textContent).toContain("ask the JLT team to reopen the lesson");
    expect(container.querySelector('input[type="file"]')).toBeNull();
    await act(async () => button("Download template").click());
    expect(mocks.calls).toContainEqual({ path: "academy.agent.getDocumentAssessmentTemplate", input: { enrollmentId: 20, lessonId: 11, origin: window.location.origin } });
    expect(mocks.calls.some(call => call.path.endsWith("submitDocumentAssessment"))).toBe(false);
  });
  it("keeps the genuine incomplete quiz answer editor and submission action", async () => {
    await render(lesson({ progress: null }));
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.textContent).not.toContain("Knowledge check — review");
    expect(button("Submit outstanding answers for marking").disabled).toBe(true);
    expect(container.textContent).toContain("What should you check before choosing a supplier?");
  });
  it("keeps the incomplete download/choose-file/upload workflow", async () => {
    await render(lesson({ title: "Client Fact Find", assessmentMode: "document_upload", assessmentTemplateName: "Client Fact Find.docx", questions: [], progress: null }));
    expect(container.textContent).toContain("1. Download the template");
    expect(container.textContent).toContain("2. Upload your completed document");
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(button("Submit document for marking").disabled).toBe(true);
    await act(async () => button("Download template").click());
    expect(mocks.calls).toContainEqual({ path: "academy.agent.getDocumentAssessmentTemplate", input: { enrollmentId: 20, lessonId: 11, origin: window.location.origin } });
  });
  it("explains an actually unconfigured completed quiz rather than claiming a pass", async () => {
    await render(lesson({ questions: [] }));
    expect(container.textContent).toContain("No quiz questions are currently configured");
    expect(container.textContent).not.toContain("All questions in this knowledge check have been passed");
  });
  it("explains a missing private template and does not make a doomed download request", async () => {
    await render(lesson({ assessmentMode: "document_upload", hasAssessmentTemplate: false, assessmentTemplateName: null, questions: [] }));
    expect(container.textContent).toContain("No assessment template is currently attached");
    expect(button("Download template").disabled).toBe(true);
    await act(async () => button("Download template").click());
    expect(mocks.calls.some(call => call.path.endsWith("getDocumentAssessmentTemplate"))).toBe(false);
  });
});
