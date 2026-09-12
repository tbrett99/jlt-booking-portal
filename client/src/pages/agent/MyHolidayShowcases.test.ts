import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./MyHolidayShowcases.tsx", import.meta.url)), "utf8");

describe("MyHolidayShowcases editing safeguards", () => {
  it("normalises blank existing image labels before the agent submits a section-level showcase edit", () => {
    expect(source).toContain('function withDefaultImageLabel(image: GalleryImage)');
    expect(source).toContain('label: image.label?.trim() || "Holiday image"');
    expect(source).toContain('label: image.label.trim() || "Holiday image"');
    expect(source).toContain('section.images.map(withDefaultImageLabel)');
  });

  it("autosaves a loaded edit locally and clears that recovery record only after direct publication succeeds", () => {
    expect(source).toContain('const showcaseAutosaveKey = (id: number)');
    expect(source).toContain('function loadAutosavedDraft(id: number)');
    expect(source).toContain('window.localStorage.setItem(showcaseAutosaveKey(editingId)');
    expect(source).toContain('window.localStorage.removeItem(showcaseAutosaveKey(editingId))');
    expect(source).toContain('Autosave is on — closing this window will not lose your work.');
  });

  it("uses direct publish language rather than asking agents to wait for a Showcase review", () => {
    expect(source).toContain('Publish safe changes');
    expect(source).toContain('safe changes update your live holiday page straight away');
    expect(source).not.toContain('Submit edits for review');
  });
});
