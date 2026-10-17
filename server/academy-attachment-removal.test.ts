import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manager = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademy.tsx"), "utf8");
const router = readFileSync(resolve(process.cwd(), "server/academy-router.ts"), "utf8");

describe("Academy downloadable resource removal", () => {
  it("lets staff clear the attachment references in the lesson draft before saving", () => {
    expect(manager).toContain("Remove resource");
    expect(manager).toContain('attachmentUrl: "", attachmentKey: "", attachmentName: ""');
    expect(manager).toContain("Resource removed from this lesson draft. Save the lesson to apply the change.");
  });

  it("persists the cleared attachment fields through the existing audited lesson save path", () => {
    expect(router).toContain("const attachmentUrl = normaliseOptionalText(input.attachmentUrl)");
    expect(router).toContain("attachmentKey: normaliseOptionalText(input.attachmentKey)");
    expect(router).toContain("attachmentName: normaliseOptionalText(input.attachmentName)");
    expect(router).toContain('action: "lesson_updated"');
  });
});
