import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Mail, Clock, UserX, Filter, RefreshCw, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const TIER_LABELS: Record<string, string> = {
  business_class: "Business Class",
  first_class: "First Class",
  charter: "Charter",
};

const TIER_COLOURS: Record<string, string> = {
  business_class: "bg-blue-100 text-blue-800",
  first_class: "bg-purple-100 text-purple-800",
  charter: "bg-amber-100 text-amber-800",
};

const STEP_COLOURS: Record<string, string> = {
  "Reached contract step": "bg-yellow-100 text-yellow-800",
  "Reached payment step": "bg-orange-100 text-orange-800",
  "Contract signed — payment pending": "bg-orange-200 text-orange-900",
  "Paid — awaiting account creation": "bg-green-100 text-green-800",
  "Started application": "bg-gray-100 text-gray-700",
};

export default function AbandonedSignups() {
  const [minDaysIdle, setMinDaysIdle] = useState(0);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"daysIdle" | "daysAgo" | "tier">("daysAgo");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [nudgingSessions, setNudgingSessions] = useState<Set<number>>(new Set());
  const [nudgedSessions, setNudgedSessions] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; email: string } | null>(null);
  const utils = trpc.useUtils();
  const deleteSession = trpc.join.deleteJoinSession.useMutation({
    onSuccess: () => {
      toast.success(`Session for ${deleteTarget?.email ?? "entry"} deleted`);
      setDeleteTarget(null);
      utils.join.getAbandonedSessions.invalidate();
    },
    onError: (e) => { toast.error(e.message); setDeleteTarget(null); },
  });

  const { data: sessions = [], isLoading, refetch } = trpc.join.getAbandonedSessions.useQuery(
    { daysIdle: minDaysIdle },
    { refetchOnWindowFocus: false }
  );

  const sendNudge = trpc.join.sendNudge.useMutation({
    onSuccess: (data, variables) => {
      toast.success(`Nudge email sent to ${data.email}`);
      setNudgingSessions((prev) => { const s = new Set(prev); s.delete(variables.sessionId); return s; });
      setNudgedSessions((prev) => new Set(prev).add(variables.sessionId));
    },
    onError: (err, variables) => {
      toast.error(err.message || "Failed to send nudge");
      setNudgingSessions((prev) => { const s = new Set(prev); s.delete(variables.sessionId); return s; });
    },
  });

  const handleNudge = (sessionId: number) => {
    setNudgingSessions((prev) => new Set(prev).add(sessionId));
    sendNudge.mutate({ sessionId });
  };

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir("desc"); }
  };

  const filtered = sessions
    .filter((s) => {
      if (search && !s.email.toLowerCase().includes(search.toLowerCase())) return false;
      if (tierFilter !== "all" && s.membershipTier !== tierFilter) return false;
      return true;
    })
    .sort((a, b) => {
      let diff = 0;
      if (sortBy === "daysIdle") diff = a.daysIdle - b.daysIdle;
      else if (sortBy === "daysAgo") diff = a.daysAgo - b.daysAgo;
      else if (sortBy === "tier") diff = (a.membershipTier ?? "").localeCompare(b.membershipTier ?? "");
      return sortDir === "asc" ? diff : -diff;
    });

  const SortIcon = ({ col }: { col: typeof sortBy }) =>
    sortBy === col ? (sortDir === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : null;

  // Summary stats
  const totalAbandoned = sessions.length;
  const abandonedToday = sessions.filter((s) => s.daysAgo === 0).length;
  const abandonedThisWeek = sessions.filter((s) => s.daysAgo <= 7).length;
  const reachedPayment = sessions.filter((s) => s.step === "payment" || s.contractSignedAt).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Abandoned Sign-Ups</h1>
        <p className="text-sm text-muted-foreground mt-1">
          People who started the join process but haven't completed it — send them a nudge to bring them back.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{totalAbandoned}</div>
            <div className="text-xs text-muted-foreground mt-1">Total abandoned</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-amber-600">{abandonedToday}</div>
            <div className="text-xs text-muted-foreground mt-1">Started today</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-blue-600">{abandonedThisWeek}</div>
            <div className="text-xs text-muted-foreground mt-1">Last 7 days</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600">{reachedPayment}</div>
            <div className="text-xs text-muted-foreground mt-1">Reached payment</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-muted-foreground" />
            <CardTitle className="text-base">Filters</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Search email</label>
              <Input
                placeholder="e.g. anna@..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-52"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Membership tier</label>
              <Select value={tierFilter} onValueChange={setTierFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tiers</SelectItem>
                  <SelectItem value="business_class">Business Class</SelectItem>
                  <SelectItem value="first_class">First Class</SelectItem>
                  <SelectItem value="charter">Charter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Idle for at least (days)</label>
              <Input
                type="number"
                min={0}
                value={minDaysIdle}
                onChange={(e) => setMinDaysIdle(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-28"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2 mb-0.5">
              <RefreshCw size={14} />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading abandoned sign-ups…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center">
              <UserX size={32} className="mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No abandoned sign-ups match your filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                    <th
                      className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                      onClick={() => toggleSort("tier")}
                    >
                      <span className="flex items-center gap-1">Tier <SortIcon col="tier" /></span>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Progress</th>
                    <th
                      className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                      onClick={() => toggleSort("daysAgo")}
                    >
                      <span className="flex items-center gap-1">Started <SortIcon col="daysAgo" /></span>
                    </th>
                    <th
                      className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                      onClick={() => toggleSort("daysIdle")}
                    >
                      <span className="flex items-center gap-1">Idle <SortIcon col="daysIdle" /></span>
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => {
                    const isNudging = nudgingSessions.has(s.id);
                    const wasNudged = nudgedSessions.has(s.id);
                    const startedLabel = s.daysAgo === 0 ? "Today"
                      : s.daysAgo === 1 ? "Yesterday"
                      : `${s.daysAgo}d ago`;
                    const idleLabel = s.daysIdle === 0 ? "Today"
                      : s.daysIdle === 1 ? "1 day"
                      : `${s.daysIdle} days`;
                    const idleColour = s.daysIdle >= 7 ? "text-red-600 font-semibold"
                      : s.daysIdle >= 3 ? "text-amber-600 font-medium"
                      : "text-muted-foreground";
                    return (
                      <tr key={s.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 font-medium">{s.email}</td>
                        <td className="px-4 py-3">
                          <Badge className={`text-xs ${TIER_COLOURS[s.membershipTier ?? ""] ?? "bg-gray-100 text-gray-700"}`} variant="outline">
                            {TIER_LABELS[s.membershipTier ?? ""] ?? s.membershipTier ?? "—"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 capitalize text-muted-foreground">{s.membershipType ?? "—"}</td>
                        <td className="px-4 py-3">
                          <Badge className={`text-xs ${STEP_COLOURS[s.progress] ?? "bg-gray-100 text-gray-700"}`} variant="outline">
                            {s.progress}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock size={13} />
                            {startedLabel}
                          </span>
                        </td>
                        <td className={`px-4 py-3 ${idleColour}`}>{idleLabel}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {wasNudged ? (
                              <span className="text-xs text-green-600 font-medium">✓ Nudge sent</span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5 text-xs"
                                disabled={isNudging}
                                onClick={() => handleNudge(s.id)}
                              >
                                <Mail size={13} />
                                {isNudging ? "Sending\u2026" : "Send Nudge"}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:bg-destructive/10 border-destructive/30"
                              onClick={() => setDeleteTarget({ id: s.id, email: s.email })}
                            >
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-4 py-2 border-t text-xs text-muted-foreground">
                Showing {filtered.length} of {sessions.length} abandoned sign-ups
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete abandoned session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the sign-up session for <strong>{deleteTarget?.email}</strong>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteSession.mutate({ sessionId: deleteTarget.id })}
              disabled={deleteSession.isPending}
            >
              {deleteSession.isPending ? "Deleting\u2026" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
