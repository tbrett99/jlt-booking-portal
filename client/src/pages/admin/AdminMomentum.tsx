import { useState } from "react";
import { Award, ChevronDown, ChevronUp, Power, Sparkles, Trophy, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const AREA_COLOURS: Record<string, string> = {
  Community: "border-sky-200 bg-sky-50 text-sky-900",
  "Accountability Tasks": "border-violet-200 bg-violet-50 text-violet-900",
  "Knowledge Base": "border-amber-200 bg-amber-50 text-amber-900",
  Webinars: "border-rose-200 bg-rose-50 text-rose-900",
  Events: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

function formatDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}

export default function AdminMomentum() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.momentum.adminDashboard.useQuery();
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const updateRule = trpc.momentum.updateRule.useMutation({
    onSuccess: () => { toast.success("Momentum rule updated"); utils.momentum.adminDashboard.invalidate(); },
    onError: (error) => toast.error(error.message),
  });
  const reverse = trpc.momentum.reverseEntry.useMutation({
    onSuccess: () => { toast.success("Momentum award reversed"); utils.momentum.adminDashboard.invalidate(); },
    onError: (error) => toast.error(error.message),
  });

  if (isLoading) return <div className="space-y-5 animate-pulse"><div className="h-32 rounded-3xl bg-muted" /><div className="h-64 rounded-2xl bg-muted" /></div>;
  const rules = data?.rules ?? [];
  const leaderboard = data?.leaderboard ?? [];
  const recent = data?.recent ?? [];
  const activeRules = rules.filter((rule) => Boolean(rule.enabled)).length;

  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="overflow-hidden rounded-3xl border border-violet-200 bg-gradient-to-r from-[#2b2540] via-[#453165] to-[#6d4ca0] p-6 text-white shadow-sm md:p-8">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between"><div><div className="flex items-center gap-2 text-sm font-semibold text-violet-100"><Sparkles size={18} /> JLT Momentum</div><h1 className="mt-2 text-3xl font-bold tracking-tight">Configure the habits you want to celebrate.</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-violet-100/85">Momentum awards verified Portal activity automatically. Turn areas on or off, set points and guardrails, then use the ledger only for exceptional reversals.</p></div><div className="grid grid-cols-2 gap-3"><div className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur"><p className="text-2xl font-bold">{activeRules}</p><p className="text-xs text-violet-100">active reward rules</p></div><div className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur"><p className="text-2xl font-bold">{leaderboard.length}</p><p className="text-xs text-violet-100">agents with points this month</p></div></div></div>
    </header>

    <section><div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-xl font-bold">Reward rules</h2><p className="text-sm text-muted-foreground">Each rule includes its own criteria. Disabled rules remain visible so you can stage future areas without awarding points early.</p></div></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rules.map((rule: any) => { const expanded = expandedRule === rule.ruleKey; return <Card key={rule.ruleKey} className={`overflow-hidden border ${rule.enabled ? AREA_COLOURS[rule.area] ?? "border-border bg-card" : "border-border bg-card opacity-85"}`}><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><div><Badge variant="outline" className="bg-white/70 text-[10px] font-bold uppercase tracking-wide">{rule.area}</Badge><h3 className="mt-2 font-bold leading-snug">{rule.label}</h3></div><button onClick={() => setExpandedRule(expanded ? null : rule.ruleKey)} className="rounded-lg p-1.5 hover:bg-white/60" aria-label={`View ${rule.label} criteria`}>{expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button></div><p className="mt-2 text-xs leading-5 opacity-80">{rule.description}</p>{expanded && <div className="mt-4 space-y-3 rounded-xl border border-black/10 bg-white/60 p-3"><label className="flex items-center justify-between gap-3 text-sm font-semibold"><span>Reward enabled</span><Checkbox checked={Boolean(rule.enabled)} onCheckedChange={(checked) => updateRule.mutate({ ruleKey: rule.ruleKey, enabled: checked === true, points: Number(rule.points), weeklyCap: Number(rule.weeklyCap), minimumTextLength: Number(rule.minimumTextLength) })} /></label><div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Points</Label><Input className="mt-1 h-8 bg-white" type="number" min={0} max={1000} defaultValue={rule.points} onBlur={(event) => updateRule.mutate({ ruleKey: rule.ruleKey, enabled: Boolean(rule.enabled), points: Number(event.target.value) || 0, weeklyCap: Number(rule.weeklyCap), minimumTextLength: Number(rule.minimumTextLength) })} /></div><div><Label className="text-xs">Weekly cap</Label><Input className="mt-1 h-8 bg-white" type="number" min={0} max={10000} defaultValue={rule.weeklyCap} onBlur={(event) => updateRule.mutate({ ruleKey: rule.ruleKey, enabled: Boolean(rule.enabled), points: Number(rule.points), weeklyCap: Number(event.target.value) || 0, minimumTextLength: Number(rule.minimumTextLength) })} /></div></div>{rule.ruleKey === "community_comment" && <div><Label className="text-xs">Minimum comment length</Label><Input className="mt-1 h-8 bg-white" type="number" min={0} max={2000} defaultValue={rule.minimumTextLength} onBlur={(event) => updateRule.mutate({ ruleKey: rule.ruleKey, enabled: Boolean(rule.enabled), points: Number(rule.points), weeklyCap: Number(rule.weeklyCap), minimumTextLength: Number(event.target.value) || 0 })} /><p className="mt-1 text-[11px] text-muted-foreground">A first comment per post only. Set to 0 if length should not matter.</p></div>}</div>}<div className="mt-4 flex items-center justify-between border-t border-black/10 pt-3 text-xs font-semibold"><span className="inline-flex items-center gap-1"><Power size={13} /> {rule.enabled ? "Live" : "Off"}</span><span>{rule.points} point{Number(rule.points) === 1 ? "" : "s"}{Number(rule.weeklyCap) > 0 ? ` · cap ${rule.weeklyCap}/week` : ""}</span></div></CardContent></Card>; })}</div></section>

    <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Trophy className="text-amber-500" size={19} /> Momentum this month</CardTitle><p className="text-sm text-muted-foreground">A positive snapshot for staff. It is not published as a competitive agent leaderboard.</p></CardHeader><CardContent>{leaderboard.length ? <ol className="space-y-3">{leaderboard.map((agent: any, index: number) => <li key={agent.agentId} className="flex items-center gap-3 rounded-xl bg-muted/50 p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-800">{index + 1}</span><span className="min-w-0 flex-1 truncate text-sm font-semibold">{agent.agentName}</span><span className="text-sm font-bold text-violet-800">{agent.points} pts</span></li>)}</ol> : <p className="py-8 text-center text-sm text-muted-foreground">No Momentum points awarded this month yet.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Award className="text-violet-700" size={19} /> Momentum ledger</CardTitle><p className="text-sm text-muted-foreground">Automatic awards are visible here for audit. Reverse only when an activity was removed or incorrectly rewarded.</p></CardHeader><CardContent>{recent.length ? <div className="divide-y">{recent.map((entry: any) => <div key={entry.id} className="flex items-center gap-3 py-3 first:pt-0"><div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${entry.status === "awarded" ? "bg-violet-100 text-violet-800" : "bg-red-100 text-red-700"}`}>{entry.status === "awarded" ? <Sparkles size={15} /> : <Undo2 size={15} />}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{entry.agentName} <span className="font-normal text-muted-foreground">· {entry.sourceLabel}</span></p><p className="mt-0.5 text-xs text-muted-foreground">{entry.ruleKey.replaceAll("_", " ")} · {formatDate(entry.awardedAt)}{entry.reversalReason ? ` · ${entry.reversalReason}` : ""}</p></div><div className="flex shrink-0 items-center gap-2"><span className={`text-sm font-bold ${entry.status === "awarded" ? "text-violet-800" : "text-red-700"}`}>{entry.status === "awarded" ? "+" : "−"}{entry.points}</span>{entry.status === "awarded" && <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Reverse award" disabled={reverse.isPending} onClick={() => { const reason = window.prompt("Reason for reversing this Momentum award:"); if (reason?.trim()) reverse.mutate({ agentId: entry.agentId, sourceType: entry.sourceType, sourceId: entry.sourceId, reason: reason.trim() }); }}><Undo2 size={14} /></Button>}</div></div>)}</div> : <p className="py-8 text-center text-sm text-muted-foreground">No Momentum activity yet.</p>}</CardContent></Card>
    </section>
  </div>;
}
