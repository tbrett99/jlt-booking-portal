import { beforeEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("./gocardless-income-service", () => ({
  getPaidOutIncomeReport: mocked.report,
}));
import { superAdminRouter } from "./super-admin-router";
function caller(role: string | null) {
  return superAdminRouter.createCaller({
    user: role ? { id: 1, role } : null,
    req: {},
    res: {},
  } as any);
}
const input = { rangeStart: "2026-11-02", rangeEnd: "2026-11-08" };
beforeEach(() => {
  mocked.report.mockReset();
});
describe("Super Admin read-only GoCardless income procedure", () => {
  it.each(["admin", "agent", "user"])(
    "rejects %s before any report/provider read",
    async role => {
      await expect(caller(role).paidOutIncome(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(mocked.report).not.toHaveBeenCalled();
    }
  );
  it("requires an authenticated session", async () => {
    await expect(caller(null).paidOutIncome(input)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(mocked.report).not.toHaveBeenCalled();
  });
  it("passes the exact selected range and refresh key to the read service", async () => {
    const result = { rows: [], complete: true };
    mocked.report.mockResolvedValue(result);
    expect(
      await caller("super_admin").paidOutIncome({ ...input, refreshKey: 100 })
    ).toEqual(result);
    expect(mocked.report).toHaveBeenCalledWith({ ...input, refreshKey: 100 });
  });
  it("refuses malformed range payloads before provider access", async () => {
    await expect(
      caller("super_admin").paidOutIncome({ ...input, rangeStart: "yesterday" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocked.report).not.toHaveBeenCalled();
  });
  it("does not expose failed-query SQL or private parameters", async () => {
    mocked.report.mockRejectedValue(
      new Error(
        "Failed query: SELECT bankAccountNumber WHERE email='private@example.test'"
      )
    );
    await expect(
      caller("super_admin").paidOutIncome(input)
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Paid-out income could not be verified. No complete totals are shown; please retry.",
    });
  });
  it("preserves controlled archive and pagination errors", async () => {
    mocked.report.mockRejectedValue(
      new Error("GoCardless API events older than 18 months are archived.")
    );
    await expect(
      caller("super_admin").paidOutIncome(input)
    ).rejects.toMatchObject({
      message: "GoCardless API events older than 18 months are archived.",
    });
  });
});
