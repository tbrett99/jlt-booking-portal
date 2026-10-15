import { describe, expect, it } from "vitest";
import {
  applyMarketingMergeTags,
  getCampaignDiscoveryCallLink,
  hasApplicationLinkMergeTag,
  wrapInBrandedTemplate,
} from "./resend-email";
import { normaliseMarketingEmailHtml, plainTextToMarketingEmailHtml } from "@shared/marketing-email-html";

const discoveryCallLink = "https://booking.example.com/jlt-discovery";

describe("email campaign secure-link merge tags", () => {
  it("renders a prospect's application and discovery links inside campaign HTML", () => {
    const html = applyMarketingMergeTags(
      '<p>Hi {{first_name}}</p><a href="{{application_link}}">Apply</a><a href="{{discovery_call_link}}">Book</a>',
      { name: "Jamie Smith", email: "jamie@example.com" },
      {
        applicationLink: "https://portal.thejltgroup.co.uk/apply/form?token=secure-token",
        discoveryCallLink,
      },
    );

    expect(html).toContain("Hi Jamie");
    expect(html).toContain('href="https://portal.thejltgroup.co.uk/apply/form?token=secure-token"');
    expect(html).toContain(`href="${discoveryCallLink}"`);
    expect(html).not.toContain("{{application_link}}");
    expect(html).not.toContain("{{discovery_call_link}}");
  });

  it("keeps workflow-style application and discovery tag aliases compatible", () => {
    const rendered = applyMarketingMergeTags(
      "{{applicationLink}} — {{discoveryCallLink}}",
      {},
      {
        applicationLink: "https://portal.thejltgroup.co.uk/apply/form?token=existing",
        discoveryCallLink,
      },
    );

    expect(rendered).toBe(
      `https://portal.thejltgroup.co.uk/apply/form?token=existing — ${discoveryCallLink}`,
    );
  });

  it("recognises both supported application-link spellings before queueing a campaign", () => {
    expect(hasApplicationLinkMergeTag('<a href="{{application_link}}">Apply</a>')).toBe(true);
    expect(hasApplicationLinkMergeTag('<a href="{{applicationLink}}">Apply</a>')).toBe(true);
    expect(hasApplicationLinkMergeTag("Book at {{discovery_call_link}}")).toBe(false);
  });

  it("uses only an HTTPS booking page explicitly saved on the campaign", () => {
    expect(getCampaignDiscoveryCallLink(JSON.stringify({ discoveryCallUrl: discoveryCallLink }))).toBe(discoveryCallLink);
    expect(getCampaignDiscoveryCallLink(JSON.stringify({ discoveryCallUrl: "http://booking.example.com" }))).toBeUndefined();
    expect(getCampaignDiscoveryCallLink(undefined)).toBeUndefined();
  });

  it("repairs legacy visual merge tags and split CTA content before delivery", () => {
    const source = '<p>Hi <span style="background:#e0fdf4;color:#0f766e">{{first_name}}</span></p><div data-button-block="true"><a href="https://booking.example.com" style="background:#02E6D2;color:#414141"></a>Book your call</div>';
    const rendered = applyMarketingMergeTags(normaliseMarketingEmailHtml(source), { name: "Jerry Prospect" });

    expect(rendered).toContain("Hi Jerry");
    expect(rendered).not.toContain("#0f766e");
    expect(rendered).toContain('data-cta="true"');
    expect(rendered).toContain('href="https://booking.example.com"');
    expect(rendered).toContain(">Book your call</a>");
    expect(rendered).toContain("margin:0 0 18px 0");
  });

  it("turns plain-text pasted paragraphs into email-safe paragraph markup", () => {
    expect(plainTextToMarketingEmailHtml("First paragraph\nwith a line break\n\nSecond paragraph")).toBe(
      "<p>First paragraph<br/>with a line break</p><p>Second paragraph</p>",
    );
  });

  it("keeps the branded wrapper compatible with table-based CTA markup", () => {
    const html = wrapInBrandedTemplate({
      bodyHtml: normaliseMarketingEmailHtml('<div data-button-block="true"><a href="https://booking.example.com">Book</a></div>'),
      audienceType: "prospect",
    });
    expect(html).toContain('role="presentation"');
    expect(html).toContain('data-cta="true"');
  });
});
