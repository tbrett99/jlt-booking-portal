import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Lock, Eye, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import CopyableRef from "@/components/CopyableRef";

const STAGE_COLOURS: Record<string, string> = {
  "New Refund Request": "bg-amber-100 text-amber-800",
  "Acknowledged by Supplier": "bg-blue-100 text-blue-800",
  "Refund Sent to PTS": "bg-purple-100 text-purple-800",
  "Refund Received in JLT": "bg-teal-100 text-teal-800",
  "Refund Processed": "bg-green-100 text-green-800",
};

export default function AdminRefunds() {
  const [selectedRefund, setSelectedRefund] = useState<any | null>(null);
  const { data: refunds = [], isLoading } = trpc.refunds.all.useQuery(undefined, { staleTime: 60000 });

  const pending = refunds.filter((r: any) => r.pipelineStage !== "Refund Processed");
  const processed = refunds.filter((r: any) => r.pipelineStage === "Refund Processed");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Refund Requests</h1>
          <p className="text-sm text-muted-foreground">
            {pending.length} pending · {processed.length} processed
          </p>
        </div>
        <Link href="/refunds/pipeline">
          <Button size="sm" className="gap-2" style={{ background: '#70FFE8', color: '#414141' }}>
            <ExternalLink size={14} />
            Refund Pipeline
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#70FFE8' }} />
        </div>
      ) : refunds.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center py-8 text-muted-foreground">No refund requests yet</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-semibold text-muted-foreground">Client</th>
                    <th className="pb-3 font-semibold text-muted-foreground hidden sm:table-cell">Refs</th>
                    <th className="pb-3 font-semibold text-muted-foreground hidden md:table-cell">Type</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Stage</th>
                    <th className="pb-3 font-semibold text-muted-foreground hidden lg:table-cell">Assignee</th>
                    <th className="pb-3 font-semibold text-muted-foreground hidden md:table-cell">Submitted</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {refunds.map((r: any) => (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3">
                        <Link href={`/bookings/${r.bookingId}?from=refunds`}>
                          <span className="font-medium hover:underline cursor-pointer" style={{ color: '#02E6D2' }}>
                            {r.clientName ?? `Booking #${r.bookingId}`}
                          </span>
                        </Link>
                        <p className="text-xs text-muted-foreground">#{r.bookingId}</p>
                      </td>
                      <td className="py-3 hidden sm:table-cell">
                        <div className="flex flex-col gap-0.5">
                          {r.ptsRef && <CopyableRef value={r.ptsRef} label="PTS" />}
                          {r.topdogRef && <CopyableRef value={r.topdogRef} label="TD" />}
                          {!r.ptsRef && !r.topdogRef && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </td>
                      <td className="py-3 hidden md:table-cell">
                        <span className="capitalize text-xs px-2 py-0.5 rounded-full"
                          style={{ background: '#FFF6ED', color: '#414141' }}>
                          {r.refundType}
                        </span>
                      </td>
                      <td className="py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLOURS[r.pipelineStage] ?? "bg-gray-100 text-gray-700"}`}>
                          {r.pipelineStage ?? "New"}
                        </span>
                      </td>
                      <td className="py-3 hidden lg:table-cell text-xs text-muted-foreground">
                        {r.assignedToName ?? <span className="italic">Unassigned</span>}
                      </td>
                      <td className="py-3 text-muted-foreground hidden md:table-cell text-xs">
                        {format(new Date(r.createdAt), "dd MMM yyyy")}
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" className="gap-1 text-xs h-7"
                            onClick={() => setSelectedRefund(r)}>
                            <Eye size={12} />View
                          </Button>
                          <Link href="/refunds/pipeline">
                            <Button variant="ghost" size="sm" className="gap-1 text-xs h-7 hidden sm:flex">
                              <ExternalLink size={12} />Pipeline
                            </Button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Refund detail dialog */}
      <Dialog open={!!selectedRefund} onOpenChange={() => setSelectedRefund(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Refund Request — {selectedRefund?.clientName ?? `Booking #${selectedRefund?.bookingId}`}
            </DialogTitle>
          </DialogHeader>
          {selectedRefund && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground text-xs">Booking</p>
                  <Link href={`/bookings/${selectedRefund.bookingId}?from=refunds`}>
                    <span className="font-medium hover:underline cursor-pointer" style={{ color: '#02E6D2' }}>
                      #{selectedRefund.bookingId}
                    </span>
                  </Link>
                </div>
                {selectedRefund.ptsRef && (
                  <div>
                    <p className="text-muted-foreground text-xs">PTS Ref</p>
                    <CopyableRef value={selectedRefund.ptsRef} label="PTS" />
                  </div>
                )}
                {selectedRefund.topdogRef && (
                  <div>
                    <p className="text-muted-foreground text-xs">TD Ref</p>
                    <CopyableRef value={selectedRefund.topdogRef} label="TD" />
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs">Type</p>
                  <p className="font-medium capitalize">{selectedRefund.refundType}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Stage</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLOURS[selectedRefund.pipelineStage] ?? "bg-gray-100 text-gray-700"}`}>
                    {selectedRefund.pipelineStage ?? "New"}
                  </span>
                </div>
                {selectedRefund.assignedToName && (
                  <div>
                    <p className="text-muted-foreground text-xs">Assigned To</p>
                    <p className="font-medium">{selectedRefund.assignedToName}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs">Submitted</p>
                  <p className="font-medium">{format(new Date(selectedRefund.createdAt), "dd MMM yyyy, HH:mm")}</p>
                </div>
                {selectedRefund.amountToClient && (
                  <div>
                    <p className="text-muted-foreground text-xs">Amount to Client</p>
                    <p className="font-medium">£{Number(selectedRefund.amountToClient).toFixed(2)}</p>
                  </div>
                )}
              </div>

              <div>
                <p className="text-muted-foreground text-xs mb-1">Refund Reason</p>
                <p className="p-3 rounded-lg bg-muted text-foreground">{selectedRefund.refundReason}</p>
              </div>

              <div>
                <p className="text-muted-foreground text-xs mb-1">Steps Taken</p>
                <p className="p-3 rounded-lg bg-muted text-foreground">{selectedRefund.stepsTaken}</p>
              </div>

              {selectedRefund.suppliers?.length > 0 && (
                <div>
                  <p className="text-muted-foreground text-xs mb-2">Supplier Refunds</p>
                  <div className="space-y-2">
                    {selectedRefund.suppliers.map((s: any, i: number) => (
                      <div key={i} className="flex justify-between p-2 rounded border">
                        <span>{s.supplierName}</span>
                        <span className="font-medium">£{Number(s.amountDue).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedRefund.clientBankName && (
                <div className="p-3 rounded-lg border" style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Lock size={14} style={{ color: '#059669' }} />
                    <p className="text-xs font-semibold text-green-700">Client Bank Details (Decrypted)</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Account Name</p>
                      <p className="font-medium">{selectedRefund.clientBankName}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Sort Code</p>
                      <p className="font-medium">{selectedRefund.clientSortCode}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Account Number</p>
                      <p className="font-medium">{selectedRefund.clientAccountNumber}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Link href={`/bookings/${selectedRefund.bookingId}?from=refunds`} className="flex-1">
                  <Button variant="outline" size="sm" className="w-full gap-1">
                    <ExternalLink size={12} />View Booking
                  </Button>
                </Link>
                <Link href="/refunds/pipeline" className="flex-1">
                  <Button size="sm" className="w-full gap-1" style={{ background: '#70FFE8', color: '#414141' }}>
                    <ExternalLink size={12} />Open in Pipeline
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
