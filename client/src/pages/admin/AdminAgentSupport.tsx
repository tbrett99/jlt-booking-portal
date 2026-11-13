import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Bot, ExternalLink, Gauge, MessageCircleQuestion, RefreshCw, ShieldCheck, ThumbsDown, ThumbsUp } from "lucide-react";
import { AIChatBox } from "@/components/AIChatBox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { SUPPORT_DISPOSITION_LABELS, SUPPORT_VALIDATION_DIAGNOSTIC_LABELS, type SupportConversationMessage } from "@shared/agent-support-pilot";
import { isSafeSupportHref, readSupportValidationDiagnostic } from "@shared/agent-support-metadata";

const SUGGESTED_PROMPTS = [
  "Where can I find guidance on a supplier?",
  "What is the process for requesting reimbursement?",
  "What is the process described in the Knowledge Base for a booking amendment?",
  "Which recorded webinar covers business development?",
];

const SOURCE_KINDS = ["knowledge_base", "academy", "webinar", "supplier", "community", "policy", "portal_procedure"] as const;

function labelForSourceKind(kind: string) {
  return {
    knowledge_base: "Knowledge Base", webinar: "Webinar", academy: "JLT Academy",
    supplier: "Supplier Directory", community: "Community update", policy: "Terms & Policies",
    portal_procedure: "Portal procedure",
  }[kind] ?? kind;
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="rounded-xl border bg-background/70 p-3"><p className="text-xl font-bold tabular-nums">{value}</p><p className="mt-0.5 text-xs text-muted-foreground">{label}</p></div>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}

