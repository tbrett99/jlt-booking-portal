import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  orderBy: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: mocks.getDb }));

import {
  getGcMandateReplacementHistoryStateByUserId,
  isMissingGoCardlessReplacementHistoryTable,
} from "./gocardless-db";

const missingHistory = () => Object.assign(
  new Error("Table 'railway.gc_mandate_replacements' doesn't exist"),
  { code: "ER_NO_SUCH_TABLE", errno: 1146 },
);

beforeEach(() => {
  vi.resetAllMocks();
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: mocks.orderBy })) })) })),
    insert: mocks.insert,
    update: mocks.update,
    delete: mocks.delete,
  };
  mocks.getDb.mockResolvedValue(db);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("Optional GoCardless replacement-history reads", () => {
  it("returns existing replacement history as available", async () => {
    const rows = [{ id: 12, userId: 42, status: "linked", replacementMandateId: "MD-CURRENT" }];
    mocks.orderBy.mockResolvedValue(rows);
    expect(await getGcMandateReplacementHistoryStateByUserId(42)).toEqual({
      replacements: rows,
      replacementHistoryAvailable: true,
    });
  });

  it("does not confuse empty but available history with missing schema", async () => {
    mocks.orderBy.mockResolvedValue([]);
    expect(await getGcMandateReplacementHistoryStateByUserId(42)).toEqual({
      replacements: [], replacementHistoryAvailable: true,
    });
  });

  it("reports only the optional history as unavailable when its exact table is missing", async () => {
    mocks.orderBy.mockRejectedValue(missingHistory());
    expect(await getGcMandateReplacementHistoryStateByUserId(42)).toEqual({
      replacements: [], replacementHistoryAvailable: false,
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("recognises the MySQL missing-table error nested in a Drizzle cause", async () => {
    const error = Object.assign(new Error("Failed query: select history"), { cause: missingHistory() });
    expect(isMissingGoCardlessReplacementHistoryTable(error)).toBe(true);
    mocks.orderBy.mockRejectedValue(error);
    expect((await getGcMandateReplacementHistoryStateByUserId(42)).replacementHistoryAvailable).toBe(false);
  });

  it.each([
    Object.assign(new Error("Table 'railway.gc_mandates' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 }),
    Object.assign(new Error("Access denied while reading gc_mandate_replacements"), { code: "ER_ACCESS_DENIED_ERROR" }),
    Object.assign(new Error("Connection lost while reading gc_mandate_replacements"), { code: "ECONNRESET" }),
    Object.assign(new Error("Unknown column in gc_mandate_replacements"), { code: "ER_BAD_FIELD_ERROR", errno: 1054 }),
  ])("does not hide a different schema, access or connection error: %s", async (error) => {
    expect(isMissingGoCardlessReplacementHistoryTable(error)).toBe(false);
    mocks.orderBy.mockRejectedValue(error);
    await expect(getGcMandateReplacementHistoryStateByUserId(42)).rejects.toBe(error);
  });

  it("does not treat the table name alone as a missing-table error", () => {
    expect(isMissingGoCardlessReplacementHistoryTable(new Error("Failed query from gc_mandate_replacements"))).toBe(false);
    expect(isMissingGoCardlessReplacementHistoryTable(undefined)).toBe(false);
  });

  it("keeps base mandate and subscription in the status response and exposes unavailable history explicitly", () => {
    const source = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    const status = source.slice(source.indexOf("    adminGetDdStatus:"), source.indexOf("    adminRequestMandateReplacement:"));
    expect(status).toContain("getGcMandateByUserId(input.userId)");
    expect(status).toContain("getGcSubscriptionByUserId(input.userId)");
    expect(status).toContain("getGcMandateReplacementHistoryStateByUserId(input.userId)");
    expect(status).toContain("subscription, replacements, replacementHistoryAvailable");
    expect(status).not.toContain("getGcMandateReplacementHistoryByUserId(input.userId)");
    expect(status).not.toContain("await updateMandate(");
    expect(status).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });
});
