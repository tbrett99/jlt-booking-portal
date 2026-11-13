import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { generateSupportTurn, type SupportModelInvoker } from "./agent-support-generation";
import { policySources } from "./agent-support-sources";
import { AGENT_PORTAL_PROCEDURE_SOURCES } from "./agent-support-portal-procedures";
import { normaliseAgentSupportText, retrieveAgentSupportChunks } from "./agent-support-utils";

const question = "what docs do I need for a reimbursement";
const sources = [...policySources(), ...AGENT_PORTAL_PROCEDURE_SOURCES];
const fullChecklist = "For every reimbursement item, provide a confirmation or invoice showing supplier name, client name and amount paid, and proof of payment matching the supplier and amount and showing cleared payment; pending payment is not accepted.";
function generated(text = fullChecklist) { return { disposition: "answered", clarification: null, claims: [{ id: 1, section: "direct_answer", text, evidence: [{ evidenceId: "E1" }] }] }; }
function verdict(overrides: Record<string, unknown> = {}) {
  return { claimResults: [{ claimId: 1, supported: true, retainsMaterialExceptions: true, safe: true }], answerRetainsMaterialExceptions: true, dispositionAppropriate: true, missingConditions: [], clarification: null, ...overrides };
}
function response(value: unknown) { return { id: "synthetic", created: 0, model: "gpt-5-mini", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(value) } }] }; }
function payload(params: any) { return JSON.parse(params.messages[2].content); }
function invokeFor(text: string, checked: (payload: any) => unknown) {
  const invoke = vi.fn<SupportModelInvoker>();
  invoke.mockResolvedValueOnce(response(generated(text)));
  invoke.mockImplementationOnce(async params => response(checked(payload(params))));
  return invoke;
}
function sourceCondition(data: any, fragment: string, target = "question_checklist", claimId: number | null = null, relation = "payment_evidence") {
  const excerpt = data.untrustedEvidenceExcerpts.find((row: any) => row.text.includes(fragment) && row.text.length < 1400 && !row.text.startsWith("How to claim"));
  expect(excerpt).toBeTruthy();
  return { evidenceId: excerpt.evidenceId, target, claimId, relation };
}

