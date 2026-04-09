import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { ArrowLeft, Upload, X, Loader2 } from "lucide-react";
import { Link } from "wouter";

export default function RegisterBooking() {
  const [, navigate] = useLocation();
  const [clientName, setClientName] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [topdogRef, setTopdogRef] = useState("");
  const [reimbursementsRequired, setReimbursementsRequired] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const createBooking = trpc.bookings.create.useMutation();
  const uploadDoc = trpc.bookings.uploadReimbDoc.useMutation();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File must be under 10MB");
        return;
      }
      setDocFile(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName || !departureDate) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (reimbursementsRequired && !docFile) {
      // Allow submission without doc — it can be uploaded later
    }
    setIsSubmitting(true);
    try {
      const booking = await createBooking.mutateAsync({
        clientName,
        departureDate: new Date(departureDate),
        topdogRef: topdogRef || undefined,
        reimbursementsRequired,
      });

      if (booking && docFile) {
        const arrayBuffer = await docFile.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        const base64 = btoa(Array.from(uint8).map(b => String.fromCharCode(b)).join(''));
        await uploadDoc.mutateAsync({
          bookingId: booking.id,
          fileBase64: base64,
          fileName: docFile.name,
          mimeType: docFile.type,
        });
      }

      await utils.bookings.myBookings.invalidate();
      toast.success("Booking registered successfully!");
      navigate("/dashboard");
    } catch (err: any) {
      toast.error(err.message || "Failed to register booking");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft size={16} />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">Register a Booking</h1>
          <p className="text-sm text-muted-foreground">Submit a new booking for processing</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Booking Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="clientName">
                Client Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="clientName"
                placeholder="Full name of the client"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="departureDate">
                Departure Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="departureDate"
                type="date"
                value={departureDate}
                onChange={(e) => setDepartureDate(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="topdogRef">Topdog Booking Reference (optional)</Label>
              <Input
                id="topdogRef"
                placeholder="e.g. TD123456"
                value={topdogRef}
                onChange={(e) => setTopdogRef(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              <Label>Reimbursements Required?</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="reimb"
                    checked={!reimbursementsRequired}
                    onChange={() => setReimbursementsRequired(false)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">No</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="reimb"
                    checked={reimbursementsRequired}
                    onChange={() => setReimbursementsRequired(true)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Yes</span>
                </label>
              </div>
            </div>

            {reimbursementsRequired && (
              <div className="space-y-2 p-4 rounded-lg border-2 border-dashed" style={{ borderColor: '#70FFE8', background: '#FFF6ED' }}>
                <Label>Reimbursement Documents</Label>
                <p className="text-xs text-muted-foreground">Upload supporting documents. You can also upload these later from the booking page.</p>
                {docFile ? (
                  <div className="flex items-center gap-2 p-2 bg-white rounded-lg border">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{docFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(docFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <button type="button" onClick={() => setDocFile(null)} className="text-muted-foreground hover:text-destructive">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-white transition-colors"
                  >
                    <Upload size={16} />
                    Choose file
                  </button>
                )}
                <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                disabled={isSubmitting}
                style={{ background: '#70FFE8', color: '#414141' }}
                className="font-semibold"
              >
                {isSubmitting ? <><Loader2 size={16} className="animate-spin mr-2" />Submitting...</> : "Register Booking"}
              </Button>
              <Link href="/dashboard">
                <Button type="button" variant="outline">Cancel</Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
