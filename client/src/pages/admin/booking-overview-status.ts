type WorkflowRecord = {
  status?: unknown;
  pipelineStage?: unknown;
};

const normaliseWorkflowStatus = (value: unknown) => String(value ?? "").trim().toLowerCase();

export function hasOutstandingAmendmentAction(amendment: WorkflowRecord): boolean {
  // The editable booking workflow is the source of truth when it is present.
  // Older rows can retain a legacy request status such as "pending" even after
  // their pipeline stage has been moved to Actioned.
  const pipelineStage = normaliseWorkflowStatus(amendment.pipelineStage);
  if (pipelineStage) return pipelineStage !== "actioned";

  return !["actioned", "processed", "completed", "rejected", "cancelled"].includes(
    normaliseWorkflowStatus(amendment.status),
  );
}

export function hasOutstandingRefundAction(refund: WorkflowRecord): boolean {
  // Refund Processed is the terminal booking-level stage. Fall back to legacy
  // request statuses only where a pipeline stage has not been recorded yet.
  const pipelineStage = normaliseWorkflowStatus(refund.pipelineStage);
  if (pipelineStage) return pipelineStage !== "refund processed";

  return !["actioned", "processed", "completed", "rejected", "cancelled"].includes(
    normaliseWorkflowStatus(refund.status),
  );
}

export function hasOutstandingReimbursementAction(item: Pick<WorkflowRecord, "status">): boolean {
  // A scheduled reimbursement has already been processed through PTS. It can
  // remain visible in its record and on the reimbursements list, but it is no
  // longer an action item on the booking.
  return ["pending", "awaiting_agent"].includes(normaliseWorkflowStatus(item.status));
}
