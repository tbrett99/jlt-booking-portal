import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Academy agent-view preview", () => {
  const app = readProjectFile("client/src/App.tsx");
  const home = readProjectFile("client/src/pages/academy/AcademyHome.tsx");
  const course = readProjectFile("client/src/pages/academy/AcademyCourse.tsx");
  const academyRouter = readProjectFile("server/academy-router.ts");

  it("routes My Agent View through a dedicated read-only course preview", () => {
    expect(app).toContain('<Route path="/academy/preview/course/:courseId">');
    expect(home).toContain("trpc.academy.agent.previewHome.useQuery");
    expect(home).toContain("/academy/preview/course/${courseId}");
    expect(course).toContain("trpc.academy.agent.previewCourse.useQuery");
  });

  it("keeps preview access staff-gated and prevents Max's preview from recording learning activity", () => {
    expect(academyRouter).toContain("previewHome: adminProcedure.query");
    expect(academyRouter).toContain("previewCourse: adminProcedure.input");
    expect(academyRouter).toContain("without creating Academy access, enrolments, progress, attempts");
    expect(course).toContain("Preview only — no assessment answer or learning record was created.");
    expect(course).toContain("Preview only — no lesson completion or Academy progress was recorded.");
  });
});
