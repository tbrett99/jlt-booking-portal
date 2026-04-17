import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
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
  ChevronDown, X, Pencil
} from "lucide-react";
import { toast } from "sonner";

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
  "Easyjet",
  "Major Travel",
  "MSC",
  "NCL",
  "Every Holiday",
  "Holiday Best",
  "Ace Rooms",
  "Koveli",
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
  topdogRetailerName: string | null;
  topdogRetailerCode: string | null;
  teamId?: number | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postcode?: string | null;
  adminNotes?: string | null;
  idDocUrl?: string | null;
  proofOfAddressUrl?: string | null;
  bankSortCode?: string | null;
  bankAccountNumber?: string | null;
};

type AgentRow = {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  tags: string[];
  crmProfile: CrmProfile | null;
  teamId?: number | null;
};

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
                      <div className="font-medium">{agent.name ?? "—"}</div>
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
  const { data: crmData, refetch: refetchCrm } = trpc.crm.agentCrm.get.useQuery(
    { userId: agent.id },
    { enabled: open }
  );
  function refresh() { refetchCrm(); onRefresh(); }

  const profile = crmData?.profile as CrmProfile | null ?? null;

  return (
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
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4">
          <Tabs defaultValue="profile">
            <TabsList className="grid grid-cols-7 w-full">
              <TabsTrigger value="profile" className="text-xs">Profile</TabsTrigger>
              <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>
              <TabsTrigger value="team" className="text-xs">Team</TabsTrigger>
              <TabsTrigger value="suppliers" className="text-xs">Suppliers</TabsTrigger>
              <TabsTrigger value="bank" className="text-xs">Bank</TabsTrigger>
              <TabsTrigger value="docs" className="text-xs">Docs</TabsTrigger>
              <TabsTrigger value="tags" className="text-xs">Tags</TabsTrigger>
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
              <DocsTab userId={agent.id} profile={profile} onRefresh={refresh} />
            </TabsContent>
            <TabsContent value="team" className="mt-5 pb-8">
              <TeamTab userId={agent.id} profile={profile} onRefresh={refresh} />
            </TabsContent>
            <TabsContent value="tags" className="mt-5 pb-8">
              <TagsTab userId={agent.id} tags={agent.tags} onRefresh={refresh} />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
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
    if (newStatus === "cancelled") { setCancelledAt(""); setCancelChecklist([]); setStatusNotes(""); setStatusDialog("cancelled"); return; }
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
  const addLogin = trpc.crm.agentCrm.addSupplierLogin.useMutation({
    onSuccess: onRefresh,
    onError: (e) => toast.error(e.message),
  });
  const deleteLogin = trpc.crm.agentCrm.deleteSupplierLogin.useMutation({
    onSuccess: onRefresh,
    onError: (e) => toast.error(e.message),
  });

  const enabledSuppliers = new Set(supplierLogins.map(l => l.supplierName));

  function toggle(supplier: string) {
    if (enabledSuppliers.has(supplier)) {
      const login = supplierLogins.find(l => l.supplierName === supplier);
      if (login) deleteLogin.mutate({ id: login.id });
    } else {
      addLogin.mutate({ userId, supplierName: supplier });
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Select which supplier portals this agent has access to.</p>
      <div className="grid grid-cols-1 gap-2">
        {SUPPLIERS.map((supplier) => {
          const enabled = enabledSuppliers.has(supplier);
          return (
            <div
              key={supplier}
              className={`flex items-center justify-between p-3.5 rounded-lg border cursor-pointer transition-colors ${
                enabled
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-muted/20 hover:bg-muted/40"
              }`}
              onClick={() => toggle(supplier)}
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

function DocsTab({ userId, profile, onRefresh }: { userId: number; profile: CrmProfile | null; onRefresh: () => void; }) {
  const idRef = useRef<HTMLInputElement>(null);
  const poaRef = useRef<HTMLInputElement>(null);
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
    <div className="space-y-5">
      <DocUploadRow
        label="ID Document"
        description="Passport, driving licence, or national ID"
        url={profile?.idDocUrl}
        inputRef={idRef}
        onUpload={(f) => handleUpload("id", f)}
        loading={uploadDoc.isPending}
      />
      <Separator />
      <DocUploadRow
        label="Proof of Address"
        description="Utility bill or bank statement (within 3 months)"
        url={profile?.proofOfAddressUrl}
        inputRef={poaRef}
        onUpload={(f) => handleUpload("proof_of_address", f)}
        loading={uploadDoc.isPending}
      />
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

  const teamId = profile?.teamId ?? null;

  // Load team data if agent is in a team
  const { data: teamData, isLoading: teamLoading } = trpc.crm.agentCrm.getTeam.useQuery(
    { teamId: teamId! },
    { enabled: !!teamId }
  );

  // Load all agents for the add-member search
  const { data: allAgents } = trpc.crm.agentCrm.list.useQuery(undefined, { enabled: showAddDialog });

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
          <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
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
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
              <Button size="sm" disabled={!teamName.trim() || createTeam.isPending}
                onClick={() => createTeam.mutate({ name: teamName, membershipTier: teamTier || undefined, monthlySub: teamSub || undefined, notes: teamNotes || undefined, memberUserIds: [userId] })}>
                {createTeam.isPending ? "Creating..." : "Create Team"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
