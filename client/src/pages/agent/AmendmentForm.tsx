import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useParams, Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";

export default function AmendmentForm() {
  const { id } = useParams<{ id: string }>();
  const bookingId = Number(id);
  const [, navigate] = useLocation();
  const [details, setDetails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: booking } = trpc.bookings.byId.useQuery({ id: bookingId });
  const submitAmendment = trpc.amendments.submit.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!details.trim()) { toast.error("Please describe the amendment"); return; }
    setIsSubmitting(true);
    try {
      await submitAmendment.mutateAsync({ bookingId, details });
      toast.success("Amendment submitted successfully");
      navigate(`/bookings/${bookingId}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to submit amendment");
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
          <h1 className="text-xl font-bold">Submit Amendment</h1>
          {booking && <p className="text-sm text-muted-foreground">{booking.clientName} — Booking #{bookingId}</p>}
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Amendment Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="details">Describe the changes required <span className="text-destructive">*</span></Label>
              <Textarea
                id="details"
                placeholder="Please provide full details of the amendment required..."
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                className="min-h-[120px]"
                required
              />
            </div>
            <div className="flex gap-3">
              <Button type="submit" disabled={isSubmitting} style={{ background: '#70FFE8', color: '#414141' }} className="font-semibold">
                {isSubmitting ? <><Loader2 size={16} className="animate-spin mr-2" />Submitting...</> : "Submit Amendment"}
              </Button>
              <Link href={`/bookings/${bookingId}`}><Button type="button" variant="outline">Cancel</Button></Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
