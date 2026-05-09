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
import { User, Calendar, ArrowRight, Clock, Search, MessageSquare } from "lucide-react";
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

  // Query dialog state
  const [queryDialog, setQueryDialog] = useState<{ refundId: number; targetStage: Stage } | null>(null);
  const [queryMessage, setQueryMessage] = useState("");

  const updatePipeline = trpc.refunds.updatePipeline.useMutation({
    onSuccess: () => { refetch(); toast.success("Refund updated"); },
    onError: (e) => toast.error(e.message),
  });

  const allRefunds = refunds ?? [];
  const filtered = search
    ? allRefunds.filter((r) =>
        (r.clientName ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (r.ptsRef ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (r.topdogRef ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : allRefunds;

  const byStage = (stage: Stage) =>
    filtered.filter((r) => (r.pipelineStage ?? "New Refund Request") === stage);

  const pendingCount = filtered.filter((r) => r.pipelineStage !== "Refund Processed").length;

  const moveStage = (refundId: number, stage: Stage) => {
    if (stage === "Query") {
      // Open the query dialog instead of moving immediately
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
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search client, PTS ref, Topdog ref..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
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

              {byStage(stage).map((refund) => (
                <RefundCard
                  key={refund.id}
                  refund={refund}
                  stage={stage}
                  stages={STAGES}
                  adminUsers={adminUsers}
                  onMoveStage={moveStage}
                  onAssign={assignTo}
                />
              ))}

              {byStage(stage).length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                  No refunds
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

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
}: {
  refund: any;
  stage: Stage;
  stages: readonly Stage[];
  adminUsers: any[];
  onMoveStage: (id: number, stage: Stage) => void;
  onAssign: (id: number, userId: number | null) => void;
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
            <AgeBadge createdAt={refund.createdAt} />
            <Badge variant="outline" className="text-xs">#{refund.id}</Badge>
            <Badge className="text-xs bg-[#FFF6ED] text-[#414141] border border-[#FFC3BC]">
              {REFUND_TYPE_LABELS[refund.refundType] ?? refund.refundType}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-3">
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
