// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

// Only synthetic records and mocked dependencies are used. In particular the
// real email module must never initialise a provider or obtain its own database.
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  emailGetDb: vi.fn(() => { throw new Error("Email database access forbidden"); }),
  getDigest: vi.fn(),
  markDigestSent: vi.fn(),
  sendDirectEmail: vi.fn(),
  getUpcomingAgentEvents: vi.fn(),
  forbidden: vi.fn(() => { throw new Error("Unexpected external work in digest test"); }),
}));
vi.mock("./db", () => ({
  getDb: mocks.getDb,
  getUpcomingAgentEvents: mocks.getUpcomingAgentEvents,
  getRawDbPool: mocks.forbidden,
}));
vi.mock("./email", () => ({
  getDb: mocks.emailGetDb,
  sendDirectEmail: mocks.sendDirectEmail,
  sendNotificationEmail: mocks.forbidden,
  sendSupportEmail: mocks.forbidden,
}));
vi.mock("./community-db", () => {
  const helpers = {
    listCommunityPosts: mocks.forbidden,
    getCommunityPost: mocks.forbidden,
    createCommunityPost: mocks.forbidden,
    updateCommunityPost: mocks.forbidden,
    deleteCommunityPost: mocks.forbidden,
    recordPostView: mocks.forbidden,
    toggleReaction: mocks.forbidden,
    listComments: mocks.forbidden,
    createComment: mocks.forbidden,
    deleteComment: mocks.forbidden,
    confirmPost: mocks.forbidden,
    getConfirmationStatus: mocks.forbidden,
    getComplianceReport: mocks.forbidden,
    getUnconfirmedBusinessUpdates: mocks.forbidden,
    getRecentCommunityPostsForDashboard: mocks.forbidden,
    getAgentsNeedingConfirmationReminder: mocks.forbidden,
    recordConfirmationReminder: mocks.forbidden,
    getOrCreateCommunityDigestDraft: mocks.forbidden,
    updateDigest: mocks.forbidden,
    listDigests: mocks.forbidden,
    getBookingHighlights: mocks.forbidden,
    getDigest: mocks.getDigest,
    markDigestSent: mocks.markDigestSent,
  };
  return { ...helpers, default: helpers };
});
vi.mock("./storage", () => ({ storagePut: mocks.forbidden }));
vi.mock("./momentum", () => ({
  awardMomentum: mocks.forbidden,
  getMomentumAgentOverview: mocks.forbidden,
  getMyMomentum: mocks.forbidden,
  reverseMomentumForCommunityPost: mocks.forbidden,
  reverseMomentumForSource: mocks.forbidden,
}));
vi.mock("./community-reply-notifications", () => ({
  sendCommunityReplyNotifications: mocks.forbidden,
}));

import { communityRouter } from "./community-router";
import { users, suppliers } from "../drizzle/schema";
import { formatDigestIntro } from "../shared/community-digest-format";

const origin = "https://portal.example.test";
const legacyMarkdown =
  "Hello synthetic team,\n\nThank you for a **brilliant period**.\n\n" +
  "## Fictional achievements\n\n- Morgan Vale: £1,240\n- Ellis Brook: £860\n\n" +
  "Keep `**literal code**` and \\*literal marker\\* visible.";
const richHtml =
  "<p>Hello synthetic team,</p><p>Thank you for a <strong>brilliant period</strong>.</p>" +
  "<h2>Fictional achievements</h2><ul><li><p>Morgan Vale: £1,240</p></li>" +
  "<li><p>Ellis Brook: £860</p></li></ul><p>Until next time.</p>";
const agents = [
  { id: 301, name: "Synthetic Agent One", email: "agent-one@example.test" },
  { id: 302, name: "Synthetic Agent Two", email: "agent-two@example.test" },
  { id: 303, name: "Synthetic Agent Without Email", email: null },
];
let queriedTables: unknown[];
let previousSettings: Record<string, unknown>;

