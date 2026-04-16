import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Clock, User } from "lucide-react";

type StatusFilter = "pending" | "approved" | "rejected" | "all";

export default function CrmChangeRequests() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [reviewDialog, setReviewDialog] = useState<{ id: number; fieldLabel: string; requestedValue: string; agentName: string } | null>(null);
  const [adminNote, setAdminNote] = useState("");

  const { data, isLoading, refetch } = trpc.crm.agentCrm.listChangeRequests.useQuery({ status: statusFilter });
  const reviewMutation = trpc.crm.agentCrm.reviewChangeRequest.useMutation({
    onSuccess: () => {
      toast.success("Change request reviewed.");
      setReviewDialog(null);
      setAdminNote("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleReview = (action: "approve" | "reject") => {
    if (!reviewDialog) return;
    reviewMutation.mutate({ id: reviewDialog.id, action, adminNote: adminNote || undefined });
  };

  const statusColors: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Change Requests</h1>
          <p className="text-muted-foreground text-sm mt-1">Review and approve agent profile update requests.</p>
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <CheckCircle2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No {statusFilter === "all" ? "" : statusFilter} change requests.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map(({ request: req, agentName, agentEmail }) => (
            <div key={req.id} className="rounded-xl border bg-card p-4 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm font-semibold">{agentName ?? "Unknown Agent"}</span>
                  <span className="text-xs text-muted-foreground">{agentEmail}</span>
                </div>
                <p className="text-sm">
                  <span className="text-muted-foreground">Field: </span>
                  <span className="font-medium">{req.fieldLabel}</span>
                </p>
                {req.currentValue && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Current: <span className="text-foreground">{req.currentValue}</span>
                  </p>
                )}
                <p className="text-sm mt-0.5">
                  <span className="text-muted-foreground">Requested: </span>
                  <span className="font-medium text-primary">{req.requestedValue}</span>
                </p>
                {req.reason && (
                  <p className="text-xs text-muted-foreground mt-0.5 italic">"{req.reason}"</p>
                )}
                {req.adminNote && (
                  <p className="text-xs text-muted-foreground mt-0.5">Admin note: {req.adminNote}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">{new Date(req.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <Badge className={`text-xs ${statusColors[req.status] ?? ""}`}>
                  {req.status === "pending" && <Clock className="h-3 w-3 mr-1" />}
                  {req.status === "approved" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                  {req.status === "rejected" && <XCircle className="h-3 w-3 mr-1" />}
                  {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                </Badge>
                {req.status === "pending" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      setAdminNote("");
                      setReviewDialog({ id: req.id, fieldLabel: req.fieldLabel, requestedValue: req.requestedValue, agentName: agentName ?? "Agent" });
                    }}
                  >
                    Review
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Review Dialog */}
      <Dialog open={!!reviewDialog} onOpenChange={(o) => !o && setReviewDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Review Change Request</DialogTitle>
          </DialogHeader>
          {reviewDialog && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-muted p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Agent</p>
                <p className="text-sm font-medium">{reviewDialog.agentName}</p>
                <p className="text-xs text-muted-foreground mt-1">Requesting to change <strong>{reviewDialog.fieldLabel}</strong> to:</p>
                <p className="text-sm font-semibold text-primary">{reviewDialog.requestedValue}</p>
              </div>
              <div>
                <Label htmlFor="adminNote">Note to agent (optional)</Label>
                <Textarea
                  id="adminNote"
                  value={adminNote}
                  onChange={e => setAdminNote(e.target.value)}
                  placeholder="Add a note explaining your decision…"
                  className="mt-1 resize-none"
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReviewDialog(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => handleReview("reject")}
              disabled={reviewMutation.isPending}
            >
              <XCircle className="h-4 w-4 mr-1" /> Reject
            </Button>
            <Button
              onClick={() => handleReview("approve")}
              disabled={reviewMutation.isPending}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Approve & Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
