import { describe, expect, it } from "vitest";
import { formatCommunityDigestIntro } from "./community-digest-intro";

describe("community digest intro formatting", () => {
  it("preserves line and paragraph breaks as email-safe HTML", () => {
    expect(formatCommunityDigestIntro("Hello team,\n\nThank you for a brilliant week.\r\nSee you soon."))
      .toBe("Hello team,<br /><br />Thank you for a brilliant week.<br />See you soon.");
  });

  it("escapes plain-text HTML so formatting cannot inject email markup", () => {
    expect(formatCommunityDigestIntro("<strong>Important</strong> & thanks"))
      .toBe("&lt;strong&gt;Important&lt;/strong&gt; &amp; thanks");
  });

  it("does not render an empty or whitespace-only intro card", () => {
    expect(formatCommunityDigestIntro("   \n  ")).toBe("");
  });
});
