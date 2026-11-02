import { useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";

type IssueFilter =
  | "all"
  | "arrears"
  | "dd"
  | "delivery"
  | "review"
  | "resolved";
const FILTERS: { value: IssueFilter; label: string }[] = [
  { value: "all", label: "All current issues" },
  { value: "arrears", label: "Outstanding payments" },
  { value: "dd", label: "Direct Debit & onboarding" },
  { value: "delivery", label: "Mail issues & queue" },
  { value: "review", label: "Needs review" },
  { value: "resolved", label: "Resolved / clear accounts" },
];
const QUERY_OPTIONS = { retry: false, refetchOnWindowFocus: false } as const;

function stamp(value: Date | string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
function money(
  pence: number | null | undefined,
  currency: string | null = "GBP"
): string {
  if (pence == null) return "Amount unknown";
  if (!currency) return `${(pence / 100).toFixed(2)} — currency unknown`;
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
    }).format(pence / 100);
  } catch {
    return `${(pence / 100).toFixed(2)} — ${currency} (unrecognised currency)`;
  }
}
function label(value: string): string {
  return value.replaceAll("_", " ");
}

export function canRecordPaymentSettlement(
  role: string | undefined,
  payment: {
    status: string;
    amountPence: number | null;
    currency: string | null;
  }
): boolean {
  return (
    (role === "admin" || role === "super_admin") &&
    payment.status === "outstanding" &&
    payment.currency === "GBP" &&
    Number.isSafeInteger(payment.amountPence) &&
    (payment.amountPence ?? 0) > 0
  );
}

export function canRecordFeeSettlement(
  role: string | undefined,
  status: string
): boolean {
  return (role === "admin" || role === "super_admin") && status === "assessed";
}

