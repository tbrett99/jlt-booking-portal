// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mock = vi.hoisted(() => ({
  user: {
    id: 9,
    role: "agent",
    name: "Staff Agent",
    isActive: true,
    portalStatus: "active",
    mustChangePassword: false,
  } as any,
  data: {} as Record<string, any>,
  errors: {} as Record<string, any>,
  loading: {} as Record<string, boolean>,
  hooks: [] as { path: string; enabled: boolean; input: unknown }[],
  mutations: [] as { path: string; input: unknown }[],
  reject: {} as Record<string, string>,
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: mock.user, loading: false, logout: vi.fn() }),
}));
vi.mock("@/contexts/ViewModeContext", () => ({
  useViewMode: () => ({ isAgentView: false, isAdminView: true }),
}));
vi.mock("@/components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-personal-shell": true }, children),
}));
vi.mock("@/pages/agent/AgentDashboard", () => ({
  default: () => React.createElement("h1", null, "Personal agent dashboard"),
}));
vi.mock("@/pages/agent/AgentCommissions", () => ({
  default: () => React.createElement("h1", null, "Personal agent commissions"),
}));
vi.mock("@/pages/agent/MyMarginReport", () => ({
  default: () => React.createElement("h1", null, "Personal margin report"),
}));
vi.mock("@/pages/academy/AcademyHome", () => ({
  default: () => React.createElement("h1", null, "Personal Academy learning"),
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
            const enabled = options.enabled !== false;
            mock.hooks.push({ path, enabled, input });
            return {
              data: mock.data[path],
              error: mock.errors[path] ?? null,
              isLoading: !!mock.loading[path],
              isFetching: false,
              refetch: vi.fn(async () => undefined),
            };
          };
        if (property === "useMutation")
          return (options: any = {}) => {
            const path = parts.join(".");
            const [error, setError] = react.useState<any>(null);
            const [isPending, setPending] = react.useState(false);
            const mutateAsync = async (input: unknown) => {
              mock.mutations.push({ path, input });
              setPending(true);
              try {
                if (mock.reject[path]) throw new Error(mock.reject[path]);
                const result = { id: 31, created: 2, success: true };
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
        if (property === "invalidate") return vi.fn(async () => undefined);
        return proxy([...parts, property]);
      },
    });
  return { trpc: proxy() };
});

import StaffWorkspace from "./StaffWorkspace";
import AdminStaffAccess from "../admin/AdminStaffAccess";
import { safeAssessmentDownload, safeEvidenceUrl } from "./StaffWorkspace";
import { AuthRouter } from "../../App";
import { Suspense } from "react";

let container: HTMLDivElement;
let root: Root;
async function render(element: React.ReactNode) {
  await act(async () => {
    root.render(element);
    await new Promise(resolve => setTimeout(resolve, 20));
  });
}
async function flush() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 25));
  });
}
async function click(text: string) {
  const button = [
    ...container.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
      "button, a"
    ),
  ].find(item => item.textContent?.trim() === text);
  expect(button, `control '${text}'`).toBeTruthy();
  await act(async () => {
    button!.click();
  });
  await flush();
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
}
function field(label: string) {
  const item = [...container.querySelectorAll("label")].find(
    entry => entry.querySelector("span")?.textContent === label
  );
  const control = item?.querySelector<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >("input,select,textarea");
  expect(control, label).toBeTruthy();
  return control!;
}
function enabledPaths() {
  return mock.hooks.filter(hook => hook.enabled).map(hook => hook.path);
}
function setPath(path: string) {
  window.history.replaceState(null, "", path);
}

