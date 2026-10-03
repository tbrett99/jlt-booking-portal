import { Link } from "wouter";
import { BookOpenCheck, CalendarDays, CheckCircle2, Clock3, GraduationCap, LockKeyhole, PlayCircle, Sparkles, ArrowRight, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";

function formatDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function AcademyHome() {
  const { data, isLoading, error } = trpc.academy.agent.home.useQuery();

  if (isLoading) {
    return <div className="space-y-5 animate-pulse"><div className="h-32 rounded-2xl bg-muted" /><div className="h-48 rounded-2xl bg-muted" /></div>;
  }
  if (error) {
    return <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6"><h1 className="font-semibold">Academy could not be loaded</h1><p className="mt-1 text-sm text-muted-foreground">Please refresh the page or contact support if the issue continues.</p></div>;
  }

  if (!data?.hasAccess) {
    return (
      <div className="mx-auto max-w-3xl py-8">
        <div className="rounded-3xl border border-border bg-card p-8 shadow-sm text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#70FFE8]/30 text-[#414141]"><LockKeyhole size={26} /></div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">JLT Academy</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Your learning space is almost ready</h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">Your Academy access is approved by the JLT team once your onboarding is complete. Once approved, your assigned pathway and learning progress will appear here.</p>
          <a href="mailto:support@thejltgroup.co.uk" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">Contact JLT Support <ArrowRight size={16} /></a>
        </div>
      </div>
    );
  }

  const active = data.enrolments.filter((enrolment) => !["completed", "waived"].includes(enrolment.status));
  const completed = data.enrolments.filter((enrolment) => ["completed", "waived"].includes(enrolment.status));
  const continueItem = active.find((enrolment) => enrolment.nextLesson) ?? active[0];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="overflow-hidden rounded-3xl border border-[#70FFE8]/50 bg-gradient-to-br from-[#414141] via-[#2d3534] to-[#414141] p-6 text-white shadow-sm md:p-8">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#70FFE8]"><GraduationCap size={18} /> JLT Academy</div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Practical learning for confident travel experts.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75 md:text-base">Follow your pathway, keep essential knowledge close to hand, and build the confidence to look after your clients brilliantly.</p>
          {continueItem ? (
            <Link href={`/academy/course/${continueItem.id}`} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#70FFE8] px-4 py-2.5 text-sm font-bold text-[#27302e] transition hover:bg-[#8cffef]">
              <PlayCircle size={17} /> {continueItem.nextLesson ? `Continue: ${continueItem.nextLesson.title}` : `Open ${continueItem.course.title}`} <ArrowRight size={16} />
            </Link>
          ) : (
            <div className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white/80"><Sparkles size={17} /> Your team will assign learning here when it is ready.</div>
          )}
        </div>
      </section>

      {active.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Your pathway</p><h2 className="mt-1 text-xl font-bold">Keep moving forward</h2></div><span className="text-sm text-muted-foreground">{active.length} active {active.length === 1 ? "course" : "courses"}</span></div>
          <div className="grid gap-4 lg:grid-cols-2">
            {active.map((item) => (
              <article key={item.id} className="rounded-2xl border bg-card p-5 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#70FFE8]/25 text-[#414141]"><BookOpenCheck size={21} /></div>
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold leading-5">{item.course.title}</h3>{item.isOverdue && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700"><AlertTriangle size={12} /> Due</span>}</div><p className="mt-1 text-sm text-muted-foreground line-clamp-2">{item.course.summary || "Your JLT learning pathway."}</p></div>
                </div>
                <div className="mt-5"><div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-medium">{item.progress.completedRequiredLessons} of {item.progress.requiredLessons} required lessons</span><span className="font-bold">{item.progress.percentage}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[#00c9b4] transition-all" style={{ width: `${item.progress.percentage}%` }} /></div></div>
                <div className="mt-4 flex items-center justify-between gap-3"><span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock3 size={13} /> {item.dueDate ? `Due ${formatDate(item.dueDate)}` : "No set deadline"}</span><Link href={`/academy/course/${item.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">Open course <ArrowRight size={15} /></Link></div>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.55fr_1fr]">
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Live learning</p><h2 className="mt-1 text-xl font-bold">Upcoming sessions</h2></div><CalendarDays className="text-muted-foreground" size={22} /></div>
          {data.upcomingSessions.length ? <div className="mt-4 divide-y">{data.upcomingSessions.slice(0, 4).map((session) => <div key={session.id} className="flex items-center gap-3 py-3 first:pt-0"><div className="w-14 shrink-0 rounded-lg bg-[#FFF6ED] px-2 py-2 text-center text-xs font-semibold text-[#414141]"><div>{new Date(session.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div><div className="mt-0.5 font-normal text-muted-foreground">{new Date(session.startDate).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div></div><div className="min-w-0 flex-1"><p className="font-medium leading-5">{session.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{session.eventCategory === "supplier_event" ? "Supplier session" : session.eventCategory === "webinar" ? "Webinar" : "Training"} · {session.duration ?? 60} min</p></div>{session.eventUrl ? <a href={session.eventUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">Join / RSVP</a> : <Link href="/events" className="text-xs font-semibold text-primary hover:underline">View</Link>}</div>)}</div> : <div className="mt-4 rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">No upcoming Academy sessions are scheduled. Training and supplier events will appear here automatically.</div>}
          <Link href="/events" className="mt-4 inline-flex text-sm font-semibold text-primary hover:underline">Open events calendar <ArrowRight className="ml-1" size={15} /></Link>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Your record</p><h2 className="mt-1 text-xl font-bold">Completed learning</h2>
          {completed.length ? <div className="mt-4 space-y-3">{completed.map((item) => <div key={item.id} className="flex gap-3 rounded-xl bg-emerald-50/70 p-3"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={18} /><div><p className="text-sm font-semibold">{item.course.title}</p><p className="mt-0.5 text-xs text-emerald-700">{item.status === "waived" ? "Completion waived by JLT" : `Completed ${formatDate(item.completedAt)}`}</p></div></div>)}</div> : <div className="mt-4 rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">Completed courses will be retained here as part of your learning record.</div>}
        </section>
      </div>
    </div>
  );
}
