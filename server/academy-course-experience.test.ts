import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normaliseAcademyLessonContent } from "../shared/academy-lesson-content";
import { loomEmbedUrl, parseLoomEmbedId } from "../shared/loom-embed";

const courseSource = readFileSync(resolve(process.cwd(), "client/src/pages/academy/AcademyCourse.tsx"), "utf8");
const portalCss = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");

describe("Academy learner course experience", () => {
  it("renders legacy plain lesson content with readable paragraphs, headings and lists", () => {
    const rendered = normaliseAcademyLessonContent(`What You'll Learn
The Academy covers:
• Find bookings in Orbit
• Keep client records accurate

Take your time with each lesson.`);
    const copiedList = normaliseAcademyLessonContent(`A good travel agent will:
Understand what the client needs.
Research destinations, hotels and suppliers.
Compare options clearly.

Keep your records up to date.`);
    const editorParagraphList = normaliseAcademyLessonContent(`<p><strong>What You'll Learn</strong></p><p>The Academy will guide you through:</p><p>How the travel industry works and where you fit within it</p><p>The systems, suppliers and booking tools you'll use at JLT</p><p>How to confidently quote, book and manage your clients</p><p>The processes and standards you need to follow when running your business</p>`);

    expect(rendered).toContain("<h2>What You&#039;ll Learn</h2>");
    expect(rendered).toContain("<strong>The Academy covers:</strong>");
    expect(rendered).toContain("<ul><li>Find bookings in Orbit</li><li>Keep client records accurate</li></ul>");
    expect(rendered).toContain("<p>Take your time with each lesson.</p>");
    expect(copiedList).toContain("<ul><li>Understand what the client needs.</li><li>Research destinations, hotels and suppliers.</li><li>Compare options clearly.</li></ul>");
    expect(copiedList).toContain("<p>Keep your records up to date.</p>");
    expect(editorParagraphList).toContain("<h2><strong>What You'll Learn</strong></h2>");
    expect(editorParagraphList).toContain("<ul><li>How the travel industry works and where you fit within it</li><li>The systems, suppliers and booking tools you'll use at JLT</li><li>How to confidently quote, book and manage your clients</li><li>The processes and standards you need to follow when running your business</li></ul>");
    expect(normaliseAcademyLessonContent("<p><strong>Rich text stays intact</strong></p>")).toBe("<p><strong>Rich text stays intact</strong></p>");
  });

  it("preserves deliberate legacy breaks, inline emphasis and real rich blocks in the same lesson", () => {
    const rendered = normaliseAcademyLessonContent(`<div class="word">What you will learn:</div><div>Find bookings in Orbit</div><div>Keep client records accurate</div><br class="Apple-interchange-newline"><p><strong>• Give practical advice</strong></p><ul><li>Already a real list</li></ul><div>Finish with this reminder.</div>`);
    expect(rendered).toContain("<p><strong>What you will learn:</strong></p>");
    expect(rendered).toContain("<ul><li>Find bookings in Orbit</li><li>Keep client records accurate</li></ul>");
    expect(rendered).toContain("<ul><li><strong>Give practical advice</strong></li></ul>");
    expect(rendered).toContain("<ul><li>Already a real list</li></ul>");
    expect(rendered).toContain("<p>Finish with this reminder.</p>");
  });

  it("embeds only recognised HTTPS Loom share URLs", () => {
    const id = "a1b2c3d4e5f6";
    expect(parseLoomEmbedId(`https://www.loom.com/share/${id}?sid=session`)).toBe(id);
    expect(loomEmbedUrl(`https://loom.com/embed/${id}`)).toBe(`https://www.loom.com/embed/${id}`);
    expect(loomEmbedUrl("https://example.com/video")).toBeNull();
  });

  it("uses a compact single-module course map and plays Loom inside the lesson", () => {
    expect(courseSource).toContain("const [expandedModuleId, setExpandedModuleId]");
    expect(courseSource).toContain("aria-controls={`academy-course-module-${module.id}`}");
    expect(courseSource).toContain("lg:max-h-[calc(100vh-3rem)]");
    expect(courseSource).toContain("normaliseAcademyLessonContent(selectedLesson.contentHtml)");
    expect(courseSource).toContain("<iframe");
    expect(courseSource).toContain("Watch within the Portal");
    expect(courseSource).toContain("loomEmbedUrl(selectedLesson.videoUrl)");
  });

  it("uses explicit Academy lesson styles rather than optional Typography utilities", () => {
    expect(courseSource).toContain('className="academy-lesson-content max-w-none text-[15px] leading-7 text-foreground"');
    expect(courseSource).not.toContain("prose-ul:list-disc");
    expect(portalCss).toContain(".academy-lesson-content p");
    expect(portalCss).toContain(".academy-lesson-content ul { list-style-type: disc !important; }");
    expect(portalCss).toContain(".academy-lesson-content ol { list-style-type: decimal !important; }");
    expect(portalCss).toContain(".academy-lesson-content li");
  });

  it("shows a single current learning path and a deliberate knowledge-check retry outcome", () => {
    expect(courseSource).toContain("lesson.locked || blockedByFeedback");
    expect(courseSource).toContain('Complete ${blockingLesson?.title ?? "the current lesson"} to unlock this lesson.');
    expect(courseSource).toContain("const [failedKnowledgeCheck, setFailedKnowledgeCheck]");
    expect(courseSource).toContain("Knowledge check not passed yet");
    expect(courseSource).toContain("Retry knowledge check");
    expect(courseSource).toContain("100% is required before you can move to the next lesson");
    expect(courseSource).toContain("const nextUnlockedLesson");
    expect(courseSource).toContain("Next lesson");
  });

  it("returns a learner to the top only after the next lesson has rendered", () => {
    expect(courseSource).toContain("const scrollToTopAfterNextLesson = useRef(false)");
    expect(courseSource).toContain("window.scrollTo({");
    expect(courseSource).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"');
    expect(courseSource).toContain("chooseLesson(nextUnlockedLesson.id, { scrollToTop: true })");
  });
});
