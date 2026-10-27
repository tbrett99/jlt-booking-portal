import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, BookOpenCheck, CheckCircle2, Circle, ClipboardCheck, Download, ExternalLink, FileText, LockKeyhole, PlayCircle, ShieldCheck, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useViewMode } from "@/contexts/ViewModeContext";
import { formatAcademyQuestionPrompt, splitAcademyQuestionInlineFormatting } from "@shared/academy-question-format";
import { normaliseAcademyLessonContent } from "@shared/academy-lesson-content";
import { loomEmbedUrl } from "@shared/loom-embed";

function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function AcademyStructuredQuestion({ text, className = "" }: { text: string; className?: string }) {
  return <div className={`academy-structured-question space-y-3 ${className}`}>{formatAcademyQuestionPrompt(text).map((block, index) => {
    const renderText = (value: string) => splitAcademyQuestionInlineFormatting(value).map((part, partIndex) => {
      const content = part.text.split("\n").map((line, lineIndex) => <span key={lineIndex}>{line}{lineIndex < part.text.split("\n").length - 1 && <br />}</span>);
      return part.bold ? <strong key={partIndex}>{content}</strong> : part.italic ? <em key={partIndex}>{content}</em> : <span key={partIndex}>{content}</span>;
    });
    if (block.type === "heading") return <p key={index} className="font-semibold leading-6">{renderText(block.text)}</p>;
    if (block.type === "bullet_list") return <ul key={index} className="list-disc space-y-1 pl-5 leading-6">{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderText(item)}</li>)}</ul>;
    if (block.type === "numbered_list") return <ol key={index} className="list-decimal space-y-1 pl-5 leading-6">{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderText(item)}</li>)}</ol>;
    return <p key={index} className="whitespace-pre-line leading-6">{renderText(block.text)}</p>;
  })}</div>;
}

