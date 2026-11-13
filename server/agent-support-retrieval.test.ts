import { describe, expect, it, vi } from "vitest";
import { retrieveAgentSupportChunks, queryTokens, scoreAgentSupportChunk, chunkAgentSupportSource, type AgentSupportSource } from "./agent-support-utils";
import { AGENT_PORTAL_PROCEDURE_SOURCES } from "./agent-support-portal-procedures";
import { policySources } from "./agent-support-sources";
import { generateSupportTurn, type SupportModelInvoker } from "./agent-support-generation";

vi.mock("./db", () => ({ getDb: vi.fn(() => { throw new Error("No database access in retrieval regressions"); }) }));

const guide = AGENT_PORTAL_PROCEDURE_SOURCES[0];
// Synthetic body, not a copy or read of a real Knowledge Base article. The title
// and query are the safe generic example supplied by the owner.
const personal: AgentSupportSource = {
  key: "kb:synthetic-personal", kind: "knowledge_base", href: "/knowledge-base?article=901",
  title: "Do I need to pay via PTS if booking personal travel?",
  text: "All payments must be paid via PTS. Submit a reimbursement claim once your funds have cleared. Reimbursements are typically returned within five working days for personal travel.",
};
const academy: AgentSupportSource = {
  key: "academy:synthetic", kind: "academy", title: "Training — Reimbursement evidence", href: "/academy",
  text: "For reimbursement evidence, provide a supplier invoice and matching proof of cleared payment. Check the supplier, client name and amount. Pending payment is not accepted.",
};
const kb: AgentSupportSource = {
  key: "kb:synthetic", kind: "knowledge_base", title: "Reimbursement document requirements", href: "/knowledge-base?article=902",
  text: "For a reimbursement, prepare the supplier invoice and proof of cleared payment. Supporting documents must show the client name, supplier and amount paid.",
};
const corpus = [...policySources(), guide, personal, academy, kb];

function source(title: string, text: string, key = title): AgentSupportSource {
  return { key, kind: "knowledge_base", title, text, href: "/knowledge-base?article=903" };
}

