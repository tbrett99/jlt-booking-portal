import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle, Clock, Loader2, ArrowRight, ChevronRight, XCircle } from "lucide-react";
import { format } from "date-fns";
import AmendmentListFilters, { useAmendmentFilterClock } from "@/components/AmendmentListFilters";
import { DEFAULT_AMENDMENT_FILTERS, amendmentDate, amendmentDepartureDays, amendmentDepartureLabel, amendmentStage, filterAndSortAmendments, type AmendmentListFilters as Filters } from "@shared/amendment-list";

export default function AdminAmendments() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const query = trpc.amendments.all.useQuery(undefined, { staleTime: 60000, refetchOnMount: "always", refetchOnWindowFocus: true });
  const [filters, setFilters] = useState<Filters>(() => ({ ...DEFAULT_AMENDMENT_FILTERS }));
  const now = useAmendmentFilterClock();
  // Never expose stale records or interpret a query failure as an empty work queue.
  const amendments = useMemo(() => query.isError ? [] : (query.data ?? []).filter(a => !a.isReimbursementDoc), [query.data, query.isError]);
  const visible = useMemo(() => filterAndSortAmendments(amendments, filters, now, user?.id), [amendments, filters, now, user?.id]);
  const pending = visible.filter(a => amendmentStage(a) === "To Do" || amendmentStage(a) === "In Progress");
  const actioned = visible.filter(a => amendmentStage(a) === "Actioned");
  const rejected = visible.filter(a => amendmentStage(a) === "rejected");
  const totalPending = amendments.filter(a => amendmentStage(a) === "To Do" || amendmentStage(a) === "In Progress").length;
  const totalActioned = amendments.filter(a => amendmentStage(a) === "Actioned").length;
  const totalRejected = amendments.filter(a => amendmentStage(a) === "rejected").length;

  const actionAmendment = trpc.amendments.action.useMutation({
    onSuccess: () => { utils.amendments.all.invalidate(); toast.success("Amendment actioned"); },
    onError: err => toast.error(err.message || "Failed to action amendment"),
  });
  const updatePipeline = trpc.amendments.updatePipeline.useMutation({ onSuccess: () => utils.amendments.all.invalidate() });
  const handleMarkActioned = (amendmentId: number, bookingId: number) => {
    actionAmendment.mutate({ amendmentId, bookingId });
    updatePipeline.mutate({ amendmentId, bookingId, pipelineStage: "Actioned" });
  };
  const isPending = actionAmendment.isPending || updatePipeline.isPending;

  function rowCard(a: (typeof amendments)[number], state: "pending" | "actioned" | "rejected") {
    const submitted = amendmentDate(a.createdAt);
    const departure = amendmentDate(a.departureDate);
    const days = amendmentDepartureDays(a.departureDate, now);
    const urgent = state === "pending" && days != null && days >= 0 && days < 7;
    return (
      <div key={a.id} data-amendment-id={a.id} className="p-4 rounded-lg border" style={state === "pending" ? { background: "#fefce8", borderColor: "#fde68a" } : state === "rejected" ? { background: "#fef2f2", borderColor: "#fecaca" } : { background: "#f0fdf4", borderColor: "#bbf7d0" }}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/bookings/${a.bookingId}?from=amendments`}><span className="font-semibold text-sm hover:underline cursor-pointer text-[#02BFAE]">{a.clientName || `Booking #${a.bookingId}`}</span></Link>
              <Badge variant="outline" className="text-[10px] px-1.5">{amendmentStage(a) === "rejected" ? "Rejected" : amendmentStage(a)}</Badge>
              <Badge variant="outline" className={`text-[10px] px-1.5 ${urgent ? "border-amber-400 text-amber-900 bg-amber-50" : "text-muted-foreground"}`}>{amendmentDepartureLabel(a, now)}</Badge>
            </div>
            <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-3">
              <span>Agent: <span className="font-medium text-foreground">{a.agentName || "Agent unavailable"}</span></span>
              <span>Departure: <span className="font-medium text-foreground">{departure ? format(departure, "dd MMM yyyy") : "Not recorded"}</span></span>
              <span title="Displayed in your local time">Submitted: {submitted ? format(submitted, "dd MMM yyyy, HH:mm") : "Not recorded"}</span>
            </div>
            <div className="flex gap-x-3 gap-y-1 flex-wrap text-xs text-muted-foreground">
              {a.crmRef && <span>Orbit: <span className="font-medium text-foreground">{a.crmRef}</span></span>}
              {a.ptsRef && <span>PTS: <span className="font-medium text-foreground">{a.ptsRef}</span></span>}
              {a.topdogRef && <span>TD: <span className="font-medium text-foreground">{a.topdogRef}</span></span>}
              <span>Assigned: <span className="font-medium text-foreground">{a.assignedToName || (a.assignedToId ? `Staff #${a.assignedToId}` : "Unassigned")}</span></span>
            </div>
            <p className="text-sm text-foreground whitespace-pre-wrap">{a.details}</p>
            {state === "rejected" && a.rejectionReason && <p className="text-xs text-red-800 whitespace-pre-wrap">Reason: {a.rejectionReason}</p>}
          </div>
          <div className="flex sm:flex-col gap-2 shrink-0">
            <Link href="/amendments/pipeline"><Button size="sm" variant="outline" className="gap-1 text-xs h-7 w-full">View in Pipeline <ChevronRight size={11} /></Button></Link>
            {state === "pending" && <Button size="sm" onClick={() => handleMarkActioned(a.id, a.bookingId)} disabled={isPending} style={{ background: "#70FFE8", color: "#414141" }} className="gap-1">{isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}Mark Actioned</Button>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Amendments</h1><p className="text-sm text-muted-foreground">{query.isError ? "Amendments unavailable" : `${totalPending} pending, ${totalActioned} actioned${totalRejected ? `, ${totalRejected} rejected` : ""}`}</p></div>
        <Link href="/amendments/pipeline"><Button style={{ background: "#70FFE8", color: "#414141" }} className="gap-1.5 text-sm">Amendment Pipeline <ArrowRight size={14} /></Button></Link>
      </div>
      {query.isLoading ? <div className="flex justify-center py-12" role="status"><Loader2 className="animate-spin h-8 w-8 text-[#02BFAE]" /><span className="sr-only">Loading amendments</span></div> : query.isError ? (
        <Card><CardContent className="py-8 text-center space-y-3"><p role="alert">Could not load amendments. No amendment records are being shown.</p><Button variant="outline" onClick={() => query.refetch()}>Retry amendments</Button></CardContent></Card>
      ) : <>
        <AmendmentListFilters filters={filters} onChange={setFilters} rows={amendments} currentUserId={user?.id} matchedCount={visible.length} totalCount={amendments.length} />
        {!visible.length ? <Card><CardContent className="py-10 text-center text-muted-foreground"><p className="font-medium">{amendments.length ? "No amendments match these filters" : "No amendments yet"}</p><p className="text-sm mt-1">{amendments.length ? "Adjust or clear the filters to see other requests." : "New requests will appear here."}</p></CardContent></Card> : <>
          {(filters.stage === "all" || filters.stage === "pending" || filters.stage === "To Do" || filters.stage === "In Progress") && <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock size={16} className="text-amber-600" />Pending Amendments <Badge variant="outline">{pending.length}</Badge></CardTitle></CardHeader><CardContent><div className="space-y-3">{pending.length ? pending.map(a => rowCard(a, "pending")) : <p className="text-sm text-muted-foreground py-4">No pending amendments match these filters</p>}</div></CardContent></Card>}
          {(filters.stage === "all" || filters.stage === "Actioned") && <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><CheckCircle size={16} className="text-emerald-600" />Actioned Amendments <Badge variant="outline">{actioned.length}</Badge></CardTitle></CardHeader><CardContent><div className="space-y-3">{actioned.length ? actioned.map(a => rowCard(a, "actioned")) : <p className="text-sm text-muted-foreground py-4">No actioned amendments match these filters</p>}</div></CardContent></Card>}
          {rejected.length > 0 && <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><XCircle size={16} className="text-red-600" />Rejected Amendments <Badge variant="outline">{rejected.length}</Badge></CardTitle></CardHeader><CardContent><div className="space-y-3">{rejected.map(a => rowCard(a, "rejected"))}</div></CardContent></Card>}
        </>}
      </>}
    </div>
  );
}
