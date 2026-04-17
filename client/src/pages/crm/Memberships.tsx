import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Users, PauseCircle, AlertTriangle, XCircle, ShieldOff,
  CheckCircle2, Clock, CalendarDays, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysUntil(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const d = new Date(date);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function DaysChip({ days }: { days: number | null }) {
  if (days === null) return <span className="text-muted-foreground text-xs">No date set</span>;
  if (days < 0) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
      <AlertTriangle className="h-3 w-3" /> {Math.abs(days)}d overdue
    </span>
  );
  if (days === 0) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
      Today
    </span>
  );
  if (days <= 7) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
      <Clock className="h-3 w-3" /> {days}d
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
      <CalendarDays className="h-3 w-3" /> {days}d
    </span>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon, color, sub,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`p-2.5 rounded-xl ${color.replace("text-", "bg-").replace("-600", "-100").replace("-400", "-900/30")}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Offboarding Checklist Row ─────────────────────────────────────────────────

const CANCEL_CHECKLIST_ITEMS = [
  "Supplier logins revoked",
  "Topdog login removed",
  "WhatsApp access removed",
  "Learnworlds access removed",
  "JLT email deactivated",
  "Portal access removed",
];

function OffboardingRow({
  agent,
  onUpdate,
}: {
  agent: {
    userId: number;
    name: string | null;
    email: string | null;
    cancelledAt: Date | null;
    cancelChecklist: unknown;
    uniqueAgentId?: string | null;
  };
  onUpdate: () => void;
}) {
  const ticked = Array.isArray(agent.cancelChecklist) ? (agent.cancelChecklist as string[]) : [];
  const [localTicked, setLocalTicked] = useState<string[]>(ticked);
  const [expanded, setExpanded] = useState(false);

  const updateChecklist = trpc.crm.agentCrm.updateCancelChecklist.useMutation({
    onSuccess: () => { toast.success("Checklist updated"); onUpdate(); },
    onError: (e) => toast.error(e.message),
  });

  function toggle(item: string) {
    const next = localTicked.includes(item)
      ? localTicked.filter(i => i !== item)
      : [...localTicked, item];
    setLocalTicked(next);
    updateChecklist.mutate({ userId: agent.userId, checklist: next });
  }

  const progress = localTicked.length;
  const total = CANCEL_CHECKLIST_ITEMS.length;
  const pct = Math.round((progress / total) * 100);

  return (
    <div className="border rounded-xl overflow-hidden">
      {/* Header row */}
      <div
        className="flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{agent.name ?? "—"}</span>
            {agent.uniqueAgentId && (
              <Badge variant="outline" className="font-mono text-xs">{agent.uniqueAgentId}</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{agent.email}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">Final date</p>
          <p className="text-sm font-medium">{formatDate(agent.cancelledAt)}</p>
        </div>
        <div className="shrink-0 w-32">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">{progress}/{total} done</span>
            <span className="text-xs font-medium">{pct}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pct === 100 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
      </div>

      {/* Checklist */}
      {expanded && (
        <div className="border-t bg-muted/20 p-4 grid grid-cols-2 gap-3">
          {CANCEL_CHECKLIST_ITEMS.map((item) => (
            <div key={item} className="flex items-center gap-2.5">
              <Checkbox
                id={`${agent.userId}-${item}`}
                checked={localTicked.includes(item)}
                onCheckedChange={() => toggle(item)}
                disabled={updateChecklist.isPending}
              />
              <label
                htmlFor={`${agent.userId}-${item}`}
                className={`text-sm cursor-pointer ${localTicked.includes(item) ? "line-through text-muted-foreground" : ""}`}
              >
                {item}
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Memberships() {
  const { data, refetch, isLoading } = trpc.crm.agentCrm.getMembershipsOverview.useQuery();

  if (isLoading) {
    return (
      <div className="p-6 space-y-5">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { stats, tierCounts, inNotice, paused, suspended, cancelledPendingOffboarding, checklistItems } = data;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Memberships</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Overview of all agent memberships, statuses, and offboarding actions
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Total Agents" value={stats.total} icon={<Users className="h-5 w-5 text-foreground" />} color="text-foreground" />
        <StatCard label="Active" value={stats.active} icon={<CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />} color="text-emerald-600 dark:text-emerald-400" />
        <StatCard label="Paused" value={stats.paused} icon={<PauseCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />} color="text-amber-600 dark:text-amber-400" />
        <StatCard label="In Notice" value={stats.in_notice} icon={<AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" />} color="text-orange-600 dark:text-orange-400" />
        <StatCard label="Suspended" value={stats.suspended} icon={<ShieldOff className="h-5 w-5 text-purple-600 dark:text-purple-400" />} color="text-purple-600 dark:text-purple-400" />
        <StatCard label="Cancelled" value={stats.cancelled} icon={<XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />} color="text-red-600 dark:text-red-400" />
      </div>

      {/* Tier Breakdown */}
      {Object.keys(tierCounts).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Active Agents by Membership Tier</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {Object.entries(tierCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([tier, count]) => (
                  <div key={tier} className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg">
                    <Badge variant="secondary" className="text-xs">{tier}</Badge>
                    <span className="text-sm font-semibold">{count}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Panels */}
      <Tabs defaultValue="in_notice" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="in_notice" className="gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            In Notice
            {inNotice.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 text-xs font-bold">
                {inNotice.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="paused" className="gap-1.5">
            <PauseCircle className="h-3.5 w-3.5" />
            Paused
            {paused.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs font-bold">
                {paused.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="suspended" className="gap-1.5">
            <ShieldOff className="h-3.5 w-3.5" />
            Suspended
            {suspended.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 text-xs font-bold">
                {suspended.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="offboarding" className="gap-1.5">
            <XCircle className="h-3.5 w-3.5" />
            Offboarding Required
            {cancelledPendingOffboarding.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs font-bold">
                {cancelledPendingOffboarding.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* In Notice Panel */}
        <TabsContent value="in_notice">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Agents In Notice</CardTitle>
              <p className="text-sm text-muted-foreground">
                These agents have given notice. Their direct debit should be cancelled on their final date.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {inNotice.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No agents currently in notice</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Agent ID</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Final Date</TableHead>
                      <TableHead>Time Remaining</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inNotice.map((agent) => {
                      const days = daysUntil(agent.noticeEndsAt);
                      return (
                        <TableRow key={agent.userId}>
                          <TableCell>
                            <div className="font-medium text-sm">{agent.name ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{agent.email}</div>
                          </TableCell>
                          <TableCell>
                            {agent.uniqueAgentId
                              ? <Badge variant="outline" className="font-mono text-xs">{agent.uniqueAgentId}</Badge>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell>
                            {agent.membershipTier
                              ? <Badge variant="secondary" className="text-xs">{agent.membershipTier}</Badge>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell className="text-sm font-medium">
                            {formatDate(agent.noticeEndsAt)}
                          </TableCell>
                          <TableCell>
                            <DaysChip days={days} />
                          </TableCell>
                          <TableCell>
                            <Link href="/crm/agents">
                              <Button size="sm" variant="ghost" className="text-xs">View</Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Paused Panel */}
        <TabsContent value="paused">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Paused Agents</CardTitle>
              <p className="text-sm text-muted-foreground">
                Direct debits are paused for these agents. Reinstate when their pause period ends.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {paused.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <PauseCircle className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No agents currently paused</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Agent ID</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Pause Ends</TableHead>
                      <TableHead>Time Remaining</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paused.map((agent) => {
                      const days = daysUntil(agent.pauseEndsAt);
                      return (
                        <TableRow key={agent.userId}>
                          <TableCell>
                            <div className="font-medium text-sm">{agent.name ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{agent.email}</div>
                          </TableCell>
                          <TableCell>
                            {agent.uniqueAgentId
                              ? <Badge variant="outline" className="font-mono text-xs">{agent.uniqueAgentId}</Badge>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell>
                            {agent.membershipTier
                              ? <Badge variant="secondary" className="text-xs">{agent.membershipTier}</Badge>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell className="text-sm font-medium">
                            {formatDate(agent.pauseEndsAt)}
                          </TableCell>
                          <TableCell>
                            <DaysChip days={days} />
                          </TableCell>
                          <TableCell>
                            <Link href="/crm/agents">
                              <Button size="sm" variant="ghost" className="text-xs">View</Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Suspended Panel */}
        <TabsContent value="suspended">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Suspended Agents</CardTitle>
              <p className="text-sm text-muted-foreground">
                These agents have had their portal access blocked. They see a suspension message directing them to memberships@thejltgroup.co.uk.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {suspended.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <ShieldOff className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No agents currently suspended</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Agent ID</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Suspended Since</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suspended.map((agent) => (
                      <TableRow key={agent.userId}>
                        <TableCell>
                          <div className="font-medium text-sm">{agent.name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{agent.email}</div>
                        </TableCell>
                        <TableCell>
                          {agent.uniqueAgentId
                            ? <Badge variant="outline" className="font-mono text-xs">{agent.uniqueAgentId}</Badge>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell>
                          {agent.membershipTier
                            ? <Badge variant="secondary" className="text-xs">{agent.membershipTier}</Badge>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDate(agent.suspendedAt)}
                        </TableCell>
                        <TableCell>
                          <Link href="/crm/agents">
                            <Button size="sm" variant="ghost" className="text-xs">View</Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Offboarding Panel */}
        <TabsContent value="offboarding">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Offboarding Required</CardTitle>
              <p className="text-sm text-muted-foreground">
                These cancelled agents still have outstanding offboarding tasks. Tick each item as it is completed.
                Once all items are ticked, the agent will be removed from this list.
              </p>
            </CardHeader>
            <CardContent>
              {cancelledPendingOffboarding.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-20 text-emerald-500" />
                  <p className="text-sm font-medium">All offboarding complete</p>
                  <p className="text-xs mt-1">No cancelled agents with outstanding tasks</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {cancelledPendingOffboarding.map((agent) => (
                    <OffboardingRow
                      key={agent.userId}
                      agent={agent as any}
                      onUpdate={() => refetch()}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
