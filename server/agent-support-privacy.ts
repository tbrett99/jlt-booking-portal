// This is defence in depth, not a claim to recognise every possible personal
// detail. The UI and model policy also prohibit private-record input/inference.
const PHONE = /(?:\+\d{1,3}[ .()-]*)?(?:\(?\d{2,5}\)?[ .()-]*){2,5}\d{3,5}\b/g;
// Match the generation boundary's labelled identifier vocabulary, plus the
// operational labels already screened below. A label alone is not private data.
const LABELLED_IDENTIFIER =
  /\b(?:booking|file|pts|orbit|claim|case|reimbursement|refund|payment|account|user|agent|customer|client)\s*(?:id|ref(?:erence)?|number|no)\b\.?\s*([:#=]?\s*)([a-z0-9][a-z0-9-]{3,})\b/gi;
const PRIVATE_DETAIL_PATTERNS: RegExp[] = [
  /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  /\b(?:PM|MD|SB|BRQ|CU|EV)[A-Z0-9]{8,}\b/gi,
  /\b(?:booking|file|claim|reimbursement|refund|payment|user|agent|customer|client)\s*(?:(?:id|number|reference|ref)\s*)?[:#=]?\s*\d{5,}\b/gi,
  /\b(?:PTS|Orbit)\s*(?:reference|ref|id|number)?\s*[:#=]?\s*(?=[A-Z0-9-]*\d)[A-Z0-9-]{6,}\b/gi,
  /\b\d[A-Z]\d{6,}\b/gi,
  /\bJLT[- ]\d{3,}\b/gi,
  /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/gi,
  /\b(?:\d[ -]?){13,19}\b/g,
  /\b\d{2}[- ]\d{2}[- ]\d{2}\b/g,
  PHONE,
  /\b(?:password|passcode|secret|api[ _-]?key|access[ _-]?token|account[ _-]?number|sort[ _-]?code)\s*(?:is|:|=)\s*[^\s,;]{2,}/gi,
  /\b(?:sk|rk|pk)[_-](?:live|test)[_-][A-Z0-9_-]+\b/gi,
  /\beyJ[A-Z0-9_-]+\.[A-Z0-9_-]+\.[A-Z0-9_-]+\b/gi,
  /\b(?:my|the|our)\s+(?:client|customer|agent)(?:'s)?\s+(?:name\s+is|is|called|named)\s+[A-Z][A-Z'-]+(?:\s+[A-Z][A-Z'-]+){0,3}/gi,
  /\b(?:client|customer|agent)\s+name\s*:\s*[^\n,;]+/gi,
];

function containsPrivateDetails(text: string) {
  LABELLED_IDENTIFIER.lastIndex = 0;
  for (
    let match = LABELLED_IDENTIFIER.exec(text);
    match;
    match = LABELLED_IDENTIFIER.exec(text)
  ) {
    const [, separator, value] = match;
    // Explicit value assignments and code-shaped tokens are identifiers; an
    // ordinary word after a label ("booking reference field") is not one.
    if (separator.trim() || /\d|-/.test(value) || /^[A-Z]{4,}$/.test(value))
      return true;
  }
  return PRIVATE_DETAIL_PATTERNS.some(pattern => {
    pattern.lastIndex = 0;
    // A flexible phone detector must not mistake ordinary dates or small fees
    // for a phone number. Explicit bank/provider patterns above are separate.
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (pattern !== PHONE || match[0].replace(/\D/g, "").length >= 9)
        return true;
    }
    return false;
  });
}

export function screenSupportInput(value: string): {
  safe: boolean;
  text: string;
  reason: string | null;
} {
  const text = value.replace(/\u0000/g, "").trim();
  if (containsPrivateDetails(text))
    return {
      safe: false,
      text: "[Private details omitted. Please ask a general process question.]",
      reason: "private_details_blocked",
    };
  return { safe: true, text, reason: null };
}

export function safeStoredSupportText(
  value: unknown,
  assistant = false
): string {
  if (typeof value !== "string") return "This message is unavailable.";
  const publicSupportLink = "[JLT Support](mailto:support@thejltgroup.co.uk)";
  // Mask only this complete server-owned link: bare addresses, suffix lookalikes
  // and mailto query parameters must still pass the ordinary privacy screen.
  const placeholder = "PUBLIC_JLT_SUPPORT_LINK";
  const screened = assistant
    ? value.replaceAll(publicSupportLink, placeholder)
    : value;
  const checked = screenSupportInput(screened);
  return checked.safe
    ? checked.text.replaceAll(placeholder, publicSupportLink)
    : checked.text;
}

export const SUPPORT_PRIVACY_MESSAGE =
  "Please remove client names, booking or payment references, bank details and other private information, then ask about the general process. I cannot inspect individual records. Nothing has been sent to the AI model for this question. You can contact [JLT Support](mailto:support@thejltgroup.co.uk) for help with a specific case.";
