import { ClipboardCheck, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

type ReviewQuestion = { id: number; prompt: string; questionType: string; answerOptions: string[] };
type ReviewAttempt = { score: number | null; graderFeedback: string | null; responses: { questionId: number; responseText: string | null; score: number | null; feedback: string | null }[] };

/** Completed evidence stays complete. Reviewing content never creates a new attempt. */
export function AcademyCompletedAssessment({ mode, questions, attempts, templateName, templateAvailable, downloadPending, downloadDisabled, onDownload, renderQuestion }: {
  mode: string;
  questions: ReviewQuestion[];
  attempts: ReviewAttempt[];
  templateName: string | null;
  templateAvailable: boolean;
  downloadPending: boolean;
  downloadDisabled: boolean;
  onDownload: () => void;
  renderQuestion: (prompt: string) => ReactNode;
}) {
  const latest = attempts[0];
  return <section className="mt-8 rounded-xl border bg-muted/20 p-4 md:p-5" aria-label="Completed assessment review">
    <div className="flex items-center gap-2"><ClipboardCheck className="text-primary" size={20} /><h3 className="font-bold">{mode === "document_upload" ? "Document assessment — review" : "Knowledge check — review"}</h3></div>
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
      <p className="font-semibold">This lesson is already recorded as complete.</p>
      <p className="mt-1">You can review its assessment material here. New answers or document uploads are not required while it remains complete. If this completion was recorded in error, ask the JLT team to reopen the lesson before submitting work.</p>
    </div>
    {mode === "document_upload" ? <div className="mt-5 flex flex-col gap-3 rounded-xl border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="font-semibold">Download the assessment template</p><p className="mt-1 text-sm text-muted-foreground">{templateName || "Assessment template"}</p>{!templateAvailable && <p className="mt-2 text-sm text-amber-800">No assessment template is currently attached. Contact the JLT team to add the document.</p>}</div>
      <Button type="button" variant="outline" disabled={!templateAvailable || downloadDisabled || downloadPending} onClick={onDownload}><Download className="mr-2" size={16} />{downloadPending ? "Preparing..." : "Download template"}</Button>
    </div> : <div className="mt-5 space-y-4">
      {questions.length ? questions.map((question, index) => {
        const response = attempts.flatMap(attempt => attempt.responses).find(item => item.questionId === question.id);
        return <article key={question.id} className="rounded-xl border bg-background p-4">
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Question {index + 1} · Review only</p>
          {renderQuestion(question.prompt)}
          {question.questionType === "multiple_choice" && <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{question.answerOptions.map((option, optionIndex) => <li key={optionIndex}>{option}</li>)}</ul>}
          {response?.responseText && <div className="mt-3 border-t pt-3"><p className="text-sm font-semibold">Your recorded answer</p><p className="mt-1 whitespace-pre-wrap text-sm">{response.responseText}</p>{response.feedback && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">Feedback: {response.feedback}</p>}</div>}
        </article>;
      }) : <p className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">No quiz questions are currently configured for this lesson. Contact the JLT team if questions were expected.</p>}
    </div>}
    {latest?.graderFeedback && <div className="mt-5 rounded-lg border bg-background p-4"><p className="font-semibold">Recorded assessment feedback{latest.score !== null ? ` · ${latest.score}%` : ""}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{latest.graderFeedback}</p></div>}
  </section>;
}
