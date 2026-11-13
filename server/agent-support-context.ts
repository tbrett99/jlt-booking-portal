import { normalizeSupportRewriteNoun } from "./agent-support-language";

// Conversational language only: these labels carry a user's explicit topic,
// never a status, entitlement, timing, source, permission or factual conclusion.
const TOPICS = new Set(["reimbursement", "refund", "amendment", "cancellation", "commission", "enrolment", "assessment", "mandate"]);
const WEAK_TOPICS = new Set(["booking", "supplier", "webinar", "lesson", "module"]);
const TOPIC_NOUNS: Record<string, string> = {
  refunds: "refund", amendments: "amendment", cancellations: "cancellation", commissions: "commission",
  assessments: "assessment", mandates: "mandate", bookings: "booking", suppliers: "supplier", webinars: "webinar",
};
// Positive closed grammar, not an ever-growing list of excluded qualifiers.
// Unrecognized scopes, statuses, negations, numbers, course names and compound
// meanings must use the checked model resolver with the full prior user text.
const SIMPLE_PRIOR_WORDS = new Set(("a an the i we you my your our do does can could should how what where which when is are need needs require requirements required request requesting process procedure work works about for of on in to and or please have get make submit submission long take will would portal jlt document documentation evidence confirmation invoice receipt").split(" "));
function topicWords(value: string) {
  return Array.from(new Set((value.normalize("NFKC").toLowerCase().match(new RegExp("[\\p{L}\\p{N}]+", "gu")) ?? [])
    .map(word => TOPIC_NOUNS[word] ?? normalizeSupportRewriteNoun(word))));
}
export function explicitSupportTopics(value: string): string[] {
  const words = topicWords(value);
  const strong = words.filter(word => TOPICS.has(word));
  // A webinar/lesson/module about reimbursements has two plausible durations.
  // Ordinary booking/supplier context does not by itself create a second one.
  return strong.length ? [...strong, ...words.filter(word => ["webinar", "lesson", "module"].includes(word))]
    : words.filter(word => WEAK_TOPICS.has(word));
}

// A closed, stage-neutral duration-reference family. Does not match identifiers,
// time promises, status/outcome questions, commands or factual suffixes. Other
// conversational questions still use the checked model resolver.
const DURATION_REFERENCE = /^(?:and\s+)?how long (?:will|would|does|should|could|can|might) (?:it|that|this) take[?.!]*$/i;
export function bindCommonDurationFollowUp(current: string, priorUsers: { content: string }[]): {
  question: string; priorUserIndices: number[]; topic: string;
} | null {
  const normalized = current.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!DURATION_REFERENCE.test(normalized) || !priorUsers.length) return null;
  // Repeating this exact duration question after a clarification does not start
  // a new topic. Otherwise never resurrect an older subject across a newer
  // topicless/ambiguous turn; qualified references retain the checked model path.
  for (let index = priorUsers.length - 1; index >= 0; index--) {
    const previous = priorUsers[index].content.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (DURATION_REFERENCE.test(previous)) continue;
    const words = topicWords(previous);
    if (words.some(word => !SIMPLE_PRIOR_WORDS.has(word) && !TOPICS.has(word) && !WEAK_TOPICS.has(word))) return null;
    // Even booking/supplier wording may name a separate requested procedure;
    // this fast path does not decide that such a second subject is incidental.
    const topics = words.filter(word => TOPICS.has(word) || WEAK_TOPICS.has(word));
    if (topics.length !== 1) return null;
    const topic = topics[0];
    const subject = topic === "reimbursement" ? "a reimbursement request" : `a ${topic}`;
    return { question: normalized.replace(/\b(?:it|that|this)\b/i, subject), priorUserIndices: [index], topic };
  }
  return null;
}
