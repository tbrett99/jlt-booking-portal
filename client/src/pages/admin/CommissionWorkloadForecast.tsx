import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarDays, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  addForecastDays,
  defaultCommissionForecastPeriod,
  forecastUtcDate,
  formatForecastCalendarDate,
  parseForecastCalendarDate,
  type CommissionForecastBucket,
  type CommissionForecastFile,
  type CommissionForecastInput,
} from "@shared/commission-workload-forecast";

const PAGE_SIZE = 50;
type Selection =
  | { type: "bucket"; key: string | null }
  | { type: "due_now" | "unscheduled" | "upcoming" };

function rangeError(start: string, end: string): string | null {
  const from = parseForecastCalendarDate(start);
  const to = parseForecastCalendarDate(end);
  if (!from || !to) return "Choose valid start and end dates.";
  if (from > to) return "Start date must be on or before end date.";
  if ((to.getTime() - from.getTime()) / 86_400_000 + 1 > 730)
    return "Choose a range of no more than 730 days (inclusive).";
  return null;
}

function sixMonthPeriod(): CommissionForecastInput {
  const now = new Date();
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 6, 0)
  );
  return {
    startDate: forecastUtcDate(now),
    endDate: forecastUtcDate(end),
    groupBy: "month",
  };
}

function shortDate(value: string): string {
  return (
    parseForecastCalendarDate(value)?.toLocaleDateString("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
    }) ?? "—"
  );
}

function bucketDates(bucket: CommissionForecastBucket): string {
  return `${formatForecastCalendarDate(bucket.startDate)} – ${formatForecastCalendarDate(bucket.endDate)}`;
}

