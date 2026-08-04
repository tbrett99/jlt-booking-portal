import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plane, Plus, Loader2, TrendingUp, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { FlightRequestForm } from "@/components/FlightRequestForm";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export default function AgentFlightRequests() {
  const utils = trpc.useUtils();
  const [formOpen, setFormOpen] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);
  const [selectedClientName, setSelectedClientName] = useState<string>("");

  // Accept/decline dialog state
  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false);
  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [priceIncreaseTargetId, setPriceIncreaseTargetId] = useState<number | null>(null);
  const [priceIncreaseTarget, setPriceIncreaseTarget] = useState<{
    clientName: string;
    pnr: string;
    originalPrice: number;
    newPrice: number;
    note?: string;
  } | null>(null);

  const { data: requests, isLoading } = trpc.flightRequests.myRequests.useQuery(undefined, {
    staleTime: 0,
  });

  const { data: myBookings } = trpc.bookings.myBookings.useQuery(undefined, {
    staleTime: 30_000,
  });

  const acceptPriceIncrease = trpc.flightRequests.acceptPriceIncrease.useMutation({
    onSuccess: () => {
      utils.flightRequests.myRequests.invalidate();
      setAcceptDialogOpen(false);
      setPriceIncreaseTargetId(null);
      setPriceIncreaseTarget(null);
      toast.success("Price increase accepted. JLT will proceed with ticketing.");
    },
    onError: (err) => toast.error(err.message),
  });

  const declinePriceIncrease = trpc.flightRequests.declinePriceIncrease.useMutation({
    onSuccess: () => {
      utils.flightRequests.myRequests.invalidate();
      setDeclineDialogOpen(false);
      setPriceIncreaseTargetId(null);
      setPriceIncreaseTarget(null);
      toast.success("Price increase declined. JLT has been notified.");
    },
    onError: (err) => toast.error(err.message),
  });

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; color: string; bg: string }> = {
      pending:                { label: "Pending",          color: "#92400e", bg: "#fef3c7" },
      ticketed:               { label: "Ticketed",         color: "#065f46", bg: "#d1fae5" },
      cancelled:              { label: "Cancelled",        color: "#991b1b", bg: "#fee2e2" },
      query:                  { label: "Query",            color: "#1e40af", bg: "#dbeafe" },
      price_increase_pending: { label: "Price Increase",   color: "#7c2d12", bg: "#ffedd5" },
    };
    const s = map[status] ?? { label: status, color: "#414141", bg: "#f3f4f6" };
    return (
      <span
        style={{
          background: s.bg,
          color: s.color,
          borderRadius: "4px",
          padding: "2px 8px",
          fontSize: "11px",
          fontWeight: 700,
          textTransform: "uppercase",
        }}
      >
        {s.label}
      </span>
    );
  };

  const typeLabel = (t: string) =>
    t === "both" ? "Ticketing & Cancellation" : t.charAt(0).toUpperCase() + t.slice(1);

  function handleNewRequest() {
    if (selectedBookingId) setFormOpen(true);
  }

  function openAcceptDialog(r: any) {
    setPriceIncreaseTargetId(r.id);
    setPriceIncreaseTarget({
      clientName: r.clientName,
      pnr: r.pnr,
      originalPrice: parseFloat(String(r.flightCost ?? 0)),
      newPrice: parseFloat(String((r as any).priceIncreaseAmount ?? 0)),
      note: (r as any).priceIncreaseNote ?? undefined,
    });
    setAcceptDialogOpen(true);
  }

  function openDeclineDialog(r: any) {
    setPriceIncreaseTargetId(r.id);
    setPriceIncreaseTarget({
      clientName: r.clientName,
      pnr: r.pnr,
      originalPrice: parseFloat(String(r.flightCost ?? 0)),
      newPrice: parseFloat(String((r as any).priceIncreaseAmount ?? 0)),
      note: (r as any).priceIncreaseNote ?? undefined,
    });
    setDeclineDialogOpen(true);
  }

  // Requests with price increase pending — shown as urgent banner at top
  const priceIncreasePending = (requests ?? []).filter((r) => r.status === "price_increase_pending");

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Plane className="h-5 w-5 text-primary" />
            Flight Requests
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Submit and track flight ticketing or cancellation requests.
          </p>
        </div>
      </div>

      {/* Urgent price increase banners */}
      {priceIncreasePending.length > 0 && (
        <div className="space-y-3">
          {priceIncreasePending.map((r) => (
            <div
              key={r.id}
              className="rounded-lg border-2 border-orange-400 bg-orange-50 px-4 py-4 space-y-3"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-orange-900">
                    Action Required: Flight Price Increase
                  </p>
                  <p className="text-sm text-orange-800 mt-0.5">
                    <strong>{r.clientName}</strong> · PNR: <strong>{r.pnr}</strong>
                  </p>
                  <div className="mt-1.5 text-sm text-orange-800 space-y-0.5">
                    <p>
                      Original price: <strong>£{parseFloat(String(r.flightCost ?? 0)).toFixed(2)}</strong>
                      {" → "}
                      New price: <strong>£{parseFloat(String((r as any).priceIncreaseAmount ?? 0)).toFixed(2)}</strong>
                      {" "}
                      <span className="text-orange-600 font-semibold">
                        (+£{(parseFloat(String((r as any).priceIncreaseAmount ?? 0)) - parseFloat(String(r.flightCost ?? 0))).toFixed(2)})
                      </span>
                    </p>
                    {(r as any).priceIncreaseNote && (
                      <p className="text-xs text-orange-700">Note from JLT: {(r as any).priceIncreaseNote}</p>
                    )}
                  </div>
                  <p className="text-xs text-orange-700 mt-2">
                    Please accept or decline the new price. Ticketing cannot proceed until you respond.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pl-8">
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
                  onClick={() => openAcceptDialog(r)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Accept Price Increase
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-400 text-red-700 hover:bg-red-50 h-8 text-xs"
                  onClick={() => openDeclineDialog(r)}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1.5" />
                  Decline
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Request Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Submit a New Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="bookingPicker">Select Booking</Label>
            <Select
              value={selectedBookingId ? String(selectedBookingId) : ""}
              onValueChange={(v) => {
                const id = Number(v);
                setSelectedBookingId(id);
                const b = myBookings?.find((bk) => bk.id === id);
                setSelectedClientName(b?.clientName ?? "");
              }}
            >
              <SelectTrigger id="bookingPicker" className="w-full">
                <SelectValue placeholder="Choose a booking…" />
              </SelectTrigger>
              <SelectContent>
                {(myBookings ?? [])
                  .filter((b) => b.currentStage !== "Cancelled")
                  .map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.clientName}
                      {b.ptsRef ? ` — ${b.ptsRef}` : ""}
                      {b.topdogRef ? ` (TD: ${b.topdogRef})` : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            disabled={!selectedBookingId}
            onClick={handleNewRequest}
            className="flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            New Flight Request
          </Button>
        </CardContent>
      </Card>

      {/* Requests List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !requests || requests.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            No flight requests yet. Use the form above to submit one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <Card
              key={r.id}
              className={r.status === "price_increase_pending" ? "border-orange-300 bg-orange-50/40" : ""}
            >
              <CardContent className="pt-4 pb-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm">
                      <Badge
                        variant="outline"
                        className={`text-xs font-semibold mr-1 ${
                          r.requestType === "cancellation"
                            ? "border-orange-400 bg-orange-50 text-orange-700"
                            : r.requestType === "both"
                            ? "border-purple-400 bg-purple-50 text-purple-700"
                            : ""
                        }`}
                      >
                        {typeLabel(r.requestType)}
                      </Badge>
                      — {r.supplier}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.clientName}
                      {r.ptsRef ? ` · PTS: ${r.ptsRef}` : ""}
                      {r.topdogRef ? ` · TD: ${r.topdogRef}` : ""}
                    </p>
                  </div>
                  {statusBadge(r.status)}
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
                  <span>PNR: <strong className="text-foreground">{r.pnr}</strong></span>
                  <span>Departure: <strong className="text-foreground">{format(new Date(r.departureDate), "dd MMM yyyy")}</strong></span>
                  <span>Deadline: <strong className="text-foreground">{format(new Date(r.ticketingDeadline), "dd MMM yyyy")}</strong></span>
                  <span>Submitted: {format(new Date(r.createdAt), "dd MMM yyyy")}</span>
                </div>
                {r.status === "query" && r.queryMessage && (
                  <div className="rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
                    <strong>Query from JLT:</strong> {r.queryMessage}
                  </div>
                )}
                {r.status === "price_increase_pending" && (
                  <div className="rounded bg-orange-50 border border-orange-300 px-3 py-2 text-xs text-orange-800 space-y-1.5">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <TrendingUp className="h-3.5 w-3.5" />
                      Price increase — action required
                    </div>
                    <p>
                      Original: <strong>£{parseFloat(String(r.flightCost ?? 0)).toFixed(2)}</strong>
                      {" → "}
                      New: <strong>£{parseFloat(String((r as any).priceIncreaseAmount ?? 0)).toFixed(2)}</strong>
                    </p>
                    <div className="flex gap-2 mt-1">
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs"
                        onClick={() => openAcceptDialog(r)}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-400 text-red-700 hover:bg-red-50 h-7 text-xs"
                        onClick={() => openDeclineDialog(r)}
                      >
                        <XCircle className="h-3 w-3 mr-1" />
                        Decline
                      </Button>
                    </div>
                  </div>
                )}
                {/* Show accepted price increase audit trail */}
                {(r as any).priceIncreaseAcceptedAt && (
                  <div className="rounded bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
                    <strong>Price increase accepted</strong> on {format(new Date((r as any).priceIncreaseAcceptedAt), "dd MMM yyyy HH:mm")}
                    {(r as any).priceIncreaseAmount && (
                      <span> — agreed price: <strong>£{parseFloat(String((r as any).priceIncreaseAmount)).toFixed(2)}</strong></span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Flight Request Form Dialog */}
      {selectedBookingId && (
        <FlightRequestForm
          open={formOpen}
          onOpenChange={setFormOpen}
          bookingId={selectedBookingId}
          clientName={selectedClientName}
          onSuccess={() => setSelectedBookingId(null)}
        />
      )}

      {/* Accept Price Increase Dialog */}
      <Dialog open={acceptDialogOpen} onOpenChange={(v) => !v && setAcceptDialogOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Accept Price Increase
            </DialogTitle>
            <DialogDescription>
              By accepting, you confirm that you agree to the new flight price. JLT will proceed with ticketing at the new price.
            </DialogDescription>
          </DialogHeader>
          {priceIncreaseTarget && (
            <div className="rounded-lg bg-orange-50 border border-orange-200 px-4 py-3 space-y-1 text-sm">
              <p><strong>Client:</strong> {priceIncreaseTarget.clientName}</p>
              <p><strong>PNR:</strong> {priceIncreaseTarget.pnr}</p>
              <p>
                <strong>Original price:</strong> £{priceIncreaseTarget.originalPrice.toFixed(2)}
                {" → "}
                <strong>New price:</strong> £{priceIncreaseTarget.newPrice.toFixed(2)}
                {" "}
                <span className="text-orange-700 font-semibold">
                  (+£{(priceIncreaseTarget.newPrice - priceIncreaseTarget.originalPrice).toFixed(2)})
                </span>
              </p>
              {priceIncreaseTarget.note && (
                <p className="text-xs text-muted-foreground">Note: {priceIncreaseTarget.note}</p>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            This acceptance will be logged as a written record on the booking.
          </p>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setAcceptDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => priceIncreaseTargetId && acceptPriceIncrease.mutate({ id: priceIncreaseTargetId })}
              disabled={acceptPriceIncrease.isPending}
            >
              {acceptPriceIncrease.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
              Confirm Acceptance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decline Price Increase Dialog */}
      <Dialog open={declineDialogOpen} onOpenChange={(v) => !v && setDeclineDialogOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <XCircle className="h-4 w-4" />
              Decline Price Increase
            </DialogTitle>
            <DialogDescription>
              Please read the important information below before declining.
            </DialogDescription>
          </DialogHeader>
          {priceIncreaseTarget && (
            <div className="rounded-lg bg-orange-50 border border-orange-200 px-4 py-3 space-y-1 text-sm">
              <p><strong>Client:</strong> {priceIncreaseTarget.clientName}</p>
              <p><strong>PNR:</strong> {priceIncreaseTarget.pnr}</p>
              <p>
                <strong>Original price:</strong> £{priceIncreaseTarget.originalPrice.toFixed(2)}
                {" → "}
                <strong>New price:</strong> £{priceIncreaseTarget.newPrice.toFixed(2)}
              </p>
            </div>
          )}
          <div className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 space-y-2 text-sm text-amber-900">
            <p className="font-semibold">⚠ Please read before declining</p>
            <p className="text-xs">
              This price increase is due to <strong>taxes and surcharges</strong>, which are not guaranteed at the point of holding ITX fares. These costs are applied by the airline/supplier at the time of ticketing and are outside JLT’s control.
            </p>
            <p className="text-xs">
              <strong>Please be aware:</strong> rebooking a different flight is unlikely to result in a lower price, as the same taxes and surcharges will apply.
            </p>
            <p className="text-xs font-semibold">If you decline:</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>Your <strong>held flight will be cancelled</strong>.</li>
              <li>You will need to <strong>rebook an alternative flight</strong> yourself.</li>
              <li>If ticketing is required on the new flight, you will need to <strong>submit a new ticketing request</strong>.</li>
              <li>A <strong>new PTS file will need to be created</strong> and new PTS booking fees will apply.</li>
            </ul>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDeclineDialogOpen(false)}>
              Go Back
            </Button>
            <Button
              variant="destructive"
              onClick={() => priceIncreaseTargetId && declinePriceIncrease.mutate({ id: priceIncreaseTargetId })}
              disabled={declinePriceIncrease.isPending}
            >
              {declinePriceIncrease.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <XCircle className="h-4 w-4 mr-1.5" />}
              I Understand — Decline & Request Cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
