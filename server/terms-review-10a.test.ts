import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FULL_TERMS_SECTIONS,
  CODE_OF_CONDUCT_SECTIONS,
  APPENDIX_SECTIONS,
} from "../client/src/pages/policyData";
import type { TrpcContext } from "./_core/context";

const safety = vi.hoisted(() => ({
  getDb: vi.fn(() => {
    throw new Error("The 10A review must not access a database");
  }),
}));
vi.mock("./db", () => ({ getDb: safety.getDb }));
import { makeTermsReviewDraft } from "./terms-review-draft";
import { termsReviewRouter } from "./terms-review-router";

const compact = (value: string) => value.replace(/\s+/g, " ").trim();
const plain = (html: string) =>
  compact(
    html
      .replace(/<\/?(?:strong|em|a|span)\b[^>]*>/g, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#(?:39|x27);/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
  );
const paragraphs = (html: string) =>
  html.match(/<p\b[^>]*>[\s\S]*?<\/p>/g) ?? [];
const section = (n: number) => makeTermsReviewDraft().terms[n - 1];
const baseline = (n: number) => FULL_TERMS_SECTIONS[n - 1];
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const clause = (html: string, number: string) => {
  const escaped = number.replace(/\./g, "\\.");
  const matches = paragraphs(html).filter(p =>
    new RegExp(`^${escaped}(?:\\s|:|$)`).test(plain(p))
  );
  expect(matches, `one paragraph for clause ${number}`).toHaveLength(1);
  return matches[0];
};

const DUO_TRIO =
  "Duo and Trio Arrangements: Duo and Trio accounts allow approved business partners to work together within the same business under a shared JLT membership package. They do not authorise the appointment of sub-agents or the creation of a sub-agent network. Each participating partner must be identified to and approved by JLT and satisfy the applicable training and booking-authorisation requirements before making bookings.";
const NON_SUBAGENT_SENTENCE =
  "Nothing in this clause permits the appointment of a sub-agent to perform the Agent’s obligations as an agent of the principal ATOL holder; such appointment is prohibited by CAA Agency Term 10A.";

// Independently transcribed from the supplied official CAA ORS3 version 19,
// Section 1.4, printed pages 30–33 (updated 2 November 2026), not imported
// from the production Schedule, generator or generated fixtures.
const EXPECTED_PREAMBLE: Record<string, string> = {
  Definitions:
    "The definitions used in this agreement have the same meaning as those used in the ATOL Regulations 2012 (as amended). Additionally, ‘Licensable Transaction’ means an offer made by a consumer (or their agent) to purchase flight accommodation for one or more persons on a flight which is accepted by an air travel organiser and constitutes an activity in respect of which that air travel organiser is required to hold an ATOL.",
  "Duration of Agreement":
    "Agency Terms 3, 5, 8, 9 and 13 remain binding on the agent even if the principal ATOL holder has failed.",
  "Extent of obligations":
    "The obligations of all parties to this agreement extend only to the parties’ conduct in respect of licensable transactions.",
  "Priority of Agency terms published by CAA":
    "Pursuant to AST 2.2 and Agency Term 1 no agency term negotiated between the principal ATOL holder and the agent may contradict or purport to contradict the CAA’s mandated terms and any that do so will be void.",
};
const EXPECTED_TERMS: Record<string, string> = {
  "1": "By making available flight accommodation to consumers in the capacity of an agent, in accordance with ATOL Regulations 9, 10 and 12 the agent is deemed to have agreed to the terms of the written agency agreement between the principal ATOL holder and its agent. The terms of the agency agreement include terms mandated by the CAA to be agreed between principal ATOL holders and agents for principal ATOL holders making available flight accommodation as agents of that principal ATOL holder. Principal ATOL holders and agents cannot agree, whether in writing, by conduct or otherwise, any terms which contradict, or purport to contradict the terms mandated by the CAA. The agent must keep a copy of this agency agreement for the period it is in force and for 12 months after it expires or is terminated.",
  "2.1":
    "Agents must comply with ATOL Standard Term 1 as if they applied directly to the agent (as applicable) and any requirements to set out the principal ATOL holder’s name and number should be read as requirements to set out the principal’s name and ATOL number. For the avoidance of doubt, agents are not permitted to use the ATOL logo without the permission of the CAA.",
  "2.2":
    "The agent must at all times identify the selling, protecting principal ATOL holder on all publicity material (including websites and brochures) that identify a flight or flight inclusive package which the agent is holding out it can make available to consumers.",
  "2.3":
    "Where the agent produces a receipt for money paid by a consumer the agent must identify which part of that money is protected by the principal ATOL holder’s ATOL and which, if any, is not.",
  "3": "The agent will, if requested by the CAA, report to the principal ATOL holder the unique reference number of each ATOL Certificate supplied by it, along with the corresponding ATOL holder’s reference number, where it acts as agent for the principal ATOL holder and where the transaction with the consumer was a Flight-Only or a package. If requested to do so by the CAA at any time, and including after the failure of the principal ATOL holder, the agent will provide this information to the CAA.",
  "4": "The agent will provide any information requested by the principal ATOL holder necessary to enable the principal ATOL holder to comply with the ATOL Standard Terms or any term of its ATOL.",
  "5": "Any payment received by the agent from consumers, for services owed by the principal ATOL holder to the consumer, is received and held by the agent on behalf of and for the benefit of the Trustees of the Air Travel Trust but subject to the agent’s right and obligation to make payment to the principal ATOL holder for so long as the principal ATOL holder does not fail. If the principal ATOL holder fails, the agent confirms it will continue to hold consumer payments on behalf of the Trustees of the Air Travel Trust and without any right or obligation to pay the same to the principal ATOL holder.",
  "6.1":
    "Where an agent makes available flight accommodation as the agent of a principal ATOL holder, the agent must ensure an ATOL Certificate is supplied to the consumer immediately and in accordance with ATOL Regulation 17, regardless of whether the ATOL Certificate is produced by the principal ATOL holder or produced by the agent on behalf of the principal ATOL holder. However, if an agent organises a package which includes that flight accommodation, the agent must immediately supply a package ATOL Certificate to the consumer in the agent’s own name.",
  "6.2":
    "Where an agent makes available a package as agent of a principal ATOL holder, the agent must additionally obtain a Confirmation (see AST 1.11) from the ATOL holder and, once obtained, pass it immediately to the consumer by the method set out below. Where an agent receives any revised Confirmation from the principal ATOL holder, it will immediately pass it to the consumer by the method set out below. Note: The method for the supply of a Confirmation means: a) in the case of a consumer who is present at the time the agent receives the Confirmation, immediately handing it to that consumer or sending it to that consumer by electronic communication; b) in the case of a consumer who is not present at the time the agent receives the Confirmation, immediately sending it to that consumer by electronic communication or by post.",
  "7": "When accepting payments in respect of transactions the agent would need an ATOL to transact if the agent were not the agent of the principal ATOL holder, agents may only accept payment from consumers as defined in the ATOL Regulations 2012.",
  "8": "Immediately upon the failure of the principal ATOL holder, the agent will provide the CAA with information on: a) money paid to it by consumers, in respect of services to be provided for future travel by the principal ATOL holder to consumers; and b) the ATOL Certificate unique reference numbers issued by that agent which apply to that failed ATOL holder, in a form acceptable to the CAA.",
  "9": "The rights of the CAA and the Trustees of the Air Travel Trust to enforce any obligations under this agreement on either party are not excluded. For the avoidance of doubt, they may be enforced by the CAA and the Trustees of the Air Travel Trust.",
  "10A":
    "An agent is not permitted to appoint a sub-agent to perform its obligations as an agent of the principal ATOL holder on the agent’s behalf",
  "11": "If a new or revised Schedule of Agency Terms is published by the CAA in its Official Record Series 3 those new or revised terms will immediately take effect and must be included in the terms of the agency agreement between the principal ATOL holder and the agent within 3 calendar months of the publication date.",
  "12": "If the principal ATOL holder fails to comply with its obligations to a consumer and by reason thereof the agent incurs a liability or obligation to the consumer, the agent shall be indemnified by the principal ATOL holder against all consequences following from such a failure.",
  "13": "If requested by the CAA the agent will provide any information regarding the principal ATOL holder referred to in AST 4 which it holds to the CAA on demand.",
};
const ORDER = [
  "1",
  "2.1",
  "2.2",
  "2.3",
  "3",
  "4",
  "5",
  "6.1",
  "6.2",
  "7",
  "8",
  "9",
  "10A",
  "11",
  "12",
  "13",
];

// Numbered subterms may be headings or strong labels under grouping headings 2
// and 6. Read full bodies up to the next marker, without rewriting their words.
// Lettered a)/b) markers are body text and must not acquire an Agency Term prefix.
const scheduleParts = () => {
  const html = section(10).content;
  const headings = [
    ...html.matchAll(
      /<h[2-6]\b[^>]*>([\s\S]*?)<\/h[2-6]>|<p\b[^>]*>\s*<strong\b[^>]*>(Agency Term \d+\.\d+)<\/strong>/g
    ),
  ];
  return headings.map((match, i) => ({
    heading: plain(match[1] ?? match[2]),
    body: plain(
      html.slice(match.index! + match[0].length, headings[i + 1]?.index)
    ),
  }));
};
const bodyFor = (heading: string) => {
  const parts = scheduleParts().filter(part => part.heading === heading);
  expect(parts, `exactly one Schedule heading ${heading}`).toHaveLength(1);
  return parts[0].body;
};

// Captured from the actual staged draft before this task's 10A-only changes.
// These snapshots are independent of the updated generator and prevent this
// compliance task from silently changing departure/commercial proposals.
const PRIOR_STAGED_TERM_SHAS: [number, string][] = [
  [11, "b9b53cd50539a88139ec1ade72214fdd6ccaa42c1b011f824c082af7b2206a43"],
  [16, "ffae1e97a2447fcffff9c0f446904351f11b4563da3486eaf48a68208dd2a29c"],
  [26, "aecec3edf9e0494f1d30b5c6d6854153453dbbcbc80bdf6e94ad9934be2233b1"],
  [30, "a1677c850e235f8458bf8e944ca52c0d1ae1d59fa6a6f42d73125d7c60b349a4"],
  [42, "1ef6a21d3f3f247957c8ebf0073867c236008618164b9ca6fd545d07730819f9"],
  [49, "2d39282d23dd0661e95c8b260c2259577c8b9a09d056fe00e43f1c47278de454"],
];
const PRIOR_STAGED_APPENDIX_SHAS: [string, string][] = [
  ["A", "ccbbd073025aec32dfdb3c318b069ed4177e9ee14ba792a2a0177877fe24ae90"],
  ["G", "0421a6cf25733b6bf049825004940e91cb7b7ca2c0fb967462b0de8bef9ac3ee"],
  ["E", "8e0b0536a719f310b8d5dd8939e95537ae4d9a7a35ef6b0bfcd6de16d2ab9c73"],
];

describe("10A-only staged Schedule: independent official wording", () => {
  it("contains all current Agency Terms 1–13 once, with every subclause and 10A only", () => {
    const headings = scheduleParts()
      .map(part => part.heading)
      .filter(
        heading =>
          heading.startsWith("Agency Term ") &&
          heading !== "Agency Term 2" &&
          heading !== "Agency Term 6"
      );
    expect(headings).toEqual(ORDER.map(n => `Agency Term ${n}`));
    expect(headings).toHaveLength(16);
    expect(
      new Set(headings.map(h => h.replace(/^Agency Term (\d+).*$/, "$1"))).size
    ).toBe(13);
    expect(section(10).content).not.toMatch(
      /Agency Term 10B|The agent may appoint a sub-agent/
    );
    expect(plain(section(10).content)).not.toContain(
      "both the ‘agent’ and ‘sub-agent’ would be acting in breach"
    );
  });
  it("retains all 26 official term paragraphs and the four unprefixed a)/b) source markers", () => {
    const html = section(10).content;
    const start = /<h[2-6]\b[^>]*>Agency Term 1<\/h[2-6]>/.exec(html);
    expect(start).not.toBeNull();
    const ps = paragraphs(html.slice(start!.index)).map(plain);
    expect(ps).toHaveLength(26);
    expect(ps.filter(p => /^[ab]\)/.test(p)).map(p => p.slice(0, 2))).toEqual([
      "a)",
      "b)",
      "a)",
      "b)",
    ]);
    expect(ps.join(" ")).not.toMatch(/Agency Term [ab]\)/);
  });
  it.each(ORDER)(
    "Agency Term %s has the exact complete current official text",
    number => {
      expect(bodyFor(`Agency Term ${number}`)).toBe(EXPECTED_TERMS[number]);
    }
  );
  it.each(Object.entries(EXPECTED_PREAMBLE))(
    "retains complete official preamble: %s",
    (heading, text) => expect(bodyFor(heading)).toBe(text)
  );
  it("retains the official appointment template without inventing the contracting identities or date", () => {
    expect(plain(section(10).content)).toContain(
      "AGREEMENT BETWEEN [NAME OF AGENT] AND [NAME OF ATOL HOLDER/ ATOL NUMBER] APPOINTING [NAME OF AGENT] AS [NAME OF ATOL HOLDER’S] AGENT PURSUANT TO ATOL REGULATIONS 12 AND 22 ON [DATE]"
    );
  });
  it("uses the current immediate-effect/three-month Agency Term 11, not its future replacement", () => {
    const text = bodyFor("Agency Term 11");
    expect(text).toBe(EXPECTED_TERMS["11"]);
    expect(text).toContain(
      "those new or revised terms will immediately take effect"
    );
    expect(text).toContain("within 3 calendar months of the publication date");
    // The source's future-variation signpost is explanatory, not substituted
    // into the current operative clause. The review records that boundary.
    expect(
      makeTermsReviewDraft()
        .changes.map(c => c.summary)
        .join(" ")
    ).toMatch(/Agency Term 11.*1 April 2027.*not applied early/);
  });
  it("identifies the official v19 source and does not describe Section 10 as unchanged or await 10A/10B selection", () => {
    const draft = makeTermsReviewDraft();
    const metadata = [
      section(10).content,
      ...draft.changes.map(c => `${c.title} ${c.summary}`),
      ...draft.approvals.map(a => `${a.title} ${a.details}`),
      readFileSync(
        resolve(
          process.cwd(),
          "client/src/pages/admin/TermsRevisionReview.tsx"
        ),
        "utf8"
      ),
    ].join(" ");
    expect(metadata).toContain(
      "https://www.caa.co.uk/publication/download/30069"
    );
    expect(metadata).toMatch(/(?:version\s*19|v19)/i);
    expect(metadata).toMatch(/(?:2|02) November 2026/);
    expect(draft.unchangedComplianceReferences).not.toContain("10");
    expect(metadata).not.toMatch(
      /Section 10 (?:remains the old|is deliberately unchanged)/i
    );
    expect(metadata).not.toMatch(
      /(?:identify|choose|select|selection of) exactly one of 10A\/10B/i
    );
  });
  it("removes every old shortened operative Agency Term summary", () => {
    for (const p of paragraphs(baseline(10).content).slice(-4))
      expect(plain(section(10).content)).not.toContain(plain(p));
  });
});

