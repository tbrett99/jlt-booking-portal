import { useState, useRef } from "react";
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
  CheckCircle2, Clock, Send, XCircle, Download, FileSignature, Search, AlertTriangle, ScrollText, Printer,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type AgentRow = {
  id: number;
  name: string | null;
  email: string | null;
  hasSigned: boolean;
  signedAt: Date | null;
  signedName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  signingId: number | null;
};

function SigningCertificate({
  agent,
  versionLabel,
  onClose,
}: {
  agent: AgentRow;
  versionLabel: string;
  onClose: () => void;
}) {
  const certRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const content = certRef.current?.innerHTML;
    if (!content) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Signing Certificate — ${agent.name}</title>
          <style>
            body { font-family: 'Times New Roman', serif; margin: 40px; color: #000; }
            .cert-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 20px; margin-bottom: 24px; }
            .cert-header h1 { font-size: 22px; font-weight: bold; margin: 0 0 4px; }
            .cert-header p { font-size: 13px; margin: 0; color: #444; }
            .cert-body { font-size: 13px; line-height: 1.8; }
            .cert-field { margin-bottom: 12px; }
            .cert-field label { font-weight: bold; display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #555; }
            .cert-field span { font-size: 14px; }
            .cert-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0; }
            .cert-footer { margin-top: 32px; border-top: 1px solid #ccc; padding-top: 16px; font-size: 11px; color: #666; }
            .cert-ref { background: #f5f5f5; border: 1px solid #ddd; padding: 10px 16px; font-family: monospace; font-size: 13px; margin: 16px 0; }
            .cert-statement { background: #f9f9f9; border-left: 4px solid #000; padding: 12px 16px; margin: 20px 0; font-style: italic; }
            @media print { body { margin: 20px; } }
          </style>
        </head>
        <body>${content}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
  };

  const refNumber = `JLT-SIGN-${agent.signingId?.toString().padStart(6, "0") ?? "000000"}`;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            Signing Certificate
          </DialogTitle>
        </DialogHeader>

        {/* Certificate content */}
        <div ref={certRef} className="font-serif text-sm text-foreground">
          {/* Header */}
          <div className="cert-header text-center border-b-2 border-foreground pb-5 mb-6">
            <h1 className="text-xl font-bold tracking-tight">ELECTRONIC SIGNING CERTIFICATE</h1>
            <p className="text-muted-foreground text-xs mt-1">JLT Group — Agent Agreement & Terms and Conditions</p>
          </div>

          {/* Reference */}
          <div className="bg-muted border rounded px-4 py-2 font-mono text-sm mb-5 cert-ref">
            Reference: <strong>{refNumber}</strong>
          </div>

          {/* Statement */}
          <div className="border-l-4 border-foreground pl-4 py-2 bg-muted/30 italic text-sm mb-5 cert-statement">
            This certificate confirms that the individual named below has reviewed and electronically accepted the
            JLT Group Agent Agreement and Terms &amp; Conditions in the version stated. This record constitutes
            a legally binding electronic signature under the Electronic Communications Act 2000.
          </div>

          {/* Fields */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 mb-5 cert-grid">
            <div className="cert-field">
              <label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground block mb-0.5">Full Name (as signed)</label>
              <span className="text-base font-medium">{agent.signedName}</span>
            </div>
            <div className="cert-field">
              <label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground block mb-0.5">Account Email</label>
              <span className="text-base">{agent.email}</span>
            </div>
            <div className="cert-field">
              <label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground block mb-0.5">Terms Version</label>
              <span className="text-base font-medium">{versionLabel}</span>
            </div>
            <div className="cert-field">
              <label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground block mb-0.5">Date &amp; Time of Signing</label>
              <span className="text-base">
                {agent.signedAt
                  ? format(new Date(agent.signedAt), "d MMMM yyyy 'at' HH:mm:ss 'UTC'")
                  : "—"}
              </span>
            </div>
            <div className="cert-field">
              <label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground block mb-0.5">IP Address</label>
              <span className="text-base font-mono">{agent.ipAddress ?? "Not recorded"}</span>
            </div>
            <div className="cert-field">
              <label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground block mb-0.5">User ID</label>
              <span className="text-base font-mono">#{agent.id}</span>
            </div>
          </div>

          {/* User agent */}
          {agent.userAgent && (
            <div className="cert-field mb-5">
              <label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground block mb-0.5">Browser / Device</label>
              <span className="text-xs font-mono text-muted-foreground break-all">{agent.userAgent}</span>
            </div>
          )}

          {/* Footer */}
          <div className="border-t pt-4 mt-4 text-xs text-muted-foreground cert-footer">
            <p>
              This certificate was generated by the JLT Group Booking Portal. The signing record is stored securely
              in the JLT Group database and includes a cryptographic audit trail. This document may be used as
              evidence of the agent's acceptance of the terms in any dispute resolution process.
            </p>
            <p className="mt-2">
              <strong>Issued by:</strong> Janine Loves Ltd t/a JLT Group (Company No. 12178075) &nbsp;·&nbsp;
              <strong>Certificate generated:</strong> {format(new Date(), "d MMMM yyyy 'at' HH:mm 'UTC'")}
            </p>
          </div>
        </div>

        <DialogFooter className="flex gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handlePrint} className="gap-2">
            <Printer className="h-4 w-4" />
            Print / Save as PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminTermsTracker() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "signed" | "unsigned">("all");
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [versionLabel, setVersionLabel] = useState("v3 — May 2026");
  const [description, setDescription] = useState(
    "Updated terms including 6% minimum margin, Family & Friends vouchers, ICO registration clause, and revised liability cap."
  );
  const [deadline, setDeadline] = useState("2026-06-13");
  const [selectedAgent, setSelectedAgent] = useState<AgentRow | null>(null);

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
      ["Name", "Email", "Signed", "Signed At", "Signed Name", "IP Address", "User Agent"],
      ...data.agents.map((a) => [
        a.name ?? "",
        a.email ?? "",
        a.hasSigned ? "Yes" : "No",
        a.signedAt ? format(new Date(a.signedAt), "dd/MM/yyyy HH:mm") : "",
        a.signedName ?? "",
        (a as AgentRow).ipAddress ?? "",
        (a as AgentRow).userAgent ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `terms-signing-tracker-${data.activeVersion?.versionLabel ?? "export"}.csv`;
    anchor.click();
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
  }) as AgentRow[];

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
                  <TableHead>IP Address</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : filteredAgents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
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
                      <TableCell className="text-sm font-mono text-muted-foreground">
                        {agent.ipAddress ?? "—"}
                      </TableCell>
                      <TableCell>
                        {agent.hasSigned && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => setSelectedAgent(agent)}
                          >
                            <ScrollText className="h-3.5 w-3.5" />
                            Certificate
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Signing Certificate Modal */}
      {selectedAgent && data?.activeVersion && (
        <SigningCertificate
          agent={selectedAgent}
          versionLabel={data.activeVersion.versionLabel}
          onClose={() => setSelectedAgent(null)}
        />
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
                placeholder="e.g. v3 — May 2026"
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
