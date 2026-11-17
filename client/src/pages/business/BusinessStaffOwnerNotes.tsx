import { useState } from "react";
import {
  businessBookingApi,
  BusinessNoteComposer,
  BusinessPagination,
  BusinessPlainNotes,
  BusinessQueryState,
  BusinessWithheldNotice,
} from "./BusinessStaffWorkspace";

/** Mount on an owner's non-personal BookingDetails; API verifies ownership again. */
export default function BusinessStaffOwnerNotes({
  bookingId,
}: {
  bookingId: number;
}) {
  // Remount when a detail page changes booking so a draft cannot cross channels.
  return <OwnerChannel key={bookingId} bookingId={bookingId} />;
}
function OwnerChannel({ bookingId }: { bookingId: number }) {
  const [page, setPage] = useState(1);
  const validId = Number.isSafeInteger(bookingId) && bookingId > 0;
  const notes = businessBookingApi.ownerNotes.useQuery(
    { bookingId, page, pageSize: 50 },
    { enabled: validId, retry: false }
  );
  const post = businessBookingApi.ownerAddNote.useMutation();
  const ready =
    validId && !notes.error && !notes.isLoading && !notes.isFetching;
  return (
    <section
      aria-label="Owner business-staff note channel"
      className="space-y-4 rounded-xl border bg-card p-5"
    >
      <header>
        <h2 className="text-lg font-semibold">Business-staff note channel</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          <strong>Staff-visible:</strong> notes posted here are shared with your
          authorised business staff. This is not the private legacy
          booking-notes area. Text is displayed literally, without embedded
          images, HTML or clickable links.
        </p>
      </header>
      <BusinessWithheldNotice />
      {!validId ? (
        <p role="alert" className="text-sm text-destructive">
          A valid booking is required.
        </p>
      ) : (
        <>
          <BusinessQueryState query={notes} empty={!notes.data?.items.length}>
            <BusinessPlainNotes notes={notes.data?.items ?? []} />
          </BusinessQueryState>
          <BusinessPagination
            page={page}
            hasMore={ready && notes.data?.hasMore}
            busy={!ready}
            onPage={setPage}
            label="Owner business-staff notes pagination"
          />
          {ready && (
            <BusinessNoteComposer
              mutation={post}
              bookingId={bookingId}
              onSaved={async () => {
                setPage(1);
                await notes.refetch();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
