import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const academyBuilder = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademy.tsx"), "utf8");

describe("Academy Builder video indicators", () => {
  it("shows an accessible video badge beside every lesson with a saved video URL", () => {
    expect(academyBuilder).toMatch(/lesson\.videoUrl\?\.trim\(\)\s*&&\s*\(?\s*<span/);
    expect(academyBuilder).toContain('title="An approved lesson video has been added"');
    expect(academyBuilder).toMatch(/<Video\s+size=\{13\}\s+aria-hidden="true"\s*\/>\s*Video/);
  });

  it("summarises the number of video lessons while a module is collapsed", () => {
    expect(academyBuilder).toContain('const videoLessonCount = module.lessons.filter');
    expect(academyBuilder).toMatch(/\{videoLessonCount\}\s*video\s*\{videoLessonCount === 1 \? "" : "s"\}/);
  });

  it("explains ordinary YouTube links, embedding requirements and unlisted-link visibility", () => {
    expect(academyBuilder).toContain("Paste a Loom or YouTube HTTPS video link");
    expect(academyBuilder).toContain("no embed code needed");
    expect(academyBuilder).toContain("allow embedding");
    expect(academyBuilder).toContain("Unlisted links are shareable, not private to the Portal");
  });
});
