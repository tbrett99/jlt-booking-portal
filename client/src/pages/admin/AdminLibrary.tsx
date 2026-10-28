import { ChangeEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  BellRing,
  BookOpen,
  CheckCircle2,
  Download,
  FileText,
  FileSpreadsheet,
  Library,
  Link2,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { RichEmailEditor } from "@/components/RichEmailEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { knowledgeBaseArticleCsvTemplate } from "@shared/knowledge-base-csv";

type Draft = {
  id?: number;
  title: string;
  summary: string;
  contentHtml: string;
  category: string;
  tagsText: string;
  status: "draft" | "published" | "archived";
  isFeatured: boolean;
  notifyAgents: boolean;
  videoUrl: string;
  privateTranscript: string;
  durationMinutes: string;
  recordedAt: string;
  linkedEventId: string;
};

const blankArticle = (): Draft => ({
  title: "",
  summary: "",
  contentHtml: "",
  category: "General",
  tagsText: "",
  status: "draft",
  isFeatured: false,
  notifyAgents: false,
  videoUrl: "",
  privateTranscript: "",
  durationMinutes: "",
  recordedAt: "",
  linkedEventId: "",
});

const blankWebinar = (): Draft => ({ ...blankArticle(), category: "Business development" });

function formatDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}

function dateInputValue(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function tagsFromText(value: string) {
  return Array.from(new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))).slice(0, 30);
}

function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

