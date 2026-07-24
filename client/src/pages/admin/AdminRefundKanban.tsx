import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Link } from "wouter";
import { User, Calendar, ArrowRight, Clock, Search, MessageSquare, Trash2, Building2, PoundSterling } from "lucide-react";
import { useState } from "react";
import { differenceInDays } from "date-fns";
import { Input } from "@/components/ui/input";

function AgeBadge({ createdAt }: { createdAt: string | Date }) {
  const days = differenceInDays(new Date(), new Date(createdAt));
  const color = days >= 7 ? { bg: '#fee2e2', text: '#991b1b' } : days >= 3 ? { bg: '#fef3c7', text: '#92400e' } : { bg: '#f0fdf4', text: '#166534' };
  return (
    <span className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: color.bg, color: color.text }}>
      <Clock size={9} />{days === 0 ? 'Today' : `${days}d`}
    </span>
  );
}

const STAGES = [
  "New Refund Request",
  "Query",
  "Acknowledged by Supplier",
  "Refund Sent to PTS",
  "Refund Received in JLT",
  "Refund Processed",
] as const;
type Stage = (typeof STAGES)[number];

const STAGE_COLORS: Record<Stage, string> = {
  "New Refund Request": "bg-red-100 text-red-800 border-red-300",
  "Query": "bg-purple-100 text-purple-800 border-purple-300",
  "Acknowledged by Supplier": "bg-orange-100 text-orange-800 border-orange-300",
  "Refund Sent to PTS": "bg-yellow-100 text-yellow-800 border-yellow-300",
  "Refund Received in JLT": "bg-blue-100 text-blue-800 border-blue-300",
  "Refund Processed": "bg-emerald-100 text-emerald-800 border-emerald-300",
};

const REFUND_TYPE_LABELS: Record<string, string> = {
  supplier: "Supplier",
  customer: "Customer",
  both: "Both",
};

