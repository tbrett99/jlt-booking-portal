import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ChevronRight, AlertTriangle, Calendar, Loader2, SlidersHorizontal } from "lucide-react";
import { format } from "date-fns";

const STAGES = [
  "New Booking",
  "Creating own PTS file",
  "Not on Topdog",
  "Query",
  "Reimb Docs Missing",
  "Urgent/Reimb",
  "T/O Package",
  "DP",
  "Added to PTS",
  "Commission Claimable",
  "Commission Claimed",
  "Cancelled",
  "Holding Accounts",
];

const STAGES_REQUIRING_PAYMENT_DATE = [
  "Added to PTS",
  "Commission Claimable",
  "Commission Claimed",
  "Holding Accounts",
];

const STAGE_COLORS: Record<string, { bg: string; border: string; dot: string }> = {
  "New Booking": { bg: "#eff6ff", border: "#bfdbfe", dot: "#3b82f6" },
  "Creating own PTS file": { bg: "#eef2ff", border: "#c7d2fe", dot: "#6366f1" },
  "Not on Topdog": { bg: "#fff7ed", border: "#fed7aa", dot: "#f97316" },
  "Query": { bg: "#fefce8", border: "#fef08a", dot: "#eab308" },
  "Reimb Docs Missing": { bg: "#fef2f2", border: "#fecaca", dot: "#ef4444" },
  "Urgent/Reimb": { bg: "#fff1f2", border: "#fecdd3", dot: "#e11d48" },
  "T/O Package": { bg: "#faf5ff", border: "#e9d5ff", dot: "#a855f7" },
  "DP": { bg: "#fdf2f8", border: "#f5d0fe", dot: "#d946ef" },
  "Added to PTS": { bg: "#f0fdf4", border: "#bbf7d0", dot: "#22c55e" },
  "Commission Claimable": { bg: "#ecfdf5", border: "#70FFE8", dot: "#02E6D2" },
  "Commission Claimed": { bg: "#d1fae5", border: "#6ee7b7", dot: "#059669" },
  "Cancelled": { bg: "#f9fafb", border: "#e5e7eb", dot: "#9ca3af" },
  "Holding Accounts": { bg: "#fffbeb", border: "#fde68a", dot: "#d97706" },
};

