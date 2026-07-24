import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plane, Loader2, Search, AlertTriangle, Clock, CheckCircle2, Trash2 } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import { toast } from "sonner";
import { Link } from "wouter";

type FlightStatus = "pending" | "ticketed" | "cancelled" | "query" | "completed";
type CancellationStatus = "pending" | "cancelled";

const ACTIVE_STATUS_OPTIONS: { value: FlightStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "ticketed", label: "Ticketed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "query", label: "Query" },
];

const CANCELLATION_STATUS_OPTIONS: { value: CancellationStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_BADGE: Record<FlightStatus, { label: string; color: string; bg: string }> = {
  pending:   { label: "Pending",   color: "#92400e", bg: "#fef3c7" },
  ticketed:  { label: "Ticketed",  color: "#065f46", bg: "#d1fae5" },
  cancelled: { label: "Cancelled", color: "#991b1b", bg: "#fee2e2" },
  query:     { label: "Query",     color: "#1e40af", bg: "#dbeafe" },
  completed: { label: "Completed", color: "#166534", bg: "#dcfce7" },
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

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const deleteRequest = trpc.flightRequests.delete.useMutation({
    onSuccess: () => {
      utils.flightRequests.adminList.invalidate();
      setConfirmDeleteId(null);
      toast.success("Flight request deleted");
    },
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

  function handleCancellationStatusChange(id: number, newStatus: CancellationStatus) {
    updateStatus.mutate({ id, cancellationStatus: newStatus });
  }

  function markComplete(id: number) {
    updateStatus.mutate({ id, status: "completed" });
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

  const allRequests = requests ?? [];

  // Split into active and completed
  const activeRequests = allRequests.filter((r) => r.status !== "completed");
  const completedRequests = allRequests.filter((r) => r.status === "completed");

  const filterRequests = (list: typeof allRequests) =>
    list.filter((r) => {
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

  const filteredActive = filterRequests(activeRequests);
  const filteredCompleted = filterRequests(completedRequests);

  const pendingCount = activeRequests.filter((r) => r.status === "pending").length;

  const renderCard = (r: (typeof allRequests)[0], isCompleted = false) => {
    const badge = STATUS_BADGE[r.status as FlightStatus] ?? STATUS_BADGE.pending;
    return (
      <Card key={r.id} className={`overflow-hidden ${
        !isCompleted && r.status === 'pending' && (() => {
          const hoursLeft = differenceInHours(new Date(r.ticketingDeadline), new Date());
          if (hoursLeft < 0) return 'border-red-400 bg-red-50/30';
          if (hoursLeft <= 48) return 'border-amber-400 bg-amber-50/30';
          return '';
        })()
      } ${isCompleted ? 'opacity-80' : ''}`}>
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
                <Badge
                  variant="outline"
                  className={`text-xs font-semibold ${
                    r.requestType === "cancellation"
                      ? "border-orange-400 bg-orange-50 text-orange-700"
                      : r.requestType === "both"
                      ? "border-purple-400 bg-purple-50 text-purple-700"
                      : ""
                  }`}
                >
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
                {r.flightCost != null && (
                  <span className="text-emerald-700 font-semibold">£{parseFloat(String(r.flightCost)).toFixed(2)}</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
                <span>Departure: <strong className="text-foreground">{format(new Date(r.departureDate), "dd MMM yyyy")}</strong></span>
                {!isCompleted && (
                  <span className={(() => {
                    if (r.status !== 'pending') return '';
                    const hoursLeft = differenceInHours(new Date(r.ticketingDeadline), new Date());
                    if (hoursLeft < 0) return 'text-red-700 font-semibold';
                    if (hoursLeft <= 48) return 'text-amber-700 font-semibold';
                    return '';
                  })()}>
                    Deadline:
                    {r.status === 'pending' && (() => {
                      const hoursLeft = differenceInHours(new Date(r.ticketingDeadline), new Date());
                      if (hoursLeft < 0) return <AlertTriangle className="inline h-3 w-3 ml-1 mr-0.5 text-red-600" />;
                      if (hoursLeft <= 48) return <Clock className="inline h-3 w-3 ml-1 mr-0.5 text-amber-600" />;
                      return null;
                    })()}
                    {' '}<strong className="text-foreground">{format(new Date(r.ticketingDeadline), "dd MMM yyyy")}</strong>
                    {r.status === 'pending' && (() => {
                      const hoursLeft = differenceInHours(new Date(r.ticketingDeadline), new Date());
                      if (hoursLeft < 0) return <span className="ml-1 text-red-600">(OVERDUE)</span>;
                      if (hoursLeft <= 48) return <span className="ml-1 text-amber-600">({hoursLeft}h left)</span>;
                      return null;
                    })()}
                  </span>
                )}
                <span>Submitted: {format(new Date(r.createdAt), "dd MMM yyyy HH:mm")}</span>
                {isCompleted && r.updatedAt && (
                  <span className="text-emerald-700">Completed: {format(new Date(r.updatedAt), "dd MMM yyyy HH:mm")}</span>
                )}
              </div>
              {r.status === "query" && r.queryMessage && (
                <div className="mt-1.5 rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
                  <strong>Query sent:</strong> {r.queryMessage}
                </div>
              )}
            </div>

            {/* Right: controls */}
            <div className="flex flex-col gap-2 sm:items-end shrink-0">
              {!isCompleted ? (
                <>
                  {/* Ticketing status dropdown */}
                  <div className="flex flex-col gap-1 sm:items-end">
                    {r.requestType === "both" && (
                      <span className="text-xs text-muted-foreground font-medium">Ticketing</span>
                    )}
                    <Select
                      value={r.status}
                      onValueChange={(v) => handleStatusChange(r.id, v as FlightStatus)}
                      disabled={updateStatus.isPending}
                    >
                      <SelectTrigger className="w-40 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTIVE_STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s.value} value={s.value} className="text-xs">
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Cancellation status dropdown — only for 'both' requests */}
                  {r.requestType === "both" && (
                    <div className="flex flex-col gap-1 sm:items-end">
                      <span className="text-xs text-muted-foreground font-medium">Cancellation</span>
                      <Select
                        value={(r.cancellationStatus as CancellationStatus) ?? "pending"}
                        onValueChange={(v) => handleCancellationStatusChange(r.id, v as CancellationStatus)}
                        disabled={updateStatus.isPending}
                      >
                        <SelectTrigger className="w-40 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CANCELLATION_STATUS_OPTIONS.map((s) => (
                            <SelectItem key={s.value} value={s.value} className="text-xs">
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Invoice checkbox */}
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground select-none">
                    <Checkbox
                      checked={r.invoiceAddedToPts ?? false}
                      onCheckedChange={() => toggleInvoice.mutate({ id: r.id, invoiceAddedToPts: !r.invoiceAddedToPts })}
                      disabled={toggleInvoice.isPending}
                    />
                    Invoice added to PTS file
                  </label>

                  {/* Mark Complete button — prominent when invoice is checked */}
                  <Button
                    size="sm"
                    variant={r.invoiceAddedToPts ? "default" : "outline"}
                    className={`h-7 text-xs px-3 ${r.invoiceAddedToPts ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "text-muted-foreground"}`}
                    onClick={() => markComplete(r.id)}
                    disabled={updateStatus.isPending}
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1.5" />
                    Mark Complete
                  </Button>
                </>
              ) : (
                <>
                  {/* Invoice status (read-only for completed) */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox checked={r.invoiceAddedToPts ?? false} disabled />
                    Invoice added to PTS file
                  </div>
                  {/* Reopen button */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs px-3"
                    onClick={() => updateStatus.mutate({ id: r.id, status: "ticketed" })}
                    disabled={updateStatus.isPending}
                  >
                    Reopen
                  </Button>
                </>
              )}

              {/* Delete button */}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs px-2 text-red-500 hover:text-red-700 hover:bg-red-50 ml-auto"
                onClick={() => setConfirmDeleteId(r.id)}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Delete
              </Button>

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
  };

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
            {ACTIVE_STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabs: Active / Completed */}
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active" className="gap-1.5">
            Active
            {activeRequests.length > 0 && (
              <Badge variant="secondary" className="text-xs h-5 px-1.5">{activeRequests.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Completed
            {completedRequests.length > 0 && (
              <Badge variant="secondary" className="text-xs h-5 px-1.5">{completedRequests.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Active tab */}
        <TabsContent value="active" className="mt-4">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredActive.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground text-sm">
                {search || filterStatus !== "all" ? "No requests match your filters." : "No active flight requests."}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredActive.map((r) => renderCard(r, false))}
            </div>
          )}
        </TabsContent>

        {/* Completed tab */}
        <TabsContent value="completed" className="mt-4">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredCompleted.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground text-sm">
                No completed flight requests yet. Use the <strong>Mark Complete</strong> button on active requests once the invoice has been added to PTS.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredCompleted.map((r) => renderCard(r, true))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <Dialog open={confirmDeleteId !== null} onOpenChange={(v) => !v && setConfirmDeleteId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Flight Request</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete this flight request? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDeleteId !== null && deleteRequest.mutate({ id: confirmDeleteId })}
              disabled={deleteRequest.isPending}
            >
              {deleteRequest.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