export default function AdminAgentSupport() {
  const utils = trpc.useUtils();
  const overview = trpc.agentSupport.overview.useQuery();
  const conversations = trpc.agentSupport.conversations.useQuery();
  const [showGaps, setShowGaps] = useState(false);
  const gaps = trpc.agentSupport.recentGaps.useQuery(undefined, { enabled: showGaps });
  const [conversationId, setConversationId] = useState<number | undefined>();
  const [messages, setMessages] = useState<SupportConversationMessage[]>([]);
  const [askBusy, setAskBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const askLock = useRef(false);
  const feedbackLock = useRef(false);
  const historyLock = useRef(false);
  const optimisticId = useRef(-1);
  const ask = trpc.agentSupport.ask.useMutation();
  const feedback = trpc.agentSupport.feedback.useMutation();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);

  const sourceCards = useMemo(() => {
    if (!overview.data) return [];
    return SOURCE_KINDS.map(kind => ({ kind, count: overview.data.sourceCounts[kind] ?? 0 }));
  }, [overview.data]);

  // Saving a turn or feedback and refreshing audit queries are separate outcomes.
  // A refresh failure must not roll back a successfully saved, screened answer.
  const refreshAudit = (epoch: number) => {
    void Promise.all([
      utils.agentSupport.overview.invalidate(),
      utils.agentSupport.conversations.invalidate(),
      utils.agentSupport.recentGaps.invalidate(),
    ]).catch(() => {
      if (mounted.current && epoch === generation.current) {
        setRefreshWarning("Saved successfully, but the pilot summary could not refresh. Your conversation is unchanged.");
      }
    });
  };

  const submitQuestion = async (input: string) => {
    const question = input.trim();
    if (!question || askLock.current || historyLock.current || feedbackLock.current || historyError) return;
    askLock.current = true;
    setAskBusy(true);
    setRefreshWarning(null);
    const epoch = generation.current;
    const id = optimisticId.current--;
    setMessages(current => [...current, {
      id, role: "user", content: question, createdAt: new Date(), sources: [],
      disposition: "clarify", verified: false, feedback: null,
    }]);
    try {
      const result = await ask.mutateAsync({ question, conversationId });
      if (!mounted.current || epoch !== generation.current) return;
      setConversationId(result.conversationId);
      setMessages(current => [...current.map(message => message.id === id ? {
        ...message, id: result.userMessageId,
        // Never retain the optimistic raw input after a successful screened response.
        content: typeof result.question === "string" ? result.question : "[Question unavailable.]",
      } : message), {
        id: result.messageId, role: "assistant", content: result.answer, createdAt: new Date(),
        sources: result.sources, disposition: result.disposition, verified: result.verified, feedback: null,
        validationDiagnostic: result.disposition === "validation_failed" && result.status !== "answered"
          ? readSupportValidationDiagnostic(result.validationDiagnostic) : null,
      }]);
      refreshAudit(epoch);
    } catch (error) {
      if (!mounted.current || epoch !== generation.current) return;
      setMessages(current => current.filter(message => message.id !== id));
      toast.error(errorMessage(error));
    } finally {
      askLock.current = false;
      if (mounted.current && epoch === generation.current) setAskBusy(false);
    }
  };

  const startNewConversation = () => {
    if (askLock.current || feedbackLock.current || historyLock.current) return;
    // Invalidates any obsolete reads from the previous view.
    generation.current += 1;
    historyLock.current = false;
    setHistoryBusy(false);
    setHistoryError(null);
    setRefreshWarning(null);
    setConversationId(undefined);
    setMessages([]);
  };

  const resumeConversation = async (id: number) => {
    if (askLock.current || feedbackLock.current || historyLock.current) return;
    const epoch = ++generation.current;
    historyLock.current = true;
    setHistoryBusy(true);
    setHistoryError(null);
    setRefreshWarning(null);
    setConversationId(id);
    setMessages([]); // Never show the previous conversation while loading another one.
    try {
      const result = await utils.agentSupport.conversation.fetch({ conversationId: id });
      if (!mounted.current || epoch !== generation.current) return;
      if (result.id !== id) throw new Error("The requested conversation is unavailable.");
      setMessages(result.messages);
    } catch (error) {
      if (!mounted.current || epoch !== generation.current) return;
      setMessages([]);
      setHistoryError(errorMessage(error));
    } finally {
      if (mounted.current && epoch === generation.current) {
        historyLock.current = false;
        setHistoryBusy(false);
      }
    }
  };

  const rateAnswer = async (messageId: number, rating: "helpful" | "not_helpful") => {
    if (askLock.current || feedbackLock.current || historyLock.current || historyError) return;
    feedbackLock.current = true;
    setFeedbackBusy(true);
    setRefreshWarning(null);
    const epoch = generation.current;
    try {
      await feedback.mutateAsync({ messageId, rating });
      if (!mounted.current || epoch !== generation.current) return;
      setMessages(current => current.map(message => message.id === messageId ? { ...message, feedback: rating } : message));
      toast.success("Feedback recorded for the pilot review.");
      refreshAudit(epoch);
    } catch (error) {
      if (mounted.current && epoch === generation.current) toast.error(errorMessage(error));
    } finally {
      feedbackLock.current = false;
      if (mounted.current && epoch === generation.current) setFeedbackBusy(false);
    }
  };

  const busy = askBusy || historyBusy || feedbackBusy;
  const answerFooter = (message: SupportConversationMessage) => {
    if (message.role !== "assistant") return null;
    const legacy = !message.verified && (!message.disposition || message.disposition === "answered");
    const label = legacy ? "Unverified legacy answer" : SUPPORT_DISPOSITION_LABELS[message.disposition] ?? "Unverified answer";
    const diagnostic = message.disposition === "validation_failed"
      ? readSupportValidationDiagnostic(message.validationDiagnostic) : null;
    return <div className="mt-3 space-y-2 border-t border-border/70 pt-2 text-xs" data-answer-id={message.id}>
      <p className="font-medium text-muted-foreground">{label}</p>
      {diagnostic ? <p className="text-muted-foreground">Pilot check: {SUPPORT_VALIDATION_DIAGNOSTIC_LABELS[diagnostic]} ({diagnostic}). No rejected draft text is retained.</p> : null}
      {message.sources?.length ? <div className="space-y-1" aria-label="Sources for this answer">{message.sources.map(source => {
        const href = isSafeSupportHref(source.href) ? source.href : null;
        const title = `[${source.index}] ${source.title}`;
        return <div key={`${source.index}:${source.key}`}>{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2">{title}<ExternalLink size={12} /></a> : <span className="text-muted-foreground">{title} — link unavailable</span>}{source.timestampLabel ? <span className="ml-1 text-muted-foreground">{source.timestampLabel}</span> : null}</div>;
      })}</div> : <p className="text-muted-foreground">{legacy ? "Source checks are unavailable for this older answer." : "No source-checked guidance in this response."}</p>}
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-muted-foreground">Was this answer useful?</span>
        <Button size="sm" className="h-7 px-2 text-xs" variant={message.feedback === "helpful" ? "default" : "outline"} aria-pressed={message.feedback === "helpful"} disabled={busy || Boolean(historyError)} onClick={() => void rateAnswer(message.id, "helpful")}><ThumbsUp size={12} /> Helpful</Button>
        <Button size="sm" className="h-7 px-2 text-xs" variant={message.feedback === "not_helpful" ? "default" : "outline"} aria-pressed={message.feedback === "not_helpful"} disabled={busy || Boolean(historyError)} onClick={() => void rateAnswer(message.id, "not_helpful")}><ThumbsDown size={12} /> Needs work</Button>
      </div>
    </div>;
  };

  if (overview.isLoading) {
    return <div className="mx-auto max-w-7xl space-y-5 animate-pulse"><div className="h-32 rounded-3xl bg-muted" /><div className="h-[570px] rounded-3xl bg-muted" /></div>;
  }
  if (overview.isError || !overview.data) {
    return <div className="mx-auto max-w-3xl rounded-2xl border border-destructive/30 bg-destructive/5 p-6"><h1 className="text-xl font-bold">AI Support Pilot is not ready yet</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">The Portal could not load the assistant’s audit and retention records. Sending is unavailable until these records load. {overview.error?.message}</p><Button className="mt-5 gap-2" onClick={() => void overview.refetch()} disabled={overview.isFetching}><RefreshCw className={overview.isFetching ? "animate-spin" : ""} size={15} /> Try again</Button></div>;
  }

  const metrics = overview.data.metrics as typeof overview.data.metrics & Partial<Record<"clarified" | "withheld" | "privacyBlocked" | "failed" | "promptTokens" | "completionTokens" | "modelCalls", number>>;
  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="overflow-hidden rounded-3xl border border-cyan-200 bg-gradient-to-r from-slate-950 via-slate-800 to-cyan-900 p-6 text-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="max-w-3xl"><div className="flex items-center gap-2 text-sm font-semibold text-cyan-100"><Bot size={18} /> Controlled AI support pilot</div><h1 className="mt-2 text-3xl font-bold tracking-tight">JLT Support Assistant</h1><p className="mt-2 text-sm leading-6 text-cyan-50/85">Admin and Super Admin only. Conversational guidance from approved Portal content, with fresh retrieval for follow-ups. It cannot inspect individual records or take action.</p></div><div className="flex flex-wrap gap-2"><Badge className="border border-cyan-200/30 bg-cyan-300/15 text-cyan-50">Admin pilot</Badge><Badge className="border border-cyan-200/30 bg-cyan-300/15 text-cyan-50">Agent access disabled</Badge></div></div>
    </header>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <main className="space-y-4">
        <Card className="overflow-hidden"><CardHeader className="border-b bg-muted/25"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><MessageCircleQuestion className="text-primary" size={20} /> Ask a question</CardTitle><p className="mt-1 text-sm text-muted-foreground">Ask follow-ups in the same conversation; check each answer and its sources.</p></div><Button variant="outline" size="sm" onClick={startNewConversation} disabled={busy}>New conversation</Button></div>
          <p className="text-xs leading-5 text-muted-foreground">Do not include client names, booking/payment references, bank details or private documents. This pilot cannot inspect individual records.</p>
          <div className="flex flex-wrap items-center gap-2 text-xs"><label htmlFor="support-conversation" className="text-muted-foreground">Your conversations</label><select id="support-conversation" aria-label="Resume your conversation" className="min-w-0 max-w-full rounded-md border bg-background px-2 py-1.5 text-xs" value={conversationId ?? ""} disabled={busy || conversations.isLoading || conversations.isError} onChange={event => { if (event.target.value) void resumeConversation(Number(event.target.value)); }}><option value="">Select a saved conversation…</option>{!conversations.isError ? conversations.data?.map(item => <option key={item.id} value={item.id}>Conversation {item.id} · {new Date(item.updatedAt).toLocaleString("en-GB")}</option>) : null}</select>{conversations.isError ? <span role="alert" className="text-destructive">Your conversation list could not load. <button className="underline" disabled={conversations.isFetching} onClick={() => void conversations.refetch()}>Retry list</button></span> : null}</div>
        </CardHeader><CardContent className="p-0">
          {historyBusy ? <p role="status" className="px-4 pt-3 text-sm text-muted-foreground">Loading your conversation…</p> : null}
          {historyError ? <div role="alert" className="p-4 text-sm text-destructive">This conversation could not load. {historyError} <Button size="sm" variant="outline" onClick={() => conversationId && void resumeConversation(conversationId)}>Retry conversation</Button></div> : null}
          {refreshWarning ? <p role="status" className="px-4 pt-3 text-xs text-muted-foreground">{refreshWarning}</p> : null}
          <AIChatBox key={conversationId ?? "new"} supportPilotMarkdown messages={messages} onSendMessage={question => void submitQuestion(question)} isLoading={busy || Boolean(historyError)} height="570px" placeholder="Ask about approved Portal guidance…" emptyStateMessage={historyBusy ? "Loading your saved conversation…" : historyError ? "History is unavailable. Retry or start a new conversation." : "Ask a practical agent-support question to start the pilot."} suggestedPrompts={historyError || historyBusy ? [] : SUGGESTED_PROMPTS} renderMessageFooter={(_message, index) => answerFooter(messages[index])} />
        </CardContent></Card>
      </main>

      <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <Card className="border-emerald-200 bg-emerald-50/50"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base text-emerald-950"><ShieldCheck size={18} /> Guardrails on</CardTitle></CardHeader><CardContent className="space-y-2 text-sm leading-5 text-emerald-950/85"><p>Approved Portal guidance only. No individual booking, client, money, email or private record access; no web search or Portal actions.</p><p className="text-xs">Source-checked means cited records passed pilot checks, not a guarantee that every claim is correct. Check the linked guidance before acting.</p></CardContent></Card>
        <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Gauge size={18} className="text-primary" /> Pilot coverage</CardTitle>
          <p className="text-xs leading-5 text-muted-foreground">Indexed: published Knowledge Base text; published, non-archived Academy lesson text; webinar descriptions and staff-approved transcript text; active supplier public descriptions; eligible admin announcements; current policies and curated procedures.</p>
          <p className="text-xs leading-5 text-muted-foreground">Not indexed: Academy video/audio transcripts or downloadable document contents; draft or archived content, private assessments, or learner, customer or financial data.</p>
          <p className="text-xs leading-5 text-muted-foreground">Counts show loaded eligible sources, not everything sent to the model. Only relevant passages are sent for each question.</p>
          <p className="text-xs leading-5 text-muted-foreground">Fresh source query on every question. Screened questions, answers, cited source references and feedback are held for {overview.data.retentionDays} days for quality review. Only your own unexpired conversations appear here.</p></CardHeader><CardContent className="grid grid-cols-2 gap-2">{sourceCards.map(source => <Metric key={source.kind} value={source.count} label={labelForSourceKind(source.kind)} />)}</CardContent></Card>
        <Card><CardHeader className="pb-3"><CardTitle className="text-base">Last 30 days</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-2"><Metric value={metrics.questions} label="questions" /><Metric value={metrics.answered} label="answered turns" /><Metric value={metrics.unresolved} label="unresolved turns" /><Metric value={metrics.helpful + metrics.notHelpful} label="feedback votes" /><Metric value={metrics.clarified ?? 0} label="clarifications" /><Metric value={metrics.withheld ?? 0} label="answers withheld" /><Metric value={metrics.privacyBlocked ?? 0} label="privacy blocked" /><Metric value={metrics.failed ?? 0} label="technical failures" /><Metric value={metrics.promptTokens ?? 0} label="prompt tokens" /><Metric value={metrics.completionTokens ?? 0} label="completion tokens" /><Metric value={metrics.modelCalls ?? 0} label="model calls" /></CardContent></Card>
        <Card><CardContent className="p-4"><details onToggle={event => setShowGaps(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">Recent content gaps</summary><div className="mt-2 space-y-2 text-xs text-muted-foreground">{showGaps && gaps.isError ? <p role="alert">Recent gaps could not load. <button className="underline" disabled={gaps.isFetching} onClick={() => void gaps.refetch()}>Retry gaps</button></p> : showGaps && gaps.isLoading ? <p>Loading gaps…</p> : showGaps && gaps.data?.length ? gaps.data.map(gap => <p key={gap.id} className="border-t pt-2">{gap.question}{gap.reason ? <span className="mt-0.5 block">{gap.reason}</span> : null}</p>) : showGaps ? <p>No recent content gaps.</p> : null}</div></details></CardContent></Card>
        <Card className="border-amber-200 bg-amber-50/60"><CardContent className="p-4 text-xs leading-5 text-amber-950"><strong>Trial discipline:</strong> use synthetic or anonymised questions, including refusals. Improve approved sources for genuine content gaps; do not treat chat replies as policy.</CardContent></Card>
      </aside>
    </div>
  </div>;
}
