import { createHash } from "node:crypto";
import {
  FULL_TERMS_SECTIONS,
  CODE_OF_CONDUCT_SECTIONS,
  APPENDIX_SECTIONS,
} from "../client/src/pages/policyData";
import type {
  TermsReviewDraft,
  TermsReviewSection,
  TermsReviewChange,
  TermsReviewApproval,
} from "../shared/terms-review";
import {
  TERMS_REVIEW_BASELINE_SHA256,
  TERMS_REVIEW_OVERRIDES,
} from "./terms-review-draft-content";

const changes: TermsReviewChange[] = [
  {
    id: "membership-payments",
    title: "Membership payments and late fees",
    references: [
      "6.2",
      "6.4",
      "6.7",
      "Appendix A items 2, 4, 5",
      "Appendix G item 2",
    ],
    summary:
      "Direct Debit every 30 days; proposed £5 late fee every 14 days replaces the recovery-attempt fee. Removes additional final-month/departure collections. The £697 joining fee, £150 additional-agent charge and 47% uplift are preserved. No billing implementation is changed by this draft.",
  },
  {
    id: "monthly-margins",
    title: "Monthly commission margins, price matching and vouchers",
    references: [
      "2: Detrimental Pricing",
      "43.2",
      "43.3",
      "43.7",
      "43.8",
      "43.10",
      "44.5",
      "Appendix J",
    ],
    summary:
      "Replaces per-booking tiers and monetary floors with the supplied post-probation monthly 6% requirement. JLT confirmed on 12 November 2026 that this is a value-weighted gross commission margin, inclusive of VAT and fees, and that high-value/complex bookings follow the same rules. Aligns price matching, personal bookings and the two annual Family & Friends vouchers. No personal/voucher exclusion, voucher rollover rule or automated enforcement has been added.",
  },
  {
    id: "commission-rights",
    title: "Commission claims, departing-agent holds and overpayments",
    references: ["26.4.2–26.4.4", "Appendix E", "Appendix H closing sentence"],
    summary:
      "Retains all three existing active-agent eligibility conditions and the Friday run. Aligns departing-agent release within 14 days after return, proportional holds, actual overpayment recovery and no double recovery. Appendix E queries use 30 days, matching 26.6.",
  },
  {
    id: "departure-options",
    title: "Consistent Option A and Option B departure arrangements",
    references: [
      "2: In Contract",
      "16.3.1",
      "16.4",
      "16.6.1",
      "16.7–16.10",
      "16.11.1",
      "42.5",
      "Appendix A item 6",
      "Appendix G item 5",
    ],
    summary:
      "Authorised Option A retains access needed to manage existing bookings and ordinary 30-day membership payments, without automatic handover. A pending commission payment alone does not extend self-management. Option B uses proper handover and future-commission forfeiture. The existing 2% charge is narrowed in the appendices to failed Option B handover only, pending legal approval; body provisions 16.6.2 and 49.7 are preserved.",
  },
  {
    id: "consent-clients",
    title: "Other-host consent and agent-sourced clients",
    references: ["11.4", "30.1", "30.4 final bullet"],
    summary:
      "Consent requests use support@thejltgroup.co.uk and 10 business days. Retains unrelated evidence deadlines, Company-Generated Lead treatment and the existing 12-month no-poaching/six-month competing-host restrictions. Existing-booking records cover either departure option.",
  },
  {
    id: "liability-cap",
    title: "Company liability cap and agent repayment obligations",
    references: ["21.1", "21.6"],
    summary:
      "Uses the supplied 100% Company-only cap and proposed agent payment/reimbursement carve-out, subject to mandatory law and CAA terms. Preserves 21.3 exceptions. Requires legal review of cap, exclusions and indemnities as a whole.",
  },
  {
    id: "chargebacks",
    title: "Payment disputes, client chargebacks and legitimate payment rights",
    references: [
      "15.1–15.13",
      "15.1A",
      "2: Misconduct",
      "Appendix G item 1",
      "Code of Conduct 3.2.1.5 / Appendix L",
    ],
    summary:
      "Replaces Section 15 in full with the supplied wording. Removes automatic fixed £50/£75/£500 charges and blanket fraud consequences for genuine bank disputes. Preserves the proposed documented client-chargeback recovery, credits and lawful rights. Appendix L is rendered from the same revised Code of Conduct collection, not a separate reconstructed copy.",
  },
  {
    id: "marketing",
    title: "Brand-compliant marketing without routine pre-approval",
    references: ["34.7 opening sentence"],
    summary:
      "Replaces only the opening sentence and preserves its corrective measures, existing 34.1–34.2 and Code of Conduct 8.2. Routine marketing materials do not require prior submission for approval.",
  },
  {
    id: "compliance-proposals",
    title: "CAA/ATOL compliance workstream — not yet complete",
    references: [
      "1.1 financial-protection sentences",
      "10",
      "Appendix D item 2",
      "6.8",
      "6.9",
      "Appendices H and I",
      "Code of Conduct 5.2",
    ],
    summary:
      "Stages the supplied qualified financial-protection proposal and payment-triggered certificate wording for sign-off. Section 10 remains the old abbreviated text, explicitly pending the approved complete mandatory schedule and 10A/10B selection. Related fee/documentation descriptions are preserved pending approved replacement wording, not silently certified or rewritten.",
  },
];

