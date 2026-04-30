/**
 * EmailMarketing — Full email marketing hub for JLT Group.
 * Tabs: Campaigns | Templates | Drip Workflows
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RichEmailEditor } from "@/components/RichEmailEditor";
import { toast } from "sonner";
import {
  Plus, Send, Eye, Pencil, Trash2, Mail, Users, Zap,
  BarChart2, Clock, CheckCircle, AlertCircle, FileText,
} from "lucide-react";

// ─── Prospect pipeline stages ─────────────────────────────────────────────────
const PROSPECT_STAGES = [
  "New Enquiry", "AR Submitted", "AR Approved",
  "Discovery Call Booked", "Approved", "Rejected", "Lost", "Won",
];

// ─── Agent segmentation options ───────────────────────────────────────────────
const MEMBERSHIP_TIERS = ["Business Class", "First Class", "Business Duo", "Business Trio", "First Class Duo"];
const TRAINING_STAGES = ["Training", "Agent Accelerator", "Accredited"];
const AGENT_STATUSES = ["active", "paused", "in_notice"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function statusBadge(status: string) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    sending: "bg-yellow-100 text-yellow-800",
    sent: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? "bg-muted"}`}>{status}</span>;
}

function parseFilters(s?: string | null) {
  if (!s) return { stages: [] as string[], tags: [] as string[] };
  try { return JSON.parse(s); } catch { return { stages: [], tags: [] }; }
}

// ─── Campaign Form ─────────────────────────────────────────────────────────────
interface CampaignFormData {
  name: string;
  subject: string;
  bodyHtml: string;
  audienceType: "prospect" | "agent";
  stages: string[];
  membershipTiers: string[];
  trainingStages: string[];
  agentTags: string[];
  agentStatus: string[];
  templateId?: number;
}

const defaultCampaignForm: CampaignFormData = {
  name: "", subject: "", bodyHtml: "", audienceType: "prospect",
  stages: [], membershipTiers: [], trainingStages: [], agentTags: [], agentStatus: [],
};

function CampaignFormDialog({
  open, onClose, initial, templates, onSave, title,
}: {
  open: boolean;
  onClose: () => void;
  initial?: CampaignFormData;
  templates: Array<{ id: number; name: string; audienceType: string; subject: string; bodyHtml: string }>;
  onSave: (data: CampaignFormData) => void;
  title: string;
}) {
  const [form, setForm] = useState<CampaignFormData>(initial ?? { ...defaultCampaignForm, ...(initial ?? {}) });
  const agentTagsQuery = trpc.crm.agentCrm.listTags.useQuery(undefined, { enabled: form.audienceType === "agent" });
  const agentTagOptions = agentTagsQuery.data ?? [];

  function loadTemplate(id: number) {
    const t = templates.find((t) => t.id === id);
    if (t) setForm((f) => ({ ...f, subject: t.subject, bodyHtml: t.bodyHtml, templateId: id }));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Campaign Name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. April Newsletter" />
            </div>
            <div>
              <Label>Audience</Label>
              <Select value={form.audienceType} onValueChange={(v) => setForm((f) => ({ ...f, audienceType: v as "prospect" | "agent", stages: [] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="prospect">Prospects</SelectItem>
                  <SelectItem value="agent">Agents</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.audienceType === "prospect" && (
            <div>
              <Label>Filter by Pipeline Stage <span className="text-muted-foreground font-normal">(leave empty for all prospects)</span></Label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {PROSPECT_STAGES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm((f) => ({
                      ...f,
                      stages: f.stages.includes(s) ? f.stages.filter((x) => x !== s) : [...f.stages, s],
                    }))}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      form.stages.includes(s) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {form.stages.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">Sending to: {form.stages.join(", ")}</p>
              )}
            </div>
          )}

          {form.audienceType === "agent" && (
            <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
              <p className="text-sm font-medium">Agent Filters <span className="text-muted-foreground font-normal">(leave all empty to send to all active agents)</span></p>

              <div>
                <Label className="text-xs">Membership Tier</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {MEMBERSHIP_TIERS.map((t) => (
                    <button key={t} type="button"
                      onClick={() => setForm((f) => ({ ...f, membershipTiers: f.membershipTiers.includes(t) ? f.membershipTiers.filter((x) => x !== t) : [...f.membershipTiers, t] }))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${form.membershipTiers.includes(t) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs">Training Stage</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {TRAINING_STAGES.map((t) => (
                    <button key={t} type="button"
                      onClick={() => setForm((f) => ({ ...f, trainingStages: f.trainingStages.includes(t) ? f.trainingStages.filter((x) => x !== t) : [...f.trainingStages, t] }))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${form.trainingStages.includes(t) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs">Agent Status <span className="text-muted-foreground">(default: active only)</span></Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {AGENT_STATUSES.map((s) => (
                    <button key={s} type="button"
                      onClick={() => setForm((f) => ({ ...f, agentStatus: f.agentStatus.includes(s) ? f.agentStatus.filter((x) => x !== s) : [...f.agentStatus, s] }))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${form.agentStatus.includes(s) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {agentTagOptions.length > 0 && (
                <div>
                  <Label className="text-xs">Tags</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {agentTagOptions.map((t: string) => (
                      <button key={t} type="button"
                        onClick={() => setForm((f) => ({ ...f, agentTags: f.agentTags.includes(t) ? f.agentTags.filter((x) => x !== t) : [...f.agentTags, t] }))}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${form.agentTags.includes(t) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(form.membershipTiers.length > 0 || form.trainingStages.length > 0 || form.agentTags.length > 0 || form.agentStatus.length > 0) && (
                <p className="text-xs text-muted-foreground">
                  Filters: {[
                    form.membershipTiers.length > 0 && `Tier: ${form.membershipTiers.join(", ")}`,
                    form.trainingStages.length > 0 && `Training: ${form.trainingStages.join(", ")}`,
                    form.agentStatus.length > 0 && `Status: ${form.agentStatus.join(", ")}`,
                    form.agentTags.length > 0 && `Tags: ${form.agentTags.join(", ")}`,
                  ].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          )}

          <div>
            <Label>Load from Template (optional)</Label>
            <Select onValueChange={(v) => loadTemplate(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Select a template…" /></SelectTrigger>
              <SelectContent>
                {templates.filter((t) => t.audienceType === form.audienceType || t.audienceType === "prospect").map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Subject Line</Label>
            <Input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="Your email subject…" />
          </div>

          <div>
            <Label>Email Body</Label>
            <RichEmailEditor value={form.bodyHtml} onChange={(html) => setForm((f) => ({ ...f, bodyHtml: html }))} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={!form.name || !form.subject || !form.bodyHtml}>
            Save Campaign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Template Form Dialog ──────────────────────────────────────────────────────
interface TemplateFormData {
  name: string;
  subject: string;
  bodyHtml: string;
  audienceType: "prospect" | "agent";
}

const defaultTemplateForm: TemplateFormData = { name: "", subject: "", bodyHtml: "", audienceType: "prospect" };

function TemplateFormDialog({
  open, onClose, initial, onSave, title,
}: {
  open: boolean;
  onClose: () => void;
  initial?: TemplateFormData;
  onSave: (data: TemplateFormData) => void;
  title: string;
}) {
  const [form, setForm] = useState<TemplateFormData>(initial ?? defaultTemplateForm);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Template Name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Welcome Email" />
            </div>
            <div>
              <Label>Audience</Label>
              <Select value={form.audienceType} onValueChange={(v) => setForm((f) => ({ ...f, audienceType: v as "prospect" | "agent" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="prospect">Prospects</SelectItem>
                  <SelectItem value="agent">Agents</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Subject Line</Label>
            <Input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="Your email subject…" />
          </div>
          <div>
            <Label>Email Body</Label>
            <RichEmailEditor value={form.bodyHtml} onChange={(html) => setForm((f) => ({ ...f, bodyHtml: html }))} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={!form.name || !form.subject || !form.bodyHtml}>
            Save Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Drip Workflow Builder ─────────────────────────────────────────────────────
interface DripStep {
  stepOrder: number;
  delayDays: number;
  subject: string;
  bodyHtml: string;
}

function DripWorkflowDetail({ workflowId, onBack }: { workflowId: number; onBack: () => void }) {
  const { data: workflow, refetch } = trpc.crm.dripWorkflows.get.useQuery({ id: workflowId });
  const [steps, setSteps] = useState<DripStep[]>([]);
  const [editingStep, setEditingStep] = useState<number | null>(null);
  const [stepForm, setStepForm] = useState<DripStep>({ stepOrder: 0, delayDays: 0, subject: "", bodyHtml: "" });

  const saveSteps = trpc.crm.dripWorkflows.saveSteps.useMutation({
    onSuccess: () => { refetch(); toast.success("Steps saved"); },
    onError: (e) => toast.error(e.message),
  });

  // Load steps when workflow loads
  useState(() => {
    if (workflow?.steps) setSteps(workflow.steps.map((s: DripStep) => ({ ...s })));
  });

  if (!workflow) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;

  function addStep() {
    const newStep: DripStep = {
      stepOrder: steps.length + 1,
      delayDays: steps.length === 0 ? 0 : (steps[steps.length - 1]?.delayDays ?? 0) + 3,
      subject: "",
      bodyHtml: "",
    };
    setSteps((s) => [...s, newStep]);
    setEditingStep(newStep.stepOrder);
    setStepForm(newStep);
  }

  function removeStep(order: number) {
    setSteps((s) => s.filter((x) => x.stepOrder !== order).map((x, i) => ({ ...x, stepOrder: i + 1 })));
  }

  function saveStep() {
    setSteps((s) => s.map((x) => x.stepOrder === stepForm.stepOrder ? { ...stepForm } : x));
    setEditingStep(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>← Back</Button>
        <div>
          <h3 className="font-semibold">{workflow.name}</h3>
          <p className="text-xs text-muted-foreground">
            {workflow.audienceType === "prospect" ? "Prospects" : "Agents"}
            {workflow.triggerStage ? ` · Triggers on: ${workflow.triggerStage}` : " · Manual enrolment"}
            {" · "}{workflow.enrollmentCount} enrolled
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {steps.map((step) => (
          <Card key={step.stepOrder} className="border">
            <CardContent className="p-4">
              {editingStep === step.stepOrder ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Delay (days after previous step)</Label>
                      <Input type="number" min={0} value={stepForm.delayDays} onChange={(e) => setStepForm((f) => ({ ...f, delayDays: Number(e.target.value) }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Subject Line</Label>
                      <Input value={stepForm.subject} onChange={(e) => setStepForm((f) => ({ ...f, subject: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Email Body</Label>
                    <RichEmailEditor value={stepForm.bodyHtml} onChange={(html) => setStepForm((f) => ({ ...f, bodyHtml: html }))} className="mt-1" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveStep} disabled={!stepForm.subject || !stepForm.bodyHtml}>Save Step</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingStep(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                      {step.stepOrder}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{step.subject || <span className="text-muted-foreground italic">No subject</span>}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" />
                        {step.delayDays === 0 ? "Immediately" : `${step.delayDays} day${step.delayDays === 1 ? "" : "s"} after enrolment`}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setEditingStep(step.stepOrder); setStepForm({ ...step }); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => removeStep(step.stepOrder)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        <Button variant="outline" className="w-full" onClick={addStep}>
          <Plus className="h-4 w-4 mr-2" /> Add Step
        </Button>
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={() => saveSteps.mutate({ workflowId, steps })} disabled={saveSteps.isPending || steps.length === 0}>
          {saveSteps.isPending ? "Saving…" : "Save All Steps"}
        </Button>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function EmailMarketing() {
  const [tab, setTab] = useState("campaigns");

  // Campaigns
  const { data: campaigns = [], refetch: refetchCampaigns } = trpc.crm.campaigns.list.useQuery();
  const [campaignDialog, setCampaignDialog] = useState<"create" | "edit" | null>(null);
  const [editCampaign, setEditCampaign] = useState<any>(null);
  const [sendConfirm, setSendConfirm] = useState<any>(null);
  const [previewCampaign, setPreviewCampaign] = useState<any>(null);

  // Templates
  const { data: templates = [], refetch: refetchTemplates } = trpc.crm.emailTemplates.list.useQuery({});
  const [templateDialog, setTemplateDialog] = useState<"create" | "edit" | null>(null);
  const [editTemplate, setEditTemplate] = useState<any>(null);

  // Drip Workflows
  const { data: workflows = [], refetch: refetchWorkflows } = trpc.crm.dripWorkflows.list.useQuery();
  const [dripDetail, setDripDetail] = useState<number | null>(null);
  const [createWorkflowDialog, setCreateWorkflowDialog] = useState(false);
  const [workflowForm, setWorkflowForm] = useState({ name: "", audienceType: "prospect" as "prospect" | "agent", triggerStage: "" });

  // Mutations — campaigns
  const createCampaign = trpc.crm.campaigns.create.useMutation({
    onSuccess: () => { refetchCampaigns(); setCampaignDialog(null); toast.success("Campaign created"); },
    onError: (e) => toast.error(e.message),
  });
  const updateCampaign = trpc.crm.campaigns.update.useMutation({
    onSuccess: () => { refetchCampaigns(); setCampaignDialog(null); setEditCampaign(null); toast.success("Campaign updated"); },
    onError: (e) => toast.error(e.message),
  });
  const sendCampaign = trpc.crm.campaigns.send.useMutation({
    onSuccess: (data) => { refetchCampaigns(); setSendConfirm(null); toast.success(`Sending to ${data.recipientCount} recipients…`); },
    onError: (e) => toast.error(e.message),
  });

  // Mutations — templates
  const createTemplate = trpc.crm.emailTemplates.create.useMutation({
    onSuccess: () => { refetchTemplates(); setTemplateDialog(null); toast.success("Template saved"); },
    onError: (e) => toast.error(e.message),
  });
  const updateTemplate = trpc.crm.emailTemplates.update.useMutation({
    onSuccess: () => { refetchTemplates(); setTemplateDialog(null); setEditTemplate(null); toast.success("Template updated"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteTemplate = trpc.crm.emailTemplates.delete.useMutation({
    onSuccess: () => { refetchTemplates(); toast.success("Template deleted"); },
    onError: (e) => toast.error(e.message),
  });

  // Mutations — drip workflows
  const createWorkflow = trpc.crm.dripWorkflows.create.useMutation({
    onSuccess: (data) => { refetchWorkflows(); setCreateWorkflowDialog(false); setDripDetail(data.id); toast.success("Workflow created"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteWorkflow = trpc.crm.dripWorkflows.delete.useMutation({
    onSuccess: () => { refetchWorkflows(); toast.success("Workflow deleted"); },
    onError: (e) => toast.error(e.message),
  });

  function handleSaveCampaign(form: CampaignFormData) {
    const filters: Record<string, string[]> = {};
    if (form.stages.length > 0) filters.stages = form.stages;
    if (form.membershipTiers.length > 0) filters.membershipTiers = form.membershipTiers;
    if (form.trainingStages.length > 0) filters.trainingStages = form.trainingStages;
    if (form.agentTags.length > 0) filters.tags = form.agentTags;
    if (form.agentStatus.length > 0) filters.agentStatus = form.agentStatus;
    const segmentFilters = Object.keys(filters).length > 0 ? JSON.stringify(filters) : undefined;
    if (campaignDialog === "create") {
      createCampaign.mutate({ ...form, segmentFilters });
    } else if (editCampaign) {
      updateCampaign.mutate({ id: editCampaign.id, ...form, segmentFilters });
    }
  }

  function handleSaveTemplate(form: TemplateFormData) {
    if (templateDialog === "create") {
      createTemplate.mutate(form);
    } else if (editTemplate) {
      updateTemplate.mutate({ id: editTemplate.id, ...form });
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Email Marketing</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Send campaigns, manage templates, and automate drip sequences</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="campaigns" className="flex items-center gap-1.5">
            <Send className="h-4 w-4" /> Campaigns
          </TabsTrigger>
          <TabsTrigger value="templates" className="flex items-center gap-1.5">
            <FileText className="h-4 w-4" /> Templates
          </TabsTrigger>
          <TabsTrigger value="drip" className="flex items-center gap-1.5">
            <Zap className="h-4 w-4" /> Drip Workflows
          </TabsTrigger>
        </TabsList>

        {/* ── Campaigns ── */}
        <TabsContent value="campaigns" className="mt-4">
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-muted-foreground">{campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}</p>
            <Button onClick={() => setCampaignDialog("create")}>
              <Plus className="h-4 w-4 mr-2" /> New Campaign
            </Button>
          </div>

          {campaigns.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No campaigns yet</p>
              <p className="text-sm">Create your first campaign to start sending emails</p>
            </div>
          ) : (
            <div className="space-y-3">
              {campaigns.map((c: any) => {
                const filters = parseFilters(c.segmentFilters);
                const audience = c.audienceType === "agent"
                  ? "All Agents"
                  : filters.stages?.length > 0
                    ? `Prospects: ${filters.stages.join(", ")}`
                    : "All Prospects";
                return (
                  <Card key={c.id}>
                    <CardContent className="p-4 flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{c.name}</span>
                          {statusBadge(c.status)}
                          <Badge variant="outline" className="text-xs">
                            {c.audienceType === "agent" ? <Users className="h-3 w-3 mr-1 inline" /> : <Mail className="h-3 w-3 mr-1 inline" />}
                            {audience}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5 truncate">{c.subject}</p>
                        {c.totalRecipients > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            <CheckCircle className="h-3 w-3 inline mr-1 text-green-600" />
                            Sent to {c.totalRecipients} recipients
                            {c.sentByName && ` by ${c.sentByName}`}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <Button size="sm" variant="ghost" title="Preview" onClick={() => setPreviewCampaign(c)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {c.status === "draft" && (
                          <>
                            <Button size="sm" variant="ghost" title="Edit" onClick={() => {
                              const filters = parseFilters(c.segmentFilters);
                              setEditCampaign(c);
                              setCampaignDialog("edit");
                            }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="default" onClick={() => setSendConfirm(c)}>
                              <Send className="h-4 w-4 mr-1" /> Send
                            </Button>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Templates ── */}
        <TabsContent value="templates" className="mt-4">
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-muted-foreground">{templates.length} template{templates.length !== 1 ? "s" : ""}</p>
            <Button onClick={() => setTemplateDialog("create")}>
              <Plus className="h-4 w-4 mr-2" /> New Template
            </Button>
          </div>

          {templates.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No templates yet</p>
              <p className="text-sm">Create reusable email templates to speed up campaign creation</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((t: any) => (
                <Card key={t.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base">{t.name}</CardTitle>
                      <Badge variant="outline" className="text-xs ml-2 flex-shrink-0">
                        {t.audienceType === "agent" ? "Agents" : "Prospects"}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs truncate">{t.subject}</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex gap-1 mt-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => {
                        setEditTemplate(t);
                        setTemplateDialog("edit");
                      }}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        if (confirm(`Delete template "${t.name}"?`)) deleteTemplate.mutate({ id: t.id });
                      }}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Drip Workflows ── */}
        <TabsContent value="drip" className="mt-4">
          {dripDetail !== null ? (
            <DripWorkflowDetail workflowId={dripDetail} onBack={() => { setDripDetail(null); refetchWorkflows(); }} />
          ) : (
            <>
              <div className="flex justify-between items-center mb-4">
                <p className="text-sm text-muted-foreground">{workflows.length} workflow{workflows.length !== 1 ? "s" : ""}</p>
                <Button onClick={() => setCreateWorkflowDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" /> New Workflow
                </Button>
              </div>

              {workflows.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Zap className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No drip workflows yet</p>
                  <p className="text-sm">Create automated email sequences triggered by pipeline stage changes</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {workflows.map((w: any) => (
                    <Card key={w.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setDripDetail(w.id)}>
                      <CardContent className="p-4 flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{w.name}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${w.isActive ? "bg-green-100 text-green-800" : "bg-muted text-muted-foreground"}`}>
                              {w.isActive ? "Active" : "Paused"}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {w.audienceType === "agent" ? "Agents" : "Prospects"}
                            {w.triggerStage ? ` · Triggers on: ${w.triggerStage}` : " · Manual enrolment"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="ghost" onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete workflow "${w.name}"?`)) deleteWorkflow.mutate({ id: w.id });
                          }}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Campaign Form Dialog */}
      {campaignDialog && (
        <CampaignFormDialog
          open={!!campaignDialog}
          onClose={() => { setCampaignDialog(null); setEditCampaign(null); }}
          initial={editCampaign ? (() => {
            const f = parseFilters(editCampaign.segmentFilters);
            return {
              name: editCampaign.name,
              subject: editCampaign.subject,
              bodyHtml: editCampaign.bodyHtml,
              audienceType: editCampaign.audienceType,
              stages: f.stages ?? [],
              membershipTiers: f.membershipTiers ?? [],
              trainingStages: f.trainingStages ?? [],
              agentTags: f.tags ?? [],
              agentStatus: f.agentStatus ?? [],
            } as CampaignFormData;
          })() : undefined}
          templates={templates}
          onSave={handleSaveCampaign}
          title={campaignDialog === "create" ? "New Campaign" : "Edit Campaign"}
        />
      )}

      {/* Template Form Dialog */}
      {templateDialog && (
        <TemplateFormDialog
          open={!!templateDialog}
          onClose={() => { setTemplateDialog(null); setEditTemplate(null); }}
          initial={editTemplate ? {
            name: editTemplate.name,
            subject: editTemplate.subject,
            bodyHtml: editTemplate.bodyHtml,
            audienceType: editTemplate.audienceType,
          } : undefined}
          onSave={handleSaveTemplate}
          title={templateDialog === "create" ? "New Template" : "Edit Template"}
        />
      )}

      {/* Send Confirm Dialog */}
      <Dialog open={!!sendConfirm} onOpenChange={(v) => !v && setSendConfirm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Send</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            You are about to send <strong>"{sendConfirm?.name}"</strong> to{" "}
            <strong>
              {sendConfirm?.audienceType === "agent" ? "all active agents" : (() => {
                const f = parseFilters(sendConfirm?.segmentFilters);
                return f.stages?.length > 0 ? `prospects in: ${f.stages.join(", ")}` : "all prospects";
              })()}
            </strong>. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendConfirm(null)}>Cancel</Button>
            <Button
              onClick={() => sendCampaign.mutate({ campaignId: sendConfirm!.id, baseUrl: window.location.origin })}
              disabled={sendCampaign.isPending}
            >
              {sendCampaign.isPending ? "Sending…" : "Yes, Send Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewCampaign} onOpenChange={(v) => !v && setPreviewCampaign(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Preview: {previewCampaign?.name}</DialogTitle>
          </DialogHeader>
          <div className="border rounded p-4 bg-white">
            <p className="text-sm font-medium text-muted-foreground mb-1">Subject: {previewCampaign?.subject}</p>
            <div
              className="prose prose-sm max-w-none mt-3"
              dangerouslySetInnerHTML={{ __html: previewCampaign?.bodyHtml ?? "" }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Workflow Dialog */}
      <Dialog open={createWorkflowDialog} onOpenChange={setCreateWorkflowDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Drip Workflow</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Workflow Name</Label>
              <Input value={workflowForm.name} onChange={(e) => setWorkflowForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. New Enquiry Welcome Sequence" />
            </div>
            <div>
              <Label>Audience</Label>
              <Select value={workflowForm.audienceType} onValueChange={(v) => setWorkflowForm((f) => ({ ...f, audienceType: v as "prospect" | "agent", triggerStage: "" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="prospect">Prospects</SelectItem>
                  <SelectItem value="agent">Agents</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {workflowForm.audienceType === "prospect" && (
              <div>
                <Label>Auto-trigger on Pipeline Stage (optional)</Label>
                <Select value={workflowForm.triggerStage || "_none"} onValueChange={(v) => setWorkflowForm((f) => ({ ...f, triggerStage: v === "_none" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Manual enrolment only" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Manual enrolment only</SelectItem>
                    {PROSPECT_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">If set, prospects will be auto-enrolled when they move to this stage.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateWorkflowDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createWorkflow.mutate({ ...workflowForm, triggerStage: workflowForm.triggerStage || undefined })}
              disabled={!workflowForm.name || createWorkflow.isPending}
            >
              Create Workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
