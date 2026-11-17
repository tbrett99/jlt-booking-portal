import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { businessStaffRouter } from "../../../../server/business-staff-management-router";
import {
  BUSINESS_STAFF_PERMISSION_KEYS,
  BUSINESS_STAFF_PERMISSION_LABELS,
  BUSINESS_STAFF_ORBIT_NOTICE,
  DEFAULT_BUSINESS_STAFF_PERMISSIONS,
  readBusinessStaffPermissions,
  type BusinessStaffPermissions,
} from "@shared/business-staff";
import {
  BusinessField,
  BusinessMutationError,
  BusinessNotice,
  BusinessPagination,
  BusinessQueryState,
  businessControl,
} from "./BusinessStaffWorkspace";

type ManagementOutputs = inferRouterOutputs<typeof businessStaffRouter>;
type ManagementInputs = inferRouterInputs<typeof businessStaffRouter>;
type Member = ManagementOutputs["adminList"]["items"][number];
type Person = ManagementOutputs["searchOwners"]["items"][number];

export function BusinessPermissionEditor({
  value,
  onChange,
  disabled,
}: {
  value: BusinessStaffPermissions;
  onChange: (value: BusinessStaffPermissions) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="mb-3 text-sm font-semibold">Staff permissions</legend>
      {BUSINESS_STAFF_PERMISSION_KEYS.map(key => (
        <label key={key} className="flex items-start gap-3 text-sm leading-6">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-emerald-700"
            checked={value[key]}
            disabled={
              (key === "viewCustomerAmounts" || key === "addBookingNotes") &&
              !value.viewBookings
            }
            onChange={event =>
              onChange(
                readBusinessStaffPermissions({
                  ...value,
                  [key]: event.target.checked,
                })
              )
            }
          />
          <span>{BUSINESS_STAFF_PERMISSION_LABELS[key]}</span>
        </label>
      ))}
      <p className="text-xs leading-5 text-muted-foreground">
        Customer amounts and note posting require booking visibility. Academy
        access uses this person's own enrolments.
      </p>
    </fieldset>
  );
}
export function BusinessOrbitRequest({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <label className="flex items-start gap-3 text-sm">
        <input
          className="mt-1 size-4 accent-emerald-700"
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={event => onChange(event.target.checked)}
        />
        <span>Request Orbit business-staff access (request only)</span>
      </label>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {BUSINESS_STAFF_ORBIT_NOTICE} Pending the Orbit team; this request does
        not enable Orbit or owner SSO.
      </p>
    </div>
  );
}
export function BusinessClassification({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
      <p className="text-sm leading-6">
        <strong>Staff-only classification — not an account merge.</strong> This
        person retains their own login, but the account becomes business staff
        only. It does not create membership billing, an agent CRM profile, or
        share the owner's identity. Existing fees and account history are not
        edited here.
      </p>
      <label className="mt-3 flex items-start gap-3 text-sm leading-6">
        <input
          type="checkbox"
          className="mt-1 size-4"
          checked={checked}
          disabled={disabled}
          onChange={event => onChange(event.target.checked)}
        />
        <span>
          I explicitly confirm this account should be classified as business
          staff only.
        </span>
      </label>
    </div>
  );
}
export default function AdminBusinessStaff() {
  const { user } = useAuth();
  if (user?.role !== "admin" && user?.role !== "super_admin")
    return (
      <BusinessNotice title="Administrator access required">
        Business-staff management is restricted to administrators.
      </BusinessNotice>
    );
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <ShieldCheck size={19} />
          Restricted business access
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Business staff
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          Choose a business owner first, then link an existing account or create
          a separate staff login. Every change requires an audit reason. Revoke
          access rather than deleting a person or merging accounts.
        </p>
      </header>
      <AdminManagement />
    </div>
  );
}
export function privateSetupUrl(value: string) {
  try {
    const url = new URL(value, window.location.origin);
    if (
      url.origin !== window.location.origin ||
      url.pathname !== "/reset-password" ||
      !url.searchParams.get("token") ||
      url.hash
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
function AdminManagement() {
  const [owner, setOwner] = useState<Person | null>(null);
  const [ownerDraft, setOwnerDraft] = useState("");
  const [ownerSearch, setOwnerSearch] = useState("");
  const [ownerPage, setOwnerPage] = useState(1);
  const owners = trpc.businessStaff.searchOwners.useQuery(
    { search: ownerSearch, page: ownerPage, pageSize: 25 },
    { enabled: ownerSearch.length >= 2, retry: false }
  );
  const [secret, setSecret] = useState<string | null>(null);
  const [secretError, setSecretError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const showSecret = (value: string) => {
    setSecret(privateSetupUrl(value));
    setCopied(false);
    setSecretError(
      privateSetupUrl(value)
        ? ""
        : "The setup link was not a valid portal reset link. Do not share it; request a fresh link."
    );
  };
  return (
    <>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">1. Choose the business owner</h2>
        <form
          className="flex items-end gap-3"
          onSubmit={event => {
            event.preventDefault();
            if (ownerDraft.trim().length < 2) return;
            setOwner(null);
            setOwnerPage(1);
            setOwnerSearch(ownerDraft.trim());
          }}
        >
          <div className="flex-1">
            <BusinessField label="Search business owners">
              <input
                className={businessControl}
                value={ownerDraft}
                maxLength={100}
                onChange={event => setOwnerDraft(event.target.value)}
                placeholder="Name or email (at least 2 characters)"
              />
            </BusinessField>
          </div>
          <Button type="submit" disabled={ownerDraft.trim().length < 2}>
            Find owner
          </Button>
        </form>
        {ownerSearch.length >= 2 && !owner && (
          <>
            <BusinessQueryState
              query={owners}
              empty={!owners.data?.items.length}
            >
              <Table>
                <TableCaption>
                  Eligible owners matching your explicit search.
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Name</TableHead>
                    <TableHead scope="col">Email</TableHead>
                    <TableHead scope="col">Choose</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {owners.data?.items.map(person => (
                    <TableRow key={person.id}>
                      <TableCell>
                        {person.name || `Owner #${person.id}`}
                      </TableCell>
                      <TableCell>{person.email}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Choose owner ${person.id}`}
                          onClick={() => setOwner(person)}
                        >
                          Choose owner
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </BusinessQueryState>
            <BusinessPagination
              page={ownerPage}
              hasMore={!owners.error && owners.data?.hasMore}
              busy={owners.isLoading || owners.isFetching || !!owners.error}
              onPage={setOwnerPage}
              label="Owner search pagination"
            />
          </>
        )}
        {owner && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-4">
            <div>
              <p className="font-semibold">
                {owner.name || `Owner #${owner.id}`}
              </p>
              <p className="text-sm text-muted-foreground">
                {owner.email} · Account #{owner.id}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setOwner(null);
                setSecret(null);
              }}
            >
              Change owner
            </Button>
          </div>
        )}
        {!owner && !ownerSearch && (
          <p className="text-sm text-muted-foreground">
            No agent directory is loaded. Search for and explicitly choose an
            owner to continue.
          </p>
        )}
      </section>
      {owner && (
        <OwnerManagement key={owner.id} owner={owner} onSecret={showSecret} />
      )}
      {secretError && !secret && (
        <p role="alert" className="text-sm text-destructive">
          {secretError}
        </p>
      )}
      <Dialog
        open={!!secret || copied}
        onOpenChange={open => {
          if (!open) {
            setSecret(null);
            setCopied(false);
            setSecretError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Private staff password setup link</DialogTitle>
            <DialogDescription>
              Shown once in this session. Share privately with the staff member.
              It expires in one hour; nothing is emailed automatically. Issuing
              another link invalidates earlier unused links.
            </DialogDescription>
          </DialogHeader>
          {secret && (
            <>
              <BusinessField label="Private setup link">
                <input className={businessControl} readOnly value={secret} />
              </BusinessField>
              <Button
                disabled={copying}
                onClick={async () => {
                  if (!secret) return;
                  setCopying(true);
                  setSecretError("");
                  try {
                    await navigator.clipboard.writeText(secret);
                    setSecret(null);
                    setCopied(true);
                  } catch {
                    setSecretError(
                      "Clipboard access failed. Copy the displayed link manually, then dismiss this dialog."
                    );
                  } finally {
                    setCopying(false);
                  }
                }}
              >
                {copying ? "Copying…" : "Copy private link once"}
              </Button>
            </>
          )}
          {copied && (
            <p role="status" className="text-sm text-emerald-700">
              Copied. The private link is no longer displayed.
            </p>
          )}
          {secretError && (
            <p role="alert" className="text-sm text-destructive">
              {secretError}
            </p>
          )}
          <Button
            variant="outline"
            onClick={() => {
              setSecret(null);
              setCopied(false);
              setSecretError("");
            }}
          >
            Dismiss private link
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OwnerManagement({
  owner,
  onSecret,
}: {
  owner: Person;
  onSecret: (url: string) => void;
}) {
  const [page, setPage] = useState(1);
  // adminList's search supports exact owner account IDs; filter projection too.
  const members = trpc.businessStaff.adminList.useQuery(
    { page, pageSize: 25, search: String(owner.id) },
    { retry: false }
  );
  const [editing, setEditing] = useState<{
    member: Member;
    mode: "permissions" | "status" | "setup";
  } | null>(null);
  const [notice, setNotice] = useState("");
  const refresh = async () => {
    await members.refetch();
  };
  const visible =
    members.data?.items.filter(member => member.ownerUserId === owner.id) ?? [];
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">
          Staff for {owner.name || `owner #${owner.id}`}
        </h2>
        {notice && (
          <p role="status" className="text-sm text-emerald-700">
            {notice}
          </p>
        )}
        <BusinessQueryState query={members} empty={!visible.length}>
          <Table>
            <TableCaption>
              Business-staff memberships for the chosen owner.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Staff account</TableHead>
                <TableHead scope="col">Status / revision</TableHead>
                <TableHead scope="col">Permissions</TableHead>
                <TableHead scope="col">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map(member => (
                <TableRow key={member.id}>
                  <TableCell>
                    <p className="font-medium">
                      {member.staff.name || `Staff #${member.staffUserId}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {member.staff.email}
                    </p>
                  </TableCell>
                  <TableCell>
                    {member.status} · v{member.revision}
                    <p className="text-xs text-muted-foreground">
                      Orbit:{" "}
                      {member.orbitRequested
                        ? "requested, pending"
                        : "not requested"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <ul className="max-w-56 whitespace-normal text-xs leading-5">
                      {BUSINESS_STAFF_PERMISSION_KEYS.filter(
                        key => member.permissions[key]
                      ).map(key => (
                        <li key={key}>
                          {BUSINESS_STAFF_PERMISSION_LABELS[key]}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setEditing({ member, mode: "permissions" })
                        }
                      >
                        Adjust permissions
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing({ member, mode: "status" })}
                      >
                        {member.status === "active"
                          ? "Revoke access"
                          : "Reactivate access"}
                      </Button>
                      {member.status === "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing({ member, mode: "setup" })}
                        >
                          Create setup link
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </BusinessQueryState>
        <BusinessPagination
          page={page}
          hasMore={!members.error && members.data?.hasMore}
          busy={members.isLoading || members.isFetching || !!members.error}
          onPage={setPage}
          label="Staff memberships pagination"
        />
        <Button variant="outline" onClick={() => void refresh()}>
          Refresh memberships
        </Button>
        <BusinessNotice title="Orbit requests remain pending">
          {BUSINESS_STAFF_ORBIT_NOTICE}
        </BusinessNotice>
      </section>
      <NewStaffForm
        owner={owner}
        onSaved={async (message, setupUrl) => {
          setNotice(message);
          if (setupUrl) onSecret(setupUrl);
          setPage(1);
          await refresh();
        }}
      />
      <Dialog
        open={!!editing}
        onOpenChange={open => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editing?.mode === "permissions"
                ? "Adjust staff permissions"
                : editing?.mode === "setup"
                  ? "Create private setup link"
                  : editing?.member.status === "active"
                    ? "Revoke staff access"
                    : "Reactivate staff access"}
            </DialogTitle>
            <DialogDescription>
              Explicit audited action for{" "}
              {editing?.member.staff.name || editing?.member.staff.email}.
              Revision {editing?.member.revision}. Account history and fees
              remain unchanged.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <EditMembership
              key={`${editing.member.id}-${editing.mode}`}
              member={editing.member}
              mode={editing.mode}
              onSaved={async setupUrl => {
                setEditing(null);
                setNotice("Staff membership updated.");
                if (setupUrl) onSecret(setupUrl);
                await refresh();
              }}
              onRefresh={async () => {
                setEditing(null);
                await refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewStaffForm({
  owner,
  onSaved,
}: {
  owner: Person;
  onSaved: (message: string, setupUrl?: string) => Promise<void>;
}) {
  const [tab, setTab] = useState("existing");
  const [accountDraft, setAccountDraft] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [accountPage, setAccountPage] = useState(1);
  const [account, setAccount] = useState<Person | null>(null);
  const accounts = trpc.businessStaff.searchAccounts.useQuery(
    { search: accountSearch, page: accountPage, pageSize: 25 },
    { enabled: tab === "existing" && accountSearch.length >= 2, retry: false }
  );
  const link = trpc.businessStaff.linkExisting.useMutation();
  const create = trpc.businessStaff.createStaff.useMutation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [permissions, setPermissions] = useState<BusinessStaffPermissions>({
    ...DEFAULT_BUSINESS_STAFF_PERMISSIONS,
  });
  const [orbitRequested, setOrbitRequested] = useState(false);
  const [classified, setClassified] = useState(false);
  const [preserve, setPreserve] = useState(false);
  const [reason, setReason] = useState("");
  const busy = link.isPending || create.isPending;
  const valid =
    classified &&
    preserve &&
    reason.trim().length >= 10 &&
    (tab === "existing"
      ? !!account &&
        account.id !== owner.id &&
        !accounts.error &&
        !accounts.isLoading &&
        !accounts.isFetching
      : name.trim().length >= 2 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
  const reset = () => {
    setAccount(null);
    setAccountDraft("");
    setAccountSearch("");
    setName("");
    setEmail("");
    setPermissions({ ...DEFAULT_BUSINESS_STAFF_PERMISSIONS });
    setOrbitRequested(false);
    setClassified(false);
    setPreserve(false);
    setReason("");
  };
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">2. Add business staff</h2>
      <Tabs
        value={tab}
        onValueChange={value => {
          if (!busy) {
            setTab(value);
            link.reset();
            create.reset();
            setClassified(false);
            setPreserve(false);
          }
        }}
      >
        <TabsList aria-label="Add staff method">
          <TabsTrigger value="existing" disabled={busy}>
            Link existing
          </TabsTrigger>
          <TabsTrigger value="create" disabled={busy}>
            Create staff
          </TabsTrigger>
        </TabsList>
        <TabsContent value="existing" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Select a separate eligible existing login. This does not merge
            records.
          </p>
          <form
            className="space-y-3"
            onSubmit={event => {
              event.preventDefault();
              if (accountDraft.trim().length < 2) return;
              setAccount(null);
              setAccountPage(1);
              setAccountSearch(accountDraft.trim());
            }}
          >
            <BusinessField label="Search existing accounts">
              <input
                className={businessControl}
                maxLength={100}
                disabled={busy}
                value={accountDraft}
                onChange={event => setAccountDraft(event.target.value)}
              />
            </BusinessField>
            <Button
              variant="outline"
              type="submit"
              disabled={busy || accountDraft.trim().length < 2}
            >
              Find existing account
            </Button>
          </form>
          {accountSearch.length >= 2 && (
            <>
              <BusinessQueryState
                query={accounts}
                empty={
                  !accounts.data?.items.filter(person => person.id !== owner.id)
                    .length
                }
              >
                <div className="max-h-52 space-y-2 overflow-y-auto">
                  {accounts.data?.items
                    .filter(person => person.id !== owner.id)
                    .map(person => (
                      <label
                        key={person.id}
                        className="flex items-start gap-2 rounded-lg border p-3 text-sm"
                      >
                        <input
                          type="radio"
                          name="existing-staff-account"
                          disabled={busy}
                          className="mt-1"
                          checked={account?.id === person.id}
                          onChange={() => {
                            setAccount(person);
                            setClassified(false);
                            setPreserve(false);
                          }}
                        />
                        <span>
                          {person.name || `Account #${person.id}`}
                          <span className="block text-xs text-muted-foreground">
                            {person.email} · #{person.id}
                          </span>
                        </span>
                      </label>
                    ))}
                </div>
              </BusinessQueryState>
              <BusinessPagination
                page={accountPage}
                hasMore={!accounts.error && accounts.data?.hasMore}
                busy={
                  busy ||
                  accounts.isLoading ||
                  accounts.isFetching ||
                  !!accounts.error
                }
                onPage={page => {
                  setAccount(null);
                  setAccountPage(page);
                }}
                label="Existing accounts pagination"
              />
            </>
          )}
          {account && (
            <p className="text-sm font-medium">
              Selected staff: {account.name || account.email} · Account #
              {account.id}
            </p>
          )}
        </TabsContent>
        <TabsContent value="create" className="space-y-3">
          <p className="text-sm leading-6 text-muted-foreground">
            Creates this person's own password login. No membership billing or
            agent CRM profile is created. A private password setup link is
            returned once; no automatic email is sent.
          </p>
          <BusinessField label="New staff name">
            <input
              className={businessControl}
              maxLength={255}
              value={name}
              disabled={busy}
              onChange={event => setName(event.target.value)}
            />
          </BusinessField>
          <BusinessField label="New staff email">
            <input
              className={businessControl}
              type="email"
              maxLength={320}
              value={email}
              disabled={busy}
              onChange={event => setEmail(event.target.value)}
            />
          </BusinessField>
        </TabsContent>
      </Tabs>
      <form
        className="space-y-4"
        onSubmit={async event => {
          event.preventDefault();
          if (!valid || busy) return;
          const shared = {
            ownerUserId: owner.id,
            permissions,
            orbitRequested,
            reason: reason.trim(),
            restrictedStaffOnlyConfirmed: true as const,
            preserveExistingDataConfirmed: true as const,
          };
          try {
            if (tab === "existing" && account) {
              const input: ManagementInputs["linkExisting"] = {
                ...shared,
                staffUserId: account.id,
              };
              await link.mutateAsync(input);
              reset();
              await onSaved("Existing account linked as business staff only.");
            } else if (tab === "create") {
              const input: ManagementInputs["createStaff"] = {
                ...shared,
                name: name.trim(),
                email: email.trim().toLowerCase(),
              };
              const result = await create.mutateAsync(input);
              reset();
              await onSaved(
                "Separate staff login created. No email was sent.",
                result.setupUrl
              );
            }
          } catch {
            /* Keep the draft and surface tRPC errors. */
          }
        }}
      >
        <BusinessPermissionEditor
          value={permissions}
          onChange={setPermissions}
          disabled={busy}
        />
        <BusinessOrbitRequest
          checked={orbitRequested}
          onChange={setOrbitRequested}
          disabled={busy}
        />
        <BusinessClassification
          checked={classified}
          onChange={setClassified}
          disabled={busy}
        />
        <label className="flex items-start gap-3 text-sm leading-6">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={preserve}
            disabled={busy}
            onChange={event => setPreserve(event.target.checked)}
          />
          <span>
            I confirm existing fees, bookings, records and history must be
            preserved without edits or account merging.
          </span>
        </label>
        <BusinessField label="Audit reason (at least 10 characters)">
          <textarea
            className={businessControl}
            maxLength={1000}
            rows={3}
            value={reason}
            disabled={busy}
            onChange={event => setReason(event.target.value)}
          />
        </BusinessField>
        <BusinessMutationError
          error={tab === "existing" ? link.error : create.error}
        />
        <Button type="submit" disabled={!valid || busy}>
          {busy
            ? "Saving…"
            : tab === "existing"
              ? "Confirm link existing account"
              : "Confirm create staff login"}
        </Button>
      </form>
    </section>
  );
}

function EditMembership({
  member,
  mode,
  onSaved,
  onRefresh,
}: {
  member: Member;
  mode: "permissions" | "status" | "setup";
  onSaved: (url?: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [permissions, setPermissions] = useState(
    readBusinessStaffPermissions(member.permissions)
  );
  const [orbitRequested, setOrbitRequested] = useState(member.orbitRequested);
  const [reason, setReason] = useState("");
  const update = trpc.businessStaff.updatePermissions.useMutation();
  const status = trpc.businessStaff.setStatus.useMutation();
  const setup = trpc.businessStaff.createSetupLink.useMutation();
  const mutation =
    mode === "permissions" ? update : mode === "status" ? status : setup;
  const busy = update.isPending || status.isPending || setup.isPending;
  return (
    <form
      className="space-y-4"
      onSubmit={async event => {
        event.preventDefault();
        if (reason.trim().length < 10 || busy) return;
        const shared = {
          membershipId: member.membershipId,
          revision: member.revision,
          reason: reason.trim(),
        };
        try {
          if (mode === "permissions") {
            await update.mutateAsync({
              ...shared,
              permissions,
              orbitRequested,
            });
            await onSaved();
          } else if (mode === "status") {
            await status.mutateAsync({
              ...shared,
              status: member.status === "active" ? "revoked" : "active",
            });
            await onSaved();
          } else {
            const result = await setup.mutateAsync(shared);
            await onSaved(result.setupUrl);
          }
        } catch {
          /* Preserve the reason and permission draft for review. */
        }
      }}
    >
      {mode === "permissions" ? (
        <>
          <BusinessPermissionEditor
            value={permissions}
            onChange={setPermissions}
            disabled={busy}
          />
          <BusinessOrbitRequest
            checked={orbitRequested}
            onChange={setOrbitRequested}
            disabled={busy}
          />
        </>
      ) : mode === "status" ? (
        <p className="text-sm leading-6">
          {member.status === "active"
            ? "Revocation stops access but retains the permanent staff-only classification, account and history. It does not restore the agent portal."
            : "Reactivation requires the server to recheck the owner and staff account eligibility. The retained staff-only identity remains unchanged."}
        </p>
      ) : (
        <p className="text-sm leading-6">
          Generate a one-hour private password setup link for this staff
          member's own login. Earlier unused links are invalidated. No automatic
          email is sent.
        </p>
      )}
      <BusinessField label="Audit reason (at least 10 characters)">
        <textarea
          className={businessControl}
          maxLength={1000}
          rows={3}
          value={reason}
          disabled={busy}
          onChange={event => setReason(event.target.value)}
        />
      </BusinessField>
      <BusinessMutationError error={mutation.error} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={reason.trim().length < 10 || busy}>
          {busy
            ? "Saving…"
            : mode === "permissions"
              ? "Confirm permission changes"
              : mode === "setup"
                ? "Confirm create private link"
                : member.status === "active"
                  ? "Confirm revoke access"
                  : "Confirm reactivate access"}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          type="button"
          onClick={() => void onRefresh()}
        >
          Discard draft and refresh
        </Button>
      </div>
    </form>
  );
}
