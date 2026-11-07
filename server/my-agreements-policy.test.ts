import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agreementSignedAt,
  safeAgreementSignature,
  safeAgreementSnapshot,
  safeAgreementStorageUrl,
  safeAgreementStoredHash,
} from "./my-agreements-policy";

const STORAGE = "https://agreements.example.test/public";
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG = `data:image/png;base64,${PNG_MAGIC.toString("base64")}`;
const JPEG = `data:image/jpeg;base64,${Buffer.from([255, 216, 255]).toString("base64")}`;
const SIGNATURE_URL = `${STORAGE}/crm/contracts/signatures/signer_11.png`;
beforeEach(() => vi.stubEnv("S3_PUBLIC_URL", STORAGE));
afterEach(() => vi.unstubAllEnvs());

describe("agreement storage trust is configured, exact and non-traversable", () => {
  it("accepts only HTTPS objects beneath the configured origin and path prefix", () => {
    expect(safeAgreementStorageUrl(`${STORAGE}/terms/original.pdf`)).toBe(
      `${STORAGE}/terms/original.pdf`
    );
    expect(safeAgreementStorageUrl(`${STORAGE}/terms/a%20b.pdf`)).toBe(
      `${STORAGE}/terms/a%20b.pdf`
    );
    vi.stubEnv("S3_PUBLIC_URL", `${STORAGE}/`);
    expect(safeAgreementStorageUrl(`${STORAGE}/terms/original.pdf`)).toBe(
      `${STORAGE}/terms/original.pdf`
    );
  });

  it.each([
    undefined,
    null,
    123,
    {},
    "",
    STORAGE,
    `${STORAGE}/`,
    "https://agreements.example.test/publicity/terms.pdf",
    "https://agreements.example.test/private/terms.pdf",
    "https://agreements.example.test.evil.test/public/terms.pdf",
    "https://foreign.example.test/public/terms.pdf",
    "https://agreements.example.test:444/public/terms.pdf",
    "http://agreements.example.test/public/terms.pdf",
    "//agreements.example.test/public/terms.pdf",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "file:///public/terms.pdf",
    "https://user:pass@agreements.example.test/public/terms.pdf",
    "https://agreements.example.test@evil.test/public/terms.pdf",
    `${STORAGE}/terms.pdf?token=private`,
    `${STORAGE}/terms.pdf#fragment`,
    `${STORAGE}/../private/terms.pdf`,
    `${STORAGE}/./terms.pdf`,
    `${STORAGE}/%2e%2e/terms.pdf`,
    `${STORAGE}/%2E/terms.pdf`,
    `${STORAGE}/%252e%252e/terms.pdf`,
    `${STORAGE}/%2fprivate/terms.pdf`,
    `${STORAGE}/%5cprivate/terms.pdf`,
    `${STORAGE}/folder\\terms.pdf`,
    `${STORAGE}//terms.pdf`,
    `${STORAGE}/terms%00.pdf`,
    `${STORAGE}/terms%0a.pdf`,
    `${STORAGE}/terms%250a.pdf`,
    `${STORAGE}/%ZZ.pdf`,
    ` ${STORAGE}/terms.pdf`,
    `${STORAGE}/terms.pdf `,
    `${STORAGE}/terms\n.pdf`,
    `${STORAGE}/terms\t.pdf`,
    `${STORAGE}/terms\u007f.pdf`,
  ])("rejects spoofed/traversal/active/credential/query URL %j", value => {
    expect(safeAgreementStorageUrl(value)).toBeNull();
  });

  it("bounds URLs before parsing", () => {
    expect(
      safeAgreementStorageUrl(`${STORAGE}/${"a".repeat(4096)}.pdf`)
    ).toBeNull();
  });

  it.each([
    "",
    "http://agreements.example.test/public",
    "https://user:pass@agreements.example.test/public",
    `${STORAGE}?key=secret`,
    `${STORAGE}#fragment`,
    "not-a-url",
    "https://agreements.example.test/public/%252e",
  ])(
    "does not trust a missing or unsafe storage configuration %j",
    configured => {
      vi.stubEnv("S3_PUBLIC_URL", configured);
      expect(
        safeAgreementStorageUrl(`${STORAGE}/terms/original.pdf`)
      ).toBeNull();
      expect(safeAgreementSignature(SIGNATURE_URL, true)).toBeNull();
    }
  );

  it("does not infer object-storage trust when configuration is absent", () => {
    delete process.env.S3_PUBLIC_URL;
    expect(safeAgreementStorageUrl(`${STORAGE}/terms.pdf`)).toBeNull();
    expect(safeAgreementSignature(SIGNATURE_URL, true)).toBeNull();
  });
});

