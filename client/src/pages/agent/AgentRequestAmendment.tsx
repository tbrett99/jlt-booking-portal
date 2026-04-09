import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Search, PenLine, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";

export default function AgentRequestAmendment() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const { data: bookings, isLoading } = trpc.bookings.myBookings.useQuery();

  const amendMutation = trpc.amendments.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success("Amendment request submitted.");
    },
    onError: (err) => toast.error(err.message),
  });

  const activeBookings = (bookings ?? []).filter(
    (b) => b.currentStage !== "Cancelled"
  );

  const filtered = activeBookings.filter(
    (b) =>
      b.clientName.toLowerCase().includes(search.toLowerCase()) ||
      (b.topdogRef ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const selected = activeBookings.find((b) => b.id === selectedBookingId);

  const handleSubmit = () => {
    if (!selectedBookingId || !description.trim()) {
      toast.error("Please select a booking and describe the amendment.");
      return;
    }
    amendMutation.mutate({ bookingId: selectedBookingId, details: description });
  };

  if (submitted) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <Card>
          <CardContent className="py-16 text-center">
            <CheckCircle className="h-12 w-12 text-[#02E6D2] mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Amendment Request Submitted</h2>
            <p className="text-muted-foreground mb-6">
              Our team will review your request and action it as soon as possible.
            </p>
            <Button onClick={() => navigate("/dashboard")} className="bg-[#02E6D2] hover:bg-[#70FFE8] text-[#414141]">
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <PenLine className="h-6 w-6 text-[#02E6D2]" />
          Request an Amendment
        </h1>
        <p className="text-muted-foreground mt-1">Search for the booking you wish to amend and describe the change.</p>
      </div>

      {/* Step 1: Search & Select */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Step 1 — Select Booking</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by client name or Topdog reference..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-[#02E6D2]" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">No active bookings found.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {filtered.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setSelectedBookingId(b.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedBookingId === b.id
                      ? "border-[#02E6D2] bg-[#02E6D2]/10"
                      : "border-border hover:border-[#70FFE8] hover:bg-accent/30"
                  }`}
                >
                  <p className="font-medium text-foreground">{b.clientName}</p>
                  <p className="text-xs text-muted-foreground">
                    Departure: {b.departureDate ? format(new Date(b.departureDate), "dd/MM/yyyy") : "—"} ·{" "}
                    Stage: {b.currentStage}
                    {b.topdogRef ? ` · Topdog: ${b.topdogRef}` : ""}
                  </p>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Description */}
      {selected && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Step 2 — Describe the Amendment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 p-3 bg-accent/30 rounded-lg">
              <p className="font-medium">{selected.clientName}</p>
              <p className="text-sm text-muted-foreground">
                Departure: {selected.departureDate ? format(new Date(selected.departureDate), "dd/MM/yyyy") : "—"}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Amendment Description *</Label>
              <Textarea
                id="description"
                placeholder="Please describe what needs to be amended (e.g. change of departure date, passenger name correction, room upgrade)..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => navigate("/dashboard")}>
          Back
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!selectedBookingId || !description.trim() || amendMutation.isPending}
          className="bg-[#02E6D2] hover:bg-[#70FFE8] text-[#414141] font-semibold"
        >
          {amendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Submit Amendment Request
        </Button>
      </div>
    </div>
  );
}
