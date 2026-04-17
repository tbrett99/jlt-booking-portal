import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle, Clock, Banknote, Lock, AlertCircle, TrendingUp, ChevronRight, Download, FileSpreadsheet } from "lucide-react";
import { Link } from "wouter";

type BookingType = "lapland" | "cruise" | "disney" | "other";

const BOOKING_TYPE_LABELS: Record<BookingType, string> = {
  lapland: "🎅 Lapland",
  cruise: "🚢 Cruise",
  disney: "🏰 Disney",
  other: "✈️ Other",
};

type BookingWithClaim = {
  id: number;
  clientName: string;
  departureDate: Date | string;
  currentStage: string;
  expectedCommission: number | null;
  claim: {
    id: number;
    status: string;
    claimedAt: Date | string;
    paidAt: Date | string | null;
    bookingType?: string | null;
  } | null;
};

function fmt(d: Date | string | null | undefined) {
  if (!d) return "—";
  return format(new Date(d), "dd/MM/yyyy");
}

function sumCommission(list: BookingWithClaim[]) {
  return list.reduce((acc, b) => acc + Number(b.expectedCommission ?? 0), 0);
}

export default function AgentCommissions() {
  const utils = trpc.useUtils();
  const { data: bookings, isLoading } = trpc.commissionClaims.myCommissions.useQuery();

  const [claimTarget, setClaimTarget] = useState<BookingWithClaim | null>(null);
  const [selectedType, setSelectedType] = useState<BookingType>("other");
  const [grossAmount, setGrossAmount] = useState<string>("");
  const [markPaidIds, setMarkPaidIds] = useState<number[]>([]);

  const { data: remittanceLines } = trpc.remittance.getMyRemittances.useQuery();

  const markAgentPaidMutation = trpc.commissionClaims.markAgentPaid.useMutation({
    onSuccess: () => {
      toast.success("Marked as paid!");
      setMarkPaidIds([]);
      utils.commissionClaims.myCommissions.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const claimMutation = trpc.commissionClaims.claim.useMutation({
    onSuccess: () => {
      toast.success("Commission claimed successfully!");
      setClaimTarget(null);
      utils.commissionClaims.myCommissions.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-[#02E6D2]" />
      </div>
    );
  }

  const all = (bookings ?? []) as BookingWithClaim[];

  const notReady = all.filter(
    (b) =>
      !b.claim &&
      b.currentStage !== "Commission Claimable" &&
      b.currentStage !== "Commission Claimed" &&
      b.currentStage !== "Cancelled"
  );
  const claimable = all.filter((b) => !b.claim && b.currentStage === "Commission Claimable");
  const processing = all.filter((b) => b.claim && b.claim.status === "processing");
  const awaitingPayment = all.filter((b) => b.claim && b.claim.status === "awaiting_payment");
  const paid = all.filter((b) => b.claim && b.claim.status === "paid");

  // Bookings missing a commission amount (active, not cancelled)
  const missingCommission = notReady.filter((b) => !b.expectedCommission);

  // Monetary totals
  const pendingTotal = sumCommission(notReady);
  const claimableTotal = sumCommission(claimable);
  const processingTotal = sumCommission(processing);
  const awaitingTotal = sumCommission(awaitingPayment);
  const paidTotal = sumCommission(paid);

  const openClaimDialog = (booking: BookingWithClaim) => {
    setSelectedType("other");
    // Pre-fill with the booking's existing expected commission if set
    setGrossAmount(booking.expectedCommission != null ? String(Number(booking.expectedCommission).toFixed(2)) : "");
    setClaimTarget(booking);
  };

  const submitClaim = () => {
    if (!claimTarget) return;
    const amount = parseFloat(grossAmount);
    if (!grossAmount || isNaN(amount) || amount <= 0) {
      toast.error("Please enter your expected gross commission amount");
      return;
    }
    claimMutation.mutate({ bookingId: claimTarget.id, bookingType: selectedType, grossAmount: amount });
  };

  const BookingRow = ({
    booking,
    showClaim,
    showStatus,
    highlightMissing,
  }: {
    booking: BookingWithClaim;
    showClaim?: boolean;
    showStatus?: boolean;
    highlightMissing?: boolean;
  }) => (
    <div className={`flex items-center justify-between p-4 border rounded-lg bg-card hover:bg-accent/30 transition-colors ${
      highlightMissing && !booking.expectedCommission ? "border-amber-300" : "border-border"
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-foreground truncate">{booking.clientName}</p>
          {highlightMissing && !booking.expectedCommission && (
            <span className="flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full"
              style={{ background: '#fef3c7', color: '#92400e' }}>
              <AlertCircle size={10} /> No amount set
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">Departure: {fmt(booking.departureDate)}</p>
        {booking.expectedCommission != null ? (
          <p className="text-sm font-semibold mt-0.5" style={{ color: '#065f46' }}>
            £{Number(booking.expectedCommission).toFixed(2)}
          </p>
        ) : (
          <Link href={`/bookings/${booking.id}`}>
            <p className="text-sm text-[#02E6D2] italic mt-0.5 hover:underline cursor-pointer">Add your expected commission →</p>
          </Link>
        )}
        {booking.claim?.claimedAt && (
          <p className="text-xs text-muted-foreground">Claimed: {fmt(booking.claim.claimedAt)}</p>
        )}
        {booking.claim?.bookingType && (
          <p className="text-xs text-muted-foreground">
            Type: {BOOKING_TYPE_LABELS[booking.claim.bookingType as BookingType] ?? booking.claim.bookingType}
          </p>
        )}
        {booking.claim?.paidAt && (
          <p className="text-xs text-emerald-600 font-medium">Processed: {fmt(booking.claim.paidAt)}</p>
        )}
      </div>
      <div className="flex items-center gap-3 ml-4 flex-shrink-0">
        {showStatus && (
          <Badge
            variant="outline"
            className={
              booking.claim?.status === "paid"
                ? "border-emerald-500 text-emerald-600"
                : booking.claim?.status === "awaiting_payment"
                ? "border-amber-500 text-amber-600"
                : booking.claim?.status === "processing"
                ? "border-orange-500 text-orange-600"
                : booking.currentStage === "Commission Claimable"
                ? "border-[#02E6D2] text-[#02E6D2]"
                : "border-muted text-muted-foreground"
            }
          >
            {booking.claim?.status === "paid"
              ? "Paid"
              : booking.claim?.status === "awaiting_payment"
              ? "Awaiting Payment"
              : booking.claim?.status === "processing"
              ? "Processing"
              : booking.currentStage}
          </Badge>
        )}
        {showClaim && (
          <Button
            size="sm"
            className="bg-[#02E6D2] hover:bg-[#70FFE8] text-[#414141] font-semibold"
            onClick={() => openClaimDialog(booking)}
          >
            Claim Commission
          </Button>
        )}
        <Link href={`/bookings/${booking.id}`}>
          <button className="p-1 rounded hover:bg-muted">
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Commissions</h1>
        <p className="text-muted-foreground mt-1">Track and claim your commission for completed bookings.</p>
      </div>

      {/* Missing commission prompt */}
      {missingCommission.length > 0 && (
        <div className="rounded-xl border-l-4 p-4 flex items-start gap-3"
          style={{ borderLeftColor: '#f59e0b', background: '#fffbeb' }}>
          <AlertCircle size={18} style={{ color: '#f59e0b' }} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm" style={{ color: '#92400e' }}>
              {missingCommission.length} booking{missingCommission.length > 1 ? "s are" : " is"} missing a commission amount
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#92400e', opacity: 0.8 }}>
              Open each booking to add your expected commission amount. This helps us track your earnings accurately.
            </p>
            <p className="text-xs mt-1 font-medium" style={{ color: '#92400e' }}>
              {missingCommission.map((b) => b.clientName).join(", ")}
            </p>
          </div>
        </div>
      )}

      {/* Financial summary bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-2">
              <Lock className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-xl font-bold truncate">
                  {pendingTotal > 0 ? `£${pendingTotal.toFixed(2)}` : <span className="text-muted-foreground text-base">—</span>}
                </p>
                <p className="text-xs text-muted-foreground">{notReady.length} booking{notReady.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#02E6D2]">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-[#02E6D2] mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Ready to Claim</p>
                <p className="text-xl font-bold text-[#02E6D2] truncate">
                  {claimableTotal > 0 ? `£${claimableTotal.toFixed(2)}` : <span className="text-muted-foreground text-base">—</span>}
                </p>
                <p className="text-xs text-muted-foreground">{claimable.length} booking{claimable.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-400">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Awaiting Payment</p>
                <p className="text-xl font-bold text-amber-500 truncate">
                  {awaitingTotal > 0 ? `£${awaitingTotal.toFixed(2)}` : <span className="text-muted-foreground text-base">—</span>}
                </p>
                <p className="text-xs text-muted-foreground">{awaitingPayment.length} booking{awaitingPayment.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-emerald-400">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-2">
              <Banknote className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Total Paid</p>
                <p className="text-xl font-bold text-emerald-500 truncate">
                  {paidTotal > 0 ? `£${paidTotal.toFixed(2)}` : <span className="text-muted-foreground text-base">—</span>}
                </p>
                <p className="text-xs text-muted-foreground">{paid.length} booking{paid.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lifetime earnings callout */}
      {paidTotal > 0 && (
        <div className="rounded-xl p-4 flex items-center gap-3"
          style={{ background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)', border: '1px solid #6ee7b7' }}>
          <TrendingUp size={20} style={{ color: '#059669' }} className="flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm" style={{ color: '#065f46' }}>
              You've earned £{(paidTotal + awaitingTotal).toFixed(2)} in total commissions
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#065f46', opacity: 0.75 }}>
              £{paidTotal.toFixed(2)} paid · £{awaitingTotal.toFixed(2)} awaiting · £{processingTotal.toFixed(2)} processing
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue="claimable">
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          <TabsTrigger value="claimable">
            Ready to Claim
            {claimable.length > 0 && (
              <span className="ml-2 bg-[#02E6D2] text-[#414141] text-xs font-bold rounded-full px-2 py-0.5">
                {claimable.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="processing">
            Processing
            {processing.length > 0 && (
              <span className="ml-2 bg-orange-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                {processing.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="awaiting">
            Awaiting Payment
            {awaitingPayment.length > 0 && (
              <span className="ml-2 bg-amber-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                {awaitingPayment.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="paid">Paid</TabsTrigger>
          <TabsTrigger value="remittances">
            Remittances
            {((remittanceLines?.length ?? 0) > 0) && (
              <span className="ml-2 bg-purple-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                {remittanceLines!.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="not-ready">
            Pending
            {notReady.length > 0 && (
              <span className="ml-2 bg-muted text-muted-foreground text-xs font-bold rounded-full px-2 py-0.5">
                {notReady.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="claimable">
          <p className="text-sm text-muted-foreground mb-4">All suppliers have been paid and you can now claim your commission on these bookings.</p>
          {claimable.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <CheckCircle className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No commissions ready to claim right now.</p>
                <p className="text-sm mt-1">We'll notify you when a booking becomes claimable.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {claimable.length > 1 && (
                <div className="rounded-lg p-3 text-sm flex items-center gap-2"
                  style={{ background: '#ecfdf5', color: '#065f46' }}>
                  <CheckCircle size={14} />
                  <span>You have <strong>£{claimableTotal.toFixed(2)}</strong> ready to claim across {claimable.length} bookings.</span>
                </div>
              )}
              {claimable.map((b) => (
                <BookingRow key={b.id} booking={b} showClaim />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="processing">
          <p className="text-sm text-muted-foreground mb-4">You have requested to claim commission on these bookings. We'll process this for you shortly.</p>
          {processing.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Clock className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No commissions currently being processed.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {processing.length > 1 && (
                <div className="rounded-lg p-3 text-sm flex items-center gap-2"
                  style={{ background: '#fff7ed', color: '#9a3412' }}>
                  <Clock size={14} />
                  <span><strong>£{processingTotal.toFixed(2)}</strong> across {processing.length} bookings is being processed by JLT.</span>
                </div>
              )}
              {processing.map((b) => (
                <BookingRow key={b.id} booking={b} showStatus />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="awaiting">
          <p className="text-sm text-muted-foreground mb-4">Your commission has been claimed and will be paid to you in the next payment run. Please note, claims processed after Wednesday may fall into next week's payment run.</p>
          {awaitingPayment.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Clock className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No commissions awaiting payment.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {awaitingPayment.length > 1 && (
                <div className="rounded-lg p-3 text-sm flex items-center gap-2"
                  style={{ background: '#fffbeb', color: '#92400e' }}>
                  <Clock size={14} />
                  <span><strong>£{awaitingTotal.toFixed(2)}</strong> is awaiting payment across {awaitingPayment.length} bookings.</span>
                </div>
              )}
              {awaitingPayment.map((b) => (
                <div key={b.id} className="flex items-center gap-2">
                  <div className="flex-1">
                    <BookingRow booking={b} showStatus />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-emerald-500 text-emerald-600 hover:bg-emerald-50 flex-shrink-0"
                    disabled={markAgentPaidMutation.isPending}
                    onClick={() => {
                      if (b.claim) markAgentPaidMutation.mutate({ claimIds: [b.claim.id] });
                    }}
                  >
                    Mark as Paid
                  </Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="paid">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">Your commission has been processed and paid into your account.</p>
            {paid.length > 0 && (
              <Button variant="outline" size="sm" className="text-xs gap-1 flex-shrink-0 ml-3"
                onClick={() => {
                  const headers = ["Client", "Departure", "Expected Commission (£)", "Booking Type", "Claimed On", "Processed On"];
                  const rows = paid.map((b) => [
                    b.clientName,
                    fmt(b.departureDate),
                    b.expectedCommission != null ? Number(b.expectedCommission).toFixed(2) : "",
                    b.claim?.bookingType ?? "",
                    fmt(b.claim?.claimedAt),
                    fmt(b.claim?.paidAt),
                  ]);
                  const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = `my-commissions-${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download size={13} /> Export CSV
              </Button>
            )}
          </div>
          {paid.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Banknote className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No paid commissions yet.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {paid.length > 0 && (
                <div className="rounded-lg p-3 text-sm flex items-center gap-2"
                  style={{ background: '#ecfdf5', color: '#065f46' }}>
                  <Banknote size={14} />
                  <span>Total paid to date: <strong>£{paidTotal.toFixed(2)}</strong></span>
                </div>
              )}
              {paid.map((b) => (
                <BookingRow key={b.id} booking={b} showStatus />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="remittances">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">Remittances paid to JLT by PTS on your behalf. Your 80% share is shown below.</p>
            {(remittanceLines?.length ?? 0) > 0 && (
              <Button variant="outline" size="sm" className="text-xs gap-1 flex-shrink-0 ml-3"
                onClick={() => {
                  const lines = remittanceLines ?? [];
                  const headers = ["Batch", "Week Of", "Client", "PTS Ref", "Return Date", "PAX", "Currency", "Total IN", "Total OUT", "SFI", "SAFI", "PTRC", "PTS", "VAT", "Remittance (£)", "Your 80% (£)"];
                  const rows = lines.map((l) => [
                    l.batchName,
                    l.weekOf ? fmt(l.weekOf) : "",
                    l.clientName,
                    l.ptsRef,
                    l.returnDate ?? "",
                    l.pax ?? "",
                    (l as any).currency ?? "GBP",
                    l.totalIn ?? "",
                    (l as any).totalOut ?? "",
                    (l as any).sfi ?? "",
                    (l as any).safi ?? "",
                    (l as any).ptrc ?? "",
                    (l as any).pts ?? "",
                    (l as any).vatFromPortal ?? (l as any).vatFromPts ?? "",
                    l.remittance ?? "",
                    l.remit80 ?? "",
                  ]);
                  const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = `my-remittances-${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download size={13} /> Export CSV
              </Button>
            )}
          </div>
          {(remittanceLines?.length ?? 0) === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No remittances have been pushed to you yet.</p>
                <p className="text-sm mt-1">Remittances appear here once JLT uploads and processes the weekly PTS remittance file.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Group by batch */}
              {Array.from(new Set((remittanceLines ?? []).map((l) => l.batchName))).map((batchName) => {
                const batchLines = (remittanceLines ?? []).filter((l) => l.batchName === batchName);
                const batchTotal = batchLines.reduce((acc, l) => acc + Number(l.remit80 ?? 0), 0);
                const weekOf = batchLines[0]?.weekOf;
                return (
                  <Card key={batchName}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet size={14} className="text-purple-500" />
                          <span>{batchName}</span>
                          {weekOf && <span className="text-xs text-muted-foreground font-normal">Week of {fmt(weekOf)}</span>}
                        </div>
                        <span className="text-purple-600 font-bold">£{batchTotal.toFixed(2)}</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-muted-foreground">
                              <th className="py-2 px-4 text-left font-medium">Client</th>
                              <th className="py-2 px-4 text-left font-medium">PTS Ref</th>
                              <th className="py-2 px-4 text-left font-medium">Return Date</th>
                              <th className="py-2 px-4 text-left font-medium">PAX</th>
                              <th className="py-2 px-4 text-left font-medium">Currency</th>
                              <th className="py-2 px-4 text-right font-medium">Total IN</th>
                              <th className="py-2 px-4 text-right font-medium">Total OUT</th>
                              <th className="py-2 px-4 text-right font-medium">SFI</th>
                              <th className="py-2 px-4 text-right font-medium">SAFI</th>
                              <th className="py-2 px-4 text-right font-medium">PTRC</th>
                              <th className="py-2 px-4 text-right font-medium">PTS</th>
                              <th className="py-2 px-4 text-right font-medium">VAT</th>
                              <th className="py-2 px-4 text-right font-medium">Remittance</th>
                              <th className="py-2 px-4 text-right font-medium text-purple-600">Your 80%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {batchLines.map((l) => (
                              <tr key={l.id} className="border-b border-border hover:bg-accent/20">
                                <td className="py-2 px-4 font-medium">{l.clientName}</td>
                                <td className="py-2 px-4 font-mono text-xs">{l.ptsRef}</td>
                                <td className="py-2 px-4">{l.returnDate ?? "—"}</td>
                                <td className="py-2 px-4">{l.pax ?? "—"}</td>
                                <td className="py-2 px-4">{(l as any).currency ?? "GBP"}</td>
                                <td className="py-2 px-4 text-right">{l.totalIn ? `£${Number(l.totalIn).toFixed(2)}` : "—"}</td>
                                <td className="py-2 px-4 text-right">{(l as any).totalOut ? `£${Number((l as any).totalOut).toFixed(2)}` : "—"}</td>
                                <td className="py-2 px-4 text-right">{(l as any).sfi ? `£${Number((l as any).sfi).toFixed(2)}` : "—"}</td>
                                <td className="py-2 px-4 text-right">{(l as any).safi ? `£${Number((l as any).safi).toFixed(2)}` : "—"}</td>
                                <td className="py-2 px-4 text-right">{(l as any).ptrc ? `£${Number((l as any).ptrc).toFixed(2)}` : "—"}</td>
                                <td className="py-2 px-4 text-right">{(l as any).pts ? `£${Number((l as any).pts).toFixed(2)}` : "—"}</td>
                                <td className="py-2 px-4 text-right">{((l as any).vatFromPortal ?? (l as any).vatFromPts) ? `£${Number((l as any).vatFromPortal ?? (l as any).vatFromPts).toFixed(2)}` : "—"}</td>
                                <td className="py-2 px-4 text-right">{l.remittance ? `£${Number(l.remittance).toFixed(2)}` : "—"}</td>
                                <td className="py-2 px-4 text-right font-semibold text-purple-600">{l.remit80 ? `£${Number(l.remit80).toFixed(2)}` : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="not-ready">
          <p className="text-sm text-muted-foreground mb-4">These bookings have commission due but aren't ready to claim yet — we'll notify you as each one moves to Ready to Claim.</p>
          {notReady.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <p>All your bookings are either claimable or already processed.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {missingCommission.length > 0 && (
                <div className="rounded-lg p-3 text-sm flex items-center gap-2"
                  style={{ background: '#fffbeb', color: '#92400e' }}>
                  <AlertCircle size={14} />
                  <span>{missingCommission.length} booking{missingCommission.length > 1 ? "s are" : " is"} missing a commission amount — open each booking to add your expected amount.</span>
                </div>
              )}
              {notReady.map((b) => (
                <BookingRow key={b.id} booking={b} showStatus highlightMissing />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Booking Type Dialog */}
      <Dialog open={!!claimTarget} onOpenChange={(open) => { if (!open) setClaimTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Claim Commission</DialogTitle>
            <DialogDescription>
              Please select the booking type for <strong>{claimTarget?.clientName}</strong> before submitting your claim.
              {claimTarget?.expectedCommission && (
                <span className="block mt-1 font-semibold" style={{ color: '#065f46' }}>
                  Expected commission: £{Number(claimTarget.expectedCommission).toFixed(2)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-5">
            {/* Required: gross commission amount */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold" htmlFor="gross-amount">
                Expected Gross Commission <span className="text-red-500">*</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                Enter the total commission before PTS fees, card charges, and any commission split.
              </p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                <Input
                  id="gross-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={grossAmount}
                  onChange={(e) => setGrossAmount(e.target.value)}
                  className="pl-7"
                />
              </div>
            </div>

            <div>
              <Label className="text-sm font-semibold mb-2 block">Booking Type</Label>
            <RadioGroup
              value={selectedType}
              onValueChange={(v) => setSelectedType(v as BookingType)}
              className="grid grid-cols-2 gap-3"
            >
              {(Object.entries(BOOKING_TYPE_LABELS) as [BookingType, string][]).map(([value, label]) => (
                <div key={value} className="relative">
                  <RadioGroupItem value={value} id={`type-${value}`} className="sr-only" />
                  <Label
                    htmlFor={`type-${value}`}
                    className={`flex items-center justify-center gap-2 p-3 rounded-lg border-2 cursor-pointer text-sm font-medium transition-all ${
                      selectedType === value
                        ? "border-[#02E6D2] bg-[#02E6D2]/10 text-foreground"
                        : "border-border bg-card text-muted-foreground hover:border-[#70FFE8]"
                    }`}
                  >
                    {label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            </div>

          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setClaimTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-[#02E6D2] hover:bg-[#70FFE8] text-[#414141] font-semibold"
              onClick={submitClaim}
              disabled={claimMutation.isPending}
            >
              {claimMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Submitting...</>
              ) : (
                "Submit Claim"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
