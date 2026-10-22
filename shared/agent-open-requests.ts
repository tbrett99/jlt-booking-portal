export type AgentOpenRequestCounts = {
  flightRequests: number;
  amendments: number;
  reimbursements: number;
  refunds: number;
  cancellations: number;
};

/**
 * Keeps the dashboard's requests-in-progress total explicit and separate from
 * actions an agent must take themselves, which appear in the attention area.
 */
export function countAgentOpenRequests(counts: AgentOpenRequestCounts) {
  return Object.values(counts).reduce(
    (total, count) => total + Math.max(0, Number.isFinite(count) ? count : 0),
    0,
  );
}
