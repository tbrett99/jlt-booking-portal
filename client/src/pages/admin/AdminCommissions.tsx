import { useState, useMemo, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Banknote, CheckCircle, Clock, Trash2, Download, FileSpreadsheet, CheckCheck, AlertCircle, XCircle, CheckCircle2, TrendingDown } from "lucide-react";
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
  vatAmount?: string | number | null;
  booking: {
    clientName: string;
    departureDate: Date | string | null;
    expectedCommission: number | null;
    ptsRef?: string | null;
    topdogRef?: string | null;
  } | null;
};

type VatPreviewRow = {
  ref: string;
  csvClient: string;
  vat: number;
  status: "matched" | "no_booking" | "no_claim";
  claimId: number | null;
  claimStatus: string | null;
  currentVat: number | null;
  bookingClient: string | null;
};

// Parse CSV text into array of objects keyed by header
function parseCsvToObjects(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const results: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (cols[idx] ?? "").trim(); });
    const ref = row["Booking Ref"] ?? row["Booking Reference"] ?? "";
    if (!ref) continue;
    results.push(row);
  }
  return results;
}

function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return format(new Date(d), "dd/MM/yyyy");
}

// ─── ClaimTable defined at MODULE SCOPE so React never remounts it on vatEditing state changes ───
type ClaimTableProps = {
  rows: ClaimRow[];
  showSelect?: boolean;
  selectedIds: Set<number>;
  vatEditing: Record<number, string>;
  setVatEditing: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  toggleSelectAll: (rows: ClaimRow[]) => void;
  toggleSelect: (id: number) => void;
  handleVatBlur: (claimId: number) => void;
  markPaidMutation: { mutate: (args: { claimIds: number[] }) => void; isPending: boolean };
  setDeleteTarget: (c: ClaimRow | null) => void;
  navigate: (to: string) => void;
};

