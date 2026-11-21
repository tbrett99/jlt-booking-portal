import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { CalendarDays } from "lucide-react";
import BookCall from "@/components/staff-calls/BookCall";
import CallDetail from "@/components/staff-calls/CallDetail";
import {
  CallCard,
  control,
  Field,
  localDay,
  localRange,
  localZone,
  Notice,
  panel,
  QueryState,
  shiftLocalDay,
  type CallOutputs,
  type CallSummary,
} from "@/components/staff-calls/CallUI";

export function positiveQueryId(name: string) {
  const value = new URLSearchParams(window.location.search).get(name);
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}
/** Mounted in the parent-owned PortalLayout / StaffWorkspace; no second shell or role switch. */
export default function StaffCalls() {
  const { user, loading } = useAuth();
  const eligible =
    !!user &&
    ["admin", "super_admin", "agent"].includes(user.role) &&
    user.isActive &&
    !user.mustChangePassword &&
    (user.role !== "agent" || user.portalStatus === "active");
  const context = trpc.staffCalls.context.useQuery(undefined, {
    enabled: eligible,
    retry: false,
    staleTime: 0,
  });
  const observedActor = useRef<number | null>(null);
  useEffect(() => {
    if (!eligible || !user) {
      observedActor.current = null;
      return;
    }
    if (observedActor.current !== user.id) {
      observedActor.current = user.id;
      void context.refetch();
    }
  }, [eligible, user?.id, context.refetch]);
  if (loading || (eligible && context.isLoading))
    return <p role="status">Checking call workspace authority…</p>;
  if (!eligible)
    return (
      <Notice title="Call workspace unavailable">
        An active authorised account is required.
      </Notice>
    );
  if (context.error) return <QueryState query={context}>{null}</QueryState>;
  if (context.data?.actorId !== user!.id)
    return <p role="status">Checking this account’s call workspace…</p>;
  if (!context.data?.canManage)
    return (
      <Notice title="Call management assignment required">
        Only administrators or actively assigned engagement staff can manage
        diaries. Instructor-only access does not grant this workspace.{" "}
        <Link className="underline" href="/my-calls">
          My own appointments →
        </Link>
      </Notice>
    );
  return (
    <CallWorkspace
      key={`${context.data.actorId}:${context.data.canViewTeam ? "team" : "own"}`}
      context={context.data}
    />
  );
}
function CallWorkspace({ context }: { context: CallOutputs["context"] }) {
  const [day, setDay] = useState(() => localDay());
  const [view, setView] = useState<"day" | "week">("day");
  const [selectedHosts, setSelectedHosts] = useState<number[]>(
    context.canViewTeam ? [] : [context.actorId]
  );
  const [cursor, setCursor] = useState<number | undefined>();
  const [callId, setCallId] = useState<number | null>(
    () => positiveQueryId("callId") ?? null
  );
  const [initialAgentId] = useState(() => positiveQueryId("agentId"));
  const [booking, setBooking] = useState(() => !!positiveQueryId("agentId"));
  const [focus, setFocus] = useState<"all" | "notes" | "rebooking">("all");
  const hosts = trpc.staffCalls.hosts.useQuery(undefined, { retry: false });
  const range = useMemo(
    () => localRange(day, view === "week" ? 7 : 1),
    [day, view]
  );
  const input = useMemo(
    () => ({
      ...range,
      ...(selectedHosts.length === 1 ? { hostUserId: selectedHosts[0] } : {}),
      limit: 25,
      cursor,
    }),
    [range, selectedHosts, cursor]
  );
  const diary = trpc.staffCalls.diary.useQuery(input, {
    enabled: !!day,
    retry: false,
    staleTime: 0,
  });
  const shownHosts = (hosts.error ? [] : (hosts.data ?? [])).filter(host =>
    context.canViewTeam
      ? selectedHosts.length === 0 || selectedHosts.includes(host.id)
      : host.id === context.actorId
  );
  function refresh() {
    void diary.refetch();
  }
  if (callId && !booking)
    return (
      <CallDetail
        key={callId}
        callId={callId}
        context={context}
        close={() => setCallId(null)}
        refresh={refresh}
      />
    );
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-emerald-700">
            <CalendarDays size={17} />
            {context.canViewTeam ? "Team diaries" : "Your own diary"}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Staff calls
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Private support appointments and deliberate follow-up. Times shown
            in {localZone()}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setBooking(true)}>Book a call</Button>
          {context.canViewTeam && (
            <Link
              href="/admin/staff-call-reports"
              className="text-sm font-semibold underline"
            >
              Call reports
            </Link>
          )}
        </div>
      </header>
      {!context.provider.connected && (
        <Notice title="Your host calendar is unconnected">
          <p>
            {context.provider.message} No available times or confirmed bookings
            are being implied.
          </p>
          <p className="mt-2">
            Existing call records can still be reviewed.{" "}
            {context.canViewTeam
              ? "Other selected hosts are verified independently when requesting their actual slots."
              : "Your host must be individually configured and verified before booking."}
          </p>
        </Notice>
      )}
      {booking && (
        <QueryState query={hosts}>
          <BookCall
            context={context}
            hosts={hosts.data ?? []}
            initialAgentId={initialAgentId}
            initialHostId={
              selectedHosts.length === 1 ? selectedHosts[0] : undefined
            }
            onBooked={id => {
              refresh();
              setCallId(id);
            }}
            close={() => setBooking(false)}
          />
        </QueryState>
      )}
      <section className={panel}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={`Diary date (${localZone()})`}>
            <input
              className={control}
              type="date"
              value={day}
              onChange={event => {
                setDay(event.target.value);
                setCursor(undefined);
              }}
            />
          </Field>
          <Field label="Diary view">
            <select
              className={control}
              value={view}
              onChange={event => {
                setView(event.target.value as typeof view);
                setCursor(undefined);
              }}
            >
              <option value="day">Day</option>
              <option value="week">Week · seven days from selected date</option>
            </select>
          </Field>
          <Field label="Call focus">
            <select
              className={control}
              value={focus}
              onChange={event => setFocus(event.target.value as typeof focus)}
            >
              <option value="all">All calls</option>
              <option value="notes">Awaiting call notes</option>
              <option value="rebooking">Needs rebooking / recovery</option>
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!day}
            onClick={() => {
              setDay(shiftLocalDay(day, view === "week" ? -7 : -1));
              setCursor(undefined);
            }}
          >
            Previous {view}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setDay(localDay());
              setCursor(undefined);
            }}
          >
            Today's calls
          </Button>
          <Button
            variant="outline"
            disabled={!day}
            onClick={() => {
              setDay(shiftLocalDay(day, view === "week" ? 7 : 1));
              setCursor(undefined);
            }}
          >
            Next {view}
          </Button>
        </div>
        {context.canViewTeam && (
          <QueryState query={hosts}>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">
                Select authorised hosts · none selected means all team diaries
              </legend>
              <div className="flex flex-wrap gap-4">
                {hosts.data?.map(host => (
                  <label
                    key={host.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedHosts.includes(host.id)}
                      onChange={event => {
                        setSelectedHosts(
                          event.target.checked
                            ? [...selectedHosts, host.id]
                            : selectedHosts.filter(id => id !== host.id)
                        );
                        setCursor(undefined);
                      }}
                    />
                    {host.name || `Host #${host.id}`}
                  </label>
                ))}
              </div>
            </fieldset>
          </QueryState>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          Connected-calendar busy-time entitlement is not enabled in this pilot.
          Other busy time and working-hours coverage are unavailable, not empty.
          Only provider-verified slot selection can establish availability;
          private external calendar titles are never loaded.
        </p>
      </section>
      <QueryState query={diary} empty={!diary.data?.items.length}>
        <QueryState query={hosts}>
          <div
            className={`grid gap-4 ${shownHosts.length > 1 ? "lg:grid-cols-2 xl:grid-cols-3" : ""}`}
          >
            {shownHosts.map(host => (
              <section key={host.id} className="min-w-0 space-y-3">
                <h2 className="border-b pb-2 font-semibold">
                  {host.name || `Host #${host.id}`}
                  {host.id === context.actorId ? " · you" : ""}
                </h2>
                {diary.data?.items
                  .filter(call => call.hostUserId === host.id)
                  .map(call => (
                    <FocusedCall
                      key={call.id}
                      call={call}
                      context={context}
                      focus={focus}
                      open={() => {
                        setCallId(call.id);
                        setBooking(false);
                      }}
                    />
                  ))}
                {!diary.data?.items.some(
                  call => call.hostUserId === host.id
                ) && (
                  <p className="rounded-xl border p-4 text-sm text-muted-foreground">
                    No matching calls on this page. Availability must still be
                    verified.
                  </p>
                )}
              </section>
            ))}
          </div>
        </QueryState>
      </QueryState>
      <div className="flex flex-wrap items-center gap-3">
        {cursor !== undefined && (
          <Button variant="outline" onClick={() => setCursor(undefined)}>
            First call page
          </Button>
        )}
        {!diary.error && diary.data?.nextCursor && (
          <Button
            variant="outline"
            disabled={diary.isFetching}
            onClick={() => setCursor(diary.data!.nextCursor!)}
          >
            Next call page
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Focus filters apply to the loaded page; browse additional pages for
          all matching calls.
        </p>
      </div>
      {context.canViewTeam && (
        <section className="border-t pt-4 text-sm">
          <Link
            className="font-semibold text-emerald-800 underline"
            href="/admin/calendar"
          >
            Open legacy holidays, rota and events →
          </Link>
          <p className="mt-2 text-xs text-muted-foreground">
            These remain separate. Portal-only leave is not automatically a
            provider booking block.
          </p>
        </section>
      )}
    </div>
  );
}
function FocusedCall({
  call,
  context,
  focus,
  open,
}: {
  call: CallSummary;
  context: CallOutputs["context"];
  focus: "all" | "notes" | "rebooking";
  open: () => void;
}) {
  const inspect = focus !== "all" && +new Date(call.endAt) <= Date.now();
  const input = useMemo(() => ({ callId: call.id }), [call.id]);
  const detail = trpc.staffCalls.get.useQuery(input, { retry: false });
  if (focus !== "all") {
    if (call.status === "needs_recovery" && focus === "rebooking")
      return <CallCard call={call} reasons={context.reasons} open={open} />;
    if (!inspect) return null;
    if (detail.error)
      return (
        <Notice title={`Call #${call.id} focus unavailable`}>
          {detail.error.message}
        </Notice>
      );
    if (detail.isLoading)
      return <p role="status">Checking call #{call.id} outcomes…</p>;
    const matches =
      focus === "notes"
        ? call.status === "booked" &&
          detail.data?.participants.some(
            participant =>
              participant.status === "active" &&
              (!participant.privateNotes?.trim() ||
                participant.attendance === "awaiting")
          )
        : detail.data?.participants.some(
            participant =>
              participant.attendance === "no_show" ||
              participant.outcome === "follow_up_required" ||
              participant.outcome === "no_contact"
          );
    if (!matches) return null;
  }
  return (
    <div>
      <CallCard call={call} reasons={context.reasons} open={open} />
      <p className="mt-2 px-1 text-xs text-muted-foreground">
        {detail.error
          ? "Invited agents unavailable; reopen the call record to retry."
          : detail.isLoading
            ? "Loading invited Portal agents…"
            : `Invited agents: ${detail.data?.participants.map(participant => `${participant.name || "Agent"} #${participant.agentId}${participant.status === "cancelled" ? " (cancelled)" : ""}`).join(", ") || "Not recorded"}`}
      </p>
    </div>
  );
}
