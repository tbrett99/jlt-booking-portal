import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Trophy, Plus, CheckCircle2, XCircle, Trash2, Download, ChevronLeft, Eye } from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Competition {
  id: number;
  title: string;
  description: string | null;
  prizeDescription: string;
  startDate: Date | string;
  endDate: Date | string;
  status: "draft" | "active" | "closed";
  createdAt: Date | string;
}

interface Entry {
  entry: {
    id: number;
    competitionId: number;
    agentId: number;
    bookingReference: string;
    bookingDate: Date | string;
    submittedAt: Date | string;
    verifiedStatus: "pending" | "approved" | "rejected";
    verifiedById: number | null;
    verifiedAt: Date | string | null;
    adminNotes: string | null;
  };
  agentName: string | null;
  agentEmail: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(d: Date | string) {
  return new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status: string) {
  if (status === "active") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Active</Badge>;
  if (status === "closed") return <Badge className="bg-slate-100 text-slate-600 border-slate-200">Closed</Badge>;
  return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Draft</Badge>;
}

function verifyBadge(status: string) {
  if (status === "approved") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Approved</Badge>;
  if (status === "rejected") return <Badge className="bg-red-100 text-red-700 border-red-200">Rejected</Badge>;
  return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Pending</Badge>;
}

// ─── Create / Edit Competition Dialog ────────────────────────────────────────

function CompetitionFormDialog({
  existing,
  onSuccess,
}: {
  existing?: Competition;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [prize, setPrize] = useState(existing?.prizeDescription ?? "");
  const [startDate, setStartDate] = useState(
    existing ? new Date(existing.startDate).toISOString().split("T")[0] : ""
  );
  const [endDate, setEndDate] = useState(
    existing ? new Date(existing.endDate).toISOString().split("T")[0] : ""
  );
  const [status, setStatus] = useState<"draft" | "active" | "closed">(existing?.status ?? "draft");

  const create = trpc.competitions.adminCreate.useMutation({
    onSuccess: () => {
      toast.success("Competition created");
      setOpen(false);
      utils.competitions.adminListAll.invalidate();
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  const update = trpc.competitions.adminUpdate.useMutation({
    onSuccess: () => {
      toast.success("Competition updated");
      setOpen(false);
      utils.competitions.adminListAll.invalidate();
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    const payload = {
      title,
      description: description || undefined,
      prizeDescription: prize,
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      status,
    };
    if (existing) {
      update.mutate({ id: existing.id, ...payload });
    } else {
      create.mutate(payload);
    }
  };

  const isValid = title && prize && startDate && endDate;
  const isPending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {existing ? (
          <Button variant="outline" size="sm">Edit</Button>
        ) : (
          <Button size="sm" className="gap-2"><Plus className="w-4 h-4" /> New Competition</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Competition" : "Create Competition"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. EasyJet Summer Incentive" />
          </div>
          <div className="space-y-1.5">
            <Label>Prize Description</Label>
            <Input value={prize} onChange={(e) => setPrize(e.target.value)} placeholder="e.g. £500 Cash Prize Draw" />
          </div>
          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description shown to agents"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>End Date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" disabled={!isValid || isPending} onClick={handleSubmit}>
            {isPending ? "Saving…" : existing ? "Save Changes" : "Create Competition"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Entries Panel ────────────────────────────────────────────────────────────

function EntriesPanel({ competition, onBack }: { competition: Competition; onBack: () => void }) {
  const utils = trpc.useUtils();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [rejectNotes, setRejectNotes] = useState<Record<number, string>>({});

  const { data: entries, isLoading } = trpc.competitions.adminListEntries.useQuery({ competitionId: competition.id });
  const { data: exportData } = trpc.competitions.adminExportEntries.useQuery({ competitionId: competition.id });

  const verify = trpc.competitions.adminVerifyEntry.useMutation({
    onSuccess: () => {
      utils.competitions.adminListEntries.invalidate({ competitionId: competition.id });
      utils.competitions.adminExportEntries.invalidate({ competitionId: competition.id });
      utils.competitions.getLeaderboard.invalidate({ competitionId: competition.id });
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkApprove = trpc.competitions.adminBulkApprove.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.count} entries approved`);
      setSelectedIds([]);
      utils.competitions.adminListEntries.invalidate({ competitionId: competition.id });
      utils.competitions.adminExportEntries.invalidate({ competitionId: competition.id });
      utils.competitions.getLeaderboard.invalidate({ competitionId: competition.id });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteEntry = trpc.competitions.adminDeleteEntry.useMutation({
    onSuccess: () => {
      utils.competitions.adminListEntries.invalidate({ competitionId: competition.id });
      utils.competitions.adminExportEntries.invalidate({ competitionId: competition.id });
      utils.competitions.getLeaderboard.invalidate({ competitionId: competition.id });
    },
    onError: (e) => toast.error(e.message),
  });

  const handleExportCSV = () => {
    if (!exportData || exportData.length === 0) {
      toast.info("No approved entries to export");
      return;
    }
    const headers = ["Agent Name", "Agent Email", "Booking Reference", "Booking Date", "Submitted At"];
    const rows = exportData.map((e) => [
      e.agentName ?? "",
      e.agentEmail ?? "",
      e.bookingReference,
      formatDate(e.bookingDate),
      formatDateTime(e.submittedAt),
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${competition.title.replace(/\s+/g, "_")}_draw_entries.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pendingEntries = entries?.filter((e) => e.entry.verifiedStatus === "pending") ?? [];
  const allEntries = entries ?? [];

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ChevronLeft className="w-4 h-4" /> Back
        </Button>
        <div>
          <h2 className="font-semibold">{competition.title}</h2>
          <p className="text-xs text-muted-foreground">{allEntries.length} total entries · {pendingEntries.length} pending</p>
        </div>
        <div className="ml-auto flex gap-2">
          {selectedIds.length > 0 && (
            <Button size="sm" variant="outline" className="gap-1 text-emerald-700 border-emerald-300"
              onClick={() => bulkApprove.mutate({ entryIds: selectedIds })}
              disabled={bulkApprove.isPending}
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Approve {selectedIds.length}
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1" onClick={handleExportCSV}>
            <Download className="w-3.5 h-3.5" /> Export Draw List
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-muted rounded" />)}
        </div>
      ) : allEntries.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No entries yet.</div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={selectedIds.length === pendingEntries.length && pendingEntries.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedIds(pendingEntries.map((e) => e.entry.id));
                      else setSelectedIds([]);
                    }}
                  />
                </TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Booking Ref</TableHead>
                <TableHead>Booked</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allEntries.map(({ entry, agentName, agentEmail }) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    {entry.verifiedStatus === "pending" && (
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={selectedIds.includes(entry.id)}
                        onChange={() => toggleSelect(entry.id)}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{agentName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{agentEmail ?? ""}</div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{entry.bookingReference}</TableCell>
                  <TableCell className="text-sm">{formatDate(entry.bookingDate)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDateTime(entry.submittedAt)}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {verifyBadge(entry.verifiedStatus)}
                      {entry.adminNotes && (
                        <p className="text-xs text-muted-foreground">{entry.adminNotes}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {entry.verifiedStatus === "pending" && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="w-7 h-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                            onClick={() => verify.mutate({ entryId: entry.id, status: "approved" })}
                            title="Approve"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="w-7 h-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => {
                              const notes = rejectNotes[entry.id] ?? "";
                              verify.mutate({ entryId: entry.id, status: "rejected", adminNotes: notes || undefined });
                            }}
                            title="Reject"
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-7 h-7 text-muted-foreground hover:text-red-500"
                        onClick={() => {
                          if (confirm("Delete this entry?")) deleteEntry.mutate({ entryId: entry.id });
                        }}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────

export default function AdminCompetitions() {
  const { data: competitions, isLoading, refetch } = trpc.competitions.adminListAll.useQuery();
  const [viewingComp, setViewingComp] = useState<Competition | null>(null);

  if (viewingComp) {
    return (
      <div className="container py-6 max-w-5xl">
        <EntriesPanel competition={viewingComp} onBack={() => setViewingComp(null)} />
      </div>
    );
  }

  return (
    <div className="container py-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Trophy className="w-6 h-6 text-amber-500" />
          <h1 className="text-2xl font-bold">Competitions</h1>
        </div>
        <CompetitionFormDialog onSuccess={refetch} />
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2].map((i) => <div key={i} className="h-24 bg-muted rounded-lg" />)}
        </div>
      ) : !competitions || competitions.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Trophy className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No competitions yet</p>
            <p className="text-sm mt-1">Create your first competition to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {competitions.map((comp) => (
            <Card key={comp.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="py-4 px-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {statusBadge(comp.status)}
                      <span className="font-semibold truncate">{comp.title}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Trophy className="w-3.5 h-3.5 text-amber-500" />
                        {comp.prizeDescription}
                      </span>
                      <span>{formatDate(comp.startDate)} – {formatDate(comp.endDate)}</span>
                    </div>
                    {comp.description && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">{comp.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => setViewingComp(comp)}
                    >
                      <Eye className="w-3.5 h-3.5" /> Entries
                    </Button>
                    <CompetitionFormDialog existing={comp} onSuccess={refetch} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
