import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  KNOWLEDGE_REQUEST_STATUS_LABELS,
  type KnowledgeRequestStatus,
} from "@shared/staff-handbook";
import {
  controlClass,
  Field,
  QueryState,
  Pagination,
  HandbookAccessDenied,
  useHandbookAccessGuard,
} from "./StaffHandbookComponents";

export function HandbookLinkPicker({
  type,
  label,
  value,
  onChange,
  disabled = false,
  publishedOnly = false,
  excludeId,
}: {
  type: "guides" | "reports";
  label: string;
  value: number | null;
  onChange: (id: number | null) => void;
  disabled?: boolean;
  publishedOnly?: boolean;
  excludeId?: number;
}) {
  const [choosing, setChoosing] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = trpc.staffHandbook.linkOptions.useQuery(
    {
      type,
      scope: publishedOnly ? "published" : "active",
      search: search || undefined,
      selectedId: value,
      excludeId,
      page,
    },
    {
      enabled: choosing || value !== null,
      placeholderData: undefined,
      staleTime: 0,
    }
  );
  const { blocked } = useHandbookAccessGuard(query.error);
  if (blocked) return <HandbookAccessDenied />;
  const data = !query.isError && !query.isLoading ? query.data : undefined;
  const selected = data?.selected?.id === value ? data.selected : null;
  function stateLabel(state: string) {
    return type === "reports"
      ? (KNOWLEDGE_REQUEST_STATUS_LABELS[state as KnowledgeRequestStatus] ??
          "Report")
      : state === "published"
        ? "Published"
        : state === "changes"
          ? "Published · draft changes"
          : state === "in_review"
            ? "Awaiting a check"
            : "Draft";
  }
  return (
    <section className="space-y-2" aria-label={label}>
      <p className="text-sm font-medium">{label}</p>
      {value !== null && (
        <div className="rounded-md bg-muted/30 p-2 text-sm">
          {selected ? (
            <>
              <span className="font-medium">{selected.title}</span>
              <p className="text-xs text-muted-foreground">
                {selected.category} · {stateLabel(selected.state)}
              </p>
            </>
          ) : query.isError ? (
            <>
              <p role="alert">
                The linked item could not be loaded. Retry before choosing
                another.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled || query.isFetching}
                onClick={() => void query.refetch()}
              >
                Retry linked {type === "guides" ? "guide" : "report"}
              </Button>
            </>
          ) : (
            <p>
              {query.isLoading || !query.data
                ? "Loading linked item…"
                : "The linked item is not currently available here. Choose another or remove the link."}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => setChoosing(previous => !previous)}
        >
          {choosing
            ? "Hide choices"
            : value === null
              ? type === "guides"
                ? "Choose a guide"
                : "Choose a report"
              : "Change selection"}
        </Button>
        {value !== null && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            Remove link
          </Button>
        )}
      </div>
      {choosing && (
        <div className="space-y-3 rounded-lg border p-3">
          <Field
            label={
              type === "guides"
                ? "Find a guide by title"
                : "Find a report by title"
            }
          >
            <input
              type="search"
              maxLength={200}
              className={controlClass}
              disabled={disabled}
              value={searchInput}
              placeholder={
                type === "guides"
                  ? "For example: reimbursement documents"
                  : "Search the question already reported"
              }
              onChange={e => {
                setSearchInput(e.target.value);
                setSearch(e.target.value.trim());
                setPage(1);
              }}
            />
          </Field>
          {query.isError || query.isLoading || !data ? (
            <QueryState
              query={query}
              label={type === "guides" ? "guide choices" : "report choices"}
            />
          ) : (
            <>
              {query.isFetching && (
                <p role="status" className="text-xs text-muted-foreground">
                  Updating choices…
                </p>
              )}
              <ul
                className="max-h-56 space-y-2 overflow-y-auto"
                aria-label={
                  type === "guides" ? "Guide choices" : "Report choices"
                }
              >
                {data.items.map(item => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={disabled || query.isFetching}
                      className="w-full rounded-md border p-3 text-left text-sm hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      onClick={() => {
                        onChange(item.id);
                        setChoosing(false);
                      }}
                    >
                      <span className="font-medium">{item.title}</span>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.category} · {stateLabel(item.state)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
              {!data.items.length && (
                <p className="text-sm text-muted-foreground">
                  {type === "guides"
                    ? publishedOnly
                      ? "No published guides match. Write a new guide, then publish it before marking this report answered."
                      : "No guides match. Try a different title or write a new guide."
                    : "No other reports match. Try a different title."}
                </p>
              )}
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                pending={query.isFetching || disabled}
                onPage={setPage}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}
