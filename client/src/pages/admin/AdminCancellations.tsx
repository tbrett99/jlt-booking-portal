import { trpc } from "@/lib/trpc";
import { format } from "date-fns";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { XCircle, CheckCircle2, ExternalLink, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

type CancellationRow = {
  id: number;
  bookingId: number;
  agentId: number;
  confirmedAt: string | Date;
  status: "pending" | "actioned";
  processedById: number | null;
  processedAt: string | Date | null;
  clientName: string | null;
  ptsRef: string | null;
  topdogRef: string | null;
  agentName: string | null;
  departureDate: string | Date | null;
  processed: boolean;
};

export default function AdminCancellations() {
  const { data: cancellations = [], refetch } = trpc.cancellations.all.useQuery();
  const [actionTarget, setActionTarget] = useState<CancellationRow | null>(null);
  const [moveToCancelled, setMoveToCancelled] = useState(true);
  const [tab, setTab] = useState<"pending" | "actioned">("pending");

  const markActioned = trpc.cancellations.markActioned.useMutation({
    onSuccess: () => {
      toast.success("Cancellation request actioned");
      setActionTarget(null);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const pending = (cancellations as CancellationRow[]).filter((c) => c.status === "pending");
  const actioned = (cancellations as CancellationRow[]).filter((c) => c.status === "actioned");
  const displayed = tab === "pending" ? pending : actioned;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <XCircle size={22} className="text-red-500" />
        <div>
          <h1 className="text-xl font-bold">Cancellation Requests</h1>
          <p className="text-sm text-muted-foreground">All booking cancellation requests submitted by agents</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <button
          onClick={() => setTab("pending")}
          className={`text-left rounded-xl p-4 border-2 transition-all ${tab === "pending" ? "border-red-400 shadow-sm" : "border-transparent bg-muted/40"}`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} className="text-red-500" />
            <span className="text-xs text-muted-foreground font-medium">Pending</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{pending.length}</p>
          <p className="text-xs text-muted-foreground">awaiting action</p>
        </button>
        <button
          onClick={() => setTab("actioned")}
          className={`text-left rounded-xl p-4 border-2 transition-all ${tab === "actioned" ? "border-green-400 shadow-sm" : "border-transparent bg-muted/40"}`}
        >
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={14} className="text-green-600" />
            <span className="text-xs text-muted-foreground font-medium">Actioned</span>
          </div>
          <p className="text-2xl font-bold text-green-700">{actioned.length}</p>
          <p className="text-xs text-muted-foreground">processed</p>
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Client</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Agent</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">PTS Ref</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Departure</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Submitted</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {displayed.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground text-sm">
                  No {tab} cancellation requests
                </td>
              </tr>
            )}
            {displayed.map((c) => (
              <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/bookings/${c.bookingId}`} className="hover:underline text-foreground flex items-center gap-1">
                    {c.clientName ?? `Booking #${c.bookingId}`}
                    <ExternalLink size={11} className="text-muted-foreground" />
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{c.agentName ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{c.ptsRef ?? c.topdogRef ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {c.departureDate ? format(new Date(c.departureDate), "dd MMM yyyy") : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {format(new Date(c.confirmedAt), "dd MMM yyyy HH:mm")}
                </td>
                <td className="px-4 py-3">
                  {c.status === "pending" ? (
                    <Badge variant="outline" className="border-red-300 text-red-600 bg-red-50 text-[11px]">
                      Pending
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50 text-[11px]">
                      Actioned
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {c.status === "pending" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 border-red-300 text-red-600 hover:bg-red-50"
                      onClick={() => { setActionTarget(c); setMoveToCancelled(true); }}
                    >
                      Action
                    </Button>
                  )}
                  {c.status === "actioned" && c.processedAt && (
                    <span className="text-[11px] text-muted-foreground">
                      {format(new Date(c.processedAt), "dd MMM yyyy")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Action dialog */}
      <Dialog open={!!actionTarget} onOpenChange={(o) => !o && setActionTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Action Cancellation Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              You are actioning the cancellation request for{" "}
              <span className="font-semibold text-foreground">{actionTarget?.clientName}</span>.
            </p>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={moveToCancelled}
                onChange={(e) => setMoveToCancelled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm">
                Move booking to <strong>Cancelled</strong> stage in the pipeline
                <span className="block text-xs text-muted-foreground mt-0.5">
                  The agent will be notified by email and in-app notification
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={markActioned.isPending}
              onClick={() => actionTarget && markActioned.mutate({ cancellationId: actionTarget.id, moveToCancelled })}
            >
              {markActioned.isPending ? "Processing…" : "Confirm & Action"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
