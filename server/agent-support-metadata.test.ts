import { describe, expect, it } from "vitest";
import {
  readSupportConditionChecks,
  readSupportMetadata,
  readSupportValidationDiagnostic,
  supportEnvelope,
} from "../shared/agent-support-metadata";
import {
  SUPPORT_CONDITION_RELATION_LABELS,
  SUPPORT_VALIDATION_DIAGNOSTIC_LABELS,
  type SupportAnswerEnvelope,
  type SupportCitation,
  type SupportConditionCheck,
  type SupportDisposition,
  type SupportValidationDiagnostic,
} from "../shared/agent-support-pilot";

const codes: SupportValidationDiagnostic[] = [
  "input_contract",
  "context_contract",
  "context_provenance",
  "model_contract",
  "generation_contract",
  "evidence_mismatch",
  "citation_invalid",
  "output_safety",
  "verification_contract",
  "claim_not_supported",
  "conditions_missing",
  "verification_safety",
  "relevance_failed",
  "clarification_failed",
  "call_budget",
];
const PRIVATE = "PRIVATE_DIAGNOSTIC_SENTINEL provider@example.test";
const invalidValues: unknown[] = [
  undefined,
  null,
  "",
  "unknown_check",
  "INPUT_CONTRACT",
  " input_contract",
  "input_contract ",
  "input_contract\n",
  "__proto__",
  "constructor",
  "toString",
  PRIVATE,
  { code: "input_contract", message: PRIVATE },
  ["input_contract"],
  new String("input_contract"),
  1,
  true,
];
const citation: SupportCitation = {
  index: 1,
  key: "kb:7",
  kind: "knowledge_base",
  title: "Synthetic approved guide",
  href: "/knowledge-base?article=7",
  label: "Synthetic approved guide",
  timestampLabel: null,
  updatedAt: null,
};
const input = (
  overrides: Record<string, unknown> = {}
): Omit<SupportAnswerEnvelope, "version" | "inputScreened"> =>
  ({
    sources: [],
    disposition: "validation_failed",
    verified: false,
    modelCalls: 2,
    latencyMs: 12,
    ...overrides,
  }) as Omit<SupportAnswerEnvelope, "version" | "inputScreened">;

function assertDiagnosticAbsent(value: object) {
  expect(value).not.toHaveProperty("validationDiagnostic");
  expect(JSON.stringify(value)).not.toContain(PRIVATE);
}

