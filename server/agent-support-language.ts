// Language equivalence only, never a source, permission, private-data exemption
// or proof of truth. Exact source evidence and independent verification still apply.

const NOUN_FORMS: Record<string, string[]> = {
  document: ["documents", "docs", "documentation"],
  reimbursement: ["reimbursements", "reimbursment", "reimbursments", "reimbursmet", "reimbursmeent", "riembursement", "rembursement"],
  invoice: ["invoices"],
  receipt: ["receipts"],
  lesson: ["lessons"],
  module: ["modules"],
  enrolment: ["enrolments", "enrollment", "enrollments"],
};
const nouns = new Map(Object.entries(NOUN_FORMS).flatMap(([term, variants]) =>
  [term, ...variants].map(variant => [variant, term] as const)));

// No fuzzy correction at the provenance boundary. A small explicit spelling list
// prevents actual words ('invoiced', 'documented', 'enjoyment', 'lesions') from
// authorizing unsupplied statuses, outcomes or topics.
export function normalizeSupportRewriteNoun(word: string): string {
  return nouns.get(word) ?? word;
}

// OUTPUT only: ingress question/feedback screening remains unchanged. Match an
// ENTIRE atomic claim or server-rendered list line, never a clause prefix. A name
// in a following sentence on the same line must keep the original privacy anchor.
// Server-owned citation markers may follow the otherwise closed statement.
const start = "^\\s*(?:- |\\d+\\. )?";
const end = "[.!?]?(?:\\s+\\[S\\d+\\])*\\s*$";
const document = "(?:the )?(?:supplier )?(?:confirmation|invoice|receipt|document)(?: or (?:invoice|confirmation|receipt|document))?";
const clientFieldRequirement = new RegExp(
  start + "(?:the )?client name(?: is required| must be (?:shown|included|present)|: required)(?: (?:on|in) " + document + ")?" + end,
  "i"
);
const clearedEvidenceRequirement = new RegExp(
  start + "(?:the )?proof of payment must show (?:that )?(?:your|the) payment has cleared" + end,
  "i"
);

export function maskGenericDocumentRequirementClauses(text: string): string {
  return text.split("\n").map(line => {
    if (clientFieldRequirement.test(line)) return "generic document field requirement";
    if (clearedEvidenceRequirement.test(line)) return "generic cleared payment evidence requirement";
    return line;
  }).join("\n");
}
