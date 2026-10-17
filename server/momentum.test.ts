import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { shouldAwardActionMomentum, validateActionMomentumConfiguration } from "../shared/momentum-policy";

const schema = readFileSync(fileURLToPath(new URL("../drizzle/schema.ts", import.meta.url)), "utf8");
const migration = readFileSync(fileURLToPath(new URL("../drizzle/0155_simple_ghost_rider.sql", import.meta.url)), "utf8");
const communityRouter = readFileSync(fileURLToPath(new URL("./community-router.ts", import.meta.url)), "utf8");
const communityPage = readFileSync(fileURLToPath(new URL("../client/src/pages/Community.tsx", import.meta.url)), "utf8");
const academyRouter = readFileSync(fileURLToPath(new URL("./agent-development-router.ts", import.meta.url)), "utf8");

function config(staffReviewRequired: boolean, momentumAwardMode: "off" | "self_declared_completion" | "reviewed_completion", momentumPoints: number) {
  return { staffReviewRequired, momentumAwardMode, momentumPoints };
}

describe("JLT Momentum", () => {
  it("requires a compatible completion trigger and a positive point value", () => {
    expect(validateActionMomentumConfiguration(config(false, "off", 0))).toBeNull();
    expect(validateActionMomentumConfiguration(config(false, "self_declared_completion", 10))).toBeNull();
    expect(validateActionMomentumConfiguration(config(true, "reviewed_completion", 10))).toBeNull();
    expect(validateActionMomentumConfiguration(config(true, "self_declared_completion", 10))).toContain("staff review is off");
    expect(validateActionMomentumConfiguration(config(false, "reviewed_completion", 10))).toContain("requires staff review");
    expect(validateActionMomentumConfiguration(config(false, "self_declared_completion", 0))).toContain("at least 1");
  });

  it("awards Accountability Tasks only at their selected verified completion point", () => {
    expect(shouldAwardActionMomentum({ assignmentStatus: "completed", momentumAwardMode: "self_declared_completion", completionPath: "self_declared", momentumPoints: 10 })).toBe(true);
    expect(shouldAwardActionMomentum({ assignmentStatus: "completed", momentumAwardMode: "reviewed_completion", completionPath: "reviewed", momentumPoints: 10 })).toBe(true);
    expect(shouldAwardActionMomentum({ assignmentStatus: "review", momentumAwardMode: "reviewed_completion", completionPath: "reviewed", momentumPoints: 10 })).toBe(false);
    expect(shouldAwardActionMomentum({ assignmentStatus: "completed", momentumAwardMode: "reviewed_completion", completionPath: "self_declared", momentumPoints: 10 })).toBe(false);
  });

  it("keeps every reward durable, one-time, and reversible", () => {
    expect(schema).toContain("export const momentumLedger");
    expect(schema).toContain("momentum_ledger_agent_rule_source_unique");
    expect(schema).toContain('status: mysqlEnum("status", ["awarded", "reversed"])');
    expect(migration).toContain("CREATE TABLE `momentum_rules`");
    expect(migration).toContain("CREATE TABLE `momentum_ledger`");
  });

  it("uses safe, automatic Community rewards rather than an approval queue", () => {
    expect(communityRouter).toContain('ruleKey: "community_reaction"');
    expect(communityRouter).toContain('ruleKey: "community_comment"');
    expect(communityRouter).toContain('ruleKey: "community_confirmation"');
    expect(communityRouter).toContain('ruleKey: "community_agent_win"');
    expect(communityRouter).toContain("reverseMomentumForCommunityPost");
    expect(communityRouter).toContain("one award per agent/post");
  });

  it("keeps Academy course progression out of Momentum and uses Accountability Tasks instead", () => {
    expect(academyRouter).toContain('ruleKey: "accountability_action"');
    expect(academyRouter).not.toContain('awardMomentum({\n          agentId: ctx.user.id,\n          ruleKey: "academy_lesson"');
  });

  it("turns Community into a visible hub rather than a long undifferentiated feed", () => {
    expect(communityRouter).toContain("hub: protectedProcedure");
    expect(communityPage).toContain("CommunityHub");
    expect(communityPage).toContain("New since your last visit");
    expect(communityPage).toContain("JLT Momentum");
    expect(communityPage).toContain("Explore what&apos;s happening");
  });
});
