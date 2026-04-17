import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Plane, Loader2, Search, CheckSquare, Square } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Link } from "wouter";

type FlightStatus = "pending" | "ticketed" | "cancelled" | "query";

const STATUS_OPTIONS: { value: FlightStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "ticketed", label: "Ticketed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "query", label: "Query" },
];

const STATUS_BADGE: Record<FlightStatus, { label: string; color: string; bg: string }> = {
  pending:   { label: "Pending",   color: "#92400e", bg: "#fef3c7" },
  ticketed:  { label: "Ticketed",  color: "#065f46", bg: "#d1fae5" },
  cancelled: { label: "Cancelled", color: "#991b1b", bg: "#fee2e2" },
  query:     { label: "Query",     color: "#1e40af", bg: "#dbeafe" },
};

const TYPE_LABEL: Record<string, string> = {
  ticketing:    "Ticketing",
  cancellation: "Cancellation",
  both:         "Ticketing & Cancellation",
};

export default function AdminFlightsPipeline() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Query dialog state
  const [queryDialogOpen, setQueryDialogOpen] = useState(false);
  const [queryTargetId, setQueryTargetId] = useState<number | null>(null);
  const [queryMessage, setQueryMessage] = useState("");

  const { data: requests, isLoading } = trpc.flightRequests.adminList.useQuery(undefined, {
    staleTime: 0,
  });

  const updateStatus = trpc.flightRequests.updateStatus.useMutation({
    onSuccess: () => {
      utils.flightRequests.adminList.invalidate();
      toast.success("Status updated");
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleInvoice = trpc.flightRequests.toggleInvoice.useMutation({
    onSuccess: () => utils.flightRequests.adminList.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  function handleStatusChange(id: number, newStatus: FlightStatus) {
    if (newStatus === "query") {
      setQueryTargetId(id);
      setQueryMessage("");
      setQueryDialogOpen(true);
    } else {
      updateStatus.mutate({ id, status: newStatus });
    }
  }

  function submitQuery() {
    if (!queryTargetId || !queryMessage.trim()) {
      toast.error("Please enter a query message.");
      return;
    }
    updateStatus.mutate(
      { id: queryTargetId, status: "query", queryMessage: queryMessage.trim() },
      {
        onSuccess: () => {
          setQueryDialogOpen(false);
          setQueryTargetId(null);
          setQueryMessage("");
        },
      }
    );
  }

  const filtered = (requests ?? []).filter((r) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      r.clientName?.toLowerCase().includes(q) ||
      r.ptsRef?.toLowerCase().includes(q) ||
      r.topdogRef?.toLowerCase().includes(q) ||
      r.agentName?.toLowerCase().includes(q) ||
      r.pnr?.toLowerCase().includes(q);
    const matchesStatus = filterStatus === "all" || r.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const pendingCount = (requests ?? []).filter((r) => r.status === "pending").length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Plane className="h-5 w-5 text-primary" />
            Flight Requests Pipeline
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage ticketing and cancellation requests from agents.
            {pendingCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-700 font-semibold">
                {pendingCount} pending
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search client, PTS ref, agent, PNR…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground text-sm">
            {search || filterStatus !== "all" ? "No requests match your filters." : "No flight requests yet."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const badge = STATUS_BADGE[r.status as FlightStatus] ?? STATUS_BADGE.pending;
            return (
              <Card key={r.id} className="overflow-hidden">
                <CardContent className="pt-4 pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                    {/* Left: booking info */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{r.clientName ?? "—"}</span>
                        <span
                          style={{
                            background: badge.bg,
                            color: badge.color,
                            borderRadius: "4px",
                            padding: "2px 8px",
                            fontSize: "11px",
                            fontWeight: 700,
                            textTransform: "uppercase",
                          }}
                        >
                          {badge.label}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {TYPE_LABEL[r.requestType] ?? r.requestType}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {r.supplier}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
                        <span>Agent: <strong className="text-foreground">{r.agentName ?? "—"}</strong></span>
                        {r.ptsRef && <span>PTS: <strong className="text-foreground">{r.ptsRef}</strong></span>}
                        {r.topdogRef && <span>TD: <strong className="text-foreground">{r.topdogRef}</strong></span>}
                        <span>PNR: <strong className="text-foreground">{r.pnr}</strong></span>
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
                        <span>Departure: <strong className="text-foreground">{format(new Date(r.departureDate), "dd MMM yyyy")}</strong></span>
                        <span>Deadline: <strong className="text-foreground">{format(new Date(r.ticketingDeadline), "dd MMM yyyy")}</strong></span>
                        <span>Submitted: {format(new Date(r.createdAt), "dd MMM yyyy HH:mm")}</span>
                      </div>
                      {r.status === "query" && r.queryMessage && (
                        <div className="mt-1.5 rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
                          <strong>Query sent:</strong> {r.queryMessage}
                        </div>
                      )}
                    </div>

                    {/* Right: controls */}
                    <div className="flex flex-col gap-2 sm:items-end shrink-0">
                      {/* Status dropdown */}
                      <Select
                        value={r.status}
                        onValueChange={(v) => handleStatusChange(r.id, v as FlightStatus)}
                        disabled={updateStatus.isPending}
                      >
                        <SelectTrigger className="w-36 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((s) => (
                            <SelectItem key={s.value} value={s.value} className="text-xs">
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Invoice checkbox */}
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground select-none">
                        <Checkbox
                          checked={r.invoiceAddedToPts ?? false}
                          onCheckedChange={() => toggleInvoice.mutate({ id: r.id, invoiceAddedToPts: !r.invoiceAddedToPts })}
                          disabled={toggleInvoice.isPending}
                        />
                        Invoice added to PTS file
                      </label>

                      {/* Link to booking */}
                      {r.bookingId && (
                        <Link href={`/bookings/${r.bookingId}`}>
                          <Button size="sm" variant="ghost" className="text-xs h-7 px-2">
                            View Booking →
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Query Message Dialog */}
      <Dialog open={queryDialogOpen} onOpenChange={setQueryDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Query to Agent</DialogTitle>
            <DialogDescription>
              Enter your query message. The agent will be notified and can see it on their booking page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-2">
            <Label htmlFor="queryMsg">Query Message</Label>
            <Textarea
              id="queryMsg"
              value={queryMessage}
              onChange={(e) => setQueryMessage(e.target.value)}
              placeholder="e.g. Please confirm the correct PNR — the one provided doesn't match our records."
              rows={4}
            />
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setQueryDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitQuery}
              disabled={!queryMessage.trim() || updateStatus.isPending}
            >
              {updateStatus.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Send Query
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
