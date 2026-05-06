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
import { Loader2, CheckCircle, Clock, Banknote, Lock, AlertCircle, TrendingUp, ChevronRight, Download, FileSpreadsheet, Zap, TrendingDown, CalendarDays, Info, Plane } from "lucide-react";
import { startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, format as fmtDate, isToday, isBefore } from "date-fns";
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
  commissionPreAuthorised?: boolean;
  claim: {
    id: number;
    status: string;
    claimedAt: Date | string;
    paidAt: Date | string | null;
    bookingType?: string | null;
    topUpAmountPence?: number | null;
    topUpNote?: string | null;
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
  const [notifyTopUpId, setNotifyTopUpId] = useState<number | null>(null);

  const notifyTopUpMutation = trpc.commissionClaims.agentNotifyTopUpComplete.useMutation({
    onSuccess: () => {
      toast.success("JLT have been notified — your claim will be reviewed shortly.");
      setNotifyTopUpId(null);
      utils.commissionClaims.myCommissions.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const [selectedType, setSelectedType] = useState<BookingType>("other");
  const [grossAmount, setGrossAmount] = useState<string>("");
  const [markPaidIds, setMarkPaidIds] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<string>("claimable");

  const { data: remittanceLines } = trpc.remittance.getMyRemittances.useQuery();
  const { data: timelineBookings, isLoading: timelineLoading } = trpc.commissionClaims.myTimeline.useQuery();
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [highlightedDate, setHighlightedDate] = useState<Date | null>(null);

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
  const topUpRequired = all.filter((b) => b.claim && b.claim.status === "top_up_required");
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

      {/* Pre-Auth Explainer Banner */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '2px solid #02E6D2', background: 'linear-gradient(135deg, #f0fffe 0%, #e0fdfb 100%)' }}>
        <div className="px-5 py-4">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#02E6D2' }}>
              <Zap size={22} className="text-[#414141]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-base" style={{ color: '#0f4c4a' }}>Commission Pre-Authorisation — get paid faster, automatically</p>
              <p className="text-sm mt-1 leading-relaxed" style={{ color: '#0f4c4a', opacity: 0.85 }}>
                Pre-authorisation allows JLT to automatically process your commission the moment a booking becomes claimable — no need to log in and claim it manually. Once enabled, your claim is submitted instantly and you'll receive your payment sooner.
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="flex items-start gap-2 rounded-lg p-3" style={{ background: 'rgba(2,230,210,0.18)' }}>
              <span className="text-lg mt-0.5">⚡</span>
              <div>
                <p className="text-xs font-bold" style={{ color: '#0f4c4a' }}>Instant processing</p>
                <p className="text-xs mt-0.5" style={{ color: '#0f4c4a', opacity: 0.75 }}>Your claim is submitted the moment the file is ready — no delays, no manual steps.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg p-3" style={{ background: 'rgba(2,230,210,0.18)' }}>
              <span className="text-lg mt-0.5">🔒</span>
              <div>
                <p className="text-xs font-bold" style={{ color: '#0f4c4a' }}>You stay in control</p>
                <p className="text-xs mt-0.5" style={{ color: '#0f4c4a', opacity: 0.75 }}>Toggle on or off per booking at any time before it becomes claimable.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg p-3" style={{ background: 'rgba(2,230,210,0.18)' }}>
              <span className="text-lg mt-0.5">💸</span>
              <div>
                <p className="text-xs font-bold" style={{ color: '#0f4c4a' }}>Get paid faster</p>
                <p className="text-xs mt-0.5" style={{ color: '#0f4c4a', opacity: 0.75 }}>Faster claims mean faster payment — especially useful during busy booking periods.</p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-lg px-4 py-3" style={{ background: '#02E6D2', color: '#414141' }}>
            <Zap size={16} className="flex-shrink-0" />
            <p className="text-sm font-bold">
              To enable pre-auth on a booking: go to the{" "}<button className="underline font-bold cursor-pointer" style={{ color: '#414141' }} onClick={() => setActiveTab("not-ready")}>Pending</button>{" "}tab below and toggle it on for each booking you'd like to pre-authorise.
            </p>
          </div>
        </div>
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
      {(paidTotal + awaitingTotal + processingTotal + claimableTotal + pendingTotal) > 0 && (
        <div className="rounded-xl p-4 flex items-center gap-3"
          style={{ background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)', border: '1px solid #6ee7b7' }}>
          <TrendingUp size={20} style={{ color: '#059669' }} className="flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm" style={{ color: '#065f46' }}>
              Total commissions across all bookings: £{(paidTotal + awaitingTotal + processingTotal + claimableTotal + pendingTotal).toFixed(2)}
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#065f46', opacity: 0.75 }}>
              {paidTotal > 0 && `£${paidTotal.toFixed(2)} paid`}{paidTotal > 0 && (awaitingTotal + processingTotal + claimableTotal + pendingTotal) > 0 ? ' · ' : ''}
              {awaitingTotal > 0 && `£${awaitingTotal.toFixed(2)} awaiting payment`}{awaitingTotal > 0 && (processingTotal + claimableTotal + pendingTotal) > 0 ? ' · ' : ''}
              {processingTotal > 0 && `£${processingTotal.toFixed(2)} processing`}{processingTotal > 0 && (claimableTotal + pendingTotal) > 0 ? ' · ' : ''}
              {claimableTotal > 0 && `£${claimableTotal.toFixed(2)} ready to claim`}{claimableTotal > 0 && pendingTotal > 0 ? ' · ' : ''}
              {pendingTotal > 0 && `£${pendingTotal.toFixed(2)} pending`}
            </p>
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          <TabsTrigger value="top-up">
            Files in Minus
            {topUpRequired.length > 0 && (
              <span className="ml-2 bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                {topUpRequired.length}
              </span>
            )}
          </TabsTrigger>
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

        <TabsContent value="top-up">
          <p className="text-sm text-muted-foreground mb-4">These files are currently in minus. Please top up your account and notify us once done — we will then review and move the claim back to Commission Due.</p>
          {topUpRequired.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <TrendingDown className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No files currently in minus.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {topUpRequired.map((b) => (
                <div key={b.id} className="flex items-start justify-between p-4 border-2 border-red-300 rounded-lg bg-red-50">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground">{b.clientName}</p>
                    <p className="text-sm text-muted-foreground">Departure: {fmt(b.departureDate)}</p>
                    {b.claim?.topUpAmountPence && (
                      <p className="text-sm font-bold text-red-600 mt-1">Amount to top up: £{(b.claim.topUpAmountPence / 100).toFixed(2)}</p>
                    )}
                    {b.claim?.topUpNote && (
                      <p className="text-sm text-muted-foreground mt-1 italic">{b.claim.topUpNote}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-400 text-red-600 hover:bg-red-50"
                      onClick={() => setNotifyTopUpId(b.claim!.id)}
                      disabled={notifyTopUpMutation.isPending && notifyTopUpId === b.claim?.id}
                    >
                      {notifyTopUpMutation.isPending && notifyTopUpId === b.claim?.id ? (
                        <Loader2 size={14} className="animate-spin mr-1" />
                      ) : null}
                      I've Topped Up — Notify JLT
                    </Button>
                    <Link href={`/bookings/${b.id}`}>
                      <button className="p-1 rounded hover:bg-muted">
                        <ChevronRight size={16} className="text-muted-foreground" />
                      </button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Confirm top-up notify dialog */}
          {notifyTopUpId !== null && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-background rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
                <h3 className="font-bold text-lg mb-2">Confirm Top-Up</h3>
                <p className="text-sm text-muted-foreground mb-4">Please confirm that you have topped up your account. JLT will be notified and will review your claim shortly.</p>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setNotifyTopUpId(null)}>Cancel</Button>
                  <Button
                    className="bg-[#02E6D2] text-[#414141] hover:bg-[#70FFE8]"
                    onClick={() => notifyTopUpMutation.mutate({ claimId: notifyTopUpId! })}
                    disabled={notifyTopUpMutation.isPending}
                  >
                    {notifyTopUpMutation.isPending ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                    Confirm
                  </Button>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

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
                  const headers = ["Batch", "Week Of", "Client", "PTS Ref", "Return Date", "PAX", "Currency", "Total IN", "Total OUT", "SFI", "SAFI", "PTRC", "PTS", "VAT Deducted (£)", "Net Remittance (£)", "Your 80% (£)"];
                  const rows = lines.map((l) => {
                    const gross = Number(l.remittance ?? 0);
                    const vat = Number((l as any).vatFromPortal ?? (l as any).vatFromPts ?? 0);
                    const net = gross > 0 ? gross - vat : gross;
                    return [
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
                      vat > 0 ? vat.toFixed(2) : "",
                      net > 0 ? net.toFixed(2) : (gross > 0 ? gross.toFixed(2) : ""),
                      l.remit80 ?? "",
                    ];
                  });
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
                              <th className="py-2 px-4 text-right font-medium text-amber-600">VAT (deducted)</th>
                              <th className="py-2 px-4 text-right font-medium">Net Remittance</th>
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
                                <td className="py-2 px-4 text-right text-amber-600">{((l as any).vatFromPortal ?? (l as any).vatFromPts) ? `−£${Number((l as any).vatFromPortal ?? (l as any).vatFromPts).toFixed(2)}` : "—"}</td>
                                <td className="py-2 px-4 text-right">{(() => { const gross = Number(l.remittance ?? 0); const vat = Number((l as any).vatFromPortal ?? (l as any).vatFromPts ?? 0); const net = gross - vat; return net > 0 ? `£${net.toFixed(2)}` : (gross > 0 ? `£${gross.toFixed(2)}` : "—"); })()}</td>
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

        {/* Timeline moved to /commission-timeline */}
        <TabsContent value="timeline-removed">
          {/* Disclaimer */}
          <div className="rounded-xl border p-4 mb-5 flex items-start gap-3" style={{ background: '#fffbeb', borderColor: '#f59e0b' }}>
            <Info size={16} className="shrink-0 mt-0.5 text-amber-600" />
            <div>
              <p className="font-semibold text-sm text-amber-800">Approximate dates — please read</p>
              <p className="text-xs mt-1 text-amber-700 leading-relaxed">
                The <strong>Final Supplier Payment Date</strong> shown here is set by JLT a few days <em>after</em> the final supplier has been paid. This buffer accounts for PTS processing time and ensures funds have fully cleared before we review the file for commission. These dates are therefore a <strong>guide only</strong> — your commission will become claimable once JLT has reviewed and approved the file, which may be slightly later than the date shown.
              </p>
            </div>
          </div>

          {timelineLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin text-[#02E6D2]" />
            </div>
          ) : !timelineBookings || timelineBookings.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No upcoming commission dates yet.</p>
                <p className="text-sm mt-1">Dates will appear here once JLT sets the final supplier payment date on your bookings.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Mini calendar strip — 3 months */}
              {(() => {
                const months = [calendarMonth, addMonths(calendarMonth, 1), addMonths(calendarMonth, 2)];
                const paymentDates = (timelineBookings ?? []).map((b) => new Date(b.finalSupplierPaymentDate));
                return (
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <button
                        className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground"
                        onClick={() => { setCalendarMonth((m) => addMonths(m, -1)); setHighlightedDate(null); }}
                      >
                        &#8249;
                      </button>
                      <span className="text-sm font-semibold text-foreground">
                        {fmtDate(calendarMonth, 'MMMM yyyy')} – {fmtDate(addMonths(calendarMonth, 2), 'MMMM yyyy')}
                      </span>
                      <button
                        className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground"
                        onClick={() => { setCalendarMonth((m) => addMonths(m, 1)); setHighlightedDate(null); }}
                      >
                        &#8250;
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {months.map((month) => {
                        const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
                        const firstDow = (startOfMonth(month).getDay() + 6) % 7; // Mon=0
                        return (
                          <div key={month.toISOString()} className="rounded-xl border border-border bg-card p-3">
                            <p className="text-xs font-semibold text-center text-muted-foreground mb-2">{fmtDate(month, 'MMMM yyyy')}</p>
                            <div className="grid grid-cols-7 gap-0.5 text-center">
                              {['M','T','W','T','F','S','S'].map((d, i) => (
                                <span key={i} className="text-[10px] text-muted-foreground font-medium py-0.5">{d}</span>
                              ))}
                              {Array.from({ length: firstDow }).map((_, i) => <span key={`e${i}`} />)}
                              {days.map((day) => {
                                const hasPayment = paymentDates.some((pd) => isSameDay(pd, day));
                                const isHighlighted = highlightedDate && isSameDay(highlightedDate, day);
                                const todayDay = isToday(day);
                                return (
                                  <button
                                    key={day.toISOString()}
                                    onClick={() => hasPayment ? setHighlightedDate(isHighlighted ? null : day) : undefined}
                                    className={`text-[11px] rounded-full w-6 h-6 mx-auto flex items-center justify-center transition-colors
                                      ${ isHighlighted ? 'bg-[#02E6D2] text-[#414141] font-bold' :
                                         hasPayment ? 'bg-[#02E6D2]/20 text-[#0f4c4a] font-bold hover:bg-[#02E6D2]/40 cursor-pointer' :
                                         todayDay ? 'ring-1 ring-[#02E6D2] text-foreground' :
                                         'text-muted-foreground' }
                                    `}
                                  >
                                    {day.getDate()}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {highlightedDate && (
                      <p className="text-xs text-center text-muted-foreground mt-2">
                        Showing bookings with payment date <strong>{fmtDate(highlightedDate, 'dd MMMM yyyy')}</strong> — <button className="underline" onClick={() => setHighlightedDate(null)}>clear filter</button>
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Grouped list */}
              {(() => {
                const now = new Date();
                const endOfThisMonth = endOfMonth(now);
                const endOfNextMonth = endOfMonth(addMonths(now, 1));
                const filtered = highlightedDate
                  ? (timelineBookings ?? []).filter((b) => isSameDay(new Date(b.finalSupplierPaymentDate), highlightedDate))
                  : (timelineBookings ?? []);

                const overdue = filtered.filter((b) => isBefore(new Date(b.finalSupplierPaymentDate), now));
                const thisMonth = filtered.filter((b) => { const d = new Date(b.finalSupplierPaymentDate); return !isBefore(d, now) && !isBefore(endOfThisMonth, d); });
                const nextMonth = filtered.filter((b) => { const d = new Date(b.finalSupplierPaymentDate); return isBefore(endOfThisMonth, d) && !isBefore(endOfNextMonth, d); });
                const further = filtered.filter((b) => isBefore(endOfNextMonth, new Date(b.finalSupplierPaymentDate)));

                const TimelineRow = ({ b }: { b: typeof filtered[0] }) => (
                  <div className="flex items-center justify-between p-4 border rounded-lg bg-card hover:bg-accent/30 transition-colors gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">{b.clientName}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
                        {b.departureDate && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Plane size={10} /> Departs {fmtDate(new Date(b.departureDate), 'dd/MM/yyyy')}
                          </span>
                        )}
                        <span className="text-xs font-medium" style={{ color: '#0f4c4a' }}>
                          Payment date: {fmtDate(new Date(b.finalSupplierPaymentDate), 'dd MMM yyyy')}
                        </span>
                      </div>
                      {b.expectedCommission && (
                        <p className="text-sm font-semibold mt-0.5" style={{ color: '#065f46' }}>£{Number(b.expectedCommission).toFixed(2)}</p>
                      )}
                      {b.ptsRef && <p className="text-xs text-muted-foreground font-mono">{b.ptsRef}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        b.claimStatus === 'processing' ? 'bg-orange-100 text-orange-700' :
                        b.claimStatus === 'top_up_required' ? 'bg-red-100 text-red-700' :
                        'bg-muted text-muted-foreground'
                      }`}>{b.currentStage}</span>
                      <Link href={`/bookings/${b.id}`}>
                        <button className="p-1 rounded hover:bg-muted"><ChevronRight size={16} className="text-muted-foreground" /></button>
                      </Link>
                    </div>
                  </div>
                );

                const Section = ({ title, items, accent }: { title: string; items: typeof filtered; accent?: string }) =>
                  items.length === 0 ? null : (
                    <div className="mb-5">
                      <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: accent ?? '#6b7280' }}>{title}</h3>
                      <div className="space-y-2">
                        {items.map((b) => <TimelineRow key={b.id} b={b} />)}
                      </div>
                    </div>
                  );

                return (
                  <>
                    <Section title="Overdue — payment date passed" items={overdue} accent="#dc2626" />
                    <Section title="This month" items={thisMonth} accent="#0f4c4a" />
                    <Section title="Next month" items={nextMonth} accent="#374151" />
                    <Section title="Further ahead" items={further} accent="#6b7280" />
                    {filtered.length === 0 && (
                      <p className="text-sm text-center text-muted-foreground py-8">No bookings match this date.</p>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </TabsContent>

        <TabsContent value="not-ready">
          <div className="rounded-xl border p-4 mb-4 flex items-start gap-3" style={{ background: '#fffbeb', borderColor: '#fcd34d' }}>
            <Zap size={16} className="shrink-0 mt-0.5" style={{ color: '#92400e' }} />
            <div>
              <p className="font-semibold text-sm" style={{ color: '#92400e' }}>Commission Pre-Authorisation</p>
              <p className="text-xs mt-0.5" style={{ color: '#92400e', opacity: 0.85 }}>
                Enable pre-authorisation on individual bookings to let JLT automatically process your commission claim as soon as the file is ready — no manual claim needed.
                Open any booking below and toggle the pre-authorisation switch.
              </p>
            </div>
          </div>
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