function syntheticDraft(digestType: "weekly" | "monthly" = "weekly") {
  return {
    id: 701,
    digestType,
    weekStarting: new Date(digestType === "monthly" ? "2026-10-01T00:00:00Z" : "2026-11-02T00:00:00Z"),
    periodEnd: new Date(digestType === "monthly" ? "2026-11-01T00:00:00Z" : "2026-11-09T00:00:00Z"),
    status: "draft",
    introText: legacyMarkdown,
    includedPostIds: [],
    statsSnapshot: { bookingsThisWeek: 8, totalCommissionClaimed: 2100, reimbursementsCount: 2 },
    includeBookingHighlights: false,
    bookingHighlightsOverride: null,
  };
}
function fakeDb() {
  return {
    select: vi.fn(() => {
      let table: unknown;
      const rows = () => {
        if (table === users) return agents;
        if (table === suppliers) return [];
        throw new Error("Unexpected table in mocked digest DB");
      };
      const query: any = {
        from: (value: unknown) => { table = value; queriedTables.push(value); return query; },
        where: vi.fn(() => query),
        orderBy: vi.fn(() => query),
        limit: vi.fn(() => query),
        then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
          Promise.resolve().then(rows).then(resolve, reject),
      };
      return query;
    }),
    insert: mocks.forbidden,
    update: mocks.forbidden,
    delete: mocks.forbidden,
    execute: mocks.forbidden,
  };
}
function caller(role: User["role"] = "admin") {
  return communityRouter.createCaller({
    user: {
      id: 91, name: "Synthetic Digest Admin", role,
      isActive: true, portalStatus: "active", mustChangePassword: false,
    } as User,
    req: {}, res: {},
  } as TrpcContext);
}
function email(index = 0) {
  const call = mocks.sendDirectEmail.mock.calls[index];
  expect(call, `mocked email ${index}`).toBeTruthy();
  return call[0] as { toEmail: string; toName: string; subject: string; html: string };
}
function emailDocument(html: string) {
  // Detached DOM parsing only: never mount an iframe or load this email.
  // Exclude the document head entirely so even happy-dom's disabled resource
  // loader does not process the production template's font stylesheet link.
  const template = document.createElement("template");
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  expect(body, "complete email body").toBeTruthy();
  template.innerHTML = body![1];
  return template.content;
}
function introElement(html: string) {
  const doc = emailDocument(html);
  const outer = [...doc.querySelectorAll("div")].find(element =>
    element.getAttribute("style")?.includes("background:#FFF6ED")
  );
  expect(outer, "intro message outer container").toBeTruthy();
  const inner = outer!.firstElementChild!;
  expect(inner.tagName, "block-safe intro wrapper (not a paragraph)").toBe("DIV");
  expect(inner.querySelector("p ul, p ol, p h2, p p")).toBeNull();
  return inner;
}
function assertSharedIntro(html: string, content: string, format: "markdown" | "html") {
  const expected = formatDigestIntro(content, format);
  expect(html).toContain(expected);
  const expectedDom = document.createElement("div");
  expectedDom.innerHTML = expected;
  expect(introElement(html).innerHTML).toBe(expectedDom.innerHTML);
  return introElement(html);
}
function assertSyntheticOnly() {
  expect(mocks.emailGetDb).not.toHaveBeenCalled();
  expect(mocks.forbidden).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(queriedTables.every(table => table === users || table === suppliers)).toBe(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  queriedTables = [];
  const settings = (window as any).happyDOM.settings;
  previousSettings = {
    disableIframePageLoading: settings.disableIframePageLoading,
    disableCSSFileLoading: settings.disableCSSFileLoading,
    disableJavaScriptFileLoading: settings.disableJavaScriptFileLoading,
    enableFileSystemHttpRequests: settings.enableFileSystemHttpRequests,
  };
  settings.disableIframePageLoading = true;
  settings.disableCSSFileLoading = true;
  settings.disableJavaScriptFileLoading = true;
  settings.enableFileSystemHttpRequests = false;
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network in digest router tests"); }));
  mocks.getDb.mockResolvedValue(fakeDb());
  mocks.getDigest.mockResolvedValue(syntheticDraft());
  mocks.getUpcomingAgentEvents.mockResolvedValue([]);
  mocks.markDigestSent.mockResolvedValue(undefined);
  mocks.sendDirectEmail.mockResolvedValue({ success: true, status: "accepted", messageId: "synthetic-only" });
});
afterEach(() => {
  assertSyntheticOnly();
  Object.assign((window as any).happyDOM.settings, previousSettings);
  vi.unstubAllGlobals();
});

