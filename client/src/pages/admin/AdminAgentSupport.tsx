import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Bot, BookOpen, CheckCircle2, ExternalLink, Gauge, MessageCircleQuestion, RefreshCw, ShieldCheck, ThumbsDown, ThumbsUp } from "lucide-react";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

const SUGGESTED_PROMPTS = [
  "Where can I find guidance on a supplier?",
  "What does the Academy say about client data?",
  "What is the process described in the Knowledge Base for a booking amendment?",
  "Which recorded webinar covers business development?",
];

type Citation = {
  key: string;
  kind: string;
  title: string;
  href: string;
  label: string;
  timestampLabel: string | null;
  updatedAt: Date | string | null;
};

type AnswerMeta = {
  messageId: number;
  sources: Citation[];
  status: "answered" | "insufficient_sources" | "failed";
};

function labelForSourceKind(kind: string) {
  return {
    knowledge_base: "Knowledge Base",
    webinar: "Webinar",
    academy: "JLT Academy",
    supplier: "Supplier Directory",
    community: "Community update",
    policy: "Terms & Policies",
  }[kind] ?? kind;
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="rounded-xl border bg-background/70 p-3"><p className="text-xl font-bold tabular-nums">{value}</p><p className="mt-0.5 text-xs text-muted-foreground">{label}</p></div>;
}

