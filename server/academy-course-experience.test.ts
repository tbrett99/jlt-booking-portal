import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normaliseAcademyLessonContent } from "../shared/academy-lesson-content";
import { loomEmbedUrl, parseLoomEmbedId } from "../shared/loom-embed";

const courseSource = readFileSync(resolve(process.cwd(), "client/src/pages/academy/AcademyCourse.tsx"), "utf8");

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

    expect(rendered).toContain("<h2>What You&#039;ll Learn</h2>");
    expect(rendered).toContain("<strong>The Academy covers:</strong>");
    expect(rendered).toContain("<ul><li>Find bookings in Orbit</li><li>Keep client records accurate</li></ul>");
    expect(rendered).toContain("<p>Take your time with each lesson.</p>");
    expect(copiedList).toContain("<ul><li>Understand what the client needs.</li><li>Research destinations, hotels and suppliers.</li><li>Compare options clearly.</li></ul>");
    expect(copiedList).toContain("<p>Keep your records up to date.</p>");
    expect(normaliseAcademyLessonContent("<p><strong>Rich text stays intact</strong></p>")).toBe("<p><strong>Rich text stays intact</strong></p>");
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

  it("shows a single current learning path and a deliberate knowledge-check retry outcome", () => {
    expect(courseSource).toContain("lesson.locked || blockedByFeedback");
    expect(courseSource).toContain("Locked until the current lesson is passed");
    expect(courseSource).toContain("const [failedKnowledgeCheck, setFailedKnowledgeCheck]");
    expect(courseSource).toContain("Knowledge check not passed yet");
    expect(courseSource).toContain("Retry knowledge check");
    expect(courseSource).toContain("100% is required before you can move to the next lesson");
  });
});
