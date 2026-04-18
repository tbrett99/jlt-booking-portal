import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Link } from "wouter";
import { AlertCircle, Calendar, CheckCircle2, User, Square, CheckSquare, CalendarClock, Minus, Zap } from "lucide-react";
import { format, formatDistanceToNow, isPast } from "date-fns";
import CopyableRef from "@/components/CopyableRef";

function MoveDatePopover({ bookingId, currentDate, onSuccess }: {
  bookingId: number;
  currentDate?: string | Date | null;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dateValue, setDateValue] = useState(() => {
    if (!currentDate) return "";
    const d = new Date(currentDate);
    return d.toISOString().split("T")[0];
  });

  const updateAdminFields = trpc.bookings.updateAdminFields.useMutation({
    onSuccess: () => {
      toast.success("Payment date updated");
      setOpen(false);
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  function handleSave() {
    if (!dateValue) { toast.error("Please select a date"); return; }
    updateAdminFields.mutate({
      bookingId,
      finalSupplierPaymentDate: new Date(dateValue),
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
          title="Move payment date"
        >
          <CalendarClock size={13} />
          Move Date
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4 space-y-3" align="end">
        <div>
          <p className="text-sm font-semibold">Move Final Payment Date</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Set a new date to be reminded when this booking is ready to claim.
          </p>
        </div>
        {currentDate && (
          <p className="text-xs text-muted-foreground">
            Current: <span className="font-medium text-foreground">
              {format(new Date(currentDate), "dd MMM yyyy")}
            </span>
          </p>
        )}
        <div className="space-y-1">
          <label className="text-xs font-medium">New date</label>
          <Input
            type="date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white"
            onClick={handleSave}
            disabled={updateAdminFields.isPending}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function buildShortFundsMessage(booking: { id: number; clientName: string; agentName?: string; ptsRef?: string | null; topdogRef?: string | null } | null) {
  if (!booking) return "";
  const ref = booking.ptsRef
    ? ` (PTS Ref: ${booking.ptsRef})`
    : booking.topdogRef
    ? ` (Topdog Ref: ${booking.topdogRef})`
    : ` (#${booking.id})`;
  return `Hi ${booking.agentName ?? 'there'},\n\nWe are reviewing the commission for your booking for ${booking.clientName}${ref} and it appears the file is currently short of funds.\n\nCould you please review the booking and ensure all client payments are up to date? If you have any questions, please do not hesitate to get in touch.\n\nThe JLT Group Team`;
}

function ShortFundsDialog({ booking, onClose }: {
  booking: { id: number; clientName: string; agentName?: string; ptsRef?: string | null; topdogRef?: string | null } | null;
  onClose: () => void;
}) {
  const [message, setMessage] = useState(() => buildShortFundsMessage(booking));

  // Reset message whenever a new booking is opened
  useEffect(() => {
    if (booking) setMessage(buildShortFundsMessage(booking));
  }, [booking?.id]);
  const sendShortFunds = trpc.commissionDue.sendShortFundsMessage.useMutation({
    onSuccess: () => { toast.success("Message sent to agent"); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  if (!booking) return null;
  return (
    <Dialog open={!!booking} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Short of Funds</span>
            Notify Agent
          </DialogTitle>
          <DialogDescription>
            This message will be sent to the agent by email and in-app notification, and posted as a note on the booking.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Message to agent</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={9}
              className="text-sm font-mono"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-red-600 hover:bg-red-700 text-white"
            disabled={!message.trim() || sendShortFunds.isPending}
            onClick={() => sendShortFunds.mutate({ bookingId: booking.id, message })}
          >
            {sendShortFunds.isPending ? "Sending..." : "Send Message"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CommissionDue() {
  const { data: bookings, isLoading, refetch } = trpc.commissionDue.list.useQuery();
  const [search, setSearch] = useState("");
  const [pastDepartureOnly, setPastDepartureOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [shortFundsBooking, setShortFundsBooking] = useState<{ id: number; clientName: string; agentName?: string; ptsRef?: string | null; topdogRef?: string | null } | null>(null);
  // Pre-auth VAT dialog state
  const [preAuthBooking, setPreAuthBooking] = useState<{ id: number; clientName: string } | null>(null);
  const [vatInput, setVatInput] = useState("");

  const moveStage = trpc.bookings.moveStage.useMutation({
    onSuccess: () => { refetch(); toast.success("Booking moved"); },
    onError: (e) => toast.error(e.message),
  });

  const bulkMoveStage = trpc.bookings.bulkMoveStage.useMutation({
    onSuccess: (data) => {
      refetch();
      setSelectedIds(new Set());
      const skipped = data.total - data.succeeded;
      if (skipped > 0) {
        toast.success(`${data.succeeded} booking${data.succeeded !== 1 ? "s" : ""} moved. ${skipped} skipped (missing payment date).`);
      } else {
        toast.success(`${data.succeeded} booking${data.succeeded !== 1 ? "s" : ""} moved successfully.`);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    let list = bookings ?? [];
    if (pastDepartureOnly) {
      list = list.filter((b) => b.departureDate && isPast(new Date(b.departureDate)));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (b) =>
          b.clientName.toLowerCase().includes(q) ||
          ((b as any).agentName ?? "").toLowerCase().includes(q) ||
          (b.topdogRef ?? "").toLowerCase().includes(q) ||
          (b.ptsRef ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [bookings, pastDepartureOnly, search]);

  const allSelected = filtered.length > 0 && filtered.every((b) => selectedIds.has(b.id));
  const someSelected = selectedIds.size > 0;

  function toggleAll() {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((b) => b.id)));
  }

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleBulkMove(toStage: string) {
    bulkMoveStage.mutate({ bookingIds: Array.from(selectedIds), toStage });
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-muted rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Commission Due</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Bookings where the final supplier payment date has passed and commission is ready to be reviewed
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by client, agent, Topdog or PTS ref…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm h-9"
        />
        <Button
          variant={pastDepartureOnly ? "default" : "outline"}
          size="sm"
          className={`gap-2 ${pastDepartureOnly ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-500" : ""}`}
          onClick={() => setPastDepartureOnly((v) => !v)}
        >
          <Calendar size={14} />
          Past departure only
        </Button>
        {filtered.length > 0 && (
          <button
            onClick={toggleAll}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground ml-auto"
          >
            {allSelected
              ? <CheckSquare size={15} className="text-amber-500" />
              : <Square size={15} />}
            {allSelected ? "Deselect all" : `Select all ${filtered.length}`}
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <span className="text-sm font-medium text-amber-800">
            {selectedIds.size} booking{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <Button
              size="sm"
              className="h-8 bg-[#70FFE8] text-[#414141] hover:bg-[#02E6D2]"
              disabled={bulkMoveStage.isPending}
              onClick={() => handleBulkMove("Commission Claimable")}
            >
              <CheckCircle2 size={14} className="mr-1.5" />
              Move to Commission Claimable
            </Button>
            <Button
              size="sm"
              className="h-8 bg-[#414141] text-white hover:bg-[#2a2a2a]"
              disabled={bulkMoveStage.isPending}
              onClick={() => handleBulkMove("Commission Claimed")}
            >
              <CheckCircle2 size={14} className="mr-1.5" />
              Move to Commission Claimed
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-amber-800"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {!filtered || filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-3" />
            <h3 className="font-semibold text-lg">All clear</h3>
            <p className="text-muted-foreground text-sm mt-1">
              {search || pastDepartureOnly
                ? "No bookings match your filters."
                : "No bookings are currently overdue for commission review."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              <strong>{filtered.length}</strong> booking{filtered.length !== 1 ? "s" : ""} shown
              {(bookings?.length ?? 0) !== filtered.length && ` (${bookings?.length} total)`}
            </span>
          </div>

          {filtered.map((booking) => {
            const isSelected = selectedIds.has(booking.id);
            const departed = booking.departureDate ? isPast(new Date(booking.departureDate)) : false;
            return (
              <Card
                key={booking.id}
                className={`border-l-4 transition-shadow ${isSelected ? "border-l-amber-500 ring-1 ring-amber-300" : "border-l-amber-400"} hover:shadow-md`}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleOne(booking.id)}
                      className="flex-shrink-0 self-start mt-0.5"
                      title="Select booking"
                    >
                      {isSelected
                        ? <CheckSquare size={17} className="text-amber-500" />
                        : <Square size={17} className="text-muted-foreground" />}
                    </button>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/bookings/${booking.id}`}>
                          <span className="font-semibold text-foreground hover:text-[#02E6D2] cursor-pointer">
                            {booking.clientName}
                          </span>
                        </Link>
                        <Badge variant="outline" className="text-xs">#{booking.id}</Badge>
                        <Badge className="text-xs bg-[#414141] text-white">{booking.currentStage}</Badge>
                        {(booking as any).commissionPreAuthorised && (
                          <Badge className="text-xs bg-emerald-100 text-emerald-800 border border-emerald-300 gap-1 flex items-center">
                            <Zap size={10} />
                            Pre-Auth
                          </Badge>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {(booking as any).agentName ?? "Unknown Agent"}
                        </span>
                        <span className={`flex items-center gap-1 ${departed ? "text-red-600 font-medium" : ""}`}>
                          <Calendar className="w-3 h-3" />
                          Departure: {format(new Date(booking.departureDate), "dd MMM yyyy")}
                          {departed && <span className="ml-0.5">(past)</span>}
                        </span>
                        {booking.finalSupplierPaymentDate && (
                          <span className="flex items-center gap-1 text-amber-700 font-medium">
                            <AlertCircle className="w-3 h-3" />
                            Payment due: {format(new Date(booking.finalSupplierPaymentDate), "dd MMM yyyy")}
                            {" "}({formatDistanceToNow(new Date(booking.finalSupplierPaymentDate), { addSuffix: true })})
                          </span>
                        )}
                        {booking.topdogRef && (
                          <span className="flex items-center gap-1">
                            Topdog: <CopyableRef value={booking.topdogRef} label="Topdog ref" />
                          </span>
                        )}
                        {booking.ptsRef && (
                          <span className="flex items-center gap-1">
                            PTS: <CopyableRef value={booking.ptsRef} label="PTS ref" />
                          </span>
                        )}
                        {booking.expectedCommission && (
                          <span>Commission: <strong>£{Number(booking.expectedCommission).toFixed(2)}</strong></span>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs border-red-300 text-red-700 hover:bg-red-50"
                        title="File is short of funds — notify agent"
                        onClick={() => setShortFundsBooking({ id: booking.id, clientName: booking.clientName, agentName: (booking as any).agentName, ptsRef: booking.ptsRef, topdogRef: booking.topdogRef })}
                      >
                        <Minus size={13} />
                        Minus
                      </Button>
                      <MoveDatePopover
                        bookingId={booking.id}
                        currentDate={booking.finalSupplierPaymentDate}
                        onSuccess={refetch}
                      />                      <Button
                        size="sm"
                        className="bg-[#70FFE8] text-[#414141] hover:bg-[#02E6D2] h-8"
                        onClick={() => {
                          if ((booking as any).commissionPreAuthorised) {
                            // Pre-auth: prompt for VAT before auto-claiming
                            setPreAuthBooking({ id: booking.id, clientName: booking.clientName });
                            setVatInput("");
                          } else {
                            moveStage.mutate({ bookingId: booking.id, toStage: "Commission Claimable" });
                          }
                        }}
                        disabled={moveStage.isPending || bulkMoveStage.isPending}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1.5" />
                        {(booking as any).commissionPreAuthorised ? "Auto-Claim" : "Mark Claimable"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <ShortFundsDialog booking={shortFundsBooking} onClose={() => setShortFundsBooking(null)} />

      {/* Pre-Auth VAT Dialog */}
      <Dialog open={!!preAuthBooking} onOpenChange={(v) => !v && setPreAuthBooking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap size={16} className="text-emerald-600" />
              Auto-Claim Commission
            </DialogTitle>
            <DialogDescription>
              This booking has pre-authorisation enabled. The commission will be automatically claimed and moved directly to <strong>Commission Claimed</strong> — the agent will not need to do anything.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm font-medium text-foreground">
              Booking: <span className="text-muted-foreground">{preAuthBooking?.clientName}</span>
            </p>
            <div className="space-y-1.5">
              <Label className="text-sm">VAT Amount (£) — leave blank if not applicable</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 12.50"
                value={vatInput}
                onChange={(e) => setVatInput(e.target.value)}
                className="h-9"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreAuthBooking(null)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={moveStage.isPending}
              onClick={() => {
                if (!preAuthBooking) return;
                const vat = vatInput.trim() !== "" ? parseFloat(vatInput) : null;
                moveStage.mutate(
                  { bookingId: preAuthBooking.id, toStage: "Commission Claimable", vatAmount: vat },
                  { onSuccess: () => setPreAuthBooking(null) }
                );
              }}
            >
              {moveStage.isPending ? "Processing..." : "Confirm & Auto-Claim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