export function feePolicyAmountPence(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const [pounds, pennies = ""] = value.trim().split(".");
  const amount = Number(pounds) * 100 + Number(pennies.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100000
    ? amount
    : null;
}

export function automationConfirmation(enabled: boolean) {
  return enabled ? "ENABLE FUTURE PAYMENT RULES" : "PAUSE PAYMENT RULES";
}

type ReconciliationOutcome = {
  status?: "in_progress" | "complete";
  skipped?: string;
  eventCount?: number;
  recovered?: { completed: number; errors: number; backlog: number };
  notifications?: { failed: number; ambiguous: number };
};
export function reconciliationMessage(result: ReconciliationOutcome): string {
  if (result.skipped)
    return `Reconciliation not run: ${result.skipped}. No new successful sync is implied.`;
  const recovered = result.recovered;
  const details = `${result.eventCount ?? 0} provider event(s) read; ${recovered?.completed ?? 0} recovered; ${recovered?.errors ?? 0} recovery error(s); ${recovered?.backlog ?? 0} awaiting recovery.`;
  if (
    result.status === "in_progress" ||
    (recovered && recovered.errors === 0 && recovered.backlog > 0)
  )
    return `Provider reconciliation in progress. ${details} No complete ledger scan or healthy status is implied; payment rules remain unchanged.`;
  if (!recovered || recovered.errors > 0 || recovered.backlog > 0)
    return `Reconciliation needs review. ${details} No healthy status is implied.`;
  return `Provider reconciliation completed. ${details} Mail failures: ${result.notifications?.failed ?? 0}; uncertain acceptance: ${result.notifications?.ambiguous ?? 0}. Review stored health below; this is not proof of collection or email delivery.`;
}

type RecoveryHealth = {
  pendingEvents?: number;
  failedEvents?: number;
  recoveryState?: "waiting" | "in_progress" | "review_required" | "complete";
  lastSuccessAt?: Date | string | null;
  lastError?: string | null;
};
function recoveryLabel(health: RecoveryHealth): string {
  if (
    health.recoveryState === "review_required" ||
    (health.failedEvents ?? 0) > 0 ||
    health.lastError
  )
    return "Review required";
  if (health.recoveryState === "waiting")
    return "Waiting for first reconciliation";
  if (health.recoveryState === "in_progress" || (health.pendingEvents ?? 0) > 0)
    return "Recovery in progress";
  return health.recoveryState === "complete" || health.lastSuccessAt
    ? "Complete"
    : "Waiting for first reconciliation";
}

function usePaymentRefresh() {
  const utils = trpc.useUtils();
  return async () => {
    await Promise.all([
      utils.membershipPayments.invalidate(),
      utils.crm.agentCrm.invalidate(),
      utils.gocardless.adminGetCurrentPaymentIssues.invalidate(),
      utils.gocardless.adminGetPaymentEvents.invalidate(),
      utils.gocardless.adminGetDdStatus.invalidate(),
      utils.gocardless.adminGetPaymentSchedule.invalidate(),
    ]);
  };
}

type ControlHealth = {
  enabled: boolean;
  activatedAt: Date | string | null;
  controlPresent: boolean;
  feePolicyApproved?: boolean;
  feeAmountPence?: number | null;
  feeCollectionMode?: string | null;
};
function PaymentControls({
  health,
  unavailable,
}: {
  health: ControlHealth | undefined;
  unavailable: boolean;
}) {
  const { user } = useAuth();
  const isStaff = user?.role === "admin" || user?.role === "super_admin";
  const isSuperAdmin = user?.role === "super_admin";
  const refresh = usePaymentRefresh();
  const [dialog, setDialog] = useState<"enable" | "pause" | "fee" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [outcome, setOutcome] = useState("");
  const reconcile = trpc.membershipPayments.refreshFromProvider.useMutation({
    onSuccess: async result => {
      setOutcome(reconciliationMessage(result));
      await refresh();
    },
    onError: async () => {
      setOutcome("");
      await refresh();
    },
  });
  const automation = trpc.membershipPayments.setAutomation.useMutation({
    onSuccess: async result => {
      setOutcome(
        result.enabled
          ? "Future payment rules enabled. Historical issues remain for review; no payment collection was initiated."
          : "Payment rules paused. Stored records and manual suspensions remain unchanged."
      );
      setDialog(null);
      setConfirmation("");
      await refresh();
    },
  });
  const approveFee = trpc.membershipPayments.approveFeePolicy.useMutation({
    onSuccess: async result => {
      setOutcome(
        `Admin fee policy approved: ${money(result.amountPence)}. Future qualifying fees require staff approval; no money collected.`
      );
      setDialog(null);
      setConfirmation("");
      setFeeAmount("");
      await refresh();
    },
  });
  const pending =
    reconcile.isPending || automation.isPending || approveFee.isPending;
  const mutationError = reconcile.error ?? automation.error ?? approveFee.error;
  const amountPence = feePolicyAmountPence(feeAmount);
  const enabled = dialog === "enable";
  const expected =
    dialog === "fee"
      ? "APPROVE ADMIN FEE POLICY"
      : automationConfirmation(enabled);
  const openDialog = (next: "enable" | "pause" | "fee") => {
    setConfirmation("");
    setFeeAmount("");
    setOutcome("");
    automation.reset();
    approveFee.reset();
    reconcile.reset();
    setDialog(next);
  };
  return (
    <div className="space-y-2 border-t pt-3 text-xs">
      <p>
        {unavailable
          ? "Admin fee policy unavailable. No approval can be inferred from cached data."
          : health?.feePolicyApproved && health.feeAmountPence != null
            ? `Admin fee policy: ${money(health.feeAmountPence)} · ${health.feeCollectionMode === "staff_approval" ? "staff approval required; no automatic collection" : "collection mode needs review"}.`
            : "Admin fee amount pending policy approval. No amount has been approved; no automatic charge is authorised."}
      </p>
      <div className="flex flex-wrap gap-2">
        {isStaff && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || unavailable}
            onClick={() => {
              setOutcome("");
              automation.reset();
              approveFee.reset();
              reconcile.mutate({});
            }}
          >
            {reconcile.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Run provider reconciliation
          </Button>
        )}
        {isSuperAdmin && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || unavailable || !health}
              onClick={() => openDialog(health?.enabled ? "pause" : "enable")}
            >
              {health?.enabled
                ? "Pause payment rules"
                : "Enable future payment rules"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || unavailable || !health?.controlPresent}
              onClick={() => openDialog("fee")}
            >
              Approve admin fee policy
            </Button>
          </>
        )}
      </div>
      <p className="text-muted-foreground">
        Reconciliation reads GoCardless and recovers durable work. It does not
        collect payments; already enabled future rules may process queued
        notices. Refresh view only reloads stored records.
      </p>
      {outcome && (
        <p role="status" className="break-words">
          {outcome}
        </p>
      )}
      {mutationError && (
        <p role="alert" className="text-destructive break-words">
          {mutationError.message} No successful reconciliation or policy change
          is implied by an error.
        </p>
      )}
      {isSuperAdmin && dialog && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open && !pending) setDialog(null);
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {dialog === "fee"
                  ? "Approve admin fee policy"
                  : enabled
                    ? "Enable future payment rules"
                    : "Pause payment rules"}
              </DialogTitle>
              <DialogDescription>
                {dialog === "fee"
                  ? "Optional policy approval for future qualifying fees only. No automatic charge, Direct Debit collection or membership reinstatement. Fees are recorded for staff approval."
                  : enabled
                    ? health?.activatedAt
                      ? "Resume already activated future work, including pending notices. A current provider reconciliation is required; provider-event errors must be resolved. No payments will be collected."
                      : "Initially paused. First activation requires a healthy, complete current provider ledger scan with no pending or failed provider events. Only future qualifying rules are activated; historical issues need separate review. No payments will be collected."
                    : "Pause future payment-rule processing and queued notices. This does not cancel a Direct Debit or undo existing records or suspensions."}
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={event => {
                event.preventDefault();
                if (
                  !isSuperAdmin ||
                  pending ||
                  unavailable ||
                  confirmation !== expected
                )
                  return;
                if (dialog === "fee") {
                  if (amountPence === null || !health?.controlPresent) return;
                  approveFee.mutate({
                    amountPence,
                    confirmation: "APPROVE ADMIN FEE POLICY",
                  });
                } else
                  automation.mutate({
                    enabled,
                    confirmation: automationConfirmation(enabled),
                  });
              }}
            >
              {dialog === "fee" && (
                <label className="block text-sm space-y-1">
                  Admin fee amount (£ GBP)
                  <Input
                    inputMode="decimal"
                    value={feeAmount}
                    disabled={pending}
                    placeholder="Enter an amount for approval"
                    onChange={event => setFeeAmount(event.target.value)}
                  />
                  <span className="block text-xs text-muted-foreground">
                    Positive GBP amount, up to £1,000; at most two decimal
                    places. No default amount.
                  </span>
                </label>
              )}
              <div className="rounded border bg-muted/30 p-2 text-xs space-y-1">
                <p className="font-medium">Exact request</p>
                <code className="break-all">
                  {JSON.stringify(
                    dialog === "fee"
                      ? { amountPence, confirmation: expected }
                      : { enabled, confirmation: expected }
                  )}
                </code>
              </div>
              <label className="block text-sm space-y-1">
                Type <strong>{expected}</strong>
                <Input
                  value={confirmation}
                  disabled={pending}
                  autoComplete="off"
                  onChange={event => setConfirmation(event.target.value)}
                />
              </label>
              {(automation.error ?? approveFee.error) && (
                <p role="alert" className="text-sm text-destructive">
                  {(automation.error ?? approveFee.error)?.message}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setDialog(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    pending ||
                    unavailable ||
                    confirmation !== expected ||
                    (dialog === "fee" && amountPence === null)
                  }
                >
                  {pending ? "Saving…" : "Confirm request"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

type ReceiptTarget =
  | {
      kind: "payment";
      userId: number;
      paymentId: string;
      amountPence: number;
      lastFailureAt: Date | string | null;
    }
  | { kind: "fee"; feeId: number; amountPence: number; currency: string };
function ReceiptDialog({
  target,
  onClose,
  onRecorded,
}: {
  target: ReceiptTarget;
  onClose: () => void;
  onRecorded: (message: string) => void;
}) {
  const { user } = useAuth();
  const isStaff = user?.role === "admin" || user?.role === "super_admin";
  const refresh = usePaymentRefresh();
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [settledAt, setSettledAt] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const receivedDate = settledAt ? new Date(settledAt) : null;
  const validDate =
    receivedDate &&
    Number.isFinite(receivedDate.getTime()) &&
    receivedDate.getTime() <= Date.now() &&
    (target.kind !== "payment" ||
      !target.lastFailureAt ||
      receivedDate.getTime() >= new Date(target.lastFailureAt).getTime());
  const completed = async () => {
    await refresh();
    onRecorded(
      "Receipt recorded. Balances reloaded; membership access and manual suspensions remain unchanged."
    );
    onClose();
  };
  const settlement = trpc.membershipPayments.recordSettlement.useMutation({
    onSuccess: completed,
  });
  const feeSettlement = trpc.membershipPayments.recordFeeSettlement.useMutation(
    { onSuccess: completed }
  );
  const pending = settlement.isPending || feeSettlement.isPending;
  const expected =
    target.kind === "payment"
      ? "RECORD PAYMENT RECEIVED"
      : "RECORD FEE RECEIVED";
  const ready =
    isStaff &&
    !pending &&
    reference.trim().length > 0 &&
    notes.trim().length > 0 &&
    confirmation === expected &&
    (target.kind === "fee" || validDate);
  const mutationError = settlement.error ?? feeSettlement.error;
  if (!isStaff) return null;
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Record {target.kind === "payment" ? "payment" : "fee"} received
          </DialogTitle>
          <DialogDescription>
            Record only a bank transfer already received and verified in the
            bank. This does not initiate a payment, retry or collect a Direct
            Debit, or automatically reinstate membership. Do not record a
            promised payment.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 space-y-1">
          <p className="font-semibold">
            Only record money actually received by bank transfer.
          </p>
          <p className="font-mono break-all">
            {target.kind === "payment"
              ? `Agent ${target.userId} · Payment ${target.paymentId}`
              : `Fee ${target.feeId}`}
          </p>
          <p>
            Exact full amount:{" "}
            <strong>
              {money(
                target.amountPence,
                target.kind === "payment" ? "GBP" : target.currency
              )}
            </strong>
            .{" "}
            {target.kind === "payment"
              ? "Whole outstanding payment only; no partial or account-wide write-off."
              : "Only this assessed fee; membership arrears remain separate."}
          </p>
        </div>
        <form
          className="space-y-3"
          onSubmit={event => {
            event.preventDefault();
            if (!ready) return;
            if (target.kind === "payment" && receivedDate)
              settlement.mutate({
                userId: target.userId,
                paymentId: target.paymentId,
                amountPence: target.amountPence,
                reference: reference.trim(),
                notes: notes.trim(),
                settledAt: receivedDate.toISOString(),
                confirmation: "RECORD PAYMENT RECEIVED",
              });
            else if (target.kind === "fee")
              feeSettlement.mutate({
                feeId: target.feeId,
                reference: reference.trim(),
                notes: notes.trim(),
                confirmation: "RECORD FEE RECEIVED",
              });
          }}
        >
          <label className="block text-sm space-y-1">
            Bank transfer reference
            <Input
              value={reference}
              maxLength={255}
              disabled={pending}
              onChange={event => setReference(event.target.value)}
            />
          </label>
          <label className="block text-sm space-y-1">
            Receipt verification notes
            <Input
              value={notes}
              maxLength={3000}
              disabled={pending}
              onChange={event => setNotes(event.target.value)}
            />
          </label>
          {target.kind === "payment" && (
            <label className="block text-sm space-y-1">
              Received at (your local time)
              <Input
                type="datetime-local"
                value={settledAt}
                disabled={pending}
                onChange={event => setSettledAt(event.target.value)}
              />
              <span className="block text-xs text-muted-foreground">
                Sent as UTC. Must not be in the future or before the latest
                failed attempt ({stamp(target.lastFailureAt)}).
              </span>
            </label>
          )}
          <label className="block text-sm space-y-1">
            Type <strong>{expected}</strong>
            <Input
              value={confirmation}
              autoComplete="off"
              disabled={pending}
              onChange={event => setConfirmation(event.target.value)}
            />
          </label>
          {mutationError && (
            <p role="alert" className="text-sm text-destructive">
              {mutationError.message} No receipt recorded. Refresh the account
              before trying again.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              {pending ? "Recording…" : "Record verified receipt"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccountReview({
  userId,
  onClose,
}: {
  userId: number;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [receipt, setReceipt] = useState<ReceiptTarget | null>(null);
  const [receiptOutcome, setReceiptOutcome] = useState("");
  const input = useMemo(() => ({ userId }), [userId]);
  const query = trpc.membershipPayments.accountDetail.useQuery(
    input,
    QUERY_OPTIONS
  );
  const data = query.data;
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Payment account review
            {data ? ` — ${data.account.name ?? `Agent ${userId}`}` : ""}
          </DialogTitle>
          <DialogDescription>
            Latest 20 payment, fee and mail references. Record verified bank
            transfer receipts only against eligible current obligations.
            Provider acceptance is not confirmed email delivery.
          </DialogDescription>
        </DialogHeader>
        {query.isLoading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading review…
          </p>
        )}
        {query.error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Review unavailable</AlertTitle>
            <AlertDescription>{query.error.message}</AlertDescription>
          </Alert>
        )}
        {data && !query.error && (
          <div className="space-y-5">
            {receiptOutcome && (
              <p role="status" className="text-sm">
                {receiptOutcome}
              </p>
            )}
            <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
              <p>
                Current outstanding:{" "}
                <strong>{data.account.outstandingCount} payment(s)</strong> ·{" "}
                {data.account.outstandingCount > 0
                  ? money(data.account.outstandingPence)
                  : "No current outstanding payments"}
              </p>
              <p>
                Current failed attempts: {data.account.failedAttempts} · Last
                failed: {stamp(data.account.lastFailedAt)}
              </p>
              <p>
                Account ledger updated: {stamp(data.account.lastSyncedAt)} (not
                a live provider balance)
              </p>
              {data.account.lastError && (
                <p className="text-destructive break-words">
                  Sync error: {data.account.lastError}
                </p>
              )}
              <p className="text-muted-foreground">
                Suspension reason:{" "}
                {data.account.suspensionReason ?? "Not recorded"}. Payment
                resolution does not authorise changing manual suspension or
                portal access.
              </p>
            </div>
            <section aria-label="Payment references" className="space-y-2">
              <h3 className="font-semibold text-sm">Payment references</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment ID</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last event</TableHead>
                    <TableHead className="text-right">Receipt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.payments.map(payment => (
                    <TableRow key={payment.id}>
                      <TableCell className="font-mono text-xs">
                        {payment.paymentId}
                      </TableCell>
                      <TableCell>
                        {money(payment.amountPence, payment.currency)}
                      </TableCell>
                      <TableCell>{label(payment.status)}</TableCell>
                      <TableCell className="text-xs">
                        {stamp(payment.lastEventAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {canRecordPaymentSettlement(user?.role, payment) && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={query.isFetching}
                            onClick={() => {
                              setReceiptOutcome("");
                              setReceipt({
                                kind: "payment",
                                userId,
                                paymentId: payment.paymentId,
                                amountPence: payment.amountPence!,
                                lastFailureAt: payment.lastFailureAt,
                              });
                            }}
                          >
                            Record payment received
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {data.payments.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No recorded payment references; this is not proof of payment.
                </p>
              )}
              {data.truncated.payments && (
                <p className="text-xs text-muted-foreground">
                  More payment records exist. Showing only the latest 20.
                </p>
              )}
            </section>
            <section aria-label="Fee references" className="space-y-2">
              <h3 className="font-semibold text-sm">Fee references</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run / trigger event</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Collection reference</TableHead>
                    <TableHead className="text-right">Receipt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.fees.map(fee => (
                    <TableRow key={fee.id}>
                      <TableCell className="font-mono text-xs break-all">
                        {fee.runKey}
                        <div className="text-muted-foreground">
                          {fee.triggerEventId}
                        </div>
                      </TableCell>
                      <TableCell>
                        {money(fee.amountPence, fee.currency)}
                      </TableCell>
                      <TableCell>{label(fee.status)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {fee.paymentId ?? "No collection reference"}
                      </TableCell>
                      <TableCell className="text-right">
                        {canRecordFeeSettlement(user?.role, fee.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={query.isFetching}
                            onClick={() => {
                              setReceiptOutcome("");
                              setReceipt({
                                kind: "fee",
                                feeId: fee.id,
                                amountPence: fee.amountPence,
                                currency: fee.currency,
                              });
                            }}
                          >
                            Record fee received
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {data.fees.length === 0 && (
                <p className="text-xs text-muted-foreground">No fee records.</p>
              )}
              {data.truncated.fees && (
                <p className="text-xs text-muted-foreground">
                  More fee records exist. Showing only the latest 20.
                </p>
              )}
            </section>
            <section aria-label="Mail references" className="space-y-2">
              <h3 className="font-semibold text-sm">Mail references</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kind / event</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Provider reference</TableHead>
                    <TableHead>Attempts / error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.mail.map(mail => (
                    <TableRow key={mail.id}>
                      <TableCell className="text-xs">
                        {label(mail.kind)}
                        <div className="font-mono text-muted-foreground break-all">
                          {mail.eventId ?? "No event reference"}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {mail.status === "accepted"
                          ? "Accepted — not delivery confirmed"
                          : label(mail.status)}
                      </TableCell>
                      <TableCell className="font-mono text-xs break-all">
                        {mail.providerMessageId ?? "Not recorded"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {mail.attempts}
                        <div className="text-destructive break-words">
                          {mail.lastError}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {data.mail.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No mail records.
                </p>
              )}
              {data.truncated.mail && (
                <p className="text-xs text-muted-foreground">
                  More mail records exist. Showing only the latest 20.
                </p>
              )}
            </section>
            <Button variant="outline" asChild>
              <Link href={data.account.crmHref}>
                Open Direct Debit record <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        )}
      </DialogContent>
      {receipt && (
        <ReceiptDialog
          target={receipt}
          onClose={() => setReceipt(null)}
          onRecorded={setReceiptOutcome}
        />
      )}
    </Dialog>
  );
}

export default function MembershipPaymentIssues() {
  const { user } = useAuth();
  const isStaff = user?.role === "admin" || user?.role === "super_admin";
  const utils = trpc.useUtils();
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<IssueFilter>("all");
  const [page, setPage] = useState(1);
  const [reviewUserId, setReviewUserId] = useState<number | null>(null);
  const input = useMemo(
    () => ({ search, filter, page, pageSize: 25 }),
    [search, filter, page]
  );
  const overviewInput = useMemo(() => ({}), []);
  const overview = trpc.membershipPayments.overview.useQuery(overviewInput, {
    ...QUERY_OPTIONS,
    enabled: isStaff,
  });
  const issues = trpc.membershipPayments.listIssues.useQuery(input, {
    ...QUERY_OPTIONS,
    enabled: isStaff,
  });
  const health = overview.data?.health;
  const recoveryHealth: RecoveryHealth | undefined = health;
  const counts = overview.data?.counts;
  const error = overview.error ?? issues.error;
  const schemaRequired =
    error?.data?.code === "PRECONDITION_FAILED" ||
    /schema update required/i.test(error?.message ?? "");
  const refreshing = overview.isFetching || issues.isFetching;

  if (!isStaff)
    return (
      <p className="text-sm text-muted-foreground">
        Payment issue review and controls are restricted to authorised staff.
      </p>
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg">
            Payment &amp; Direct Debit Issues
          </h2>
          <p className="text-sm text-muted-foreground">
            Current account balances and latest recorded Direct Debit authority
            — one row per agent.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={() => {
            void overview.refetch();
            void issues.refetch();
            void utils.membershipPayments.accountDetail.invalidate();
          }}
          className="gap-2 shrink-0"
        >
          <RefreshCw
            className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing ? "Refreshing…" : "Refresh view"}
        </Button>
      </div>

      <Card className="border-amber-200 dark:border-amber-900">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Payment automation health
            </CardTitle>
            <Badge
              variant={
                schemaRequired || !health?.enabled ? "outline" : "secondary"
              }
            >
              {schemaRequired
                ? "Schema update required"
                : error
                  ? "Health unavailable"
                  : overview.isLoading
                    ? "Checking health…"
                    : !health
                      ? "Health unavailable"
                      : health.lastError
                        ? "Provider recovery needs review"
                        : !health.enabled
                          ? "Automation paused"
                          : "Automation enabled — not health confirmation"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {recoveryHealth && !error && !overview.isLoading && (
            <section
              aria-label="Provider event recovery"
              className="rounded-lg border bg-muted/30 p-3 text-xs space-y-3"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="font-semibold">Provider event recovery</h3>
                <Badge variant="outline">{recoveryLabel(recoveryHealth)}</Badge>
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Pending events</dt>
                  <dd className="font-medium mt-1">
                    {recoveryHealth.pendingEvents ?? "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    Events requiring review
                  </dt>
                  <dd className="font-medium mt-1">
                    {recoveryHealth.failedEvents ?? "Not recorded"}
                  </dd>
                </div>
              </dl>
              <p className="text-muted-foreground">
                Pending events are awaiting recovery, not a failed
                reconciliation. Partial progress is not a healthy, complete
                ledger scan and does not enable payment rules.
              </p>
            </section>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div>
              <p className="text-muted-foreground">
                Last completed ledger reconciliation
              </p>
              <p className="font-medium mt-1">{stamp(health?.lastSuccessAt)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Last provider event sync</p>
              <p className="font-medium mt-1">
                {stamp(health?.lastEventSyncAt)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">
                Reviewed historical issues
              </p>
              <p className="font-medium mt-1">
                {!counts
                  ? "Review state unavailable"
                  : counts.historicalReviewRequiredAgents > 0
                    ? `${counts.historicalReviewRequiredAgents} agent(s) need historical review`
                    : "No historical review flags; not audit confirmation"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">View last read</p>
              <p className="font-medium mt-1">{stamp(overview.data?.readAt)}</p>
            </div>
          </div>
          {health?.stale && (
            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <Clock className="h-3.5 w-3.5" /> The last completed ledger
              reconciliation is over 15 minutes old or has not completed yet.
              Provider event sync may still be progressing. This is not a live
              balance.
            </p>
          )}
          {health && !health.controlPresent && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Automation paused: singleton control record is not initialised.
              Run provider reconciliation before first activation.
            </p>
          )}
          {health?.lastError && (
            <p className="text-xs text-destructive break-words">
              Provider sync error: {health.lastError}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Last provider event sync records provider reads, not completion of
            ledger recovery. Last completed ledger reconciliation records a
            complete successful scan, not proof of collection or email delivery.
            View last read is only a stored-record read timestamp, not provider
            last success. Refresh view does not sync the provider or collect
            payments. Manual suspensions remain unchanged.
          </p>
          <PaymentControls
            health={health}
            unavailable={Boolean(error) || overview.isLoading}
          />
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>
            {schemaRequired
              ? "Schema update required — issues cannot be reviewed"
              : "Payment issues unavailable"}
          </AlertTitle>
          <AlertDescription>
            {error.message}
            <p>
              Do not interpret unavailable or cached data as no issues. No
              successful refresh is implied.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {!error && counts && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[
            {
              title: "Outstanding payments",
              value: counts.outstandingPayments,
              sub: `${counts.arrearsAgents} agent(s) · ${money(counts.knownOutstandingPence)} known balance${counts.unknownAmountAgents > 0 ? ` · ${counts.unknownAmountAgents} agent(s): amount unknown` : ""}`,
            },
            {
              title: "Direct Debit issues",
              value: counts.ddAgents,
              sub: `${counts.onboardingDdAgents} onboarding setup(s) shown separately`,
            },
            {
              title: "Fees pending / review",
              value: counts.pendingFeeCount,
              sub: "Separate from membership arrears; see review for currency and status",
            },
            {
              title: "Mail issues / queue",
              value: counts.deliveryAgents,
              sub: `${counts.mailAcceptedCount} accepted by provider — not delivery confirmed`,
            },
          ].map(stat => (
            <Card key={stat.title}>
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {stat.title}
                </p>
                <p className="text-2xl font-bold mt-1">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{stat.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <form
              className="flex gap-2 flex-1 max-w-xl"
              onSubmit={event => {
                event.preventDefault();
                setSearch(draftSearch.trim());
                setPage(1);
              }}
            >
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  aria-label="Search payment issues by agent, email or ID"
                  placeholder="Search agent, email or ID"
                  value={draftSearch}
                  maxLength={200}
                  onChange={event => setDraftSearch(event.target.value)}
                  className="pl-9"
                />
              </div>
              <Button type="submit" variant="outline">
                Search
              </Button>
            </form>
            <Select
              value={filter}
              onValueChange={value => {
                setFilter(value as IssueFilter);
                setPage(1);
              }}
            >
              <SelectTrigger
                aria-label="Filter payment issues"
                className="w-full sm:w-64"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTERS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Cancelled/departed and intentionally paused memberships are not
            flagged simply for a cancelled mandate. Onboarding setup is not
            arrears. Historical failed events alone do not create an outstanding
            balance.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {(issues.isLoading || overview.isLoading) && !error ? (
            <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading current
              accounts…
            </div>
          ) : error ? (
            <p className="p-6 text-sm text-muted-foreground">
              Issue list unavailable. Resolve the error above, then refresh the
              view.
            </p>
          ) : !issues.data ? (
            <p className="p-6 text-sm text-muted-foreground">
              No successful account read yet.
            </p>
          ) : issues.data.items.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <p className="font-medium">No records match this filter.</p>
              <p className="mt-1 text-xs">
                This is a stored snapshot, not confirmation that all live
                payments are settled.
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent / membership</TableHead>
                    <TableHead>Current outstanding</TableHead>
                    <TableHead>Direct Debit</TableHead>
                    <TableHead>Fees / mail</TableHead>
                    <TableHead>Review &amp; freshness</TableHead>
                    <TableHead className="text-right">Record</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issues.data.items.map(account => (
                    <TableRow key={account.userId}>
                      <TableCell className="align-top">
                        <p className="font-medium text-sm">
                          {account.name ?? `Agent ${account.userId}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {account.email ?? "No email recorded"}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {account.uniqueAgentId && (
                            <Badge
                              variant="outline"
                              className="font-mono text-[10px]"
                            >
                              {account.uniqueAgentId}
                            </Badge>
                          )}
                          <Badge
                            variant="secondary"
                            className="text-[10px] capitalize"
                          >
                            {label(account.agentStatus)}
                          </Badge>
                          {!account.isActive && (
                            <Badge variant="outline" className="text-[10px]">
                              Portal access disabled
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <p className="font-semibold text-sm">
                          {account.outstandingCount} payment(s)
                        </p>
                        <p
                          className={`text-xs mt-1 ${account.amountUnknown ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
                        >
                          {!account.accountPresent
                            ? "Account not yet reconciled"
                            : account.outstandingCount > 0
                              ? money(account.outstandingPence)
                              : "No current arrears"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Current failed attempts: {account.failedAttempts}
                        </p>
                      </TableCell>
                      <TableCell className="align-top text-xs">
                        <p
                          className={
                            account.ddIssue
                              ? "text-destructive font-medium"
                              : "font-medium"
                          }
                        >
                          {account.paymentExempt
                            ? "Payment exempt"
                            : account.onboardingDd
                              ? "Onboarding — DD setup needed"
                              : account.ddIssue
                                ? `Current DD issue: ${account.mandateStatus ?? "missing"}`
                                : `Mandate: ${account.mandateStatus ?? "not recorded"}`}
                        </p>
                        {account.mandateId && (
                          <p className="font-mono text-muted-foreground mt-1">
                            {account.mandateId}
                          </p>
                        )}
                        <p className="text-muted-foreground mt-1">
                          Subscription:{" "}
                          {account.subscriptionStatus ?? "not recorded"}
                        </p>
                        {account.subscriptionId && (
                          <p className="font-mono text-muted-foreground">
                            {account.subscriptionId}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-xs space-y-1">
                        <p>{account.pendingFeeCount} fee(s) pending / review</p>
                        <p
                          className={
                            account.deliveryIssueCount > 0
                              ? "text-destructive"
                              : "text-muted-foreground"
                          }
                        >
                          {account.deliveryIssueCount} mail issue(s) ·{" "}
                          {account.mailPendingCount} queued
                        </p>
                        <p className="text-muted-foreground">
                          {account.mailAcceptedCount} accepted — not delivery
                          confirmed
                        </p>
                      </TableCell>
                      <TableCell className="align-top text-xs space-y-1">
                        {account.historyReviewRequired && (
                          <Badge variant="outline" className="text-[10px]">
                            Historical review required
                          </Badge>
                        )}
                        {account.reviewIssue &&
                          !account.historyReviewRequired && (
                            <Badge variant="outline" className="text-[10px]">
                              Reconciliation review needed
                            </Badge>
                          )}
                        <p className="text-muted-foreground">
                          Synced: {stamp(account.lastSyncedAt)}
                        </p>
                        {account.lastError && (
                          <p className="text-destructive max-w-52 break-words">
                            {account.lastError}
                          </p>
                        )}
                        {(account.agentStatus === "suspended" ||
                          account.portalStatus === "suspended") && (
                          <p className="text-muted-foreground">
                            Suspended:{" "}
                            {account.suspensionReason ?? "reason not recorded"}.
                            Access unchanged.
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-right">
                        <div className="flex flex-col gap-1 items-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setReviewUserId(account.userId)}
                          >
                            Review refs
                          </Button>
                          <Button size="sm" variant="ghost" asChild>
                            <Link href={account.crmHref}>
                              Direct Debit{" "}
                              <ArrowRight className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
          {!error && issues.data && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
              <p>
                {issues.data.total} matching agent(s) · Page {issues.data.page}{" "}
                of {issues.data.totalPages} · 25 per page
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Previous page"
                  disabled={issues.data.page <= 1 || issues.isFetching}
                  onClick={() => setPage(issues.data!.page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Next page"
                  disabled={
                    issues.data.page >= issues.data.totalPages ||
                    issues.isFetching
                  }
                  onClick={() => setPage(issues.data!.page + 1)}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      {reviewUserId !== null && (
        <AccountReview
          userId={reviewUserId}
          onClose={() => setReviewUserId(null)}
        />
      )}
    </div>
  );
}
