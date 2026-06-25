/**
 * Reverse-engineers estimated gross commission from the agent's net commission figure
 * as received from Orbit.
 *
 * Orbit sends the net commission after:
 *   1. PTS fees are deducted from gross (approx 1%, but variable)
 *   2. The 80/20 split in the agent's favour
 *
 * Formula:
 *   grossCommission = (agentNet / AGENT_SPLIT) / (1 - PTS_FEE_RATE)
 *
 * This is an approximation — actual PTS fees fluctuate around 1%.
 * The result should be labelled as estimated (e.g. "~6.2%") in the UI.
 */

const AGENT_SPLIT = 0.80; // Agent receives 80% of post-PTS commission
const PTS_FEE_RATE = 0.013; // PTS fees approx 1.3% of gross commission

/**
 * Estimates gross commission from the agent net figure sent by Orbit.
 * @param agentNetPence - Agent net commission in pence (as stored in DB)
 * @returns Estimated gross commission in pence
 */
export function estimateGrossCommissionPence(agentNetPence: number): number {
  if (!agentNetPence || agentNetPence <= 0) return 0;
  return (agentNetPence / AGENT_SPLIT) / (1 - PTS_FEE_RATE);
}

/**
 * Calculates estimated gross margin % from agent net commission and booking value.
 * @param agentNetPence - Agent net commission in pence
 * @param bookingValuePence - Total booking value in pence
 * @returns Estimated gross margin as a percentage (e.g. 6.2), or null if inputs invalid
 */
export function estimateGrossMarginPercent(
  agentNetPence: number,
  bookingValuePence: number
): number | null {
  if (!agentNetPence || !bookingValuePence || bookingValuePence <= 0) return null;
  const estimatedGross = estimateGrossCommissionPence(agentNetPence);
  return (estimatedGross / bookingValuePence) * 100;
}
