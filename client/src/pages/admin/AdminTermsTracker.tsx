import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  CheckCircle2, Clock, Send, XCircle, Download, FileSignature, Search, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function AdminTermsTracker() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "signed" | "unsigned">("all");
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [versionLabel, setVersionLabel] = useState("v2 — May 2026");
  const [description, setDescription] = useState(
    "Updated terms including Section 26.4.1 (Commission Eligibility Conditions) and Section 5.3.1 (Fair Dealing)."
  );
  const [deadline, setDeadline] = useState("2026-06-12");

  const { data, isLoading, refetch } = trpc.terms.getSigningTracker.useQuery();

  const sendVersionMutation = trpc.terms.sendVersion.useMutation({
    onSuccess: () => {
      toast.success("Terms version activated — agents will now see the signing banner.");
      setSendDialogOpen(false);
      refetch();
    },
    onError: (err) => toast.error(err.message || "Failed to activate terms version."),
  });

  const deactivateMutation = trpc.terms.deactivateVersion.useMutation({
    onSuccess: () => {
      toast.success("Terms version deactivated — banner hidden from agents.");
      refetch();
    },
    onError: (err) => toast.error(err.message || "Failed to deactivate."),
  });

  const handleSend = () => {
    if (!versionLabel.trim()) {
      toast.error("Please enter a version label.");
      return;
    }
    sendVersionMutation.mutate({
      versionLabel: versionLabel.trim(),
      description: description.trim() || undefined,
      deadline: deadline ? new Date(deadline) : undefined,
    });
  };

  const handleExportCsv = () => {
    if (!data?.agents?.length) return;
    const rows = [
      ["Name", "Email", "Signed", "Signed At", "Signed Name"],
        ...data.agents.map((a) => [
        a.name ?? "",
        a.email ?? "",
        a.hasSigned ? "Yes" : "No",
        a.signedAt ? format(new Date(a.signedAt), "dd/MM/yyyy HH:mm") : "",
        a.signedName ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `terms-signing-tracker-${data.activeVersion?.versionLabel ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredAgents = (data?.agents ?? []).filter((a) => {
    const matchesSearch =
      !search ||
      (a.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (a.email ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesFilter =
      filter === "all" ||
      (filter === "signed" && a.hasSigned) ||
      (filter === "unsigned" && !a.hasSigned);
    return matchesSearch && matchesFilter;
  });

  const signedPct = data
    ? Math.round((data.signedCount / Math.max(data.totalCount, 1)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Terms & Contract Signing</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage term versions and track agent signatures.
          </p>
        </div>
        <div className="flex gap-2">
          {data?.activeVersion && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => deactivateMutation.mutate()}
              disabled={deactivateMutation.isPending}
            >
              <XCircle className="h-4 w-4 mr-1.5" />
              Deactivate Banner
            </Button>
          )}
          <Button size="sm" onClick={() => setSendDialogOpen(true)}>
            <Send className="h-4 w-4 mr-1.5" />
            {data?.activeVersion ? "Send New Version" : "Activate Terms for Signing"}
          </Button>
        </div>
      </div>

      {/* Active version summary */}
      {data?.activeVersion ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSignature className="h-4 w-4 text-primary" />
                  Active: {data.activeVersion.versionLabel}
                </CardTitle>
                <CardDescription className="mt-1">
                  Sent {data.activeVersion.sentAt
                    ? format(new Date(data.activeVersion.sentAt), "d MMMM yyyy 'at' HH:mm")
                    : "—"}
                  {data.activeVersion.deadline && (
                    <> · Deadline: <strong>{format(new Date(data.activeVersion.deadline), "d MMMM yyyy")}</strong></>
                  )}
                </CardDescription>
              </div>
              <Badge variant={signedPct === 100 ? "default" : "secondary"}>
                {data.signedCount} / {data.totalCount} signed
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <Progress value={signedPct} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1.5">{signedPct}% of active agents have signed</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-muted-foreground">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No active terms version. Click "Activate Terms for Signing" to push terms to agents.</p>
          </CardContent>
        </Card>
      )}

      {/* Tracker table */}
      {data?.activeVersion && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex gap-2">
                {(["all", "signed", "unsigned"] as const).map((f) => (
                  <Button
                    key={f}
                    variant={filter === f ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilter(f)}
                    className="capitalize"
                  >
                    {f === "all" ? `All (${data.totalCount})` : f === "signed" ? `Signed (${data.signedCount})` : `Unsigned (${data.totalCount - data.signedCount})`}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2 items-center">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search agents…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-8 w-48 text-sm"
                  />
                </div>
                <Button variant="outline" size="sm" onClick={handleExportCsv}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Export CSV
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Signed At</TableHead>
                  <TableHead>Signed Name</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : filteredAgents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No agents match your filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAgents.map((agent) => (
                    <TableRow key={agent.id}>
                      <TableCell className="font-medium">{agent.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{agent.email}</TableCell>
                      <TableCell>
                        {agent.hasSigned ? (
                          <Badge variant="default" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Signed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300">
                            <Clock className="h-3 w-3" /> Pending
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {agent.signedAt
                          ? format(new Date(agent.signedAt), "dd/MM/yyyy HH:mm")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm">{agent.signedName ?? "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Send/Activate dialog */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Activate Terms for Signing</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="versionLabel">Version label <span className="text-red-500">*</span></Label>
              <Input
                id="versionLabel"
                value={versionLabel}
                onChange={(e) => setVersionLabel(e.target.value)}
                placeholder="e.g. v2 — May 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief summary of changes"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deadline">Signing deadline (optional)</Label>
              <Input
                id="deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Shown to agents in the banner. Does not auto-close the signing period.
              </p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">
              <strong>Note:</strong> Activating will immediately show the signing banner to all active agents. Any previously active version will be deactivated.
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSendDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSend} disabled={sendVersionMutation.isPending}>
              {sendVersionMutation.isPending ? "Activating…" : "Activate & Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
