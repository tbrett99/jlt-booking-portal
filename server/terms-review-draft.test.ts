import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FULL_TERMS_SECTIONS,
  CODE_OF_CONDUCT_SECTIONS,
  APPENDIX_SECTIONS,
} from "../client/src/pages/policyData";
import { makeTermsReviewDraft } from "./terms-review-draft";

// Independently captured from the user-supplied brief, not the draft renderer or its fixtures.
// Each key is the brief's exact quote heading. This makes the tests portable without
// relying on an attachment path and protects against renderer/parser mistakes.
const expectedBriefQuotes: Record<string, string> = {
  "### Replace clause 6.2":
    "**6.2 Membership Fees:** Membership fees are payable by Direct Debit every 30 days as follows: Business Class Membership — £87; First Class Membership — £127. Payments follow the Agent’s notified 30-day collection schedule. The Agent must maintain a valid Direct Debit instruction and sufficient funds. Cancelling the instruction does not, by itself, terminate Membership or extinguish amounts validly due.",
  "### Replace clause 6.4":
    "**6.4 Late Payments:** A £5 late-payment fee will be applied every 14 days while a Membership Fee remains overdue. This replaces the previous £25-per-recovery-attempt fee. Any restriction of services or withholding of commission for non-payment must be exercised in accordance with this Agreement and applicable law.",
  "### Replace clause 6.7":
    "**6.7 Membership Fees on Departure:** Normal Membership Fees continue to fall due on the existing 30-day payment schedule during the Agent’s 30-day notice period. If the Agent chooses Option A under Section 16.3, normal Membership Fees continue throughout the authorised self-management period. Giving notice does not create an additional final-month fee, accelerate the payment schedule or entitle JLT to collect whichever amount produces the greater payment. Cancellation and continuing-booking arrangements are governed by Section 16.",
  "### Appendix A — replace item 2":
    "**2. Membership Fees:** Payable by Direct Debit every 30 days: Business Class Membership — £87; First Class Membership — £127. The payment requirements in Section 6.2 apply.",
  "### Appendix A — replace item 4":
    "**4. Late Payment Fee:** £5 every 14 days while a Membership Fee remains overdue, in accordance with Section 6.4. No £25-per-recovery-attempt fee applies.",
  "### Appendix A — replace item 5":
    "**5. Departure Payments:** Normal Membership Fees remain payable during the 30-day notice period and any continuing Option A self-management period under Section 16. No separate additional cancellation or final-month administration fee is created by giving notice.",
  "### Appendix G — replace item 2":
    "**2. Late Payment Fee:** £5 every 14 days while a Membership Fee remains overdue, in accordance with Section 6.4. This replaces the previous £25-per-recovery-attempt fee.",
  "### Replace clause 43.2":
    "**43.2 Net Rate and Family & Friends Vouchers:** Client Travel must not be sold at Net Rate unless a valid Family & Friends voucher is used. Personal Bookings may be made at Net Rate where the Agent is a named traveller and the requirements of Section 44 are met. Each Agent receives two Family & Friends vouchers annually, allowing Net Rate or below-standard-margin sales on two selected bookings per calendar year. The voucher must be recorded against the selected booking. All applicable PTS Trust fees and card-processing fees must be covered in full, including on voucher and Personal Bookings.",
  "### Replace clause 43.3":
    "**43.3 Monthly Average Commission Margin:** Following the Agent’s probationary period, the Agent must maintain an average commission margin of at least 6%, inclusive of VAT and fees, across bookings made over each calendar month. This is a contractual requirement, not a suggested target. Individual booking margins may vary; the 6% standard is a monthly average and not a separate minimum for every booking. Bookings at 1–2% margins must be kept to a minimum. Pricing training and support are available, but do not replace the requirement to meet the monthly standard.",
  "### Replace clause 43.7":
    "**43.7 Price Reductions After Processing:** Any reduction in a selling price after a booking has been Processed must be supported by an updated invoice and written client communication, with any required client agreement retained in the booking system. The reduction must comply with the monthly-average policy in Section 43.3 and Appendix J, cover all applicable costs and fees, and must not cause financial loss or reputational harm to JLT. An individual booking is not prohibited solely because its margin is below 6%.",
  "### Replace clause 43.8":
    "**43.8 Detrimental Pricing:** Agents must not price bookings in a way that causes financial loss or reputational harm to JLT, fails to cover required costs and fees, or breaches the applicable monthly-average requirement. A lower-margin individual booking is not, by itself, Detrimental Pricing where it is consistent with the monthly policy and any permitted Personal Booking or Family & Friends voucher arrangement.",
  "### Replace clause 43.10":
    "**43.10 Price Matching and Pricing Support:** Price matching is permitted where the Agent retains written evidence of a genuine, comparable offer and the booking does not cause financial loss or reputational harm to JLT. All applicable costs and fees must be covered. Price matching does not automatically waive the monthly-average requirement. Agents should seek support where they are unsure of appropriate pricing. No additional approval requirement arises solely because an individual booking margin is below 6%.",
  "### Section 2 — replace the definition of “Detrimental Pricing”":
    "**“Detrimental Pricing”** means pricing that causes financial loss or reputational harm to JLT, fails to cover applicable costs and fees, or breaches the monthly-average commission-margin requirements in Section 43 and Appendix J. An individual booking margin below 6% does not, by itself, constitute Detrimental Pricing.",
  "### Replace Appendix J in full":
    "**1. Monthly standard**\nFollowing probation, Agents must maintain an average commission margin of at least 6%, inclusive of VAT and fees, across bookings made over each calendar month. This is a monthly-average requirement, not a minimum applying separately to every booking. Individual booking margins may vary. Bookings at 1–2% margins must be kept to a minimum.\n\n**2. Probation and support**\nAgents are exempt from the monthly-average requirement during their probationary period. They must nevertheless cover all applicable costs and fees and comply with the booking, payment and client-protection requirements. Pricing training and support are available. After probation, the monthly standard must be met.\n\n**3. Price matching**\nAn Agent may price-match a genuine, comparable offer if written evidence is retained in the booking system. The price must cover all applicable costs and fees and must not cause financial loss or reputational harm to JLT. Price matching does not automatically waive the monthly-average requirement.\n\n**4. Personal Bookings**\nPersonal Bookings may be made at Net Rate where the Agent is a named traveller and Section 44 is satisfied. All applicable PTS Trust, card-processing and bank charges must be covered in full.\n\n**5. Family & Friends vouchers**\nEach Agent receives two vouchers annually for two selected bookings per calendar year. A valid voucher permits a Client Travel booking at Net Rate or below the normal margin standard. The voucher must be recorded against the booking. All applicable PTS Trust and card-processing fees must be covered in full.\n\n**6. Other Client Travel**\nClient Travel must not be sold at Net Rate unless a valid Family & Friends voucher is used. An Agent must not incorrectly label Client Travel as personal travel to avoid these requirements.\n\n**7. Price amendments and records**\nChanges after a booking has been Processed must follow Section 43, be supported by updated invoices and written client communication, and retain any required client agreement in the booking system.\n\n**8. Fair and lawful pricing**\nAgents must give accurate price information and comply with applicable consumer-protection and advertising requirements. Misleading discounts, unavailable offers and concealed separately payable charges are prohibited.",
  "### Add this sentence at the end of clause 44.5":
    "A valid Family & Friends voucher may nevertheless permit Net Rate pricing on a selected Client Travel booking under Section 43.2 and Appendix J. Such a booking remains Client Travel and must not be relabelled as a Personal Booking.",
  "### Replace clause 26.4.2":
    "**26.4.2 Departing Agent Commission Hold:** From the date an Agent gives notice to leave, commission on their Active Bookings is held until the relevant client returns from travel, including while the Agent continues under Option A. Commission retained under Option A will be released within 14 days of the client’s return, subject to any relevant unresolved dispute, chargeback, refund or amount properly deductible under this Agreement. Any continuing hold must relate to the relevant exposure and be reviewed when that matter is resolved. This clause does not restore commission forfeited under Option B or another applicable provision.",
  "### Replace clause 26.4.3":
    "**26.4.3 Commission Clawback:** If a cancellation, refund or chargeback after commission has been paid reduces the Net Revenue on which it was calculated, the resulting commission overpayment must be repaid. JLT may deduct the overpayment from later commission or issue an invoice. If the Agent has left, the overpayment is immediately due and payable and may be recovered as a civil debt. Recovery must reflect the commission actually overpaid; the same loss must not be recovered twice.",
  "### Add clause 26.4.4":
    "**26.4.4 Withholding and Set-Off:** JLT may withhold or set off commission to cover outstanding amounts validly due under this Agreement or a reasonably supported exposure arising from a relevant dispute, chargeback, refund or commission overpayment. JLT will provide the Agent with the reason and a breakdown. Amounts held must be proportionate to the exposure and reviewed when it is resolved. Protected client funds must not be used to discharge the Agent’s separate liabilities.",
  "### Replace Appendix E in full":
    "**1. Commission split:** The Agent receives 80% of Net Revenue and JLT retains 20%. Net Revenue is calculated in accordance with Section 26.2 and Appendix H. Applicable deductions are made once, not again after calculating Net Revenue.\n\n**2. Active-agent eligibility:** An active Agent in Good Standing may claim commission only when all three conditions are met: the client’s full balance has been paid; all relevant suppliers have been paid in full; and departure is no more than 12 weeks away.\n\n**3. Payment schedule:** Eligible, correctly submitted active-agent claims are processed on the weekly Friday commission-payment run. The payment run does not override eligibility conditions, a valid hold or a departure arrangement. Departing-agent release is governed by item 4 and must not be delayed beyond its 14-day release period merely because of the weekly run.\n\n**4. Departing Agents:** From notice of departure, commission on Active Bookings is held until the client returns. Commission retained under Option A will be released within 14 days after return, subject to relevant unresolved disputes, chargebacks, refunds or properly deductible amounts. Option B bookings carry no entitlement to future commission. Sections 26.4.2 and 16.10 apply.\n\n**5. Statements and queries:** JLT will provide a statement showing revenue, applicable deductions, Net Revenue and the commission calculation. Commission queries must be raised in writing within 30 days of payment, consistent with Section 26.6. Nothing in this item removes a right that cannot lawfully be excluded.\n\n**6. Clawback and recovery:** Commission overpayments resulting from cancellations, refunds or chargebacks are repayable under Section 26.4.3. JLT may withhold or set off amounts under Sections 15 and 26.4.4. Amounts already recovered must be credited so that the same loss is not recovered twice.\n\n**7. Forfeiture:** Future commission is forfeited where an Agent chooses Option B or an applicable takeover or forfeiture provision applies. Self-management under Option A does not itself forfeit commission. Sections 14.6, 16.3.4, 16.10 and 49 apply according to their scope.",
  "### Appendix H — add this closing sentence":
    "Each cost or loss must be accounted for only once. A chargeback amount, fee or commission overpayment already recovered through another deduction, set-off or invoice must not be deducted or recovered again.",
  "### Replace clause 16.3.1":
    "**16.3.1** Agents with Active Bookings must give 30 days’ written notice. Under **Option A — Self-Management**, the Agent may continue managing existing bookings until the clients have returned and the booking-management obligations have been completed. The Agent remains In Contract, pays the normal Membership Fee every 30 days and keeps the account in Good Standing. Access needed to manage those bookings continues. Commission is retained subject to the departing-agent hold in Section 26.4.2. Under **Option B — Handover to JLT**, the Agent hands the Active Bookings to JLT under Section 49 and forfeits future commission on those bookings. A properly completed Option B handover does not create an ongoing self-management Membership Fee obligation after the notice period.",
  "### Section 2 — add the definition of “In Contract”":
    "**“In Contract”** means the continuing contractual period during which an Agent who has given notice remains authorised to self-manage existing Active Bookings under Option A of Section 16.3, subject to continuing Membership payments and Good Standing. It ends when the clients have returned and the Agent’s booking-management obligations have been completed. A pending commission payment alone does not extend the self-management period or Membership Fee obligation.",
  "### Replace Section 16.4":
    "**16.4 Settlement of Account:** The Agent must pay Membership Fees and other sums validly due under the applicable payment schedule. Under Option A, existing bookings continue to be managed and normal Membership Fees continue throughout the authorised self-management period. Under Option B, the Agent must complete the handover within the notice period under Section 49. Client balances and supplier payments continue to follow the applicable booking terms and deadlines; giving notice does not itself accelerate those client payment obligations.",
  "### Replace clause 16.6.1":
    "**16.6.1** Amounts already due from the Agent must be settled during the notice period. This does not require an Option A Agent to hand over bookings, or require clients to pay balances early solely because the Agent has given notice. Future Membership Fees under Option A remain payable on the normal 30-day schedule.",
  "### Replace clauses 16.7.1–16.7.3":
    "**16.7.1** Normal Membership Fees continue on the existing 30-day Direct Debit schedule during the notice period and any authorised Option A self-management period.\n\n**16.7.2** Giving notice does not accelerate collections, create an extra final-month fee, or permit JLT to collect two standard payments or whichever amount produces the greater payment.\n\n**16.7.3** Under Option B, continuing Membership payments end when the 30-day notice period and proper handover have been completed, subject to outstanding amounts already validly due. Under Option A, continuing payments end when the authorised self-management period ends. No additional departure administration fee applies merely because notice is given.",
  "### Replace Section 16.8":
    "**16.8 Access and Resources on Departure:** An Agent under Option A may retain and use the access and JLT resources needed to manage existing bookings throughout the authorised self-management period. When all authorised access ends, the Agent must stop using JLT’s systems, resources and branding, return or securely delete JLT’s confidential materials as instructed, and comply with surviving contractual obligations. This is subject to lawful record-retention requirements and the Agent’s right to retain their own client information lawfully.",
  "### Replace clauses 16.9.1–16.9.2":
    "**16.9.1** Access is removed after completion of the notice period and proper handover under Option B, or at the end of the authorised Option A self-management period. Access may be restricted earlier in accordance with the Agreement for non-payment, serious breach or necessary protective action.\n\n**16.9.2** Once authorised access ends, the Agent must cease trading under JLT’s name and remove JLT branding and representations of continuing JLT membership. During Option A, use is limited to the authorised management of existing JLT bookings.",
  "### Replace clauses 16.10.1–16.10.4":
    "**16.10.1** Under Option A, the Agent retains commission entitlement on bookings they continue to manage, subject to the commission calculation, deductions, hold and clawback provisions in Section 26 and Appendix E. A handover is not a condition of commission entitlement under Option A.\n\n**16.10.2** Under Option B, the Agent forfeits future commission on the bookings handed to JLT. An applicable takeover under Section 16.3.4 is dealt with under that provision.\n\n**16.10.3** Commission payable to a departing Agent is held until the client returns and then released within 14 days, subject to Section 26.4.2. The ordinary active-agent payment schedule does not override this hold or release requirement.\n\n**16.10.4** Handover cooperation is required where Option B or an authorised takeover applies. Option A Agents remain responsible for their own existing bookings and must keep complete records accessible to JLT.",
  "### Replace clause 16.11.1":
    "**16.11.1** The obligation to stop using JLT’s systems, resources and branding applies when all authorised access ends, including after any authorised Option A self-management period. It does not remove access required for continuing self-management merely because the ordinary notice period has expired.",
  "### Replace clause 42.5":
    "**42.5 Booking Management on Departure:** Active Bookings remain JLT bookings in either departure option. Under Option A, the Agent continues to service them while paying normal Membership Fees and remaining in Good Standing. Under Option B, or an authorised takeover under Section 16, JLT assumes their management. Commission is dealt with under Sections 16.10 and 26 and Appendix E. Departure does not automatically require JLT to take over every Option A booking.",
  "### Clarify the existing 2% failed-handover fee — Appendix A item 6 and Appendix G item 5":
    "**Failed Option B Handover:** The 2% transaction fee in Section 16.6.2 applies only to an affected booking where an Agent who chose Option B fails to complete the required handover within the notice period and that failure causes continued management work beyond the notice period. It is not a routine fee for Option A self-management or an orderly Option B handover.",
  "### Replace clause 11.4":
    "**11.4 Joining Another Host Agency While In Contract:** An Agent must obtain JLT’s prior written consent before joining another host agency while still bound by the relevant Membership obligations, including during notice or an Option A self-management period. Requests must be sent to support@thejltgroup.co.uk. JLT will respond within 10 business days of receiving the request. If no response is given within that period, consent is deemed granted. Consent will not be unreasonably withheld. This does not prevent the Agent joining another host after their relevant contractual obligations to JLT have ended.",
  "### Replace clause 30.1":
    "**30.1 Agent-Sourced Clients:** The Agent may continue their relationships with clients they independently sourced and may work with those clients on future travel after leaving JLT. Use of JLT’s booking systems to arrange their travel does not, by itself, turn an Agent-Sourced Client into a Company-Generated Lead. Existing JLT bookings remain within JLT’s arrangements and are managed under Sections 16, 42 and 49. Personal data may only be retained and used in accordance with data-protection law.",
  "### Section 30.4 — replace only its final bullet":
    "The Agent must ensure JLT has all records needed to protect and manage Active Bookings, whether the Agent continues under Option A or a handover takes place under Option B.",
  "### Replace clause 21.1":
    "**21.1 Company Liability Cap:** Subject to Section 21.3 and any liability that cannot lawfully be limited, JLT’s total aggregate liability to the Agent arising under or in connection with this Agreement, whether in contract, tort, breach of statutory duty or otherwise, is limited to 100% of the Membership Fees paid by the Agent in the 12 months immediately preceding the event giving rise to the claim. This is a cap on JLT’s liability, not the Agent’s liability.",
  "### Add clause 21.6":
    "**21.6 Agent Payment and Reimbursement Obligations:** The Company liability cap in Section 21.1 and the exclusion in Section 21.2 do not limit the Agent’s obligation to pay validly due Membership Fees, repay commission overpayments or reimburse client chargeback amounts and associated recoverable fees, penalties and reasonable administration costs under Sections 15 and 26. Nothing overrides mandatory CAA agency terms, JLT’s applicable indemnity obligations or liability that cannot lawfully be transferred, excluded or limited.",
  "### Replace Section 15 in full":
    "**15.1 Scope:** This Section distinguishes client booking chargebacks from disputes concerning the Agent’s Joining Fee, Membership Fees and other contractual payments.\n\n**15.1A Client Chargebacks:** Where a client payment for a booking made by the Agent is reversed through a chargeback, payment dispute or bank reversal, the Agent must reimburse JLT for the full amount reversed, resulting processor or bank fees and penalties actually incurred, and reasonable, documented administrative costs of responding to the dispute. This obligation applies whether or not the Agent was at fault or could prevent the reversal, subject to mandatory law and CAA agency terms. These reimbursement obligations are not limited by the Company liability cap in Section 21.1.\n\n**15.2 Joining and Membership Fees:** Joining and Membership Fees validly due remain payable and non-refundable under Sections 6 and 16, subject to contractual refund exceptions and applicable law. Leaving Membership, cancelling a Direct Debit or obtaining a bank refund does not itself extinguish a valid debt. This does not create fees for periods otherwise not chargeable under this Agreement.\n\n**15.3 Legitimate Payment Rights:** Nothing in this Agreement restricts legitimate bank, card-provider or Direct Debit Guarantee rights, including claims concerning unauthorised, duplicate, incorrect or improperly collected payments. A dispute or refund request is not, by itself, fraud or Misconduct.\n\n**15.4 Notification and Resolution:** The Agent must notify support@thejltgroup.co.uk promptly on becoming aware of a disputed payment or reversal and provide available details. The parties are encouraged to resolve matters directly. Notification, negotiation, mediation and any waiting period are not preconditions to contacting a bank or exercising payment-provider rights.\n\n**15.5 Membership Payment Recovery:** For reversed Joining or Membership Fee payments, JLT may recover only fees that remain validly owed. Exercising legitimate payment rights attracts no chargeback surcharge. Additional recovery costs must be legally recoverable, reasonably incurred and documented; they are not automatically payable merely because a payment was disputed.\n\n**15.6 Limits and Mandatory Obligations:** No fixed £50 chargeback fee, £75 hourly management charge or £500 liquidated damages applies. Nothing transfers liability for JLT’s own acts or omissions where prohibited by law. Mandatory CAA agency terms prevail and JLT’s applicable indemnity obligations remain unaffected.\n\n**15.7 Invoices, Withholding and Set-Off:** JLT may invoice amounts actually owed under this Section, payable within 14 days of issue, or withhold and set off those amounts against commission or other sums payable to the Agent. Written notice must identify the booking or payment, supporting breakdown, credits and remaining balance. Amounts already deducted must be credited. Protected client or trust funds must not be used for this purpose. Reasonably supported pending exposure is dealt with under Section 26.4.4.\n\n**15.8 No Double Recovery:** Reinstated payments and recoveries relating to the same loss must be credited promptly. Amounts already recovered through deductions, invoices or otherwise cannot be recovered again. Any resulting overpayment must be refunded promptly.\n\n**15.9 Disputed Liability:** The Agent may challenge an invoice or deduction with reasons and supporting information. JLT will review and explain its calculation. Contractual dispute resolution does not restrict legitimate bank or Direct Debit rights.\n\n**15.10 Cooperation:** The Agent must retain relevant booking records and provide truthful information and reasonable assistance promptly, taking account of payment-provider deadlines. JLT will support the collection and submission of available evidence through the applicable dispute process, but cannot guarantee a successful outcome.\n\n**15.11 Evidence and Reporting:** Relevant records may be used or disclosed to payment providers, advisers, courts or authorities only as necessary and permitted by law. Reporting suspected fraud must have an evidence-based basis.\n\n**15.12 Actual Fraud:** Actual fraud or dishonest conduct may justify termination under Section 16. A good-faith dispute does not. This Section creates no automatic commission forfeiture merely because a bank claim is made.\n\n**15.13 Survival:** Accrued payment and reimbursement obligations survive departure until settled, and related disputes until resolved, subject to applicable limitation periods.",
  "### Appendix G — replace item 1":
    "**1. Chargebacks and Payment Reversals:** Recovery is governed by Section 15. Client booking reversals may include the full reversed amount, actual processor or bank fees and penalties, and reasonable documented administrative costs. No fixed chargeback administration fee applies. Legitimate bank and Direct Debit rights remain unaffected.",
  "### Code of Conduct / Appendix L — replace clause 3.2.1.5":
    "**3.2.1.5** Knowingly making a false payment-dispute claim or submitting false information to obtain a refund of Joining Fees, Membership Fees or other payments. An honestly raised dispute or legitimate exercise of bank, card-provider or Direct Debit rights is not, by itself, fraud.",
  "### Replace the opening sentence of clause 34.7":
    "**34.7 Consequences for Breach:** Use of marketing materials that breach JLT’s brand guidelines, applicable law or the standards in this Section may result in the measures listed below. Routine marketing materials do not require prior submission to JLT for approval.",
  "### Appendix D — replace item 2":
    "**2. ATOL Certificates:** For a transaction requiring an ATOL Certificate, the Agent must ensure the appropriate Certificate is supplied to the consumer immediately when any payment is taken, in accordance with the applicable ATOL Regulations and CAA agency terms. This applies whether payment is taken as a deposit or in full and regardless of the booking channel.",
  "### Clause 1.1 — financial-protection wording: legal approval required":
    "Client booking funds are protected through JLT’s applicable ATOL and/or PTS arrangements, subject to the eligibility, scope and conditions of those arrangements. The applicable protection will be identified in the booking documentation. Agents must not describe a booking as ATOL-protected unless it qualifies, or represent financial protection as insurance against their own errors or omissions.",
};
const BASELINE_ARRAY_SHA =
  "1f7e7ff1e35e35ce5e1fe381ec1bfbbb5ae45e473a32fd578051e36045b40066";
