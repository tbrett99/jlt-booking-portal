import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { format } from "date-fns";
import { Loader2, CheckCircle, Clock, Banknote, Lock } from "lucide-react";

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
  } | null;
};

export default function AgentCommissions() {
  const utils = trpc.useUtils();
  const { data: bookings, isLoading } = trpc.commissionClaims.myCommissions.useQuery();
  const claimMutation = trpc.commissionClaims.claim.useMutation({
    onSuccess: () => {
      toast.success("Commission claimed successfully!");
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
  const claimedNotPaid = all.filter((b) => b.claim && b.claim.status === "claimed");
  const paid = all.filter((b) => b.claim && b.claim.status === "paid");

  const formatDate = (d: Date | string | null | undefined) => {
    if (!d) return "—";
    return format(new Date(d), "dd/MM/yyyy");
  };

  const BookingRow = ({
    booking,
    showClaim,
    showStatus,
  }: {
    booking: BookingWithClaim;
    showClaim?: boolean;
    showStatus?: boolean;
  }) => (
    <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card hover:bg-accent/30 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-foreground truncate">{booking.clientName}</p>
        <p className="text-sm text-muted-foreground">Departure: {formatDate(booking.departureDate)}</p>
        {booking.expectedCommission != null && (
          <p className="text-sm text-muted-foreground">Expected: £{booking.expectedCommission.toFixed(2)}</p>
        )}
        {booking.claim?.claimedAt && (
          <p className="text-xs text-muted-foreground">Claimed: {formatDate(booking.claim.claimedAt)}</p>
        )}
        {booking.claim?.paidAt && (
          <p className="text-xs text-emerald-600 font-medium">Paid: {formatDate(booking.claim.paidAt)}</p>
        )}
      </div>
      <div className="flex items-center gap-3 ml-4">
        {showStatus && (
          <Badge
            variant="outline"
            className={
              booking.claim?.status === "paid"
                ? "border-emerald-500 text-emerald-600"
                : booking.claim?.status === "claimed"
                ? "border-amber-500 text-amber-600"
                : booking.currentStage === "Commission Claimable"
                ? "border-[#02E6D2] text-[#02E6D2]"
                : "border-muted text-muted-foreground"
            }
          >
            {booking.claim?.status === "paid"
              ? "Paid"
              : booking.claim?.status === "claimed"
              ? "Claimed – Awaiting Payment"
              : booking.currentStage}
          </Badge>
        )}
        {showClaim && (
          <Button
            size="sm"
            className="bg-[#02E6D2] hover:bg-[#70FFE8] text-[#414141] font-semibold"
            onClick={() => claimMutation.mutate({ bookingId: booking.id })}
            disabled={claimMutation.isPending}
          >
            {claimMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Claim Commission"}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">My Commissions</h1>
        <p className="text-muted-foreground mt-1">Track and claim your commission for completed bookings.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Card className="border-border">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{notReady.length}</p>
                <p className="text-xs text-muted-foreground">Not Ready</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-[#02E6D2]">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-[#02E6D2]" />
              <div>
                <p className="text-2xl font-bold text-[#02E6D2]">{claimable.length}</p>
                <p className="text-xs text-muted-foreground">Ready to Claim</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-400">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              <div>
                <p className="text-2xl font-bold text-amber-500">{claimedNotPaid.length}</p>
                <p className="text-xs text-muted-foreground">Awaiting Payment</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-400">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold text-emerald-500">{paid.length}</p>
                <p className="text-xs text-muted-foreground">Paid</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="claimable">
        <TabsList className="mb-4">
          <TabsTrigger value="claimable">
            Ready to Claim
            {claimable.length > 0 && (
              <span className="ml-2 bg-[#02E6D2] text-[#414141] text-xs font-bold rounded-full px-2 py-0.5">
                {claimable.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="awaiting">Awaiting Payment</TabsTrigger>
          <TabsTrigger value="paid">Paid</TabsTrigger>
          <TabsTrigger value="not-ready">Not Ready</TabsTrigger>
        </TabsList>

        <TabsContent value="claimable">
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
              {claimable.map((b) => (
                <BookingRow key={b.id} booking={b} showClaim />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="awaiting">
          {claimedNotPaid.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Clock className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No commissions awaiting payment.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {claimedNotPaid.map((b) => (
                <BookingRow key={b.id} booking={b} showStatus />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="paid">
          {paid.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Banknote className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No paid commissions yet.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {paid.map((b) => (
                <BookingRow key={b.id} booking={b} showStatus />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="not-ready">
          {notReady.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <p>All your bookings are either claimable or already processed.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {notReady.map((b) => (
                <BookingRow key={b.id} booking={b} showStatus />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
