import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Search, ChevronRight } from "lucide-react";
import { format } from "date-fns";

const STAGES = [
  "New Booking",
  "Creating own PTS file",
  "Not on Topdog",
  "Query",
  "Reimb Docs Missing",
  "Urgent/Reimb",
  "T/O Package",
  "DP",
  "Added to PTS",
  "Commission Claimable",
  "Commission Claimed",
  "Cancelled",
  "Holding Accounts",
];

const STAGE_COLORS: Record<string, { bg: string; border: string; dot: string }> = {
  "New Booking": { bg: "#eff6ff", border: "#bfdbfe", dot: "#3b82f6" },
  "Creating own PTS file": { bg: "#eef2ff", border: "#c7d2fe", dot: "#6366f1" },
  "Not on Topdog": { bg: "#fff7ed", border: "#fed7aa", dot: "#f97316" },
  "Query": { bg: "#fefce8", border: "#fef08a", dot: "#eab308" },
  "Reimb Docs Missing": { bg: "#fef2f2", border: "#fecaca", dot: "#ef4444" },
  "Urgent/Reimb": { bg: "#fff1f2", border: "#fecdd3", dot: "#e11d48" },
  "T/O Package": { bg: "#faf5ff", border: "#e9d5ff", dot: "#a855f7" },
  "DP": { bg: "#fdf2f8", border: "#f5d0fe", dot: "#d946ef" },
  "Added to PTS": { bg: "#f0fdf4", border: "#bbf7d0", dot: "#22c55e" },
  "Commission Claimable": { bg: "#ecfdf5", border: "#70FFE8", dot: "#02E6D2" },
  "Commission Claimed": { bg: "#d1fae5", border: "#6ee7b7", dot: "#059669" },
  "Cancelled": { bg: "#f9fafb", border: "#e5e7eb", dot: "#9ca3af" },
  "Holding Accounts": { bg: "#fffbeb", border: "#fde68a", dot: "#d97706" },
};

export default function AdminKanban() {
  const [search, setSearch] = useState("");
  const [movingId, setMovingId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const { data: bookings = [], isLoading } = trpc.bookings.all.useQuery({});
  const moveStage = trpc.bookings.moveStage.useMutation({
    onSuccess: () => {
      utils.bookings.all.invalidate();
      setMovingId(null);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to move booking");
      setMovingId(null);
    },
  });

  const handleMove = async (bookingId: number, newStage: string) => {
    setMovingId(bookingId);
    moveStage.mutate({ bookingId, toStage: newStage });
  };

  const filtered = bookings.filter((b) =>
    !search ||
    b.clientName.toLowerCase().includes(search.toLowerCase()) ||
    (b.topdogRef ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (b.ptsRef ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const byStage = STAGES.reduce<Record<string, typeof bookings>>((acc, stage) => {
    acc[stage] = filtered.filter((b) => b.currentStage === stage);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">Booking Pipeline</h1>
          <p className="text-sm text-muted-foreground">{bookings.length} total bookings</p>
        </div>
        <div className="relative sm:ml-auto sm:w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by client, Topdog ref, PTS ref..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: '#70FFE8' }} />
        </div>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-4 min-w-max">
            {STAGES.map((stage) => {
              const cols = byStage[stage] ?? [];
              const colors = STAGE_COLORS[stage] ?? { bg: "#f9fafb", border: "#e5e7eb", dot: "#9ca3af" };
              return (
                <div
                  key={stage}
                  className="w-72 flex-shrink-0 rounded-xl border-2 overflow-hidden"
                  style={{ background: colors.bg, borderColor: colors.border }}
                >
                  {/* Column header */}
                  <div className="px-3 py-2.5 border-b" style={{ borderColor: colors.border }}>
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: colors.dot }} />
                      <span className="text-xs font-semibold text-foreground">{stage}</span>
                      <span className="ml-auto text-xs font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: colors.dot + '30', color: colors.dot }}>
                        {cols.length}
                      </span>
                    </div>
                  </div>

                  {/* Cards */}
                  <div className="p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-280px)] overflow-y-auto">
                    {cols.map((booking) => (
                      <div
                        key={booking.id}
                        className="bg-white rounded-lg border p-3 shadow-sm hover:shadow-md transition-shadow"
                        style={{ borderColor: colors.border }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{booking.clientName}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {format(new Date(booking.departureDate), "dd MMM yyyy")}
                            </p>
                            {booking.topdogRef && (
                              <p className="text-xs text-muted-foreground">TD: {booking.topdogRef}</p>
                            )}
                            {booking.ptsRef && (
                              <p className="text-xs text-muted-foreground">PTS: {booking.ptsRef}</p>
                            )}
                            {booking.reimbursementsRequired && !booking.reimbursementDocUrl && (
                              <span className="inline-block mt-1 text-xs px-1.5 py-0.5 rounded"
                                style={{ background: '#fee2e2', color: '#991b1b' }}>
                                Docs missing
                              </span>
                            )}
                          </div>
                          <Link href={`/bookings/${booking.id}`}>
                            <button className="p-1 rounded hover:bg-muted flex-shrink-0">
                              <ChevronRight size={14} className="text-muted-foreground" />
                            </button>
                          </Link>
                        </div>

                        {/* Move to stage */}
                        <div className="mt-2 pt-2 border-t" style={{ borderColor: colors.border }}>
                          <select
                            className="w-full text-xs border rounded px-2 py-1 bg-white cursor-pointer"
                            value={booking.currentStage}
                            disabled={movingId === booking.id}
                            onChange={(e) => handleMove(booking.id, e.target.value)}
                          >
                            {STAGES.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                    {cols.length === 0 && (
                      <div className="flex items-center justify-center h-20">
                        <p className="text-xs text-muted-foreground">No bookings</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
