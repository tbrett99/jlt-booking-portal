import type { AgentSupportChunk } from "./agent-support-utils";

// These are language normalization rules, not source IDs or policy decisions.
// Refunds and commission claims deliberately remain distinct from reimbursements.
const FORMS: Record<string, string[]> = {
  reimbursement: ["reimburse", "reimbursed", "reimbursing", "reimbursements"],
  refund: ["refunds", "refunded", "refunding"],
  amendment: ["amend", "amended", "amending", "amendments"],
  cancellation: ["cancel", "cancelled", "canceled", "cancelling", "canceling", "cancellations"],
  booking: ["bookings", "booked"],
  payment: ["payments", "pay", "paid", "paying"],
  document: ["documents", "documentation", "docs"],
  invoice: ["invoices"],
  supplier: ["suppliers"],
  claim: ["claims", "claimed", "claiming"],
  commission: ["commissions"],
  enrolment: ["enrollment", "enrolments", "enrollments", "enrol", "enroll", "enrolled", "enrolling"],
  assessment: ["assessments"],
  lesson: ["lessons"],
  module: ["modules"],
  webinar: ["webinars"],
  mandate: ["mandates"],
  card: ["cards"],
  receipt: ["receipts"],
  requirement: ["requirements", "required", "require", "requires"],
  upload: ["uploads", "uploaded", "uploading"],
};
const canonical = new Map(Object.entries(FORMS).flatMap(([term, variants]) =>
  [term, ...variants].map(variant => [variant, term] as const)));
const STOP = new Set("a an and are as at be been being by can could did do does for from had has have how i if in is it its me my of on or our please should that the their them then there these they this those to was were what when where which who why will with would you your need needs want wants work works get gets own back tell explain process help about using use say says described guidance find".split(" "));
// A topic present in the question must actually occur in the candidate. Weak
// words such as 'payment' cannot rescue a source missing 'reimbursement'.
const TOPICS = new Set(["reimbursement", "refund", "amendment", "cancellation", "commission", "enrolment", "assessment", "mandate"]);

export function retrievalTokens(value: string): string[] {
  return Array.from(new Set((value.normalize("NFKC").toLowerCase().match(new RegExp("[\\p{L}\\p{N}]+", "gu")) ?? [])
    .map(token => canonical.get(token) ?? token)
    .filter(token => token.length > 1 && !STOP.has(token))));
}

// Bounded optimal-string-alignment distance also catches a single transposition.
function distance(a: string, b: string, bound: number): number {
  if (Math.abs(a.length - b.length) > bound) return bound + 1;
  let previousPrevious: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j], previousPrevious[j - 2] + 1);
      }
    }
    previousPrevious = previous;
    previous = current;
  }
  return previous[b.length];
}

function correctTokens(tokens: string[], vocabulary: Set<string>): string[] {
  return Array.from(new Set(tokens.map(token => {
    // Never reinterpret short terms, acronyms, numbers, exact vocabulary or
    // ambiguous spelling. No user questions or private records form this index.
    if (vocabulary.has(token) || token.length < 7 || !/^[a-z]+$/.test(token)) return token;
    const bound = token.length >= 9 ? 2 : 1;
    let best = bound + 1;
    let candidate: string | null = null;
    // Correct only reviewed terminology whose canonical topic is present in the
    // approved corpus; do not change 'compliant' into a corpus word 'complaint'.
    for (const [word, topic] of Array.from(canonical.entries())) {
      if (!vocabulary.has(topic)) continue;
      const difference = distance(token, word, bound);
      if (difference < best) { best = difference; candidate = topic; }
      else if (difference === best && topic !== candidate) candidate = null;
    }
    if (!candidate || best > bound) return token;
    // Other corpus words may veto a correction, but can never become targets.
    const ambiguous = Array.from(vocabulary).some(word => word !== candidate && word.length >= 7 && distance(token, word, best) <= best);
    return ambiguous ? token : candidate;
  })));
}

type Indexed = { chunk: AgentSupportChunk; title: Set<string>; body: string[]; terms: Set<string> };

function indexed(chunk: AgentSupportChunk): Indexed {
  const title = new Set(retrievalTokens(`${chunk.title} ${chunk.category ?? ""}`));
  // Keep frequency for length-normalized, capped term-frequency scoring.
  const body = (chunk.chunkText.normalize("NFKC").toLowerCase().match(new RegExp("[\\p{L}\\p{N}]+", "gu")) ?? [])
    .map(token => canonical.get(token) ?? token).filter(token => !STOP.has(token));
  return { chunk, title, body, terms: new Set([...Array.from(title), ...body]) };
}

function scopeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ");
}
function personalTravelScope(title: string): boolean {
  const text = scopeText(title);
  return /\bpersonal (?:travel|bookings?|holidays?|vacations?|trips?)\b/.test(text) && !/\b(?:client|customer|general|business)\b/.test(text);
}
function asksPersonalTravel(question: string): boolean {
  const text = scopeText(question);
  if (/\b(?:not|non|excluding) (?:for )?personal\b/.test(text)) return false;
  return /\bpersonal (?:travel|bookings?|holidays?|vacations?|trips?)\b|\b(?:my|our|own) (?:own )?(?:travel|holidays?|vacations?|trips?)\b/.test(text);
}

function relevance(item: Indexed, tokens: string[], question: string, idf: Map<string, number>, averageLength: number): number {
  // A narrowly labelled personal-travel source must not establish a general
  // reimbursement/payment rule. It remains available for explicit personal travel.
  if (personalTravelScope(item.chunk.title) && !asksPersonalTravel(question)) return 0;
  const topics = tokens.filter(token => TOPICS.has(token));
  if (topics.length && !topics.some(token => item.terms.has(token))) return 0;
  let coveredWeight = 0, totalWeight = 0, score = 0, matched = 0;
  for (const token of tokens) {
    const weight = Math.max(1, idf.get(token) ?? 1);
    totalWeight += weight;
    const frequency = item.body.reduce((count, word) => count + Number(word === token), 0);
    const inTitle = item.title.has(token);
    if (!frequency && !inTitle) continue;
    matched++;
    coveredWeight += weight;
    const lengthNorm = 1.2 * (0.25 + 0.75 * item.body.length / Math.max(1, averageLength));
    score += weight * ((Math.min(frequency, 5) * 2.2) / (Math.min(frequency, 5) + lengthNorm) + (inTitle ? 3 : 0));
  }
  const coverage = totalWeight ? coveredWeight / totalWeight : 0;
  // A single meaningful named topic can match; broader questions need evidence
  // covering more than one incidental word. This is a retrieval gate, not an
  // accuracy/confidence probability. The independent answer verifier still runs.
  if (!matched || (tokens.length > 1 && coverage < (topics.length ? 0.25 : 0.45))) return 0;
  return score * (0.5 + coverage);
}

export function rankSupportChunks(chunks: AgentSupportChunk[], question: string, limit: number): AgentSupportChunk[] {
  if (!Number.isFinite(limit) || limit < 1) return [];
  const items = chunks.map(indexed);
  const documents = new Map<string, Set<string>>();
  const vocabulary = new Set<string>();
  for (const item of items) {
    const terms = documents.get(item.chunk.key) ?? new Set<string>();
    for (const term of Array.from(item.terms)) { terms.add(term); vocabulary.add(term); }
    documents.set(item.chunk.key, terms);
  }
  const tokens = correctTokens(retrievalTokens(question), vocabulary);
  if (!tokens.length) return [];
  const idf = new Map(tokens.map(token => {
    const count = Array.from(documents.values()).filter(terms => terms.has(token)).length;
    return [token, Math.log(1 + (documents.size - count + 0.5) / (count + 0.5))];
  }));
  const averageLength = items.reduce((sum, item) => sum + item.body.length, 0) / Math.max(1, items.length);
  const ranked = items.map(item => ({ ...item.chunk, score: relevance(item, tokens, question, idf, averageLength) }))
    .filter(chunk => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key) || a.chunkIndex - b.chunkIndex);
  // Prefer distinct relevant sources before a second passage from the same source.
  // Do not discard a lower score just because a strongly titled source scored
  // higher: it may contain a material conflict. The five-passage bound means this
  // is not an exhaustive conflict scan or a guarantee of source completeness.
  const relevant = ranked;
  const selected: AgentSupportChunk[] = [];
  const perSource = new Map<string, number>();
  for (const maxPerSource of [1, 2]) {
    for (const chunk of relevant) {
      const included = perSource.get(chunk.key) ?? 0;
      if (included >= maxPerSource || selected.some(old => old.key === chunk.key && old.chunkIndex === chunk.chunkIndex)) continue;
      selected.push(chunk);
      perSource.set(chunk.key, included + 1);
      if (selected.length >= Math.min(5, Math.floor(limit))) return selected;
    }
  }
  return selected;
}

export function scoreSupportChunk(chunk: Omit<AgentSupportChunk, "score">, question: string): number {
  return rankSupportChunks([{ ...chunk, score: 0 }], question, 1)[0]?.score ?? 0;
}
