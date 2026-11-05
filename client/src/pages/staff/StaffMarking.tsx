import { useState } from "react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  StaffField,
  StaffMutationError,
  StaffNotice,
  StaffQueryState,
  safeAssessmentDownload,
  staffControl,
  staffDate,
  useStaffAuthority,
} from "./StaffWorkspace";

type Outputs = inferRouterOutputs<AppRouter>["academy"]["admin"];
type Written = Outputs["markingQueue"][number];
type Document = Outputs["documentMarkingQueue"][number];
export default function StaffMarking({
  kind,
  courseId,
}: {
  kind: "written" | "documents";
  courseId: number | null;
}) {
  const access = useStaffAuthority();
  const { user } = useAuth();
  const allowed = access.instructor && access.schemaAvailable;
  const written = trpc.academy.admin.markingQueue.useQuery(undefined, {
    enabled: allowed && kind === "written",
    retry: false,
  });
  const documents = trpc.academy.admin.documentMarkingQueue.useQuery(
    undefined,
    { enabled: allowed && kind === "documents", retry: false, staleTime: 0 }
  );
  const [search, setSearch] = useState("");
  const query = kind === "written" ? written : documents;
  const inScope = (row: Written | Document) =>
    access.courseIds.includes(row.course.id) &&
    row.agent.id !== user?.id &&
    (!courseId || row.course.id === courseId) &&
    `${row.agent.name ?? ""} ${row.lesson.title}`
      .toLowerCase()
      .includes(search.toLowerCase());
  const writtenRows = (written.data ?? []).filter(inScope);
  const documentRows = (documents.data ?? []).filter(inScope);
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">
          {kind === "written"
            ? "Written assessment marking"
            : "Document assessment marking"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {courseId
            ? `Showing assigned course #${courseId}.`
            : "Showing all explicitly assigned courses."}{" "}
          A recorded mark releases feedback to the learner; completion still
          follows the Academy's genuine acknowledgement and progression rules.
          You cannot mark your own work.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <StaffField label="Search learner or lesson">
            <input
              className={staffControl}
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </StaffField>
        </div>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh queue / download links
        </Button>
      </div>
      <StaffQueryState
        query={query}
        empty={kind === "written" ? !writtenRows.length : !documentRows.length}
      >
        <div className="space-y-4">
          {kind === "written"
            ? writtenRows.map(row => (
                <WrittenReview
                  key={row.attempt.id}
                  row={row}
                  allowed={allowed}
                  refresh={() => void written.refetch()}
                />
              ))
            : documentRows.map(row => (
                <DocumentReview
                  key={row.attempt.id}
                  row={row}
                  allowed={allowed}
                  refresh={() => void documents.refetch()}
                />
              ))}
        </div>
      </StaffQueryState>
    </section>
  );
}
function ReviewHeading({ row }: { row: Written | Document }) {
  return (
    <header>
      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
        {row.course.title}
      </p>
      <h3 className="mt-1 text-lg font-semibold">{row.lesson.title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {row.agent.name || row.agent.email} · submitted{" "}
        {staffDate(row.attempt.takenAt)} · pass mark{" "}
        {row.lesson.assessmentPassMark}%
      </p>
    </header>
  );
}
function WrittenReview({
  row,
  allowed,
  refresh,
}: {
  row: Written;
  allowed: boolean;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState("");
  const [grades, setGrades] = useState<
    Record<number, { score: string; feedback: string }>
  >({});
  const [saved, setSaved] = useState(false);
  const mark = trpc.academy.admin.markWrittenAssessment.useMutation({
    onSuccess: () => {
      setSaved(true);
      toast.success("Written assessment feedback recorded");
      refresh();
    },
  });
  const valid =
    feedback.trim().length >= 3 &&
    row.responses.length > 0 &&
    row.responses.every(response => {
      const grade = grades[response.questionId];
      return (
        grade &&
        grade.score !== "" &&
        Number.isInteger(Number(grade.score)) &&
        Number(grade.score) >= 0 &&
        Number(grade.score) <= 100 &&
        grade.feedback.trim().length >= 3
      );
    });
  if (saved)
    return (
      <StaffNotice title="Feedback recorded">
        The assessment has left the marking queue. The learner must read and
        acknowledge the feedback.
      </StaffNotice>
    );
  return (
    <form
      className="space-y-5 rounded-xl border bg-card p-5 text-card-foreground"
      onSubmit={event => {
        event.preventDefault();
        if (allowed && valid)
          mark.mutate({
            attemptId: row.attempt.id,
            feedback,
            responses: row.responses.map(response => ({
              questionId: response.questionId,
              score: Number(grades[response.questionId].score),
              feedback: grades[response.questionId].feedback,
            })),
          });
      }}
    >
      <ReviewHeading row={row} />
      <fieldset disabled={!allowed || mark.isPending} className="space-y-4">
        {row.responses.map((response, index) => {
          const grade = grades[response.questionId] ?? {
            score: "",
            feedback: "",
          };
          const update = (patch: Partial<typeof grade>) =>
            setGrades(current => ({
              ...current,
              [response.questionId]: { ...grade, ...patch },
            }));
          return (
            <section
              key={response.questionId}
              className="space-y-3 rounded-lg border bg-muted/20 p-4"
            >
              <h4 className="text-sm font-semibold">
                {index + 1}. {response.prompt}
              </h4>
              <p className="whitespace-pre-wrap rounded-lg border bg-background p-3 text-sm leading-6">
                {response.responseText || "No written text recorded."}
              </p>
              {response.explanation && (
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium">
                    Private marking guide
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                    {response.explanation}
                  </p>
                </details>
              )}
              <StaffField label={`Response ${index + 1} score (%)`}>
                <input
                  className={staffControl}
                  type="number"
                  min={0}
                  max={100}
                  required
                  value={grade.score}
                  onChange={event => update({ score: event.target.value })}
                />
              </StaffField>
              <StaffField label={`Response ${index + 1} feedback to learner`}>
                <textarea
                  className={staffControl}
                  rows={3}
                  minLength={3}
                  maxLength={10000}
                  required
                  value={grade.feedback}
                  onChange={event => update({ feedback: event.target.value })}
                />
              </StaffField>
            </section>
          );
        })}
        <StaffField label="Overall feedback to learner">
          <textarea
            className={staffControl}
            rows={4}
            minLength={3}
            maxLength={10000}
            required
            value={feedback}
            onChange={event => setFeedback(event.target.value)}
          />
        </StaffField>
        <StaffMutationError error={mark.error} />
        <Button type="submit" disabled={!valid || mark.isPending}>
          {mark.isPending
            ? "Recording feedback…"
            : "Record marks and release feedback"}
        </Button>
      </fieldset>
    </form>
  );
}
function DocumentReview({
  row,
  allowed,
  refresh,
}: {
  row: Document;
  allowed: boolean;
  refresh: () => void;
}) {
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saved, setSaved] = useState(false);
  const mark = trpc.academy.admin.markDocumentAssessment.useMutation({
    onSuccess: () => {
      setSaved(true);
      toast.success("Document assessment feedback recorded");
      refresh();
    },
  });
  const valid =
    score !== "" &&
    Number.isInteger(Number(score)) &&
    Number(score) >= 0 &&
    Number(score) <= 100 &&
    feedback.trim().length >= 3;
  const submission = safeAssessmentDownload(row.submissionDownloadUrl);
  const template = safeAssessmentDownload(row.templateDownloadUrl);
  if (saved)
    return (
      <StaffNotice title="Document feedback recorded">
        The assessment has left the marking queue. The learner must read and
        acknowledge the feedback.
      </StaffNotice>
    );
  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground"
      onSubmit={event => {
        event.preventDefault();
        if (allowed && valid)
          mark.mutate({
            attemptId: row.attempt.id,
            score: Number(score),
            feedback,
          });
      }}
    >
      <ReviewHeading row={row} />
      <div className="flex flex-wrap gap-3">
        {submission && (
          <a
            className="rounded-lg border px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-muted"
            href={submission}
            target="_blank"
            rel="noopener noreferrer"
          >
            Download {row.attempt.submissionFileName || "submitted assessment"}
          </a>
        )}
        {template && (
          <a
            className="rounded-lg border px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-muted"
            href={template}
            target="_blank"
            rel="noopener noreferrer"
          >
            Download assessment template
          </a>
        )}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Downloads use short-lived, authenticated links. Refresh the queue if a
        link expires; access is checked again by the download service.
      </p>
      <fieldset disabled={!allowed || mark.isPending} className="space-y-4">
        <StaffField label="Document score (%)">
          <input
            className={staffControl}
            type="number"
            min={0}
            max={100}
            required
            value={score}
            onChange={event => setScore(event.target.value)}
          />
        </StaffField>
        <StaffField label="Document feedback to learner">
          <textarea
            className={staffControl}
            rows={5}
            required
            minLength={3}
            maxLength={10000}
            value={feedback}
            onChange={event => setFeedback(event.target.value)}
          />
        </StaffField>
        <StaffMutationError error={mark.error} />
        <Button type="submit" disabled={!valid || mark.isPending}>
          {mark.isPending
            ? "Recording feedback…"
            : "Record mark and release feedback"}
        </Button>
      </fieldset>
    </form>
  );
}