export default function AcademyCourse({ enrollmentId, previewCourseId }: { enrollmentId?: string; previewCourseId?: string }) {
  const numericEnrollmentId = Number(enrollmentId);
  const numericPreviewCourseId = Number(previewCourseId);
  const { isAgentView } = useViewMode();
  const isPreview = isAgentView && Number.isInteger(numericPreviewCourseId) && numericPreviewCourseId > 0;
  const utils = trpc.useUtils();
  const agentCourse = trpc.academy.agent.course.useQuery({ enrollmentId: numericEnrollmentId }, { enabled: !isPreview && Number.isInteger(numericEnrollmentId) && numericEnrollmentId > 0 });
  const previewCourse = trpc.academy.agent.previewCourse.useQuery({ courseId: numericPreviewCourseId }, { enabled: isPreview });
  const data = isPreview ? previewCourse.data : agentCourse.data;
  const isLoading = isPreview ? previewCourse.isLoading : agentCourse.isLoading;
  const error = isPreview ? previewCourse.error : agentCourse.error;
  const [failedKnowledgeCheck, setFailedKnowledgeCheck] = useState<{ lessonId: number; score: number; correct: number; total: number } | null>(null);
  const viewLesson = trpc.academy.agent.viewLesson.useMutation();
  const recordActivity = trpc.academy.agent.recordActivity.useMutation();
  const acknowledgeLesson = trpc.academy.agent.acknowledgeLesson.useMutation({ onSuccess: () => {
    toast.success("Acknowledgement recorded");
    utils.academy.agent.course.invalidate({ enrollmentId: numericEnrollmentId });
    utils.academy.agent.home.invalidate();
  }, onError: (error) => toast.error(error.message) });
  const completeLesson = trpc.academy.agent.completeLesson.useMutation({ onSuccess: () => { toast.success("Lesson completed"); utils.academy.agent.course.invalidate({ enrollmentId: numericEnrollmentId }); utils.academy.agent.home.invalidate(); } });
  const submitAssessment = trpc.academy.agent.submitAssessment.useMutation({ onSuccess: (result, variables) => {
    if (result.status === "awaiting_marking") toast.success("Written response submitted. A JLT team member will mark it and send feedback.");
    else if (result.passed) toast.success(`Passed with ${result.score}%`);
    else {
      setFailedKnowledgeCheck({ lessonId: variables.lessonId, score: result.score ?? 0, correct: result.correct, total: result.total });
      toast.info("Review the result, then choose when you are ready to retry.");
    }
    utils.academy.agent.course.invalidate({ enrollmentId: numericEnrollmentId });
    utils.academy.agent.home.invalidate();
  }, onError: (error) => {
    if (error.message === "Please answer each outstanding question before submitting") {
      // A staff edit or a prior attempt can change targeted-resit state while
      // an agent has the form open. Refresh the source of truth, preserving
      // any typed answers so only a genuinely newly-outstanding question needs attention.
      utils.academy.agent.course.invalidate({ enrollmentId: numericEnrollmentId });
      toast.error("Your question list has been refreshed. Please check the outstanding questions and submit again.");
      return;
    }
    toast.error(error.message);
  } });
  const acknowledgeAssessmentFeedback = trpc.academy.agent.acknowledgeAssessmentFeedback.useMutation({ onSuccess: (result) => {
    toast.success(result.passed ? "Feedback acknowledged — this lesson is now complete." : "Feedback acknowledged. Please update your response and submit again when you are ready.");
    utils.academy.agent.course.invalidate({ enrollmentId: numericEnrollmentId });
    utils.academy.agent.home.invalidate();
  }, onError: (error) => toast.error(error.message) });
  const [selectedLessonId, setSelectedLessonId] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [writtenAnswers, setWrittenAnswers] = useState<Record<number, string>>({});
  const [expandedModuleId, setExpandedModuleId] = useState<number | null>(null);
  const [isWorkingOnKnowledgeCheck, setIsWorkingOnKnowledgeCheck] = useState(false);
  const scrollToTopAfterNextLesson = useRef(false);

  const lessons = useMemo(() => data?.modules.flatMap((module) => module.lessons) ?? [], [data]);
  const selectedLesson = lessons.find((lesson) => lesson.id === selectedLessonId) ?? lessons.find((lesson) => !lesson.locked) ?? null;
  const feedbackBlockingLessonIndex = lessons.findIndex((lesson) => lesson.attempts.some((attempt) => attempt.status === "feedback_pending"));
  const pendingFeedback = selectedLesson?.attempts.find((attempt) => attempt.status === "feedback_pending") ?? null;
  const awaitingMarking = selectedLesson?.attempts.find((attempt) => attempt.status === "awaiting_marking") ?? null;
  const outstandingQuestions = selectedLesson?.questions.filter((question) => !question.resit.passed) ?? [];
  const passedQuestionCount = selectedLesson ? selectedLesson.questions.length - outstandingQuestions.length : 0;
  const supportRequired = outstandingQuestions.some((question) => question.resit.supportRequired);
  const failedCurrentKnowledgeCheck = failedKnowledgeCheck?.lessonId === selectedLesson?.id ? failedKnowledgeCheck : null;

  useEffect(() => {
    if (!data || selectedLessonId) return;
    // With one ordered path, the first unfinished required lesson is always
    // the learner's valid resume point, including after they leave mid-lesson.
    const next = lessons.find((lesson) => !lesson.locked && lesson.isRequired && !lesson.progress?.completedAt)
      ?? lessons.find((lesson) => !lesson.locked)
      ?? null;
    if (next) setSelectedLessonId(next.id);
  }, [data, lessons, selectedLessonId]);

  useEffect(() => {
    if (!selectedLesson) return;
    setFailedKnowledgeCheck(null);
    setAnswers({});
    setWrittenAnswers({});
    setIsWorkingOnKnowledgeCheck(false);
    const containingModule = data?.modules.find((module) => module.lessons.some((lesson) => lesson.id === selectedLesson.id));
    if (containingModule) setExpandedModuleId((current) => current === containingModule.id ? current : containingModule.id);
    if (isPreview) return;
    viewLesson.mutate({ enrollmentId: numericEnrollmentId, lessonId: selectedLesson.id });
  // Only record an intentional lesson switch, not every progress refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLesson?.id, isPreview]);

  useEffect(() => {
    if (!selectedLesson || !scrollToTopAfterNextLesson.current) return;
    scrollToTopAfterNextLesson.current = false;
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [selectedLesson?.id]);

  useEffect(() => {
    if (isPreview || !selectedLesson || selectedLesson.progress?.completedAt) return;
    const recordVisibleActivity = (includeHidden = false) => {
      if (!includeHidden && document.hidden) return;
      recordActivity.mutate({
        enrollmentId: numericEnrollmentId,
        lessonId: selectedLesson.id,
        area: isWorkingOnKnowledgeCheck ? "knowledge_check" : "lesson",
      });
    };
    const interval = window.setInterval(() => recordVisibleActivity(), 30_000);
    const onVisibilityChange = () => {
      if (document.hidden) recordVisibleActivity(true);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isPreview, isWorkingOnKnowledgeCheck, numericEnrollmentId, recordActivity, selectedLesson?.id, selectedLesson?.progress?.completedAt]);

  const chooseLesson = (lessonId: number, options?: { scrollToTop?: boolean }) => {
    const targetIndex = lessons.findIndex((lesson) => lesson.id === lessonId);
    const target = lessons[targetIndex];
    if (target?.locked) {
      if (target.lockedReason) {
        toast.error(target.lockedReason);
        return;
      }
      const blockingLesson = lessons.find((lesson) => !lesson.progress?.completedAt && !lesson.locked && lesson.isRequired);
      toast.error(`Complete ${blockingLesson?.title ?? "the current lesson"} to unlock this lesson.`);
      return;
    }
    if (feedbackBlockingLessonIndex >= 0 && targetIndex > feedbackBlockingLessonIndex) {
      const blockingLesson = lessons[feedbackBlockingLessonIndex];
      toast.error(`Read and acknowledge the feedback for ${blockingLesson?.title ?? "your assessment"} before continuing.`);
      setSelectedLessonId(blockingLesson?.id ?? lessonId);
      return;
    }
    const containingModule = data?.modules.find((module) => module.lessons.some((lesson) => lesson.id === lessonId));
    if (containingModule) setExpandedModuleId(containingModule.id);
    if (options?.scrollToTop) scrollToTopAfterNextLesson.current = true;
    setSelectedLessonId(lessonId);
  };

  if (isLoading) return <div className="mx-auto max-w-7xl space-y-4 animate-pulse"><div className="h-10 w-32 rounded bg-muted" /><div className="h-24 rounded-2xl bg-muted" /><div className="h-[480px] rounded-2xl bg-muted" /></div>;
  if (error || !data) return <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6"><h1 className="font-semibold">Course could not be loaded</h1><p className="mt-1 text-sm text-muted-foreground">Return to Academy and try again.</p><Link href="/academy" className="mt-4 inline-flex text-sm font-semibold text-primary hover:underline">Back to Academy</Link></div>;
  if (!selectedLesson) return <div className="rounded-2xl border bg-card p-8 text-center"><LockKeyhole className="mx-auto text-muted-foreground" /><h1 className="mt-4 text-xl font-bold">This course is being prepared</h1><p className="mt-2 text-sm text-muted-foreground">Your JLT team will add lessons shortly.</p></div>;

  const canComplete = !selectedLesson.progress?.completedAt && (isPreview || !selectedLesson.requiresAcknowledgement || !!selectedLesson.progress?.acknowledgedAt) && !selectedLesson.requiresAssessment;
  const hasAnsweredAll = outstandingQuestions.length > 0 && outstandingQuestions.every((question) => question.questionType === "free_text" ? !!writtenAnswers[question.id]?.trim() : answers[question.id] !== undefined);
  const embeddedLoomUrl = loomEmbedUrl(selectedLesson.videoUrl);
  const selectedLessonIndex = lessons.findIndex((lesson) => lesson.id === selectedLesson.id);
  const nextUnlockedLesson = selectedLessonIndex >= 0 ? lessons.slice(selectedLessonIndex + 1).find((lesson) => !lesson.locked) ?? null : null;

  return (
    <div className="mx-auto max-w-7xl">
      <Link href="/academy" className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /> Back to Academy</Link>
      {isPreview && <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"><span className="font-semibold">Academy preview:</span> this course is shown exactly as an agent sees it. Quiz answers, acknowledgements and completions are intentionally not recorded in preview mode.</div>}
      <header className="rounded-2xl border bg-card p-5 shadow-sm md:p-6"><div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">JLT Academy</p><h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">{data.course.title}</h1>{data.course.summary && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{data.course.summary}</p>}</div><div className="min-w-44"><div className="mb-1.5 flex justify-between text-xs font-medium"><span>Course progress</span><span>{data.progress.percentage}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[#00c9b4]" style={{ width: `${data.progress.percentage}%` }} /></div><p className="mt-1.5 text-right text-xs text-muted-foreground">{data.progress.completedRequiredLessons} / {data.progress.requiredLessons} required</p></div></div></header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border bg-card p-3 shadow-sm lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          <div className="flex items-center justify-between gap-2 px-2 pb-3"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Course map</p><span className="text-xs text-muted-foreground">{data.progress.completedRequiredLessons}/{data.progress.requiredLessons}</span></div>
          <p className="px-2 pb-3 text-xs leading-5 text-muted-foreground">Open one section at a time, then choose a lesson.</p>
          <div className="space-y-2">{data.modules.map((module, index) => {
            const isOpen = expandedModuleId === module.id || (expandedModuleId === null && module.lessons.some((lesson) => lesson.id === selectedLesson.id));
            const completed = module.lessons.filter((lesson) => !!lesson.progress?.completedAt).length;
            return <section key={module.id} className="overflow-hidden rounded-xl border bg-background/60">
              <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition hover:bg-muted/60" aria-expanded={isOpen} aria-controls={`academy-course-module-${module.id}`} onClick={() => setExpandedModuleId((current) => current === module.id ? null : module.id)}>
                <span className="min-w-0"><span className="block text-xs font-semibold text-primary">{data.course.isAcceleratorJourney ? (module.releaseWeek ? `Week ${module.releaseWeek}` : "Introduction") : `Module ${index + 1}`}</span><span className="mt-0.5 block line-clamp-2 text-sm font-semibold leading-5">{module.title}</span>{data.course.isAcceleratorJourney && <span className={`mt-1 block text-[10px] font-medium ${module.releaseLocked ? "text-amber-700" : "text-emerald-700"}`}>{module.releaseLocked ? `Available ${module.releaseLabel}` : module.releaseWeek ? "Weekly section unlocked" : "Available now"}</span>}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"><span>{completed}/{module.lessons.length}</span><span className={`text-base transition-transform ${isOpen ? "rotate-180" : ""}`}>⌄</span></span>
              </button>
              {isOpen && <div id={`academy-course-module-${module.id}`} className="space-y-1 border-t p-2">{module.lessons.map((lesson) => {
                const complete = !!lesson.progress?.completedAt;
                const current = lesson.id === selectedLesson.id;
                const blockedByFeedback = feedbackBlockingLessonIndex >= 0 && lessons.findIndex((item) => item.id === lesson.id) > feedbackBlockingLessonIndex;
                const locked = lesson.locked || blockedByFeedback;
                const lockedReason = blockedByFeedback
                  ? "Read and acknowledge your assessment feedback first"
                  : lesson.lockedReason || "Complete the current lesson to unlock this section";
                return <button type="button" key={lesson.id} disabled={locked} aria-disabled={locked} onClick={() => chooseLesson(lesson.id)} title={locked ? lockedReason : undefined} className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition ${current ? "bg-[#70FFE8]/25 text-foreground" : locked ? "cursor-not-allowed opacity-45" : "hover:bg-muted/70 text-muted-foreground"}`}><span className="mt-0.5 shrink-0">{complete ? <CheckCircle2 size={16} className="text-emerald-600" /> : locked ? <LockKeyhole size={15} /> : current ? <PlayCircle size={16} className="text-primary" /> : <Circle size={16} />}</span><span className="min-w-0 flex-1 leading-5">{lesson.title}{lesson.isRequired && <span className="ml-1 text-[10px] font-semibold uppercase text-muted-foreground">Required</span>}{locked && <span className="mt-0.5 block text-[10px] font-medium text-muted-foreground">{lockedReason}</span>}</span></button>;
              })}</div>}
            </section>;
          })}</div>
        </aside>

        <main className="min-w-0 rounded-2xl border bg-card p-5 shadow-sm md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"><BookOpenCheck size={14} /> Lesson</div><h2 className="mt-2 text-2xl font-bold tracking-tight">{selectedLesson.title}</h2>{selectedLesson.summary && <p className="mt-2 max-w-3xl text-muted-foreground">{selectedLesson.summary}</p>}</div>{selectedLesson.progress?.completedAt ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-800"><CheckCircle2 size={15} /> Completed</span> : <span className="rounded-full bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground">In progress</span>}</div>

          {(selectedLesson.contentHtml || selectedLesson.videoUrl || selectedLesson.attachmentUrl) && <div className="mt-7 space-y-6">
            {selectedLesson.contentHtml && <div className="academy-lesson-content max-w-none text-[15px] leading-7 text-foreground" dangerouslySetInnerHTML={{ __html: normaliseAcademyLessonContent(selectedLesson.contentHtml) }} />}
            {selectedLesson.videoUrl && (embeddedLoomUrl ? <section className="overflow-hidden rounded-2xl border border-[#70FFE8]/60 bg-[#70FFE8]/10"><div className="flex items-center justify-between gap-3 px-4 py-3"><span className="flex items-center gap-2 font-semibold"><span className="flex size-8 items-center justify-center rounded-lg bg-[#414141] text-[#70FFE8]"><PlayCircle size={17} /></span> Watch within the Portal</span><a href={selectedLesson.videoUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">Open in Loom <ExternalLink className="ml-1 inline" size={13} /></a></div><div className="aspect-video bg-black"><iframe className="h-full w-full" title={`Loom video: ${selectedLesson.title}`} src={embeddedLoomUrl} allowFullScreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture" /></div></section> : <a href={selectedLesson.videoUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-4 rounded-xl border border-[#70FFE8]/60 bg-[#70FFE8]/10 p-4 transition hover:bg-[#70FFE8]/20"><span className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-lg bg-[#414141] text-[#70FFE8]"><PlayCircle size={20} /></span><span><span className="block font-semibold">Watch the lesson video</span><span className="mt-0.5 block text-xs text-muted-foreground">Opens the approved video in a new tab</span></span></span><ExternalLink size={18} className="shrink-0" /></a>)}
            {selectedLesson.attachmentUrl && <a href={selectedLesson.attachmentUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-4 rounded-xl border bg-muted/30 p-4 transition hover:bg-muted"><span className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-lg bg-card text-primary shadow-sm"><FileText size={20} /></span><span><span className="block font-semibold">{selectedLesson.attachmentName || "Download lesson resource"}</span><span className="mt-0.5 block text-xs text-muted-foreground">Open or save your copy</span></span></span><Download size={18} className="shrink-0" /></a>}
          </div>}

          {selectedLesson.requiresAcknowledgement && !selectedLesson.progress?.completedAt && <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50/70 p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">Confirm you have read and understood this lesson</p><p className="mt-1 text-sm leading-6 text-muted-foreground">This is saved to your Academy learning record and must be completed before the lesson can be marked complete.</p></div>{selectedLesson.progress?.acknowledgedAt ? <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-800"><CheckCircle2 size={15} /> Acknowledged</span> : <Button className="shrink-0" disabled={isPreview || acknowledgeLesson.isPending} onClick={() => { if (isPreview) { toast.info("Preview only — no acknowledgement was recorded."); return; } acknowledgeLesson.mutate({ enrollmentId: numericEnrollmentId, lessonId: selectedLesson.id }); }}><ShieldCheck className="mr-2" size={17} />{acknowledgeLesson.isPending ? "Recording..." : "I acknowledge this lesson"}</Button>}</div></div>}

          {selectedLesson.requiresAssessment && !selectedLesson.progress?.completedAt && <section className="mt-8 rounded-xl border bg-muted/20 p-4 md:p-5">
            <div className="flex items-center gap-2"><ClipboardCheck className="text-primary" size={20} /><div><h3 className="font-bold">Knowledge check</h3><p className="text-sm text-muted-foreground">{selectedLesson.questions.some((question) => question.questionType === "free_text") ? `Written assessments pass at ${selectedLesson.assessmentPassMark}% overall. Multiple-choice answers remain 100% mastery checks.` : "100% is required before you can move to the next lesson. Multiple-choice answers are checked immediately."}</p></div></div>

            {pendingFeedback ? <div className="mt-5 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-amber-950"><p className="font-bold">Your feedback needs acknowledgement</p><p className="mt-1 text-sm leading-6">Read the feedback below. You must acknowledge it before you can move on in this course.</p><div className="mt-4 rounded-lg border border-amber-200 bg-background p-3"><p className="text-sm font-semibold">Assessment outcome: {pendingFeedback.score}% — {pendingFeedback.passed ? `passed the ${selectedLesson.assessmentPassMark}% overall standard` : `below the ${selectedLesson.assessmentPassMark}% overall standard`}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{pendingFeedback.graderFeedback}</p></div><div className="mt-4 space-y-3">{selectedLesson.questions.filter((question) => question.questionType === "free_text").map((question, index) => { const response = pendingFeedback.responses.find((item) => item.questionId === question.id); const needsResit = !pendingFeedback.passed && (response?.score ?? 0) < selectedLesson.assessmentPassMark; return <div key={question.id} className={`rounded-lg border p-3 ${needsResit ? "border-amber-300 bg-amber-50/45" : "border-emerald-200 bg-emerald-50/35"}`}><div><p className="font-semibold">Written question {index + 1}</p><AcademyStructuredQuestion text={question.prompt} className="mt-2 text-sm" /></div><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">Your answer: {response?.responseText || "—"}</p><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Score: {response?.score ?? 0}%</p><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${needsResit ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>{needsResit ? "Needs attention — resubmit this answer" : "Passed — no resubmission"}</span></div><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{response?.feedback || "No question-level feedback was recorded."}</p></div>; })}</div><Button className="mt-5" disabled={acknowledgeAssessmentFeedback.isPending} onClick={() => acknowledgeAssessmentFeedback.mutate({ attemptId: pendingFeedback.id })}>{acknowledgeAssessmentFeedback.isPending ? "Recording acknowledgement..." : "I have read and acknowledge this feedback"}</Button></div> : awaitingMarking ? <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950"><p className="font-bold">Written response submitted for marking</p><p className="mt-1 text-sm leading-6">A JLT team member will review your response and send feedback here. You cannot continue to the next lesson until you have read and acknowledged that feedback.</p></div> : failedCurrentKnowledgeCheck ? <div className="mt-5 rounded-xl border-2 border-amber-300 bg-amber-50 p-5 text-amber-950"><p className="font-bold">Knowledge check not passed yet</p><p className="mt-2 text-sm leading-6">You scored <strong>{failedCurrentKnowledgeCheck.score}%</strong> ({failedCurrentKnowledgeCheck.correct} of {failedCurrentKnowledgeCheck.total} correct). Every outstanding answer must be correct: <strong>100% is required</strong> before this lesson and the next section unlock.</p><p className="mt-2 text-sm leading-6">Please review the lesson material above, then retry when you are ready.</p><Button className="mt-5" onClick={() => { setFailedKnowledgeCheck(null); setAnswers({}); setWrittenAnswers({}); }}>Retry knowledge check</Button></div> : supportRequired ? <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-950"><p className="font-bold">JLT team support required</p><p className="mt-1 text-sm leading-6">You have used the three available attempts for an outstanding question. A JLT team member will review your progress and reopen the question after support.</p></div> : <>
              {passedQuestionCount > 0 && <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><span className="font-semibold">{passedQuestionCount} {passedQuestionCount === 1 ? "question is" : "questions are"} already complete.</span> Only the outstanding {outstandingQuestions.length === 1 ? "question is" : "questions are"} shown below.</div>}
              <div className="mt-5 space-y-5">{outstandingQuestions.map((question, index) => <fieldset key={question.id} className="rounded-xl border bg-background p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><div className="flex items-start gap-2"><span className="mt-0.5 shrink-0 text-sm font-semibold text-muted-foreground">{index + 1}.</span><AcademyStructuredQuestion text={question.prompt} className="text-sm font-medium" /></div></div><span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">Attempt {question.resit.attemptCount + 1} of 3</span></div>{question.questionType === "free_text" ? <div className="mt-2"><Textarea value={writtenAnswers[question.id] ?? ""} rows={6} placeholder="Type your answer here. Pasting is disabled for written questions." onFocus={() => setIsWorkingOnKnowledgeCheck(true)} onPaste={(event) => { event.preventDefault(); toast.error("Pasting is disabled for written Academy answers."); }} onDrop={(event) => { event.preventDefault(); toast.error("Dropping text is disabled for written Academy answers."); }} onChange={(event) => { setIsWorkingOnKnowledgeCheck(true); const next = event.target.value; if (countWords(next) > question.maxWords) { toast.error(`This answer is limited to ${question.maxWords} words.`); return; } setWrittenAnswers((current) => ({ ...current, [question.id]: next })); }} /><p className="mt-1 text-right text-xs text-muted-foreground">{countWords(writtenAnswers[question.id] ?? "")} / {question.maxWords} words · Paste disabled</p></div> : <div className="mt-2 space-y-2">{question.answerOptions.map((option, optionIndex) => <label key={`${question.id}-${optionIndex}`} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition ${answers[question.id] === optionIndex ? "border-primary bg-primary/5" : "bg-background hover:bg-muted/50"}`}><input type="radio" className="mt-0.5" name={`question-${question.id}`} checked={answers[question.id] === optionIndex} onChange={() => { setIsWorkingOnKnowledgeCheck(true); setAnswers((current) => ({ ...current, [question.id]: optionIndex })); }} /><span>{option}</span></label>)}</div>}</fieldset>)}</div>{outstandingQuestions.length ? <Button className="mt-6" disabled={!hasAnsweredAll || (!isPreview && submitAssessment.isPending)} onClick={() => { setIsWorkingOnKnowledgeCheck(true); if (isPreview) { toast.info("Preview only — no assessment answer or learning record was created."); return; } submitAssessment.mutate({ enrollmentId: numericEnrollmentId, lessonId: selectedLesson.id, answers: outstandingQuestions.map((question) => question.questionType === "free_text" ? ({ questionId: question.id, responseText: writtenAnswers[question.id] }) : ({ questionId: question.id, selectedIndex: answers[question.id] })) }); }}>{isPreview ? "Preview submission (not recorded)" : submitAssessment.isPending ? "Submitting..." : outstandingQuestions.some((question) => question.questionType === "free_text") ? "Submit outstanding answers for marking" : "Submit outstanding questions"}</Button> : <div className="mt-5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">All questions in this knowledge check have been passed.</div>}</>}
          </section>}

          {!selectedLesson.progress?.completedAt && !selectedLesson.requiresAssessment && <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-6"><p className="text-sm text-muted-foreground">{selectedLesson.requiresAcknowledgement && !selectedLesson.progress?.acknowledgedAt ? "Acknowledge this lesson above before marking it complete." : "When you are ready, save this lesson as complete."}</p><Button disabled={!canComplete || (!isPreview && completeLesson.isPending)} onClick={() => { if (isPreview) { toast.info("Preview only — no lesson completion or Academy progress was recorded."); return; } completeLesson.mutate({ enrollmentId: numericEnrollmentId, lessonId: selectedLesson.id }); }}><ShieldCheck className="mr-2" size={17} />{isPreview ? "Preview completion (not recorded)" : completeLesson.isPending ? "Saving..." : "Complete lesson"}</Button></div>}
          {selectedLesson.progress?.completedAt && nextUnlockedLesson && <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t pt-6"><div><p className="font-semibold">Ready to continue?</p><p className="mt-1 text-sm text-muted-foreground">Next: {nextUnlockedLesson.title}</p></div><Button onClick={() => chooseLesson(nextUnlockedLesson.id, { scrollToTop: true })}>Next lesson <ArrowRight className="ml-2" size={17} /></Button></div>}
          {data.progress.isComplete && <div className="mt-8 flex items-center gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-900"><Trophy size={22} className="text-emerald-600" /><div><p className="font-bold">Course complete</p><p className="text-sm text-emerald-800">Your completion has been recorded in your Academy learning history.</p></div></div>}
        </main>
      </div>
    </div>
  );
}
