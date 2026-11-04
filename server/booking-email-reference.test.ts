import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bookingOrbitReference, normaliseBookingReferenceTemplate, orbitReferenceEmailParagraph } from "../shared/booking-email-reference";
import { buildRemittanceBookingList, remittanceOrbitReferenceMap } from "./remittance-email-reference";

const legacy = {
  triggerKey: "added_to_pts",
  subject: "Booking Added to PTS — Reference: {{ptsRef}}",
  bodyHtml: '<p>Hi {{agentName}},</p><p>Custom staff intro retained.</p><p><strong>Your PTS Reference is: {{ptsRef}}</strong></p><ul><li><strong>Bank transfer payments:</strong> Use <strong>{{ptsRef}}</strong> as the payment reference.</li><li><strong>PPS payment links:</strong> Use <strong>{{ptsRef}}</strong> in the Order Description.</li></ul><p>Custom sign-off retained.</p>',
  isActive: false,
};
function render(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, key, inner) => vars[key]?.trim() ? inner : "")
    .replace(/\{\{(\w+)\}\}/g, (_m, key) => vars[key] ?? "");
}

describe("Orbit booking email policy", () => {
  it("uses only trimmed crmRef, not PTS, Topdog or booking ID", () => {
    expect(bookingOrbitReference({ crmRef: "  ORBIT-44  " })).toBe("ORBIT-44");
    for (const crmRef of [undefined, null, "", "  "]) expect(bookingOrbitReference({ crmRef })).toBeNull();
  });
  it("upgrades the live saved template without replacing custom text or inactive flags", () => {
    const result = normaliseBookingReferenceTemplate(legacy);
    expect(result.subject).toContain("{{orbitRefDisplay}}");
    expect(result.subject).not.toContain("{{ptsRef}}");
    expect(result.bodyHtml).toContain("Your Orbit reference is: {{orbitRef}}");
    expect(result.bodyHtml).toContain("Custom staff intro retained.");
    expect(result.bodyHtml).toContain("Custom sign-off retained.");
    expect(result.isActive).toBe(false);
    const html = render(result.bodyHtml, { orbitRef: "ORBIT-44", orbitRefDisplay: "ORBIT-44", orbitRefMissing: "", ptsRef: "PTS-99" });
    expect(html).toContain("Use <strong>ORBIT-44</strong> as the payment reference");
    expect(html).toContain("Use <strong>PTS-99</strong> in the Order Description");
  });
  it("is idempotent across template listing, saving and sending", () => {
    const once = normaliseBookingReferenceTemplate(legacy);
    expect(normaliseBookingReferenceTemplate(once)).toEqual(once);
    for (const triggerKey of ["commission_claimable", "commission_claimed", "commission_due_for_payment", "commission_paid"]) {
      const template = normaliseBookingReferenceTemplate({ triggerKey, subject: "Commission", bodyHtml: "<p>Thanks.</p>" });
      expect(normaliseBookingReferenceTemplate(template)).toEqual(template);
    }
  });
  it("does not send a bank-transfer instruction with a missing reference", () => {
    const template = normaliseBookingReferenceTemplate(legacy);
    const html = render(template.bodyHtml, { orbitRef: "", orbitRefDisplay: "Not recorded", orbitRefMissing: "yes", ptsRef: "PTS-99" });
    expect(html).not.toContain("Bank transfer payments:");
    expect(html).toContain("Orbit reference not recorded:");
    expect(html).toContain("Do not use the PTS reference instead");
    expect(html).toContain("Use <strong>PTS-99</strong> in the Order Description");
  });
  it("adds correct bank-transfer guidance to older short templates", () => {
    const result = normaliseBookingReferenceTemplate({ triggerKey: "added_to_pts", subject: "Booking added", bodyHtml: "<p>Custom intro</p>" });
    expect(result.bodyHtml).toContain("Bank transfer payments:");
    expect(result.bodyHtml).toContain("{{orbitRef}}");
    expect(result.bodyHtml).toContain("Custom intro");
    expect(normaliseBookingReferenceTemplate(result)).toEqual(result);
  });
  it("splits a mixed bank/PPS paragraph so each method has its own reference", () => {
    const result = normaliseBookingReferenceTemplate({ ...legacy, bodyHtml: "<p>Use {{ptsRef}} for bank transfers and the PPS Order Description.</p>" });
    const html = render(result.bodyHtml, { orbitRef: "ORBIT-44", orbitRefDisplay: "ORBIT-44", orbitRefMissing: "", ptsRef: "PTS-99" });
    expect(html).toContain("ORBIT-44</strong> as the payment reference");
    expect(html).toContain("PTS-99</strong> in the Order Description");
    expect(normaliseBookingReferenceTemplate(result)).toEqual(result);
  });
  it.each(["commission_claimable", "commission_claimed", "commission_due_for_payment", "commission_paid"])("upgrades %s refs and does not rename PTS amendment fees", triggerKey => {
    const result = normaliseBookingReferenceTemplate({ triggerKey, subject: "Commission {{ptsRef}}", bodyHtml: "<p>PTS Ref: {{ptsRef}}</p><p>PTS amendment fees still apply.</p>" });
    expect(result.subject).toBe("Commission {{orbitRefDisplay}}");
    expect(result.bodyHtml).toContain("Orbit reference: {{orbitRef}}");
    expect(result.bodyHtml).not.toContain("{{ptsRef}}");
    expect(result.bodyHtml).toContain("PTS amendment fees still apply");
  });
  it("leaves non-approved payment receipt and admin reference templates untouched", () => {
    for (const triggerKey of ["payment_received", "creating_own_pts_file", "not_on_topdog", "query"]) {
      const template = { ...legacy, triggerKey };
      expect(normaliseBookingReferenceTemplate(template)).toBe(template);
    }
  });
  it("escapes Orbit references and tells staff to check missing references", () => {
    expect(orbitReferenceEmailParagraph({ crmRef: 'ORBIT<&"\'' }, true)).toContain("ORBIT&lt;&amp;&quot;&#039;");
    expect(orbitReferenceEmailParagraph({ crmRef: " " }, true)).toContain("do not use the PTS reference instead");
    expect(orbitReferenceEmailParagraph({ crmRef: " " }, true)).not.toContain("Please use this Orbit reference");
  });
});