describe("signature evidence is bounded canonical PNG/JPEG, never active SVG", () => {
  it("accepts matching PNG and JPEG magic without rewriting the stored value", () => {
    expect(safeAgreementSignature(PNG)).toBe(PNG);
    expect(safeAgreementSignature(JPEG)).toBe(JPEG);
  });

  it.each([
    null,
    undefined,
    {},
    "",
    "data:image/png;base64,",
    "data:image/png;base64,YWJjZA==",
    "data:image/png;base64,/9j/",
    "data:image/jpeg;base64,iVBORw0KGgo=",
    "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=",
    "data:image/svg+xml,<svg onload='alert(1)'></svg>",
    "data:text/html;base64,PHNjcmlwdD4=",
    "javascript:alert(1)",
    "data:image/gif;base64,R0lGODlh",
    "data:image/webp;base64,UklGRg==",
    "data:image/png;base64,iVBORw0KGgo",
    "data:image/png;base64,iVBORw0KGgo==",
    "data:image/png;base64,iVBORw0KGgp=", // same decoded bytes but noncanonical pad bits
    "data:image/png;base64,iVBORw0K\nGgo=",
    "data:image/png;base64,iVBORw0KGgo= ",
    "data:image/PNG;base64,iVBORw0KGgo=",
    "data:image/png;utf8;base64,iVBORw0KGgo=",
    "data:image/png;base64,iVBORw0KGg_=",
    " data:image/png;base64,iVBORw0KGgo=",
  ])("rejects invalid or active signature %j", value => {
    expect(safeAgreementSignature(value)).toBeNull();
    expect(safeAgreementSignature(value, true)).toBeNull();
  });

  it("accepts exactly the byte bound and rejects larger data even with valid magic", () => {
    const max = 2 * 1024 * 1024;
    const bytes = Buffer.alloc(max);
    PNG_MAGIC.copy(bytes);
    const exact = `data:image/png;base64,${bytes.toString("base64")}`;
    expect(safeAgreementSignature(exact)).toBe(exact);
    const tooLarge = `data:image/png;base64,${Buffer.concat([bytes, Buffer.from([0])]).toString("base64")}`;
    expect(safeAgreementSignature(tooLarge)).toBeNull();
    expect(safeAgreementSignature(tooLarge, true)).toBeNull();
  });

  it("allows a trusted stored signature only with explicit opt-in and the dedicated object key", () => {
    expect(safeAgreementSignature(SIGNATURE_URL)).toBeNull();
    expect(safeAgreementSignature(SIGNATURE_URL, true)).toBe(SIGNATURE_URL);
    const jpegUrl = `${STORAGE}/crm/contracts/signatures/abc-123.jpeg`;
    expect(safeAgreementSignature(jpegUrl, true)).toBe(jpegUrl);
  });

  it.each([
    `${STORAGE}/crm/contracts/signatures/signer.svg`,
    `${STORAGE}/crm/contracts/signatures/signer.gif`,
    `${STORAGE}/crm/contracts/signatures/signer.jpg`,
    `${STORAGE}/crm/contracts/signatures/signer.PNG`,
    `${STORAGE}/crm/contracts/signatures/nested/signer.png`,
    `${STORAGE}/crm/contracts/signatures/.png`,
    `${STORAGE}/crm/contracts/signatures/signer.png?tracking=1`,
    `${STORAGE}/crm/contracts/signatures/%2e%2e/signer.png`,
    `${STORAGE}/crm/contracts/signatures/signer%20name.png`,
    `${STORAGE}/other/signer.png`,
    "https://foreign.example.test/public/crm/contracts/signatures/signer.png",
  ])("rejects URL signatures outside safe raster key allowlist %s", value => {
    expect(safeAgreementSignature(value, true)).toBeNull();
  });
});

