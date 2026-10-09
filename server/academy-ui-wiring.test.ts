import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const app = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
const navigation = readFileSync(resolve(process.cwd(), "client/src/components/PortalLayout.tsx"), "utf8");
const agentHome = readFileSync(resolve(process.cwd(), "client/src/pages/academy/AcademyHome.tsx"), "utf8");
const agentCourse = readFileSync(resolve(process.cwd(), "client/src/pages/academy/AcademyCourse.tsx"), "utf8");
const manager = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademy.tsx"), "utf8");
const academyRouter = readFileSync(resolve(process.cwd(), "server/academy-router.ts"), "utf8");
const richEditor = readFileSync(resolve(process.cwd(), "client/src/components/RichEmailEditor.tsx"), "utf8");

describe("JLT Academy interface wiring", () => {
  it("exposes Academy for agents and the manager for admins", () => {
    expect(app).toContain('<Route path="/academy" component={AcademyHome} />');
    expect(app).toContain('<Route path="/admin/academy" component={AdminAcademy} />');
    expect(navigation).toContain('{ label: "JLT Academy", href: "/academy"');
    expect(navigation).toContain('{ label: "Academy Manager", href: "/admin/academy"');
  });

  it("keeps the Academy content-ready instead of pre-populating a course", () => {
    expect(agentHome).toContain("Your learning space is almost ready");
    expect(manager).toContain("Create your first course to start building a content-ready Academy");
    expect(manager).toContain("Nothing appears to agents until the course is published");
  });

  it("provides staff controls for resources, quizzes, manual access and accreditation", () => {
    expect(manager).toContain("Downloadable resource");
    expect(manager).toContain("Knowledge-check questions");
    expect(manager).toContain("Grant Academy");
    expect(manager).toContain("Accredit");
  });

  it("lets staff amend module and lesson names with an audit trail", () => {
    expect(manager).toContain("Edit module name or summary");
    expect(manager).toContain("Module updated");
    expect(manager).toContain("Edit lesson name and content");
    expect(academyRouter).toContain('action: "module_updated"');
    expect(academyRouter).toContain('action: "lesson_updated"');
  });

  it("keeps Academy Manager focused on one expandable module at a time", () => {
    expect(manager).toContain("const [openModuleId, setOpenModuleId]");
    expect(manager).toContain("aria-expanded={isOpen}");
    expect(manager).toContain("aria-controls={`academy-module-${module.id}`}");
    expect(manager).toContain("current === module.id ? null : module.id");
    expect(manager).toContain("setOpenModuleId(module.id)");
  });

  it("never submits quiz questions with an invalid lesson ID", () => {
    expect(manager).toContain("const lessonId = Number(result.id)");
    expect(manager).toContain("Number.isSafeInteger(lessonId)");
    expect(manager).toContain("lessonId, questions: lessonDraft.questions");
  });

  it("keeps useful Academy paste formatting while filtering unsafe clipboard markup", () => {
    expect(manager).toContain("preserveClipboardFormatting");
    expect(manager).toContain("Smart format pasted text");
    expect(richEditor).toContain("TableKit.configure");
    expect(richEditor).toContain("transformPastedHTML: normaliseClipboardHtml");
    expect(richEditor).toContain("plainTextToLessonHtml");
    expect(richEditor).toContain("handlePaste: (view, event)");
    expect(richEditor).toContain("insertLessonHtmlIntoView");
    expect(richEditor).toContain("[&_.ProseMirror_ul]:list-disc");
    expect(richEditor).toContain("[&_.ProseMirror_ol]:list-decimal");
    expect(richEditor).toContain("script, style, iframe, object, embed, form");
    expect(manager).toContain("Formatted ${headings} heading");
    expect(manager).toContain("preview below has been updated");
    expect(agentCourse).toContain("prose-ul:list-disc");
    expect(agentCourse).toContain("prose-ol:list-decimal");
    expect(agentCourse).toContain("prose-table:border-collapse");
  });
});
