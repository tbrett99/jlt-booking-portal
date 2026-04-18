import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useParams, Link, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Send, Lock, FileText, Loader2, Save, AlertTriangle, Calendar, User, AtSign, CheckSquare, Trash2, GitMerge, Search, X, History, ArrowRight, RefreshCw, XCircle, DollarSign, Edit3, Clock, Mail, Paperclip, Download, Link2, Unlink, ChevronDown, CreditCard, Copy, CheckCircle2, ExternalLink, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/_core/hooks/useAuth";
import CopyableRef from "@/components/CopyableRef";
import CountrySelect from "@/components/CountrySelect";
import TaskFormDialog from "./TaskFormDialog";

const STAGES = [
  "New Booking", "Creating own PTS file", "Not on Topdog", "Query",
  "Reimb Docs Missing", "Urgent/Reimb", "T/O Package", "DP",
  "Added to PTS", "Commission Claimable", "Commission Claimed",
  "Cancelled", "Holding Accounts",
];

const STAGES_REQUIRING_PAYMENT_DATE = [
  "Added to PTS",
  "Commission Claimable",
  "Commission Claimed",
  "Holding Accounts",
];

// Render note content with @mentions highlighted
function NoteContent({ content }: { content: string }) {
  const parts = content.split(/(@[A-Za-z][A-Za-z0-9 ]*)/g);
  return (
    <p className="whitespace-pre-wrap text-sm">
      {parts.map((part, i) =>
        part.startsWith("@") ? (
          <span key={i} className="font-semibold rounded px-1" style={{ background: "#70FFE8", color: "#414141" }}>
            {part}
          </span>
        ) : (
          part
        )
      )}
    </p>
  );
}

// ─── Payments Card ───────────────────────────────────────────────────────────

function PaymentsCard({ bookingId, booking }: { bookingId: number; booking: any }) {
  const utils = trpc.useUtils();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingEmailCapture, setPendingEmailCapture] = useState(false);
  const [capturedEmail, setCapturedEmail] = useState("");
  const [emailError, setEmailError] = useState("");

  const { data: links = [], isLoading } = trpc.payments.listForBooking.useQuery({ bookingId });

  const createLink = trpc.payments.createLink.useMutation({
    onSuccess: (data) => {
      setCreatedLink(data.payUrl);
      setAmount("");
      utils.payments.listForBooking.invalidate({ bookingId });
    },
    onError: (err) => toast.error(err.message || "Failed to create payment link"),
  });

  const cancelLink = trpc.payments.cancelLink.useMutation({
    onSuccess: () => {
      toast.success("Payment link cancelled");
      utils.payments.listForBooking.invalidate({ bookingId });
    },
    onError: (err) => toast.error(err.message || "Failed to cancel link"),
  });

  const manualMarkPaid = trpc.payments.manualMarkPaid.useMutation({
    onSuccess: () => {
      toast.success("Payment marked as paid");
      utils.payments.listForBooking.invalidate({ bookingId });
    },
    onError: (err) => toast.error(err.message || "Failed to mark as paid"),
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
    const clientEmail = booking?.clientEmail;
    if (!clientEmail) {
      setPendingEmailCapture(true);
      return;
    }
    createLink.mutate({ bookingId, amountPounds: amount, origin: window.location.origin });
  }

  function handleEmailCaptureAndCreate() {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!capturedEmail || !emailRegex.test(capturedEmail)) {
      setEmailError("Please enter a valid email address");
      return;
    }
    setEmailError("");
    // Save email to booking then create link
    saveEmailMutation.mutate({ bookingId, clientEmail: capturedEmail });
  }

  const saveEmailMutation = trpc.bookings.updateAdminFields.useMutation({
    onSuccess: () => {
      utils.bookings.byId.invalidate({ id: bookingId });
      setPendingEmailCapture(false);
      createLink.mutate({ bookingId, amountPounds: amount, origin: window.location.origin });
    },
    onError: (err) => toast.error(err.message || "Failed to save email"),
  });

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
    <Card>
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
          <p className="text-sm text-muted-foreground italic">No payment links yet.</p>
        )}
        {links.map((link) => (
          <div key={link.id} className="border rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">£{(link.amountPence / 100).toFixed(2)}</span>
              {statusBadge(link.status)}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Ref: {link.orderRef}</span>
              {link.createdByName && <span>· by {link.createdByName}</span>}
              <span>· {new Date(link.createdAt).toLocaleDateString()}</span>
            </div>
            {link.paidAt && (
              <p className="text-xs text-emerald-600">Paid: {new Date(link.paidAt).toLocaleString()}</p>
            )}
            {link.ppsTransactionId && (
              <p className="text-xs text-muted-foreground font-mono">Txn: {link.ppsTransactionId}</p>
            )}
            {link.status === "pending" && (
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs gap-1"
                  onClick={() => copyLink(`${window.location.origin}/api/pay/${link.id}`)}
                >
                  <Copy size={11} /> Copy Link
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs gap-1 text-red-600 hover:text-red-700"
                  onClick={() => cancelLink.mutate({ linkId: link.id })}
                  disabled={cancelLink.isPending}
                >
                  <XCircle size={11} /> Cancel
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs gap-1 text-emerald-600 hover:text-emerald-700"
                  onClick={() => {
                    if (confirm("Mark this payment as paid?\n\nOnly use this if PPS confirmed the payment was successful but the portal wasn't updated automatically.")) {
                      manualMarkPaid.mutate({ linkId: link.id });
                    }
                  }}
                  disabled={manualMarkPaid.isPending}
                >
                  <CheckCircle size={11} /> Mark Paid
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
                <p className="text-sm text-emerald-800 font-medium">Payment link created successfully. A confirmation email will be sent to {booking?.clientEmail}.</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Payment URL (share with client)</Label>
                <div className="flex gap-2">
                  <Input value={createdLink} readOnly className="text-xs font-mono" />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyLink(createdLink)}
                    className="shrink-0"
                  >
                    {copied ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(createdLink, "_blank")}
                    className="shrink-0"
                  >
                    <ExternalLink size={14} />
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => { setShowCreateModal(false); setCreatedLink(null); }}>Done</Button>
              </DialogFooter>
            </div>
          ) : pendingEmailCapture ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <span className="text-amber-600 mt-0.5">⚠</span>
                <div>
                  <p className="text-sm font-medium text-amber-900">Client email required</p>
                  <p className="text-xs text-amber-700 mt-0.5">A confirmation email will be sent to this address when payment is received. It will be saved to the booking for future links.</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-email">Client Email Address</Label>
                <Input
                  id="client-email"
                  type="email"
                  placeholder="client@example.com"
                  value={capturedEmail}
                  onChange={(e) => { setCapturedEmail(e.target.value); if (emailError) setEmailError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleEmailCaptureAndCreate()}
                />
                {emailError && <p className="text-xs text-red-500">{emailError}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setPendingEmailCapture(false); setCapturedEmail(""); setEmailError(""); }}>Back</Button>
                <Button onClick={handleEmailCaptureAndCreate} disabled={saveEmailMutation.isPending || createLink.isPending}>
                  {(saveEmailMutation.isPending || createLink.isPending) ? <Loader2 size={14} className="animate-spin mr-2" /> : <CreditCard size={14} className="mr-2" />}
                  Save & Generate Link
                </Button>
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
                <Label htmlFor="pay-amount">Amount (£)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                  <Input
                    id="pay-amount"
                    className="pl-7"
                    placeholder="e.g. 1500.00"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); if (amountError) validateAmount(e.target.value); }}
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
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

// ─── Amendment Pipeline Card ─────────────────────────────────────────────────

