import { Link } from "wouter";
import { CalendarDays, ArrowUpRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { STAFF_CALL_REASONS } from "@shared/staff-calls";

function date(value: Date | string) {
  return new Date(value).toLocaleString();
}
function reason(key: string) {
  return (
    STAFF_CALL_REASONS.find(item => item.key === key)?.label ??
    key.replaceAll("_", " ")
  );
}
/** Full CRM rendering only. Restricted staff use their own call screen instead. */
export default function StaffCallCrmHistory({ agentId }: { agentId: number }) {
  const query = trpc.staffCalls.agentHistory.useQuery(
    { agentId, limit: 8 },
    { retry: false, staleTime: 0, refetchOnWindowFocus: true }
  );
  const bookUrl = `/admin/staff-calls?agentId=${agentId}`;
  return (
    <section
      aria-label="Agent support calls"
      className="rounded-2xl border border-emerald-200 bg-card p-4 text-card-foreground shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <CalendarDays size={18} />
            Support calls
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Appointments, confirmed attendance and this agent’s internal call
            notes.
          </p>
        </div>
        <Link
          href={bookUrl}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
        >
          Book a call
          <ArrowUpRight size={14} />
        </Link>
      </div>
      {query.isLoading ? (
        <p role="status" className="mt-4 text-sm">
          Loading call history…
        </p>
      ) : query.error || !query.data ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <p>Call history could not be loaded. No cached notes are shown.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void query.refetch()}
          >
            Retry call history
          </Button>
        </div>
      ) : (
        <>
          {query.data.nextCall ? (
            <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-950">
              <p className="text-xs font-semibold uppercase tracking-wide">
                Next booked call
              </p>
              <p className="mt-1 text-sm font-semibold">
                {date(query.data.nextCall.startAt)} ·{" "}
                {query.data.nextCall.hostName}
              </p>
              <p className="mt-1 text-xs">
                {reason(query.data.nextCall.reasonKey)}
              </p>
              <Link
                href={`/admin/staff-calls?callId=${query.data.nextCall.id}`}
                className="mt-2 inline-block text-sm font-semibold underline"
              >
                Open call
              </Link>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              No future confirmed support call is booked.
            </p>
          )}
          <div className="mt-4 space-y-3">
            {query.data.items.map(call => (
              <article
                key={call.id}
                className="rounded-xl border bg-muted/20 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">
                      {reason(call.reasonKey)} · {call.hostName}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {date(call.startAt)} ·{" "}
                      {call.format === "group" ? "Group call" : "1:1"}
                    </p>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-1 text-xs capitalize">
                    {call.status.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="mt-2 text-xs capitalize">
                  Attendance: {call.attendance.replaceAll("_", " ")}
                  {call.outcome
                    ? ` · ${call.outcome.replaceAll("_", " ")}`
                    : ""}
                </p>
                {call.privateNotes && (
                  <div className="mt-2">
                    <p className="text-xs font-semibold text-muted-foreground">
                      Internal call notes
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
                      {call.privateNotes}
                    </p>
                  </div>
                )}
                <Link
                  href={`/admin/staff-calls?callId=${call.id}`}
                  className="mt-2 inline-block text-xs font-semibold text-emerald-700 underline"
                >
                  Call record and Academy follow-ups
                </Link>
              </article>
            ))}
          </div>
          {!query.data.items.length && (
            <p className="mt-4 text-sm text-muted-foreground">
              No call history has been recorded in this feature yet.
            </p>
          )}
          {query.data.nextCursor && (
            <Link
              href={bookUrl}
              className="mt-3 inline-block text-sm underline"
            >
              Open diary for more calls
            </Link>
          )}
        </>
      )}
    </section>
  );
}
