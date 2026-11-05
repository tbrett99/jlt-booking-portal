import { describe, expect, it } from "vitest";
import { parseYouTubeEmbedId, youtubeEmbedUrl } from "../shared/youtube-embed";
const id = "AbCdEfGhI12";
const base = `https://www.youtube-nocookie.com/embed/${id}?rel=0`;

describe("allowlisted Academy YouTube embeds", () => {
  it.each([
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&si=tracking`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=tracking`,
    `https://www.youtu.be/${id}/`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://youtube-nocookie.com/embed/${id}/`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `  https://WWW.YOUTUBE.COM/watch?v=${id}  `,
  ])("normalises a recognised individual-video URL %s", (url) => {
    expect(parseYouTubeEmbedId(url)).toBe(id);
    expect(youtubeEmbedUrl(url)).toBe(base);
  });
  it.each([
    ["t=90", 90], ["t=90s", 90], ["t=1m30s", 90], ["t=1h2m3s", 3723],
    ["start=120", 120], ["t=1m30s&autoplay=1&origin=https://evil.example", 90],
  ])("keeps only valid start offsets %s", (query, expected) => {
    expect(youtubeEmbedUrl(`https://youtu.be/${id}?${query}`)).toBe(`${base}&start=${expected}`);
  });
  it("accepts a share timestamp fragment and ignores other embed parameters", () => {
    expect(youtubeEmbedUrl(`https://www.youtube.com/watch?v=${id}#t=30s`)).toBe(`${base}&start=30`);
    expect(youtubeEmbedUrl(`https://www.youtube.com/embed/${id}?autoplay=1&enablejsapi=1&list=arbitrary&rel=1`)).toBe(base);
  });
  it.each(["", "bad", "-3", "1.5", "Infinity", "9999999999999", "9999h", "0"])("ignores invalid or zero timestamps %s", (time) => {
    expect(youtubeEmbedUrl(`https://youtu.be/${id}?t=${time}`)).toBe(base);
  });
  it.each([
    null, undefined, "", "not a URL", `http://youtube.com/watch?v=${id}`,
    `//youtube.com/watch?v=${id}`, `https://youtube.com.evil.example/watch?v=${id}`,
    `https://evil.example/youtube.com/watch?v=${id}`, `https://youtube.com@evil.example/watch?v=${id}`,
    `https://user:pass@youtube.com/watch?v=${id}`, `https://youtube.com:444/watch?v=${id}`,
    `https://youtu.be/${id}/extra`, `https://www.youtube.com/embed/${id}/extra`,
    `https://www.youtube.com/watch?v=${id}&v=AnotherId01`,
    "https://www.youtube.com/watch?v=short", "https://www.youtube.com/watch?v=AbCdEfGhI12extra",
    "https://www.youtube.com/watch?v=AbCdEfGh%3C12", "https://www.youtube.com/playlist?list=anything",
    `https://www.youtube.com/channel/${id}`, `https://www.youtube-nocookie.com/watch?v=${id}`,
    `https://youtu.be/%2F${id}`, "javascript:alert(1)", "data:text/html,iframe",
  ])("never iframes an invalid or unsupported URL %s", (url) => {
    expect(parseYouTubeEmbedId(url)).toBeNull();
    expect(youtubeEmbedUrl(url)).toBeNull();
  });
  it("preserves case-sensitive IDs and strips tracking without fabricating a video", () => {
    expect(youtubeEmbedUrl("https://youtu.be/aB_cd-Ef123?si=private-share-tag")).toBe("https://www.youtube-nocookie.com/embed/aB_cd-Ef123?rel=0");
  });
});
