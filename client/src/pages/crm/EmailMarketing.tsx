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
import { Plus, Send, Eye, Pencil, Trash2, Mail, Users, Zap,
  BarChart2, Clock, CheckCircle, AlertCircle, FileText, Paintbrush,
  ChevronDown, ChevronUp, RefreshCw, MailOpen, MailX, Edit3, Copy,
} from "lucide-react";
import EmailBrandingEditor from "./EmailBrandingEditor";

// ─── Prospect pipeline stages (values must match DB pipelineStage column) ─────────────
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

// Map legacy human-readable stage names → current snake_case DB values
const LEGACY_STAGE_MAP: Record<string, string> = {
  "New Enquiry": "new_enquiry",
  "AR Submitted": "application_received",
  "AR Approved": "ar_approved",
  "AR Declined": "ar_declined",
  "Discovery Call Booked": "discovery_call_booked",
  "Call Complete": "discovery_call_complete",
  "Did Not Turn Up": "did_not_turn_up",
  "Rebook Required": "rebook_required",
  "Approved": "onboarding_approved",
  "Rejected": "ar_declined",
  "Lost": "archived",
  "Won": "won",
  "Archived": "archived",
};

function migrateStage(s: string): string {
  return LEGACY_STAGE_MAP[s] ?? s;
}

function parseFilters(s?: string | null) {
  if (!s) return { stages: [] as string[], tags: [] as string[], stageLogic: "any" as "any" | "all" };
  try {
    const p = JSON.parse(s);
    // Migrate any legacy human-readable stage names to snake_case DB values
    if (Array.isArray(p.stages)) p.stages = p.stages.map(migrateStage);
    return { stages: [], tags: [], stageLogic: "any" as "any" | "all", ...p };
  } catch { return { stages: [], tags: [], stageLogic: "any" as "any" | "all" }; }
}

// ─── Campaign Form ─────────────────────────────────────────────────────────────
interface CampaignFormData {
  name: string;
  subject: string;
  bodyHtml: string;
  audienceType: "prospect" | "agent";
  stages: string[];
  stageLogic: "any" | "all";
  membershipTiers: string[];
  trainingStages: string[];
  agentTags: string[];
  agentStatus: string[];
  hasActiveMandate?: boolean | null; // null = no filter, true = has mandate, false = no mandate
  templateId?: number;
}

const defaultCampaignForm: CampaignFormData = {
  name: "", subject: "", bodyHtml: "", audienceType: "prospect",
  stages: [], stageLogic: "any", membershipTiers: [], trainingStages: [], agentTags: [], agentStatus: [], hasActiveMandate: null,
};

