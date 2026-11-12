import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const safety = vi.hoisted(() => ({
  getDb: vi.fn(() => { throw new Error("Policy source must not access a database"); }),
}));
vi.mock("./db", () => ({ getDb: safety.getDb }));

import {
  FULL_TERMS_SECTIONS,
  CODE_OF_CONDUCT_SECTIONS,
  APPENDIX_SECTIONS,
} from "../client/src/pages/policyData";
import {
  FULL_TERMS_SECTIONS as MAY_TERMS,
  CODE_OF_CONDUCT_SECTIONS as MAY_CONDUCT,
  APPENDIX_SECTIONS as MAY_APPENDICES,
} from "../shared/policyDataMay2026";
import { CURRENT_POLICY_REVISION } from "../shared/policy-revision";
import { makeTermsReviewDraft } from "./terms-review-draft";
import { termsReviewRouter } from "./terms-review-router";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const approved = JSON.parse(readFileSync(resolve(process.cwd(), "server/fixtures/approved-terms-review-2026-11-12.json"), "utf8"));
const current = () => ({ terms: FULL_TERMS_SECTIONS, conduct: CODE_OF_CONDUCT_SECTIONS, appendices: APPENDIX_SECTIONS });
const may = () => ({ FULL_TERMS_SECTIONS: MAY_TERMS, CODE_OF_CONDUCT_SECTIONS: MAY_CONDUCT, APPENDIX_SECTIONS: MAY_APPENDICES });

beforeEach(() => {
  safety.getDb.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Policy-source tests must not send any network requests"); }));
});
afterEach(() => {
  expect(safety.getDb).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("prepared November policy source and immutable May provenance", () => {
  it("matches every title and HTML string from the approved review JSON exactly", () => {
    expect(current()).toEqual({ terms: approved.terms, conduct: approved.conduct, appendices: approved.appendices });
    expect(hash(current())).toBe("ebb021f685dfbe6bcfb16841806c645a48f9912f7cc663a97b06dba96e4ccfa0");
    expect(hash(current())).toBe(approved.draftSha256);
    expect(CURRENT_POLICY_REVISION.sourceSha256).toBe(approved.draftSha256);
    expect(CURRENT_POLICY_REVISION.sourceReviewId).toBe(approved.id);
  });
  it("preserves the full original May source bytes and baseline arrays", () => {
    const bytes = readFileSync(resolve(process.cwd(), "shared/policyDataMay2026.ts"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("e2a8010caadf02b1cf5702cde88ddfbb55b3b19226cdd689cf34e60d8388c8e4");
    expect(hash(may())).toBe("1f7e7ff1e35e35ce5e1fe381ec1bfbbb5ae45e473a32fd578051e36045b40066");
    expect(hash(may())).toBe(approved.baselineSha256);
    expect(FULL_TERMS_SECTIONS).not.toBe(MAY_TERMS);
    expect(CODE_OF_CONDUCT_SECTIONS).not.toBe(MAY_CONDUCT);
    expect(APPENDIX_SECTIONS).not.toBe(MAY_APPENDICES);
  });
  it("keeps the archived proposal valid after replacement of the default current source", () => {
    const draft = makeTermsReviewDraft();
    expect(draft.status).toBe("archived_proposal");
    expect({ terms: draft.terms, conduct: draft.conduct, appendices: draft.appendices }).toEqual(current());
    expect(draft.draftSha256).toBe(approved.draftSha256);
    expect(draft.baselineSha256).toBe(approved.baselineSha256);
    expect(draft.approvals).toEqual(approved.approvals);
    expect(draft.approvals.every(item => item.status === "pending")).toBe(true);
    const original = FULL_TERMS_SECTIONS[0].content;
    try {
      FULL_TERMS_SECTIONS[0].content = "synthetic current-source edit";
      expect(makeTermsReviewDraft().terms).toEqual(approved.terms);
    } finally {
      FULL_TERMS_SECTIONS[0].content = original;
    }
  });
  it("records a static publication revision without imposing an all-agent effective date", () => {
    expect(CURRENT_POLICY_REVISION.id).toBe("2026-11-12-agent-terms");
    expect(CURRENT_POLICY_REVISION.publicationDate).toBe("2026-11-12");
    expect(CURRENT_POLICY_REVISION).not.toHaveProperty("effectiveDate");
    const draft = makeTermsReviewDraft();
    expect(draft.publicationDate).toBeNull();
    expect(draft.effectiveDate).toBeNull();
    expect(draft.notice).toContain("does not automatically vary existing signed/accepted agreements");
    expect(draft.notice).not.toContain("live May 2026 terms");
  });
  it("has no database, billing, notification or acceptance operation when sources or archive are read", () => {
    const before = { current: hash(current()), may: hash(may()) };
    const first = makeTermsReviewDraft();
    first.currentPublishedRevision = { ...CURRENT_POLICY_REVISION };
    expect(makeTermsReviewDraft().currentPublishedRevision).toEqual(CURRENT_POLICY_REVISION);
    expect(Object.keys(termsReviewRouter._def.procedures)).toEqual(["draft"]);
    expect(termsReviewRouter._def.procedures.draft._def.type).toBe("query");
    expect({ current: hash(current()), may: hash(may()) }).toEqual(before);
    for (const path of ["client/src/pages/policyData.ts", "shared/policyDataMay2026.ts", "shared/policy-revision.ts", "server/terms-review-draft.ts", "server/terms-review-router.ts"]) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(source).not.toMatch(/\b(?:getDb|sendEmail|sendNotification|createAcceptance|chargeCustomer)\s*\(|\.mutation\s*\(|\bfetch\s*\(/);
    }
  });
});
