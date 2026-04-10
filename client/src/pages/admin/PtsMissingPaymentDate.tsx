import { useState, useMemo } from "react";
import { Link } from "wouter";
import { format, isPast } from "date-fns";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ArrowLeft, ExternalLink, Calendar, Download, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import CopyableRef from "@/components/CopyableRef";

export default function PtsMissingPaymentDate() {
  const [search, setSearch] = useState("");
  const [pastDepartureOnly, setPastDepartureOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDate, setBulkDate] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dateInput, setDateInput] = useState("");

  const { data: bookings = [], isLoading, refetch } = trpc.bookings.ptsMissingPaymentDate.useQuery();

  const updateAdminFields = trpc.bookings.updateAdminFields.useMutation({
    onSuccess: () => {
      toast.success("Payment date saved");
      refetch();
    },
    onError: (err) => toast.error(err.message || "Failed to save date"),
  });

  // Apply filters
  const filtered = useMemo(() => {
    let list = bookings;
    if (pastDepartureOnly) {
      list = list.filter((b) => b.departureDate && isPast(new Date(b.departureDate)));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (b) =>
          b.clientName.toLowerCase().includes(q) ||
          ((b as any).agentName ?? "").toLowerCase().includes(q) ||
          (b.topdogRef ?? "").toLowerCase().includes(q) ||
          (b.ptsRef ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [bookings, pastDepartureOnly, search]);

  // Selection helpers
  const allSelected = filtered.length > 0 && filtered.every((b) => selectedIds.has(b.id));
  const someSelected = selectedIds.size > 0;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((b) => b.id)));
    }
  }

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Inline single-row save
  function handleSaveDate(bookingId: number) {
    if (!dateInput) return;
    updateAdminFields.mutate({ bookingId, finalSupplierPaymentDate: new Date(dateInput) });
    setEditingId(null);
    setDateInput("");
  }

  // Bulk save
  async function handleBulkSave() {
    if (!bulkDate || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    let saved = 0;
    for (const id of ids) {
      try {
        await updateAdminFields.mutateAsync({ bookingId: id, finalSupplierPaymentDate: new Date(bulkDate) });
        saved++;
      } catch {
        // continue
      }
    }
    toast.success(`Payment date set for ${saved} booking${saved !== 1 ? "s" : ""}`);
    setSelectedIds(new Set());
    setBulkDate("");
  }

  // CSV export
  function handleExport() {
    const rows = filtered;
    const headers = ["Client", "Agent", "Destination", "Departure", "Topdog Ref", "PTS Ref"];
    const lines = [
      headers.join(","),
      ...rows.map((b) =>
        [
          `"${b.clientName}"`,
          `"${(b as any).agentName ?? ""}"`,
          `"${(b as any).supplierName ?? ""}"`,
          b.departureDate ? format(new Date(b.departureDate), "dd/MM/yyyy") : "",
          b.topdogRef ?? "",
          b.ptsRef ?? "",
        ].join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pts-missing-payment-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <AlertTriangle size={20} className="text-amber-500" />
            Added to PTS — Missing Payment Date
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isLoading
              ? "Loading…"
              : `${bookings.length} booking${bookings.length !== 1 ? "s" : ""} in Added to PTS with no Final Supplier Payment Date set`}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2 flex-shrink-0" onClick={handleExport} disabled={filtered.length === 0}>
          <Download size={14} />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Input
          placeholder="Search by client, agent, Topdog ref or PTS ref…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm h-9"
        />
        <Button
          variant={pastDepartureOnly ? "default" : "outline"}
          size="sm"
          className={`gap-2 ${pastDepartureOnly ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-500" : ""}`}
          onClick={() => setPastDepartureOnly((v) => !v)}
        >
          <Calendar size={14} />
          Past departure only
        </Button>
        {filtered.length > 0 && (
          <p className="text-sm text-muted-foreground ml-auto">
            Showing {filtered.length} of {bookings.length}
          </p>
        )}
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <span className="text-sm font-medium text-amber-800">
            {selectedIds.size} booking{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <label className="text-sm text-amber-800 font-medium">Set payment date for all:</label>
            <Input
              type="date"
              value={bulkDate}
              onChange={(e) => setBulkDate(e.target.value)}
              className="h-8 text-sm w-40"
            />
            <Button
              size="sm"
              className="h-8 bg-amber-500 hover:bg-amber-600 text-white"
              disabled={!bulkDate || updateAdminFields.isPending}
              onClick={handleBulkSave}
            >
              Apply to {selectedIds.size}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-amber-800"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading bookings…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          {search || pastDepartureOnly
            ? "No bookings match your filters."
            : "All Added to PTS bookings have a payment date set."}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-4 py-2.5 w-8">
                  <button onClick={toggleAll} className="flex items-center justify-center">
                    {allSelected
                      ? <CheckSquare size={15} className="text-amber-500" />
                      : <Square size={15} className="text-muted-foreground" />}
                  </button>
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Client</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Agent</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Destination</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Departure</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Topdog Ref</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">PTS Ref</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Payment Date</th>
                <th className="px-4 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => {
                const departed = b.departureDate ? isPast(new Date(b.departureDate)) : false;
                const isSelected = selectedIds.has(b.id);
                return (
                  <tr
                    key={b.id}
                    className={`${i % 2 === 0 ? "bg-background" : "bg-muted/20"} ${isSelected ? "ring-1 ring-inset ring-amber-300" : ""}`}
                  >
                    <td className="px-4 py-2.5">
                      <button onClick={() => toggleOne(b.id)} className="flex items-center justify-center">
                        {isSelected
                          ? <CheckSquare size={15} className="text-amber-500" />
                          : <Square size={15} className="text-muted-foreground" />}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 font-medium">{b.clientName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{(b as any).agentName ?? `#${b.agentId}`}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{(b as any).supplierName ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {b.departureDate ? (
                        <span className={departed ? "text-red-600 font-medium" : "text-muted-foreground"}>
                          {format(new Date(b.departureDate), "dd MMM yyyy")}
                          {departed && <span className="ml-1 text-xs">(past)</span>}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {b.topdogRef ? <CopyableRef value={b.topdogRef} label="Topdog ref" /> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {b.ptsRef ? <CopyableRef value={b.ptsRef} label="PTS ref" /> : <span className="text-muted-foreground">—</span>}
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
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingId(null)}>✕</Button>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
