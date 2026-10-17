import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isMissingAcademyTranscriptColumn } from "./academy-router";

const readProjectFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Academy transcript schema compatibility", () => {
  it("recognises the nested Drizzle/MySQL error when only the optional transcript column is absent", () => {
    expect(isMissingAcademyTranscriptColumn({
      message: "Failed query: select `videoTranscript` from `academy_lessons`",
      cause: {
        code: "ER_BAD_FIELD_ERROR",
        message: "Unknown column 'videoTranscript' in 'field list'",
      },
    })).toBe(true);
  });

  it("does not hide unrelated database failures", () => {
    expect(isMissingAcademyTranscriptColumn({
      cause: { code: "ER_BAD_FIELD_ERROR", message: "Unknown column 'unrelatedField' in 'field list'" },
    })).toBe(false);
    expect(isMissingAcademyTranscriptColumn({
      cause: { code: "ER_ACCESS_DENIED_ERROR", message: "Access denied" },
    })).toBe(false);
  });

  it("loads legacy lesson fields without weakening private transcript safeguards", () => {
    const router = readProjectFile("server/academy-router.ts");
    expect(router).toContain("const legacyAcademyLessonColumns");
    expect(router).toContain("async function getAcademyLessonsForModules");
    expect(router).toContain("Loom transcript storage is not ready on Railway yet");
    expect(router).toContain("videoTranscript: null");
  });

  it("shows a retryable editor error instead of treating an error as perpetual loading", () => {
    const editor = readProjectFile("client/src/pages/admin/AdminAcademy.tsx");
    expect(editor).toContain("error: editorError");
    expect(editor).toContain("Course editor unavailable");
    expect(editor).toContain("refetch: refetchEditor");
    expect(editor).toContain("Retrying…");
  });
});