const approvals: TermsReviewApproval[] = [
  {
    id: "caa-schedule",
    title: "Complete applicable CAA schedule and Agency Term 10A or 10B",
    references: ["10", "1.1", "Appendix D item 2"],
    status: "pending",
    details:
      "Compliance lead or UK travel-law solicitor must supply or approve the complete applicable ORS3 Section 1.4 schedule, identify exactly one of 10A/10B, and confirm the ATOL holder/Agent names and agreement date. Use provisions effective for that date; do not prematurely apply the 1 April 2027 changes. Section 10 is deliberately unchanged in this draft. The supplied financial-protection and certificate proposals are not certified compliant.",
  },
  {
    id: "related-compliance",
    title: "Related booking-fee, card-cost and protection descriptions",
    references: [
      "6.8",
      "6.9",
      "Appendix H",
      "Appendix I",
      "Code of Conduct 5.2",
    ],
    status: "pending",
    details:
      "Obtain sign-off against actual booking and protection arrangements, including required disclosure of separately charged booking fees and protected/unprotected money. These descriptions remain unchanged except the separately instructed Appendix H no-double-recovery addition. No blanket replacement or unrestricted protection guarantee is approved by this preview.",
  },
  {
    id: "margin-calculation",
    title:
      "Personal/voucher booking treatment in the confirmed gross-margin calculation",
    references: ["43.3", "44.5", "Appendix J"],
    status: "pending",
    details:
      "Value-weighted 6% gross commission margin and identical rules for high-value/complex bookings were confirmed by JLT on 12 November 2026. The supplied instructions separately flag how Personal Bookings and Family & Friends voucher bookings count. No exclusion, adjusted formula or automated enforcement has been added; confirm any special treatment before introducing it.",
  },
  {
    id: "covenant-start",
    title: "Covenant start date during continuing In Contract periods",
    references: ["11.2", "11.3", "11.4", "2: In Contract"],
    status: "pending",
    details:
      "Solicitor to confirm when the preserved no-poaching/competing-host covenants begin if ordinary membership ends before Option A self-management. No start date is selected through the new definition or a UI label.",
  },
  {
    id: "failed-handover-fee",
    title: "2% failed Option B handover charge",
    references: ["16.6.2", "49.7", "Appendix A item 6", "Appendix G item 5"],
    status: "pending",
    details:
      "Confirm proportionality/enforceability and interaction with forfeiture and other recovery. The appendix proposal narrows the existing scope; it is not a fresh approval of the fee. If removal is chosen, remove it from all four references together.",
  },
  {
    id: "liability-and-recovery",
    title: "Legal sign-off on liability, indemnities and recovery as a whole",
    references: ["15", "20", "21", "26", "Appendices E, G and H"],
    status: "pending",
    details:
      "The supplied liability and chargeback wording is staged exactly as JLT requested on 12 November 2026. The brief nevertheless calls for legal review of the Company cap, exclusions, existing indemnities, Agent payment/reimbursement obligations and mandatory CAA priority as a whole. Previewing that wording does not certify enforceability or override an applicable signed agreement.",
  },
  {
    id: "publication-and-acceptance",
    title: "Publication date, effective date, notice and versioned acceptance",
    references: ["25", "26.5", "27.2", "published PDF and accepted versions"],
    status: "pending",
    details:
      "Approve the revision and change list, set actual publication/effective dates separately, and agree notice/fresh-acceptance arrangements under applicable agreements and variation provisions. Preserve each existing signed/accepted version and its date. Only after approval/publication regenerate and compare the revised full PDF; do not overwrite the old snapshot or backdate the revision. This read-only feature sends no notice and creates no acceptance record.",
  },
  {
    id: "operational-alignment",
    title:
      "Billing and account-status alignment before enforcing revised rules",
    references: ["6.4", "6.7", "2: In Contract", "16", "43.3"],
    status: "pending",
    details:
      "This staging change does not alter automated fees, Direct Debit collection dates, account status, access, commission payment logic or margin enforcement. Confirm any undocumented first-late-fee trigger/partial-cycle rule before coding it. Align approved continuing-membership logic so pending commission alone cannot extend Option A billing; complete a separate controlled implementation/test review before enforcing new rules.",
  },
];

