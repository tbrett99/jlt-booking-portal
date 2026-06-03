import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Zap, Search, ExternalLink } from "lucide-react";
import { AgentCrmSheet } from "./AgentCrm";

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

export default function OrbitAccess() {
  const [search, setSearch] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<any | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: allAgents = [], isLoading, refetch } = trpc.crm.agentCrm.list.useQuery(
    undefined,
    { staleTime: 60_000 }
  );

  const orbitAgents = (allAgents as any[]).filter((a: any) => a.crmProfile?.orbitEnabled === true);

  const filtered = search.trim()
    ? orbitAgents.filter((a: any) =>
        (a.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (a.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (a.crmProfile?.uniqueAgentId ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : orbitAgents;

  const openSheet = (agent: any) => {
    setSelectedAgent(agent);
    setSheetOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Zap size={20} className="text-violet-600" />
            Orbit Access
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Agents who have been granted access to the Orbit supplier portal.
          </p>
        </div>
        <Badge variant="secondary" className="text-sm px-3 py-1">
          {isLoading ? "…" : orbitAgents.length} agent{orbitAgents.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b">
            <div className="relative max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search agents…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
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
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    {search
                      ? "No agents match your search."
                      : "No agents currently have Orbit access enabled. Open an agent's CRM profile and toggle Orbit Access on the Suppliers tab."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((agent: any) => (
                <TableRow
                  key={agent.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => openSheet(agent)}
                >
                  <TableCell>
                    <div className="font-medium text-sm">{agent.name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{agent.email}</div>
                  </TableCell>
                  <TableCell>
                    {agent.crmProfile?.uniqueAgentId
                      ? <Badge variant="outline" className="font-mono text-xs">{agent.crmProfile.uniqueAgentId}</Badge>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {agent.crmProfile?.jltEmail ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {agent.crmProfile?.membershipTier
                      ? <Badge variant="secondary" className="text-xs">{agent.crmProfile.membershipTier}</Badge>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                  <TableCell><StatusBadge status={agent.crmProfile?.agentStatus} /></TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-xs"
                      onClick={(e) => { e.stopPropagation(); openSheet(agent); }}
                    >
                      <ExternalLink size={12} /> View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
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
