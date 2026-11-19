import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import type {
  HandbookContent,
  KnowledgeRequestStatus,
} from "@shared/staff-handbook";
import { Button } from "@/components/ui/button";

export type Staff = { id: number; name: string | null };
export type HandbookBrowseItem = {
  id: number;
  version: number;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  sensitivity: HandbookContent["sensitivity"];
  format: HandbookContent["format"];
  isPinned: boolean;
  nextReviewAt: Date | string | null;
  updatedAt: Date | string;
  state: "draft" | "in_review" | "published" | "changes" | "archived";
};
export type HandbookOverview = {
  metrics: {
    newRequests: number;
    unassignedRequests: number;
    awaitingReview: number;
    overdueGuides: number;
    openRequests: number;
    publishedGuides: number;
  };
  categories: string[];
  staff: Staff[];
  byAssignee: { id: number | null; name: string | null; count: number }[];
  byCategory: { category: string; count: number }[];
};
export type Revision = {
  id: number;
  articleId: number;
  revisionNumber: number;
  content: HandbookContent;
  resourceIds: number[];
  contributorIds: number[];
  createdById: number;
  changeSummary: string;
  createdAt: Date | string;
};
export type Resource = {
  id: number;
  fileName: string;
  mimeType: string;
  byteSize: number;
  available: boolean;
  url?: string | null;
};
export type Audit = {
  id: number;
  action: string;
  actorId: number;
  summary: string;
  createdAt: Date | string;
};
export type ArticleDetail = {
  article: {
    id: number;
    version: number;
    draftRevisionId: number | null;
    publishedRevisionId: number | null;
    reviewedRevisionId: number | null;
    reviewedById: number | null;
    submittedAt: Date | string | null;
    archivedAt: Date | string | null;
    createdById: number;
    updatedAt: Date | string;
    requiresIndependentReview: boolean;
  };
  draft: Revision | null;
  published: Revision | null;
  revisions: Revision[];
  resources: Resource[];
  audit: Audit[];
};
export type RequestDto = {
  id: number;
  version: number;
  title: string;
  description: string;
  category: string;
  kind:
    | "missing_process"
    | "unclear"
    | "outdated"
    | "conflicting"
    | "recurring_question";
  checkedGuidance: string | null;
  impact: string | null;
  priority: "low" | "normal" | "high";
  status: KnowledgeRequestStatus;
  reporterId: number;
  assigneeId: number | null;
  articleId: number | null;
  resolvedRevisionId: number | null;
  duplicateOfId: number | null;
  closureReason: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};
export const controlClass =
  "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export const panelClass =
  "min-w-0 rounded-xl border bg-card p-4 shadow-sm space-y-4";
