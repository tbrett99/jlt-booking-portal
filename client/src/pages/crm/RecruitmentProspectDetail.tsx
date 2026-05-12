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
import { ArrowLeft, Mail, Clock, ChevronRight, Send, Trash2 } from "lucide-react";
import { useLocation } from "wouter";
import { getStageBadge, PIPELINE_STAGES } from "./RecruitmentPipeline";

// ─── Application data type ────────────────────────────────────────────────────

interface ApplicationData {
  // Core fields
  occupation?: string;
  whyJlt?: string;
  experience?: string;
  fullOrPartTime?: string;
  linkedinUrl?: string;
  anythingElse?: string;
  submittedAt?: string;
  // Agent Readiness Form extended fields
  selfEmployed?: string;
  travelExperience?: string;
  travelExperienceDetails?: string;
  mainGoal?: string[];
  travelSpecialism?: string;
  hoursPerWeek?: string;
  homeSupport?: string;
  investmentReadiness?: string;
  selfEmployedAwareness?: string;
  biggestWorry?: string;
  techConfidence?: string;
  financialReadiness?: string;
  twoYearVision?: string;
  heardAbout?: string[];
  heardAboutOther?: string;
  lookingAtOthers?: string;
  lookingAtOthersDetails?: string;
}

// ─── Stage transition config ──────────────────────────────────────────────────

