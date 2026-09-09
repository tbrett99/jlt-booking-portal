export type RecruitmentWorkflowTemplateContext = {
  firstName: string;
  lastName: string;
  email: string;
  applicationLink: string;
  discoveryCallDate: string;
};

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
    discoveryCallDate: context.discoveryCallDate,
  };

  return Object.entries(variables).reduce(
    (rendered, [key, value]) => rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value),
    template
  );
}