export const staffHandbookQueryKey = [["staffHandbook"]];
export function isHandbookMutationKey(
  key: readonly unknown[] | undefined
): boolean {
  return Array.isArray(key?.[0]) && key[0][0] === "staffHandbook";
}
export function isHandbookAuthorityError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    data?: { code?: unknown };
    shape?: { data?: { code?: unknown } };
    code?: unknown;
  };
  const code = value.data?.code ?? value.shape?.data?.code ?? value.code;
  return code === "FORBIDDEN" || code === "UNAUTHORIZED";
}
const AccessContext = createContext<{ revoke: () => void } | null>(null);
export function HandbookAccessDenied() {
  return (
    <Feedback
      error
      message="Staff handbook access could not be authorized. All handbook content and unsaved edits have been cleared. Your staff access is being checked again."
    />
  );
}
// A denial is sticky for this mounted identity. Cached auth.me must not reopen it.
// Subscriptions catch sibling query/mutation denials before rendering cached data.
export function HandbookAccessBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  const cache = useQueryClient();
  const utils = trpc.useUtils();
  const utilsRef = useRef(utils);
  utilsRef.current = utils;
  const parent = useContext(AccessContext);
  const parentRevoke = parent?.revoke;
  const [denied, setDenied] = useState(false);
  const revoked = useRef(false);
  const subscribe = useCallback(
    (notify: () => void) => {
      const stopQueries = cache.getQueryCache().subscribe(notify);
      const stopMutations = cache.getMutationCache().subscribe(notify);
      return () => {
        stopQueries();
        stopMutations();
      };
    },
    [cache]
  );
  const snapshot = useCallback(
    () =>
      cache
        .getQueryCache()
        .findAll({ queryKey: staffHandbookQueryKey })
        .some(query => isHandbookAuthorityError(query.state.error)) ||
      cache
        .getMutationCache()
        .getAll()
        .some(
          mutation =>
            isHandbookMutationKey(mutation.options.mutationKey) &&
            isHandbookAuthorityError(mutation.state.error)
        ),
    [cache]
  );
  const cacheDenied = useSyncExternalStore(subscribe, snapshot, () => false);
  const revoke = useCallback(() => {
    if (revoked.current) return;
    revoked.current = true;
    setDenied(true);
    if (parentRevoke) {
      parentRevoke();
      return;
    }
    // Cancel in-flight responses before removing all handbook-only cache entries.
    void cache
      .cancelQueries({ queryKey: staffHandbookQueryKey })
      .finally(() => {
        cache.removeQueries({ queryKey: staffHandbookQueryKey });
        for (const mutation of cache.getMutationCache().getAll()) {
          if (isHandbookMutationKey(mutation.options.mutationKey))
            cache.getMutationCache().remove(mutation);
        }
      })
      .catch(() => undefined);
    void utilsRef.current.auth.me
      .invalidate(undefined, undefined, { throwOnError: true })
      .catch(() => undefined);
  }, [cache, parentRevoke]);
  useEffect(() => {
    if (cacheDenied) revoke();
  }, [cacheDenied, revoke]);
  const context = useMemo(() => ({ revoke }), [revoke]);
  return denied || cacheDenied ? (
    <HandbookAccessDenied />
  ) : (
    <AccessContext.Provider value={context}>{children}</AccessContext.Provider>
  );
}
export function useHandbookAccessGuard(...errors: unknown[]) {
  const access = useContext(AccessContext);
  const [denied, setDenied] = useState(false);
  const authorityError = errors.some(isHandbookAuthorityError);
  const revoke = access?.revoke;
  const deny = useCallback(
    (error: unknown) => {
      if (!isHandbookAuthorityError(error)) return false;
      setDenied(true);
      revoke?.();
      return true;
    },
    [revoke]
  );
  useEffect(() => {
    if (authorityError) {
      setDenied(true);
      revoke?.();
    }
  }, [authorityError, revoke]);
  return { blocked: denied || authorityError, deny };
}
export const sectionLabels = {
  whenToUse: "When to use",
  checks: "Checks before starting",
  steps: "Steps",
  agentWording: "Agent wording",
  exceptions: "Exceptions & escalation",
  related: "Related guidance",
};
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactElement<{ id?: string }>;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {React.cloneElement(children, { id })}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
export function Feedback({
  message,
  error = false,
}: {
  message: string;
  error?: boolean;
}) {
  return message ? (
    <p
      role={error ? "alert" : "status"}
      className={`rounded-md border p-3 text-sm ${error ? "border-destructive/40 text-destructive" : "bg-muted/40"}`}
    >
      {message}
    </p>
  ) : null;
}
export function QueryState({
  query,
  label,
}: {
  query: {
    isError: boolean;
    isLoading: boolean;
    data?: unknown;
    refetch: () => unknown;
  };
  label: string;
}) {
  if (query.isError)
    return (
      <div className="space-y-2">
        <Feedback
          error
          message={`Unable to load ${label}. No cached content is shown.`}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
        >
          Retry {label}
        </Button>
      </div>
    );
  return (
    <Feedback
      message={
        query.isLoading ? `Loading ${label}…` : `${label} is not available.`
      }
    />
  );
}
export function Pagination({
  page,
  pageSize,
  total,
  pending,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  pending: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <nav
      aria-label="List pagination"
      className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"
    >
      <span className="text-xs text-muted-foreground">
        Page {page} · {total} result{total === 1 ? "" : "s"}
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || page * pageSize >= total}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
export function dateLabel(value: Date | string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not set"
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}
export function dateInput(value: Date | string | null) {
  return value && !Number.isNaN(new Date(value).getTime())
    ? new Date(value).toISOString().slice(0, 10)
    : "";
}
export function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The action failed. Your edits have been kept. Please retry.";
}
export function privateResourceUrl(
  url: string | null | undefined,
  resourceId: number
) {
  return Number.isSafeInteger(resourceId) &&
    resourceId > 0 &&
    url === `/api/staff-handbook/resource/${resourceId}`
    ? url
    : null;
}

