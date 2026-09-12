import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./MyHolidayShowcases.tsx", import.meta.url)), "utf8");

describe("MyHolidayShowcases image label handling", () => {
  it("normalises blank existing image labels before the agent submits a section-level showcase edit", () => {
    expect(source).toContain('function withDefaultImageLabel(image: GalleryImage)');
    expect(source).toContain('label: image.label?.trim() || "Holiday image"');
    expect(source).toContain('label: image.label.trim() || "Holiday image"');
    expect(source).toContain('section.images.map(withDefaultImageLabel)');
  });
});
