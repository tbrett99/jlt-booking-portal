import React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  KNOWLEDGE_REQUEST_STATUS_LABELS,
  type KnowledgeRequestStatus,
} from "@shared/staff-handbook";
import {
  HandbookAccessDenied,
  useHandbookAccessGuard,
} from "./StaffHandbookComponents";

export function StaffHandbookLinkedItem({
  type,
  id,
  onOpen,
  disabled = false,
  publishedOnly = false,
}: {
  type: "guides" | "reports";
  id: number;
  onOpen: (id: number) => void;
  disabled?: boolean;
  publishedOnly?: boolean;
}) {
  const query = trpc.staffHandbook.linkOptions.useQuery(
    {
      type,
      scope: type === "guides" && publishedOnly ? "published" : "active",
      selectedId: id,
      page: 1,
    },
    { placeholderData: undefined, staleTime: 0 }
  );
  const { blocked } = useHandbookAccessGuard(query.error);
  if (blocked) return <HandbookAccessDenied />;

  // Never fall back to a previous selection, search result, or historical title.
  const data = !query.isError && !query.isLoading ? query.data : undefined;
  const selected =
    data?.selected?.id === id &&
    !(
      type === "guides" &&
      (data.selected.state === "archived" ||
        (publishedOnly && data.selected.state !== "published"))
    )
      ? data.selected
      : null;
  const itemLabel = type === "guides" ? "guide" : "report";
  const stateLabel = selected
    ? type === "reports"
      ? (KNOWLEDGE_REQUEST_STATUS_LABELS[
          selected.state as KnowledgeRequestStatus
        ] ?? "Report")
      : selected.state === "published"
        ? "Published"
        : selected.state === "in_review"
          ? "Awaiting a check"
          : selected.state === "changes"
            ? "Published · draft changes"
            : "Draft"
    : "";

  return (
    <section
      className="space-y-2 rounded-md bg-muted/30 p-3 text-sm"
      aria-label={`Linked ${itemLabel}`}
    >
      {query.isError ? (
        <>
          <p role="alert">
            The linked {itemLabel} could not be loaded. No cached title is
            shown.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry linked {itemLabel}
          </Button>
        </>
      ) : query.isLoading || !data ? (
        <p role="status">Loading linked {itemLabel}…</p>
      ) : selected ? (
        <>
          <p className="font-medium">{selected.title}</p>
          <p className="text-xs text-muted-foreground">
            {selected.category} · {stateLabel}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || query.isFetching}
            onClick={() => onOpen(selected.id)}
          >
            {type === "reports" ? "Follow report" : "Read"}{" "}
            {selected.title}
          </Button>
        </>
      ) : (
        <p>
          {type === "guides" && publishedOnly
            ? "This report was answered before, but its linked guide is not currently published. Check or replace the guide."
            : `The linked ${itemLabel} is not currently available here. Check or replace the link.`}
        </p>
      )}
    </section>
  );
}
