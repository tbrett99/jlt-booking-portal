import { describe, expect, it } from "vitest";
import {
  readSupportMetadata,
  readSupportValidationDiagnostic,
  supportEnvelope,
} from "../shared/agent-support-metadata";
import {
  SUPPORT_VALIDATION_DIAGNOSTIC_LABELS,
  type SupportAnswerEnvelope,
  type SupportCitation,
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
