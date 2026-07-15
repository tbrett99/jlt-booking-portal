import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Trophy, Ticket, Plus, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Competition {
  id: number;
  title: string;
  description: string | null;
  prizeDescription: string;
  startDate: Date | string;
  endDate: Date | string;
  status: "draft" | "active" | "closed";
}

interface LeaderboardEntry {
  rank: number;
  agentId: number;
  agentName: string;
  tickets: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function daysRemaining(endDate: Date | string) {
  const diff = new Date(endDate).getTime() - Date.now();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return days;
}

// ─── Entry status badge ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return (
    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1">
      <CheckCircle2 className="w-3 h-3" /> Approved
    </Badge>
  );
  if (status === "rejected") return (
    <Badge className="bg-red-100 text-red-700 border-red-200 gap-1">
      <XCircle className="w-3 h-3" /> Rejected
    </Badge>
  );
  return (
    <Badge className="bg-amber-100 text-amber-700 border-amber-200 gap-1">
      <Clock className="w-3 h-3" /> Pending
    </Badge>
  );
}

// ─── Submit Entry Dialog ──────────────────────────────────────────────────────

function SubmitEntryDialog({ competition, onSuccess }: { competition: Competition; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  const [date, setDate] = useState("");
  // toast imported from sonner at top of file
  const utils = trpc.useUtils();

  const submitEntry = trpc.competitions.submitEntry.useMutation({
    onSuccess: () => {
      toast.success("Entry submitted! Your booking reference has been submitted for verification.");
      setRef("");
      setDate("");
      setOpen(false);
      onSuccess();
      utils.competitions.myEntries.invalidate({ competitionId: competition.id });
      utils.competitions.getLeaderboard.invalidate({ competitionId: competition.id });
      utils.competitions.myTicketSummary.invalidate();
    },
    onError: (err) => {
      toast.error(`Could not submit entry: ${err.message}`);
    },
  });

  const startDate = new Date(competition.startDate).toISOString().split("T")[0];
  const endDate = new Date(competition.endDate).toISOString().split("T")[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="w-4 h-4" /> Submit Booking
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Submit a Booking Entry</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Enter your booking reference and the date the booking was made. Bookings must be dated between{" "}
          <strong>{formatDate(competition.startDate)}</strong> and{" "}
          <strong>{formatDate(competition.endDate)}</strong>.
        </p>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="ref">Booking Reference</Label>
            <Input
              id="ref"
              placeholder="e.g. EJ123456"
              value={ref}
              onChange={(e) => setRef(e.target.value.toUpperCase())}
              maxLength={100}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date">Date Booked</Label>
            <Input
              id="date"
              type="date"
              min={startDate}
              max={endDate}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            disabled={!ref.trim() || !date || submitEntry.isPending}
            onClick={() =>
              submitEntry.mutate({
                competitionId: competition.id,
                bookingReference: ref.trim(),
                bookingDate: new Date(date).toISOString(),
              })
            }
          >
            {submitEntry.isPending ? "Submitting…" : "Submit Entry"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Competition Tab ──────────────────────────────────────────────────────────

function CompetitionTab({ competition, currentUserId }: { competition: Competition; currentUserId: number }) {
  const { data: leaderboardData, refetch: refetchLeaderboard } = trpc.competitions.getLeaderboard.useQuery(
    { competitionId: competition.id }
  );
  const { data: myEntries, refetch: refetchEntries } = trpc.competitions.myEntries.useQuery(
    { competitionId: competition.id }
  );

  const days = daysRemaining(competition.endDate);
  const leaderboard: LeaderboardEntry[] = leaderboardData?.leaderboard ?? [];
  const myRank = leaderboard.find((e) => e.agentId === currentUserId);
  const myApproved = myEntries?.filter((e) => e.verifiedStatus === "approved").length ?? 0;
  const myPending = myEntries?.filter((e) => e.verifiedStatus === "pending").length ?? 0;

  const handleSuccess = () => {
    refetchLeaderboard();
    refetchEntries();
  };

  return (
    <div className="space-y-6">
      {/* Competition header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Trophy className="w-5 h-5 text-amber-500" />
            <span className="font-semibold text-lg">{competition.prizeDescription}</span>
          </div>
          {competition.description && (
            <p className="text-sm text-muted-foreground">{competition.description}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {formatDate(competition.startDate)} – {formatDate(competition.endDate)}
            {days > 0 ? (
              <span className="ml-2 text-amber-600 font-medium">· {days} day{days !== 1 ? "s" : ""} remaining</span>
            ) : (
              <span className="ml-2 text-muted-foreground">· Competition closed</span>
            )}
          </p>
        </div>
        {competition.status === "active" && days > 0 && (
          <SubmitEntryDialog competition={competition} onSuccess={handleSuccess} />
        )}
      </div>

      {/* My stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="bg-muted/40">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-primary">{myApproved}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Approved Tickets</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/40">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-amber-500">{myPending}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Pending</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/40">
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold">{myRank ? `#${myRank.rank}` : "—"}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Your Rank</div>
          </CardContent>
        </Card>
      </div>

      {/* Leaderboard */}
      <div>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" /> Leaderboard
        </h3>
        {leaderboard.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">
            No approved entries yet — be the first on the board!
          </div>
        ) : (
          <div className="space-y-2">
            {leaderboard.map((entry) => {
              const isMe = entry.agentId === currentUserId;
              return (
                <div
                  key={entry.agentId}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${
                    isMe
                      ? "bg-primary/10 border-primary/30 font-semibold"
                      : "bg-card border-border"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                        entry.rank === 1
                          ? "bg-amber-400 text-amber-900"
                          : entry.rank === 2
                          ? "bg-slate-300 text-slate-700"
                          : entry.rank === 3
                          ? "bg-orange-300 text-orange-800"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {entry.rank}
                    </span>
                    <span className="text-sm">
                      {entry.agentName}
                      {isMe && <span className="ml-1.5 text-xs text-primary">(you)</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm">
                    <Ticket className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>{entry.tickets} ticket{entry.tickets !== 1 ? "s" : ""}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* My entries */}
      {myEntries && myEntries.length > 0 && (
        <div>
          <Separator className="my-2" />
          <h3 className="font-semibold mb-3 mt-4 flex items-center gap-2">
            <Ticket className="w-4 h-4" /> My Submitted Entries
          </h3>
          <div className="space-y-2">
            {myEntries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between px-4 py-3 rounded-lg border bg-card text-sm">
                <div>
                  <span className="font-mono font-medium">{entry.bookingReference}</span>
                  <span className="text-muted-foreground ml-2">
                    booked {formatDate(entry.bookingDate)}
                  </span>
                  {entry.adminNotes && entry.verifiedStatus === "rejected" && (
                    <p className="text-xs text-red-600 mt-0.5 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {entry.adminNotes}
                    </p>
                  )}
                </div>
                <StatusBadge status={entry.verifiedStatus} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Competitions() {
  const { user } = useAuth();
  const { data: activeComps, isLoading } = trpc.competitions.listActive.useQuery();

  if (isLoading) {
    return (
      <div className="container py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (!activeComps || activeComps.length === 0) {
    return (
      <div className="container py-8">
        <div className="flex items-center gap-3 mb-6">
          <Trophy className="w-6 h-6 text-amber-500" />
          <h1 className="text-2xl font-bold">Competitions</h1>
        </div>
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Trophy className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No active competitions right now</p>
            <p className="text-sm mt-1">Check back soon — new incentives are on the way.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Trophy className="w-6 h-6 text-amber-500" />
        <h1 className="text-2xl font-bold">Competitions</h1>
        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
          {activeComps.length} Active
        </Badge>
      </div>

      {activeComps.length === 1 ? (
        <Card>
          <CardContent className="pt-6">
            <CompetitionTab competition={activeComps[0]} currentUserId={user?.id ?? 0} />
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue={String(activeComps[0].id)}>
          <TabsList className="mb-4 w-full">
            {activeComps.map((comp) => (
              <TabsTrigger key={comp.id} value={String(comp.id)} className="flex-1 truncate">
                {comp.title}
              </TabsTrigger>
            ))}
          </TabsList>
          {activeComps.map((comp) => (
            <TabsContent key={comp.id} value={String(comp.id)}>
              <Card>
                <CardContent className="pt-6">
                  <CompetitionTab competition={comp} currentUserId={user?.id ?? 0} />
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
