import { useState } from "react";
import { Link } from "wouter";
import sanitizeHtml from "sanitize-html";
import type {
  TermsReviewDraft,
  TermsReviewSection,
} from "@shared/terms-review";
import { CURRENT_POLICY_REVISION, MAY_2026_POLICY_BASELINE } from "@shared/policy-revision";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ArrowLeft, Clock, FileText, Loader2, RefreshCw } from "lucide-react";

const PROSE_CLASS =
  "prose prose-sm max-w-none text-foreground [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:pl-5 [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:pl-5 [&_strong]:font-semibold [&_table]:w-full [&_table]:border-collapse [&_th]:bg-muted [&_th]:p-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_td]:p-2 [&_td]:border [&_td]:border-border [&_td]:text-sm [&_tr:nth-child(even)_td]:bg-muted/30";

type ReviewTab = "terms" | "conduct" | "appendices";

// The API supplies a static, server-owned draft. There is no HTML editing input.
// Keep its prose and links, but never permit executable HTML or remote embeds.
function safeDraftHtml(content: string) {
  return sanitizeHtml(content, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "a",
      "hr",
      "blockquote",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
      "caption",
      "span",
      "div",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      p: ["id"],
      h2: ["id"],
      h3: ["id"],
      span: ["id"],
      ol: ["start"],
      li: ["value"],
      th: ["colspan", "rowspan", "scope"],
      td: ["colspan", "rowspan"],
    },
    transformTags: {
      "*": (tagName, attributes) => {
        if (attributes.id && !/^[a-z0-9][a-z0-9-]{0,119}$/i.test(attributes.id))
          delete attributes.id;
        return { tagName, attribs: attributes };
      },
    },
    allowedSchemes: ["https", "http", "mailto"],
    allowProtocolRelative: false,
  });
}

function complianceNote(tab: ReviewTab, title: string): string | null {
  const number = title.match(/^(\d+)\./)?.[1];
  if (tab === "terms" && number === "1") {
    return "The financial-protection wording in clause 1.1 is proposed compliance wording, not approved. JLT's compliance lead or UK travel-law solicitor must confirm the arrangements and scope before publication.";
  }
  if (tab === "appendices" && /^Appendix D:/.test(title)) {
    return "Appendix D item 2 contains proposed ATOL Certificate wording, not an approved compliance update. It remains subject to the CAA/compliance approval workstream before publication.";
  }
  if (tab === "terms" && number === "10") {
    return "Section 10 contains the complete current CAA Schedule from ORS3 version 19, with Agency Term 10A only. JLT does not permit sub-agents. The regulator's agreement-party, principal ATOL-holder/number and date placeholders must be completed against the actual contracting structure. Duo/Trio partners are not automatically separate agencies. This draft is not certification of JLT's legal/protection arrangements.";
  }
  if (tab === "terms" && number === "6") {
    return "Clauses 6.8 and 6.9 retain their baseline compliance wording; approved replacement wording is still required where needed.";
  }
  if (tab === "conduct" && number === "5") {
    return "Code of Conduct 5.2 retains its baseline compliance wording and remains subject to compliance review.";
  }
  if (tab === "appendices" && /^Appendix [HI]:/.test(title)) {
    return "The fee/protection descriptions referred for compliance review retain their baseline wording. This is separate from any proposed commercial edits in this appendix.";
  }
  if (tab === "appendices" && /^Appendix L:/.test(title)) {
    return "Appendix L is supplied by the API from the same Code of Conduct source as the separate tab. Code of Conduct 5.2 remains unchanged pending compliance review.";
  }
  return null;
}

function sectionAnchor(
  tab: ReviewTab,
  section: TermsReviewSection,
  index: number
) {
  if (tab === "terms" || tab === "conduct") {
    const number = section.title.match(/^(\d+)\./)?.[1];
    return number
      ? `${tab}-section-${number}`
      : `${tab}-section-index-${index}`;
  }
  const letter = section.title.match(/^Appendix ([A-Z]):/)?.[1];
  return letter
    ? `appendix-${letter.toLowerCase()}`
    : `appendix-index-${index}`;
}

