import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, Search, ExternalLink, Plane, Download, Mail, CheckCircle2, Pencil, X, Check } from "lucide-react";
import { AgentCrmSheet } from "./AgentCrm";
import { toast } from "sonner";

type FilterTab = "all" | "no_aviate" | "no_username" | "ready" | "sent";

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  const map: Record<string, { label: string; bg: string; color: string }> = {
    active:   { label: "Active",   bg: "#dcfce7", color: "#166534" },
    inactive: { label: "Inactive", bg: "#fee2e2", color: "#991b1b" },
    prospect: { label: "Prospect", bg: "#fef9c3", color: "#854d0e" },
    won:      { label: "Won",      bg: "#ede9fe", color: "#5b21b6" },
    lost:     { label: "Lost",     bg: "#f1f5f9", color: "#475569" },
  };
  const s = map[status] ?? { label: status, bg: "#f1f5f9", color: "#475569" };
  return (
    <span style={{ background: s.bg, color: s.color, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

function InlineUsernameEdit({
  loginId,
  currentUsername,
  onSaved,
}: {
  loginId: number;
  currentUsername: string | null;
  onSaved: (username: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentUsername ?? "");
  const utils = trpc.useUtils();

  const updateUsername = trpc.crm.agentCrm.updateAviateUsername.useMutation({
    onSuccess: () => {
      toast.success("Username saved");
      onSaved(value);
      setEditing(false);
      utils.crm.agentCrm.listOrbitAgents.invalidate();
    },
    onError: () => toast.error("Failed to save username"),
  });

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5">
        {currentUsername ? (
          <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{currentUsername}</span>
        ) : (
          <span className="text-xs text-muted-foreground italic">Not set</span>
        )}
        <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => { setValue(currentUsername ?? ""); setEditing(true); }}>
          <Pencil size={11} />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-6 text-xs w-32 font-mono"
        onKeyDown={(e) => {
          if (e.key === "Enter") updateUsername.mutate({ loginId, username: value });
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <Button size="icon" variant="ghost" className="h-6 w-6 text-green-600" disabled={updateUsername.isPending}
        onClick={() => updateUsername.mutate({ loginId, username: value })}>
        <Check size={12} />
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" onClick={() => setEditing(false)}>
        <X size={12} />
      </Button>
    </div>
  );
}

export default function OrbitAccess() {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [selectedAgent, setSelectedAgent] = useState<any | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [bulkEmailOpen, setBulkEmailOpen] = useState(false);
  const [instructions, setInstructions] = useState("");

  const utils = trpc.useUtils();

  const { data: allAgents = [], isLoading } = trpc.crm.agentCrm.list.useQuery(undefined, { staleTime: 60_000 });
  const { data: orbitData = [] } = trpc.crm.agentCrm.listOrbitAgents.useQuery(undefined, { staleTime: 30_000 });

  type OrbitEntry = { userId: number; hasAviate: boolean; aviateLoginId: number | null; aviateUsername: string | null; welcomeEmailSentAt: Date | null };
  const orbitMap = new Map((orbitData as OrbitEntry[]).map((d) => [d.userId, d]));

  const toggleAviate = trpc.crm.agentCrm.toggleAviateLogin.useMutation({
    onMutate: async ({ userId, enabled }) => {
      await utils.crm.agentCrm.listOrbitAgents.cancel();
      const prev = utils.crm.agentCrm.listOrbitAgents.getData();
      utils.crm.agentCrm.listOrbitAgents.setData(undefined, (old: any) =>
        (old ?? []).map((d: any) => d.userId === userId ? { ...d, hasAviate: enabled, aviateLoginId: enabled ? -1 : null, aviateUsername: null, welcomeEmailSentAt: null } : d)
      );
      return { prev };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.prev) utils.crm.agentCrm.listOrbitAgents.setData(undefined, ctx.prev);
      toast.error("Failed to update Aviate login");
    },
    onSuccess: () => {
      utils.crm.agentCrm.listOrbitAgents.invalidate();
    },
  });

  const bulkSend = trpc.crm.agentCrm.bulkSendAviateWelcome.useMutation({
    onSuccess: (data) => {
      toast.success(`Welcome email sent to ${data.sent} agent${data.sent !== 1 ? "s" : ""}${data.skipped > 0 ? ` (${data.skipped} skipped)` : ""}`);
      setBulkEmailOpen(false);
      utils.crm.agentCrm.listOrbitAgents.invalidate();
    },
    onError: () => toast.error("Failed to send welcome emails"),
  });

  const orbitAgents = (allAgents as any[]).filter((a: any) => a.crmProfile?.orbitEnabled === true);

  // Stats
  const noAviate = orbitAgents.filter((a: any) => !orbitMap.get(a.id)?.hasAviate);
  const noUsername = orbitAgents.filter((a: any) => {
    const d = orbitMap.get(a.id);
    return d?.hasAviate && !d.aviateUsername;
  });
  const readyToSend = orbitAgents.filter((a: any) => {
    const d = orbitMap.get(a.id);
    return d?.hasAviate && d.aviateUsername && !d.welcomeEmailSentAt;
  });
  const emailSent = orbitAgents.filter((a: any) => !!orbitMap.get(a.id)?.welcomeEmailSentAt);

  const tabFiltered = useMemo(() => {
    switch (activeTab) {
      case "no_aviate":   return noAviate;
      case "no_username": return noUsername;
      case "ready":       return readyToSend;
      case "sent":        return emailSent;
      default:            return orbitAgents;
    }
  }, [activeTab, orbitData, allAgents]);

  const filtered = search.trim()
    ? tabFiltered.filter((a: any) =>
        (a.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (a.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (a.crmProfile?.uniqueAgentId ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : tabFiltered;

  // Export CSV of agents with no Aviate login
  const exportMissing = () => {
    const rows = [
      ["Agent Name", "Email", "Agent ID", "JLT Email", "Membership"],
      ...noAviate.map((a: any) => [
        a.name ?? "",
        a.email ?? "",
        a.crmProfile?.uniqueAgentId ?? "",
        a.crmProfile?.jltEmail ?? "",
        a.crmProfile?.membershipTier ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orbit-agents-no-aviate-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openSheet = (agent: any) => { setSelectedAgent(agent); setSheetOpen(true); };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Zap size={20} className="text-violet-600" />
            Orbit Access
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage Orbit access and Aviate logins for your agents.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {noAviate.length > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={exportMissing}>
              <Download size={13} />
              Export Missing ({noAviate.length})
            </Button>
          )}
          {readyToSend.length > 0 && (
            <Button size="sm" className="gap-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white" onClick={() => setBulkEmailOpen(true)}>
              <Mail size={13} />
              Send Welcome Email ({readyToSend.length})
            </Button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Orbit Agents", value: orbitAgents.length, color: "text-violet-600" },
          { label: "No Aviate Login", value: noAviate.length, color: "text-orange-500" },
          { label: "Aviate — No Username", value: noUsername.length, color: "text-amber-500" },
          { label: "Ready to Email", value: readyToSend.length, color: "text-sky-600" },
          { label: "Email Sent", value: emailSent.length, color: "text-green-600" },
        ].map((s) => (
          <Card key={s.label} className="py-3 px-4">
            <div className={`text-2xl font-bold ${s.color}`}>{isLoading ? "…" : s.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Filters */}
          <div className="px-4 pt-3 pb-0 border-b flex items-center gap-3 flex-wrap">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FilterTab)}>
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs px-3">All ({orbitAgents.length})</TabsTrigger>
                <TabsTrigger value="no_aviate" className="text-xs px-3">No Aviate ({noAviate.length})</TabsTrigger>
                <TabsTrigger value="no_username" className="text-xs px-3">No Username ({noUsername.length})</TabsTrigger>
                <TabsTrigger value="ready" className="text-xs px-3">Ready to Email ({readyToSend.length})</TabsTrigger>
                <TabsTrigger value="sent" className="text-xs px-3">Email Sent ({emailSent.length})</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative ml-auto mb-2">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 h-7 text-xs w-48" />
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Agent ID</TableHead>
                <TableHead>JLT Email</TableHead>
                <TableHead>Membership</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <div className="flex items-center gap-1"><Plane size={12} className="text-sky-600" /> Aviate</div>
                </TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Welcome Email</TableHead>
                <TableHead className="w-14"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    {search ? "No agents match your search." : activeTab === "all" ? "No agents currently have Orbit access enabled." : "No agents in this category."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((agent: any) => {
                const orbit = orbitMap.get(agent.id);
                const hasAviate = orbit?.hasAviate ?? false;
                const loginId = orbit?.aviateLoginId ?? null;
                const username = orbit?.aviateUsername ?? null;
                const emailSentAt = orbit?.welcomeEmailSentAt ?? null;
                return (
                  <TableRow key={agent.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openSheet(agent)}>
                    <TableCell>
                      <div className="font-medium text-sm">{agent.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{agent.email}</div>
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
                    <TableCell><StatusBadge status={agent.crmProfile?.agentStatus} /></TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={hasAviate}
                        disabled={toggleAviate.isPending}
                        onCheckedChange={(checked) => toggleAviate.mutate({ userId: agent.id, enabled: checked })}
                      />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {hasAviate && loginId && loginId > 0 ? (
                        <InlineUsernameEdit
                          loginId={loginId}
                          currentUsername={username}
                          onSaved={() => utils.crm.agentCrm.listOrbitAgents.invalidate()}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {emailSentAt ? (
                        <div className="flex items-center gap-1 text-green-600">
                          <CheckCircle2 size={13} />
                          <span className="text-xs">{new Date(emailSentAt).toLocaleDateString()}</span>
                        </div>
                      ) : hasAviate && username ? (
                        <span className="text-xs text-amber-600 font-medium">Pending</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="gap-1 text-xs h-7"
                        onClick={(e) => { e.stopPropagation(); openSheet(agent); }}>
                        <ExternalLink size={11} /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Bulk Send Dialog */}
      <Dialog open={bulkEmailOpen} onOpenChange={setBulkEmailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail size={16} className="text-violet-600" />
              Send Aviate Welcome Email
            </DialogTitle>
            <DialogDescription>
              This will send the welcome email to <strong>{readyToSend.length} agent{readyToSend.length !== 1 ? "s" : ""}</strong> who have an Aviate username set but haven't received the email yet. Agents who have already been sent the email will be skipped automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Setup Instructions</label>
              <p className="text-xs text-muted-foreground mb-1.5">These instructions will appear in the email below the agent's username.</p>
              <Textarea
                placeholder="Paste the Aviate setup instructions here…"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={8}
                className="text-sm font-mono"
              />
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
              <strong>Recipients ({readyToSend.length}):</strong>{" "}
              {readyToSend.slice(0, 5).map((a: any) => a.name ?? a.email).join(", ")}
              {readyToSend.length > 5 && ` and ${readyToSend.length - 5} more`}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkEmailOpen(false)}>Cancel</Button>
            <Button
              disabled={!instructions.trim() || bulkSend.isPending}
              onClick={() => bulkSend.mutate({ instructions })}
              className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
            >
              <Mail size={14} />
              {bulkSend.isPending ? "Sending…" : `Send to ${readyToSend.length} Agent${readyToSend.length !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedAgent && (
        <AgentCrmSheet
          agent={selectedAgent}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onRefresh={() => {
            utils.crm.agentCrm.list.invalidate();
            utils.crm.agentCrm.listOrbitAgents.invalidate();
          }}
        />
      )}
    </div>
  );
}
