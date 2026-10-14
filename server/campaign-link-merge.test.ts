import { describe, expect, it } from "vitest";
import {
  DISCOVERY_CALL_BOOKING_URL,
  applyMarketingMergeTags,
  hasApplicationLinkMergeTag,
} from "./resend-email";

describe("email campaign secure-link merge tags", () => {
  it("renders a prospect's application and discovery links inside campaign HTML", () => {
    const html = applyMarketingMergeTags(
      '<p>Hi {{first_name}}</p><a href="{{application_link}}">Apply</a><a href="{{discovery_call_link}}">Book</a>',
      { name: "Jamie Smith", email: "jamie@example.com" },
      {
        applicationLink: "https://portal.thejltgroup.co.uk/apply/form?token=secure-token",
        discoveryCallLink: DISCOVERY_CALL_BOOKING_URL,
      },
    );

    expect(html).toContain("Hi Jamie");
    expect(html).toContain('href="https://portal.thejltgroup.co.uk/apply/form?token=secure-token"');
    expect(html).toContain(`href="${DISCOVERY_CALL_BOOKING_URL}"`);
    expect(html).not.toContain("{{application_link}}");
    expect(html).not.toContain("{{discovery_call_link}}");
  });

  it("keeps workflow-style application and discovery tag aliases compatible", () => {
    const rendered = applyMarketingMergeTags(
      "{{applicationLink}} — {{discoveryCallLink}}",
      {},
      {
        applicationLink: "https://portal.thejltgroup.co.uk/apply/form?token=existing",
        discoveryCallLink: DISCOVERY_CALL_BOOKING_URL,
      },
    );

    expect(rendered).toBe(
      `https://portal.thejltgroup.co.uk/apply/form?token=existing — ${DISCOVERY_CALL_BOOKING_URL}`,
    );
  });

  it("recognises both supported application-link spellings before queueing a campaign", () => {
    expect(hasApplicationLinkMergeTag('<a href="{{application_link}}">Apply</a>')).toBe(true);
    expect(hasApplicationLinkMergeTag('<a href="{{applicationLink}}">Apply</a>')).toBe(true);
    expect(hasApplicationLinkMergeTag("Book at {{discovery_call_link}}")).toBe(false);
  });
});
