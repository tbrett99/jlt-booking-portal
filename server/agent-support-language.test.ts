import { describe, expect, it, vi } from "vitest";
import { maskGenericDocumentRequirementClauses, normalizeSupportRewriteNoun } from "./agent-support-language";
import { safeStoredSupportText, screenSupportInput } from "./agent-support-privacy";
import { generateSupportTurn, type SupportModelInvoker } from "./agent-support-generation";
import { AGENT_PORTAL_PROCEDURE_SOURCES } from "./agent-support-portal-procedures";

const source = AGENT_PORTAL_PROCEDURE_SOURCES[0];
const evidence = "Before continuing, have the required supporting documents ready: a confirmation or invoice showing the supplier name, client name and amount paid; and proof of payment that matches the supplier and amount and shows the payment has cleared. A payment still shown as pending is not accepted.";
function claim(id: number, text: string) { return { id, section: "direct_answer", text, evidence: [{ citationIndex: 1, quote: evidence }] }; }
function candidate(wording: string) {
  return { disposition: "answered", clarification: null, claims: [claim(1, "A confirmation or invoice must show the supplier name and amount paid."), claim(2, wording), claim(3, "Proof of payment must match the supplier and amount and show the payment has cleared; pending payment is not accepted.")] };
}
function verdict() {
  return { claimResults: [1, 2, 3].map(claimId => ({ claimId, supported: true, retainsMaterialExceptions: true, safe: true })), answerRetainsMaterialExceptions: true, missingConditions: [] as any[], dispositionAppropriate: true, clarification: null };
}
function invoker(...values: unknown[]) {
  const invoke = vi.fn<SupportModelInvoker>();
  for (const value of values) invoke.mockResolvedValueOnce({ id: "synthetic", created: 0, model: "gpt-5-mini", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(value) } }] });
  return invoke;
}
const question = "what docs do i need for a reimbursment";

const generic = [
  "The client name is required on the confirmation or invoice.",
  "Client name: required on the confirmation or invoice.",
  "The client name must be shown on the invoice.",
  "The client name must be included in the supplier confirmation.",
  "Client name is required.",
];
const privateVariants = [
  "The client name is Synthetic Person.",
  "Client name: Synthetic Person.",
  "The client name is required on the invoice for Synthetic Person.",
  "Client name: required on the invoice, Synthetic Person.",
  "Client name: required on the confirmation or invoice (Synthetic Person).",
  "The client name is required on the invoice; my client is Synthetic Person.",
  "The client name is required on the invoice. The client name is Synthetic Person.",
  "The client name is required on the invoice. Email customer@example.test.",
  "The client name is required on the invoice; booking ref AB1234.",
  "The client name is required on the invoice; payment PM01ABCDEFGHIJKL.",
  "The client name is required on the invoice; bank account number: 12345678.",
];

