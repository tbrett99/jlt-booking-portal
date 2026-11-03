import React, { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { resolveDocUrl } from "@/lib/docUrl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MergeHistoryEntry } from "../../../server/agent-merge-contract";

/** The merge audit stores UTC; timezone-less database timestamps must not be read as local. */
export function formatMergeTimestamp(value: string | null): string {
  if (!value) return "Not recorded";
  const normalized = value.trim().replace(" ", "T");
  const date = new Date(
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`
  );
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function AgentMergeHistory({ userId }: { userId: number }) {
  const { user } = useAuth();
  if (user?.role !== "admin" && user?.role !== "super_admin") return null;
  return <AuthorizedMergeHistory key={userId} userId={userId} />;
}

function AuthorizedMergeHistory({ userId }: { userId: number }) {
  const [archivedSource, setArchivedSource] = useState<number | null>(null);
  const history = trpc.agentMerge.history.useQuery(
    { userId },
    { retry: false }
  );

  if (history.isLoading)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading merge history…
      </p>
    );
  if (history.isError || !history.data) {
    return (
      <div
        role="alert"
        className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
      >
        <p className="font-medium">Merge history is unavailable.</p>
        <p>
          {history.error?.message ?? "The server did not return merge history."}
        </p>
        <p className="text-muted-foreground">
          Retry loading. If the merge-history schema is pending or unavailable,
          ask a SuperAdmin to complete the database migration; this is not
          evidence that no merges exist.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={history.isFetching}
          onClick={() => void history.refetch()}
        >
          {history.isFetching ? "Retrying…" : "Retry merge history"}
        </Button>
      </div>
    );
  }

  const { archivedInto, entries } = history.data;
  return (
    <div className="space-y-4 text-sm">
      {archivedInto != null && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <p className="font-semibold">
            Archived duplicate — merged into account #{archivedInto}
          </p>
          <p className="mt-1">
            This original record is retained for read-only history, not deleted.
          </p>
          <a
            className="mt-2 inline-block font-medium underline"
            href={`/crm/agents?agent=${archivedInto}`}
          >
            Open the primary CRM account
          </a>
        </div>
      )}
      <p className="text-muted-foreground">
        Immutable merge audit. Times are shown in your local timezone from
        stored UTC. Overlapping Academy learning and Actions remain separate
        read-only history, not blended into primary progress. The
        original-source view preserves provenance for all recorded source
        activity, including records moved to the primary.
      </p>
      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-muted-foreground">
          No merges are recorded for this account.
        </p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry: MergeHistoryEntry) => (
            <article key={entry.id} className="space-y-3 rounded-lg border p-4">
              <div>
                <h4 className="font-semibold">
                  {entry.sourceName ?? "Unnamed agent"} · source #
                  {entry.sourceUserId} → primary #{entry.primaryUserId}
                </h4>
                <p className="mt-1 break-words text-muted-foreground">
                  {entry.sourceEmail ?? "No email recorded"} · JLT ID:{" "}
                  {entry.sourceJltId ?? "Not recorded"}
                </p>
                <p
                  className="mt-1 text-xs text-muted-foreground"
                  title={`Stored UTC: ${entry.mergedAt}`}
                >
                  {formatMergeTimestamp(entry.mergedAt)} · Merged by{" "}
                  {entry.actorName ?? "Administrator"}
                </p>
              </div>
              <div>
                <p className="font-medium">Recorded reason</p>
                <p className="whitespace-pre-wrap break-words">
                  {entry.reason}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="font-medium">Moved to primary</p>
                  <ul className="mt-1 space-y-1 text-muted-foreground">
                    {entry.moves.map(move => (
                      <li key={move.table}>
                        {move.label}: {move.count}
                      </li>
                    ))}
                  </ul>
                  {entry.moves.length === 0 && (
                    <p className="text-muted-foreground">No records moved.</p>
                  )}
                </div>
                <div>
                  <p className="font-medium">Retained on original record</p>
                  <ul className="mt-1 space-y-2 text-muted-foreground">
                    {entry.retained.map(item => (
                      <li key={item.table}>
                        {item.label}: {item.count}
                        <span className="block text-xs">{item.reason}</span>
                      </li>
                    ))}
                  </ul>
                  {entry.retained.length === 0 && (
                    <p className="text-muted-foreground">
                      No retained activity recorded.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setArchivedSource(entry.sourceUserId)}
                >
                  View original CRM, Academy & Actions — read-only
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {archivedSource != null && (
        <ArchivedSourceDialog
          key={archivedSource}
          sourceUserId={archivedSource}
          onClose={() => setArchivedSource(null)}
        />
      )}
    </div>
  );
}

// Only allow navigable document URLs; render text, never server-provided HTML.
function archivedDocumentUrl(url: string): string | null {
  const resolved = resolveDocUrl(url);
  if (!resolved || !/^(https?:\/\/|\/(?!\/))/i.test(resolved)) return null;
  return resolved;
}

function ArchivedSourceDialog({
  sourceUserId,
  onClose,
}: {
  sourceUserId: number;
  onClose(): void;
}) {
  const details = trpc.agentMerge.archivedDetails.useQuery(
    { sourceUserId },
    { retry: false }
  );
  const data = details.data;
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Original CRM record #{sourceUserId} — read-only
          </DialogTitle>
          <DialogDescription>
            Archived source provenance, not the primary account’s current
            profile. Original Academy, Actions and legal signatures remain
            attributed to the source identity. Nothing here can be edited or
            reassigned.
          </DialogDescription>
        </DialogHeader>
        {details.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading archived source record…
          </p>
        ) : details.isError || !data ? (
          <div
            role="alert"
            className="space-y-2 rounded-lg border border-destructive/30 p-4 text-sm"
          >
            <p className="font-semibold">
              Archived source details are unavailable.
            </p>
            <p>
              {details.error?.message ??
                "The server did not return an archived record."}
            </p>
            <p>
              Retry loading. If the merge schema is pending, ask a SuperAdmin to
              complete the migration. No historical data has been declared
              missing.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={details.isFetching}
              onClick={() => void details.refetch()}
            >
              Retry archived details
            </Button>
          </div>
        ) : data.sourceUserId !== sourceUserId ? (
          <p role="alert" className="text-sm text-destructive">
            The archived response does not match this source. Close and reopen
            the record.
          </p>
        ) : (
          <div className="space-y-5 text-sm">
            <p className="rounded-lg border bg-muted/40 p-3">
              Archived source #{data.sourceUserId} → primary #
              {data.primaryUserId}. Times below are local, converted from stored
              UTC. Sensitive bank credentials and raw learner answers are not
              displayed.
            </p>
            <section className="space-y-2">
              <h3 className="font-semibold">Original source profile</h3>
              {data.profile.length ? (
                <dl className="grid gap-2 sm:grid-cols-2">
                  {data.profile.map((item, index) => (
                    <div
                      key={`${item.label}:${index}`}
                      className="rounded-md border p-3"
                    >
                      <dt className="text-xs text-muted-foreground">
                        {item.label}
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words">
                        {item.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-muted-foreground">
                  No archived profile fields recorded.
                </p>
              )}
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">Original source notes</h3>
              {data.notes.length ? (
                <div className="space-y-2">
                  {data.notes.map(note => (
                    <article key={note.id} className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">
                        {note.authorName ?? "Unknown author"} ·{" "}
                        {formatMergeTimestamp(note.createdAt)}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap break-words">
                        {note.content}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  No source notes recorded.
                </p>
              )}
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">Original source documents</h3>
              {data.documents.length ? (
                <ul className="space-y-2">
                  {data.documents.map((document, index) => {
                    const url = archivedDocumentUrl(document.url);
                    return (
                      <li key={`${document.label}:${index}`}>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary underline"
                          >
                            {document.label} — original source document
                          </a>
                        ) : (
                          <span>
                            {document.label} — document link unavailable
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-muted-foreground">
                  No source documents recorded.
                </p>
              )}
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">
                Original source contract & signature provenance
              </h3>
              <p className="text-xs text-muted-foreground">
                Legal signatures belong to the original source and signing
                event. They have not been re-signed by or attributed to the
                primary account.
              </p>
              {data.contracts.length ? (
                <ul className="space-y-2">
                  {data.contracts.map((contract, index) => (
                    <li
                      key={`${contract.kind}:${index}`}
                      className="rounded-md border p-3"
                    >
                      <p className="font-medium">
                        {contract.kind} ·{" "}
                        {contract.name ?? "Signer not recorded"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Original source #{sourceUserId} · Signed:{" "}
                        {formatMergeTimestamp(contract.signedAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">
                  No source contract signatures recorded.
                </p>
              )}
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">
                Original Academy courses — separate archived history
              </h3>
              {data.courses.length ? (
                <ul className="space-y-2">
                  {data.courses.map(course => (
                    <li
                      key={course.enrollmentId}
                      className="rounded-md border p-3"
                    >
                      <p className="font-medium">
                        {course.title} · {course.status}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Enrollment #{course.enrollmentId} · {course.attempts}{" "}
                        attempts · Completed:{" "}
                        {formatMergeTimestamp(course.completedAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">
                  No source courses recorded.
                </p>
              )}
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">
                Original Actions — separate archived history
              </h3>
              {data.actions.length ? (
                <ul className="space-y-2">
                  {data.actions.map(action => (
                    <li key={action.id} className="rounded-md border p-3">
                      <p className="font-medium">
                        {action.title} · {action.status}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Action #{action.id} · Submitted:{" "}
                        {formatMergeTimestamp(action.submittedAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">
                  No source Actions recorded.
                </p>
              )}
            </section>
          </div>
        )}
        <div className="flex justify-end border-t pt-3">
          <Button variant="outline" onClick={onClose}>
            Close read-only record
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