describe("10A-only changes: exact additions and preserved prior proposals", () => {
  it("appends exactly the requested sentence to 3.4 and retains its original consent text", () => {
    const old = plain(clause(baseline(3).content, "3.4"));
    expect(plain(clause(section(3).content, "3.4"))).toBe(
      `${old} ${NON_SUBAGENT_SENTENCE}`
    );
    expect(plain(section(3).content).split(NON_SUBAGENT_SENTENCE)).toHaveLength(
      2
    );
    for (const p of paragraphs(baseline(3).content)) {
      if (!plain(p).startsWith("3.4 ")) expect(section(3).content).toContain(p);
    }
  });
  it("adds the exact Duo/Trio paragraph after unchanged 6.3 and before 6.4", () => {
    const old = clause(baseline(6).content, "6.3");
    expect(clause(section(6).content, "6.3")).toBe(old);
    const ps = paragraphs(section(6).content).map(plain);
    const index = ps.indexOf(plain(old));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(ps[index + 1]).toBe(DUO_TRIO);
    expect(ps[index + 2]).toMatch(/^6\.4\b/);
    expect(ps.filter(p => p === DUO_TRIO)).toHaveLength(1);
    expect(plain(old)).toContain("£150 per additional agent");
    expect(plain(old)).toContain("47% for each added member");
    expect(plain(old)).toContain(
      "The Agent retains full responsibility for the conduct, compliance, and actions of any additional agents added to their membership and accepts full liability for them."
    );
    for (const number of ["6.11", "6.12", "6.13"])
      expect(clause(section(6).content, number)).toBe(
        clause(baseline(6).content, number)
      );
  });
  it("makes no Section 6 change beyond the new Duo/Trio paragraph", () => {
    const html = section(6).content;
    const added = paragraphs(html).filter(p => plain(p) === DUO_TRIO);
    expect(added).toHaveLength(1);
    expect(sha(html.replace(added[0], ""))).toBe(
      "36306c54bdcf6922ba0bca2514411960aaae075da5a37477e8615d1e9aaf7691"
    );
  });
  it("keeps 11.2 and 11.3 restrictions byte-for-byte without changing their periods", () => {
    for (const number of ["11.2", "11.3"])
      expect(clause(section(11).content, number)).toBe(
        clause(baseline(11).content, number)
      );
  });
  it.each(PRIOR_STAGED_TERM_SHAS)(
    "preserves prior staged departure/commercial Section %s",
    (number, expectedSha) => {
      expect(sha(section(number).content)).toBe(expectedSha);
    }
  );
  it.each(PRIOR_STAGED_APPENDIX_SHAS)(
    "preserves prior staged Appendix %s",
    (letter, expectedSha) => {
      const item = makeTermsReviewDraft().appendices.find(s =>
        s.title.startsWith(`Appendix ${letter}:`)
      )!;
      expect(sha(item.content)).toBe(expectedSha);
    }
  );
  it("keeps the actual contracting business and partner legal structure pending review", () => {
    const draft = makeTermsReviewDraft();
    const relevant = draft.approvals.filter(a =>
      /contracting|legal structure|partners|Duo|Trio/i.test(
        `${a.title} ${a.details}`
      )
    );
    expect(relevant.length).toBeGreaterThan(0);
    expect(relevant.every(a => a.status === "pending")).toBe(true);
    const text = relevant.map(a => `${a.title} ${a.details}`).join(" ");
    expect(text).toMatch(/legal|solicitor/i);
    expect(text).toMatch(/business|structure|identit/i);
    const operative = plain(draft.terms.map(s => s.content).join(" "));
    expect(operative).not.toMatch(
      /each (?:Duo|Trio|participating|approved) partner must (?:enter|sign).*separate (?:independent )?agency agreement/i
    );
  });
  it("never changes the published source bytes or the independently recorded baseline array SHA", () => {
    expect(
      sha(
        readFileSync(resolve(process.cwd(), "client/src/pages/policyData.ts"))
      )
    ).toBe("e2a8010caadf02b1cf5702cde88ddfbb55b3b19226cdd689cf34e60d8388c8e4");
    expect(
      sha(
        JSON.stringify({
          FULL_TERMS_SECTIONS,
          CODE_OF_CONDUCT_SECTIONS,
          APPENDIX_SECTIONS,
        })
      )
    ).toBe("1f7e7ff1e35e35ce5e1fe381ec1bfbbb5ae45e473a32fd578051e36045b40066");
  });
});

