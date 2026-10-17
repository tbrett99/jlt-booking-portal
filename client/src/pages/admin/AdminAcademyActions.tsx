import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, Clock3, Eye, FileUp, Link2, Plus, Send, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type MomentumAwardMode = "off" | "self_declared_completion" | "reviewed_completion";

const blank = {
  title: "",
  instructions: "",
  actionType: "weekly" as "onboarding" | "weekly" | "ad_hoc",
  audience: "agent_accelerator" as "agent_accelerator" | "selected_agents" | "all_agents",
  assignmentTrigger: "immediate" as "immediate" | "on_accelerator_entry",
  publishAt: "",
  dueAt: "",
  requiresNote: true,
  requiresUrl: false,
  requiresUpload: false,
  staffReviewRequired: false,
  momentumAwardMode: "off" as MomentumAwardMode,
  momentumPoints: 0,
  targetAgentIds: [] as number[],
};

function dateTimeForInput(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function formatDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}
function toDate(value: string) { return value ? new Date(value) : null; }

export default function AdminAcademyActions() {
  const utils = trpc.useUtils();
  const { data: plans = [], isLoading } = trpc.agentDevelopment.admin.actionPlans.useQuery();
  const { data: agents = [] } = trpc.users.listAgents.useQuery();
  const [draft, setDraft] = useState(blank);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const { data: assignments = [] } = trpc.agentDevelopment.admin.actionAssignments.useQuery({ planId: selectedPlanId ?? 0 }, { enabled: !!selectedPlanId });
  const save = trpc.agentDevelopment.admin.saveActionPlan.useMutation({
    onSuccess: () => {
      toast.success(draft.publishAt && new Date(draft.publishAt) > new Date() ? "Academy action scheduled" : "Academy action saved as a draft");
      setDraft(blank);
      utils.agentDevelopment.admin.actionPlans.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const publish = trpc.agentDevelopment.admin.publishActionPlan.useMutation({
    onSuccess: (result) => { toast.success(`Published and assigned to ${result.created} agent${result.created === 1 ? "" : "s"}`); utils.agentDevelopment.admin.actionPlans.invalidate(); },
    onError: (error) => toast.error(error.message),
  });
  const archive = trpc.agentDevelopment.admin.archiveActionPlan.useMutation({ onSuccess: () => { toast.success("Action archived"); utils.agentDevelopment.admin.actionPlans.invalidate(); }, onError: (error) => toast.error(error.message) });
  const review = trpc.agentDevelopment.admin.reviewAction.useMutation({ onSuccess: () => { toast.success("Action review recorded"); if (selectedPlanId) utils.agentDevelopment.admin.actionAssignments.invalidate({ planId: selectedPlanId }); utils.agentDevelopment.admin.actionPlans.invalidate(); }, onError: (error) => toast.error(error.message) });
  const agentOptions = useMemo(() => agents.filter((agent) => agent.role === "agent").sort((a, b) => (a.name || "").localeCompare(b.name || "")), [agents]);
  const currentWeek = useMemo(() => {
    const today = new Date();
    const day = today.getDay() || 7;
    const monday = new Date(today); monday.setDate(today.getDate() - day + 1); monday.setHours(8, 0, 0, 0);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); sunday.setHours(20, 0, 0, 0);
    return { monday: dateTimeForInput(monday), sunday: dateTimeForInput(sunday) };
  }, []);

  function savePlan() { save.mutate({ ...draft, publishAt: toDate(draft.publishAt), dueAt: toDate(draft.dueAt) }); }
  function toggleAgent(agentId: number, checked: boolean) {
    setDraft((current) => ({ ...current, targetAgentIds: checked ? [...current.targetAgentIds, agentId] : current.targetAgentIds.filter((id) => id !== agentId) }));
  }
  function newWeeklyPlan() { setDraft({ ...blank, actionType: "weekly", audience: "agent_accelerator", publishAt: currentWeek.monday, dueAt: currentWeek.sunday }); }
  function setStaffReview(staffReviewRequired: boolean) {
    setDraft((current) => ({ ...current, staffReviewRequired, momentumAwardMode: current.momentumAwardMode === "off" ? "off" : staffReviewRequired ? "reviewed_completion" : "self_declared_completion" }));
  }
  function toggleMomentum(enabled: boolean) {
    setDraft((current) => ({ ...current, momentumAwardMode: enabled ? (current.staffReviewRequired ? "reviewed_completion" : "self_declared_completion") : "off", momentumPoints: enabled && current.momentumPoints < 1 ? 10 : current.momentumPoints }));
  }

  if (isLoading) return <div className="space-y-5 animate-pulse"><div className="h-28 rounded-3xl bg-muted" /><div className="h-[520px] rounded-2xl bg-muted" /></div>;

  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="rounded-3xl border border-[#70FFE8]/45 bg-gradient-to-r from-[#414141] to-[#2d3534] p-6 text-white shadow-sm md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><div className="flex items-center gap-2 text-sm font-semibold text-[#70FFE8]"><ClipboardCheck size={18} /> Academy Actions</div><h1 className="mt-2 text-3xl font-bold tracking-tight">Create the habits that grow an agent&apos;s business.</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-white/75">Set one-off onboarding actions, publish two focused Accelerator actions per week, or coach selected agents with evidence and staff review where it matters.</p></div>
        <Button onClick={newWeeklyPlan} className="bg-[#70FFE8] text-[#27302e] hover:bg-[#8cffef]"><Plus className="mr-2" size={17} /> New weekly action</Button>
      </div>
    </header>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-5">
        <Card>
          <CardHeader><CardTitle className="text-xl">Create an Academy action</CardTitle><p className="text-sm text-muted-foreground">Draft first, then publish immediately or schedule it for Monday. New Accelerator agents receive entry actions only — not a backlog of weekly tasks.</p></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2"><div><Label>Action title</Label><Input className="mt-1.5" value={draft.title} placeholder="e.g. Share your first introduction reel" onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></div><div><Label>Action type</Label><select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.actionType} onChange={(event) => { const actionType = event.target.value as typeof draft.actionType; setDraft({ ...draft, actionType, audience: actionType === "onboarding" ? "agent_accelerator" : draft.audience, assignmentTrigger: actionType === "onboarding" ? "on_accelerator_entry" : "immediate", publishAt: actionType === "onboarding" ? "" : draft.publishAt }); }}><option value="onboarding">Accelerator entry action</option><option value="weekly">Weekly Accelerator action</option><option value="ad_hoc">Ad-hoc coaching action</option></select></div></div>
            <div><Label>Instructions</Label><Textarea className="mt-1.5" rows={6} value={draft.instructions} placeholder="Give clear, practical instructions and define what good evidence looks like." onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></div>
            <div className="grid gap-4 md:grid-cols-2"><div><Label>Audience</Label><select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.audience} disabled={draft.actionType === "onboarding"} onChange={(event) => setDraft({ ...draft, audience: event.target.value as typeof draft.audience })}><option value="agent_accelerator">Agent Accelerator</option><option value="selected_agents">Selected agents</option><option value="all_agents">All active agents</option></select></div><div><Label>Assignment timing</Label><select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.assignmentTrigger} disabled={draft.actionType === "weekly" || draft.audience !== "agent_accelerator"} onChange={(event) => setDraft({ ...draft, assignmentTrigger: event.target.value as typeof draft.assignmentTrigger })}><option value="immediate">Assign when published</option><option value="on_accelerator_entry">Only when an agent enters Accelerator</option></select></div></div>
            {draft.audience === "selected_agents" && <div className="rounded-xl border bg-muted/20 p-4"><p className="text-sm font-semibold">Choose agents</p><div className="mt-3 grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">{agentOptions.map((agent) => <label key={agent.id} className="flex items-center gap-2 text-sm"><Checkbox checked={draft.targetAgentIds.includes(agent.id)} onCheckedChange={(checked) => toggleAgent(agent.id, checked === true)} />{agent.name || agent.email}</label>)}</div></div>}
            <div className="grid gap-4 md:grid-cols-2"><div><Label>Publish from</Label><Input className="mt-1.5" type="datetime-local" value={draft.publishAt} onChange={(event) => setDraft({ ...draft, publishAt: event.target.value })} disabled={draft.assignmentTrigger === "on_accelerator_entry"} /></div><div><Label>Due by</Label><Input className="mt-1.5" type="datetime-local" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></div></div>
            <div className="grid gap-3 rounded-xl border bg-muted/15 p-4 md:grid-cols-2"><label className="flex items-start gap-2 text-sm"><Checkbox checked={draft.requiresNote} onCheckedChange={(checked) => setDraft({ ...draft, requiresNote: checked === true })} /><span><b>Completion notes</b><span className="block text-xs text-muted-foreground">Ask agents to reflect on what they did.</span></span></label><label className="flex items-start gap-2 text-sm"><Checkbox checked={draft.requiresUrl} onCheckedChange={(checked) => setDraft({ ...draft, requiresUrl: checked === true })} /><span><b>URL evidence</b><span className="block text-xs text-muted-foreground">For a live reel, post or web page.</span></span></label><label className="flex items-start gap-2 text-sm"><Checkbox checked={draft.requiresUpload} onCheckedChange={(checked) => setDraft({ ...draft, requiresUpload: checked === true })} /><span><b>File upload</b><span className="block text-xs text-muted-foreground">Accept a PDF, JPG or PNG.</span></span></label><label className="flex items-start gap-2 text-sm"><Checkbox checked={draft.staffReviewRequired} onCheckedChange={(checked) => setStaffReview(checked === true)} /><span><b>Staff review</b><span className="block text-xs text-muted-foreground">Otherwise the agent&apos;s declaration completes it.</span></span></label></div>
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4"><div className="flex items-start gap-3"><Sparkles className="mt-0.5 shrink-0 text-violet-700" size={19} /><div className="min-w-0 flex-1"><label className="flex cursor-pointer items-start gap-2 text-sm"><Checkbox checked={draft.momentumAwardMode !== "off"} onCheckedChange={(checked) => toggleMomentum(checked === true)} /><span><b>Reward this action with JLT Momentum</b><span className="mt-0.5 block text-xs text-muted-foreground">No extra admin queue: points are awarded automatically on the completion rule selected below.</span></span></label>{draft.momentumAwardMode !== "off" && <div className="mt-3 grid gap-3 sm:grid-cols-2"><div><Label className="text-xs">Award trigger</Label><select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={draft.momentumAwardMode} onChange={(event) => { const mode = event.target.value as MomentumAwardMode; setDraft({ ...draft, momentumAwardMode: mode, staffReviewRequired: mode === "reviewed_completion" }); }}><option value="self_declared_completion">When the agent completes it</option><option value="reviewed_completion">When staff approves it</option></select></div><div><Label className="text-xs">Momentum Points</Label><Input className="mt-1 h-9" type="number" min={1} max={1000} value={draft.momentumPoints} onChange={(event) => setDraft({ ...draft, momentumPoints: Math.max(0, Number(event.target.value) || 0) })} /></div></div>}</div></div></div>
            <div className="flex justify-end"><Button disabled={save.isPending || !draft.title.trim() || !draft.instructions.trim()} onClick={savePlan}>{save.isPending ? "Saving…" : draft.publishAt && new Date(draft.publishAt) > new Date() ? "Schedule action" : "Save draft"}</Button></div>
          </CardContent>
        </Card>

        <Card><CardHeader><CardTitle className="text-xl">Action plans</CardTitle><p className="text-sm text-muted-foreground">Open a plan to inspect submissions and review evidence where required.</p></CardHeader><CardContent>{plans.length ? <div className="divide-y">{plans.map((plan: any) => <div key={plan.id} className="py-4 first:pt-0"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap gap-2"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${plan.status === "published" ? "bg-emerald-100 text-emerald-800" : plan.status === "scheduled" ? "bg-blue-100 text-blue-800" : plan.status === "archived" ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-800"}`}>{plan.status}</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{plan.actionType.replace("_", " ")}</span>{plan.momentumAwardMode !== "off" && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">✦ {plan.momentumPoints} Momentum</span>}</div><h3 className="mt-2 font-bold">{plan.title}</h3><p className="mt-1 text-sm text-muted-foreground">{plan.audience.replaceAll("_", " ")} · due {formatDate(plan.dueAt)}</p><div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground"><span><UsersRound className="mr-1 inline" size={13} />{plan.counts.assigned} assigned</span><span><CheckCircle2 className="mr-1 inline" size={13} />{plan.counts.completed} complete</span>{plan.counts.awaitingReview > 0 && <span className="font-semibold text-amber-700"><Clock3 className="mr-1 inline" size={13} />{plan.counts.awaitingReview} to review</span>}</div></div><div className="flex shrink-0 gap-2"><Button variant="outline" size="sm" onClick={() => setSelectedPlanId(plan.id)}><Eye className="mr-1" size={15} /> View</Button>{plan.status === "draft" || plan.status === "scheduled" ? <Button size="sm" onClick={() => publish.mutate({ planId: plan.id })} disabled={publish.isPending}><Send className="mr-1" size={15} /> Publish</Button> : plan.status !== "archived" ? <Button variant="ghost" size="sm" className="text-destructive" onClick={() => window.confirm("Archive this action plan? Existing submissions will be retained.") && archive.mutate({ planId: plan.id })}>Archive</Button> : null}</div></div></div>)}</div> : <p className="py-8 text-center text-sm text-muted-foreground">No action plans yet.</p>}</CardContent></Card>
      </section>
      <aside className="h-fit space-y-4 xl:sticky xl:top-6"><Card><CardContent className="p-5"><p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">Delivery rules</p><div className="mt-4 space-y-4 text-sm"><div className="flex gap-3"><ClipboardCheck className="shrink-0 text-[#00c9b4]" size={19} /><p><strong>Two focused actions each week.</strong><br /><span className="text-muted-foreground">Publish Monday morning, due Sunday evening.</span></p></div><div className="flex gap-3"><ShieldCheck className="shrink-0 text-[#00c9b4]" size={19} /><p><strong>Self-declaration by default.</strong><br /><span className="text-muted-foreground">Turn on staff review only when evidence needs checking.</span></p></div><div className="flex gap-3"><Sparkles className="shrink-0 text-violet-700" size={19} /><p><strong>Momentum is optional and rule-based.</strong><br /><span className="text-muted-foreground">Choose the exact points and completion trigger for each action.</span></p></div><div className="flex gap-3"><UsersRound className="shrink-0 text-[#00c9b4]" size={19} /><p><strong>New Accelerator agents start simply.</strong><br /><span className="text-muted-foreground">They get an entry action, not an immediate backlog.</span></p></div></div></CardContent></Card>{selectedPlanId && <Card><CardHeader><CardTitle className="text-base">Assignments</CardTitle></CardHeader><CardContent>{assignments.length ? <div className="space-y-4">{assignments.map((row: any) => <div key={row.assignment.id} className="rounded-xl border p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-sm">{row.agent.name || row.agent.email}</p><p className="text-xs text-muted-foreground">{row.assignment.status.replace("_", " ")}</p></div>{row.assignment.status === "review" && <div className="flex gap-1"><Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700" onClick={() => review.mutate({ assignmentId: row.assignment.id, outcome: "completed", feedback: null })}>Approve</Button><Button size="sm" variant="outline" className="h-7" onClick={() => { const feedback = window.prompt("What should the agent update?"); if (feedback?.trim()) review.mutate({ assignmentId: row.assignment.id, outcome: "needs_revision", feedback }); }}>Revise</Button></div>}</div>{row.assignment.completionNote && <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{row.assignment.completionNote}</p>}{row.assignment.evidenceUrl && <a href={row.assignment.evidenceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><Link2 size={13} /> Open link</a>}{row.assignment.evidenceFileUrl && <a href={row.assignment.evidenceFileUrl} target="_blank" rel="noreferrer" className="mt-2 ml-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><FileUp size={13} /> Evidence</a>}</div>)}</div> : <p className="text-sm text-muted-foreground">No assignments yet.</p>}</CardContent></Card>}</aside>
    </div>
  </div>;
}