function ReviewSections({
  tab,
  sections,
}: {
  tab: ReviewTab;
  sections: TermsReviewSection[];
}) {
  const [openItems, setOpenItems] = useState<string[]>([]);
  const split = tab === "terms" ? 25 : 12;
  const columns =
    tab === "appendices"
      ? [sections]
      : [sections.slice(0, split), sections.slice(split)];
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {sections.length} {tab === "appendices" ? "appendices" : "sections"} —
          click to expand the draft wording.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs text-primary underline"
            onClick={() =>
              setOpenItems(sections.map((_, index) => `${tab}-${index}`))
            }
          >
            Expand all
          </button>
          <span className="text-xs text-muted-foreground">·</span>
          <button
            type="button"
            className="text-xs text-primary underline"
            onClick={() => setOpenItems([])}
          >
            Collapse all
          </button>
        </div>
      </div>
      <div
        className={
          tab === "appendices" ? "" : "grid grid-cols-1 lg:grid-cols-2 gap-x-6"
        }
      >
        {columns.map((column, columnIndex) => (
          <Accordion
            key={columnIndex}
            type="multiple"
            value={openItems}
            onValueChange={setOpenItems}
            className={tab === "appendices" ? "space-y-2" : ""}
          >
            {column.map((section, localIndex) => {
              const index = localIndex + (columnIndex === 1 ? split : 0);
              const itemId = `${tab}-${index}`;
              const note = complianceNote(tab, section.title);
              return (
                <div
                  key={itemId}
                  id={sectionAnchor(tab, section, index)}
                  className="scroll-mt-6"
                >
                  <AccordionItem
                    id={itemId}
                    value={itemId}
                    className={
                      tab === "appendices"
                        ? "border border-border rounded-lg px-4"
                        : ""
                    }
                  >
                    <AccordionTrigger className="text-sm font-medium text-left py-3 hover:no-underline">
                      <span>
                        <span data-review-section-title>{section.title}</span>
                        {note && (
                          <span className="block mt-1 text-xs font-normal text-amber-700 dark:text-amber-400">
                            {(tab === "terms" && /^1\./.test(section.title)) ||
                            (tab === "appendices" &&
                              /^Appendix D:/.test(section.title))
                              ? "Proposed compliance wording — not approved"
                              : tab === "terms" && /^10\./.test(section.title)
                                ? "Full CAA Schedule with 10A — actual-party details require review"
                                : "Contains unchanged compliance wording — review required"}
                          </span>
                        )}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      {note && (
                        <p
                          className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                          data-compliance-note
                        >
                          {note}
                        </p>
                      )}
                      <div
                        className={PROSE_CLASS}
                        dangerouslySetInnerHTML={{
                          __html: safeDraftHtml(section.content),
                        }}
                      />
                    </AccordionContent>
                  </AccordionItem>
                </div>
              );
            })}
          </Accordion>
        ))}
      </div>
    </div>
  );
}

