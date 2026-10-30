export type AgentSupportSourceKind =
  | "knowledge_base"
  | "webinar"
  | "academy"
  | "supplier"
  | "community"
  | "policy";

export type AgentSupportSource = {
  key: string;
  kind: AgentSupportSourceKind;
  title: string;
  text: string;
  href: string;
  updatedAt?: Date | null;
  category?: string | null;
  timestampLabel?: string | null;
};

export type AgentSupportChunk = AgentSupportSource & {
  chunkIndex: number;
  chunkText: string;
  score: number;
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "for", "from", "how", "i", "if", "in", "is", "it", "me", "my", "of", "on", "or", "our", "please", "the", "to", "what", "when", "where", "which", "who", "with", "you", "your",
]);

const SENSITIVE_SUPPLIER_VALUES = [
  "loginUsername",
  "loginPassword",
  "agencyId",
  "adminUsername",
  "adminPassword",
  "adminNotes",
  "generalNotes",
  "loginRequestNotes",
] as const;

export function stripAgentSupportHtml(value: string | null | undefined) {
  return (value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseAgentSupportText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function queryTokens(value: string) {
  return Array.from(new Set(
    value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9£@._-]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  ));
}

export function chunkAgentSupportSource(source: AgentSupportSource, maxCharacters = 1_400): AgentSupportChunk[] {
  const text = normaliseAgentSupportText(source.text);
  if (!text) return [];

  const paragraphs = text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxCharacters) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let offset = 0; offset < paragraph.length; offset += maxCharacters) {
        chunks.push(paragraph.slice(offset, offset + maxCharacters));
      }
      continue;
    }

    const next = current ? `${current} ${paragraph}` : paragraph;
    if (next.length > maxCharacters && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);

  return chunks.map((chunkText, chunkIndex) => ({ ...source, chunkIndex, chunkText, score: 0 }));
}

