import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { resolveDocUrl } from "@/lib/docUrl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search, UserCheck, Banknote, Eye, EyeOff, Plus, Trash2,
  Upload, BadgeCheck, MapPin, Phone, Mail, Building2,
  Calendar, CreditCard, User, FileText, CheckSquare, Square,
  ChevronDown, X, Pencil, Clock, ArrowRight, CheckCircle2,
  Shield, ExternalLink, FileSignature, ScrollText, Printer, Zap
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

const UK_REGIONS = [
  "North West", "North East", "Yorkshire and the Humber", "East Midlands",
  "West Midlands", "East of England", "London", "South East", "South West",
  "Wales", "Scotland", "Northern Ireland",
];

const AGENT_STATUS_OPTIONS = [
  { value: "active", label: "Active", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" },
  { value: "paused", label: "Paused", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  { value: "in_notice", label: "In Notice", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" },
  { value: "suspended", label: "Suspended", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400" },
  { value: "cancelled", label: "Cancelled", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
];

const MEMBERSHIP_TIERS = [
  "Business Class",
  "Business Duo",
  "Business Trio",
  "First Class",
  "First Class Duo",
  "Economy",
  "CORE",
];

const SUPPLIERS = [
  "Ace Rooms",
  "Easyjet",
  "Etihad Holidays",
  "Every Holiday",
  "Gold Medal",
  "Holiday Best",
  "Koveli",
  "Major Travel",
  "MSC",
  "NCL",
];

type CrmProfile = {
  uniqueAgentId: string | null;
  jltEmail: string | null;
  personalEmail: string | null;
  businessEmail: string | null;
  mobile: string | null;
  ukRegion: string | null;
  bankAccountName: string | null;
  membershipTier: string | null;
  agentStatus: string | null;
  businessName: string | null;
  retailerCode: string | null;
  introducedBy: string | null;
  dateJoined: string | null;
  monthlySub: string | null;
  internalNotes: string | null;
  trainingStage: string | null;
  topdogRetailerName: string | null;
  topdogRetailerCode: string | null;
  teamId?: number | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postcode?: string | null;
  adminNotes?: string | null;
  idDocUrl?: string | null;
  idDocKey?: string | null;
  proofOfAddressUrl?: string | null;
  proofOfAddressKey?: string | null;
  bankSortCode?: string | null;
  bankAccountNumber?: string | null;
  orbitEnabled?: boolean | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
};

type AgentRow = {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  portalStatus: "onboarding" | "active";
  createdAt: Date;
  tags: string[];
  crmProfile: CrmProfile | null;
  teamId?: number | null;
};

// Render note content with attachment links as clickable anchors
function NoteContent({ content }: { content: string }) {
  const parts = content.split(/(\[Attachment:[^\]]+\]\([^)]+\))/g);
  return (
    <p className="text-sm whitespace-pre-wrap leading-relaxed">
      {parts.map((part, i) => {
        const m = part.match(/^\[Attachment:\s*([^\]]+)\]\(([^)]+)\)$/);
        if (m) {
          const [, fileName, url] = m;
          return (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:opacity-80"
              style={{ color: "#02E6D2" }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              {fileName.trim()}
            </a>
          );
        }
        return part;
      })}
    </p>
  );
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const opt = AGENT_STATUS_OPTIONS.find(o => o.value === (status ?? "active")) ?? AGENT_STATUS_OPTIONS[0];
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${opt.color}`}>{opt.label}</span>;
}

export default function AgentCrm() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [selectedAgent, setSelectedAgent] = useState<AgentRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: agents = [], refetch } = trpc.crm.agentCrm.list.useQuery();
  const { data: recentFailedPayments = [] } = trpc.gocardless.adminGetRecentFailedPayments.useQuery();
  const failedPaymentUserIds = new Set((recentFailedPayments as any[]).map((e: any) => e.userId));

  const filtered = (agents as AgentRow[]).filter((a) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      (a.name ?? "").toLowerCase().includes(q) ||
      (a.email ?? "").toLowerCase().includes(q) ||
      (a.crmProfile?.uniqueAgentId ?? "").toLowerCase().includes(q) ||
      (a.crmProfile?.jltEmail ?? "").toLowerCase().includes(q) ||
      (a.crmProfile?.businessName ?? "").toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || (a.crmProfile?.agentStatus ?? "active") === statusFilter;
    const matchesTier = tierFilter === "all" || a.crmProfile?.membershipTier === tierFilter;
    return matchesSearch && matchesStatus && matchesTier;
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Agent CRM</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{(agents as AgentRow[]).length} registered agents</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, agent ID, business name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {AGENT_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Membership tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers</SelectItem>
            {MEMBERSHIP_TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Agent ID</TableHead>
                <TableHead>JLT Email</TableHead>
                <TableHead>Membership</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    <UserCheck className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p>No agents found</p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((agent) => (
                  <TableRow
                    key={agent.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => { setSelectedAgent(agent); setSheetOpen(true); }}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{agent.name ?? "—"}</span>
                        {failedPaymentUserIds.has(agent.id) && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">
                            <CreditCard size={9} /> Payment Failed
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{agent.email}</div>
                      {agent.crmProfile?.businessName && (
                        <div className="text-xs text-muted-foreground italic">{agent.crmProfile.businessName}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {agent.crmProfile?.uniqueAgentId
                        ? <Badge variant="outline" className="font-mono text-xs">{agent.crmProfile.uniqueAgentId}</Badge>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">{agent.crmProfile?.jltEmail ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      {agent.crmProfile?.membershipTier
                        ? <Badge variant="secondary" className="text-xs">{agent.crmProfile.membershipTier}</Badge>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={agent.crmProfile?.agentStatus} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{agent.crmProfile?.ukRegion ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap max-w-[160px]">
                        {agent.tags.slice(0, 3).map((tag) => <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>)}
                        {agent.tags.length > 3 && <span className="text-xs text-muted-foreground">+{agent.tags.length - 3}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelectedAgent(agent); setSheetOpen(true); }}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedAgent && (
        <AgentCrmSheet
          agent={selectedAgent}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onRefresh={() => refetch()}
        />
      )}
    </div>
  );
}

// ─── Agent CRM Sheet ──────────────────────────────────────────────────────────

function AgentCrmSheet({ agent, open, onClose, onRefresh }: {
  agent: AgentRow; open: boolean; onClose: () => void; onRefresh: () => void;
}) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: crmData, refetch: refetchCrm, isLoading: crmLoading, isError: crmError } = trpc.crm.agentCrm.get.useQuery(
    { userId: agent.id },
    { enabled: open, retry: 2, retryDelay: 1000, placeholderData: (prev: any) => prev }
  );
  function refresh() { refetchCrm(); onRefresh(); }

  const deleteRecord = trpc.crm.agentCrm.deleteRecord.useMutation({
    onSuccess: () => {
      toast.success(`CRM record for ${agent.name} deleted`);
      setConfirmDelete(false);
      onClose();
      onRefresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const { data: agentDdStatus } = trpc.gocardless.adminListMandates.useQuery(undefined, { enabled: open });
  const agentMandate = agentDdStatus?.find((m: any) => m.userId === agent.id);

  // Fall back to the list-level crmProfile while the detailed query is loading
  const profile = (crmData?.profile ?? agent.crmProfile) as CrmProfile | null ?? null;

  const [orbitChecked, setOrbitChecked] = useState<boolean | null>(null);
  // Sync local state from server when profile loads
  useEffect(() => {
    if (profile !== null && orbitChecked === null) {
      setOrbitChecked(!!profile?.orbitEnabled);
    }
  }, [profile]);
  // Reset local state when sheet closes
  useEffect(() => {
    if (!open) setOrbitChecked(null);
  }, [open]);

  const toggleOrbitAccess = trpc.crm.agentCrm.toggleOrbitAccess.useMutation({
    onSuccess: (data) => {
      toast.success(data.orbitEnabled ? "Orbit access enabled" : "Orbit access disabled");
      setOrbitChecked(data.orbitEnabled);
      refresh();
    },
    onError: (e) => {
      toast.error(e.message);
      // Revert local state on error
      setOrbitChecked(!!profile?.orbitEnabled);
    },
  });

  const activatePortal = trpc.users.activatePortalAccess.useMutation({
    onSuccess: () => {
      toast.success(`Portal access activated for ${agent.name}`);
      onRefresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const isOnboarding = agent.portalStatus === "onboarding";

  return (
    <>
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto p-0">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <SheetTitle className="text-xl font-bold truncate">{agent.name}</SheetTitle>
              <p className="text-sm text-muted-foreground mt-0.5 truncate">{agent.email}</p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {profile?.uniqueAgentId && (
                  <Badge variant="outline" className="font-mono text-xs">{profile.uniqueAgentId}</Badge>
                )}
                <StatusBadge status={profile?.agentStatus} />
                {profile?.membershipTier && (
                  <Badge variant="secondary" className="text-xs">{profile.membershipTier}</Badge>
                )}
                {isOnboarding ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                    Onboarding
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                    Portal Active
                  </span>
                )}
                {/* Orbit beta access badge */}
                {profile?.orbitEnabled ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-800">
                    <Zap size={10} /> Orbit Access
                  </span>
                ) : null}
                {/* DD mandate status badge */}
                {agentMandate ? (
                  agentMandate.status === "active" ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-800">
                      <CreditCard size={10} /> DD Active
                    </span>
                  ) : agentMandate.status === "pending" ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      <CreditCard size={10} /> DD Pending
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                      <CreditCard size={10} /> DD {agentMandate.status}
                    </span>
                  )
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                    <CreditCard size={10} /> No DD
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Error banner when detailed query fails — only show if error AND not yet successfully loaded */}
        {crmError && !crmLoading && !crmData && (
          <div className="mx-6 mt-3 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            <span className="flex-1">Could not load full profile data — showing cached data. Some fields may be incomplete.</span>
            <button onClick={() => refetchCrm()} className="shrink-0 font-medium underline hover:no-underline">Retry</button>
          </div>
        )}

        {/* Tabs */}
        <div className="px-6 pt-4">
          {/* Portal access + delete actions */}
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-4">
              {/* Activate Portal Access — shown when agent is still in onboarding */}
              {isOnboarding ? (
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  style={{ background: "#70FFE8", color: "#414141" }}
                  disabled={activatePortal.isPending}
                  onClick={() => activatePortal.mutate({ userId: agent.id })}
                >
                  <UserCheck size={12} />
                  {activatePortal.isPending ? "Activating..." : "Activate Portal Access"}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Portal access is active</span>
              )}
              {/* Orbit beta access toggle */}
              <div className="flex items-center gap-2">
                <Switch
                  id="orbit-toggle"
                  checked={orbitChecked ?? !!profile?.orbitEnabled}
                  disabled={toggleOrbitAccess.isPending}
                  onCheckedChange={(checked) => {
                    setOrbitChecked(checked);
                    toggleOrbitAccess.mutate({ userId: agent.id, enabled: checked });
                  }}
                />
                <label htmlFor="orbit-toggle" className="text-xs text-muted-foreground flex items-center gap-1 cursor-pointer select-none">
                  <Zap size={11} className={(orbitChecked ?? !!profile?.orbitEnabled) ? "text-violet-600" : ""} />
                  Orbit Access
                </label>
              </div>
            </div>
            {/* Delete record — super_admin only */}
            {isSuperAdmin && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-red-300 text-red-600 hover:bg-red-50 gap-1.5"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={12} />
                Delete CRM Record
              </Button>
            )}
          </div>
          <Tabs defaultValue="profile">
            <TabsList className="grid grid-cols-11 w-full">
              <TabsTrigger value="profile" className="text-xs">Profile</TabsTrigger>
              <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>
              <TabsTrigger value="team" className="text-xs">Team</TabsTrigger>
              <TabsTrigger value="suppliers" className="text-xs">Suppliers</TabsTrigger>
              <TabsTrigger value="bank" className="text-xs">Bank</TabsTrigger>
              <TabsTrigger value="docs" className="text-xs">Docs</TabsTrigger>
              <TabsTrigger value="tags" className="text-xs">Tags</TabsTrigger>
              <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
              <TabsTrigger value="dd" className="text-xs">Direct Debit</TabsTrigger>
              <TabsTrigger value="onboarding" className="text-xs">Onboarding</TabsTrigger>
              <TabsTrigger value="notes" className="text-xs">Notes</TabsTrigger>

            </TabsList>

            <TabsContent value="profile" className="mt-5 pb-8">
              <ProfileTab userId={agent.id} profile={profile} supplierLogins={crmData?.supplierLogins ?? []} onRefresh={refresh} />
            </TabsContent>
            <TabsContent value="activity" className="mt-5 pb-8">
              <ActivityTab userId={agent.id} />
            </TabsContent>
            <TabsContent value="suppliers" className="mt-5 pb-8">
              <SupplierAccessTab userId={agent.id} supplierLogins={crmData?.supplierLogins ?? []} onRefresh={refresh} />
            </TabsContent>
            <TabsContent value="bank" className="mt-5 pb-8">
              <BankDetailsTab userId={agent.id} profile={profile} onRefresh={refresh} />
            </TabsContent>
            <TabsContent value="docs" className="mt-5 pb-8">
              <DocsTab userId={agent.id} profile={profile} contractData={crmData?.contractData ?? null} onRefresh={refresh} />
            </TabsContent>
            <TabsContent value="team" className="mt-5 pb-8">
              <TeamTab userId={agent.id} profile={profile} onRefresh={refresh} />
            </TabsContent>
            <TabsContent value="tags" className="mt-5 pb-8">
              <TagsTab userId={agent.id} tags={agent.tags} onRefresh={refresh} />
            </TabsContent>
            <TabsContent value="history" className="mt-5 pb-8">
              <StatusHistoryTab userId={agent.id} />
            </TabsContent>
            <TabsContent value="dd" className="mt-5 pb-8">
              <DirectDebitTab userId={agent.id} mandate={agentMandate} />
            </TabsContent>
            <TabsContent value="onboarding" className="mt-5 pb-8">
              <AdminOnboardingChecklistTab userId={agent.id} agentName={agent.name ?? ""} agentEmail={agent.email ?? ""} open={open} onRefresh={refresh} />
            </TabsContent>
            <TabsContent value="notes" className="mt-5 pb-8">
              <AgentNotesTab userId={agent.id} />
            </TabsContent>

          </Tabs>
        </div>
      </SheetContent>
    </Sheet>

    {/* Delete confirmation dialog */}
    <Dialog open={confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <Trash2 size={18} />
            Delete CRM Record
          </DialogTitle>
          <DialogDescription>
            This will permanently delete the CRM profile, supplier logins, status history, tags, and change requests for <strong>{agent.name}</strong>. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button
            className="bg-red-600 hover:bg-red-700 text-white"
            disabled={deleteRecord.isPending}
            onClick={() => deleteRecord.mutate({ userId: agent.id })}
          >
            {deleteRecord.isPending ? "Deleting..." : "Delete Permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

// ─── Profile Tab ────────────────────────────────────────────────────────────────────────────────

type SupplierLoginRow = { id: number; supplierName: string; notes?: string | null };

function ProfileTab({ userId, profile, supplierLogins = [], onRefresh }: {
  userId: number;
  profile: CrmProfile | null;
  supplierLogins?: SupplierLoginRow[];
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    jltEmail: profile?.jltEmail ?? "",
    personalEmail: profile?.personalEmail ?? "",
    businessEmail: profile?.businessEmail ?? "",
    mobile: profile?.mobile ?? "",
    addressLine1: profile?.addressLine1 ?? "",
    addressLine2: profile?.addressLine2 ?? "",
    city: profile?.city ?? "",
    postcode: profile?.postcode ?? "",
    ukRegion: profile?.ukRegion ?? "",
    agentStatus: profile?.agentStatus ?? "active",
    membershipTier: profile?.membershipTier ?? "",
    businessName: profile?.businessName ?? "",
    retailerCode: profile?.retailerCode ?? "",
    introducedBy: profile?.introducedBy ?? "",
    dateJoined: profile?.dateJoined ?? "",
    monthlySub: profile?.monthlySub ?? "",
    internalNotes: profile?.internalNotes ?? "",
    trainingStage: profile?.trainingStage ?? "",
  });

  // ── Status-change dialog state ──────────────────────────────────────────────
  const [statusDialog, setStatusDialog] = useState<null | "paused" | "in_notice" | "cancelled" | "suspended">(null);
  const [pauseEndsAt, setPauseEndsAt] = useState("");
  const [noticeEndsAt, setNoticeEndsAt] = useState("");
  const [cancelledAt, setCancelledAt] = useState("");
  const [statusNotes, setStatusNotes] = useState("");
  const CANCEL_CHECKLIST_ITEMS = [
    "Supplier logins revoked",
    "Topdog login removed",
    "WhatsApp access removed",
    "Learnworlds access removed",
    "JLT email deactivated",
    "Portal access removed",
  ];
  const [cancelChecklist, setCancelChecklist] = useState<string[]>([]);

  const updateAgentStatus = trpc.crm.agentCrm.updateAgentStatus.useMutation({
    onSuccess: () => {
      toast.success("Agent status updated");
      setStatusDialog(null);
      setEditing(false);
      onRefresh();
    },
    onError: (e) => toast.error(e.message),
  });

  function handleStatusChange(newStatus: string) {
    const prev = profile?.agentStatus ?? "active";
    if (newStatus === prev) return;
    if (newStatus === "paused") { setPauseEndsAt(""); setStatusNotes(""); setStatusDialog("paused"); return; }
    if (newStatus === "in_notice") { setNoticeEndsAt(""); setStatusNotes(""); setStatusDialog("in_notice"); return; }
    if (newStatus === "cancelled") { setCancelledAt(new Date().toISOString().split("T")[0]); setCancelChecklist([]); setStatusNotes(""); setStatusDialog("cancelled"); return; }
    if (newStatus === "suspended") { setStatusNotes(""); setStatusDialog("suspended"); return; }
    // active — no dialog needed, update directly
    updateAgentStatus.mutate({ userId, newStatus: newStatus as any });
  }

  const updateProfile = trpc.crm.agentCrm.updateProfile.useMutation({
    onSuccess: () => { toast.success("Profile updated"); setEditing(false); onRefresh(); },
    onError: (e) => toast.error(e.message),
  });
  const assignId = trpc.crm.agentCrm.assignAgentId.useMutation({
    onSuccess: (data) => { toast.success("Agent ID assigned: " + data.uniqueAgentId); onRefresh(); },
    onError: (e) => toast.error(e.message),
  });

  // ── Supplier Directory Stage ────────────────────────────────────────────────
  const { data: stageData, refetch: refetchStage } = trpc.suppliers.getAgentStageFor.useQuery(
    { userId },
    { staleTime: 30000 }
  );
  const setSupplierStage = trpc.suppliers.setAgentStage.useMutation({
    onSuccess: () => { toast.success("Supplier directory stage updated"); refetchStage(); },
    onError: (e) => toast.error(e.message),
  });
  const currentStage = stageData?.stage ?? 1;

  function startEdit() {
    setForm({
      jltEmail: profile?.jltEmail ?? "",
      personalEmail: profile?.personalEmail ?? "",
      businessEmail: profile?.businessEmail ?? "",
      mobile: profile?.mobile ?? "",
      addressLine1: profile?.addressLine1 ?? "",
      addressLine2: profile?.addressLine2 ?? "",
      city: profile?.city ?? "",
      postcode: profile?.postcode ?? "",
      ukRegion: profile?.ukRegion ?? "",
      agentStatus: profile?.agentStatus ?? "active",
      membershipTier: profile?.membershipTier ?? "",
      businessName: profile?.businessName ?? "",
      retailerCode: profile?.retailerCode ?? "",
      introducedBy: profile?.introducedBy ?? "",
      dateJoined: profile?.dateJoined ?? "",
      monthlySub: profile?.monthlySub ?? "",
      internalNotes: profile?.internalNotes ?? "",
      trainingStage: profile?.trainingStage ?? "",
    });
    setEditing(true);
  }

  const dialogs = (
    <>
      {/* ── Paused Dialog ── */}
      <Dialog open={statusDialog === "paused"} onOpenChange={(v) => !v && setStatusDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Paused</span>
              Set Pause End Date
            </DialogTitle>
            <DialogDescription>Enter the date when the agent's pause period ends. An email will be sent to memberships to pause their direct debit.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Pause Ends On <span className="text-destructive">*</span></Label>
              <Input type="date" value={pauseEndsAt} onChange={(e) => setPauseEndsAt(e.target.value)} min={new Date().toISOString().split("T")[0]} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Admin Notes (optional)</Label>
              <Textarea value={statusNotes} onChange={(e) => setStatusNotes(e.target.value)} rows={2} placeholder="Reason for pause..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialog(null)}>Cancel</Button>
            <Button
              disabled={!pauseEndsAt || updateAgentStatus.isPending}
              onClick={() => updateAgentStatus.mutate({ userId, newStatus: "paused", pauseEndsAt, notes: statusNotes || null })}
            >
              {updateAgentStatus.isPending ? "Saving..." : "Confirm Pause"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── In Notice Dialog ── */}
      <Dialog open={statusDialog === "in_notice"} onOpenChange={(v) => !v && setStatusDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">In Notice</span>
              Set Final Date at JLT
            </DialogTitle>
            <DialogDescription>Enter the agent's final date at JLT. An email will be sent to memberships to cancel their direct debit at the end of the notice period.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Final Date at JLT <span className="text-destructive">*</span></Label>
              <Input type="date" value={noticeEndsAt} onChange={(e) => setNoticeEndsAt(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Admin Notes (optional)</Label>
              <Textarea value={statusNotes} onChange={(e) => setStatusNotes(e.target.value)} rows={2} placeholder="Reason for notice..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialog(null)}>Cancel</Button>
            <Button
              disabled={!noticeEndsAt || updateAgentStatus.isPending}
              onClick={() => updateAgentStatus.mutate({ userId, newStatus: "in_notice", noticeEndsAt, notes: statusNotes || null })}
            >
              {updateAgentStatus.isPending ? "Saving..." : "Confirm In Notice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Cancelled Dialog ── */}
      <Dialog open={statusDialog === "cancelled"} onOpenChange={(v) => !v && setStatusDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Cancelled</span>
              Confirm Cancellation
            </DialogTitle>
            <DialogDescription>Record the agent's final date and confirm which systems have been restricted. An email will be sent to memberships.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Final Date <span className="text-destructive">*</span></Label>
              <Input type="date" value={cancelledAt} onChange={(e) => setCancelledAt(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block font-medium">Systems to Restrict — tick all that apply</Label>
              <div className="space-y-2 mt-1">
                {CANCEL_CHECKLIST_ITEMS.map((item) => (
                  <div key={item} className="flex items-center gap-2.5">
                    <Checkbox
                      id={`cancel-${item}`}
                      checked={cancelChecklist.includes(item)}
                      onCheckedChange={(checked) =>
                        setCancelChecklist(checked
                          ? [...cancelChecklist, item]
                          : cancelChecklist.filter((i) => i !== item)
                        )
                      }
                    />
                    <label htmlFor={`cancel-${item}`} className="text-sm cursor-pointer">{item}</label>
                  </div>
                ))}
              </div>
              {supplierLogins.length > 0 && (
                <div className="mt-3 p-3 bg-muted/40 rounded-lg">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Active Supplier Logins to revoke:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {supplierLogins.map((s) => (
                      <Badge key={s.id} variant="outline" className="text-xs">{s.supplierName}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Admin Notes (optional)</Label>
              <Textarea value={statusNotes} onChange={(e) => setStatusNotes(e.target.value)} rows={2} placeholder="Reason for cancellation..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialog(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!cancelledAt || updateAgentStatus.isPending}
              onClick={() => updateAgentStatus.mutate({ userId, newStatus: "cancelled", cancelledAt, cancelChecklist, notes: statusNotes || null })}
            >
              {updateAgentStatus.isPending ? "Saving..." : "Confirm Cancellation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Suspended Dialog ── */}
      <Dialog open={statusDialog === "suspended"} onOpenChange={(v) => !v && setStatusDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">Suspended</span>
              Suspend Agent Portal Access
            </DialogTitle>
            <DialogDescription>The agent's portal access will be immediately restricted. They will see a message advising them to contact memberships@thejltgroup.co.uk.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg">
              <p className="text-sm text-purple-800 dark:text-purple-300 font-medium">Portal access will be blocked immediately upon confirmation.</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Admin Notes (optional)</Label>
              <Textarea value={statusNotes} onChange={(e) => setStatusNotes(e.target.value)} rows={2} placeholder="Reason for suspension..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialog(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={updateAgentStatus.isPending}
              onClick={() => updateAgentStatus.mutate({ userId, newStatus: "suspended", notes: statusNotes || null })}
            >
              {updateAgentStatus.isPending ? "Saving..." : "Confirm Suspension"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (!editing) {
    return (
      <>
        <div className="space-y-6">
          {/* Actions */}
          <div className="flex gap-2 justify-end">
            {!profile?.uniqueAgentId && (
              <Button size="sm" variant="outline" onClick={() => assignId.mutate({ userId })} disabled={assignId.isPending}>
                <BadgeCheck className="h-3.5 w-3.5 mr-1.5" />Assign Agent ID
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={startEdit}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit Profile
            </Button>
          </div>

          {/* Status & Membership */}
          <Section title="Status & Membership">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Agent Status">
                <StatusBadge status={profile?.agentStatus} />
              </Field>
              <Field label="Membership Tier">
                {profile?.membershipTier
                  ? <Badge variant="secondary">{profile.membershipTier}</Badge>
                  : <span className="text-muted-foreground text-sm">Not set</span>}
              </Field>
              <Field label="Monthly Subscription" value={profile?.monthlySub} />
              <Field label="Training Stage">
                {profile?.trainingStage
                  ? <Badge variant="outline" className="text-xs">{profile.trainingStage}</Badge>
                  : <span className="text-muted-foreground text-sm">Not set</span>}
              </Field>
              <Field label="Supplier Directory Stage">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-xs ${
                      currentStage === 3 ? "border-green-500 text-green-700 bg-green-50" :
                      currentStage === 2 ? "border-blue-500 text-blue-700 bg-blue-50" :
                      "border-amber-500 text-amber-700 bg-amber-50"
                    }`}
                  >
                    Stage {currentStage} — {currentStage === 1 ? "Training Only" : currentStage === 2 ? "Select Credentials" : "Full Access"}
                  </Badge>
                  <div className="flex gap-1">
                    {[1, 2, 3].map((s) => (
                      <button
                        key={s}
                        onClick={() => setSupplierStage.mutate({ userId, stage: s })}
                        disabled={s === currentStage || setSupplierStage.isPending}
                        className={`w-7 h-7 rounded text-xs font-semibold transition-colors ${
                          s === currentStage
                            ? "bg-primary text-primary-foreground cursor-default"
                            : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                        }`}
                        title={`Set Stage ${s}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </Field>
              <Field label="Date Joined" value={profile?.dateJoined} />
            </div>
          </Section>

          {/* Contact Details */}
          <Section title="Contact Details">
            <div className="grid grid-cols-2 gap-4">
              <Field label="JLT Email" value={profile?.jltEmail} icon={<Mail className="h-3.5 w-3.5" />} />
              <Field label="Personal Email" value={profile?.personalEmail} icon={<Mail className="h-3.5 w-3.5" />} />
              <Field label="Business Email" value={profile?.businessEmail} icon={<Mail className="h-3.5 w-3.5" />} />
              <Field label="Mobile" value={profile?.mobile} icon={<Phone className="h-3.5 w-3.5" />} />
              <Field label="UK Region" value={profile?.ukRegion} icon={<MapPin className="h-3.5 w-3.5" />} />
            </div>
            {(profile?.addressLine1 || profile?.city) && (
              <div className="mt-3 bg-muted/40 rounded-lg p-3 text-sm">
                <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Address</p>
                {profile?.addressLine1 && <p>{profile.addressLine1}</p>}
                {profile?.addressLine2 && <p>{profile.addressLine2}</p>}
                {(profile?.city || profile?.postcode) && <p>{[profile?.city, profile?.postcode].filter(Boolean).join(", ")}</p>}
              </div>
            )}
          </Section>

          {/* Emergency Contact */}
          {(profile?.emergencyContactName || profile?.emergencyContactPhone) && (
            <Section title="Emergency Contact">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Name" value={profile?.emergencyContactName} icon={<User className="h-3.5 w-3.5" />} />
                <Field label="Phone" value={profile?.emergencyContactPhone} icon={<Phone className="h-3.5 w-3.5" />} />
              </div>
            </Section>
          )}

          {/* Business Details */}
          <Section title="Business Details">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Business Name" value={profile?.businessName} icon={<Building2 className="h-3.5 w-3.5" />} />
              <Field label="Retailer Code" value={profile?.retailerCode} />
              <Field label="Introduced By" value={profile?.introducedBy} icon={<User className="h-3.5 w-3.5" />} />
            </div>
          </Section>

          {/* Internal Notes */}
          {profile?.internalNotes && (
            <Section title="Internal Notes">
              <p className="text-sm whitespace-pre-wrap text-foreground/80">{profile.internalNotes}</p>
            </Section>
          )}

          {!profile && (
            <div className="text-center py-10 text-muted-foreground border-2 border-dashed rounded-xl">
              <UserCheck className="h-10 w-10 mx-auto mb-2 opacity-20" />
              <p className="text-sm font-medium">No CRM profile yet</p>
              <p className="text-xs mt-1">Click Edit Profile to add details</p>
            </div>
          )}
        </div>
        {dialogs}
      </>
    );
  }

  // Edit mode
  return (
    <>
      <div className="space-y-6">
        {/* Status & Membership */}
        <Section title="Status & Membership">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Agent Status</Label>
              <Select value={form.agentStatus} onValueChange={(v) => { setForm({ ...form, agentStatus: v }); handleStatusChange(v); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AGENT_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Membership Tier</Label>
              <Select value={form.membershipTier || "_none"} onValueChange={(v) => setForm({ ...form, membershipTier: v === "_none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Select tier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Not set —</SelectItem>
                  {MEMBERSHIP_TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Monthly Subscription</Label>
              <Input value={form.monthlySub} onChange={(e) => setForm({ ...form, monthlySub: e.target.value })} placeholder="e.g. £87" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Training Stage</Label>
              <Select value={form.trainingStage || "_none"} onValueChange={(v) => setForm({ ...form, trainingStage: v === "_none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Select stage" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Not set —</SelectItem>
                  <SelectItem value="Training">Training</SelectItem>
                  <SelectItem value="Agent Accelerator">Agent Accelerator</SelectItem>
                  <SelectItem value="Accredited">Accredited</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Date Joined</Label>
              <Input type="date" value={form.dateJoined} onChange={(e) => setForm({ ...form, dateJoined: e.target.value })} />
            </div>
          </div>
        </Section>

        {/* Contact Details */}
        <Section title="Contact Details">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">JLT Email</Label>
              <Input value={form.jltEmail} onChange={(e) => setForm({ ...form, jltEmail: e.target.value })} placeholder="agent@thejltgroup.co.uk" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Personal Email</Label>
              <Input value={form.personalEmail} onChange={(e) => setForm({ ...form, personalEmail: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Business Email</Label>
              <Input value={form.businessEmail} onChange={(e) => setForm({ ...form, businessEmail: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Mobile</Label>
              <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">UK Region</Label>
              <Select value={form.ukRegion || "_none"} onValueChange={(v) => setForm({ ...form, ukRegion: v === "_none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Select region" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Not set —</SelectItem>
                  {UK_REGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Address Line 1</Label>
              <Input value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Address Line 2</Label>
              <Input value={form.addressLine2} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">City</Label>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Postcode</Label>
              <Input value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value })} />
            </div>
          </div>
        </Section>

        {/* Business Details */}
        <Section title="Business Details">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Business Name</Label>
              <Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="Trading name" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Retailer Code</Label>
              <Input value={form.retailerCode} onChange={(e) => setForm({ ...form, retailerCode: e.target.value })} placeholder="e.g. TRAAV" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Introduced By</Label>
              <Input value={form.introducedBy} onChange={(e) => setForm({ ...form, introducedBy: e.target.value })} placeholder="Referral source" />
            </div>
          </div>
        </Section>

        {/* Internal Notes */}
        <Section title="Internal Notes">
          <Textarea
            value={form.internalNotes}
            onChange={(e) => setForm({ ...form, internalNotes: e.target.value })}
            rows={4}
            placeholder="Internal notes visible to admin only..."
          />
        </Section>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          <Button size="sm" onClick={() => updateProfile.mutate({
            userId,
            jltEmail: form.jltEmail || null,
            personalEmail: form.personalEmail || null,
            businessEmail: form.businessEmail || null,
            mobile: form.mobile || null,
            addressLine1: form.addressLine1 || null,
            addressLine2: form.addressLine2 || null,
            city: form.city || null,
            postcode: form.postcode || null,
            ukRegion: form.ukRegion || null,
            agentStatus: form.agentStatus || "active",
            membershipTier: form.membershipTier || null,
            businessName: form.businessName || null,
            retailerCode: form.retailerCode || null,
            introducedBy: form.introducedBy || null,
            dateJoined: form.dateJoined || null,
            monthlySub: form.monthlySub || null,
            internalNotes: form.internalNotes || null,
            trainingStage: form.trainingStage || null,
          })} disabled={updateProfile.isPending}>
            {updateProfile.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
      {dialogs}
    </>
  );
}


// ─── Supplier Access Tab ──────────────────────────────────────────────────────

function SupplierAccessTab({ userId, supplierLogins, onRefresh }: {
  userId: number;
  supplierLogins: Array<{ id: number; supplierName: string; notes?: string | null }>;
  onRefresh: () => void;
}) {
  // Optimistic local state — mirrors server state but updates immediately on click
  const [optimisticEnabled, setOptimisticEnabled] = useState<Set<string>>(() => new Set(supplierLogins.map(l => l.supplierName)));
  const [optimisticLogins, setOptimisticLogins] = useState(supplierLogins);

  // Track whether a mutation is in-flight so we don't overwrite optimistic state mid-request
  const mutationPendingRef = useRef(false);

  // Sync from server when supplierLogins prop changes (after refetch) — but not while a mutation is pending
  useEffect(() => {
    if (!mutationPendingRef.current) {
      setOptimisticEnabled(new Set(supplierLogins.map(l => l.supplierName)));
      setOptimisticLogins(supplierLogins);
    }
  }, [supplierLogins]);

  const addLogin = trpc.crm.agentCrm.addSupplierLogin.useMutation({
    onSuccess: () => {
      mutationPendingRef.current = false;
      onRefresh();
    },
    onError: (e) => {
      mutationPendingRef.current = false;
      toast.error(e.message);
      // Revert optimistic update on error
      setOptimisticEnabled(new Set(supplierLogins.map(l => l.supplierName)));
      setOptimisticLogins(supplierLogins);
    },
  });
  const deleteLogin = trpc.crm.agentCrm.deleteSupplierLogin.useMutation({
    onSuccess: () => {
      mutationPendingRef.current = false;
      onRefresh();
    },
    onError: (e) => {
      mutationPendingRef.current = false;
      toast.error(e.message);
      // Revert optimistic update on error
      setOptimisticEnabled(new Set(supplierLogins.map(l => l.supplierName)));
      setOptimisticLogins(supplierLogins);
    },
  });

  function toggle(supplier: string) {
    mutationPendingRef.current = true;
    if (optimisticEnabled.has(supplier)) {
      // Optimistically remove
      const newEnabled = new Set(optimisticEnabled);
      newEnabled.delete(supplier);
      setOptimisticEnabled(newEnabled);
      const login = optimisticLogins.find(l => l.supplierName === supplier);
      if (login) deleteLogin.mutate({ id: login.id });
    } else {
      // Optimistically add
      const newEnabled = new Set(optimisticEnabled);
      newEnabled.add(supplier);
      setOptimisticEnabled(newEnabled);
      addLogin.mutate({ userId, supplierName: supplier });
    }
  }

  const isPending = addLogin.isPending || deleteLogin.isPending;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Select which supplier portals this agent has access to.</p>
      <div className="grid grid-cols-1 gap-2">
        {SUPPLIERS.map((supplier) => {
          const enabled = optimisticEnabled.has(supplier);
          return (
            <div
              key={supplier}
              className={`flex items-center justify-between p-3.5 rounded-lg border transition-colors ${
                isPending ? "cursor-wait opacity-80" : "cursor-pointer"
              } ${
                enabled
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-muted/20 hover:bg-muted/40"
              }`}
              onClick={() => !isPending && toggle(supplier)}
            >
              <div className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded flex items-center justify-center border ${
                  enabled ? "bg-primary border-primary" : "border-muted-foreground/40"
                }`}>
                  {enabled && <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                </div>
                <span className={`text-sm font-medium ${enabled ? "text-foreground" : "text-muted-foreground"}`}>{supplier}</span>
              </div>
              {enabled && (
                <Badge variant="secondary" className="text-xs">Access granted</Badge>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Bank Details Tab ─────────────────────────────────────────────────────────

function BankDetailsTab({ userId, profile, onRefresh }: { userId: number; profile: CrmProfile | null; onRefresh: () => void; }) {
  const [editing, setEditing] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [showAcc, setShowAcc] = useState(false);
  const [form, setForm] = useState({ bankAccountName: "", bankSortCode: "", bankAccountNumber: "" });

  const updateProfile = trpc.crm.agentCrm.updateProfile.useMutation({
    onSuccess: () => { toast.success("Bank details saved"); setEditing(false); onRefresh(); },
    onError: (e) => toast.error(e.message),
  });

  function startEdit() {
    setForm({ bankAccountName: profile?.bankAccountName ?? "", bankSortCode: "", bankAccountNumber: "" });
    setEditing(true);
  }

  if (!editing) {
    const hasBankDetails = profile?.bankAccountName || profile?.bankSortCode || profile?.bankAccountNumber;
    return (
      <div className="space-y-5">
        {hasBankDetails ? (
          <Section title="Bank Account">
            <div className="space-y-3">
              <Field label="Account Name" value={profile?.bankAccountName} />
              {profile?.bankSortCode && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Sort Code</p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono">{showSort ? profile.bankSortCode : "••-••-••"}</span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowSort(!showSort)}>
                      {showSort ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              )}
              {profile?.bankAccountNumber && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Account Number</p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono">{showAcc ? profile.bankAccountNumber : "••••••••"}</span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowAcc(!showAcc)}>
                      {showAcc ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Section>
        ) : (
          <div className="text-center py-10 text-muted-foreground border-2 border-dashed rounded-xl">
            <Banknote className="h-10 w-10 mx-auto mb-2 opacity-20" />
            <p className="text-sm font-medium">No bank details on file</p>
          </div>
        )}
        <Button size="sm" variant="outline" onClick={startEdit}>
          <Pencil className="h-3.5 w-3.5 mr-1.5" />Update Bank Details
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-400">
        Bank details are encrypted at rest. Leave sort code / account number blank to keep existing values.
      </div>
      <div className="space-y-3">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Account Name</Label>
          <Input value={form.bankAccountName} onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Sort Code</Label>
          <Input value={form.bankSortCode} onChange={(e) => setForm({ ...form, bankSortCode: e.target.value })} placeholder="Leave blank to keep existing" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Account Number</Label>
          <Input value={form.bankAccountNumber} onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })} placeholder="Leave blank to keep existing" />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
        <Button size="sm" onClick={() => updateProfile.mutate({
          userId,
          bankAccountName: form.bankAccountName || null,
          ...(form.bankSortCode ? { bankSortCode: form.bankSortCode } : {}),
          ...(form.bankAccountNumber ? { bankAccountNumber: form.bankAccountNumber } : {}),
        })} disabled={updateProfile.isPending}>
          {updateProfile.isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ─── Docs Tab ─────────────────────────────────────────────────────────────────

type ContractData = { signatureDataUrl?: string | null; signerName?: string | null; signerAddress?: string | null; contractSignedAt?: Date | null; } | null;

type TermsRecord = { id: number; versionLabel: string; signedName: string | null; signedAt: Date | null; ipAddress: string | null; userAgent: string | null; signatureImage: string | null; description: string | null; };

function TermsCertificateModal({ record, agentEmail, agentUserId, onClose }: { record: TermsRecord; agentEmail: string | null; agentUserId: number; onClose: () => void; }) {
  const certRef = useRef<HTMLDivElement>(null);
  const refNumber = `JLT-SIGN-${record.id.toString().padStart(6, "0")}`;
  const { format } = { format: (d: Date, fmt: string) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return fmt
      .replace("d MMMM yyyy 'at' HH:mm:ss 'UTC'", `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} at ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`)
      .replace("d MMMM yyyy 'at' HH:mm 'UTC'", `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} at ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`);
  }};
  const handlePrint = () => {
    const content = certRef.current?.innerHTML;
    if (!content) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Signing Certificate — ${record.signedName}</title><style>body{font-family:'Times New Roman',serif;margin:40px;color:#000}.cert-header{text-align:center;border-bottom:2px solid #000;padding-bottom:20px;margin-bottom:24px}.cert-header h1{font-size:22px;font-weight:bold;margin:0 0 4px}.cert-ref{background:#f5f5f5;border:1px solid #ddd;padding:10px 16px;font-family:monospace;font-size:13px;margin:16px 0}.cert-statement{background:#f9f9f9;border-left:4px solid #000;padding:12px 16px;margin:20px 0;font-style:italic}.cert-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:20px 0}.cert-field label{font-weight:bold;display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#555}.cert-field span{font-size:14px}.cert-footer{margin-top:32px;border-top:1px solid #ccc;padding-top:16px;font-size:11px;color:#666}</style></head><body>${content}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScrollText className="h-5 w-5" />Signing Certificate</DialogTitle>
        </DialogHeader>
        <div ref={certRef} className="font-serif text-sm text-foreground">
          <div className="text-center border-b-2 border-foreground pb-5 mb-6">
            <h1 className="text-xl font-bold tracking-tight">ELECTRONIC SIGNING CERTIFICATE</h1>
            <p className="text-muted-foreground text-xs mt-1">JLT Group — Agent Agreement &amp; Terms and Conditions</p>
          </div>
          <div className="bg-muted border rounded px-4 py-2 font-mono text-sm mb-5">Reference: <strong>{refNumber}</strong></div>
          <div className="border-l-4 border-foreground pl-4 py-2 bg-muted/30 italic text-sm mb-5">
            This certificate confirms that the individual named below has reviewed and electronically accepted the JLT Group Agent Agreement and Terms &amp; Conditions in the version stated. This record constitutes a legally binding electronic signature under the Electronic Communications Act 2000.
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 mb-5">
            <div><label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground block mb-0.5">Full Name (as signed)</label><span className="text-base font-medium">{record.signedName}</span></div>
            <div><label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground block mb-0.5">Account Email</label><span className="text-base">{agentEmail}</span></div>
            <div><label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground block mb-0.5">Terms Version</label><span className="text-base font-medium">{record.versionLabel}</span></div>
            <div><label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground block mb-0.5">Date &amp; Time of Signing</label><span className="text-base">{record.signedAt ? format(new Date(record.signedAt), "d MMMM yyyy 'at' HH:mm:ss 'UTC'") : "—"}</span></div>
            <div><label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground block mb-0.5">IP Address</label><span className="text-base font-mono">{record.ipAddress ?? "Not recorded"}</span></div>
            <div><label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground block mb-0.5">User ID</label><span className="text-base font-mono">#{agentUserId}</span></div>
          </div>
          {record.userAgent && <div className="mb-5"><label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground block mb-0.5">Browser / Device</label><span className="text-xs font-mono text-muted-foreground break-all">{record.userAgent}</span></div>}
          <div className="border-t pt-4 mt-4 text-xs text-muted-foreground">
            <p>This certificate was generated by the JLT Group Booking Portal. The signing record is stored securely in the JLT Group database and includes a cryptographic audit trail. This document may be used as evidence of the agent's acceptance of the terms in any dispute resolution process.</p>
            <p className="mt-2"><strong>Issued by:</strong> Janine Loves Ltd t/a JLT Group (Company No. 12178075) &nbsp;·&nbsp; <strong>Certificate generated:</strong> {format(new Date(), "d MMMM yyyy 'at' HH:mm 'UTC'")}</p>
          </div>
        </div>
        <DialogFooter className="flex gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handlePrint} className="gap-2"><Printer className="h-4 w-4" />Print / Save as PDF</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocsTab({ userId, profile, contractData, onRefresh }: { userId: number; profile: CrmProfile | null; contractData: ContractData; onRefresh: () => void; }) {
  const idRef = useRef<HTMLInputElement>(null);
  const poaRef = useRef<HTMLInputElement>(null);
  const [showSignature, setShowSignature] = useState(false);
  const [showTermsSig, setShowTermsSig] = useState<Record<number, boolean>>({});
  const [selectedTermsRecord, setSelectedTermsRecord] = useState<TermsRecord | null>(null);
  const { data: termsHistory, isLoading: termsLoading } = trpc.terms.getAgentSigningHistory.useQuery({ userId });
  const uploadDoc = trpc.crm.agentCrm.uploadIdDoc.useMutation({
    onSuccess: () => { toast.success("Document uploaded"); onRefresh(); },
    onError: (e) => toast.error(e.message),
  });

  async function handleUpload(type: "id" | "proof_of_address", file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadDoc.mutate({ userId, docType: type, fileBase64: base64, fileName: file.name, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-6">
      {/* Contract documents section */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Signed Contract</h3>
        {contractData ? (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Membership Contract</p>
                {contractData.contractSignedAt && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Signed {new Date(contractData.contractSignedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                    {contractData.signerName ? ` by ${contractData.signerName}` : ""}
                  </p>
                )}
                {contractData.signerAddress && (
                  <p className="text-xs text-muted-foreground mt-0.5">{contractData.signerAddress}</p>
                )}
              </div>
              {contractData.signatureDataUrl && (
                <Button size="sm" variant="outline" onClick={() => setShowSignature(!showSignature)} className="shrink-0">
                  <Eye className="h-3.5 w-3.5 mr-1.5" />{showSignature ? "Hide" : "View"} Signature
                </Button>
              )}
            </div>
            {showSignature && contractData.signatureDataUrl && (
              <div className="border rounded-md p-3 bg-white">
                <p className="text-xs text-muted-foreground mb-2">Drawn signature:</p>
                <img
                  src={contractData.signatureDataUrl}
                  alt="Contract signature"
                  className="max-h-24 border rounded"
                  style={{ background: "white" }}
                />
              </div>
            )}
            {/* Legal evidence link */}
            <div className="pt-1 border-t">
              <Link href={`/crm/agents/${userId}/contract-evidence`}>
                <Button size="sm" variant="outline" className="w-full gap-2 text-primary border-primary/30 hover:bg-primary/5">
                  <Shield className="h-3.5 w-3.5" />
                  View Full Legal Evidence Record
                  <ExternalLink className="h-3 w-3 ml-auto" />
                </Button>
              </Link>
              <p className="text-xs text-muted-foreground mt-1.5 text-center">
                Full audit trail: IP address, browser, consent confirmation, contract snapshot &amp; integrity hash
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-center">
            <FileText className="h-6 w-6 mx-auto mb-1.5 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">No signed contract found</p>
            <p className="text-xs text-muted-foreground mt-0.5">Agent may have joined before the self-sign-up flow was introduced.</p>
          </div>
        )}
      </div>

      <Separator />

      {/* Identity documents section */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Identity Documents</h3>
        <DocUploadRow
          label="ID Document"
          description="Passport, driving licence, or national ID"
          url={resolveDocUrl(profile?.idDocUrl)}
          inputRef={idRef}
          onUpload={(f) => handleUpload("id", f)}
          loading={uploadDoc.isPending}
        />
        <Separator />
        <DocUploadRow
          label="Proof of Address"
          description="Utility bill or bank statement (within 3 months)"
          url={resolveDocUrl(profile?.proofOfAddressUrl)}
          inputRef={poaRef}
          onUpload={(f) => handleUpload("proof_of_address", f)}
          loading={uploadDoc.isPending}
        />
      </div>

      <Separator />

      {/* Terms signing history */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Terms &amp; Conditions Signings</h3>
        {termsLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !termsHistory?.length ? (
          <div className="rounded-lg border border-dashed p-4 text-center">
            <FileSignature className="h-6 w-6 mx-auto mb-1.5 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">No terms signed yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {termsHistory.map((record) => (
              <div key={record.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{record.versionLabel}</p>
                    {record.signedAt && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Signed {new Date(record.signedAt).toLocaleString("en-GB", {
                          day: "numeric", month: "long", year: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                        {record.signedName ? ` by ${record.signedName}` : ""}
                      </p>
                    )}
                    {record.ipAddress && (
                      <p className="text-xs text-muted-foreground mt-0.5">IP: {record.ipAddress}</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {record.signatureImage && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowTermsSig(prev => ({ ...prev, [record.id]: !prev[record.id] }))}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1.5" />
                        {showTermsSig[record.id] ? "Hide" : "View"} Signature
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => setSelectedTermsRecord(record as TermsRecord)}
                    >
                      <ScrollText className="h-3.5 w-3.5" />
                      Certificate
                    </Button>
                  </div>
                </div>
                {showTermsSig[record.id] && record.signatureImage && (
                  <div className="border rounded-md p-3 bg-white">
                    <p className="text-xs text-muted-foreground mb-2">Drawn signature:</p>
                    <img
                      src={record.signatureImage}
                      alt="Terms signature"
                      className="max-h-24 border rounded"
                      style={{ background: "white" }}
                    />
                  </div>
                )}
                {record.userAgent && (
                  <p className="text-xs text-muted-foreground border-t pt-2 truncate">
                    Browser: {record.userAgent}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Terms Certificate Modal */}
      {selectedTermsRecord && (
        <TermsCertificateModal
          record={selectedTermsRecord}
          agentEmail={profile?.jltEmail ?? profile?.personalEmail ?? profile?.businessEmail ?? null}
          agentUserId={userId}
          onClose={() => setSelectedTermsRecord(null)}
        />
      )}
    </div>
  );
}

function DocUploadRow({ label, description, url, inputRef, onUpload, loading }: {
  label: string; description: string; url?: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>; onUpload: (f: File) => void; loading: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline mt-1 inline-block">
            View uploaded document
          </a>
        )}
      </div>
      <div className="shrink-0">
        <input ref={inputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { if (e.target.files?.[0]) onUpload(e.target.files[0]); }} />
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={loading}>
          <Upload className="h-3.5 w-3.5 mr-1.5" />{url ? "Replace" : "Upload"}
        </Button>
      </div>
    </div>
  );
}

// ─── Tags Tab ─────────────────────────────────────────────────────────────────

function TagsTab({ userId, tags, onRefresh }: { userId: number; tags: string[]; onRefresh: () => void; }) {
  const [customTag, setCustomTag] = useState("");
  const addTag = trpc.crm.agentCrm.addTag.useMutation({
    onSuccess: () => { onRefresh(); setCustomTag(""); },
    onError: (e) => toast.error(e.message),
  });
  const removeTag = trpc.crm.agentCrm.removeTag.useMutation({
    onSuccess: onRefresh,
    onError: (e) => toast.error(e.message),
  });

  const PRESET_TAGS = ["agent", "core team", "cancelled", "inactive", "vip", "new", "prospect"];

  return (
    <div className="space-y-5">
      <Section title="Current Tags">
        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tags assigned</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1.5 pr-1.5">
                {tag}
                <button onClick={() => removeTag.mutate({ userId, tag })} className="hover:text-destructive transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </Section>

      <Section title="Quick Add">
        <div className="flex flex-wrap gap-2">
          {PRESET_TAGS.filter(t => !tags.includes(t)).map((tag) => (
            <button
              key={tag}
              onClick={() => addTag.mutate({ userId, tag })}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-muted-foreground/40 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            >
              <Plus className="h-3 w-3" />{tag}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Custom Tag">
        <div className="flex gap-2">
          <Input
            value={customTag}
            onChange={(e) => setCustomTag(e.target.value)}
            placeholder="Type a custom tag..."
            onKeyDown={(e) => { if (e.key === "Enter" && customTag.trim()) addTag.mutate({ userId, tag: customTag.trim() }); }}
          />
          <Button size="sm" onClick={() => { if (customTag.trim()) addTag.mutate({ userId, tag: customTag.trim() }); }} disabled={!customTag.trim() || addTag.isPending}>
            Add
          </Button>
        </div>
      </Section>
    </div>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value, icon, children }: { label: string; value?: string | null; icon?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <div className="flex items-center gap-1.5">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        {children ?? <p className="text-sm font-medium">{value || <span className="text-muted-foreground font-normal">—</span>}</p>}
      </div>
    </div>
  );
}

function ActivityTab({ userId }: { userId: number }) {
  const { data, isLoading } = trpc.crm.agentCrm.getActivity.useQuery({ userId });

  if (isLoading) return (
    <div className="space-y-4">
      {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}
    </div>
  );

  if (!data) return <p className="text-sm text-muted-foreground">No activity data available.</p>;

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Total Bookings</p>
          <p className="text-2xl font-bold">{data.bookings.total}</p>
          <p className="text-xs text-muted-foreground">{data.bookings.active} active</p>
        </div>
        <div className="rounded-lg border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Booking Value</p>
          <p className="text-2xl font-bold">{fmt(data.bookings.totalValue)}</p>
          {data.bookings.lastBookingDate && (
            <p className="text-xs text-muted-foreground">Last: {new Date(data.bookings.lastBookingDate).toLocaleDateString("en-GB")}</p>
          )}
        </div>
        <div className="rounded-lg border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Commission Paid</p>
          <p className="text-2xl font-bold">{fmt(data.commissions.totalPaid)}</p>
          <p className="text-xs text-amber-600 dark:text-amber-400">{fmt(data.commissions.outstanding)} outstanding</p>
        </div>
        <div className="rounded-lg border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Reimbursements</p>
          <p className="text-2xl font-bold">{fmt(data.reimbursements.paid)}</p>
          <p className="text-xs text-muted-foreground">{fmt(data.reimbursements.pending)} pending</p>
        </div>
      </div>

      {/* Refunds row */}
      {data.refunds.total > 0 && (
        <div className="rounded-lg border bg-card p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Refund Requests</p>
            <p className="text-lg font-semibold">{data.refunds.total} total</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{data.refunds.completed} completed</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">{data.refunds.pending} pending</p>
          </div>
        </div>
      )}

      {/* Recent bookings */}
      {data.recentBookings.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recent Bookings</h3>
          <div className="space-y-2">
            {data.recentBookings.map((b: any) => (
              <div key={b.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{b.clientName}</p>
                  <p className="text-xs text-muted-foreground">{b.bookingType} · {new Date(b.createdAt).toLocaleDateString("en-GB")}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{fmt(parseFloat(b.grossCost ?? 0))}</p>
                  <p className="text-xs text-muted-foreground">{b.currentStage}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity feed */}
      {data.feed.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Activity Feed</h3>
          <div className="space-y-2">
            {data.feed.map((item: any, i: number) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <div className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${
                  item.type === "booking" ? "bg-blue-500" :
                  item.type === "commission" ? "bg-emerald-500" :
                  item.type === "refund" ? "bg-amber-500" : "bg-muted-foreground"
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.meta} · {new Date(item.date).toLocaleDateString("en-GB")}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.bookings.total === 0 && data.commissions.totalClaimed === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No portal activity recorded for this agent yet.</p>
      )}
    </div>
  );
}

// ─── Team Tab ─────────────────────────────────────────────────────────────────

function TeamTab({ userId, profile, onRefresh }: { userId: number; profile: CrmProfile | null; onRefresh: () => void; }) {
  const utils = trpc.useUtils();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamTier, setTeamTier] = useState("");
  const [teamSub, setTeamSub] = useState("");
  const [teamNotes, setTeamNotes] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [createSearchQuery, setCreateSearchQuery] = useState("");
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<number[]>([]);

  const teamId = profile?.teamId ?? null;

  // Load team data if agent is in a team
  const { data: teamData, isLoading: teamLoading } = trpc.crm.agentCrm.getTeam.useQuery(
    { teamId: teamId! },
    { enabled: !!teamId }
  );

  // Load all agents for the add-member search (also used in create dialog)
  const { data: allAgents } = trpc.crm.agentCrm.list.useQuery(undefined, { enabled: showAddDialog || showCreateDialog });

  const createTeam = trpc.crm.agentCrm.createTeam.useMutation({
    onSuccess: () => { utils.crm.agentCrm.list.invalidate(); onRefresh(); setShowCreateDialog(false); },
  });

  const addMember = trpc.crm.agentCrm.addTeamMember.useMutation({
    onSuccess: () => { utils.crm.agentCrm.getTeam.invalidate(); utils.crm.agentCrm.list.invalidate(); onRefresh(); setShowAddDialog(false); },
  });

  const removeMember = trpc.crm.agentCrm.removeTeamMember.useMutation({
    onSuccess: () => { utils.crm.agentCrm.getTeam.invalidate(); utils.crm.agentCrm.list.invalidate(); onRefresh(); },
  });

  const deleteTeam = trpc.crm.agentCrm.deleteTeam.useMutation({
    onSuccess: () => { utils.crm.agentCrm.list.invalidate(); onRefresh(); },
  });

  const filteredAgents = (allAgents ?? []).filter(a =>
    a.id !== userId &&
    !a.crmProfile?.teamId &&
    (a.name?.toLowerCase().includes(searchQuery.toLowerCase()) || a.email?.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (teamLoading && teamId) {
    return <div className="text-sm text-muted-foreground py-6 text-center">Loading team...</div>;
  }

  // Agent is in a team
  if (teamData) {
    return (
      <div className="space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-base">{teamData.name}</h3>
            <div className="flex gap-2 mt-1 flex-wrap">
              {teamData.membershipTier && <Badge variant="secondary">{teamData.membershipTier}</Badge>}
              {teamData.monthlySub && <Badge variant="outline">£{teamData.monthlySub}/mo</Badge>}
            </div>
            {teamData.notes && <p className="text-sm text-muted-foreground mt-2">{teamData.notes}</p>}
          </div>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => {
            if (confirm("Remove this agent from the team?")) removeMember.mutate({ userId });
          }}>Leave Team</Button>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Team Members ({teamData.members.length})</p>
            <Button size="sm" variant="outline" onClick={() => setShowAddDialog(true)}>
              <Plus className="h-3 w-3 mr-1" /> Add Member
            </Button>
          </div>
          <div className="space-y-2">
            {teamData.members.map(m => (
              <div key={m.userId} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                <div>
                  <p className="text-sm font-medium">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </div>
                {m.userId !== userId && (
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-7 text-xs"
                    onClick={() => { if (confirm(`Remove ${m.name} from this team?`)) removeMember.mutate({ userId: m.userId }); }}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t">
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive text-xs"
            onClick={() => { if (confirm("Delete this entire team? All members will be unlinked.")) deleteTeam.mutate({ teamId: teamData.id }); }}>
            Delete Team
          </Button>
        </div>

        {/* Add member dialog */}
        {showAddDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
              <h3 className="font-semibold mb-4">Add Team Member</h3>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm mb-3 bg-background"
                placeholder="Search agents..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
              />
              <div className="max-h-60 overflow-y-auto space-y-1">
                {filteredAgents.slice(0, 20).map(a => (
                  <button key={a.id} className="w-full text-left px-3 py-2 rounded-lg hover:bg-accent text-sm"
                    onClick={() => addMember.mutate({ teamId: teamData.id, userId: a.id })}>
                    <span className="font-medium">{a.name}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{a.email}</span>
                  </button>
                ))}
                {filteredAgents.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No unassigned agents found</p>}
              </div>
              <div className="flex justify-end mt-4">
                <Button variant="outline" size="sm" onClick={() => { setShowAddDialog(false); setSearchQuery(""); }}>Cancel</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Agent is not in a team
  return (
    <div className="space-y-5">
      <div className="text-center py-6 border-2 border-dashed rounded-xl">
        <User className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm font-medium">Not part of a team</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4">Create a new team or add this agent to an existing one</p>
        <Button size="sm" onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-3 w-3 mr-1" /> Create Team
        </Button>
      </div>

      {/* Create team dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold mb-4">Create New Team</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Team Name *</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-background" placeholder="e.g. Smith Travel Duo"
                  value={teamName} onChange={e => setTeamName(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Membership Tier</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-background"
                  value={teamTier} onChange={e => setTeamTier(e.target.value)}>
                  <option value="">Select tier...</option>
                  <option>Business Duo</option>
                  <option>Business Trio</option>
                  <option>First Class Duo</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Monthly Subscription (£)</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-background" placeholder="e.g. 174"
                  value={teamSub} onChange={e => setTeamSub(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes</label>
                <textarea className="w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-background resize-none" rows={2}
                  value={teamNotes} onChange={e => setTeamNotes(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add Team Members</label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">Select the other agent(s) to include alongside the current agent.</p>
                {selectedPartnerIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {selectedPartnerIds.map(pid => {
                      const agent = (allAgents ?? []).find(a => a.id === pid);
                      return agent ? (
                        <span key={pid} className="inline-flex items-center gap-1 bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                          {agent.name}
                          <button onClick={() => setSelectedPartnerIds(ids => ids.filter(id => id !== pid))} className="hover:text-destructive ml-0.5">×</button>
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm mb-1 bg-background"
                  placeholder="Search agents..."
                  value={createSearchQuery}
                  onChange={e => setCreateSearchQuery(e.target.value)}
                />
                <div className="max-h-36 overflow-y-auto space-y-0.5 border rounded-lg p-1">
                  {(allAgents ?? []).filter(a =>
                    a.id !== userId &&
                    !a.crmProfile?.teamId &&
                    !selectedPartnerIds.includes(a.id) &&
                    (createSearchQuery === "" || a.name?.toLowerCase().includes(createSearchQuery.toLowerCase()) || a.email?.toLowerCase().includes(createSearchQuery.toLowerCase()))
                  ).slice(0, 15).map(a => (
                    <button key={a.id} className="w-full text-left px-3 py-2 rounded-lg hover:bg-accent text-sm"
                      onClick={() => { setSelectedPartnerIds(ids => [...ids, a.id]); setCreateSearchQuery(""); }}>
                      <span className="font-medium">{a.name}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{a.email}</span>
                    </button>
                  ))}
                  {(allAgents ?? []).filter(a => a.id !== userId && !a.crmProfile?.teamId && !selectedPartnerIds.includes(a.id)).length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-3">No unassigned agents available</p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => { setShowCreateDialog(false); setSelectedPartnerIds([]); setCreateSearchQuery(""); }}>Cancel</Button>
              <Button size="sm" disabled={!teamName.trim() || createTeam.isPending}
                onClick={() => createTeam.mutate({ name: teamName, membershipTier: teamTier || undefined, monthlySub: teamSub || undefined, notes: teamNotes || undefined, memberUserIds: [userId, ...selectedPartnerIds] })}>
                {createTeam.isPending ? "Creating..." : `Create Team${selectedPartnerIds.length > 0 ? ` (${selectedPartnerIds.length + 1} members)` : ""}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Status History Tab ───────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  in_notice: "In Notice",
  cancelled: "Cancelled",
  suspended: "Suspended",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  in_notice: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  suspended: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
};

function StatusPill({ status }: { status: string | null | undefined }) {
  const s = status ?? "unknown";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[s] ?? "bg-muted text-muted-foreground"}`}>
      {STATUS_LABELS[s] ?? s}
    </span>
  );
}

function StatusHistoryTab({ userId }: { userId: number }) {
  const { data: events = [], isLoading } = trpc.crm.agentCrm.getStatusHistory.useQuery({ userId });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-20" />
        <p className="text-sm">No status changes recorded yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event, idx) => {
        const date = event.createdAt ? new Date(event.createdAt) : null;
        const checklist = Array.isArray(event.cancelChecklist) ? event.cancelChecklist as string[] : [];
        return (
          <div
            key={event.id ?? idx}
            className="relative flex gap-4 pb-3"
          >
            {/* Timeline line */}
            {idx < events.length - 1 && (
              <div className="absolute left-4 top-8 bottom-0 w-px bg-border" />
            )}

            {/* Timeline dot */}
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted border-2 border-border flex items-center justify-center z-10">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 bg-card border border-border rounded-lg p-3 shadow-sm">
              {/* Header row */}
              <div className="flex items-center gap-2 flex-wrap">
                <StatusPill status={event.fromStatus} />
                <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <StatusPill status={event.toStatus} />
                <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                  {date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                </span>
              </div>

              {/* Admin */}
              {event.adminName && (
                <p className="text-xs text-muted-foreground mt-1">
                  Changed by <span className="font-medium text-foreground">{event.adminName}</span>
                </p>
              )}

              {/* Date fields */}
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
                {event.pauseEndsAt && (
                  <p className="text-xs text-muted-foreground">
                    Pause ends: <span className="font-medium text-foreground">
                      {new Date(event.pauseEndsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </p>
                )}
                {event.noticeEndsAt && (
                  <p className="text-xs text-muted-foreground">
                    Final date: <span className="font-medium text-foreground">
                      {new Date(event.noticeEndsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </p>
                )}
                {event.cancelledAt && (
                  <p className="text-xs text-muted-foreground">
                    Departed: <span className="font-medium text-foreground">
                      {new Date(event.cancelledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </p>
                )}
              </div>

              {/* Checklist (for cancellations) */}
              {checklist.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {checklist.map((item) => (
                    <span key={item} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                      <CheckSquare className="h-2.5 w-2.5 text-emerald-500" /> {item}
                    </span>
                  ))}
                </div>
              )}

              {/* Notes */}
              {event.notes && (
                <p className="text-xs text-muted-foreground mt-1.5 italic">"{event.notes}"</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Direct Debit Tab ─────────────────────────────────────────────────────────

function DirectDebitTab({ userId, mandate: initialMandate }: { userId: number; mandate: any }) {
  const utils = trpc.useUtils();
  const [localMandate, setLocalMandate] = useState<any>(initialMandate);
  const mandate = localMandate;
  const { data: paymentEvents, isLoading } = trpc.gocardless.adminGetPaymentEvents.useQuery(
    { userId },
    { enabled: true }
  );
  const { data: ddStatus, refetch: refetchDdStatus } = trpc.gocardless.adminGetDdStatus.useQuery({ userId });
  const subscription = ddStatus?.subscription;

  const [showCreateSub, setShowCreateSub] = useState(false);
  const [createSubDay, setCreateSubDay] = useState<number>(mandate?.preferredPaymentDay ?? 1);
  const [manualMandateId, setManualMandateId] = useState<string>(mandate?.mandateId ?? "");
  const createSubMutation = trpc.gocardless.adminCreateSubscription.useMutation({
    onSuccess: () => {
      setShowCreateSub(false);
      refetchDdStatus();
      utils.gocardless.adminListMandates.invalidate();
    },
  });
  const refreshMutation = trpc.gocardless.adminRefreshMandateStatus.useMutation({
    onSuccess: (data) => {
      setLocalMandate((prev: any) => prev ? { ...prev, status: data.status } : { mandateId: data.mandateId, status: data.status });
      refetchDdStatus();
      toast.success(`Mandate status updated: ${data.status}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const formatEventType = (type: string) => {
    const map: Record<string, string> = {
      payments_failed: "Payment Failed",
      payments_charged_back: "Payment Charged Back",
      mandates_cancelled: "Mandate Cancelled",
      mandates_failed: "Mandate Failed",
      mandates_expired: "Mandate Expired",
    };
    return map[type] ?? type;
  };

  const eventBadgeColor = (type: string) => {
    if (type.includes("failed") || type.includes("charged_back")) return "bg-red-100 text-red-700";
    if (type.includes("cancelled") || type.includes("expired")) return "bg-orange-100 text-orange-700";
    return "bg-gray-100 text-gray-700";
  };

  return (
    <div className="space-y-6">
      {/* Mandate Status */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <CreditCard size={14} />
          Mandate Status
        </h3>
        {mandate ? (
          <div className="rounded-lg border p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                mandate.status === "active" ? "bg-teal-100 text-teal-800" :
                mandate.status === "pending" ? "bg-blue-100 text-blue-800" :
                mandate.status === "cancelled" ? "bg-red-100 text-red-800" :
                "bg-gray-100 text-gray-700"
              }`}>{mandate.status}</span>
            </div>
            {mandate.mandateId && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mandate ID</span>
                <span className="font-mono text-xs">{mandate.mandateId}</span>
              </div>
            )}
            {mandate.preferredPaymentDay && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Preferred Payment Day</span>
                <span>{mandate.preferredPaymentDay}{["st","nd","rd"][mandate.preferredPaymentDay - 1] ?? "th"} of month</span>
              </div>
            )}
            {mandate.joiningFeePaidAt && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Joining Fee Paid</span>
                <span>{new Date(mandate.joiningFeePaidAt).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No Direct Debit mandate set up yet.
          </div>
        )}

        {/* Refresh status button — shown when mandate exists but is not yet active */}
        {mandate && mandate.status !== "active" && mandate.status !== "cancelled" && mandate.status !== "expired" && (
          <div className="mt-2">
            <button
              onClick={() => refreshMutation.mutate({ userId })}
              disabled={refreshMutation.isPending}
              className="text-xs text-blue-600 hover:text-blue-800 underline disabled:opacity-50"
            >
              {refreshMutation.isPending ? "Refreshing..." : "↻ Refresh status from GoCardless"}
            </button>
          </div>
        )}
        {/* Manual subscription creation — shown when mandate exists (any non-cancelled/expired status) OR no mandate at all */}
        {(!mandate || (!subscription && mandate?.status !== "cancelled" && mandate?.status !== "expired")) && (
          <div className="mt-3">
            {!showCreateSub ? (
              <button
                onClick={() => setShowCreateSub(true)}
                className="w-full text-sm border border-dashed rounded-lg px-4 py-2 text-teal-700 hover:bg-teal-50 transition-colors"
              >
                + {mandate ? "Create Subscription Manually" : "Set Up Direct Debit Manually"}
              </button>
            ) : (
              <div className="rounded-lg border p-4 space-y-3 text-sm bg-muted/30">
                <p className="font-medium">Create GoCardless Subscription</p>
                {!mandate && (
                  <div className="space-y-1">
                    <label className="text-muted-foreground text-xs block">GoCardless Mandate ID <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={manualMandateId}
                      onChange={(e) => setManualMandateId(e.target.value)}
                      placeholder="MD01XXXXXXXXXXXXXXXX"
                      className="w-full border rounded px-2 py-1 text-sm bg-background font-mono"
                    />
                    <p className="text-xs text-muted-foreground">Paste the mandate ID from the GoCardless dashboard</p>
                  </div>
                )}
                {ddStatus?.mandate?.scheme === "faster_payments" ? (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    <strong>Faster Payments mandate</strong> — payment day selection is not supported for this mandate type. GoCardless will determine the charge date automatically.
                  </p>
                ) : (
                  <div className="flex items-center gap-3">
                    <label className="text-muted-foreground whitespace-nowrap">Payment day:</label>
                    <select
                      value={createSubDay}
                      onChange={(e) => setCreateSubDay(Number(e.target.value))}
                      className="border rounded px-2 py-1 text-sm bg-background"
                    >
                      {[1, 15, 28].map((d) => (
                        <option key={d} value={d}>{d === 1 ? "1st" : d === 15 ? "15th" : "28th"} of month</option>
                      ))}
                    </select>
                  </div>
                )}
                {createSubMutation.error && (
                  <p className="text-red-600 text-xs">{createSubMutation.error.message}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => createSubMutation.mutate({ userId, dayOfMonth: createSubDay, mandateId: mandate ? undefined : (manualMandateId || undefined) })}
                    disabled={createSubMutation.isPending || (!mandate && !manualMandateId.trim())}
                    className="px-3 py-1.5 rounded bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 disabled:opacity-50"
                  >
                    {createSubMutation.isPending ? "Creating..." : "Confirm & Create"}
                  </button>
                  <button
                    onClick={() => setShowCreateSub(false)}
                    className="px-3 py-1.5 rounded border text-xs hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Subscription */}
      {subscription && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Calendar size={14} />
            Subscription
          </h3>
          <div className="rounded-lg border p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span>£{(subscription.amount / 100).toFixed(2)} / month</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Start Date</span>
              <span>{subscription.startDate}</span>
            </div>
            {subscription.nextChargeDate && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Next Charge</span>
                <span>{subscription.nextChargeDate}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subscription ID</span>
              <span className="font-mono text-xs">{subscription.subscriptionId}</span>
            </div>
          </div>
        </div>
      )}

      {/* Payment Event History */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Clock size={14} />
          Payment Event History
        </h3>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : !paymentEvents || paymentEvents.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No payment events recorded.
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Event</TableHead>
                  <TableHead className="text-xs">Amount</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentEvents.map((ev: any) => (
                  <TableRow key={ev.id}>
                    <TableCell className="text-xs">{new Date(ev.occurredAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${eventBadgeColor(ev.eventType)}`}>
                        {formatEventType(ev.eventType)}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {ev.amount != null ? `£${(ev.amount / 100).toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                      {ev.failureDescription ?? ev.failureReason ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Admin Onboarding Checklist Tab ──────────────────────────────────────────

const ONBOARDING_STEPS = [
  { key: "trainingHubLogin" as const, label: "Create Training Hub Login", description: "Set up the agent's account on the training platform and send them their login credentials." },
  { key: "jltEmailSetup" as const, label: "Set Up JLT Email", description: "Create the @thejltgroup.co.uk email address based on the agent's preference and configure forwarding." },
  { key: "idDocsReviewed" as const, label: "Review ID Documents", description: "Verify the agent's photo ID and proof of address uploaded during onboarding." },
  { key: "contractReviewed" as const, label: "Review Contract", description: "Confirm the signed membership contract is complete and all details are correct." },
  { key: "welcomeEmailSent" as const, label: "Send Welcome Email", description: "Send the official JLT Group welcome email with key resources and next steps." },
  { key: "portalAccessApproved" as const, label: "Approve Portal Access", description: "Activate the agent's portal access once all other steps are complete." },
  { key: "ddSubscriptionCreated" as const, label: "Set Up Direct Debit Subscription", description: "Create the GoCardless subscription for the agent's monthly membership fee." },
];

type ChecklistKey = typeof ONBOARDING_STEPS[number]["key"];

function AdminOnboardingChecklistTab({ userId, agentName, agentEmail, open, onRefresh }: {
  userId: number; agentName: string; agentEmail: string; open: boolean; onRefresh: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: checklist, isLoading } = trpc.crm.agentCrm.getOnboardingChecklist.useQuery(
    { userId },
    { enabled: open }
  );
  const { data: ddStatus, refetch: refetchDd } = trpc.gocardless.adminGetDdStatus.useQuery(
    { userId },
    { enabled: open }
  );
  // Check for pending team invites for this agent
  const { data: pendingInvite } = trpc.join.adminGetPendingInviteForAgent.useQuery(
    { userId },
    { enabled: open }
  );
  const resendInvite = trpc.join.adminResendTeamInvite.useMutation({
    onSuccess: () => toast.success(`Invite resent to ${agentEmail}`),
    onError: (e) => toast.error(e.message),
  });
  const [subPaymentDay, setSubPaymentDay] = useState<string>("1");
  const [showSubForm, setShowSubForm] = useState(false);
  const createSub = trpc.gocardless.adminCreateSubscription.useMutation({
    onSuccess: () => {
      toast.success("Subscription created successfully");
      refetchDd();
      // Auto-tick the checklist step
      handleToggle("ddSubscriptionCreated", true);
      setShowSubForm(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const [localState, setLocalState] = useState<Record<ChecklistKey, boolean>>({
    trainingHubLogin: false,
    jltEmailSetup: false,
    idDocsReviewed: false,
    contractReviewed: false,
    welcomeEmailSent: false,
    portalAccessApproved: false,
    ddSubscriptionCreated: false,
  });

  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    if (checklist !== undefined && !initialised) {
      // Auto-tick ddSubscriptionCreated if a subscription already exists in GC
      const subExists = !!(ddStatus as any)?.subscription;
      setLocalState({
        trainingHubLogin: checklist?.trainingHubLogin ?? false,
        jltEmailSetup: checklist?.jltEmailSetup ?? false,
        idDocsReviewed: checklist?.idDocsReviewed ?? false,
        contractReviewed: checklist?.contractReviewed ?? false,
        welcomeEmailSent: checklist?.welcomeEmailSent ?? false,
        portalAccessApproved: checklist?.portalAccessApproved ?? false,
        ddSubscriptionCreated: subExists || (checklist?.ddSubscriptionCreated ?? false),
      });
      // Persist the auto-tick to DB if subscription exists but checklist not yet ticked
      if (subExists && !(checklist?.ddSubscriptionCreated)) {
        updateChecklist.mutate({ userId, ddSubscriptionCreated: true });
      }
      setInitialised(true);
    }
  }, [checklist, ddStatus, initialised]);

  const updateChecklist = trpc.crm.agentCrm.updateOnboardingChecklist.useMutation({
    onSuccess: () => {
      utils.crm.agentCrm.getOnboardingChecklist.invalidate({ userId });
      onRefresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const activatePortal = trpc.users.activatePortalAccess.useMutation({
    onSuccess: () => {
      toast.success(`Portal access activated for ${agentName}`);
      onRefresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const sendWelcomeEmailMutation = trpc.crm.agentCrm.sendWelcomeEmail.useMutation({
    onSuccess: () => {
      toast.success("Welcome email sent to agent!");
      setLocalState(prev => ({ ...prev, welcomeEmailSent: true }));
      utils.crm.agentCrm.getOnboardingChecklist.invalidate({ userId });
      onRefresh();
    },
    onError: (e) => toast.error(`Failed to send welcome email: ${e.message}`),
  });

  function handleToggle(key: ChecklistKey, value: boolean) {
    // Welcome email step: send the actual email (which also marks the checklist)
    if (key === "welcomeEmailSent" && value) {
      sendWelcomeEmailMutation.mutate({ userId });
      return;
    }
    const newState = { ...localState, [key]: value };
    setLocalState(newState);
    updateChecklist.mutate({ userId, [key]: value });

    // Auto-activate portal access when that step is ticked
    if (key === "portalAccessApproved" && value) {
      activatePortal.mutate({ userId });
    }
  }

  const completedCount = Object.values(localState).filter(Boolean).length;
  const totalCount = ONBOARDING_STEPS.length;
  const allComplete = completedCount === totalCount;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1,2,3,4,5,6].map(i => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Pending invite banner */}
      {pendingInvite && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-400 flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Team invite not yet signed
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
                {agentName} was invited as a team member but has not yet signed their contract.
                Expires {new Date(pendingInvite.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-amber-400 text-amber-800 hover:bg-amber-100 dark:text-amber-400 dark:border-amber-600 dark:hover:bg-amber-900/30"
              disabled={resendInvite.isPending}
              onClick={() => resendInvite.mutate({
                userId: pendingInvite.leaderId,
                invitedEmail: agentEmail,
                origin: window.location.origin,
              })}
            >
              {resendInvite.isPending ? "Sending..." : "Resend Invite"}
            </Button>
          </div>
        </div>
      )}

      {/* Progress header */}
      <div className={`rounded-xl p-4 ${allComplete ? "bg-emerald-50 border border-emerald-200" : "bg-muted/50 border border-border"}`}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            {allComplete
              ? <CheckCircle2 size={15} className="text-emerald-600" />
              : <Clock size={15} className="text-amber-500" />}
            Admin Onboarding Checklist
          </h3>
          <span className={`text-xs font-medium ${allComplete ? "text-emerald-700" : "text-muted-foreground"}`}>
            {completedCount}/{totalCount} complete
          </span>
        </div>
        <div className="w-full bg-white/60 rounded-full h-1.5 border border-border/40">
          <div
            className="h-1.5 rounded-full transition-all duration-500"
            style={{
              width: `${(completedCount / totalCount) * 100}%`,
              background: allComplete ? "#10b981" : "#70FFE8",
            }}
          />
        </div>
        {allComplete && (
          <p className="text-xs text-emerald-700 mt-2 font-medium">
            All onboarding steps complete for {agentName}.
          </p>
        )}
        {checklist?.updatedAt && checklist?.updatedByName && (
          <p className="text-xs text-muted-foreground mt-1.5">
            Last updated {new Date(checklist.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} by {checklist.updatedByName}
          </p>
        )}
      </div>

      {/* Checklist items */}
      <div className="space-y-2">
        {ONBOARDING_STEPS.map((step, idx) => {
          const done = localState[step.key];
          const isPortalStep = step.key === "portalAccessApproved";
          const isDdStep = step.key === "ddSubscriptionCreated";
          const isEmailStep = step.key === "jltEmailSetup";
          const mandate = (ddStatus as any)?.mandate;
          const subscription = (ddStatus as any)?.subscription;
          const mandateStatusColor = {
            active: "text-emerald-600 bg-emerald-50",
            submitted: "text-blue-600 bg-blue-50",
            pending_submission: "text-amber-600 bg-amber-50",
            pending: "text-amber-600 bg-amber-50",
            cancelled: "text-red-600 bg-red-50",
            failed: "text-red-600 bg-red-50",
            expired: "text-gray-600 bg-gray-50",
          } as Record<string, string>;
          return (
            <div
              key={step.key}
              className={`rounded-lg border p-4 transition-all ${done ? "border-emerald-200 bg-emerald-50/50" : "border-border bg-card"}`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <Checkbox
                    id={`checklist-${step.key}`}
                    checked={done}
                    onCheckedChange={(v) => handleToggle(step.key, !!v)}
                    className={done ? "border-emerald-500 data-[state=checked]:bg-emerald-500" : ""}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor={`checklist-${step.key}`}
                    className={`text-sm font-medium cursor-pointer flex items-center gap-2 ${done ? "line-through text-muted-foreground" : ""}`}
                  >
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0"
                      style={{ background: done ? "#10b981" : "#e5e7eb", color: done ? "white" : "#6b7280" }}>
                      {idx + 1}
                    </span>
                    {step.label}
                    {isPortalStep && !done && (
                      <span className="text-xs text-amber-600 font-normal">(activates portal)</span>
                    )}
                  </label>
                  <p className="text-xs text-muted-foreground mt-0.5 ml-7">{step.description}</p>

                  {/* Inline JLT email preference display */}
                  {isEmailStep && (checklist as any)?.jltEmailPreference && (
                    <div className="ml-7 mt-2 flex items-center gap-2">
                      <Mail size={12} className="text-muted-foreground shrink-0" />
                      <span className="text-xs text-muted-foreground">Requested email:</span>
                      <span className="text-xs font-semibold text-foreground font-mono">{(checklist as any).jltEmailPreference}</span>
                    </div>
                  )}

                  {/* Inline DD subscription panel */}
                  {isDdStep && !done && (
                    <div className="ml-7 mt-3 space-y-2">
                      {/* Mandate status row */}
                      {mandate ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground">Mandate:</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${mandateStatusColor[mandate.status] ?? "text-gray-600 bg-gray-50"}`}>
                            {mandate.status}
                          </span>
                          {mandate.preferredPaymentDay && (
                            <span className="text-xs text-muted-foreground">· Payment day: {mandate.preferredPaymentDay === 1 ? "1st" : mandate.preferredPaymentDay === 15 ? "15th" : "28th"} of month</span>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-amber-600">No mandate found — agent has not completed DD setup.</p>
                      )}

                      {/* Subscription already exists */}
                      {subscription ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={13} className="text-emerald-500" />
                          <span className="text-xs text-emerald-700 font-medium">Subscription active — £{(subscription.amount / 100).toFixed(2)}/mo, {subscription.dayOfMonth === 1 ? "1st" : subscription.dayOfMonth === 15 ? "15th" : "28th"} of month</span>
                        </div>
                      ) : mandate && !showSubForm ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5"
                          onClick={() => {
                            setSubPaymentDay(String(mandate.preferredPaymentDay ?? 1));
                            setShowSubForm(true);
                          }}
                        >
                          <Plus size={12} /> Create Subscription
                        </Button>
                      ) : showSubForm ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground">Payment day:</span>
                          <Select value={subPaymentDay} onValueChange={setSubPaymentDay}>
                            <SelectTrigger className="h-7 w-28 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">1st of month</SelectItem>
                              <SelectItem value="15">15th of month</SelectItem>
                              <SelectItem value="28">28th of month</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            disabled={createSub.isPending}
                            onClick={() => createSub.mutate({ userId, dayOfMonth: parseInt(subPaymentDay) })}
                          >
                            {createSub.isPending ? "Creating..." : "Confirm"}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowSubForm(false)}>Cancel</Button>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* If DD step is done, show subscription summary */}
                  {isDdStep && done && subscription && (
                    <div className="ml-7 mt-1 flex items-center gap-2">
                      <span className="text-xs text-emerald-600">£{(subscription.amount / 100).toFixed(2)}/mo · {subscription.dayOfMonth === 1 ? "1st" : subscription.dayOfMonth === 15 ? "15th" : "28th"} of month</span>
                    </div>
                  )}
                </div>
                {done && <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Ticking "Approve Portal Access" will automatically activate the agent's portal login.
      </p>
    </div>
  );
}


// ─── Agent CRM Notes Tab ──────────────────────────────────────────────────────
function AgentNotesTab({ userId }: { userId: number }) {
  const [noteText, setNoteText] = useState("");
  const utils = trpc.useUtils();
  const { data: notes = [], isLoading } = trpc.crm.agentNotes.list.useQuery({ agentUserId: userId });
  const addNote = trpc.crm.agentNotes.add.useMutation({
    onSuccess: () => {
      setNoteText("");
      utils.crm.agentNotes.list.invalidate({ agentUserId: userId });
    },
    onError: (err) => toast.error(err.message),
  });

  function handleSubmit() {
    const trimmed = noteText.trim();
    addNote.mutate({ agentUserId: userId, content: trimmed });
  }

  return (
    <div className="space-y-5">
      {/* Input area */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 p-4 space-y-3">
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-400 uppercase tracking-wide">Add a note</p>
        <Textarea
          placeholder="Record a call, meeting, or general note about this agent…"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          rows={3}
          className="text-sm resize-none bg-white dark:bg-background"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Ctrl+Enter to submit</span>
          <Button
            size="sm"
            onClick={handleSubmit}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {addNote.isPending ? "Saving…" : "Add Note"}
          </Button>
        </div>
      </div>

      {/* Notes list */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-4">Loading notes…</p>
      ) : notes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-amber-300 dark:border-amber-700 p-8 text-center">
          <p className="text-sm text-muted-foreground">No notes yet. Add the first note above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div
              key={note.id}
              className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/10 p-4"
            >
              <NoteContent content={note.content} />
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-500 font-medium">
                {new Date(note.createdAt).toLocaleString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })} — {note.authorName ?? "Admin"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