function DraftContent({ draft }: { draft: TermsReviewDraft }) {
  const [activeTab, setActiveTab] = useState<ReviewTab>("terms");
  const preparedDate = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${draft.preparedDate}T00:00:00Z`));
  return (
    <div className="space-y-6" data-terms-review-draft={draft.id}>
      <section
        aria-labelledby="draft-status-heading"
        className="rounded-lg border border-amber-300 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30"
      >
        <h2
          id="draft-status-heading"
          className="text-lg font-semibold text-amber-950 dark:text-amber-100"
        >
          Archived proposal — May 2026 baseline
        </h2>
        <p className="mt-2 text-sm text-amber-900 dark:text-amber-200">
          {draft.notice}
        </p>
        <p className="mt-2 text-sm text-amber-900 dark:text-amber-200">
          Read-only review. This page does not publish terms, change signed
          agreements or acceptance records, or change billing.
        </p>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Proposal prepared</dt>
            <dd className="mt-1 font-medium">
              <time dateTime={draft.preparedDate}>{preparedDate}</time>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              Archived baseline
            </dt>
            <dd className="mt-1 font-medium">{draft.publishedBaseline}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Current revision publication</dt>
            <dd className="mt-1 font-medium">
              <time dateTime={draft.currentPublishedRevision.publicationDate}>
                {draft.currentPublishedRevision.publicationLabel}
              </time>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Existing-agent effective date</dt>
            <dd className="mt-1 font-medium">Not set by publication — agreement-specific</dd>
          </div>
        </dl>
      </section>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Historical legal and operational review checklist</CardTitle>
          <CardDescription>
            All {draft.approvals.length} historical review issues are Pending.
            Approval of the terms text does not record solicitor or compliance sign-off.
            No approval is recorded by opening this page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border" aria-label="Pending approvals">
            {draft.approvals.map(approval => (
              <li
                key={approval.id}
                className="py-3 first:pt-0 last:pb-0"
                data-approval-id={approval.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-medium">{approval.title}</h3>
                  <Badge
                    variant="outline"
                    className="shrink-0 gap-1 text-amber-700 border-amber-300 dark:text-amber-400"
                  >
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    Pending
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {approval.details}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  References: {approval.references.join("; ")}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <details
        className="rounded-lg border border-border bg-card p-4"
        data-review-changes
      >
        <summary className="cursor-pointer text-sm font-semibold">
          Proposed changes ({draft.changes.length})
        </summary>
        <ul className="mt-3 divide-y divide-border">
          {draft.changes.map(change => (
            <li
              key={change.id}
              className="py-3 first:pt-0 last:pb-0"
              data-change-id={change.id}
            >
              <h3 className="text-sm font-medium">{change.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {change.summary}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                References: {change.references.join("; ")}
              </p>
            </li>
          ))}
        </ul>
      </details>

      <section
        aria-labelledby="unchanged-compliance-heading"
        className="rounded-lg border border-border bg-muted/30 p-4"
      >
        <h2 id="unchanged-compliance-heading" className="text-sm font-semibold">
          Unchanged compliance wording — approval still required
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Section 10 now contains the full current CAA Schedule with 10A only.
          The related descriptions below remain unchanged pending review against
          the actual booking and protection arrangements. Retaining this wording
          does not certify it as compliant.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Official source:{" "}
          <a
            href="https://www.caa.co.uk/publication/download/30069"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            CAA ORS3 version 19 — 2 November 2026
          </a>
          . The Agency Term 11 variation effective 1 April 2027 is not applied
          early.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {draft.unchangedComplianceReferences.map(reference => (
            <li key={reference}>{reference}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="draft-preview-heading">
        <h2 id="draft-preview-heading" className="text-lg font-semibold mb-1">
          Draft wording preview
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Privacy Policy is unchanged and is not included in this preview.
        </p>
        <Tabs
          value={activeTab}
          onValueChange={value => {
            if (
              value === "terms" ||
              value === "conduct" ||
              value === "appendices"
            )
              setActiveTab(value);
          }}
        >
          <TabsList className="mb-6 h-auto flex-wrap gap-1">
            <TabsTrigger value="terms" className="text-sm">
              Full Terms &amp; Conditions
            </TabsTrigger>
            <TabsTrigger value="conduct" className="text-sm">
              Code of Conduct
            </TabsTrigger>
            <TabsTrigger value="appendices" className="text-sm">
              Appendices
            </TabsTrigger>
          </TabsList>
          <TabsContent value="terms">
            <ReviewSections tab="terms" sections={draft.terms} />
          </TabsContent>
          <TabsContent value="conduct">
            <ReviewSections tab="conduct" sections={draft.conduct} />
          </TabsContent>
          <TabsContent value="appendices">
            <ReviewSections tab="appendices" sections={draft.appendices} />
          </TabsContent>
        </Tabs>
      </section>

      <details className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium">
          Draft provenance
        </summary>
        <dl className="mt-3 space-y-3 break-all">
          <div>
            <dt>Draft identifier</dt>
            <dd className="font-mono mt-1">{draft.id}</dd>
          </div>
          <div>
            <dt>Published baseline SHA-256</dt>
            <dd className="font-mono mt-1">{draft.baselineSha256}</dd>
          </div>
          <div>
            <dt>Draft SHA-256</dt>
            <dd className="font-mono mt-1">{draft.draftSha256}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

export default function TermsRevisionReview() {
  const { data, isLoading, isError, isFetching, refetch } =
    trpc.termsReview.draft.useQuery(undefined, { refetchOnMount: "always" });
  // Never substitute published policies or a fabricated local draft on failure.
  const validDraft =
    data?.status === "archived_proposal" &&
    data.publicationDate === null &&
    data.effectiveDate === null &&
    data.currentPublishedRevision?.id === CURRENT_POLICY_REVISION.id &&
    data.currentPublishedRevision.publicationDate === CURRENT_POLICY_REVISION.publicationDate &&
    data.currentPublishedRevision.sourceSha256 === CURRENT_POLICY_REVISION.sourceSha256 &&
    data.approvals.length > 0 &&
    data.approvals.every(approval => approval.status === "pending");
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/terms-tracker"
            className="inline-flex items-center gap-1 mb-3 text-sm font-medium underline underline-offset-2"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to terms tracker
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" aria-hidden="true" />
            Terms revision review
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Archived clause and appendix proposal, with separate current-revision metadata.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a
              href="https://hub.thejltgroup.co.uk/bookingterms"
              target="_blank"
              rel="noopener noreferrer"
            >
              Official booking terms
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/terms">Current terms — {CURRENT_POLICY_REVISION.publicationLabel}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={MAY_2026_POLICY_BASELINE.url}>Archived baseline — May 2026</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => {
              void refetch();
            }}
          >
            <RefreshCw
              className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"}
              aria-hidden="true"
            />
            {isFetching ? "Refreshing…" : "Refresh draft"}
          </Button>
        </div>
      </div>
      {isLoading ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border p-6 text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading draft review…
        </div>
      ) : isError || !data || !validDraft ? (
        <div role="alert" className="rounded-lg border border-border p-6">
          <h2 className="text-base font-semibold">Draft review unavailable</h2>
          <p className="text-sm text-muted-foreground mt-1">
            The draft could not be verified or loaded. No draft wording is
            shown. Refresh to try again; published terms remain unchanged.
          </p>
        </div>
      ) : (
        <DraftContent draft={data} />
      )}
    </div>
  );
}