beforeEach(async () => {
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all([import("./StaffInstructor"), import("./StaffEngagement")]);
  mock.user = {
    id: 9,
    role: "agent",
    name: "Staff Agent",
    isActive: true,
    portalStatus: "active",
    mustChangePassword: false,
  };
  mock.data = {
    "staffAccess.mine": {
      instructor: false,
      engagement: false,
      courseIds: [],
      schemaAvailable: true,
    },
  };
  mock.errors = {};
  mock.loading = {};
  mock.hooks = [];
  mock.mutations = [];
  mock.reject = {};
  setPath("/staff");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("rendered staff access boundary", () => {
  it("does not mount staff data hooks when the schema is unavailable", async () => {
    mock.data["staffAccess.mine"] = {
      instructor: true,
      engagement: true,
      courseIds: [7],
      schemaAvailable: false,
    };
    await render(React.createElement(StaffWorkspace));
    expect(container.textContent).toContain("Staff workspace unavailable");
    expect(enabledPaths()).toEqual(["staffAccess.mine"]);
    expect(container.querySelector('a[href="/staff/instructor"]')).toBeNull();
    expect(container.querySelector('a[href="/staff/engagement"]')).toBeNull();
    expect(
      container.querySelector('a[href="/dashboard"]')?.textContent
    ).toContain("My Agent Portal");
  });
  it("never grants access from stale data after a capability lookup error", async () => {
    mock.data["staffAccess.mine"] = {
      instructor: true,
      engagement: true,
      courseIds: [7],
      schemaAvailable: true,
    };
    mock.errors["staffAccess.mine"] = {
      message: "Permission check unavailable",
    };
    setPath("/staff/instructor");
    await render(React.createElement(StaffWorkspace));
    expect(container.textContent).toContain(
      "Staff access could not be checked"
    );
    expect(enabledPaths()).toEqual(["staffAccess.mine"]);
  });
  it("blocks direct instructor navigation for engagement-only grants", async () => {
    mock.data["staffAccess.mine"] = {
      instructor: false,
      engagement: true,
      courseIds: [],
      schemaAvailable: true,
    };
    setPath("/staff/instructor");
    await render(React.createElement(StaffWorkspace));
    expect(container.textContent).toContain(
      "This workspace is not assigned to you"
    );
    expect(container.querySelector('a[href="/staff/instructor"]')).toBeNull();
    expect(
      container.querySelector('a[href="/staff/engagement"]')
    ).not.toBeNull();
    expect(enabledPaths()).toEqual(["staffAccess.mine"]);
  });
  it("blocks direct engagement navigation for instructor-only grants", async () => {
    mock.data["staffAccess.mine"] = {
      instructor: true,
      engagement: false,
      courseIds: [7],
      schemaAvailable: true,
    };
    setPath("/staff/engagement");
    await render(React.createElement(StaffWorkspace));
    expect(container.textContent).toContain(
      "This workspace is not assigned to you"
    );
    expect(enabledPaths()).toEqual(["staffAccess.mine"]);
  });
  it.each(["onboarding", "paused", "suspended", "cancelled", "in_notice"])(
    "keeps mine disabled for %s accounts",
    async portalStatus => {
      mock.user.portalStatus = portalStatus;
      mock.data["staffAccess.mine"] = {
        instructor: true,
        engagement: true,
        courseIds: [7],
        schemaAvailable: true,
      };
      await render(React.createElement(StaffWorkspace));
      expect(enabledPaths()).toEqual([]);
      expect(container.textContent).toContain("Staff workspace unavailable");
    }
  );
  it("only enables course-list data after an instructor grant and does not auto-select a course", async () => {
    mock.data["staffAccess.mine"] = {
      instructor: true,
      engagement: false,
      courseIds: [7],
      schemaAvailable: true,
    };
    mock.data["academy.admin.courses"] = [
      { id: 7, title: "Assigned course", status: "draft" },
      { id: 12, title: "Unassigned course", status: "published" },
    ];
    setPath("/staff/instructor");
    await render(React.createElement(StaffWorkspace));
    await flush();
    expect(container.textContent).toContain("Assigned course");
    expect(container.textContent).not.toContain("Unassigned course");
    expect(enabledPaths()).toContain("academy.admin.courses");
    expect(enabledPaths()).not.toContain("academy.admin.editor");
    expect(
      enabledPaths().some(path =>
        /users\.|crm\.|dashboard\.|insights/i.test(path)
      )
    ).toBe(false);
  });
  it("mounts name-only engagement picker and only queries activity after an explicit learner selection", async () => {
    mock.data["staffAccess.mine"] = {
      instructor: false,
      engagement: true,
      courseIds: [],
      schemaAvailable: true,
    };
    mock.data["agentDevelopment.admin.staffLearners"] = [
      { id: 3, name: "Learner" },
    ];
    mock.data["agentDevelopment.admin.actionPlans"] = [];
    setPath("/staff/engagement");
    await render(React.createElement(StaffWorkspace));
    await flush();
    await click("People & activity");
    expect(enabledPaths()).toContain("agentDevelopment.admin.staffLearners");
    expect(enabledPaths()).not.toContain(
      "agentDevelopment.admin.staffActivity"
    );
    expect(
      enabledPaths().some(path =>
        /users\.|crm\.|dashboard\.|academy\.admin/i.test(path)
      )
    ).toBe(false);
  });
  it("switches back to the personal portal without an identity or mode mutation", async () => {
    mock.data["staffAccess.mine"] = {
      instructor: true,
      engagement: false,
      courseIds: [7],
      schemaAvailable: true,
    };
    await render(React.createElement(StaffWorkspace));
    await click("My Agent Portal");
    expect(window.location.pathname).toBe("/dashboard");
    expect(mock.user.role).toBe("agent");
    expect(mock.mutations).toEqual([]);
  });
});

describe("rendered Super Admin assignments", () => {
  beforeEach(() => {
    mock.user.role = "super_admin";
    mock.data["staffAccess.adminOptions"] = {
      agents: [{ id: 3, name: "Learner", email: "learner@example.test" }],
      courses: [
        { id: 17, title: "Existing course", status: "draft" },
        { id: 21, title: "Another course", status: "published" },
      ],
    };
    mock.data["staffAccess.adminList"] = [];
  });
  it("disables admin configuration data for ordinary admins", async () => {
    mock.user.role = "admin";
    await render(React.createElement(AdminStaffAccess));
    expect(enabledPaths()).toEqual([]);
    expect(container.textContent).toContain("Super Admin access required");
  });
  it("requires explicit existing course selection and an audit reason before sending a grant", async () => {
    await render(React.createElement(AdminStaffAccess));
    expect(container.textContent).toContain("First Class is not built yet");
    expect(container.textContent).toContain("#17 · Existing course");
    expect(mock.mutations).toEqual([]);
    await change(field("Existing agent"), "3");
    await change(field("Audit reason"), "Assigned teaching responsibility");
    const save = [...container.querySelectorAll("button")].find(
      button => button.textContent === "Save assignment"
    )!;
    expect(save.disabled).toBe(true);
    const courseLabel = [...container.querySelectorAll("label")].find(label =>
      label.textContent?.includes("#17 · Existing course")
    )!;
    await act(async () =>
      courseLabel.querySelector<HTMLInputElement>("input")!.click()
    );
    await click("Save assignment");
    expect(mock.mutations).toEqual([
      {
        path: "staffAccess.adminSave",
        input: {
          userId: 3,
          staffRole: "instructor",
          enabled: true,
          courseIds: [17],
          reason: "Assigned teaching responsibility",
        },
      },
    ]);
  });
});

describe("routing and secure evidence invariants", () => {
  const app = readFileSync(
    resolve(process.cwd(), "client/src/App.tsx"),
    "utf8"
  );
  it("routes staff only inside the pure-agent branch before the personal PortalLayout", () => {
    const branch = app.slice(
      app.indexOf("// Pure agent"),
      app.indexOf("// Admin / Super Admin — switch")
    );
    expect(branch.indexOf("return <StaffWorkspace />")).toBeGreaterThan(0);
    expect(branch.indexOf("return <StaffWorkspace />")).toBeLessThan(
      branch.indexOf("<PortalLayout>")
    );
    expect(branch).toContain(
      '<Route path="/commissions" component={AgentCommissions} />'
    );
    expect(branch).toContain(
      '<Route path="/my-margin" component={MyMarginReport} />'
    );
    expect(branch).toContain(
      '<Route path="/academy" component={AcademyHome} />'
    );
    expect(app).toContain(
      'user.role === "super_admin" && <Route path="/admin/staff-access"'
    );
  });
  it("rejects raw storage keys, non-secure evidence URLs and foreign document links", () => {
    expect(
      safeAssessmentDownload("https://storage.example.test/learner-private.pdf")
    ).toBeUndefined();
    expect(
      safeAssessmentDownload("academy/templates/private-key")
    ).toBeUndefined();
    expect(
      safeAssessmentDownload(
        "https://evil.example/api/academy/assessment-document/token"
      )
    ).toBeUndefined();
    expect(
      safeAssessmentDownload("/api/academy/assessment-document/signed.token")
    ).toContain("/api/academy/assessment-document/signed.token");
    expect(safeEvidenceUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeEvidenceUrl("https://example.test/evidence")).toBe(
      "https://example.test/evidence"
    );
  });
});

describe("rendered server-confirmed decisions", () => {
  it("retains action feedback and does not show approval after a denied review", async () => {
    mock.data["staffAccess.mine"] = {
      instructor: false,
      engagement: true,
      courseIds: [],
      schemaAvailable: true,
    };
    mock.data["agentDevelopment.admin.staffLearners"] = [
      { id: 3, name: "Learner" },
    ];
    mock.data["agentDevelopment.admin.actionPlans"] = [];
    mock.data["agentDevelopment.admin.actionReviewQueue"] = {
      items: [
        {
          agent: { id: 3, name: "Learner" },
          plan: {
            id: 8,
            title: "Action to review",
            instructions: "Provide evidence",
          },
          assignment: {
            id: 42,
            submittedAt: new Date(),
            completionNote: "My evidence",
            evidenceUrl: null,
            evidenceFileUrl: null,
          },
        },
      ],
      nextCursor: null,
    };
    mock.reject["agentDevelopment.admin.reviewAction"] =
      "Staff permission revoked";
    setPath("/staff/engagement");
    await render(React.createElement(StaffWorkspace));
    await flush();
    await click("Action review");
    await change(
      field("Action feedback to learner"),
      "Please improve this evidence"
    );
    await click("Request changes");
    await click("Confirm decision");
    expect(container.textContent).toContain("Staff permission revoked");
    expect(container.textContent).not.toContain("Action review recorded");
    expect(field("Action feedback to learner").value).toBe(
      "Please improve this evidence"
    );
    expect(mock.mutations[0]).toEqual({
      path: "agentDevelopment.admin.reviewAction",
      input: {
        assignmentId: 42,
        outcome: "needs_revision",
        feedback: "Please improve this evidence",
      },
    });
  });
  it("requires a genuine score and feedback for every written answer and retains both on failure", async () => {
    mock.data["staffAccess.mine"] = {
      instructor: true,
      engagement: false,
      courseIds: [7],
      schemaAvailable: true,
    };
    mock.data["academy.admin.courses"] = [
      { id: 7, title: "Assigned course", status: "draft" },
    ];
    mock.data["academy.admin.markingQueue"] = [
      {
        attempt: { id: 12, takenAt: new Date() },
        enrollment: { id: 5, agentId: 3, courseId: 7 },
        course: { id: 7, title: "Assigned course" },
        lesson: { id: 14, title: "Written lesson", assessmentPassMark: 90 },
        agent: { id: 3, name: "Learner", email: null },
        responses: [
          {
            questionId: 11,
            prompt: "Describe your approach",
            responseText: "Learner answer",
            explanation: "Private rubric",
          },
        ],
      },
    ];
    mock.reject["academy.admin.markWrittenAssessment"] =
      "Submission already marked";
    setPath("/staff/instructor");
    await render(React.createElement(StaffWorkspace));
    await flush();
    await click("Written marking");
    const release = [...container.querySelectorAll("button")].find(
      item => item.textContent === "Record marks and release feedback"
    )!;
    expect(release.disabled).toBe(true);
    await change(field("Response 1 score (%)"), "85");
    await change(
      field("Response 1 feedback to learner"),
      "Explain the safety checks"
    );
    await change(
      field("Overall feedback to learner"),
      "Good work, add the missing safety detail"
    );
    await click("Record marks and release feedback");
    expect(container.textContent).toContain("Submission already marked");
    expect(container.textContent).not.toContain("Feedback recorded");
    expect(field("Response 1 score (%)").value).toBe("85");
    expect(field("Response 1 feedback to learner").value).toBe(
      "Explain the safety checks"
    );
    expect(mock.mutations[0]).toEqual({
      path: "academy.admin.markWrittenAssessment",
      input: {
        attemptId: 12,
        feedback: "Good work, add the missing safety detail",
        responses: [
          { questionId: 11, score: 85, feedback: "Explain the safety checks" },
        ],
      },
    });
  });
  it("shows only server-issued secure document downloads", async () => {
    mock.data["staffAccess.mine"] = {
      instructor: true,
      engagement: false,
      courseIds: [7],
      schemaAvailable: true,
    };
    mock.data["academy.admin.courses"] = [
      { id: 7, title: "Assigned course", status: "draft" },
    ];
    mock.data["academy.admin.documentMarkingQueue"] = [
      {
        attempt: {
          id: 12,
          takenAt: new Date(),
          submissionFileName: "Assessment.pdf",
        },
        enrollment: { id: 5, agentId: 3, courseId: 7 },
        course: { id: 7, title: "Assigned course" },
        lesson: { id: 14, title: "Document lesson", assessmentPassMark: 90 },
        agent: { id: 3, name: "Learner" },
        submissionDownloadUrl:
          "https://portal.thejltgroup.co.uk/api/academy/assessment-document/signed.token",
        templateDownloadUrl: "https://storage.example/private.pdf",
      },
    ];
    setPath("/staff/instructor");
    await render(React.createElement(StaffWorkspace));
    await flush();
    await click("Document marking");
    expect(
      container.querySelector(
        'a[href="https://portal.thejltgroup.co.uk/api/academy/assessment-document/signed.token"]'
      )
    ).not.toBeNull();
    expect(
      container.querySelector('a[href="https://storage.example/private.pdf"]')
    ).toBeNull();
    expect(enabledPaths()).not.toContain("academy.admin.markingQueue");
  });
});

describe("rendered same-identity personal routes", () => {
  it.each([
    ["/commissions", "Personal agent commissions"],
    ["/my-margin", "Personal margin report"],
    ["/academy", "Personal Academy learning"],
  ])(
    "keeps %s in the personal agent shell despite staff grants",
    async (path, title) => {
      mock.data["staffAccess.mine"] = {
        instructor: true,
        engagement: true,
        courseIds: [7],
        schemaAvailable: true,
      };
      await Promise.all([
        import("../agent/AgentCommissions"),
        import("../agent/MyMarginReport"),
        import("../academy/AcademyHome"),
      ]);
      setPath(path);
      await render(
        React.createElement(
          Suspense,
          { fallback: "Loading test route" },
          React.createElement(AuthRouter)
        )
      );
      await flush();
      expect(container.textContent).toContain(title);
      expect(container.querySelector("[data-personal-shell]")).not.toBeNull();
      expect(enabledPaths()).not.toContain("staffAccess.mine");
      expect(mock.mutations).toEqual([]);
    }
  );
  it("does not mount PortalLayout in /staff and switches to its own personal dashboard", async () => {
    mock.data["staffAccess.mine"] = {
      instructor: true,
      engagement: false,
      courseIds: [7],
      schemaAvailable: true,
    };
    await import("../agent/AgentDashboard");
    setPath("/staff");
    await render(
      React.createElement(
        Suspense,
        { fallback: "Loading test route" },
        React.createElement(AuthRouter)
      )
    );
    await flush();
    expect(container.querySelector("[data-personal-shell]")).toBeNull();
    expect(enabledPaths()).not.toContain("crm.agentCrm.getMyProfile");
    await click("My Agent Portal");
    await flush();
    expect(container.textContent).toContain("Personal agent dashboard");
    expect(container.querySelector("[data-personal-shell]")).not.toBeNull();
    expect(mock.user.role).toBe("agent");
    expect(mock.mutations).toEqual([]);
  });
});

describe("rendered bounded engagement writes", () => {
  beforeEach(() => {
    mock.data["staffAccess.mine"] = {
      instructor: false,
      engagement: true,
      courseIds: [],
      schemaAvailable: true,
    };
    mock.data["agentDevelopment.admin.staffLearners"] = [
      { id: 3, name: "Learner" },
    ];
    mock.data["agentDevelopment.admin.actionPlans"] = [];
    setPath("/staff/engagement");
  });
  it("creates selected-learner immediate Actions without reward or course policy input", async () => {
    await render(React.createElement(StaffWorkspace));
    await flush();
    await click("New Action");
    await change(field("Action title"), "Practice client follow-up");
    await change(
      field("Instructions to learners"),
      "Provide a short reflection on your follow-up approach"
    );
    const learner = [...container.querySelectorAll("label")].find(
      label => label.textContent === "Learner"
    )!;
    await act(async () =>
      learner.querySelector<HTMLInputElement>("input")!.click()
    );
    await click("Save Action draft");
    expect(mock.mutations).toHaveLength(1);
    expect(mock.mutations[0].path).toBe(
      "agentDevelopment.admin.saveActionPlan"
    );
    expect(mock.mutations[0].input).toMatchObject({
      title: "Practice client follow-up",
      audience: "selected_agents",
      actionType: "ad_hoc",
      assignmentTrigger: "immediate",
      targetAgentIds: [3],
      staffReviewRequired: true,
    });
    expect(mock.mutations[0].input).not.toHaveProperty("momentumPoints");
    expect(mock.mutations[0].input).not.toHaveProperty("momentumAwardMode");
    expect(mock.mutations[0].input).not.toHaveProperty("courseId");
    expect(
      mock.mutations.some(item => item.path.includes("publishActionPlan"))
    ).toBe(false);
  });
  it("logs email check-ins as interactions only, preserving drafts on failure", async () => {
    mock.data["agentDevelopment.admin.engagementCases"] = [
      {
        case: {
          id: 22,
          riskReason: "Activity check",
          status: "active",
          nextFollowUpAt: null,
        },
        agent: { id: 3, name: "Learner" },
      },
    ];
    mock.data["agentDevelopment.admin.getEngagementCase"] = {
      case: {
        id: 22,
        riskReason: "Activity check",
        status: "active",
        nextFollowUpAt: null,
        lastContactAt: null,
        outcome: null,
      },
      agent: { id: 3, name: "Learner" },
      interactions: [],
    };
    mock.reject["agentDevelopment.admin.logEngagementInteraction"] =
      "Check-in could not be saved";
    await render(React.createElement(StaffWorkspace));
    await flush();
    await click("Check-ins");
    const open = [...container.querySelectorAll("button")].find(button =>
      button.textContent?.includes("Activity check")
    )!;
    await act(async () => open.click());
    await flush();
    await change(field("Contact channel"), "email");
    await change(
      field("Contact summary"),
      "Discussed next Academy action by email"
    );
    await click("Record check-in");
    expect(mock.mutations).toEqual([
      {
        path: "agentDevelopment.admin.logEngagementInteraction",
        input: {
          caseId: 22,
          channel: "email",
          summary: "Discussed next Academy action by email",
          outcome: null,
          status: "active",
          nextFollowUpAt: null,
        },
      },
    ]);
    expect(container.textContent).toContain(
      "Selecting email does not send an email"
    );
    expect(container.textContent).toContain("Check-in could not be saved");
    expect(field("Contact summary").value).toBe(
      "Discussed next Academy action by email"
    );
  });
});