function downloadKnowledgeBaseCsvTemplate() {
  const blob = new Blob([`\uFEFF${knowledgeBaseArticleCsvTemplate}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "jlt-knowledge-base-bulk-import-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export default function AdminLibrary() {
  const utils = trpc.useUtils();
  const { data, isLoading, isError, error, refetch, isFetching } = trpc.library.admin.overview.useQuery();
  const [activeTab, setActiveTab] = useState<"articles" | "webinars">("articles");
  const [articleDraft, setArticleDraft] = useState<Draft>(blankArticle);
  const [webinarDraft, setWebinarDraft] = useState<Draft>(blankWebinar);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const draft = activeTab === "articles" ? articleDraft : webinarDraft;
  const setDraft = activeTab === "articles" ? setArticleDraft : setWebinarDraft;
  const activeKind: "article" | "webinar" = activeTab === "articles" ? "article" : "webinar";
  const auditInput = useMemo(() => ({ contentType: activeKind, contentId: draft.id ?? 1 }), [activeKind, draft.id]);
  const audit = trpc.library.admin.audit.useQuery(auditInput, { enabled: !!draft.id });

  const refresh = async () => {
    await Promise.all([utils.library.admin.overview.invalidate(), utils.library.admin.audit.invalidate()]);
  };

  const saveArticle = trpc.library.admin.saveArticle.useMutation({
    onSuccess: async (result) => {
      setArticleDraft((current) => ({ ...current, id: result.id, notifyAgents: false }));
      await refresh();
      toast.success(result.announcement.notified ? `Article published and announced to ${result.announcement.notified} active agents.` : "Knowledge Base article saved.");
    },
    onError: (mutationError) => toast.error(mutationError.message),
  });
  const saveWebinar = trpc.library.admin.saveWebinar.useMutation({
    onSuccess: async (result) => {
      setWebinarDraft((current) => ({ ...current, id: result.id, notifyAgents: false }));
      await refresh();
      toast.success(result.announcement.notified ? `Webinar published and announced to ${result.announcement.notified} active agents.` : "Webinar saved.");
    },
    onError: (mutationError) => toast.error(mutationError.message),
  });
  const uploadResource = trpc.library.admin.uploadResource.useMutation({
    onSuccess: async () => { await refresh(); toast.success("Resource uploaded."); },
    onError: (mutationError) => toast.error(mutationError.message),
  });
  const removeResource = trpc.library.admin.removeResource.useMutation({
    onSuccess: async () => { await refresh(); toast.success("Resource withdrawn from the Portal."); },
    onError: (mutationError) => toast.error(mutationError.message),
  });
  const importArticlesCsv = trpc.library.admin.importArticlesCsv.useMutation({
    onSuccess: async (result) => {
      await refresh();
      setArticleDraft(blankArticle());
      toast.success(`Imported ${result.imported} Knowledge Base ${result.imported === 1 ? "article" : "articles"}: ${result.drafts} draft${result.drafts === 1 ? "" : "s"}, ${result.published} published. No agent notifications were sent.`);
    },
    onError: (mutationError) => toast.error(mutationError.message),
  });

  const chooseArticle = (article: any) => {
    setActiveTab("articles");
    setArticleDraft({
      id: article.id,
      title: article.title,
      summary: article.summary ?? "",
      contentHtml: article.contentHtml ?? "",
      category: article.category,
      tagsText: (article.tags ?? []).join(", "),
      status: article.status,
      isFeatured: !!article.isFeatured,
      notifyAgents: false,
      videoUrl: "",
      privateTranscript: "",
      durationMinutes: "",
      recordedAt: "",
      linkedEventId: "",
    });
  };
  const chooseWebinar = (webinar: any) => {
    setActiveTab("webinars");
    setWebinarDraft({
      id: webinar.id,
      title: webinar.title,
      summary: webinar.summary ?? "",
      contentHtml: webinar.descriptionHtml ?? "",
      category: webinar.category,
      tagsText: (webinar.tags ?? []).join(", "),
      status: webinar.status,
      isFeatured: !!webinar.isFeatured,
      notifyAgents: false,
      videoUrl: webinar.videoUrl ?? "",
      privateTranscript: webinar.privateTranscript ?? "",
      durationMinutes: webinar.durationMinutes ? String(webinar.durationMinutes) : "",
      recordedAt: dateInputValue(webinar.recordedAt),
      linkedEventId: webinar.linkedEventId ? String(webinar.linkedEventId) : "",
    });
  };

  const save = () => {
    const core = {
      id: draft.id,
      title: draft.title,
      summary: draft.summary || null,
      contentHtml: draft.contentHtml || null,
      category: draft.category,
      tags: tagsFromText(draft.tagsText),
      status: draft.status,
      isFeatured: draft.isFeatured,
      notifyAgents: draft.notifyAgents,
    };
    if (activeKind === "article") {
      saveArticle.mutate(core);
      return;
    }
    saveWebinar.mutate({
      ...core,
      videoUrl: draft.videoUrl || null,
      privateTranscript: draft.privateTranscript || null,
      durationMinutes: draft.durationMinutes ? Number(draft.durationMinutes) : null,
      recordedAt: draft.recordedAt ? new Date(`${draft.recordedAt}T12:00:00.000Z`) : null,
      linkedEventId: draft.linkedEventId ? Number(draft.linkedEventId) : null,
    });
  };

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !draft.id) return;
    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
      "text/csv",
    ];
    if (!allowed.includes(file.type)) {
      toast.error("Choose a PDF, Word, Excel, PowerPoint, text or CSV resource.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Resources must be under 10 MB.");
      return;
    }
    const key = `${activeKind}:${draft.id}`;
    try {
      setUploadingFor(key);
      await uploadResource.mutateAsync({ contentType: activeKind, contentId: draft.id, fileName: file.name, fileBase64: await toBase64(file), mimeType: file.type as any });
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : "The file could not be prepared.");
    } finally {
      setUploadingFor(null);
    }
  };

  const onImportArticlesCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith(".csv")) {
      toast.error("Choose a CSV file (.csv). Export Numbers or Excel files as CSV first.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Keep a Knowledge Base CSV below 8 MB. Split a larger migration into smaller files.");
      return;
    }
    try {
      await importArticlesCsv.mutateAsync({ csvText: await file.text(), fileName: file.name });
    } catch {
      // The mutation toast contains row-level validation or conflict guidance.
    }
  };

  if (isLoading) return <div className="mx-auto max-w-7xl space-y-5 animate-pulse"><div className="h-44 rounded-3xl bg-muted" /><div className="h-96 rounded-3xl bg-muted" /></div>;
  if (isError || !data) return <div className="mx-auto max-w-3xl rounded-2xl border border-destructive/30 bg-destructive/5 p-6"><h1 className="text-xl font-bold">Knowledge and webinar content could not be loaded</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Nothing has been changed. {error?.message}</p><Button className="mt-5" disabled={isFetching} onClick={() => refetch()}>{isFetching ? "Retrying…" : "Retry library"}</Button></div>;

  const selectedRecord = activeKind === "article" ? data.articles.find((item: any) => item.id === draft.id) : data.webinars.find((item: any) => item.id === draft.id);
  const records = activeKind === "article" ? data.articles : data.webinars;
  const saving = saveArticle.isPending || saveWebinar.isPending;

  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="overflow-hidden rounded-3xl border border-indigo-200 bg-gradient-to-r from-[#1e293b] via-[#2f3e65] to-[#5b4db2] p-6 text-white shadow-sm md:p-8"><div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex items-center gap-2 text-sm font-semibold text-indigo-100"><Library size={18} /> JLT content workspace</div><h1 className="mt-2 text-3xl font-bold tracking-tight">Knowledge Base & Webinar Library</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-indigo-100/85">Draft, publish and maintain agent-facing JLT knowledge separately from Academy courses and supplier webinars. Private webinar transcripts stay staff-only for future AI search.</p></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric value={data.metrics.publishedArticles} label="live articles" /><Metric value={data.metrics.publishedWebinars} label="live webinars" /><Metric value={data.metrics.articleCompletions} label="article completions" /><Metric value={data.metrics.webinarCompletions} label="webinar completions" /></div></div></header>

    <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
      <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start"><Card><CardHeader className="pb-3"><div className="flex items-center justify-between gap-3"><CardTitle className="text-lg">Library content</CardTitle><Button size="sm" variant="outline" className="gap-1.5" onClick={() => activeKind === "article" ? setArticleDraft(blankArticle()) : setWebinarDraft(blankWebinar())}><Plus size={15} /> New</Button></div><div className="mt-3 grid grid-cols-2 rounded-xl bg-muted p-1"><button type="button" onClick={() => setActiveTab("articles")} className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${activeTab === "articles" ? "bg-background shadow-sm" : "text-muted-foreground"}`}><BookOpen className="mr-1.5 inline" size={15} /> Articles</button><button type="button" onClick={() => setActiveTab("webinars")} className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${activeTab === "webinars" ? "bg-background shadow-sm" : "text-muted-foreground"}`}><Video className="mr-1.5 inline" size={15} /> Webinars</button></div></CardHeader><CardContent className="space-y-2">{records.length ? records.map((record: any) => <button type="button" key={record.id} onClick={() => activeKind === "article" ? chooseArticle(record) : chooseWebinar(record)} className={`w-full rounded-xl border p-3 text-left transition hover:bg-muted/50 ${draft.id === record.id ? "border-primary bg-primary/5" : "border-transparent bg-muted/30"}`}><div className="flex items-start justify-between gap-2"><p className="line-clamp-2 text-sm font-bold">{record.title}</p><StatusBadge status={record.status} /></div><p className="mt-1 truncate text-xs text-muted-foreground">{record.category} · {record.completionCount} complete</p></button>) : <p className="rounded-xl bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">No {activeKind === "article" ? "Knowledge Base articles" : "webinars"} yet. Create the first draft here.</p>}</CardContent></Card>
        <Card className="border-amber-200 bg-amber-50/60"><CardContent className="p-4"><div className="flex gap-3"><Sparkles className="mt-0.5 shrink-0 text-amber-700" size={18} /><div><p className="text-sm font-bold text-amber-950">Momentum is opt-in</p><p className="mt-1 text-xs leading-5 text-amber-900/80">Completion is recorded for every resource, but points only award once if the relevant Momentum rule is switched on in JLT Momentum.</p></div></div></CardContent></Card>
        {activeKind === "article" ? <KnowledgeBaseCsvImportPanel importing={importArticlesCsv.isPending} onDownload={downloadKnowledgeBaseCsvTemplate} onUpload={onImportArticlesCsv} /> : null}
      </aside>

      <main className="space-y-6"><Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-xl">{activeKind === "article" ? <BookOpen className="text-indigo-700" size={21} /> : <Video className="text-rose-700" size={21} />}{draft.id ? `Edit ${activeKind === "article" ? "article" : "webinar"}` : `New ${activeKind === "article" ? "Knowledge Base article" : "webinar"}`}</CardTitle><p className="mt-1 text-sm text-muted-foreground">Save as a draft while you write. Only Published content is visible to agents.</p></div>{draft.id && selectedRecord ? <div className="text-right text-xs text-muted-foreground"><p>{selectedRecord.viewCount} agents opened it</p><p>{selectedRecord.completionCount} marked complete</p></div> : null}</div></CardHeader><CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-[1fr_210px]"><Field label="Title"><Input value={draft.title} maxLength={255} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder={activeKind === "article" ? "e.g. Handling a booking amendment" : "e.g. Building your first referral partnership"} /></Field><Field label="Status"><select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as Draft["status"] }))} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="draft">Draft — staff only</option><option value="published">Published — agents can view</option><option value="archived">Archived — hidden, retained</option></select></Field></div>
          <Field label="Short summary" hint="Used in search results and on the agent library card."><textarea value={draft.summary} maxLength={10_000} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring" placeholder="A clear description of what this resource helps an agent do." /></Field>
          <div className="grid gap-4 md:grid-cols-2"><Field label="Category"><Input value={draft.category} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} placeholder="e.g. Bookings, Sales, Marketing" /></Field><Field label="Tags" hint="Separate with commas"><Input value={draft.tagsText} onChange={(event) => setDraft((current) => ({ ...current, tagsText: event.target.value }))} placeholder="amendments, customer care, process" /></Field></div>
          {activeKind === "webinar" && <WebinarFields draft={draft} setDraft={setWebinarDraft} events={data.eventOptions as any[]} />}
          <section><Label>Agent-facing content</Label><p className="mb-2 mt-1 text-xs leading-5 text-muted-foreground">Paste formatted text, use headings and lists, and add links. This is displayed in the Portal exactly as the article or webinar description.</p><RichEmailEditor value={draft.contentHtml} onChange={(contentHtml) => setDraft((current) => ({ ...current, contentHtml }))} placeholder={activeKind === "article" ? "Write the trusted JLT guidance here…" : "Add an overview, takeaways and any follow-up actions…"} preserveClipboardFormatting className="min-h-[280px]" /></section>
          <div className="flex flex-col gap-3 rounded-2xl border bg-muted/25 p-4 sm:flex-row sm:items-center sm:justify-between"><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={draft.isFeatured} onChange={(event) => setDraft((current) => ({ ...current, isFeatured: event.target.checked }))} className="mt-1 h-4 w-4" /><span><span className="block text-sm font-semibold">Feature this resource</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">Shows it prominently at the top of the agent library.</span></span></label>{draft.status === "published" && <label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={draft.notifyAgents} onChange={(event) => setDraft((current) => ({ ...current, notifyAgents: event.target.checked }))} className="mt-1 h-4 w-4" /><span><span className="flex items-center gap-1.5 text-sm font-semibold"><BellRing size={15} /> Announce to active agents</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">Sends one in-Portal notification and email per active agent for this publish/update.</span></span></label>}</div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5"><p className="text-xs leading-5 text-muted-foreground">{draft.status === "archived" ? "Archived content is retained for audit but hidden from agents." : "Every save is recorded in the staff audit timeline."}</p><Button disabled={saving || !draft.title.trim()} onClick={save} className="gap-2"><Save size={16} /> {saving ? "Saving…" : draft.status === "published" ? "Save & publish" : "Save draft"}</Button></div>
        </CardContent></Card>

        <ResourcesPanel draft={draft} kind={activeKind} record={selectedRecord} uploading={uploadingFor === `${activeKind}:${draft.id}`} onUpload={onUpload} removeResource={(id) => { if (window.confirm("Remove this resource from the Portal? The file reference will be withdrawn but the audit trail remains.")) removeResource.mutate({ id }); }} removingId={removeResource.isPending ? undefined : null} />
        {draft.id ? <AuditPanel audit={audit.data as any[] | undefined} loading={audit.isLoading} /> : null}
      </main>
    </div>
  </div>;
}

function KnowledgeBaseCsvImportPanel({ importing, onDownload, onUpload }: { importing: boolean; onDownload: () => void; onUpload: (event: ChangeEvent<HTMLInputElement>) => void }) {
  return <Card className="border-indigo-200 bg-indigo-50/40"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><FileSpreadsheet className="text-indigo-700" size={18} /> Bulk article import</CardTitle><p className="text-xs leading-5 text-muted-foreground">Migrate up to 500 new Knowledge Base articles at once. Imports create only — they never overwrite an existing article or announce it to agents.</p></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={onDownload}><Download className="mr-1.5" size={15} /> Download CSV template</Button><label className={`inline-flex cursor-pointer items-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 ${importing ? "pointer-events-none opacity-60" : ""}`}><Upload className="mr-1.5" size={15} /> {importing ? "Checking & importing…" : "Upload CSV"}<input type="file" className="sr-only" accept=".csv,text/csv" disabled={importing} onChange={onUpload} /></label></div><ul className="space-y-1 text-xs leading-5 text-muted-foreground"><li><strong>Required columns:</strong> Title, Category and Content HTML. Keep cells containing commas, headings, links or multi-line HTML wrapped in double quotes.</li><li><strong>Loom URL:</strong> paste a Loom share URL and it becomes an in-Portal player. <strong>SOP URL:</strong> paste an HTTPS link and a labelled online-SOP link is appended to the article.</li><li>Use <strong>Draft</strong> while you review migrated content. Published rows become visible to agents but are deliberately not emailed or notified in bulk.</li></ul></CardContent></Card>;
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="rounded-2xl bg-white/10 px-3 py-3 text-center backdrop-blur"><p className="text-xl font-bold">{value}</p><p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-100">{label}</p></div>;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = { published: "bg-emerald-100 text-emerald-800", draft: "bg-amber-100 text-amber-800", archived: "bg-slate-200 text-slate-700" };
  return <Badge className={`shrink-0 border-0 text-[10px] ${styles[status] ?? "bg-muted text-muted-foreground"}`}>{status}</Badge>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-sm font-semibold">{label}</span>{hint && <span className="ml-2 text-xs text-muted-foreground">{hint}</span>}<div className="mt-1.5">{children}</div></label>;
}

function WebinarFields({ draft, setDraft, events }: { draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>>; events: any[] }) {
  return <section className="space-y-4 rounded-2xl border border-rose-200 bg-rose-50/40 p-4"><div><h2 className="flex items-center gap-2 font-bold"><Video className="text-rose-700" size={18} /> Recording details</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Only approved HTTPS recordings are accepted. Loom links will play inside the Portal; other approved links open in a new tab.</p></div><Field label="Recording link"><Input type="url" value={draft.videoUrl} onChange={(event) => setDraft((current) => ({ ...current, videoUrl: event.target.value }))} placeholder="https://www.loom.com/share/..." /></Field><div className="grid gap-4 md:grid-cols-3"><Field label="Duration (minutes)"><Input type="number" min={1} max={1440} value={draft.durationMinutes} onChange={(event) => setDraft((current) => ({ ...current, durationMinutes: event.target.value }))} placeholder="45" /></Field><Field label="Recorded date"><Input type="date" value={draft.recordedAt} onChange={(event) => setDraft((current) => ({ ...current, recordedAt: event.target.value }))} /></Field><Field label="Related live event"><select value={draft.linkedEventId} onChange={(event) => setDraft((current) => ({ ...current, linkedEventId: event.target.value }))} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">No linked event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title} · {new Date(event.startDate).toLocaleDateString("en-GB")}</option>)}</select></Field></div><Field label="Private staff transcript" hint="Never visible to agents. Stored for the future JLT AI assistant."><textarea value={draft.privateTranscript} maxLength={1_000_000} onChange={(event) => setDraft((current) => ({ ...current, privateTranscript: event.target.value }))} className="min-h-40 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-ring" placeholder="Paste the full Loom transcript, including timestamps if useful…" /></Field></section>;
}

function ResourcesPanel({ draft, kind, record, uploading, onUpload, removeResource, removingId }: { draft: Draft; kind: "article" | "webinar"; record: any; uploading: boolean; onUpload: (event: ChangeEvent<HTMLInputElement>) => void; removeResource: (id: number) => void; removingId: number | null | undefined }) {
  return <Card><CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-lg"><FileText className="text-primary" size={19} /> Supporting resources</CardTitle><p className="mt-1 text-sm text-muted-foreground">Attach PDFs, Word, Excel, PowerPoint, text or CSV files (maximum 10 MB). These appear alongside the published content.</p></div>{draft.id ? <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Upload size={15} /> {uploading ? "Uploading…" : "Upload"}<input type="file" className="sr-only" onChange={onUpload} disabled={uploading} accept=".pdf,.docx,.xlsx,.pptx,.txt,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv" /></label> : null}</div></CardHeader><CardContent>{!draft.id ? <div className="rounded-xl border border-dashed bg-muted/30 p-5 text-sm leading-6 text-muted-foreground">Save this {kind === "article" ? "article" : "webinar"} first, then attach supporting resources.</div> : record?.resources?.length ? <div className="divide-y rounded-xl border">{record.resources.map((resource: any) => <div key={resource.id} className="flex items-center justify-between gap-3 p-3"><a className="min-w-0 truncate text-sm font-semibold text-primary hover:underline" href={resource.fileUrl} target="_blank" rel="noreferrer"><Link2 className="mr-1 inline" size={14} />{resource.title}</a><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={removingId === resource.id} onClick={() => removeResource(resource.id)} aria-label={`Remove ${resource.title}`}><Trash2 size={15} /></Button></div>)}</div> : <p className="rounded-xl bg-muted/30 p-5 text-sm text-muted-foreground">No supporting resources attached yet.</p>}</CardContent></Card>;
}

function AuditPanel({ audit, loading }: { audit: any[] | undefined; loading: boolean }) {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Archive className="text-slate-600" size={19} /> Staff audit trail</CardTitle><p className="text-sm text-muted-foreground">A record of content, resource and announcement decisions. Historic entries are retained.</p></CardHeader><CardContent>{loading ? <div className="h-24 animate-pulse rounded-xl bg-muted" /> : audit?.length ? <ol className="divide-y">{audit.map((entry) => <li key={entry.audit.id} className="py-3 first:pt-0"><p className="text-sm font-semibold">{entry.audit.summary}</p><p className="mt-1 text-xs text-muted-foreground">{entry.actorName || entry.actorEmail || "Staff member"} · {formatDate(entry.audit.createdAt)}</p></li>)}</ol> : <p className="rounded-xl bg-muted/30 p-5 text-sm text-muted-foreground">No audit entries are available yet.</p>}</CardContent></Card>;
}
