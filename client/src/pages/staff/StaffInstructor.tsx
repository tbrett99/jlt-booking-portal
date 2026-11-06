import { useState } from "react";
import { BookOpen, Plus } from "lucide-react";
import { toast } from "sonner";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { RichEmailEditor, lessonHtmlToPlainText, plainTextToLessonHtml } from "@/components/RichEmailEditor";
import { AcademyQuestionRichTextEditor } from "@/components/AcademyQuestionRichTextEditor";
import {
  StaffField,
  StaffMutationError,
  StaffNotice,
  StaffQueryState,
  staffControl,
  useStaffAuthority,
} from "./StaffWorkspace";
import StaffMarking from "./StaffMarking";
import StaffImageUpload from "./StaffImageUpload";

type Inputs = inferRouterInputs<AppRouter>["academy"]["admin"];
type Editor = inferRouterOutputs<AppRouter>["academy"]["admin"]["editor"];
type Module = Editor["modules"][number];
type Lesson = Module["lessons"][number];
type LessonDraft = Inputs["saveLesson"];
type Question = Inputs["replaceQuestions"]["questions"][number];
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const attachmentMimes = [
  "application/pdf",
  DOCX,
  XLSX,
  "text/plain",
  "text/csv",
] as const;
const templateMimes = ["application/pdf", DOCX, XLSX] as const;
function lessonDraft(moduleId: number, lesson?: Lesson): LessonDraft {
  return {
    id: lesson?.id,
    moduleId,
    title: lesson?.title ?? "",
    summary: lesson?.summary ?? "",
    contentHtml: lesson?.contentHtml ?? "",
    videoUrl: lesson?.videoUrl ?? "",
    videoTranscript: lesson?.videoTranscript ?? "",
    attachmentUrl: lesson?.attachmentUrl ?? null,
    attachmentKey: lesson?.attachmentKey ?? null,
    attachmentName: lesson?.attachmentName ?? null,
    estimatedMinutes: lesson?.estimatedMinutes ?? 5,
    isRequired: lesson?.isRequired ?? true,
    requiresAcknowledgement: lesson?.requiresAcknowledgement ?? false,
    requiresAssessment: lesson?.requiresAssessment ?? false,
    assessmentMode: lesson?.assessmentMode ?? "quiz",
    assessmentPassMark: lesson?.assessmentPassMark ?? 90,
    assessmentTemplateKey: lesson?.assessmentTemplateKey ?? null,
    assessmentTemplateName: lesson?.assessmentTemplateName ?? null,
    assessmentTemplateMimeType: templateMimes.includes(
      lesson?.assessmentTemplateMimeType as (typeof templateMimes)[number]
    )
      ? (lesson?.assessmentTemplateMimeType as (typeof templateMimes)[number])
      : null,
    assessmentTemplateSize: lesson?.assessmentTemplateSize ?? null,
  };
}
async function fileBase64(file: File) {
  if (!file.size || file.size > 10 * 1024 * 1024)
    throw new Error("Choose a non-empty file up to 10 MB.");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

export default function StaffInstructor() {
  const access = useStaffAuthority();
  const [courseId, setCourseId] = useState<number | null>(null);
  const [tab, setTab] = useState<"builder" | "written" | "documents">(
    "builder"
  );
  const courses = trpc.academy.admin.courses.useQuery(undefined, {
    enabled: access.instructor && access.schemaAvailable,
    retry: false,
  });
  const permittedCourses = (courses.data ?? []).filter(course =>
    access.courseIds.includes(course.id)
  );
  const permitted =
    access.instructor &&
    courseId !== null &&
    access.courseIds.includes(courseId);
  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <BookOpen size={18} />
          Instructor
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Teach, improve and give useful feedback.
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          Only your explicitly assigned courses are available here. Content
          changes save directly to the assigned course; publication, enrolment
          and Academy settings remain with an administrator.
        </p>
      </header>
      <StaffQueryState query={courses}>
        <StaffField label="Assigned course">
          <select
            className={`${staffControl} max-w-xl`}
            value={courseId ?? ""}
            onChange={event =>
              setCourseId(
                event.target.value ? Number(event.target.value) : null
              )
            }
          >
            <option value="">Choose a course to work on</option>
            {permittedCourses.map(course => (
              <option key={course.id} value={course.id}>
                #{course.id} · {course.title} · {course.status}
              </option>
            ))}
          </select>
        </StaffField>
        {!permittedCourses.length && (
          <StaffNotice title="No assigned courses available">
            Ask a Super Admin to select explicit existing course IDs after the
            course is built. Courses are never assigned automatically by title.
          </StaffNotice>
        )}
      </StaffQueryState>
      <nav
        aria-label="Instructor tasks"
        className="flex flex-wrap gap-2 border-b pb-3"
      >
        {(
          [
            ["builder", "Course builder"],
            ["written", "Written marking"],
            ["documents", "Document marking"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={tab === value ? "default" : "outline"}
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
          >
            {label}
          </Button>
        ))}
      </nav>
      {tab === "builder" ? (
        permitted ? (
          <CourseBuilder key={courseId} courseId={courseId!} />
        ) : (
          <StaffNotice title="Select an assigned course">
            Choose an existing course above to edit its modules, lessons,
            resources and assessments.
          </StaffNotice>
        )
      ) : (
        <StaffMarking
          key={`${tab}-${courseId}`}
          kind={tab}
          courseId={permitted ? courseId : null}
        />
      )}
    </div>
  );
}

function CourseBuilder({ courseId }: { courseId: number }) {
  const access = useStaffAuthority();
  const editor = trpc.academy.admin.editor.useQuery(
    { courseId },
    {
      enabled: access.instructor && access.courseIds.includes(courseId),
      retry: false,
    }
  );
  return (
    <StaffQueryState query={editor}>
      {editor.data && (
        <BuilderForms
          key={editor.data.course.id}
          data={editor.data}
          refresh={() => void editor.refetch()}
        />
      )}
    </StaffQueryState>
  );
}
function BuilderForms({
  data,
  refresh,
}: {
  data: Editor;
  refresh: () => void;
}) {
  const access = useStaffAuthority();
  const allowed =
    access.instructor && access.courseIds.includes(data.course.id);
  const [selection, setSelection] = useState<
    | { type: "course" }
    | { type: "module"; module?: Module }
    | { type: "lesson"; module: Module; lesson?: Lesson }
  >({ type: "course" });
  const [revision, setRevision] = useState(0);
  function select(next: typeof selection) {
    setSelection(next);
    setRevision(value => value + 1);
  }
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[270px_minmax(0,1fr)]">
      <aside className="space-y-3 rounded-xl border bg-card p-4 text-card-foreground">
        <Button
          className="w-full justify-start"
          variant="outline"
          onClick={() => select({ type: "course" })}
        >
          Course details
        </Button>
        {data.modules.map(module => (
          <div key={module.id} className="border-t pt-3">
            <button
              className="w-full rounded-md px-2 py-2 text-left text-sm font-semibold hover:bg-muted"
              onClick={() => select({ type: "module", module })}
            >
              {module.title}
            </button>
            <div className="mt-1 space-y-1 border-l pl-2">
              {module.lessons.map(lesson => (
                <button
                  key={lesson.id}
                  className="block w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => select({ type: "lesson", module, lesson })}
                >
                  {lesson.title}
                </button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                disabled={!allowed}
                onClick={() => select({ type: "lesson", module })}
              >
                <Plus size={14} className="mr-1" />
                Add lesson
              </Button>
            </div>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={!allowed}
          onClick={() => select({ type: "module" })}
        >
          <Plus size={14} className="mr-1" />
          Add module
        </Button>
      </aside>
      <section className="rounded-xl border bg-card p-5 text-card-foreground">
        {selection.type === "course" ? (
          <CourseForm
            key={`course-${revision}`}
            course={data.course}
            allowed={allowed}
            refresh={refresh}
          />
        ) : selection.type === "module" ? (
          <ModuleForm
            key={`module-${revision}`}
            courseId={data.course.id}
            module={selection.module}
            allowed={allowed}
            refresh={refresh}
          />
        ) : (
          <LessonForm
            key={`lesson-${revision}`}
            courseId={data.course.id}
            module={selection.module}
            lesson={selection.lesson}
            allowed={allowed}
            refresh={refresh}
          />
        )}
      </section>
    </div>
  );
}
function CourseForm({
  course,
  allowed,
  refresh,
}: {
  course: Editor["course"];
  allowed: boolean;
  refresh: () => void;
}) {
  const [draft, setDraft] = useState({
    title: course.title,
    summary: course.summary ?? "",
    coverImageUrl: course.coverImageUrl ?? "",
    estimatedMinutes: course.estimatedMinutes,
  });
  const save = trpc.academy.admin.saveCourse.useMutation({
    onSuccess: () => {
      toast.success("Assigned course updated");
      refresh();
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={event => {
        event.preventDefault();
        if (allowed)
          save.mutate({
            ...draft,
            id: course.id,
            coverImageUrl: draft.coverImageUrl.trim() || null,
            isCoreAcademy: course.isCoreAcademy,
            isAcceleratorJourney: course.isAcceleratorJourney,
          });
      }}
    >
      <h2 className="text-xl font-semibold">Course details</h2>
      <p className="text-xs text-muted-foreground">
        Existing course #{course.id} · {course.status}. Changes update this
        course directly.
      </p>
      <fieldset className="space-y-4" disabled={!allowed || save.isPending}>
        <StaffField label="Course title">
          <input
            required
            minLength={2}
            maxLength={255}
            className={staffControl}
            value={draft.title}
            onChange={event =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
        </StaffField>
        <StaffField label="Course summary">
          <textarea
            maxLength={10000}
            rows={4}
            className={staffControl}
            value={draft.summary}
            onChange={event =>
              setDraft({ ...draft, summary: event.target.value })
            }
          />
        </StaffField>
        <StaffField label="Cover image HTTPS URL">
          <input
            type="url"
            className={staffControl}
            value={draft.coverImageUrl}
            onChange={event =>
              setDraft({ ...draft, coverImageUrl: event.target.value })
            }
          />
        </StaffField>
        <StaffImageUpload
          courseId={course.id}
          onUploaded={url =>
            setDraft(current => ({ ...current, coverImageUrl: url }))
          }
        />
        <StaffField label="Estimated minutes">
          <input
            type="number"
            min={0}
            max={10000}
            className={staffControl}
            value={draft.estimatedMinutes}
            onChange={event =>
              setDraft({
                ...draft,
                estimatedMinutes: Number(event.target.value),
              })
            }
          />
        </StaffField>
        <StaffMutationError error={save.error} />
        <Button type="submit">
          {save.isPending ? "Saving…" : "Save course details"}
        </Button>
      </fieldset>
    </form>
  );
}
function ModuleForm({
  courseId,
  module,
  allowed,
  refresh,
}: {
  courseId: number;
  module?: Module;
  allowed: boolean;
  refresh: () => void;
}) {
  const [draft, setDraft] = useState({
    title: module?.title ?? "",
    summary: module?.summary ?? "",
  });
  const [savedModuleId, setSavedModuleId] = useState(module?.id);
  const save = trpc.academy.admin.saveModule.useMutation({
    onSuccess: result => {
      setSavedModuleId(result.id);
      toast.success("Module saved");
      refresh();
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={event => {
        event.preventDefault();
        if (allowed)
          save.mutate({
            ...draft,
            id: savedModuleId,
            courseId,
            releaseWeek: module?.releaseWeek ?? 0,
          });
      }}
    >
      <h2 className="text-xl font-semibold">
        {savedModuleId ? "Edit module" : "Add module"}
      </h2>
      <fieldset disabled={!allowed || save.isPending} className="space-y-4">
        <StaffField label="Module title">
          <input
            className={staffControl}
            minLength={2}
            maxLength={255}
            required
            value={draft.title}
            onChange={event =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
        </StaffField>
        <StaffField label="Module summary">
          <textarea
            className={staffControl}
            rows={4}
            maxLength={10000}
            value={draft.summary}
            onChange={event =>
              setDraft({ ...draft, summary: event.target.value })
            }
          />
        </StaffField>
        <StaffMutationError error={save.error} />
        <Button type="submit">
          {save.isPending ? "Saving…" : "Save module"}
        </Button>
      </fieldset>
    </form>
  );
}
function LessonForm({
  courseId,
  module,
  lesson,
  allowed,
  refresh,
}: {
  courseId: number;
  module: Module;
  lesson?: Lesson;
  allowed: boolean;
  refresh: () => void;
}) {
  const [draft, setDraft] = useState(() => lessonDraft(module.id, lesson));
  const [savedLessonId, setSavedLessonId] = useState<number | undefined>(
    lesson?.id
  );
  const [uploadError, setUploadError] = useState("");
  const [readingFile, setReadingFile] = useState(false);
  const [formatSummary, setFormatSummary] = useState<string | null>(null);
  const save = trpc.academy.admin.saveLesson.useMutation({
    onSuccess: result => {
      setSavedLessonId(result.id);
      setDraft(current => ({ ...current, id: result.id }));
      toast.success("Lesson saved");
      refresh();
    },
  });
  const attachment = trpc.academy.admin.uploadAttachment.useMutation();
  const template =
    trpc.academy.admin.uploadDocumentAssessmentTemplate.useMutation();
  const pending =
    save.isPending || attachment.isPending || template.isPending || readingFile;
  function change<K extends keyof LessonDraft>(key: K, value: LessonDraft[K]) {
    setDraft(current => ({ ...current, [key]: value }));
  }
  function smartFormatCurrentContent() {
    if (!allowed || pending || !draft.contentHtml?.trim()) return;
    const formatted = plainTextToLessonHtml(lessonHtmlToPlainText(draft.contentHtml));
    const headings = (formatted.match(/<h2>/g) ?? []).length;
    const bullets = (formatted.match(/<li>/g) ?? []).length;
    const summary = `Formatted ${headings} heading${headings === 1 ? "" : "s"} and ${bullets} bullet point${bullets === 1 ? "" : "s"}.`;
    change("contentHtml", formatted);
    setFormatSummary(summary);
    toast.success(summary);
  }
  async function upload(
    file: File | undefined,
    kind: "attachment" | "template"
  ) {
    if (!file || !allowed || pending) return;
    setUploadError("");
    setReadingFile(true);
    try {
      const base64 = await fileBase64(file);
      const mimeType =
        file.type ||
        (file.name.toLowerCase().endsWith(".csv")
          ? "text/csv"
          : file.name.toLowerCase().endsWith(".txt")
            ? "text/plain"
            : "");
      if (kind === "attachment") {
        if (
          !attachmentMimes.includes(
            mimeType as (typeof attachmentMimes)[number]
          )
        )
          throw new Error("Choose PDF, DOCX, XLSX, TXT or CSV.");
        const stored = await attachment.mutateAsync({
          courseId,
          fileName: file.name,
          fileBase64: base64,
          mimeType: mimeType as (typeof attachmentMimes)[number],
        });
        setDraft(current => ({
          ...current,
          attachmentUrl: stored.url,
          attachmentKey: stored.key,
          attachmentName: stored.name,
        }));
      } else {
        if (!templateMimes.includes(mimeType as (typeof templateMimes)[number]))
          throw new Error("Choose a PDF, DOCX or XLSX assessment template.");
        const stored = await template.mutateAsync({
          courseId,
          fileName: file.name,
          fileBase64: base64,
          mimeType: mimeType as (typeof templateMimes)[number],
        });
        setDraft(current => ({
          ...current,
          assessmentTemplateKey: stored.key,
          assessmentTemplateName: stored.name,
          assessmentTemplateMimeType: stored.mimeType,
          assessmentTemplateSize: stored.size,
        }));
      }
      toast.success("File uploaded. Save the lesson to attach it.");
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "Upload failed. No lesson changes were saved."
      );
    } finally {
      setReadingFile(false);
    }
  }
  return (
    <div className="space-y-6">
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          if (allowed && !pending) save.mutate(draft);
        }}
      >
        <h2 className="text-xl font-semibold">
          {savedLessonId ? "Edit lesson" : "Add lesson"}
        </h2>
        <p className="text-xs text-muted-foreground">
          Module: {module.title}. Learner evidence is protected by the server;
          incompatible assessment changes are rejected.
        </p>
        <fieldset disabled={!allowed || pending} className="space-y-4">
          <StaffField label="Lesson title">
            <input
              required
              minLength={2}
              maxLength={255}
              className={staffControl}
              value={draft.title}
              onChange={event => change("title", event.target.value)}
            />
          </StaffField>
          <StaffField label="Lesson summary">
            <textarea
              maxLength={10000}
              className={staffControl}
              rows={3}
              value={draft.summary ?? ""}
              onChange={event => change("summary", event.target.value)}
            />
          </StaffField>
          <section aria-label="Lesson content editor" className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Lesson content</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!allowed || pending || !draft.contentHtml?.trim()}
                onClick={smartFormatCurrentContent}
              >
                Smart format pasted text
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste directly from your source to keep headings, bold, italics,
              underline, bullets, numbered lists, links and tables—the same
              formatting tools as the regular Academy builder.
            </p>
            <p className="text-xs text-muted-foreground">
              Smart format is for text already pasted as plain lines. Check the
              preview before saving; it rebuilds text structure, not images or tables.
            </p>
            {formatSummary && (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800" role="status">
                {formatSummary} The preview below has been updated; save the
                lesson when you are happy with it.
              </p>
            )}
            <RichEmailEditor
              value={draft.contentHtml ?? ""}
              onChange={contentHtml => {
                if (!allowed || pending) return;
                change("contentHtml", contentHtml);
                setFormatSummary(null);
              }}
              placeholder="Write the practical guidance for this lesson…"
              preserveClipboardFormatting
              restrictedAcademy
              disabled={!allowed || pending}
              ariaLabel="Lesson content"
            />
          </section>
          <p className="text-xs text-muted-foreground">
            Content is sanitised on save. Use the course-scoped image upload
            below; video links and downloadable resources stay separate.
          </p>
          <StaffImageUpload
            courseId={courseId}
            onUploaded={url =>
              setDraft(current => ({
                ...current,
                contentHtml: `${current.contentHtml ?? ""}\n<p><img src="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" alt="Course image" /></p>`,
              }))
            }
          />
          <StaffField label="Video HTTPS URL">
            <input
              className={staffControl}
              type="url"
              value={draft.videoUrl ?? ""}
              onChange={event => change("videoUrl", event.target.value)}
            />
          </StaffField>
          <StaffField label="Private video transcript">
            <textarea
              className={staffControl}
              rows={5}
              maxLength={1000000}
              value={draft.videoTranscript ?? ""}
              onChange={event => change("videoTranscript", event.target.value)}
            />
          </StaffField>
          <StaffField label="Estimated minutes">
            <input
              className={staffControl}
              type="number"
              min={1}
              max={1440}
              required
              value={draft.estimatedMinutes}
              onChange={event =>
                change("estimatedMinutes", Number(event.target.value))
              }
            />
          </StaffField>
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["isRequired", "Required lesson"],
                ["requiresAcknowledgement", "Require acknowledgement"],
                ["requiresAssessment", "Require assessment"],
              ] as const
            ).map(([key, label]) => (
              <label className="flex items-center gap-2 text-sm" key={key}>
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={event => change(key, event.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="rounded-lg border p-4">
            <StaffField label="Lesson resource (up to 10 MB)">
              <input
                className={staffControl}
                type="file"
                accept=".pdf,.docx,.xlsx,.txt,.csv"
                onChange={event => {
                  void upload(event.target.files?.[0], "attachment");
                  event.target.value = "";
                }}
              />
            </StaffField>
            {draft.attachmentName && (
              <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                <span>{draft.attachmentName}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setDraft(current => ({
                      ...current,
                      attachmentUrl: null,
                      attachmentKey: null,
                      attachmentName: null,
                    }))
                  }
                >
                  Remove resource
                </Button>
              </div>
            )}
          </div>
          {draft.requiresAssessment && (
            <div className="space-y-4 rounded-lg border p-4">
              <StaffField label="Assessment type">
                <select
                  className={staffControl}
                  value={draft.assessmentMode}
                  onChange={event =>
                    change(
                      "assessmentMode",
                      event.target.value as LessonDraft["assessmentMode"]
                    )
                  }
                >
                  <option value="quiz">
                    Questions (multiple choice / written)
                  </option>
                  <option value="document_upload">Document upload</option>
                </select>
              </StaffField>
              <StaffField label="Written / document pass mark (%)">
                <input
                  className={staffControl}
                  type="number"
                  min={1}
                  max={100}
                  value={draft.assessmentPassMark}
                  onChange={event =>
                    change("assessmentPassMark", Number(event.target.value))
                  }
                />
              </StaffField>
              {draft.assessmentMode === "document_upload" && (
                <>
                  <StaffField label="Assessment template (PDF, DOCX or XLSX, up to 10 MB)">
                    <input
                      className={staffControl}
                      type="file"
                      accept=".pdf,.docx,.xlsx"
                      onChange={event => {
                        void upload(event.target.files?.[0], "template");
                        event.target.value = "";
                      }}
                    />
                  </StaffField>
                  <p className="text-sm text-muted-foreground">
                    {draft.assessmentTemplateName ||
                      "Upload a template before saving this assessment."}
                  </p>
                </>
              )}
            </div>
          )}
          {uploadError && (
            <p role="alert" className="text-sm text-red-700">
              {uploadError}
            </p>
          )}
          <StaffMutationError error={save.error} />
          <Button
            type="submit"
            disabled={
              pending ||
              (draft.assessmentMode === "document_upload" &&
                !draft.assessmentTemplateKey)
            }
          >
            {pending ? "Saving / uploading…" : "Save lesson"}
          </Button>
        </fieldset>
      </form>
      {draft.requiresAssessment &&
        draft.assessmentMode === "quiz" &&
        (savedLessonId ? (
          <QuestionForm
            key={savedLessonId}
            lessonId={savedLessonId}
            questions={lesson?.questions ?? []}
            allowed={allowed}
            refresh={refresh}
          />
        ) : (
          <StaffNotice title="Save the lesson before adding questions">
            Questions will be attached to its saved, scoped lesson ID.
          </StaffNotice>
        ))}
    </div>
  );
}
function QuestionForm({
  lessonId,
  questions,
  allowed,
  refresh,
}: {
  lessonId: number;
  questions: Lesson["questions"];
  allowed: boolean;
  refresh: () => void;
}) {
  const [draft, setDraft] = useState<Question[]>(() =>
    questions.map(question => ({
      id: question.id,
      prompt: question.prompt,
      questionType: question.questionType,
      answerOptions: Array.isArray(question.answerOptions)
        ? (question.answerOptions as string[])
        : [],
      correctAnswerIndex: question.correctAnswerIndex,
      maxWords: question.maxWords,
      explanation: question.explanation,
    }))
  );
  const save = trpc.academy.admin.replaceQuestions.useMutation({
    onSuccess: () => {
      toast.success("Questions saved");
      refresh();
    },
  });
  function change(index: number, patch: Partial<Question>) {
    setDraft(current =>
      current.map((question, position) =>
        position === index ? { ...question, ...patch } : question
      )
    );
  }
  return (
    <form
      className="space-y-4 border-t pt-5"
      onSubmit={event => {
        event.preventDefault();
        if (allowed) save.mutate({ lessonId, questions: draft });
      }}
    >
      <h3 className="text-lg font-semibold">Assessment questions</h3>
      <p className="text-xs leading-5 text-muted-foreground">
        Save questions separately after saving lesson details. After learner
        activity, only wording and private marking guides can change; the server
        protects the assessment structure.
      </p>
      <fieldset disabled={!allowed || save.isPending} className="space-y-4">
        {draft.map((question, index) => (
          <section key={index} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Question {index + 1}</h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setDraft(current =>
                    current.filter((_, position) => position !== index)
                  )
                }
              >
                Remove
              </Button>
            </div>
            <StaffField label={`Question ${index + 1} type`}>
              <select
                className={staffControl}
                value={question.questionType}
                onChange={event =>
                  change(index, {
                    questionType: event.target
                      .value as Question["questionType"],
                    answerOptions:
                      event.target.value === "free_text" ? [] : ["", ""],
                    correctAnswerIndex: 0,
                  })
                }
              >
                <option value="multiple_choice">Multiple choice</option>
                <option value="free_text">Written response</option>
              </select>
            </StaffField>
            <StaffField label={`Question ${index + 1} prompt`}>
              <AcademyQuestionRichTextEditor
                value={question.prompt}
                onChange={prompt => {
                  if (allowed && !save.isPending) change(index, { prompt });
                }}
                placeholder="Write the question and any supporting context…"
                label={`Question ${index + 1} prompt`}
                disabled={!allowed || save.isPending}
              />
            </StaffField>
            {question.questionType === "multiple_choice" ? (
              <>
                <StaffField
                  label={`Question ${index + 1} answer options (one per line)`}
                >
                  <textarea
                    className={staffControl}
                    rows={4}
                    required
                    value={question.answerOptions?.join("\n") ?? ""}
                    onChange={event =>
                      change(index, {
                        answerOptions: event.target.value.split("\n"),
                      })
                    }
                  />
                </StaffField>
                <StaffField label={`Question ${index + 1} correct answer`}>
                  <select
                    className={staffControl}
                    value={question.correctAnswerIndex}
                    onChange={event =>
                      change(index, {
                        correctAnswerIndex: Number(event.target.value),
                      })
                    }
                  >
                    {question.answerOptions?.map((option, position) => (
                      <option key={position} value={position}>
                        {position + 1}. {option || "Empty answer"}
                      </option>
                    ))}
                  </select>
                </StaffField>
              </>
            ) : (
              <StaffField label={`Question ${index + 1} maximum words`}>
                <input
                  className={staffControl}
                  type="number"
                  min={10}
                  max={2000}
                  value={question.maxWords}
                  onChange={event =>
                    change(index, { maxWords: Number(event.target.value) })
                  }
                />
              </StaffField>
            )}
            <StaffField
              label={`Question ${index + 1} explanation / private marking guide`}
            >
              <AcademyQuestionRichTextEditor
                value={question.explanation ?? ""}
                onChange={explanation => {
                  if (allowed && !save.isPending) change(index, { explanation });
                }}
                placeholder="Write the explanation or private marking criteria…"
                label={`Question ${index + 1} explanation / private marking guide`}
                disabled={!allowed || save.isPending}
              />
            </StaffField>
          </section>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setDraft(current => [
                ...current,
                {
                  prompt: "",
                  questionType: "multiple_choice",
                  answerOptions: ["", ""],
                  correctAnswerIndex: 0,
                  maxWords: 250,
                  explanation: "",
                },
              ])
            }
          >
            <Plus size={14} className="mr-1" />
            Add question
          </Button>
          <Button type="submit">
            {save.isPending ? "Saving questions…" : "Save questions"}
          </Button>
        </div>
        <StaffMutationError error={save.error} />
      </fieldset>
    </form>
  );
}
