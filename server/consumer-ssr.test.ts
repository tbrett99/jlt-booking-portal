import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { prefetchForPath } from "../client/src/ssr/prefetch";

const prefetch = {
  siteSettings: async () => ({ metrics: [], relationshipHeading: "Your travel agent. Backed by The JLT Group.", relationshipBody: "A sufficiently detailed explanation of how the JLT Group supports independent travel agents." }),
  tags: async () => [],
  listAgents: async () => [],
  listShowcases: async () => [],
  listPartners: async () => [],
  getAgent: async () => { throw { code: "NOT_FOUND" }; },
  listShowcasesForAgent: async () => [],
  getShowcase: async () => { throw { code: "NOT_FOUND" }; },
};

describe("consumer website SSR prefetch", () => {
  it("provides indexable, route-specific metadata for the new trust and contact pages", async () => {
    for (const [path, title] of [
      ["/about", "About The JLT Group"],
      ["/atol-protection", "ATOL protection"],
      ["/how-your-money-is-protected", "How your money is protected"],
      ["/why-jlt-is-on-my-booking", "Why JLT is on my booking"],
      ["/contact", "Customer contact"],
    ]) {
      const head = await prefetchForPath(path, new QueryClient(), prefetch);
      expect(head.title).toContain(title);
      expect(head.canonicalPath).toBe(path);
      expect(head.notFound).toBeUndefined();
      expect(head.noindex).toBeUndefined();
    }
  });

  it("marks unknown public profile pages as real noindex 404s", async () => {
    const head = await prefetchForPath("/travel-agents/missing-agent", new QueryClient(), prefetch);
    expect(head).toMatchObject({ notFound: true, noindex: true, canonicalPath: "/travel-agents/missing-agent" });
  });
});
