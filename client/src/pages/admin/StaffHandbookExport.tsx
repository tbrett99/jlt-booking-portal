import React, { useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import type { KnowledgeRequestStatus } from "@shared/staff-handbook";
import {
  Feedback,
  HandbookAccessDenied,
  errorText,
  isHandbookAuthorityError,
  isHandbookMutationKey,
  staffHandbookQueryKey,
  useHandbookAccessGuard,
} from "./StaffHandbookComponents";

/** The server serialises exports; this helper never builds CSV from visible rows. */
export function downloadHandbookCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" })
  );
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Safari/Firefox may still be consuming the URL after click returns.
    // This cleanup retains only the opaque URL, not CSV or authority state.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

type Props = {
  tab: "handbook" | "requests";
  search?: string;
  category?: string;
  view: "all" | "published" | "drafts" | "archived";
  status: "all" | "open" | KnowledgeRequestStatus;
  assigneeId?: number | null;
  // Includes unfinished filter edits and page/route context, not just RPC input.
  contextKey: string;
};
export function StaffHandbookExport(props: Props) {
  const cache = useQueryClient();
  const guides = trpc.staffHandbook.exportGuides.useMutation();
  const reports = trpc.staffHandbook.exportRequests.useMutation();
  const { blocked, deny } = useHandbookAccessGuard(guides.error, reports.error);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const context = useRef({ key: props.contextKey, epoch: 0 });
  if (context.current.key !== props.contextKey) {
    context.current = {
      key: props.contextKey,
      epoch: context.current.epoch + 1,
    };
  }
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      context.current.epoch += 1;
      for (const mutation of cache.getMutationCache().getAll()) {
        const key = mutation.options.mutationKey;
        if (
          isHandbookMutationKey(key) &&
          Array.isArray(key?.[0]) &&
          ["exportGuides", "exportRequests"].includes(String(key[0][1]))
        )
          cache.getMutationCache().remove(mutation);
      }
    };
  }, [cache]);
  // A sibling denial must prevent a download even before boundary effects run.
  function authorized() {
    return (
      !cache
        .getQueryCache()
        .findAll({ queryKey: staffHandbookQueryKey })
        .some(q => isHandbookAuthorityError(q.state.error)) &&
      !cache
        .getMutationCache()
        .getAll()
        .some(
          m =>
            isHandbookMutationKey(m.options.mutationKey) &&
            isHandbookAuthorityError(m.state.error)
        )
    );
  }
  async function exportMatching() {
    if (lock.current || blocked || !authorized()) return;
    lock.current = true;
    const epoch = context.current.epoch;
    setPending(true);
    setMessage("");
    setFailed(false);
    try {
      const result =
        props.tab === "handbook"
          ? await guides.mutateAsync({
              search: props.search,
              category: props.category,
              view: props.view,
            })
          : await reports.mutateAsync({
              search: props.search,
              category: props.category,
              status: props.status,
              ...(props.assigneeId !== undefined
                ? { assigneeId: props.assigneeId }
                : {}),
            });
      if (!alive.current || context.current.epoch !== epoch || !authorized())
        return;
      downloadHandbookCsv(
        result.csv,
        props.tab === "handbook"
          ? "staff-handbook-guides.csv"
          : "staff-handbook-reports.csv"
      );
      setMessage(
        `Exported ${result.rowCount} matching ${props.tab === "handbook" ? "guide" : "report"}${result.rowCount === 1 ? "" : "s"}.${props.tab === "handbook" ? ` Snapshot: ${props.view === "published" ? "Published" : "Working draft"}.` : ""}`
      );
    } catch (error) {
      if (!alive.current) return;
      if (deny(error)) return;
      if (context.current.epoch === epoch) {
        setFailed(true);
        setMessage(errorText(error));
      }
    } finally {
      lock.current = false;
      if (alive.current) setPending(false);
    }
  }
  if (blocked) return <HandbookAccessDenied />;
  return (
    <div className="space-y-2" data-handbook-export>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => void exportMatching()}
      >
        {pending
          ? "Preparing CSV…"
          : `Export all matching ${props.tab === "handbook" ? "guides" : "reports"} (CSV)`}
      </Button>
      <p className="text-xs text-muted-foreground">
        Uses the current filters across every results page, not just the rows
        shown.
      </p>
      {props.tab === "handbook" && (
        <p className="text-xs text-muted-foreground">
          CSV snapshot:{" "}
          {props.view === "published"
            ? "Published — the guidance staff can use now."
            : "Working draft — latest saved content, including unpublished changes. Archived guides also use their working draft."}
        </p>
      )}
      <Feedback message={message} error={failed} />
    </div>
  );
}
