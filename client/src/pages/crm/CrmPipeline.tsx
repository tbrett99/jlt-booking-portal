import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { Plus, Search, Mail, Phone, ChevronRight, AlertTriangle } from "lucide-react";

const STAGES = [
  { key: "New Enquiry",           color: "#e0f2fe", border: "#0ea5e9", text: "#0369a1" },
  { key: "AR Submitted",          color: "#fef9c3", border: "#eab308", text: "#854d0e" },
  { key: "AR Approved",           color: "#dcfce7", border: "#22c55e", text: "#166534" },
  { key: "Discovery Call Booked", color: "#f3e8ff", border: "#a855f7", text: "#6b21a8" },
  { key: "Approved",              color: "#d1fae5", border: "#10b981", text: "#065f46" },
  { key: "Waitlisted",            color: "#fff7ed", border: "#f97316", text: "#9a3412" },
  { key: "Rejected",              color: "#fee2e2", border: "#ef4444", text: "#991b1b" },
  { key: "Lost",                  color: "#f1f5f9", border: "#94a3b8", text: "#475569" },
  { key: "Won",                   color: "#fef3c7", border: "#f59e0b", text: "#92400e" },
] as const;

type Stage = (typeof STAGES)[number]["key"];

const TAG_COLORS: Record<string, string> = {
  prospect: "bg-blue-100 text-blue-700",
  agent: "bg-green-100 text-green-700",
  "core team": "bg-purple-100 text-purple-700",
  cancelled: "bg-red-100 text-red-700",
};

function tagClass(tag: string) {
  return TAG_COLORS[tag.toLowerCase()] ?? "bg-gray-100 text-gray-700";
}

// Abandoned sign-up virtual card type
interface AbandonedCard {
  id: string; // "abandoned-{sessionId}"
  sessionId: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  stage: "New Enquiry";
  tags: string[];
  createdAt: Date;
  isAbandoned: true;
  progress: string;
  membershipTier?: string | null;
  daysIdle: number;
}

interface ProspectCard {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  stage: Stage;
  tags: string[];
  createdAt: Date;
  uniqueAgentId?: string | null;
  isAbandoned?: false;
}

type KanbanCard = ProspectCard | AbandonedCard;

