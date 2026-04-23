import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  CheckCircle2, Clock, CalendarDays, ChevronRight, RotateCcw,
  UserPlus, ArrowRight, Mail,
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

// Fixed system items (no generic "Supplier logins revoked" — suppliers are listed individually)
const CANCEL_CHECKLIST_ITEMS = [
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
    supplierLogins?: { id: number; supplierName: string }[];
  };
  onUpdate: () => void;
}) {
  const suppliers = agent.supplierLogins ?? [];
  // Build the full item list: per-supplier items first, then fixed system items
  const supplierItems = suppliers.map(s => `Revoke: ${s.supplierName}`);
  const allItems = [...supplierItems, ...CANCEL_CHECKLIST_ITEMS];

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
  const total = allItems.length;
  const pct = total === 0 ? 100 : Math.round((progress / total) * 100);

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
          {suppliers.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {suppliers.map(s => (
                <span
                  key={s.id}
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                    localTicked.includes(`Revoke: ${s.supplierName}`)
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-400 line-through opacity-60"
                      : "bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-950 dark:border-orange-800 dark:text-orange-400"
                  }`}
                >
                  {s.supplierName}
                </span>
              ))}
            </div>
          )}
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
        <div className="border-t bg-muted/20 p-4 space-y-4">
          {/* Per-supplier items */}
          {supplierItems.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Supplier Logins</p>
              <div className="grid grid-cols-2 gap-3">
                {supplierItems.map((item) => (
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
                      {/* Show just the supplier name, not the "Revoke: " prefix */}
                      {item.replace(/^Revoke: /, "")}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fixed system items */}
          <div>
            {supplierItems.length > 0 && (
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Systems &amp; Access</p>
            )}
            <div className="grid grid-cols-2 gap-3">
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
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Memberships() {
  const { data, refetch, isLoading } = trpc.crm.agentCrm.getMembershipsOverview.useQuery();
  const { data: newSignUps = [], refetch: refetchSignUps } = trpc.crm.agentCrm.getNewSignUps.useQuery();

  // Reinstate dialog state
  const [reinstateTarget, setReinstateTarget] = useState<{ userId: number; name: string | null } | null>(null);
  const reinstateAgent = trpc.crm.agentCrm.updateAgentStatus.useMutation({
    onSuccess: () => {
      toast.success(`${reinstateTarget?.name ?? "Agent"} reinstated to Active`);
      setReinstateTarget(null);
      refetch();
    },
    onError: (e) => { toast.error(e.message); setReinstateTarget(null); },
  });

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
      <Tabs defaultValue={newSignUps.length > 0 ? "new_signups" : "in_notice"} className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="new_signups" className="gap-1.5">
            <UserPlus className="h-3.5 w-3.5" />
            New Sign-Ups
            {newSignUps.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400 text-xs font-bold">
                {newSignUps.length}
              </span>
            )}
          </TabsTrigger>
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

        {/* New Sign-Ups Panel */}
        <TabsContent value="new_signups">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">New Sign-Ups Awaiting Onboarding</CardTitle>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Agents who have joined but haven't been fully onboarded yet. Open their CRM profile to begin or continue the onboarding checklist.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchSignUps()}>Refresh</Button>
              </div>
            </CardHeader>
            <CardContent>
              {newSignUps.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <UserPlus className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No new sign-ups awaiting onboarding</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {(newSignUps as any[]).map((agent: any) => {
                    const pct = Math.round((agent.completedSteps / agent.totalSteps) * 100);
                    const tierLabel = agent.membershipTier
                      ? agent.membershipTier.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
                      : null;
                    const stepLabels = [
                      { key: "trainingHubLogin", label: "Training Hub" },
                      { key: "jltEmailSetup", label: "JLT Email" },
                      { key: "idDocsReviewed", label: "ID Docs" },
                      { key: "contractReviewed", label: "Contract" },
                      { key: "welcomeEmailSent", label: "Welcome Email" },
                      { key: "portalAccessApproved", label: "Portal Access" },
                      { key: "ddSubscriptionCreated", label: "DD Setup" },
                    ];
                    return (
                      <div key={agent.userId} className="flex items-center gap-4 p-4 rounded-xl border bg-card hover:bg-muted/40 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{agent.name ?? "—"}</span>
                            {agent.uniqueAgentId && (
                              <Badge variant="outline" className="font-mono text-xs">{agent.uniqueAgentId}</Badge>
                            )}
                            {tierLabel && (
                              <Badge variant="secondary" className="text-xs">{tierLabel}</Badge>
                            )}
                            <span className="text-xs text-muted-foreground">{agent.email}</span>
                          </div>
                          {agent.jltEmailPreference && (
                            <div className="mt-1 flex items-center gap-1.5">
                              <Mail size={11} className="text-muted-foreground shrink-0" />
                              <span className="text-xs text-muted-foreground">Requested JLT email:</span>
                              <span className="text-xs font-semibold font-mono text-foreground">{agent.jltEmailPreference}</span>
                            </div>
                          )}
                          <div className="mt-2 space-y-1.5">
                            <div className="flex items-center gap-2">
                              <Progress value={pct} className="h-1.5 flex-1" />
                              <span className="text-xs text-muted-foreground whitespace-nowrap">{agent.completedSteps}/{agent.totalSteps} steps</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {stepLabels.map(({ key, label }) => (
                                <span
                                  key={key}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                    agent[key]
                                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                      : "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {agent[key] ? <CheckCircle2 size={9} /> : <Clock size={9} />}
                                  {label}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                        <Link href={`/crm/agents?agent=${agent.userId}&tab=onboarding`}>
                          <Button size="sm" variant="outline" className="gap-1.5 shrink-0">
                            Open Checklist <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

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
                      <TableHead className="w-32"></TableHead>
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
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950"
                                onClick={() => setReinstateTarget({ userId: agent.userId, name: agent.name })}
                              >
                                <RotateCcw className="h-3 w-3" /> Reinstate
                              </Button>
                              <Link href="/crm/agents">
                                <Button size="sm" variant="ghost" className="text-xs">View</Button>
                              </Link>
                            </div>
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
                      <TableHead className="w-32"></TableHead>
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
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950"
                              onClick={() => setReinstateTarget({ userId: agent.userId, name: agent.name })}
                            >
                              <RotateCcw className="h-3 w-3" /> Reinstate
                            </Button>
                            <Link href="/crm/agents">
                              <Button size="sm" variant="ghost" className="text-xs">View</Button>
                            </Link>
                          </div>
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

      {/* Reinstate Confirmation Dialog */}
      <AlertDialog open={!!reinstateTarget} onOpenChange={(open) => { if (!open) setReinstateTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reinstate Agent</AlertDialogTitle>
            <AlertDialogDescription>
              Set <strong>{reinstateTarget?.name ?? "this agent"}</strong> back to <strong>Active</strong> status?
              Their portal access will be restored immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                if (reinstateTarget) {
                  reinstateAgent.mutate({ userId: reinstateTarget.userId, newStatus: "active" });
                }
              }}
              disabled={reinstateAgent.isPending}
            >
              {reinstateAgent.isPending ? "Reinstating..." : "Confirm Reinstate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
