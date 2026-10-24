import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Library,
  PlayCircle,
  Search,
  Sparkles,
  Video,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { loomEmbedUrl } from "@shared/loom-embed";

type LibraryKind = "article" | "webinar";

function formatDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function completionLabel(item: { activity?: { completedAt?: Date | string | null } | null }) {
  return item.activity?.completedAt ? "Completed" : "Open";
}

export default function LibraryBrowser({ kind }: { kind: LibraryKind }) {
  const utils = trpc.useUtils();
  const [location, navigate] = useLocation();
  const paramName = kind === "article" ? "article" : "webinar";
  const selectedId = useMemo(() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get(paramName);
    const parsed = raw ? Number(raw) : null;
    return parsed && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }, [location, paramName]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("");
  const browseInput = useMemo(() => ({ search, category: category || null }), [search, category]);
  const { data, isLoading, isError, error, refetch } = trpc.library.browse.useQuery(browseInput);
  const articleDetail = trpc.library.article.useQuery({ id: selectedId ?? 1 }, { enabled: kind === "article" && !!selectedId });
  const webinarDetail = trpc.library.webinar.useQuery({ id: selectedId ?? 1 }, { enabled: kind === "webinar" && !!selectedId });
  const recordView = trpc.library.recordView.useMutation();
  const markCompleted = trpc.library.markCompleted.useMutation({
    onSuccess: async (result) => {
      await Promise.all([utils.library.browse.invalidate(), kind === "article" ? utils.library.article.invalidate() : utils.library.webinar.invalidate()]);
      if (result.award.awarded) toast.success(`Completed — you earned ${result.award.points} JLT Momentum point${result.award.points === 1 ? "" : "s"}.`);
      else toast.success("Marked as completed.");
    },
    onError: (mutationError) => toast.error(mutationError.message),
  });
  const detail = kind === "article" ? articleDetail.data : webinarDetail.data;
  const detailLoading = kind === "article" ? articleDetail.isLoading : webinarDetail.isLoading;

  useEffect(() => {
    if (!selectedId || !detail) return;
    recordView.mutate({ contentType: kind, contentId: selectedId });
  // Record durable activity, not UI state; a repeat open simply updates lastViewedAt.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, kind, !!detail]);

  const title = kind === "article" ? "Knowledge Base" : "Webinar Library";
  const description = kind === "article"
    ? "Trusted JLT guidance, processes and practical answers — kept in one searchable place."
    : "Catch up on recorded business-development calls and practical JLT sessions whenever it suits you.";
  const items = kind === "article" ? (data?.articles ?? []) : (data?.webinars ?? []);

  if (selectedId) {
    if (detailLoading) return <div className="mx-auto max-w-5xl space-y-5 animate-pulse"><div className="h-16 rounded-2xl bg-muted" /><div className="h-96 rounded-3xl bg-muted" /></div>;
    if (!detail) return <div className="mx-auto max-w-3xl rounded-2xl border border-destructive/30 bg-destructive/5 p-6"><h1 className="text-xl font-bold">This {kind === "article" ? "article" : "webinar"} could not be opened</h1><p className="mt-2 text-sm text-muted-foreground">It may have been archived or is not currently available.</p><Button className="mt-5" onClick={() => navigate(kind === "article" ? "/knowledge-base" : "/webinars")}>Back to library</Button></div>;
    return <LibraryDetail kind={kind} item={detail as any} onBack={() => navigate(kind === "article" ? "/knowledge-base" : "/webinars")} onComplete={() => markCompleted.mutate({ contentType: kind, contentId: selectedId })} completing={markCompleted.isPending} />;
  }

  return <div className="mx-auto max-w-7xl space-y-6">
    <header className={`overflow-hidden rounded-3xl border p-6 shadow-sm md:p-8 ${kind === "article" ? "border-indigo-200 bg-gradient-to-r from-[#1e293b] via-[#26395e] to-[#4f46a5] text-white" : "border-rose-200 bg-gradient-to-r from-[#3c1d3e] via-[#65315d] to-[#a24c70] text-white"}`}>
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="flex items-center gap-2 text-sm font-semibold text-white/80">{kind === "article" ? <Library size={18} /> : <Video size={18} />} JLT learning library</div><h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/85">{description}</p></div><div className="rounded-2xl bg-white/10 px-5 py-3 backdrop-blur"><p className="text-2xl font-bold">{items.length}</p><p className="text-xs text-white/80">{kind === "article" ? "matching articles" : "matching recordings"}</p></div></div>
    </header>

    <section className="grid gap-3 rounded-2xl border bg-card p-4 shadow-sm md:grid-cols-[1fr_220px]">
      <label className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={kind === "article" ? "Search articles, topics and tags…" : "Search recordings, topics and tags…"} className="h-11 pl-10" /></label>
      <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-11 rounded-md border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
        <option value="">All categories</option>
        {(data?.categories ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </section>

    {isLoading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-52 animate-pulse rounded-2xl bg-muted" />)}</div> : isError ? <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6"><h2 className="font-bold">The library could not be loaded</h2><p className="mt-1 text-sm text-muted-foreground">The content has not changed. {error?.message}</p><Button className="mt-4" onClick={() => refetch()}>Retry</Button></div> : items.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((item: any) => <LibraryCard key={item.id} kind={kind} item={item} />)}</div> : <div className="rounded-2xl border border-dashed bg-card p-12 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">{kind === "article" ? <BookOpen size={23} /> : <Video size={23} />}</div><h2 className="mt-4 text-lg font-bold">Nothing matches yet</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Try a broader search or another category. New JLT resources will appear here as they are published.</p></div>}
  </div>;
}

function LibraryCard({ kind, item }: { kind: LibraryKind; item: any }) {
  const href = kind === "article" ? `/knowledge-base?article=${item.id}` : `/webinars?webinar=${item.id}`;
  const Icon = kind === "article" ? BookOpen : PlayCircle;
  return <Link href={href}><Card className="group h-full overflow-hidden border transition-all hover:-translate-y-0.5 hover:shadow-md"><CardContent className="flex h-full flex-col p-5"><div className="flex items-start justify-between gap-3"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${kind === "article" ? "bg-indigo-100 text-indigo-700" : "bg-rose-100 text-rose-700"}`}><Icon size={20} /></div>{item.activity?.completedAt ? <Badge className="border-0 bg-emerald-100 text-emerald-800"><CheckCircle2 className="mr-1" size={13} /> Completed</Badge> : item.isFeatured ? <Badge className="border-0 bg-amber-100 text-amber-800"><Sparkles className="mr-1" size={13} /> Featured</Badge> : null}</div><p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{item.category}</p><h2 className="mt-2 line-clamp-2 text-lg font-bold leading-snug group-hover:text-primary">{item.title}</h2><p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{item.summary || (kind === "article" ? "Open this JLT guide for the full detail." : "Open this recorded session and its supporting resources.")}</p><div className="mt-auto flex flex-wrap items-center gap-2 pt-5"><span className="text-xs font-semibold text-primary">{completionLabel(item)} {kind === "article" ? "article" : "recording"} <span aria-hidden>→</span></span>{kind === "webinar" && item.durationMinutes ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock3 size={13} /> {item.durationMinutes} min</span> : null}</div></CardContent></Card></Link>;
}

function LibraryDetail({ kind, item, onBack, onComplete, completing }: { kind: LibraryKind; item: any; onBack: () => void; onComplete: () => void; completing: boolean }) {
  const embeddedLoomUrl = kind === "webinar" ? loomEmbedUrl(item.videoUrl) : null;
  const bodyHtml = kind === "article" ? item.contentHtml : item.descriptionHtml;
  const completed = !!item.activity?.completedAt;
  return <div className="mx-auto max-w-5xl space-y-5">
    <Button variant="ghost" className="gap-2" onClick={onBack}><ArrowLeft size={16} /> Back to {kind === "article" ? "Knowledge Base" : "Webinar Library"}</Button>
    <article className="overflow-hidden rounded-3xl border bg-card shadow-sm"><header className={`p-6 md:p-8 ${kind === "article" ? "bg-indigo-50/70" : "bg-rose-50/70"}`}><div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-3xl"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{item.category}</Badge>{(item.tags ?? []).map((tag: string) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div><h1 className="mt-4 text-3xl font-bold tracking-tight">{item.title}</h1>{item.summary && <p className="mt-3 text-base leading-7 text-muted-foreground">{item.summary}</p>}</div>{completed ? <Badge className="border-0 bg-emerald-100 px-3 py-1.5 text-emerald-800"><CheckCircle2 className="mr-1.5" size={15} /> Completed</Badge> : null}</div><div className="mt-5 flex flex-wrap gap-4 text-xs text-muted-foreground">{item.publishedAt && <span>Published {formatDate(item.publishedAt)}</span>}{kind === "webinar" && item.durationMinutes && <span className="inline-flex items-center gap-1"><Clock3 size={13} /> {item.durationMinutes} minutes</span>}{kind === "webinar" && item.recordedAt && <span>Recorded {formatDate(item.recordedAt)}</span>}</div></header>
      <div className="p-6 md:p-8">
        {kind === "webinar" && item.videoUrl ? (embeddedLoomUrl ? <section className="overflow-hidden rounded-2xl border border-rose-200 bg-rose-50/50"><div className="flex items-center justify-between gap-3 px-4 py-3"><span className="flex items-center gap-2 font-semibold"><PlayCircle className="text-rose-700" size={18} /> Watch in the Portal</span><a href={item.videoUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">Open in Loom <ExternalLink className="ml-1 inline" size={13} /></a></div><div className="aspect-video bg-black"><iframe title={`Webinar: ${item.title}`} src={embeddedLoomUrl} className="h-full w-full" allowFullScreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture" /></div></section> : <a href={item.videoUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50 p-5 transition hover:bg-rose-100/70"><span className="flex items-center gap-3"><span className="rounded-xl bg-rose-700 p-2.5 text-white"><PlayCircle size={20} /></span><span><strong className="block">Watch this recording</strong><span className="mt-0.5 block text-sm text-muted-foreground">Opens the approved recording in a new tab.</span></span></span><ExternalLink size={18} /></a>) : null}
        {bodyHtml && <div className="academy-lesson-content mt-7 max-w-none text-[15px] leading-7 text-foreground" dangerouslySetInnerHTML={{ __html: bodyHtml }} />}
        {item.resources?.length ? <section className="mt-8 border-t pt-7"><h2 className="flex items-center gap-2 text-lg font-bold"><FileText className="text-primary" size={19} /> Supporting resources</h2><div className="mt-4 grid gap-3">{item.resources.map((resource: any) => <a key={resource.id} href={resource.fileUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-4 rounded-xl border bg-muted/30 p-4 transition hover:bg-muted"><span className="flex min-w-0 items-center gap-3"><span className="rounded-lg bg-card p-2 text-primary shadow-sm"><FileText size={18} /></span><span className="truncate font-semibold">{resource.title}</span></span><Download size={18} className="shrink-0 text-muted-foreground" /></a>)}</div></section> : null}
        <section className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold">{completed ? "Completed in your learning record" : `Finished with this ${kind === "article" ? "article" : "recording"}?`}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{completed ? "Your completion is saved. You can return to this resource whenever you need it." : "Mark it complete to keep a simple record of the JLT resources you have worked through. If its Momentum rule is active, points are awarded once only."}</p></div>{!completed && <Button onClick={onComplete} disabled={completing} className="shrink-0 gap-2 bg-emerald-700 hover:bg-emerald-800"><CheckCircle2 size={16} /> {completing ? "Saving…" : "Mark as complete"}</Button>}</div></section>
      </div>
    </article>
  </div>;
}
