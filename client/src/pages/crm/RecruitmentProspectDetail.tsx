/**
 * Admin Recruitment Prospect Detail — /crm/recruitment/:id
 * Shows full prospect info, application answers, stage history, emails sent.
 */
import { useState } from "react";
import { useRoute, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Mail, Clock, ChevronRight, Send } from "lucide-react";
import { getStageBadge, PIPELINE_STAGES } from "./RecruitmentPipeline";

// ─── Application data type ────────────────────────────────────────────────────

interface ApplicationData {
  occupation?: string;
  whyJlt?: string;
  experience?: string;
  fullOrPartTime?: string;
  linkedinUrl?: string;
  anythingElse?: string;
  submittedAt?: string;
}

// ─── Stage transition config ──────────────────────────────────────────────────

const STAGE_TRANSITIONS: Record<string, string[]> = {
  new_enquiry: ["application_received", "archived"],
  application_received: ["ar_approved", "ar_declined", "waitlisted"],
  ar_approved: ["discovery_call_booked", "waitlisted", "archived"],
  ar_declined: ["waitlisted", "archived"],
  discovery_call_booked: ["discovery_call_complete", "did_not_turn_up"],
  did_not_turn_up: ["discovery_call_booked", "waitlisted", "archived"],
  discovery_call_complete: ["onboarding_approved", "onboarding_declined", "waitlisted"],
  onboarding_approved: ["archived"],
  onboarding_declined: ["waitlisted", "archived"],
  waitlisted: ["ar_approved", "archived"],
  archived: [],
};

const DECLINE_STAGES = ["ar_declined", "onboarding_declined", "archived", "waitlisted"];

// ─── Component ────────────────────────────────────────────────────────────────

