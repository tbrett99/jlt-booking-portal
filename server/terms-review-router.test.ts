import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(() => {
    throw new Error("A draft review must never access a database");
  }),
}));
// Any unexpected DB access is a test failure, not a connection to live records.
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import { termsReviewRouter } from "./terms-review-router";
import { makeTermsReviewDraft } from "./terms-review-draft";

const account = (role: string, extra: Record<string, unknown> = {}) => ({
  id: 1042,
  openId: "synthetic-terms-review",
  name: "Synthetic Review User",
  email: "terms-review@synthetic.invalid",
  role,
  isActive: true,
  portalStatus: "active",
  ...extra,
});
const context = (user: unknown) =>
  ({ req: { headers: {} }, res: {}, user }) as TrpcContext;
const caller = (role: string, extra: Record<string, unknown> = {}) =>
  termsReviewRouter.createCaller(context(account(role, extra)));

beforeEach(() => {
  mocks.getDb.mockClear();
});

describe("terms review draft router: protected, read-only and database-free", () => {
  it("rejects anonymous access without a database query", async () => {
    await expect(
      termsReviewRouter.createCaller(context(null)).draft()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each(["agent", "instructor", "agent_engagement", "engagement", "user"])(
    "denies non-administrator role %s regardless of staff claims",
    async role => {
      await expect(
        caller(role, {
          isInstructor: true,
          isEngagement: true,
          instructor: true,
          engagement: true,
          isStaff: true,
          staffRole: "instructor",
          staffRoles: ["instructor", "agent_engagement"],
          staffAccess: { instructor: true, engagement: true, courseIds: [123] },
        }).draft()
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mocks.getDb).not.toHaveBeenCalled();
    }
  );
  it.each(["admin", "super_admin"])(
    "allows a verified active %s to read the same unpublished draft",
    async role => {
      const result = await caller(role).draft();
      expect(result).toEqual(makeTermsReviewDraft());
      expect(result.status).toBe("draft_not_published");
      expect(result.publicationDate).toBeNull();
      expect(result.effectiveDate).toBeNull();
      expect(mocks.getDb).not.toHaveBeenCalled();
    }
  );
  it.each(["admin", "super_admin"])(
    "fails closed for inactive or missing-active %s caller state",
    async role => {
      for (const isActive of [false, undefined, null, 1, "true"]) {
        await expect(caller(role, { isActive }).draft()).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
      expect(mocks.getDb).not.toHaveBeenCalled();
    }
  );
  it("does not grant review permission to a synthetic cron identity", async () => {
    await expect(
      caller("agent", {
        id: -1,
        isCron: true,
        taskUid: "synthetic-task",
        isActive: undefined,
      }).draft()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { approved: true },
    { effectiveDate: "2026-11-12" },
    [],
    "publish",
    0,
    true,
  ])("rejects every non-undefined input %j", async input => {
    await expect(
      (caller("super_admin").draft as (input: unknown) => Promise<unknown>)(
        input
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("accepts explicit undefined without changing state", async () => {
    expect(await caller("admin").draft(undefined)).toEqual(
      makeTermsReviewDraft()
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("exposes exactly one query with no mutation, publication or acceptance APIs", () => {
    const procedures = termsReviewRouter._def.procedures;
    expect(Object.keys(procedures)).toEqual(["draft"]);
    expect(procedures.draft._def.type).toBe("query");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("does not allow callers to mutate any later response", async () => {
    const first = await caller("admin").draft();
    const expected = await caller("super_admin").draft();
    first.terms[0].content = "synthetic altered response";
    first.conduct[0].content = "synthetic altered response";
    first.appendices[0].content = "synthetic altered response";
    first.approvals[0].references.push("synthetic altered response");
    first.changes[0].references.push("synthetic altered response");
    expect(await caller("admin").draft()).toEqual(expected);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
