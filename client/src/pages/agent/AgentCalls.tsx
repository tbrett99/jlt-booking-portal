import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { STAFF_CALL_REASONS } from "@shared/staff-calls";
import {
  CallCard,
  callTime,
  control,
  Field,
  localDay,
  localRange,
  localZone,
  MeetingLink,
  Notice,
  panel,
  QueryState,
  reasonLabel,
  shiftLocalDay,
} from "@/components/staff-calls/CallUI";
export default function AgentCalls() {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Checking your appointments…</p>;
  if (
    !user ||
    user.role !== "agent" ||
    !user.isActive ||
    user.mustChangePassword ||
    user.portalStatus !== "active"
  )
    return (
      <Notice title="Appointments unavailable">
        An active agent account is required.
      </Notice>
    );
  return <OwnAppointments key={user.id} actorId={user.id} />;
}
function OwnAppointments({ actorId }: { actorId: number }) {
  const [day, setDay] = useState(() => localDay());
  const [cursor, setCursor] = useState<number | undefined>();
  const [callId, setCallId] = useState<number | null>(null);
  const input = useMemo(
    () => ({ ...localRange(day, 31), limit: 50, cursor }),
    [day, cursor]
  );
  const mine = trpc.staffCalls.mine.useQuery(input, {
    retry: false,
    enabled: !!day,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const checkedActor = useRef<number | null>(null);
  useEffect(() => {
    if (checkedActor.current !== actorId) {
      checkedActor.current = actorId;
      void mine.refetch();
    }
  }, [actorId, mine.refetch]);
  const bound = mine.data?.actorId === actorId;
  if (callId)
    return (
      <OwnCall
        key={callId}
        callId={callId}
        actorId={actorId}
        close={() => setCallId(null)}
      />
    );
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
          Your appointments
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          My support calls
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Calls arranged for you by JLT staff. Times are shown in {localZone()}.
          Contact your host to discuss scheduling changes.
        </p>
      </header>
      <section className={panel}>
        <Field label={`Appointments from (${localZone()})`}>
          <input
            type="date"
            className={`${control} max-w-sm`}
            value={day}
            onChange={event => {
              setDay(event.target.value);
              setCursor(undefined);
            }}
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          31 days from the selected date, including retained cancelled
          appointments.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!day}
            onClick={() => {
              setDay(shiftLocalDay(day, -31));
              setCursor(undefined);
            }}
          >
            Earlier appointments
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setDay(localDay());
              setCursor(undefined);
            }}
          >
            From today
          </Button>
          <Button
            variant="outline"
            disabled={!day}
            onClick={() => {
              setDay(shiftLocalDay(day, 31));
              setCursor(undefined);
            }}
          >
            Later appointments
          </Button>
        </div>
      </section>
      <QueryState
        query={{
          ...mine,
          isLoading: mine.isLoading || (!mine.error && !bound),
        }}
        empty={bound && !mine.data?.items.length}
      >
        <div className="grid gap-4 md:grid-cols-2">
          {bound &&
            mine.data?.items.map(call => (
              <CallCard
                key={call.id}
                call={call}
                reasons={[...STAFF_CALL_REASONS]}
                showCount={false}
                open={() => setCallId(call.id)}
              />
            ))}
        </div>
      </QueryState>
      <div className="flex gap-3">
        {cursor !== undefined && (
          <Button variant="outline" onClick={() => setCursor(undefined)}>
            First appointments page
          </Button>
        )}
        {bound && !mine.error && mine.data?.nextCursor && (
          <Button
            variant="outline"
            disabled={mine.isFetching}
            onClick={() => setCursor(mine.data!.nextCursor!)}
          >
            Next appointments page
          </Button>
        )}
      </div>
    </div>
  );
}
function OwnCall({
  callId,
  actorId,
  close,
}: {
  callId: number;
  actorId: number;
  close: () => void;
}) {
  const input = useMemo(() => ({ callId }), [callId]);
  const query = trpc.staffCalls.get.useQuery(input, {
    retry: false,
    staleTime: 0,
  });
  // Re-check exact recipient even if a cached or regressed DTO includes other records.
  const own = !query.error
    ? query.data?.participants.filter(
        participant => participant.agentId === actorId
      )
    : [];
  const invitation = own?.length === 1 ? own[0] : null;
  return (
    <div className="space-y-5">
      <Button variant="outline" onClick={close}>
        ← Back to my appointments
      </Button>
      <QueryState query={query}>
        {query.data && invitation ? (
          <>
            <header className={panel}>
              <h1 className="text-2xl font-semibold">
                {reasonLabel(query.data.call.reasonKey, [
                  ...STAFF_CALL_REASONS,
                ])}
              </h1>
              <p className="text-sm">
                Host: {query.data.call.hostName || "JLT staff"} ·{" "}
                {query.data.call.format === "group"
                  ? "Private group call"
                  : "1:1 support call"}
              </p>
              <p className="text-sm">
                {callTime(query.data.call.startAt)} –{" "}
                {callTime(query.data.call.endAt)} ({localZone()})
              </p>
              <p className="text-sm">
                Appointment status:{" "}
                {invitation.status === "cancelled"
                  ? "cancelled"
                  : query.data.call.status.replaceAll("_", " ")}
              </p>
              <MeetingLink
                url={
                  invitation.status === "active" &&
                  query.data.call.status === "booked"
                    ? query.data.call.meetingUrl
                    : null
                }
              />
              <p className="text-xs text-muted-foreground">
                Contact your host for cancellation or rescheduling. A pending
                appointment or one awaiting a booking-status check is not
                confirmed.
              </p>
            </header>
            <section className={panel}>
              <h2 className="font-semibold">Your shared call recap</h2>
              <p className="text-xs text-muted-foreground">
                Your invitation: {invitation.status} · attendance:{" "}
                {invitation.attendance.replaceAll("_", " ")}
              </p>
              {invitation.sharedAt && invitation.sharedSummary ? (
                <>
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {invitation.sharedSummary}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Explicitly shared {callTime(invitation.sharedAt)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Your host has not explicitly shared a recap with you.
                </p>
              )}
              <a
                className="text-sm font-semibold text-emerald-800 underline"
                href="/academy/actions"
              >
                My assigned Academy Actions →
              </a>
            </section>
          </>
        ) : (
          <Notice title="Appointment unavailable">
            This record has not been verified for your account.
          </Notice>
        )}
      </QueryState>
    </div>
  );
}
