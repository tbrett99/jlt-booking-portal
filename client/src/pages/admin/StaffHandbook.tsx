import React, { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, MessageSquarePlus, Plus, Search } from "lucide-react";
import {
  canUseStaffHandbook,
  STAFF_HANDBOOK_CATEGORIES,
  KNOWLEDGE_REQUEST_STATUSES,
  KNOWLEDGE_REQUEST_STATUS_LABELS,
  type KnowledgeRequestStatus,
} from "@shared/staff-handbook";
import { ArticlePanel } from "./StaffHandbookArticle";
import { ReportKnowledge, RequestPanel } from "./StaffHandbookRequests";
import {
  controlClass,
  panelClass,
  Field,
  Feedback,
  Pagination,
  QueryState,
  dateLabel,
  type HandbookOverview,
  type HandbookBrowseItem,
  type RequestDto,
  HandbookAccessBoundary,
  HandbookAccessDenied,
  useHandbookAccessGuard,
  isHandbookAuthorityError,
  staffHandbookQueryKey,
  isHandbookMutationKey,
} from "./StaffHandbookComponents";
const staffQueryKey = staffHandbookQueryKey;
function positiveId(value: string | null) {
  return value &&
    /^[1-9]\d*$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) <= 2147483647
    ? Number(value)
    : null;
}
type View = "all" | "published" | "drafts" | "archived";
const guideStateLabels: Record<HandbookBrowseItem["state"], string> = {
  draft: "Draft",
  in_review: "In review",
  published: "Published",
  changes: "Unpublished changes",
  archived: "Archived",
};