describe("safe support validation diagnostic metadata", () => {
  it("exports exactly the approved codes and fixed human-readable labels", () => {
    expect(Object.keys(SUPPORT_VALIDATION_DIAGNOSTIC_LABELS)).toEqual(codes);
    expect(Object.isFrozen(SUPPORT_VALIDATION_DIAGNOSTIC_LABELS)).toBe(true);
    for (const code of codes) {
      expect(SUPPORT_VALIDATION_DIAGNOSTIC_LABELS[code]).toMatch(/check failed$/);
      expect(SUPPORT_VALIDATION_DIAGNOSTIC_LABELS[code]).not.toContain("_");
    }
  });

  it.each(codes)("accepts only the exact %s code and round-trips it", code => {
    expect(readSupportValidationDiagnostic(code)).toBe(code);
    const envelope = supportEnvelope(input({ validationDiagnostic: code }));
    expect(envelope).toEqual({
      version: 2,
      inputScreened: true,
      sources: [],
      disposition: "validation_failed",
      verified: false,
      modelCalls: 2,
      latencyMs: 12,
      validationDiagnostic: code,
    });
    for (const status of ["failed", "insufficient_sources"])
      expect(readSupportMetadata(envelope, status)).toMatchObject({
        disposition: "validation_failed",
        validationDiagnostic: code,
        verified: false,
      });
  });

  it.each(invalidValues.map(value => [value]))(
    "discards invalid diagnostic %# rather than preserving arbitrary text",
    value => {
      expect(readSupportValidationDiagnostic(value)).toBeNull();
      const envelope = supportEnvelope(input({ validationDiagnostic: value }));
      assertDiagnosticAbsent(envelope);
      assertDiagnosticAbsent(
        readSupportMetadata({ ...envelope, validationDiagnostic: value }, "failed")
      );
    }
  );

  it.each<SupportDisposition>([
    "answered",
    "partial",
    "clarify",
    "escalated",
    "privacy_blocked",
    "failed",
  ])("ignores even valid diagnostic codes for %s dispositions", disposition => {
    const envelope = supportEnvelope(
      input({ disposition, validationDiagnostic: "citation_invalid" })
    );
    assertDiagnosticAbsent(envelope);
    assertDiagnosticAbsent(
      readSupportMetadata({ ...envelope, validationDiagnostic: "citation_invalid" })
    );
  });

  it("does not expose a diagnostic on a successful status, even with contradictory metadata", () => {
    const envelope = supportEnvelope(
      input({ validationDiagnostic: "citation_invalid" })
    );
    assertDiagnosticAbsent(readSupportMetadata(envelope, "answered"));
  });

  it("constructs and reads only known metadata fields, not provider/debug payloads", () => {
    const raw = input({
      validationDiagnostic: "claim_not_supported",
      version: PRIVATE,
      inputScreened: PRIVATE,
      diagnosticMessage: PRIVATE,
      providerError: { message: PRIVATE },
      rejectedDraft: PRIVATE,
      rawQuestion: PRIVATE,
      rawSources: PRIVATE,
    });
    const envelope = supportEnvelope(raw);
    expect(Object.keys(envelope).sort()).toEqual([
      "disposition",
      "inputScreened",
      "latencyMs",
      "modelCalls",
      "sources",
      "validationDiagnostic",
      "verified",
      "version",
    ]);
    expect(JSON.stringify(envelope)).not.toContain(PRIVATE);
    const metadata = readSupportMetadata({ ...raw, version: 2, inputScreened: true });
    expect(metadata.validationDiagnostic).toBe("claim_not_supported");
    expect(JSON.stringify(metadata)).not.toContain(PRIVATE);
  });

  it("preserves version-two answers without diagnostics", () => {
    const envelope = supportEnvelope(input({
      disposition: "answered", verified: true, sources: [citation],
    }));
    expect(readSupportMetadata(envelope, "answered")).toEqual({
      sources: [citation], disposition: "answered", verified: true,
      inputScreened: true, modelCalls: 2, latencyMs: 12,
    });
    const withheld = supportEnvelope(input());
    assertDiagnosticAbsent(withheld);
    assertDiagnosticAbsent(readSupportMetadata(withheld));
  });

  it("preserves legacy citations and fallback dispositions without trusting old diagnostics", () => {
    expect(readSupportMetadata([citation], "answered")).toEqual({
      sources: [citation], disposition: "answered", verified: false,
      inputScreened: false, modelCalls: 0, latencyMs: 0,
    });
    for (const status of ["answered", "failed", "insufficient_sources"]) {
      for (const raw of [
        null,
        { sources: [citation], disposition: "validation_failed", validationDiagnostic: "citation_invalid" },
        { ...input({ validationDiagnostic: "citation_invalid" }), version: 1, inputScreened: true },
        { ...input({ validationDiagnostic: "citation_invalid" }), version: 2, inputScreened: false },
      ]) {
        const metadata = readSupportMetadata(raw, status);
        assertDiagnosticAbsent(metadata);
        expect(metadata.verified).toBe(false);
        expect(metadata.inputScreened).toBe(false);
        expect(metadata.disposition).toBe(status === "answered" ? "answered" : status === "failed" ? "failed" : "escalated");
      }
    }
  });
});

const condition = (overrides: Record<string, unknown> = {}): SupportConditionCheck => ({
  target: "question_checklist", claimId: null, relation: "document_field", source: citation,
  chunkIndex: 0, start: 0, end: 30, sourceFingerprint: "a".repeat(64), ...overrides,
}) as SupportConditionCheck;

