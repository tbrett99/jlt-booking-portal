import { describe, expect, it } from "vitest";
import { plainTextToLessonHtml } from "../client/src/components/RichEmailEditor";

describe("Academy smart clipboard formatting", () => {
  it("turns text-only training copy into headings, paragraphs and lists", () => {
    const html = plainTextToLessonHtml(`Welcome to JLT Academy

You are officially part of JLT — and this is where it all starts.

What You’ll Learn
The Academy will guide you through:
How the travel industry works
The systems, suppliers and booking tools you will use
How to confidently quote and manage your clients

How the Academy Works
The training is self-paced, so you can work through each module in your own time.`);

    expect(html).toContain("<h2>Welcome to JLT Academy</h2>");
    expect(html).toContain("<h2>What You’ll Learn</h2>");
    expect(html).toContain("<strong>The Academy will guide you through:</strong>");
    expect(html).toContain("<ul><li>How the travel industry works</li>");
    expect(html).toContain("<h2>How the Academy Works</h2>");
    expect(html).toContain("<p>The training is self-paced");
  });

  it("retains explicit bullet lists and escapes pasted markup", () => {
    const html = plainTextToLessonHtml(`Key actions
• Check your booking details
• <script>Never paste executable markup</script>`);

    expect(html).toContain("<ul><li>Check your booking details</li>");
    expect(html).toContain("&lt;script&gt;Never paste executable markup&lt;/script&gt;");
  });
});
