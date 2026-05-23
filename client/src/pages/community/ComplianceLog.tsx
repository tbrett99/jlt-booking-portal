import { trpc } from "@/lib/trpc";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, Mail } from "lucide-react";
import { toast } from "sonner";

interface ComplianceLogProps {
  postId: number;
  onClose: () => void;
}

export function ComplianceLog({ postId, onClose }: ComplianceLogProps) {
  const { data, isLoading } = trpc.community.complianceReport.useQuery({ postId });

  const sendReminders = trpc.community.sendConfirmationReminders.useMutation({
    onSuccess: (result) => toast.success(`Sent ${result.sent} reminder${result.sent !== 1 ? "s" : ""}`),
    onError: () => toast.error("Failed to send reminders"),
  });

  const confirmed = data?.filter((r: any) => r.confirmedAt) ?? [];
  const unconfirmed = data?.filter((r: any) => !r.confirmedAt) ?? [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirmation Compliance Log</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{confirmed.length}</p>
                <p className="text-xs text-green-600 mt-0.5">Confirmed</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-amber-700">{unconfirmed.length}</p>
                <p className="text-xs text-amber-600 mt-0.5">Not yet confirmed</p>
              </div>
            </div>

            {/* Unconfirmed agents */}
            {unconfirmed.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-foreground">Not yet confirmed</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sendReminders.mutate()}
                    disabled={sendReminders.isPending}
                  >
                    <Mail className="w-3.5 h-3.5 mr-1.5" />
                    Send reminders
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {unconfirmed.map((r: any) => (
                    <div key={r.userId} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100">
                      <XCircle className="w-4 h-4 text-amber-500 shrink-0" />
                      <span className="text-sm text-foreground flex-1">{r.name}</span>
                      <span className="text-xs text-muted-foreground">{r.email}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Confirmed agents */}
            {confirmed.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-foreground mb-2">Confirmed</p>
                <div className="space-y-1.5">
                  {confirmed.map((r: any) => (
                    <div key={r.userId} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-green-50 border border-green-100">
                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                      <span className="text-sm text-foreground flex-1">{r.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.confirmedAt
                          ? new Date(r.confirmedAt).toLocaleDateString("en-GB", {
                              day: "numeric", month: "short", year: "numeric",
                            })
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