export default function StaffHandbook() {
  const { user, loading, error } = useAuth();
  const cache = useQueryClient();
  const allowed =
    !loading && !isHandbookAuthorityError(error) && canUseStaffHandbook(user);
  const identity = allowed && user ? `${user.id}:${user.role}` : null;
  const [safeIdentity, setSafeIdentity] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSafeIdentity(null);
    // Cache must not bridge logout, denied role, or a changed staff identity.
    void cache.cancelQueries({ queryKey: staffQueryKey }).then(() => {
      cache.removeQueries({ queryKey: staffQueryKey });
      for (const mutation of cache.getMutationCache().getAll()) {
        if (isHandbookMutationKey(mutation.options.mutationKey))
          cache.getMutationCache().remove(mutation);
      }
      if (active) setSafeIdentity(identity);
    });
    return () => {
      active = false;
      void cache.cancelQueries({ queryKey: staffQueryKey });
      cache.removeQueries({ queryKey: staffQueryKey });
    };
  }, [identity, cache]);
  if (loading || (allowed && safeIdentity !== identity))
    return <Feedback message="Checking staff handbook access…" />;
  if (!allowed || !user)
    return (
      <Feedback
        error
        message="Staff handbook access is restricted to active, eligible internal administrators. No handbook or request data has been loaded."
      />
    );
  return (
    <HandbookAccessBoundary key={identity!}>
      <HandbookWorkspace userId={user.id} />
    </HandbookAccessBoundary>
  );
}
function HandbookWorkspace({ userId }: { userId: number }) {
  const [, navigate] = useLocation();
  const searchParams = new URLSearchParams(useSearch());
  const tab = searchParams.get("tab") === "requests" ? "requests" : "handbook";
  const articleId = positiveId(searchParams.get("article"));
  const requestId = positiveId(searchParams.get("request"));
  const [newArticle, setNewArticle] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [remount, setRemount] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [category, setCategory] = useState("");
  const [view, setView] = useState<View>("all");
  const [status, setStatus] = useState<"all" | "open" | KnowledgeRequestStatus>(
    "all"
  );
  const [assignee, setAssignee] = useState("");
  const [page, setPage] = useState(1);
  // Overview remains an authorized metadata source for categories and staff,
  // not a dashboard or a prerequisite for rendering the guide list.
  const overview = trpc.staffHandbook.overview.useQuery(undefined, {
    enabled: true,
    placeholderData: undefined,
  });
  const browse = trpc.staffHandbook.browse.useQuery(
    {
      search: search || undefined,
      category: category || undefined,
      view,
      page,
    },
    { enabled: tab === "handbook", placeholderData: undefined }
  );
  const requests = trpc.staffHandbook.requests.useQuery(
    {
      search: search || undefined,
      category: category || undefined,
      status,
      ...(assignee === "unassigned"
        ? { assigneeId: null }
        : assignee
          ? { assigneeId: Number(assignee) }
          : {}),
      page,
    },
    { enabled: tab === "requests", placeholderData: undefined }
  );
  const { blocked } = useHandbookAccessGuard(
    overview.error,
    browse.error,
    requests.error
  );
  const overviewData: HandbookOverview | undefined = overview.data;
  const categories = Array.from(
    new Set([
      ...STAFF_HANDBOOK_CATEGORIES,
      ...(overview.isError ? [] : (overviewData?.categories ?? [])),
    ])
  );
  const staff = overview.isError ? [] : (overviewData?.staff ?? []);
  function route(
    nextTab: "handbook" | "requests",
    selected?: { article?: number; request?: number }
  ) {
    const params = new URLSearchParams({ tab: nextTab });
    if (selected?.article) params.set("article", String(selected.article));
    if (selected?.request) params.set("request", String(selected.request));
    navigate(`/admin/staff-handbook?${params.toString()}`);
  }
  function resetFilters() {
    setPage(1);
    setSearch("");
    setSearchInput("");
    setCategory("");
    setStatus("all");
    setAssignee("");
  }
  function changeTab(nextTab: "handbook" | "requests") {
    setReporting(false);
    setNewArticle(false);
    setEditingId(null);
    resetFilters();
    setView("all");
    route(nextTab);
  }
  function startNewGuide() {
    // A saved draft must remain visible after closing, even when creation
    // started from Published, Archived, a search, or a later results page.
    resetFilters();
    setView("all");
    setEditingId(null);
    setNewArticle(true);
    setReporting(false);
    route("handbook");
  }
  function startReport() {
    resetFilters();
    setEditingId(null);
    setReporting(true);
    setNewArticle(false);
    route("requests");
  }
  function openArticle(id: number, edit = false) {
    setNewArticle(false);
    setReporting(false);
    setEditingId(edit ? id : null);
    setRemount(previous => previous + 1);
    route("handbook", { article: id });
  }
  const selection =
    tab === "handbook"
      ? articleId !== null || newArticle
      : requestId !== null || reporting;
  const data = tab === "handbook" ? browse.data : requests.data;
  if (blocked) return <HandbookAccessDenied />;
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-1 sm:p-2" data-staff-handbook>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <BookOpen className="h-6 w-6 text-primary" aria-hidden="true" />
            Staff Handbook
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Internal guides for JLT staff.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={selection}
            onClick={startNewGuide}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            New guide
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={selection}
            onClick={startReport}
          >
            <MessageSquarePlus className="mr-1 h-4 w-4" aria-hidden="true" />
            Report missing knowledge
          </Button>
        </div>
      </header>
      {!selection && (
        <nav aria-label="Handbook sections" className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={tab === "handbook" ? "default" : "outline"}
            aria-current={tab === "handbook" ? "page" : undefined}
            onClick={() => changeTab("handbook")}
          >
            Guides
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tab === "requests" ? "default" : "outline"}
            aria-current={tab === "requests" ? "page" : undefined}
            onClick={() => changeTab("requests")}
          >
            Missing knowledge
          </Button>
        </nav>
      )}
      {tab === "handbook" && (articleId !== null || newArticle) ? (
        <ArticlePanel
          key={`${articleId ?? "new"}:${remount}`}
          id={newArticle ? "new" : articleId!}
          userId={userId}
          categories={categories}
          staff={staff}
          startEditing={newArticle || editingId === articleId}
          onSaved={id => openArticle(id, true)}
          onClose={() => {
            setNewArticle(false);
            setEditingId(null);
            route("handbook");
          }}
        />
      ) : tab === "requests" && reporting ? (
        <ReportKnowledge
          key="report"
          categories={categories}
          onCreated={id => {
            setReporting(false);
            route("requests", { request: id });
          }}
          onCancel={() => {
            setReporting(false);
            route("requests");
          }}
        />
      ) : tab === "requests" && requestId !== null ? (
        <RequestPanel
          key={`${requestId}:${remount}`}
          id={requestId}
          categories={categories}
          staff={staff}
          onGuide={id => {
            resetFilters();
            setView("all");
            openArticle(id, false);
          }}
          onReload={() => setRemount(previous => previous + 1)}
          onClose={() => route("requests")}
        />
      ) : (
        <section className={panelClass}>
          <div>
            <h2 className="font-semibold">
              {tab === "handbook" ? "Browse guides" : "Missing knowledge"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {tab === "handbook"
                ? "All active guides, including saved drafts and unpublished changes."
                : "Report a gap or follow up on an existing request."}
            </p>
          </div>
          <form
            onSubmit={e => {
              e.preventDefault();
              setSearch(searchInput.trim());
              setPage(1);
            }}
            className="flex items-end gap-2"
          >
            <div className="min-w-0 flex-1">
              <Field
                label={
                  tab === "handbook" ? "Search guidance" : "Search requests"
                }
              >
                <input
                  type="search"
                  maxLength={200}
                  className={controlClass}
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  placeholder="Search titles, content and tags"
                />
              </Field>
            </div>
            <Button type="submit" size="sm">
              <Search className="mr-1 h-4 w-4" aria-hidden="true" />
              Search
            </Button>
          </form>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Filter category">
              <select
                className={controlClass}
                value={category}
                onChange={e => {
                  setCategory(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All categories</option>
                {categories.map(c => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            {tab === "handbook" && (
              <Field label="Guide view">
                <select
                  className={controlClass}
                  value={view}
                  onChange={e => {
                    setView(e.target.value as View);
                    setPage(1);
                  }}
                >
                  <option value="all">All active guides</option>
                  <option value="published">Published</option>
                  <option value="drafts">Drafts</option>
                  <option value="archived">Archived</option>
                </select>
              </Field>
            )}
          </div>
          {tab === "requests" && (
            <details className="rounded-lg border px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">
                Advanced filters
                {(status !== "all" || assignee) && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {" "}
                    (active)
                  </span>
                )}
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Filter request status">
                  <select
                    className={controlClass}
                    value={status}
                    onChange={e => {
                      setStatus(e.target.value as typeof status);
                      setPage(1);
                    }}
                  >
                    <option value="all">All statuses</option>
                    <option value="open">Open requests</option>
                    {KNOWLEDGE_REQUEST_STATUSES.map(s => (
                      <option key={s} value={s}>
                        {KNOWLEDGE_REQUEST_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Filter assignee">
                  <select
                    className={controlClass}
                    value={assignee}
                    onChange={e => {
                      setAssignee(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All assignees</option>
                    <option value="unassigned">Unassigned</option>
                    {staff.map(person => (
                      <option key={person.id} value={person.id}>
                        {person.name || `Staff #${person.id}`}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </details>
          )}
          {overview.isError && (
            <QueryState query={overview} label="handbook filters" />
          )}
          {tab === "handbook" ? (
            browse.isError || browse.isLoading || !browse.data ? (
              <QueryState query={browse} label="guides" />
            ) : (
              <>
                <ul
                  className="max-h-[440px] overflow-y-auto space-y-2"
                  aria-label="Guide results"
                >
                  {browse.data.items.map((item: HandbookBrowseItem) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="w-full rounded-lg border p-3 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => openArticle(item.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-medium break-words">
                            {item.isPinned ? "Pinned · " : ""}
                            {item.title}
                          </h3>
                          <Badge variant="secondary" className="shrink-0">
                            {guideStateLabels[item.state]}
                          </Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {item.summary}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {item.category} · {item.sensitivity} · Updated{" "}
                          {dateLabel(item.updatedAt)}
                        </p>
                        {item.nextReviewAt &&
                          new Date(item.nextReviewAt).getTime() <
                            Date.now() && (
                            <p className="mt-1 text-xs text-amber-700">
                              Review overdue · {dateLabel(item.nextReviewAt)}
                            </p>
                          )}
                      </button>
                    </li>
                  ))}
                </ul>
                {!browse.data.items.length && (
                  <div className="space-y-2 rounded-lg bg-muted/30 p-4 text-sm">
                    <p>
                      {search
                        ? "No guidance matches your search."
                        : "No guides in this view yet."}
                    </p>
                    <Button type="button" size="sm" onClick={startReport}>
                      Report missing knowledge
                    </Button>
                  </div>
                )}
              </>
            )
          ) : requests.isError || requests.isLoading || !requests.data ? (
            <QueryState query={requests} label="requests" />
          ) : (
            <>
              <ul
                className="max-h-[440px] overflow-y-auto space-y-2"
                aria-label="Request results"
              >
                {requests.data.items.map((item: RequestDto) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="w-full rounded-lg border p-3 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => route("requests", { request: item.id })}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-medium break-words">
                          {item.title}
                        </h3>
                        <Badge variant="secondary" className="shrink-0">
                          {
                            KNOWLEDGE_REQUEST_STATUS_LABELS[
                              item.status as KnowledgeRequestStatus
                            ]
                          }
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {item.description}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        #{item.id} · {item.category} · {item.priority} priority
                        ·{" "}
                        {staff.find(p => p.id === item.assigneeId)?.name ||
                          (item.assigneeId
                            ? `Staff #${item.assigneeId}`
                            : "Unassigned")}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
              {!requests.data.items.length && (
                <p className="rounded-lg bg-muted/30 p-4 text-sm">
                  No requests match these filters. Use Report missing knowledge
                  to raise a gap.
                </p>
              )}
            </>
          )}
          {data &&
            !(tab === "handbook" ? browse.isError : requests.isError) && (
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                pending={
                  tab === "handbook" ? browse.isFetching : requests.isFetching
                }
                onPage={setPage}
              />
            )}
        </section>
      )}
    </div>
  );
}
