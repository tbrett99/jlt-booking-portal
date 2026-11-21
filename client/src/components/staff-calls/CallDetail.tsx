import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  callTime,
  localZone,
  MeetingLink,
  panel,
  QueryState,
  reasonLabel,
  type CallOutputs,
} from "./CallUI";
import ParticipantRecord from "./ParticipantRecord";
import CallScheduling from "./CallScheduling";
export default function CallDetail({
  callId,
  context,
  close,
  refresh,
}: {
  callId: number;
  context: CallOutputs["context"];
  close: () => void;
  refresh: () => void;
}) {
  const input = useMemo(() => ({ callId }), [callId]);
  const detail = trpc.staffCalls.get.useQuery(input, {
    enabled: context.canManage && callId > 0,
    retry: false,
    staleTime: 0,
  });
  const [briefingId, setBriefingId] = useState<number | null>(null);
  const [participantPage, setParticipantPage] = useState(0);
  const refreshAll = () => {
    void detail.refetch();
    refresh();
  };
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={close}>
          ← Back to diary
        </Button>
        <Button variant="ghost" onClick={() => void detail.refetch()}>
          Reload current call record
        </Button>
      </div>
      {(detail.error || detail.isLoading) && (
        <QueryState query={detail}>{null}</QueryState>
      )}
      <div
        hidden={!!detail.error || detail.isLoading}
        inert={!!detail.error || detail.isLoading}
        className="space-y-5"
      >
        {detail.data && (
          <>
            <header className={panel}>
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
                    Private support call #{callId}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold">
                    {reasonLabel(detail.data.call.reasonKey, context.reasons)}
                  </h2>
                </div>
                <span className="text-sm font-semibold">
                  {detail.data.call.status.replaceAll("_", " ")}
                </span>
              </div>
              <p className="text-sm">
                Hosted by{" "}
                {detail.data.call.hostName ||
                  `Host #${detail.data.call.hostUserId}`}{" "}
                ·{" "}
                {detail.data.call.format === "group" ? "Private group" : "1:1"}{" "}
                · scheduling version {detail.data.call.version}
              </p>
              <p className="text-sm font-medium">
                {callTime(detail.data.call.startAt)} –{" "}
                {callTime(detail.data.call.endAt)} ({localZone()})
              </p>
              {detail.data.call.reasonExplanation && (
                <p className="text-sm">
                  Other reason: {detail.data.call.reasonExplanation}
                </p>
              )}
              <MeetingLink url={detail.data.call.meetingUrl} />
              <p className="text-xs text-muted-foreground">
                Provider connection:{" "}
                {context.provider.connected
                  ? "Configured; actual availability is verified per host"
                  : "Unconnected"}
                . {context.provider.message}
              </p>
              {["pending", "needs_recovery"].includes(
                detail.data.call.status
              ) && (
                <p
                  role="alert"
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                >
                  This call is not a confirmed booking. Open the retained
                  booking operation and check provider recovery; never submit a
                  replacement with a new request ID.
                </p>
              )}
            </header>
            <CallScheduling
              key={callId}
              detail={detail.data}
              actorId={context.actorId}
              connected={context.provider.connected}
              refresh={refreshAll}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">
                Individual participant records
              </h3>
              <p className="text-xs text-muted-foreground">
                {detail.data.participants.length} invitations · attendance and
                outcomes recorded per person
              </p>
            </div>
            {briefingId && (
              <PermittedBriefing
                agentId={briefingId}
                close={() => setBriefingId(null)}
              />
            )}
            {detail.data.participants
              .slice(participantPage * 10, (participantPage + 1) * 10)
              .map(participant => (
                <ParticipantRecord
                  key={participant.id}
                  participant={participant}
                  callId={callId}
                  ended={+new Date(detail.data!.call.endAt) <= Date.now()}
                  staffMode={!context.canViewTeam}
                  refresh={refreshAll}
                  showBriefing={() => setBriefingId(participant.agentId)}
                />
              ))}
            {detail.data.participants.length > 10 && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={participantPage === 0}
                  onClick={() => setParticipantPage(page => page - 1)}
                >
                  Previous participants
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    (participantPage + 1) * 10 >=
                    detail.data.participants.length
                  }
                  onClick={() => setParticipantPage(page => page + 1)}
                >
                  Next participants
                </Button>
              </div>
            )}
            {!!detail.data.followUps.length && (
              <section className={panel}>
                <h3 className="font-semibold">
                  Linked Academy draft follow-ups
                </h3>
                {detail.data.followUps.map(item => (
                  <p key={item.planId} className="text-sm">
                    Action #{item.planId} · participant #{item.participantId}
                  </p>
                ))}
                <Link
                  className="text-sm font-semibold text-emerald-800 underline"
                  href={
                    context.canViewTeam
                      ? "/admin/academy/actions"
                      : "/staff/engagement"
                  }
                >
                  Open existing Academy assignment lifecycle →
                </Link>
              </section>
            )}
            <details className={panel}>
              <summary className="cursor-pointer font-semibold">
                Scheduling and record history
              </summary>
              <ol className="mt-3 space-y-2 text-sm">
                {detail.data.history.map(item => (
                  <li key={item.id}>
                    {callTime(item.createdAt)} ·{" "}
                    {item.action.replaceAll("_", " ")}
                    <details>
                      <summary className="cursor-pointer text-xs">
                        Before / after audit state
                      </summary>
                      <pre className="overflow-auto whitespace-pre-wrap text-xs">
                        {JSON.stringify(
                          { before: item.beforeState, after: item.afterState },
                          null,
                          2
                        )}
                      </pre>
                    </details>
                  </li>
                ))}
              </ol>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
function PermittedBriefing({
  agentId,
  close,
}: {
  agentId: number;
  close: () => void;
}) {
  const input = useMemo(() => ({ agentId }), [agentId]);
  const briefing = trpc.agentDevelopment.admin.staffActivity.useQuery(input, {
    retry: false,
  });
  return (
    <section className={panel}>
      <div className="flex justify-between gap-3">
        <h3 className="font-semibold">
          Permitted Academy and engagement briefing
        </h3>
        <Button variant="ghost" onClick={close}>
          Close briefing
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Read-only activity; no booking, customer, finance or unrelated CRM
        notes.
      </p>
      <QueryState query={briefing}>
        {briefing.data && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <p className="text-sm">
                Last sign-in
                <br />
                <strong>{callTime(briefing.data.agent?.lastSignedIn)}</strong>
              </p>
              <p className="text-sm">
                Latest Academy activity
                <br />
                <strong>
                  {callTime(briefing.data.activity.lastActivityAt)}
                </strong>
              </p>
              <p className="text-sm">
                Completed lessons
                <br />
                <strong>{briefing.data.activity.completedLessons}</strong>
              </p>
            </div>
            <ul className="space-y-2 text-sm">
              {briefing.data.enrollments.map(item => (
                <li key={item.id}>
                  {item.courseTitle} · {item.status.replaceAll("_", " ")}
                </li>
              ))}
            </ul>
            <ul className="space-y-2 text-sm">
              {briefing.data.actions.map(item => (
                <li key={item.id}>
                  Action: {item.title} · {item.status.replaceAll("_", " ")} ·
                  due {callTime(item.dueAt)}
                </li>
              ))}
            </ul>
          </>
        )}
      </QueryState>
    </section>
  );
}