export function safeInternalHandbookHref(href: string): boolean {
  // Exact relative canonical route; no encoded/network values or extra params.
  const match =
    /^\/admin\/staff-handbook\?tab=(handbook|requests)(?:&(article|request)=([1-9]\d{0,9}))?$/.exec(
      href
    );
  if (!match) return false;
  if (!match[2]) return true;
  return (
    (match[1] === "handbook"
      ? match[2] === "article"
      : match[2] === "request") && Number(match[3]) <= 2147483647
  );
}
// Parse into an inert template, then rebuild only approved elements/attributes.
// Never insert the original markup into a live document or render inline images.
export function safeHandbookHtml(html: string, resources: Resource[] = []) {
  if (typeof document === "undefined") return "";
  const template = document.createElement("template");
  template.innerHTML = html;
  const output = document.createElement("div");
  const allowed = new Set(
    "p br strong b em i u s h1 h2 h3 h4 h5 h6 ul ol li a hr blockquote table thead tbody tfoot tr th td caption span div pre code".split(
      " "
    )
  );
  const discarded = new Set(
    "script style iframe object embed img svg math form input button textarea select link meta base audio video source".split(
      " "
    )
  );
  const links = new Set(
    resources
      .filter(r => r.available)
      .map(r => privateResourceUrl(r.url, r.id))
      .filter(Boolean)
  );
  function copy(node: Node, parent: HTMLElement) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ""));
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();
    if (discarded.has(tag)) return;
    const target = allowed.has(tag) ? document.createElement(tag) : parent;
    if (target !== parent) {
      if (tag === "a") {
        const href = node.getAttribute("href") ?? "";
        // Private files must be API-authenticated and belong to this revision.
        const privateHref = href.startsWith("/api/");
        const valid = privateHref
          ? links.has(href)
          : safeInternalHandbookHref(href) ||
            /^(?:https:\/\/[^\s\\]+|#[a-z0-9-]+)$/i.test(href);
        if (valid) {
          target.setAttribute("href", href);
          target.setAttribute("rel", "noopener noreferrer");
        }
      }
      if (tag === "td" || tag === "th")
        for (const name of ["colspan", "rowspan"]) {
          const value = node.getAttribute(name);
          if (value && /^[1-9]\d?$/.test(value))
            target.setAttribute(name, value);
        }
      if (tag === "ol") {
        const start = node.getAttribute("start");
        if (start && /^\d{1,5}$/.test(start))
          target.setAttribute("start", start);
      }
      parent.appendChild(target);
    }
    Array.from(node.childNodes).forEach(child => copy(child, target));
  }
  Array.from(template.content.childNodes).forEach(node => copy(node, output));
  return output.innerHTML;
}
export function GuideReading({
  revision,
  resources,
}: {
  revision: Revision;
  resources: Resource[];
}) {
  const content = revision.content;
  const allowedResources = resources.filter(r =>
    revision.resourceIds.includes(r.id)
  );
  return (
    <article data-handbook-reading className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold break-words">{content.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{content.summary}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {content.category} · {content.sensitivity} · Revision{" "}
          {revision.revisionNumber} · Review due:{" "}
          {dateLabel(content.nextReviewAt)}
        </p>
        {content.tags.length > 0 && (
          <p className="mt-1 text-xs">{content.tags.join(" · ")}</p>
        )}
      </header>
      {content.format === "article" ? (
        <SafeProse html={content.contentHtml} resources={allowedResources} />
      ) : (
        Object.entries(sectionLabels).map(([key, label]) => (
          <section key={key}>
            <h3 className="mb-2 text-sm font-semibold">{label}</h3>
            <SafeProse
              html={content.sections[key as keyof typeof sectionLabels]}
              resources={allowedResources}
            />
          </section>
        ))
      )}
      <section>
        <h3 className="text-sm font-semibold">Private attachments</h3>
        {allowedResources.length ? (
          <ul className="mt-2 space-y-2 text-sm">
            {allowedResources.map(r => (
              <li key={r.id}>
                {r.available && privateResourceUrl(r.url, r.id) ? (
                  <a
                    className="text-primary underline break-all"
                    href={r.url!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {r.fileName}
                  </a>
                ) : (
                  <span>
                    {r.fileName} —{" "}
                    {r.available
                      ? "unavailable (invalid private link)"
                      : "Attachment no longer available"}
                  </span>
                )}{" "}
                <span className="text-xs text-muted-foreground">
                  ({Math.ceil(r.byteSize / 1024)} KB)
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            No attachments in this revision.
          </p>
        )}
      </section>
    </article>
  );
}
export function SafeProse({
  html,
  resources,
}: {
  html: string;
  resources: Resource[];
}) {
  return (
    <div
      className="prose prose-sm max-w-none break-words overflow-x-auto [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2"
      dangerouslySetInnerHTML={{ __html: safeHandbookHtml(html, resources) }}
    />
  );
}
export function History({ audit }: { audit: Audit[] }) {
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Audit history (read-only)
      </summary>
      <ol className="mt-3 max-h-64 overflow-y-auto space-y-3 text-xs">
        {audit.length ? (
          audit.map(item => (
            <li key={item.id}>
              <p className="font-medium">
                {item.action} · Staff #{item.actorId} ·{" "}
                {dateLabel(item.createdAt)}
              </p>
              <p className="text-muted-foreground">{item.summary}</p>
            </li>
          ))
        ) : (
          <li>No audit entries.</li>
        )}
      </ol>
    </details>
  );
}
