import { trpc } from "@/lib/trpc";
import BusinessStaffOwnerNotes from "./BusinessStaffOwnerNotes";
/** Caller is the current booking owner; server endpoints independently recheck it. */
export default function BusinessStaffOwnerPanel({ bookingId }: { bookingId: number }) {
  const summary = trpc.businessStaff.ownerSummary.useQuery(undefined, {
    retry: false, staleTime: 0, refetchOnWindowFocus: true,
  });
  if (summary.isLoading || summary.isFetching || summary.error || !summary.data?.hasStaff) return null;
  return <BusinessStaffOwnerNotes bookingId={bookingId} />;
}
