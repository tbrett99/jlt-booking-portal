import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { BookOpen, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
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
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import {
  BUSINESS_STAFF_ORBIT_NOTICE,
  readBusinessStaffPermissions,
  type BusinessStaffPermissions,
} from "@shared/business-staff";

export const businessControl =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary";

export function BusinessField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function BusinessNotice({
  title,
  children,
  retry,
}: {
  title: string;
  children?: ReactNode;
  retry?: () => unknown;
}) {
  return (
    <section className="rounded-xl border bg-card p-5 text-card-foreground">
      <h2 className="font-semibold">{title}</h2>
      {children && (
        <div className="mt-2 text-sm leading-6 text-muted-foreground">
          {children}
        </div>
      )}
      {retry && (
        <Button className="mt-4" variant="outline" onClick={() => void retry()}>
          Try again
        </Button>
      )}
    </section>
  );
}
export type BusinessQuery<T> = {
  data?: T;
  isLoading: boolean;
  isFetching?: boolean;
  error: { message: string } | null;
  refetch: () => unknown;
};
export function BusinessQueryState({
  query,
  empty,
  children,
}: {
  query: BusinessQuery<unknown>;
  empty?: boolean;
  children: ReactNode;
}) {
  if (query.error)
    return (
      <BusinessNotice title="Records could not be loaded" retry={query.refetch}>
        {query.error.message}
      </BusinessNotice>
    );
  if (query.isLoading || query.isFetching)
    return (
      <p role="status" className="py-6 text-sm text-muted-foreground">
        Loading records…
      </p>
    );
  if (empty)
    return (
      <BusinessNotice title="No matching records">
        Try another search or select another page.
      </BusinessNotice>
    );
  return <>{children}</>;
}
export function BusinessMutationError({
  error,
}: {
  error?: { message: string } | null;
}) {
  return error ? (
    <p
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      {error.message} Your draft is retained. If access or the revision changed,
      refresh the record before trying again.
    </p>
  ) : null;
}
export function BusinessPagination({
  page,
  totalPages,
  hasMore,
  busy,
  onPage,
  label = "Records pagination",
}: {
  page: number;
  totalPages?: number;
  hasMore?: boolean;
  busy?: boolean;
  onPage: (page: number) => void;
  label?: string;
}) {
  return (
    <nav
      aria-label={label}
      className="flex items-center justify-between gap-3 pt-4"
    >
      <Button
        variant="outline"
        disabled={busy || page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </Button>
      <span className="text-sm text-muted-foreground" aria-live="polite">
        Page {page}
        {totalPages !== undefined ? ` of ${Math.max(1, totalPages)}` : ""}
      </span>
      <Button
        variant="outline"
        disabled={
          busy || (totalPages !== undefined ? page >= totalPages : !hasMore)
        }
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}
type ApiOutputs = inferRouterOutputs<AppRouter>;
type ApiInputs = inferRouterInputs<AppRouter>;
export type BusinessNote =
  ApiOutputs["businessBookings"]["listNotes"]["items"][number];
export function BusinessPlainNotes({ notes }: { notes: BusinessNote[] }) {
  return (
    <ol aria-label="Business-staff notes" className="space-y-3">
      {notes.map(note => (
        <li key={note.id} className="rounded-lg border bg-card p-4">
          <p className="whitespace-pre-wrap break-words text-sm">{note.text}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Channel member #{note.authorUserId} ·{" "}
            {new Date(note.createdAt).toLocaleString()}
          </p>
        </li>
      ))}
    </ol>
  );
}
export function BusinessWithheldNotice() {
  return (
    <p className="rounded-lg border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
      Legacy booking notes and documents are withheld pending classification.
      This separate plain-text channel is visible to the business owner and
      authorised business staff.
    </p>
  );
}
export type BusinessStaffAuthority = ApiOutputs["businessStaff"]["mine"];

// The authority lookup never falls back to the agent portal or changes identity.
export default function BusinessStaffWorkspace() {
  const { user, logout } = useAuth();
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const mine = trpc.businessStaff.mine.useQuery(undefined, {
    enabled: !!user,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const authorised =
    !!user &&
    !mine.error &&
    !mine.isLoading &&
    !mine.isFetching &&
    mine.data?.managed === true &&
    mine.data.active === true &&
    !!mine.data.membership;
  const permissions = readBusinessStaffPermissions(
    authorised ? mine.data?.membership?.permissions : null
  );
  return (
    <div className="min-h-screen bg-background text-foreground md:grid md:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="border-b bg-card px-5 py-6 md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="text-emerald-700" size={22} />
          JLT Business Staff
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Your own login · restricted business access
        </p>
        <nav
          aria-label="Business-staff navigation"
          className="mt-6 flex flex-col gap-2"
        >
          <Link
            href="/business-staff"
            className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"
          >
            Workspace
          </Link>
          {permissions.academyAccess && (
            <Link
              href="/academy"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted"
            >
              <BookOpen size={16} />
              My Academy
            </Link>
          )}
        </nav>
        <Button
          className="mt-6 w-full"
          variant="outline"
          disabled={loggingOut}
          onClick={async () => {
            setLoggingOut(true);
            setLogoutError("");
            try {
              await logout();
            } catch {
              setLogoutError("Sign out failed. Please try again.");
            } finally {
              setLoggingOut(false);
            }
          }}
        >
          <LogOut size={16} />
          {loggingOut ? "Signing out…" : "Sign out"}
        </Button>
        {logoutError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {logoutError}
          </p>
        )}
      </aside>
      <main data-portal-route-content className="min-w-0 p-5 md:p-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <header>
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald-700">
              Separate identity, scoped access
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Business-staff workspace
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {authorised
                ? `Working with ${mine.data?.owner?.name || mine.data?.owner?.email || "your business owner"}.`
                : "Your assignment is checked before any business records are loaded."}
            </p>
          </header>
          {mine.error ? (
            <BusinessNotice
              title="Business-staff access could not be checked"
              retry={mine.refetch}
            >
              {mine.error.message} Business records remain unavailable.
            </BusinessNotice>
          ) : mine.isLoading || mine.isFetching ? (
            <p role="status">Checking your business-staff access…</p>
          ) : !authorised ? (
            <BusinessNotice
              title={
                mine.data?.managed && !mine.data.active
                  ? "Business-staff access revoked or inactive"
                  : "Business-staff access denied"
              }
            >
              You do not currently have an active business-staff assignment.
              Contact a Super Admin if access is expected. This page does not
              provide an agent-portal fallback.
            </BusinessNotice>
          ) : (
            <>
              <BusinessNotice title="Orbit access is not ready">
                {BUSINESS_STAFF_ORBIT_NOTICE}
                {mine.data?.membership?.orbitRequested && (
                  <p className="mt-2">
                    Request recorded only; pending the Orbit team. No owner
                    sign-in or SSO is available.
                  </p>
                )}
              </BusinessNotice>
              {permissions.academyAccess && (
                <BusinessNotice title="Your own Academy learning">
                  Use My Academy for your own enrolled courses. Existing
                  enrolment and course-access rules still apply.
                </BusinessNotice>
              )}
              {permissions.viewBookings ? (
                <BusinessBookingsWorkspace permissions={permissions} />
              ) : (
                <BusinessNotice title="Booking access is not assigned">
                  Only the permissions explicitly assigned to your account are
                  available.
                </BusinessNotice>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export type BusinessMutation<Input, Output> = {
  mutateAsync: (input: Input) => Promise<Output>;
  isPending: boolean;
  error: { message: string } | null;
  reset: () => void;
};
export type BusinessBooking = ApiOutputs["businessBookings"]["detail"];
type NoteInput = ApiInputs["businessBookings"]["addNote"];
export const businessBookingApi = trpc.businessBookings;

export function BusinessNoteComposer({
  mutation,
  bookingId,
  onSaved,
}: {
  mutation: BusinessMutation<NoteInput, { success: true; noteId: number }>;
  bookingId: number;
  onSaved: () => Promise<unknown> | unknown;
}) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async event => {
        event.preventDefault();
        if (!text.trim() || text.trim().length > 2000 || mutation.isPending)
          return;
        setSaved(false);
        try {
          await mutation.mutateAsync({ bookingId, text: text.trim() });
          setText("");
          setSaved(true);
          await onSaved();
        } catch {
          /* The mutation reports failure and retains the draft. */
        }
      }}
    >
      <BusinessField label="New business-staff note">
        <textarea
          className={businessControl}
          value={text}
          rows={4}
          maxLength={2000}
          disabled={mutation.isPending}
          onChange={event => {
            setText(event.target.value);
            setSaved(false);
          }}
        />
      </BusinessField>
      <p className="text-xs text-muted-foreground">
        Plain text only · maximum 2,000 characters · visible to the business
        owner and authorised staff. Do not post private financial or account
        details.
      </p>
      <BusinessMutationError error={mutation.error} />
      {saved && (
        <p role="status" className="text-sm text-emerald-700">
          Note posted to the business-staff channel.
        </p>
      )}
      <Button
        disabled={
          !text.trim() || text.trim().length > 2000 || mutation.isPending
        }
        type="submit"
      >
        {mutation.isPending ? "Posting…" : "Post note"}
      </Button>
    </form>
  );
}
function formatDate(value: string | Date | null) {
  return value ? new Date(value).toLocaleDateString() : "Not recorded";
}
function customerPrice(booking: BusinessBooking) {
  return "grossPrice" in booking
    ? (booking.grossPrice ?? "Not available")
    : "Not available";
}
function BusinessBookingsWorkspace({
  permissions,
}: {
  permissions: BusinessStaffPermissions;
}) {
  const [page, setPage] = useState(1);
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [bookingId, setBookingId] = useState<number | null>(null);
  const list = businessBookingApi.list.useQuery(
    { page, pageSize: 50, ...(search ? { search } : {}) },
    { retry: false }
  );
  const usable = !list.error && !list.isLoading && !list.isFetching;
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Business bookings</h2>
      <p className="text-sm text-muted-foreground">
        Read-only non-personal bookings for your assigned owner.
      </p>
      <form
        className="flex items-end gap-3"
        onSubmit={event => {
          event.preventDefault();
          setPage(1);
          setSearch(draftSearch.trim());
          setBookingId(null);
        }}
      >
        <div className="flex-1">
          <BusinessField label="Search business bookings">
            <input
              className={businessControl}
              maxLength={100}
              value={draftSearch}
              onChange={event => setDraftSearch(event.target.value)}
              placeholder="Customer, destination or reference"
            />
          </BusinessField>
        </div>
        <Button type="submit">Search bookings</Button>
      </form>
      <BusinessQueryState query={list} empty={!list.data?.items.length}>
        <Table>
          <TableCaption>
            Assigned business bookings; personal bookings are excluded.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Customer</TableHead>
              <TableHead scope="col">Destination</TableHead>
              <TableHead scope="col">Departure</TableHead>
              <TableHead scope="col">Reference</TableHead>
              <TableHead scope="col">Stage</TableHead>
              {permissions.viewCustomerAmounts && (
                <TableHead scope="col">Customer selling price</TableHead>
              )}
              <TableHead scope="col">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usable &&
              list.data?.items.map(booking => (
                <TableRow key={booking.id}>
                  <TableCell>{booking.clientName}</TableCell>
                  <TableCell>{booking.destination || "Not recorded"}</TableCell>
                  <TableCell>{formatDate(booking.departureDate)}</TableCell>
                  <TableCell>
                    {booking.topdogRef ||
                      booking.ptsRef ||
                      booking.crmRef ||
                      `#${booking.id}`}
                  </TableCell>
                  <TableCell>{booking.currentStage}</TableCell>
                  {permissions.viewCustomerAmounts && (
                    <TableCell>{customerPrice(booking)}</TableCell>
                  )}
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`View booking ${booking.id}`}
                      onClick={() => setBookingId(booking.id)}
                    >
                      View details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </BusinessQueryState>
      <BusinessPagination
        page={page}
        hasMore={usable && list.data?.hasMore}
        busy={!usable}
        onPage={setPage}
        label="Business bookings pagination"
      />
      <BusinessWithheldNotice />
      <Dialog
        open={bookingId !== null}
        onOpenChange={open => {
          if (!open) setBookingId(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Business booking #{bookingId}</DialogTitle>
            <DialogDescription>
              Read-only booking details and the separate staff-visible note
              channel.
            </DialogDescription>
          </DialogHeader>
          {bookingId !== null && usable && (
            <BusinessBookingDetail
              key={bookingId}
              bookingId={bookingId}
              permissions={permissions}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
function BusinessBookingDetail({
  bookingId,
  permissions,
}: {
  bookingId: number;
  permissions: BusinessStaffPermissions;
}) {
  const detail = businessBookingApi.detail.useQuery(
    { bookingId },
    { retry: false }
  );
  const [page, setPage] = useState(1);
  const detailReady =
    !detail.error && !detail.isLoading && !detail.isFetching && !!detail.data;
  const notes = businessBookingApi.listNotes.useQuery(
    { bookingId, page, pageSize: 50 },
    { enabled: detailReady, retry: false }
  );
  const addNote = businessBookingApi.addNote.useMutation();
  return (
    <BusinessQueryState query={detail}>
      <div className="space-y-5">
        {detailReady && detail.data && (
          <dl className="grid grid-cols-2 gap-4 text-sm">
            {[
              ["Customer", detail.data.clientName],
              ["Destination", detail.data.destination],
              ["Departure", formatDate(detail.data.departureDate)],
              ["Booked", formatDate(detail.data.bookedDate)],
              ["Passengers", detail.data.passengers],
              ["Nights", detail.data.numberOfNights],
              ["Stage", detail.data.currentStage],
              ["Topdog reference", detail.data.topdogRef],
              ["PTS reference", detail.data.ptsRef],
              ["CRM reference", detail.data.crmRef],
              ...(permissions.viewCustomerAmounts
                ? [["Customer selling price", customerPrice(detail.data)]]
                : []),
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words font-medium">
                  {value ?? "Not recorded"}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <BusinessWithheldNotice />
        <h3 className="font-semibold">Business-staff notes</h3>
        <BusinessQueryState query={notes} empty={!notes.data?.items.length}>
          <BusinessPlainNotes notes={notes.data?.items ?? []} />
        </BusinessQueryState>
        <BusinessPagination
          page={page}
          hasMore={!notes.error && notes.data?.hasMore}
          busy={notes.isLoading || notes.isFetching || !!notes.error}
          onPage={setPage}
          label="Booking notes pagination"
        />
        {detailReady &&
          !notes.error &&
          !notes.isLoading &&
          !notes.isFetching &&
          permissions.addBookingNotes && (
            <BusinessNoteComposer
              mutation={addNote}
              bookingId={bookingId}
              onSaved={async () => {
                setPage(1);
                await notes.refetch();
              }}
            />
          )}
      </div>
    </BusinessQueryState>
  );
}
