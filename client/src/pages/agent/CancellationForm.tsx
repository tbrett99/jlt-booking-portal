import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useParams, Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, AlertTriangle, Loader2 } from "lucide-react";

export default function CancellationForm() {
  const { id } = useParams<{ id: string }>();
  const bookingId = Number(id);
  const [, navigate] = useLocation();
  const [confirmed, setConfirmed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: booking } = trpc.bookings.byId.useQuery({ id: bookingId });
  const submitCancellation = trpc.cancellations.submit.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmed) { toast.error("Please confirm the cancellation"); return; }
    setIsSubmitting(true);
    try {
      await submitCancellation.mutateAsync({ bookingId });
      toast.success("Cancellation submitted. Booking has been moved to Cancelled.");
      navigate(`/bookings/${bookingId}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to submit cancellation");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/bookings/${bookingId}`}>
          <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft size={16} />Back</Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">Cancel Booking</h1>
          {booking && <p className="text-sm text-muted-foreground">{booking.clientName} — Booking #{bookingId}</p>}
        </div>
      </div>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-destructive">
            <AlertTriangle size={18} />
            Confirm Cancellation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 rounded-lg mb-5" style={{ background: '#fee2e2' }}>
            <p className="text-sm font-medium text-red-800">This action will cancel the entire booking.</p>
            <p className="text-sm text-red-700 mt-1">
              If any amounts need to be refunded, please also submit a Refund Request from the booking page.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-5">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 w-4 h-4"
              />
              <span className="text-sm">
                I confirm that I want to cancel the full booking for <strong>{booking?.clientName}</strong> (Booking #{bookingId}).
              </span>
            </label>
            <div className="flex gap-3">
              <Button
                type="submit"
                disabled={isSubmitting || !confirmed}
                variant="destructive"
                className="font-semibold"
              >
                {isSubmitting ? <><Loader2 size={16} className="animate-spin mr-2" />Processing...</> : "Confirm Cancellation"}
              </Button>
              <Link href={`/bookings/${bookingId}`}><Button type="button" variant="outline">Go Back</Button></Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