export default function AdminAgentSupport() {
  const utils = trpc.useUtils();
  const overview = trpc.agentSupport.overview.useQuery();
  const [conversationId, setConversationId] = useState<number | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [latestAnswer, setLatestAnswer] = useState<AnswerMeta | null>(null);
  const [feedbackGiven, setFeedbackGiven] = useState<"helpful" | "not_helpful" | null>(null);

  const ask = trpc.agentSupport.ask.useMutation({
    onSuccess: async (result) => {
      setConversationId(result.conversationId);
      setMessages((current) => [...current, { role: "assistant", content: result.answer }]);
      setLatestAnswer({ messageId: result.messageId, sources: result.sources, status: result.status });
      setFeedbackGiven(null);
      await utils.agentSupport.overview.invalidate();
    },
    onError: (error) => {
      setMessages((current) => current.slice(0, -1));
      toast.error(error.message);
    },
  });

  const feedback = trpc.agentSupport.feedback.useMutation({
    onSuccess: async (_result, variables) => {
      setFeedbackGiven(variables.rating);
      toast.success("Feedback recorded for the pilot review.");
      await utils.agentSupport.overview.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const sourceCards = useMemo(() => {
    if (!overview.data) return [];
    return Object.entries(overview.data.sourceCounts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, count]) => ({ kind, count }));
  }, [overview.data]);

  const submitQuestion = (question: string) => {
    setMessages((current) => [...current, { role: "user", content: question }]);
    ask.mutate({ question, conversationId });
  };

  const startNewConversation = () => {
    setConversationId(undefined);
    setMessages([]);
    setLatestAnswer(null);
    setFeedbackGiven(null);
  };

  if (overview.isLoading) {
    return <div className="mx-auto max-w-7xl space-y-5 animate-pulse"><div className="h-48 rounded-3xl bg-muted" /><div className="h-[600px] rounded-3xl bg-muted" /></div>;
  }

  if (overview.isError || !overview.data) {
    return <div className="mx-auto max-w-3xl rounded-2xl border border-destructive/30 bg-destructive/5 p-6"><h1 className="text-xl font-bold">AI Support Pilot is not ready yet</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">The Portal could not load the assistant’s audit and retention records. Nothing has been sent to an AI model. {overview.error?.message}</p><Button className="mt-5 gap-2" onClick={() => overview.refetch()} disabled={overview.isFetching}>{overview.isFetching ? <RefreshCw className="animate-spin" size={15} /> : <RefreshCw size={15} />} Try again</Button></div>;
  }

  const { metrics } = overview.data;
  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="overflow-hidden rounded-3xl border border-cyan-200 bg-gradient-to-r from-slate-950 via-slate-800 to-cyan-900 p-6 text-white shadow-sm md:p-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl"><div className="flex items-center gap-2 text-sm font-semibold text-cyan-100"><Bot size={18} /> Controlled AI support pilot</div><h1 className="mt-2 text-3xl font-bold tracking-tight">JLT Support Assistant</h1><p className="mt-2 text-sm leading-6 text-cyan-50/85">Admin and Super Admin only. It answers from current approved Portal content, links the exact source, and refuses when the evidence is not there. It cannot search the web, access operational records or take action.</p></div>
        <div className="flex flex-wrap gap-2"><Badge className="border border-cyan-200/30 bg-cyan-300/15 px-3 py-1.5 text-cyan-50">Admin pilot</Badge><Badge className="border border-cyan-200/30 bg-cyan-300/15 px-3 py-1.5 text-cyan-50">Fresh retrieval per question</Badge></div>
      </div>
    </header>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <main className="space-y-4">
        <Card className="overflow-hidden"><CardHeader className="border-b bg-muted/25"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><MessageCircleQuestion className="text-primary" size={20} /> Ask a question</CardTitle><p className="mt-1 text-sm text-muted-foreground">Try normal agent questions and check the answer, source links and refusal behaviour before agent rollout.</p></div><Button variant="outline" size="sm" onClick={startNewConversation} disabled={ask.isPending}>New conversation</Button></div></CardHeader><CardContent className="p-0"><AIChatBox messages={messages} onSendMessage={submitQuestion} isLoading={ask.isPending} height="570px" placeholder="Ask about approved Portal guidance…" emptyStateMessage="Ask a practical agent-support question to start the pilot." suggestedPrompts={SUGGESTED_PROMPTS} /></CardContent></Card>

        {latestAnswer ? <Card className="border-cyan-200"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><BookOpen className="text-cyan-700" size={18} /> Sources used for this answer</CardTitle><p className="text-sm text-muted-foreground">These are the only source records supplied to the model for the answer above.</p></CardHeader><CardContent className="space-y-3">{latestAnswer.sources.length ? <div className="grid gap-2">{latestAnswer.sources.map((source) => <a key={source.key} href={source.href} target="_blank" rel="noreferrer" className="group flex items-start justify-between gap-3 rounded-xl border bg-card p-3 transition hover:border-primary/50 hover:bg-muted/30"><span><span className="text-xs font-semibold text-primary">{labelForSourceKind(source.kind)}</span><span className="mt-0.5 block text-sm font-semibold group-hover:underline">{source.title}</span>{source.timestampLabel ? <span className="mt-1 block text-xs text-muted-foreground">{source.timestampLabel}</span> : null}</span><ExternalLink className="mt-1 shrink-0 text-muted-foreground" size={16} /></a>)}</div> : <div className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">No approved source was sufficiently relevant, so the assistant gave the standard support escalation instead.</div>}<div className="flex flex-wrap items-center gap-2 border-t pt-3"><span className="mr-1 text-sm text-muted-foreground">Was this answer useful?</span><Button size="sm" variant={feedbackGiven === "helpful" ? "default" : "outline"} disabled={feedback.isPending} onClick={() => feedback.mutate({ messageId: latestAnswer.messageId, rating: "helpful" })}><ThumbsUp size={14} /> Helpful</Button><Button size="sm" variant={feedbackGiven === "not_helpful" ? "default" : "outline"} disabled={feedback.isPending} onClick={() => feedback.mutate({ messageId: latestAnswer.messageId, rating: "not_helpful" })}><ThumbsDown size={14} /> Needs work</Button></div></CardContent></Card> : null}
      </main>

      <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <Card className="border-emerald-200 bg-emerald-50/50"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base text-emerald-950"><ShieldCheck size={18} /> Guardrails on</CardTitle></CardHeader><CardContent><ul className="space-y-2 text-sm leading-5 text-emerald-950/85"><li>Only approved, agent-facing text is retrieved.</li><li>No public web search, tools or Portal actions.</li><li>No booking, client, money, email or private record access.</li><li>Every answer must link its source or escalate.</li></ul></CardContent></Card>
        <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Gauge size={18} className="text-primary" /> Pilot coverage</CardTitle><p className="text-xs leading-5 text-muted-foreground">Fresh source query on every question. Conversation questions, answers, cited source references and feedback are held for {overview.data.retentionDays} days for quality review.</p></CardHeader><CardContent className="grid grid-cols-2 gap-2">{sourceCards.map((source) => <Metric key={source.kind} value={source.count} label={labelForSourceKind(source.kind)} />)}</CardContent></Card>
        <Card><CardHeader className="pb-3"><CardTitle className="text-base">Last 30 days</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-2"><Metric value={metrics.questions} label="questions" /><Metric value={metrics.answered} label="grounded answers" /><Metric value={metrics.unresolved} label="content gaps" /><Metric value={metrics.helpful + metrics.notHelpful} label="feedback votes" /></CardContent></Card>
        <Card className="border-amber-200 bg-amber-50/60"><CardContent className="p-4 text-sm leading-6 text-amber-950"><strong>Trial discipline:</strong> test 20–50 real questions, including questions that should be refused. Add or improve an approved source when a refusal reveals a genuine content gap; do not teach the model from a one-off chat reply.</CardContent></Card>
      </aside>
    </div>
  </div>;
}
