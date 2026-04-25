import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plane, Plus, Loader2 } from "lucide-react";
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

export default function AgentFlightRequests() {
  const [formOpen, setFormOpen] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);
  const [selectedClientName, setSelectedClientName] = useState<string>("");

  const { data: requests, isLoading } = trpc.flightRequests.myRequests.useQuery(undefined, {
    staleTime: 0,
  });

  // Load agent's bookings for the booking picker
  const { data: myBookings } = trpc.bookings.myBookings.useQuery(undefined, {
    staleTime: 30_000,
  });

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; color: string; bg: string }> = {
      pending:   { label: "Pending",   color: "#92400e", bg: "#fef3c7" },
      ticketed:  { label: "Ticketed",  color: "#065f46", bg: "#d1fae5" },
      cancelled: { label: "Cancelled", color: "#991b1b", bg: "#fee2e2" },
      query:     { label: "Query",     color: "#1e40af", bg: "#dbeafe" },
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
    if (selectedBookingId) {
      setFormOpen(true);
    }
  }

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
            <Card key={r.id}>
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
                  <span>
                    PNR: <strong className="text-foreground">{r.pnr}</strong>
                  </span>
                  <span>
                    Departure:{" "}
                    <strong className="text-foreground">
                      {format(new Date(r.departureDate), "dd MMM yyyy")}
                    </strong>
                  </span>
                  <span>
                    Deadline:{" "}
                    <strong className="text-foreground">
                      {format(new Date(r.ticketingDeadline), "dd MMM yyyy")}
                    </strong>
                  </span>
                  <span>Submitted: {format(new Date(r.createdAt), "dd MMM yyyy")}</span>
                </div>
                {r.status === "query" && r.queryMessage && (
                  <div className="rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
                    <strong>Query from JLT:</strong> {r.queryMessage}
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
    </div>
  );
}
