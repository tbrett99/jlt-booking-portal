import { useMemo, useState, type FormEvent } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Download, RefreshCw } from "lucide-react";
import {
  addIncomeDays,
  incomeMonday,
  incomeHistoryFloor,
  incomeMoney,
  incomeCsv,
  isCalendarDate,
  londonDate,
  validateIncomeRange,
  INCOME_CATEGORY_LABELS,
  type PaidOutIncomeRow,
} from "@shared/gocardless-income-report";

type AppliedRange = {
  rangeStart: string;
  rangeEnd: string;
  refreshKey?: number;
};
type RowView = "joining" | "membership" | "review" | "all";
const PAGE_SIZE = 25;
const VIEWS: { value: RowView; label: string }[] = [
  { value: "joining", label: "Joining fees" },
  { value: "membership", label: "Membership" },
  { value: "review", label: "Other + needs review" },
  { value: "all", label: "All" },
];
function needsReview(row: PaidOutIncomeRow) {
  return (
    row.category === "unclassified" ||
    row.identityStatus !== "matched" ||
    !!row.reviewReason ||
    row.amountMinor === null ||
    !row.currency ||
    (row.category === "joining_fee" &&
      (!row.sources.length ||
        row.sources.some(source =>
          ["Not recorded", "Needs source review"].includes(source)
        )))
  );
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export default function GoCardlessIncomeReport() {
  const [initialRange] = useState(() => {
    const monday = incomeMonday();
    return { rangeStart: monday, rangeEnd: addIncomeDays(monday, 6) };
  });
  const [draftStart, setDraftStart] = useState(initialRange.rangeStart);
  const [draftEnd, setDraftEnd] = useState(initialRange.rangeEnd);
  const [applied, setApplied] = useState<AppliedRange | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [view, setView] = useState<RowView>("joining");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = trpc.superAdmin.paidOutIncome.useQuery(
    applied ?? initialRange,
    {
      enabled: applied !== null,
      retry: false,
      staleTime: 300_000,
      refetchOnWindowFocus: false,
    }
  );

  // A cached success is not a result for a pending/failed request, or a different range.
  const busy =
    applied !== null &&
    (query.isFetching || query.isLoading || query.isPending);
  const failed = applied !== null && (!!query.error || query.isError);
  const report =
    applied &&
    !busy &&
    !failed &&
    query.data?.complete === true &&
    query.data.rangeStart === applied.rangeStart &&
    query.data.rangeEnd === applied.rangeEnd
      ? query.data
      : null;
  const draftChanged =
    !!applied &&
    (draftStart !== applied.rangeStart || draftEnd !== applied.rangeEnd);
  const displayed = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("en-GB");
    return (report?.rows ?? []).filter(row => {
      const categoryMatches =
        view === "all" ||
        (view === "joining" && row.category === "joining_fee") ||
        (view === "membership" && row.category === "membership") ||
        (view === "review" && (row.category === "other" || needsReview(row)));
      const searchable = [
        row.agentName,
        row.agentId,
        row.paymentId,
        row.payoutId,
        ...row.sources,
        row.sourceEvidence,
        row.identityStatus,
        row.description,
        row.reviewReason,
      ]
        .join(" ")
        .toLocaleLowerCase("en-GB");
      return categoryMatches && (!term || searchable.includes(term));
    });
  }, [report, view, search]);
  const pageCount = Math.max(1, Math.ceil(displayed.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = displayed.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  function selectWeek(date: string) {
    if (!isCalendarDate(date)) return;
    const monday = incomeMonday(date);
    setDraftStart(monday);
    setDraftEnd(addIncomeDays(monday, 6));
    setValidationError(null);
  }
  function moveWeek(days: number) {
    selectWeek(
      addIncomeDays(
        isCalendarDate(draftStart) ? incomeMonday(draftStart) : incomeMonday(),
        days
      )
    );
  }
  function loadReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      validateIncomeRange(draftStart, draftEnd);
      setValidationError(null);
      setPage(1);
      if (
        applied?.rangeStart === draftStart &&
        applied.rangeEnd === draftEnd &&
        applied.refreshKey === undefined
      ) {
        void query.refetch();
      } else {
        setApplied({ rangeStart: draftStart, rangeEnd: draftEnd });
      }
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : "Choose a valid date range"
      );
    }
  }
  function refreshReport() {
    if (!applied || busy) return;
    setApplied({ ...applied, refreshKey: Date.now() });
    setPage(1);
  }
  function exportCsv() {
    if (!report?.rows.length) return;
    const url = URL.createObjectURL(
      new Blob([incomeCsv(report)], { type: "text/csv;charset=utf-8" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `gocardless-paid-out-income-${report.rangeStart}-to-${report.rangeEnd}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-5" aria-labelledby="gocardless-income-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="gocardless-income-title" className="text-2xl font-bold">
            GoCardless paid-out income
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Gross payments paid out by GoCardless, grouped by currency.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!applied || busy}
            onClick={refreshReport}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh from GoCardless
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!report?.rows.length}
            onClick={exportCsv}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-4 text-sm dark:border-teal-900 dark:bg-teal-950/20">
        <p>
          <strong>Source:</strong> actual GoCardless payment{" "}
          <code>paid_out</code> event date in Europe/London, not the charge date
          or joining date. This is not bank statement confirmation.
        </p>
        <p className="mt-1">
          Gross income does not deduct fees, refunds or chargebacks. Later
          reversals remain in the paid-out report and are annotated with the
          current payment status; this is not net income.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <form
            onSubmit={loadReport}
            className="space-y-3"
            aria-label="Income report date range"
          >
            <div className="flex flex-wrap items-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => selectWeek(londonDate())}
              >
                This week
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => selectWeek(addIncomeDays(incomeMonday(), -7))}
              >
                Last week
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Previous week"
                onClick={() => moveWeek(-7)}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Next week"
                onClick={() => moveWeek(7)}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
              <div className="space-y-1">
                <Label htmlFor="income-week">Pick a week (Monday–Sunday)</Label>
                <Input
                  id="income-week"
                  type="date"
                  className="w-44"
                  value={
                    isCalendarDate(draftStart) ? incomeMonday(draftStart) : ""
                  }
                  onChange={event => selectWeek(event.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="income-start">Custom start date</Label>
                <Input
                  id="income-start"
                  type="date"
                  required
                  className="w-44"
                  value={draftStart}
                  onChange={event => {
                    setDraftStart(event.target.value);
                    setValidationError(null);
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="income-end">Custom end date</Label>
                <Input
                  id="income-end"
                  type="date"
                  required
                  className="w-44"
                  value={draftEnd}
                  onChange={event => {
                    setDraftEnd(event.target.value);
                    setValidationError(null);
                  }}
                />
              </div>
              <Button type="submit" disabled={busy}>
                Load report
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Dates are inclusive London calendar dates. Presets and date edits
              only change the draft; select Load report to apply.
            </p>
            {draftChanged && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Unapplied date changes. Any displayed report and CSV still use
                the applied range.
              </p>
            )}
            {validationError && (
              <p role="alert" className="text-sm text-destructive">
                {validationError}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {!applied && (
        <p
          role="status"
          className="rounded-lg border p-4 text-sm text-muted-foreground"
        >
          Choose a range and select Load report. No GoCardless report has been
          requested.
        </p>
      )}
      {busy && (
        <p role="status" className="rounded-lg border p-4 text-sm">
          Loading GoCardless paid-out events for {applied?.rangeStart} to{" "}
          {applied?.rangeEnd}… Previous results are withheld while loading.
        </p>
      )}
      {failed && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 p-4 text-sm"
        >
          <p className="font-semibold">
            Unable to load GoCardless paid-out income for {applied?.rangeStart}{" "}
            to {applied?.rangeEnd}.
          </p>
          <p>{query.error?.message ?? "The provider request failed."}</p>
          <p className="mt-1">
            Previous results are withheld. This is not a zero-income result.
            Select Load report to retry, or Refresh from GoCardless.
          </p>
        </div>
      )}
      {applied && !busy && !failed && !report && (
        <p role="status" className="rounded-lg border p-4 text-sm">
          Awaiting a complete report for the applied range. No totals are
          available yet.
        </p>
      )}

      {report && (
        <div className="space-y-5" data-testid="income-report-results">
          <div
            className="flex flex-wrap items-center gap-2 text-sm"
            data-testid="income-applied-label"
          >
            <strong>
              Applied range: {dateLabel(report.rangeStart)} –{" "}
              {dateLabel(report.rangeEnd)}
            </strong>
            <span>
              ({report.rangeStart} to {report.rangeEnd}, Europe/London)
            </span>
            <Badge
              variant={
                report.providerEnvironment === "sandbox"
                  ? "secondary"
                  : "outline"
              }
            >
              {report.providerEnvironment === "live"
                ? "Live GoCardless environment"
                : "Sandbox GoCardless environment — not live income"}
            </Badge>
            <span
              className="text-muted-foreground"
              title={`UTC: ${report.asOf}`}
            >
              As of{" "}
              {new Date(report.asOf).toLocaleString("en-GB", {
                timeZone: "Europe/London",
              })}{" "}
              (London)
            </span>
          </div>
          <p
            className="text-sm text-muted-foreground"
            data-testid="income-report-totals"
          >
            {report.rows.length} paid-out payment rows in the full report ·{" "}
            {report.reviewCount} need review. All currency totals below use the
            full report, not the table filter or page. Counts are payments, not
            people. Paid-out event pagination is complete; payment details,
            Portal ownership or sources may still need review.
          </p>
          {report.currencies.map(summary => (
            <div
              key={summary.currency}
              className="space-y-2"
              data-testid={`income-currency-${summary.currency}`}
            >
              <h3 className="text-sm font-semibold">
                Verified gross amounts · {summary.currency} — no currency
                conversion
              </h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs font-medium text-muted-foreground">
                      Joining fees · {summary.currency}
                    </p>
                    <p className="mt-1 text-xl font-bold tabular-nums">
                      {incomeMoney(summary.joiningGrossMinor, summary.currency)}
                    </p>
                    <p className="text-sm">
                      {summary.joiningCount} joining-fee payments
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs font-medium text-muted-foreground">
                      Membership · {summary.currency}
                    </p>
                    <p className="mt-1 text-xl font-bold tabular-nums">
                      {incomeMoney(
                        summary.membershipGrossMinor,
                        summary.currency
                      )}
                    </p>
                    <p className="text-sm">
                      {summary.membershipCount} individual membership payments
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs font-medium text-muted-foreground">
                      Overall gross · {summary.currency}
                    </p>
                    <p className="mt-1 text-xl font-bold tabular-nums">
                      {incomeMoney(summary.totalGrossMinor, summary.currency)}
                    </p>
                    <p className="text-sm">
                      {summary.totalCount} payments, including other /
                      unclassified
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Other: {summary.otherCount} payments ·{" "}
                      {incomeMoney(summary.otherGrossMinor, summary.currency)}
                      <br />
                      Unclassified: {summary.unclassifiedCount} payments ·{" "}
                      {incomeMoney(
                        summary.unclassifiedGrossMinor,
                        summary.currency
                      )}
                    </p>
                  </CardContent>
                </Card>
              </div>
              <p className="text-xs text-muted-foreground">
                Card payment counts include only rows with verified gross
                amounts and currency. All returned rows, including unknown
                amounts, remain in the full report and CSV.
              </p>
            </div>
          ))}
          {!report.rows.length && (
            <p role="status" className="rounded-lg border p-4">
              No paid-out payment events were returned for this applied range.
            </p>
          )}
          {report.rows.some(
            row => row.amountMinor === null || !row.currency
          ) && (
            <p className="rounded-lg border border-amber-300 p-3 text-sm">
              Some amounts or currencies are unknown and need review. Verified
              gross amounts are a lower bound, not a complete monetary total.
              Missing values are not assumed to be zero or included in currency
              totals.
            </p>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Joining-fee referral sources
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                Each joining-fee payment counts under each selected channel.
                Multi-selected sources overlap, so channel counts must not be
                added as a unique payment or person total. Unknown sources stay
                unknown; they are not guessed. This breakdown uses the full
                applied report. Sources reflect current CRM/form attribution,
                not a historical snapshot at the paid-out date.
              </p>
              <div
                className="flex flex-wrap gap-2"
                aria-label="Referral source payment counts"
              >
                {report.referralBreakdown.map(item => (
                  <Badge key={item.source} variant="outline">
                    {item.source}: {item.joiningPaymentCount} payments
                  </Badge>
                ))}
                {!report.referralBreakdown.length && (
                  <span className="text-sm text-muted-foreground">
                    No joining-fee source counts available.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-3 pb-3">
              <CardTitle className="text-base">Paid-out payments</CardTitle>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Payment categories"
              >
                {VIEWS.map(item => (
                  <Button
                    key={item.value}
                    type="button"
                    size="sm"
                    variant={view === item.value ? "secondary" : "outline"}
                    aria-pressed={view === item.value}
                    onClick={() => {
                      setView(item.value);
                      setPage(1);
                    }}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <div className="max-w-md space-y-1">
                <Label htmlFor="income-search">
                  Search payer, ID or source
                </Label>
                <Input
                  id="income-search"
                  type="search"
                  value={search}
                  onChange={event => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Payer name, payment/payout/agent ID, source…"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The joining-fee payer may be a team lead paying for someone
                else. A payment is not necessarily a new person. Only confirmed
                identity matches link to the CRM; review rows are not guessed.
              </p>
            </CardHeader>
            <CardContent>
              <Table aria-label="GoCardless paid-out payments">
                <TableHeader>
                  <TableRow>
                    <TableHead>Payer / member</TableHead>
                    <TableHead>Category / review</TableHead>
                    <TableHead>Source(s)</TableHead>
                    <TableHead>Gross / currency</TableHead>
                    <TableHead>Paid-out date / reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row, index) => (
                    <TableRow
                      key={`${row.paymentId}-${row.paidOutAt}-${index}`}
                    >
                      <TableCell className="align-top whitespace-normal min-w-40">
                        {row.identityStatus === "matched" &&
                        row.agentId !== null ? (
                          <a
                            className="font-medium text-primary underline"
                            href={`/crm/agents?agent=${row.agentId}`}
                          >
                            {row.agentName || `Matched agent ${row.agentId}`}
                          </a>
                        ) : (
                          <span className="font-medium">
                            {row.identityStatus === "ambiguous"
                              ? "Unknown payer"
                              : row.agentName || "Unknown payer"}
                          </span>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.identityStatus === "matched"
                            ? "Matched identity"
                            : row.category === "joining_fee" &&
                                row.identityStatus === "unmatched" &&
                                row.agentId === null &&
                                row.agentName
                              ? "GoCardless payer · not linked to one Portal agent"
                              : `${row.identityStatus === "ambiguous" ? "Ambiguous" : "Unmatched"} identity — needs review`}
                        </p>
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          Payment: {row.paymentId}
                        </p>
                      </TableCell>
                      <TableCell className="align-top whitespace-normal min-w-44 max-w-xs">
                        <Badge
                          variant={needsReview(row) ? "secondary" : "outline"}
                        >
                          {INCOME_CATEGORY_LABELS[row.category]}
                        </Badge>
                        <details className="mt-1 text-xs text-muted-foreground">
                          <summary className="cursor-pointer">
                            Classification evidence
                          </summary>
                          <p className="mt-1">{row.categoryEvidence}</p>
                        </details>
                        {row.reviewReason && (
                          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                            Needs review: {row.reviewReason}
                          </p>
                        )}
                        {row.currentStatus && (
                          <p className="mt-1 text-xs">
                            Current status: {row.currentStatus}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="align-top whitespace-normal min-w-36 max-w-xs">
                        {row.sources.length
                          ? row.sources.join("; ")
                          : "Unknown source"}
                        <details className="mt-1 text-xs text-muted-foreground">
                          <summary className="cursor-pointer">
                            Source details
                          </summary>
                          <p className="mt-1">{row.sourceEvidence}</p>
                        </details>
                      </TableCell>
                      <TableCell className="align-top tabular-nums">
                        {row.amountMinor !== null && row.currency
                          ? incomeMoney(row.amountMinor, row.currency)
                          : "Unknown gross / currency"}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.currency || "Unknown currency"}
                        </p>
                      </TableCell>
                      <TableCell className="align-top whitespace-normal min-w-40">
                        <p>{londonDate(new Date(row.paidOutAt))} (London)</p>
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          Payout: {row.payoutId || "Unknown payout reference"}
                        </p>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!pageRows.length && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center text-muted-foreground"
                      >
                        No payments match this table view. Full-report totals
                        above are unchanged.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                <p aria-live="polite">
                  {displayed.length
                    ? `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, displayed.length)}`
                    : "0"}{" "}
                  of {displayed.length} matching rows · Page {currentPage} of{" "}
                  {pageCount} · 25 rows per page
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 1}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Previous page
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={currentPage === pageCount}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next page
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <details className="rounded-lg border p-4 text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">
          History and read-only scope
        </summary>
        <p className="mt-2">
          GoCardless keeps 18 months of API event history. Backdated ranges
          within that window are read automatically on demand when you load the
          report; no scheduled recovery is needed. Earliest available London
          date: {report?.earliestAvailableDate ?? incomeHistoryFloor()}.
        </p>
        <p className="mt-2">
          Older GoCardless events are archived and require archived reports from
          GoCardless support. This report does not automatically recover
          archives, generate receipts, send mail, upload files, confirm bank
          deposits or change the ledger. Loading and refreshing only read
          GoCardless data; they do not create or change provider payments or
          payouts.
        </p>
      </details>
    </section>
  );
}
