// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  data: null as any,
  previewData: null as any,
  isAgentView: false,
  loading: false,
  error: null as Error | null,
  previewLoading: false,
  previewError: null as Error | null,
  mutationCalls: [] as string[],
}));

vi.mock("@/contexts/ViewModeContext", () => ({
  useViewMode: () => ({ isAgentView: mocks.isAgentView }),
}));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
    React.createElement("a", { ...props, href }, children),
}));

vi.mock("@/lib/trpc", () => {
  const node = (path = ""): any =>
    new Proxy({}, {
      get: (_target, key: string) => {
        const nextPath = path ? `${path}.${key}` : key;
        if (key === "useQuery") {
          return () => {
            if (path.endsWith("previewHome")) {
              return { data: mocks.previewData, isLoading: mocks.previewLoading, error: mocks.previewError };
            }
            if (path.endsWith("actions.mine")) {
              return { data: [], isLoading: false, error: null };
            }
            return { data: mocks.data, isLoading: mocks.loading, error: mocks.error };
          };
        }
        if (key === "useMutation") {
          return () => {
            mocks.mutationCalls.push(nextPath);
            return { isPending: false, mutate: vi.fn() };
          };
        }
        return node(nextPath);
      },
    });
  return { trpc: node() };
});

import AcademyHome from "../client/src/pages/academy/AcademyHome";

let root: Root;
let container: HTMLDivElement;

const completedCourse = {
  id: 701,
  title: "Supplier Standards",
  summary: "Completed supplier learning",
  status: "published",
};
const waivedCourse = {
  id: 702,
  title: "Client Care Essentials",
  summary: "Waived course",
  status: "published",
};
const activeCourse = {
  id: 703,
  title: "Active Travel Practice",
  summary: "Current learning",
  status: "published",
};

function enrolment(course: any, id: number, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status,
    course,
    completedAt: status === "completed" ? "2026-10-01T12:00:00Z" : null,
    dueDate: null,
    isOverdue: false,
    nextLesson: null,
    progress: { completedRequiredLessons: status === "completed" ? 3 : 1, requiredLessons: 3, percentage: status === "completed" ? 100 : 33 },
    ...overrides,
  };
}

function homeData(enrolments: any[]) {
  return { hasAccess: true, enrolments, upcomingSessions: [] };
}

function links() {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>("a"));
}

function linkByAccessibleName(name: string) {
  const match = links().find((link) => (link.getAttribute("aria-label") || link.textContent || "").replace(/\s+/g, " ").trim() === name);
  expect(match, `link ${name}`).toBeTruthy();
  return match!;
}

async function render() {
  await act(async () => root.render(React.createElement(AcademyHome)));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.data = homeData([enrolment(completedCourse, 9001, "completed")]);
  mocks.previewData = mocks.data;
  mocks.isAgentView = false;
  mocks.loading = false;
  mocks.error = null;
  mocks.previewLoading = false;
  mocks.previewError = null;
  mocks.mutationCalls = [];
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Academy completed-course navigation", () => {
  it("renders completed rows as read-only Revisit course links using the enrollment ID and accessible name", async () => {
    mocks.data = homeData([
      enrolment(completedCourse, 9001, "completed"),
      enrolment(waivedCourse, 9002, "waived"),
    ]);
    await render();

    expect(linkByAccessibleName("Revisit course: Supplier Standards").getAttribute("href")).toBe("/academy/course/9001");
    expect(linkByAccessibleName("Revisit course: Client Care Essentials").getAttribute("href")).toBe("/academy/course/9002");
    expect(mocks.mutationCalls).toEqual([]);
  });

  it("uses the first completed enrollment for the hero recap when there are no active courses", async () => {
    await render();

    const hero = links().find((link) => link.textContent?.includes("Revisit: Supplier Standards"));
    expect(hero).toBeTruthy();
    expect(hero!.getAttribute("href")).toBe("/academy/course/9001");
  });

  it("prioritizes an active Continue link over completed-course recap", async () => {
    mocks.data = homeData([
      enrolment(completedCourse, 9001, "completed"),
      enrolment(activeCourse, 9003, "in_progress", { nextLesson: { title: "Airline booking practice" } }),
    ]);
    await render();

    const continueLink = links().find((link) => link.textContent?.includes("Continue: Airline booking practice"));
    expect(continueLink).toBeTruthy();
    expect(continueLink!.getAttribute("href")).toBe("/academy/course/9003");
    expect(links().some((link) => link.textContent?.includes("Revisit: Supplier Standards"))).toBe(false);
  });

  it("does not expose recap links when Academy access is denied", async () => {
    mocks.data = { hasAccess: false, enrolments: [], upcomingSessions: [] };
    await render();

    expect(links().some((link) => link.textContent?.match(/Revisit|Open course|Continue:/))).toBe(false);
    expect(container.textContent).toContain("Your learning space is almost ready");
  });

  it("renders no navigation links while loading or after an Academy error", async () => {
    mocks.loading = true;
    await render();
    expect(links()).toHaveLength(0);

    mocks.loading = false;
    mocks.error = new Error("synthetic failure");
    await render();
    expect(links()).toHaveLength(0);
    expect(container.textContent).toContain("Academy could not be loaded");
  });

  it("uses staff preview course paths rather than real enrollment paths and remains read-only", async () => {
    mocks.isAgentView = true;
    mocks.previewData = homeData([enrolment(completedCourse, 9001, "completed")]);
    await render();

    expect(linkByAccessibleName("Revisit course: Supplier Standards").getAttribute("href")).toBe("/academy/preview/course/701");
    const hero = links().find((link) => link.textContent?.includes("Revisit: Supplier Standards"));
    expect(hero!.getAttribute("href")).toBe("/academy/preview/course/701");
    expect(links().some((link) => link.getAttribute("href") === "/academy/course/9001")).toBe(false);
    expect(mocks.mutationCalls).toEqual([]);
  });
});