export default function CrmPipeline() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [moveDialog, setMoveDialog] = useState<{ prospectId: number; name: string; currentStage: Stage } | null>(null);
  const [newStage, setNewStage] = useState<Stage>("New Enquiry");
  const [moveNote, setMoveNote] = useState("");
  const [addDialog, setAddDialog] = useState(false);
  const [newProspect, setNewProspect] = useState({ firstName: "", lastName: "", email: "", phone: "", marketingConsent: false });
  const [showAbandoned, setShowAbandoned] = useState(true);

  const { data: prospects = [], refetch } = trpc.crm.prospects.list.useQuery();
  const { data: abandonedSessions = [] } = trpc.join.getAbandonedSessions.useQuery({ daysIdle: 0 });

  const moveStage = trpc.crm.prospects.moveStage.useMutation({
    onSuccess: () => { refetch(); setMoveDialog(null); setMoveNote(""); toast.success("Stage updated"); },
  });
  const createProspect = trpc.crm.prospects.create.useMutation({
    onSuccess: () => { refetch(); setAddDialog(false); setNewProspect({ firstName: "", lastName: "", email: "", phone: "", marketingConsent: false }); toast.success("Prospect added"); },
    onError: (e) => toast.error(e.message),
  });

  // Build abandoned cards — only show if their email is NOT already a CRM prospect
  const prospectEmails = new Set((prospects as ProspectCard[]).map((p) => p.email.toLowerCase()));
  const abandonedCards: AbandonedCard[] = showAbandoned
    ? (abandonedSessions as any[])
        .filter((s) => !prospectEmails.has((s.email ?? "").toLowerCase()))
        .map((s) => {
          const emailParts = (s.email ?? "").split("@")[0].split(".");
          const firstName = emailParts[0] ? emailParts[0].charAt(0).toUpperCase() + emailParts[0].slice(1) : "Unknown";
          const lastName = emailParts[1] ? emailParts[1].charAt(0).toUpperCase() + emailParts[1].slice(1) : "";
          return {
            id: `abandoned-${s.id}`,
            sessionId: s.id,
            firstName,
            lastName,
            email: s.email ?? "",
            stage: "New Enquiry" as const,
            tags: ["sign-up"],
            createdAt: new Date(s.createdAt),
            isAbandoned: true as const,
            progress: s.progress ?? "Started application",
            membershipTier: s.membershipTier,
            daysIdle: s.daysIdle ?? 0,
          };
        })
    : [];

  const allCards: KanbanCard[] = [...(prospects as ProspectCard[]), ...abandonedCards];

  const filtered = allCards.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
  });

  const byStage = (stage: Stage) => filtered.filter((p) => p.stage === stage);

  const totalProspects = (prospects as any[]).length;
  const totalAbandoned = abandonedCards.length;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold">Recruitment Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            {totalProspects} prospects
            {showAbandoned && totalAbandoned > 0 && (
              <span className="ml-1 text-orange-600">+ {totalAbandoned} abandoned sign-up{totalAbandoned !== 1 ? "s" : ""}</span>
            )}
          </p>
        </div>
        <div className="flex gap-2 sm:ml-auto flex-wrap">
          <Button
            size="sm"
            variant={showAbandoned ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => setShowAbandoned((v) => !v)}
          >
            <AlertTriangle size={12} className="mr-1" />
            {showAbandoned ? "Hide" : "Show"} Abandoned Sign-ups
          </Button>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8 h-8 w-52 text-sm" placeholder="Search prospects…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Button size="sm" onClick={() => setAddDialog(true)}><Plus size={14} className="mr-1" />Add Prospect</Button>
        </div>
      </div>

      {/* Kanban board */}
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-3 min-w-max">
          {STAGES.map((stage) => {
            const cards = byStage(stage.key);
            return (
              <div key={stage.key} className="w-64 flex-shrink-0">
                <div
                  className="flex items-center justify-between px-3 py-2 rounded-t-lg text-xs font-semibold"
                  style={{ background: stage.color, borderBottom: `2px solid ${stage.border}`, color: stage.text }}
                >
                  <span>{stage.key}</span>
                  <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ background: stage.border, color: "#fff" }}>{cards.length}</span>
                </div>
                <div className="bg-muted/30 rounded-b-lg min-h-[200px] p-2 space-y-2 border border-t-0 border-border">
                  {cards.map((p: KanbanCard) => {
                    const isAbandoned = (p as AbandonedCard).isAbandoned === true;
                    return (
                      <Card
                        key={p.id}
                        className={`p-3 cursor-pointer hover:shadow-md transition-shadow group ${isAbandoned ? "border-orange-300 bg-orange-50/50" : ""}`}
                        onClick={() => {
                          if (!isAbandoned) navigate(`/crm/prospects/${(p as ProspectCard).id}`);
                          else navigate(`/crm/abandoned-signups`);
                        }}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: stage.color, color: stage.text }}>
                              {p.firstName[0]}{p.lastName[0] || "?"}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate">{p.firstName} {p.lastName}</p>
                              {!isAbandoned && (p as ProspectCard).uniqueAgentId && (
                                <p className="text-[10px] text-muted-foreground font-mono">{(p as ProspectCard).uniqueAgentId}</p>
                              )}
                              {isAbandoned && (
                                <span className="text-[9px] bg-orange-100 text-orange-700 px-1 py-0.5 rounded font-medium">Abandoned sign-up</span>
                              )}
                            </div>
                          </div>
                          <ChevronRight size={12} className="text-muted-foreground opacity-0 group-hover:opacity-100 flex-shrink-0 mt-0.5" />
                        </div>
                        <div className="mt-2 space-y-0.5">
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Mail size={10} /><span className="truncate">{p.email}</span>
                          </div>
                          {p.phone && <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Phone size={10} /><span>{p.phone}</span></div>}
                        </div>
                        {isAbandoned && (
                          <div className="mt-1.5 text-[10px] text-orange-600 truncate">{(p as AbandonedCard).progress}</div>
                        )}
                        {p.tags?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {p.tags.slice(0, 3).map((t: string) => (
                              <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${tagClass(t)}`}>{t}</span>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 pt-2 border-t border-border flex justify-between items-center">
                          <span className="text-[10px] text-muted-foreground">{new Date(p.createdAt).toLocaleDateString("en-GB")}</span>
                          {!isAbandoned && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-5 text-[10px] px-1.5 py-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMoveDialog({ prospectId: (p as ProspectCard).id, name: `${p.firstName} ${p.lastName}`, currentStage: p.stage as Stage });
                                setNewStage(p.stage as Stage);
                              }}
                            >
                              Move
                            </Button>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Move stage dialog */}
      <Dialog open={!!moveDialog} onOpenChange={() => setMoveDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Move Stage — {moveDialog?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>New Stage</Label>
              <Select value={newStage} onValueChange={(v) => setNewStage(v as Stage)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => <SelectItem key={s.key} value={s.key}>{s.key}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Textarea placeholder="Reason for moving…" value={moveNote} onChange={(e) => setMoveNote(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialog(null)}>Cancel</Button>
            <Button onClick={() => moveStage.mutate({ id: moveDialog!.prospectId, stage: newStage, note: moveNote || undefined })} disabled={moveStage.isPending}>
              {moveStage.isPending ? "Moving…" : "Move Stage"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add prospect dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Prospect</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>First Name *</Label>
              <Input value={newProspect.firstName} onChange={(e) => setNewProspect((p) => ({ ...p, firstName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name *</Label>
              <Input value={newProspect.lastName} onChange={(e) => setNewProspect((p) => ({ ...p, lastName: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" value={newProspect.email} onChange={(e) => setNewProspect((p) => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Phone</Label>
              <Input value={newProspect.phone} onChange={(e) => setNewProspect((p) => ({ ...p, phone: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)}>Cancel</Button>
            <Button onClick={() => createProspect.mutate(newProspect)} disabled={createProspect.isPending || !newProspect.firstName || !newProspect.lastName || !newProspect.email}>
              {createProspect.isPending ? "Adding…" : "Add Prospect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
