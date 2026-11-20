import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "wouter";
import { RefreshCw, BarChart2 } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type {
  StaffWorkDomain,
  StaffWorkMetric,
  StaffWorkRange,
  StaffWorkloadDrillInput,
  StaffWorkloadReport,
  StaffWorkloadDetails,
} from "@shared/staff-workload";
import {
  addWorkloadDays,
  formatWorkloadDate,
  formatWorkloadTimestamp,
  validateWorkloadCustom,
  workloadCustomRange,
  workloadLondonToday,
  workloadPresetRange,
  type WorkloadPreset,
} from "@/lib/staff-workload-dates";

const DOMAIN_LABELS: Record<StaffWorkDomain, string> = {
  amendment: "Amendments",
  flight: "Flights",
  reimbursement: "Reimbursements",
};
const DOMAINS: StaffWorkDomain[] = ["amendment", "flight", "reimbursement"];
type Scope = "all" | StaffWorkDomain;
type Selection = {
  domain: StaffWorkDomain | null;
  metric: StaffWorkMetric;
  actorId?: number | null;
  actorName?: string;
};
const PRESETS: { value: WorkloadPreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "thisWeek", label: "This week (Mon–Sun)" },
  { value: "lastWeek", label: "Last week" },
  { value: "thisMonth", label: "This month" },
];
const freshOptions = {
  staleTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: "always" as const,
  placeholderData: undefined,
  retry: false,
};
const count = (value: number) => value.toLocaleString("en-GB");
function metricLabel(
  metric: StaffWorkMetric,
  domain?: StaffWorkDomain | null
): string {
  if (metric === "completed")
    return domain === "reimbursement"
      ? "Processed in PTS (scheduled)"
      : "Completed in period";
  return {
    received: "Received in period",
    reprocessed: "Repeat work (included in completed)",
    paid: "Recorded paid",
    rejected: "Rejected in period",
    touched: "Requests touched",
    outstanding: "Outstanding now",
    waiting: "Waiting now",
  }[metric];
}
function CountButton({
  value,
  label,
  onClick,
}: {
  value: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="rounded px-2 py-1 font-semibold tabular-nums text-[#1a8a78] underline decoration-dotted underline-offset-4 hover:bg-[#70FFE8]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {count(value)}
    </button>
  );
}
function AsOf({ value }: { value: string }) {
  return (
    <time dateTime={value}>
      {formatWorkloadTimestamp(value)} · Europe/London
    </time>
  );
}

