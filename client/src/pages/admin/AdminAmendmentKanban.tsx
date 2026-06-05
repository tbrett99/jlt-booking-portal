import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Link } from "wouter";
import { User, Calendar, ArrowRight, FileText, Clock, XCircle, Loader2 } from "lucide-react";
import { useState } from "react";
import { differenceInDays } from "date-fns";

function AgeBadge({ createdAt }: { createdAt: string | Date }) {
  const days = differenceInDays(new Date(), new Date(createdAt));
  const color = days >= 7 ? { bg: '#fee2e2', text: '#991b1b' } : days >= 3 ? { bg: '#fef3c7', text: '#92400e' } : { bg: '#f0fdf4', text: '#166534' };
  return (
    <span className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: color.bg, color: color.text }}>
      <Clock size={9} />{days === 0 ? 'Today' : `${days}d`}
    </span>
  );
}

const STAGES = ["To Do", "In Progress", "Actioned"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_COLORS: Record<Stage, string> = {
  "To Do": "bg-amber-100 text-amber-800 border-amber-300",
  "In Progress": "bg-blue-100 text-blue-800 border-blue-300",
  "Actioned": "bg-emerald-100 text-emerald-800 border-emerald-300",
};

export default function AdminAmendmentKanban() {
  const { data: amendments, refetch } = trpc.amendments.all.useQuery(undefined, { staleTime: 60000 });
  const { data: adminUsers = [] } = trpc.users.listAdmins.useQuery();
  const updatePipeline = trpc.amendments.updatePipeline.useMutation({
    onSuccess: () => { refetch(); toast.success("Amendment updated"); },
    onError: (e) => toast.error(e.message),
  });

  const byStage = (stage: Stage) =>
    (amendments ?? []).filter((a) => (a.pipelineStage ?? "To Do") === stage && a.status !== "rejected");

  const rejectedAmendments = (amendments ?? []).filter((a) => a.status === "rejected");

  const moveStage = (amendmentId: number, stage: Stage) => {
    updatePipeline.mutate({ amendmentId, pipelineStage: stage });
  };

  const assignTo = (amendmentId: number, userId: number | null) => {
    updatePipeline.mutate({ amendmentId, assignedToId: userId });
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Amendment Pipeline</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage and track all amendment requests across stages</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {STAGES.map((stage) => (
          <div key={stage} className="space-y-3">
            <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${STAGE_COLORS[stage]}`}>
              <span className="font-semibold text-sm">{stage}</span>
              <Badge variant="outline" className="text-xs">{byStage(stage).length}</Badge>
            </div>

            {byStage(stage).map((amendment) => (
              <AmendmentCard
                key={amendment.id}
                amendment={amendment}
                stage={stage}
                stages={STAGES}
                adminUsers={adminUsers}
                onMoveStage={moveStage}
                onAssign={assignTo}
                onReject={refetch}
              />
            ))}

            {byStage(stage).length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                No amendments
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Rejected amendments section */}
      {rejectedAmendments.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border bg-red-50 text-red-800 border-red-300">
            <span className="font-semibold text-sm flex items-center gap-2"><XCircle size={14} /> Rejected</span>
            <Badge variant="outline" className="text-xs">{rejectedAmendments.length}</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rejectedAmendments.map((amendment) => (
              <RejectedAmendmentCard key={amendment.id} amendment={amendment} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const LINE_ITEM_LABELS: Record<string, { label: string; prefix: string; color: string; textColor: string }> = {
  add_supplier:    { label: "Add",         prefix: "+", color: "#d1fae5", textColor: "#065f46" },
  remove_supplier: { label: "Remove",      prefix: "−", color: "#fee2e2", textColor: "#991b1b" },
  change_cost:     { label: "Change Cost", prefix: "~", color: "#fef3c7", textColor: "#92400e" },
  other:           { label: "Other",       prefix: "•", color: "#ede9fe", textColor: "#5b21b6" },
};

function RejectedAmendmentCard({ amendment }: { amendment: any }) {
  return (
    <Card className="shadow-sm border-l-4 border-l-red-400 opacity-80">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link href={`/bookings/${amendment.bookingId}?from=amendments`}>
              <span className="font-semibold text-sm text-foreground hover:text-[#02E6D2] cursor-pointer block truncate">
                {amendment.clientName ?? `Booking #${amendment.bookingId}`}
              </span>
            </Link>
            <span className="text-xs text-muted-foreground">
              {new Date(amendment.createdAt).toLocaleDateString("en-GB")}
            </span>
          </div>
          <Badge className="text-xs bg-red-100 text-red-800 border-red-300 shrink-0">Rejected</Badge>
        </div>
      </CardHeader>
      {amendment.rejectionReason && (
        <CardContent className="px-4 pb-3">
          <p className="text-xs text-muted-foreground font-medium mb-0.5">Rejection reason:</p>
          <p className="text-xs text-red-800 bg-red-50 rounded p-2">{amendment.rejectionReason}</p>
        </CardContent>
      )}
    </Card>
  );
}

function RejectModal({
  open,
  onClose,
  amendmentId,
  bookingId,
  clientName,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  amendmentId: number;
  bookingId: number;
  clientName: string;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState("");
  const rejectMutation = trpc.amendments.reject.useMutation({
    onSuccess: () => {
      toast.success("Amendment rejected — agent has been notified by email");
      setReason("");
      onClose();
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!reason.trim()) { toast.error("Please provide a rejection reason"); return; }
    rejectMutation.mutate({ amendmentId, bookingId, reason: reason.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setReason(""); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <XCircle size={18} /> Reject Amendment
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            You are rejecting the amendment for <strong>{clientName}</strong>. The agent will be notified by email with your reason and asked to resubmit correctly.
          </p>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Reason for rejection <span className="text-destructive">*</span></Label>
            <Textarea
              placeholder="e.g. You have selected 'Change Cost' but have not provided the final balance NET amount due to the supplier. Please resubmit with the exact NET amount owed less any deposit already paid."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[120px] text-sm"
              autoFocus
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { setReason(""); onClose(); }} disabled={rejectMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={rejectMutation.isPending || !reason.trim()}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {rejectMutation.isPending ? <><Loader2 size={14} className="animate-spin mr-1.5" />Rejecting...</> : "Reject & Notify Agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AmendmentCard({
  amendment,
  stage,
  stages,
  adminUsers,
  onMoveStage,
  onAssign,
  onReject,
}: {
  amendment: any;
  stage: Stage;
  stages: readonly Stage[];
  adminUsers: any[];
  onMoveStage: (id: number, stage: Stage) => void;
  onAssign: (id: number, userId: number | null) => void;
  onReject: () => void;
}) {
  const [showMove, setShowMove] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const assignedUser = adminUsers.find((u) => u.id === amendment.assignedToId);
  const details: string = amendment.details ?? "";
  const isLong = details.length > 200;
  const currentIdx = stages.indexOf(stage);

  const isReimb = !!amendment.isReimbursementDoc;

  // Fetch structured line items for this amendment
  const { data: lineItems = [] } = trpc.amendments.getLineItems.useQuery(
    { amendmentId: amendment.id },
    { enabled: !isReimb }
  );
  const hasLineItems = lineItems.length > 0;

  return (
    <>
      <Card className={`shadow-sm hover:shadow-md transition-shadow border-l-4 ${isReimb ? 'border-l-red-500' : 'border-l-[#70FFE8]'}`}>
        {isReimb && (
          <div className="flex items-center gap-2 px-4 pt-3 pb-1">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-bold" style={{ background: '#fee2e2', color: '#991b1b' }}>
              <FileText size={12} />
              REIMBURSEMENT DOCS UPLOADED
            </div>
            <span className="text-xs text-red-600 font-medium">Action required</span>
          </div>
        )}
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <Link href={`/bookings/${amendment.bookingId}?from=amendments`}>
                <span className="font-semibold text-sm text-foreground hover:text-[#02E6D2] cursor-pointer block truncate">
                  {amendment.clientName ?? `Booking #${amendment.bookingId}`}
                </span>
              </Link>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                {amendment.ptsRef && (
                  <span className="text-xs text-muted-foreground">PTS: {amendment.ptsRef}</span>
                )}
                {amendment.topdogRef && (
                  <span className="text-xs text-muted-foreground">TD: {amendment.topdogRef}</span>
                )}
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(amendment.createdAt).toLocaleDateString("en-GB")}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <AgeBadge createdAt={amendment.createdAt} />
              <Badge variant="outline" className="text-xs">#{amendment.id}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-3">
          {isReimb ? (
            <div className="flex items-center gap-2 p-2 rounded" style={{ background: '#fff7ed' }}>
              <FileText size={14} style={{ color: '#92400e' }} className="flex-shrink-0" />
              <p className="text-sm text-foreground">{amendment.details}</p>
            </div>
          ) : hasLineItems ? (
            // Structured line items view
            <div className="space-y-1.5">
              {(lineItems as any[]).map((li: any) => {
                const cfg = LINE_ITEM_LABELS[li.type] ?? LINE_ITEM_LABELS.other;
                return (
                  <div key={li.id} className="flex items-start gap-2 rounded px-2 py-1.5" style={{ background: cfg.color }}>
                    <span className="font-bold text-xs mt-0.5 flex-shrink-0" style={{ color: cfg.textColor }}>{cfg.prefix}</span>
                    <div className="min-w-0">
                      <span className="text-xs font-semibold" style={{ color: cfg.textColor }}>{cfg.label}</span>
                      {li.supplierName && <span className="text-xs text-foreground ml-1 font-medium">{li.supplierName}</span>}
                      {li.type === "change_cost" && li.oldCost && li.cost && (
                        <span className="text-xs text-muted-foreground ml-1">£{li.oldCost} → £{li.cost}</span>
                      )}
                      {li.type !== "change_cost" && li.cost && (
                        <span className="text-xs text-muted-foreground ml-1">— £{li.cost}</span>
                      )}
                      {li.notes && <p className="text-xs text-muted-foreground mt-0.5">{li.notes}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // Legacy free-text fallback
            <div className="bg-muted/50 rounded p-2 space-y-1">
              <p className={`text-sm text-foreground whitespace-pre-wrap ${!expanded && isLong ? 'line-clamp-4' : ''}`}>
                {details}
              </p>
              {isLong && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="text-xs font-medium hover:underline"
                  style={{ color: '#02E6D2' }}
                >
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}

          {/* Assignee */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              <User className="w-3 h-3" /> Assigned to
            </label>
            <Select
              value={amendment.assignedToId ? String(amendment.assignedToId) : "unassigned"}
              onValueChange={(val) => onAssign(amendment.id, val === "unassigned" ? null : Number(val))}
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

          {/* Stage movement + Reject */}
          <div className="flex gap-1 flex-wrap items-center">
            {stages.filter((s) => s !== stage).map((s) => (
              <Button
                key={s}
                variant="outline"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => onMoveStage(amendment.id, s)}
              >
                <ArrowRight className="w-3 h-3 mr-1" />
                {s}
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs px-2 border-red-300 text-red-700 hover:bg-red-50 hover:border-red-400 ml-auto"
              onClick={() => setShowRejectModal(true)}
            >
              <XCircle className="w-3 h-3 mr-1" />
              Reject
            </Button>
          </div>
        </CardContent>
      </Card>

      <RejectModal
        open={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        amendmentId={amendment.id}
        bookingId={amendment.bookingId}
        clientName={amendment.clientName ?? `Booking #${amendment.bookingId}`}
        onSuccess={onReject}
      />
    </>
  );
}
