import React, { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatMergeTimestamp } from "./AgentMergeHistory";
import type {
  MergeAccount,
  MergePreview,
} from "../../../server/agent-merge-contract";

export type AgentMergeDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  sourceUserId: number;
  sourceName: string;
  onMerged(primaryId: number): void;
};

export type MergeConfirmation = {
  reason: string;
  confirmation: string;
  samePersonConfirmed: boolean;
  primaryChoicesConfirmed: boolean;
  archivedLearningConfirmed: boolean;
  keepBanksAsIs?: boolean;
};

/** Recheck all safeguards at submission time, not only when enabling the button. */
export function canExecuteAgentMerge(
  preview: MergePreview | undefined,
  sourceUserId: number,
  primaryUserId: number,
  review: MergeConfirmation,
  now = Date.now()
): boolean {
  return Boolean(
    preview &&
      sourceUserId !== primaryUserId &&
      preview.source.id === sourceUserId &&
      preview.primary.id === primaryUserId &&
      preview.canMerge &&
      preview.blockers.length === 0 &&
      preview.token.trim() &&
      Number.isFinite(Date.parse(preview.expiresAt)) &&
      Date.parse(preview.expiresAt) > now &&
      review.reason.trim().length >= 10 &&
      review.samePersonConfirmed &&
      review.primaryChoicesConfirmed &&
      review.archivedLearningConfirmed &&
      Boolean(preview.keepBanksAsIs) === Boolean(review.keepBanksAsIs) &&
      review.confirmation === `MERGE ${sourceUserId} INTO ${primaryUserId}`
  );
}

export function AgentMergeDialog(props: AgentMergeDialogProps) {
  const { user } = useAuth();
  // Do not mount merge queries or execution controls for any other role.
  if (user?.role !== "super_admin" || !props.open) return null;
  return <AuthorizedMergeDialog key={props.sourceUserId} {...props} />;
}

