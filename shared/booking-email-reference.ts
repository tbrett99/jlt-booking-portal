/** Booking payment/commission references are Orbit crmRef, never PTS or Topdog. */
export function bookingOrbitReference(booking: { crmRef?: string | null }): string | null {
  return booking.crmRef?.trim() || null;
}

export function escapeBookingEmailText(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export function orbitReferenceEmailParagraph(booking: { crmRef?: string | null }, bankTransfer = false): string {
  const reference = bookingOrbitReference(booking);
  if (!reference) return '<p><strong>Orbit reference:</strong> Not recorded. Please check the booking in the Portal or contact JLT before making a bank transfer; do not use the PTS reference instead.</p>';
  return `<p><strong>Orbit reference:</strong> ${escapeBookingEmailText(reference)}.${bankTransfer ? ' Please use this Orbit reference as the bank-transfer payment reference.' : ''}</p>`;
}

const COMMISSION_TRIGGERS = new Set([
  "commission_claimable", "commission_claimed", "commission_due_for_payment", "commission_paid",
]);
export function usesOrbitBookingEmailReference(triggerKey: string): boolean {
  return triggerKey === "added_to_pts" || COMMISSION_TRIGGERS.has(triggerKey);
}

const BANK_GUIDANCE = '<p>{{#if orbitRef}}<strong>Bank transfer payments:</strong> If your client is paying by bank transfer, they should use <strong>{{orbitRef}}</strong> as the payment reference so the funds are matched correctly.{{/if}}</p>';
const MISSING_GUIDANCE = '<p>{{#if orbitRefMissing}}<strong>Orbit reference not recorded:</strong> Please check this booking in the Portal or contact JLT before making a bank transfer. Do not use the PTS reference instead.{{/if}}</p>';

/**
 * Upgrades only the approved booking notifications at read/render time. Stored
 * customised wording is not overwritten, historic mail is unchanged, and PPS
 * card-link paragraphs/list items keep their actual PTS reference.
 */
export function normaliseBookingReferenceTemplate<T extends { triggerKey: string; subject: string; bodyHtml: string }>(template: T): T {
  if (!usesOrbitBookingEmailReference(template.triggerKey)) return template;
  const upgrade = (value: string) => value
    .replace(/\{\{(?:ptsRef|topdogRef|crmRef)\}\}/g, "{{orbitRef}}")
    .replace(/\bPTS\s+(Reference|Ref)\b/gi, "Orbit reference")
    .replace(/\bTopdog\s+(Reference|Ref)\b/gi, "Orbit reference");
  const subject = upgrade(template.subject).replace(/\{\{orbitRef\}\}/g, "{{orbitRefDisplay}}");
  let bodyHtml = template.bodyHtml;

  if (template.triggerKey === "added_to_pts") {
    const protectedBlocks: string[] = [];
    bodyHtml = bodyHtml.replace(/<(li|p)\b[^>]*>[\s\S]*?<\/\1>/gi, block => {
      const text = block.replace(/<[^>]+>/g, " ");
      if (block.includes("{{#if orbitRefMissing}}") || (/\bPPS\b|order description/i.test(text) && !/bank[ -]?transfers?/i.test(text))) {
        const index = protectedBlocks.push(block) - 1;
        return `@@JLT_PPS_BLOCK_${index}@@`;
      }
      // A mixed bank/card paragraph cannot safely substitute one shared ref.
      // Split its instructions explicitly, without inventing bank details.
      if (/\bPPS\b|order description/i.test(text)) {
        if (/\{\{(?:ptsRef|topdogRef|crmRef)\}\}/.test(block)) {
          const index = protectedBlocks.push('<p><strong>PPS payment links:</strong> Continue to use <strong>{{ptsRef}}</strong> in the Order Description for manual PPS card links.</p>') - 1;
          return `${BANK_GUIDANCE}@@JLT_PPS_BLOCK_${index}@@`;
        }
      }
      let updated = upgrade(block);
      if (/bank[ -]?transfers?/i.test(text) && !updated.includes("{{#if orbitRef}}") && !updated.includes("{{#if orbitRefMissing}}")) {
        updated = updated.replace(/^(<(?:li|p)\b[^>]*>)([\s\S]*)(<\/(?:li|p)>)$/i, '$1{{#if orbitRef}}$2{{/if}}$3');
      }
      return updated;
    });
    bodyHtml = upgrade(bodyHtml);
    bodyHtml = bodyHtml.replace(/@@JLT_PPS_BLOCK_(\d+)@@/g, (_match, index) => protectedBlocks[Number(index)]);
    bodyHtml = bodyHtml.replace("Please keep this reference to hand, as you will need it in two important situations:", "Please use the correct reference for each payment method:");
    if (!/bank[ -]?transfers?/i.test(bodyHtml)) bodyHtml += BANK_GUIDANCE;
    if (!bodyHtml.includes("{{#if orbitRefMissing}}")) bodyHtml += MISSING_GUIDANCE;
  } else {
    bodyHtml = upgrade(bodyHtml);
  }
  if (!/\{\{orbitRef(?:Display)?\}\}/.test(bodyHtml)) bodyHtml += '<p><strong>Orbit reference:</strong> {{orbitRefDisplay}}</p>';
  return { ...template, subject, bodyHtml };
}
