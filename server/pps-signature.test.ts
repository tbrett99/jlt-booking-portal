import { describe, it, expect } from "vitest";
import { buildPpsSignature, verifyPpsSignature } from "./pps-signature";

const SECRET = "testSecret123";

describe("buildPpsSignature", () => {
  it("produces a 128-character hex string (SHA-512)", () => {
    const sig = buildPpsSignature({ merchantID: "12345", amount: "1000" }, SECRET);
    expect(sig).toHaveLength(128);
    expect(sig).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic for the same inputs", () => {
    const fields = { merchantID: "12345", amount: "1000", orderRef: "PTS-001" };
    expect(buildPpsSignature(fields, SECRET)).toBe(buildPpsSignature(fields, SECRET));
  });

  it("sorts fields by ASCII key order before hashing", () => {
    const a = buildPpsSignature({ b: "2", a: "1" }, SECRET);
    const b = buildPpsSignature({ a: "1", b: "2" }, SECRET);
    expect(a).toBe(b);
  });

  it("produces different signatures for different amounts", () => {
    const s1 = buildPpsSignature({ amount: "1000" }, SECRET);
    const s2 = buildPpsSignature({ amount: "2000" }, SECRET);
    expect(s1).not.toBe(s2);
  });

  it("produces different signatures for different secrets", () => {
    const fields = { amount: "1000" };
    expect(buildPpsSignature(fields, "secret1")).not.toBe(buildPpsSignature(fields, "secret2"));
  });
});

describe("verifyPpsSignature", () => {
  it("returns true when signature matches", () => {
    const fields = { merchantID: "258137", amount: "15000", orderRef: "PTS-REF-001" };
    const sig = buildPpsSignature(fields, SECRET);
    expect(verifyPpsSignature({ ...fields, signature: sig }, sig, SECRET)).toBe(true);
  });

  it("returns false when signature is tampered", () => {
    const fields = { merchantID: "258137", amount: "15000" };
    const sig = buildPpsSignature(fields, SECRET);
    const tampered = sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a");
    expect(verifyPpsSignature({ ...fields, signature: tampered }, tampered, SECRET)).toBe(false);
  });

  it("returns false when a field value is changed after signing", () => {
    const fields = { merchantID: "258137", amount: "15000" };
    const sig = buildPpsSignature(fields, SECRET);
    // Attacker changes amount
    expect(verifyPpsSignature({ merchantID: "258137", amount: "1", signature: sig }, sig, SECRET)).toBe(false);
  });

  it("excludes the signature field itself when verifying", () => {
    const fields = { merchantID: "258137", amount: "15000", orderRef: "PTS-REF" };
    const sig = buildPpsSignature(fields, SECRET);
    // Pass fields WITH signature key — should still verify correctly
    const withSig = { ...fields, signature: sig };
    expect(verifyPpsSignature(withSig, sig, SECRET)).toBe(true);
  });
});
