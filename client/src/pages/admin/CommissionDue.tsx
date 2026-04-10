import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Link } from "wouter";
import { AlertCircle, Calendar, CheckCircle2, User } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import CopyableRef from "@/components/CopyableRef";

export default function CommissionDue() {
  const { data: bookings, isLoading, refetch } = trpc.commissionDue.list.useQuery();
  const moveStage = trpc.bookings.moveStage.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Booking moved to Commission Claimable");
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Commission Due</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Bookings where the final supplier payment date has passed and commission is ready to be reviewed
        </p>
      </div>

      {!bookings || bookings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-3" />
            <h3 className="font-semibold text-lg">All clear</h3>
            <p className="text-muted-foreground text-sm mt-1">
              No bookings are currently overdue for commission review.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              <strong>{bookings.length}</strong> booking{bookings.length !== 1 ? "s" : ""} require commission review
            </span>
          </div>

          {bookings.map((booking) => (
            <Card key={booking.id} className="border-l-4 border-l-amber-400 hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/admin/bookings/${booking.id}`}>
                        <span className="font-semibold text-foreground hover:text-[#02E6D2] cursor-pointer">
                          {booking.clientName}
                        </span>
                      </Link>
                      <Badge variant="outline" className="text-xs">#{booking.id}</Badge>
                      <Badge className="text-xs bg-[#414141] text-white">{booking.currentStage}</Badge>
                    </div>

                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {(booking as any).agentName ?? "Unknown Agent"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Departure: {format(new Date(booking.departureDate), "dd MMM yyyy")}
                      </span>
                      {booking.finalSupplierPaymentDate && (
                        <span className="flex items-center gap-1 text-amber-700 font-medium">
                          <AlertCircle className="w-3 h-3" />
                          Payment due: {format(new Date(booking.finalSupplierPaymentDate), "dd MMM yyyy")}
                          {" "}({formatDistanceToNow(new Date(booking.finalSupplierPaymentDate), { addSuffix: true })})
                        </span>
                      )}
                      {booking.topdogRef && (
                        <span className="flex items-center gap-1">Topdog: <CopyableRef value={booking.topdogRef} label="Topdog ref" /></span>
                      )}
                      {booking.ptsRef && (
                        <span className="flex items-center gap-1">PTS: <CopyableRef value={booking.ptsRef} label="PTS ref" /></span>
                      )}
                      {booking.expectedCommission && (
                        <span>Expected commission: <strong>£{Number(booking.expectedCommission).toFixed(2)}</strong></span>
                      )}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    className="bg-[#70FFE8] text-[#414141] hover:bg-[#02E6D2] shrink-0"
                    onClick={() =>
                      moveStage.mutate({ bookingId: booking.id, toStage: "Commission Claimable" })
                    }
                    disabled={moveStage.isPending}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-1.5" />
                    Mark Commission Claimable
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
