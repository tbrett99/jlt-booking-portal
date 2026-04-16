import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, UserCheck, Building2, Banknote, Eye, EyeOff, Plus, Trash2, Pencil, Upload, BadgeCheck, MapPin, Phone, Mail, StickyNote } from "lucide-react";
import { toast } from "sonner";

const UK_REGIONS = [
  "North West","North East","Yorkshire and the Humber","East Midlands",
  "West Midlands","East of England","London","South East","South West",
  "Wales","Scotland","Northern Ireland",
];
const AGENT_TAGS = ["agent","core team","cancelled","inactive","vip","new"];

type CrmProfile = {
  uniqueAgentId: string | null;
  jltEmail: string | null;
  personalEmail: string | null;
  mobile: string | null;
  ukRegion: string | null;
  bankAccountName: string | null;
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
};

export default function AgentCrm() {
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
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
      (a.crmProfile?.jltEmail ?? "").toLowerCase().includes(q);
    return matchesSearch && (tagFilter === "all" || a.tags.includes(tagFilter));
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Agent CRM</h1>
        <p className="text-muted-foreground text-sm mt-1">{(agents as AgentRow[]).length} registered agents</p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, agent ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={tagFilter} onValueChange={setTagFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter by tag" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tags</SelectItem>
            {AGENT_TAGS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Agent ID</TableHead>
                <TableHead>JLT Email</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
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
                    </TableCell>
                    <TableCell>
                      {agent.crmProfile?.uniqueAgentId
                        ? <Badge variant="outline" className="font-mono text-xs">{agent.crmProfile.uniqueAgentId}</Badge>
                        : <span className="text-muted-foreground text-xs">Not assigned</span>}
                    </TableCell>
                    <TableCell className="text-sm">{agent.crmProfile?.jltEmail ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm">{agent.crmProfile?.ukRegion ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {agent.tags.map((tag) => <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={agent.isActive ? "default" : "destructive"} className="text-xs">
                        {agent.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); setSelectedAgent(agent); setSheetOpen(true); }}
                      >
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

function AgentCrmSheet({ agent, open, onClose, onRefresh }: {
  agent: AgentRow; open: boolean; onClose: () => void; onRefresh: () => void;
}) {
  const { data: crmData, refetch: refetchCrm } = trpc.crm.agentCrm.get.useQuery(
    { userId: agent.id },
    { enabled: open }
  );
  function refresh() { refetchCrm(); onRefresh(); }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="text-xl">{agent.name}</SheetTitle>
              <p className="text-sm text-muted-foreground mt-1">{agent.email}</p>
              {crmData?.profile?.uniqueAgentId && (
                <Badge variant="outline" className="font-mono text-xs mt-2">{crmData.profile.uniqueAgentId}</Badge>
              )}
            </div>
            <Badge variant={agent.isActive ? "default" : "destructive"}>
              {agent.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>
        </SheetHeader>

        <Tabs defaultValue="profile" className="mt-4">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="tags">Tags</TabsTrigger>
            <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
            <TabsTrigger value="bank">Bank</TabsTrigger>
            <TabsTrigger value="docs">Docs</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="mt-4">
            <ProfileTab userId={agent.id} profile={crmData?.profile ?? null} onRefresh={refresh} />
          </TabsContent>
          <TabsContent value="tags" className="mt-4">
            <TagsTab userId={agent.id} tags={agent.tags} onRefresh={refresh} />
          </TabsContent>
          <TabsContent value="suppliers" className="mt-4">
            <SupplierLoginsTab userId={agent.id} logins={crmData?.supplierLogins ?? []} onRefresh={refresh} />
          </TabsContent>
          <TabsContent value="bank" className="mt-4">
            <BankDetailsTab userId={agent.id} profile={crmData?.profile ?? null} onRefresh={refresh} />
          </TabsContent>
          <TabsContent value="docs" className="mt-4">
            <DocsTab userId={agent.id} profile={crmData?.profile ?? null} onRefresh={refresh} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function ProfileTab({ userId, profile, onRefresh }: { userId: number; profile: CrmProfile | null; onRefresh: () => void; }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    jltEmail: profile?.jltEmail ?? "",
    personalEmail: profile?.personalEmail ?? "",
    mobile: profile?.mobile ?? "",
    addressLine1: profile?.addressLine1 ?? "",
    addressLine2: profile?.addressLine2 ?? "",
    city: profile?.city ?? "",
    postcode: profile?.postcode ?? "",
    ukRegion: profile?.ukRegion ?? "",
    adminNotes: profile?.adminNotes ?? "",
  });

  const updateProfile = trpc.crm.agentCrm.updateProfile.useMutation({
    onSuccess: () => { toast.success("Profile updated"); setEditing(false); onRefresh(); },
    onError: (e) => toast.error(e.message),
  });
  const assignId = trpc.crm.agentCrm.assignAgentId.useMutation({
    onSuccess: (data) => { toast.success("Agent ID assigned: " + data.uniqueAgentId); onRefresh(); },
    onError: (e) => toast.error(e.message),
  });

  if (!editing) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Contact Details</h3>
          <div className="flex gap-2">
            {!profile?.uniqueAgentId && (
              <Button size="sm" variant="outline" onClick={() => assignId.mutate({ userId })} disabled={assignId.isPending}>
                <BadgeCheck className="h-3 w-3 mr-1" />Assign Agent ID
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => {
              setForm({
                jltEmail: profile?.jltEmail ?? "",
                personalEmail: profile?.personalEmail ?? "",
                mobile: profile?.mobile ?? "",
                addressLine1: profile?.addressLine1 ?? "",
                addressLine2: profile?.addressLine2 ?? "",
                city: profile?.city ?? "",
                postcode: profile?.postcode ?? "",
                ukRegion: profile?.ukRegion ?? "",
                adminNotes: profile?.adminNotes ?? "",
              });
              setEditing(true);
            }}>
              <Pencil className="h-3 w-3 mr-1" />Edit
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InfoRow icon={<Mail className="h-4 w-4" />} label="JLT Email" value={profile?.jltEmail} />
          <InfoRow icon={<Mail className="h-4 w-4" />} label="Personal Email" value={profile?.personalEmail} />
          <InfoRow icon={<Phone className="h-4 w-4" />} label="Mobile" value={profile?.mobile} />
          <InfoRow icon={<MapPin className="h-4 w-4" />} label="Region" value={profile?.ukRegion} />
        </div>
        {(profile?.addressLine1 || profile?.city || profile?.postcode) && (
          <div className="bg-muted/30 rounded-lg p-3 text-sm">
            <p className="font-medium text-xs text-muted-foreground mb-1">Address</p>
            {profile?.addressLine1 && <p>{profile.addressLine1}</p>}
            {profile?.addressLine2 && <p>{profile.addressLine2}</p>}
            {(profile?.city || profile?.postcode) && (
              <p>{[profile?.city, profile?.postcode].filter(Boolean).join(", ")}</p>
            )}
          </div>
        )}
        {profile?.adminNotes && (
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-1">
              <StickyNote className="h-3 w-3" /> Admin Notes
            </p>
            <p className="text-sm whitespace-pre-wrap">{profile.adminNotes}</p>
          </div>
        )}
        {!profile && (
          <div className="text-center py-8 text-muted-foreground">
            <UserCheck className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No CRM profile yet. Click Edit to add details.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">JLT Email</Label><Input value={form.jltEmail} onChange={(e) => setForm({ ...form, jltEmail: e.target.value })} placeholder="agent@thejltgroup.co.uk" /></div>
        <div><Label className="text-xs">Personal Email</Label><Input value={form.personalEmail} onChange={(e) => setForm({ ...form, personalEmail: e.target.value })} /></div>
        <div><Label className="text-xs">Mobile</Label><Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
        <div>
          <Label className="text-xs">UK Region</Label>
          <Select value={form.ukRegion} onValueChange={(v) => setForm({ ...form, ukRegion: v })}>
            <SelectTrigger><SelectValue placeholder="Select region" /></SelectTrigger>
            <SelectContent>{UK_REGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">Address Line 1</Label><Input value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} /></div>
        <div><Label className="text-xs">Address Line 2</Label><Input value={form.addressLine2} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} /></div>
        <div><Label className="text-xs">City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
        <div><Label className="text-xs">Postcode</Label><Input value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value })} /></div>
      </div>
      <div>
        <Label className="text-xs">Admin Notes (internal only)</Label>
        <Textarea value={form.adminNotes} onChange={(e) => setForm({ ...form, adminNotes: e.target.value })} rows={3} placeholder="Internal notes..." />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
        <Button size="sm" onClick={() => updateProfile.mutate({
          userId,
          jltEmail: form.jltEmail || null,
          personalEmail: form.personalEmail || null,
          mobile: form.mobile || null,
          addressLine1: form.addressLine1 || null,
          addressLine2: form.addressLine2 || null,
          city: form.city || null,
          postcode: form.postcode || null,
          ukRegion: form.ukRegion || null,
          adminNotes: form.adminNotes || null,
        })} disabled={updateProfile.isPending}>
          {updateProfile.isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

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

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">Current Tags</h3>
        <div className="flex flex-wrap gap-2 min-h-[40px]">
          {tags.length === 0
            ? <p className="text-sm text-muted-foreground">No tags assigned</p>
            : tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                {tag}
                <button onClick={() => removeTag.mutate({ userId, tag })} className="ml-1 hover:text-destructive">×</button>
              </Badge>
            ))}
        </div>
      </div>
      <div>
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">Quick-Add Tags</h3>
        <div className="flex flex-wrap gap-2">
          {AGENT_TAGS.filter((t) => !tags.includes(t)).map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
              onClick={() => addTag.mutate({ userId, tag })}
            >
              <Plus className="h-3 w-3 mr-1" />{tag}
            </Badge>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="Custom tag..."
          value={customTag}
          onChange={(e) => setCustomTag(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && customTag.trim()) addTag.mutate({ userId, tag: customTag.trim() }); }}
        />
        <Button
          size="sm"
          onClick={() => customTag.trim() && addTag.mutate({ userId, tag: customTag.trim() })}
          disabled={!customTag.trim() || addTag.isPending}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function SupplierLoginsTab({ userId, logins, onRefresh }: { userId: number; logins: any[]; onRefresh: () => void; }) {
  const [showDialog, setShowDialog] = useState(false);
  const [editLogin, setEditLogin] = useState<any | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<number, boolean>>({});
  const [form, setForm] = useState({ supplierName: "", loginUrl: "", username: "", password: "", notes: "" });

  const addLogin = trpc.crm.agentCrm.addSupplierLogin.useMutation({
    onSuccess: () => { toast.success("Added"); setShowDialog(false); onRefresh(); },
    onError: (e) => toast.error(e.message),
  });
  const updateLogin = trpc.crm.agentCrm.updateSupplierLogin.useMutation({
    onSuccess: () => { toast.success("Updated"); setShowDialog(false); setEditLogin(null); onRefresh(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteLogin = trpc.crm.agentCrm.deleteSupplierLogin.useMutation({
    onSuccess: () => { toast.success("Deleted"); onRefresh(); },
    onError: (e) => toast.error(e.message),
  });

  function openAdd() { setEditLogin(null); setForm({ supplierName: "", loginUrl: "", username: "", password: "", notes: "" }); setShowDialog(true); }
  function openEdit(login: any) { setEditLogin(login); setForm({ supplierName: login.supplierName ?? "", loginUrl: login.loginUrl ?? "", username: login.username ?? "", password: "", notes: login.notes ?? "" }); setShowDialog(true); }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Supplier Logins</h3>
        <Button size="sm" onClick={openAdd}><Plus className="h-3 w-3 mr-1" /> Add Login</Button>
      </div>

      {logins.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Building2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No supplier logins yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logins.map((login) => (
            <Card key={login.id} className="p-3">
              <div className="flex justify-between items-start">
                <div className="space-y-1 flex-1">
                  <div className="font-medium text-sm">{login.supplierName}</div>
                  {login.loginUrl && <a href={login.loginUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate block">{login.loginUrl}</a>}
                  {login.username && <div className="text-xs text-muted-foreground">Username: {login.username}</div>}
                  {login.password && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      Password: <span className="font-mono">{showPasswords[login.id] ? login.password : "••••••••"}</span>
                      <button onClick={() => setShowPasswords((p) => ({ ...p, [login.id]: !p[login.id] }))} className="text-muted-foreground hover:text-foreground">
                        {showPasswords[login.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                    </div>
                  )}
                  {login.notes && <div className="text-xs text-muted-foreground">{login.notes}</div>}
                </div>
                <div className="flex gap-1 ml-2">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(login)}><Pencil className="h-3 w-3" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteLogin.mutate({ id: login.id })}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editLogin ? "Edit Supplier Login" : "Add Supplier Login"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Supplier Name *</Label><Input value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })} placeholder="e.g. Topdog, PTS, Ryanair" /></div>
            <div><Label className="text-xs">Login URL</Label><Input value={form.loginUrl} onChange={(e) => setForm({ ...form, loginUrl: e.target.value })} placeholder="https://..." /></div>
            <div><Label className="text-xs">Username</Label><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
            <div><Label className="text-xs">Password {editLogin && "(leave blank to keep existing)"}</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <div><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={() => editLogin ? updateLogin.mutate({ id: editLogin.id, ...form }) : addLogin.mutate({ userId, ...form })}
              disabled={!form.supplierName || addLogin.isPending || updateLogin.isPending}
            >
              {editLogin ? "Save Changes" : "Add Login"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BankDetailsTab({ userId, profile, onRefresh }: { userId: number; profile: CrmProfile | null; onRefresh: () => void; }) {
  const [editing, setEditing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [form, setForm] = useState({
    bankAccountName: profile?.bankAccountName ?? "",
    bankSortCode: profile?.bankSortCode ?? "",
    bankAccountNumber: profile?.bankAccountNumber ?? "",
  });

  const updateProfile = trpc.crm.agentCrm.updateProfile.useMutation({
    onSuccess: () => { toast.success("Bank details saved"); setEditing(false); onRefresh(); },
    onError: (e) => toast.error(e.message),
  });

  const hasBankDetails = profile?.bankAccountName || profile?.bankSortCode || profile?.bankAccountNumber;

  if (!editing) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Bank Details</h3>
          <div className="flex gap-2">
            {hasBankDetails && (
              <Button size="sm" variant="outline" onClick={() => setShowDetails(!showDetails)}>
                {showDetails ? <EyeOff className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
                {showDetails ? "Hide" : "Show"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => {
              setForm({ bankAccountName: profile?.bankAccountName ?? "", bankSortCode: profile?.bankSortCode ?? "", bankAccountNumber: profile?.bankAccountNumber ?? "" });
              setEditing(true);
            }}>
              <Pencil className="h-3 w-3 mr-1" /> Edit
            </Button>
          </div>
        </div>
        {!hasBankDetails ? (
          <div className="text-center py-8 text-muted-foreground">
            <Banknote className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No bank details on file</p>
          </div>
        ) : (
          <div className="bg-muted/30 rounded-lg p-4 space-y-2">
            <InfoRow label="Account Name" value={profile?.bankAccountName} />
            <InfoRow label="Sort Code" value={showDetails ? profile?.bankSortCode : "••-••-••"} />
            <InfoRow label="Account Number" value={showDetails ? profile?.bankAccountNumber : "••••••••"} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Edit Bank Details</h3>
      <div className="space-y-3">
        <div><Label className="text-xs">Account Name</Label><Input value={form.bankAccountName} onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })} placeholder="Full name as on account" /></div>
        <div><Label className="text-xs">Sort Code</Label><Input value={form.bankSortCode} onChange={(e) => setForm({ ...form, bankSortCode: e.target.value })} placeholder="00-00-00" /></div>
        <div><Label className="text-xs">Account Number</Label><Input value={form.bankAccountNumber} onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })} placeholder="8-digit account number" /></div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
        <Button size="sm" onClick={() => updateProfile.mutate({ userId, bankAccountName: form.bankAccountName || null, bankSortCode: form.bankSortCode || null, bankAccountNumber: form.bankAccountNumber || null })} disabled={updateProfile.isPending}>
          {updateProfile.isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

function DocsTab({ userId, profile, onRefresh }: { userId: number; profile: CrmProfile | null; onRefresh: () => void; }) {
  const idInputRef = useRef<HTMLInputElement>(null);
  const poaInputRef = useRef<HTMLInputElement>(null);

  const uploadDoc = trpc.crm.agentCrm.uploadIdDoc.useMutation({
    onSuccess: () => { toast.success("Document uploaded"); onRefresh(); },
    onError: (e) => toast.error(e.message),
  });

  function handleUpload(file: File, docType: "id" | "proof_of_address") {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadDoc.mutate({ userId, fileBase64: base64, fileName: file.name, mimeType: file.type, docType });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Identity Documents</h3>
      <div className="grid grid-cols-1 gap-4">
        <Card className="p-4">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-medium text-sm">ID Document</p>
              <p className="text-xs text-muted-foreground">Passport, driving licence, or national ID</p>
            </div>
            {profile?.idDocUrl ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" asChild>
                  <a href={profile.idDocUrl} target="_blank" rel="noopener noreferrer"><Eye className="h-3 w-3 mr-1" /> View</a>
                </Button>
                <Button size="sm" variant="outline" onClick={() => idInputRef.current?.click()}>
                  <Upload className="h-3 w-3 mr-1" /> Replace
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={() => idInputRef.current?.click()} disabled={uploadDoc.isPending}>
                <Upload className="h-3 w-3 mr-1" /> Upload
              </Button>
            )}
          </div>
          {profile?.idDocUrl && (
            <div className="mt-2 flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <BadgeCheck className="h-3 w-3" /> Document on file
            </div>
          )}
          <input ref={idInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0], "id")} />
        </Card>

        <Card className="p-4">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-medium text-sm">Proof of Address</p>
              <p className="text-xs text-muted-foreground">Utility bill, bank statement (last 3 months)</p>
            </div>
            {profile?.proofOfAddressUrl ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" asChild>
                  <a href={profile.proofOfAddressUrl} target="_blank" rel="noopener noreferrer"><Eye className="h-3 w-3 mr-1" /> View</a>
                </Button>
                <Button size="sm" variant="outline" onClick={() => poaInputRef.current?.click()}>
                  <Upload className="h-3 w-3 mr-1" /> Replace
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={() => poaInputRef.current?.click()} disabled={uploadDoc.isPending}>
                <Upload className="h-3 w-3 mr-1" /> Upload
              </Button>
            )}
          </div>
          {profile?.proofOfAddressUrl && (
            <div className="mt-2 flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <BadgeCheck className="h-3 w-3" /> Document on file
            </div>
          )}
          <input ref={poaInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0], "proof_of_address")} />
        </Card>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon?: React.ReactNode; label: string; value?: string | null; }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <span className="text-muted-foreground min-w-[100px]">{label}:</span>
      <span className="font-medium">{value ?? <span className="text-muted-foreground italic">Not set</span>}</span>
    </div>
  );
}
