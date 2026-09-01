import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  PoundSterling, Clock, CheckCircle2, AlertCircle, RefreshCw, Download, Trash2, CreditCard, Search
} from "lucide-react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "pending" | "scheduled" | "paid" | "late" | "overdue_scheduled";
type ReimbursementSort = "oldest" | "newest";
const REIMBURSEMENTS_PER_PAGE = 25;

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: "Pending",   color: "#92400e", bg: "#fef3c7" },
  scheduled: { label: "Scheduled", color: "#065f46", bg: "#d1fae5" },
  paid:      { label: "Paid",      color: "#1e3a5f", bg: "#dbeafe" },
};

export default function AdminReimbursements() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [cardFilter, setCardFilter] = useState<CardFilter>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [clientSearch, setClientSearch] = useState("");
  const [minAmount, setMinAmount] = useState<string>("");
  const [maxAmount, setMaxAmount] = useState<string>("");
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<ReimbursementSort>("oldest");
  const [currentPage, setCurrentPage] = useState(1);
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

  const scheduledReference = (item: any) => item.scheduledAt ?? item.actionedAt ?? item.updatedAt ?? item.createdAt;
  const daysSinceScheduled = (item: any) => {
    const reference = scheduledReference(item);
    if (!reference) return 0;
    return Math.floor((Date.now() - new Date(reference).getTime()) / (1000 * 60 * 60 * 24));
  };
  const isOverdueScheduled = (item: any) => item.status === "scheduled" && daysSinceScheduled(item) >= 5;
  const items = statusFilter === "all" ? allItems
    : statusFilter === "late" ? allItems.filter((r) => r.isLate)
    : statusFilter === "overdue_scheduled" ? allItems.filter(isOverdueScheduled)
    : allItems.filter((r) => r.status === statusFilter);

  const agentNames = Array.from(new Set(allItems.map((r: any) => r.agentName).filter(Boolean))).sort() as string[];

  const filteredItems = items.filter((r: any) => {
    if (clientSearch.trim() && !(r.clientName ?? "").toLowerCase().includes(clientSearch.trim().toLowerCase())) return false;
    if (cardFilter === "jlt" && !r.jltCompanyCard) return false;
    if (cardFilter === "agent" && r.jltCompanyCard) return false;
    if (agentFilter !== "all" && r.agentName !== agentFilter) return false;
    const amt = Number(r.amount);
    if (minAmount && amt < Number(minAmount)) return false;
    if (maxAmount && amt > Number(maxAmount)) return false;
    return true;
  }).sort((a: any, b: any) => {
    const dateA = new Date(statusFilter === "overdue_scheduled" ? scheduledReference(a) : a.createdAt).getTime();
    const dateB = new Date(statusFilter === "overdue_scheduled" ? scheduledReference(b) : b.createdAt).getTime();
    return sortOrder === "oldest" ? dateA - dateB : dateB - dateA;
  });
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / REIMBURSEMENTS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * REIMBURSEMENTS_PER_PAGE;
  const paginatedItems = filteredItems.slice(pageStart, pageStart + REIMBURSEMENTS_PER_PAGE);
  const hasExtraFilters = !!clientSearch.trim() || cardFilter !== "all" || agentFilter !== "all" || !!minAmount || !!maxAmount;

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, clientSearch, cardFilter, agentFilter, minAmount, maxAmount, sortOrder]);

  const handleSchedule = (id: number) => {
    updateStatus.mutate({ id, status: "scheduled" });
  };
  const handlePaid = (id: number) => {
    updateStatus.mutate({ id, status: "paid" });
  };

  const exportCsv = () => {
    const rows = [
      ["Client", "PTS Ref", "Agent", "Supplier", "Amount (£)", "Status", "Late", "Departure Date", "Created"],
      ...filteredItems.map((r) => [
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
  const scheduled = allItems.filter((r) => r.status === "scheduled");
  const paid = allItems.filter((r) => r.status === "paid");
  const late = allItems.filter((r) => r.isLate ?? false);
  const overdueScheduled = allItems.filter(isOverdueScheduled);
  const overdueScheduledTotal = overdueScheduled.reduce((sum, item) => sum + Number(item.amount), 0);

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
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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
          onClick={() => setStatusFilter("overdue_scheduled")}
          className={`text-left rounded-xl p-4 border-2 transition-all ${statusFilter === "overdue_scheduled" ? "border-red-400 shadow-sm" : "border-transparent"}`}
          style={{ background: "#fff1f2" }}
        >
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle size={15} style={{ color: overdueScheduled.length > 0 ? "#e11d48" : "#9ca3af" }} />
            <span className="text-xs text-muted-foreground font-medium">Scheduled 5+ days</span>
          </div>
          <p className="text-2xl font-bold" style={{ color: overdueScheduled.length > 0 ? "#be123c" : "#414141" }}>{overdueScheduled.length}</p>
          <p className="text-xs" style={{ color: overdueScheduled.length > 0 ? "#be123c" : "#6b7280", opacity: 0.8 }}>£{overdueScheduledTotal.toFixed(2)} unpaid</p>
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "pending", "scheduled", "overdue_scheduled", "paid", "late"] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${statusFilter === f ? "border-[#70FFE8] bg-[#70FFE8]/20 text-[#414141]" : "border-border text-muted-foreground hover:bg-muted"}`}
          >
            {f === "all" ? "All" : f === "overdue_scheduled" ? "Scheduled 5+ days" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Extra filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Search size={13} className="text-muted-foreground" />
        <Input
          value={clientSearch}
          onChange={(e) => setClientSearch(e.target.value)}
          placeholder="Search client name…"
          aria-label="Search reimbursements by client name"
          className="h-7 w-44 text-xs"
        />
        <Clock size={13} className="text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Sort:</span>
        <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as ReimbursementSort)} className="h-7 text-xs border rounded-md px-2 bg-background">
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
        </select>
        <CreditCard size={13} className="text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Card:</span>
        <select value={cardFilter} onChange={(e) => setCardFilter(e.target.value as CardFilter)} className="h-7 text-xs border rounded-md px-2 bg-background">
          <option value="all">All</option>
          <option value="jlt">JLT Company Card</option>
          <option value="agent">Agent Card</option>
        </select>
        <span className="text-xs text-muted-foreground ml-2">Agent:</span>
        <Popover open={agentPickerOpen} onOpenChange={setAgentPickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" className="h-7 text-xs w-44 justify-between font-normal">
              {agentFilter === "all" ? "All agents" : agentFilter}
              <ChevronsUpDown size={11} className="ml-1 opacity-50 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search agents…" className="h-8 text-xs" />
              <CommandList>
                <CommandEmpty>No agent found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="all" onSelect={() => { setAgentFilter("all"); setAgentPickerOpen(false); }}>
                    <Check size={11} className={cn("mr-2", agentFilter === "all" ? "opacity-100" : "opacity-0")} />
                    All agents
                  </CommandItem>
                  {agentNames.map((name) => (
                    <CommandItem key={name} value={name} onSelect={() => { setAgentFilter(name); setAgentPickerOpen(false); }}>
                      <Check size={11} className={cn("mr-2", agentFilter === name ? "opacity-100" : "opacity-0")} />
                      {name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <span className="text-xs text-muted-foreground ml-2">Amount:</span>
        <Input type="number" placeholder="Min £" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="h-7 text-xs w-20" />
        <span className="text-xs text-muted-foreground">–</span>
        <Input type="number" placeholder="Max £" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className="h-7 text-xs w-20" />
        {hasExtraFilters && (
          <>
            <button onClick={() => { setClientSearch(""); setCardFilter("all"); setAgentFilter("all"); setMinAmount(""); setMaxAmount(""); }} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline ml-1"><X size={11} /> Clear</button>
            <span className="text-xs text-muted-foreground">({filteredItems.length} of {items.length})</span>
          </>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <PoundSterling size={32} className="mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No reimbursements match the current filters.</p>
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
                {paginatedItems.map((r) => {
                  const sb = STATUS_BADGE[r.status] ?? STATUS_BADGE.pending;
                  return (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <a
                          href={`/bookings/${r.bookingId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:underline text-left"
                          title={`Open ${r.clientName ?? "booking"} in a new tab`}
                        >
                          {r.clientName ?? "—"}
                        </a>
                        {r.isLate && (
                          <span className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "#fee2e2", color: "#991b1b" }}>Late</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{r.ptsRef ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.agentName ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span>{r.supplierName}</span>
                          {(r as any).jltCompanyCard && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                              style={{ background: "#70FFE8", color: "#1a4a44" }}
                              title="Paid on JLT company card — funds return to JLT"
                            >
                              <CreditCard size={10} />
                              JLT Card
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">£{Number(r.amount).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: sb.bg, color: sb.color }}>
                          {sb.label}
                        </span>
                        {r.status === "scheduled" && (
                          <p className={`mt-1 text-[10px] font-medium ${isOverdueScheduled(r) ? "text-red-600" : "text-muted-foreground"}`}>
                            Scheduled {daysSinceScheduled(r)} day{daysSinceScheduled(r) === 1 ? "" : "s"} ago
                          </p>
                        )}
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
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 border-amber-300 text-amber-700 hover:bg-amber-50"
                                disabled={updateStatus.isPending}
                                onClick={() => updateStatus.mutate({ id: r.id, status: "pending" })}
                                title="Reset this reimbursement back to pending — use if PTS did not process the payment"
                              >
                                Reset to Pending
                              </Button>
                              <Button size="sm" className="text-xs h-7 font-semibold" style={{ background: "#70FFE8", color: "#414141" }} disabled={updateStatus.isPending} onClick={() => handlePaid(r.id)}>
                                Mark Paid
                              </Button>
                            </>
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
          <div className="flex flex-col gap-3 border-t bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Showing <span className="font-semibold text-foreground">{pageStart + 1}–{Math.min(pageStart + REIMBURSEMENTS_PER_PAGE, filteredItems.length)}</span> of <span className="font-semibold text-foreground">{filteredItems.length}</span> reimbursements
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={safeCurrentPage === 1}
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                >
                  Previous
                </Button>
                <span className="min-w-20 text-center text-xs text-muted-foreground">
                  Page {safeCurrentPage} of {totalPages}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={safeCurrentPage === totalPages}
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
type CardFilter = "all" | "jlt" | "agent";
