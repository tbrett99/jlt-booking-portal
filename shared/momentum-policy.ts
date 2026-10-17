export const MOMENTUM_AWARD_MODES = ["off", "self_declared_completion", "reviewed_completion"] as const;
export type MomentumAwardMode = typeof MOMENTUM_AWARD_MODES[number];

export function validateActionMomentumConfiguration(params: {
  staffReviewRequired: boolean;
  momentumAwardMode: MomentumAwardMode;
  momentumPoints: number;
}) {
  if (params.momentumAwardMode === "self_declared_completion" && params.staffReviewRequired) {
    return "Self-declared Momentum can only be used when staff review is off";
  }
  if (params.momentumAwardMode === "reviewed_completion" && !params.staffReviewRequired) {
    return "Reviewed Momentum requires staff review to be on";
  }
  if (params.momentumAwardMode !== "off" && params.momentumPoints < 1) {
    return "Choose at least 1 Momentum Point for a rewarded action";
  }
  return null;
}

export function shouldAwardActionMomentum(params: {
  assignmentStatus: string;
  momentumAwardMode: MomentumAwardMode;
  completionPath: "self_declared" | "reviewed";
  momentumPoints: number;
}) {
  if (params.assignmentStatus !== "completed" || params.momentumPoints < 1) return false;
  return (params.completionPath === "self_declared" && params.momentumAwardMode === "self_declared_completion")
    || (params.completionPath === "reviewed" && params.momentumAwardMode === "reviewed_completion");
}
