import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Academy Loom transcript knowledge source", () => {
  const schema = readProjectFile("drizzle/schema.ts");
  const router = readProjectFile("server/academy-router.ts");
  const editor = readProjectFile("client/src/pages/admin/AdminAcademy.tsx");

  it("stores a dedicated long-text transcript separately from agent-facing lesson content", () => {
    expect(schema).toContain('videoTranscript: longtext("videoTranscript")');
    expect(router).toContain("videoTranscript: z.string().max(1_000_000).nullable().optional()");
    expect(router).toContain("videoTranscript: preserveOptionalTranscript(input.videoTranscript)");
  });

  it("preserves original timestamped transcript text and keeps it out of the agent course response", () => {
    expect(router).toContain("function preserveOptionalTranscript");
    expect(router).toContain("return value?.trim() ? value : null;");
    expect(router).toContain("const { videoTranscript: _videoTranscript, ...agentLesson } = lesson;");
    expect(router).toContain("The transcript is private staff source material");
  });

  it("provides an explicitly private Loom transcript paste area for staff", () => {
    expect(editor).toContain("Loom transcript for JLT knowledge");
    expect(editor).toContain("Private · timestamps preserved");
    expect(editor).toContain("including timestamp lines");
    expect(editor).toContain("academy-video-transcript");
  });
});
