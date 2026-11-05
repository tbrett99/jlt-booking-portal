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
let previousIframeSetting: boolean;
const id = "AbCdEfGhI12";
const embed = `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
const completedAt = new Date("2026-10-01T12:00:00Z");
function lesson(videoUrl: string | null, overrides: Record<string, unknown> = {}) {
  return { id: 11, title: "First Class lesson", contentHtml: "<p>Watch the lesson.</p>", summary: null,
    videoUrl, attachmentUrl: null, requiresAcknowledgement: false, requiresAssessment: false, isRequired: true,
    assessmentMode: "quiz", locked: false, lockedReason: "", progress: null, attempts: [], questions: [], ...overrides };
}
async function render(videoUrl: string | null, overrides: Record<string, unknown> = {}) {
  mocks.data = { course: { id: 7, title: "First Class", isAcceleratorJourney: false }, enrollment: { id: 20 },
    progress: { percentage: 0, completedRequiredLessons: 0, requiredLessons: 1, isComplete: false },
    modules: [{ id: 9, title: "Introduction", lessons: [lesson(videoUrl, overrides)] }] };
  await act(async () => root.render(React.createElement(AcademyCourse, { enrollmentId: "20" })));
}
beforeEach(() => {
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  previousIframeSetting = (window as any).happyDOM.settings.disableIframePageLoading;
  (window as any).happyDOM.settings.disableIframePageLoading = true;
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network is forbidden in these tests"); }));
  const originalError = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (args.some(arg => String(arg).includes("Iframe page loading is disabled"))) return;
    originalError(...args);
  });
  mocks.calls = [];
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  (window as any).happyDOM.settings.disableIframePageLoading = previousIframeSetting;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Academy in-Portal YouTube playback", () => {
  it("embeds normal watch links with privacy-enhanced player, accessible title and provider fallback", async () => {
    const url = `https://www.youtube.com/watch?v=${id}`;
    await render(url);
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(embed);
    expect(frame.title).toBe("YouTube video: First Class lesson");
    expect(frame.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(frame.hasAttribute("allowfullscreen")).toBe(true);
    expect(frame.parentElement?.className).toContain("aspect-video");
    const external = container.querySelector<HTMLAnchorElement>(`a[href="${url}"]`)!;
    expect(external.textContent).toContain("Open in YouTube");
    expect(external.target).toBe("_blank");
    expect(container.textContent).toContain("Watch within the Portal");
    expect(container.textContent).toContain("embedding permissions are controlled by the video owner");
    expect(mocks.calls.filter(call => call.path !== "academy.agent.viewLesson")).toEqual([]);
  });
  it("embeds share links while preserving the requested timestamp, not autoplay or tracking", async () => {
    await render(`https://youtu.be/${id}?t=1m30s&si=tracking&autoplay=1`);
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(`${embed}&start=90`);
    expect(mocks.calls.filter(call => call.path !== "academy.agent.viewLesson")).toEqual([]);
  });
  it("keeps existing Loom videos playing inline with their existing host and ID", async () => {
    await render("https://www.loom.com/share/abc123?sid=existing");
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe("https://www.loom.com/embed/abc123");
    expect(container.querySelector("iframe")?.title).toBe("Loom video: First Class lesson");
    expect(container.textContent).toContain("Open in Loom");
    expect(container.textContent).not.toContain("If YouTube blocks playback");
  });
  it.each([
    "https://video.example.test/lesson",
    `https://www.youtube.com.evil.example/watch?v=${id}`,
    "https://www.youtube.com/playlist?list=not-an-individual-video",
  ])("keeps unsupported URLs as external links, never arbitrary iframe src: %s", async (url) => {
    await render(url);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Opens the approved video in a new tab");
    expect(mocks.calls.filter(call => call.path !== "academy.agent.viewLesson")).toEqual([]);
  });
  it("renders no player for a lesson without a video", async () => {
    await render(null);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).not.toContain("Watch within the Portal");
  });
  it("shows the player for a completed lesson without changing completion or recorded evidence", async () => {
    await render(`https://youtu.be/${id}`, { progress: { completedAt } });
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(embed);
    expect(container.textContent).toContain("Completed");
    expect(mocks.data.modules[0].lessons[0].progress.completedAt).toBe(completedAt);
    expect(mocks.calls.filter(call => call.path !== "academy.agent.viewLesson")).toEqual([]);
  });
  it("does not reveal an unreleased lesson's video when server delivery has withheld it", async () => {
    await render(null, { locked: true, lockedReason: "Available next week", contentHtml: null });
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector('a[href*="youtube"]')).toBeNull();
    expect(mocks.calls.filter(call => call.path !== "academy.agent.viewLesson")).toEqual([]);
  });
  it("replaces the player when a lesson's current video URL changes", async () => {
    await render(`https://youtu.be/${id}`);
    await render("https://youtu.be/aB_cd-Ef123");
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/aB_cd-Ef123?rel=0");
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(mocks.calls.filter(call => call.path !== "academy.agent.viewLesson")).toEqual([]);
  });
});
