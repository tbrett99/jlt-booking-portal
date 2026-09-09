export type RecruitmentWorkflowTemplateContext = {
  firstName: string;
  lastName: string;
  email: string;
  applicationLink: string;
  discoveryCallLink: string;
  joinLink: string;
  discoveryCallDate: string;
};

/**
 * Workflow delays are absolute offsets from entering a recruitment stage.
 * This keeps a three-day email at exactly three days even when an earlier
 * email was delayed by the scheduler.
 */
export function calculateWorkflowStepSendAt(
  stageEnteredAt: Date | string,
  delayHours: number
): Date {
  const enteredAt = stageEnteredAt instanceof Date
    ? stageEnteredAt
    : new Date(stageEnteredAt);
  const safeEnteredAt = Number.isNaN(enteredAt.getTime()) ? new Date() : enteredAt;
  return new Date(safeEnteredAt.getTime() + Math.max(0, delayHours) * 60 * 60 * 1000);
}

export function formatDiscoveryCallDate(value: Date | string | null | undefined): string {
  if (!value) return "your scheduled time";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "your scheduled time";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(date);
}

export function renderRecruitmentWorkflowTemplate(
  template: string,
  context: RecruitmentWorkflowTemplateContext
): string {
  const variables: Record<string, string> = {
    firstName: context.firstName,
    lastName: context.lastName,
    email: context.email,
    applicationLink: context.applicationLink,
    discoveryCallLink: context.discoveryCallLink,
    joinLink: context.joinLink,
    discoveryCallDate: context.discoveryCallDate,
  };

  return Object.entries(variables).reduce(
    (rendered, [key, value]) => rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value),
    template
  );
}