function AuthorizedMergeDialog({
  open,
  onOpenChange,
  sourceUserId,
  sourceName,
  onMerged,
}: AgentMergeDialogProps) {
  const [search, setSearch] = useState("");
  const [primary, setPrimary] = useState<MergeAccount | null>(null);
  const [executing, setExecuting] = useState(false);
  const query = search.trim();
  const candidates = trpc.agentMerge.candidates.useQuery(
    { search: query },
    {
      enabled: open && query.length >= 2,
      retry: false,
      placeholderData: undefined,
    }
  );
  const results = (candidates.data ?? [])
    .filter(account => account.id !== sourceUserId)
    .slice(0, 25);

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        if (!executing) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"
        showCloseButton={!executing}
        onEscapeKeyDown={event => {
          if (executing) event.preventDefault();
        }}
        onInteractOutside={event => {
          if (executing) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Merge duplicate agent</DialogTitle>
          <DialogDescription>
            Current record:{" "}
            <strong>
              {sourceName} (#{sourceUserId})
            </strong>{" "}
            is the SOURCE duplicate to archive. Choose the PRIMARY account to
            KEEP. This does not delete the original record.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="agent-merge-search">
            Find the account to KEEP — ID, name, email or JLT ID
          </Label>
          <Input
            id="agent-merge-search"
            value={search}
            disabled={executing}
            onChange={event => setSearch(event.target.value)}
            placeholder="Enter at least 2 characters"
            autoComplete="off"
            maxLength={150}
          />
          {query.length < 2 ? (
            <p className="text-xs text-muted-foreground">
              Enter at least 2 characters. Up to 25 matches are shown; narrow
              the search if needed.
            </p>
          ) : candidates.isError ? (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm"
            >
              <p>Unable to search accounts: {candidates.error.message}</p>
              <p className="text-muted-foreground">
                Retry. If the merge schema is pending, ask a SuperAdmin to
                complete the migration before merging.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={executing || candidates.isFetching}
                onClick={() => void candidates.refetch()}
              >
                Retry account search
              </Button>
            </div>
          ) : candidates.isFetching ? (
            <p role="status" className="text-sm text-muted-foreground">
              Searching accounts…
            </p>
          ) : results.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No other matching accounts. Try a different ID, name, email or JLT
              ID.
            </p>
          ) : (
            <div
              className="max-h-56 space-y-2 overflow-y-auto rounded-lg border p-2"
              aria-label="Accounts to keep"
            >
              {results.map(account => (
                <div
                  key={account.id}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-md p-2 ${primary?.id === account.id ? "bg-primary/10" : "bg-muted/40"}`}
                >
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">
                      {account.name ?? "Unnamed agent"} · #{account.id}
                    </p>
                    <p className="break-words text-xs text-muted-foreground">
                      {account.email ?? "No email"} · JLT:{" "}
                      {account.jltId ?? "Not recorded"} ·{" "}
                      {account.status ?? "Status unknown"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={
                      primary?.id === account.id ? "secondary" : "outline"
                    }
                    disabled={executing}
                    aria-pressed={primary?.id === account.id}
                    onClick={() => setPrimary(account)}
                  >
                    {primary?.id === account.id
                      ? "Selected to KEEP"
                      : "Keep this record"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        {primary ? (
          <SelectedMergePreview
            // A different pair unmounts the old preview, acknowledgements and mutation state.
            key={`${sourceUserId}:${primary.id}`}
            sourceUserId={sourceUserId}
            primary={primary}
            onPendingChange={setExecuting}
            onMerged={primaryId => {
              onOpenChange(false);
              onMerged(primaryId);
            }}
          />
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Select the primary account to load a fresh merge preview.
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={executing}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountSummary({
  account,
  title,
}: {
  account: MergeAccount;
  title: string;
}) {
  return (
    <section className="space-y-2 rounded-lg border p-4 text-sm">
      <h3 className="font-semibold">{title}</h3>
      <p className="font-medium">
        {account.name ?? "Unnamed agent"} · #{account.id}
      </p>
      <p className="break-words">{account.email ?? "No email recorded"}</p>
      <p>
        JLT ID: {account.jltId ?? "Not recorded"} · Status:{" "}
        {account.status ?? "Unknown"}
      </p>
      <p className="text-muted-foreground">
        Last login: {formatMergeTimestamp(account.lastSignedIn)}
      </p>
      <p>
        {account.bookings} bookings · {account.courses} courses
      </p>
      <p className="text-xs text-muted-foreground">
        Payout bank: {account.payoutBankStatus === "not_recorded"
          ? "No bank identifiers recorded"
          : account.payoutBankStatus === "partial"
            ? "Partial bank identifiers recorded"
            : account.payoutBankStatus === "recorded"
              ? "Bank identifiers recorded"
              : account.payoutBankStatus === "unverified"
                ? "Stored bank identifiers could not be verified"
                : "Check CRM record"}
      </p>
      <div>
        <p className="font-medium">Direct Debit mandates</p>
        {account.mandates.length ? (
          <ul className="space-y-1">
            {account.mandates.map((mandate, index) => (
              <li
                key={`${mandate.id}:${index}`}
                className="break-words text-xs"
              >
                {mandate.id ?? "No reference"} — {mandate.status}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">None recorded</p>
        )}
      </div>
      <div>
        <p className="font-medium">Subscription references</p>
        {account.subscriptions.length ? (
          <ul className="space-y-1">
            {account.subscriptions.map((subscription, index) => (
              <li
                key={`${subscription.id}:${index}`}
                className="break-words text-xs"
              >
                {subscription.id ?? "No reference"} — {subscription.status}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">None recorded</p>
        )}
      </div>
    </section>
  );
}

function SelectedMergePreview({
  sourceUserId,
  primary,
  onPendingChange,
  onMerged,
}: {
  sourceUserId: number;
  primary: MergeAccount;
  onPendingChange(pending: boolean): void;
  onMerged(primaryId: number): void;
}) {
  const utils = trpc.useUtils();
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [samePersonConfirmed, setSamePersonConfirmed] = useState(false);
  const [primaryChoicesConfirmed, setPrimaryChoicesConfirmed] = useState(false);
  const [archivedLearningConfirmed, setArchivedLearningConfirmed] =
    useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [keepBanksAsIs, setKeepBanksAsIs] = useState(false);
  const previewQuery = trpc.agentMerge.preview.useQuery(
    { sourceUserId, primaryUserId: primary.id, keepBanksAsIs },
    {
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
      placeholderData: undefined,
    }
  );
  const preview = previewQuery.data;
  const expectedConfirmation = `MERGE ${sourceUserId} INTO ${primary.id}`;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  function resetReview() {
    setConfirmation("");
    setSamePersonConfirmed(false);
    setPrimaryChoicesConfirmed(false);
    setArchivedLearningConfirmed(false);
  }

  // A refreshed token must be reviewed again; never carry approval across preview changes.
  useEffect(() => {
    resetReview();
  }, [preview?.token, keepBanksAsIs]);

  const execute = trpc.agentMerge.execute.useMutation({
    onSuccess: async () => {
      const refreshed = await Promise.allSettled([
        utils.crm.agentCrm.invalidate(),
        utils.gocardless.invalidate(),
        utils.membershipPayments.invalidate(),
        utils.academy.invalidate(),
        utils.agentMerge.invalidate(),
      ]);
      toast.success(
        `Duplicate archived. Account #${primary.id} is the primary account.`
      );
      if (refreshed.some(result => result.status === "rejected"))
        toast.warning(
          "Merge completed, but some views could not refresh. Reload before making further changes."
        );
      onMerged(primary.id);
    },
    onError: error => {
      setExecutionError(error.message);
      setNeedsRefresh(true);
      resetReview();
    },
    onSettled: () => onPendingChange(false),
  });

  async function refreshPreview() {
    if (execute.isPending) return;
    setNeedsRefresh(true);
    resetReview();
    const result = await previewQuery.refetch();
    if (!result.isError && result.data) {
      setNeedsRefresh(false);
      setExecutionError(null);
      setNow(Date.now());
    }
  }

  const review = {
    reason,
    confirmation,
    samePersonConfirmed,
    primaryChoicesConfirmed,
    archivedLearningConfirmed,
    keepBanksAsIs,
  };
  const fresh =
    previewQuery.isFetchedAfterMount &&
    !previewQuery.isFetching &&
    !previewQuery.isError &&
    !needsRefresh;
  const valid =
    fresh &&
    !execute.isPending &&
    canExecuteAgentMerge(preview, sourceUserId, primary.id, review, now);
  const expired =
    preview &&
    (!Number.isFinite(Date.parse(preview.expiresAt)) ||
      Date.parse(preview.expiresAt) <= now);
  const pairMatches =
    preview?.source.id === sourceUserId && preview?.primary.id === primary.id;

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          Review merge into {primary.name ?? "Unnamed agent"} (#{primary.id})
        </h3>
        <Button
          size="sm"
          variant="outline"
          disabled={execute.isPending || previewQuery.isFetching}
          onClick={() => void refreshPreview()}
        >
          {previewQuery.isFetching ? "Loading preview…" : "Refresh preview"}
        </Button>
      </div>
      <div className="rounded-lg border p-3 text-sm">
        <div className="flex items-start gap-2">
          <Checkbox id="agent-merge-bank-as-is" checked={keepBanksAsIs}
            disabled={execute.isPending || previewQuery.isFetching}
            onCheckedChange={checked => { resetReview(); setKeepBanksAsIs(checked === true); }} />
          <Label htmlFor="agent-merge-bank-as-is" className="text-sm leading-5">
            Keep bank fields as-is — retain the primary's payout settings and preserve the duplicate's original bank fields in archived history, even if values differ or cannot be read.
          </Label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          No bank fields are edited, copied or cleared. This choice only removes bank-comparison blockers; other merge safeguards still apply. It does not verify a bank account or authorise a payment. Changing it loads a new preview and requires all confirmations again.
        </p>
      </div>
      {executionError && (
        <div
          role="alert"
          className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <p className="font-medium">
            Merge could not be completed: {executionError}
          </p>
          <p>
            Do not retry with the old token. Refresh the preview, resolve any
            blockers, and review all confirmations again.
          </p>
        </div>
      )}
      {previewQuery.isError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 p-3 text-sm"
        >
          <p>Unable to load merge preview: {previewQuery.error.message}</p>
          <p className="mt-1 text-muted-foreground">
            Use Refresh preview to retry. If the merge schema is pending, ask a
            SuperAdmin to complete the migration first. Merging is disabled.
          </p>
        </div>
      ) : previewQuery.isFetching || !previewQuery.isFetchedAfterMount ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading a fresh preview for this pair…
        </p>
      ) : !preview || !pairMatches ? (
        <p role="alert" className="text-sm text-destructive">
          No valid preview for this pair. Refresh preview before continuing.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <AccountSummary
              account={preview.source}
              title="SOURCE — duplicate to archive"
            />
            <AccountSummary
              account={preview.primary}
              title="PRIMARY — account to KEEP"
            />
          </div>
          <div className="rounded-lg border bg-muted/40 p-4 text-sm">
            <p className="font-semibold">What stays on the primary account</p>
            <p className="mt-1">
              The primary login, JLT ID, membership, contact details, payout
              bank details, permissions and settings are retained. Source values
              do not overwrite these choices. The primary’s existing Academy
              course and Action state is also kept; source completion does not
              complete or unlock overlapping primary learning. Review the
              primary membership, payout and contact details in its CRM record
              before confirming.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Blank bank fields do not block merging. An account-holder name alone
              is not a bank destination. Original bank fields are preserved as-is;
              the primary's fields are never overwritten by the merge.
            </p>
            <a
              className="mt-2 inline-block font-medium text-primary underline"
              href={`/crm/agents?agent=${primary.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Review primary CRM record in a new tab
            </a>
            <p className="mt-3 font-semibold">
              Archive, not delete — learning is not blended
            </p>
            <p className="mt-1">
              The duplicate is archived, not deleted. Its overlapping Academy
              courses, assessments and Actions stay preserved under the original
              identity as separate read-only history, not blended into primary
              progress. Unique course and Action records move with their existing
              progress as listed in the preview. Original-source summaries and
              provenance remain accessible in the read-only merge-history dialog.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <section className="rounded-lg border p-3 text-sm">
              <h4 className="font-semibold">Records moving to primary</h4>
              <ul className="mt-2 space-y-1">
                {preview.moves.map(move => (
                  <li key={move.table}>
                    {move.label}: <strong>{move.count}</strong>
                  </li>
                ))}
              </ul>
              {preview.moves.length === 0 && (
                <p className="mt-2 text-muted-foreground">
                  No records to move.
                </p>
              )}
            </section>
            <section className="rounded-lg border p-3 text-sm">
              <h4 className="font-semibold">Records retained on source</h4>
              <ul className="mt-2 space-y-2">
                {preview.retained.map(item => (
                  <li key={item.table}>
                    {item.label}: <strong>{item.count}</strong>
                    <p className="text-xs text-muted-foreground">
                      {item.reason}
                    </p>
                  </li>
                ))}
              </ul>
              {preview.retained.length === 0 && (
                <p className="mt-2 text-muted-foreground">
                  No retained activity listed.
                </p>
              )}
            </section>
          </div>
          {preview.blockers.length > 0 && (
            <section
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
            >
              <h4 className="font-semibold text-destructive">Merge blocked</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {preview.blockers.map((blocker, index) => (
                  <li key={index}>{blocker}</li>
                ))}
              </ul>
              <p className="mt-2">
                Resolve these blockers, then refresh the preview.
              </p>
            </section>
          )}
          {!preview.canMerge && preview.blockers.length === 0 && (
            <p role="alert" className="text-sm text-destructive">
              The server has not approved this pair for merging. Refresh the
              preview or contact support.
            </p>
          )}
          {preview.warnings.length > 0 && (
            <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <h4 className="font-semibold">
                Warnings — review before confirming
              </h4>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {preview.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </section>
          )}
          {(expired || needsRefresh) && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {expired
                ? "This preview has expired."
                : "A fresh preview is required."}{" "}
              Refresh the preview and review the confirmations again.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Preview expires: {formatMergeTimestamp(preview.expiresAt)}
          </p>
          <fieldset
            disabled={execute.isPending || !fresh || Boolean(expired)}
            className="space-y-4 disabled:opacity-60"
          >
            <legend className="mb-3 text-sm font-semibold">
              Required merge confirmations
            </legend>
            <div className="space-y-2">
              <Label htmlFor="agent-merge-reason">
                Reason for merging (at least 10 characters)
              </Label>
              <Textarea
                id="agent-merge-reason"
                value={reason}
                onChange={event => setReason(event.target.value)}
                maxLength={2000}
                placeholder="Explain how you verified this duplicate identity and the primary account choice."
              />
              <p className="text-xs text-muted-foreground">
                {reason.trim().length}/10 minimum characters. This reason
                becomes part of the immutable audit.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="agent-merge-same-person"
                checked={samePersonConfirmed}
                onCheckedChange={checked =>
                  setSamePersonConfirmed(checked === true)
                }
              />
              <Label
                htmlFor="agent-merge-same-person"
                className="text-sm leading-5"
              >
                I verified that both accounts belong to the same person.
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="agent-merge-primary-choices"
                checked={primaryChoicesConfirmed}
                onCheckedChange={checked =>
                  setPrimaryChoicesConfirmed(checked === true)
                }
              />
              <Label
                htmlFor="agent-merge-primary-choices"
                className="text-sm leading-5"
              >
                I reviewed the primary membership, payout bank and contact
                choices and confirm they should be retained, along with the
                primary’s existing Academy course and Action state.
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="agent-merge-archived-learning"
                checked={archivedLearningConfirmed}
                onCheckedChange={checked =>
                  setArchivedLearningConfirmed(checked === true)
                }
              />
              <Label
                htmlFor="agent-merge-archived-learning"
                className="text-sm leading-5"
              >
                I acknowledge that the duplicate’s overlapping Academy learning
                and Actions remain separate archived read-only history, not
                blended into the primary account, and have reviewed which
                non-overlapping records move.
              </Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-merge-confirmation">
                Type exactly{" "}
                <code className="select-all font-mono">
                  {expectedConfirmation}
                </code>
              </Label>
              <Input
                id="agent-merge-confirmation"
                value={confirmation}
                onChange={event => setConfirmation(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={expectedConfirmation}
              />
            </div>
          </fieldset>
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="text-xs text-muted-foreground">
          {execute.isPending
            ? "Merging and refreshing records. Keep this dialog open."
            : "All confirmations and a current, unblocked preview are required."}
        </p>
        <Button
          disabled={!valid}
          onClick={() => {
            // Date.now() catches expiration between rendering and clicking.
            if (
              !fresh ||
              execute.isPending ||
              !canExecuteAgentMerge(
                preview,
                sourceUserId,
                primary.id,
                review,
                Date.now()
              )
            )
              return;
            onPendingChange(true);
            execute.mutate({
              sourceUserId,
              primaryUserId: primary.id,
              previewToken: preview!.token,
              reason: reason.trim(),
              confirmation,
              samePersonConfirmed: true,
              primaryChoicesConfirmed: true,
              archivedLearningConfirmed: true,
              keepBanksAsIs,
            });
          }}
        >
          {execute.isPending
            ? "Merging…"
            : `Merge source #${sourceUserId} into #${primary.id}`}
        </Button>
      </div>
    </div>
  );
}
