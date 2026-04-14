import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, Banknote, CheckCircle, Clock, Trash2, Download } from "lucide-react";
import CopyableRef from "@/components/CopyableRef";
import { useLocation } from "wouter";

type ClaimRow = {
  id: number;
  bookingId: number;
  agentId: number;
  agentName: string;
  agentEmail: string;
  status: string;
  claimedAt: Date | string;
  paidAt: Date | string | null;
  paidByName: string | null;
  bookingType?: string | null;
  booking: {
    clientName: string;
    departureDate: Date | string | null;
    expectedCommission: number | null;
    ptsRef?: string | null;
    topdogRef?: string | null;
  } | null;
};

export default function AdminCommissions() {
  const [, navigate] = useLocation();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<ClaimRow | null>(null);
  const utils = trpc.useUtils();

  const { data: claims, isLoading } = trpc.commissionClaims.all.useQuery();
  const deleteClaimMutation = trpc.commissionClaims.deleteClaim.useMutation({
    onSuccess: () => {
      toast.success("Commission claim deleted.");
      setDeleteTarget(null);
      utils.commissionClaims.all.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const markPaidMutation = trpc.commissionClaims.markPaid.useMutation({
    onSuccess: () => {
      toast.success(`${selectedIds.size} commission(s) marked as paid.`);
      setSelectedIds(new Set());
      utils.commissionClaims.all.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const allClaims = (claims ?? []) as ClaimRow[];
  const pending = allClaims.filter((c) => c.status === "claimed_not_paid");
  const paid = allClaims.filter((c) => c.status === "paid");

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (rows: ClaimRow[]) => {
    const allSelected = rows.every((r) => selectedIds.has(r.id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        rows.forEach((r) => next.delete(r.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        rows.forEach((r) => next.add(r.id));
        return next;
      });
    }
  };

  const handleMarkPaid = () => {
    if (selectedIds.size === 0) return;
    markPaidMutation.mutate({ claimIds: Array.from(selectedIds) });
  };

  const formatDate = (d: Date | string | null | undefined) => {
    if (!d) return "—";
    return format(new Date(d), "dd/MM/yyyy");
  };

  const exportCSV = (rows: ClaimRow[], filename: string) => {
    const headers = ["Client", "Agent", "Agent Email", "Departure", "Expected Commission (£)", "Booking Type", "Claimed On", "Processed On", "Processed By", "Status"];
    const csvRows = rows.map((c) => [
      c.booking?.clientName ?? "",
      c.agentName,
      c.agentEmail,
      formatDate(c.booking?.departureDate),
      c.booking?.expectedCommission != null ? Number(c.booking.expectedCommission).toFixed(2) : "",
      c.bookingType ?? "",
      formatDate(c.claimedAt),
      formatDate(c.paidAt),
      c.paidByName ?? "",
      c.status === "paid" ? "Processed" : "Awaiting Payment",
    ]);
    const csv = [headers, ...csvRows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-[#02E6D2]" />
      </div>
    );
  }

  const ClaimTable = ({ rows, showSelect }: { rows: ClaimRow[]; showSelect?: boolean }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            {showSelect && (
              <th className="py-3 px-4 text-left w-10">
                <Checkbox
                  checked={rows.length > 0 && rows.every((r) => selectedIds.has(r.id))}
                  onCheckedChange={() => toggleSelectAll(rows)}
                />
              </th>
            )}
            <th className="py-3 px-4 text-left font-medium">Client</th>
            <th className="py-3 px-4 text-left font-medium">PTS Ref</th>
            <th className="py-3 px-4 text-left font-medium">Agent</th>
            <th className="py-3 px-4 text-left font-medium">Departure</th>
            <th className="py-3 px-4 text-left font-medium">Expected Comm.</th>
            <th className="py-3 px-4 text-left font-medium">Type</th>
            <th className="py-3 px-4 text-left font-medium">Claimed On</th>
            {!showSelect && <th className="py-3 px-4 text-left font-medium">Processed On</th>}
            {!showSelect && <th className="py-3 px-4 text-left font-medium">Processed By</th>}
            <th className="py-3 px-4 text-left font-medium">Status</th>
            <th className="py-3 px-4 text-left font-medium">Booking</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={showSelect ? 9 : 10} className="py-12 text-center text-muted-foreground">
                No records found.
              </td>
            </tr>
          ) : (
            rows.map((c) => (
              <tr key={c.id} className="border-b border-border hover:bg-accent/20 transition-colors">
                {showSelect && (
                  <td className="py-3 px-4">
                    <Checkbox
                      checked={selectedIds.has(c.id)}
                      onCheckedChange={() => toggleSelect(c.id)}
                    />
                  </td>
                )}
                <td className="py-3 px-4 font-medium">{c.booking?.clientName ?? "—"}</td>
                <td className="py-3 px-4">
                  {c.booking?.ptsRef ? (
                    <CopyableRef value={c.booking.ptsRef} />
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <div>
                    <p>{c.agentName}</p>
                    <p className="text-xs text-muted-foreground">{c.agentEmail}</p>
                  </div>
                </td>
                <td className="py-3 px-4">{formatDate(c.booking?.departureDate)}</td>
                <td className="py-3 px-4">
                  {c.booking?.expectedCommission != null ? `£${Number(c.booking.expectedCommission).toFixed(2)}` : "—"}
                </td>
                <td className="py-3 px-4 capitalize">{c.bookingType ?? "—"}</td>
                <td className="py-3 px-4">{formatDate(c.claimedAt)}</td>
                {!showSelect && <td className="py-3 px-4">{formatDate(c.paidAt)}</td>}
                {!showSelect && <td className="py-3 px-4">{c.paidByName ?? "—"}</td>}
                <td className="py-3 px-4">
                  <Badge
                    variant="outline"
                    className={
                      c.status === "paid"
                        ? "border-emerald-500 text-emerald-600"
                        : "border-amber-500 text-amber-600"
                    }
                  >
                    {c.status === "paid" ? "Paid" : "Claimed – Awaiting Payment"}
                  </Badge>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/bookings/${c.bookingId}`)}
                      className="text-[#02E6D2] hover:text-[#02E6D2] hover:bg-[#02E6D2]/10 text-xs"
                    >
                      View
                    </Button>
                    {showSelect && c.status === "claimed_not_paid" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => markPaidMutation.mutate({ claimIds: [c.id] })}
                        disabled={markPaidMutation.isPending}
                        className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 text-xs"
                      >
                        Pay
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(c)}
                      className="text-red-500 hover:text-red-600 hover:bg-red-50 text-xs"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Commission Management</h1>
          <p className="text-muted-foreground mt-1">Review and process agent commission claims.</p>
        </div>
        {selectedIds.size > 0 && (
          <Button
            onClick={handleMarkPaid}
            disabled={markPaidMutation.isPending}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold"
          >
            {markPaidMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Banknote className="h-4 w-4 mr-2" />
            )}
            Mark {selectedIds.size} as Paid
          </Button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <Card className="border-amber-400">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              <div>
                <p className="text-2xl font-bold text-amber-500">{pending.length}</p>
                <p className="text-xs text-muted-foreground">Awaiting Payment</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-400">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold text-emerald-500">{paid.length}</p>
                <p className="text-xs text-muted-foreground">Paid</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{allClaims.length}</p>
                <p className="text-xs text-muted-foreground">Total Claims</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="pending">
        <TabsList className="mb-4">
          <TabsTrigger value="pending">
            Awaiting Payment
            {pending.length > 0 && (
              <span className="ml-2 bg-amber-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                {pending.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="paid">Paid History</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Claims Awaiting Payment</span>
                <div className="flex items-center gap-2">
                  {pending.length > 0 && selectedIds.size === 0 && (
                    <Button variant="outline" size="sm" onClick={() => toggleSelectAll(pending)} className="text-xs">
                      Select All
                    </Button>
                  )}
                  {pending.length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => exportCSV(pending, `commissions-pending-${format(new Date(), 'yyyy-MM-dd')}.csv`)} className="text-xs gap-1">
                      <Download size={13} /> Export CSV
                    </Button>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ClaimTable rows={pending} showSelect />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="paid">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
              <span>Payment History</span>
              {paid.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => exportCSV(paid, `commissions-paid-${format(new Date(), 'yyyy-MM-dd')}.csv`)} className="text-xs gap-1">
                  <Download size={13} /> Export CSV
                </Button>
              )}
            </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ClaimTable rows={paid} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Commission Claim</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the commission claim for{" "}
              <strong>{deleteTarget?.booking?.clientName ?? "this booking"}</strong> by{" "}
              <strong>{deleteTarget?.agentName}</strong>? The booking will be reverted to{" "}
              <em>Commission Claimable</em> so the agent can re-claim if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deleteTarget && deleteClaimMutation.mutate({ claimId: deleteTarget.id })}
              disabled={deleteClaimMutation.isPending}
            >
              {deleteClaimMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
