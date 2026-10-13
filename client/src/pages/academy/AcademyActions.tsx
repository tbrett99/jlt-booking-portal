import { ChangeEvent, useMemo, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, ChevronLeft, ClipboardCheck, FileUp, Link2, MessageSquareText, Send, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function formatDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "No deadline";
}

function statusLabel(status: string) {
  return ({ assigned: "To do", submitted: "Submitted", review: "Awaiting review", completed: "Complete", needs_revision: "Update requested" } as Record<string, string>)[status] ?? status;
}

function statusStyle(status: string) {
  return ({
    assigned: "bg-slate-100 text-slate-700",
    submitted: "bg-blue-100 text-blue-700",
    review: "bg-amber-100 text-amber-800",
    completed: "bg-emerald-100 text-emerald-800",
    needs_revision: "bg-rose-100 text-rose-800",
  } as Record<string, string>)[status] ?? "bg-muted text-muted-foreground";
}

export default function AcademyActions() {
  const utils = trpc.useUtils();
  const { data: actions = [], isLoading } = trpc.agentDevelopment.actions.mine.useQuery();
  const upload = trpc.agentDevelopment.actions.uploadEvidence.useMutation({ onError: (error) => toast.error(error.message) });
  const submit = trpc.agentDevelopment.actions.submit.useMutation({
    onSuccess: (result) => { toast.success(result.status === "completed" ? "Action marked complete" : "Action submitted for staff review"); utils.agentDevelopment.actions.mine.invalidate(); setOpenId(null); },
    onError: (error) => toast.error(error.message),
  });
  const [openId, setOpenId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [files, setFiles] = useState<Record<number, { url: string; key: string; name: string }>>({});
  const openAction = useMemo(() => actions.find((item: any) => item.assignment.id === openId) as any, [actions, openId]);

  async function uploadFile(assignmentId: number, file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("Evidence files must be under 10 MB"); return; }
    const permitted = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
    if (!permitted.includes(file.type)) { toast.error("Evidence must be a PDF, JPG or PNG"); return; }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const result = await upload.mutateAsync({ fileName: file.name, fileBase64: base64, mimeType: file.type as "application/pdf" | "image/jpeg" | "image/jpg" | "image/png" });
    setFiles((current) => ({ ...current, [assignmentId]: result }));
    toast.success("Evidence uploaded");
  }

  if (isLoading) return <div className="space-y-4 animate-pulse"><div className="h-28 rounded-3xl bg-muted" /><div className="h-52 rounded-2xl bg-muted" /></div>;

  const current = actions.filter((item: any) => item.assignment.status !== "completed");
  const completed = actions.filter((item: any) => item.assignment.status === "completed");

  return <div className="mx-auto max-w-5xl space-y-6">
    <header className="rounded-3xl border border-[#70FFE8]/45 bg-gradient-to-br from-[#414141] via-[#2d3534] to-[#414141] px-6 py-7 text-white shadow-sm md:px-8">
      <Link href="/academy" className="inline-flex items-center gap-1 text-sm font-semibold text-[#70FFE8] hover:underline"><ChevronLeft size={16} /> Back to Academy</Link>
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><div className="flex items-center gap-2 text-sm font-semibold text-[#70FFE8]"><ClipboardCheck size={18} /> Academy Actions</div><h1 className="mt-2 text-3xl font-bold tracking-tight">Put your learning into practice.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">Your JLT team sets focused actions to help you build momentum. Complete each one with the evidence requested.</p></div><div className="rounded-2xl bg-white/10 px-4 py-3 text-sm"><strong className="text-2xl text-[#70FFE8]">{current.length}</strong><span className="ml-2 text-white/80">current action{current.length === 1 ? "" : "s"}</span></div></div>
    </header>

    <section className="space-y-4">
      <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">Your focus</p><h2 className="mt-1 text-xl font-bold">Current actions</h2></div>
      {current.length ? <div className="grid gap-4">{current.map((item: any) => {
        const { assignment, plan, isOverdue } = item;
        return <Card key={assignment.id} className="overflow-hidden border shadow-sm"><CardContent className="p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusStyle(assignment.status)}`}>{statusLabel(assignment.status)}</span>{isOverdue && <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700">Overdue</span>}</div><h3 className="mt-3 text-lg font-bold">{plan.title}</h3><p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{plan.instructions}</p></div><Button onClick={() => setOpenId(assignment.id)} className="shrink-0 bg-[#414141] text-white hover:bg-[#2d3534]">{assignment.status === "needs_revision" ? "Update action" : assignment.status === "review" ? "View submission" : "Complete action"}</Button></div><div className="mt-4 flex flex-wrap gap-3 border-t pt-4 text-xs text-muted-foreground"><span>Due: <strong className="text-foreground">{formatDate(plan.dueAt)}</strong></span>{plan.requiresNote && <span className="inline-flex items-center gap-1"><MessageSquareText size={13} /> Notes required</span>}{plan.requiresUrl && <span className="inline-flex items-center gap-1"><Link2 size={13} /> Link required</span>}{plan.requiresUpload && <span className="inline-flex items-center gap-1"><FileUp size={13} /> Upload required</span>}{plan.staffReviewRequired && <span className="inline-flex items-center gap-1"><ShieldCheck size={13} /> Staff review</span>}</div>{assignment.reviewerFeedback && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950"><strong>JLT feedback:</strong> {assignment.reviewerFeedback}</div>}</CardContent></Card>;
      })}</div> : <div className="rounded-2xl border border-dashed bg-card p-10 text-center"><Sparkles className="mx-auto text-[#00c9b4]" size={28} /><h3 className="mt-3 font-bold">You are up to date</h3><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">New Academy actions will appear here when your JLT team assigns them.</p></div>}
    </section>

    {completed.length > 0 && <section className="rounded-2xl border bg-card p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">Your record</p><h2 className="mt-1 text-xl font-bold">Completed actions</h2><div className="mt-4 divide-y">{completed.slice(0, 12).map((item: any) => <div key={item.assignment.id} className="flex items-start justify-between gap-4 py-3"><div className="flex min-w-0 gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={18} /><div><p className="font-semibold">{item.plan.title}</p><p className="mt-0.5 text-xs text-muted-foreground">Completed {formatDate(item.assignment.completedAt)}</p></div></div><Button variant="ghost" size="sm" onClick={() => setOpenId(item.assignment.id)}>View</Button></div>)}</div></section>}

    {openAction && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-background p-6 shadow-2xl sm:rounded-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">Academy action</p><h2 className="mt-1 text-xl font-bold">{openAction.plan.title}</h2></div><Button variant="ghost" onClick={() => setOpenId(null)}>Close</Button></div><p className="mt-4 whitespace-pre-line text-sm leading-6 text-muted-foreground">{openAction.plan.instructions}</p>{openAction.assignment.status === "completed" || openAction.assignment.status === "review" ? <div className="mt-6 space-y-3 rounded-2xl bg-muted/45 p-4 text-sm"><p><strong>Status:</strong> {statusLabel(openAction.assignment.status)}</p>{openAction.assignment.completionNote && <p className="whitespace-pre-line"><strong>Your notes:</strong><br />{openAction.assignment.completionNote}</p>}{openAction.assignment.evidenceUrl && <p><a className="font-semibold text-primary underline" href={openAction.assignment.evidenceUrl} target="_blank" rel="noreferrer">Open submitted link</a></p>}{openAction.assignment.evidenceFileUrl && <p><a className="font-semibold text-primary underline" href={openAction.assignment.evidenceFileUrl} target="_blank" rel="noreferrer">Open {openAction.assignment.evidenceFileName || "submitted evidence"}</a></p>}</div> : <div className="mt-6 space-y-5"><div><Label>Completion notes {openAction.plan.requiresNote ? "(required)" : "(optional)"}</Label><Textarea className="mt-1.5" rows={5} placeholder="What did you do? What did you learn or what happened next?" value={notes[openAction.assignment.id] ?? openAction.assignment.completionNote ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [openAction.assignment.id]: event.target.value }))} /></div>{openAction.plan.requiresUrl && <div><Label>URL evidence (required)</Label><Input className="mt-1.5" type="url" placeholder="https://…" value={urls[openAction.assignment.id] ?? openAction.assignment.evidenceUrl ?? ""} onChange={(event) => setUrls((current) => ({ ...current, [openAction.assignment.id]: event.target.value }))} /></div>}{openAction.plan.requiresUpload && <div><Label>Upload evidence (required)</Label><label className="mt-1.5 flex cursor-pointer items-center justify-between rounded-xl border border-dashed p-4 text-sm hover:bg-muted/50"><span>{files[openAction.assignment.id]?.name || openAction.assignment.evidenceFileName || "PDF, JPG or PNG · maximum 10 MB"}</span><span className="inline-flex items-center gap-1 font-semibold text-primary"><Upload size={15} /> {upload.isPending ? "Uploading…" : "Choose file"}</span><input className="hidden" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event: ChangeEvent<HTMLInputElement>) => uploadFile(openAction.assignment.id, event.target.files?.[0])} /></label></div>}<div className="flex justify-end gap-2 border-t pt-5"><Button variant="outline" onClick={() => setOpenId(null)}>Cancel</Button><Button disabled={submit.isPending || upload.isPending} onClick={() => submit.mutate({ assignmentId: openAction.assignment.id, evidence: { note: notes[openAction.assignment.id] ?? openAction.assignment.completionNote ?? null, url: urls[openAction.assignment.id] ?? openAction.assignment.evidenceUrl ?? null, fileUrl: files[openAction.assignment.id]?.url ?? openAction.assignment.evidenceFileUrl ?? null, fileKey: files[openAction.assignment.id]?.key ?? openAction.assignment.evidenceFileKey ?? null, fileName: files[openAction.assignment.id]?.name ?? openAction.assignment.evidenceFileName ?? null } })}><Send className="mr-2" size={16} />{submit.isPending ? "Submitting…" : "Submit action"}</Button></div></div>}</div></div>}
  </div>;
}
