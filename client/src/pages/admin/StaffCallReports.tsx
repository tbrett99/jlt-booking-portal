import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { STAFF_CALL_REASONS } from "@shared/staff-calls";
import {
  addStaffWorkDays,
  createStaffWorkPeriod,
  staffWorkLondonDate,
} from "@shared/staff-workload-periods";
import {
  staffCallReportRange,
  type StaffCallReportCounts,
  type StaffCallReportInput,
} from "@shared/staff-call-reporting";
import {
  callTime,
  control,
  Field,
  Notice,
  panel,
  QueryState,
  reasonLabel,
} from "@/components/staff-calls/CallUI";
export default function StaffCallReports() {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Checking reporting access…</p>;
  if (
    !user ||
    !["admin", "super_admin"].includes(user.role) ||
    !user.isActive ||
    user.mustChangePassword
  )
    return (
      <Notice title="Administrator reporting access required">
        Engagement or instructor assignments do not grant team reporting.
      </Notice>
    );
  return <AdminCallReports />;
}
function AdminCallReports() {
  const [initial] = useState(() => createStaffWorkPeriod("month"));
  const [from, setFrom] = useState(initial.rangeStart);
  const [through, setThrough] = useState(() =>
    addStaffWorkDays(initial.rangeEnd, -1)
  );
  const [basis, setBasis] =
    useState<StaffCallReportInput["basis"]>("scheduled");
  const [hostId, setHostId] = useState("");
  const [reason, setReason] = useState("");
  const [format, setFormat] = useState<"" | "one_to_one" | "group">("");
  const prepared = useMemo(() => {
    try {
      const input: StaffCallReportInput = {
        rangeStart: from,
        rangeEnd: addStaffWorkDays(through, 1),
        basis,
        ...(hostId ? { hostUserId: Number(hostId) } : {}),
        ...(reason ? { reasonKey: reason } : {}),
        ...(format ? { format } : {}),
      };
      staffCallReportRange(input);
      return { input, error: null };
    } catch (error) {
      return {
        input: { ...initial, basis } as StaffCallReportInput,
        error: error instanceof Error ? error.message : "Invalid date range",
      };
    }
  }, [from, through, basis, hostId, reason, format, initial]);
  const hosts = trpc.staffCalls.hosts.useQuery(undefined, { retry: false });
  const report = trpc.staffCalls.report.useQuery(prepared.input, {
    enabled: !prepared.error,
    retry: false,
    staleTime: 0,
  });
  const visible =
    !prepared.error && !report.error && !report.isFetching
      ? report.data
      : undefined;
  const maxDaily = Math.max(
    1,
    ...(visible?.daily.map(row => row.sessions) ?? [])
  );
  function preset(kind: "day" | "week" | "month" | "year") {
    const range = createStaffWorkPeriod(kind);
    setFrom(range.rangeStart);
    setThrough(addStaffWorkDays(range.rangeEnd, -1));
  }
  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/admin/staff-calls"
          className="text-sm font-semibold text-emerald-800 underline"
        >
          ← Staff call diaries
        </Link>
        <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-emerald-700">
          Administrator insights
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Staff call reports
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Booked sessions are not completed staff productivity. Manual
          participant attendance and provider-confirmed invitations are measured
          separately.
        </p>
      </header>
      <section className={panel}>
        <div className="flex flex-wrap gap-2">
          {(["day", "week", "month", "year"] as const).map(kind => (
            <Button variant="outline" key={kind} onClick={() => preset(kind)}>
              {kind === "day"
                ? "Today"
                : kind === "year"
                  ? "Year to date"
                  : `This ${kind}`}
            </Button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="From date (London, inclusive)">
            <input
              type="date"
              className={control}
              value={from}
              onChange={event => setFrom(event.target.value)}
            />
          </Field>
          <Field label="Through date (London, inclusive)">
            <input
              type="date"
              className={control}
              value={through}
              onChange={event => setThrough(event.target.value)}
            />
          </Field>
          <Field label="Period basis">
            <select
              className={control}
              value={basis}
              onChange={event => setBasis(event.target.value as typeof basis)}
            >
              <option value="booked">
                Booked during · first provider confirmation
              </option>
              <option value="scheduled">
                Scheduled in · current appointment time
              </option>
            </select>
          </Field>
          <Field label="Host filter">
            <select
              className={control}
              value={hostId}
              disabled={!!hosts.error}
              onChange={event => setHostId(event.target.value)}
            >
              <option value="">All authorised hosts</option>
              {!hosts.error &&
                hosts.data?.map(host => (
                  <option key={host.id} value={host.id}>
                    {host.name || `Host #${host.id}`}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Reason filter">
            <select
              className={control}
              value={reason}
              onChange={event => setReason(event.target.value)}
            >
              <option value="">All reasons</option>
              {STAFF_CALL_REASONS.map(item => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Format filter">
            <select
              className={control}
              value={format}
              onChange={event => setFormat(event.target.value as typeof format)}
            >
              <option value="">All formats</option>
              <option value="one_to_one">1:1</option>
              <option value="group">Private group</option>
            </select>
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Date bounds are Europe/London midnight, including BST changes. The API
          end is exclusive; the selected Through date is included. Today in
          London: {staffWorkLondonDate()}.
        </p>
        {hosts.error && (
          <p role="alert" className="text-sm text-red-800">
            Host filters unavailable: {hosts.error.message}
          </p>
        )}
        {prepared.error && (
          <p role="alert" className="text-sm text-red-800">
            {prepared.error}
          </p>
        )}
      </section>
      {!prepared.error && (
        <QueryState query={report}>
          {report.isFetching ? (
            <p role="status">Refreshing report; previous totals are hidden…</p>
          ) : (
            visible && (
              <>
                <p className="text-xs text-muted-foreground">
                  Snapshot as of {callTime(visible.asOf)} · report days
                  Europe/London ·{" "}
                  {visible.basis === "booked"
                    ? "first provider confirmation"
                    : "current scheduled start"}{" "}
                  basis
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric
                    label="Sessions in period"
                    value={visible.counts.sessions}
                    note="One private appointment, not attendee count"
                  />
                  <Metric
                    label="Provider-confirmed sessions"
                    value={visible.counts.bookedSessions}
                    note="First accepted confirmation retained through cancellation"
                  />
                  <Metric
                    label="Participant invitations"
                    value={visible.counts.participantInvitations}
                    note="Invitations, not unique agents"
                  />
                  <Metric
                    label="Manually attended participants"
                    value={visible.counts.attended}
                    note="Not inferred from elapsed time or meeting access"
                  />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <section className={panel}>
                    <h2 className="font-semibold">
                      Session status and recovery
                    </h2>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <dt>Cancelled sessions</dt>
                      <dd>{visible.counts.cancelledSessions}</dd>
                      <dt>Pending sessions</dt>
                      <dd>{visible.counts.pendingSessions}</dd>
                      <dt>Needs recovery</dt>
                      <dd>{visible.counts.recoverySessions}</dd>
                      <dt>Rescheduled sessions</dt>
                      <dd>{visible.counts.rescheduledSessions}</dd>
                      <dt>Sessions with attendance</dt>
                      <dd>{visible.counts.sessionsWithAttendance}</dd>
                    </dl>
                    <p className="text-xs text-muted-foreground">
                      Sessions with attendance have at least one manually marked
                      attended person. Status/history measures can overlap.
                    </p>
                  </section>
                  <section className={panel}>
                    <h2 className="font-semibold">Participant attendance</h2>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <dt>Confirmed invitations</dt>
                      <dd>{visible.counts.bookedParticipants}</dd>
                      <dt>Cancelled invitations</dt>
                      <dd>{visible.counts.cancelledParticipants}</dd>
                      <dt>No-show</dt>
                      <dd>{visible.counts.noShow}</dd>
                      <dt>Excused</dt>
                      <dd>{visible.counts.excused}</dd>
                      <dt>Not held</dt>
                      <dd>{visible.counts.notHeld}</dd>
                      <dt>Awaiting outcome after end</dt>
                      <dd>{visible.counts.awaitingOutcome}</dd>
                      <dt>Attendance rate</dt>
                      <dd>{rate(visible.counts)}</dd>
                    </dl>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Attended ÷ (attended + no-show): {visible.counts.attended}{" "}
                      / {visible.counts.attendanceDenominator}. Excludes
                      unrecorded, future, cancelled-only, excused and not-held
                      invitations. A cancellation does not erase earlier
                      recorded attendance.
                    </p>
                  </section>
                </div>
                <section className={panel}>
                  <h2 className="font-semibold">
                    Sessions by London calendar day
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Accessible horizontal count chart. Each row includes the
                    exact session and invitation totals.
                  </p>
                  <div className="max-h-96 space-y-3 overflow-auto">
                    {visible.daily.map(row => (
                      <div
                        key={row.date}
                        className="grid items-center gap-2 sm:grid-cols-[105px_minmax(0,1fr)_170px]"
                      >
                        <span className="text-xs">{row.date}</span>
                        <div
                          className="h-4 rounded bg-muted"
                          aria-hidden="true"
                        >
                          <div
                            className="h-4 rounded bg-emerald-600"
                            style={{
                              width: `${(row.sessions / maxDaily) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs">
                          {row.sessions} sessions · {row.participantInvitations}{" "}
                          invitations
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
                <Breakdown
                  title="By host"
                  rows={visible.byHost.map(row => ({
                    ...row,
                    label: row.hostName,
                  }))}
                />
                <Breakdown
                  title="By reason"
                  rows={visible.byReason.map(row => ({
                    ...row,
                    label: reasonLabel(row.reasonKey, [...STAFF_CALL_REASONS]),
                  }))}
                />
                <section className={panel}>
                  <h2 className="font-semibold">Reporting boundaries</h2>
                  <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                    {visible.warnings.map(warning => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              </>
            )
          )}
        </QueryState>
      )}
    </div>
  );
}
function rate(counts: StaffCallReportCounts) {
  return counts.attendanceRate === null
    ? "Not measurable (denominator 0)"
    : `${(counts.attendanceRate * 100).toFixed(1)}%`;
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note: string;
}) {
  return (
    <article className={panel}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-semibold">{value}</p>
      <p className="text-xs leading-5 text-muted-foreground">{note}</p>
    </article>
  );
}
function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: (StaffCallReportCounts & { label: string })[];
}) {
  return (
    <section className={panel}>
      <h2 className="font-semibold">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            {title}: sessions, invitations, manual attendance and denominator
          </caption>
          <thead>
            <tr className="border-b">
              {[
                "Category",
                "Sessions",
                "Invitations",
                "Attended",
                "No-show",
                "Denominator",
                "Attendance rate",
              ].map(label => (
                <th className="px-2 py-3" scope="col" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.label}-${index}`} className="border-b">
                <th scope="row" className="px-2 py-3 font-medium">
                  {row.label}
                </th>
                {[
                  row.sessions,
                  row.participantInvitations,
                  row.attended,
                  row.noShow,
                  row.attendanceDenominator,
                  rate(row),
                ].map((value, i) => (
                  <td key={i} className="px-2 py-3">
                    {value}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="p-3 text-muted-foreground">
                  No retained call sessions for this selection.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
