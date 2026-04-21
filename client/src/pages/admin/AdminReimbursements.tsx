import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  PoundSterling, Clock, CheckCircle2, AlertCircle, RefreshCw, Download, Trash2
} from "lucide-react";
import { format } from "date-fns";

type StatusFilter = "all" | "pending" | "scheduled" | "paid" | "late";

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: "Pending",   color: "#92400e", bg: "#fef3c7" },
  scheduled: { label: "Scheduled", color: "#065f46", bg: "#d1fae5" },
  paid:      { label: "Paid",      color: "#1e3a5f", bg: "#dbeafe" },
};

export default function AdminReimbursements() {
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const utils = trpc.useUtils();

  const { data: allItems = [], isLoading, refetch } = trpc.reimbursements.list.useQuery({});
  const { data: stats } = trpc.reimbursements.dashboardStats.useQuery();
  const { data: adminUsersForAssign = [] } = trpc.reimbursements.listAdminsForAssign.useQuery();
  const updateStatus = trpc.reimbursements.updateStatus.useMutation({
    onSuccess: () => { refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const assignReimb = trpc.reimbursements.assign.useMutation({ onSuccess: () => refetch() });
  const markActioned = trpc.reimbursements.markActioned.useMutation({ onSuccess: () => refetch() });
  const deleteItem = trpc.reimbursements.deleteItem.useMutation({
    onSuccess: () => { toast.success("Reimbursement item deleted"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const handleDelete = (id: number, supplierName: string) => {
    if (!window.confirm(`Delete reimbursement item "${supplierName}"? This cannot be undone.`)) return;
    deleteItem.mutate({ id });
  };

  const items = statusFilter === "all" ? allItems
    : statusFilter === "late" ? allItems.filter((r) => r.isLate)
    : allItems.filter((r) => r.status === statusFilter);

  const handleSchedule = (id: number) => {
    updateStatus.mutate({ id, status: "scheduled" });
  };
  const handlePaid = (id: number) => {
    updateStatus.mutate({ id, status: "paid" });
  };

  const exportCsv = () => {
    const rows = [
      ["Client", "PTS Ref", "Agent", "Supplier", "Amount (£)", "Status", "Late", "Departure Date", "Created"],
      ...items.map((r) => [
        r.clientName ?? "",
        r.ptsRef ?? "",
        r.agentName ?? "",
        r.supplierName,
        Number(r.amount).toFixed(2),
        r.status,
        r.isLate ? "Yes" : "No",
        r.departureDate ? format(new Date(r.departureDate), "dd/MM/yyyy") : "",
        format(new Date(r.createdAt), "dd/MM/yyyy"),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reimbursements-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pending = items.filter((r) => r.status === "pending");
  const scheduled = items.filter((r) => r.status === "scheduled");
  const paid = items.filter((r) => r.status === "paid");
  const late = items.filter((r) => r.isLate ?? false);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Reimbursements</h1>
          <p className="text-sm text-muted-foreground">Track and manage all agent reimbursements</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv}>
          <Download size={14} />
          Export CSV
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => setStatusFilter("pending")}
          className={`text-left rounded-xl p-4 border-2 transition-all ${statusFilter === "pending" ? "border-amber-400 shadow-sm" : "border-transparent"}`}
          style={{ background: "#fef3c7" }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Clock size={15} style={{ color: "#d97706" }} />
            <span className="text-xs text-muted-foreground font-medium">Pending</span>
          </div>
          <p className="text-2xl font-bold" style={{ color: "#92400e" }}>{stats?.pendingCount ?? pending.length}</p>
          <p className="text-xs" style={{ color: "#92400e", opacity: 0.8 }}>
            £{(stats?.pendingTotal ?? pending.reduce((s, r) => s + Number(r.amount), 0)).toFixed(2)}
          </p>
        </button>

        <button
          onClick={() => setStatusFilter("scheduled")}
          className={`text-left rounded-xl p-4 border-2 transition-all ${statusFilter === "scheduled" ? "border-green-400 shadow-sm" : "border-transparent"}`}
          style={{ background: "#d1fae5" }}
        >
          <div className="flex items-center gap-2 mb-1">
            <RefreshCw size={15} style={{ color: "#059669" }} />
            <span className="text-xs text-muted-foreground font-medium">Scheduled</span>
          </div>
          <p className="text-2xl font-bold" style={{ color: "#065f46" }}>{stats?.scheduledCount ?? scheduled.length}</p>
          <p className="text-xs" style={{ color: "#065f46", opacity: 0.8 }}>
            £{(stats?.scheduledTotal ?? scheduled.reduce((s, r) => s + Number(r.amount), 0)).toFixed(2)}
          </p>
        </button>

        <button
          onClick={() => setStatusFilter("paid")}
          className={`text-left rounded-xl p-4 border-2 transition-all ${statusFilter === "paid" ? "border-blue-400 shadow-sm" : "border-transparent"}`}
          style={{ background: "#dbeafe" }}
        >
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={15} style={{ color: "#2563eb" }} />
            <span className="text-xs text-muted-foreground font-medium">Paid</span>
          </div>
          <p className="text-2xl font-bold" style={{ color: "#1e3a5f" }}>{paid.length}</p>
          <p className="text-xs" style={{ color: "#1e3a5f", opacity: 0.8 }}>
            £{paid.reduce((s, r) => s + Number(r.amount), 0).toFixed(2)}
          </p>
        </button>

        <button
          onClick={() => setStatusFilter("all")}
          className={`text-left rounded-xl p-4 border-2 transition-all ${statusFilter === "all" ? "border-[#70FFE8] shadow-sm" : "border-transparent"}`}
          style={{ background: "#f9fafb" }}
        >
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle size={15} style={{ color: late.length > 0 ? "#e11d48" : "#9ca3af" }} />
            <span className="text-xs text-muted-foreground font-medium">Late</span>
          </div>
          <p className="text-2xl font-bold" style={{ color: late.length > 0 ? "#e11d48" : "#414141" }}>{late.length}</p>
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "pending", "scheduled", "paid", "late"] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${statusFilter === f ? "border-[#70FFE8] bg-[#70FFE8]/20 text-[#414141]" : "border-border text-muted-foreground hover:bg-muted"}`}
          >
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <PoundSterling size={32} className="mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No reimbursements found for this filter.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Client</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">PTS Ref</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Agent</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Supplier</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Amount</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Departure</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Assigned To</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const sb = STATUS_BADGE[r.status] ?? STATUS_BADGE.pending;
                  return (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          className="font-medium hover:underline text-left"
                          onClick={() => navigate(`/bookings/${r.bookingId}`)}
                        >
                          {r.clientName ?? "—"}
                        </button>
                        {r.isLate && (
                          <span className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "#fee2e2", color: "#991b1b" }}>Late</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{r.ptsRef ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.agentName ?? "—"}</td>
                      <td className="px-4 py-3">{r.supplierName}</td>
                      <td className="px-4 py-3 text-right font-medium">£{Number(r.amount).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: sb.bg, color: sb.color }}>
                          {sb.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {r.departureDate ? format(new Date(r.departureDate), "dd MMM yyyy") : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="text-xs border rounded px-1.5 py-1 bg-white min-w-[120px]"
                          value={(r as any).assignedToId ?? ""}
                          onChange={(e) => assignReimb.mutate({ id: r.id, assignedToId: e.target.value ? Number(e.target.value) : null })}
                        >
                          <option value="">Unassigned</option>
                          {adminUsersForAssign.map((a: any) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {r.status === "pending" && r.isLate && (
                            <Button size="sm" variant="outline" className="text-xs h-7" disabled={updateStatus.isPending} onClick={() => handleSchedule(r.id)}>
                              Mark Scheduled
                            </Button>
                          )}
                          {r.status === "scheduled" && (
                            <Button size="sm" className="text-xs h-7 font-semibold" style={{ background: "#70FFE8", color: "#414141" }} disabled={updateStatus.isPending} onClick={() => handlePaid(r.id)}>
                              Mark Paid
                            </Button>
                          )}
                          {r.status === "paid" && (
                            <span className="text-xs text-muted-foreground">{(r as any).paidAt ? format(new Date((r as any).paidAt), "dd MMM yyyy") : "Paid"}</span>
                          )}
                          {r.isLate && !(r as any).actionedAt && (
                            <button
                              onClick={() => markActioned.mutate({ id: r.id })}
                              disabled={markActioned.isPending}
                              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium hover:bg-green-100 text-green-700 border border-green-200"
                            >
                              <CheckCircle2 size={10} /> Actioned
                            </button>
                          )}
                          {r.isLate && (r as any).actionedAt && (
                            <span className="text-[10px] text-green-600 font-medium">✓ Actioned</span>
                          )}
                          <button
                            onClick={() => handleDelete(r.id, r.supplierName)}
                            disabled={deleteItem.isPending}
                            title="Delete this reimbursement item"
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium hover:bg-red-50 text-red-500 border border-red-200 ml-1"
                          >
                            <Trash2 size={10} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
