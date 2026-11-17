import { useEffect, useId, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// This view intentionally deals only with recruitment linkage, not member,
// contract, invitation or payment administration. The server is authoritative.
type RecordedDate = Date | string | null;
interface SignupCandidate {
  joinSessionId: number;
  userId: number;
  signerName: string | null;
  agentName: string | null;
  signupEmail: string | null;
  agentEmail: string | null;
  jltId: string | null;
  contractSignedAt: RecordedDate;
  joiningFeePaidAt: RecordedDate;
  membershipTier: string | null;
  membershipType: string | null;
  linkedProspectId: number | null;
}

const greenButton = "bg-[#02E6D2] text-[#1a1a1a] hover:bg-[#02E6D2]/90";
const enquiryHref = (id: number) => `/crm/recruitment/${id}`;
function displayDate(value: RecordedDate) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : "Not recorded";
}
function readable(value: string | null | undefined) {
  return value?.replace(/_/g, " ") || "Not recorded";
}
function SignupIdentity({ signup }: { signup: SignupCandidate }) {
  return (
    <dl className="space-y-1 text-sm break-words">
      <div>
        <dt className="inline text-muted-foreground">Member: </dt>
        <dd className="inline">{signup.agentName || "Not recorded"}</dd>
      </div>
      <div>
        <dt className="inline text-muted-foreground">Contract signer: </dt>
        <dd className="inline">{signup.signerName || "Not recorded"}</dd>
      </div>
      <div>
        <dt className="inline text-muted-foreground">
          Signup / checkout email:{" "}
        </dt>
        <dd className="inline">{signup.signupEmail || "Not recorded"}</dd>
      </div>
      <div>
        <dt className="inline text-muted-foreground">Member account email: </dt>
        <dd className="inline">{signup.agentEmail || "Not recorded"}</dd>
      </div>
      <div>
        <dt className="inline text-muted-foreground">JLT ID: </dt>
        <dd className="inline">{signup.jltId || "Not recorded"}</dd>
      </div>
      <div>
        <dt className="inline text-muted-foreground">Contract signed: </dt>
        <dd className="inline">{displayDate(signup.contractSignedAt)}</dd>
      </div>
      <div>
        <dt className="inline text-muted-foreground">Joining fee recorded: </dt>
        <dd className="inline">
          {signup.joiningFeePaidAt ? "Yes (Portal record)" : "No Portal record"}
          {signup.joiningFeePaidAt &&
            ` — ${displayDate(signup.joiningFeePaidAt)}`}
        </dd>
      </div>
      <div>
        <dt className="inline text-muted-foreground">Membership: </dt>
        <dd className="inline">
          {readable(signup.membershipTier)} / {readable(signup.membershipType)}
        </dd>
      </div>
    </dl>
  );
}

