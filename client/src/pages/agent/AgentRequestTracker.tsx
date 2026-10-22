import { useMemo, type ElementType } from "react";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FilePenLine,
  Plane,
  ReceiptText,
  RotateCcw,
  Search,
  XCircle,
} from "lucide-react";

const REQUEST_TYPES = ["all", "flights", "amendments", "reimbursements", "refunds", "cancellations"] as const;
type RequestType = (typeof REQUEST_TYPES)[number];

type TrackerRow = {
  id: number;
  kind: Exclude<RequestType, "all">;
  title: string;
  bookingId: number;
  bookingReference?: string | null;
  status: string;
  detail: string;
  submittedAt?: Date | string | null;
  href: string;
  actionLabel: string;
};

const requestTypeMeta: Record<Exclude<RequestType, "all">, {
  label: string;
  icon: ElementType;
  activeClass: string;
  softClass: string;
  emptyCopy: string;
  createHref: string;
  createLabel: string;
}> = {
  flights: {
    label: "Flight requests",
    icon: Plane,
    activeClass: "border-sky-300 bg-sky-50 text-sky-900",
    softClass: "bg-sky-100 text-sky-700",
    emptyCopy: "There are no live flight requests right now.",
    createHref: "/flight-requests",
    createLabel: "Request flights",
  },
  amendments: {
    label: "Amendments",
    icon: FilePenLine,
    activeClass: "border-violet-300 bg-violet-50 text-violet-900",
    softClass: "bg-violet-100 text-violet-700",
    emptyCopy: "There are no amendments in progress right now.",
    createHref: "/request-amendment",
    createLabel: "Request an amendment",
  },
  reimbursements: {
    label: "Reimbursements",
    icon: ReceiptText,
    activeClass: "border-amber-300 bg-amber-50 text-amber-900",
    softClass: "bg-amber-100 text-amber-700",
    emptyCopy: "There are no reimbursements in progress right now.",
    createHref: "/my-bookings",
    createLabel: "Find a booking",
  },
  refunds: {
    label: "Refund requests",
    icon: RotateCcw,
    activeClass: "border-rose-300 bg-rose-50 text-rose-900",
    softClass: "bg-rose-100 text-rose-700",
    emptyCopy: "There are no refund requests in progress right now.",
    createHref: "/my-bookings",
    createLabel: "Find a booking",
  },
  cancellations: {
    label: "Cancellation requests",
    icon: XCircle,
    activeClass: "border-red-300 bg-red-50 text-red-900",
    softClass: "bg-red-100 text-red-700",
    emptyCopy: "There are no cancellation requests in progress right now.",
    createHref: "/cancel-booking",
    createLabel: "Cancel a booking",
  },
};