describe("actual community digest send with synthetic database and delivery", () => {
  it.each(["weekly", "monthly"] as const)(
    "%s test delivery has exactly the live HTML and only test recipient/subject differences",
    async digestType => {
      mocks.getDigest.mockResolvedValue(syntheticDraft(digestType));
      const input = {
        digestId: 701, origin, customSubject: "Synthetic reporting period",
        customIntro: richHtml, customIntroFormat: "html" as const,
      };
      expect(await caller().digest.send({ ...input, testToEmail: "reviewer@example.test" })).toEqual({
        sent: 1, sentCount: 1, isTest: true,
      });
      expect(mocks.sendDirectEmail).toHaveBeenCalledTimes(1);
      const testEmail = email();
      expect(testEmail).toMatchObject({ toEmail: "reviewer@example.test", subject: "[TEST] Synthetic reporting period" });
      expect(mocks.markDigestSent).not.toHaveBeenCalled();
      expect(testEmail.html).toContain(digestType === "monthly" ? "Monthly Review" : "Weekly Update");
      const intro = assertSharedIntro(testEmail.html, richHtml, "html");
      expect(intro.querySelector("h2")?.textContent).toBe("Fictional achievements");
      expect(intro.querySelector("strong")?.textContent).toBe("brilliant period");
      expect([...intro.querySelectorAll("ul li")].map(item => item.textContent)).toEqual([
        "Morgan Vale: £1,240", "Ellis Brook: £860",
      ]);

      mocks.sendDirectEmail.mockClear();
      expect(await caller().digest.send(input)).toEqual({ sent: 2, sentCount: 2, isTest: false });
      expect(mocks.sendDirectEmail).toHaveBeenCalledTimes(2);
      for (const [index, agent] of agents.slice(0, 2).entries()) {
        expect(email(index)).toMatchObject({ toEmail: agent.email, toName: agent.name, subject: "Synthetic reporting period" });
        expect(email(index).html).toBe(testEmail.html);
      }
      expect(mocks.markDigestSent).toHaveBeenCalledTimes(1);
      expect(mocks.markDigestSent).toHaveBeenCalledWith(701, 91, 2);
      expect(mocks.getUpcomingAgentEvents).toHaveBeenCalledWith(14);
      expect(queriedTables).toContain(users);
      expect(queriedTables).toContain(suppliers);
    }
  );

  it.each(["weekly", "monthly"] as const)("renders the untouched old %s Markdown draft with shared formatting", async digestType => {
    const draft = syntheticDraft(digestType);
    mocks.getDigest.mockResolvedValue(draft);
    await caller().digest.send({ digestId: 701, origin, testToEmail: "reviewer@example.test" });
    const intro = assertSharedIntro(email().html, legacyMarkdown, "markdown");
    expect(intro.querySelector("strong")?.textContent).toBe("brilliant period");
    expect(intro.querySelector("h2")?.textContent).toBe("Fictional achievements");
    expect(intro.querySelectorAll("ul li")).toHaveLength(2);
    expect(intro.querySelector("code")?.textContent).toBe("**literal code**");
    expect(intro.textContent).toContain("*literal marker*");
    expect(intro.textContent).not.toContain("## Fictional achievements");
    expect(draft.introText).toBe(legacyMarkdown);
    expect(mocks.markDigestSent).not.toHaveBeenCalled();
  });

  it("defaults custom intros to Markdown, and does not apply an HTML flag to a stored legacy draft", async () => {
    await caller().digest.send({ digestId: 701, origin, customIntro: legacyMarkdown, testToEmail: "reviewer@example.test" });
    assertSharedIntro(email().html, legacyMarkdown, "markdown");
    mocks.sendDirectEmail.mockClear();
    await caller().digest.send({ digestId: 701, origin, customIntroFormat: "html", testToEmail: "reviewer@example.test" });
    assertSharedIntro(email().html, legacyMarkdown, "markdown");
  });

  it("sanitizes explicitly rich HTML while retaining escaped literal dangerous text and safe formatting", async () => {
    const unsafe =
      '<h2 onclick="alert(1)">Safe synthetic heading</h2>' +
      '<p><strong>Safe amount £2,100</strong> &amp; literal &lt;img src=x onerror=alert(1)&gt;</p>' +
      '<ul><li>Safe list item</li></ul><p><a href="javascript:alert(1)">Unsafe link label</a></p>' +
      '<script>DO_NOT_KEEP_SCRIPT</script><iframe src="https://external.example.test"></iframe>' +
      '<img src="https://external.example.test/tracker" onerror="alert(1)">';
    await caller().digest.send({ digestId: 701, origin, customIntro: unsafe, customIntroFormat: "html", testToEmail: "reviewer@example.test" });
    const intro = assertSharedIntro(email().html, unsafe, "html");
    expect(intro.querySelector("script, iframe, img, [onclick], [onerror], [href^='javascript:']")).toBeNull();
    expect(intro.textContent).not.toContain("DO_NOT_KEEP_SCRIPT");
    expect(intro.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(intro.querySelector("strong")?.textContent).toBe("Safe amount £2,100");
    expect(intro.querySelectorAll("ul li")).toHaveLength(1);
  });

  it.each(["markdown", "html"] as const)("an explicitly empty %s override removes the old intro instead of falling back", async customIntroFormat => {
    await caller().digest.send({ digestId: 701, origin, customIntro: "", customIntroFormat, testToEmail: "reviewer@example.test" });
    expect(email().html).not.toContain("<!-- Intro message -->");
    expect(email().html).not.toContain("brilliant period");
    expect(email().html).not.toContain("Fictional achievements");
    expect(mocks.getDigest.mock.results[0]).toBeDefined();
  });

  it("removes an editor-empty HTML document rather than sending a blank intro panel", async () => {
    await caller().digest.send({ digestId: 701, origin, customIntro: "<p></p>", customIntroFormat: "html", testToEmail: "reviewer@example.test" });
    expect(email().html).not.toContain("<!-- Intro message -->");
    expect(email().html).not.toContain("brilliant period");
  });

  it("denies an ordinary agent before any draft, database, or email access", async () => {
    await expect(caller("agent").digest.send({ digestId: 701, origin, customIntro: richHtml, customIntroFormat: "html", testToEmail: "reviewer@example.test" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getDigest).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.getUpcomingAgentEvents).not.toHaveBeenCalled();
    expect(mocks.sendDirectEmail).not.toHaveBeenCalled();
    expect(mocks.markDigestSent).not.toHaveBeenCalled();
  });

  it("rejects an unsupported intro format before data access", async () => {
    await expect(caller().digest.send({ digestId: 701, origin, customIntroFormat: "unsafe" as "html" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getDigest).not.toHaveBeenCalled();
    expect(mocks.sendDirectEmail).not.toHaveBeenCalled();
  });
});
