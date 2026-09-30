import { describe, expect, it } from "vitest";
import { buildPipelineHealth, taskNeedsAttention } from "../shared/dashboard-workboard-utils";

describe("dashboard workboard helpers", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");

  it("groups active pipeline stages with transparent ageing and over-target counts", () => {
    const health = buildPipelineHealth([
      { id: 1, clientName: "Old client", currentStage: "Query", stageEntered: "2026-09-24T12:00:00.000Z" },
      { id: 2, clientName: "New client", currentStage: "Query", stageEntered: "2026-09-29T12:00:00.000Z" },
      { id: 3, clientName: "PTS client", currentStage: "Added to PTS", stageEntered: "2026-09-28T12:00:00.000Z" },
    ], now);

    expect(health).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "Query",
        count: 2,
        averageAgeDays: 3.5,
        oldestAgeDays: 6,
        oldestClientName: "Old client",
        overTargetCount: 1,
        targetDays: 3,
      }),
      expect.objectContaining({
        stage: "Added to PTS",
        count: 1,
        oldestAgeDays: 2,
        overTargetCount: 0,
      }),
    ]));
  });

  it("keeps open, unacknowledged and due tasks in the daily focus", () => {
    expect(taskNeedsAttention({ status: "open", acknowledgedAt: null, dueDate: null }, now)).toBe(true);
    expect(taskNeedsAttention({ status: "in_progress", acknowledgedAt: now, dueDate: "2026-09-30T10:00:00.000Z" }, now)).toBe(true);
    expect(taskNeedsAttention({ status: "in_progress", acknowledgedAt: now, dueDate: "2026-10-03T12:00:00.000Z" }, now)).toBe(false);
    expect(taskNeedsAttention({ status: "done", acknowledgedAt: null, dueDate: null }, now)).toBe(false);
  });
});
