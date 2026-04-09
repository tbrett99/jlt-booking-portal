import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Lock, Eye } from "lucide-react";
import { format } from "date-fns";

export default function AdminRefunds() {
  const [selectedRefund, setSelectedRefund] = useState<any | null>(null);
  const { data: refunds = [], isLoading } = trpc.refunds.all.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Refund Requests</h1>
        <p className="text-sm text-muted-foreground">{refunds.length} total refund requests</p>
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#70FFE8' }} />
            </div>
          ) : refunds.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No refund requests yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-semibold text-muted-foreground">Booking</th>
                    <th className="pb-3 font-semibold text-muted-foreground hidden sm:table-cell">Type</th>
                    <th className="pb-3 font-semibold text-muted-foreground hidden md:table-cell">Submitted</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Reason</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {refunds.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3">
                        <Link href={`/bookings/${r.bookingId}`}>
                          <span className="font-medium hover:underline cursor-pointer" style={{ color: '#02E6D2' }}>
                            #{r.bookingId}
                          </span>
                        </Link>
                      </td>
                      <td className="py-3 hidden sm:table-cell">
                        <span className="capitalize text-xs px-2 py-0.5 rounded-full"
                          style={{ background: '#FFF6ED', color: '#414141' }}>
                          {r.refundType}
                        </span>
                      </td>
                      <td className="py-3 text-muted-foreground hidden md:table-cell">
                        {format(new Date(r.createdAt), "dd MMM yyyy")}
                      </td>
                      <td className="py-3 max-w-xs">
                        <p className="truncate text-muted-foreground">{r.refundReason}</p>
                      </td>
                      <td className="py-3">
                        <Button variant="ghost" size="sm" className="gap-1 text-xs h-7"
                          onClick={() => setSelectedRefund(r)}>
                          <Eye size={12} />View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Refund detail dialog */}
      <Dialog open={!!selectedRefund} onOpenChange={() => setSelectedRefund(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Refund Request — Booking #{selectedRefund?.bookingId}</DialogTitle>
          </DialogHeader>
          {selectedRefund && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground text-xs">Type</p>
                  <p className="font-medium capitalize">{selectedRefund.refundType}</p>
                </div>
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

              {/* Bank details */}
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
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