describe("closed generic document wording — output only, no private values", () => {
  it.each(generic)("accepts fully sourced generic field wording through independent verification: %s", async wording => {
    const invoke = invoker(candidate(wording), verdict());
    const result = await generateSupportTurn({ question, history: [], sources: [source] }, invoke);
    expect(result.disposition).toBe("answered");
    expect(result.verified).toBe(true);
    expect(result.answer).toContain(wording);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(safeStoredSupportText(result.answer, true, true)).toBe(result.answer);
    const payload = JSON.parse(invoke.mock.calls[1][0].messages[2].content as string);
    expect(payload.untrustedCandidate.claims[1].text).toBe(wording);
    expect(payload.untrustedCandidate.claims[1].evidence[0].quote).toBe(evidence);
  });
  it.each(privateVariants)("does not allow private values or appended private content: %s", async wording => {
    const invoke = invoker(candidate(wording));
    const result = await generateSupportTurn({ question, history: [], sources: [source] }, invoke);
    expect(result.disposition).toBe("validation_failed");
    expect(result.validationDiagnostic).toBe("output_safety");
    expect(result.sources).toEqual([]);
    expect(result.answer).not.toContain("Synthetic Person");
    expect(safeStoredSupportText(wording, true)).toContain("Private details omitted");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("does not mask prefixes ending in private values or an incomplete clause", () => {
    for (const wording of privateVariants.slice(0, 5)) expect(maskGenericDocumentRequirementClauses(wording)).toBe(wording);
  });
  it("keeps ingress screening unchanged even when wording looks generic", () => {
    for (const wording of generic.slice(0, 2)) {
      expect(screenSupportInput(wording).safe).toBe(false);
      expect(safeStoredSupportText(wording, false)).toContain("Private details omitted");
    }
    for (const wording of privateVariants) expect(screenSupportInput(wording).safe).toBe(false);
  });
  it("recognizes only an evidence requirement, not an asserted individual payment outcome", async () => {
    const wording = "Proof of payment must show that your payment has cleared.";
    const good = candidate("The client name is required on the invoice.");
    good.claims[2].text = wording;
    good.claims.push(claim(4, "The proof must match the supplier and amount; pending payment is not accepted."));
    const checked = verdict();
    checked.claimResults.push({ claimId: 4, supported: true, retainsMaterialExceptions: true, safe: true });
    const invoke = invoker(good, checked);
    const result = await generateSupportTurn({ question, history: [], sources: [source] }, invoke);
    expect(result.verified).toBe(true);
    for (const unsafe of ["Your payment has cleared.", "Proof of payment shows that your payment has cleared.", "Proof of payment must show that your payment has cleared for booking ref AB1234."]) {
      const bad = candidate(unsafe);
      const reject = invoker(bad);
      const withheld = await generateSupportTurn({ question, history: [], sources: [source] }, reject);
      expect(withheld.disposition).toBe("validation_failed");
      expect(withheld.validationDiagnostic).toBe("output_safety");
    }
  });
  it("never treats grammatical normalization as proof or bypasses missing evidence and verification", async () => {
    const wording = generic[0];
    const forged = candidate(wording);
    forged.claims[1].evidence[0].quote = "No such source quote exists.";
    const mismatch = await generateSupportTurn({ question, history: [], sources: [source] }, invoker(forged));
    expect(mismatch.validationDiagnostic).toBe("evidence_mismatch");
    const checked = verdict(); checked.claimResults[1].supported = false;
    const rejected = await generateSupportTurn({ question, history: [], sources: [source] }, invoker(candidate(wording), checked));
    expect(rejected.validationDiagnostic).toBe("claim_not_supported");
    expect(rejected.verified).toBe(false);
    expect(rejected.sources).toEqual([]);
  });
  it("never permits markup, arbitrary navigation or citations in a normalized requirement", async () => {
    for (const suffix of [" <script>bad()</script>", " https://evil.example.test", " [S999]", " &lt;script&gt;"]) {
      const result = await generateSupportTurn({ question, history: [], sources: [source] }, invoker(candidate(generic[0] + suffix)));
      expect(result.validationDiagnostic).toBe("output_safety");
    }
  });
  it("preserves NUL removal and normal stored-text trimming", () => {
    expect(safeStoredSupportText("  Safe generic\u0000text. ", true)).toBe("Safe generictext.");
  });
});

describe("history vocabulary permits nouns/spelling, never new facts, statuses or topics", () => {
  it.each([
    "What documents do I need for a reimbursment?",
    "What docs do I need for a reimbursement?",
    "What documentation is required for a reimbursement?",
    "What documents do I need for reimbursements?",
  ])("accepts reviewed normalization with screened history: %s", resolvedQuestion => {
    return (async () => {
      const invoke = invoker({ disposition: "resolved", question: resolvedQuestion, priorUserIndices: [] }, candidate(generic[0]), verdict());
      const result = await generateSupportTurn({ question, history: [{ role: "user", content: "How do reimbursements work?" }], sources: [source] }, invoke);
      expect(result.verified).toBe(true);
      expect(invoke).toHaveBeenCalledTimes(3);
      expect(JSON.parse(invoke.mock.calls[1][0].messages[2].content as string).resolvedQuestion).toBe(resolvedQuestion);
    })();
  });
  it.each([
    "What documents do I need for a refund?",
    "What documents do I need for a reimbursement approved yesterday?",
    "What documents do I need for a reimbursement of 400 pounds?",
    "What documents do I need for a cleared reimbursement?",
    "What documents do I need for a commission claim?",
    "What docs do I need for a reimbursement fee?",
  ])("rejects unsupplied topic/status/amount words: %s", resolvedQuestion => {
    return (async () => {
      const invoke = invoker({ disposition: "resolved", question: resolvedQuestion, priorUserIndices: [] });
      const result = await generateSupportTurn({ question, history: [{ role: "user", content: "How do reimbursements work?" }], sources: [source] }, invoke);
      expect(result.validationDiagnostic).toBe("context_provenance");
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(result.sources).toEqual([]);
    })();
  });
  it("does not borrow evidence from a prior user turn the contextualizer did not select", async () => {
    const invoke = invoker({ disposition: "resolved", question: "What reimbursement documents are required for a payment still pending?", priorUserIndices: [] });
    const result = await generateSupportTurn({ question, history: [{ role: "user", content: "The payment still says pending." }], sources: [source] }, invoke);
    expect(result.validationDiagnostic).toBe("context_provenance");
  });
  it("keeps unrelated exact words, numbers and payment statuses out of noun normalization", () => {
    for (const word of ["refund", "paid", "pending", "cleared", "approved", "reimbursed", "400", "john", "compliant"]) expect(normalizeSupportRewriteNoun(word)).toBe(word);
    expect(normalizeSupportRewriteNoun("reimbursment")).toBe("reimbursement");
    expect(normalizeSupportRewriteNoun("docs")).toBe("document");
  });
});

describe("allowlisted content-free verification diagnostics", () => {
  it.each([
    ["conditions_missing", { answerRetainsMaterialExceptions: false, missingConditions: [{ evidenceId: "E1", target: "question_checklist", claimId: null, relation: "document_field" }] }],
    ["relevance_failed", { dispositionAppropriate: false }],
    ["verification_contract", { claimResults: [] }],
    ["clarification_failed", { clarification: { safe: true, needed: true, noUnstatedAssumptions: true } }],
  ])("withholds for %s and returns only the code", async (code, override) => {
    const invoke = invoker(candidate(generic[0]), { ...verdict(), ...override });
    const result = await generateSupportTurn({ question, history: [], sources: [source] }, invoke);
    expect(result.validationDiagnostic).toBe(code);
    expect(result.unresolvedReason).toBe("support_validation_failed");
    expect(result.verified).toBe(false);
    expect(result.sources).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("client name is required");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["supported", "claim_not_supported"],
    ["retainsMaterialExceptions", "conditions_missing"],
    ["safe", "verification_safety"],
  ])("continues rejecting negative per-claim flag %s", async (flag, code) => {
    const checked = verdict();
    (checked.claimResults[1] as Record<string, unknown>)[flag] = false;
    if (flag === "retainsMaterialExceptions") checked.missingConditions = [{ evidenceId: "E1", target: "claim", claimId: 2, relation: "document_field" }];
    const result = await generateSupportTurn({ question, history: [], sources: [source] }, invoker(candidate(generic[0]), checked));
    expect(result.validationDiagnostic).toBe(code);
    expect(result.verified).toBe(false);
  });
  it("rejects malformed generator and contextualizer contracts without forwarding their strings", async () => {
    const bad = "MODEL_PRIVATE_SENTINEL";
    const result = await generateSupportTurn({ question, history: [], sources: [source] }, invoker({ leaked: bad }));
    expect(result.validationDiagnostic).toBe("generation_contract");
    expect(JSON.stringify(result)).not.toContain(bad);
    const context = await generateSupportTurn({ question, history: [{ role: "user", content: "How do reimbursements work?" }], sources: [source] }, invoker({ leaked: bad }));
    expect(context.validationDiagnostic).toBe("context_contract");
    expect(JSON.stringify(context)).not.toContain(bad);
  });
});

describe("independent security review regressions", () => {
  it.each([
    "Client name: required on the invoice. Actual value: Synthetic Person.",
    "Client name: required on the invoice. It is Synthetic Person.",
    "Client name: required on the confirmation or invoice. Actual value: Synthetic Person.",
    "The client name is required on the invoice. Actual value: Synthetic Person.",
  ])("does not erase a privacy anchor before an appended name: %s", async text => {
    expect(maskGenericDocumentRequirementClauses(text)).toBe(text);
    expect(safeStoredSupportText(text, true)).toContain("Private details omitted");
    const result = await generateSupportTurn({ question, history: [], sources: [source] }, invoker(candidate(text)));
    expect(result.validationDiagnostic).toBe("output_safety");
  });
  it.each(["invoiced", "documented", "receipted", "enjoyment", "lesions", "modulus"])("does not reinterpret a real word as a noun: %s", word => {
    expect(normalizeSupportRewriteNoun(word)).toBe(word);
  });
  it.each([
    ["What invoice documents are required for reimbursement?", "Is my reimbursement invoiced?"],
    ["What documents are required for reimbursement?", "Is my reimbursement documented?"],
    ["What enjoyment is required for reimbursement?", "What enrolment is required for reimbursement?"],
  ])("blocks unsupplied outcomes/topics from %s", async (current, rewritten) => {
    const invoke = invoker({ disposition: "resolved", question: rewritten, priorUserIndices: [] });
    const result = await generateSupportTurn({ question: current, history: [{ role: "user", content: "How do reimbursements work?" }], sources: [source] }, invoke);
    expect(result.validationDiagnostic).toBe("context_provenance");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("server-issued evidence references — quotes remain exact and source-bound", () => {
  function byReference(text: string, evidenceId = "E1") {
    return { disposition: "answered", clarification: null, claims: [{ id: 1, section: "direct_answer", text, evidence: [{ evidenceId }] }] };
  }
  function oneVerdict(overrides = {}) {
    return { claimResults: [{ claimId: 1, supported: true, retainsMaterialExceptions: true, safe: true }], answerRetainsMaterialExceptions: true, missingConditions: [] as any[], dispositionAppropriate: true, clarification: null, ...overrides };
  }
  it("expands only the selected real source passage before exact semantic verification", async () => {
    const text = "Provide a supplier confirmation or invoice showing supplier name, client name and amount paid, and proof of payment matching supplier and amount that has cleared; pending payment is not accepted.";
    const invoke = invoker(byReference(text), oneVerdict());
    const result = await generateSupportTurn({ question, history: [], sources: [source] }, invoke);
    expect(result.verified).toBe(true);
    const generation = JSON.parse(invoke.mock.calls[0][0].messages[2].content as string);
    const verification = JSON.parse(invoke.mock.calls[1][0].messages[2].content as string);
    expect(generation.untrustedEvidenceExcerpts[0].evidenceId).toBe("E1");
    expect(verification.untrustedCandidate.claims[0].evidence).toEqual([{ citationIndex: 1, quote: generation.untrustedEvidenceExcerpts[0].text }]);
    expect(verification.untrustedCandidate.claims[0].text).toBe(text);
    expect(invoke.mock.calls[0][0].response_format?.type).toBe("json_schema");
    const schema = (invoke.mock.calls[0][0].response_format as any).json_schema.schema;
    expect(JSON.stringify(schema)).toContain("evidenceId");
    expect(JSON.stringify(schema)).not.toContain('"quote"');
  });
  it("refuses fabricated, unselected or malformed evidence IDs without verification", async () => {
    for (const evidenceId of ["E999", "E0", "E-1", "E1 https://evil.test", "PRIVATE_VALUE"]) {
      const invoke = invoker(byReference("A confirmation or invoice is required.", evidenceId));
      const result = await generateSupportTurn({ question, history: [], sources: [source] }, invoke);
      expect(result.disposition).toBe("validation_failed");
      expect(result.sources).toEqual([]);
      expect(invoke).toHaveBeenCalledTimes(1);
    }
  });
  it("an existing evidence ID is not permission to make an unsupported claim", async () => {
    const checked = oneVerdict(); checked.claimResults[0].supported = false;
    const result = await generateSupportTurn({ question, history: [], sources: [source] }, invoker(byReference("Reimbursements are guaranteed tomorrow."), checked));
    expect(result.validationDiagnostic).toBe("claim_not_supported");
    expect(result.verified).toBe(false);
    expect(result.sources).toEqual([]);
  });
  it("keeps privacy screening and original raw markup guards for referenced claims", async () => {
    for (const text of ["Client name: Synthetic Person.", "Open booking > My Reimbursements.", "Open https://evil.test."]) {
      const result = await generateSupportTurn({ question, history: [], sources: [source] }, invoker(byReference(text)));
      expect(result.validationDiagnostic).toBe("output_safety");
    }
  });
  it("bounds exact reference excerpts and never combines disjoint source spans", async () => {
    const invoke = invoker(byReference("A confirmation or invoice is required."), oneVerdict());
    await generateSupportTurn({ question, history: [], sources: [source] }, invoke);
    const payload = JSON.parse(invoke.mock.calls[0][0].messages[2].content as string);
    const chunk = payload.untrustedSourcePassages[0].text;
    expect(payload.untrustedEvidenceExcerpts.length).toBeLessThanOrEqual(120);
    for (const excerpt of payload.untrustedEvidenceExcerpts) {
      expect(excerpt.text.length).toBeGreaterThanOrEqual(8);
      expect(excerpt.text.length).toBeLessThanOrEqual(1400);
      expect(chunk.includes(excerpt.text)).toBe(true);
      expect(excerpt.citationIndex).toBe(1);
    }
  });
});

describe("verified-history-only requirement normalization", () => {
  it("never normalizes arbitrary or legacy assistant text without verified-output metadata", () => {
    for (const text of ["Client name: required on the invoice.", "Client name: required on the invoice.\nActual value: Synthetic Person."]) {
      expect(safeStoredSupportText(text, true)).toContain("Private details omitted");
      expect(safeStoredSupportText(text, true, false)).toContain("Private details omitted");
    }
    expect(safeStoredSupportText("Client name: required on the invoice.", true, true)).toBe("Client name: required on the invoice.");
  });

  it.each(["!", ".", "?"])("preserves a verified closed %s requirement through actual generation, rendering and storage", async punctuation => {
    const wording = `Client name: required on the invoice${punctuation}`;
    const invoke = invoker(candidate(wording), verdict());
    const result = await generateSupportTurn({ question, history: [], sources: [source] }, invoke);
    const renderedWording = punctuation === "!" ? "Client name: required on the invoice\\!" : wording;
    expect(result).toMatchObject({ disposition: "answered", verified: true });
    expect(result.answer).toContain(`- ${renderedWording} [S1]`);
    expect(invoke).toHaveBeenCalledTimes(2);
    const verification = JSON.parse(invoke.mock.calls[1][0].messages[2].content as string);
    expect(verification.untrustedCandidate.claims[1].text).toBe(wording);
    expect(safeStoredSupportText(result.answer, true, result.verified)).toBe(result.answer);
    expect(safeStoredSupportText(result.answer, true)).toContain("Private details omitted");
    expect(safeStoredSupportText(result.answer, true, false)).toContain("Private details omitted");
    expect(safeStoredSupportText(result.answer, false, true)).toContain("Private details omitted");
  });

  it("recognizes the exact renderer-escaped exclamation without unescaping stored text", () => {
    const text = "**Direct answer**\n\n- Client name: required on the invoice\\! [S1]";
    expect(maskGenericDocumentRequirementClauses(text)).toBe("**Direct answer**\n\ngeneric document field requirement");
    expect(safeStoredSupportText(text, true, true)).toBe(text);
    expect(safeStoredSupportText(text, true, false)).toContain("Private details omitted");
    expect(screenSupportInput(text).safe).toBe(false);
  });

  it.each(["\\.", "\\?", "\\*", "\\\\!"])("does not generally unescape Markdown suffix %s", suffix => {
    const text = `- Client name: required on the invoice${suffix} [S1]`;
    expect(maskGenericDocumentRequirementClauses(text)).toBe(text);
    expect(safeStoredSupportText(text, true, true)).toContain("Private details omitted");
  });

  it.each([
    "Client name: required on the invoice Synthetic Person\\! [S1]",
    "Client name: required on the invoice\\! Synthetic Person. [S1]",
    "Client name: required on the invoice for Synthetic Person\\! [S1]",
    "Client name: required on the invoice\\! Actual value: Synthetic Person. [S1]",
    "The client name is Synthetic Person.\n- Client name: required on the invoice\\! [S1]",
    "- Client name: required on the invoice\\! [S1]\nThe client name is Synthetic Person.",
    "booking reference: ABCD-123\n- Client name: required on the invoice\\! [S1]",
    "- Client name: required on the invoice\\! [S1]\nbooking reference: ABCD-123",
    "Client name: required on the invoice; payment PM01ABCDEFGHIJKL\\! [S1]",
    "Client name: required on the invoice\\!; payment PM01ABCDEFGHIJKL [S1]",
    "customer@example.test\n- Client name: required on the invoice\\! [S1]",
    "- Client name: required on the invoice\\! [S1]\ncustomer@example.test",
  ])("still suppresses private names/identifiers before or after escaped punctuation: %s", text => {
    expect(safeStoredSupportText(text, true, true)).toContain("Private details omitted");
    expect(safeStoredSupportText(text, true, false)).toContain("Private details omitted");
    expect(screenSupportInput(text).safe).toBe(false);
  });
});
