import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { CheckCircle, Clock, Loader2 } from "lucide-react";
import { format } from "date-fns";

export default function AdminAmendments() {
  const utils = trpc.useUtils();
  const { data: amendments = [], isLoading } = trpc.amendments.all.useQuery();

  // Use pipelineStage as the source of truth (kept in sync by the Kanban)
  // "To Do" and "In Progress" = pending; "Actioned" = done
  const pending = amendments.filter(
    (a) => !a.isReimbursementDoc && a.pipelineStage !== "Actioned"
  );
  const actioned = amendments.filter(
    (a) => !a.isReimbursementDoc && a.pipelineStage === "Actioned"
  );

  const actionAmendment = trpc.amendments.action.useMutation({
    onSuccess: () => {
      utils.amendments.all.invalidate();
      toast.success("Amendment actioned");
    },
    onError: (err) => toast.error(err.message || "Failed to action amendment"),
  });

  // Also update pipelineStage so the Kanban stays in sync
  const updatePipeline = trpc.amendments.updatePipeline.useMutation({
    onSuccess: () => utils.amendments.all.invalidate(),
  });

  const handleMarkActioned = (amendmentId: number, bookingId: number) => {
    // Set legacy status field
    actionAmendment.mutate({ amendmentId, bookingId });
    // Also set pipelineStage so Kanban reflects the change
    updatePipeline.mutate({ amendmentId, bookingId, pipelineStage: "Actioned" });
  };

  const isPending = actionAmendment.isPending || updatePipeline.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Amendments</h1>
        <p className="text-sm text-muted-foreground">{pending.length} pending, {actioned.length} actioned</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#70FFE8' }} />
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock size={16} style={{ color: '#f59e0b' }} />
                  Pending Amendments
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {pending.map((a) => (
                    <div key={a.id} className="p-4 rounded-lg border" style={{ background: '#fefce8', borderColor: '#fde68a' }}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Link href={`/bookings/${a.bookingId}`}>
                              <span className="font-semibold text-sm hover:underline cursor-pointer" style={{ color: '#02E6D2' }}>
                                {a.clientName ? `${a.clientName} (#${a.bookingId})` : `Booking #${a.bookingId}`}
                              </span>
                            </Link>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground">{format(new Date(a.createdAt), "dd MMM yyyy, HH:mm")}</span>
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{
                                background: a.pipelineStage === "In Progress" ? '#dbeafe' : '#fef3c7',
                                color: a.pipelineStage === "In Progress" ? '#1d4ed8' : '#92400e',
                              }}
                            >
                              {a.pipelineStage ?? "To Do"}
                            </span>
                          </div>
                          <p className="text-sm text-foreground whitespace-pre-wrap">{a.details}</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleMarkActioned(a.id, a.bookingId)}
                          disabled={isPending}
                          style={{ background: '#70FFE8', color: '#414141' }}
                          className="flex-shrink-0 gap-1"
                        >
                          {isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                          Mark Actioned
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {pending.length === 0 && !isLoading && (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                <CheckCircle size={32} className="mx-auto mb-2 opacity-30" />
                <p className="font-medium">No pending amendments</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle size={16} style={{ color: '#10b981' }} />
                Actioned Amendments
              </CardTitle>
            </CardHeader>
            <CardContent>
              {actioned.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No actioned amendments yet</p>
              ) : (
                <div className="space-y-2">
                  {actioned.map((a) => (
                    <div key={a.id} className="p-3 rounded-lg border text-sm" style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Link href={`/bookings/${a.bookingId}`}>
                          <span className="font-medium hover:underline cursor-pointer" style={{ color: '#02E6D2' }}>
                            {a.clientName ? `${a.clientName} (#${a.bookingId})` : `Booking #${a.bookingId}`}
                          </span>
                        </Link>
                        <span className="text-xs text-muted-foreground">· {format(new Date(a.createdAt), "dd MMM yyyy")}</span>
                      </div>
                      <p className="text-muted-foreground line-clamp-2">{a.details}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
