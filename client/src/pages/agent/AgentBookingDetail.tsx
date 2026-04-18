import { useState, useRef } from "react";
import CopyableRef from "@/components/CopyableRef";
import { FlightRequestForm } from "@/components/FlightRequestForm";
import { trpc } from "@/lib/trpc";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Send, Upload, FileText, Loader2, Calendar,
  CheckCircle2, Circle, AlertCircle, Sparkles, TrendingUp, Clock,
  RefreshCw, Pencil, User, Check, X, Trash2, Plane, Zap,
  CreditCard, Copy, ExternalLink
} from "lucide-react";
import { format, differenceInDays, isPast } from "date-fns";
import { useAuth } from "@/_core/hooks/useAuth";

// ─── Agent Payments Card ─────────────────────────────────────────────────────
function AgentPaymentsCard({ bookingId, booking }: { bookingId: number; booking: any }) {
  const utils = trpc.useUtils();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: links = [], isLoading } = trpc.payments.listForBooking.useQuery({ bookingId });

  const createLink = trpc.payments.createLink.useMutation({
    onSuccess: (data) => {
      setCreatedLink(data.payUrl);
      setAmount("");
      utils.payments.listForBooking.invalidate({ bookingId });
    },
    onError: (err) => toast.error(err.message || "Failed to create payment link"),
  });

  function validateAmount(val: string) {
    if (!val) { setAmountError("Amount is required"); return false; }
    if (!/^\d+(\.\d{1,2})?$/.test(val)) { setAmountError("Enter a valid amount e.g. 150.00"); return false; }
    if (parseFloat(val) <= 0) { setAmountError("Amount must be greater than 0"); return false; }
    setAmountError("");
    return true;
  }

  function handleCreate() {
    if (!validateAmount(amount)) return;
    createLink.mutate({ bookingId, amountPounds: amount, origin: window.location.origin });
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function statusBadge(status: string) {
    const map: Record<string, { label: string; color: string; bg: string }> = {
      pending: { label: "Pending", color: "#92400e", bg: "#fef3c7" },
      paid: { label: "Paid", color: "#065f46", bg: "#d1fae5" },
      failed: { label: "Failed", color: "#991b1b", bg: "#fee2e2" },
      cancelled: { label: "Cancelled", color: "#374151", bg: "#f3f4f6" },
    };
    const s = map[status] ?? { label: status, color: "#374151", bg: "#f3f4f6" };
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={{ color: s.color, background: s.bg }}>
        {s.label}
      </span>
    );
  }

  return (
    <Card style={{ border: '2px solid #70FFE8' }}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CreditCard size={16} className="text-[#02E6D2]" />
            Payment Links
          </span>
          <Button size="sm" onClick={() => { setShowCreateModal(true); setCreatedLink(null); }} className="h-7 text-xs">
            + Generate Link
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && links.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No payment links yet. Generate one to send to your client.</p>
        )}
        {links.map((link) => (
          <div key={link.id} className="border rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">£{(link.amountPence / 100).toFixed(2)}</span>
              {statusBadge(link.status)}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Ref: {link.orderRef}</span>
              <span>· {new Date(link.createdAt).toLocaleDateString()}</span>
            </div>
            {link.paidAt && (
              <p className="text-xs text-emerald-600">Paid: {new Date(link.paidAt).toLocaleString()}</p>
            )}
            {link.status === "pending" && link.expiresAt && (
              <p className={`text-xs ${new Date() > new Date(link.expiresAt) ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
                {new Date() > new Date(link.expiresAt) ? "Expired — generate a new link" : `Expires: ${new Date(link.expiresAt).toLocaleString()}`}
              </p>
            )}
            {link.ppsTransactionId && link.ppsTransactionId !== 'MANUAL' && (
              <p className="text-xs text-muted-foreground font-mono">Txn: {link.ppsTransactionId}</p>
            )}
            {link.status === "pending" && new Date() <= new Date(link.expiresAt!) && (
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs gap-1"
                  onClick={() => copyLink(`${window.location.origin}/api/pay/${link.id}`)}
                >
                  <Copy size={11} /> {copied ? 'Copied!' : 'Copy Link'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs gap-1"
                  onClick={() => window.open(`${window.location.origin}/api/pay/${link.id}`, '_blank')}
                >
                  <ExternalLink size={11} /> Open
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>

      {/* Create Payment Link Modal */}
      <Dialog open={showCreateModal} onOpenChange={(open) => { if (!open) { setShowCreateModal(false); setCreatedLink(null); setAmount(""); setAmountError(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard size={18} className="text-[#02E6D2]" />
              Generate Payment Link
            </DialogTitle>
            <DialogDescription>
              Enter the amount to charge. The PTS reference will be used as the order description.
            </DialogDescription>
          </DialogHeader>

          {createdLink ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                <p className="text-sm text-emerald-800 font-medium">Payment link created. Share the URL below with your client.</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Payment URL (share with client)</Label>
                <div className="flex gap-2">
                  <Input value={createdLink} readOnly className="text-xs font-mono" />
                  <Button size="sm" variant="outline" onClick={() => copyLink(createdLink)} className="shrink-0">
                    {copied ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => window.open(createdLink, '_blank')} className="shrink-0">
                    <ExternalLink size={14} />
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => { setShowCreateModal(false); setCreatedLink(null); }}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              {booking?.clientEmail && (
                <div className="flex items-center gap-2 p-2.5 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                  <span className="text-emerald-600">✓</span>
                  Confirmation email will be sent to <strong className="text-foreground">{booking.clientEmail}</strong>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="agent-pay-amount">Amount (£)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                  <Input
                    id="agent-pay-amount"
                    className="pl-7"
                    placeholder="e.g. 1500.00"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); if (amountError) validateAmount(e.target.value); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  />
                </div>
                {amountError && <p className="text-xs text-red-500">{amountError}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={createLink.isPending}>
                  {createLink.isPending ? <Loader2 size={14} className="animate-spin mr-2" /> : <CreditCard size={14} className="mr-2" />}
                  Generate Link
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// The visible pipeline stages for agents (simplified)
const PIPELINE_STEPS = [
  { stage: "New Booking",            label: "Registered" },
  { stage: "Creating own PTS file",  label: "PTS File" },
  { stage: "Added to PTS",           label: "Added to PTS" },
  { stage: "Commission Claimable",   label: "Commission Ready" },
  { stage: "Commission Claimed",     label: "Claimed" },
];

const STAGE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  "New Booking":           { label: "New",                  color: "#414141", bg: "#FFF6ED" },
  "Creating own PTS file": { label: "Creating PTS",         color: "#414141", bg: "#e0e7ff" },
  "Not on Topdog":         { label: "Not on Topdog",        color: "#92400e", bg: "#fef3c7" },
  "Query":                 { label: "Query — Action Needed",color: "#92400e", bg: "#fef9c3" },
  "Reimb Docs Missing":    { label: "Docs Missing",         color: "#991b1b", bg: "#fee2e2" },
  "Urgent/Reimb":          { label: "Urgent",               color: "#991b1b", bg: "#fecaca" },
  "T/O Package":           { label: "T/O Package",          color: "#5b21b6", bg: "#ede9fe" },
  "DP":                    { label: "DP",                   color: "#9d174d", bg: "#fce7f3" },
  "Added to PTS":          { label: "Added to PTS",         color: "#065f46", bg: "#d1fae5" },
  "Commission Claimable":  { label: "Commission Ready",     color: "#065f46", bg: "#70FFE8" },
  "Commission Claimed":    { label: "Commission Claimed",   color: "#064e3b", bg: "#a7f3d0" },
  "Cancelled":             { label: "Cancelled",            color: "#6b7280", bg: "#f3f4f6" },
  "Holding Accounts":      { label: "Holding",              color: "#92400e", bg: "#fef3c7" },
};

// Only show action-required banner for stages where agent genuinely needs to act
const ATTENTION_STAGES = new Set(["Query", "Reimb Docs Missing"]);

function getPipelineProgress(currentStage: string): number {
  const idx = PIPELINE_STEPS.findIndex((s) => s.stage === currentStage);
  if (idx >= 0) return idx;
  // Intermediate stages map to step 1 (between registered and added to PTS)
  return 1;
}

export default function AgentBookingDetail() {
  const { id } = useParams<{ id: string }>();
  const bookingId = Number(id);
  const { user } = useAuth();
  const [noteContent, setNoteContent] = useState("");
  const [isSendingNote, setIsSendingNote] = useState(false);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [editingCommission, setEditingCommission] = useState(false);
  const [commissionInput, setCommissionInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // Per-item doc upload state: maps reimbItemId -> uploading boolean
  const [uploadingItemId, setUploadingItemId] = useState<number | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null);
  // Request additional reimbursement form state
  const [showAddReimb, setShowAddReimb] = useState(false);
  const [addReimbCount, setAddReimbCount] = useState(1);
  const [addReimbItems, setAddReimbItems] = useState<{ supplierName: string; amount: string; file: File | null }[]>([{ supplierName: "", amount: "", file: null }]);
  const [isSubmittingReimb, setIsSubmittingReimb] = useState(false);
  const addReimbFileRefs = useRef<(HTMLInputElement | null)[]>([]);

  // PTS details editing (only in Creating own PTS file stage)
  const [flightFormOpen, setFlightFormOpen] = useState(false);
  const [editingPts, setEditingPts] = useState(false);
  const [ptsRefInput, setPtsRefInput] = useState("");
  const [paymentDateInput, setPaymentDateInput] = useState("");

  const utils = trpc.useUtils();
  const { data: booking, isLoading } = trpc.bookings.byId.useQuery({ id: bookingId });
  const { data: notes = [], refetch: refetchNotes } = trpc.notes.list.useQuery({ bookingId });
  const { data: amendments = [] } = trpc.amendments.byBooking.useQuery({ bookingId });
  const { data: refunds = [] } = trpc.refunds.byBooking.useQuery({ bookingId });
  const { data: reimbItems = [], refetch: refetchReimbItems } = trpc.reimbursements.getByBooking.useQuery({ bookingId });
  const addNote = trpc.notes.add.useMutation();
  const addLateReimb = trpc.reimbursements.addLate.useMutation();
  const uploadItemDoc = trpc.reimbursements.uploadItemDoc.useMutation();
  const updatePtsDetails = trpc.bookings.updatePtsDetails.useMutation({
    onSuccess: () => {
      utils.bookings.byId.invalidate({ id: bookingId });
      setEditingPts(false);
      toast.success("PTS details saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSavePtsDetails = () => {
    updatePtsDetails.mutate({
      bookingId,
      ptsRef: ptsRefInput.trim() || undefined,
      finalSupplierPaymentDate: paymentDateInput ? new Date(paymentDateInput) : undefined,
    });
  };

  const togglePreAuth = trpc.bookings.togglePreAuth.useMutation({
    onSuccess: () => {
      utils.bookings.byId.invalidate({ id: bookingId });
      toast.success("Pre-authorisation updated");
    },
    onError: (e: any) => toast.error(e.message || "Failed to update pre-authorisation"),
  });

  const updateCommission = trpc.bookings.updateCommission.useMutation({
    onSuccess: () => {
      toast.success("Commission amount saved");
      setEditingCommission(false);
      utils.bookings.byId.invalidate({ id: bookingId });
      refetchNotes();
    },
    onError: (err: any) => toast.error(err.message || "Failed to save commission"),
  });

  const handleSaveCommission = () => {
    const val = parseFloat(commissionInput);
    if (isNaN(val) || val < 0) { toast.error("Please enter a valid amount"); return; }
    updateCommission.mutate({ bookingId, expectedCommission: val });
  };

  const handleSendNote = async () => {
    if (!noteContent.trim()) return;
    setIsSendingNote(true);
    try {
      await addNote.mutateAsync({ bookingId, content: noteContent, isInternal: false });
      setNoteContent("");
      await refetchNotes();
      toast.success("Message sent");
    } catch (err: any) {
      toast.error(err.message || "Failed to send message");
    } finally {
      setIsSendingNote(false);
    }
  };

  const handleItemDocUpload = async (e: React.ChangeEvent<HTMLInputElement>, itemId: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("File must be under 10MB"); return; }
    setUploadingItemId(itemId);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      const base64 = btoa(Array.from(uint8).map(b => String.fromCharCode(b)).join(''));
      // Upload via the booking-level upload endpoint, tagging the reimbursement item
      await uploadItemDoc.mutateAsync({
        reimbursementItemId: itemId,
        bookingId,
        fileUrl: `data:${file.type};base64,${base64}`,
        fileKey: `reimb-item-${itemId}-${Date.now()}-${file.name}`,
        fileName: file.name,
      });
      await refetchReimbItems();
      toast.success("Document uploaded — the JLT team has been notified");
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploadingItemId(null);
      // Reset the file input
      e.target.value = "";
    }
  };

  const handleAddReimbCountChange = (n: number) => {
    setAddReimbCount(n);
    setAddReimbItems(prev => {
      const next = [...prev];
      while (next.length < n) next.push({ supplierName: "", amount: "", file: null });
      return next.slice(0, n);
    });
  };

  const handleSubmitAdditionalReimb = async () => {
    const valid = addReimbItems.every(i => i.supplierName.trim() && parseFloat(i.amount) > 0);
    if (!valid) { toast.error("Please fill in all supplier names and amounts"); return; }
    const missingDoc = addReimbItems.findIndex(i => !i.file);
    if (missingDoc !== -1) {
      toast.error(`Please attach a document for item ${missingDoc + 1} (${addReimbItems[missingDoc].supplierName || 'supplier'})`);
      return;
    }
    setIsSubmittingReimb(true);
    try {
      // Step 1: create the reimbursement items
      const created = await addLateReimb.mutateAsync({
        bookingId,
        items: addReimbItems.map(i => ({ supplierName: i.supplierName.trim(), amount: parseFloat(i.amount) })),
      });
      // Step 2: upload a doc for each item
      const createdItems: any[] = Array.isArray(created) ? created : [];
      for (let idx = 0; idx < addReimbItems.length; idx++) {
        const file = addReimbItems[idx].file!;
        const itemId = createdItems[idx]?.id;
        if (!itemId) continue;
        const arrayBuffer = await file.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        const base64 = btoa(Array.from(uint8).map(b => String.fromCharCode(b)).join(''));
        await uploadItemDoc.mutateAsync({
          reimbursementItemId: itemId,
          bookingId,
          fileUrl: `data:${file.type};base64,${base64}`,
          fileKey: `reimb-item-${itemId}-${Date.now()}-${file.name}`,
          fileName: file.name,
        });
      }
      await refetchReimbItems();
      setShowAddReimb(false);
      setAddReimbItems([{ supplierName: "", amount: "", file: null }]);
      setAddReimbCount(1);
      toast.success("Reimbursement request submitted with documents — the JLT team has been notified");
    } catch (err: any) {
      toast.error(err.message || "Failed to submit reimbursement");
    } finally {
      setIsSubmittingReimb(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin" size={32} style={{ color: '#70FFE8' }} />
      </div>
    );
  }

  if (!booking) {
    return <div className="text-center py-20 text-muted-foreground">Booking not found.</div>;
  }

  const badge = STAGE_BADGE[booking.currentStage] ?? { label: booking.currentStage, color: "#414141", bg: "#f3f4f6" };
  const isCancelled = booking.currentStage === "Cancelled";
  const needsAction = ATTENTION_STAGES.has(booking.currentStage);
  const isCommissionReady = booking.currentStage === "Commission Claimable";
  // Items that have no docs uploaded yet (pending or late items that still need evidence)
  const itemsMissingDocs = reimbItems.filter((item: any) => !item.docs || item.docs.length === 0);
  const hasUndocumentedReimbs = itemsMissingDocs.length > 0;
  const sharedNotes = notes.filter(n => !n.isInternal);

  const daysUntilDeparture = differenceInDays(new Date(booking.departureDate), new Date());
  const departed = isPast(new Date(booking.departureDate));

  const pipelineStep = getPipelineProgress(booking.currentStage);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft size={16} />My Bookings</Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{booking.clientName}</h1>
          <p className="text-sm text-muted-foreground">Booking #{booking.id}</p>
        </div>
        <span className="px-3 py-1 rounded-full text-sm font-medium flex-shrink-0"
          style={{ background: badge.bg, color: badge.color }}>
          {badge.label}
        </span>
      </div>

      {/* Attention banner */}
      {needsAction && (
        <div className="rounded-xl border-l-4 p-4 flex items-start gap-3"
          style={{ borderLeftColor: '#f97316', background: '#fff7ed' }}>
          <AlertCircle size={18} style={{ color: '#f97316' }} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm" style={{ color: '#92400e' }}>Action required on this booking</p>
            <p className="text-xs mt-0.5" style={{ color: '#92400e', opacity: 0.8 }}>
              This booking is in <strong>{booking.currentStage}</strong> status. Please check the messages below for details from the JLT team.
            </p>
          </div>
        </div>
      )}

      {/* Undocumented reimbursements banner */}
      {hasUndocumentedReimbs && !needsAction && (
        <div className="rounded-xl border-l-4 p-4 flex items-start gap-3"
          style={{ borderLeftColor: '#f59e0b', background: '#fffbeb' }}>
          <AlertCircle size={18} style={{ color: '#d97706' }} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-sm" style={{ color: '#92400e' }}>Documents needed for your reimbursement{itemsMissingDocs.length > 1 ? 's' : ''}</p>
            <p className="text-xs mt-0.5" style={{ color: '#92400e', opacity: 0.85 }}>
              {itemsMissingDocs.length === 1
                ? `Please upload a supporting document for your ${itemsMissingDocs[0].supplierName} reimbursement (£${Number(itemsMissingDocs[0].amount).toFixed(2)}) in the Reimbursements section below.`
                : `${itemsMissingDocs.length} reimbursement items are missing documents. Please upload supporting documents in the Reimbursements section below.`}
            </p>
          </div>
        </div>
      )}

      {/* Commission ready banner */}
      {isCommissionReady && (
        <div className="rounded-xl border-l-4 p-4 flex items-center gap-3"
          style={{ borderLeftColor: '#02E6D2', background: '#ecfdf5' }}>
          <Sparkles size={18} style={{ color: '#02E6D2' }} className="flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-sm" style={{ color: '#065f46' }}>Your commission is ready to claim!</p>
            <p className="text-xs mt-0.5 opacity-70" style={{ color: '#065f46' }}>Head to My Commissions to submit your claim.</p>
          </div>
          <Link href="/commissions">
            <Button size="sm" style={{ background: '#70FFE8', color: '#414141' }} className="flex-shrink-0">
              Claim Now
            </Button>
          </Link>
        </div>
      )}

      {/* Pipeline progress */}
      {!isCancelled && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Booking Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-0">
              {PIPELINE_STEPS.map((step, idx) => {
                const isCompleted = idx < pipelineStep;
                const isCurrent = idx === pipelineStep;
                const isLast = idx === PIPELINE_STEPS.length - 1;
                return (
                  <div key={step.stage} className="flex items-center flex-1 min-w-0">
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all ${
                        isCompleted ? "border-[#02E6D2]" : isCurrent ? "border-[#70FFE8]" : "border-muted"
                      }`}
                        style={{
                          background: isCompleted ? '#02E6D2' : isCurrent ? '#70FFE8' : 'transparent',
                        }}>
                        {isCompleted ? (
                          <CheckCircle2 size={14} style={{ color: 'white' }} />
                        ) : isCurrent ? (
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#414141' }} />
                        ) : (
                          <Circle size={14} className="text-muted-foreground" />
                        )}
                      </div>
                      <span className={`text-[10px] text-center leading-tight max-w-[60px] ${
                        isCurrent ? "font-semibold" : "text-muted-foreground"
                      }`}>
                        {step.label}
                      </span>
                    </div>
                    {!isLast && (
                      <div className="flex-1 h-0.5 mx-1 mb-4"
                        style={{ background: isCompleted ? '#02E6D2' : '#e5e7eb' }} />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key info cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl p-3 border" style={{ background: '#FFF6ED' }}>
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <Calendar size={11} /> Departure
          </p>
          <p className="font-semibold text-sm">{format(new Date(booking.departureDate), "dd MMM yyyy")}</p>
          <p className="text-xs mt-0.5" style={{ color: departed ? '#9ca3af' : daysUntilDeparture <= 30 ? '#f97316' : '#02E6D2' }}>
            {departed ? "Departed" : `${daysUntilDeparture} days away`}
          </p>
        </div>

        <div className="rounded-xl p-3 border" style={{ background: '#f9fafb' }}>
          <p className="text-xs text-muted-foreground mb-1">Topdog Ref</p>
          {booking.topdogRef
            ? <CopyableRef value={booking.topdogRef} label="Topdog ref" />
            : <span className="italic text-muted-foreground text-sm">Not set</span>}
        </div>

        <div className={`rounded-xl p-3 border col-span-2 sm:col-span-1 ${booking.ptsRef ? 'border-[#70FFE8]' : booking.currentStage === 'Creating own PTS file' ? 'border-amber-300' : ''}`} style={{ background: booking.ptsRef ? '#ecfdf5' : booking.currentStage === 'Creating own PTS file' ? '#fffbeb' : '#f9fafb' }}>
          <p className="text-xs text-muted-foreground mb-1 font-semibold flex items-center justify-between">
            <span>PTS Ref</span>
            {(booking.currentStage === 'Creating own PTS file' || !booking.ptsRef) && !editingPts && (
              <button
                onClick={() => { setPtsRefInput(booking.ptsRef ?? ""); setPaymentDateInput((booking as any).finalSupplierPaymentDate ? new Date((booking as any).finalSupplierPaymentDate).toISOString().split('T')[0] : ""); setEditingPts(true); }}
                className="text-[10px] underline opacity-60 hover:opacity-100"
              >
                {booking.ptsRef ? "Edit" : "Add"}
              </button>
            )}
          </p>
          {editingPts ? (
            <div className="space-y-2 mt-1">
              <div>
                <label className="text-[10px] text-muted-foreground">PTS Reference</label>
                <Input
                  value={ptsRefInput}
                  onChange={(e) => setPtsRefInput(e.target.value)}
                  placeholder="e.g. 2T0119631"
                  className="h-7 text-xs mt-0.5"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Final Supplier Payment Date</label>
                <Input
                  type="date"
                  value={paymentDateInput}
                  onChange={(e) => setPaymentDateInput(e.target.value)}
                  className="h-7 text-xs mt-0.5"
                />
              </div>
              <div className="flex items-center gap-1">
                <button onClick={handleSavePtsDetails} disabled={updatePtsDetails.isPending} className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[10px] font-medium">
                  {updatePtsDetails.isPending ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Save
                </button>
                <button onClick={() => setEditingPts(false)} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-red-50 text-red-600 text-[10px]">
                  <X size={10} /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {booking.ptsRef
                ? <CopyableRef value={booking.ptsRef} label="PTS ref" className="font-bold text-base" />
                : <span className="italic text-muted-foreground text-sm">{booking.currentStage === 'Creating own PTS file' ? 'Tap "Add" to enter your PTS ref' : 'Not set yet'}</span>}
              {(booking as any).finalSupplierPaymentDate && (
                <p className="text-[10px] text-muted-foreground mt-1">Payment due: {format(new Date((booking as any).finalSupplierPaymentDate), 'dd MMM yyyy')}</p>
              )}
            </>
          )}
        </div>

        {(booking as any).destination && (
          <div className="rounded-xl p-3 border" style={{ background: '#f9fafb' }}>
            <p className="text-xs text-muted-foreground mb-1">Destination</p>
            <p className="font-semibold text-sm">{(booking as any).destination}</p>
          </div>
        )}

        {(booking as any).passengers != null && (
          <div className="rounded-xl p-3 border" style={{ background: '#f9fafb' }}>
            <p className="text-xs text-muted-foreground mb-1">Passengers (excl. infants)</p>
            <p className="font-semibold text-sm">{(booking as any).passengers}</p>
          </div>
        )}

        {(booking as any).numberOfNights != null && (
          <div className="rounded-xl p-3 border" style={{ background: '#f9fafb' }}>
            <p className="text-xs text-muted-foreground mb-1">Number of Nights</p>
            <p className="font-semibold text-sm">{(booking as any).numberOfNights}</p>
          </div>
        )}

        <div className="rounded-xl p-3 border col-span-2 sm:col-span-1" style={{ background: booking.expectedCommission ? '#ecfdf5' : '#fffbeb' }}>
          <p className="text-xs text-muted-foreground mb-1 flex items-center justify-between gap-1">
            <span className="flex items-center gap-1"><TrendingUp size={11} /> My Commission</span>
            {!editingCommission && (
              <button
                onClick={() => { setCommissionInput(booking.expectedCommission ? String(Number(booking.expectedCommission)) : ""); setEditingCommission(true); }}
                className="text-[10px] underline opacity-60 hover:opacity-100"
              >
                {booking.expectedCommission ? "Edit" : "Add"}
              </button>
            )}
          </p>
          {editingCommission ? (
            <div className="flex items-center gap-1 mt-1">
              <span className="text-sm font-medium">£</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={commissionInput}
                onChange={(e) => setCommissionInput(e.target.value)}
                className="h-7 text-sm px-2 py-0 w-24"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveCommission(); if (e.key === "Escape") setEditingCommission(false); }}
              />
              <button onClick={handleSaveCommission} disabled={updateCommission.isPending} className="p-1 rounded hover:bg-emerald-100">
                {updateCommission.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} style={{ color: '#065f46' }} />}
              </button>
              <button onClick={() => setEditingCommission(false)} className="p-1 rounded hover:bg-red-50">
                <X size={13} style={{ color: '#991b1b' }} />
              </button>
            </div>
          ) : (
            <p className="font-semibold text-sm" style={{ color: booking.expectedCommission ? '#065f46' : '#92400e' }}>
              {booking.expectedCommission
                ? `£${Number(booking.expectedCommission).toFixed(2)}`
                : <span className="text-xs font-normal">Tap "Add" to enter your expected commission</span>}
            </p>
          )}
        </div>
      </div>

      {/* Commission Pre-Authorisation Toggle */}
      {booking.expectedCommission && !['Commission Claimed', 'Cancelled'].includes(booking.currentStage) && (
        <div
          className="rounded-xl border p-4 flex items-start gap-3"
          style={{
            background: (booking as any).commissionPreAuthorised ? '#ecfdf5' : '#fffbeb',
            borderColor: (booking as any).commissionPreAuthorised ? '#6ee7b7' : '#fcd34d',
          }}
        >
          <Zap
            size={18}
            className="shrink-0 mt-0.5"
            style={{ color: (booking as any).commissionPreAuthorised ? '#065f46' : '#92400e' }}
          />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm" style={{ color: (booking as any).commissionPreAuthorised ? '#065f46' : '#92400e' }}>
              Commission Pre-Authorisation
            </p>
            <p className="text-xs mt-0.5 opacity-80" style={{ color: (booking as any).commissionPreAuthorised ? '#065f46' : '#92400e' }}>
              {(booking as any).commissionPreAuthorised
                ? "Pre-authorisation is ON. JLT will automatically process your commission claim as soon as your file is ready — you don't need to do anything."
                : "Turn on pre-authorisation and JLT will automatically process your commission claim as soon as your file is ready. No manual claim needed."}
            </p>
          </div>
          <button
            onClick={() =>
              togglePreAuth.mutate({
                bookingId: booking.id,
                preAuthorised: !(booking as any).commissionPreAuthorised,
              })
            }
            disabled={togglePreAuth.isPending}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
              (booking as any).commissionPreAuthorised ? 'bg-emerald-500' : 'bg-gray-300'
            }`}
            role="switch"
            aria-checked={(booking as any).commissionPreAuthorised}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                (booking as any).commissionPreAuthorised ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      )}

      {/* Payment Links Card — agents can generate and view links for their own bookings */}
      <AgentPaymentsCard bookingId={bookingId} booking={booking} />

      {/* PTS Ref bank transfer guidance banner */}
      {booking.ptsRef && (
        <div className="rounded-xl border-l-4 p-4 flex items-start gap-3" style={{ borderLeftColor: '#70FFE8', background: '#f0fdf4' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#02E6D2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          <div>
            <p className="font-semibold text-sm" style={{ color: '#065f46' }}>Use your PTS Ref for client payments</p>
            <p className="text-xs mt-0.5" style={{ color: '#065f46', opacity: 0.85 }}>
              Ask your client to use <strong>{booking.ptsRef}</strong> as the payment reference for bank transfers, and as the order description on manual PPS card links.
            </p>
          </div>
        </div>
      )}

      {/* Reimbursements Section — per-item with doc upload — always visible so agents can request reimbursements on any booking */}
      <Card className="border-2" style={{ borderColor: booking.currentStage === 'Reimb Docs Missing' ? '#ef4444' : '#70FFE8' }}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <FileText size={18} style={{ color: '#02E6D2' }} />
              My Reimbursements
              <span className="ml-auto text-xs font-normal px-2 py-0.5 rounded-full" style={{ background: '#d1fae5', color: '#065f46' }}>
                {reimbItems.length} item{reimbItems.length !== 1 ? 's' : ''}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {booking.currentStage === 'Reimb Docs Missing' && (
              <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: '#fee2e2' }}>
                <AlertCircle size={18} style={{ color: '#991b1b' }} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold" style={{ color: '#991b1b' }}>Documents required</p>
                  <p className="text-xs mt-0.5" style={{ color: '#7f1d1d' }}>Please upload documents for your reimbursements below. The JLT team is waiting.</p>
                </div>
              </div>
            )}
            {reimbItems.map((item: any) => {
              const statusColors: Record<string, { bg: string; color: string }> = {
                pending:   { bg: '#fef3c7', color: '#92400e' },
                scheduled: { bg: '#dbeafe', color: '#1d4ed8' },
                paid:      { bg: '#d1fae5', color: '#065f46' },
              };
              const sc = statusColors[item.status] ?? statusColors.pending;
              const isExpanded = expandedItemId === item.id;
              const docsMissing = !item.docs || item.docs.length === 0;
              return (
                <div key={item.id} className={`rounded-lg border-2 p-3 space-y-2 ${docsMissing ? 'border-amber-400' : 'border-transparent'}`} style={{ background: docsMissing ? '#fffbeb' : sc.bg + '40' }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{item.supplierName}</p>
                      <p className="text-xs text-muted-foreground">£{Number(item.amount).toFixed(2)}{item.isLate ? ' · Late submission' : ''}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {docsMissing && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1" style={{ background: '#fef3c7', color: '#92400e' }}>
                          <AlertCircle size={10} /> Doc needed
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize" style={sc}>{item.status}</span>
                      <button
                        type="button"
                        className={`text-xs flex-shrink-0 underline ${docsMissing ? 'font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
                        style={docsMissing ? { color: '#d97706' } : {}}
                        onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                      >
                        {isExpanded ? 'Hide' : docsMissing ? 'Upload doc ↑' : 'Docs'}
                      </button>
                    </div>
                  </div>
                  {(isExpanded || docsMissing) && (
                    <div className="pt-2 border-t space-y-2">
                      {(item.docs ?? []).map((doc: any) => (
                        <div key={doc.id} className="flex items-center gap-2 text-xs">
                          <CheckCircle2 size={12} style={{ color: '#065f46' }} />
                          <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="underline truncate flex-1" style={{ color: '#065f46' }}>{doc.fileName}</a>
                          <span className="text-muted-foreground flex-shrink-0">{format(new Date(doc.createdAt), 'dd MMM')}</span>
                        </div>
                      ))}
                      {docsMissing && (
                        <p className="text-xs font-medium" style={{ color: '#92400e' }}>No document uploaded yet — please attach one below.</p>
                      )}
                      <label className="block">
                        <input
                          type="file"
                          className="hidden"
                          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                          onChange={(e) => handleItemDocUpload(e, item.id)}
                          disabled={uploadingItemId === item.id}
                        />
                        <Button
                          size="sm"
                          variant={docsMissing ? 'default' : 'outline'}
                          className="w-full gap-1 text-xs"
                          style={docsMissing ? { background: '#f59e0b', color: 'white' } : {}}
                          disabled={uploadingItemId === item.id}
                          onClick={(e) => { e.preventDefault(); (e.currentTarget.previousElementSibling as HTMLInputElement)?.click(); }}
                        >
                          {uploadingItemId === item.id ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                          {uploadingItemId === item.id ? 'Uploading...' : docsMissing ? 'Upload Supporting Document' : 'Upload Another Document'}
                        </Button>
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
            {/* Request Additional Reimbursement */}
            {!showAddReimb ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 text-xs"
                onClick={() => setShowAddReimb(true)}
              >
                <Upload size={12} /> Request Additional Reimbursement
              </Button>
            ) : (
              <div className="rounded-lg border-2 p-4 space-y-4" style={{ background: '#f0fdf4', borderColor: '#02E6D2' }}>
                <div>
                  <p className="text-sm font-bold">Request Additional Reimbursement</p>
                  <p className="text-xs text-muted-foreground mt-0.5">You must attach a supporting document for each item before submitting.</p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">How many items?</label>
                  <select
                    className="border rounded px-2 py-1 text-xs"
                    value={addReimbCount}
                    onChange={(e) => handleAddReimbCountChange(Number(e.target.value))}
                  >
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                {addReimbItems.map((item, idx) => (
                  <div key={idx} className="rounded-lg border p-3 space-y-2" style={{ background: 'white' }}>
                    <p className="text-xs font-semibold text-muted-foreground">Item {idx + 1}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        placeholder="Supplier name"
                        value={item.supplierName}
                        onChange={(e) => setAddReimbItems(prev => prev.map((p, i) => i === idx ? { ...p, supplierName: e.target.value } : p))}
                        className="text-xs h-8"
                      />
                      <Input
                        placeholder="Amount (£)"
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.amount}
                        onChange={(e) => setAddReimbItems(prev => prev.map((p, i) => i === idx ? { ...p, amount: e.target.value } : p))}
                        className="text-xs h-8"
                      />
                    </div>
                    {/* Mandatory document upload */}
                    <div className={`rounded-md border p-2 flex items-center gap-2 ${item.file ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                        ref={el => { addReimbFileRefs.current[idx] = el; }}
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          setAddReimbItems(prev => prev.map((p, i) => i === idx ? { ...p, file: f } : p));
                        }}
                      />
                      {item.file ? (
                        <>
                          <CheckCircle2 size={14} style={{ color: '#065f46' }} className="flex-shrink-0" />
                          <span className="text-xs flex-1 truncate font-medium" style={{ color: '#065f46' }}>{item.file.name}</span>
                          <button
                            type="button"
                            className="text-xs text-red-500 hover:text-red-700 flex-shrink-0"
                            onClick={() => {
                              setAddReimbItems(prev => prev.map((p, i) => i === idx ? { ...p, file: null } : p));
                              if (addReimbFileRefs.current[idx]) addReimbFileRefs.current[idx]!.value = "";
                            }}
                          >
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <>
                          <AlertCircle size={14} style={{ color: '#92400e' }} className="flex-shrink-0" />
                          <span className="text-xs flex-1" style={{ color: '#92400e' }}>Document required</span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-6 px-2 flex-shrink-0"
                            onClick={() => addReimbFileRefs.current[idx]?.click()}
                          >
                            <Upload size={10} className="mr-1" /> Attach
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={handleSubmitAdditionalReimb}
                    disabled={isSubmittingReimb || addReimbItems.some(i => !i.file)}
                    style={addReimbItems.every(i => i.file) ? { background: '#02E6D2', color: '#414141' } : {}}
                  >
                    {isSubmittingReimb ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
                    {isSubmittingReimb ? 'Submitting...' : 'Submit Request'}
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => { setShowAddReimb(false); setAddReimbItems([{ supplierName: '', amount: '', file: null }]); setAddReimbCount(1); }}>Cancel</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      {/* Reimbursement doc submission confirmation banner (legacy) */}
      {(() => {
        const reimbAmendments = amendments.filter((a: any) => a.isReimbursementDoc);
        if (reimbAmendments.length === 0) return null;
        const latest = reimbAmendments[reimbAmendments.length - 1];
        const isActioned = latest?.pipelineStage === 'Actioned';
        return (
          <div className="rounded-xl border-2 p-4 flex items-start gap-3" style={{ borderColor: isActioned ? '#10b981' : '#02E6D2', background: isActioned ? '#f0fdf4' : '#f0fdfa' }}>
            {isActioned
              ? <CheckCircle2 size={22} style={{ color: '#10b981' }} className="flex-shrink-0 mt-0.5" />
              : <Clock size={22} style={{ color: '#02E6D2' }} className="flex-shrink-0 mt-0.5" />}
            <div>
              <p className="font-bold text-sm" style={{ color: isActioned ? '#065f46' : '#0f766e' }}>
                {isActioned ? 'Reimbursement processed — thank you!' : 'Documents received — we\'re on it!'}
              </p>
              <p className="text-xs mt-0.5" style={{ color: isActioned ? '#047857' : '#0f766e' }}>
                {isActioned
                  ? 'Your reimbursement has been processed by the JLT team. If you have any questions, please get in touch.'
                  : 'Your reimbursement documents have been received. The JLT team will review them and be in touch if anything else is needed.'}
              </p>
            </div>
          </div>
        );
      })()}

      {/* Amendments & Refunds Status */}
      {(() => {
        const visibleAmendments = amendments.filter((a: any) => !a.isReimbursementDoc);
        return (visibleAmendments.length > 0 || refunds.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Amendments */}
          {visibleAmendments.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Pencil size={14} style={{ color: '#6366f1' }} />
                  Amendment Requests
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {visibleAmendments.map((a: any) => {
                  const stageColor = a.pipelineStage === "Actioned" ? '#065f46' : a.pipelineStage === "In Progress" ? '#1d4ed8' : '#92400e';
                  const stageBg = a.pipelineStage === "Actioned" ? '#d1fae5' : a.pipelineStage === "In Progress" ? '#dbeafe' : '#fef3c7';
                  return (
                    <div key={a.id} className="rounded-lg border p-3 text-sm" style={{ background: stageBg + '80' }}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: stageBg, color: stageColor }}>
                          {a.pipelineStage ?? 'To Do'}
                        </span>
                        <span className="text-xs text-muted-foreground">{format(new Date(a.createdAt), 'dd MMM yyyy')}</span>
                      </div>
                      <p className="text-xs text-foreground line-clamp-2">{a.details}</p>
                      {a.assignedToName && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <User size={10} /> Assigned to {a.assignedToName}
                        </p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Refunds */}
          {refunds.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <RefreshCw size={14} style={{ color: '#0891b2' }} />
                  Refund Requests
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {refunds.map((r: any) => {
                  const REFUND_STAGES = [
                    { key: 'New Refund Request', label: 'Submitted' },
                    { key: 'Acknowledged by Supplier', label: 'With Supplier' },
                    { key: 'Refund Sent to PTS', label: 'Sent to PTS' },
                    { key: 'Refund Received in JLT', label: 'Received' },
                    { key: 'Refund Processed', label: 'Processed' },
                  ];
                  const REFUND_STAGE_LABELS: Record<string, string> = {
                    'New Refund Request': 'Submitted — awaiting review',
                    'Acknowledged by Supplier': 'Supplier acknowledged — refund in progress',
                    'Refund Sent to PTS': 'Refund sent to PTS',
                    'Refund Received in JLT': 'Refund received — processing payment',
                    'Refund Processed': 'Refund processed — complete',
                  };
                  const currentIdx = REFUND_STAGES.findIndex(s => s.key === r.pipelineStage);
                  const isProcessed = r.pipelineStage === 'Refund Processed';
                  const isInProgress = currentIdx > 0 && !isProcessed;
                  const stageColor = isProcessed ? '#065f46' : isInProgress ? '#1d4ed8' : '#92400e';
                  const stageBg = isProcessed ? '#d1fae5' : isInProgress ? '#dbeafe' : '#fef3c7';
                  return (
                    <div key={r.id} className="rounded-lg border p-3 text-sm space-y-2" style={{ background: stageBg + '40' }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: stageBg, color: stageColor }}>
                          {REFUND_STAGE_LABELS[r.pipelineStage] ?? r.pipelineStage ?? 'Submitted'}
                        </span>
                        <span className="text-xs text-muted-foreground">{format(new Date(r.createdAt), 'dd MMM yyyy')}</span>
                      </div>
                      {/* Progress steps */}
                      <div className="flex items-center gap-0 mt-1">
                        {REFUND_STAGES.map((step, idx) => {
                          const done = idx <= currentIdx;
                          const isLast = idx === REFUND_STAGES.length - 1;
                          return (
                            <div key={step.key} className="flex items-center flex-1 min-w-0">
                              <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center`}
                                  style={{ background: done ? '#02E6D2' : 'transparent', borderColor: done ? '#02E6D2' : '#d1d5db' }}>
                                  {done && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                </div>
                                <span className="text-[9px] text-center leading-tight max-w-[40px] text-muted-foreground">{step.label}</span>
                              </div>
                              {!isLast && <div className="flex-1 h-0.5 mb-3 mx-0.5" style={{ background: done && idx < currentIdx ? '#02E6D2' : '#e5e7eb' }} />}
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground capitalize">{r.refundType} refund</p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
        );
      })()}

      {/* Actions */}
      {(!isCancelled || true) && (
        <Card style={{ border: '2px solid #70FFE8', background: 'rgba(112,255,232,0.04)' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2" style={{ color: '#0d7a6b' }}>
              <span style={{ background: '#70FFE8', color: '#0d7a6b', borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Actions</span>
              Need to make a change to this booking?
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Use the buttons below to submit formal requests. Do not send amendment or cancellation requests via the messages box.</p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {!isCancelled && (
              <Button size="sm" variant="outline" style={{ fontWeight: 600 }} onClick={() => setFlightFormOpen(true)}>
                <Plane className="h-3.5 w-3.5 mr-1.5" />
                Flight Ticketing / Cancellation
              </Button>
            )}
            {!isCancelled && (
              <Link href={`/bookings/${bookingId}/amend`}>
                <Button size="sm" style={{ background: '#70FFE8', color: '#414141', fontWeight: 600 }}>Request Amendment</Button>
              </Link>
            )}
            <Link href={`/bookings/${bookingId}/refund`}>
              <Button size="sm" variant="outline" style={{ fontWeight: 600 }}>Request Refund</Button>
            </Link>
            {!isCancelled && (
              <Link href={`/bookings/${bookingId}/cancel`}>
                <Button size="sm" variant="outline" className="text-destructive border-destructive hover:bg-destructive/10" style={{ fontWeight: 600 }}>
                  Cancel Booking
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      {/* Messages */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Messages with JLT Team</CardTitle>
          <p className="text-xs text-muted-foreground">All messages are visible to both you and the JLT team</p>
          <div className="mt-2 px-3 py-2 rounded-md text-xs flex items-start gap-2" style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#92400e' }}>
            <span className="font-bold flex-shrink-0">⚠</span>
            <span>This chat is for general queries only. To request an amendment, refund, or cancellation, please use the <strong>Actions</strong> section above — do not submit these requests via this message box.</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {sharedNotes.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">No messages yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Start the conversation with the JLT team below.</p>
              </div>
            ) : (
              sharedNotes.map((note: any) => {
                const isSystem = note.content?.startsWith('[System]');
                const isMe = note.authorId === user?.id;
                const isAdmin = note.authorRole === 'admin' || note.authorRole === 'super_admin';

                if (isSystem) {
                  return (
                    <div key={note.id} className="flex justify-center">
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
                        style={{ background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd' }}>
                        <span className="font-semibold uppercase tracking-wide text-[10px]">System</span>
                        <span>{note.content.replace('[System] ', '')}</span>
                        <span className="opacity-50">{format(new Date(note.createdAt), 'dd MMM, HH:mm')}</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={note.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${isMe ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
                      style={{
                        background: isMe ? '#70FFE8' : isAdmin ? '#ede9fe' : '#f3f4f6',
                        color: '#414141',
                        border: isAdmin ? '1px solid #c4b5fd' : 'none',
                      }}>
                      <p className="font-semibold text-[10px] mb-1 flex items-center gap-1.5" style={{ opacity: 0.75 }}>
                        {isAdmin && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide" style={{ background: '#7c3aed', color: 'white' }}>JLT Team</span>}
                        {note.authorName}
                      </p>
                      <p className="whitespace-pre-wrap">{note.content}</p>
                      <p className="text-xs opacity-50 mt-1 text-right">
                        {format(new Date(note.createdAt), 'dd MMM, HH:mm')}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex gap-2 pt-2 border-t">
            <Textarea
              placeholder="Type a message to the JLT team..."
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              className="min-h-[60px] resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendNote();
                }
              }}
            />
            <Button
              onClick={handleSendNote}
              disabled={isSendingNote || !noteContent.trim()}
              style={{ background: '#70FFE8', color: '#414141' }}
              className="self-end"
            >
              {isSendingNote ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Flight Requests Section */}
      <FlightRequestsSection bookingId={bookingId} />

      {/* Flight Request Form Dialog */}
      {booking && (
        <FlightRequestForm
          open={flightFormOpen}
          onOpenChange={setFlightFormOpen}
          bookingId={bookingId}
          clientName={booking.clientName}
        />
      )}
    </div>
  );
}

function FlightRequestsSection({ bookingId }: { bookingId: number }) {
  const { data: requests, isLoading } = trpc.flightRequests.byBooking.useQuery(
    { bookingId },
    { staleTime: 0 }
  );

  if (isLoading || !requests || requests.length === 0) return null;

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; color: string; bg: string }> = {
      pending:   { label: "Pending",   color: "#92400e", bg: "#fef3c7" },
      ticketed:  { label: "Ticketed",  color: "#065f46", bg: "#d1fae5" },
      cancelled: { label: "Cancelled", color: "#991b1b", bg: "#fee2e2" },
      query:     { label: "Query",     color: "#1e40af", bg: "#dbeafe" },
    };
    const s = map[status] ?? { label: status, color: "#414141", bg: "#f3f4f6" };
    return (
      <span style={{ background: s.bg, color: s.color, borderRadius: "4px", padding: "2px 8px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase" }}>
        {s.label}
      </span>
    );
  };

  const typeLabel = (t: string) =>
    t === "both" ? "Ticketing & Cancellation" : t.charAt(0).toUpperCase() + t.slice(1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Plane className="h-4 w-4 text-primary" />
          Flight Requests
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {requests.map((r) => (
          <div key={r.id} className="rounded-md border p-3 text-sm space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{typeLabel(r.requestType)} — {r.supplier}</span>
              {statusBadge(r.status)}
            </div>
            <div className="text-muted-foreground text-xs flex flex-wrap gap-x-4 gap-y-0.5">
              <span>PNR: <strong className="text-foreground">{r.pnr}</strong></span>
              <span>Departure: <strong className="text-foreground">{format(new Date(r.departureDate), "dd MMM yyyy")}</strong></span>
              <span>Deadline: <strong className="text-foreground">{format(new Date(r.ticketingDeadline), "dd MMM yyyy")}</strong></span>
              <span>Submitted: {format(new Date(r.createdAt), "dd MMM yyyy")}</span>
            </div>
            {r.status === "query" && r.queryMessage && (
              <div className="mt-1.5 rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
                <strong>Query from JLT:</strong> {r.queryMessage}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