const STAGE_TRANSITIONS: Record<string, string[]> = {
  new_enquiry: ["application_received", "archived"],
  application_received: ["ar_approved", "ar_declined", "waitlisted"],
  ar_approved: ["discovery_call_booked", "waitlisted", "archived"],
  ar_declined: ["waitlisted", "archived"],
  discovery_call_booked: ["discovery_call_complete", "rebook_required", "did_not_turn_up"],
  rebook_required: ["discovery_call_booked", "did_not_turn_up", "waitlisted", "archived"],
  did_not_turn_up: ["discovery_call_booked", "rebook_required", "waitlisted", "archived"],
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
  const [, navigate] = useLocation();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
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

  const resendApplicationLink = trpc.recruitment.resendApplicationLink.useMutation({
    onSuccess: () => {
      toast.success("Application link email sent to " + data?.email);
      utils.recruitment.getProspect.invalidate({ id });
      utils.recruitment.getEmailsSent.invalidate({ id });
    },
    onError: (err) => toast.error("Failed to send: " + err.message),
  });
  const deleteProspect = trpc.recruitment.deleteProspect.useMutation({
    onSuccess: () => {
      toast.success("Prospect deleted");
      utils.recruitment.listProspects.invalidate();
      utils.recruitment.stageCounts.invalidate();
      navigate("/crm/recruitment");
    },
    onError: () => toast.error("Failed to delete prospect"),
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
            {(data as any).referrerName && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#70FFE8]/20 text-[#0d6b5e] border border-[#70FFE8]/40">
                Referred by {(data as any).referrerName}
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
          <Button
            size="sm"
            variant="outline"
            className="border-[#70FFE8] text-[#0d6b5e] hover:bg-[#70FFE8]/10"
            onClick={() => resendApplicationLink.mutate({ id, origin: window.location.origin })}
            disabled={resendApplicationLink.isPending}
          >
            <Send size={12} className="mr-1" />
            {resendApplicationLink.isPending ? "Sending..." : "Resend Application Link"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 size={12} className="mr-1" />
            Delete
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
              {/* Section helper */}
              <dl className="space-y-5">

                {/* ── Background & Experience ── */}
                <div className="pb-4 border-b border-border">
                  <p className="text-xs font-semibold text-[#02E6D2] uppercase tracking-widest mb-3">Background &amp; Experience</p>
                  <div className="space-y-4">
                    {appData.whyJlt && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Why interested in becoming a travel agent?</dt>
                        <dd className="text-sm text-foreground whitespace-pre-wrap">{appData.whyJlt}</dd>
                      </div>
                    )}
                    {appData.selfEmployed && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Currently / previously self-employed?</dt>
                        <dd className="text-sm text-foreground">{appData.selfEmployed}</dd>
                      </div>
                    )}
                    {appData.travelExperience && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Worked in travel or customer service?</dt>
                        <dd className="text-sm text-foreground">{appData.travelExperience}</dd>
                      </div>
                    )}
                    {appData.travelExperienceDetails && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Travel / customer service experience details</dt>
                        <dd className="text-sm text-foreground whitespace-pre-wrap">{appData.travelExperienceDetails}</dd>
                      </div>
                    )}
                    {/* Legacy field */}
                    {appData.experience && !appData.travelExperienceDetails && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Travel Industry Experience</dt>
                        <dd className="text-sm text-foreground whitespace-pre-wrap">{appData.experience}</dd>
                      </div>
                    )}
                    {appData.occupation && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Current occupation / income source</dt>
                        <dd className="text-sm text-foreground">{appData.occupation}</dd>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Travel Business Plans ── */}
                <div className="pb-4 border-b border-border">
                  <p className="text-xs font-semibold text-[#02E6D2] uppercase tracking-widest mb-3">Travel Business Plans</p>
                  <div className="space-y-4">
                    {appData.mainGoal && appData.mainGoal.length > 0 && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Main goal for first 12 months</dt>
                        <dd className="text-sm text-foreground">{appData.mainGoal.join(", ")}</dd>
                      </div>
                    )}
                    {appData.travelSpecialism && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Travel specialism interest</dt>
                        <dd className="text-sm text-foreground">{appData.travelSpecialism}</dd>
                      </div>
                    )}
                    {(appData.hoursPerWeek || appData.fullOrPartTime) && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Hours per week / commitment</dt>
                        <dd className="text-sm text-foreground">
                          {appData.hoursPerWeek || appData.fullOrPartTime?.replace("_", "-")}
                        </dd>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Mindset & Readiness ── */}
                <div className="pb-4 border-b border-border">
                  <p className="text-xs font-semibold text-[#02E6D2] uppercase tracking-widest mb-3">Mindset &amp; Readiness</p>
                  <div className="space-y-4">
                    {appData.homeSupport && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Support at home</dt>
                        <dd className="text-sm text-foreground">{appData.homeSupport}</dd>
                      </div>
                    )}
                    {appData.investmentReadiness && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Readiness to invest (time, energy, financially)</dt>
                        <dd className="text-sm text-foreground">{appData.investmentReadiness}</dd>
                      </div>
                    )}
                    {appData.selfEmployedAwareness && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Aware this is self-employed?</dt>
                        <dd className="text-sm text-foreground">{appData.selfEmployedAwareness}</dd>
                      </div>
                    )}
                    {appData.biggestWorry && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Biggest worry / hesitation</dt>
                        <dd className="text-sm text-foreground whitespace-pre-wrap">{appData.biggestWorry}</dd>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Financial & Tech Readiness ── */}
                <div className="pb-4 border-b border-border">
                  <p className="text-xs font-semibold text-[#02E6D2] uppercase tracking-widest mb-3">Financial &amp; Tech Readiness</p>
                  <div className="space-y-4">
                    {appData.techConfidence && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Tech confidence</dt>
                        <dd className="text-sm text-foreground">{appData.techConfidence}</dd>
                      </div>
                    )}
                    {appData.financialReadiness && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Financial readiness</dt>
                        <dd className="text-sm text-foreground">{appData.financialReadiness}</dd>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Long-Term Vision ── */}
                {appData.twoYearVision && (
                  <div className="pb-4 border-b border-border">
                    <p className="text-xs font-semibold text-[#02E6D2] uppercase tracking-widest mb-3">Long-Term Vision</p>
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Where they want to be in 2 years</dt>
                      <dd className="text-sm text-foreground whitespace-pre-wrap">{appData.twoYearVision}</dd>
                    </div>
                  </div>
                )}

                {/* ── How Did You Hear About Us ── */}
                <div>
                  <p className="text-xs font-semibold text-[#02E6D2] uppercase tracking-widest mb-3">How Did They Hear About Us</p>
                  <div className="space-y-4">
                    {appData.heardAbout && appData.heardAbout.length > 0 && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Source</dt>
                        <dd className="text-sm text-foreground">{appData.heardAbout.join(", ")}</dd>
                      </div>
                    )}
                    {appData.heardAboutOther && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Source details / referral</dt>
                        <dd className="text-sm text-foreground">{appData.heardAboutOther}</dd>
                      </div>
                    )}
                    {appData.lookingAtOthers && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Looking at other host agencies?</dt>
                        <dd className="text-sm text-foreground">{appData.lookingAtOthers}</dd>
                      </div>
                    )}
                    {appData.lookingAtOthersDetails && (
                      <div>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Which other agencies?</dt>
                        <dd className="text-sm text-foreground">{appData.lookingAtOthersDetails}</dd>
                      </div>
                    )}
                    {/* Legacy fields */}
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
                  </div>
                </div>

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
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-foreground flex items-center gap-2">
                <Mail className="w-4 h-4 text-muted-foreground" />
                Email Log
              </h2>
              {data.emailsSent.length > 0 && (
                <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
                  {data.emailsSent.length} sent
                </span>
              )}
            </div>
            {data.emailsSent.length === 0 ? (
              <p className="text-muted-foreground text-sm">No emails sent yet.</p>
            ) : (
              <div className="space-y-3">
                {data.emailsSent.map((e) => {
                  const friendlyNames: Record<string, string> = {
                    application_confirmation: "Application Confirmation",
                    followup_day3: "Day 3 Follow-up",
                    followup_day7: "Day 7 Follow-up",
                    re_engagement_june_2026: "Re-engagement (June 2026)",
                    ar_approved_notification: "Agent Readiness Approved",
                    ar_declined_notification: "Agent Readiness Declined",
                    waitlisted_notification: "Waitlisted",
                    dntu_notification: "Did Not Turn Up",
                    onboarding_approved_notification: "Onboarding Approved",
                    discovery_call_booked: "Discovery Call Booked",
                    welcome_email: "Welcome Email",
                  };
                  const label = friendlyNames[e.emailKey] ?? e.emailKey.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                  return (
                    <div key={e.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Send className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{label}</p>
                        {e.subject && e.subject !== label && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">Subject: {e.subject}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(e.sentAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  );
                })}
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

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Prospect</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to permanently delete <strong>{data?.firstName} {data?.lastName}</strong>? This will remove all their application data, stage history, and email logs. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteProspect.mutate({ id })}
              disabled={deleteProspect.isPending}
            >
              {deleteProspect.isPending ? "Deleting..." : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