const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function revisedSections(
  key: keyof typeof TERMS_REVIEW_OVERRIDES,
  baseline: TermsReviewSection[]
): TermsReviewSection[] {
  const result = baseline.map(section => ({ ...section }));
  const seen = new Set<number>();
  for (const change of TERMS_REVIEW_OVERRIDES[key]) {
    if (seen.has(change.index) || !result[change.index]) {
      throw new Error("The terms review draft is unavailable.");
    }
    seen.add(change.index);
    result[change.index] = { ...change.section };
  }
  return result;
}

const escapeTitle = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Read-only preview. Never consumed by signup, published terms, billing or RAG. */
export function makeTermsReviewDraft(): TermsReviewDraft {
  const baseline = {
    FULL_TERMS_SECTIONS,
    CODE_OF_CONDUCT_SECTIONS,
    APPENDIX_SECTIONS,
  };
  if (fingerprint(baseline) !== TERMS_REVIEW_BASELINE_SHA256) {
    // Fail closed if published text changed since this proposal was prepared.
    throw new Error(
      "The published baseline has changed. Reconcile the draft before reviewing it."
    );
  }
  const terms = revisedSections("FULL_TERMS_SECTIONS", FULL_TERMS_SECTIONS);
  const conduct = revisedSections(
    "CODE_OF_CONDUCT_SECTIONS",
    CODE_OF_CONDUCT_SECTIONS
  );
  const appendices = revisedSections("APPENDIX_SECTIONS", APPENDIX_SECTIONS);
  const index = appendices.findIndex(section =>
    section.title.startsWith("Appendix L:")
  );
  if (index < 0) throw new Error("The terms review draft is unavailable.");
  appendices[index] = {
    ...appendices[index],
    content: conduct
      .map(
        section => `<h3>${escapeTitle(section.title)}</h3>${section.content}`
      )
      .join("\n"),
  };
  return {
    id: "2026-11-12-clause-and-appendix-review",
    status: "draft_not_published",
    preparedDate: "2026-11-12",
    publishedBaseline: "May 2026",
    publicationDate: null,
    effectiveDate: null,
    baselineSha256: TERMS_REVIEW_BASELINE_SHA256,
    draftSha256: fingerprint({ terms, conduct, appendices }),
    terms,
    conduct,
    appendices,
    changes: changes.map(change => ({
      ...change,
      references: [...change.references],
    })),
    approvals: approvals.map(approval => ({
      ...approval,
      references: [...approval.references],
    })),
    unchangedComplianceReferences: [
      "10",
      "6.8",
      "6.9",
      "Appendix H existing fee descriptions",
      "Appendix I",
      "Code of Conduct 5.2",
    ],
    notice:
      "Draft for JLT review only — not published or effective. The live May 2026 terms and existing signing/acceptance records are unchanged. Outstanding compliance and approval points must be resolved before publication. Viewing this draft does not create acceptance, change an agreement or apply financial/account actions.",
  };
}