/** Mounted inside the existing admin dashboard shell. No financial mutation hooks. */
export default function StaffWorkloadReport() {
  // Read current identity directly; useAuth also mounts logout mutations unnecessarily here.
  const currentUser = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const allowed =
    !currentUser.isLoading &&
    !currentUser.error &&
    currentUser.data?.role === "super_admin";
  const [preset, setPreset] = useState<WorkloadPreset | "custom">("thisWeek");
  const [range, setRange] = useState<StaffWorkRange>(() =>
    workloadPresetRange("thisWeek")
  );
  const [scope, setScope] = useState<Scope>("all");
  const [from, setFrom] = useState(() => range.rangeStart);
  const [to, setTo] = useState(() => addWorkloadDays(range.rangeEnd, -1));
  const [validation, setValidation] = useState<string | null>(null);
  const today = workloadLondonToday();
  if (currentUser.isLoading) return <p role="status">Checking access…</p>;
  if (!allowed)
    return (
      <p role="alert">
        Workload &amp; Productivity is available to Super Admins only.
      </p>
    );
  function selectPreset(value: WorkloadPreset) {
    const next = workloadPresetRange(value, today);
    setPreset(value);
    setRange(next);
    setFrom(next.rangeStart);
    setTo(addWorkloadDays(next.rangeEnd, -1));
    setValidation(null);
  }
  function apply() {
    const error = validateWorkloadCustom(from, to, today);
    setValidation(error);
    if (!error) {
      setPreset("custom");
      setRange(workloadCustomRange(from, to, today));
    }
  }
  const draftChanged =
    from !== range.rangeStart || to !== addWorkloadDays(range.rangeEnd, -1);
  return (
    <section
      className="min-w-0 space-y-5"
      aria-label="Workload & Productivity report"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <BarChart2 size={20} className="text-[#1a8a78]" />
            Workload &amp; Productivity
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Request intake, recorded completions and the current queue. Not a
            staffing-hours estimate or staff ranking.
          </p>
        </div>
        <div
          role="group"
          aria-label="Select work type"
          className="flex flex-wrap gap-1 rounded-lg bg-muted p-1"
        >
          {(["all", ...DOMAINS] as Scope[]).map(value => (
            <Button
              key={value}
              size="sm"
              variant={scope === value ? "default" : "ghost"}
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
              className={
                scope === value
                  ? "bg-[#70FFE8] text-slate-900 hover:bg-[#70FFE8]/80"
                  : ""
              }
            >
              {value === "all" ? "All" : DOMAIN_LABELS[value]}
            </Button>
          ))}
        </div>
      </div>
      <div className="rounded-xl border p-4 space-y-3">
        <div
          role="group"
          aria-label="Select workload period"
          className="flex flex-wrap gap-2"
        >
          {PRESETS.map(item => (
            <Button
              key={item.value}
              size="sm"
              variant={preset === item.value ? "secondary" : "outline"}
              aria-pressed={preset === item.value}
              onClick={() => selectPreset(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <form
          onSubmit={event => {
            event.preventDefault();
            apply();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label
            className="grid gap-1 text-xs font-medium"
            htmlFor="workload-from"
          >
            From
            <input
              id="workload-from"
              type="date"
              value={from}
              max={today}
              onChange={event => {
                setFrom(event.target.value);
                setValidation(null);
              }}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            />
          </label>
          <label
            className="grid gap-1 text-xs font-medium"
            htmlFor="workload-to"
          >
            To (inclusive)
            <input
              id="workload-to"
              type="date"
              value={to}
              max={today}
              onChange={event => {
                setTo(event.target.value);
                setValidation(null);
              }}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            />
          </label>
          <Button size="sm" type="submit">
            Apply custom dates
          </Button>
          <p className="text-xs text-muted-foreground pb-1">
            Up to 366 days · Europe/London
            {draftChanged ? " · Draft dates not applied" : ""}
          </p>
        </form>
        {validation && (
          <p role="alert" className="text-sm text-rose-700">
            {validation}
          </p>
        )}
        <p className="text-sm font-medium" aria-live="polite">
          Reporting {formatWorkloadDate(range.rangeStart)} –{" "}
          {formatWorkloadDate(addWorkloadDays(range.rangeEnd, -1))} (inclusive)
          {preset === "thisWeek" || preset === "thisMonth"
            ? " · So far, through today"
            : ""}
        </p>
      </div>
      <ReportScope
        key={`${range.rangeStart}/${range.rangeEnd}/${scope}`}
        range={range}
        scope={scope}
      />
    </section>
  );
}

function ReportScope({
  range,
  scope,
}: {
  range: StaffWorkRange;
  scope: Scope;
}) {
  const query = trpc.superAdmin.workloadSummary.useQuery(range, freshOptions);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  async function refresh() {
    setSelection(null);
    setRefreshing(true);
    setRefreshError(false);
    try {
      const result = await query.refetch({ throwOnError: true });
      if (result.error) setRefreshError(true);
    } catch {
      setRefreshError(true);
    } finally {
      setRefreshing(false);
    }
  }
  const busy = query.isLoading || query.isFetching || refreshing;
  const failed = Boolean(query.error) || refreshError;
  const data: StaffWorkloadReport | undefined =
    !busy &&
    !failed &&
    !query.isPlaceholderData &&
    query.data?.rangeStart === range.rangeStart &&
    query.data?.rangeEnd === range.rangeEnd
      ? query.data
      : undefined;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {data ? (
            <>
              Current queue as of <AsOf value={data.asOf} />
            </>
          ) : (
            "Counts withheld until a fresh report is available."
          )}
        </span>
        <Button size="sm" variant="outline" onClick={refresh} disabled={busy}>
          <RefreshCw size={14} className="mr-2" />
          {failed ? "Retry report" : "Refresh report"}
        </Button>
      </div>
      {failed ? (
        <p
          role="alert"
          className="rounded-lg border border-rose-200 p-4 text-sm text-rose-700"
        >
          Unable to load workload report. Counts are unavailable, not zero.
          Please retry.
        </p>
      ) : !data ? (
        <p
          role="status"
          className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground"
        >
          Loading fresh report… Counts, chart and staff rows are withheld.
        </p>
      ) : (
        <>
          <Coverage report={data} />
          <SummaryContent report={data} scope={scope} select={setSelection} />
          {selection && (
            <RequestDialog
              key={`${selection.domain}/${selection.metric}/${selection.actorId}`}
              selection={selection}
              range={range}
              onClose={() => setSelection(null)}
              onDomain={domain => setSelection({ ...selection, domain })}
            />
          )}
        </>
      )}
    </div>
  );
}

function Coverage({ report }: { report: StaffWorkloadReport }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
      <details>
        <summary className="cursor-pointer font-medium text-foreground">
          Historical coverage · view limits and earliest recorded actions
        </summary>
        <div className="mt-3 space-y-3">
          <p>
            Received uses request intake dates; completed uses recorded action
            dates and can include older intake. These are not an opening/closing
            historical backlog. Unknown dates or actors are not invented.
            Earliest recorded action is not the first-ever request.
          </p>
          {!report.historyTrackingReady && (
            <p className="font-medium text-amber-800">
              History tracking update awaiting setup. Existing historical
              records remain usable; newer history may be incomplete.
            </p>
          )}
          {report.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
          {report.coverage.map(item => (
            <div key={item.domain}>
              <p className="font-medium text-foreground">
                {DOMAIN_LABELS[item.domain]} · Earliest recorded action:{" "}
                {formatWorkloadTimestamp(item.earliestRecordedAction)}
              </p>
              <p>
                {count(item.unknownCompletionDate)} completion dates unknown ·{" "}
                {count(item.unknownCompletionActor)} completion actors unknown
              </p>
              {item.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </div>
          ))}
        </div>
      </details>
      {!report.historyTrackingReady && (
        <p className="mt-1 text-amber-800">
          History tracking update awaiting setup; existing historical report is
          still usable.
        </p>
      )}
    </div>
  );
}

function SummaryContent({
  report,
  scope,
  select,
}: {
  report: StaffWorkloadReport;
  scope: Scope;
  select: (selection: Selection) => void;
}) {
  const summaries = report.summaries.filter(
    item => scope === "all" || item.domain === scope
  );
  const sum = (metric: "received" | "completed" | "outstanding" | "waiting") =>
    summaries.reduce((total, item) => total + item[metric], 0);
  const metrics = ["received", "completed", "outstanding", "waiting"] as const;
  return (
    <>
      <div
        aria-label="Workload summary"
        className="grid grid-cols-2 gap-3 xl:grid-cols-4"
      >
        {metrics.map(metric => (
          <div
            key={metric}
            className="rounded-xl border border-l-4 border-l-[#70FFE8] px-4 py-3"
          >
            <p className="text-xs font-medium text-muted-foreground">
              {metricLabel(metric, scope === "all" ? null : scope)}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {count(sum(metric))}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {metric === "received" ? (
                "Requests received in selected dates"
              ) : metric === "completed" ? (
                "Includes requests received before this period"
              ) : (
                <>
                  Current queue · <AsOf value={report.asOf} />
                </>
              )}
            </p>
          </div>
        ))}
      </div>
      <section className="space-y-2" aria-labelledby="workload-breakdown-title">
        <h3 id="workload-breakdown-title" className="text-base font-semibold">
          Work type breakdown
        </h3>
        <p className="text-xs text-muted-foreground">
          Click a count to view matching requests. Flight completion counts
          requests, not tickets; a combined request counts once. Reimbursements
          completed means processed in PTS (scheduled). Recorded paid is
          separate and is not confirmation of bank settlement.
        </p>
        <div className="overflow-x-auto rounded-xl border">
          <Table className="min-w-[920px]" id="workload-breakdown">
            <TableHeader>
              <TableRow>
                <TableHead>Work type</TableHead>
                <TableHead>Received in period</TableHead>
                <TableHead>Completed / processed in period</TableHead>
                <TableHead>Outstanding now</TableHead>
                <TableHead>Waiting now</TableHead>
                <TableHead>
                  Repeat work
                  <br />
                  (included in completed)
                </TableHead>
                <TableHead>Rejected in period</TableHead>
                <TableHead>Recorded paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    No work type data returned for this scope.
                  </TableCell>
                </TableRow>
              ) : (
                summaries.map(item => (
                  <TableRow key={item.domain}>
                    <TableCell className="font-medium">
                      {DOMAIN_LABELS[item.domain]}
                    </TableCell>
                    {(
                      [
                        "received",
                        "completed",
                        "outstanding",
                        "waiting",
                        "reprocessed",
                        "rejected",
                        "paid",
                      ] as const
                    ).map(metric => (
                      <TableCell key={metric}>
                        {metric === "paid" &&
                        item.domain !== "reimbursement" ? (
                          <span className="text-xs text-muted-foreground">
                            Not applicable
                          </span>
                        ) : (
                          <>
                            <CountButton
                              value={item[metric]}
                              label={`${DOMAIN_LABELS[item.domain]}: ${metricLabel(metric, item.domain)}`}
                              onClick={() =>
                                select({ domain: item.domain, metric })
                              }
                            />
                            {metric === "completed" &&
                              item.domain === "reimbursement" && (
                                <p className="text-[11px] text-muted-foreground">
                                  Processed in PTS (scheduled)
                                </p>
                              )}
                          </>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Repeat work is a subset of completed requests, not an additional
          total. Rejections are shown separately. Waiting may overlap
          outstanding; do not add queue counts together.
        </p>
      </section>
      <section aria-labelledby="workload-queue-title" className="space-y-2">
        <h3 id="workload-queue-title" className="text-base font-semibold">
          Current queue health
        </h3>
        <p className="text-xs text-muted-foreground">
          As of <AsOf value={report.asOf} /> · Across all intake dates, not a
          historical queue snapshot.
        </p>
        <div className="overflow-x-auto rounded-xl border">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>Work type</TableHead>
                <TableHead>Unassigned now</TableHead>
                <TableHead>Urgent now</TableHead>
                <TableHead>Overdue follow-ups now</TableHead>
                <TableHead>Oldest outstanding</TableHead>
                <TableHead>Median turnaround</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.map(item => (
                <TableRow key={item.domain}>
                  <TableCell className="font-medium">
                    {DOMAIN_LABELS[item.domain]}
                  </TableCell>
                  <TableCell>
                    {item.unassigned === null
                      ? "Not tracked"
                      : count(item.unassigned)}
                  </TableCell>
                  <TableCell>{count(item.urgent)}</TableCell>
                  <TableCell>{count(item.overdueFollowUps)}</TableCell>
                  <TableCell>
                    {item.oldestDays === null
                      ? "Not available"
                      : `${count(item.oldestDays)} days`}
                  </TableCell>
                  <TableCell>
                    {item.medianTurnaroundHours === null
                      ? "Not available"
                      : `${item.medianTurnaroundHours.toLocaleString("en-GB", { maximumFractionDigits: 1 })} hours`}
                    <p className="text-[11px] text-muted-foreground">
                      {count(item.turnaroundSampleCount)} dated completion
                      samples
                    </p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Turnaround is elapsed request-to-action time where dates are recorded,
          not hours worked or staff availability.
        </p>
      </section>
      <section
        aria-labelledby="workload-daily-title"
        className="rounded-xl border p-4 space-y-2"
      >
        <h3 id="workload-daily-title" className="text-base font-semibold">
          Daily received vs completed · All work types
        </h3>
        <p className="text-xs text-muted-foreground">
          Combined server-recorded daily totals; this chart does not change with
          the work type filter. Completions include older intake; repeat work is
          already included.
        </p>
        {report.daily.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No daily activity returned for this period.
          </p>
        ) : (
          <>
            <div
              className="h-64 w-full min-w-0"
              role="img"
              aria-label="Daily received and completed request counts, all work types"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={report.daily}
                  margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={value =>
                      formatWorkloadDate(String(value)).replace(/ \d{4}$/, "")
                    }
                    minTickGap={30}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis allowDecimals={false} width={35} />
                  <Tooltip
                    labelFormatter={value => formatWorkloadDate(String(value))}
                  />
                  <Legend />
                  <Line
                    type="linear"
                    dataKey="received"
                    name="Received"
                    stroke="#1a8a78"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="linear"
                    dataKey="completed"
                    name="Completed / processed in PTS"
                    stroke="#64748b"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer">
                View daily counts as a table
              </summary>
              <div className="max-h-64 overflow-auto mt-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date (London)</TableHead>
                      <TableHead>Received</TableHead>
                      <TableHead>Completed / processed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.daily.map(day => (
                      <TableRow key={day.date}>
                        <TableCell>{formatWorkloadDate(day.date)}</TableCell>
                        <TableCell>{count(day.received)}</TableCell>
                        <TableCell>{count(day.completed)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          </>
        )}
      </section>
      <section aria-labelledby="workload-staff-title" className="space-y-2">
        <h3 id="workload-staff-title" className="text-base font-semibold">
          Staff recorded activity · All work types
        </h3>
        <p className="text-xs text-muted-foreground">
          Selected period; independent of the work type filter. Completed
          requests are credited once per work type to the first recorded
          completion actor in the period. Repeat-work actor can differ. Unknown
          attribution is retained; these counts are not a staff score. Requests
          touched includes recorded work such as queries, chases and assignments;
          several staff can touch the same request, so these counts are not additive.
        </p>
        <div className="overflow-x-auto rounded-xl border">
          <Table className="min-w-[860px]" id="workload-staff">
            <TableHeader>
              <TableRow>
                <TableHead>Staff member</TableHead>
                <TableHead>Amendments completed</TableHead>
                <TableHead>
                  Flights completed
                  <br />
                  (requests, not tickets)
                </TableHead>
                <TableHead>
                  Reimbursements
                  <br />
                  Processed in PTS (scheduled)
                </TableHead>
                <TableHead>
                  Repeat work
                  <br />
                  (included in completed)
                </TableHead>
                <TableHead>Requests touched</TableHead>
                <TableHead>
                  Recorded paid
                  <br />
                  (reimbursements)
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.staff.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    No recorded staff activity in this period. This does not
                    establish that no work occurred.
                  </TableCell>
                </TableRow>
              ) : (
                report.staff.map(row => {
                  const name =
                    row.actorId === null
                      ? `${row.actorName || "Unknown actor"} (attribution unknown)`
                      : row.actorName;
                  const open = (
                    domain: StaffWorkDomain | null,
                    metric: StaffWorkMetric
                  ) =>
                    select({
                      domain,
                      metric,
                      actorId: row.actorId,
                      actorName: name,
                    });
                  return (
                    <TableRow key={row.actorId ?? "unknown"}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell>
                        <CountButton
                          value={row.amendmentsCompleted}
                          label={`${name}: Amendments completed`}
                          onClick={() => open("amendment", "completed")}
                        />
                      </TableCell>
                      <TableCell>
                        <CountButton
                          value={row.flightsCompleted}
                          label={`${name}: Flights completed`}
                          onClick={() => open("flight", "completed")}
                        />
                      </TableCell>
                      <TableCell>
                        <CountButton
                          value={row.reimbursementsProcessed}
                          label={`${name}: Processed in PTS (scheduled)`}
                          onClick={() => open("reimbursement", "completed")}
                        />
                      </TableCell>
                      <TableCell>
                        <CountButton
                          value={row.reprocessed}
                          label={`${name}: Repeat work across all work types`}
                          onClick={() => open(null, "reprocessed")}
                        />
                      </TableCell>
                      <TableCell>
                        <CountButton
                          value={row.touched}
                          label={`${name}: Requests touched across all work types`}
                          onClick={() => open(null, "touched")}
                        />
                      </TableCell>
                      <TableCell>
                        <CountButton
                          value={row.recordedPaid}
                          label={`${name}: Recorded paid`}
                          onClick={() => open("reimbursement", "paid")}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </>
  );
}

function RequestDialog({
  selection,
  range,
  onClose,
  onDomain,
}: {
  selection: Selection;
  range: StaffWorkRange;
  onClose: () => void;
  onDomain: (domain: StaffWorkDomain) => void;
}) {
  const title = `${selection.domain ? DOMAIN_LABELS[selection.domain] + " · " : "All work types · "}${metricLabel(selection.metric, selection.domain)}${selection.actorName ? " · " + selection.actorName : ""}`;
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {selection.metric === "outstanding" ||
            selection.metric === "waiting"
              ? "Current working queue across all intake dates; it can change after the report is loaded."
              : `${formatWorkloadDate(range.rangeStart)} – ${formatWorkloadDate(addWorkloadDays(range.rangeEnd, -1))}, inclusive. Received and action dates are different measures.`}{" "}
            {selection.metric === "paid"
              ? "Recorded paid is not confirmation of bank settlement."
              : ""}
          </DialogDescription>
        </DialogHeader>
        {selection.domain === null ? (
          <div className="space-y-3">
            <p className="text-sm">
              The staff count covers all work types. Choose a work type to view
              its matching requests.
            </p>
            <div className="flex flex-wrap gap-2">
              {DOMAINS.map(domain => (
                <Button
                  key={domain}
                  variant="outline"
                  onClick={() => onDomain(domain)}
                >
                  {DOMAIN_LABELS[domain]}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <RequestPage
            key={selection.domain}
            input={{
              ...range,
              domain: selection.domain,
              metric: selection.metric,
              ...(selection.actorId !== undefined
                ? { actorId: selection.actorId }
                : {}),
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RequestPage({
  input,
}: {
  input: Omit<StaffWorkloadDrillInput, "page" | "pageSize">;
}) {
  const [page, setPage] = useState(1);
  // Keying the page remounts its observer: no previous-page rows while a new input loads.
  return (
    <DetailsPage
      key={page}
      input={{ ...input, page, pageSize: 25 }}
      onPage={setPage}
    />
  );
}

function DetailsPage({
  input,
  onPage,
}: {
  input: StaffWorkloadDrillInput;
  onPage: (page: number) => void;
}) {
  const query = trpc.superAdmin.workloadDetails.useQuery(input, freshOptions);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  async function refresh() {
    setRefreshing(true);
    setRefreshError(false);
    try {
      const result = await query.refetch({ throwOnError: true });
      if (result.error) setRefreshError(true);
    } catch {
      setRefreshError(true);
    } finally {
      setRefreshing(false);
    }
  }
  const busy = query.isLoading || query.isFetching || refreshing;
  const failed = Boolean(query.error) || refreshError;
  const data: StaffWorkloadDetails | undefined =
    !busy &&
    !failed &&
    !query.isPlaceholderData &&
    query.data?.page === input.page &&
    query.data?.pageSize === input.pageSize
      ? query.data
      : undefined;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-between items-center gap-2 text-xs text-muted-foreground">
        <span>
          {data ? (
            <>
              {count(data.total)} matching requests · Fresh detail as of{" "}
              <AsOf value={data.asOf} />
            </>
          ) : (
            "Request rows withheld until fresh details are available."
          )}
        </span>
        <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>
          {failed ? "Retry requests" : "Refresh requests"}
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-rose-700">
          Unable to load requests. Previous rows and totals are withheld. Please
          retry.
        </p>
      ) : !data ? (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          Loading fresh requests…
        </p>
      ) : (
        <>
          {(input.metric === "outstanding" || input.metric === "waiting") && (
            <p className="text-xs text-muted-foreground">
              The current queue may have changed since the summary. Use the
              fresh total above; it need not match the earlier count.
            </p>
          )}
          {data.warnings.map((warning, index) => (
            <p key={index} className="text-xs text-muted-foreground">
              {warning}
            </p>
          ))}
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[820px]" id="workload-requests">
              <TableHeader>
                <TableRow>
                  <TableHead>Request / booking</TableHead>
                  <TableHead>Received (London)</TableHead>
                  <TableHead>Action (London)</TableHead>
                  <TableHead>Recorded actor / action</TableHead>
                  <TableHead>Current status</TableHead>
                  <TableHead>Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center">
                      No matching requests on this page.
                      {data.total === 0
                        ? " No recorded matches for these filters."
                        : " The working queue may have changed; return to the first page or refresh."}
                    </TableCell>
                  </TableRow>
                ) : (
                  data.rows.map((row, index) => (
                    <TableRow key={`${row.domain}/${row.requestId}/${index}`}>
                      <TableCell className="min-w-48">
                        <p className="font-medium">
                          {!row.isDeleted &&
                          row.bookingId !== null &&
                          Number.isInteger(row.bookingId) &&
                          row.bookingId > 0 ? (
                            <Link
                              className="text-[#1a8a78] underline"
                              href={`/bookings/${row.bookingId}`}
                            >
                              {row.title}
                            </Link>
                          ) : (
                            row.title
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Request #{row.requestId} ·{" "}
                          {row.reference || "Reference not recorded"}
                        </p>
                        {row.clientName && (
                          <p className="text-xs text-muted-foreground">
                            {row.clientName}
                          </p>
                        )}
                        {row.isDeleted && (
                          <Badge variant="outline" className="mt-1">
                            Deleted context · link unavailable
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatWorkloadTimestamp(row.receivedAt)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatWorkloadTimestamp(row.actionAt)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <p>
                          {row.actorName || "Unknown actor"}
                          {row.actorId === null ? " · attribution unknown" : ""}
                        </p>
                        <p className="text-muted-foreground">
                          {row.eventLabel}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.currentStatus}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {row.evidence === "recorded_history"
                            ? "Recorded history"
                            : "Legacy record"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Page {data.page} of {pages} · {data.pageSize} requests per page
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={data.page <= 1}
                onClick={() => onPage(data.page - 1)}
              >
                Previous requests
              </Button>
              {data.page > pages && (
                <Button size="sm" variant="outline" onClick={() => onPage(1)}>
                  First page
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={data.page >= pages}
                onClick={() => onPage(data.page + 1)}
              >
                Next requests
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
