import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { sanitiseInstructorLessonHtml } from "./academy-staff-html";

const attacks = [
  '<a href="javascript:INERT">link</a>',
  '<a href="java&#x73;cript:INERT">link</a>',
  '<a href="java&#x0a;script:INERT">link</a>',
  '<a href="data:text/html,INERT">link</a>',
  '<a href="vbscript:INERT">link</a>',
  '<img src="https://objects.example.test/own.png" /onload="INERT">',
  '<img src="https://objects.example.test/own.png" onerror="INERT">',
  '<img src="javascript:INERT">',
  '<img src="data:image/svg+xml,INERT">',
  '<img src="//objects.example.test/own.png">',
  '<svg><a href="javascript:INERT">link</a></svg>',
  '<math><mtext><img src="https://objects.example.test/own.png" /onload="INERT"></mtext></math>',
  '<script>INERT</script><p>Keep this.</p>',
  '<iframe src="https://untrusted.example.test"></iframe>',
  '<form><input name="location"><button>INERT</button></form>',
  '<p style="background-image:url(javascript:INERT);font-weight:bold">Safe bold</p>',
  '<a href="https://example.test" onclick="INERT" name="location" id="document">Safe</a>',
];
describe("Instructor parser-based stored HTML boundary", () => {
  it.each(attacks)("strips dangerous content from %s", source => {
    const html = sanitiseInstructorLessonHtml(source) ?? "";
    const window = new Window();
    const root = window.document.createElement("div");
    root.innerHTML = html;
    expect(root.querySelector("script,svg,math,iframe,form,input,button,object,embed,style")).toBeNull();
    for (const element of root.querySelectorAll("*")) {
      for (const attr of element.attributes) {
        expect(attr.name).not.toMatch(/^on/i);
        expect(["id", "name", "srcdoc", "srcset"]).not.toContain(attr.name);
        if (["href", "src"].includes(attr.name)) {
          expect(attr.value.replace(/\s/g, "")).not.toMatch(/^(?:javascript|vbscript|data):|^\/\//i);
        }
        if (attr.name === "style") expect(attr.value).not.toMatch(/url\(|expression\(|behavior/i);
      }
    }
    window.happyDOM.abort();
  });
  it("preserves headings, paragraphs, line breaks, lists, tables and safe course images", () => {
    const html = sanitiseInstructorLessonHtml('<h2>Title</h2><p style="text-align:center;color:#414141">Line one<br>Line two</p><ul><li><strong>Bold</strong></li></ul><table><tbody><tr><td colspan="2">Cell</td></tr></tbody></table><img src="https://objects.example.test/own.png" alt="Lesson">');
    expect(html).toContain("<h2>Title</h2>"); expect(html).toContain("<br");
    expect(html).toContain("<ul><li><strong>Bold</strong></li></ul>"); expect(html).toContain('colspan="2"');
    expect(html).toContain('src="https://objects.example.test/own.png"'); expect(html).toContain("text-align:center");
  });
  it("preserves safe internal and HTTPS links and prevents opener access", () => {
    const html = sanitiseInstructorLessonHtml('<a href="/academy" target="_blank">Internal</a><a href="https://example.test">External</a>');
    expect(html).toContain('href="/academy"'); expect(html).toContain('href="https://example.test"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("returns null for missing content", () => {
    expect(sanitiseInstructorLessonHtml(null)).toBeNull(); expect(sanitiseInstructorLessonHtml("  ")).toBeNull();
  });
});
