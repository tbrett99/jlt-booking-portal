import { createHash } from "crypto";

/**
 * Build a PPS SHA-512 signature for a set of form fields.
 *
 * Algorithm (per PPS Integration Guide v4.21):
 * 1. Sort fields by ASCII field name order (case-sensitive)
 * 2. URL-encode as application/x-www-form-urlencoded (spaces → +)
 * 3. Normalise line endings: %0D%0A | %0A%0D | %0D → %0A
 * 4. Append the signing secret (no separator)
 * 5. SHA-512 hash
 */
export function buildPpsSignature(
  fields: Record<string, string>,
  signingSecret: string
): string {
  // Step 1: sort by ASCII key order
  const sorted = Object.keys(fields)
    .sort()
    .reduce(
      (acc, k) => {
        acc[k] = fields[k];
        return acc;
      },
      {} as Record<string, string>
    );

  // Step 2: URL-encode
  const str = new URLSearchParams(sorted).toString();

  // Step 3: normalise line endings
  const normalised = str.replace(/%0D%0A|%0A%0D|%0D/g, "%0A");

  // Step 4+5: append secret and hash
  return createHash("sha512")
    .update(normalised + signingSecret)
    .digest("hex");
}

/**
 * Verify a PPS response signature.
 * The response fields (excluding 'signature') are signed with the same algorithm.
 */
export function verifyPpsSignature(
  fields: Record<string, string>,
  receivedSignature: string,
  signingSecret: string
): boolean {
  const { signature: _sig, ...rest } = fields;
  const expected = buildPpsSignature(rest, signingSecret);
  return expected === receivedSignature;
}
