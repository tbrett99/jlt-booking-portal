import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Search, PenLine, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";

export default function AgentRequestAmendment() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");

  const { data: bookings, isLoading } = trpc.bookings.myBookings.useQuery();

  const activeBookings = (bookings ?? []).filter(
    (b) => b.currentStage !== "Cancelled"
  );

  const filtered = activeBookings.filter(
    (b) =>
      b.clientName.toLowerCase().includes(search.toLowerCase()) ||
      (b.topdogRef ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (bookingId: number) => {
    navigate(`/bookings/${bookingId}/amend`);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <PenLine className="h-6 w-6 text-[#02E6D2]" />
          Request an Amendment
        </h1>
        <p className="text-muted-foreground mt-1">
          Select the booking you wish to amend to continue.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select Booking</CardTitle>
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
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filtered.map((b) => (
                <button
                  key={b.id}
                  onClick={() => handleSelect(b.id)}
                  className="w-full text-left p-3 rounded-lg border border-border hover:border-[#02E6D2] hover:bg-[#02E6D2]/5 transition-colors group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">{b.clientName}</p>
                      <p className="text-xs text-muted-foreground">
                        Departure: {b.departureDate ? format(new Date(b.departureDate), "dd/MM/yyyy") : "—"} ·{" "}
                        Stage: {b.currentStage}
                        {b.topdogRef ? ` · Topdog: ${b.topdogRef}` : ""}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-[#02E6D2] transition-colors flex-shrink-0 ml-3" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4">
        <Button variant="outline" onClick={() => navigate("/dashboard")}>
          Back
        </Button>
      </div>
    </div>
  );
}
