import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, "AdminRefundKanban.tsx"), "utf8");
const routerSource = readFileSync(path.resolve(here, "../../../../server/routers.ts"), "utf8");
const dbSource = readFileSync(path.resolve(here, "../../../../server/db.ts"), "utf8");

describe("refund expected-date chase workflow", () => {
  it("provides a date field, due review queue, and expected-date pipeline mutation", () => {
    expect(source).toContain("Expected refund-date review");
    expect(source).toContain("Expected refund date");
    expect(source).toContain("onExpectedRefundDateChange");
    expect(source).toContain("refundId: id, expectedRefundDate");
    expect(source).toContain("refundChaseTiming");
  });

  it("accepts expected dates and clears them when a refund is processed", () => {
    expect(routerSource).toContain("expectedRefundDate: z.date().nullable().optional()");
    expect(routerSource).toContain("Expected refund date");
    expect(routerSource).toContain('ctx.user.role !== "agent" ? r.expectedRefundDate : undefined');
    expect(dbSource).toContain("expectedRefundDate?: Date | null");
    expect(dbSource).toContain('data.pipelineStage === "Refund Processed"');
    expect(dbSource).toContain("updateData.expectedRefundDate = null");
  });
});