function EmailPreviewPanel({ bodyHtml }: { bodyHtml: string }) {
  const { data: branding } = trpc.crm.emailBranding.get.useQuery();
  const headerBg = branding?.headerBgColor ?? "#70FFE8";
  const headerText = branding?.headerTextColor ?? "#414141";
  const logoUrl = branding?.logoUrl ?? null;
  const companyName = branding?.companyName ?? "JLT Group";

  // Inject paragraph/list spacing into the preview body
  const styledBody = `<style>
    .email-body p { margin: 0 0 14px 0; }
    .email-body ul, .email-body ol { margin: 0 0 14px 0; padding-left: 24px; }
    .email-body li { margin-bottom: 6px; }
    .email-body h1 { font-size: 22px; font-weight: 700; margin: 0 0 12px 0; }
    .email-body h2 { font-size: 18px; font-weight: 700; margin: 0 0 10px 0; }
    .email-body h3 { font-size: 15px; font-weight: 700; margin: 0 0 8px 0; }
    .email-body a { color: #02E6D2; }
    .email-body strong { font-weight: 700; }
  </style><div class="email-body">${bodyHtml}</div>`;

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="bg-muted/30 px-3 py-2 text-xs text-muted-foreground border-b">Email preview (approximate rendering)</div>
      <div className="p-4 bg-[#f5f5f5] min-h-[280px]" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <div style={{ maxWidth: 540, margin: '0 auto', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          {/* Header — turquoise with logo centred */}
          <div style={{ background: headerBg, padding: '20px 24px', textAlign: 'center' }}>
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={companyName}
                style={{ maxHeight: 60, maxWidth: 200, display: 'inline-block', objectFit: 'contain' }}
              />
            ) : (
              <span style={{ color: headerText, fontWeight: 800, fontSize: 22, letterSpacing: '-0.5px' }}>{companyName}</span>
            )}
          </div>
          {/* Body */}
          <div
            style={{ padding: '24px', color: '#1a1a2e', fontSize: 15, lineHeight: 1.7 }}
            dangerouslySetInnerHTML={{ __html: styledBody }}
          />
          {/* Footer */}
          <div style={{ padding: '0 24px 24px' }}>
            <p style={{ marginTop: 20, color: '#888', fontSize: 11, borderTop: '1px solid #eee', paddingTop: 14 }}>This email was sent from the JLT Group Booking Portal.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const [previewMode, setPreviewMode] = useState(false);
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
              <div className="flex items-center justify-between mb-1.5">
                <Label>Filter by Pipeline Stage <span className="text-muted-foreground font-normal">(leave empty for all prospects)</span></Label>
                {form.stages.length > 0 && (
                  <div className="flex items-center gap-1 text-xs border rounded-full overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, stageLogic: "any" }))}
                      className={`px-2.5 py-1 transition-colors ${
                        form.stageLogic === "any" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"
                      }`}
                    >ANY</button>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, stageLogic: "all" }))}
                      className={`px-2.5 py-1 transition-colors ${
                        form.stageLogic === "all" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"
                      }`}
                    >ALL</button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {PROSPECT_STAGES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setForm((f) => ({
                      ...f,
                      stages: f.stages.includes(s.value) ? f.stages.filter((x) => x !== s.value) : [...f.stages, s.value],
                    }))}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      form.stages.includes(s.value) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {form.stages.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {form.stageLogic === "any"
                    ? `Sending to prospects in any of: ${form.stages.map((v) => PROSPECT_STAGES.find((s) => s.value === v)?.label ?? v).join(", ")}`
                    : `Sending to prospects matching all of: ${form.stages.map((v) => PROSPECT_STAGES.find((s) => s.value === v)?.label ?? v).join(", ")}`
                  }
                </p>
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

              <div>
                <Label className="text-xs">Direct Debit (GoCardless Mandate)</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {([{ label: "Has Active Mandate", value: true }, { label: "No Active Mandate", value: false }] as const).map(({ label, value }) => (
                    <button key={label} type="button"
                      onClick={() => setForm((f) => ({ ...f, hasActiveMandate: f.hasActiveMandate === value ? null : value }))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        form.hasActiveMandate === value ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {(form.membershipTiers.length > 0 || form.trainingStages.length > 0 || form.agentTags.length > 0 || form.agentStatus.length > 0 || form.hasActiveMandate != null) && (
                <p className="text-xs text-muted-foreground">
                  Filters: {[
                    form.membershipTiers.length > 0 && `Tier: ${form.membershipTiers.join(", ")}`,
                    form.trainingStages.length > 0 && `Training: ${form.trainingStages.join(", ")}`,
                    form.agentStatus.length > 0 && `Status: ${form.agentStatus.join(", ")}`,
                    form.agentTags.length > 0 && `Tags: ${form.agentTags.join(", ")}`,
                    form.hasActiveMandate === true && "Has Active Direct Debit",
                    form.hasActiveMandate === false && "No Active Direct Debit",
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
            <div className="flex items-center justify-between mb-2">
              <Label>Email Body</Label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPreviewMode(false)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    !previewMode ? "text-[#0d1a26] bg-[#70FFE8]" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Edit3 size={12} /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode(true)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    previewMode ? "text-[#0d1a26] bg-[#70FFE8]" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Eye size={12} /> Preview
                </button>
              </div>
            </div>
            {previewMode ? (
              <EmailPreviewPanel bodyHtml={form.bodyHtml} />
            ) : (
              <RichEmailEditor value={form.bodyHtml} onChange={(html) => setForm((f) => ({ ...f, bodyHtml: html }))} className="mt-1" />
            )}
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
  const [previewMode, setPreviewMode] = useState(false);

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
            <div className="flex items-center justify-between mb-2">
              <Label>Email Body</Label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPreviewMode(false)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    !previewMode ? "text-[#0d1a26] bg-[#70FFE8]" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Edit3 size={12} /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode(true)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    previewMode ? "text-[#0d1a26] bg-[#70FFE8]" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Eye size={12} /> Preview
                </button>
              </div>
            </div>
            {previewMode ? (
              <EmailPreviewPanel bodyHtml={form.bodyHtml} />
            ) : (
              <RichEmailEditor value={form.bodyHtml} onChange={(html) => setForm((f) => ({ ...f, bodyHtml: html }))} className="mt-1" />
            )}
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

// ─── Campaign Recipients Panel ───────────────────────────────────────────────
function CampaignRecipientsPanel({
  campaignId,
  onResendOne,
  onResendAll,
  isResendingOne,
  isResendingAll,
}: {
  campaignId: number;
  onResendOne: (sendId: number) => void;
  onResendAll: () => void;
  isResendingOne: boolean;
  isResendingAll: boolean;
}) {
  const { data: recipients = [], isLoading } = trpc.crm.campaigns.recipients.useQuery({ campaignId });
  const [filter, setFilter] = useState<"all" | "opened" | "unopened">("all");

  const filtered = recipients.filter((r: any) => {
    if (filter === "opened") return ["opened", "clicked"].includes(r.status);
    if (filter === "unopened") return !["opened", "clicked"].includes(r.status);
    return true;
  });

  const openedCount = recipients.filter((r: any) => ["opened", "clicked"].includes(r.status)).length;
  const unopenedCount = recipients.length - openedCount;

  return (
    <div className="mt-4 border-t pt-4 space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-3 text-sm">
          <span className="flex items-center gap-1 text-green-700">
            <MailOpen className="h-3.5 w-3.5" /> {openedCount} opened
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <MailX className="h-3.5 w-3.5" /> {unopenedCount} unopened
          </span>
        </div>
        <div className="flex gap-1 ml-auto">
          {(["all", "opened", "unopened"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filter === f ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {unopenedCount > 0 && (
          <Button
            size="sm" variant="outline"
            className="text-xs h-7"
            disabled={isResendingAll}
            onClick={() => {
              if (!window.confirm(`Resend to all ${unopenedCount} unopened recipients?`)) return;
              onResendAll();
            }}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Resend to all unopened
          </Button>
        )}
      </div>

      {/* Recipient list */}
      {isLoading ? (
        <p className="text-xs text-muted-foreground py-2">Loading recipients…</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No recipients match this filter.</p>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium">Recipient</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Opened</th>
                <th className="text-right px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r: any) => {
                const opened = ["opened", "clicked"].includes(r.status);
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <p className="font-medium">{r.recipientName ?? r.recipientEmail}</p>
                      {r.recipientName && <p className="text-muted-foreground">{r.recipientEmail}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full font-medium ${
                        opened ? "bg-green-100 text-green-800" :
                        r.status === "bounced" ? "bg-red-100 text-red-800" :
                        r.status === "failed" ? "bg-red-100 text-red-800" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.openedAt
                        ? new Date(r.openedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm" variant="ghost"
                        className="h-6 text-xs px-2"
                        disabled={isResendingOne}
                        onClick={() => onResendOne(r.id)}
                        title="Resend to this recipient"
                      >
                        <RefreshCw className="h-3 w-3 mr-1" /> Resend
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
  const [expandedCampaignId, setExpandedCampaignId] = useState<number | null>(null);
  const [resendDialog, setResendDialog] = useState(false);

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
  const resendOne = trpc.crm.campaigns.resendOne.useMutation({
    onSuccess: () => toast.success("Email resent successfully"),
    onError: (e) => toast.error(e.message),
  });
  const resendUnopenedAll = trpc.crm.campaigns.resendUnopenedAll.useMutation({
    onSuccess: (data) => toast.success(`Resent to ${data.count} unopened recipient${data.count !== 1 ? 's' : ''}`),
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
    const filters: Record<string, any> = {};
    if (form.stages.length > 0) filters.stages = form.stages;
    if (form.membershipTiers.length > 0) filters.membershipTiers = form.membershipTiers;
    if (form.trainingStages.length > 0) filters.trainingStages = form.trainingStages;
    if (form.agentTags.length > 0) filters.tags = form.agentTags;
    if (form.agentStatus.length > 0) filters.agentStatus = form.agentStatus;
    if (form.hasActiveMandate != null) filters.hasActiveMandate = form.hasActiveMandate;
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
          <TabsTrigger value="branding" className="flex items-center gap-1.5">
            <Paintbrush className="h-4 w-4" /> Email Branding
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-1.5">
            <BarChart2 className="h-4 w-4" /> Analytics
          </TabsTrigger>
          <TabsTrigger value="unsubscribes" className="flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" /> Unsubscribes
          </TabsTrigger>
        </TabsList>

        {/* ── Campaigns ── */}
        <TabsContent value="campaigns" className="mt-4">
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-muted-foreground">{campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setResendDialog(true)}>
                <RefreshCw className="h-4 w-4 mr-2" /> Resend to Agents
              </Button>
              <Button onClick={() => setCampaignDialog("create")}>
                <Plus className="h-4 w-4 mr-2" /> New Campaign
              </Button>
            </div>
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
                const agentParts: string[] = [];
                if (c.audienceType === "agent") {
                  if (filters.membershipTiers?.length) agentParts.push(`Tier: ${filters.membershipTiers.join(", ")}`);
                  if (filters.trainingStages?.length) agentParts.push(`Training: ${filters.trainingStages.join(", ")}`);
                  if (filters.tags?.length) agentParts.push(`Tags: ${filters.tags.join(", ")}`);
                  if (filters.agentStatus?.length) agentParts.push(`Status: ${filters.agentStatus.join(", ")}`);
                  if (filters.hasActiveMandate === true) agentParts.push("Has Active DD");
                  if (filters.hasActiveMandate === false) agentParts.push("No Active DD");
                }
                const audience = c.audienceType === "agent"
                  ? agentParts.length > 0 ? agentParts.join(" | ") : "All Active Agents"
                  : filters.stages?.length > 0
                    ? `Prospects: ${filters.stages.join(", ")}`
                    : "All Prospects";
                const isExpanded = expandedCampaignId === c.id;
                return (
                  <Card key={c.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
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
                          {c.status === "sent" && (
                            <>
                              <Button
                                size="sm" variant="ghost"
                                title="Copy to Draft"
                                onClick={() => {
                                  const f = parseFilters(c.segmentFilters);
                                  setEditCampaign({
                                    ...c,
                                    id: undefined,
                                    name: `Copy of ${c.name}`,
                                    status: 'draft',
                                  });
                                  setCampaignDialog('create');
                                }}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm" variant="outline"
                                onClick={() => setExpandedCampaignId(isExpanded ? null : c.id)}
                                className="text-xs"
                              >
                                <BarChart2 className="h-3.5 w-3.5 mr-1" />
                                Recipients
                                {isExpanded ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Recipients panel — lazy loaded when expanded */}
                      {isExpanded && (
                        <CampaignRecipientsPanel
                          campaignId={c.id}
                          onResendOne={(sendId) => resendOne.mutate({ sendId })}
                          onResendAll={() => resendUnopenedAll.mutate({ campaignId: c.id })}
                          isResendingOne={resendOne.isPending}
                          isResendingAll={resendUnopenedAll.isPending}
                        />
                      )}
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

        {/* ── Email Branding ── */}
        <TabsContent value="branding" className="mt-4">
          <EmailBrandingEditor />
        </TabsContent>

        {/* ── Analytics ── */}
        <TabsContent value="analytics" className="mt-4">
          <EmailAnalyticsTab campaigns={campaigns} />
        </TabsContent>

        {/* ── Unsubscribes ── */}
        <TabsContent value="unsubscribes" className="mt-4">
          <EmailUnsubscribesTab />
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
              hasActiveMandate: f.hasActiveMandate != null ? f.hasActiveMandate : null,
            } as CampaignFormData;
          })() : undefined}
          templates={templates}
          onSave={handleSaveCampaign}
          title={campaignDialog === "create" ? "New Campaign" : "Edit Campaign"}
        />
      )}

      {/* Resend to Specific Agents */}
      {resendDialog && <ResendAgentsModal onClose={() => setResendDialog(false)} />}

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
              {sendConfirm?.audienceType === "agent" ? (() => {
                const f = parseFilters(sendConfirm?.segmentFilters);
                const parts: string[] = [];
                if (f.membershipTiers?.length) parts.push(`tier: ${f.membershipTiers.join(", ")}`);
                if (f.trainingStages?.length) parts.push(`training: ${f.trainingStages.join(", ")}`);
                if (f.tags?.length) parts.push(`tags: ${f.tags.join(", ")}`);
                if (f.agentStatus?.length) parts.push(`status: ${f.agentStatus.join(", ")}`);
                if (f.hasActiveMandate === true) parts.push("has active direct debit");
                if (f.hasActiveMandate === false) parts.push("no active direct debit");
                return parts.length > 0 ? `agents filtered by ${parts.join(" | ")}` : "all active agents";
              })() : (() => {
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
          <p className="text-sm text-muted-foreground -mt-1 mb-2"><span className="font-medium">Subject:</span> {previewCampaign?.subject}</p>
          {previewCampaign && <EmailPreviewPanel bodyHtml={previewCampaign.bodyHtml} />}
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setPreviewCampaign(null)}>Close</Button>
            <Button
              variant="default"
              onClick={() => {
                const c = previewCampaign;
                setPreviewCampaign(null);
                const f = parseFilters(c.segmentFilters);
                setEditCampaign({
                  ...c,
                  id: undefined,
                  name: `Copy of ${c.name}`,
                  status: 'draft',
                });
                setCampaignDialog('create');
              }}
            >
              <Copy className="h-4 w-4 mr-1.5" /> Copy to Draft
            </Button>
          </DialogFooter>
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
                    {PROSPECT_STAGES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
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

// ─── Email Analytics Tab ──────────────────────────────────────────────────────

function EmailAnalyticsTab({ campaigns }: { campaigns: any[] }) {
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  const { data: stats } = trpc.crm.campaigns.stats.useQuery(
    { campaignId: selectedCampaignId! },
    { enabled: !!selectedCampaignId }
  );
  const { data: recipientsData } = trpc.crm.campaigns.recipients.useQuery(
    { campaignId: selectedCampaignId! },
    { enabled: !!selectedCampaignId }
  );

  const sentCampaigns = campaigns.filter((c: any) => c.status === "sent");

  return (
    <div className="space-y-6">
      <div>
        <Label className="text-sm font-medium">Select Campaign</Label>
        <Select
          value={selectedCampaignId ? String(selectedCampaignId) : ""}
          onValueChange={(v) => setSelectedCampaignId(Number(v))}
        >
          <SelectTrigger className="mt-1 w-full max-w-sm">
            <SelectValue placeholder="Choose a sent campaign…" />
          </SelectTrigger>
          <SelectContent>
            {sentCampaigns.map((c: any) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedCampaignId && stats && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Sent", value: stats.total, icon: Send, color: "text-blue-500" },
              { label: "Delivered", value: stats.sent, icon: CheckCircle, color: "text-green-500" },
              { label: "Opened", value: stats.opened, icon: Eye, color: "text-purple-500" },
              { label: "Failed", value: stats.failed, icon: AlertCircle, color: "text-red-500" },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={`h-4 w-4 ${color}`} />
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                  <p className="text-2xl font-bold">{value}</p>
                  {stats.total > 0 && (
                    <p className="text-xs text-muted-foreground">{Math.round((value / stats.total) * 100)}%</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {recipientsData && recipientsData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recipients</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-4 py-2 font-medium">Email</th>
                        <th className="text-left px-4 py-2 font-medium">Name</th>
                        <th className="text-left px-4 py-2 font-medium">Type</th>
                        <th className="text-left px-4 py-2 font-medium">Status</th>
                        <th className="text-left px-4 py-2 font-medium">Sent At</th>
                        <th className="text-left px-4 py-2 font-medium">Opened At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipientsData.map((r: any) => (
                        <tr key={r.id} className="border-b hover:bg-muted/20">
                          <td className="px-4 py-2">{r.recipientEmail}</td>
                          <td className="px-4 py-2">{r.recipientName ?? "—"}</td>
                          <td className="px-4 py-2 capitalize">{r.recipientType}</td>
                          <td className="px-4 py-2">
                            <Badge variant={
                              r.status === "opened" || r.status === "clicked" ? "default" :
                              r.status === "delivered" || r.status === "sent" ? "secondary" :
                              r.status === "failed" ? "destructive" : "outline"
                            } className="text-xs capitalize">{r.status}</Badge>
                          </td>
                          <td className="px-4 py-2">{r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}</td>
                          <td className="px-4 py-2">{r.openedAt ? new Date(r.openedAt).toLocaleString() : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!selectedCampaignId && (
        <div className="text-center py-16 text-muted-foreground">
          <BarChart2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Select a campaign to view analytics</p>
          <p className="text-sm">Delivery, open, and click stats for each sent campaign</p>
        </div>
      )}
    </div>
  );
}

// ─── Email Unsubscribes Tab ───────────────────────────────────────────────────

function EmailUnsubscribesTab() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const { data, refetch } = trpc.crm.emailUnsubscribes.list.useQuery({
    search: debouncedSearch || undefined,
    limit: 100,
    offset: 0,
  });

  const remove = trpc.crm.emailUnsubscribes.remove.useMutation({
    onSuccess: () => { toast.success("Removed from unsubscribe list"); refetch(); },
    onError: () => toast.error("Failed to remove"),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search by email…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              clearTimeout((window as any)._unsubSearchTimer);
              (window as any)._unsubSearchTimer = setTimeout(() => setDebouncedSearch(e.target.value), 400);
            }}
            className="w-64"
          />
        </div>
        <p className="text-sm text-muted-foreground">{total} unsubscribe{total !== 1 ? "s" : ""}</p>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CheckCircle className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No unsubscribes{debouncedSearch ? " matching your search" : ""}</p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-4 py-2 font-medium">Email</th>
                    <th className="text-left px-4 py-2 font-medium">Unsubscribed At</th>
                    <th className="text-left px-4 py-2 font-medium">Prospect ID</th>
                    <th className="text-right px-4 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} className="border-b hover:bg-muted/20">
                      <td className="px-4 py-2 font-mono">{r.email}</td>
                      <td className="px-4 py-2">{r.unsubscribedAt ? new Date(r.unsubscribedAt).toLocaleString() : "—"}</td>
                      <td className="px-4 py-2">{r.prospectId ?? "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Re-subscribe ${r.email}? This will allow marketing emails to be sent to them again.`)) {
                              remove.mutate({ id: r.id });
                            }
                          }}
                        >
                          Re-subscribe
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Resend to Specific Agents Modal ─────────────────────────────────────────
function ResendAgentsModal({ onClose }: { onClose: () => void }) {
  const [emailSearch, setEmailSearch] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<any>(null);
  const [agentSearch, setAgentSearch] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<Set<number>>(new Set());
  const [step, setStep] = useState<"pick-email" | "pick-agents">("pick-email");

  // Agent filters — default to active only
  const [filterStatus, setFilterStatus] = useState<string[]>(["active"]);
  const [filterTiers, setFilterTiers] = useState<string[]>([]);
  const [filterTraining, setFilterTraining] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const emailLog = trpc.crm.agentEmailLog.list.useQuery(
    { search: emailSearch || undefined, limit: 50 },
    { enabled: step === "pick-email" }
  );

  const agents = trpc.crm.agentCrm.list.useQuery(undefined, { enabled: step === "pick-agents" });
  const agentTagsQuery = trpc.crm.agentCrm.listTags.useQuery(undefined, { enabled: step === "pick-agents" });
  const agentTagOptions: string[] = agentTagsQuery.data ?? [];

  const resendMutation = trpc.crm.agentEmailLog.resend.useMutation({
    onSuccess: (data) => {
      toast.success(`Resent to ${data.sent} agent${data.sent !== 1 ? "s" : ""}${data.failed > 0 ? ` (${data.failed} failed)` : ""}`);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const filteredAgents = ((agents.data ?? []) as any[]).filter((a: any) => {
    const profile = a.crmProfile;
    const status = profile?.agentStatus ?? "active";
    // Status filter
    if (filterStatus.length > 0 && !filterStatus.includes(status)) return false;
    // Tier filter
    if (filterTiers.length > 0 && !filterTiers.includes(profile?.membershipTier ?? "")) return false;
    // Training stage filter
    if (filterTraining.length > 0 && !filterTraining.includes(profile?.trainingStage ?? "")) return false;
    // Tags filter
    if (filterTags.length > 0 && !filterTags.some((t) => (a.tags ?? []).includes(t))) return false;
    // Text search
    if (agentSearch) {
      const q = agentSearch.toLowerCase();
      if (!(a.name ?? "").toLowerCase().includes(q) && !(a.email ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
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

  function toggleFilter<T>(arr: T[], setArr: (v: T[]) => void, val: T) {
    setArr(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
    // Clear selection when filters change — avoid sending to wrong people
    setSelectedAgents(new Set());
  }

  const activeFilterCount = filterStatus.length + filterTiers.length + filterTraining.length + filterTags.length;
  const isDefaultFilter = filterStatus.length === 1 && filterStatus[0] === "active" && filterTiers.length === 0 && filterTraining.length === 0 && filterTags.length === 0;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Resend Email to Specific Agents
          </DialogTitle>
        </DialogHeader>

        {step === "pick-email" && (
          <div className="flex flex-col gap-4 min-h-0">
            <p className="text-sm text-muted-foreground">Search your email log and pick the email you want to resend.</p>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
          <div className="flex flex-col gap-4 min-h-0 overflow-y-auto">
            <div className="bg-muted/40 rounded-lg px-4 py-3 text-sm">
              <div className="font-medium truncate">{selectedEmail.subject}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Originally sent to: {selectedEmail.toName ?? selectedEmail.toEmail}</div>
            </div>

            {/* Filter panel */}
            <div className="border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5" />
                  Agent Filters
                  {!isDefaultFilter && (
                    <span className="text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5">{activeFilterCount}</span>
                  )}
                </span>
                {showFilters ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {showFilters && (
                <div className="p-3 space-y-3 border-t">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Status <span className="font-normal">(default: active only)</span></p>
                    <div className="flex flex-wrap gap-1.5">
                      {AGENT_STATUSES.map((s) => (
                        <button key={s} type="button"
                          onClick={() => toggleFilter(filterStatus, setFilterStatus, s)}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            filterStatus.includes(s) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                          }`}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Membership Tier <span className="font-normal">(empty = all tiers)</span></p>
                    <div className="flex flex-wrap gap-1.5">
                      {MEMBERSHIP_TIERS.map((t) => (
                        <button key={t} type="button"
                          onClick={() => toggleFilter(filterTiers, setFilterTiers, t)}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            filterTiers.includes(t) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                          }`}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Training Stage <span className="font-normal">(empty = all stages)</span></p>
                    <div className="flex flex-wrap gap-1.5">
                      {TRAINING_STAGES.map((t) => (
                        <button key={t} type="button"
                          onClick={() => toggleFilter(filterTraining, setFilterTraining, t)}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            filterTraining.includes(t) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                          }`}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  {agentTagOptions.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Tags <span className="font-normal">(empty = all tags)</span></p>
                      <div className="flex flex-wrap gap-1.5">
                        {agentTagOptions.map((t) => (
                          <button key={t} type="button"
                            onClick={() => toggleFilter(filterTags, setFilterTags, t)}
                            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                              filterTags.includes(t) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                            }`}>
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {!isDefaultFilter && (
                    <button
                      type="button"
                      onClick={() => { setFilterStatus(["active"]); setFilterTiers([]); setFilterTraining([]); setFilterTags([]); setSelectedAgents(new Set()); }}
                      className="text-xs text-muted-foreground underline hover:text-foreground"
                    >
                      Reset to default (active only)
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Search + select all */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search agents by name or email…"
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                />
              </div>
              <Button size="sm" variant="outline" onClick={selectAll} disabled={filteredAgents.length === 0}>Select All ({filteredAgents.length})</Button>
              <Button size="sm" variant="outline" onClick={clearAll} disabled={selectedAgents.size === 0}>Clear</Button>
            </div>

            {selectedAgents.size > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Array.from(selectedAgents).map((id) => {
                  const a = (agents.data as any[] ?? []).find((x: any) => x.id === id);
                  if (!a) return null;
                  return (
                    <Badge key={id} variant="secondary" className="flex items-center gap-1 pr-1">
                      {a.name ?? a.email}
                      <button type="button" onClick={() => toggleAgent(id)} className="ml-0.5 hover:text-destructive">
                        <AlertCircle className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}

            <div className="border rounded-lg divide-y max-h-56 overflow-y-auto">
              {agents.isLoading && <div className="p-4 text-center text-sm text-muted-foreground">Loading agents…</div>}
              {!agents.isLoading && filteredAgents.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">No agents match the current filters.</div>
              )}
              {filteredAgents.map((a: any) => {
                const status = a.crmProfile?.agentStatus ?? "active";
                const statusColor = status === "active" ? "text-green-700 bg-green-50" : status === "paused" ? "text-amber-700 bg-amber-50" : "text-red-700 bg-red-50";
                return (
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
                      {selectedAgents.has(a.id) && <CheckCircle className="h-3 w-3 text-primary-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{a.name ?? "Unnamed"}</div>
                      <div className="text-xs text-muted-foreground truncate">{a.email}</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {a.crmProfile?.membershipTier && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{a.crmProfile.membershipTier}</span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusColor}`}>{status}</span>
                    </div>
                  </button>
                );
              })}
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
