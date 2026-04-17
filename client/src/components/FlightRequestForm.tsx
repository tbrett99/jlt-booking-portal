import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plane } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: number;
  clientName: string;
  onSuccess?: () => void;
}

const REQUEST_TYPES = [
  { value: "ticketing", label: "Ticketing" },
  { value: "cancellation", label: "Cancellation" },
  { value: "both", label: "Ticketing & Cancellation" },
] as const;

const SUPPLIERS = ["Aviate", "Lime", "VA Flight Store"] as const;

export function FlightRequestForm({ open, onOpenChange, bookingId, clientName, onSuccess }: Props) {
  const utils = trpc.useUtils();

  const [requestType, setRequestType] = useState<string>("");
  const [supplier, setSupplier] = useState<string>("");
  const [pnr, setPnr] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [ticketingDeadline, setTicketingDeadline] = useState("");

  const createMutation = trpc.flightRequests.create.useMutation({
    onSuccess: () => {
      toast.success("Flight request submitted — the JLT team will action this shortly.");
      utils.flightRequests.byBooking.invalidate({ bookingId });
      utils.flightRequests.myRequests.invalidate();
      onOpenChange(false);
      resetForm();
      onSuccess?.();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  function resetForm() {
    setRequestType("");
    setSupplier("");
    setPnr("");
    setDepartureDate("");
    setTicketingDeadline("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!requestType || !supplier || !pnr.trim() || !departureDate || !ticketingDeadline) {
      toast.error("Please fill in all fields.");
      return;
    }
    createMutation.mutate({
      bookingId,
      requestType: requestType as "ticketing" | "cancellation" | "both",
      supplier: supplier as "Aviate" | "Lime" | "VA Flight Store",
      pnr: pnr.trim(),
      departureDate: new Date(departureDate),
      ticketingDeadline: new Date(ticketingDeadline),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plane className="h-5 w-5 text-primary" />
            Flight Request
          </DialogTitle>
          <DialogDescription>
            Submit a flight ticketing or cancellation request for <strong>{clientName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Request Type */}
          <div className="space-y-1.5">
            <Label htmlFor="requestType">Request Type <span className="text-destructive">*</span></Label>
            <Select value={requestType} onValueChange={setRequestType}>
              <SelectTrigger id="requestType">
                <SelectValue placeholder="Select type…" />
              </SelectTrigger>
              <SelectContent>
                {REQUEST_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Supplier */}
          <div className="space-y-1.5">
            <Label htmlFor="supplier">Supplier <span className="text-destructive">*</span></Label>
            <Select value={supplier} onValueChange={setSupplier}>
              <SelectTrigger id="supplier">
                <SelectValue placeholder="Select supplier…" />
              </SelectTrigger>
              <SelectContent>
                {SUPPLIERS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* PNR */}
          <div className="space-y-1.5">
            <Label htmlFor="pnr">PNR <span className="text-destructive">*</span></Label>
            <Input
              id="pnr"
              value={pnr}
              onChange={(e) => setPnr(e.target.value.toUpperCase())}
              placeholder="e.g. ABC123"
              maxLength={50}
            />
          </div>

          {/* Departure Date */}
          <div className="space-y-1.5">
            <Label htmlFor="departureDate">Departure Date <span className="text-destructive">*</span></Label>
            <Input
              id="departureDate"
              type="date"
              value={departureDate}
              onChange={(e) => setDepartureDate(e.target.value)}
            />
          </div>

          {/* Ticketing Deadline */}
          <div className="space-y-1.5">
            <Label htmlFor="ticketingDeadline">Ticketing Deadline <span className="text-destructive">*</span></Label>
            <Input
              id="ticketingDeadline"
              type="date"
              value={ticketingDeadline}
              onChange={(e) => setTicketingDeadline(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Submitting…" : "Submit Request"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