export default function RecruitmentProspectDetail() {
  const [, params] = useRoute("/crm/recruitment/:id");
  const id = parseInt(params?.id ?? "0");

  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [targetStage, setTargetStage] = useState("");
  const [stageNote, setStageNote] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [notesValue, setNotesValue] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);

  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.recruitment.getProspect.useQuery(
    { id },
    { enabled: !!id }
  );

  // Sync notes with server data
  if (data && notesValue === null) {
    setNotesValue(data.adminNotes ?? "");
  }

  const updateStage = trpc.recruitment.updateStage.useMutation({
    onSuccess: () => {
      toast.success("Stage updated successfully");
      setStageDialogOpen(false);
      setStageNote("");
      setDeclineReason("");
      utils.recruitment.getProspect.invalidate({ id });
      utils.recruitment.stageCounts.invalidate();
      utils.recruitment.listProspectsFiltered.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateNotes = trpc.recruitment.updateNotes.useMutation({
    onSuccess: () => {
      toast.success("Notes saved");
      setEditingNotes(false);
      utils.recruitment.getProspect.invalidate({ id });
    },
    onError: (err) => toast.error(err.message),
  });

  const resendProspectus = trpc.recruitment.resendProspectusEmail.useMutation({
    onSuccess: () => {
      toast.success("Prospectus email resent");
      utils.recruitment.getProspect.invalidate({ id });
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-muted-foreground text-sm">Loading prospect...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-destructive">Prospect not found.</p>
        <Link href="/crm/recruitment">
          <Button variant="ghost" size="sm" className="mt-2">
            <ArrowLeft size={14} className="mr-1" /> Back to Pipeline
          </Button>
        </Link>
      </div>
    );
  }

  const stage = getStageBadge(data.pipelineStage);
  const appData = data.applicationData as ApplicationData | null;
  const availableTransitions = STAGE_TRANSITIONS[data.pipelineStage] ?? [];

  function openStageDialog(toStage: string) {
    setTargetStage(toStage);
    setStageNote("");
    setDeclineReason("");
    setStageDialogOpen(true);
  }

  function confirmStageChange() {
    updateStage.mutate({
      id,
      toStage: targetStage,
      note: stageNote || undefined,
      declineReason: declineReason || undefined,
    });
  }

  const targetStageMeta = getStageBadge(targetStage);
  const isDeclineAction = DECLINE_STAGES.includes(targetStage);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Back */}
      <Link href="/crm/recruitment">
        <Button variant="ghost" size="sm" className="mb-4 -ml-2">
          <ArrowLeft size={14} className="mr-1" /> Recruitment Pipeline
        </Button>
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {data.firstName} {data.lastName}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <a href={`mailto:${data.email}`} className="text-muted-foreground text-sm hover:text-foreground flex items-center gap-1">
              <Mail size={13} />
              {data.email}
            </a>
            {data.phone && (
              <span className="text-muted-foreground text-sm">{data.phone}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${stage.color}`}>
              {stage.label}
            </span>
            {data.tierInterest && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full capitalize">
                {data.tierInterest.replace("_", " ")} tier
              </span>
            )}
            {data.source && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full capitalize">
                via {data.source.replace("_", " ")}
              </span>
            )}
          </div>
        </div>

        {/* Stage actions */}
        <div className="flex flex-wrap gap-2 justify-end">
          {availableTransitions.map((toStage) => {
            const meta = getStageBadge(toStage);
            const isNegative = DECLINE_STAGES.includes(toStage);
            return (
              <Button
                key={toStage}
                size="sm"
                variant={isNegative ? "outline" : "default"}
                className={isNegative ? "text-muted-foreground" : "bg-[#02E6D2] hover:bg-[#02E6D2]/90 text-[#1a1a1a]"}
                onClick={() => openStageDialog(toStage)}
              >
                {meta.label}
                <ChevronRight size={12} className="ml-1" />
              </Button>
            );
          })}
          <Button
            size="sm"
            variant="outline"
            onClick={() => resendProspectus.mutate({ id, origin: window.location.origin })}
            disabled={resendProspectus.isPending}
          >
            <Send size={12} className="mr-1" />
            Resend Prospectus
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — application answers + notes */}
        <div className="lg:col-span-2 space-y-6">

          {/* Application Answers */}
          {appData ? (
            <div className="bg-card rounded-xl border border-border p-5">
              <h2 className="font-semibold text-foreground mb-4">Application Answers</h2>
              <dl className="space-y-4">
                {appData.occupation && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Current Occupation</dt>
                    <dd className="text-sm text-foreground">{appData.occupation}</dd>
                  </div>
                )}
                {appData.fullOrPartTime && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Full / Part Time</dt>
                    <dd className="text-sm text-foreground capitalize">{appData.fullOrPartTime.replace("_", "-")}</dd>
                  </div>
                )}
                {appData.experience && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Travel Industry Experience</dt>
                    <dd className="text-sm text-foreground whitespace-pre-wrap">{appData.experience}</dd>
                  </div>
                )}
                {appData.whyJlt && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Why JLT Group?</dt>
                    <dd className="text-sm text-foreground whitespace-pre-wrap">{appData.whyJlt}</dd>
                  </div>
                )}
                {appData.linkedinUrl && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">LinkedIn</dt>
                    <dd className="text-sm">
                      <a href={appData.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-[#02E6D2] hover:underline">
                        {appData.linkedinUrl}
                      </a>
                    </dd>
                  </div>
                )}
                {appData.anythingElse && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Anything Else</dt>
                    <dd className="text-sm text-foreground whitespace-pre-wrap">{appData.anythingElse}</dd>
                  </div>
                )}
              </dl>
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border p-5">
              <h2 className="font-semibold text-foreground mb-2">Application Answers</h2>
              <p className="text-muted-foreground text-sm">
                {data.pipelineStage === "new_enquiry"
                  ? "This prospect has not yet completed their application form."
                  : "No application data available."}
              </p>
            </div>
          )}

          {/* Admin Notes */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-foreground">Admin Notes</h2>
              {!editingNotes && (
                <Button variant="ghost" size="sm" onClick={() => setEditingNotes(true)}>
                  Edit
                </Button>
              )}
            </div>
            {editingNotes ? (
              <div className="space-y-3">
                <Textarea
                  value={notesValue ?? ""}
                  onChange={(e) => setNotesValue(e.target.value)}
                  rows={5}
                  placeholder="Internal notes about this prospect..."
                  className="resize-none"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="bg-[#02E6D2] hover:bg-[#02E6D2]/90 text-[#1a1a1a]"
                    onClick={() => updateNotes.mutate({ id, adminNotes: notesValue ?? "" })}
                    disabled={updateNotes.isPending}
                  >
                    Save Notes
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingNotes(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {data.adminNotes || <span className="text-muted-foreground/60">No notes yet.</span>}
              </p>
            )}
          </div>

          {/* Decline Reason */}
          {data.declineReason && (
            <div className="bg-rose-50 dark:bg-rose-950/20 rounded-xl border border-rose-200 dark:border-rose-900 p-5">
              <h2 className="font-semibold text-rose-800 dark:text-rose-300 mb-2">Decline Reason</h2>
              <p className="text-sm text-rose-700 dark:text-rose-400">{data.declineReason}</p>
            </div>
          )}
        </div>

        {/* Right column — timeline + emails */}
        <div className="space-y-6">
          {/* Key dates */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h2 className="font-semibold text-foreground mb-3">Key Dates</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Enquired</dt>
                <dd className="text-foreground">{new Date(data.createdAt).toLocaleDateString()}</dd>
              </div>
              {data.applicationSubmittedAt && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Applied</dt>
                  <dd className="text-foreground">{new Date(data.applicationSubmittedAt).toLocaleDateString()}</dd>
                </div>
              )}
              {data.reviewedAt && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Reviewed</dt>
                  <dd className="text-foreground">{new Date(data.reviewedAt).toLocaleDateString()}</dd>
                </div>
              )}
              {data.discoveryCallAt && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Discovery Call</dt>
                  <dd className="text-foreground">{new Date(data.discoveryCallAt).toLocaleDateString()}</dd>
                </div>
              )}
              {data.prospectusEmailSentAt && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Prospectus Sent</dt>
                  <dd className="text-foreground">{new Date(data.prospectusEmailSentAt).toLocaleDateString()}</dd>
                </div>
              )}
              {data.howHeard && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">How Heard</dt>
                  <dd className="text-foreground capitalize">{data.howHeard.replace("_", " ")}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Stage History */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h2 className="font-semibold text-foreground mb-3">Stage History</h2>
            {data.stageHistory.length === 0 ? (
              <p className="text-muted-foreground text-sm">No history yet.</p>
            ) : (
              <div className="space-y-3">
                {data.stageHistory.map((h) => {
                  const toMeta = getStageBadge(h.toStage);
                  return (
                    <div key={h.id} className="flex gap-3">
                      <div className="mt-1 w-2 h-2 rounded-full bg-[#02E6D2] shrink-0" />
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${toMeta.color}`}>
                            {toMeta.label}
                          </span>
                          {h.changedByName && (
                            <span className="text-xs text-muted-foreground">by {h.changedByName}</span>
                          )}
                        </div>
                        {h.note && (
                          <p className="text-xs text-muted-foreground mt-0.5">{h.note}</p>
                        )}
                        <p className="text-xs text-muted-foreground/60 mt-0.5">
                          <Clock size={10} className="inline mr-0.5" />
                          {new Date(h.changedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Emails Sent */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h2 className="font-semibold text-foreground mb-3">Emails Sent</h2>
            {data.emailsSent.length === 0 ? (
              <p className="text-muted-foreground text-sm">No emails sent yet.</p>
            ) : (
              <div className="space-y-2">
                {data.emailsSent.map((e) => (
                  <div key={e.id} className="text-sm">
                    <p className="text-foreground font-medium truncate">{e.subject ?? e.emailKey}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.sentAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stage Change Dialog */}
      <Dialog open={stageDialogOpen} onOpenChange={setStageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Move to{" "}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${targetStageMeta.color}`}>
                {targetStageMeta.label}
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {isDeclineAction && (
              <div>
                <label className="text-sm font-medium text-foreground block mb-1">
                  Reason <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <Textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Reason for this decision..."
                  rows={3}
                  className="resize-none"
                />
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-foreground block mb-1">
                Note <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Textarea
                value={stageNote}
                onChange={(e) => setStageNote(e.target.value)}
                placeholder="Add a note about this stage change..."
                rows={3}
                className="resize-none"
              />
            </div>
            {targetStage === "ar_approved" && (
              <p className="text-sm text-muted-foreground bg-muted rounded-lg p-3">
                An email will be sent to <strong>{data.firstName}</strong> with a link to book their discovery call on Cal.com.
              </p>
            )}
            {targetStage === "ar_declined" && (
              <p className="text-sm text-muted-foreground bg-muted rounded-lg p-3">
                A polite decline email will be sent to <strong>{data.firstName}</strong>.
              </p>
            )}
            {targetStage === "waitlisted" && (
              <p className="text-sm text-muted-foreground bg-muted rounded-lg p-3">
                A waitlist notification email will be sent to <strong>{data.firstName}</strong>.
              </p>
            )}
            {targetStage === "onboarding_approved" && (
              <p className="text-sm text-muted-foreground bg-muted rounded-lg p-3">
                A welcome email will be sent to <strong>{data.firstName}</strong>.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setStageDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-[#02E6D2] hover:bg-[#02E6D2]/90 text-[#1a1a1a]"
              onClick={confirmStageChange}
              disabled={updateStage.isPending}
            >
              {updateStage.isPending ? "Updating..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
