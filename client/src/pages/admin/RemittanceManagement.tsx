import React, { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Upload,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Send,
  Trash2,
  Search,
  ClipboardCheck,
  BadgeCheck,
} from "lucide-react";

// ─── CSV Helpers ──────────────────────────────────────────────────────────────

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const values = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) ?? line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? "").trim().replace(/^"|"$/g, "");
    });
    return row;
  });
}

function exportToCsv(filename: string, rows: Record<string, string>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      headers.map((h) => `"${(r[h] ?? "").replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fmt(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = parseFloat(String(v));
  if (isNaN(n)) return String(v);
  return `£${n.toFixed(2)}`;
}

// ─── Upload Dialog ────────────────────────────────────────────────────────────

function UploadDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [weekOf, setWeekOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadMutation = trpc.remittance.uploadBatch.useMutation({
    onSuccess: (data) => {
      toast.success(`Batch uploaded — ${data.totalLines} rows, ${data.matchedCount} matched, ${data.unmatchedCount} unmatched`);
      onSuccess();
      onClose();
      setRows([]);
      setFileName("");
      setName("");
    },
    onError: (e) => toast.error(`Upload failed: ${e.message}`),
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    if (!name) setName(`Week of ${weekOf}`);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRows(parseCsv(text));
    };
    reader.readAsText(file);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Remittance CSV</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Batch Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Week of 14 Apr 2026"
            />
          </div>
          <div>
            <Label>Week Of</Label>
            <Input type="date" value={weekOf} onChange={(e) => setWeekOf(e.target.value)} />
          </div>
          <div>
            <Label>CSV File</Label>
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              {fileName ? (
                <p className="text-sm font-medium">{fileName}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Click to select CSV (PTS or JLT Commissions format)</p>
              )}
              {rows.length > 0 && (
                <p className="text-xs text-green-600 mt-1">{rows.length} rows parsed</p>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name || !weekOf || rows.length === 0 || uploadMutation.isPending}
            onClick={() => uploadMutation.mutate({ name, weekOf, rows })}
          >
            {uploadMutation.isPending ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Janine's View ────────────────────────────────────────────────────────────

function JaninesView({ batchId }: { batchId?: number }) {
  const { data: lines = [], isLoading } = trpc.remittance.getJaninesView.useQuery({ batchId }, { staleTime: 0 });

  const exportJanines = () => {
    const rows = lines.map((l) => ({
      "Batch": l.batchName,
      "Week Of": l.weekOf ? new Date(l.weekOf).toLocaleDateString("en-GB") : "",
      "Client": l.clientName,
      "Booking Reference": l.ptsRef,
      "Return Date": l.returnDate ?? "",
      "PAX": String(l.pax ?? ""),
      "Currency": l.currency ?? "GBP",
      "Total IN": fmt(l.totalIn),
      "Total OUT": fmt(l.totalOut),
      "SFI": fmt(l.sfi),
      "SAFI": fmt(l.safi),
      "PTRC": fmt(l.ptrc),
      "PTS Fee": fmt(l.pts),
      "VAT": fmt((l as any).vatFromPortal ?? l.vatFromPts),
      "Booking Type": (l as any).bookingType ?? "",
      "Remittance": l.remittance,
      "0.80": l.remit80 ?? "",
      "0.20": l.jlt20 ?? "",
      "Agent": l.agentName ?? "",
      "Agent Email": l.agentEmail ?? "",
      "Matched": l.isMatched ? "Yes" : "No",
      "Notes": l.adminNotes ?? "",
    }));
    // Add totals row
    const sumField = (field: (l: typeof lines[0]) => string | number | null | undefined) =>
      lines.reduce((acc, l) => acc + (parseFloat(String(field(l) ?? 0)) || 0), 0);
    const totalsRow: Record<string, string> = {
      "Batch": "TOTALS",
      "Week Of": "",
      "Client": `${lines.length} bookings`,
      "Booking Reference": "",
      "Return Date": "",
      "PAX": String(lines.reduce((acc, l) => acc + (Number(l.pax) || 0), 0)),
      "Currency": "",
      "Total IN": `£${sumField(l => l.totalIn).toFixed(2)}`,
      "Total OUT": `£${sumField(l => l.totalOut).toFixed(2)}`,
      "SFI": `£${sumField(l => l.sfi).toFixed(2)}`,
      "SAFI": `£${sumField(l => l.safi).toFixed(2)}`,
      "PTRC": `£${sumField(l => l.ptrc).toFixed(2)}`,
      "PTS Fee": `£${sumField(l => l.pts).toFixed(2)}`,
      "VAT": `£${sumField(l => (l as any).vatFromPortal ?? l.vatFromPts).toFixed(2)}`,
      "Booking Type": "",
      "Remittance": `£${sumField(l => parseFloat(String(l.remittance ?? 0).replace(/[^0-9.-]/g, ""))).toFixed(2)}`,
      "0.80": `£${sumField(l => parseFloat(String(l.remit80 ?? 0).replace(/[^0-9.-]/g, ""))).toFixed(2)}`,
      "0.20": `£${sumField(l => parseFloat(String(l.jlt20 ?? 0).replace(/[^0-9.-]/g, ""))).toFixed(2)}`,
      "Agent": "",
      "Agent Email": "",
      "Matched": "",
      "Notes": "",
    };
    exportToCsv("janines-view.csv", [...rows, totalsRow]);
  };

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading…</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">{lines.length} rows</p>
        <Button size="sm" variant="outline" onClick={exportJanines}>
          <Download className="h-4 w-4 mr-2" />Full Export
        </Button>
      </div>
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>PTS Ref</TableHead>
              <TableHead>Return</TableHead>
              <TableHead>PAX</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Total IN</TableHead>
              <TableHead>Total OUT</TableHead>
              <TableHead>SFI</TableHead>
              <TableHead>SAFI</TableHead>
              <TableHead>PTRC</TableHead>
              <TableHead>PTS</TableHead>
              <TableHead>VAT</TableHead>
              <TableHead>Remittance</TableHead>
              <TableHead>80%</TableHead>
              <TableHead>20%</TableHead>
              <TableHead>Booking Type</TableHead>
              <TableHead>Agent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  No data
                </TableCell>
              </TableRow>
            )}
            {lines.map((l) => (
                <TableRow key={l.id} className={!l.isMatched ? "bg-amber-50 dark:bg-amber-950/20" : ""}>
                <TableCell>
                  {l.isMatched ? (
                    <Badge variant="outline" className="text-green-600 border-green-300">Matched</Badge>
                  ) : (
                    <Badge variant="outline" className="text-amber-600 border-amber-300">
                      <AlertTriangle className="h-3 w-3 mr-1" />Unmatched
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs">{l.batchName}</TableCell>
                <TableCell className="font-medium">{l.clientName}</TableCell>
                <TableCell className="font-mono text-xs">{l.ptsRef}</TableCell>
                <TableCell className="text-xs">{l.returnDate ?? "—"}</TableCell>
                <TableCell className="text-xs">{l.pax ?? "—"}</TableCell>
                <TableCell className="text-xs">{l.currency ?? "GBP"}</TableCell>
                <TableCell className="text-xs">{fmt(l.totalIn)}</TableCell>
                <TableCell className="text-xs">{fmt(l.totalOut)}</TableCell>
                <TableCell className="text-xs">{fmt(l.sfi)}</TableCell>
                <TableCell className="text-xs">{fmt(l.safi)}</TableCell>
                <TableCell className="text-xs">{fmt(l.ptrc)}</TableCell>
                <TableCell className="text-xs">{fmt(l.pts)}</TableCell>
                <TableCell className="text-xs font-medium">
                  {(l as any).vatFromPortal ? fmt((l as any).vatFromPortal) : <span className="text-muted-foreground text-xs">—</span>}
                </TableCell>
                <TableCell className="font-medium">{fmt(l.remittance)}</TableCell>
                <TableCell className="text-green-700 dark:text-green-400">{fmt(l.remit80)}</TableCell>
                <TableCell className="text-blue-700 dark:text-blue-400">{fmt(l.jlt20)}</TableCell>
                <TableCell className="text-xs capitalize">{(l as any).bookingType ?? "—"}</TableCell>
                <TableCell className="text-xs">{l.agentName ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Agent View ───────────────────────────────────────────────────────────────

function AgentView({ batchId, batchName }: { batchId?: number; batchName?: string }) {
  const { data: agents = [], isLoading } = trpc.remittance.getAgentView.useQuery({ batchId }, { staleTime: 0 });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const utils = trpc.useUtils();

  const pushMutation = trpc.remittance.pushToAgents.useMutation({
    onSuccess: (data) => {
      toast.success(`Pushed to agents — ${data.pushed} lines sent`);
      utils.remittance.getBatches.invalidate();
      utils.remittance.getAgentView.invalidate();
    },
    onError: (e) => toast.error(`Push failed: ${e.message}`),
  });

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const exportAgentView = () => {
    const rows = agents.flatMap((a) =>
      a.lines.map((l: any) => ({
        "Agent": a.agentName,
        "Agent Email": a.agentEmail,
        "Batch": l.batchName,
        "Week Of": l.weekOf ? new Date(l.weekOf).toLocaleDateString("en-GB") : "",
        "Client": l.clientName,
        "PTS Ref": l.ptsRef,
        "Return Date": l.returnDate ?? "",
        "PAX": String(l.pax ?? ""),
        "Currency": l.currency ?? "GBP",
        "Total IN": fmt(l.totalIn),
        "Total OUT": fmt(l.totalOut),
        "SFI": fmt(l.sfi),
        "SAFI": fmt(l.safi),
        "PTRC": fmt(l.ptrc),
        "PTS Fee": fmt(l.pts),
        "VAT": fmt((l as any).vatFromPortal ?? l.vatFromPts),
        "Remittance": l.remittance,
        "Agent 80%": l.remit80 ?? "",
        "Pushed": l.pushedToAgent ? "Yes" : "No",
      }))
    );
    exportToCsv(`agent-view${batchName ? `-${batchName}` : ""}.csv`, rows);
  };

  const exportPaymentSummary = () => {
    const rows = agents.map((a) => {
      const total = a.lines.reduce((sum: number, l: any) => {
        const v = parseFloat(String(l.remit80 ?? 0).replace(/[^0-9.-]/g, ""));
        return sum + (isNaN(v) ? 0 : v);
      }, 0);
      return {
        "Agent": a.agentName ?? "",
        "Agent Email": a.agentEmail ?? "",
        "Number of Claims": String(a.lines.length),
        "Total to Pay (80%)": `£${total.toFixed(2)}`,
      };
    });
    // Add grand total row
    const grandTotal = agents.reduce((sum, a) =>
      sum + a.lines.reduce((s: number, l: any) => {
        const v = parseFloat(String(l.remit80 ?? 0).replace(/[^0-9.-]/g, ""));
        return s + (isNaN(v) ? 0 : v);
      }, 0), 0);
    const totalClaims = agents.reduce((sum, a) => sum + a.lines.length, 0);
    rows.push({
      "Agent": "TOTAL",
      "Agent Email": "",
      "Number of Claims": String(totalClaims),
      "Total to Pay (80%)": `£${grandTotal.toFixed(2)}`,
    });
    exportToCsv(`payment-summary${batchName ? `-${batchName}` : ""}.csv`, rows);
  };

  const [confirmPush, setConfirmPush] = useState(false);

  const handlePush = () => {
    setConfirmPush(true);
  };

  const confirmAndPush = () => {
    if (batchId === undefined) {
      toast.error("Please select a batch before pushing to agents");
      return;
    }
    pushMutation.mutate({ batchId });
    setConfirmPush(false);
  };

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading…</div>;

  const unpushedCount = agents.reduce(
    (sum, a) => sum + a.lines.filter((l: any) => !l.pushedToAgent).length,
    0
  );

  return (
    <div>
      {/* Push confirmation dialog */}
      <Dialog open={confirmPush} onOpenChange={setConfirmPush}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Push to Agents?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will send {unpushedCount} remittance line{unpushedCount !== 1 ? "s" : ""} to{" "}
            {agents.filter((a) => a.lines.some((l: any) => !l.pushedToAgent)).length} agent{agents.filter((a) => a.lines.some((l: any) => !l.pushedToAgent)).length !== 1 ? "s" : ""}.
            Each agent will see their remittance breakdown in their portal dashboard.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPush(false)}>Cancel</Button>
            <Button onClick={confirmAndPush} disabled={pushMutation.isPending}>
              <Send className="h-4 w-4 mr-2" />
              {pushMutation.isPending ? "Pushing…" : "Confirm Push"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">{agents.length} agents</p>
        <div className="flex gap-2">
          {unpushedCount > 0 && (
            <Button
              size="sm"
              onClick={handlePush}
              disabled={pushMutation.isPending || batchId === undefined}
              title={batchId === undefined ? "Select a batch to push" : undefined}
            >
              <Send className="h-4 w-4 mr-2" />
              {pushMutation.isPending ? "Pushing…" : `Push to Agents (${unpushedCount})`}
            </Button>
          )}
          {unpushedCount === 0 && agents.length > 0 && (
            <Badge variant="outline" className="text-green-600 border-green-300 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />All pushed
            </Badge>
          )}
          <Button size="sm" variant="outline" onClick={exportPaymentSummary} title="One row per agent showing total to pay">
            <Download className="h-4 w-4 mr-2" />Payment Summary
          </Button>
          <Button size="sm" variant="outline" onClick={exportAgentView}>
            <Download className="h-4 w-4 mr-2" />Export CSV
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {agents.length === 0 && (
          <div className="text-center text-muted-foreground py-8">No matched lines</div>
        )}
        {agents.map((agent) => {
          const key = agent.agentEmail || agent.agentName;
          const isOpen = expanded.has(key);
          const unpushed = agent.lines.filter((l: any) => !l.pushedToAgent).length;
          return (
            <Card key={key} className="overflow-hidden">
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50"
                onClick={() => toggle(key)}
              >
                <div className="flex items-center gap-3">
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <div>
                    <p className="font-medium">{agent.agentName}</p>
                    <p className="text-xs text-muted-foreground">{agent.agentEmail}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {unpushed > 0 && (
                    <Badge variant="outline" className="text-amber-600 border-amber-300">
                      {unpushed} unpushed
                    </Badge>
                  )}
                  <span className="font-semibold text-green-700 dark:text-green-400">
                    {fmt(agent.totalRemit80)} total
                  </span>
                  <Badge variant="secondary">{agent.lines.length} bookings</Badge>
                </div>
              </div>
              {isOpen && (
                <div className="border-t">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>PTS Ref</TableHead>
                        <TableHead>Return</TableHead>
                        <TableHead>Batch</TableHead>
                        <TableHead>Currency</TableHead>
                        <TableHead>Total IN</TableHead>
                        <TableHead>Total OUT</TableHead>
                        <TableHead>SFI</TableHead>
                        <TableHead>SAFI</TableHead>
                        <TableHead>PTRC</TableHead>
                        <TableHead>PTS</TableHead>
                        <TableHead>VAT</TableHead>
                        <TableHead>Remittance</TableHead>
                        <TableHead>Agent 80%</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {agent.lines.map((l: any) => (
                        <TableRow key={l.id}>
                          <TableCell className="font-medium">{l.clientName}</TableCell>
                          <TableCell className="font-mono text-xs">{l.ptsRef}</TableCell>
                          <TableCell className="text-xs">{l.returnDate ?? "—"}</TableCell>
                          <TableCell className="text-xs">{l.batchName}</TableCell>
                          <TableCell className="text-xs">{l.currency ?? "GBP"}</TableCell>
                          <TableCell className="text-xs">{fmt(l.totalIn)}</TableCell>
                          <TableCell className="text-xs">{fmt(l.totalOut)}</TableCell>
                          <TableCell className="text-xs">{fmt(l.sfi)}</TableCell>
                          <TableCell className="text-xs">{fmt(l.safi)}</TableCell>
                          <TableCell className="text-xs">{fmt(l.ptrc)}</TableCell>
                          <TableCell className="text-xs">{fmt(l.pts)}</TableCell>
                          <TableCell className="text-xs font-medium">
                            {l.vatFromPortal ? fmt(l.vatFromPortal) : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell>{fmt(l.remittance)}</TableCell>
                          <TableCell className="text-green-700 dark:text-green-400 font-semibold">
                            {fmt(l.remit80)}
                          </TableCell>
                          <TableCell>
                            {l.pushedToAgent ? (
                              <Badge variant="outline" className="text-green-600 border-green-300">
                                <CheckCircle2 className="h-3 w-3 mr-1" />Pushed
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">Pending</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Needs Review Panel ──────────────────────────────────────────────────────

function NeedsReviewPanel({ batchId }: { batchId?: number }) {
  const { data: lines = [], isLoading } = trpc.remittance.getNeedsReview.useQuery({ batchId });
  const utils = trpc.useUtils();

  const approveMutation = trpc.remittance.approveProcessingClaim.useMutation({
    onSuccess: () => {
      toast.success("Commission claim approved and marked as Paid");
      utils.remittance.getNeedsReview.invalidate();
      utils.remittance.getJaninesView.invalidate();
      utils.remittance.getAgentView.invalidate();
    },
    onError: (e) => toast.error(`Approval failed: ${e.message}`),
  });

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading…</div>;

  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
        <p className="font-medium">No items need review</p>
        <p className="text-sm text-muted-foreground">
          All matched bookings had commission claims in the correct state.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 p-3 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-orange-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-orange-700 dark:text-orange-400">
            {lines.length} booking{lines.length !== 1 ? "s" : ""} matched on PTS remittance but commission is still in Processing
          </p>
          <p className="text-xs text-orange-600 dark:text-orange-500 mt-1">
            This usually means an admin claimed the booking in PTS but hasn’t yet clicked “Claimed in PTS” in the portal.
            Review each booking and click Approve to advance the commission claim to Paid.
          </p>
        </div>
      </div>
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>PTS Ref</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Remittance</TableHead>
              <TableHead>80%</TableHead>
              <TableHead>Claim Type</TableHead>
              <TableHead>Claim Status</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.id} className="bg-orange-50/50 dark:bg-orange-950/10">
                <TableCell className="font-medium">{l.clientName}</TableCell>
                <TableCell className="font-mono text-xs text-orange-700">{l.ptsRef}</TableCell>
                <TableCell className="text-xs">{l.agentName ?? "—"}</TableCell>
                <TableCell className="text-xs">{l.batchName}</TableCell>
                <TableCell>{fmt(l.remittance)}</TableCell>
                <TableCell className="text-green-700 dark:text-green-400 font-semibold">{fmt(l.remit80)}</TableCell>
                <TableCell className="text-xs capitalize">{(l as any).claim?.bookingType ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-orange-600 border-orange-300">
                    Processing
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    onClick={() => approveMutation.mutate({ lineId: l.id })}
                    disabled={approveMutation.isPending}
                  >
                    <ClipboardCheck className="h-3 w-3 mr-1" />
                    Approve
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Unmatched Panel ──────────────────────────────────────────────────────────

function UnmatchedPanel({ batchId }: { batchId?: number }) {
  const { data: allLines = [] } = trpc.remittance.getJaninesView.useQuery({ batchId });
  const unmatched = allLines.filter((l) => !l.isMatched);
  const [matchingId, setMatchingId] = useState<number | null>(null);
  const [searchRef, setSearchRef] = useState("");
  const utils = trpc.useUtils();

  const matchMutation = trpc.remittance.matchLine.useMutation({
    onSuccess: () => {
      toast.success("Line matched successfully");
      setMatchingId(null);
      setSearchRef("");
      utils.remittance.getJaninesView.invalidate();
      utils.remittance.getAgentView.invalidate();
      utils.remittance.getBatches.invalidate();
    },
    onError: (e) => toast.error(`Match failed: ${e.message}`),
  });

  const { data: searchResults = [] } = trpc.bookings.quickSearch.useQuery(
    { query: searchRef },
    { enabled: searchRef.length >= 3 }
  );

  if (unmatched.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
        <p className="font-medium">All rows matched</p>
        <p className="text-sm text-muted-foreground">No unmatched PTS references in this batch</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {unmatched.length} row{unmatched.length !== 1 ? "s" : ""} could not be matched to a booking by PTS reference.
          Manually match them below before exporting or pushing to agents.
        </p>
      </div>
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>PTS Ref</TableHead>
              <TableHead>Return Date</TableHead>
              <TableHead>Remittance</TableHead>
              <TableHead>80%</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unmatched.map((l) => (
              <TableRow key={l.id} className="bg-amber-50/50 dark:bg-amber-950/10">
                <TableCell className="font-medium">{l.clientName}</TableCell>
                <TableCell className="font-mono text-xs text-amber-700">{l.ptsRef}</TableCell>
                <TableCell className="text-xs">{l.returnDate ?? "—"}</TableCell>
                <TableCell>{fmt(l.remittance)}</TableCell>
                <TableCell>{fmt(l.remit80)}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => setMatchingId(l.id)}>
                    <Search className="h-3 w-3 mr-1" />Match
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Match dialog */}
      <Dialog open={matchingId !== null} onOpenChange={() => setMatchingId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Match to Booking</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Search for the booking by client name, PTS ref, or booking ID.
            </p>
            <Input
              placeholder="Search bookings…"
              value={searchRef}
              onChange={(e) => setSearchRef(e.target.value)}
            />
            {searchResults.length > 0 && (
              <div className="border rounded-md max-h-48 overflow-y-auto">
                {searchResults.map((b: any) => (
                  <div
                    key={b.id}
                    className="p-3 hover:bg-muted cursor-pointer border-b last:border-0"
                    onClick={() =>
                      matchingId !== null &&
                      matchMutation.mutate({ lineId: matchingId, bookingId: b.id })
                    }
                  >
                    <p className="font-medium text-sm">{b.clientName}</p>
                    <p className="text-xs text-muted-foreground">
                      #{b.id} · PTS: {b.ptsRef ?? "—"} · Agent: {b.agentName ?? "—"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatchingId(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Needs Review Badge wrapper ──────────────────────────────────────────────

function NeedsReviewBadge({
  batchId,
  children,
}: {
  batchId?: number;
  children: (count: number) => React.ReactNode;
}) {
  const { data: lines = [] } = trpc.remittance.getNeedsReview.useQuery({ batchId });
  return <>{children(lines.length)}</>;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RemittanceManagement() {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<number | undefined>(undefined);
  const utils = trpc.useUtils();

  const { data: batches = [], isLoading: batchesLoading } = trpc.remittance.getBatches.useQuery();

  const [markPaidConfirmOpen, setMarkPaidConfirmOpen] = useState(false);
  const markBatchPaidMutation = trpc.remittance.markBatchPaid.useMutation({
    onSuccess: (data) => {
      toast.success(`Marked ${data.paidCount} claims as paid and notified ${data.pushedCount} agents`);
      setMarkPaidConfirmOpen(false);
      utils.remittance.getBatches.invalidate();
      utils.remittance.getJaninesView.invalidate();
      utils.remittance.getAgentView.invalidate();
      utils.remittance.getNeedsReview.invalidate();
    },
    onError: (e) => toast.error(`Mark paid failed: ${e.message}`),
  });
  const deleteMutation = trpc.remittance.deleteBatch.useMutation({
    onSuccess: () => {
      toast.success("Batch deleted");
      setSelectedBatchId(undefined);
      utils.remittance.getBatches.invalidate();
      utils.remittance.getJaninesView.invalidate();
      utils.remittance.getAgentView.invalidate();
    },
    onError: (e) => toast.error(`Delete failed: ${e.message}`),
  });

  const selectedBatch = batches.find((b) => b.id === selectedBatchId);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">PTS Remittance</h1>
          <p className="text-muted-foreground text-sm">
            Upload weekly PTS remittance CSVs, match to bookings, and push to agents.
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)}>
          <Upload className="h-4 w-4 mr-2" />Upload Remittance
        </Button>
      </div>

      {/* Batch selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Batches</CardTitle>
        </CardHeader>
        <CardContent>
          {batchesLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No batches uploaded yet.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Select
                  value={selectedBatchId ? String(selectedBatchId) : "all"}
                  onValueChange={(v) =>
                    setSelectedBatchId(v === "all" ? undefined : parseInt(v))
                  }
                >
                  <SelectTrigger className="w-72">
                    <SelectValue placeholder="All batches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All batches</SelectItem>
                    {batches.map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.name} — {new Date(b.weekOf).toLocaleDateString("en-GB")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedBatch && (
                  <>
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                      onClick={() => setMarkPaidConfirmOpen(true)}
                      disabled={markBatchPaidMutation.isPending}
                    >
                      <BadgeCheck className="h-4 w-4 mr-1.5" />
                      Mark All Paid
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Delete batch "${selectedBatch.name}"? This cannot be undone.`)) {
                          deleteMutation.mutate({ batchId: selectedBatch.id });
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
              {selectedBatch && (
                <div className="flex gap-4 text-sm">
                  <span>
                    <span className="text-muted-foreground">Total:</span>{" "}
                    <span className="font-medium">£{parseFloat(String(selectedBatch.totalRemittance)).toFixed(2)}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">Lines:</span>{" "}
                    <span className="font-medium">{selectedBatch.totalLines}</span>
                  </span>
                  <span className="text-green-600">
                    ✓ {selectedBatch.matchedLines} matched
                  </span>
                  {selectedBatch.unmatchedLines > 0 && (
                    <span className="text-amber-600">
                      ⚠ {selectedBatch.unmatchedLines} unmatched
                    </span>
                  )}
                  {selectedBatch.pushedToAgentsAt && (
                    <span className="text-blue-600">
                      Pushed {new Date(selectedBatch.pushedToAgentsAt).toLocaleDateString("en-GB")}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Views */}
      <NeedsReviewBadge batchId={selectedBatchId}>
        {(reviewCount) => (
          <Tabs defaultValue="janines">
            <TabsList>
              <TabsTrigger value="janines">Janine's View</TabsTrigger>
              <TabsTrigger value="agents">Agent View</TabsTrigger>
              <TabsTrigger value="review" className="relative">
                Needs Review
                {reviewCount > 0 && (
                  <Badge className="ml-2 bg-orange-500 text-white text-xs">
                    {reviewCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="unmatched">
                Unmatched
                {selectedBatch?.unmatchedLines ? (
                  <Badge className="ml-2 bg-amber-500 text-white text-xs">
                    {selectedBatch.unmatchedLines}
                  </Badge>
                ) : null}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="janines" className="mt-4">
              <JaninesView batchId={selectedBatchId} />
            </TabsContent>
            <TabsContent value="agents" className="mt-4">
              <AgentView batchId={selectedBatchId} batchName={selectedBatch?.name} />
            </TabsContent>
            <TabsContent value="review" className="mt-4">
              <NeedsReviewPanel batchId={selectedBatchId} />
            </TabsContent>
            <TabsContent value="unmatched" className="mt-4">
              <UnmatchedPanel batchId={selectedBatchId} />
            </TabsContent>
          </Tabs>
        )}
      </NeedsReviewBadge>

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={() => {
          utils.remittance.getBatches.invalidate();
          utils.remittance.getJaninesView.invalidate();
          utils.remittance.getAgentView.invalidate();
        }}
      />

      {/* Mark All Paid confirm dialog */}
      <Dialog open={markPaidConfirmOpen} onOpenChange={setMarkPaidConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BadgeCheck className="h-5 w-5 text-emerald-600" />
              Mark All Paid — {selectedBatch?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              This will:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>Mark all matched commission claims in this batch as <strong className="text-foreground">Paid</strong></li>
              <li>Set the VAT amount on each claim from the CSV data</li>
              <li>Send a payment notification to each agent via email and in-app message</li>
            </ul>
            <div className="rounded-lg p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                {selectedBatch?.matchedLines ?? 0} matched bookings · £{parseFloat(String(selectedBatch?.totalRemittance ?? "0")).toFixed(2)} total
              </p>
            </div>
            <p className="text-xs text-amber-600 font-medium">
              ⚠ This action cannot be undone. Only proceed once you have confirmed payment has been made.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPaidConfirmOpen(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={markBatchPaidMutation.isPending || !selectedBatchId}
              onClick={() => selectedBatchId && markBatchPaidMutation.mutate({ batchId: selectedBatchId })}
            >
              {markBatchPaidMutation.isPending ? "Processing…" : "Confirm — Mark All Paid"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
