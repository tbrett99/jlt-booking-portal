import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, BookOpenCheck, CheckCircle2, Circle, ClipboardCheck, Download, ExternalLink, FileText, LockKeyhole, PlayCircle, ShieldCheck, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

export default function AcademyCourse({ enrollmentId }: { enrollmentId: string }) {
  const numericEnrollmentId = Number(enrollmentId);
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.academy.agent.course.useQuery({ enrollmentId: numericEnrollmentId }, { enabled: Number.isInteger(numericEnrollmentId) && numericEnrollmentId > 0 });
  const viewLesson = trpc.academy.agent.viewLesson.useMutation();
  const completeLesson = trpc.academy.agent.completeLesson.useMutation({ onSuccess: () => { toast.success("Lesson completed"); utils.academy.agent.course.invalidate({ enrollmentId: numericEnrollmentId }); utils.academy.agent.home.invalidate(); } });
  const submitAssessment = trpc.academy.agent.submitAssessment.useMutation({ onSuccess: (result) => {
    if (result.status === "awaiting_marking") toast.success("Written response submitted. A JLT team member will mark it and send feedback.");
    else if (result.passed) toast.success(`Passed with ${result.score}%`);
    else toast.error(`You scored ${result.score}%. Please review the lesson and try again.`);
    utils.academy.agent.course.invalidate({ enrollmentId: numericEnrollmentId });
    utils.academy.agent.home.invalidate();
  }, onError: (error) => toast.error(error.message) });
  const acknowledgeAssessmentFeedback = trpc.academy.agent.acknowledgeAssessmentFeedback.useMutation({ onSuccess: (result) => {
    toast.success(result.passed ? "Feedback acknowledged — this lesson is now complete." : "Feedback acknowledged. Please update your response and submit again when you are ready.");
    utils.academy.agent.course.invalidate({ enrollmentId: numericEnrollmentId });
    utils.academy.agent.home.invalidate();
  }, onError: (error) => toast.error(error.message) });
  const [selectedLessonId, setSelectedLessonId] = useState<number | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [writtenAnswers, setWrittenAnswers] = useState<Record<number, string>>({});

  const lessons = useMemo(() => data?.modules.flatMap((module) => module.lessons) ?? [], [data]);
  const selectedLesson = lessons.find((lesson) => lesson.id === selectedLessonId) ?? lessons[0] ?? null;
  const feedbackBlockingLessonIndex = lessons.findIndex((lesson) => lesson.attempts.some((attempt) => attempt.status === "feedback_pending"));
  const pendingFeedback = selectedLesson?.attempts.find((attempt) => attempt.status === "feedback_pending") ?? null;
  const awaitingMarking = selectedLesson?.attempts.find((attempt) => attempt.status === "awaiting_marking") ?? null;
  const outstandingQuestions = selectedLesson?.questions.filter((question) => !question.resit.passed) ?? [];
  const passedQuestionCount = selectedLesson ? selectedLesson.questions.length - outstandingQuestions.length : 0;
  const supportRequired = outstandingQuestions.some((question) => question.resit.supportRequired);

  useEffect(() => {
    if (!data || selectedLessonId) return;
    const next = lessons.find((lesson) => lesson.isRequired && !lesson.progress?.completedAt) ?? lessons[0] ?? null;
    if (next) setSelectedLessonId(next.id);
  }, [data, lessons, selectedLessonId]);

  useEffect(() => {
    if (!selectedLesson) return;
    setAcknowledged(false);
    setAnswers({});
    setWrittenAnswers({});
    viewLesson.mutate({ enrollmentId: numericEnrollmentId, lessonId: selectedLesson.id });
  // Only record an intentional lesson switch, not every progress refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLesson?.id]);

  const chooseLesson = (lessonId: number) => {
    const targetIndex = lessons.findIndex((lesson) => lesson.id === lessonId);
    if (feedbackBlockingLessonIndex >= 0 && targetIndex > feedbackBlockingLessonIndex) {
      const blockingLesson = lessons[feedbackBlockingLessonIndex];
      toast.error(`Read and acknowledge the feedback for ${blockingLesson?.title ?? "your assessment"} before continuing.`);
      setSelectedLessonId(blockingLesson?.id ?? lessonId);
      return;
    }
    setSelectedLessonId(lessonId);
  };

  if (isLoading) return <div className="mx-auto max-w-7xl space-y-4 animate-pulse"><div className="h-10 w-32 rounded bg-muted" /><div className="h-24 rounded-2xl bg-muted" /><div className="h-[480px] rounded-2xl bg-muted" /></div>;
  if (error || !data) return <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6"><h1 className="font-semibold">Course could not be loaded</h1><p className="mt-1 text-sm text-muted-foreground">Return to Academy and try again.</p><Link href="/academy" className="mt-4 inline-flex text-sm font-semibold text-primary hover:underline">Back to Academy</Link></div>;
  if (!selectedLesson) return <div className="rounded-2xl border bg-card p-8 text-center"><LockKeyhole className="mx-auto text-muted-foreground" /><h1 className="mt-4 text-xl font-bold">This course is being prepared</h1><p className="mt-2 text-sm text-muted-foreground">Your JLT team will add lessons shortly.</p></div>;

  const canComplete = !selectedLesson.progress?.completedAt && (!selectedLesson.requiresAcknowledgement || acknowledged) && !selectedLesson.requiresAssessment;
  const hasAnsweredAll = outstandingQuestions.length > 0 && outstandingQuestions.every((question) => question.questionType === "free_text" ? !!writtenAnswers[question.id]?.trim() : answers[question.id] !== undefined);

  return (
    <div className="mx-auto max-w-7xl">
      <Link href="/academy" className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /> Back to Academy</Link>
      <header className="rounded-2xl border bg-card p-5 shadow-sm md:p-6"><div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">JLT Academy</p><h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">{data.course.title}</h1>{data.course.summary && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{data.course.summary}</p>}</div><div className="min-w-44"><div className="mb-1.5 flex justify-between text-xs font-medium"><span>Course progress</span><span>{data.progress.percentage}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[#00c9b4]" style={{ width: `${data.progress.percentage}%` }} /></div><p className="mt-1.5 text-right text-xs text-muted-foreground">{data.progress.completedRequiredLessons} / {data.progress.requiredLessons} required</p></div></div></header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border bg-card p-3 shadow-sm lg:sticky lg:top-6">
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Course lessons</p>
          <div className="space-y-3">{data.modules.map((module, index) => <section key={module.id}><p className="px-2 py-1 text-xs font-semibold text-foreground">{index + 1}. {module.title}</p><div className="space-y-1">{module.lessons.map((lesson) => { const complete = !!lesson.progress?.completedAt; const current = lesson.id === selectedLesson.id; const blockedByFeedback = feedbackBlockingLessonIndex >= 0 && lessons.findIndex((item) => item.id === lesson.id) > feedbackBlockingLessonIndex; return <button type="button" key={lesson.id} disabled={blockedByFeedback} onClick={() => chooseLesson(lesson.id)} title={blockedByFeedback ? "Read and acknowledge your assessment feedback first" : undefined} className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition ${current ? "bg-[#70FFE8]/25 text-foreground" : blockedByFeedback ? "cursor-not-allowed opacity-45" : "hover:bg-muted/70 text-muted-foreground"}`}><span className="mt-0.5 shrink-0">{complete ? <CheckCircle2 size={16} className="text-emerald-600" /> : blockedByFeedback ? <LockKeyhole size={15} /> : current ? <PlayCircle size={16} className="text-primary" /> : <Circle size={16} />}</span><span className="min-w-0 flex-1 leading-5">{lesson.title}{lesson.isRequired && <span className="ml-1 text-[10px] font-semibold uppercase text-muted-foreground">Required</span>}</span></button>; })}</div></section>)}</div>
        </aside>

        <main className="min-w-0 rounded-2xl border bg-card p-5 shadow-sm md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"><BookOpenCheck size={14} /> Lesson</div><h2 className="mt-2 text-2xl font-bold tracking-tight">{selectedLesson.title}</h2>{selectedLesson.summary && <p className="mt-2 max-w-3xl text-muted-foreground">{selectedLesson.summary}</p>}</div>{selectedLesson.progress?.completedAt ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-800"><CheckCircle2 size={15} /> Completed</span> : <span className="rounded-full bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground">In progress</span>}</div>

          {(selectedLesson.contentHtml || selectedLesson.videoUrl || selectedLesson.attachmentUrl) && <div className="mt-7 space-y-6">
            {selectedLesson.contentHtml && <div className="academy-lesson-content prose prose-slate max-w-none prose-headings:font-bold prose-p:my-4 prose-p:leading-relaxed prose-ul:my-4 prose-ul:list-disc prose-ul:pl-7 prose-ol:my-4 prose-ol:list-decimal prose-ol:pl-7 prose-li:my-1 prose-a:text-primary prose-a:underline prose-img:rounded-xl prose-table:w-full prose-table:border-collapse prose-th:border prose-th:border-slate-200 prose-th:bg-slate-50 prose-th:p-2 prose-th:text-left prose-td:border prose-td:border-slate-200 prose-td:p-2" dangerouslySetInnerHTML={{ __html: selectedLesson.contentHtml }} />}
            {selectedLesson.videoUrl && <a href={selectedLesson.videoUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-4 rounded-xl border border-[#70FFE8]/60 bg-[#70FFE8]/10 p-4 transition hover:bg-[#70FFE8]/20"><span className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-lg bg-[#414141] text-[#70FFE8]"><PlayCircle size={20} /></span><span><span className="block font-semibold">Watch the lesson video</span><span className="mt-0.5 block text-xs text-muted-foreground">Opens the approved video in a new tab</span></span></span><ExternalLink size={18} className="shrink-0" /></a>}
            {selectedLesson.attachmentUrl && <a href={selectedLesson.attachmentUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-4 rounded-xl border bg-muted/30 p-4 transition hover:bg-muted"><span className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-lg bg-card text-primary shadow-sm"><FileText size={20} /></span><span><span className="block font-semibold">{selectedLesson.attachmentName || "Download lesson resource"}</span><span className="mt-0.5 block text-xs text-muted-foreground">Open or save your copy</span></span></span><Download size={18} className="shrink-0" /></a>}
          </div>}

          {selectedLesson.requiresAcknowledgement && !selectedLesson.progress?.completedAt && <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50/70 p-4"><div className="flex gap-3"><Checkbox id="academy-acknowledgement" checked={acknowledged} onCheckedChange={(checked) => setAcknowledged(checked === true)} /><label htmlFor="academy-acknowledgement" className="cursor-pointer text-sm leading-6"><span className="font-semibold">I confirm I have read and understood this lesson.</span><span className="mt-0.5 block text-muted-foreground">This acknowledgement is recorded against your Academy learning record.</span></label></div></div>}

          {selectedLesson.requiresAssessment && !selectedLesson.progress?.completedAt && <section className="mt-8 rounded-xl border bg-muted/20 p-4 md:p-5">
            <div className="flex items-center gap-2"><ClipboardCheck className="text-primary" size={20} /><div><h3 className="font-bold">Knowledge check</h3><p className="text-sm text-muted-foreground">Pass mark: {selectedLesson.assessmentPassMark}%. Multiple-choice answers are checked immediately; written answers are marked by the JLT team.</p></div></div>

            {pendingFeedback ? <div className="mt-5 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-amber-950"><p className="font-bold">Your feedback needs acknowledgement</p><p className="mt-1 text-sm leading-6">Read the feedback below. You must acknowledge it before you can move on in this course.</p><div className="mt-4 rounded-lg border border-amber-200 bg-background p-3"><p className="text-sm font-semibold">Assessment outcome: {pendingFeedback.score}% — {pendingFeedback.passed ? "passed" : "targeted resit needed"}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{pendingFeedback.graderFeedback}</p></div><div className="mt-4 space-y-3">{selectedLesson.questions.filter((question) => question.questionType === "free_text").map((question, index) => { const response = pendingFeedback.responses.find((item) => item.questionId === question.id); return <div key={question.id} className="rounded-lg border border-amber-200 bg-background p-3"><p className="font-semibold">Written question {index + 1}: {question.prompt}</p><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">Your answer: {response?.responseText || "—"}</p><p className="mt-3 text-sm font-semibold">Score: {response?.score ?? 0}%</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{response?.feedback || "No question-level feedback was recorded."}</p></div>; })}</div><Button className="mt-5" disabled={acknowledgeAssessmentFeedback.isPending} onClick={() => acknowledgeAssessmentFeedback.mutate({ attemptId: pendingFeedback.id })}>{acknowledgeAssessmentFeedback.isPending ? "Recording acknowledgement..." : "I have read and acknowledge this feedback"}</Button></div> : awaitingMarking ? <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950"><p className="font-bold">Written response submitted for marking</p><p className="mt-1 text-sm leading-6">A JLT team member will review your response and send feedback here. You cannot continue to the next lesson until you have read and acknowledged that feedback.</p></div> : supportRequired ? <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-950"><p className="font-bold">JLT team support required</p><p className="mt-1 text-sm leading-6">You have used the three available attempts for an outstanding question. A JLT team member will review your progress and reopen the question after support.</p></div> : <>
              {passedQuestionCount > 0 && <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><span className="font-semibold">{passedQuestionCount} {passedQuestionCount === 1 ? "question is" : "questions are"} already complete.</span> Only the outstanding {outstandingQuestions.length === 1 ? "question is" : "questions are"} shown below.</div>}
              <div className="mt-5 space-y-5">{outstandingQuestions.map((question, index) => <fieldset key={question.id}><legend className="font-medium leading-6"><span className="mr-1.5 text-muted-foreground">{index + 1}.</span>{question.prompt}<span className="ml-2 text-xs font-medium text-muted-foreground">Attempt {question.resit.attemptCount + 1} of 3</span></legend>{question.questionType === "free_text" ? <div className="mt-2"><Textarea value={writtenAnswers[question.id] ?? ""} rows={6} placeholder="Type your answer here. Pasting is disabled for written questions." onPaste={(event) => { event.preventDefault(); toast.error("Pasting is disabled for written Academy answers."); }} onDrop={(event) => { event.preventDefault(); toast.error("Dropping text is disabled for written Academy answers."); }} onChange={(event) => { const next = event.target.value; if (countWords(next) > question.maxWords) { toast.error(`This answer is limited to ${question.maxWords} words.`); return; } setWrittenAnswers((current) => ({ ...current, [question.id]: next })); }} /><p className="mt-1 text-right text-xs text-muted-foreground">{countWords(writtenAnswers[question.id] ?? "")} / {question.maxWords} words · Paste disabled</p></div> : <div className="mt-2 space-y-2">{question.answerOptions.map((option, optionIndex) => <label key={`${question.id}-${optionIndex}`} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition ${answers[question.id] === optionIndex ? "border-primary bg-primary/5" : "bg-background hover:bg-muted/50"}`}><input type="radio" className="mt-0.5" name={`question-${question.id}`} checked={answers[question.id] === optionIndex} onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))} /><span>{option}</span></label>)}</div>}</fieldset>)}</div>{outstandingQuestions.length ? <Button className="mt-6" disabled={!hasAnsweredAll || submitAssessment.isPending} onClick={() => submitAssessment.mutate({ enrollmentId: numericEnrollmentId, lessonId: selectedLesson.id, answers: outstandingQuestions.map((question) => question.questionType === "free_text" ? ({ questionId: question.id, responseText: writtenAnswers[question.id] }) : ({ questionId: question.id, selectedIndex: answers[question.id] })) })}>{submitAssessment.isPending ? "Submitting..." : outstandingQuestions.some((question) => question.questionType === "free_text") ? "Submit outstanding answers for marking" : "Submit outstanding questions"}</Button> : <div className="mt-5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">All questions in this knowledge check have been passed.</div>}</>}
          </section>}

          {!selectedLesson.progress?.completedAt && !selectedLesson.requiresAssessment && <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-6"><p className="text-sm text-muted-foreground">{selectedLesson.requiresAcknowledgement ? "Confirm your acknowledgement, then save this lesson as complete." : "When you are ready, save this lesson as complete."}</p><Button disabled={!canComplete || completeLesson.isPending} onClick={() => completeLesson.mutate({ enrollmentId: numericEnrollmentId, lessonId: selectedLesson.id, acknowledged })}><ShieldCheck className="mr-2" size={17} />{completeLesson.isPending ? "Saving..." : "Complete lesson"}</Button></div>}
          {data.progress.isComplete && <div className="mt-8 flex items-center gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-900"><Trophy size={22} className="text-emerald-600" /><div><p className="font-bold">Course complete</p><p className="text-sm text-emerald-800">Your completion has been recorded in your Academy learning history.</p></div></div>}
        </main>
      </div>
    </div>
  );
}