describe("all commission/top-up email paths", () => {
  const router = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
  const remittance = readFileSync(new URL("./remittance-router.ts", import.meta.url), "utf8");
  it("uses the shared Orbit paragraph in both initial top-up email paths", () => {
    expect(router.match(/\$\{orbitReferenceEmailParagraph\(booking, true\)\}/g)).toHaveLength(2);
    expect(router.match(/subject: `Action Required — File in Minus:.*bookingOrbitReference\(booking\)/g)).toHaveLength(2);
  });
  it("makes notification preview/edit use the same upgrade as the sender", () => {
    expect(router).toContain("(await getNotificationTemplates()).map(normaliseBookingReferenceTemplate)");
    expect(router).toContain("...normaliseBookingReferenceTemplate(input)");
  });
  it("uses Orbit in both remittance emails but preserves imported PTS matching", () => {
    expect(remittance.match(/buildRemittanceBookingList\(agentLines, orbitReferences\)/g)).toHaveLength(2);
    expect(remittance).not.toContain("${l.ptsRef}");
    expect(remittance).toContain("eq(bookings.ptsRef, ref)");
  });
  it("does not take a remittance reference from a different booking owner or from a PTS fallback", () => {
    const refs = remittanceOrbitReferenceMap([{ id: 101, agentId: 10, crmRef: " ORBIT-101 " }, { id: 102, agentId: 20, crmRef: "ORBIT-OTHER-AGENT" }]);
    const list = buildRemittanceBookingList([
      { bookingId: 101, agentId: 10, clientName: "Client", remit80: "12.00" },
      { bookingId: 102, agentId: 10, clientName: "Other", remit80: "5.00" },
      { bookingId: null, agentId: 10, clientName: "Unlinked", remit80: "0" },
    ], refs);
    expect(list).toContain("Orbit reference: ORBIT-101");
    expect(list.match(/Orbit reference not recorded/g)).toHaveLength(2);
    expect(list).not.toContain("ORBIT-OTHER-AGENT");
  });
  it("keeps the booking-page transfer guidance consistent while preserving PPS Order Description", () => {
    const page = readFileSync(new URL("../client/src/pages/agent/AgentBookingDetail.tsx", import.meta.url), "utf8");
    expect(page).toContain("Use your Orbit reference for bank transfers");
    expect(page).toContain("{booking.crmRef.trim()}");
    expect(page).toContain("continue to use the PTS reference");
  });
});