describe("approved-corpus retrieval repair — deterministic static/synthetic only", () => {
  it.each([
    "what do i need for a reimbursmet?",
    "What do I need for a reimbursement?",
    "How do reimbursements work?",
    "reimbursments",
    "reimbursment",
    "reimbursmet",
    "reimbursmeent",
    "reimbursements",
    "How do I get reimbursed?",
    "What documents are required for a reimbursement?",
  ])("finds reimbursement evidence, not personal-travel rules: %s", question => {
    const selected = retrieveAgentSupportChunks(corpus, question);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.map(chunk => chunk.key)).toContain(guide.key);
    expect(selected.some(chunk => chunk.key === academy.key || chunk.key === kb.key)).toBe(true);
    expect(selected.some(chunk => chunk.key === personal.key)).toBe(false);
    expect(selected.every(chunk => queryTokens(`${chunk.title} ${chunk.chunkText}`).includes("reimbursement"))).toBe(true);
  });

  it("preserves all generic reimbursement prerequisites and the company-card exception", () => {
    const selected = retrieveAgentSupportChunks(corpus, "what do i need for a reimbursmet?");
    const actual = selected.find(chunk => chunk.key === guide.key)!;
    expect(actual.chunkText).toContain("proof of payment");
    expect(actual.chunkText).toContain("pending is not accepted");
    expect(actual.chunkText).toContain("those funds return to JLT");
    expect(actual.chunkText).toContain("every reimbursement item");
    expect(actual.chunkText).toContain("not send reimbursement documents as a general booking-message attachment");
  });

  it("retrieves own-card wording without treating Chargebacks as a back substring", () => {
    const selected = retrieveAgentSupportChunks(corpus, "I paid a supplier from my own card, how do I get it back?");
    expect(selected.map(chunk => chunk.key)).toContain(guide.key);
    expect(selected.some(chunk => chunk.key === personal.key)).toBe(false);
    expect(selected[0].title).not.toContain("Chargebacks");
  });

  it.each(["what do I need?", "how does it work?", "need", "work", "get", "back", "unicornification"]) (
    "does not turn generic or unsupported words into an answer: %s", question => {
      expect(retrieveAgentSupportChunks([guide, personal, source("Disciplinary Framework", "Conduct rules apply.")], question)).toEqual([]);
    }
  );

  it("does not match title substrings or reinterpret short words", () => {
    const unrelated = source("Framework, Chargebacks and Ownership", "Published conduct rules apply.");
    for (const question of ["work", "back", "own", "frame", "charge", "owner", "refnd"]) {
      expect(scoreAgentSupportChunk(chunkAgentSupportSource(unrelated)[0], question)).toBe(0);
    }
  });

  it("keeps refunds, commission claims and reimbursements distinct", () => {
    expect(retrieveAgentSupportChunks([guide, kb, academy, personal], "How do I claim a refund?")).toEqual([]);
    expect(retrieveAgentSupportChunks([guide, kb, academy, personal], "What do I need for a commission claim?")).toEqual([]);
    const refunds = source("Refund evidence", "Refund requests require a cancellation confirmation and evidence.");
    expect(retrieveAgentSupportChunks([guide, refunds], "What do I need for a refund?").map(chunk => chunk.key)).toEqual([refunds.key]);
  });

  it("retains specifically requested personal-travel evidence instead of forcing the generic guide", () => {
    const selected = retrieveAgentSupportChunks(corpus, "Do I need to pay via PTS if booking personal travel?");
    expect(selected[0].key).toBe(personal.key);
  });

  it("will abstain when only the narrower personal-travel source exists for a general reimbursement", () => {
    expect(retrieveAgentSupportChunks([personal], "what do i need for a reimbursmet?")).toEqual([]);
  });

  it("does not force a curated source above a more precise published article", () => {
    const article = source("Reimbursement for overseas rail tickets", "Overseas rail tickets: reimbursement evidence includes a supplier invoice and proof of cleared payment.");
    expect(retrieveAgentSupportChunks([...corpus, article], "What reimbursement evidence is required for overseas rail tickets?")[0].key).toBe(article.key);
  });

  it("rejects ambiguous typo corrections instead of picking an alphabetically first source", () => {
    const cases = [source("Reimbursement", "Reimbursement guidance."), source("Reimbursemenx", "Reimbursemenx glossary.")];
    expect(retrieveAgentSupportChunks(cases, "reimbursemenz")).toEqual([]);
  });

  it.each(["knowledge_base", "academy", "webinar", "supplier", "community", "policy", "portal_procedure"] as const)(
    "allows relevant text from source kind %s to participate", kind => {
      const candidate = { ...source("Zephyr safeguarding workshop", "The Zephyr safeguarding workshop covers secure enquiry handling."), key: `synthetic:${kind}`, kind };
      const selected = retrieveAgentSupportChunks([...corpus, candidate], "What does the Zephyr safeguarding workshop cover?");
      expect(selected[0].key).toBe(candidate.key);
    }
  );

  it("retains potentially conflicting relevant sources for the independent verifier", () => {
    const conflicting = source("Reimbursement document requirements", "Reimbursement requests accept pending payment proof.");
    const selected = retrieveAgentSupportChunks([kb, academy, guide, conflicting], "What proof of payment is required for a reimbursement?");
    expect(selected.map(chunk => chunk.key)).toContain(conflicting.key);
    expect(selected.map(chunk => chunk.key)).toContain(kb.key);
  });

  it("prefers distinct relevant sources before another chunk and obeys both bounds", () => {
    const long = source("Reimbursement documents", "Reimbursement documents and invoice evidence. ".repeat(180), "long");
    const others = Array.from({ length: 6 }, (_, index) => ({ ...kb, key: `kb:diversity-${index}` }));
    const selected = retrieveAgentSupportChunks([long, ...others], "Reimbursement documents", 50);
    expect(selected).toHaveLength(5);
    expect(new Set(selected.map(chunk => chunk.key)).size).toBe(5);
    for (const key of selected.map(chunk => chunk.key)) expect(selected.filter(chunk => chunk.key === key).length).toBeLessThanOrEqual(2);
    for (const limit of [0, -1, NaN, Infinity]) expect(retrieveAgentSupportChunks(corpus, "reimbursement", limit)).toEqual([]);
  });

  it("recomputes retrieval against fresh source text, not cached answers or citations", () => {
    expect(retrieveAgentSupportChunks([kb], "reimbursement")).toHaveLength(1);
    expect(retrieveAgentSupportChunks([], "reimbursement")).toEqual([]);
    expect(retrieveAgentSupportChunks([{ ...kb, title: "Webinar schedule", text: "Business workshop recording." }], "reimbursement")).toEqual([]);
  });
});

