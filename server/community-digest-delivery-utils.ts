export function prepareCommunityDigestDelivery(input: {
  html: string;
  digestTitle: "Weekly Update" | "Monthly Review";
  periodLabel: string;
  customSubject?: string;
  isTest: boolean;
}) {
  const baseSubject = input.customSubject || `JLT Group ${input.digestTitle} — ${input.periodLabel}`;
  return {
    subject: input.isTest ? `[TEST] ${baseSubject}` : baseSubject,
    html: input.html,
  };
}