export default function AdminRefundKanban() {
  const { data: refunds, refetch } = trpc.refunds.all.useQuery(undefined, { staleTime: 60000 });
  const { data: adminUsers = [] } = trpc.users.listAdmins.useQuery();
  const [search, setSearch] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const PAGE_SIZE = 10;
  const [stagePage, setStagePage] = useState<Record<Stage, number>>(
    () => Object.fromEntries(STAGES.map((s) => [s, 1])) as Record<Stage, number>
  );

  // Query dialog state
  const [queryDialog, setQueryDialog] = useState<{ refundId: number; targetStage: Stage } | null>(null);
  const [queryMessage, setQueryMessage] = useState("");

  // Delete dialog state
  const [deleteDialog, setDeleteDialog] = useState<number | null>(null);

  const deleteRefund = trpc.refunds.delete.useMutation({
    onSuccess: () => { refetch(); toast.success("Refund deleted"); setDeleteDialog(null); },
    onError: (e) => toast.error(e.message),
  });

  const updatePipeline = trpc.refunds.updatePipeline.useMutation({
    onSuccess: () => { refetch(); toast.success("Refund updated"); },
    onError: (e) => toast.error(e.message),
  });

  const allRefunds = refunds ?? [];
  const filtered = allRefunds.filter((r) => {
    // Client/ref search
    if (search) {
      const s = search.toLowerCase();
      const matchesClient = (r.clientName ?? "").toLowerCase().includes(s);
      const matchesPts = (r.ptsRef ?? "").toLowerCase().includes(s);
      const matchesTd = (r.topdogRef ?? "").toLowerCase().includes(s);
      if (!matchesClient && !matchesPts && !matchesTd) return false;
    }
    // Supplier name search
    if (supplierSearch) {
      const ss = supplierSearch.toLowerCase();
      const hasMatch = (r.suppliers ?? []).some((s: { supplierName: string }) =>
        s.supplierName.toLowerCase().includes(ss)
      );
      if (!hasMatch) return false;
    }
    // Amount range filter — amounts stored in pounds (decimal), compare directly
    const minAmt = amountMin ? parseFloat(amountMin) : null;
    const maxAmt = amountMax ? parseFloat(amountMax) : null;
    if (minAmt !== null || maxAmt !== null) {
      const amounts = [
        ...(r.suppliers ?? []).map((s: { amountDue: number }) => Number(s.amountDue)),
        ...(r.amountToClient != null ? [Number(r.amountToClient)] : []),
      ];
      const totalAmount = amounts.reduce((sum: number, a: number) => sum + a, 0);
      if (minAmt !== null && totalAmount < minAmt) return false;
      if (maxAmt !== null && totalAmount > maxAmt) return false;
    }
    return true;
  });

  const byStage = (stage: Stage) =>
    filtered.filter((r) => (r.pipelineStage ?? "New Refund Request") === stage);
  const byStagePagedCount = (stage: Stage) => byStage(stage).length;
  const byStagePagedItems = (stage: Stage) => {
    const all = byStage(stage);
    const page = stagePage[stage] ?? 1;
    return all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  };

  const pendingCount = filtered.filter((r) => r.pipelineStage !== "Refund Processed").length;

  const moveStage = (refundId: number, stage: Stage) => {
    if (stage === "Query") {
      setQueryMessage("");
      setQueryDialog({ refundId, targetStage: stage });
      return;
    }
    updatePipeline.mutate({ refundId, pipelineStage: stage });
  };

  const handleQuerySubmit = () => {
    if (!queryDialog) return;
    if (!queryMessage.trim()) {
      toast.error("Please enter a message to send to the agent");
      return;
    }
    updatePipeline.mutate({
      refundId: queryDialog.refundId,
      pipelineStage: "Query",
      queryMessage: queryMessage.trim(),
    });
    setQueryDialog(null);
    setQueryMessage("");
  };

  const assignTo = (refundId: number, userId: number | null) => {
    updatePipeline.mutate({ refundId, assignedToId: userId });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Refund Pipeline</h1>
          <p className="text-muted-foreground text-sm mt-1">Track refund requests from submission through to completion</p>
        </div>
        <div className="sm:ml-auto flex items-center gap-3">
          {pendingCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: '#fce7f3', color: '#9d174d' }}>
              <Clock size={14} />
              {pendingCount} pending
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-52">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Client, PTS ref, Topdog ref..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-8 text-sm"
              />
            </div>
            <div className="relative w-40">
              <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Supplier name..."
                value={supplierSearch}
                onChange={(e) => setSupplierSearch(e.target.value)}
                className="pl-9 h-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-1">
              <div className="relative w-24">
                <PoundSterling size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="number"
                  placeholder="Min"
                  value={amountMin}
                  onChange={(e) => setAmountMin(e.target.value)}
                  className="pl-6 h-8 text-sm"
                  min="0"
                  step="0.01"
                />
              </div>
              <span className="text-muted-foreground text-xs">–</span>
              <div className="relative w-24">
                <PoundSterling size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="number"
                  placeholder="Max"
                  value={amountMax}
                  onChange={(e) => setAmountMax(e.target.value)}
                  className="pl-6 h-8 text-sm"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
            {(search || supplierSearch || amountMin || amountMax) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground"
                onClick={() => { setSearch(""); setSupplierSearch(""); setAmountMin(""); setAmountMax(""); }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Horizontal scroll for 6 columns */}
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-4 min-w-max">
          {STAGES.map((stage) => (
            <div key={stage} className="w-72 space-y-3 flex-shrink-0">
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${STAGE_COLORS[stage]}`}>
                <span className="font-semibold text-xs leading-tight flex items-center gap-1">
                  {stage === "Query" && <MessageSquare size={11} />}
                  {stage}
                </span>
                <Badge variant="outline" className="text-xs ml-2 shrink-0">{byStage(stage).length}</Badge>
              </div>

              {byStagePagedItems(stage).map((refund) => (
                <RefundCard
                  key={refund.id}
                  refund={refund}
                  stage={stage}
                  stages={STAGES}
                  adminUsers={adminUsers}
                  onMoveStage={moveStage}
                  onAssign={assignTo}
                  onDelete={(id) => setDeleteDialog(id)}
                />
              ))}

              {byStagePagedCount(stage) === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                  No refunds
                </div>
              )}

              {/* Pagination controls */}
              {byStagePagedCount(stage) > PAGE_SIZE && (
                <div className="flex items-center justify-between pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs px-2"
                    disabled={(stagePage[stage] ?? 1) <= 1}
                    onClick={() => setStagePage((p) => ({ ...p, [stage]: (p[stage] ?? 1) - 1 }))}
                  >←</Button>
                  <span className="text-xs text-muted-foreground">
                    {stagePage[stage] ?? 1} / {Math.ceil(byStagePagedCount(stage) / PAGE_SIZE)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs px-2"
                    disabled={(stagePage[stage] ?? 1) >= Math.ceil(byStagePagedCount(stage) / PAGE_SIZE)}
                    onClick={() => setStagePage((p) => ({ ...p, [stage]: (p[stage] ?? 1) + 1 }))}
                  >→</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialog !== null} onOpenChange={(open) => { if (!open) setDeleteDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Refund?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the refund request. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteDialog !== null && deleteRefund.mutate({ refundId: deleteDialog })}
              disabled={deleteRefund.isPending}
            >
              {deleteRefund.isPending ? 'Deleting...' : 'Delete Refund'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Query Dialog */}
      <Dialog open={!!queryDialog} onOpenChange={(open) => { if (!open) { setQueryDialog(null); setQueryMessage(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare size={18} className="text-purple-600" />
              Send Query to Agent
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This message will be sent to the agent via email and in-app notification, asking them for more information about this refund request.
            </p>
            <div className="space-y-2">
              <Label htmlFor="query-message">Your message to the agent</Label>
              <Textarea
                id="query-message"
                placeholder="e.g. Could you please provide the supplier's booking reference number for this refund?"
                value={queryMessage}
                onChange={(e) => setQueryMessage(e.target.value)}
                rows={4}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setQueryDialog(null); setQueryMessage(""); }}>
              Cancel
            </Button>
            <Button
              onClick={handleQuerySubmit}
              disabled={!queryMessage.trim() || updatePipeline.isPending}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              <MessageSquare size={14} className="mr-1.5" />
              Send Query &amp; Move to Query Stage
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RefundCard({
  refund,
  stage,
  stages,
  adminUsers,
  onMoveStage,
  onAssign,
  onDelete,
}: {
  refund: any;
  stage: Stage;
  stages: readonly Stage[];
  adminUsers: any[];
  onMoveStage: (id: number, stage: Stage) => void;
  onAssign: (id: number, userId: number | null) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <Card className={`shadow-sm hover:shadow-md transition-shadow border-l-4 ${stage === "Query" ? "border-l-purple-400" : "border-l-[#FFC3BC]"}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link href={`/bookings/${refund.bookingId}?from=refunds`}>
              <span className="font-semibold text-sm text-foreground hover:text-[#02E6D2] cursor-pointer block truncate">
                {refund.clientName ?? `Booking #${refund.bookingId}`}
              </span>
            </Link>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {refund.ptsRef && (
                <span className="text-xs text-muted-foreground">PTS: {refund.ptsRef}</span>
              )}
              {refund.topdogRef && (
                <span className="text-xs text-muted-foreground">TD: {refund.topdogRef}</span>
              )}
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {new Date(refund.createdAt).toLocaleDateString("en-GB")}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1">
              <AgeBadge createdAt={refund.createdAt} />
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(refund.id); }}
                className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"
                title="Delete refund"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <Badge variant="outline" className="text-xs">#{refund.id}</Badge>
            <Badge className="text-xs bg-[#FFF6ED] text-[#414141] border border-[#FFC3BC]">
              {REFUND_TYPE_LABELS[refund.refundType] ?? refund.refundType}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-3">
        {/* Supplier names + amounts */}
        {refund.suppliers && refund.suppliers.length > 0 && (
          <div className="space-y-1">
            {refund.suppliers.map((s: { supplierName: string; amountDue: number }, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs bg-blue-50 border border-blue-100 rounded px-2 py-1">
                <span className="flex items-center gap-1 text-blue-800 font-medium truncate">
                  <Building2 size={10} className="shrink-0" />{s.supplierName}
                </span>
                <span className="flex items-center gap-0.5 text-blue-700 font-semibold shrink-0 ml-2">
                  <PoundSterling size={9} />{Number(s.amountDue).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
        {refund.amountToClient != null && refund.amountToClient > 0 && (
          <div className="flex items-center justify-between text-xs bg-emerald-50 border border-emerald-100 rounded px-2 py-1">
            <span className="text-emerald-800 font-medium">Client refund</span>
            <span className="flex items-center gap-0.5 text-emerald-700 font-semibold">
              <PoundSterling size={9} />{Number(refund.amountToClient).toFixed(2)}
            </span>
          </div>
        )}
        <p className="text-xs text-muted-foreground line-clamp-2 bg-muted/50 rounded p-2">
          {refund.refundReason}
        </p>

        {/* Assignee */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <User className="w-3 h-3" /> Assigned to
          </label>
          <Select
            value={refund.assignedToId ? String(refund.assignedToId) : "unassigned"}
            onValueChange={(val) => onAssign(refund.id, val === "unassigned" ? null : Number(val))}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {adminUsers.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Stage movement buttons */}
        <div className="flex gap-1 flex-wrap">
          {stages.filter((s) => s !== stage).map((s) => (
            <Button
              key={s}
              variant="outline"
              size="sm"
              className={`h-6 text-xs px-2 ${s === "Query" ? "border-purple-300 text-purple-700 hover:bg-purple-50" : ""}`}
              onClick={() => onMoveStage(refund.id, s)}
            >
              {s === "Query" ? <MessageSquare className="w-3 h-3 mr-1" /> : <ArrowRight className="w-3 h-3 mr-1" />}
              {s === "Query" ? "Query" : s.split(" ").slice(-1)[0]}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