export default function AdminKanban() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "departure_asc" | "departure_desc" | "agent_az">("newest");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [movingId, setMovingId] = useState<number | null>(null);
  const [pendingMove, setPendingMove] = useState<{ bookingId: number; toStage: string } | null>(null);
  const [guardPaymentDate, setGuardPaymentDate] = useState("");
  const [isSavingGuard, setIsSavingGuard] = useState(false);
  const [queryMove, setQueryMove] = useState<{ bookingId: number } | null>(null);
  const [queryMessage, setQueryMessage] = useState("");
  const utils = trpc.useUtils();

  const { data: bookings = [], isLoading } = trpc.bookings.all.useQuery({});
  const moveStage = trpc.bookings.moveStage.useMutation({
    onSuccess: () => {
      utils.bookings.all.invalidate();
      setMovingId(null);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to move booking");
      setMovingId(null);
    },
  });
  const updateDetails = trpc.bookings.updateAdminFields.useMutation();

  const handleMove = (bookingId: number, newStage: string) => {
    const booking = bookings.find((b) => b.id === bookingId);
    if (
      STAGES_REQUIRING_PAYMENT_DATE.includes(newStage) &&
      booking &&
      !booking.finalSupplierPaymentDate
    ) {
      setPendingMove({ bookingId, toStage: newStage });
      setGuardPaymentDate("");
      return;
    }
    if (newStage === "Query") {
      const firstName = booking?.clientName?.split(" ")[0] ?? "there";
      setQueryMove({ bookingId });
      setQueryMessage(`Hi ${firstName},\n\nWe have a query regarding your booking. Please review the details and respond at your earliest convenience.\n\nThank you,\nJLT Group`);
      return;
    }
    setMovingId(bookingId);
    moveStage.mutate({ bookingId, toStage: newStage });
  };

  const handleSendQueryAndMove = () => {
    if (!queryMove) return;
    setMovingId(queryMove.bookingId);
    moveStage.mutate({ bookingId: queryMove.bookingId, toStage: "Query", queryMessage: queryMessage.trim() || undefined });
    setQueryMove(null);
    setQueryMessage("");
  };

  const handleGuardSaveAndMove = async () => {
    if (!pendingMove || !guardPaymentDate) {
      toast.error("Please enter a Final Supplier Payment Date.");
      return;
    }
    setIsSavingGuard(true);
    try {
      await updateDetails.mutateAsync({
        bookingId: pendingMove.bookingId,
        finalSupplierPaymentDate: new Date(guardPaymentDate),
      });
      setMovingId(pendingMove.bookingId);
      moveStage.mutate({ bookingId: pendingMove.bookingId, toStage: pendingMove.toStage });
      setPendingMove(null);
      setGuardPaymentDate("");
      toast.success("Payment date saved and booking moved.");
    } catch (err: any) {
      toast.error(err.message || "Failed to save payment date");
    } finally {
      setIsSavingGuard(false);
    }
  };

  // Unique agent names for filter dropdown
  const agentNames = Array.from(new Set(bookings.map((b: any) => b.agentName).filter(Boolean))).sort() as string[];

  const filtered = bookings
    .filter((b: any) =>
      (!search ||
        b.clientName.toLowerCase().includes(search.toLowerCase()) ||
        (b.topdogRef ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (b.ptsRef ?? "").toLowerCase().includes(search.toLowerCase())) &&
      (agentFilter === "all" || b.agentName === agentFilter)
    )
    .slice()
    .sort((a: any, b: any) => {
      if (sortBy === "newest") return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
      if (sortBy === "oldest") return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
      if (sortBy === "departure_asc") return new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime();
      if (sortBy === "departure_desc") return new Date(b.departureDate).getTime() - new Date(a.departureDate).getTime();
      if (sortBy === "agent_az") return (a.agentName ?? "").localeCompare(b.agentName ?? "");
      return 0;
    });

  const byStage = STAGES.reduce<Record<string, typeof bookings>>((acc, stage) => {
    acc[stage] = filtered.filter((b) => b.currentStage === stage);
    return acc;
  }, {});

  const pendingBooking = pendingMove ? bookings.find((b) => b.id === pendingMove.bookingId) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold">Booking Pipeline</h1>
            <p className="text-sm text-muted-foreground">{filtered.length} of {bookings.length} bookings</p>
          </div>
          <div className="relative sm:ml-auto sm:w-72">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by client, Topdog ref, PTS ref..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        {/* Filter & Sort bar */}
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border bg-muted/30">
          <SlidersHorizontal size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground mr-1">Sort:</span>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="h-7 text-xs w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="departure_asc">Departure ↑ (soonest)</SelectItem>
              <SelectItem value="departure_desc">Departure ↓ (latest)</SelectItem>
              <SelectItem value="agent_az">Agent A–Z</SelectItem>
            </SelectContent>
          </Select>
          {agentNames.length > 0 && (
            <>
              <span className="text-xs font-medium text-muted-foreground ml-2">Agent:</span>
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="h-7 text-xs w-44">
                  <SelectValue placeholder="All agents" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All agents</SelectItem>
                  {agentNames.map((name) => (
                    <SelectItem key={name} value={name}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {(search || agentFilter !== "all" || sortBy !== "newest") && (
            <button
              onClick={() => { setSearch(""); setAgentFilter("all"); setSortBy("newest"); }}
              className="ml-auto text-xs underline text-muted-foreground hover:text-foreground"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: '#70FFE8' }} />
        </div>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-4 min-w-max">
            {STAGES.map((stage) => {
              const cols = byStage[stage] ?? [];
              const colors = STAGE_COLORS[stage] ?? { bg: "#f9fafb", border: "#e5e7eb", dot: "#9ca3af" };
              return (
                <div
                  key={stage}
                  className="w-72 flex-shrink-0 rounded-xl border-2 overflow-hidden"
                  style={{ background: colors.bg, borderColor: colors.border }}
                >
                  {/* Column header */}
                  <div className="px-3 py-2.5 border-b" style={{ borderColor: colors.border }}>
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: colors.dot }} />
                      <span className="text-xs font-semibold text-foreground">{stage}</span>
                      <span className="ml-auto text-xs font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: colors.dot + '30', color: colors.dot }}>
                        {cols.length}
                      </span>
                    </div>
                  </div>

                  {/* Cards */}
                  <div className="p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-280px)] overflow-y-auto">
                    {cols.map((booking) => {
                      const missingDate = !booking.finalSupplierPaymentDate;
                      return (
                        <div
                          key={booking.id}
                          className="bg-white rounded-lg border p-3 shadow-sm hover:shadow-md transition-shadow"
                          style={{ borderColor: colors.border }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm truncate">{booking.clientName}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                <Calendar size={10} className="inline mr-1 opacity-60" />
                                {format(new Date(booking.departureDate), "dd MMM yyyy")}
                              </p>
                              {booking.topdogRef && (
                                <p className="text-xs text-muted-foreground">TD: {booking.topdogRef}</p>
                              )}
                              {booking.ptsRef && (
                                <p className="text-xs text-muted-foreground">PTS: {booking.ptsRef}</p>
                              )}
                              <div className="flex flex-wrap gap-1 mt-1">
                                {booking.reimbursementsRequired && !booking.reimbursementDocUrl && (
                                  <span className="text-xs px-1.5 py-0.5 rounded"
                                    style={{ background: '#fee2e2', color: '#991b1b' }}>
                                    Docs missing
                                  </span>
                                )}
                                {missingDate && (
                                  <span className="text-xs px-1.5 py-0.5 rounded flex items-center gap-0.5"
                                    style={{ background: '#fef3c7', color: '#92400e' }}>
                                    <AlertTriangle size={9} />
                                    No payment date
                                  </span>
                                )}
                              </div>
                            </div>
                            <Link href={`/bookings/${booking.id}`}>
                              <button className="p-1 rounded hover:bg-muted flex-shrink-0">
                                <ChevronRight size={14} className="text-muted-foreground" />
                              </button>
                            </Link>
                          </div>

                          {/* Move to stage */}
                          <div className="mt-2 pt-2 border-t" style={{ borderColor: colors.border }}>
                            {movingId === booking.id ? (
                              <div className="flex items-center justify-center py-1">
                                <Loader2 size={14} className="animate-spin text-muted-foreground" />
                              </div>
                            ) : (
                              <select
                                className="w-full text-xs border rounded px-2 py-1 bg-white cursor-pointer"
                                value={booking.currentStage}
                                onChange={(e) => handleMove(booking.id, e.target.value)}
                              >
                                {STAGES.map((s) => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {cols.length === 0 && (
                      <div className="flex items-center justify-center h-20">
                        <p className="text-xs text-muted-foreground">No bookings</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Query Message Dialog */}
      {(() => {
        const queryBooking = queryMove ? bookings.find((b) => b.id === queryMove.bookingId) : null;
        return (
          <Dialog open={!!queryMove} onOpenChange={(open) => { if (!open) { setQueryMove(null); setQueryMessage(""); } }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold" style={{ background: '#fefce8', color: '#854d0e' }}>?</span>
                  Send Query to Agent
                </DialogTitle>
                <DialogDescription>
                  {queryBooking && (
                    <>Compose a message for <strong>{queryBooking.clientName}</strong>. It will be posted as a shared note visible to the agent and trigger a query notification email.</>
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 py-2">
                <Label className="text-sm font-medium">Message to Agent</Label>
                <textarea
                  className="w-full min-h-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  value={queryMessage}
                  onChange={(e) => setQueryMessage(e.target.value)}
                  placeholder="Describe the query for the agent..."
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">This will also move the booking to the <strong>Query</strong> stage.</p>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => { setQueryMove(null); setQueryMessage(""); }}>Cancel</Button>
                <Button
                  onClick={handleSendQueryAndMove}
                  disabled={moveStage.isPending}
                  style={{ background: '#eab308', color: '#fff' }}
                >
                  {moveStage.isPending ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                  Send &amp; Move to Query
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Payment Date Guard Dialog */}
      <Dialog open={!!pendingMove} onOpenChange={(open) => { if (!open) { setPendingMove(null); setGuardPaymentDate(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500" />
              Final Supplier Payment Date Required
            </DialogTitle>
            <DialogDescription>
              {pendingBooking && (
                <>
                  <strong>{pendingBooking.clientName}</strong> cannot be moved to{" "}
                  <strong>"{pendingMove?.toStage}"</strong> without a Final Supplier Payment Date.
                  Enter it below to continue.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-sm">Final Supplier Payment Date</Label>
            <Input
              type="date"
              value={guardPaymentDate}
              onChange={(e) => setGuardPaymentDate(e.target.value)}
              className="h-9"
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setPendingMove(null); setGuardPaymentDate(""); }}>
              Cancel
            </Button>
            <Button
              onClick={handleGuardSaveAndMove}
              disabled={isSavingGuard || !guardPaymentDate}
              style={{ background: '#70FFE8', color: '#414141' }}
            >
              {isSavingGuard ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
              Save &amp; Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
