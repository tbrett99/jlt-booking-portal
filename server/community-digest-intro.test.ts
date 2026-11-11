import { describe, expect, it } from "vitest";
import {
  digestTextToEditorHtml,
  formatDigestIntro,
  sanitizeDigestEditorHtml,
} from "../shared/community-digest-format";
import { formatCommunityDigestIntro } from "./community-digest-intro";

function withoutStyles(html: string): string {
  return html.replace(/ style="[^"]*"/g, "");
}

describe("community digest intro formatting", () => {
  it("preserves real line breaks and paragraphs, including CRLF and bare CR", () => {
    const html = formatCommunityDigestIntro(
      "Hello team,\n\nThank you for a brilliant week.\r\nSee you soon.\rBest wishes."
    );
    expect(withoutStyles(html)).toBe(
      "<p>Hello team,</p>\n<p>Thank you for a brilliant week.<br />\nSee you soon.<br />\nBest wishes.</p>"
    );
    expect(html).toContain('style="margin:0 0 12px;line-height:1.6;"');
  });

  it("formats synthetic bold money figures, paragraphs, headings and lists without rewriting wording", () => {
    const text =
      "## This week's update\n\n**£12,345.67** booked by **24 agents** — thank you!\n\nCommission: **£1,234.50**\nOutstanding: £250.00\n\n• Follow up with guests\n• Confirm the £99 deposit\n\n1. Check your bookings\n2. Share your wins";
    const html = withoutStyles(formatCommunityDigestIntro(text));
    expect(html).toContain("<h2>This week's update</h2>");
    expect(html).toContain(
      "<p><strong>£12,345.67</strong> booked by <strong>24 agents</strong> — thank you!</p>"
    );
    expect(html).toContain(
      "<p>Commission: <strong>£1,234.50</strong><br />\nOutstanding: £250.00</p>"
    );
    expect(html).toContain(
      "<ul>\n<li>Follow up with guests</li>\n<li>Confirm the £99 deposit</li>\n</ul>"
    );
    expect(html).toContain(
      "<ol>\n<li>Check your bookings</li>\n<li>Share your wins</li>\n</ol>"
    );
    expect(html).not.toContain("**");
  });

  it("supports Markdown emphasis, quotes, numbered-list starts and safe links", () => {
    const html = withoutStyles(
      formatCommunityDigestIntro(
        "*Thanks* and ~~well done~~\n\n> Keep going\n\n3. Third step\n4. Fourth step\n\n[Visit](https://example.com/a?x=1&y=2) and [Email](mailto:team@example.com)"
      )
    );
    expect(html).toContain("<em>Thanks</em> and <s>well done</s>");
    expect(html).toContain("<blockquote>\n<p>Keep going</p>\n</blockquote>");
    expect(html).toContain('<ol start="3">');
    expect(html).toContain(
      '<a href="https://example.com/a?x=1&amp;y=2">Visit</a>'
    );
    expect(html).toContain('<a href="mailto:team@example.com">Email</a>');
  });

  it("keeps inline and fenced code and does not turn code's Unicode bullets into lists", () => {
    const html = withoutStyles(
      formatCommunityDigestIntro(
        "Use `**literal** <tag>`\n\n```html\n• keep this bullet\n<script>alert(1)</script>\n```\n\n    • indented code\n\n• actual list"
      )
    );
    expect(html).toContain("<code>**literal** &lt;tag&gt;</code>");
    expect(html).toContain(
      "<pre><code>• keep this bullet\n&lt;script&gt;alert(1)&lt;/script&gt;\n</code></pre>"
    );
    expect(html).toContain("<pre><code>• indented code\n</code></pre>");
    expect(html).toContain("<ul>\n<li>actual list</li>\n</ul>");
    expect(html).not.toContain("language-html");
  });

  it.each(["•", "●", "▪", "◦", "‣", "⁃"])(
    "recognizes pasted %s bullet markers",
    bullet => {
      expect(
        withoutStyles(formatDigestIntro(`${bullet} First\n${bullet} Second`))
      ).toBe("<ul>\n<li>First</li>\n<li>Second</li>\n</ul>");
    }
  );

  it("does not apply typographic substitutions or alter a Unicode bullet within a sentence", () => {
    expect(
      withoutStyles(formatDigestIntro('"Team" -- thank you... £10.00 • bonus'))
    ).toBe('<p>"Team" -- thank you... £10.00 • bonus</p>');
  });

  it("escapes literal angle brackets and injected markup by default, without guessing HTML", () => {
    const input =
      '<strong>Important</strong> & thanks\n2 < 3 and 5 > 4\n<script>alert("x")</script>\n<img src="https://tracker.example/pixel" onerror="alert(1)">';
    const html = withoutStyles(formatCommunityDigestIntro(input));
    expect(html).toContain(
      "&lt;strong&gt;Important&lt;/strong&gt; &amp; thanks"
    );
    expect(html).toContain("2 &lt; 3 and 5 &gt; 4");
    expect(html).toContain('&lt;script&gt;alert("x")&lt;/script&gt;');
    expect(html).toContain(
      '&lt;img src="https://tracker.example/pixel" onerror="alert(1)"&gt;'
    );
    expect(html).not.toMatch(/<(?:script|img|strong)\b/);
    expect(
      withoutStyles(
        formatCommunityDigestIntro("<strong>Important</strong>", "html")
      )
    ).toBe("<strong>Important</strong>");
  });

  it("sanitizes explicit HTML, preserving safe semantics but stripping active/media contents and arbitrary attributes", () => {
    const input =
      '<p class="secret" id="track" style="background:url(https://tracker.example/p);color:red" onclick="steal()">Hello <b>team</b><br><i>great work</i> <u>today</u> <del>old</del></p>' +
      "<script>alert(1)</script><style>body{display:none}</style><svg><text>svg payload</text></svg>" +
      '<form><p>form payload</p><input value="bad"></form><iframe src="https://tracker.example">iframe payload</iframe>' +
      '<img src="https://tracker.example/pixel" onerror="steal()"><object>object payload</object>' +
      '<a href="https://example.com" ping="https://tracker.example" target="_blank" rel="opener" data-track="1">Visit</a>';
    const html = formatCommunityDigestIntro(input, "html");
    expect(withoutStyles(html)).toBe(
      '<p>Hello <strong>team</strong><br /><em>great work</em> <u>today</u> <s>old</s></p><a href="https://example.com">Visit</a>'
    );
    expect(html).not.toMatch(
      /tracker|payload|alert|steal|onclick|onerror|class=|id=|ping=|target=|rel=|data-track=|background|color:red/
    );
    expect(html).toContain('style="color:#2563eb;text-decoration:underline;"');
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java&#x09;script:alert(1)",
    "&#106;avascript:alert(1)",
    "data:text/html,bad",
    "vbscript:bad",
    "ftp://example.com",
    "//tracker.example",
    "/relative",
    "relative",
    "#fragment",
    "https:example.com",
    "https:\\tracker.example",
    "https://example.com&#10;bad",
    "https://",
    "mailto:",
  ])(
    "rejects unsafe or non-absolute HTML href %s while retaining label",
    href => {
      const html = formatDigestIntro(
        `<p><a href="${href}" onclick="bad()">Keep this label</a></p>`,
        "html"
      );
      expect(html).not.toContain("href=");
      expect(html).toContain(">Keep this label</a>");
      expect(html).not.toContain("onclick");
    }
  );

  it.each([
    "https://example.com/path",
    "http://example.com",
    "mailto:team@example.com",
    "HTTPS://example.com",
  ])("retains allowed explicit href %s", href => {
    expect(formatDigestIntro(`<a href="${href}">Link</a>`, "html")).toContain(
      `href="${href}"`
    );
  });

  it("rejects dangerous and relative Markdown links and never emits tracking images", () => {
    const html = formatDigestIntro(
      "[Danger](javascript:alert(1)) [Data](data:text/html,bad) [Relative](/path) [Protocol](//example.com) ![Pixel](https://tracker.example/pixel)"
    );
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<img");
    expect(html).toContain("Danger");
    expect(html).toContain("Relative");
    expect(html).toContain("Pixel");
  });

  it("retains a Markdown image label as safe text, including literal markup", () => {
    const html = withoutStyles(
      formatDigestIntro(
        "![<img src=x onerror=bad()> & team](https://tracker.example/pixel)"
      )
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("tracker.example");
    expect(html).toContain("&lt;img src=x onerror=bad()&gt;");
    expect(html).toContain("&amp; team");
  });

  it("handles unknown hostile tag names without inheriting object properties", () => {
    expect(
      withoutStyles(
        formatDigestIntro(
          "<constructor>Keep</constructor><toString> wording</toString><__proto__> safely</__proto__>",
          "html"
        )
      )
    ).toContain("Keep");
  });

  it.each([null, undefined, "", "   \n  ", "\r\n\t"])(
    "does not render a blank Markdown intro card for %s",
    content => {
      expect(formatCommunityDigestIntro(content)).toBe("");
    }
  );

  it.each([
    "",
    " \r\n ",
    "<p></p>",
    "<p><br /></p>",
    "<p> &nbsp; &#160; &#xA0; </p>",
    "<ul><li><br></li></ul>",
    "<ol><li> </li></ol>",
    "<p>&#8203;</p>",
    "<hr>",
    '<img src="https://tracker.example/pixel">',
    "<script>alert(1)</script>",
    "<style>p { color:red }</style>",
  ])("does not render an empty HTML intro card for %s", content => {
    expect(formatDigestIntro(content, "html")).toBe("");
    expect(sanitizeDigestEditorHtml(content)).toBe("");
  });

  it("keeps paragraphs, explicit breaks and code whitespace unchanged in HTML mode", () => {
    const input =
      "<p>First<br>Second</p><p>Third</p><pre><code> a\n b\n</code></pre>";
    expect(withoutStyles(formatDigestIntro(input, "html"))).toBe(
      "<p>First<br />Second</p><p>Third</p><pre><code> a\n b\n</code></pre>"
    );
  });

  it("is idempotent when sanitized HTML is parsed again explicitly", () => {
    const first = formatDigestIntro(
      "# Update\n\n**£1,000**\nNext line with `code`\n\n• One\n• Two\n\n3. Three\n4. Four\n\n[Link](https://example.com?a=1&b=2)\n\n---"
    );
    expect(formatDigestIntro(first, "html")).toBe(first);
    expect(sanitizeDigestEditorHtml(first)).toBe(first);
    const editorHtml =
      '<p style="color:red">Hello&nbsp;<strong>team</strong><br />Next</p><ul><li>A</li><li>B</li></ul>';
    const clean = formatDigestIntro(editorHtml, "html");
    expect(formatDigestIntro(clean, "html")).toBe(clean);
  });

  it("migrates text to editor HTML using the same safe shared formatter", () => {
    const text = "**£2,500**\n\n• Keep <literal> words\n• Thanks";
    expect(digestTextToEditorHtml(text)).toBe(formatDigestIntro(text));
    expect(formatCommunityDigestIntro(text)).toBe(formatDigestIntro(text));
    expect(
      formatCommunityDigestIntro(digestTextToEditorHtml(text), "html")
    ).toBe(digestTextToEditorHtml(text));
  });

  it("does not support tables in either format and retains their wording", () => {
    const markdown = formatDigestIntro(
      "| Item | Total |\n| --- | --- |\n| Bookings | £99 |"
    );
    const html = formatDigestIntro(
      "<table><tr><th>Item</th><th>Total</th></tr><tr><td>Bookings</td><td>£99</td></tr></table>",
      "html"
    );
    expect(markdown).not.toContain("<table");
    expect(html).not.toMatch(/<(?:table|tr|th|td)\b/);
    expect(markdown).toContain("£99");
    expect(html).toContain("£99");
  });
});