function ClaimTable({
  rows, showSelect,
  selectedIds, vatEditing, setVatEditing,
  toggleSelectAll, toggleSelect, handleVatBlur,
  markPaidMutation, setDeleteTarget, navigate,
}: ClaimTableProps) {
  return (
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
            <th className="py-3 px-4 text-left font-medium">VAT (£)</th>
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
              <td colSpan={showSelect ? 10 : 11} className="py-12 text-center text-muted-foreground">
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
                <td className="py-3 px-4">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={vatEditing[c.id] !== undefined ? vatEditing[c.id] : (c.vatAmount != null ? Number(c.vatAmount).toFixed(2) : "")}
                    onChange={(e) => setVatEditing((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    onBlur={() => handleVatBlur(c.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    className="w-24 h-7 px-2 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-[#02E6D2]"
                  />
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
                        : c.status === "awaiting_payment"
                        ? "border-amber-500 text-amber-600"
                        : "border-orange-500 text-orange-600"
                    }
                  >
                    {c.status === "paid" ? "Paid" : c.status === "awaiting_payment" ? "Awaiting Payment" : "Processing"}
                  </Badge>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/bookings/${c.bookingId}`)}
                      className="text-xs"
                    >
                      View
                    </Button>
                    {showSelect && (c.status === "processing") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => markPaidMutation.mutate({ claimIds: [c.id] })}
                        disabled={markPaidMutation.isPending}
                        className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 text-xs"
                      >
                        Claimed in PTS
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
}

export default function AdminCommissions() {
  const [, navigate] = useLocation();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<ClaimRow | null>(null);
  const [vatEditing, setVatEditing] = useState<Record<number, string>>({});

  // VAT import state
  const [vatImportOpen, setVatImportOpen] = useState(false);
  const [vatPreviewRows, setVatPreviewRows] = useState<VatPreviewRow[]>([]);
  const [vatCsvRows, setVatCsvRows] = useState<{ ref: string; clientName: string; vat: number }[]>([]);
  const [vatPreviewing, setVatPreviewing] = useState(false);
  const [vatApplying, setVatApplying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();

  const updateVatMutation = trpc.commissionClaims.updateVat.useMutation({
    onSuccess: () => utils.commissionClaims.all.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  const applyVatMutation = trpc.commissionClaims.applyVatFromCsv.useMutation({
    onSuccess: (data) => {
      toast.success(`VAT updated on ${data.updated} commission claim(s).`);
      setVatImportOpen(false);
      setVatPreviewRows([]);
      setVatCsvRows([]);
      utils.commissionClaims.all.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const previewVatQuery = trpc.commissionClaims.previewVatFromCsv.useQuery(
    { rows: vatCsvRows },
    { enabled: vatCsvRows.length > 0 && vatImportOpen }
  );

  useEffect(() => {
    if (previewVatQuery.data) {
      setVatPreviewRows(previewVatQuery.data as VatPreviewRow[]);
      setVatPreviewing(false);
    }
  }, [previewVatQuery.data]);

  useEffect(() => {
    if (previewVatQuery.error) {
      toast.error(previewVatQuery.error.message);
      setVatPreviewing(false);
    }
  }, [previewVatQuery.error]);

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
      toast.success(`${selectedIds.size} commission(s) claimed in PTS.`);
      setSelectedIds(new Set());
      utils.commissionClaims.all.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // Pending review state
  const [markClaimableTarget, setMarkClaimableTarget] = useState<ClaimRow | null>(null);
  const [topUpTarget, setTopUpTarget] = useState<ClaimRow | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpNote, setTopUpNote] = useState("");

  const markClaimableMutation = trpc.commissionClaims.markClaimable.useMutation({
    onSuccess: () => {
      toast.success("Claim marked as claimable — moved to Processing.");
      setMarkClaimableTarget(null);
      utils.commissionClaims.all.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const requestTopUpMutation = trpc.commissionClaims.requestTopUp.useMutation({
    onSuccess: () => {
      toast.success("Top-up request sent to agent.");
      setTopUpTarget(null);
      setTopUpAmount("");
      setTopUpNote("");
      utils.commissionClaims.all.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const allClaims = (claims ?? []) as ClaimRow[];
  const pendingReview = allClaims.filter((c) => c.status === "pending");
  const topUpRequired = allClaims.filter((c) => c.status === "top_up_required");
  const processing = allClaims.filter((c) => c.status === "processing");
  const awaitingPayment = allClaims.filter((c) => c.status === "awaiting_payment");
  const claimed = awaitingPayment;
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

  const handleVatBlur = (claimId: number) => {
    const raw = vatEditing[claimId];
    if (raw === undefined) return;
    const parsed = raw.trim() === "" ? null : parseFloat(raw);
    if (parsed !== null && isNaN(parsed)) { toast.error("Invalid VAT amount"); return; }
    updateVatMutation.mutate({ claimId, vatAmount: parsed });
    setVatEditing((prev) => { const n = { ...prev }; delete n[claimId]; return n; });
  };

  const exportCSV = (rows: ClaimRow[], filename: string) => {
    const headers = ["Client", "Agent", "Agent Email", "Departure", "Expected Commission (£)", "VAT (£)", "Booking Type", "Claimed On", "Processed On", "Processed By", "Status"];
    const csvRows = rows.map((c) => [
      c.booking?.clientName ?? "",
      c.agentName,
      c.agentEmail,
      formatDate(c.booking?.departureDate),
      c.booking?.expectedCommission != null ? Number(c.booking.expectedCommission).toFixed(2) : "",
      c.vatAmount != null ? Number(c.vatAmount).toFixed(2) : "",
      c.bookingType ?? "",
      formatDate(c.claimedAt),
      formatDate(c.paidAt),
      c.paidByName ?? "",
      c.status === "paid" ? "Paid" : c.status === "awaiting_payment" ? "Awaiting Payment" : "Processing",
    ]);
    const csv = [headers, ...csvRows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCsvToObjects(text);
      const mapped = rows
        .map((r) => ({
          ref: (r["Booking Ref"] ?? r["Booking Reference"] ?? "").trim(),
          clientName: (r["Client Name"] ?? r["Client"] ?? "").trim(),
          vat: parseFloat(r["VAT"] ?? "0") || 0,
        }))
        .filter((r) => r.ref);
      if (mapped.length === 0) {
        toast.error("No valid rows found in CSV. Check the Booking Ref and VAT columns.");
        return;
      }
      setVatPreviewing(true);
      setVatCsvRows(mapped);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleApplyVat = () => {
    const updates = vatPreviewRows
      .filter((r) => r.status === "matched" && r.claimId !== null)
      .map((r) => ({ claimId: r.claimId!, vat: r.vat }));
    if (updates.length === 0) {
      toast.error("No matched claims to update.");
      return;
    }
    setVatApplying(true);
    applyVatMutation.mutate({ updates });
  };

  const matchedRows = vatPreviewRows.filter((r) => r.status === "matched");
  const noBookingRows = vatPreviewRows.filter((r) => r.status === "no_booking");
  const noClaimRows = vatPreviewRows.filter((r) => r.status === "no_claim");

  // Shared props passed down to the module-scope ClaimTable
  const tableProps = { selectedIds, vatEditing, setVatEditing, toggleSelectAll, toggleSelect, handleVatBlur, markPaidMutation, setDeleteTarget, navigate };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-[#02E6D2]" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Commission Management</h1>
          <p className="text-muted-foreground mt-1">Review and process agent commission claims.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setVatImportOpen(true); setVatPreviewRows([]); setVatCsvRows([]); }}
            className="gap-2 border-[#02E6D2] text-[#02E6D2] hover:bg-[#02E6D2]/10"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Import VAT from CSV
          </Button>
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
              Claimed in PTS ({selectedIds.size})
            </Button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Card className="border-yellow-400">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-yellow-500" />
              <div>
                <p className="text-2xl font-bold text-yellow-500">{pendingReview.length}</p>
                <p className="text-xs text-muted-foreground">Pending Review</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-400">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-500" />
              <div>
                <p className="text-2xl font-bold text-red-500">{topUpRequired.length}</p>
                <p className="text-xs text-muted-foreground">Top-Up Required</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-400">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              <div>
                <p className="text-2xl font-bold text-orange-500">{processing.length}</p>
                <p className="text-xs text-muted-foreground">Processing</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-400">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-2xl font-bold text-blue-500">{claimed.length}</p>
                <p className="text-xs text-muted-foreground">Claimed in PTS</p>
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

      <Tabs defaultValue="processing">
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          <TabsTrigger value="top_up">
            Top-Up Required
            {topUpRequired.length > 0 && (
              <span className="ml-2 bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                {topUpRequired.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="processing">
            Processing
            {processing.length > 0 && (
              <span className="ml-2 bg-orange-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                {processing.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="claimed">
            Claimed
            {claimed.length > 0 && (
              <span className="ml-2 bg-blue-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                {claimed.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="paid">Paid</TabsTrigger>
        </TabsList>

        {/* TOP-UP REQUIRED TAB */}
        <TabsContent value="top_up">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Top-Up Required — Awaiting agent action</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {topUpRequired.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">No files awaiting top-up.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-3 px-4 text-left">Client</th>
                        <th className="py-3 px-4 text-left">Agent</th>
                        <th className="py-3 px-4 text-left">Departure</th>
                        <th className="py-3 px-4 text-left">Commission</th>
                        <th className="py-3 px-4 text-left">Top-Up Amount</th>
                        <th className="py-3 px-4 text-left">Note</th>
                        <th className="py-3 px-4 text-left">Requested</th>
                        <th className="py-3 px-4 text-left">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topUpRequired.map((c) => (
                        <tr key={c.id} className="border-b border-border hover:bg-muted/30">
                          <td className="py-3 px-4">
                            <div className="font-medium">{c.booking?.clientName ?? "—"}</div>
                            {c.booking?.ptsRef && <div className="text-xs text-muted-foreground">{c.booking.ptsRef}</div>}
                          </td>
                          <td className="py-3 px-4">
                            <div>{c.agentName}</div>
                            <div className="text-xs text-muted-foreground">{c.agentEmail}</div>
                          </td>
                          <td className="py-3 px-4">{c.booking?.departureDate ? format(new Date(c.booking.departureDate), "dd/MM/yyyy") : "—"}</td>
                          <td className="py-3 px-4 font-semibold">
                            {c.booking?.expectedCommission != null ? `£${Number(c.booking.expectedCommission).toFixed(2)}` : "—"}
                          </td>
                          <td className="py-3 px-4 font-semibold text-red-500">
                            {(c as any).topUpAmountPence != null ? `£${(Number((c as any).topUpAmountPence) / 100).toFixed(2)}` : "—"}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground text-xs max-w-[200px]">
                            {(c as any).topUpNote ?? "—"}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground text-xs">{format(new Date(c.claimedAt), "dd/MM/yyyy")}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteTarget(c)}
                                className="text-red-500 hover:text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* PROCESSING TAB */}
        <TabsContent value="processing">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Processing — Claim in PTS to advance</span>
                <div className="flex items-center gap-2">
                  {processing.length > 0 && selectedIds.size === 0 && (
                    <Button variant="outline" size="sm" onClick={() => toggleSelectAll(processing)} className="text-xs">
                      Select All
                    </Button>
                  )}
                  {processing.length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => exportCSV(processing, `commissions-processing-${format(new Date(), "yyyy-MM-dd")}.csv`)} className="text-xs gap-1">
                      <Download size={13} /> Export CSV
                    </Button>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ClaimTable rows={processing} showSelect {...tableProps} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="claimed">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Claimed in PTS — Awaiting Payment Run</span>
                {claimed.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => exportCSV(claimed, `commissions-claimed-${format(new Date(), "yyyy-MM-dd")}.csv`)} className="text-xs gap-1">
                    <Download size={13} /> Export CSV
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ClaimTable rows={claimed} {...tableProps} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="paid">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Paid — Confirmed by Agent</span>
                {paid.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => exportCSV(paid, `commissions-paid-${format(new Date(), "yyyy-MM-dd")}.csv`)} className="text-xs gap-1">
                    <Download size={13} /> Export CSV
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ClaimTable rows={paid} {...tableProps} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Mark Claimable confirmation dialog */}
      <AlertDialog open={!!markClaimableTarget} onOpenChange={(open) => { if (!open) setMarkClaimableTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as Claimable</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm you have reviewed the file for{" "}
              <strong>{markClaimableTarget?.booking?.clientName ?? "this booking"}</strong> by{" "}
              <strong>{markClaimableTarget?.agentName}</strong>. This will move the claim to{" "}
              <em>Processing</em> so it can be claimed in PTS.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
              onClick={() => markClaimableTarget && markClaimableMutation.mutate({ claimId: markClaimableTarget.id })}
              disabled={markClaimableMutation.isPending}
            >
              {markClaimableMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark Claimable"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Request Top-Up dialog */}
      <Dialog open={!!topUpTarget} onOpenChange={(open) => { if (!open) { setTopUpTarget(null); setTopUpAmount(""); setTopUpNote(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-500" />
              File in Minus — Request Top-Up
            </DialogTitle>
            <DialogDescription>
              Enter the amount the agent needs to top up for{" "}
              <strong>{topUpTarget?.booking?.clientName ?? "this booking"}</strong>. They will receive a notification
              and see an action point on their dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="topup-amount">Amount to Top Up (£)</Label>
              <Input
                id="topup-amount"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 45.00"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="topup-note">Note to Agent (optional)</Label>
              <Textarea
                id="topup-note"
                placeholder="Explain why the top-up is needed..."
                value={topUpNote}
                onChange={(e) => setTopUpNote(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTopUpTarget(null); setTopUpAmount(""); setTopUpNote(""); }}>Cancel</Button>
            <Button
              onClick={() => {
                if (!topUpTarget) return;
                const pence = Math.round(parseFloat(topUpAmount) * 100);
                if (isNaN(pence) || pence <= 0) { toast.error("Please enter a valid amount."); return; }
                requestTopUpMutation.mutate({ claimId: topUpTarget.id, amountPence: pence, note: topUpNote || undefined });
              }}
              disabled={requestTopUpMutation.isPending}
              className="bg-red-500 hover:bg-red-600 text-white gap-2"
            >
              {requestTopUpMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingDown className="h-4 w-4" />}
              Send Top-Up Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Import VAT from CSV dialog */}
      <Dialog open={vatImportOpen} onOpenChange={(open) => { if (!open) { setVatImportOpen(false); setVatPreviewRows([]); setVatCsvRows([]); } }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-[#02E6D2]" />
              Import VAT from CSV
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload your commissions spreadsheet. The portal will match each row to an existing commission claim
              using the <strong>Booking Ref</strong> (Topdog ref) column and fill in the <strong>VAT</strong> figure.
              Only rows with a matched claim will be updated — unmatched rows are shown for your review.
            </p>

            <div
              className="border-2 border-dashed border-[#02E6D2]/40 rounded-lg p-6 text-center cursor-pointer hover:border-[#02E6D2] transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 text-[#02E6D2]" />
              <p className="text-sm font-medium">Click to select CSV file</p>
              <p className="text-xs text-muted-foreground mt-1">Expects columns: Booking Ref, Client Name, VAT</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleCsvFileChange}
              />
            </div>

            {(vatPreviewing || previewVatQuery.isFetching) && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Matching {vatCsvRows.length} rows against commission claims…
              </div>
            )}

            {vatPreviewRows.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                    <CheckCheck className="h-4 w-4" />
                    {matchedRows.length} matched
                  </span>
                  {noBookingRows.length > 0 && (
                    <span className="flex items-center gap-1.5 text-sm font-medium text-red-500">
                      <XCircle className="h-4 w-4" />
                      {noBookingRows.length} booking not found
                    </span>
                  )}
                  {noClaimRows.length > 0 && (
                    <span className="flex items-center gap-1.5 text-sm font-medium text-amber-500">
                      <AlertCircle className="h-4 w-4" />
                      {noClaimRows.length} no claim on file
                    </span>
                  )}
                </div>

                {matchedRows.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Matched — will be updated</p>
                    <div className="rounded-md border border-border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="py-2 px-3 text-left font-medium text-muted-foreground">Booking Ref</th>
                            <th className="py-2 px-3 text-left font-medium text-muted-foreground">CSV Client</th>
                            <th className="py-2 px-3 text-left font-medium text-muted-foreground">Portal Client</th>
                            <th className="py-2 px-3 text-left font-medium text-muted-foreground">Claim Status</th>
                            <th className="py-2 px-3 text-left font-medium text-muted-foreground">Current VAT</th>
                            <th className="py-2 px-3 text-left font-medium text-muted-foreground">New VAT</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matchedRows.map((r) => (
                            <tr key={r.ref} className="border-t border-border">
                              <td className="py-2 px-3 font-mono text-xs">{r.ref}</td>
                              <td className="py-2 px-3">{r.csvClient}</td>
                              <td className="py-2 px-3">{r.bookingClient ?? "—"}</td>
                              <td className="py-2 px-3 capitalize">
                                <Badge variant="outline" className="text-xs">
                                  {r.claimStatus ?? "—"}
                                </Badge>
                              </td>
                              <td className="py-2 px-3 text-muted-foreground">
                                {r.currentVat !== null ? `£${r.currentVat.toFixed(2)}` : "—"}
                              </td>
                              <td className="py-2 px-3 font-semibold text-emerald-600">
                                £{r.vat.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {(noBookingRows.length > 0 || noClaimRows.length > 0) && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Unmatched — will be skipped</p>
                    <div className="rounded-md border border-border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="py-2 px-3 text-left font-medium text-muted-foreground">Booking Ref</th>
                            <th className="py-2 px-3 text-left font-medium text-muted-foreground">CSV Client</th>
                            <th className="py-2 px-3 text-left font-medium text-muted-foreground">VAT</th>
                            <th className="py-2 px-3 text-left font-medium text-muted-foreground">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...noBookingRows, ...noClaimRows].map((r) => (
                            <tr key={r.ref} className="border-t border-border">
                              <td className="py-2 px-3 font-mono text-xs">{r.ref}</td>
                              <td className="py-2 px-3">{r.csvClient}</td>
                              <td className="py-2 px-3">£{r.vat.toFixed(2)}</td>
                              <td className="py-2 px-3">
                                <span className={`text-xs font-medium ${r.status === "no_booking" ? "text-red-500" : "text-amber-500"}`}>
                                  {r.status === "no_booking" ? "Booking not found in portal" : "No commission claim on this booking"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => { setVatImportOpen(false); setVatPreviewRows([]); setVatCsvRows([]); }}>
              Cancel
            </Button>
            {matchedRows.length > 0 && (
              <Button
                onClick={handleApplyVat}
                disabled={applyVatMutation.isPending || vatApplying}
                className="bg-[#02E6D2] hover:bg-[#02E6D2]/90 text-black font-semibold gap-2"
              >
                {applyVatMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCheck className="h-4 w-4" />
                )}
                Apply VAT to {matchedRows.length} claim{matchedRows.length !== 1 ? "s" : ""}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