function readableStatus(value: string | null | undefined) {
  if (!value) return "In progress";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function requestTypeLabel(value: string | null | undefined) {
  if (!value) return "Flight request";
  if (value === "both") return "Ticketing & cancellation";
  return readableStatus(value);
}

function money(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(amount) : null;
}

export default function AgentRequestTracker() {
  const [location] = useLocation();
  const {
    data: summary,
    isLoading,
    isError,
    refetch,
  } = trpc.reimbursements.agentOutstandingSummary.useQuery();

  const selectedType = useMemo<RequestType>(() => {
    const value = new URLSearchParams(window.location.search).get("type");
    return REQUEST_TYPES.includes(value as RequestType) ? value as RequestType : "all";
  }, [location]);

  const requestRows = useMemo<TrackerRow[]>(() => {
    if (!summary) return [];
    return [
      ...summary.flightRequests.map((request) => ({
        id: request.id,
        kind: "flights" as const,
        title: request.clientName ?? `Booking #${request.bookingId}`,
        bookingId: request.bookingId,
        bookingReference: (request as any).bookingReference ?? null,
        status: readableStatus(request.status),
        detail: [requestTypeLabel(request.requestType), request.supplier].filter(Boolean).join(" · "),
        submittedAt: request.createdAt,
        href: "/flight-requests",
        actionLabel: "Open flight request",
      })),
      ...summary.amendments.map((request) => ({
        id: request.id,
        kind: "amendments" as const,
        title: request.clientName ?? `Booking #${request.bookingId}`,
        bookingId: request.bookingId,
        bookingReference: (request as any).bookingReference ?? null,
        status: readableStatus(request.pipelineStage),
        detail: "Amendment request",
        submittedAt: request.createdAt,
        href: `/bookings/${request.bookingId}`,
        actionLabel: "Open booking",
      })),
      ...summary.reimbursements.map((request) => ({
        id: request.id,
        kind: "reimbursements" as const,
        title: request.clientName ?? `Booking #${request.bookingId}`,
        bookingId: request.bookingId,
        bookingReference: (request as any).bookingReference ?? null,
        status: readableStatus(request.status),
        detail: [request.supplierName, money(request.amount), request.isLate ? "Marked late" : null].filter(Boolean).join(" · ") || "Reimbursement request",
        submittedAt: (request as any).createdAt,
        href: `/bookings/${request.bookingId}`,
        actionLabel: "Open booking",
      })),
      ...summary.refunds.map((request) => ({
        id: request.id,
        kind: "refunds" as const,
        title: request.clientName ?? `Booking #${request.bookingId}`,
        bookingId: request.bookingId,
        bookingReference: (request as any).bookingReference ?? null,
        status: readableStatus(request.pipelineStage),
        detail: "Refund request",
        submittedAt: request.createdAt,
        href: `/bookings/${request.bookingId}`,
        actionLabel: "Open booking",
      })),
      ...summary.cancellations.map((request) => ({
        id: request.id,
        kind: "cancellations" as const,
        title: request.clientName ?? `Booking #${request.bookingId}`,
        bookingId: request.bookingId,
        bookingReference: (request as any).bookingReference ?? null,
        status: readableStatus(request.status),
        detail: "Cancellation request",
        submittedAt: request.confirmedAt,
        href: `/bookings/${request.bookingId}`,
        actionLabel: "Open booking",
      })),
    ].sort((first, second) => new Date(second.submittedAt ?? 0).getTime() - new Date(first.submittedAt ?? 0).getTime());
  }, [summary]);

  const visibleRows = selectedType === "all" ? requestRows : requestRows.filter((row) => row.kind === selectedType);
  const selectedMeta = selectedType === "all" ? null : requestTypeMeta[selectedType];
  const SelectedIcon = selectedMeta?.icon ?? Clock3;
  const totalCopy = requestRows.length === 1 ? "1 request in progress" : `${requestRows.length} requests in progress`;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link href="/dashboard" className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft size={14} /> Back to JLT Home
          </Link>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Request tracker</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">See every request JLT is currently working on for you. Select a category to check its latest status, then open the relevant request or booking when you need more detail.</p>
        </div>
        {!isLoading && !isError && (
          <div className="inline-flex w-fit items-center gap-2 rounded-full bg-[#f0fffb] px-4 py-2 text-sm font-bold text-[#065f46]">
            <Clock3 size={16} /> {requestRows.length === 0 ? "All up to date" : totalCopy}
          </div>
        )}
      </section>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Link href="/my-requests">
          <div className={`flex h-full items-center gap-2 rounded-xl border px-3 py-3 text-sm font-bold transition-colors ${selectedType === "all" ? "border-[#70FFE8] bg-[#f0fffb] text-[#065f46]" : "bg-card text-foreground hover:bg-muted/40"}`}>
            <Clock3 size={16} /> All requests
            <span className="ml-auto rounded-full bg-white/80 px-2 py-0.5 text-xs">{requestRows.length}</span>
          </div>
        </Link>
        {(Object.keys(requestTypeMeta) as Exclude<RequestType, "all">[]).map((type) => {
          const meta = requestTypeMeta[type];
          const Icon = meta.icon;
          const count = requestRows.filter((row) => row.kind === type).length;
          return (
            <Link key={type} href={`/my-requests?type=${type}`}>
              <div className={`flex h-full items-center gap-2 rounded-xl border px-3 py-3 text-sm font-bold transition-colors ${selectedType === type ? meta.activeClass : "bg-card text-foreground hover:bg-muted/40"}`}>
                <Icon size={16} /> <span className="min-w-0 flex-1 truncate">{meta.label}</span>
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs">{count}</span>
              </div>
            </Link>
          );
        })}
      </section>

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/20 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <SelectedIcon size={18} /> {selectedMeta?.label ?? "All requests in progress"}
              </CardTitle>
              <p className="mt-1 text-sm font-normal text-muted-foreground">
                {selectedMeta ? "Only live requests are shown. Completed requests drop out automatically." : "Filter by request type to focus on the work you need to follow up."}
              </p>
            </div>
            {selectedMeta && (
              <Link href={selectedMeta.createHref}>
                <Button size="sm" variant="outline" className="gap-1.5"><ArrowRight size={14} /> {selectedMeta.createLabel}</Button>
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-muted/60" />)}</div>
          ) : isError ? (
            <div className="p-6 text-center">
              <p className="font-semibold text-red-800">Your request tracker could not be loaded.</p>
              <p className="mt-1 text-sm text-muted-foreground">No request records have been removed. Please retry.</p>
              <Button className="mt-4" size="sm" variant="outline" onClick={() => refetch()}>Retry request tracker</Button>
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="p-10 text-center">
              <CheckCircle2 size={30} className="mx-auto text-emerald-600" />
              <p className="mt-3 font-semibold text-foreground">{selectedMeta?.emptyCopy ?? "There are no requests in progress right now."}</p>
              <p className="mt-1 text-sm text-muted-foreground">When JLT is working on a request for you, its latest status will appear here.</p>
              {selectedMeta && <Link href={selectedMeta.createHref}><Button className="mt-4" size="sm" variant="outline">{selectedMeta.createLabel}</Button></Link>}
            </div>
          ) : (
            <div className="divide-y">
              {visibleRows.map((row) => {
                const meta = requestTypeMeta[row.kind];
                const Icon = meta.icon;
                return (
                  <Link key={`${row.kind}-${row.id}`} href={row.href}>
                    <div className="group flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-muted/35 sm:flex-row sm:items-center">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${meta.softClass}`}><Icon size={18} /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold text-foreground">{row.title}</p>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{meta.label}</span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{row.detail}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Booking #{row.bookingId}{row.bookingReference ? ` · ${row.bookingReference}` : ""}{row.submittedAt ? ` · Submitted ${format(new Date(row.submittedAt), "d MMM yyyy")}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 sm:text-right">
                        <div><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${meta.softClass}`}>{row.status}</span><p className="mt-1 hidden text-xs text-muted-foreground sm:block">{row.actionLabel}</p></div>
                        <ChevronRight size={18} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <section className="rounded-2xl border border-[#a7f3e8] bg-[#f0fffb]/55 p-4">
        <div className="flex items-start gap-3">
          <Search size={18} className="mt-0.5 shrink-0 text-[#047857]" />
          <div><p className="font-bold text-foreground">Need to take action on a booking?</p><p className="mt-1 text-sm text-muted-foreground">Open the relevant row above to see its booking details, messages and any documents that JLT needs from you. For live booking management, continue to use Orbit.</p></div>
        </div>
      </section>
    </div>
  );
}
