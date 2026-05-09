/**
 * Agent Recruitment — /crm/recruitment
 *
 * Single management view with three tabs:
 *  1. Prospects Pipeline  — all recruitment prospects with stage filter
 *  2. Sign-Up Applications — self-service join sessions (GoCardless flow)
 *  3. Abandoned Sign-Ups  — incomplete sessions, nudge / delete
 */
import React, { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search, ExternalLink, RefreshCw, Loader2, UserPlus, AlertCircle,
  CheckCircle2, Clock, FileSignature, CreditCard, Users, UserX,
  Mail, ChevronDown, ChevronUp, Trash2, UserCheck, Filter, Send,
} from "lucide-react";
import { toast } from "sonner";
import { TIER_LABELS, TYPE_LABELS } from "../../../../shared/membership";

// ─── Stage config ─────────────────────────────────────────────────────────────

export const PIPELINE_STAGES = [
  { value: "new_enquiry",            label: "New Enquiry",         color: "bg-blue-100 text-blue-800" },
  { value: "application_received",   label: "Application Received", color: "bg-yellow-100 text-yellow-800" },
  { value: "ar_approved",            label: "AR Approved",          color: "bg-green-100 text-green-800" },
  { value: "ar_declined",            label: "AR Declined",          color: "bg-red-100 text-red-800" },
  { value: "discovery_call_booked",  label: "Call Booked",          color: "bg-purple-100 text-purple-800" },
  { value: "rebook_required",        label: "Rebook Required",      color: "bg-amber-100 text-amber-800" },
  { value: "did_not_turn_up",        label: "Did Not Turn Up",      color: "bg-orange-100 text-orange-800" },
  { value: "discovery_call_complete",label: "Call Complete",        color: "bg-teal-100 text-teal-800" },
  { value: "onboarding_approved",    label: "Onboarding Approved",  color: "bg-emerald-100 text-emerald-800" },
  { value: "onboarding_declined",    label: "Onboarding Declined",  color: "bg-rose-100 text-rose-800" },
  { value: "won",                    label: "Won",                  color: "bg-amber-100 text-amber-900" },
  { value: "waitlisted",             label: "Waitlisted",           color: "bg-gray-100 text-gray-600" },
  { value: "archived",               label: "Archived",             color: "bg-gray-100 text-gray-400" },
];

export function getStageBadge(stage: string) {
  const s = PIPELINE_STAGES.find((x) => x.value === stage);
  return s ?? { value: stage, label: stage, color: "bg-gray-100 text-gray-600" };
}

// ─── Sign-Up Applications helpers ─────────────────────────────────────────────

type Step = "plan" | "contract" | "payment" | "complete";

const STEP_LABELS: Record<Step, string> = {
  plan: "Plan Selection",
  contract: "Contract Signing",
  payment: "Payment",
  complete: "Complete",
};

const STEP_COLORS: Record<Step, string> = {
  plan: "bg-gray-100 text-gray-600",
  contract: "bg-amber-100 text-amber-700",
  payment: "bg-blue-100 text-blue-700",
  complete: "bg-green-100 text-green-700",
};