describe("full static reimbursement checklist and explicit scope", () => {
  it("uses the full checked-in corpus rather than artificial KB/Academy helpers", () => {
    const chunks = retrieveAgentSupportChunks(sources, question, 5);
    expect(sources.length).toBe(98);
    expect(chunks.map(row => [row.key, row.chunkIndex])).toEqual([
      ["portal-procedure:reimbursement-request-v1", 0], ["policy:87", 0], ["policy:14", 3], ["policy:20", 1], ["policy:14", 0],
    ]);
    expect(chunks[0].chunkText).toContain("client name and amount paid");
    expect(chunks[0].chunkText).toContain("payment has cleared");
    expect(chunks[4].chunkText).toContain("must reimburse JLT");
  });
  it("accepts a complete source-cited document checklist without adding unrelated policy/workflow conditions", async () => {
    const invoke = invokeFor(fullChecklist, () => verdict());
    const result = await generateSupportTurn({ question, history: [], sources }, invoke);
    expect(result.verified).toBe(true);
    expect(result.conditionChecks).toBeUndefined();
    expect(result.answer).not.toContain("chargeback");
    expect(result.answer).not.toContain("company card");
    const data = payload(invoke.mock.calls[1][0]);
    expect(data.untrustedSourcePassages.length).toBe(5);
    expect(data.untrustedSourcePassages.some((row: any) => row.text.includes("must reimburse JLT"))).toBe(true);
    expect(data.untrustedEvidenceExcerpts.every((row: any) => data.untrustedSourcePassages.some((source: any) => source.citationIndex === row.citationIndex && source.chunkIndex === row.chunkIndex && source.text.slice(row.start, row.end) === row.text))).toBe(true);
    const instruction = invoke.mock.calls[1][0].messages[1].content as string;
    for (const required of ["direct nexus", "opposite-direction agent repayments", "Privacy processing purposes", "company-card payout routing", "semantically equivalent wording", "per candidate claim"]) expect(instruction).toContain(required);
    expect(JSON.stringify(invoke.mock.calls[1][0].response_format)).toContain("missingConditions");
  });
  it.each([
    ["Supplier invoice and cleared payment proof are required.", "client name and amount paid", "document_field"],
    ["Provide documents with supplier name, client name and amount paid.", "proof of payment that matches", "payment_evidence"],
    ["Provide an invoice and payment proof showing supplier, client name and amount.", "payment has cleared", "payment_evidence"],
    ["Provide a confirmation or invoice showing supplier, client name and amount, plus proof of cleared payment.", "Upload the supporting documents for every reimbursement item", "per_item_scope"],
  ])("withholds a real checklist omission and anchors the asserted reason: %s", async (text, fragment, relation) => {
    const invoke = invokeFor(text, data => verdict({ answerRetainsMaterialExceptions: false, missingConditions: [sourceCondition(data, fragment, "question_checklist", null, relation)] }));
    const result = await generateSupportTurn({ question, history: [], sources }, invoke);
    expect(result.disposition).toBe("validation_failed");
    expect(result.validationDiagnostic).toBe("conditions_missing");
    expect(result.sources).toEqual([]);
    expect(result.verified).toBe(false);
    expect(result.answer).not.toContain(text);
    expect(result.conditionChecks).toHaveLength(1);
    const check = result.conditionChecks![0];
    const chunk = retrieveAgentSupportChunks(sources, question).find(row => row.key === check.source.key && row.chunkIndex === check.chunkIndex)!;
    expect(chunk.chunkText.slice(check.start, check.end)).toContain(fragment);
    expect(check.sourceFingerprint).toBe(createHash("sha256").update(normaliseAgentSupportText(chunk.chunkText)).digest("hex"));
    expect(check.source.href).toBe("/my-bookings");
    expect(Object.keys(check).sort()).toEqual(["target", "claimId", "relation", "source", "chunkIndex", "start", "end", "sourceFingerprint"].sort());
    expect(JSON.stringify(result)).not.toContain("missingRequirement");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe("no blind false flags or invented condition diagnostics", () => {
  it.each([
    { answerRetainsMaterialExceptions: false },
    { missingConditions: [{ evidenceId: "E999", target: "question_checklist", claimId: null, relation: "document_field" }], answerRetainsMaterialExceptions: false },
    { missingConditions: [{ evidenceId: "E1", target: "claim", claimId: 999, relation: "document_field" }], answerRetainsMaterialExceptions: false },
    { missingConditions: [{ evidenceId: "E1", target: "question_checklist", claimId: 1, relation: "document_field" }], answerRetainsMaterialExceptions: false },
    { missingConditions: [{ evidenceId: "E1", target: "question_checklist", claimId: null, relation: "private_identifier" }], answerRetainsMaterialExceptions: false },
    { missingConditions: [{ evidenceId: "E1", target: "question_checklist", claimId: null, relation: "document_field", explanation: "PRIVATE_DRAFT_SENTINEL" }], answerRetainsMaterialExceptions: false },
    { missingConditions: [{ evidenceId: "E1", target: "question_checklist", claimId: null, relation: "document_field" }] },
    { claimResults: [{ claimId: 1, supported: true, retainsMaterialExceptions: false, safe: true }] },
  ])("rejects inconsistent or fabricated condition contract %#", async override => {
    const result = await generateSupportTurn({ question, history: [], sources }, invokeFor(fullChecklist, () => verdict(override)));
    expect(result.disposition).toBe("validation_failed");
    expect(result.validationDiagnostic).toBe("verification_contract");
    expect(result.conditionChecks).toBeUndefined();
    expect(result.sources).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_DRAFT_SENTINEL");
  });
  it("a claim-level omission requires the exact failed claim ID and never exposes the rejected draft", async () => {
    const text = "PRIVATE_DRAFT_BENCHMARK: Payment proof without clear status is enough.";
    const invoke = invokeFor(text, data => verdict({ claimResults: [{ claimId: 1, supported: true, retainsMaterialExceptions: false, safe: true }], missingConditions: [sourceCondition(data, "payment has cleared", "claim", 1)] }));
    const result = await generateSupportTurn({ question, history: [], sources }, invoke);
    expect(result.validationDiagnostic).toBe("conditions_missing");
    expect(result.conditionChecks![0].claimId).toBe(1);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_DRAFT_BENCHMARK");
  });
  it.each([["supported", "claim_not_supported"], ["safe", "verification_safety"]])("semantic/safety failure %s is not hidden by a global condition flag", async (flag, diagnostic) => {
    const invoke = invokeFor(fullChecklist, data => verdict({ answerRetainsMaterialExceptions: false, missingConditions: [sourceCondition(data, "payment has cleared")], claimResults: [{ claimId: 1, supported: flag !== "supported", retainsMaterialExceptions: true, safe: flag !== "safe" }] }));
    const result = await generateSupportTurn({ question, history: [], sources }, invoke);
    expect(result.validationDiagnostic).toBe(diagnostic);
    expect(result.conditionChecks).toBeUndefined();
  });
  it("missing-condition references never make a conflict-supported flag become true", async () => {
    const result = await generateSupportTurn({ question, history: [], sources }, invokeFor("The fee is confirmed despite conflicting guidance.", data => verdict({ answerRetainsMaterialExceptions: false, missingConditions: [sourceCondition(data, "payment has cleared")], claimResults: [{ claimId: 1, supported: false, retainsMaterialExceptions: true, safe: true }] })));
    expect(result.validationDiagnostic).toBe("claim_not_supported");
    expect(result.verified).toBe(false);
  });
});

describe("independent review — diagnostic precedence and non-authoritative reasons", () => {
  it.each([
    { safe: false, needed: true, noUnstatedAssumptions: true },
    { safe: true, needed: false, noUnstatedAssumptions: true },
    { safe: true, needed: true, noUnstatedAssumptions: false },
  ])("does not mask a failed clarification flag with a source-bound condition", async clarification => {
    const invoke = vi.fn<SupportModelInvoker>();
    invoke.mockResolvedValueOnce(response({ ...generated(), disposition: "partial", clarification: "Which general procedure do you mean?" }));
    invoke.mockImplementationOnce(async params => response(verdict({ answerRetainsMaterialExceptions: false, missingConditions: [sourceCondition(payload(params), "payment has cleared")], clarification })));
    const result = await generateSupportTurn({ question, history: [], sources }, invoke);
    expect(result.validationDiagnostic).toBe("clarification_failed");
    expect(result.conditionChecks).toBeUndefined();
    expect(result.verified).toBe(false);
  });
  it("a structurally valid unrelated condition is a verifier assertion, never a server-confirmed new requirement", async () => {
    const invoke = invokeFor(fullChecklist, data => verdict({ answerRetainsMaterialExceptions: false, missingConditions: [sourceCondition(data, "must reimburse JLT", "question_checklist", null, "procedure_prerequisite")] }));
    const result = await generateSupportTurn({ question, history: [], sources }, invoke);
    expect(result.disposition).toBe("validation_failed");
    expect(result.verified).toBe(false);
    expect(result.sources).toEqual([]);
    expect(result.conditionChecks?.[0].source.key).toBe("policy:14");
    expect(result.answer).not.toContain("must reimburse JLT");
    expect(result.answer).not.toContain("required documents");
  });
});
