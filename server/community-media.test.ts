import { describe, expect, it } from "vitest";
import { asCommunityArray } from "../shared/community-media";

describe("Community media compatibility", () => {
  it("preserves current array values", () => {
    expect(asCommunityArray<string>(["https://example.com/one.jpg"])).toEqual(["https://example.com/one.jpg"]);
  });

  it("parses legacy JSON strings before rendering media", () => {
    expect(asCommunityArray<string>(JSON.stringify(["https://example.com/one.jpg"]))).toEqual(["https://example.com/one.jpg"]);
    expect(asCommunityArray<{ url: string }>(JSON.stringify([{ url: "https://example.com/file.pdf" }]))).toEqual([{ url: "https://example.com/file.pdf" }]);
  });

  it("supports a single legacy URL and ignores empty or malformed structured values safely", () => {
    expect(asCommunityArray<string>("https://example.com/old-image.jpg")).toEqual(["https://example.com/old-image.jpg"]);
    expect(asCommunityArray<string>("")).toEqual([]);
    expect(asCommunityArray<string>("{not-json}")).toEqual([]);
    expect(asCommunityArray<string>({ url: "https://example.com/not-an-array" })).toEqual([]);
  });
});
