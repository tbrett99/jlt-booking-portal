import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import EmailEditor from "@/components/EmailEditor";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Mail,
  Plus,
  Pencil,
  Trash2,
  Clock,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

// ─── Stage metadata ───────────────────────────────────────────────────────────

const STAGE_META: Record<string, { label: string; color: string }> = {
  new_enquiry:             { label: "New Enquiry",          color: "bg-blue-100 text-blue-800" },
  application_received:   { label: "Application Received", color: "bg-yellow-100 text-yellow-800" },
  ar_approved:            { label: "AR Approved",           color: "bg-green-100 text-green-800" },
  ar_declined:            { label: "AR Declined",           color: "bg-red-100 text-red-800" },
  discovery_call_booked:  { label: "Call Booked",           color: "bg-purple-100 text-purple-800" },
  rebook_required:        { label: "Rebook Required",       color: "bg-amber-100 text-amber-800" },
  did_not_turn_up:        { label: "Did Not Turn Up",       color: "bg-orange-100 text-orange-800" },
  discovery_call_complete:{ label: "Call Complete",         color: "bg-teal-100 text-teal-800" },
  onboarding_approved:    { label: "Onboarding Approved",   color: "bg-emerald-100 text-emerald-800" },
  onboarding_declined:    { label: "Onboarding Declined",   color: "bg-rose-100 text-rose-800" },
  won:                    { label: "Won",                   color: "bg-amber-100 text-amber-900" },
  waitlisted:             { label: "Waitlisted",            color: "bg-gray-100 text-gray-600" },
  archived:               { label: "Archived",              color: "bg-gray-100 text-gray-400" },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkflowEmail {
  id: number;
  workflowId: number;
  stepOrder: number;
  delayHours: number;
  subject: string;
  bodyHtml: string;
}

interface Workflow {
  id: number;
  stage: string;
  name: string;
  isActive: boolean;
  emails: WorkflowEmail[];
}

// ─── Email Step Editor Dialog ─────────────────────────────────────────────────

function EmailStepDialog({
  open,
  onClose,
  stage,
  email,
  nextOrder,
}: {
  open: boolean;
  onClose: () => void;
  stage: string;
  email?: WorkflowEmail;
  nextOrder: number;
}) {
  const utils = trpc.useUtils();
  const [subject, setSubject] = useState(email?.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState(email?.bodyHtml ?? "");
  const [delayHours, setDelayHours] = useState(email?.delayHours ?? 0);

  const save = trpc.recruitmentWorkflow.saveWorkflowEmail.useMutation({
    onSuccess: () => {
      toast.success("Email step saved");
      utils.recruitmentWorkflow.listWorkflows.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = () => {
    if (!subject.trim() || !bodyHtml.trim()) {
      toast.error("Subject and body are required");
      return;
    }
    save.mutate({
      id: email?.id,
      stage,
      stepOrder: email?.stepOrder ?? nextOrder,
      delayHours,
      subject: subject.trim(),
      bodyHtml: bodyHtml.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{email ? "Edit Email Step" : "Add Email Step"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Delay after stage entry</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                value={delayHours}
                onChange={(e) => setDelayHours(Number(e.target.value))}
                className="w-28"
              />
              <span className="text-sm text-muted-foreground">hours (0 = send immediately)</span>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Subject line</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Great news — your application has been approved!"
            />
          </div>

          <div className="space-y-1">
            <Label>Email body</Label>
            <EmailEditor
              value={bodyHtml}
              onChange={setBodyHtml}
              placeholder="Hi {{firstName}}, ..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Workflow Card ────────────────────────────────────────────────────────────

function WorkflowCard({ workflow }: { workflow: Workflow }) {
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);
  const [editEmail, setEditEmail] = useState<WorkflowEmail | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const meta = STAGE_META[workflow.stage] ?? { label: workflow.stage, color: "bg-gray-100 text-gray-600" };

  const toggle = trpc.recruitmentWorkflow.toggleWorkflow.useMutation({
    onSuccess: () => utils.recruitmentWorkflow.listWorkflows.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const deleteEmail = trpc.recruitmentWorkflow.deleteWorkflowEmail.useMutation({
    onSuccess: () => {
      toast.success("Email step deleted");
      utils.recruitmentWorkflow.listWorkflows.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card className="border border-border">
      {/* Header */}
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <button
            className="flex items-center gap-2 text-left flex-1 min-w-0"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
            <Badge className={`${meta.color} shrink-0`}>{meta.label}</Badge>
            <span className="text-sm text-muted-foreground truncate">
              {workflow.emails.length === 0
                ? "No emails configured"
                : `${workflow.emails.length} email${workflow.emails.length !== 1 ? "s" : ""}`}
            </span>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            {workflow.isActive ? (
              <span className="flex items-center gap-1 text-xs text-emerald-600">
                <CheckCircle2 size={13} /> Active
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <AlertCircle size={13} /> Paused
              </span>
            )}
            <Switch
              checked={workflow.isActive}
              onCheckedChange={(v) => toggle.mutate({ id: workflow.id, isActive: v })}
              disabled={toggle.isPending}
            />
          </div>
        </div>
      </CardHeader>

      {/* Expanded email steps */}
      {expanded && (
        <CardContent className="pt-0 space-y-3">
          {workflow.emails.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              No email steps yet. Add one below to start automating this stage.
            </p>
          )}

          {workflow.emails.map((email, idx) => (
            <div
              key={email.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 border border-border"
            >
              <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                  {idx + 1}
                </div>
                {idx < workflow.emails.length - 1 && (
                  <div className="w-px h-4 bg-border" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Mail size={13} className="text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">{email.subject}</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock size={11} />
                  {email.delayHours === 0
                    ? "Sent immediately on stage entry"
                    : `Sent ${email.delayHours}h after stage entry`}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setEditEmail(email)}
                >
                  <Pencil size={13} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => {
                    if (confirm("Delete this email step?")) {
                      deleteEmail.mutate({ id: email.id });
                    }
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ))}

          <Button
            variant="outline"
            size="sm"
            className="w-full mt-1"
            onClick={() => setShowAdd(true)}
          >
            <Plus size={14} className="mr-1" /> Add Email Step
          </Button>
        </CardContent>
      )}

      {/* Edit dialog */}
      {editEmail && (
        <EmailStepDialog
          open
          onClose={() => setEditEmail(null)}
          stage={workflow.stage}
          email={editEmail}
          nextOrder={workflow.emails.length + 1}
        />
      )}

      {/* Add dialog */}
      {showAdd && (
        <EmailStepDialog
          open
          onClose={() => setShowAdd(false)}
          stage={workflow.stage}
          nextOrder={workflow.emails.length + 1}
        />
      )}
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkflowBuilder() {
  const { data: workflows, isLoading } = trpc.recruitmentWorkflow.listWorkflows.useQuery();

  const processEmails = trpc.recruitmentWorkflow.processWorkflowEmails.useMutation({
    onSuccess: (r) => toast.success(`Processed ${r.processed} enrollments, sent ${r.sent} emails`),
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Email Workflows</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure automated email sequences for each recruitment stage. When a prospect moves to a
            new stage, they are automatically unenrolled from their current workflow and enrolled in
            the new one.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => processEmails.mutate()}
          disabled={processEmails.isPending}
          className="shrink-0"
        >
          {processEmails.isPending ? "Processing…" : "Process Now"}
        </Button>
      </div>

      {/* Template variable reference */}
      <div className="rounded-lg bg-muted/50 border border-border p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Available template variables:</p>
        <p>
          <code className="bg-background border rounded px-1">{"{{firstName}}"}</code> — prospect's first name &nbsp;
          <code className="bg-background border rounded px-1">{"{{lastName}}"}</code> — prospect's last name &nbsp;
          <code className="bg-background border rounded px-1">{"{{email}}"}</code> — prospect's email address
        </p>
      </div>

      {/* Workflow cards */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {(workflows ?? []).map((w) => (
            <WorkflowCard key={w.id} workflow={w as Workflow} />
          ))}
        </div>
      )}
    </div>
  );
}
