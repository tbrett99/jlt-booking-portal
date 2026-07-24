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
  { value: "both", label: "Ticketing & Cancellation (Both)" },
] as const;

const SUPPLIERS = ["Aviate", "Lime", "VA Flight Store"] as const;

/** Reusable PNR / date block */
function FlightSection({
  prefix,
  label,
  pnr, setPnr,
  departureDate, setDepartureDate,
  ticketingDeadline, setTicketingDeadline,
}: {
  prefix: string;
  label: string;
  pnr: string; setPnr: (v: string) => void;
  departureDate: string; setDepartureDate: (v: string) => void;
  ticketingDeadline: string; setTicketingDeadline: (v: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>

      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-pnr`}>PNR <span className="text-destructive">*</span></Label>
        <Input
          id={`${prefix}-pnr`}
          value={pnr}
          onChange={(e) => setPnr(e.target.value.toUpperCase())}
          placeholder="e.g. ABC123"
          maxLength={50}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-dep`}>Departure Date <span className="text-destructive">*</span></Label>
          <Input
            id={`${prefix}-dep`}
            type="date"
            value={departureDate}
            onChange={(e) => setDepartureDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-deadline`}>Ticketing Deadline <span className="text-destructive">*</span></Label>
          <Input
            id={`${prefix}-deadline`}
            type="date"
            value={ticketingDeadline}
            onChange={(e) => setTicketingDeadline(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

/** Reusable flight cost input */
function FlightCostInput({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label} <span className="text-destructive">*</span></Label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
        <Input
          id={id}
          type="number"
          min="0"
          step="0.01"
          className="pl-7"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function FlightRequestForm({ open, onOpenChange, bookingId, clientName, onSuccess }: Props) {
  const utils = trpc.useUtils();

  const [requestType, setRequestType] = useState<string>("");
  const [supplier, setSupplier] = useState<string>("");

  // Ticketing fields
  const [pnr, setPnr] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [ticketingDeadline, setTicketingDeadline] = useState("");
  const [flightCost, setFlightCost] = useState("");

  // Cancellation-specific fields (used when requestType = 'both')
  const [cancellationPnr, setCancellationPnr] = useState("");
  const [cancellationDepartureDate, setCancellationDepartureDate] = useState("");
  const [cancellationTicketingDeadline, setCancellationTicketingDeadline] = useState("");
  const [cancellationFlightCost, setCancellationFlightCost] = useState("");

  const isBoth = requestType === "both";

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
    setFlightCost("");
    setCancellationPnr("");
    setCancellationDepartureDate("");
    setCancellationTicketingDeadline("");
    setCancellationFlightCost("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!requestType || !supplier || !pnr.trim() || !departureDate || !ticketingDeadline) {
      toast.error("Please fill in all required fields.");
      return;
    }
    if (!flightCost || isNaN(parseFloat(flightCost)) || parseFloat(flightCost) < 0) {
      toast.error("Please enter a valid flight cost.");
      return;
    }
    if (isBoth && (!cancellationPnr.trim() || !cancellationDepartureDate || !cancellationTicketingDeadline)) {
      toast.error("Please fill in all cancellation fields.");
      return;
    }
    if (isBoth && (!cancellationFlightCost || isNaN(parseFloat(cancellationFlightCost)) || parseFloat(cancellationFlightCost) < 0)) {
      toast.error("Please enter a valid cancellation flight cost.");
      return;
    }
    createMutation.mutate({
      bookingId,
      requestType: requestType as "ticketing" | "cancellation" | "both",
      supplier: supplier as "Aviate" | "Lime" | "VA Flight Store",
      pnr: pnr.trim(),
      departureDate: new Date(departureDate),
      ticketingDeadline: new Date(ticketingDeadline),
      flightCost: parseFloat(flightCost),
      ...(isBoth && {
        cancellationPnr: cancellationPnr.trim(),
        cancellationDepartureDate: new Date(cancellationDepartureDate),
        cancellationTicketingDeadline: new Date(cancellationTicketingDeadline),
        cancellationFlightCost: parseFloat(cancellationFlightCost),
      }),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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
            <Select value={requestType} onValueChange={(v) => { setRequestType(v); }}>
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

          {/* Single-type: one section + cost */}
          {requestType && !isBoth && (
            <>
              <FlightSection
                prefix="primary"
                label={requestType === "ticketing" ? "Ticketing Details" : "Cancellation Details"}
                pnr={pnr} setPnr={setPnr}
                departureDate={departureDate} setDepartureDate={setDepartureDate}
                ticketingDeadline={ticketingDeadline} setTicketingDeadline={setTicketingDeadline}
              />
              <FlightCostInput
                id="flightCost"
                label="Flight Cost"
                value={flightCost}
                onChange={setFlightCost}
                hint="Enter the total cost of the flight so we can match this when completing your request."
              />
            </>
          )}

          {/* Both: two sections + two costs */}
          {isBoth && (
            <>
              <FlightSection
                prefix="ticketing"
                label="Ticketing Details"
                pnr={pnr} setPnr={setPnr}
                departureDate={departureDate} setDepartureDate={setDepartureDate}
                ticketingDeadline={ticketingDeadline} setTicketingDeadline={setTicketingDeadline}
              />
              <FlightCostInput
                id="flightCost"
                label="Ticketing Flight Cost"
                value={flightCost}
                onChange={setFlightCost}
                hint="Enter the total cost of the ticketing flight."
              />
              <FlightSection
                prefix="cancellation"
                label="Cancellation Details"
                pnr={cancellationPnr} setPnr={setCancellationPnr}
                departureDate={cancellationDepartureDate} setDepartureDate={setCancellationDepartureDate}
                ticketingDeadline={cancellationTicketingDeadline} setTicketingDeadline={setCancellationTicketingDeadline}
              />
              <FlightCostInput
                id="cancellationFlightCost"
                label="Cancellation Flight Cost"
                value={cancellationFlightCost}
                onChange={setCancellationFlightCost}
                hint="Enter the total cost of the cancellation flight."
              />
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => { onOpenChange(false); resetForm(); }}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !requestType}>
              {createMutation.isPending ? "Submitting…" : "Submit Request"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