export default function RecruitmentSignupLink({
  prospectId,
}: {
  prospectId: number;
}) {
  const utils = trpc.useUtils();
  const state = trpc.recruitment.signupLinkState.useQuery(
    { prospectId },
    {
      enabled: Number.isSafeInteger(prospectId) && prospectId > 0,
      staleTime: 0,
    }
  );
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState("");

  async function refreshCard() {
    setRefreshing(true);
    try {
      const result = await state.refetch();
      if (result.error || !result.data || (saved && !result.data.link)) {
        throw new Error("The current link could not be verified.");
      }
      setRefreshWarning("");
    } catch {
      setRefreshWarning(
        saved
          ? "Link saved, but the latest record could not be refreshed. Do not submit it again; refresh the link status."
          : "The current link could not be refreshed. Please retry."
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function onSaved() {
    // Close only after the mutation succeeds. Failed cache refreshes are not
    // reported as failed saves, and never offer another confirmation.
    setSaved(true);
    setOpen(false);
    setRefreshing(true);
    const results = await Promise.allSettled([
      utils.recruitment.getProspect.invalidate({ id: prospectId }),
      utils.recruitment.signupLinkState.invalidate({ prospectId }),
      utils.recruitment.stageCounts.invalidate(),
      utils.recruitment.listProspectsFiltered.invalidate(),
      utils.recruitment.listProspects.invalidate(),
      utils.recruitment.analytics.invalidate(),
    ]);
    let verified = false;
    try {
      const result = await state.refetch();
      verified = !result.error && !!result.data?.link;
    } catch {
      /* Saved is still true; show the refresh warning below. */
    }
    setRefreshing(false);
    setRefreshWarning(
      !verified || results.some(result => result.status === "rejected")
        ? "Link saved, but some views could not refresh. Do not submit it again; refresh the link status or reload this page."
        : ""
    );
  }

  const link = state.data?.link;
  const supersededBy = state.data?.supersededBy;
  return (
    <>
      <section
        aria-label="Completed signup link"
        className="rounded-xl border border-border bg-card p-4 text-sm"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h2 className="font-semibold text-foreground">Completed signup</h2>
            {supersededBy ? (
              <p>
                This enquiry was superseded.{" "}
                <Link
                  className="text-[#0d6b5e] underline"
                  href={enquiryHref(supersededBy.prospectId)}
                >
                  Open original enquiry #{supersededBy.prospectId}
                </Link>{" "}
                to view the link and recruitment correspondence.
              </p>
            ) : state.isLoading ? (
              <p role="status" className="text-muted-foreground">
                Loading signup link…
              </p>
            ) : state.error ? (
              <p role="alert" className="text-destructive">
                Could not load signup link: {state.error.message}
              </p>
            ) : link ? (
              <div className="space-y-1 break-words">
                <p>
                  <span className="font-medium text-[#0d6b5e]">
                    Linked member:{" "}
                  </span>
                  <Link
                    className="underline"
                    href={`/crm/agents?agent=${link.userId}`}
                  >
                    {link.agentName || "View member"}
                    {link.jltId ? ` (${link.jltId})` : ""}
                  </Link>
                </p>
                <p className="text-muted-foreground">
                  Signup email: {link.signupEmail || "Not recorded"} · Member
                  email: {link.agentEmail || "Not recorded"}
                </p>
                <p className="text-muted-foreground">
                  Linked by {link.linkedByName || "Not recorded"} ·{" "}
                  {displayDate(link.linkedAt)} · Won:{" "}
                  {displayDate(link.conversionAt)}
                </p>
                <p className="whitespace-pre-wrap">Reason: {link.reason}</p>
                {link.supersededProspectId && (
                  <p>
                    Verified duplicate archived:{" "}
                    <Link
                      className="underline"
                      href={enquiryHref(link.supersededProspectId)}
                    >
                      Enquiry #{link.supersededProspectId}
                    </Link>
                  </p>
                )}
                <p className="text-muted-foreground">
                  Original enquiry email, source and recruitment correspondence
                  remain on this enquiry.
                </p>
              </div>
            ) : saved ? (
              <p role="status">
                Link saved.{" "}
                {refreshing
                  ? "Refreshing the current record…"
                  : "Refresh link status to view the member."}
              </p>
            ) : (
              <p className="max-w-2xl text-muted-foreground">
                Signed up using a different email? Manually link a completed
                signup to this original enquiry after checking both identities.
                The enquiry email and correspondence stay unchanged.
              </p>
            )}
          </div>
          {!supersededBy &&
            !link &&
            !saved &&
            !state.error &&
            !state.isLoading && (
              <Button
                size="sm"
                variant="outline"
                className="border-[#70FFE8] text-[#0d6b5e]"
                onClick={() => setOpen(true)}
              >
                Link completed signup
              </Button>
            )}
          {(state.error || saved || refreshWarning) && !supersededBy && (
            <Button
              size="sm"
              variant="outline"
              disabled={refreshing}
              onClick={() => void refreshCard()}
            >
              {refreshing ? "Refreshing…" : "Refresh link status"}
            </Button>
          )}
        </div>
        {refreshWarning && (
          <p role="alert" className="mt-3 text-destructive">
            {refreshWarning}
          </p>
        )}
      </section>
      {open && (
        <SignupLinkDialog
          key={prospectId}
          prospectId={prospectId}
          onClose={() => setOpen(false)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

function SignupLinkDialog({
  prospectId,
  onClose,
  onSaved,
}: {
  prospectId: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const searchId = useId();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [cursors, setCursors] = useState<Array<number | undefined>>([
    undefined,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<SignupCandidate | null>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const searchQuery = trpc.recruitment.searchCompletedSignups.useQuery(
    {
      search,
      ...(cursors[pageIndex] === undefined
        ? {}
        : { cursor: cursors[pageIndex] }),
    },
    {
      enabled: search.length >= 2 && search.length <= 150,
      staleTime: 0,
      placeholderData: undefined,
    }
  );

  function resetSelection() {
    setSelected(null);
    setSelectionRevision(value => value + 1);
  }
  // A rejected/refetching search must not leave a previously selected candidate
  // actionable. Search edits and pagination reset synchronously below as well.
  useEffect(() => {
    if (!pendingRef.current && (searchQuery.error || searchQuery.isFetching))
      resetSelection();
  }, [searchQuery.error, searchQuery.isFetching]);

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    if (pendingRef.current) return;
    const term = draft.trim();
    resetSelection();
    setCursors([undefined]);
    setPageIndex(0);
    setSearch(term.length >= 2 && term.length <= 150 ? term : "");
    if (term === search && pageIndex === 0 && term.length >= 2)
      void searchQuery.refetch();
  }
  function changePage(nextIndex: number, nextCursor?: number) {
    if (pendingRef.current) return;
    resetSelection();
    if (nextCursor !== undefined)
      setCursors(current => [...current.slice(0, nextIndex), nextCursor]);
    setPageIndex(nextIndex);
  }
  const hasResults =
    search.length >= 2 &&
    !searchQuery.isFetching &&
    !searchQuery.error &&
    searchQuery.data;
  return (
    <Dialog
      open
      onOpenChange={value => {
        if (!value && !pendingRef.current) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
        showCloseButton={!pending}
        onEscapeKeyDown={event => {
          if (pendingRef.current) event.preventDefault();
        }}
        onInteractOutside={event => {
          if (pendingRef.current) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Link a completed signup</DialogTitle>
          <DialogDescription>
            Find a signed signup with a recorded joining-fee payment. This is a
            Portal record, not a new provider settlement check. A matching name
            or email is not proof that two records are the same person.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submitSearch} className="space-y-2">
          <label htmlFor={searchId} className="text-sm font-medium">
            Search by full name, email or JLT ID
          </label>
          <div className="flex gap-2">
            <Input
              id={searchId}
              value={draft}
              maxLength={150}
              disabled={pending}
              placeholder="Name, checkout email or JLT ID"
              autoComplete="off"
              onChange={event => {
                if (pendingRef.current) return;
                setDraft(event.target.value);
                setSearch("");
                setCursors([undefined]);
                setPageIndex(0);
                resetSelection();
              }}
            />
            <Button
              type="submit"
              size="sm"
              disabled={
                pending || draft.trim().length < 2 || draft.trim().length > 150
              }
            >
              Search
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Enter 2–150 characters, then select Search. Full names can include
            spaces. Only completed signups are searched; no member directory is
            loaded.
          </p>
        </form>
        {search.length >= 2 && searchQuery.isFetching && (
          <p role="status" className="text-sm text-muted-foreground">
            Searching completed signups…
          </p>
        )}
        {search.length >= 2 && searchQuery.error && (
          <div role="alert" className="space-y-2 text-sm">
            <p className="text-destructive">
              Search failed: {searchQuery.error.message}
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                resetSelection();
                void searchQuery.refetch();
              }}
            >
              Retry search
            </Button>
          </div>
        )}
        {hasResults && (
          <div className="space-y-3">
            {searchQuery.data.items.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">
                No completed signups found. Try a different name, email or JLT
                ID.
              </p>
            ) : (
              <ul
                aria-label="Completed signups"
                className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2"
              >
                {searchQuery.data.items.map((signup: SignupCandidate) => {
                  const linkedElsewhere =
                    signup.linkedProspectId !== null &&
                    signup.linkedProspectId !== prospectId;
                  const chosen =
                    selected?.joinSessionId === signup.joinSessionId;
                  return (
                    <li
                      key={signup.joinSessionId}
                      className={`rounded-md border p-3 ${chosen ? "border-[#02E6D2] bg-[#70FFE8]/10" : "border-border"}`}
                    >
                      <SignupIdentity signup={signup} />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending || linkedElsewhere}
                          aria-pressed={chosen}
                          onClick={() => {
                            if (pendingRef.current) return;
                            setSelected(signup);
                            setSelectionRevision(value => value + 1);
                          }}
                        >
                          {chosen ? "Selected" : "Review signup"}
                        </Button>
                        {linkedElsewhere && (
                          <span className="text-xs text-muted-foreground">
                            Already linked to another enquiry.{" "}
                            <Link
                              className="underline"
                              href={enquiryHref(signup.linkedProspectId!)}
                            >
                              Open enquiry #{signup.linkedProspectId}
                            </Link>
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <nav
              aria-label="Signup results pages"
              className="flex items-center justify-between gap-2 text-sm"
            >
              <Button
                size="sm"
                variant="outline"
                disabled={pending || pageIndex === 0}
                onClick={() => changePage(pageIndex - 1)}
              >
                Previous
              </Button>
              <span>Page {pageIndex + 1} · up to 30 signups per page</span>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  pending ||
                  !searchQuery.data.hasMore ||
                  searchQuery.data.nextCursor == null
                }
                onClick={() => {
                  if (searchQuery.data?.nextCursor != null)
                    changePage(pageIndex + 1, searchQuery.data.nextCursor);
                }}
              >
                Next
              </Button>
            </nav>
          </div>
        )}
        {selected && (
          <SignupLinkReview
            key={`${prospectId}:${selected.joinSessionId}:${selectionRevision}`}
            prospectId={prospectId}
            selected={selected}
            pendingRef={pendingRef}
            pending={pending}
            setPending={setPending}
            onSaved={onSaved}
          />
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (!pendingRef.current) onClose();
            }}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SignupLinkReview({
  prospectId,
  selected,
  pendingRef,
  pending,
  setPending,
  onSaved,
}: {
  prospectId: number;
  selected: SignupCandidate;
  pendingRef: React.MutableRefObject<boolean>;
  pending: boolean;
  setPending: (pending: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const checkboxId = useId();
  const reasonId = useId();
  const preview = trpc.recruitment.previewSignupLink.useQuery(
    { prospectId, joinSessionId: selected.joinSessionId },
    {
      enabled: true,
      gcTime: 0,
      staleTime: 0,
      refetchOnMount: "always",
      placeholderData: undefined,
    }
  );
  const confirm = trpc.recruitment.confirmSignupLink.useMutation();
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [invalidated, setInvalidated] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const [now, setNow] = useState(Date.now());
  const data = preview.data;
  const expiry = data ? new Date(data.expiresAt).getTime() : NaN;
  const identityMatches =
    !!data &&
    data.prospect.id === prospectId &&
    data.signup.joinSessionId === selected.joinSessionId &&
    data.signup.userId === selected.userId &&
    (data.signup.linkedProspectId === null ||
      data.signup.linkedProspectId === prospectId);
  const expired = !Number.isFinite(expiry) || expiry <= now;
  const validPreview =
    identityMatches &&
    !preview.error &&
    !preview.isFetching &&
    !preview.isLoading &&
    !refreshing &&
    !invalidated &&
    !expired &&
    !!data?.token &&
    !data.alreadyLinked;
  const validReason = reason.trim().length >= 5 && reason.length <= 1000;

  useEffect(() => {
    setChecked(false);
    setNow(Date.now());
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, expiry - Date.now()) + 1
    );
    return () => clearTimeout(timer);
  }, [expiry, preview.dataUpdatedAt]);

  async function refreshPreview() {
    if (pendingRef.current || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setChecked(false);
    setInvalidated(true);
    setError("");
    try {
      const result = await preview.refetch();
      if (!result.error) setInvalidated(false);
    } catch {
      setError("Could not refresh the preview. Please retry.");
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
      setNow(Date.now());
    }
  }

  async function save() {
    // Synchronous ref guards protect even two clicks before React re-renders.
    // Recheck expiry here as background tabs may delay the display timer.
    if (
      pendingRef.current ||
      refreshingRef.current ||
      !validPreview ||
      !checked ||
      !validReason ||
      !data ||
      new Date(data.expiresAt).getTime() <= Date.now()
    )
      return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const result = await confirm.mutateAsync({
        prospectId,
        joinSessionId: selected.joinSessionId,
        token: data.token,
        reason: reason.trim(),
        samePersonConfirmed: true,
      });
      if (!result.linked)
        throw new Error("The server did not confirm a saved link.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The link could not be saved. Please retry after refreshing the preview."
      );
      setInvalidated(true);
      setChecked(false);
      pendingRef.current = false;
      setPending(false);
      return;
    }
    // Cache work is separate from mutation failure: never encourage re-saving
    // when the server has already committed the link.
    await onSaved();
    pendingRef.current = false;
  }

  return (
    <section
      aria-label="Review signup link"
      className="space-y-3 border-t pt-4"
    >
      <h3 className="text-sm font-semibold">Review both records</h3>
      {(preview.isLoading || preview.isFetching || refreshing) && (
        <p role="status" className="text-sm text-muted-foreground">
          Checking the current records…
        </p>
      )}
      {preview.error && (
        <p role="alert" className="text-sm text-destructive">
          Cannot link these records: {preview.error.message}
        </p>
      )}
      {data &&
        !preview.error &&
        !preview.isFetching &&
        !refreshing &&
        (identityMatches ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-muted/30 p-3">
                <h4 className="mb-2 text-sm font-semibold">
                  Original enquiry #{data.prospect.id}
                </h4>
                <dl className="space-y-1 text-sm break-words">
                  <div>
                    <dt className="inline text-muted-foreground">Name: </dt>
                    <dd className="inline">{data.prospect.name}</dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">
                      Enquiry email (unchanged):{" "}
                    </dt>
                    <dd className="inline">{data.prospect.email}</dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">
                      Current stage:{" "}
                    </dt>
                    <dd className="inline">
                      {readable(data.prospect.pipelineStage)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">
                      Historical source:{" "}
                    </dt>
                    <dd className="inline">{readable(data.prospect.source)}</dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">
                      How heard:{" "}
                    </dt>
                    <dd className="inline">
                      {readable(data.prospect.howHeard)}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <h4 className="mb-2 text-sm font-semibold">
                  Selected signed signup / member
                </h4>
                <SignupIdentity signup={data.signup} />
              </div>
            </div>
            <div className="space-y-1 rounded-lg border border-[#70FFE8]/50 bg-[#70FFE8]/10 p-3 text-sm">
              <p>
                This original enquiry will be marked <strong>Won</strong> and
                linked to the existing member. Conversion date:{" "}
                {displayDate(data.conversionAt)}.
              </p>
              <p>
                The original enquiry email, historical source and correspondence
                are preserved. Old recruitment follow-ups are cancelled.
              </p>
              {data.duplicate ? (
                <p>
                  Verified automatic duplicate{" "}
                  <Link
                    className="underline"
                    href={enquiryHref(data.duplicate.id)}
                  >
                    #{data.duplicate.id} — {data.duplicate.name}
                  </Link>{" "}
                  ({data.duplicate.email};{" "}
                  {readable(data.duplicate.pipelineStage)}) will be archived,
                  not deleted.
                </p>
              ) : (
                <p>No verified automatic duplicate will be archived.</p>
              )}
              <p>
                No emails are sent and no welcome email is resent. Signing,
                account email, payment and mandate details are not changed.
              </p>
            </div>
            {data.alreadyLinked && (
              <p role="status" className="text-sm">
                This signup is already linked to this enquiry. Cancel and
                refresh the link status; no new confirmation is needed.
              </p>
            )}
            {expired && !data.alreadyLinked && (
              <p role="alert" className="text-sm text-destructive">
                This preview has expired. Refresh it and check the records
                again.
              </p>
            )}
            {!expired && (
              <p className="text-xs text-muted-foreground">
                Preview valid until {displayDate(data.expiresAt)} (10-minute
                validity). The server rechecks identity and eligibility when you
                confirm.
              </p>
            )}
          </>
        ) : (
          <p role="alert" className="text-sm text-destructive">
            The preview does not match the selected enquiry and signup
            identities. Confirmation is blocked. Refresh the preview or select
            the correct record.
          </p>
        ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Link not saved: {error} Your reason is retained. Refresh the preview
          and check the records again before retrying.
        </p>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || preview.isFetching || refreshing}
        onClick={() => void refreshPreview()}
      >
        Refresh preview
      </Button>
      <fieldset disabled={pending} className="space-y-3">
        <div className="flex items-start gap-2">
          <input
            id={checkboxId}
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[#0d6b5e]"
            checked={checked}
            disabled={!validPreview || pending}
            onChange={event => {
              if (!pendingRef.current) setChecked(event.target.checked);
            }}
          />
          <label htmlFor={checkboxId} className="text-sm">
            I have checked that these records are the same person
          </label>
        </div>
        <div className="space-y-1">
          <label htmlFor={reasonId} className="text-sm font-medium">
            Reason for linking (required)
          </label>
          <Textarea
            id={reasonId}
            value={reason}
            maxLength={1000}
            minLength={5}
            rows={3}
            readOnly={pending}
            onChange={event => {
              if (!pendingRef.current) setReason(event.target.value);
            }}
            placeholder="Record the identity checks and why the signup belongs to this enquiry."
            aria-describedby={`${reasonId}-help`}
          />
          <p id={`${reasonId}-help`} className="text-xs text-muted-foreground">
            5–1,000 characters. Do not include bank or payment details.{" "}
            {reason.length}/1,000
          </p>
        </div>
      </fieldset>
      <Button
        type="button"
        className={greenButton}
        disabled={pending || !validPreview || !checked || !validReason}
        onClick={() => void save()}
      >
        {pending ? "Linking…" : "Confirm link and mark Won"}
      </Button>
    </section>
  );
}