const context = (user: unknown) =>
  ({ req: { headers: {} }, res: {}, user }) as TrpcContext;
const caller = (
  role: unknown,
  isActive: unknown = true,
  extra: Record<string, unknown> = {}
) =>
  termsReviewRouter.createCaller(
    context({
      id: 81042,
      openId: "synthetic-10a-review",
      name: "Synthetic 10A Reviewer",
      email: "review-10a@synthetic.invalid",
      role,
      isActive,
      ...extra,
    })
  );

beforeEach(() => {
  safety.getDb.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error(
        "The 10A review must not make network or financial calls"
      );
    })
  );
});
afterEach(() => {
  expect(safety.getDb).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("10A review API remains strictly read-only and isolated", () => {
  it("still exposes only the no-input draft query, never a mutation or publication API", () => {
    const procedures = termsReviewRouter._def.procedures;
    expect(Object.keys(procedures)).toEqual(["draft"]);
    expect(procedures.draft._def.type).toBe("query");
  });
  it.each(["admin", "super_admin"])(
    "allows only active %s to read the unpublished complete 10A Schedule",
    async role => {
      const result = await caller(role).draft(undefined);
      expect(result).toEqual(makeTermsReviewDraft());
      expect(result.status).toBe("draft_not_published");
      expect(result.publicationDate).toBeNull();
      expect(result.effectiveDate).toBeNull();
      expect(plain(result.terms[9].content)).toContain(EXPECTED_TERMS["10A"]);
    }
  );
  it("denies anonymous readers", async () => {
    await expect(
      termsReviewRouter.createCaller(context(null)).draft()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it.each([
    "agent",
    "instructor",
    "agent_engagement",
    "engagement",
    "user",
    "ADMIN",
    "superadmin",
    null,
  ])("denies role %s despite synthetic staff or cron flags", async role => {
    await expect(
      caller(role, true, {
        isInstructor: true,
        isEngagement: true,
        isStaff: true,
        isCron: true,
        staffRoles: ["admin"],
      }).draft()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["admin", "super_admin"])(
    "requires literal active true for %s",
    async role => {
      for (const isActive of [false, null, 0, 1, "true"])
        await expect(caller(role, isActive).draft()).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      await expect(
        caller(role, true, { isActive: undefined }).draft()
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );
  it.each([
    null,
    {},
    { publish: true },
    { approved: true },
    { effectiveDate: "2026-11-12" },
    [],
    "10A",
    0,
    true,
  ])("rejects every non-undefined input %j", async input => {
    await expect(
      (caller("super_admin").draft as (input: unknown) => Promise<unknown>)(
        input
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("does not allow a returned 10A Schedule or legal-review state to change later responses", async () => {
    const result = await caller("admin").draft();
    const untouched = await caller("super_admin").draft();
    result.terms[9].content = "synthetic 10B replacement";
    result.terms[2].content = "synthetic waiver";
    result.approvals[0].details = "synthetic approval";
    result.changes[0].references.push("synthetic publication");
    expect(await caller("admin").draft()).toEqual(untouched);
  });
});
