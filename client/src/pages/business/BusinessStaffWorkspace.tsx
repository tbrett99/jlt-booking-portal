import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { BookOpen, Building2, GraduationCap, PlayCircle } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import {
  readBusinessStaffPermissions,
} from "@shared/business-staff";
import { useBusinessStaffPortalAuthority } from "./BusinessStaffPortalLayout";

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

// This page contains content only; the authoritative root supplies the Portal
// shell. Its fresh query keeps loading, errors and revocation fail-closed.
export default function BusinessStaffWorkspace() {
  const { user } = useAuth();
  const rootAuthority = useBusinessStaffPortalAuthority();
  const standaloneMine = trpc.businessStaff.mine.useQuery(undefined, {
    enabled: !!user && !rootAuthority,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  // The root already checks this exact query before mounting the page. A second
  // enabled stale observer refetches on mount, which would unmount this page
  // again through the root's fetching guard and start an endless check loop.
  const mine = rootAuthority
    ? { ...standaloneMine, data: rootAuthority, error: null, isLoading: false, isFetching: false }
    : standaloneMine;
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
  const resources = permissions.resourceAccess;
  const shortcuts = [
    ...(permissions.viewBookings
      ? [
          {
            label: "My Bookings",
            href: "/my-bookings",
            icon: <BookOpen size={22} />,
            description:
              "Browse your business owner's bookings and view the latest booking details.",
          },
        ]
      : []),
    ...(permissions.academyAccess
      ? [
          {
            label: "JLT Academy",
            href: "/academy",
            icon: <GraduationCap size={22} />,
            description: "Continue your own enrolled courses and learning.",
          },
        ]
      : []),
    ...(resources
      ? [
          {
            label: "Knowledge Base",
            href: "/knowledge-base",
            icon: <BookOpen size={22} />,
            description:
              "Find useful guides and answers for your day-to-day work.",
          },
          {
            label: "Supplier Directory",
            href: "/suppliers",
            icon: <Building2 size={22} />,
            description: "Explore suppliers and find their contact details.",
          },
          {
            label: "Webinar Library",
            href: "/webinars",
            icon: <PlayCircle size={22} />,
            description: "Catch up on training and supplier webinars.",
          },
        ]
      : []),
  ];
  return (
    <div data-portal-route-content className="mx-auto max-w-6xl space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald-700">
          Your Portal
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {`Welcome${user?.name ? `, ${user.name.split(" ")[0]}` : " back"}`}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {authorised
            ? `Working with ${mine.data?.owner?.name || mine.data?.owner?.email || "your business owner"}. Use the normal booking pages for your assigned business bookings${permissions.manageBookings ? ", messages and requests" : " (read-only)"}. Commission claims remain with the business owner.`
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
          You do not currently have an active business-staff assignment. Contact
          a Super Admin if access is expected. This page does not provide an
          agent-portal fallback.
        </BusinessNotice>
      ) : (
        <>
              <section className="rounded-xl border border-[#a7f3e8] bg-[#f0fffb] p-6">
                <h2 className="text-xl font-semibold tracking-tight">
                  Everything you need, in one place
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Explore your assigned bookings and learning from the shortcuts
                  below.
                  {resources &&
                    " Your everyday resources and published PTS and card fees are also available in the sidebar."}
                </p>
              </section>
              <section
                aria-label="Portal shortcuts"
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                {shortcuts.map(shortcut => (
                  <Link
                    key={shortcut.href}
                    href={shortcut.href}
                    className="rounded-xl border bg-card p-5 text-card-foreground transition-colors hover:border-emerald-400 hover:bg-muted/20"
                  >
                    <span className="inline-flex rounded-lg bg-[#70FFE8]/15 p-2.5 text-emerald-700">
                      {shortcut.icon}
                    </span>
                    <h2 className="mt-4 font-semibold">{shortcut.label}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {shortcut.description}
                    </p>
                    <p className="mt-4 text-sm font-semibold text-emerald-700">
                      Explore →
                    </p>
                  </Link>
                ))}
              </section>
              {!permissions.viewBookings && (
                <BusinessNotice title="Booking access is not assigned">
                  Only the permissions explicitly assigned to your account are
                  available.
                </BusinessNotice>
              )}
          <p className="rounded-lg border bg-muted/30 px-4 py-3 text-xs leading-5 text-muted-foreground">
            Already have your own Orbit login? <a className="underline font-semibold" href="https://orbit.thejltgroup.co.uk" target="_blank" rel="noopener noreferrer">Continue to use it directly.</a>
            Portal single sign-on for business staff is currently unavailable.
            {mine.data?.membership?.orbitRequested &&
              " Orbit access request recorded; pending the Orbit team."}
          </p>
        </>
      )}
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
