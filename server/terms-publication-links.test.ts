import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assistantSystemPrompt, policySources } from "./agent-support-router";
import {
  policyTabFromSearch,
  policyVersionFromSearch,
} from "../shared/policy-navigation";

describe("Terms publication does not silently change personal acceptance", () => {
  it("keeps the existing May acceptance banner tied to the frozen May document", () => {
    const banner = readFileSync(
      new URL(
        "../client/src/components/TermsSigningBanner.tsx",
        import.meta.url
      ),
      "utf8"
    );
    expect(banner).toContain('href="/terms?version=2026-05"');
    expect(banner).not.toContain('href="/terms"');
    expect(banner).toContain("12 May 2026");
    expect(banner).toContain("trpc.terms.sign.useMutation");
  });

  it("labels the published policy passages and keeps privacy at its separate unchanged date", () => {
    const sources = policySources();
    const terms = sources.filter(source =>
      source.href.includes("section=terms")
    );
    const conduct = sources.filter(source =>
      source.href.includes("section=conduct")
    );
    const appendices = sources.filter(source =>
      source.href.includes("section=appendices")
    );
    const privacy = sources.filter(source =>
      source.href.includes("section=privacy")
    );
    expect(terms).toHaveLength(49);
    expect(conduct).toHaveLength(24);
    expect(appendices).toHaveLength(12);
    expect(privacy.length).toBeGreaterThan(0);
    for (const source of [...terms, ...conduct, ...appendices]) {
      expect(source.title).toContain("12 November 2026");
      expect(policyVersionFromSearch(source.href.split("?")[1])).toBe(
        "2026-11"
      );
      expect(policyTabFromSearch(source.href.split("?")[1])).not.toBe(
        "privacy"
      );
    }
    for (const source of privacy) {
      expect(source.title).toContain("May 2026");
      expect(policyTabFromSearch(source.href.split("?")[1])).toBe("privacy");
    }
  });

  it("does not infer personal contractual applicability from a public document update", () => {
    expect(assistantSystemPrompt()).toContain(
      "Publication of terms is NOT an individual's acceptance"
    );
    expect(assistantSystemPrompt()).toContain(
      "evidence of notice delivery, or a change to their signed agreement"
    );
    expect(assistantSystemPrompt()).toContain(
      "Do not infer which version binds an individual. Refer individual agreement questions to Support."
    );
  });
});
