import { createHash } from "crypto";

/**
 * Build a PPS SHA-512 signature for a set of form fields.
 *
 * Algorithm (per PPS/CardStream Integration Guide — matches PHP SDK Gateway::sign() exactly):
 * 1. Remove the 'signature' field from the data
 * 2. If `partial` is provided, filter to only those fields
 * 3. Sort fields by key using localeCompare (matches PHP ksort behaviour)
 * 4. URL-encode as application/x-www-form-urlencoded (spaces → +)
 * 5. Normalise line endings: %0D%0A | %0A%0D | %0D → %0A
 * 6. Append the signing secret (no separator)
 * 7. SHA-512 hash
 * 8. If partial, return `${hash}|${partial}`; otherwise return hash
 */
export function buildPpsSignature(
  fields: Record<string, string>,
  signingSecret: string,
  partial?: string
): string {
  // Step 1: exclude signature field
  const data: Record<string, string> = { ...fields };
  delete data.signature;

  // Step 2: if partial, filter to only the listed fields
  let workingData = data;
  if (partial) {
    const keys = partial.split(",").map((k) => k.trim());
    workingData = Object.fromEntries(
      Object.entries(data).filter(([k]) => keys.includes(k))
    );
  }

  // Step 3: sort by key using localeCompare (matches PHP ksort)
  const sorted = Object.fromEntries(
    Object.entries(workingData).sort(([a], [b]) => a.localeCompare(b))
  );

  // Step 4: URL-encode
  const str = new URLSearchParams(sorted).toString();

  // Step 5: normalise line endings
  const normalised = str.replace(/%0D%0A|%0A%0D|%0D/gi, "%0A");

  // Step 6+7: append secret and hash
  const hash = createHash("sha512")
    .update(normalised + signingSecret)
    .digest("hex");

  // Step 8: return hash|partial if partial mode
  return partial ? `${hash}|${partial}` : hash;
}

/**
 * Verify a PPS response signature.
 *
 * Handles both plain hash signatures and partial signatures (hash|fieldList format).
 * Warns but does not throw on mismatch — caller decides whether to block.
 */
export function verifyPpsSignature(
  fields: Record<string, string>,
  receivedSignature: string,
  signingSecret: string
): boolean {
  if (!receivedSignature) return false;

  // Handle partial signature format: "hash|field1,field2,..."
  let sigHash = receivedSignature;
  let partial: string | undefined;
  if (receivedSignature.includes("|")) {
    const parts = receivedSignature.split("|");
    sigHash = parts[0];
    partial = parts[1];
  }

  const computed = buildPpsSignature(fields, signingSecret, partial);
  const computedHash = computed.includes("|") ? computed.split("|")[0] : computed;

  return computedHash === sigHash;
}
