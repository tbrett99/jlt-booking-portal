import { describe, expect, it } from "vitest";
import {
  safeStoredSupportText,
  screenSupportInput,
  SUPPORT_PRIVACY_MESSAGE,
} from "./agent-support-privacy";

// Synthetic deterministic regression fixtures only. These are not staff-reviewed
// evaluation questions and do not establish comprehensive PII detection coverage.
const privateExamples = [
  ["email", "synthetic.client@example.test"],
  ["provider payment ID", "PM0123456789AB"],
  ["booking number", "booking reference: 123456789"],
  ["labelled booking reference", "booking reference: ABCD-123"],
  ["labelled client ID", "client id: CUST-A12"],
  ["labelled claim reference", "claim reference: CLM-AB12"],
  ["unpunctuated booking reference", "booking ref ABCD-123"],
  ["labelled payment reference", "payment ref=PAY-A12"],
  ["labelled case number", "case no. # CASE-A12"],
  ["labelled account number", "account number: ACCT-A12"],
  ["labelled customer ID", "customer ID: CUST-A12"],
  ["short labelled ID", "client id: A123"],
  ["alphabetic labelled ID", "booking reference: SYNTHETIC"],
  ["Orbit reference", "Orbit ref: A1234567"],
  ["PTS reference", "PTS reference: AB123456"],
  ["JLT identity", "JLT-123456"],
  ["IBAN", "GB82 WEST 1234 5698 7654 32"],
  ["card number", "4242 4242 4242 4242"],
  ["sort code", "12-34-56"],
  ["phone", "+44 7700 900123"],
  ["password", "password: synthetic-only-secret"],
  ["API credential", "sk_test_SYNTHETICONLY123"],
  ["access token", "access_token=synthetic-only-token"],
  ["client name", "my client is Synthetic Person"],
  ["explicit name", "customer name: Synthetic Person"],
] as const;
const wrappers = [
  (value: string) => value,
  (value: string) => `Please inspect ${value}.`,
  (value: string) => `How do I cancel?\n${value}\nPlease help.`,
  (value: string) => `  ${value}  `,
  (value: string) => `General process question; ${value}; more text`,
];
const unsafeCases = privateExamples.flatMap(([label, detail]) =>
  wrappers.map((wrap, index) => ({
    label: `${label}, wrapper ${index + 1}`,
    detail,
    input: wrap(detail),
  }))
);
const generalQuestions = [
  "How do I cancel a booking in Orbit?",
  "How do I request a reimbursement?",
  "What happens when a flight is cancelled?",
  "Where is the payment request form?",
  "What are the general refund procedures?",
  "Where can I find the supplier directory?",
  "How do I find an Academy course?",
  "Where can I read the published terms?",
  "Is the general fee £25?",
  "Was this procedure published on 2026-11-13?",
  "Was the general procedure published on 13/11/2026 with a £25 fee?",
  "booking reference",
  "client name",
  "account number",
  "Where is the booking reference field in the general procedure?",
  "Should the client name field be completed in the general process?",
  "Is the account number field required in the general procedure?",
  "What is a claim reference?",
] as const;
const safeCases = generalQuestions.flatMap((question, index) => [
  { label: `general ${index + 1}`, input: question, expected: question },
  {
    label: `trim ${index + 1}`,
    input: ` \n${question}\t `,
    expected: question,
  },
  {
    label: `nul ${index + 1}`,
    input: `\u0000${question}\u0000`,
    expected: question,
  },
  {
    label: `multiline ${index + 1}`,
    input: `${question}\nPlease explain the general process.`,
    expected: `${question}\nPlease explain the general process.`,
  },
  {
    label: `case ${index + 1}`,
    input: question.toLowerCase(),
    expected: question.toLowerCase(),
  },
]);

describe("support privacy — synthetic input regression fixtures", () => {
  it.each(unsafeCases)(
    "omits $label without returning the original private value",
    ({ input, detail }) => {
      const result = screenSupportInput(input);
      expect(result.safe).toBe(false);
      expect(result.reason).toBe("private_details_blocked");
      expect(result.text).toBe(
        "[Private details omitted. Please ask a general process question.]"
      );
      expect(JSON.stringify(result)).not.toContain(detail);
      expect(safeStoredSupportText(input)).toBe(result.text);
      expect(safeStoredSupportText(input, true)).toBe(result.text);
    }
  );

  it.each(safeCases)(
    "preserves $label as a general process question",
    ({ input, expected }) => {
      expect(screenSupportInput(input)).toEqual({
        safe: true,
        text: expected,
        reason: null,
      });
      expect(safeStoredSupportText(input)).toBe(expected);
    }
  );

  it("resets stateful regular expressions across repeated safe and unsafe calls", () => {
    for (let index = 0; index < 12; index++) {
      expect(screenSupportInput("synthetic.client@example.test").safe).toBe(
        false
      );
      expect(screenSupportInput("How do I request a refund?").safe).toBe(true);
    }
  });

  it.each([null, undefined, 123, {}, [], true])(
    "does not stringify non-text stored content (%j)",
    value => {
      expect(safeStoredSupportText(value)).toBe("This message is unavailable.");
    }
  );

  it("keeps the exact approved support mailto link in safe stored display", () => {
    expect(safeStoredSupportText(SUPPORT_PRIVACY_MESSAGE, true)).toBe(
      SUPPORT_PRIVACY_MESSAGE
    );
    expect(
      safeStoredSupportText(
        "Contact [JLT Support](mailto:support@thejltgroup.co.uk).",
        true
      )
    ).toBe("Contact [JLT Support](mailto:support@thejltgroup.co.uk).");
  });

  it.each([
    "Contact support@thejltgroup.co.uk for this case.",
    "[JLT Support](mailto:synthetic.client@example.test)",
    "[JLT Support](mailto:support@thejltgroup.co.uk?cc=synthetic.client@example.test)",
    "[JLT Support](mailto:support@thejltgroup.co.uk.evil.test)",
    "[JLT Support](mailto:support@thejltgroup.co.uk) booking reference: 123456789",
    "[JLT Support](mailto:support@thejltgroup.co.uk) booking reference: ABCD-123",
    "[JLT Support](mailto:support@thejltgroup.co.uk) client id: CUST-A12",
    "[JLT Support](mailto:support@thejltgroup.co.uk) claim reference: CLM-AB12",
  ])(
    "does not let a lookalike or combined contact bypass stored privacy screening (%s)",
    input => {
      expect(safeStoredSupportText(input, true)).toBe(
        "[Private details omitted. Please ask a general process question.]"
      );
    }
  );

  it("does not whitelist the support address for current user input", () => {
    expect(
      screenSupportInput("[JLT Support](mailto:support@thejltgroup.co.uk)").safe
    ).toBe(false);
    expect(safeStoredSupportText(SUPPORT_PRIVACY_MESSAGE, false)).toBe(
      "[Private details omitted. Please ask a general process question.]"
    );
  });
});
