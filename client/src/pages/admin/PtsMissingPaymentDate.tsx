import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ArrowLeft, ExternalLink, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function PtsMissingPaymentDate() {
  const [search, setSearch] = useState("");
  const { data: bookings = [], isLoading, refetch } = trpc.bookings.ptsMissingPaymentDate.useQuery();
  const updateAdminFields = trpc.bookings.updateAdminFields.useMutation({
    onSuccess: () => {
      toast.success("Payment date saved");
      refetch();
    },
    onError: (err) => toast.error(err.message || "Failed to save date"),
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [dateInput, setDateInput] = useState("");

  const filtered = bookings.filter((b) => {
    const q = search.toLowerCase();
    return (
      b.clientName.toLowerCase().includes(q) ||
      ((b as any).agentName ?? "").toLowerCase().includes(q) ||
      (b.topdogRef ?? "").toLowerCase().includes(q) ||
      (b.ptsRef ?? "").toLowerCase().includes(q)
    );
  });

  function handleSaveDate(bookingId: number) {
    if (!dateInput) return;
    updateAdminFields.mutate({ bookingId, finalSupplierPaymentDate: new Date(dateInput) });
    setEditingId(null);
    setDateInput("");
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft size={16} />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <AlertTriangle size={20} className="text-amber-500" />
            Added to PTS — Missing Payment Date
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isLoading ? "Loading…" : `${bookings.length} booking${bookings.length !== 1 ? "s" : ""} in Added to PTS with no Final Supplier Payment Date set`}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <Input
          placeholder="Search by client, agent, Topdog ref or PTS ref…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading bookings…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          {search ? "No bookings match your search." : "All Added to PTS bookings have a payment date set. "}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Client</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Agent</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Destination</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Departure</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Topdog Ref</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">PTS Ref</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Payment Date</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => (
                <tr key={b.id} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                  <td className="px-4 py-2.5 font-medium">{b.clientName}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{(b as any).agentName ?? `#${b.agentId}`}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{(b as any).supplierName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {b.departureDate ? format(new Date(b.departureDate), "dd MMM yyyy") : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {b.topdogRef ? <Badge variant="outline" className="text-xs font-mono">{b.topdogRef}</Badge> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {b.ptsRef ? <Badge variant="outline" className="text-xs font-mono">{b.ptsRef}</Badge> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {editingId === b.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          type="date"
                          value={dateInput}
                          onChange={(e) => setDateInput(e.target.value)}
                          className="h-7 text-xs w-36"
                          autoFocus
                        />
                        <Button size="sm" className="h-7 px-2 text-xs" onClick={() => handleSaveDate(b.id)}>Save</Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs gap-1 text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100"
                        onClick={() => { setEditingId(b.id); setDateInput(""); }}
                      >
                        <Calendar size={12} />
                        Set date
                      </Button>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/bookings/${b.id}`}>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                        <ExternalLink size={13} />
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
