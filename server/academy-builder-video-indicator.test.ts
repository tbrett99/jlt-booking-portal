import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const academyBuilder = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademy.tsx"), "utf8");

describe("Academy Builder video indicators", () => {
  it("shows an accessible video badge beside every lesson with a saved video URL", () => {
    expect(academyBuilder).toContain('lesson.videoUrl?.trim() && <span');
    expect(academyBuilder).toContain('title="An approved lesson video has been added"');
    expect(academyBuilder).toContain('<Video size={13} aria-hidden="true" />Video');
  });

  it("summarises the number of video lessons while a module is collapsed", () => {
    expect(academyBuilder).toContain('const videoLessonCount = module.lessons.filter');
    expect(academyBuilder).toContain('{videoLessonCount} video{videoLessonCount === 1 ? "" : "s"}');
  });
});
