import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getDigestPeriod } from "./community-db";

const digestDb = readFileSync(resolve(process.cwd(), "server/community-db.ts"), "utf8");
const digestPage = readFileSync(resolve(process.cwd(), "client/src/pages/community/WeeklyDigestAdmin.tsx"), "utf8");
const digestRouter = readFileSync(resolve(process.cwd(), "server/community-router.ts"), "utf8");

describe("monthly review reporting", () => {
  it("keeps a September month boundary in UTC during UK daylight-saving time", () => {
    const { periodStart, periodEnd } = getDigestPeriod("monthly", new Date("2026-09-01T00:00:00.000Z"));

    expect(periodStart.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("uses whole-period business activity rather than current statuses", () => {
    expect(digestDb).toContain("gte(bookings.createdAt, normalisedPeriodStart)");
    expect(digestDb).toContain("gte(commissionClaims.claimedAt, normalisedPeriodStart)");
    expect(digestDb).toContain("gte(reimbursementItems.scheduledAt, normalisedPeriodStart)");
    expect(digestDb).not.toContain('eq(reimbursementItems.status, "scheduled"),\n        gte(reimbursementItems.scheduledAt, normalisedPeriodStart)');
  });

  it("repairs the unsent one-day monthly draft before it is regenerated", () => {
    expect(digestDb).toContain("Repair the unsent monthly draft");
    expect(digestDb).toContain("eq(communityDigests.periodEnd, normalisedPeriodStart)");
    expect(digestDb).toContain("weekStarting: normalisedPeriodStart, periodEnd");
  });

  it("exposes saved manual figures without changing the sending flow", () => {
    expect(digestPage).toContain("setUTCMonth(d.getUTCMonth() - 1, 1)");
    expect(digestPage).toContain("Edit figures");
    expect(digestPage).toContain("Save figures");
    expect(digestPage).toContain("statsSnapshot: { ...stats, ...currentFigures }");
    expect(digestRouter).toContain("${digestPeriodLabel}'s Numbers");
  });
});