function DateControl({
  label,
  value,
  onChange,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label
        className="text-xs font-medium"
        htmlFor={`forecast-${label.toLowerCase()}`}
      >
        {label}
      </label>
      <Input
        id={`forecast-${label.toLowerCase()}`}
        type="date"
        value={value}
        onChange={event => onChange(event.target.value)}
        aria-invalid={invalid}
        aria-describedby={invalid ? "forecast-range-error" : undefined}
        className="h-9 w-36 text-sm"
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={`Choose ${label.toLowerCase()} date on calendar`}
          >
            <CalendarDays className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            timeZone="UTC"
            weekStartsOn={1}
            selected={parseForecastCalendarDate(value) ?? undefined}
            defaultMonth={parseForecastCalendarDate(value) ?? undefined}
            onSelect={date => onChange(date ? forecastUtcDate(date) : "")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

const unscheduledReasons: Record<
  NonNullable<CommissionForecastFile["unscheduledReason"]>,
  string
> = {
  missing_payment_date: "Missing final supplier payment date",
  invalid_payment_date: "Invalid final supplier payment date",
  missing_departure_date: "Missing departure date for pre-authorised review",
  invalid_departure_date: "Invalid departure date for pre-authorised review",
};

function FileReviewDate({ file }: { file: CommissionForecastFile }) {
  const departure =
    file.departureDate && parseForecastCalendarDate(file.departureDate);
  return (
    <>
      <span>{formatForecastCalendarDate(file.reviewDate)}</span>
      {file.unscheduledReason && (
        <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
          {unscheduledReasons[file.unscheduledReason]}
        </p>
      )}
      {file.preAuthorised && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          Pre-authorised
          {file.reviewDate !== file.finalSupplierPaymentDate && (
            <>
              {" "}
              · later of final supplier payment and departure + 7 days
              {departure &&
                ` (${formatForecastCalendarDate(addForecastDays(file.departureDate!, 7))})`}
            </>
          )}
        </p>
      )}
    </>
  );
}

function FileWarnings({ file }: { file: CommissionForecastFile }) {
  const warnings = [
    file.inContract && "In Contract",
    file.hasOutstandingRefund && "Outstanding refund",
    file.hasOutstandingAmendment && "Outstanding amendment",
    file.hasOutstandingReimbursement && "Outstanding reimbursement",
  ].filter(Boolean);
  return warnings.length ? (
    <div className="space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
      {warnings.map(warning => (
        <p key={String(warning)}>{warning}</p>
      ))}
    </div>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

export default function CommissionWorkloadForecast() {
  // Read auth directly: useAuth also registers a logout mutation, which this page does not need.
  const auth = trpc.auth.me.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const isAdmin =
    auth.data?.role === "admin" || auth.data?.role === "super_admin";
  const [period, setPeriod] = useState<CommissionForecastInput>(() =>
    defaultCommissionForecastPeriod()
  );
  const [draftStart, setDraftStart] = useState(period.startDate);
  const [draftEnd, setDraftEnd] = useState(period.endDate);
  const [selection, setSelection] = useState<Selection>({
    type: "bucket",
    key: null,
  });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const validationError = rangeError(draftStart, draftEnd);
  const appliedError = rangeError(period.startDate, period.endDate);
  // Draft dates never enter a query until Apply. Search, selection and pagination retain this input identity.
  const input = useMemo(
    () => ({
      startDate: period.startDate,
      endDate: period.endDate,
      groupBy: period.groupBy,
    }),
    [period.startDate, period.endDate, period.groupBy]
  );
  const enabled =
    isAdmin && !auth.isLoading && !validationError && !appliedError;
  const forecast = trpc.commissionDue.forecast.useQuery(input, {
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const response = forecast.data;
  const responseMatches =
    response?.period.startDate === input.startDate &&
    response?.period.endDate === input.endDate &&
    response?.period.groupBy === input.groupBy;
  // A cached result is not evidence of current workload while refreshing, after an error or for a different range.
  const ready =
    enabled &&
    responseMatches &&
    !forecast.isLoading &&
    !forecast.isFetching &&
    !forecast.error;
  const data = ready ? response : undefined;
  const buckets = data?.buckets ?? [];
  const maxCount = buckets.length
    ? Math.max(...buckets.map(bucket => bucket.fileCount))
    : 0;
  const minCount = buckets.length
    ? Math.min(...buckets.map(bucket => bucket.fileCount))
    : 0;
  const busiest = buckets.filter(bucket => bucket.fileCount === maxCount);
  const quietest = buckets.filter(bucket => bucket.fileCount === minCount);
  const selectedBucket =
    selection.type === "bucket"
      ? (buckets.find(bucket => bucket.key === selection.key) ??
        busiest[0] ??
        buckets[0])
      : undefined;
  const chartData = buckets.map(bucket => ({
    ...bucket,
    chartLabel: `${shortDate(bucket.startDate)}–${shortDate(bucket.endDate)}`,
  }));
  const files = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-GB");
    return (data?.files ?? [])
      .filter(file => {
        const inSelection =
          selection.type === "bucket"
            ? file.category === "upcoming" &&
              file.bucketKey === selectedBucket?.key
            : selection.type === "upcoming"
              ? file.category === "upcoming" && file.bucketKey !== null
              : file.category === selection.type;
        return (
          inSelection &&
          (!needle ||
            [
              file.clientName,
              file.agentName,
              file.orbitRef,
              file.ptsRef,
              String(file.bookingId),
            ].some(value => value?.toLocaleLowerCase("en-GB").includes(needle)))
        );
      })
      .sort(
        (a, b) =>
          (a.reviewDate ?? "9999").localeCompare(b.reviewDate ?? "9999") ||
          a.bookingId - b.bookingId
      );
  }, [data, selection, selectedBucket?.key, search]);
  const pageCount = Math.max(1, Math.ceil(files.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleFiles = files.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE
  );

  function choose(next: Selection) {
    setSelection(next);
    setPage(0);
  }
  function applyPeriod(next: CommissionForecastInput) {
    if (rangeError(next.startDate, next.endDate)) return;
    setPeriod(previous =>
      previous.startDate === next.startDate &&
      previous.endDate === next.endDate &&
      previous.groupBy === next.groupBy
        ? previous
        : next
    );
    setDraftStart(next.startDate);
    setDraftEnd(next.endDate);
    setPage(0);
  }

  if (auth.isLoading)
    return (
      <div className="p-6 text-sm" role="status">
        Checking access…
      </div>
    );
  if (!isAdmin)
    return (
      <div className="p-6 text-sm" role="alert">
        Commission Due Forecast is available to administrators only.
      </div>
    );

  const selectionTitle =
    selection.type === "bucket"
      ? selectedBucket
        ? bucketDates(selectedBucket)
        : "Selected period"
      : selection.type === "due_now"
        ? "Due now / overdue backlog"
        : selection.type === "unscheduled"
          ? "Unscheduled files"
          : "Future arrivals in range";

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Commission Due Forecast</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Files to check, based on final supplier payment dates — not a
            cashflow or payout forecast.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!enabled || forecast.isFetching || forecast.isLoading}
          onClick={() => void forecast.refetch()}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Refresh
        </Button>
      </header>

      <section
        aria-label="Forecast range"
        className="space-y-2 rounded-lg border p-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => applyPeriod(defaultCommissionForecastPeriod())}
          >
            Next 12 weeks
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => applyPeriod(sixMonthPeriod())}
          >
            Next 6 months
          </Button>
          <div
            className="flex gap-1"
            role="group"
            aria-label="Group forecast periods"
          >
            {(["week", "month"] as const).map(groupBy => (
              <Button
                key={groupBy}
                size="sm"
                variant={period.groupBy === groupBy ? "default" : "outline"}
                aria-pressed={period.groupBy === groupBy}
                onClick={() =>
                  setPeriod(previous =>
                    previous.groupBy === groupBy
                      ? previous
                      : { ...previous, groupBy }
                  )
                }
              >
                {groupBy === "week" ? "Weekly" : "Monthly"}
              </Button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            Weeks run Monday–Sunday.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DateControl
            label="Start"
            value={draftStart}
            onChange={setDraftStart}
            invalid={!!validationError}
          />
          <DateControl
            label="End"
            value={draftEnd}
            onChange={setDraftEnd}
            invalid={!!validationError}
          />
          <Button
            size="sm"
            disabled={!!validationError}
            onClick={() =>
              applyPeriod({
                startDate: draftStart,
                endDate: draftEnd,
                groupBy: period.groupBy,
              })
            }
          >
            Apply
          </Button>
          <span className="text-xs text-muted-foreground">
            Custom range · maximum 730 days inclusive
          </span>
        </div>
        {validationError && (
          <p
            id="forecast-range-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {validationError}
          </p>
        )}
        {!validationError &&
          (draftStart !== period.startDate || draftEnd !== period.endDate) && (
            <p className="text-xs text-muted-foreground">
              Dates not applied. Showing the applied range below; choose Apply
              to update.
            </p>
          )}
      </section>

      {!data ? (
        <div
          className="rounded-lg border p-6 text-sm"
          role={forecast.error ? "alert" : "status"}
        >
          {validationError
            ? "Forecast paused until the date range is valid. Counts are unavailable."
            : forecast.error
              ? "Unable to load forecast. Counts are unavailable; use Refresh to retry."
              : forecast.isFetching || forecast.isLoading
                ? "Refreshing forecast… Counts and files are withheld until the latest result arrives."
                : "Forecast unavailable. Use Refresh to load current counts."}
        </div>
      ) : (
        <>
          <div
            className="grid grid-cols-2 gap-2 lg:grid-cols-4"
            aria-label="Workload summary"
          >
            {(
              [
                {
                  type: "due_now",
                  label: "Due now / overdue backlog",
                  count: data.dueNowCount,
                  detail: "Separate from future arrivals",
                },
                {
                  type: "upcoming",
                  label: "Future arrivals in range",
                  count: data.upcomingCount,
                  detail: "New review dates after today only",
                },
                {
                  type: "unscheduled",
                  label: "Unscheduled",
                  count: data.unscheduledCount,
                  detail: "Missing or invalid dates; not zero workload",
                },
              ] as const
            ).map(summary => (
              <button
                key={summary.type}
                type="button"
                className="rounded-lg border p-3 text-left hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                aria-pressed={selection.type === summary.type}
                aria-controls="forecast-files"
                onClick={() => choose({ type: summary.type })}
              >
                <span className="block text-xs font-medium text-muted-foreground">
                  {summary.label}
                </span>
                <strong className="my-1 block text-2xl tabular-nums">
                  {summary.count}
                </strong>
                <span className="block text-xs text-muted-foreground">
                  {summary.detail}
                </span>
              </button>
            ))}
            <button
              type="button"
              className="rounded-lg border p-3 text-left hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
              disabled={!busiest.length}
              aria-controls="forecast-files"
              onClick={() =>
                busiest[0] && choose({ type: "bucket", key: busiest[0].key })
              }
            >
              <span className="block text-xs font-medium text-muted-foreground">
                Busiest period in selected range
              </span>
              <strong className="my-1 block text-2xl tabular-nums">
                {maxCount}
              </strong>
              <span className="block text-xs text-muted-foreground">
                {busiest[0] ? bucketDates(busiest[0]) : "No periods"}
                {busiest.length > 1 && ` · ${busiest.length} periods tied`}
              </span>
            </button>
          </div>

          <Card>
            <CardContent className="space-y-3 p-3 sm:p-4">
              <div>
                <h2 className="text-sm font-semibold">
                  New files arriving for review
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatForecastCalendarDate(data.period.startDate)} –{" "}
                  {formatForecastCalendarDate(data.period.endDate)} · Counts
                  exclude today and earlier backlog. Period edges are clipped to
                  this range; the current period is remaining arrivals only, not
                  a full-period comparison.
                </p>
              </div>
              <div
                className="h-56 w-full"
                role="img"
                aria-label="Bar chart of new files per period. Use the period buttons below to select files, including zero-count periods."
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 8, right: 8, left: 0, bottom: 12 }}
                    accessibilityLayer
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="chartLabel"
                      tick={{ fontSize: 10 }}
                      minTickGap={24}
                    />
                    <YAxis
                      allowDecimals={false}
                      domain={[0, Math.max(1, maxCount)]}
                      width={32}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      labelFormatter={(_label, payload) => {
                        const bucket = payload?.[0]?.payload as
                          | CommissionForecastBucket
                          | undefined;
                        return bucket ? bucketDates(bucket) : "Period";
                      }}
                      formatter={value => [value, "New files"]}
                    />
                    <Bar
                      dataKey="fileCount"
                      name="New files"
                      isAnimationActive={false}
                      onClick={entry => {
                        if (entry?.key)
                          choose({ type: "bucket", key: entry.key });
                      }}
                    >
                      {chartData.map(bucket => (
                        <Cell
                          key={bucket.key}
                          fill={
                            bucket.key === selectedBucket?.key
                              ? "#0f766e"
                              : "#70d7c8"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div
                className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3"
                role="group"
                aria-label="Select forecast period"
              >
                {buckets.map(bucket => (
                  <button
                    key={bucket.key}
                    type="button"
                    aria-pressed={
                      selection.type === "bucket" &&
                      selectedBucket?.key === bucket.key
                    }
                    aria-controls="forecast-files"
                    onClick={() => choose({ type: "bucket", key: bucket.key })}
                    className="rounded-md border px-3 py-2 text-left text-xs hover:bg-muted/40 aria-pressed:border-teal-700 aria-pressed:bg-teal-50 dark:aria-pressed:bg-teal-950 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="font-medium">{bucketDates(bucket)}</span>
                    <span className="ml-2 font-semibold tabular-nums">
                      {bucket.fileCount} new files
                    </span>
                    {bucket.startDate <= data.today &&
                      bucket.endDate >= data.today && (
                        <span className="mt-0.5 block text-muted-foreground">
                          Remaining period · after{" "}
                          {formatForecastCalendarDate(data.today)}
                        </span>
                      )}
                    {bucket.endDate < data.today && (
                      <span className="mt-0.5 block text-muted-foreground">
                        Past period · no new arrivals
                      </span>
                    )}
                    <span className="mt-0.5 block text-muted-foreground">
                      {bucket.preAuthorisedCount} pre-authorised ·{" "}
                      {bucket.attentionCount} with review warnings
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Quietest periods: {minCount} new files
                {quietest.length > 0 &&
                  ` · ${quietest.slice(0, 3).map(bucketDates).join("; ")}`}
                {quietest.length > 3 && ` · ${quietest.length - 3} more tied`}.
                {minCount === maxCount &&
                  buckets.length > 0 &&
                  " All periods have the same count."}
              </p>
            </CardContent>
          </Card>

          <section
            id="forecast-files"
            aria-label="Selected forecast files"
            className="space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">{selectionTitle}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {files.length} files{search.trim() && " matching search"} · up
                  to 50 per page. Search only filters this table.
                </p>
              </div>
              <Input
                aria-label="Search selected files"
                placeholder="Client, agent, Orbit / PTS ref or booking ID"
                value={search}
                onChange={event => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                className="h-9 w-full sm:max-w-sm"
              />
            </div>
            {selection.type === "due_now" && (
              <Link
                href="/commission-due"
                className="inline-block text-xs font-medium text-teal-700 underline"
              >
                Open original Commission Due queue
              </Link>
            )}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  Files for {selectionTitle}
                </caption>
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    {[
                      "Booking / client",
                      "Agent",
                      "Orbit / PTS",
                      "Final supplier payment",
                      "Review date / reason",
                      "Review warnings",
                    ].map(heading => (
                      <th
                        key={heading}
                        scope="col"
                        className="px-3 py-2 font-medium"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleFiles.map(file => (
                    <tr key={file.bookingId} className="border-b last:border-0">
                      <td className="px-3 py-2 align-top">
                        <Link
                          href={`/bookings/${file.bookingId}`}
                          className="font-medium hover:underline"
                        >
                          {file.clientName || "Unnamed client"}{" "}
                          <span className="text-xs text-muted-foreground">
                            #{file.bookingId}
                          </span>
                        </Link>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {file.stage}
                        </p>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {file.agentName || `Agent #${file.agentId}`}
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        <p>Orbit: {file.orbitRef || "—"}</p>
                        <p>PTS: {file.ptsRef || "—"}</p>
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        {formatForecastCalendarDate(
                          file.finalSupplierPaymentDate
                        )}
                      </td>
                      <td className="min-w-44 px-3 py-2 align-top">
                        <FileReviewDate file={file} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <FileWarnings file={file} />
                      </td>
                    </tr>
                  ))}
                  {!visibleFiles.length && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-6 text-center text-sm text-muted-foreground"
                      >
                        {search.trim()
                          ? "No files match this search in the selected category."
                          : selection.type === "unscheduled"
                            ? "No unscheduled files in this result."
                            : "No files in this selected period or category."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2 text-xs">
              <span>
                Page {currentPage + 1} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage + 1 >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </Button>
            </div>
          </section>

          <p className="text-xs text-muted-foreground">
            {data.outsideRangeCount} scheduled future files outside the selected
            range (not included in the bars). Dates assessed against{" "}
            {formatForecastCalendarDate(data.today)} (UTC calendar date). Data
            as of{" "}
            <time dateTime={data.asOf}>
              {new Date(data.asOf).toLocaleString("en-GB")}
            </time>{" "}
            ({Intl.DateTimeFormat().resolvedOptions().timeZone}, local time).
          </p>
        </>
      )}

      <footer className="space-y-1 text-xs leading-relaxed text-muted-foreground">
        <p>
          Read-only workload planning. Only files in Added to PTS or Commission
          Ready for Review are included; other stages, including files already
          handed off for claiming or payment, are excluded. Personal £0 files
          still need review.
        </p>
        <p>
          In Contract and outstanding refunds, amendments or reimbursements are
          review warnings, not exclusions. Pre-authorised review uses the later
          of final supplier payment and departure + 7 days. Missing or invalid
          required dates are unscheduled, not zero workload.
        </p>
        <p>
          New bookings, date moves and stage changes can change this forecast.
          No pre-authorisation, claim or payment actions are available here.
        </p>
      </footer>
    </div>
  );
}