export function scoreAgentSupportChunk(chunk: Omit<AgentSupportChunk, "score">, question: string) {
  const tokens = queryTokens(question);
  if (!tokens.length) return 0;
  const title = `${chunk.title} ${chunk.category ?? ""}`.toLocaleLowerCase();
  const text = chunk.chunkText.toLocaleLowerCase();
  let score = 0;

  for (const token of tokens) {
    if (title.includes(token)) score += 6;
    const matches = text.match(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"))?.length ?? 0;
    score += Math.min(matches, 4);
  }

  // Prefer sources with a direct topic overlap, without allowing a popular long
  // article to overwhelm a more exact shorter match.
  if (text.includes(question.toLocaleLowerCase().trim())) score += 10;
  return score;
}

export function retrieveAgentSupportChunks(sources: AgentSupportSource[], question: string, limit = 5) {
  const ranked = sources
    .flatMap((source) => chunkAgentSupportSource(source))
    .map((chunk) => ({ ...chunk, score: scoreAgentSupportChunk(chunk, question) }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const selected: AgentSupportChunk[] = [];
  const perSource = new Map<string, number>();
  for (const chunk of ranked) {
    const included = perSource.get(chunk.key) ?? 0;
    if (included >= 2) continue;
    selected.push(chunk);
    perSource.set(chunk.key, included + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function sourceCitationLabel(source: Pick<AgentSupportSource, "kind" | "title" | "timestampLabel">) {
  const kind = {
    knowledge_base: "Knowledge Base",
    webinar: "Webinar",
    academy: "JLT Academy",
    supplier: "Supplier Directory",
    community: "Community update",
    policy: "Terms & Policies",
  }[source.kind];
  return `${kind}: ${source.title}${source.timestampLabel ? ` (${source.timestampLabel})` : ""}`;
}

export function uniqueSourceCitations(chunks: AgentSupportChunk[]) {
  const sourceByKey = new Map<string, AgentSupportSource>();
  for (const chunk of chunks) {
    if (!sourceByKey.has(chunk.key)) {
      sourceByKey.set(chunk.key, {
        key: chunk.key,
        kind: chunk.kind,
        title: chunk.title,
        text: "",
        href: chunk.href,
        updatedAt: chunk.updatedAt,
        category: chunk.category,
        timestampLabel: chunk.timestampLabel,
      });
    }
  }
  return Array.from(sourceByKey.values()).map((source, index) => ({
    index: index + 1,
    key: source.key,
    kind: source.kind,
    title: source.title,
    href: source.href,
    label: sourceCitationLabel(source),
    timestampLabel: source.timestampLabel ?? null,
    updatedAt: source.updatedAt ?? null,
  }));
}

export function buildAgentSupportModelPrompt(question: string, chunks: AgentSupportChunk[]) {
  const citations = uniqueSourceCitations(chunks);
  const citationIndex = new Map(citations.map((citation) => [citation.key, citation.index]));
  const context = chunks.map((chunk) => {
    const index = citationIndex.get(chunk.key);
    return `[S${index}] ${chunk.title}\n${chunk.chunkText}`;
  }).join("\n\n");

  return `Question: ${question}\n\nApproved JLT Portal source passages:\n${context}`;
}

export function buildSupplierAgentSupportText(supplier: {
  name: string;
  description?: string | null;
  shortDescription?: string | null;
  publicWebsite?: string | null;
  tradeWebsite?: string | null;
  additionalWebsite?: string | null;
  categories?: string | null;
  locations?: string | null;
  usp?: string | null;
  priceTier?: string | null;
  notSuitableFor?: string | null;
  preferredContact?: string | null;
  aiSummary?: string | null;
  idealClient?: string | null;
  bookingTips?: string | null;
  accountManager?: string | null;
  phone?: string | null;
  email?: string | null;
  outOfHoursContactName?: string | null;
  outOfHoursPhone?: string | null;
  outOfHoursEmail?: string | null;
  outOfHoursNotes?: string | null;
}) {
  // This is deliberately a positive allow-list. Passwords, agency IDs, internal
  // notes and request instructions cannot reach the model even if schema fields
  // are added or a broad supplier object is accidentally passed in future.
  const values = [
    supplier.shortDescription,
    stripAgentSupportHtml(supplier.description),
    supplier.aiSummary,
    supplier.usp && `Key selling points: ${supplier.usp}`,
    supplier.idealClient && `Ideal client: ${supplier.idealClient}`,
    supplier.notSuitableFor && `Not suitable for: ${supplier.notSuitableFor}`,
    supplier.bookingTips && `Booking tips: ${supplier.bookingTips}`,
    supplier.categories && `Categories: ${supplier.categories}`,
    supplier.locations && `Locations: ${supplier.locations}`,
    supplier.priceTier && `Price tier: ${supplier.priceTier}`,
    supplier.preferredContact && `Preferred contact: ${supplier.preferredContact}`,
    supplier.publicWebsite && `Website: ${supplier.publicWebsite}`,
    supplier.tradeWebsite && `Trade website: ${supplier.tradeWebsite}`,
    supplier.additionalWebsite && `Additional website: ${supplier.additionalWebsite}`,
    supplier.accountManager && `Account manager: ${supplier.accountManager}`,
    supplier.phone && `Phone: ${supplier.phone}`,
    supplier.email && `Email: ${supplier.email}`,
    supplier.outOfHoursContactName && `Out-of-hours contact: ${supplier.outOfHoursContactName}`,
    supplier.outOfHoursPhone && `Out-of-hours phone: ${supplier.outOfHoursPhone}`,
    supplier.outOfHoursEmail && `Out-of-hours email: ${supplier.outOfHoursEmail}`,
    supplier.outOfHoursNotes && `Out-of-hours notes: ${supplier.outOfHoursNotes}`,
  ].filter((value): value is string => Boolean(value && value.trim()));
  return `${supplier.name}\n${values.join("\n")}`;
}

export function sensitiveSupplierFieldsAreExcluded(value: Record<string, unknown>) {
  return SENSITIVE_SUPPLIER_VALUES.every((field) => !(field in value));
}

export function buildAcademyAgentSupportText(lesson: {
  courseTitle: string;
  moduleTitle: string;
  lessonTitle: string;
  summary?: string | null;
  contentHtml?: string | null;
  videoTranscript?: string | null;
}) {
  return [
    `Course: ${lesson.courseTitle}`,
    `Module: ${lesson.moduleTitle}`,
    `Lesson: ${lesson.lessonTitle}`,
    lesson.summary,
    stripAgentSupportHtml(lesson.contentHtml),
    lesson.videoTranscript ? `Video transcript (use only to direct the learner to the recording): ${lesson.videoTranscript}` : null,
  ].filter((value): value is string => Boolean(value && value.trim())).join("\n");
}
