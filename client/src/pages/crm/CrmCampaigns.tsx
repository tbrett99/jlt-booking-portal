import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Plus, Send, Eye, Pencil, RefreshCw, X, Check, Search } from "lucide-react";
import { useState as useStateAlias, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";

const PROSPECT_STAGES: { value: string; label: string }[] = [
  { value: "new_enquiry",             label: "New Enquiry" },
  { value: "application_received",    label: "AR Submitted" },
  { value: "ar_approved",             label: "AR Approved" },
  { value: "ar_declined",             label: "AR Declined" },
  { value: "discovery_call_booked",   label: "Discovery Call Booked" },
  { value: "discovery_call_complete", label: "Call Complete" },
  { value: "did_not_turn_up",         label: "Did Not Turn Up" },
  { value: "rebook_required",         label: "Rebook Required" },
  { value: "onboarding_approved",     label: "Approved" },
  { value: "archived",                label: "Archived" },
  { value: "won",                     label: "Won" },
];

const statusColor: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sending: "bg-blue-100 text-blue-700",
  sent: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

type FormState = {
  name: string;
  subject: string;
  bodyHtml: string;
  audienceType: "prospect" | "agent";
  stages: string[];
  stageLogic: "any" | "all";
};

const defaultForm: FormState = {
  name: "", subject: "", bodyHtml: "", audienceType: "prospect", stages: [], stageLogic: "any",
};

function buildFilters(stages: string[], stageLogic: "any" | "all") {
  if (stages.length === 0) return undefined;
  return JSON.stringify({ stages, stageLogic: stageLogic === "all" ? "all" : "any" });
}

function parseFilters(filters: string | null | undefined): { stages: string[]; stageLogic: "any" | "all" } {
  if (!filters) return { stages: [], stageLogic: "any" };
  try {
    const parsed = JSON.parse(filters);
    return { stages: parsed.stages ?? [], stageLogic: parsed.stageLogic === "all" ? "all" : "any" };
  } catch { return { stages: [], stageLogic: "any" }; }
}

function audienceLabel(c: any) {
  if (c.audienceType === "agent") return "All Agents";
  const { stages, stageLogic } = parseFilters(c.segmentFilters);
  if (stages.length === 0) return "All Prospects";
  const labels = stages.map((v: string) => PROSPECT_STAGES.find((s) => s.value === v)?.label ?? v);
  const connector = stageLogic === "all" ? " AND " : " OR ";
  return `Prospects: ${labels.join(connector)}`;
}

function StageFilter({
  stages, stageLogic, onStagesChange, onLogicChange,
}: {
  stages: string[];
  stageLogic: "any" | "all";
  onStagesChange: (s: string[]) => void;
  onLogicChange: (l: "any" | "all") => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>
          Filter by Pipeline Stage{" "}
          <span className="text-muted-foreground font-normal">(leave blank for all prospects)</span>
        </Label>
        {stages.length > 0 && (
          <div className="flex items-center gap-1 text-xs border rounded-full overflow-hidden">
            <button
              type="button"
              onClick={() => onLogicChange("any")}
              className={`px-2.5 py-1 transition-colors ${stageLogic === "any" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
            >
              ANY
            </button>
            <button
              type="button"
              onClick={() => onLogicChange("all")}
              className={`px-2.5 py-1 transition-colors ${stageLogic === "all" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
            >
              ALL
            </button>
          </div>
        )}
      </div>
      {stages.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {stageLogic === "any"
            ? "Sending to prospects who match any of the selected stages."
            : "Sending to prospects who match all of the selected stages."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {PROSPECT_STAGES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() =>
              onStagesChange(
                stages.includes(s.value) ? stages.filter((x) => x !== s.value) : [...stages, s.value]
              )
            }
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              stages.includes(s.value)
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:border-primary"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Resend to Specific Agents Modal ─────────────────────────────────────────
function ResendModal({ onClose }: { onClose: () => void }) {
  const [emailSearch, setEmailSearch] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<any>(null);
  const [agentSearch, setAgentSearch] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<Set<number>>(new Set());
  const [step, setStep] = useState<"pick-email" | "pick-agents">("pick-email");

  const emailLog = trpc.crm.agentEmailLog.list.useQuery(
    { search: emailSearch || undefined, limit: 50 },
    { enabled: step === "pick-email" }
  );

  const agents = trpc.crm.agentCrm.list.useQuery(undefined, { enabled: step === "pick-agents" });

  const resendMutation = trpc.crm.agentEmailLog.resend.useMutation({
    onSuccess: (data) => {
      toast.success(`Resent to ${data.sent} agent${data.sent !== 1 ? "s" : ""}${data.failed > 0 ? ` (${data.failed} failed)` : ""}`);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const filteredAgents = ((agents.data ?? []) as any[]).filter((a: any) => {
    if (!agentSearch) return true;
    const q = agentSearch.toLowerCase();
    return (a.name ?? "").toLowerCase().includes(q) || (a.email ?? "").toLowerCase().includes(q);
  });

  const toggleAgent = (id: number) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedAgents(new Set(filteredAgents.map((a: any) => a.id)));
  const clearAll = () => setSelectedAgents(new Set());

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw size={16} />
            Resend Email to Specific Agents
          </DialogTitle>
        </DialogHeader>

        {step === "pick-email" && (
          <div className="flex flex-col gap-4 min-h-0">
            <p className="text-sm text-muted-foreground">Search your email log and pick the email you want to resend.</p>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by subject, name or email address…"
                value={emailSearch}
                onChange={(e) => setEmailSearch(e.target.value)}
              />
            </div>
            <div className="flex-1 overflow-y-auto border rounded-lg divide-y max-h-80">
              {emailLog.isLoading && <div className="p-4 text-center text-sm text-muted-foreground">Loading…</div>}
              {!emailLog.isLoading && (emailLog.data?.rows ?? []).length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">No emails found</div>
              )}
              {(emailLog.data?.rows ?? []).map((e: any) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => { setSelectedEmail(e); setStep("pick-agents"); }}
                  className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="font-medium text-sm truncate">{e.subject}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex gap-3">
                    <span>To: {e.toName ?? e.toEmail}</span>
                    {e.sentAt && <span>{new Date(e.sentAt).toLocaleDateString("en-GB")}</span>}
                    {e.triggerKey && <span className="font-mono">{e.triggerKey}</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "pick-agents" && selectedEmail && (
          <div className="flex flex-col gap-4 min-h-0">
            <div className="bg-muted/40 rounded-lg px-4 py-3 text-sm">
              <div className="font-medium truncate">{selectedEmail.subject}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Originally sent to: {selectedEmail.toName ?? selectedEmail.toEmail}</div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search agents by name or email…"
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                />
              </div>
              <Button size="sm" variant="outline" onClick={selectAll}>Select All</Button>
              <Button size="sm" variant="outline" onClick={clearAll}>Clear</Button>
            </div>
            {selectedAgents.size > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Array.from(selectedAgents).map((id) => {
                  const a = (agents.data as any[] ?? []).find((x: any) => x.id === id);
                  if (!a) return null;
                  return (
                    <Badge key={id} variant="secondary" className="flex items-center gap-1 pr-1">
                      {a.name ?? a.email}
                      <button type="button" onClick={() => toggleAgent(id)} className="ml-0.5 hover:text-destructive"><X size={11} /></button>
                    </Badge>
                  );
                })}
              </div>
            )}
            <div className="flex-1 overflow-y-auto border rounded-lg divide-y max-h-64">
              {agents.isLoading && <div className="p-4 text-center text-sm text-muted-foreground">Loading agents…</div>}
              {filteredAgents.map((a: any) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleAgent(a.id)}
                  className={`w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-muted/50 transition-colors ${
                    selectedAgents.has(a.id) ? "bg-primary/5" : ""
                  }`}
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                    selectedAgents.has(a.id) ? "bg-primary border-primary" : "border-border"
                  }`}>
                    {selectedAgents.has(a.id) && <Check size={10} className="text-primary-foreground" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{a.name ?? "Unnamed"}</div>
                    <div className="text-xs text-muted-foreground truncate">{a.email}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="mt-2">
          {step === "pick-agents" && (
            <Button variant="outline" onClick={() => { setStep("pick-email"); setSelectedAgents(new Set()); }}>
              ← Back
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {step === "pick-agents" && (
            <Button
              disabled={selectedAgents.size === 0 || resendMutation.isPending}
              onClick={() => resendMutation.mutate({ sourceEmailId: selectedEmail.id, recipientUserIds: Array.from(selectedAgents) })}
            >
              {resendMutation.isPending ? "Sending…" : `Resend to ${selectedAgents.size} Agent${selectedAgents.size !== 1 ? "s" : ""}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CrmCampaigns() {
  const [createDialog, setCreateDialog] = useState(false);
  const [editDialog, setEditDialog] = useState<any>(null);
  const [previewDialog, setPreviewDialog] = useState<any>(null);
  const [sendConfirm, setSendConfirm] = useState<any>(null);
  const [resendDialog, setResendDialog] = useState(false);
  const [form, setForm] = useState<FormState>(defaultForm);

  const { data: campaigns = [], refetch } = trpc.crm.campaigns.list.useQuery();

  const createCampaign = trpc.crm.campaigns.create.useMutation({
    onSuccess: () => { refetch(); setCreateDialog(false); setForm(defaultForm); toast.success("Campaign created"); },
    onError: (e) => toast.error(e.message),
  });
  const updateCampaign = trpc.crm.campaigns.update.useMutation({
    onSuccess: () => { refetch(); setEditDialog(null); toast.success("Campaign updated"); },
    onError: (e) => toast.error(e.message),
  });
  const sendCampaign = trpc.crm.campaigns.send.useMutation({
    onSuccess: (data) => { refetch(); setSendConfirm(null); toast.success(`Campaign sent to ${data.recipientCount} recipients`); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Email Campaigns</h1>
          <p className="text-sm text-muted-foreground">Send bulk emails to agents and prospects</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setResendDialog(true)}><RefreshCw size={14} className="mr-1" />Resend to Agents</Button>
          <Button size="sm" onClick={() => setCreateDialog(true)}><Plus size={14} className="mr-1" />New Campaign</Button>
        </div>
      </div>

      <div className="space-y-3">
        {(campaigns as any[]).length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border rounded-lg">
            <p className="font-medium">No campaigns yet</p>
            <p className="text-sm">Create your first email campaign to get started.</p>
          </div>
        ) : (campaigns as any[]).map((c: any) => (
          <Card key={c.id}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{c.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[c.status] ?? "bg-gray-100 text-gray-600"}`}>{c.status}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">Subject: {c.subject}</p>
                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                    <span>Audience: {audienceLabel(c)}</span>
                    {c.sentAt && <span>Sent: {new Date(c.sentAt).toLocaleDateString("en-GB")}</span>}
                    {(c.totalRecipients ?? 0) > 0 && <span>{c.totalRecipients} recipients</span>}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button size="sm" variant="outline" onClick={() => setPreviewDialog(c)}><Eye size={13} className="mr-1" />Preview</Button>
                  {c.status === "draft" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => {
                        const { stages, stageLogic } = parseFilters(c.segmentFilters);
                        setEditDialog({ ...c, stages, stageLogic });
                      }}><Pencil size={13} className="mr-1" />Edit</Button>
                      <Button size="sm" onClick={() => setSendConfirm(c)}><Send size={13} className="mr-1" />Send</Button>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New Email Campaign</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Campaign Name</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. April Business Update" />
              </div>
              <div className="space-y-1.5">
                <Label>Audience</Label>
                <Select value={form.audienceType} onValueChange={(v) => setForm((f) => ({ ...f, audienceType: v as "prospect" | "agent", stages: [], stageLogic: "any" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prospect">Prospects</SelectItem>
                    <SelectItem value="agent">Agents</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.audienceType === "prospect" && (
              <StageFilter
                stages={form.stages}
                stageLogic={form.stageLogic}
                onStagesChange={(s) => setForm((f) => ({ ...f, stages: s }))}
                onLogicChange={(l) => setForm((f) => ({ ...f, stageLogic: l }))}
              />
            )}
            <div className="space-y-1.5">
              <Label>Email Subject</Label>
              <Input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="e.g. Important update from JLT Group" />
            </div>
            <div className="space-y-1.5">
              <Label>Email Body (HTML)</Label>
              <Textarea rows={10} value={form.bodyHtml} onChange={(e) => setForm((f) => ({ ...f, bodyHtml: e.target.value }))} placeholder="<p>Dear Agent,</p><p>We have an exciting update...</p>" className="font-mono text-sm" />
              <p className="text-xs text-muted-foreground">Use HTML to format your email. A rich editor with templates is coming soon.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createCampaign.mutate({ name: form.name, subject: form.subject, bodyHtml: form.bodyHtml, audienceType: form.audienceType, segmentFilters: buildFilters(form.stages, form.stageLogic) })}
              disabled={createCampaign.isPending || !form.name || !form.subject || !form.bodyHtml}
            >
              {createCampaign.isPending ? "Creating…" : "Create Campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editDialog} onOpenChange={() => setEditDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Edit Campaign</DialogTitle></DialogHeader>
          {editDialog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Campaign Name</Label>
                  <Input value={editDialog.name} onChange={(e) => setEditDialog((d: any) => ({ ...d, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Audience</Label>
                  <Select value={editDialog.audienceType} onValueChange={(v) => setEditDialog((d: any) => ({ ...d, audienceType: v, stages: [], stageLogic: "any" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="prospect">Prospects</SelectItem>
                      <SelectItem value="agent">Agents</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {editDialog.audienceType === "prospect" && (
                <StageFilter
                  stages={editDialog.stages ?? []}
                  stageLogic={editDialog.stageLogic ?? "any"}
                  onStagesChange={(s) => setEditDialog((d: any) => ({ ...d, stages: s }))}
                  onLogicChange={(l) => setEditDialog((d: any) => ({ ...d, stageLogic: l }))}
                />
              )}
              <div className="space-y-1.5">
                <Label>Email Subject</Label>
                <Input value={editDialog.subject} onChange={(e) => setEditDialog((d: any) => ({ ...d, subject: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Email Body (HTML)</Label>
                <Textarea rows={10} value={editDialog.bodyHtml} onChange={(e) => setEditDialog((d: any) => ({ ...d, bodyHtml: e.target.value }))} className="font-mono text-sm" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(null)}>Cancel</Button>
            <Button
              onClick={() => updateCampaign.mutate({ id: editDialog.id, name: editDialog.name, subject: editDialog.subject, bodyHtml: editDialog.bodyHtml, audienceType: editDialog.audienceType, segmentFilters: buildFilters(editDialog.stages ?? [], editDialog.stageLogic ?? "any") })}
              disabled={updateCampaign.isPending}
            >
              {updateCampaign.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={!!previewDialog} onOpenChange={() => setPreviewDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Preview — {previewDialog?.name}</DialogTitle></DialogHeader>
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/30 px-4 py-2 border-b text-sm">
              <span className="text-muted-foreground">Subject: </span><span className="font-medium">{previewDialog?.subject}</span>
            </div>
            <div className="p-4 max-h-96 overflow-y-auto" dangerouslySetInnerHTML={{ __html: previewDialog?.bodyHtml ?? "" }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewDialog(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {resendDialog && <ResendModal onClose={() => setResendDialog(false)} />}

      {/* Send confirm dialog */}
      <Dialog open={!!sendConfirm} onOpenChange={() => setSendConfirm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send Campaign</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            You are about to send <strong>"{sendConfirm?.name}"</strong> to <strong>{audienceLabel(sendConfirm ?? {})}</strong>. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendConfirm(null)}>Cancel</Button>
            <Button onClick={() => sendCampaign.mutate({ campaignId: sendConfirm!.id, baseUrl: window.location.origin })} disabled={sendCampaign.isPending}>
              {sendCampaign.isPending ? "Sending…" : "Yes, Send Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