describe("source-bound condition reference metadata", () => {
  it("exports exactly the fixed relation labels and reconstructs only approved fields", () => {
    expect(Object.keys(SUPPORT_CONDITION_RELATION_LABELS)).toEqual([
      "document_field", "payment_evidence", "per_item_scope", "branch_qualification", "procedure_prerequisite",
    ]);
    expect(Object.isFrozen(SUPPORT_CONDITION_RELATION_LABELS)).toBe(true);
    const raw = condition({ explanation: PRIVATE, rawText: PRIVATE, excerpt: PRIVATE,
      source: { ...citation, text: PRIVATE, rejectedDraft: PRIVATE },
    });
    expect(readSupportConditionChecks([raw])).toEqual([condition()]);
    expect(Object.keys(readSupportConditionChecks([raw])[0]).sort()).toEqual([
      "target", "claimId", "relation", "source", "chunkIndex", "start", "end", "sourceFingerprint",
    ].sort());
    expect(JSON.stringify(readSupportConditionChecks([raw]))).not.toContain(PRIVATE);
    expect(readSupportConditionChecks(Array.from({ length: 20 }, () => raw))).toHaveLength(8);
    expect(readSupportConditionChecks({ checks: [raw] })).toEqual([]);
  });

  it.each([
    { target: "other" }, { target: "claim", claimId: null }, { target: "claim", claimId: 0 },
    { target: "claim", claimId: 11 }, { claimId: 1 }, { claimId: undefined },
    { target: "claim", claimId: 1.1 }, { relation: PRIVATE }, { relation: "constructor" },
    { chunkIndex: -1 }, { chunkIndex: 0.5 }, { chunkIndex: "0" }, { chunkIndex: Infinity },
    { chunkIndex: Number.MAX_SAFE_INTEGER + 1 }, { start: -1 }, { start: 0.5 },
    { start: 1401 }, { end: 1401 }, { end: 0 }, { start: 30, end: 30 },
    { start: 31, end: 30 }, { end: "30" }, { sourceFingerprint: "A".repeat(64) },
    { sourceFingerprint: "a".repeat(63) }, { sourceFingerprint: PRIVATE },
  ])("drops invalid reference %#", overrides => {
    expect(readSupportConditionChecks([condition(overrides), condition()])).toEqual([condition()]);
  });

  it.each([
    { href: "//private.invalid" }, { href: "/admin/users" },
    { href: "/knowledge-base?article=7&raw=private" }, { index: 0 }, { index: 6 },
    { key: "x".repeat(101) }, { key: PRIVATE }, { kind: "x".repeat(41) },
    { title: "x".repeat(301) }, { title: "" }, { label: "x".repeat(401) },
    { timestampLabel: "x".repeat(201) }, { updatedAt: PRIVATE },
    { title: "unsafe\u0000title" },
  ])("drops invalid nested citation %#", overrides => {
    expect(readSupportConditionChecks([condition({ source: { ...citation, ...overrides } })])).toEqual([]);
  });

  it("accepts boundary integers and target/claim consistency", () => {
    const rows = [condition({ target: "claim", claimId: 10, start: 1399, end: 1400 }),
      condition({ chunkIndex: Number.MAX_SAFE_INTEGER, end: 1400 })];
    expect(readSupportConditionChecks(rows)).toEqual(rows);
  });

  it("stores and reads references only for current conditions_missing failures", () => {
    const envelope = supportEnvelope(input({ validationDiagnostic: "conditions_missing", conditionChecks: [condition()] }));
    expect(envelope.conditionChecks).toEqual([condition()]);
    expect(readSupportMetadata(envelope, "failed").conditionChecks).toEqual([condition()]);
    expect(readSupportMetadata(envelope, "answered")).not.toHaveProperty("conditionChecks");
    for (const raw of [
      { ...envelope, version: 1 }, { ...envelope, inputScreened: false },
      { ...envelope, validationDiagnostic: "verification_safety" },
      { ...envelope, validationDiagnostic: undefined },
      { ...envelope, disposition: "privacy_blocked" },
      { ...envelope, disposition: "answered" }, [condition()],
    ]) expect(readSupportMetadata(raw, "failed")).not.toHaveProperty("conditionChecks");
    for (const disposition of ["answered", "partial", "clarify", "escalated", "privacy_blocked", "failed"]) {
      expect(supportEnvelope(input({ disposition, validationDiagnostic: "conditions_missing", conditionChecks: [condition()] })))
        .not.toHaveProperty("conditionChecks");
    }
    for (const code of codes.filter(code => code !== "conditions_missing")) {
      expect(supportEnvelope(input({ validationDiagnostic: code, conditionChecks: [condition()] })))
        .not.toHaveProperty("conditionChecks");
    }
  });
});