const BASELINE_FILE_SHA =
  "e2a8010caadf02b1cf5702cde88ddfbb55b3b19226cdd689cf34e60d8388c8e4";
const baseline = {
  FULL_TERMS_SECTIONS,
  CODE_OF_CONDUCT_SECTIONS,
  APPENDIX_SECTIONS,
};
const initialBaseline = JSON.stringify(baseline);
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const compact = (value: string) => value.replace(/\s+/g, " ").trim();
const confirmedCalculationBasis =
  "Monthly calculation basis: The 6% standard is a value-weighted gross commission margin, not an unweighted average of individual booking percentages. This basis applies equally to ordinary, high-value and complex bookings. The gross margin remains inclusive of VAT and fees as stated above.";
const plain = (html: string) =>
  compact(
    html
      .replace(/<\/?(?:strong|em|a|span)\b[^>]*>/g, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#(?:39|x27);/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
  );
const expected = (heading: string) =>
  compact(expectedBriefQuotes[heading].replace(/\*\*/g, ""));
const paragraphs = (html: string) =>
  html.match(/<p\b[^>]*>[\s\S]*?<\/p>/g) ?? [];
const baseTerm = (n: number) => FULL_TERMS_SECTIONS[n - 1];
const term = (n: number) => makeTermsReviewDraft().terms[n - 1];
const appendix = (letter: string) =>
  makeTermsReviewDraft().appendices.find(s =>
    s.title.startsWith(`Appendix ${letter}:`)
  )!;
const baseAppendix = (letter: string) =>
  APPENDIX_SECTIONS.find(s => s.title.startsWith(`Appendix ${letter}:`))!;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const startsWithClause = (p: string, clause: string) =>
  new RegExp(`^${escape(clause)}(?:\\s|:|$)`).test(plain(p));
const clauseParagraph = (html: string, clause: string) => {
  const matches = paragraphs(html).filter(p => startsWithClause(p, clause));
  expect(matches, `exactly one paragraph for ${clause}`).toHaveLength(1);
  return matches[0];
};

const clauseCases: [number, string, string][] = [
  [6, "6.2", "### Replace clause 6.2"],
  [6, "6.4", "### Replace clause 6.4"],
  [6, "6.7", "### Replace clause 6.7"],
  [11, "11.4", "### Replace clause 11.4"],
  [26, "26.4.2", "### Replace clause 26.4.2"],
  [26, "26.4.3", "### Replace clause 26.4.3"],
  [26, "26.4.4", "### Add clause 26.4.4"],
  [16, "16.3.1", "### Replace clause 16.3.1"],
  [16, "16.4", "### Replace Section 16.4"],
  [16, "16.6.1", "### Replace clause 16.6.1"],
  [16, "16.8", "### Replace Section 16.8"],
  [16, "16.11.1", "### Replace clause 16.11.1"],
  [42, "42.5", "### Replace clause 42.5"],
  [30, "30.1", "### Replace clause 30.1"],
  [21, "21.1", "### Replace clause 21.1"],
  [21, "21.6", "### Add clause 21.6"],
  [43, "43.2", "### Replace clause 43.2"],
  [43, "43.7", "### Replace clause 43.7"],
  [43, "43.8", "### Replace clause 43.8"],
  [43, "43.10", "### Replace clause 43.10"],
];
const groupedClauses: [number, string][] = [
  [16, "### Replace clauses 16.7.1–16.7.3"],
  [16, "### Replace clauses 16.9.1–16.9.2"],
  [16, "### Replace clauses 16.10.1–16.10.4"],
  [15, "### Replace Section 15 in full"],
];
const appendixCases: [string, string, string][] = [
  ["A", "2.", "### Appendix A — replace item 2"],
  ["A", "4.", "### Appendix A — replace item 4"],
  ["A", "5.", "### Appendix A — replace item 5"],
  ["G", "1.", "### Appendix G — replace item 1"],
  ["G", "2.", "### Appendix G — replace item 2"],
  ["D", "2.", "### Appendix D — replace item 2"],
];

describe("staged terms review: independent exact brief wording", () => {
  it.each(clauseCases)(
    "clause %s / %s exactly matches its supplied replacement",
    (n, clause, heading) => {
      expect(plain(clauseParagraph(term(n).content, clause))).toBe(
        expected(heading)
      );
    }
  );
  it.each(groupedClauses)(
    "all supplied replacement clauses in section %s are exact",
    (n, heading) => {
      for (const paragraph of expectedBriefQuotes[heading].split(/\n\s*\n/)) {
        const text = compact(paragraph.replace(/\*\*/g, ""));
        const clause = text.match(/^\d+\.\d+(?:A|\.\d+)?/)![0];
        expect(plain(clauseParagraph(term(n).content, clause))).toBe(text);
      }
    }
  );
  it.each(appendixCases)(
    "Appendix %s item %s exactly matches the supplied replacement",
    (letter, item, heading) => {
      expect(plain(clauseParagraph(appendix(letter).content, item))).toBe(
        expected(heading)
      );
    }
  );
  it("Appendix E is completely replaced, with no legacy paragraphs", () => {
    expect(plain(appendix("E").content)).toBe(
      expected("### Replace Appendix E in full")
    );
  });
  it("preserves exact 43.3 wording and adds only the approved value-weighted gross-basis clarification", () => {
    const text = plain(clauseParagraph(term(43).content, "43.3"));
    expect(text).toBe(expected("### Replace clause 43.3"));
    const calculation = paragraphs(term(43).content)
      .map(plain)
      .filter(p => p.startsWith("Monthly calculation basis:"));
    expect(calculation).toEqual([confirmedCalculationBasis]);
  });
  it("keeps all eight exact Appendix J items, with only the approved monthly-basis addition", () => {
    const originalItems = expectedBriefQuotes["### Replace Appendix J in full"]
      .split(/\n\s*\n/)
      .map(s => compact(s.replace(/\*\*/g, "")));
    const actualItems = paragraphs(appendix("J").content).map(plain);
    expect(actualItems).toHaveLength(9);
    expect(actualItems.slice(0, 8)).toEqual(originalItems);
    expect(actualItems[8]).toBe(confirmedCalculationBasis);
    expect(plain(appendix("J").content)).toBe(
      `${expected("### Replace Appendix J in full")} ${confirmedCalculationBasis}`
    );
  });
  it("keeps Appendix J's letter with the exact approved new title", () => {
    expect(appendix("J").title).toBe(
      "Appendix J: Monthly Commission Margins, Price Matching and Net-Rate Bookings"
    );
  });
  it("defines Detrimental Pricing and In Contract using the supplied wording", () => {
    for (const heading of [
      "### Section 2 — replace the definition of “Detrimental Pricing”",
      "### Section 2 — add the definition of “In Contract”",
    ]) {
      expect(paragraphs(term(2).content).map(plain)).toContain(
        expected(heading)
      );
    }
  });
  it("limits the same 2% failed-handover wording to Option B in both appendices", () => {
    const text = expected(
      "### Clarify the existing 2% failed-handover fee — Appendix A item 6 and Appendix G item 5"
    );
    for (const letter of ["A", "G"])
      expect(plain(appendix(letter).content)).toContain(text);
    expect(plain(appendix("A").content)).not.toContain(
      "Transaction Fee for Extended Booking Management"
    );
    expect(plain(appendix("G").content)).not.toContain(
      "Transaction Fee for Extended Booking Management"
    );
  });
  it("appends the voucher clarification without removing the existing 44.5 restrictions", () => {
    const old = clauseParagraph(baseTerm(44).content, "44.5");
    const text = expected("### Add this sentence at the end of clause 44.5");
    expect(plain(term(44).content)).toContain(`${plain(old)} ${text}`);
    expect(term(44).content).toContain(old);
    expect(plain(term(44).content).split(text)).toHaveLength(2);
  });
  it("adds H's once-only recovery sentence while retaining all original content exactly", () => {
    expect(appendix("H").content).toContain(baseAppendix("H").content);
    expect(plain(appendix("H").content)).toBe(
      `${plain(baseAppendix("H").content)} ${expected("### Appendix H — add this closing sentence")}`
    );
  });
  it("replaces only the final 30.4 bullet and preserves the preceding two bullets", () => {
    const old = clauseParagraph(baseTerm(30).content, "30.4");
    const prefix = old.slice(0, old.lastIndexOf("<br/>"));
    expect(clauseParagraph(term(30).content, "30.4")).toContain(prefix);
    expect(plain(clauseParagraph(term(30).content, "30.4"))).toContain(
      expected("### Section 30.4 — replace only its final bullet")
    );
    expect(plain(term(30).content)).not.toContain(
      "You must provide The JLT Group with all information necessary to service any Active Bookings in accordance with Section 49"
    );
  });
  it("changes only 34.7's opening and keeps every corrective measure", () => {
    const old = clauseParagraph(baseTerm(34).content, "34.7");
    const measures = old.slice(old.indexOf("<br/>"));
    expect(term(34).content).toContain(measures);
    expect(plain(term(34).content)).toContain(
      expected("### Replace the opening sentence of clause 34.7")
    );
    expect(plain(term(34).content)).not.toContain(
      "Use of unapproved marketing materials"
    );
  });
  it("uses the exact good-faith-dispute safeguard in conduct and derives full Appendix L from it", () => {
    const draft = makeTermsReviewDraft();
    const fraud = draft.conduct.find(
      s => s.title === "3. Fraud and Misrepresentation"
    )!;
    expect(plain(clauseParagraph(fraud.content, "3.2.1.5"))).toBe(
      expected("### Code of Conduct / Appendix L — replace clause 3.2.1.5")
    );
    const l = draft.appendices.find(
      s => s.title === "Appendix L: Code of Conduct"
    )!;
    // Ordered concatenation of the actual draft conduct source; no stale independent copy.
    let previousEnd = 0;
    for (const section of draft.conduct) {
      const index = l.content.indexOf(section.content, previousEnd);
      expect(
        index,
        `full conduct body included once in order: ${section.title}`
      ).toBeGreaterThanOrEqual(previousEnd);
      expect(l.content.split(section.content)).toHaveLength(2);
      previousEnd = index + section.content.length;
    }
    expect(l.content).not.toContain(
      "Please refer to that tab for the complete text"
    );
    expect(plain(l.content)).not.toContain(
      "Initiation of fraudulent chargebacks for membership fees"
    );
  });
});

const changedSections = new Set([
  1, 2, 6, 11, 15, 16, 21, 26, 30, 34, 42, 43, 44,
]);
const replacedPrefixes: Record<number, string[]> = {
  6: ["6.2", "6.4", "6.7"],
  11: ["11.4"],
  16: [
    "16.3.1",
    "16.6.1",
    "16.7.1",
    "16.7.2",
    "16.7.3",
    "16.9.1",
    "16.9.2",
    "16.10.1",
    "16.10.2",
    "16.10.3",
    "16.10.4",
    "16.11.1",
  ],
  21: ["21.1"],
  26: ["26.4.2", "26.4.3"],
  30: ["30.1", "30.4"],
  34: ["34.7"],
  42: ["42.5"],
  43: ["43.2", "43.3", "43.7", "43.8", "43.10"],
};

describe("staged terms review: complete unaffected baseline retention", () => {
  it("retains all 49 stable section titles and section order", () => {
    const draft = makeTermsReviewDraft();
    expect(draft.terms).toHaveLength(49);
    expect(draft.terms.map(s => s.title)).toEqual(
      FULL_TERMS_SECTIONS.map(s => s.title)
    );
    expect(draft.conduct.map(s => s.title)).toEqual(
      CODE_OF_CONDUCT_SECTIONS.map(s => s.title)
    );
    expect(
      draft.appendices.map(s => s.title.replace(/^Appendix ([A-L]):.*/, "$1"))
    ).toEqual("ABCDEFGHIJKL".split(""));
    for (const [index, section] of FULL_TERMS_SECTIONS.entries()) {
      if (!changedSections.has(index + 1))
        expect(draft.terms[index]).toEqual(section);
    }
    for (const section of CODE_OF_CONDUCT_SECTIONS) {
      if (section.title !== "3. Fraud and Misrepresentation")
        expect(draft.conduct.find(s => s.title === section.title)).toEqual(
          section
        );
    }
    for (const letter of ["B", "C", "F", "I", "K"])
      expect(appendix(letter)).toEqual(baseAppendix(letter));
    for (const section of APPENDIX_SECTIONS) {
      if (!section.title.startsWith("Appendix J:"))
        expect(
          draft.appendices.find(s => s.title === section.title)?.title
        ).toBe(section.title);
    }
  });
  it("preserves every unaffected paragraph within changed numbered sections", () => {
    for (const [number, prefixes] of Object.entries(replacedPrefixes)) {
      const n = Number(number);
      for (const p of paragraphs(baseTerm(n).content)) {
        // 16.4 and 16.8 are unnumbered baseline heading/body spans replaced in full.
        if (n === 16 && !/^16\./.test(plain(p))) continue;
        if (prefixes.some(prefix => startsWithClause(p, prefix))) continue;
        expect(
          term(n).content,
          `unaffected paragraph retained in section ${n}: ${plain(p).slice(0, 60)}`
        ).toContain(p);
      }
    }
    for (const p of paragraphs(baseTerm(2).content)) {
      if (
        plain(p).startsWith('"Detrimental Pricing"') ||
        plain(p).startsWith('"Misconduct"')
      )
        continue;
      expect(term(2).content).toContain(p);
    }
    for (const p of paragraphs(baseTerm(44).content))
      expect(term(44).content).toContain(p);
    const baselineFraud = CODE_OF_CONDUCT_SECTIONS.find(
      s => s.title === "3. Fraud and Misrepresentation"
    )!;
    const draftFraud = makeTermsReviewDraft().conduct.find(
      s => s.title === baselineFraud.title
    )!;
    for (const p of paragraphs(baselineFraud.content)) {
      if (!startsWithClause(p, "3.2.1.5"))
        expect(draftFraud.content).toContain(p);
    }
  });
  it("retains every unaffected appendix paragraph and team-member list exactly", () => {
    for (const [letter, replaced] of [
      ["A", ["2.", "4.", "5.", "6."]],
      ["G", ["1.", "2.", "5."]],
      ["D", ["2."]],
    ] as [string, string[]][]) {
      for (const p of paragraphs(baseAppendix(letter).content)) {
        if (replaced.some(prefix => startsWithClause(p, prefix))) continue;
        expect(appendix(letter).content).toContain(p);
      }
    }
    const teamMemberList =
      baseAppendix("A").content.match(/<ul>[\s\S]*?<\/ul>/g)![1];
    expect(appendix("A").content).toContain(teamMemberList);
    expect(term(16).content).toContain(
      clauseParagraph(baseTerm(16).content, "16.6.2")
    );
    expect(term(49)).toEqual(baseTerm(49));
  });
  it("retains existing h3 anchors outside rewritten Section 15", () => {
    for (const [index, section] of FULL_TERMS_SECTIONS.entries()) {
      if (index + 1 === 15) continue;
      for (const anchor of section.content.match(/<h3\b[^>]*>/g) ?? [])
        expect(term(index + 1).content).toContain(anchor);
    }
  });
  it("protects the £697 joining fee, £150 team-member charge, 47% uplift and optional insurance", () => {
    expect(appendix("A").content).toContain(
      clauseParagraph(baseAppendix("A").content, "1.")
    );
    expect(plain(appendix("A").content)).toContain("£697.00");
    expect(plain(appendix("A").content)).toContain("£150 per agent");
    expect(plain(appendix("A").content)).toContain("47%");
    expect(term(6).content).toContain(
      clauseParagraph(baseTerm(6).content, "6.3")
    );
    expect(term(13)).toEqual(baseTerm(13));
    expect(appendix("B")).toEqual(baseAppendix("B"));
    expect(JSON.stringify(makeTermsReviewDraft())).not.toContain("£297");
  });
  it("retains all commission-eligibility conditions and signed-agreement variation safeguards", () => {
    for (const [n, clauses] of [
      [26, ["26.4.1", "26.5", "26.6"]],
      [21, ["21.3"]],
      [11, ["11.2", "11.3"]],
      [30, ["30.2"]],
      [42, ["42.0"]],
    ] as [number, string[]][]) {
      for (const clause of clauses)
        expect(term(n).content).toContain(
          clauseParagraph(baseTerm(n).content, clause)
        );
    }
    expect(term(25)).toEqual(baseTerm(25));
    expect(term(27)).toEqual(baseTerm(27));
    expect(plain(term(26).content)).toContain(
      "all relevant suppliers have been paid in full"
    );
    expect(plain(term(26).content)).toContain(
      "the departure date is no more than 12 weeks away"
    );
    expect(plain(term(42).content)).toContain(
      "before any deposit is paid or booking confirmed"
    );
    // Actual published terms body has no embedded link; the staging review must
    // retain the official brief's URL, not an older host or a reconstructed link.
    expect(
      readFileSync(
        resolve(
          process.cwd(),
          "client/src/pages/admin/TermsRevisionReview.tsx"
        ),
        "utf8"
      )
    ).toContain("https://hub.thejltgroup.co.uk/bookingterms");
  });
  it("preserves compliance text until approval, not a fabricated CAA Schedule", () => {
    const oldIntroduction = plain(clauseParagraph(baseTerm(1).content, "1.1"));
    const entityAndMembership = oldIntroduction.slice(
      0,
      oldIntroduction.indexOf("All client bookings")
    );
    expect(plain(term(1).content)).toContain(compact(entityAndMembership));
    expect(plain(term(1).content)).toContain(
      expected(
        "### Clause 1.1 — financial-protection wording: legal approval required"
      )
    );
    expect(term(1).content).toContain(
      clauseParagraph(baseTerm(1).content, "1.2")
    );
    expect(term(10)).toEqual(baseTerm(10));
    for (const clause of ["6.8", "6.9"])
      expect(term(6).content).toContain(
        clauseParagraph(baseTerm(6).content, clause)
      );
    expect(appendix("I")).toEqual(baseAppendix("I"));
    const conduct5 = makeTermsReviewDraft().conduct.find(
      s => s.title === "5. Transparency and Honesty"
    )!;
    expect(conduct5).toEqual(
      CODE_OF_CONDUCT_SECTIONS.find(s => s.title === conduct5.title)
    );
    expect(appendix("H").content).toContain(baseAppendix("H").content);
    for (const reference of [
      "10",
      "6.8",
      "6.9",
      "Appendix H",
      "Appendix I",
      "Code of Conduct 5.2",
    ]) {
      expect(
        makeTermsReviewDraft().unchangedComplianceReferences.join(" ")
      ).toContain(reference);
    }
  });
  it("changes only the consent deadline, not unrelated retained evidence deadlines", () => {
    expect(plain(clauseParagraph(term(11).content, "11.4"))).toContain(
      "within 10 business days of receiving the request"
    );
    for (const [index, section] of FULL_TERMS_SECTIONS.entries()) {
      if (index + 1 === 11 || index + 1 === 15) continue;
      for (const p of paragraphs(section.content)) {
        if (/5 business days|five business days/i.test(plain(p)))
          expect(term(index + 1).content).toContain(p);
      }
    }
  });
});

describe("staged terms review: semantic removals, approvals and isolation", () => {
  it("uses only the supplied Section 15 numbering and deletes all obsolete nested references", () => {
    const html = term(15).content;
    expect(compact(paragraphs(html).map(plain).join(" "))).toBe(
      expected("### Replace Section 15 in full")
    );
    const clauses = paragraphs(html).map(
      p => plain(p).match(/^(15\.\d+A?)\b/)?.[1]
    );
    expect(clauses).toEqual([
      "15.1",
      "15.1A",
      ...Array.from({ length: 12 }, (_, i) => `15.${i + 2}`),
    ]);
    const draft = makeTermsReviewDraft();
    for (const section of [
      ...draft.terms,
      ...draft.conduct,
      ...draft.appendices,
    ]) {
      expect(section.content, section.title).not.toMatch(/\b15\.\d+A?\.\d+\b/);
    }
    expect(plain(html)).not.toContain("Before initiating any chargeback");
    expect(plain(html)).not.toContain("Prima facie evidence");
    expect(plain(html)).not.toContain(
      "You must forfeit any unpaid commissions"
    );
  });
  it("preserves each old top-level Section 15 anchor exactly once regardless of element type", () => {
    const oldIds = [...baseTerm(15).content.matchAll(/\bid="([^"]+)"/g)].map(
      m => m[1]
    );
    const draftIds = [...term(15).content.matchAll(/\bid="([^"]+)"/g)].map(
      m => m[1]
    );
    for (const id of oldIds)
      expect(
        draftIds.filter(value => value === id),
        id
      ).toHaveLength(1);
    expect(new Set(draftIds).size).toBe(draftIds.length);
  });
  it("removes operative old fees without banning amounts expressly negated by the new text", () => {
    const draft = makeTermsReviewDraft();
    const text = plain(
      [...draft.terms, ...draft.appendices, ...draft.conduct]
        .map(s => s.content)
        .join(" ")
    );
    expect(text).not.toContain("£25 per recovery attempt");
    expect(text).not.toContain("Management time calculated at £75 per hour");
    expect(text).not.toContain("£50 per chargeback processed");
    expect(text).not.toContain(
      "liquidated damages to The JLT Group in the amount of £500"
    );
    expect(text).not.toContain(
      "successful collection of two standard monthly payments"
    );
    expect(plain(term(15).content)).toContain(
      "No fixed £50 chargeback fee, £75 hourly management charge or £500 liquidated damages applies."
    );
    expect(plain(term(6).content)).toContain(
      "This replaces the previous £25-per-recovery-attempt fee."
    );
  });
  it("removes all legacy margin tiers and blanket approval controls", () => {
    const marginText = plain(
      [term(2).content, term(43).content, appendix("J").content].join(" ")
    );
    for (const legacy of [
      "Minimum Margin Standards",
      "Minimum Margin Requirements",
      "£50 per booking",
      "£100 per booking",
      "£300 per booking",
      "Minimum margin of 5%",
      "Minimum margin of 7%",
      "Minimum margin of 3%",
      "6% gross excluding VAT on commission",
      "£5,000",
      "£50,000",
      "prior approval is obtained",
    ])
      expect(marginText).not.toContain(legacy);
    expect(plain(term(43).content)).toContain("inclusive of VAT and fees");
    expect(plain(term(43).content)).toContain(
      "not a separate minimum for every booking"
    );
    expect(plain(appendix("J").content)).toContain(
      "exempt from the monthly-average requirement during their probationary period"
    );
  });
  it("does not retain a large/complex-booking approval distinction or ask again about resolved weighting", () => {
    const draft = makeTermsReviewDraft();
    expect(draft.approvals.map(a => a.id)).not.toContain("exceptional-pricing");
    const margin = draft.approvals.find(a => a.id === "margin-calculation")!;
    expect(margin).toBeTruthy();
    expect(margin.details).toMatch(/Personal Bookings|voucher/i);
    expect(margin.details).not.toMatch(
      /Confirm booking-weighted or value-weighted|whether.*value.weighted/i
    );
    expect(draft.changes.map(c => c.summary).join(" ")).toMatch(
      /value.weighted/i
    );
    expect(draft.changes.map(c => c.summary).join(" ")).toMatch(
      /gross commission margin/i
    );
  });
  it("explicitly excludes honest payment disputes from Misconduct while preserving actual fraud remedies", () => {
    const definition = paragraphs(term(2).content)
      .map(plain)
      .find(p => p.startsWith('"Misconduct"'))!;
    expect(definition).toBeTruthy();
    expect(definition).toContain(
      "A dispute or refund request is not, by itself, fraud or Misconduct."
    );
    expect(plain(term(15).content)).toContain(
      "A dispute or refund request is not, by itself, fraud or Misconduct."
    );
    expect(plain(term(15).content)).toContain(
      "This Section creates no automatic commission forfeiture merely because a bank claim is made."
    );
  });
  it("is unambiguously an unpublished staging version with no invented dates or approvals", () => {
    const draft = makeTermsReviewDraft();
    expect(draft.id).toBe("2026-11-12-clause-and-appendix-review");
    expect(draft.status).toBe("draft_not_published");
    expect(draft.preparedDate).toBe("2026-11-12");
    expect(draft.publishedBaseline).toBe("May 2026");
    expect(draft.publicationDate).toBeNull();
    expect(draft.effectiveDate).toBeNull();
    expect(draft.approvals.length).toBeGreaterThanOrEqual(7);
    for (const approval of draft.approvals)
      expect(approval.status).toBe("pending");
    const approvals = draft.approvals
      .map(a => `${a.title} ${a.details} ${a.references.join(" ")}`)
      .join(" ");
    for (const required of [
      /CAA|ATOL/i,
      /10A/,
      /10B/,
      /calculation/i,
      /voucher/i,
      /covenant|start date/i,
      /2%/,
      /liability|indemnit/i,
      /financial.protection/i,
      /6\.8/,
      /6\.9/,
      /Appendix H/,
      /Appendix I/,
      /5\.2/,
    ])
      expect(approvals).toMatch(required);
    expect(draft.changes.length).toBeGreaterThan(0);
    expect(draft.notice).toMatch(/draft|staging/i);
    expect(draft.notice).toMatch(/signed|acceptance/i);
    expect(draft.notice).toMatch(/not.*publish|unpublished/i);
  });
  it("fingerprints the actual baseline arrays and never changes the published source file", () => {
    expect(hash(baseline)).toBe(BASELINE_ARRAY_SHA);
    const file = readFileSync(
      resolve(process.cwd(), "client/src/pages/policyData.ts")
    );
    expect(createHash("sha256").update(file).digest("hex")).toBe(
      BASELINE_FILE_SHA
    );
    const first = makeTermsReviewDraft();
    const second = makeTermsReviewDraft();
    expect(first.baselineSha256).toBe(hash(baseline));
    expect(first.draftSha256).toBe(
      hash({
        terms: first.terms,
        conduct: first.conduct,
        appendices: first.appendices,
      })
    );
    expect(second).toEqual(first);
    expect(JSON.stringify(baseline)).toBe(initialBaseline);
    expect(hash(baseline)).toBe(BASELINE_ARRAY_SHA);
  });
  it("fails closed if the in-memory public baseline changes, and restores the synthetic test mutation", () => {
    const original = FULL_TERMS_SECTIONS[0].content;
    try {
      FULL_TERMS_SECTIONS[0].content = "synthetic baseline divergence";
      expect(() => makeTermsReviewDraft()).toThrow(/baseline has changed/i);
    } finally {
      FULL_TERMS_SECTIONS[0].content = original;
    }
    expect(JSON.stringify(baseline)).toBe(initialBaseline);
    expect(hash(baseline)).toBe(BASELINE_ARRAY_SHA);
    expect(makeTermsReviewDraft().baselineSha256).toBe(BASELINE_ARRAY_SHA);
  });
  it("isolates all returned arrays, nested metadata and section objects from later calls", () => {
    const untouched = makeTermsReviewDraft();
    const altered = makeTermsReviewDraft();
    altered.terms[0].content = "synthetic mutation";
    altered.terms[0].title = "synthetic mutation";
    altered.terms.pop();
    altered.conduct[0].content = "synthetic mutation";
    altered.appendices[0].content = "synthetic mutation";
    altered.changes[0].references.push("synthetic mutation");
    altered.changes[0].summary = "synthetic mutation";
    altered.approvals[0].references.push("synthetic mutation");
    altered.approvals[0].details = "synthetic mutation";
    altered.unchangedComplianceReferences.push("synthetic mutation");
    altered.notice = "synthetic mutation";
    expect(makeTermsReviewDraft()).toEqual(untouched);
    expect(JSON.stringify(baseline)).toBe(initialBaseline);
    expect(hash(baseline)).toBe(BASELINE_ARRAY_SHA);
  });
});