const AMENDMENT_STAGES = ["To Do", "In Progress", "Actioned"] as const;
type AmendmentStage = (typeof AMENDMENT_STAGES)[number];
const AMENDMENT_STAGE_COLORS: Record<AmendmentStage, string> = {
  "To Do": "bg-yellow-100 text-yellow-800 border-yellow-300",
  "In Progress": "bg-blue-100 text-blue-800 border-blue-300",
  "Actioned": "bg-green-100 text-green-800 border-green-300",
};

function AmendmentPipelineCard({
  amendments,
  adminUsers,
  onUpdatePipeline,
  isPending,
}: {
  amendments: any[];
  adminUsers: any[];
  onUpdatePipeline: (amendmentId: number, data: { pipelineStage?: AmendmentStage; assignedToId?: number | null }) => void;
  isPending: boolean;
}) {
  if (amendments.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Edit3 size={16} style={{ color: '#7c3aed' }} />
          Amendments
          <Badge variant="secondary" className="ml-1">{amendments.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {amendments.map((a: any) => {
          const stage: AmendmentStage = (a.pipelineStage ?? "To Do") as AmendmentStage;
          return (
            <div key={a.id} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{a.amendmentType ?? "Amendment"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{a.details ?? a.reason ?? ""}</p>
                  <p className="text-xs text-muted-foreground">{a.createdAt ? format(new Date(a.createdAt), "d MMM yyyy") : ""}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  {/* Stage selector */}
                  <Select
                    value={stage}
                    onValueChange={(v) => onUpdatePipeline(a.id, { pipelineStage: v as AmendmentStage })}
                    disabled={isPending}
                  >
                    <SelectTrigger className={`h-7 text-xs w-36 border font-medium ${AMENDMENT_STAGE_COLORS[stage]}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AMENDMENT_STAGES.map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Assignee selector */}
                  <Select
                    value={a.assignedToId ? String(a.assignedToId) : "__unassigned__"}
                    onValueChange={(v) => onUpdatePipeline(a.id, { assignedToId: v === "__unassigned__" ? null : Number(v) })}
                    disabled={isPending}
                  >
                    <SelectTrigger className="h-7 text-xs w-36">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unassigned__" className="text-xs">Unassigned</SelectItem>
                      {adminUsers.map((u: any) => (
                        <SelectItem key={u.id} value={String(u.id)} className="text-xs">{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── Refund Pipeline Card ─────────────────────────────────────────────────────

const REFUND_STAGES = [
  "New Refund Request",
  "Acknowledged by Supplier",
  "Refund Sent to PTS",
  "Refund Received in JLT",
  "Refund Processed",
] as const;
type RefundStage = (typeof REFUND_STAGES)[number];
const REFUND_STAGE_COLORS: Record<RefundStage, string> = {
  "New Refund Request": "bg-red-100 text-red-800 border-red-300",
  "Acknowledged by Supplier": "bg-orange-100 text-orange-800 border-orange-300",
  "Refund Sent to PTS": "bg-yellow-100 text-yellow-800 border-yellow-300",
  "Refund Received in JLT": "bg-blue-100 text-blue-800 border-blue-300",
  "Refund Processed": "bg-green-100 text-green-800 border-green-300",
};

function RefundPipelineCard({
  refunds,
  adminUsers,
  onUpdatePipeline,
  isPending,
}: {
  refunds: any[];
  adminUsers: any[];
  onUpdatePipeline: (refundId: number, data: { pipelineStage?: RefundStage; assignedToId?: number | null }) => void;
  isPending: boolean;
}) {
  if (refunds.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <DollarSign size={16} style={{ color: '#0891b2' }} />
          Refunds
          <Badge variant="secondary" className="ml-1">{refunds.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {refunds.map((r: any) => {
          const stage: RefundStage = (r.pipelineStage ?? "New Refund Request") as RefundStage;
          return (
            <div key={r.id} className="border rounded-lg p-3 space-y-3">
              {/* Header row: type + pipeline controls */}
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold capitalize">{r.refundType ? r.refundType.replace(/_/g, ' ') : 'Refund'}</p>
                  <p className="text-xs text-muted-foreground">{r.createdAt ? format(new Date(r.createdAt), "d MMM yyyy") : ""}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <Select
                    value={stage}
                    onValueChange={(v) => onUpdatePipeline(r.id, { pipelineStage: v as RefundStage })}
                    disabled={isPending}
                  >
                    <SelectTrigger className={`h-7 text-xs w-44 border font-medium ${REFUND_STAGE_COLORS[stage]}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REFUND_STAGES.map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={r.assignedToId ? String(r.assignedToId) : "__unassigned__"}
                    onValueChange={(v) => onUpdatePipeline(r.id, { assignedToId: v === "__unassigned__" ? null : Number(v) })}
                    disabled={isPending}
                  >
                    <SelectTrigger className="h-7 text-xs w-36">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unassigned__" className="text-xs">Unassigned</SelectItem>
                      {adminUsers.map((u: any) => (
                        <SelectItem key={u.id} value={String(u.id)} className="text-xs">{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Refund reason */}
              {r.refundReason && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-0.5">Reason</p>
                  <p className="text-sm">{r.refundReason}</p>
                </div>
              )}

              {/* Steps taken */}
              {r.stepsTaken && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-0.5">Steps Taken</p>
                  <p className="text-sm whitespace-pre-wrap">{r.stepsTaken}</p>
                </div>
              )}

              {/* Amount to client */}
              {r.amountToClient != null && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-0.5">Amount to Client</p>
                  <p className="text-sm font-semibold">£{Number(r.amountToClient).toFixed(2)}</p>
                </div>
              )}

              {/* Per-supplier breakdown */}
              {r.suppliers?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Supplier Breakdown</p>
                  <div className="space-y-1">
                    {r.suppliers.map((s: any, i: number) => (
                      <div key={i} className="flex justify-between text-xs bg-muted rounded px-2 py-1">
                        <span>{s.supplierName}</span>
                        <span className="font-medium">£{Number(s.amountDue).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bank details (admin only — already decrypted by the API) */}
              {r.clientBankName && (
                <div className="border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800 rounded p-2 space-y-1">
                  <p className="text-xs font-semibold text-green-700 dark:text-green-400">Client Bank Details</p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Account Name</p>
                      <p className="font-medium">{r.clientBankName}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Sort Code</p>
                      <p className="font-medium">{r.clientSortCode ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Account Number</p>
                      <p className="font-medium">{r.clientAccountNumber ?? '—'}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── Linked Emails Card ──────────────────────────────────────────────────────

function LinkedEmailsCard({ bookingId }: { bookingId: number }) {
  const utils = trpc.useUtils();
  const { data: linkedEmails, isLoading } = trpc.inbox.getLinkedEmails.useQuery(
    { bookingId },
    { enabled: !isNaN(bookingId) }
  );

  const unlinkEmail = trpc.inbox.unlinkEmail.useMutation({
    onSuccess: () => {
      toast.success("Email unlinked.");
      utils.inbox.getLinkedEmails.invalidate({ bookingId });
    },
    onError: (e) => toast.error(e.message),
  });

  function handleDownloadEmail(email: NonNullable<typeof linkedEmails>[number]) {
    const dateStr = email.emailDate ? format(new Date(email.emailDate), "d MMM yyyy HH:mm") : "";
    const bodyContent = email.bodyHtml
      ? email.bodyHtml
      : `<pre style="font-family:sans-serif;white-space:pre-wrap;">${email.snippet || "(no body)"}</pre>`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${email.subject || "Email"}</title><style>body{font-family:Arial,sans-serif;margin:0;padding:0}.email-header{background:#f5f5f5;border-bottom:2px solid #ddd;padding:16px 24px;margin-bottom:16px}.email-header h2{margin:0 0 8px;font-size:16px;color:#111}.email-header p{margin:2px 0;font-size:13px;color:#555}.email-body{padding:0 24px 24px}@media print{.email-header{break-inside:avoid}}</style></head><body><div class="email-header"><h2>${email.subject || "(no subject)"}</h2><p><strong>From:</strong> ${email.fromName || email.fromAddress}</p><p><strong>Date:</strong> ${dateStr}</p></div><div class="email-body">${bodyContent}</div></body></html>`;
    const printWin = window.open("", "_blank");
    if (!printWin) { toast.error("Pop-up blocked — please allow pop-ups to download emails as PDF."); return; }
    printWin.document.write(html);
    printWin.document.close();
    printWin.onload = () => { setTimeout(() => { printWin.focus(); printWin.print(); }, 400); };
    setTimeout(() => { if (!printWin.closed) { printWin.focus(); printWin.print(); } }, 1200);
    toast.success("Email opened — use Save as PDF.");
  }

  function handleDownloadAttachment(s3Url: string, filename: string) {
    const a = document.createElement("a");
    a.href = s3Url;
    a.download = filename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
    toast.success(`Downloading: ${filename}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mail size={16} style={{ color: '#02E6D2' }} />
          Linked Emails
          {linkedEmails && linkedEmails.length > 0 && (
            <Badge variant="secondary" className="ml-1">{linkedEmails.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && (!linkedEmails || linkedEmails.length === 0) && (
          <p className="text-sm text-muted-foreground">
            No emails linked yet. Use the <a href="/booking-documents" className="underline text-primary">Booking Documents</a> search to find and link emails.
          </p>
        )}
        {linkedEmails && linkedEmails.length > 0 && (
          <div className="space-y-3">
            {linkedEmails.map((email) => (
              <div key={email.linkId} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{email.subject || "(no subject)"}</p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <User size={10} />
                        {email.fromName || email.fromAddress}
                      </span>
                      {email.emailDate && (
                        <span className="flex items-center gap-1">
                          <Calendar size={10} />
                          {format(new Date(email.emailDate), "d MMM yyyy HH:mm")}
                        </span>
                      )}
                      {email.hasAttachments && (
                        <span className="flex items-center gap-1">
                          <Paperclip size={10} />
                          {email.s3Keys.length} attachment{email.s3Keys.length !== 1 ? "s" : ""}
                        </span>
                      )}
                      <span className="text-muted-foreground/60">Linked by {email.linkedByName ?? "unknown"}</span>
                    </div>
                    {email.note && (
                      <p className="text-xs text-muted-foreground mt-1 italic">{email.note}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => handleDownloadEmail(email)}
                      title="Download email as text"
                    >
                      <Download size={12} />
                      Email
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
                      onClick={() => unlinkEmail.mutate({ linkId: email.linkId })}
                      disabled={unlinkEmail.isPending}
                      title="Remove link"
                    >
                      <Unlink size={12} />
                    </Button>
                  </div>
                </div>
                {/* Attachment download chips */}
                {email.s3Keys.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {email.s3Keys.map((att) => (
                      <button
                        key={att.s3Key}
                        onClick={() => handleDownloadAttachment(att.s3Url, att.filename)}
                        className="flex items-center gap-1 text-xs bg-muted/50 hover:bg-muted rounded px-2 py-1 transition-colors"
                      >
                        <FileText size={10} className="text-muted-foreground" />
                        <span className="truncate max-w-[160px]">{att.filename}</span>
                        <Download size={10} className="text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminBookingDetail() {
  const { id } = useParams<{ id: string }>();
  const bookingId = Number(id);
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const search = useSearch();
  const fromParam = new URLSearchParams(search).get("from");
  const backHref = fromParam === "amendments" ? "/amendments/pipeline"
    : fromParam === "refunds" ? "/refunds/pipeline"
    : "/pipeline";
  const backLabel = fromParam === "amendments" ? "Amendment Pipeline"
    : fromParam === "refunds" ? "Refund Pipeline"
    : "Pipeline";

  const [sharedNote, setSharedNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [isSendingShared, setIsSendingShared] = useState(false);
  const [isSendingInternal, setIsSendingInternal] = useState(false);
  const [editPts, setEditPts] = useState("");
  const [editTopdog, setEditTopdog] = useState("");
  const [editDestination, setEditDestination] = useState("");
  const [editPaymentDate, setEditPaymentDate] = useState("");
  const [editCommission, setEditCommission] = useState("");
  const [editGrossCost, setEditGrossCost] = useState("");
  const [editPassengers, setEditPassengers] = useState("");
  const [editNights, setEditNights] = useState("");
  const [editClientName, setEditClientName] = useState("");
  const [editClientEmail, setEditClientEmail] = useState("");
  const [editDepartureDate, setEditDepartureDate] = useState("");
  const [editBookedDate, setEditBookedDate] = useState("");
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [detailsInitialised, setDetailsInitialised] = useState(false);
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [showPaymentDateGuard, setShowPaymentDateGuard] = useState(false);
  const [showQueryDialog, setShowQueryDialog] = useState(false);
  const [queryMessage, setQueryMessage] = useState("");
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<{ id: number; clientName: string } | null>(null);
  const [mergeSearchQuery, setMergeSearchQuery] = useState("");
  const isSuperAdmin = user?.role === "super_admin";

  // @mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionDropdownOpen, setMentionDropdownOpen] = useState(false);
  const [expandedHistoryItems, setExpandedHistoryItems] = useState<Set<string>>(new Set());
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: booking, isLoading } = trpc.bookings.byId.useQuery({ id: bookingId });
  const { data: adminUsers = [] } = trpc.users.listAdmins.useQuery();
  const { data: reimbDocs = [] } = trpc.bookings.listReimbDocs.useQuery({ bookingId }, { enabled: !!bookingId });
  const { data: reimbItems = [], refetch: refetchReimbItems } = trpc.reimbursements.getByBooking.useQuery({ bookingId }, { enabled: !!bookingId });
  const { data: stageHistory = [] } = trpc.bookings.pipelineHistory.useQuery({ bookingId }, { enabled: !!bookingId });
  const { data: amendments = [], refetch: refetchAmendments } = trpc.amendments.byBooking.useQuery({ bookingId }, { enabled: !!bookingId });
  const { data: refundsList = [], refetch: refetchRefunds } = trpc.refunds.byBookingAdmin.useQuery({ bookingId }, { enabled: !!bookingId });
  const updateAmendmentPipeline = trpc.amendments.updatePipeline.useMutation({
    onSuccess: () => { refetchAmendments(); toast.success('Amendment updated'); },
    onError: (e) => toast.error(e.message),
  });
  const updateRefundPipeline = trpc.refunds.updatePipeline.useMutation({
    onSuccess: () => { refetchRefunds(); toast.success('Refund updated'); },
    onError: (e) => toast.error(e.message),
  });
  const { data: cancellationsList = [] } = trpc.cancellations.byBooking.useQuery({ bookingId }, { enabled: !!bookingId });
  const updateReimbStatus = trpc.reimbursements.updateStatus.useMutation({
    onSuccess: () => { refetchReimbItems(); toast.success('Reimbursement status updated'); },
    onError: (e) => toast.error(e.message),
  });

  // Populate editable fields once booking loads
  if (booking && !detailsInitialised) {
    setEditPts(booking.ptsRef ?? "");
    setEditTopdog(booking.topdogRef ?? "");
    setEditDestination((booking as any).destination ?? "");
    setEditPaymentDate(booking.finalSupplierPaymentDate ? format(new Date(booking.finalSupplierPaymentDate), "yyyy-MM-dd") : "");
    setEditCommission(booking.expectedCommission ? String(booking.expectedCommission) : "");
    setEditGrossCost((booking as any).grossCost ? String((booking as any).grossCost) : "");
    setEditPassengers((booking as any).passengers != null ? String((booking as any).passengers) : "");
    setEditNights((booking as any).numberOfNights != null ? String((booking as any).numberOfNights) : "");
    setEditClientName(booking.clientName ?? "");
    setEditClientEmail((booking as any).clientEmail ?? "");
    setEditDepartureDate(booking.departureDate ? format(new Date(booking.departureDate), "yyyy-MM-dd") : "");
    setEditBookedDate((booking as any).bookedDate ? format(new Date((booking as any).bookedDate), "yyyy-MM-dd") : "");
    setDetailsInitialised(true);
  }

  const { data: allNotes = [], refetch: refetchNotes } = trpc.notes.list.useQuery({ bookingId });
  const { data: quickSearchResults = [] } = trpc.bookings.quickSearch.useQuery(
    { query: mergeSearchQuery },
    { enabled: mergeSearchQuery.length >= 2 }
  );
  const mergeSearchFiltered = (quickSearchResults as any[]).filter((r: any) => r.id !== bookingId);
  const sharedNotes = allNotes.filter(n => !n.isInternal);
  const internalNotes = allNotes.filter(n => n.isInternal);

  const addNote = trpc.notes.add.useMutation({
    onMutate: async (newNote) => {
      // Cancel any outgoing refetches
      await utils.notes.list.cancel({ bookingId });
      // Snapshot the previous value
      const previousNotes = utils.notes.list.getData({ bookingId });
      // Optimistically add the note
      utils.notes.list.setData({ bookingId }, (old: any) => [
        ...(old ?? []),
        {
          id: -Date.now(),
          bookingId,
          content: newNote.content,
          isInternal: newNote.isInternal,
          authorId: user?.id ?? 0,
          authorName: user?.name ?? 'You',
          authorRole: user?.role ?? 'admin',
          createdAt: new Date(),
          isReadByAdmin: true,
        },
      ]);
      return { previousNotes };
    },
    onError: (_err, _newNote, context) => {
      // Rollback on error
      if (context?.previousNotes) {
        utils.notes.list.setData({ bookingId }, context.previousNotes);
      }
    },
    onSettled: () => {
      utils.notes.list.invalidate({ bookingId });
    },
  });
  const markNotesRead = trpc.notes.markBookingNotesRead.useMutation();
  const updateDetails = trpc.bookings.updateAdminFields.useMutation();
  const deleteBookingMutation = trpc.bookings.delete.useMutation();
  const mergeBookingMutation = trpc.bookings.merge.useMutation();
  const deleteReimbDocMutation = trpc.bookings.deleteReimbDoc.useMutation({
    onSuccess: () => utils.bookings.listReimbDocs.invalidate({ bookingId }),
    onError: (err) => toast.error(err.message || "Failed to delete document"),
  });
  const moveStage = trpc.bookings.moveStage.useMutation({
    onSuccess: () => utils.bookings.byId.invalidate({ id: bookingId }),
    onError: (err) => toast.error(err.message || "Failed to move booking"),
  });

  // @mention: detect when user types @ in internal note
  const handleInternalNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInternalNote(val);

    // Find the last @ before cursor
    const cursorPos = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([A-Za-z][A-Za-z0-9 ]*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionDropdownOpen(true);
    } else if (textBeforeCursor.match(/@$/)) {
      setMentionQuery("");
      setMentionDropdownOpen(true);
    } else {
      setMentionDropdownOpen(false);
      setMentionQuery(null);
    }
  };

  const insertMention = (name: string) => {
    const textarea = internalTextareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart ?? internalNote.length;
    const textBeforeCursor = internalNote.slice(0, cursorPos);
    const textAfterCursor = internalNote.slice(cursorPos);
    // Replace the partial @mention with the full name
    const replaced = textBeforeCursor.replace(/@([A-Za-z][A-Za-z0-9 ]*)?$/, `@${name} `);
    setInternalNote(replaced + textAfterCursor);
    setMentionDropdownOpen(false);
    setMentionQuery(null);
    setTimeout(() => textarea.focus(), 0);
  };

  const filteredAdmins = adminUsers.filter(
    (a) => a.id !== user?.id && (mentionQuery === null || a.name.toLowerCase().startsWith(mentionQuery.toLowerCase()))
  );

  const handleStageChange = (newStage: string) => {
    // For "Added to PTS": require BOTH ptsRef and finalSupplierPaymentDate
    const missingPtsRef = newStage === 'Added to PTS' && !booking?.ptsRef && !editPts.trim();
    const missingPayDate = STAGES_REQUIRING_PAYMENT_DATE.includes(newStage) && !booking?.finalSupplierPaymentDate && !editPaymentDate;
    if (missingPtsRef || missingPayDate) {
      setPendingStage(newStage);
      setShowPaymentDateGuard(true);
      return;
    }
    if (newStage === "Query") {
      setPendingStage(newStage);
      setQueryMessage(`Hi ${booking?.clientName ? booking.clientName.split(" ")[0] : "there"},\n\nWe have a query regarding your booking. Please review the details and respond at your earliest convenience.\n\nThank you,\nJLT Group`);
      setShowQueryDialog(true);
      return;
    }
    moveStage.mutate({ bookingId, toStage: newStage });
  };

  const handleSendQueryAndMove = () => {
    if (!pendingStage) return;
    moveStage.mutate({ bookingId, toStage: pendingStage, queryMessage: queryMessage.trim() || undefined });
    setShowQueryDialog(false);
    setPendingStage(null);
    setQueryMessage("");
  };

  const handleGuardSaveAndMove = async () => {
    const needsPtsRef = pendingStage === 'Added to PTS' && !booking?.ptsRef && !editPts.trim();
    const needsPayDate = STAGES_REQUIRING_PAYMENT_DATE.includes(pendingStage ?? '') && !booking?.finalSupplierPaymentDate && !editPaymentDate;
    if (needsPtsRef) { toast.error("Please enter a PTS Reference."); return; }
    if (needsPayDate) { toast.error("Please enter a Final Supplier Payment Date."); return; }
    setIsSavingDetails(true);
    try {
      await updateDetails.mutateAsync({
        bookingId,
        ...(editPts.trim() && !booking?.ptsRef ? { ptsRef: editPts.trim() } : {}),
        ...(editPaymentDate && !booking?.finalSupplierPaymentDate ? { finalSupplierPaymentDate: new Date(editPaymentDate) } : {}),
      });
      await utils.bookings.byId.invalidate({ id: bookingId });
      if (pendingStage) {
        moveStage.mutate({ bookingId, toStage: pendingStage });
      }
      setShowPaymentDateGuard(false);
      setPendingStage(null);
      toast.success("Details saved and booking moved.");
    } catch (err: any) {
      toast.error(err.message || "Failed to save details");
    } finally {
      setIsSavingDetails(false);
    }
  };

  const handleSendNote = async (isInternal: boolean) => {
    const content = isInternal ? internalNote : sharedNote;
    if (!content.trim()) return;
    // Clear input immediately for instant feedback
    if (isInternal) setInternalNote(""); else setSharedNote("");
    if (isInternal) setIsSendingInternal(true); else setIsSendingShared(true);
    try {
      await addNote.mutateAsync({ bookingId, content, isInternal });
      // When admin replies via a shared note, auto-mark all unread agent messages as read
      if (!isInternal) { markNotesRead.mutate({ bookingId }); }
    } catch (err: any) {
      // Restore content on failure
      if (isInternal) setInternalNote(content); else setSharedNote(content);
      toast.error(err.message || "Failed to add note");
    } finally {
      if (isInternal) setIsSendingInternal(false); else setIsSendingShared(false);
    }
  };

  const handleSaveDetails = async () => {
    setIsSavingDetails(true);
    try {
      await updateDetails.mutateAsync({
        bookingId,
        ptsRef: editPts || undefined,
        topdogRef: editTopdog || undefined,
        destination: editDestination || undefined,
        finalSupplierPaymentDate: editPaymentDate ? new Date(editPaymentDate) : null,
        expectedCommission: editCommission ? Number(editCommission) : undefined,
        grossCost: editGrossCost ? Number(editGrossCost) : undefined,
        passengers: editPassengers ? parseInt(editPassengers) : undefined,
        numberOfNights: editNights ? parseInt(editNights) : undefined,
        clientName: editClientName.trim() || undefined,
        clientEmail: editClientEmail.trim() || null,
        departureDate: editDepartureDate ? new Date(editDepartureDate) : undefined,
        // Only send bookedDate if it was explicitly set by the admin — never overwrite with null
        ...(editBookedDate ? { bookedDate: new Date(editBookedDate) } : {}),
      });
      await utils.bookings.byId.invalidate({ id: bookingId });
      toast.success("Details saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save details");
    } finally {
      setIsSavingDetails(false);
    }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="animate-spin" size={32} style={{ color: '#70FFE8' }} />
    </div>
  );
  if (!booking) return <div className="text-center py-20 text-muted-foreground">Booking not found.</div>;

  const missingPaymentDate = !booking.finalSupplierPaymentDate && !editPaymentDate;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href={backHref}>
          <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft size={16} />{backLabel}</Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{booking.clientName}</h1>
          <p className="text-sm text-muted-foreground">Booking #{booking.id}</p>
        </div>
        <div className="flex items-center gap-2">
          {booking.isPersonalBooking && (
            <Badge className="gap-1 text-xs bg-teal-100 text-teal-800 border border-teal-300 hover:bg-teal-100">
              Personal Booking
            </Badge>
          )}
          {missingPaymentDate && STAGES_REQUIRING_PAYMENT_DATE.includes(booking.currentStage) && (
            <Badge variant="destructive" className="gap-1 text-xs">
              <AlertTriangle size={10} /> Payment date missing
            </Badge>
          )}
          {isSuperAdmin && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                onClick={() => setShowMergeDialog(true)}
              >
                <GitMerge size={13} /> Merge
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs border-red-300 text-red-600 hover:bg-red-50"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 size={13} /> Delete
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setCreateTaskOpen(true)}
          >
            <CheckSquare size={13} /> Create Task
          </Button>
          <Select value={booking.currentStage} onValueChange={handleStageChange}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Booking info */}
        <Card>
          <CardHeader><CardTitle className="text-base">Booking Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Client</dt>
                <dd className="font-medium mt-0.5">{booking.clientName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Departure</dt>
                <dd className="font-medium mt-0.5">{format(new Date(booking.departureDate), "dd MMM yyyy")}</dd>
              </div>
              {(booking as any).bookedDate && (
                <div>
                  <dt className="text-muted-foreground">Booked Date</dt>
                  <dd className="font-medium mt-0.5">{format(new Date((booking as any).bookedDate), "dd MMM yyyy")}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Agent</dt>
                <dd className="font-medium mt-0.5">
                  {(booking as any).agentName ?? `Agent #${booking.agentId}`}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Reimbursements</dt>
                <dd className="font-medium mt-0.5">{booking.reimbursementsRequired ? "Yes" : "No"}</dd>
              </div>
              {(booking as any).passengers != null && (
                <div>
                  <dt className="text-muted-foreground">Passengers (excl. infants)</dt>
                  <dd className="font-medium mt-0.5">{(booking as any).passengers}</dd>
                </div>
              )}
              {(booking as any).numberOfNights != null && (
                <div>
                  <dt className="text-muted-foreground">Number of Nights</dt>
                  <dd className="font-medium mt-0.5">{(booking as any).numberOfNights}</dd>
                </div>
              )}
            </dl>

            {(reimbDocs as any[]).length > 0 && (
              <div className="pt-2 border-t space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reimbursement Documents ({(reimbDocs as any[]).length})</p>
                {(reimbDocs as any[]).map((doc: any) => (
                  <div key={doc.id} className="flex items-center gap-2 text-sm">
                    <FileText size={13} style={{ color: '#02E6D2' }} className="flex-shrink-0" />
                    <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                      className="underline truncate flex-1" style={{ color: '#02E6D2' }}>
                      {doc.fileName || 'View document'}
                    </a>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
                    </span>
                    <button
                      type="button"
                      className="text-red-400 hover:text-red-600 flex-shrink-0 ml-1"
                      title="Delete document"
                      onClick={() => {
                        if (confirm(`Delete "${doc.fileName || 'this document'}"? This cannot be undone.`)) {
                          deleteReimbDocMutation.mutate({ docId: doc.id });
                        }
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {booking.reimbursementsRequired && (reimbDocs as any[]).length === 0 && (
              <div className="pt-2 border-t">
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <FileText size={12} /> No documents uploaded yet
                </p>
              </div>
            )}

            {/* Reimbursement Items Panel */}
            {(reimbItems as any[]).length > 0 && (
              <div className="pt-2 border-t space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reimbursement Items ({(reimbItems as any[]).length})</p>
                {(reimbItems as any[]).map((item: any) => {
                  const statusColor = item.status === 'paid' ? '#065f46' : item.status === 'scheduled' ? '#1d4ed8' : '#92400e';
                  const statusBg = item.status === 'paid' ? '#d1fae5' : item.status === 'scheduled' ? '#dbeafe' : '#fef3c7';
                  const statusLabel = item.status === 'paid' ? 'Paid' : item.status === 'scheduled' ? 'Scheduled' : 'Pending';
                  const docs: any[] = item.docs ?? [];
                  return (
                    <div key={item.id} className="rounded-lg border overflow-hidden" style={{ background: item.isLate ? '#fffbeb' : '#fafafa', borderColor: item.isLate ? '#f59e0b' : undefined }}>
                      {/* Item header */}
                      <div className="flex items-center gap-2 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{item.supplierName}</p>
                          <p className="text-xs text-muted-foreground">£{Number(item.amount).toFixed(2)}{item.isLate ? ' · 🕒 Late submission' : ''}</p>
                        </div>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: statusBg, color: statusColor }}>
                          {statusLabel}
                        </span>
                        {item.status !== 'paid' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-6 px-2 flex-shrink-0"
                            disabled={updateReimbStatus.isPending}
                            onClick={() => updateReimbStatus.mutate({ id: item.id, status: item.status === 'pending' ? 'scheduled' : 'paid' })}
                          >
                            {item.status === 'pending' ? 'Mark Scheduled' : 'Mark Paid'}
                          </Button>
                        )}
                      </div>
                      {/* Documents for this item */}
                      <div className="border-t px-3 py-2 space-y-1" style={{ background: '#f8fafc' }}>
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          Documents ({docs.length})
                        </p>
                        {docs.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No documents uploaded yet for this reimbursement.</p>
                        ) : (
                          docs.map((doc: any) => (
                            <div key={doc.id} className="flex items-center gap-2 text-xs">
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#065f46" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="underline truncate flex-1" style={{ color: '#065f46' }}>{doc.fileName}</a>
                              <span className="text-muted-foreground flex-shrink-0">{doc.createdAt ? new Date(doc.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : ''}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-3 pt-2 border-t">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs flex items-center gap-1"><User size={11} />Client Name</Label>
                  <Input value={editClientName} onChange={(e) => setEditClientName(e.target.value)} placeholder="Client full name" className="h-8 text-sm" />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>Client Email</Label>
                  <Input type="email" value={editClientEmail} onChange={(e) => setEditClientEmail(e.target.value)} placeholder="client@example.com" className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1"><Calendar size={11} />Departure Date</Label>
                  <Input type="date" value={editDepartureDate} onChange={(e) => setEditDepartureDate(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1"><Calendar size={11} />Booked Date</Label>
                  <Input type="date" value={editBookedDate} onChange={(e) => setEditBookedDate(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Destination</Label>
                  <CountrySelect value={editDestination} onChange={setEditDestination} placeholder="Select country..." className="h-8 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Topdog Ref</Label>
                  <div className="flex items-center gap-1.5">
                    <Input value={editTopdog} onChange={(e) => setEditTopdog(e.target.value)} placeholder="TD..." className="h-8 text-sm" />
                    {booking.topdogRef && <CopyableRef value={booking.topdogRef} label="Topdog ref" className="flex-shrink-0" />}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">PTS Ref</Label>
                  <div className="flex items-center gap-1.5">
                    <Input value={editPts} onChange={(e) => setEditPts(e.target.value)} placeholder="PTS..." className="h-8 text-sm" />
                    {booking.ptsRef && <CopyableRef value={booking.ptsRef} label="PTS ref" className="flex-shrink-0" />}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1">
                    <Calendar size={11} />
                    Final Supplier Payment Date
                    {missingPaymentDate && <span className="text-red-500 ml-1">*</span>}
                  </Label>
                  <Input
                    type="date"
                    value={editPaymentDate}
                    onChange={(e) => setEditPaymentDate(e.target.value)}
                    className={`h-8 text-sm ${missingPaymentDate ? "border-red-400 ring-1 ring-red-300" : ""}`}
                  />
                  {missingPaymentDate && (
                    <p className="text-xs text-red-500">Required before moving to "Added to PTS" or later</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Expected Commission (£)</Label>
                  <Input type="number" value={editCommission} onChange={(e) => setEditCommission(e.target.value)} placeholder="0.00" className="h-8 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Passengers (excl. infants)</Label>
                  <Input type="number" min="1" step="1" value={editPassengers} onChange={(e) => setEditPassengers(e.target.value)} placeholder="e.g. 2" className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Number of Nights</Label>
                  <Input type="number" min="0" step="1" value={editNights} onChange={(e) => setEditNights(e.target.value)} placeholder="e.g. 7" className="h-8 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Gross Cost (£)</Label>
                  <Input type="number" value={editGrossCost} onChange={(e) => setEditGrossCost(e.target.value)} placeholder="0.00" className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Margin</Label>
                  {(() => {
                    const gc = Number(editGrossCost || (booking as any).grossCost || 0);
                    const ec = Number(editCommission || booking.expectedCommission || 0);
                    if (!gc || !ec) return <p className="text-xs text-muted-foreground h-8 flex items-center">—</p>;
                    const pct = (ec / gc) * 100;
                    return (
                      <div className={`h-8 flex items-center px-2 rounded text-sm font-semibold ${
                        pct < 5 ? 'bg-red-100 text-red-700' : pct < 10 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {pct.toFixed(1)}%{pct < 5 && ' ⚠ Low'}
                      </div>
                    );
                  })()}
                </div>
              </div>
              <Button onClick={handleSaveDetails} disabled={isSavingDetails} size="sm"
                style={{ background: '#70FFE8', color: '#414141' }} className="gap-2">
                {isSavingDetails ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Details
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent>
            <Tabs defaultValue="shared">
              <TabsList className="w-full mb-4">
                <TabsTrigger value="shared" className="flex-1">Shared ({sharedNotes.length})</TabsTrigger>
                <TabsTrigger value="internal" className="flex-1">
                  <Lock size={12} className="mr-1" />
                  Internal ({internalNotes.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="shared" className="space-y-3">
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {sharedNotes.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No shared notes yet</p>
                  ) : (sharedNotes as any[]).map((note) => {
                    const isSystem = note.content?.startsWith('[System]');
                    const isMe = note.authorId === user?.id;
                    const isAgent = note.authorRole === 'agent';

                    if (isSystem) {
                      return (
                        <div key={note.id} className="flex justify-center">
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
                            style={{ background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd' }}>
                            <span className="font-bold uppercase tracking-wide text-[10px]">System</span>
                            <span>{note.content.replace('[System] ', '')}</span>
                            <span className="opacity-50">{format(new Date(note.createdAt), 'dd MMM, HH:mm')}</span>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={note.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-[85%] rounded-2xl px-3 py-2 text-sm"
                          style={{
                            background: isMe ? '#70FFE8' : isAgent ? '#f0fdf4' : '#f3f4f6',
                            color: '#414141',
                            border: isAgent ? '1px solid #86efac' : 'none',
                          }}>
                          <p className="text-[10px] font-semibold mb-1 flex items-center gap-1.5" style={{ opacity: 0.75 }}>
                            {isAgent && !isMe && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide" style={{ background: '#16a34a', color: 'white' }}>Agent</span>
                            )}
                            {note.authorName}
                          </p>
                          <NoteContent content={note.content} />
                          <p className="text-xs opacity-50 mt-1">{format(new Date(note.createdAt), 'dd MMM, HH:mm')}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-2 pt-2 border-t">
                  <Textarea value={sharedNote} onChange={(e) => setSharedNote(e.target.value)}
                    placeholder="Shared message (agent can see this)..." className="min-h-[56px] resize-none text-sm"
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendNote(false); } }} />
                  <Button onClick={() => handleSendNote(false)} disabled={isSendingShared || !sharedNote.trim()}
                    style={{ background: '#70FFE8', color: '#414141' }} className="self-end">
                    {isSendingShared ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="internal" className="space-y-3">
                <div className="p-2 rounded-lg text-xs flex items-center gap-2 mb-2"
                  style={{ background: '#FFF6ED', color: '#92400e' }}>
                  <Lock size={12} />
                  Internal notes are never visible to agents. Use <AtSign size={11} className="inline mx-0.5" /> to tag a colleague.
                </div>
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {internalNotes.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No internal notes yet</p>
                  ) : (internalNotes as any[]).map((note) => {
                    const isSystem = note.content?.startsWith('[System]');
                    const isMe = note.authorId === user?.id;

                    if (isSystem) {
                      return (
                        <div key={note.id} className="flex justify-center">
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
                            style={{ background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd' }}>
                            <span className="font-bold uppercase tracking-wide text-[10px]">System</span>
                            <span>{note.content.replace('[System] ', '')}</span>
                            <span className="opacity-50">{format(new Date(note.createdAt), 'dd MMM, HH:mm')}</span>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={note.id} className={`p-3 rounded-lg border text-sm ${isMe ? 'ml-4' : 'mr-4'}`}
                        style={{
                          background: isMe ? '#FFF6ED' : '#faf5ff',
                          borderColor: isMe ? '#FFC3BC' : '#d8b4fe',
                        }}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <User size={11} className="opacity-50" />
                          <p className="text-[10px] font-semibold opacity-75">{note.authorName}</p>
                          {isMe && <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: '#7c3aed', color: 'white' }}>You</span>}
                        </div>
                        <NoteContent content={note.content} />
                        <p className="text-xs opacity-50 mt-1">{format(new Date(note.createdAt), 'dd MMM, HH:mm')}</p>
                      </div>
                    );
                  })}
                </div>
                {/* @mention textarea with dropdown */}
                <div className="relative pt-2 border-t">
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <Textarea
                        ref={internalTextareaRef}
                        value={internalNote}
                        onChange={handleInternalNoteChange}
                        placeholder="Internal note — type @ to mention a colleague..."
                        className="min-h-[56px] resize-none text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Escape") { setMentionDropdownOpen(false); return; }
                          if (e.key === "Enter" && !e.shiftKey && !mentionDropdownOpen) {
                            e.preventDefault();
                            handleSendNote(true);
                          }
                        }}
                        onBlur={() => setTimeout(() => setMentionDropdownOpen(false), 150)}
                      />
                      {/* @mention dropdown */}
                      {mentionDropdownOpen && filteredAdmins.length > 0 && (
                        <div className="absolute bottom-full left-0 mb-1 w-56 rounded-lg border shadow-lg z-50 overflow-hidden"
                          style={{ background: '#fff', borderColor: '#FFC3BC' }}>
                          {filteredAdmins.map((admin) => (
                            <button
                              key={admin.id}
                              type="button"
                              className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                              onMouseDown={(e) => { e.preventDefault(); insertMention(admin.name); }}
                            >
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                                style={{ background: '#70FFE8', color: '#414141' }}>
                                {admin.name.charAt(0).toUpperCase()}
                              </div>
                              <span>{admin.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button onClick={() => handleSendNote(true)} disabled={isSendingInternal || !internalNote.trim()}
                      style={{ background: '#FFC3BC', color: '#414141' }} className="self-end">
                      {isSendingInternal ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Full History Overview */}
      {/* expandedHistoryItems tracks which timeline event IDs are expanded */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History size={16} style={{ color: '#02E6D2' }} />
            Full Booking History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            // Build a unified timeline from all history sources
            type TimelineEvent = {
              id: string;
              type: 'stage' | 'amendment' | 'refund' | 'cancellation' | 'reimbursement';
              timestamp: Date;
              title: string;
              description?: string;
              status?: string;
              statusColor?: string;
              statusBg?: string;
            };

            const events: TimelineEvent[] = [];

            // Stage changes
            (stageHistory as any[]).forEach((h) => {
              events.push({
                id: `stage-${h.id}`,
                type: 'stage',
                timestamp: new Date(h.movedAt),
                title: h.fromStage ? `Stage: ${h.fromStage} → ${h.toStage}` : `Stage set to: ${h.toStage}`,
                description: h.movedByName ? `By ${h.movedByName}` : undefined,
              });
            });

            // Amendments
            (amendments as any[]).forEach((a) => {
              const statusColor = a.status === 'actioned' ? '#065f46' : '#92400e';
              const statusBg = a.status === 'actioned' ? '#d1fae5' : '#fef3c7';
              events.push({
                id: `amendment-${a.id}`,
                type: 'amendment',
                timestamp: new Date(a.createdAt),
                title: 'Amendment Request',
                description: a.details ?? undefined,
                status: a.status === 'actioned' ? 'Actioned' : 'Pending',
                statusColor,
                statusBg,
              });
            });

            // Refunds
            (refundsList as any[]).forEach((r) => {
              const statusColor = r.pipelineStage === 'Actioned' ? '#065f46' : '#1d4ed8';
              const statusBg = r.pipelineStage === 'Actioned' ? '#d1fae5' : '#dbeafe';
              events.push({
                id: `refund-${r.id}`,
                type: 'refund',
                timestamp: new Date(r.createdAt),
                title: `Refund Request (${r.refundType})`,
                description: r.refundReason ?? undefined,
                status: r.pipelineStage ?? 'To Do',
                statusColor,
                statusBg,
              });
            });

            // Cancellations
            (cancellationsList as any[]).forEach((c) => {
              events.push({
                id: `cancellation-${c.id}`,
                type: 'cancellation',
                timestamp: new Date(c.confirmedAt),
                title: 'Cancellation Request',
                description: c.status === 'actioned' ? 'Actioned by admin' : 'Pending admin action',
                status: c.status === 'actioned' ? 'Actioned' : 'Pending',
                statusColor: c.status === 'actioned' ? '#065f46' : '#dc2626',
                statusBg: c.status === 'actioned' ? '#d1fae5' : '#fee2e2',
              });
            });

            // Reimbursements
            (reimbItems as any[]).forEach((ri) => {
              const statusColor = ri.status === 'paid' ? '#065f46' : ri.status === 'scheduled' ? '#1d4ed8' : '#92400e';
              const statusBg = ri.status === 'paid' ? '#d1fae5' : ri.status === 'scheduled' ? '#dbeafe' : '#fef3c7';
              events.push({
                id: `reimb-${ri.id}`,
                type: 'reimbursement',
                timestamp: new Date(ri.createdAt),
                title: `Reimbursement: ${ri.supplierName}`,
                description: `£${Number(ri.amount).toFixed(2)}${ri.isLate ? ' · Late submission' : ''}`,
                status: ri.status === 'paid' ? 'Paid' : ri.status === 'scheduled' ? 'Scheduled' : 'Pending',
                statusColor,
                statusBg,
              });
            });

            // Sort by timestamp descending (newest first)
            events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

            if (events.length === 0) {
              return (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No history recorded yet for this booking.
                </p>
              );
            }

            const typeConfig: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
              stage: { icon: <RefreshCw size={13} />, color: '#0369a1', bg: '#e0f2fe' },
              amendment: { icon: <Edit3 size={13} />, color: '#7c3aed', bg: '#f3e8ff' },
              refund: { icon: <DollarSign size={13} />, color: '#0891b2', bg: '#cffafe' },
              cancellation: { icon: <XCircle size={13} />, color: '#dc2626', bg: '#fee2e2' },
              reimbursement: { icon: <Clock size={13} />, color: '#d97706', bg: '#fef3c7' },
            };

            return (
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-4 top-0 bottom-0 w-0.5" style={{ background: '#e5e7eb' }} />
                <div className="space-y-0">
                  {events.map((event, idx) => {
                    const cfg = typeConfig[event.type];
                    return (
                      <div key={event.id} className="relative flex gap-3 pb-4">
                        {/* Icon bubble */}
                        <div
                          className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                          style={{ background: cfg.bg, color: cfg.color, border: `1.5px solid ${cfg.color}20` }}
                        >
                          {cfg.icon}
                        </div>
                        {/* Content */}
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-start gap-2 flex-wrap">
                            <p className="text-sm font-medium flex-1 min-w-0">{event.title}</p>
                            {event.status && (
                              <span
                                className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                                style={{ background: event.statusBg, color: event.statusColor }}
                              >
                                {event.status}
                              </span>
                            )}
                          </div>
                          {event.description && (() => {
                              const LIMIT = 200;
                              const isLong = event.description.length > LIMIT;
                              const expandKey = event.id;
                              const isExpanded = expandedHistoryItems.has(expandKey);
                              return (
                                <div className="mt-0.5">
                                  <p className="text-xs text-muted-foreground leading-relaxed">
                                    {isLong && !isExpanded ? event.description.slice(0, LIMIT) + '…' : event.description}
                                  </p>
                                  {isLong && (
                                    <button
                                      onClick={() => setExpandedHistoryItems((prev: Set<string>) => {
                                        const next = new Set(prev);
                                        if (isExpanded) next.delete(expandKey); else next.add(expandKey);
                                        return next;
                                      })}
                                      className="text-[10px] font-medium mt-0.5 hover:underline"
                                      style={{ color: '#02E6D2' }}
                                    >
                                      {isExpanded ? 'Show less' : 'Show more'}
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <Clock size={10} className="opacity-60" />
                            {format(event.timestamp, 'dd MMM yyyy, HH:mm')}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Amendment Pipeline */}
      <AmendmentPipelineCard
        amendments={amendments as any[]}
        adminUsers={adminUsers}
        onUpdatePipeline={(amendmentId, data) => updateAmendmentPipeline.mutate({ amendmentId, ...data })}
        isPending={updateAmendmentPipeline.isPending}
      />

      {/* Refund Pipeline */}
      <RefundPipelineCard
        refunds={refundsList as any[]}
        adminUsers={adminUsers}
        onUpdatePipeline={(refundId, data) => updateRefundPipeline.mutate({ refundId, ...data })}
        isPending={updateRefundPipeline.isPending}
      />

      {/* Linked Emails */}
      <LinkedEmailsCard bookingId={bookingId} />

      {/* Payment Links */}
      <PaymentsCard bookingId={bookingId} booking={booking} />

      {/* Query Message Dialog */}
      <Dialog open={showQueryDialog} onOpenChange={(open) => { if (!open) { setShowQueryDialog(false); setPendingStage(null); setQueryMessage(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-sm" style={{ background: '#fefce8', color: '#854d0e' }}>?</span>
              Send Query to Agent
            </DialogTitle>
            <DialogDescription>
              This message will be posted as a shared note visible to the agent and will also trigger a query notification email. You can edit the message below before sending.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-sm font-medium">Message to Agent</Label>
            <Textarea
              value={queryMessage}
              onChange={(e) => setQueryMessage(e.target.value)}
              className="min-h-[140px] text-sm resize-none"
              placeholder="Describe the query for the agent..."
              autoFocus
            />
            <p className="text-xs text-muted-foreground">This will also move the booking to the <strong>Query</strong> stage.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowQueryDialog(false); setPendingStage(null); setQueryMessage(""); }}>
              Cancel
            </Button>
            <Button
              onClick={handleSendQueryAndMove}
              disabled={moveStage.isPending}
              style={{ background: '#eab308', color: '#fff' }}
            >
              {moveStage.isPending ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
              Send &amp; Move to Query
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stage Move Guard Dialog — requires PTS ref (Added to PTS) and/or payment date */}
      <Dialog open={showPaymentDateGuard} onOpenChange={setShowPaymentDateGuard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500" />
              Required Details to Move to "{pendingStage}"
            </DialogTitle>
            <DialogDescription>
              Please complete the fields below before moving this booking to <strong>"{pendingStage}"</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* PTS Reference — only shown when moving to Added to PTS and no ref yet */}
            {pendingStage === 'Added to PTS' && !booking?.ptsRef && (
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">
                  PTS Reference <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="text"
                  placeholder="e.g. 2T0096300"
                  value={editPts}
                  onChange={(e) => setEditPts(e.target.value)}
                  className="h-9"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">Sent to the agent for bank transfers and PPS payment links.</p>
              </div>
            )}
            {/* Payment Date — shown when required and not yet set */}
            {STAGES_REQUIRING_PAYMENT_DATE.includes(pendingStage ?? '') && !booking?.finalSupplierPaymentDate && (
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">
                  Final Supplier Payment Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="date"
                  value={editPaymentDate}
                  onChange={(e) => setEditPaymentDate(e.target.value)}
                  className="h-9"
                />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowPaymentDateGuard(false); setPendingStage(null); }}>
              Cancel
            </Button>
            <Button
              onClick={handleGuardSaveAndMove}
              disabled={
                isSavingDetails ||
                (pendingStage === 'Added to PTS' && !booking?.ptsRef && !editPts.trim()) ||
                (STAGES_REQUIRING_PAYMENT_DATE.includes(pendingStage ?? '') && !booking?.finalSupplierPaymentDate && !editPaymentDate)
              }
              style={{ background: '#70FFE8', color: '#414141' }}
            >
              {isSavingDetails ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
              Save &amp; Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Booking Confirm Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 size={18} /> Delete Booking
            </DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{booking.clientName}</strong> (Booking #{booking.id}) and all associated notes, documents, amendments, refunds, and cancellations. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteBookingMutation.isPending}
              onClick={async () => {
                try {
                  await deleteBookingMutation.mutateAsync({ id: bookingId });
                  toast.success(`Booking "${booking.clientName}" deleted.`);
                  window.location.href = "/pipeline";
                } catch (err: any) {
                  toast.error(err.message || "Failed to delete booking");
                }
              }}
            >
              {deleteBookingMutation.isPending ? <Loader2 size={14} className="animate-spin mr-2" /> : <Trash2 size={14} className="mr-2" />}
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Booking Dialog */}
      <Dialog open={showMergeDialog} onOpenChange={(open) => { if (!open) { setShowMergeDialog(false); setMergeTarget(null); setMergeSearchQuery(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <GitMerge size={18} /> Merge into Another Booking
            </DialogTitle>
            <DialogDescription>
              Search for the booking to merge <strong>{booking.clientName} (#{booking.id})</strong> into. All documents, notes, amendments, refunds, and cancellations from this booking will be moved to the target, and this booking will be deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                className="w-full pl-8 pr-4 py-2 text-sm border rounded-md bg-background"
                placeholder="Search by client name, PTS ref, or TD ref..."
                value={mergeSearchQuery}
                onChange={(e) => { setMergeSearchQuery(e.target.value); setMergeTarget(null); }}
                autoFocus
              />
            </div>
            {mergeSearchQuery.length >= 2 && (
              <div className="border rounded-md overflow-hidden max-h-48 overflow-y-auto">
                {mergeSearchFiltered.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No bookings found</p>
                ) : mergeSearchFiltered.map((r: any) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`w-full text-left px-3 py-2.5 text-sm hover:bg-muted flex items-center justify-between ${
                      mergeTarget?.id === r.id ? 'bg-amber-50 border-l-2 border-amber-400' : ''
                    }`}
                    onClick={() => setMergeTarget({ id: r.id, clientName: r.clientName })}
                  >
                    <div>
                      <p className="font-medium">{r.clientName}</p>
                      <p className="text-xs text-muted-foreground">#{r.id} · {r.currentStage}</p>
                    </div>
                    {mergeTarget?.id === r.id && <span className="text-amber-600 text-xs font-semibold">Selected</span>}
                  </button>
                ))}
              </div>
            )}
            {mergeTarget && (
              <div className="p-3 rounded-lg text-sm" style={{ background: '#fffbeb', border: '1px solid #fcd34d' }}>
                <p className="font-medium text-amber-800">Merge summary:</p>
                <p className="text-amber-700 mt-1">
                  <strong>{booking.clientName} (#{booking.id})</strong> → <strong>{mergeTarget.clientName} (#{mergeTarget.id})</strong>
                </p>
                <p className="text-xs text-amber-600 mt-1">Booking #{booking.id} will be permanently deleted after the merge.</p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowMergeDialog(false); setMergeTarget(null); setMergeSearchQuery(""); }}>Cancel</Button>
            <Button
              disabled={!mergeTarget || mergeBookingMutation.isPending}
              className="bg-amber-500 text-white hover:bg-amber-600"
              onClick={async () => {
                if (!mergeTarget) return;
                try {
                  await mergeBookingMutation.mutateAsync({ sourceId: bookingId, targetId: mergeTarget.id });
                  toast.success(`Merged into ${mergeTarget.clientName} (#${mergeTarget.id}).`);
                  window.location.href = `/bookings/${mergeTarget.id}`;
                } catch (err: any) {
                  toast.error(err.message || "Failed to merge bookings");
                }
              }}
            >
              {mergeBookingMutation.isPending ? <Loader2 size={14} className="animate-spin mr-2" /> : <GitMerge size={14} className="mr-2" />}
              Merge &amp; Delete Source
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Task dialog */}
      {createTaskOpen && (
        <TaskFormDialog
          open={createTaskOpen}
          onClose={() => setCreateTaskOpen(false)}
          onSaved={() => setCreateTaskOpen(false)}
          adminUsers={adminUsers as { id: number; name: string }[]}
          prefillBooking={{
            id: booking.id,
            label: `${booking.clientName} (#${booking.id})`,
          }}
        />
      )}
    </div>
  );
}