describe("mixed-corpus generation contracts — mocked model only", () => {
  const evidence = "A payment still shown as pending is not accepted.";
  const candidate = { disposition: "answered", clarification: null, claims: [{ id: 1, section: "direct_answer", text: evidence, evidence: [{ citationIndex: 1, quote: evidence }] }] };
  const verified = { claimResults: [{ claimId: 1, supported: true, retainsMaterialExceptions: true, safe: true }], answerRetainsMaterialExceptions: true, missingConditions: [], dispositionAppropriate: true, clarification: null };
  function invoker(...values: unknown[]) {
    const invoke = vi.fn<SupportModelInvoker>();
    for (const value of values) invoke.mockResolvedValueOnce({ id: "synthetic", created: 0, model: "gpt-5-mini", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(value) } }] });
    return invoke;
  }
  it("the exact reported typo reaches generation with reimbursement evidence, not the personal-travel policy", async () => {
    const invoke = invoker(candidate, verified);
    const result = await generateSupportTurn({ question: "what do i need for a reimbursmet?", history: [], sources: [guide, personal] }, invoke);
    expect(result.verified).toBe(true);
    expect(result.sources.map(citation => citation.key)).toEqual([guide.key]);
    expect(invoke).toHaveBeenCalledTimes(2);
    for (const [params] of invoke.mock.calls) {
      const payload = JSON.parse(params.messages[2].content as string);
      expect(payload.resolvedQuestion).toBe("what do i need for a reimbursmet?");
      expect(JSON.stringify(payload.untrustedSourcePassages)).toContain("proof of payment");
      expect(JSON.stringify(payload.untrustedSourcePassages)).not.toContain(personal.title);
      expect(params.tool_choice).toBe("none");
    }
  });
  it("a screened follow-up performs fresh retrieval instead of retaining the old wrong citation", async () => {
    const question = "Where do I upload reimbursement evidence?";
    const invoke = invoker({ disposition: "resolved", question, priorUserIndices: [0] }, candidate, verified);
    const result = await generateSupportTurn({ question: "Where do I upload it?", history: [{ role: "user", content: "Where do I upload reimbursement evidence?" }], sources: [guide, personal] }, invoke);
    expect(result.verified).toBe(true);
    expect(result.sources.map(citation => citation.key)).toEqual([guide.key]);
    expect(invoke).toHaveBeenCalledTimes(3);
  });
  it("makes no model calls and provides no personal-travel answer when direct generic support is missing", async () => {
    const invoke = invoker();
    const result = await generateSupportTurn({ question: "what do i need for a reimbursmet?", history: [], sources: [personal] }, invoke);
    expect(result.disposition).toBe("escalated");
    expect(result.unresolvedReason).toBe("no_relevant_approved_source");
    expect(result.sources).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("continues withholding conflicting or irrelevant guidance rejected by independent verification", async () => {
    const invoke = invoker(candidate, { ...verified, dispositionAppropriate: false });
    const result = await generateSupportTurn({ question: "What payment proof is required for a reimbursement?", history: [], sources: [guide, personal] }, invoke);
    expect(result.disposition).toBe("validation_failed");
    expect(result.verified).toBe(false);
    expect(result.sources).toEqual([]);
  });
});

describe("independent retrieval review edge cases", () => {
  it.each(["riembursement", "rembursement", "reimbused payment evidence"])("supports conservative reviewed reimbursement spelling: %s", question => {
    expect(retrieveAgentSupportChunks([guide, source("Payment evidence", "Payment evidence guidance.")], question).map(chunk => chunk.key)).toContain(guide.key);
  });
  it.each(["enroling", "enrollling"])("corrects reviewed enrolment forms: %s", question => {
    const course = source("Academy enrolment", "Enrolling in a published course requires Academy access.");
    expect(retrieveAgentSupportChunks([course], question)[0]?.key).toBe(course.key);
  });
  it("does not reinterpret a valid unrelated word as a corpus word", () => {
    expect(retrieveAgentSupportChunks([source("Complaint procedure", "How to make a complaint.")], "compliant")).toEqual([]);
  });
  it.each(["Personal-Travel reimbursement", "Personal/travel reimbursement", "Ｐｅｒｓｏｎａｌ Travel reimbursement"])("recognizes punctuation and Unicode narrow scopes: %s", title => {
    expect(retrieveAgentSupportChunks([{ ...personal, title }], "reimbursement")).toEqual([]);
  });
  it.each(["personal-travel reimbursement", "personal vacation reimbursement", "my own travel reimbursement", "my personal trip reimbursement"])("keeps explicit personal-travel evidence available: %s", question => {
    expect(retrieveAgentSupportChunks([personal], question)[0]?.key).toBe(personal.key);
  });
  it("does not unlock narrow personal-travel guidance for an expressly non-personal question", () => {
    expect(retrieveAgentSupportChunks([personal], "not personal travel reimbursement")).toEqual([]);
  });
  it("does not blanket-exclude an article labelled for both client and personal travel", () => {
    const mixed = { ...personal, title: "Client and personal travel reimbursement" };
    expect(retrieveAgentSupportChunks([mixed], "client reimbursement")[0]?.key).toBe(mixed.key);
  });
  it("retains a low-scoring Academy passage that can conflict with a strongly titled KB answer", () => {
    const strong = source("Reimbursement request procedure", "Reimbursement claims must be submitted within 30 days.", "strong");
    const conflict = { ...source("Claims handling", "Reimbursement claims must be submitted within 14 days. " + "This training explains ordinary business practice. ".repeat(18), "conflict"), kind: "academy" as const };
    const selected = retrieveAgentSupportChunks([strong, conflict], "reimbursement");
    expect(selected.map(chunk => chunk.key)).toEqual([strong.key, conflict.key]);
  });
});
