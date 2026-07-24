import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useParams, Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Minus, Lock, AlertTriangle, Info } from "lucide-react";

type Supplier = { supplierName: string; amountDue: string };

export default function RefundForm() {
  const { id } = useParams<{ id: string }>();
  const bookingId = Number(id);
  const [, navigate] = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [refundType, setRefundType] = useState<"supplier" | "customer" | "both">("both");
  const [supplierCount, setSupplierCount] = useState(1);
  const [suppliers, setSuppliers] = useState<Supplier[]>([{ supplierName: "", amountDue: "" }]);
  const [amountToClient, setAmountToClient] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [clientBankName, setClientBankName] = useState("");
  const [clientSortCode, setClientSortCode] = useState("");
  const [clientAccountNumber, setClientAccountNumber] = useState("");
  const [stepsTaken, setStepsTaken] = useState("");

  const { data: booking } = trpc.bookings.byId.useQuery({ id: bookingId });
  const submitRefund = trpc.refunds.submit.useMutation();

  const updateSupplierCount = (count: number) => {
    const n = Math.max(0, count);
    setSupplierCount(n);
    setSuppliers((prev) => {
      const updated = [...prev];
      while (updated.length < n) updated.push({ supplierName: "", amountDue: "" });
      return updated.slice(0, n);
    });
  };

  const updateSupplier = (index: number, field: keyof Supplier, value: string) => {
    setSuppliers((prev) => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundReason.trim() || !stepsTaken.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }
    setIsSubmitting(true);
    try {
      await submitRefund.mutateAsync({
        bookingId,
        refundType,
        supplierCount,
        amountToClient: amountToClient ? Number(amountToClient) : undefined,
        refundReason,
        clientBankName: clientBankName || undefined,
        clientSortCode: clientSortCode || undefined,
        clientAccountNumber: clientAccountNumber || undefined,
        stepsTaken,
        suppliers: suppliers
          .filter((s) => s.supplierName.trim())
          .map((s) => ({ supplierName: s.supplierName, amountDue: Number(s.amountDue) || 0 })),
      });
      toast.success("Refund request submitted successfully");
      navigate(`/bookings/${bookingId}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to submit refund request");
    } finally {
      setIsSubmitting(false);
    }
  };

  const showSupplierFields = refundType === "supplier" || refundType === "both";
  const showClientFields = refundType === "customer" || refundType === "both";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/bookings/${bookingId}`}>
          <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft size={16} />Back</Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">Request Refund</h1>
          {booking && <p className="text-sm text-muted-foreground">{booking.clientName} — Booking #{bookingId}</p>}
        </div>
      </div>

      {/* Agent responsibility notice */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-amber-600 mt-0.5 shrink-0" size={20} />
          <div className="space-y-2">
            <p className="font-semibold text-amber-900 text-sm">Important — Please read before submitting</p>
            <ul className="text-sm text-amber-800 space-y-1.5 list-disc list-inside">
              <li><strong>You are responsible for initiating the refund directly with the supplier</strong> (where applicable) and for chasing it through to completion.</li>
              <li>Once you submit this form, you will receive a confirmation email with full details on timelines and the refund process. <strong>Please read this carefully.</strong></li>
              <li>JLT will support you throughout the process, but the supplier relationship and initial contact is your responsibility.</li>
            </ul>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Refund Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Refund type */}
            <div className="space-y-2">
              <Label>Refund Type <span className="text-destructive">*</span></Label>
              <div className="flex flex-wrap gap-3">
                {(["supplier", "customer", "both"] as const).map((type) => (
                  <label key={type} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="refundType" checked={refundType === type}
                      onChange={() => setRefundType(type)} className="w-4 h-4" />
                    <span className="text-sm capitalize">{type === "both" ? "Supplier & Customer" : type}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Supplier section */}
            {showSupplierFields && (
              <div className="space-y-4 p-4 rounded-lg border" style={{ background: '#FFF6ED' }}>
                <div className="flex items-center justify-between">
                  <Label>Number of Suppliers Refunding</Label>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => updateSupplierCount(supplierCount - 1)}>
                      <Minus size={14} />
                    </Button>
                    <span className="w-8 text-center font-medium">{supplierCount}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => updateSupplierCount(supplierCount + 1)}>
                      <Plus size={14} />
                    </Button>
                  </div>
                </div>
                {suppliers.map((supplier, index) => (
                  <div key={index} className="grid grid-cols-2 gap-3 p-3 bg-white rounded-lg border">
                    <div className="space-y-1">
                      <Label className="text-xs">Supplier {index + 1} Name</Label>
                      <Input placeholder="Supplier name" value={supplier.supplierName}
                        onChange={(e) => updateSupplier(index, "supplierName", e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Amount Due (£)</Label>
                      <Input type="number" placeholder="0.00" step="0.01" min="0" value={supplier.amountDue}
                        onChange={(e) => updateSupplier(index, "amountDue", e.target.value)} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Client refund amount */}
            {showClientFields && (
              <div className="space-y-2">
                <Label htmlFor="amountToClient">Amount to Refund to Client (£)</Label>
                <Input id="amountToClient" type="number" placeholder="0.00" step="0.01" min="0"
                  value={amountToClient} onChange={(e) => setAmountToClient(e.target.value)} />
              </div>
            )}

            {/* Refund reason */}
            <div className="space-y-2">
              <Label htmlFor="refundReason">Refund Reason <span className="text-destructive">*</span></Label>
              <Textarea id="refundReason" placeholder="Explain the reason for the refund..."
                value={refundReason} onChange={(e) => setRefundReason(e.target.value)}
                className="min-h-[80px]" required />
            </div>

            {/* Bank details */}
            {showClientFields && (
              <div className="space-y-4 p-4 rounded-lg border">
                <div className="flex items-center gap-2">
                  <Lock size={14} style={{ color: '#02E6D2' }} />
                  <Label className="text-sm font-semibold">Client Bank Details</Label>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#d1fae5', color: '#065f46' }}>
                    AES-256 Encrypted
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">These details are encrypted at rest and only accessible to admin staff.</p>
                <div className="grid gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Account Name (Name on Account)</Label>
                    <Input placeholder="e.g. John Smith" value={clientBankName}
                      onChange={(e) => setClientBankName(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Sort Code</Label>
                      <Input placeholder="00-00-00" value={clientSortCode}
                        onChange={(e) => setClientSortCode(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Account Number</Label>
                      <Input placeholder="12345678" value={clientAccountNumber}
                        onChange={(e) => setClientAccountNumber(e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Steps taken */}
            <div className="space-y-2">
              <Label htmlFor="stepsTaken">Steps Taken So Far <span className="text-destructive">*</span></Label>
              <p className="text-xs text-muted-foreground">Please describe what you have already done to initiate the refund with suppliers.</p>
              <Textarea id="stepsTaken" placeholder="e.g. Contacted supplier on 01/01/2025, awaiting response..."
                value={stepsTaken} onChange={(e) => setStepsTaken(e.target.value)}
                className="min-h-[80px]" required />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={isSubmitting} style={{ background: '#70FFE8', color: '#414141' }} className="font-semibold">
                {isSubmitting ? <><Loader2 size={16} className="animate-spin mr-2" />Submitting...</> : "Submit Refund Request"}
              </Button>
              <Link href={`/bookings/${bookingId}`}><Button type="button" variant="outline">Cancel</Button></Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