describe("stored signing snapshot is safe display only", () => {
  it("removes active HTML, event/style attributes, trackers and unsafe links while preserving legal structure", () => {
    const input = `<h1 id="tracking" onclick="steal()">Agency terms</h1>
      <p style="background:url(https://tracker.test/pixel)">Paragraph <strong>bold</strong> <em>emphasis</em>.</p>
      <h2>Obligations</h2><ul><li>One</li><li>Two</li></ul><ol start="3"><li value="4">Four</li></ol>
      <table><caption>Fees</caption><thead><tr><th scope="col">Item</th></tr></thead>
      <tbody><tr><td colspan="2" rowspan="2" onmouseover="steal()">Amount</td></tr></tbody></table>
      <script>ACTIVE_SCRIPT</script><style>ACTIVE_STYLE</style><iframe src="https://tracker.test">ACTIVE_FRAME</iframe>
      <object>ACTIVE_OBJECT</object><embed src="https://tracker.test"><svg>ACTIVE_SVG</svg><math>ACTIVE_MATH</math>
      <img src="https://tracker.test/pixel" onerror="steal()"><form action="https://tracker.test"><input name="password"></form>
      <a href="javascript:steal()">Bad JS</a><a href="//tracker.test">Protocol relative</a>
      <a href="https://tracker.test/pixel">Tracking link</a><a href="${STORAGE}/doc.pdf?token=secret">Query link</a>
      <a href="${STORAGE}/doc.pdf" target="_self" rel="opener" onclick="steal()">Saved PDF</a>`;
    const result = safeAgreementSnapshot(input);
    expect(result.kind).toBe("document_reference");
    expect(result.html).toContain("<h1>Agency terms</h1>");
    expect(result.html).toContain(
      "<p>Paragraph <strong>bold</strong> <em>emphasis</em>.</p>"
    );
    expect(result.html).toContain(
      "<h2>Obligations</h2><ul><li>One</li><li>Two</li></ul>"
    );
    expect(result.html).toContain('<ol start="3"><li value="4">Four</li></ol>');
    expect(result.html).toContain('<th scope="col">Item</th>');
    expect(result.html).toContain('<td colspan="2" rowspan="2">Amount</td>');
    expect(result.html).toContain("<a>Bad JS</a>");
    expect(result.html).toContain("<a>Tracking link</a>");
    expect(result.html).toContain("<a>Query link</a>");
    expect(result.html).toContain(
      `<a href="${STORAGE}/doc.pdf" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Saved PDF</a>`
    );
    expect(result.html).not.toMatch(
      /ACTIVE_|tracker\.test|steal\(|token=|<(?:script|style|iframe|object|embed|svg|math|img|form|input)\b|\son\w+=|\sstyle=/i
    );
  });

  it.each([
    null,
    undefined,
    {},
    "",
    "  ",
    "<p> </p>",
    "<p>&nbsp;&#160;&#xA0;</p>",
    "<p>\u200b\u200c\u200d\ufeff</p>",
    "<script>only active content</script>",
    "<img src='https://tracker.test/pixel'>",
    "<table><tr><td></td></tr></table>",
  ])("does not advertise an empty or non-text snapshot %j", value => {
    expect(safeAgreementSnapshot(value)).toEqual({ html: null, kind: null });
  });

  it("ordinary signed text remains a text snapshot, not a verified or recomputed document", () => {
    const result = safeAgreementSnapshot(
      "<h2>Signed heading</h2><p>Original paragraph</p>"
    );
    expect(result).toEqual({
      html: "<h2>Signed heading</h2><p>Original paragraph</p>",
      kind: "text_snapshot",
    });
  });

  it("a trusted PDF reference acknowledgment is not represented as full captured text", () => {
    const input = `<p>I acknowledge the <a href="${STORAGE}/agreement.PDF">agency terms</a>.</p>`;
    expect(safeAgreementSnapshot(input)).toMatchObject({
      kind: "document_reference",
    });
  });

  it.each([
    `<p>Signed text</p><script><a href="${STORAGE}/agreement.pdf">Hidden</a></script>`,
    `<p>Signed text</p><svg><a href="${STORAGE}/agreement.pdf">Hidden</a></svg>`,
    '<p>I acknowledge <a href="https://foreign.test/agreement.pdf">terms</a>.</p>',
    `<p>I acknowledge <a href="${STORAGE}/agreement.pdf?token=private">terms</a>.</p>`,
    `<p>I acknowledge <a href="${STORAGE}/terms.html">terms</a>.</p>`,
  ])(
    "suppressed or unsafe references cannot misclassify a text snapshot %s",
    input => {
      expect(safeAgreementSnapshot(input).kind).toBe("text_snapshot");
    }
  );

  it("unconfigured storage removes all reference links without losing acknowledgment text", () => {
    delete process.env.S3_PUBLIC_URL;
    const result = safeAgreementSnapshot(
      `<p>I acknowledge <a href="${STORAGE}/agreement.pdf">terms</a>.</p>`
    );
    expect(result).toEqual({
      html: "<p>I acknowledge <a>terms</a>.</p>",
      kind: "text_snapshot",
    });
  });
});

describe("stored digest is only a reference, never verified against rendered bytes", () => {
  it("returns the supplied valid digest exactly, independent of any signing content", () => {
    const unrelatedStoredDigest = "Ab".repeat(32);
    expect(safeAgreementStoredHash(unrelatedStoredDigest)).toBe(
      unrelatedStoredDigest
    );
    expect(safeAgreementStoredHash("0".repeat(64))).toBe("0".repeat(64));
  });
  it.each([
    null,
    undefined,
    123,
    "",
    "a".repeat(63),
    "a".repeat(65),
    "g".repeat(64),
    ` ${"a".repeat(64)}`,
    `${"a".repeat(64)}\n`,
  ])("rejects malformed stored hash %j", value =>
    expect(safeAgreementStoredHash(value)).toBeNull()
  );
});

describe("signedAt is strict evidence, not a coercible or overflowing date", () => {
  it("normalizes Dates and valid timezone-qualified strings to ISO", () => {
    expect(agreementSignedAt(new Date("2026-01-01T12:00:00Z"))).toBe(
      "2026-01-01T12:00:00.000Z"
    );
    expect(agreementSignedAt("2026-01-01T12:00:00+01:00")).toBe(
      "2026-01-01T11:00:00.000Z"
    );
    expect(agreementSignedAt("2024-02-29T00:00:00.12Z")).toBe(
      "2024-02-29T00:00:00.120Z"
    );
  });
  it.each([
    null,
    undefined,
    0,
    {},
    new Date(NaN),
    "bad-date",
    "2026-01-01",
    "2026-01-01 12:00:00",
    "2026-01-01T12:00:00",
    "2026-02-30T12:00:00Z",
    "2025-02-29T12:00:00Z",
    "2026-13-01T12:00:00Z",
    "2026-00-01T12:00:00Z",
    "2026-01-00T12:00:00Z",
    "2026-01-01T25:00:00Z",
  ])("rejects malformed/overflowing signed date %j", value =>
    expect(agreementSignedAt(value)).toBeNull()
  );
});
