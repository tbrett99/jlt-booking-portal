import { describe, expect, it } from "vitest";
import {
  hasOutstandingAmendmentAction,
  hasOutstandingRefundAction,
  hasOutstandingReimbursementAction,
} from "./booking-overview-status";

describe("booking overview attention statuses", () => {
  it("uses the amendment pipeline stage rather than a stale legacy request status", () => {
    expect(hasOutstandingAmendmentAction({ status: "pending", pipelineStage: "Actioned" })).toBe(false);
    expect(hasOutstandingAmendmentAction({ status: "pending", pipelineStage: "In Progress" })).toBe(true);
  });

  it("does not flag a Refund Processed record as outstanding", () => {
    expect(hasOutstandingRefundAction({ status: "pending", pipelineStage: "Refund Processed" })).toBe(false);
    expect(hasOutstandingRefundAction({ status: "pending", pipelineStage: "Refund Received in JLT" })).toBe(true);
    expect(hasOutstandingRefundAction({ status: "processed" })).toBe(false);
  });

  it("treats only pending or awaiting-agent reimbursements as booking actions", () => {
    expect(hasOutstandingReimbursementAction({ status: "pending" })).toBe(true);
    expect(hasOutstandingReimbursementAction({ status: "awaiting_agent" })).toBe(true);
    expect(hasOutstandingReimbursementAction({ status: "scheduled" })).toBe(false);
    expect(hasOutstandingReimbursementAction({ status: "paid" })).toBe(false);
  });
});