function StepBadge({ step }: { step: string }) {
  const s = step as Step;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STEP_COLORS[s] ?? "bg-gray-100 text-gray-600"}`}>
      {s === "complete" && <CheckCircle2 size={11} />}
      {s === "payment" && <CreditCard size={11} />}
      {s === "contract" && <FileSignature size={11} />}
      {s === "plan" && <Clock size={11} />}
      {STEP_LABELS[s] ?? s}
    </span>
  );
}

function ActivateButton({ userId }: { userId: number }) {
  const utils = trpc.useUtils();
  const activate = trpc.users.activatePortalAccess.useMutation({
    onSuccess: () => {
      toast.success("Portal access activated");
      utils.join.adminListSessions.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Button
      size="sm"
      className="h-7 text-xs gap-1"
      style={{ background: "#70FFE8", color: "#0d1a26" }}
      disabled={activate.isPending}
      onClick={() => activate.mutate({ userId })}
    >
      <UserCheck size={11} />
      {activate.isPending ? "..." : "Activate"}
    </Button>
  );
}

// ─── Abandoned sign-ups helpers ────────────────────────────────────────────────

const TIER_COLOURS: Record<string, string> = {
  business_class: "bg-blue-100 text-blue-800",
  first_class: "bg-purple-100 text-purple-800",
  charter: "bg-amber-100 text-amber-800",
};

const STEP_COLOURS_ABANDONED: Record<string, string> = {
  "Reached contract step": "bg-yellow-100 text-yellow-800",
  "Reached payment step": "bg-orange-100 text-orange-800",
  "Contract signed — payment pending": "bg-orange-200 text-orange-900",
  "Paid — awaiting account creation": "bg-green-100 text-green-800",
  "Started application": "bg-gray-100 text-gray-700",
};

// ─── Stage transitions (mirrors RecruitmentProspectDetail) ─────────────────────

const STAGE_TRANSITIONS: Record<string, string[]> = {
  new_enquiry: ["application_received", "archived"],
  application_received: ["ar_approved", "ar_declined", "waitlisted"],
  ar_approved: ["discovery_call_booked", "waitlisted", "archived"],
  ar_declined: ["waitlisted", "archived"],
  discovery_call_booked: ["discovery_call_complete", "rebook_required", "did_not_turn_up"],
  rebook_required: ["discovery_call_booked", "did_not_turn_up", "waitlisted", "archived"],
  did_not_turn_up: ["discovery_call_booked", "rebook_required", "waitlisted", "archived"],
  discovery_call_complete: ["onboarding_approved", "onboarding_declined", "waitlisted"],
  onboarding_approved: ["won", "archived"],
  onboarding_declined: ["waitlisted", "archived"],
  waitlisted: ["ar_approved", "archived"],
  won: ["archived"],
  archived: [],
};

// ─── Tab: Prospects Pipeline ───────────────────────────────────────────────────

function ProspectsPipelineTab() {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [referredByFilter, setReferredByFilter] = useState<number | undefined>(undefined);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showBulkSendDialog, setShowBulkSendDialog] = useState(false);
  const [bulkJobStarted, setBulkJobStarted] = useState(false);
  const utils = trpc.useUtils();

  const updateStage = trpc.recruitment.updateStage.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`Moved to ${getStageBadge(vars.toStage).label}`);
      utils.recruitment.listProspectsFiltered.invalidate();
      utils.recruitment.stageCounts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const { data: prospects = [], isLoading } = trpc.recruitment.listProspectsFiltered.useQuery(
    {
      stage: stageFilter === "all" ? undefined : stageFilter,
      search: search || undefined,
      referredById: referredByFilter,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    },
    { refetchInterval: 30_000 }
  );

  // Get unique referrers from all prospects for the filter dropdown
  const { data: allProspectsForFilter = [] } = trpc.recruitment.listProspectsFiltered.useQuery(
    {},
    { staleTime: 60_000 }
  );
  const referrers = Array.from(
    new Map(
      (allProspectsForFilter as any[])
        .filter((p) => p.referredById && p.referrerName)
        .map((p) => [p.referredById, p.referrerName])
    ).entries()
  ).map(([id, name]) => ({ id: id as number, name: name as string }));

  const { data: stageCounts = {} } = trpc.recruitment.stageCounts.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const { data: newEnquiryCount } = trpc.recruitment.countNewEnquiryProspects.useQuery();

  // Poll job status every 2s while dialog is open
  const { data: jobStatus } = trpc.recruitment.bulkEmailJobStatus.useQuery(undefined, {
    refetchInterval: showBulkSendDialog ? 2000 : false,
    staleTime: 0,
  });

  const bulkSendMutation = trpc.recruitment.bulkSendReEngagementEmail.useMutation({
    onSuccess: () => {
      setBulkJobStarted(true);
    },
    onError: (e) => {
      toast.error(e.message);
      setShowBulkSendDialog(false);
    },
  });

  const totalActive = (prospects as any[]).filter(
    (p) => !["archived", "ar_declined", "onboarding_declined"].includes(p.pipelineStage)
  ).length;

  return (
    <div className="space-y-5">
      {/* Stage summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {PIPELINE_STAGES.filter((s) =>
          !["ar_declined", "onboarding_declined", "archived"].includes(s.value)
        ).map((s) => (
          <button
            key={s.value}
            onClick={() => setStageFilter(stageFilter === s.value ? "all" : s.value)}
            className={`rounded-xl border p-3 text-left transition-all hover:shadow-sm ${
              stageFilter === s.value ? "ring-2 ring-[#02E6D2] border-[#02E6D2]" : "border-border"
            }`}
          >
            <div className="text-2xl font-bold text-foreground">
              {(stageCounts as Record<string, number>)[s.value] ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All stages" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {PIPELINE_STAGES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {referrers.length > 0 && (
          <Select
            value={referredByFilter ? String(referredByFilter) : "all"}
            onValueChange={(v) => setReferredByFilter(v === "all" ? undefined : Number(v))}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All referrers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Referrers</SelectItem>
              {referrers.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            title="From date"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            title="To date"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Clear
            </button>
          )}
        </div>
        <span className="text-sm text-muted-foreground self-center">{totalActive} active</span>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 ml-auto"
          onClick={() => { setBulkJobStarted(false); setShowBulkSendDialog(true); }}
        >
          <Send size={14} />
          Send Re-engagement Email
        </Button>
      </div>

      {/* Bulk send confirmation dialog */}
      <AlertDialog
        open={showBulkSendDialog}
        onOpenChange={(open) => {
          // Allow closing only when not actively running
          if (!open && jobStatus?.status !== "running") {
            setShowBulkSendDialog(false);
            setBulkJobStarted(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send Re-engagement Email</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {/* Job is running or done (started this session) */}
                {bulkJobStarted ? (
                  jobStatus?.status === "done" ? (
                    <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm space-y-1">
                      <p className="font-semibold text-green-800">✓ Email send complete</p>
                      <p className="text-green-700"><strong>{jobStatus.sent}</strong> emails sent successfully</p>
                      {(jobStatus.skipped ?? 0) > 0 && <p className="text-muted-foreground">{jobStatus.skipped} already received this email (skipped)</p>}
                      {(jobStatus.errors ?? 0) > 0 && <p className="text-red-600">{jobStatus.errors} failed to send</p>}
                    </div>
                  ) : jobStatus?.status === "error" ? (
                    <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm">
                      <p className="font-semibold text-red-800">✗ An error occurred during sending</p>
                      <p className="text-muted-foreground mt-1">{jobStatus.sent} sent before the error. Please try again.</p>
                    </div>
                  ) : (
                    /* Running — show live progress */
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 size={14} className="animate-spin text-[#02E6D2]" />
                        <span>Sending emails in the background… you can close this dialog and it will continue.</span>
                      </div>
                      <div className="rounded-lg bg-muted/40 border border-border p-4 text-sm space-y-2">
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>{(jobStatus?.sent ?? 0) + (jobStatus?.skipped ?? 0) + (jobStatus?.errors ?? 0)} of {jobStatus?.total ?? "…"} processed</span>
                          <span>{jobStatus?.total ? Math.round(((jobStatus.sent + jobStatus.skipped + jobStatus.errors) / jobStatus.total) * 100) : 0}%</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                          <div
                            className="h-2 rounded-full transition-all duration-500"
                            style={{
                              width: jobStatus?.total ? `${Math.round(((jobStatus.sent + jobStatus.skipped + jobStatus.errors) / jobStatus.total) * 100)}%` : "0%",
                              background: "#02E6D2",
                            }}
                          />
                        </div>
                        <div className="flex gap-4 text-xs pt-1">
                          <span className="text-green-700"><strong>{jobStatus?.sent ?? 0}</strong> sent</span>
                          <span className="text-muted-foreground"><strong>{jobStatus?.skipped ?? 0}</strong> skipped</span>
                          {(jobStatus?.errors ?? 0) > 0 && <span className="text-red-600"><strong>{jobStatus?.errors}</strong> errors</span>}
                        </div>
                      </div>
                    </div>
                  )
                ) : (
                  /* Pre-send confirmation */
                  <>
                    <p>This will send the <strong>"Join Before the Price Increase"</strong> re-engagement email to all <strong>{newEnquiryCount?.count ?? "…"} prospects</strong> currently in the <em>New Enquiry</em> stage.</p>
                    <p>Prospects who have already received this email will be skipped automatically.</p>
                    <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 text-xs">Emails are sent in the background — you can close this dialog once sending starts and it will continue running.</p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {bulkJobStarted && (jobStatus?.status === "done" || jobStatus?.status === "error") ? (
              <AlertDialogAction onClick={() => { setShowBulkSendDialog(false); setBulkJobStarted(false); }}>Done</AlertDialogAction>
            ) : bulkJobStarted && jobStatus?.status === "running" ? (
              <AlertDialogAction onClick={() => setShowBulkSendDialog(false)} style={{ background: "#02E6D2", color: "#1a1a1a" }}>Close (sending continues)</AlertDialogAction>
            ) : (
              <>
                <AlertDialogCancel disabled={bulkSendMutation.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={bulkSendMutation.isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    bulkSendMutation.mutate({ origin: window.location.origin });
                  }}
                  style={{ background: "#02E6D2", color: "#1a1a1a" }}
                >
                  {bulkSendMutation.isPending ? (
                    <><Loader2 size={14} className="animate-spin mr-1" /> Starting…</>
                  ) : (
                    <><Send size={14} className="mr-1" /> Send to {newEnquiryCount?.count ?? "…"} Prospects</>
                  )}
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading prospects...</div>
        ) : (prospects as any[]).length === 0 ? (
          <div className="p-12 text-center">
            <UserPlus size={40} className="mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-muted-foreground font-medium">No prospects found</p>
            <p className="text-muted-foreground/60 text-sm mt-1">
              {search || stageFilter !== "all"
                ? "Try adjusting your filters"
                : "Share the enquiry form to start receiving applications"}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Stage</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Referred By</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date of Enquiry</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Applied</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Move Stage</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {(prospects as any[]).map((p) => {
                const stage = getStageBadge(p.pipelineStage);
                return (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {p.firstName} {p.lastName}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${stage.color}`}>
                        {stage.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {p.referrerName ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#70FFE8]/20 text-[#0d6b5e] border border-[#70FFE8]/40">
                          {p.referrerName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.applicationSubmittedAt
                        ? new Date(p.applicationSubmittedAt).toLocaleDateString()
                        : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {/* Inline stage change dropdown */}
                      {(STAGE_TRANSITIONS[p.pipelineStage] ?? []).length > 0 ? (
                        <Select
                          value=""
                          onValueChange={(toStage) => {
                            if (toStage) updateStage.mutate({ id: p.id, toStage });
                          }}
                          disabled={updateStage.isPending}
                        >
                          <SelectTrigger className="h-7 text-xs w-44 border-dashed">
                            <SelectValue placeholder="Move to..." />
                          </SelectTrigger>
                          <SelectContent>
                            {(STAGE_TRANSITIONS[p.pipelineStage] ?? []).map((toStage) => (
                              <SelectItem key={toStage} value={toStage} className="text-xs">
                                {getStageBadge(toStage).label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/crm/recruitment/${p.id}`}>
                        <Button variant="ghost" size="sm" className="text-xs">
                          View
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Sign-Up Applications ─────────────────────────────────────────────────

function SignUpApplicationsTab() {
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "contract" | "payment" | "complete">("all");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; email: string } | null>(null);
  const utils = trpc.useUtils();

  const deleteSession = trpc.join.deleteJoinSession.useMutation({
    onSuccess: () => {
      toast.success(`Session for ${deleteTarget?.email ?? "entry"} deleted`);
      setDeleteTarget(null);
      utils.join.adminListSessions.invalidate();
    },
    onError: (e) => { toast.error(e.message); setDeleteTarget(null); },
  });

  const { data: sessions, isLoading, refetch } = trpc.join.adminListSessions.useQuery({
    status: statusFilter,
    limit: 100,
    offset: 0,
  });

  const { data: allSessions } = trpc.join.adminListSessions.useQuery({ status: "all", limit: 200, offset: 0 });

  const filtered = (sessions ?? []).filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.email.toLowerCase().includes(q) ||
      ((s as any).signerName ?? "").toLowerCase().includes(q)
    );
  });

  const stats = React.useMemo(() => {
    if (!allSessions) return null;
    return {
      total: allSessions.length,
      complete: allSessions.filter((s) => s.step === "complete").length,
      pending: allSessions.filter((s) => s.step !== "complete").length,
      contractSigned: allSessions.filter((s) => s.contractSignedAt).length,
      paid: allSessions.filter((s) => s.joiningFeePaidAt).length,
    };
  }, [allSessions]);

  return (
    <div className="space-y-5">
      {/* Summary stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Total Applications", value: stats.total, icon: <Users size={16} /> },
            { label: "Complete", value: stats.complete, icon: <CheckCircle2 size={16} className="text-green-500" /> },
            { label: "In Progress", value: stats.pending, icon: <Clock size={16} className="text-amber-500" /> },
            { label: "Contract Signed", value: stats.contractSigned, icon: <FileSignature size={16} className="text-blue-500" /> },
            { label: "Joining Fee Paid", value: stats.paid, icon: <CreditCard size={16} className="text-purple-500" /> },
          ].map((stat) => (
            <div key={stat.label} className="bg-card rounded-xl border border-border p-4 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs">{stat.icon} {stat.label}</div>
              <div className="text-2xl font-bold text-foreground">{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Input
          placeholder="Search by email or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Plan Selection</SelectItem>
            <SelectItem value="contract">Contract Signing</SelectItem>
            <SelectItem value="payment">Payment</SelectItem>
            <SelectItem value="complete">Complete</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1">
          <RefreshCw size={14} /> Refresh
        </Button>
        <span className="text-sm text-muted-foreground ml-auto">{filtered.length} session{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="animate-spin text-[#70FFE8]" size={28} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <AlertCircle size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No sign-up sessions found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Email / Name</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Contract</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Portal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((session) => (
                <TableRow key={session.id} className="hover:bg-muted/20">
                  <TableCell>
                    <div className="font-medium text-foreground text-sm">{session.email}</div>
                    {(session as any).signerName && (
                      <div className="text-xs text-muted-foreground">{(session as any).signerName}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {session.membershipTier ? (
                      <div>
                        <div className="text-xs font-medium text-foreground">
                          {TIER_LABELS[session.membershipTier as keyof typeof TIER_LABELS] ?? session.membershipTier}
                        </div>
                        {session.membershipType && (
                          <div className="text-xs text-muted-foreground">
                            {TYPE_LABELS[session.membershipType as keyof typeof TYPE_LABELS] ?? session.membershipType}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell><StepBadge step={session.step} /></TableCell>
                  <TableCell>
                    {session.contractSignedAt ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle2 size={12} />
                        {new Date(session.contractSignedAt).toLocaleDateString("en-GB")}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not signed</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {session.joiningFeePaidAt ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle2 size={12} />
                        {new Date(session.joiningFeePaidAt).toLocaleDateString("en-GB")}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not paid</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {session.userId ? (
                      <span className="text-xs font-mono text-foreground">#{session.userId}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {new Date(session.createdAt).toLocaleDateString("en-GB")}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {session.userId && session.step === "complete" ? (
                        <ActivateButton userId={session.userId} />
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                      {!session.userId && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-destructive hover:bg-destructive/10 border-destructive/30"
                          onClick={() => setDeleteTarget({ id: session.id, email: session.email })}
                        >
                          <Trash2 size={13} />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete sign-up application?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the application for <strong>{deleteTarget?.email}</strong>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteSession.mutate({ sessionId: deleteTarget.id })}
              disabled={deleteSession.isPending}
            >
              {deleteSession.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Tab: Abandoned Sign-Ups ───────────────────────────────────────────────────

function AbandonedSignUpsTab() {
  const [minDaysIdle, setMinDaysIdle] = useState(0);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"daysIdle" | "daysAgo" | "tier">("daysAgo");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [nudgingSessions, setNudgingSessions] = useState<Set<number>>(new Set());
  const [nudgedSessions, setNudgedSessions] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; email: string } | null>(null);
  const utils = trpc.useUtils();

  const deleteSession = trpc.join.deleteJoinSession.useMutation({
    onSuccess: () => {
      toast.success(`Session for ${deleteTarget?.email ?? "entry"} deleted`);
      setDeleteTarget(null);
      utils.join.getAbandonedSessions.invalidate();
    },
    onError: (e) => { toast.error(e.message); setDeleteTarget(null); },
  });

  const { data: sessions = [], isLoading, refetch } = trpc.join.getAbandonedSessions.useQuery(
    { daysIdle: minDaysIdle },
    { refetchOnWindowFocus: false }
  );

  const sendNudge = trpc.join.sendNudge.useMutation({
    onSuccess: (data, variables) => {
      toast.success(`Nudge email sent to ${data.email}`);
      setNudgingSessions((prev) => { const s = new Set(prev); s.delete(variables.sessionId); return s; });
      setNudgedSessions((prev) => new Set(prev).add(variables.sessionId));
    },
    onError: (err, variables) => {
      toast.error(err.message || "Failed to send nudge");
      setNudgingSessions((prev) => { const s = new Set(prev); s.delete(variables.sessionId); return s; });
    },
  });

  const handleNudge = (sessionId: number) => {
    setNudgingSessions((prev) => new Set(prev).add(sessionId));
    sendNudge.mutate({ sessionId });
  };

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir("desc"); }
  };

  const filtered = (sessions as any[])
    .filter((s) => {
      if (search && !s.email.toLowerCase().includes(search.toLowerCase())) return false;
      if (tierFilter !== "all" && s.membershipTier !== tierFilter) return false;
      return true;
    })
    .sort((a, b) => {
      let diff = 0;
      if (sortBy === "daysIdle") diff = a.daysIdle - b.daysIdle;
      else if (sortBy === "daysAgo") diff = a.daysAgo - b.daysAgo;
      else if (sortBy === "tier") diff = (a.membershipTier ?? "").localeCompare(b.membershipTier ?? "");
      return sortDir === "asc" ? diff : -diff;
    });

  const SortIcon = ({ col }: { col: typeof sortBy }) =>
    sortBy === col ? (sortDir === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : null;

  const totalAbandoned = (sessions as any[]).length;
  const abandonedToday = (sessions as any[]).filter((s) => s.daysAgo === 0).length;
  const abandonedThisWeek = (sessions as any[]).filter((s) => s.daysAgo <= 7).length;
  const reachedPayment = (sessions as any[]).filter((s) => s.step === "payment" || s.contractSignedAt).length;

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{totalAbandoned}</div>
            <div className="text-xs text-muted-foreground mt-1">Total abandoned</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-amber-600">{abandonedToday}</div>
            <div className="text-xs text-muted-foreground mt-1">Started today</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-blue-600">{abandonedThisWeek}</div>
            <div className="text-xs text-muted-foreground mt-1">Last 7 days</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600">{reachedPayment}</div>
            <div className="text-xs text-muted-foreground mt-1">Reached payment</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Search email</label>
          <Input
            placeholder="e.g. anna@..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-52"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Membership tier</label>
          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tiers</SelectItem>
              <SelectItem value="business_class">Business Class</SelectItem>
              <SelectItem value="first_class">First Class</SelectItem>
              <SelectItem value="charter">Charter</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Idle for at least (days)</label>
          <Input
            type="number"
            min={0}
            value={minDaysIdle}
            onChange={(e) => setMinDaysIdle(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-28"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2 mb-0.5">
          <RefreshCw size={14} />
          Refresh
        </Button>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading abandoned sign-ups…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <UserX size={32} className="mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No abandoned sign-ups match your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                  <th
                    className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                    onClick={() => toggleSort("tier")}
                  >
                    <span className="flex items-center gap-1">Tier <SortIcon col="tier" /></span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Progress</th>
                  <th
                    className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                    onClick={() => toggleSort("daysAgo")}
                  >
                    <span className="flex items-center gap-1">Started <SortIcon col="daysAgo" /></span>
                  </th>
                  <th
                    className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                    onClick={() => toggleSort("daysIdle")}
                  >
                    <span className="flex items-center gap-1">Idle <SortIcon col="daysIdle" /></span>
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s: any) => {
                  const isNudging = nudgingSessions.has(s.id);
                  const wasNudged = nudgedSessions.has(s.id);
                  const startedLabel = s.daysAgo === 0 ? "Today"
                    : s.daysAgo === 1 ? "Yesterday"
                    : `${s.daysAgo}d ago`;
                  const idleLabel = s.daysIdle === 0 ? "Today"
                    : s.daysIdle === 1 ? "1 day"
                    : `${s.daysIdle} days`;
                  const idleColour = s.daysIdle >= 7 ? "text-red-600 font-semibold"
                    : s.daysIdle >= 3 ? "text-amber-600 font-medium"
                    : "text-muted-foreground";
                  return (
                    <tr key={s.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium">{s.email}</td>
                      <td className="px-4 py-3">
                        <Badge className={`text-xs ${TIER_COLOURS[s.membershipTier ?? ""] ?? "bg-gray-100 text-gray-700"}`} variant="outline">
                          {TIER_LABELS[s.membershipTier as keyof typeof TIER_LABELS] ?? s.membershipTier ?? "—"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 capitalize text-muted-foreground">{s.membershipType ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge className={`text-xs ${STEP_COLOURS_ABANDONED[s.progress] ?? "bg-gray-100 text-gray-700"}`} variant="outline">
                          {s.progress}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock size={13} />
                          {startedLabel}
                        </span>
                      </td>
                      <td className={`px-4 py-3 ${idleColour}`}>{idleLabel}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {wasNudged ? (
                            <span className="text-xs text-green-600 font-medium">✓ Nudge sent</span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 text-xs"
                              disabled={isNudging}
                              onClick={() => handleNudge(s.id)}
                            >
                              <Mail size={13} />
                              {isNudging ? "Sending…" : "Send Nudge"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:bg-destructive/10 border-destructive/30"
                            onClick={() => setDeleteTarget({ id: s.id, email: s.email })}
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t text-xs text-muted-foreground">
              Showing {filtered.length} of {(sessions as any[]).length} abandoned sign-ups
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete abandoned session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the sign-up session for <strong>{deleteTarget?.email}</strong>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteSession.mutate({ sessionId: deleteTarget.id })}
              disabled={deleteSession.isPending}
            >
              {deleteSession.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function RecruitmentPipeline() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Agent Recruitment</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage prospects, sign-up applications, and abandoned sign-ups in one place
          </p>
        </div>
        <a
          href="/apply"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#02E6D2] hover:bg-[#02E6D2]/90 text-[#1a1a1a] font-semibold text-sm transition-colors"
        >
          <ExternalLink size={14} />
          View Enquiry Form
        </a>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="prospects">
        <TabsList className="mb-6">
          <TabsTrigger value="prospects">Prospects Pipeline</TabsTrigger>
          <TabsTrigger value="applications">Sign-Up Applications</TabsTrigger>
          <TabsTrigger value="abandoned">Abandoned Sign-Ups</TabsTrigger>
        </TabsList>

        <TabsContent value="prospects">
          <ProspectsPipelineTab />
        </TabsContent>

        <TabsContent value="applications">
          <SignUpApplicationsTab />
        </TabsContent>

        <TabsContent value="abandoned">
          <AbandonedSignUpsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
