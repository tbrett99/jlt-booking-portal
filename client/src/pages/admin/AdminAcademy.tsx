import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  CirclePlus,
  Clock3,
  Download,
  Eye,
  FileText,
  GraduationCap,
  LayoutList,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
  UsersRound,
  Video,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useViewMode } from "@/contexts/ViewModeContext";
import {
  lessonHtmlToPlainText,
  plainTextToLessonHtml,
  RichEmailEditor,
} from "@/components/RichEmailEditor";
import { academyQuizCsvTemplate, MAX_ACADEMY_ASSESSMENT_QUESTIONS } from "@shared/academy-quiz-csv";
import {
  formatAcademyQuestionPrompt,
  splitAcademyQuestionInlineFormatting,
} from "@shared/academy-question-format";
import { AcademyQuestionRichTextEditor } from "@/components/AcademyQuestionRichTextEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const emptyCourse = {
  title: "",
  summary: "",
  estimatedMinutes: 0,
  isCoreAcademy: false,
  isAcceleratorJourney: false,
};
type DraftQuestion = {
  prompt: string;
  questionType: "multiple_choice" | "free_text";
  answerOptions: string[];
  correctAnswerIndex: number;
  maxWords: number;
  explanation: string;
};
const emptyLesson = {
  title: "",
  summary: "",
  contentHtml: "",
  videoUrl: "",
  videoTranscript: "",
  attachmentUrl: "",
  attachmentKey: "",
  attachmentName: "",
  estimatedMinutes: 5,
  isRequired: true,
  requiresAcknowledgement: false,
  requiresAssessment: false,
  assessmentPassMark: 80,
  questions: [] as DraftQuestion[],
};

function dateForInput(value: Date | string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
function formatDate(value: Date | string | null | undefined) {
  return value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
}
function formatDateTime(value: Date | string | null | undefined) {
  return value
    ? new Date(value).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}
function formatActiveDuration(value: number | null | undefined) {
  const total = Math.max(0, Math.round(Number(value ?? 0)));
  if (!total) return "Not recorded yet";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function downloadQuizCsvTemplate() {
  const blob = new Blob([academyQuizCsvTemplate], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "jlt-academy-multiple-choice-quiz-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function AcademyStructuredText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <div className={`academy-structured-question space-y-3 ${className}`}>
      {formatAcademyQuestionPrompt(text).map((block, index) => {
        const renderText = (value: string) =>
          splitAcademyQuestionInlineFormatting(value).map((part, partIndex) => {
            const content = part.text.split("\n").map((line, lineIndex) => (
              <span key={lineIndex}>
                {line}
                {lineIndex < part.text.split("\n").length - 1 && <br />}
              </span>
            ));
            return part.bold ? (
              <strong key={partIndex}>{content}</strong>
            ) : part.italic ? (
              <em key={partIndex}>{content}</em>
            ) : (
              <span key={partIndex}>{content}</span>
            );
          });
        if (block.type === "heading")
          return (
            <p key={index} className="font-semibold leading-6">
              {renderText(block.text)}
            </p>
          );
        if (block.type === "bullet_list")
          return (
            <ul key={index} className="list-disc space-y-1 pl-5 leading-6">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderText(item)}</li>
              ))}
            </ul>
          );
        if (block.type === "numbered_list")
          return (
            <ol key={index} className="list-decimal space-y-1 pl-5 leading-6">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderText(item)}</li>
              ))}
            </ol>
          );
        return (
          <p key={index} className="whitespace-pre-line leading-6">
            {renderText(block.text)}
          </p>
        );
      })}
    </div>
  );
}

function QuestionFormatPreview({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  if (!text.trim()) return null;
  return (
    <div className="mt-3 rounded-lg border border-dashed bg-background/80 p-3">
      <p className="text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">
        {title}
      </p>
      <AcademyStructuredText text={text} className="mt-2 text-sm" />
    </div>
  );
}

export default function AdminAcademy() {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const { setViewMode } = useViewMode();
  const { data: courses = [], isLoading: coursesLoading } =
    trpc.academy.admin.courses.useQuery();
  const [courseId, setCourseId] = useState<number | null>(null);
  const {
    data: editor,
    error: editorError,
    isLoading: editorLoading,
    isRefetching: editorRefetching,
    refetch: refetchEditor,
  } = trpc.academy.admin.editor.useQuery(
    { courseId: courseId ?? 0 },
    { enabled: !!courseId }
  );
  const [courseDraft, setCourseDraft] = useState(emptyCourse);
  const [moduleTitle, setModuleTitle] = useState("");
  const [moduleSummary, setModuleSummary] = useState("");
  const [moduleReleaseWeek, setModuleReleaseWeek] = useState(0);
  const [openModuleId, setOpenModuleId] = useState<number | null>(null);
  const [editingModuleId, setEditingModuleId] = useState<number | null>(null);
  const [editingModuleDraft, setEditingModuleDraft] = useState({
    title: "",
    summary: "",
    releaseWeek: 0,
  });
  const [editingLessonId, setEditingLessonId] = useState<number | null>(null);
  const [lessonModuleId, setLessonModuleId] = useState<number | null>(null);
  const [lessonDraft, setLessonDraft] = useState(emptyLesson);
  const [alertDraft, setAlertDraft] = useState({
    moduleId: "",
    eventType: "week_released" as "week_released" | "module_started" | "module_completed" | "action_submitted_for_review" | "action_overdue" | "course_completed" | "written_assessment_ready" | "three_attempt_lock",
    recipientType: "support" as "support" | "custom",
    recipientEmail: "",
    recipientName: "",
    subjectTemplate: "Academy alert: {{event_label}} — {{agent_name}}",
    bodyHtmlTemplate: "<p><strong>{{agent_name}}</strong> has triggered an Academy alert.</p><p><strong>Course:</strong> {{course_title}}<br /><strong>Module:</strong> {{module_title}}<br /><strong>Event:</strong> {{event_label}}</p><p><a href=\"{{course_url}}\">Open the learner course</a></p>",
  });
  const { data: emailAlerts = [] } = trpc.academy.admin.emailAlerts.useQuery({ courseId: courseId ?? 0 }, { enabled: !!courseId });

  const invalidateAcademy = () => {
    utils.academy.admin.courses.invalidate();
    if (courseId) utils.academy.admin.editor.invalidate({ courseId });
    utils.academy.agent.home.invalidate();
  };
  const saveCourse = trpc.academy.admin.saveCourse.useMutation({
    onSuccess: result => {
      toast.success("Course saved");
      setCourseId(result.id);
      invalidateAcademy();
    },
    onError: e => toast.error(e.message),
  });
  const setStatus = trpc.academy.admin.setCourseStatus.useMutation({
    onSuccess: () => {
      toast.success("Course status updated");
      invalidateAcademy();
    },
    onError: e => toast.error(e.message),
  });
  const saveModule = trpc.academy.admin.saveModule.useMutation({
    onSuccess: (result, variables) => {
      toast.success(variables.id ? "Module updated" : "Module added");
      if (!variables.id) {
        setModuleTitle("");
        setModuleSummary("");
        setModuleReleaseWeek(0);
        setOpenModuleId(result.id);
      }
      setEditingModuleId(null);
      invalidateAcademy();
    },
    onError: e => toast.error(e.message),
  });
  const deleteModule = trpc.academy.admin.deleteModule.useMutation({
    onSuccess: () => {
      toast.success("Module removed");
      invalidateAcademy();
    },
    onError: e => toast.error(e.message),
  });
  const saveLesson = trpc.academy.admin.saveLesson.useMutation({
    onSuccess: async result => {
      const lessonId = Number(result.id);
      if (!Number.isSafeInteger(lessonId) || lessonId < 1) {
        toast.error(
          "The lesson was not assigned a valid ID. Please refresh before trying again."
        );
        return;
      }
      if (lessonDraft.requiresAssessment)
        await replaceQuestions.mutateAsync({
          lessonId,
          questions: lessonDraft.questions,
        });
      toast.success("Lesson saved");
      setEditingLessonId(null);
      setLessonModuleId(null);
      setLessonDraft(emptyLesson);
      invalidateAcademy();
    },
    onError: e => toast.error(e.message),
  });
  const deleteLesson = trpc.academy.admin.deleteLesson.useMutation({
    onSuccess: () => {
      toast.success("Lesson removed");
      invalidateAcademy();
    },
    onError: e => toast.error(e.message),
  });
  const saveEmailAlert = trpc.academy.admin.saveEmailAlert.useMutation({
    onSuccess: () => {
      toast.success("Academy email alert saved");
      if (courseId) utils.academy.admin.emailAlerts.invalidate({ courseId });
    },
    onError: error => toast.error(error.message),
  });
  const archiveEmailAlert = trpc.academy.admin.archiveEmailAlert.useMutation({
    onSuccess: () => {
      toast.success("Academy email alert switched off");
      if (courseId) utils.academy.admin.emailAlerts.invalidate({ courseId });
    },
    onError: error => toast.error(error.message),
  });
  const replaceQuestions = trpc.academy.admin.replaceQuestions.useMutation({
    onError: e => toast.error(e.message),
  });
  const importMultipleChoiceQuestions =
    trpc.academy.admin.importMultipleChoiceQuestions.useMutation({
      onError: e => toast.error(e.message),
    });
  const uploadAttachment = trpc.academy.admin.uploadAttachment.useMutation({
    onError: e => toast.error(e.message),
  });
  const reorderModules = trpc.academy.admin.reorderModules.useMutation({
    onSuccess: invalidateAcademy,
    onError: e => toast.error(e.message),
  });
  const reorderLessons = trpc.academy.admin.reorderLessons.useMutation({
    onSuccess: invalidateAcademy,
    onError: e => toast.error(e.message),
  });

  useEffect(() => {
    if (!courseId && courses.length) setCourseId(courses[0].id);
  }, [courses, courseId]);
  useEffect(() => {
    if (!editor) return;
    setCourseDraft({
      title: editor.course.title,
      summary: editor.course.summary ?? "",
      estimatedMinutes: editor.course.estimatedMinutes ?? 0,
      isCoreAcademy: editor.course.isCoreAcademy,
      isAcceleratorJourney: editor.course.isAcceleratorJourney,
    });
    setOpenModuleId(current =>
      current && editor.modules.some(module => module.id === current)
        ? current
        : (editor.modules[0]?.id ?? null)
    );
  }, [editor?.course.id, editor?.course.updatedAt]);

  const selectedCourse = courses.find(course => course.id === courseId) ?? null;

  function createCourse() {
    setCourseId(null);
    setCourseDraft(emptyCourse);
    setOpenModuleId(null);
    setEditingModuleId(null);
    setEditingLessonId(null);
    setLessonModuleId(null);
  }
  function saveCourseDraft() {
    saveCourse.mutate({
      id: courseId ?? undefined,
      title: courseDraft.title,
      summary: courseDraft.summary || null,
      estimatedMinutes: Number(courseDraft.estimatedMinutes) || 0,
      isCoreAcademy: courseDraft.isCoreAcademy,
      isAcceleratorJourney: courseDraft.isAcceleratorJourney,
    });
  }
  function editModule(module: {
    id: number;
    title: string;
    summary?: string | null;
    releaseWeek?: number | null;
  }) {
    setOpenModuleId(module.id);
    setEditingModuleId(module.id);
    setEditingModuleDraft({
      title: module.title,
      summary: module.summary ?? "",
      releaseWeek: module.releaseWeek ?? 0,
    });
  }
  function saveModuleEdit() {
    if (!editor || !editingModuleId || !editingModuleDraft.title.trim()) return;
    saveModule.mutate({
      id: editingModuleId,
      courseId: editor.course.id,
      title: editingModuleDraft.title,
      summary: editingModuleDraft.summary || null,
      releaseWeek: editingModuleDraft.releaseWeek,
    });
  }
  function startNewLesson(moduleId: number) {
    setOpenModuleId(moduleId);
    setEditingModuleId(null);
    setEditingLessonId(null);
    setLessonModuleId(moduleId);
    setLessonDraft(emptyLesson);
  }
  function editLesson(moduleId: number, lesson: any) {
    setOpenModuleId(moduleId);
    setLessonModuleId(moduleId);
    setEditingLessonId(lesson.id);
    setLessonDraft({
      title: lesson.title,
      summary: lesson.summary ?? "",
      contentHtml: lesson.contentHtml ?? "",
      videoUrl: lesson.videoUrl ?? "",
      videoTranscript: lesson.videoTranscript ?? "",
      attachmentUrl: lesson.attachmentUrl ?? "",
      attachmentKey: lesson.attachmentKey ?? "",
      attachmentName: lesson.attachmentName ?? "",
      estimatedMinutes: lesson.estimatedMinutes ?? 5,
      isRequired: lesson.isRequired,
      requiresAcknowledgement: lesson.requiresAcknowledgement,
      requiresAssessment: lesson.requiresAssessment,
      assessmentPassMark: lesson.assessmentPassMark ?? 80,
      questions: lesson.questions.map((q: any) => ({
        prompt: q.prompt,
        questionType: q.questionType ?? "multiple_choice",
        answerOptions: Array.isArray(q.answerOptions) ? q.answerOptions : [],
        correctAnswerIndex: q.correctAnswerIndex ?? 0,
        maxWords: q.maxWords ?? 250,
        explanation: q.explanation ?? "",
      })),
    });
  }
  function submitLesson() {
    if (!lessonModuleId) return;
    saveLesson.mutate({
      id: editingLessonId ?? undefined,
      moduleId: lessonModuleId,
      ...lessonDraft,
      summary: lessonDraft.summary || null,
      contentHtml: lessonDraft.contentHtml || null,
      videoUrl: lessonDraft.videoUrl || null,
      videoTranscript: lessonDraft.videoTranscript || null,
      attachmentUrl: lessonDraft.attachmentUrl || null,
      attachmentKey: lessonDraft.attachmentKey || null,
      attachmentName: lessonDraft.attachmentName || null,
    });
  }
  async function handleAttachment(file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Attachments must be under 10 MB");
      return;
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const stored = await uploadAttachment.mutateAsync({
      fileName: file.name,
      fileBase64: base64,
      mimeType: file.type as any,
    });
    setLessonDraft(current => ({
      ...current,
      attachmentUrl: stored.url,
      attachmentKey: stored.key,
      attachmentName: stored.name,
    }));
    toast.success("Resource uploaded");
  }
  async function handleQuizCsvImport(file: File | undefined) {
    if (!file || !editingLessonId) return;
    if (file.size > 500_000) {
      toast.error("Quiz CSV files must be under 500 KB");
      return;
    }
    const csvText = await file.text();
    const result = await importMultipleChoiceQuestions.mutateAsync({
      lessonId: editingLessonId,
      csvText,
    });
    toast.success(
      `${result.imported} quiz ${result.imported === 1 ? "question" : "questions"} imported`
    );
    setEditingLessonId(null);
    setLessonModuleId(null);
    setLessonDraft(emptyLesson);
    invalidateAcademy();
  }
  function moveModule(moduleId: number, direction: -1 | 1) {
    if (!editor) return;
    const ids = editor.modules.map(module => module.id);
    const index = ids.indexOf(moduleId);
    const next = index + direction;
    if (next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    reorderModules.mutate({ courseId: editor.course.id, moduleIds: ids });
  }
  function moveLesson(module: any, lessonId: number, direction: -1 | 1) {
    const ids = module.lessons.map((lesson: any) => lesson.id);
    const index = ids.indexOf(lessonId);
    const next = index + direction;
    if (next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    reorderLessons.mutate({ moduleId: module.id, lessonIds: ids });
  }
  if (coursesLoading)
    return (
      <div className="space-y-5 animate-pulse">
        <div className="h-24 rounded-2xl bg-muted" />
        <div className="h-[500px] rounded-2xl bg-muted" />
      </div>
    );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="rounded-3xl border border-[#70FFE8]/45 bg-gradient-to-r from-[#414141] to-[#2d3534] p-6 text-white shadow-sm md:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#70FFE8]">
              <GraduationCap size={18} /> Academy Manager
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">
              Build learning your way.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">
              Create, order, publish and maintain Academy courses, modules,
              lessons, resources, videos and knowledge checks.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="border-white/45 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => {
                setViewMode("agent");
                navigate("/academy");
              }}
            >
              <Eye className="mr-2" size={17} /> Preview as agent
            </Button>
            <Button
              onClick={createCourse}
              className="bg-[#70FFE8] text-[#27302e] hover:bg-[#8cffef]"
            >
              <CirclePlus className="mr-2" size={17} /> Create course
            </Button>
          </div>
        </div>
        <p className="mt-4 text-xs text-white/70">
          Learner enrolment, progress, assessment review and support locks now
          live in Academy Progress &amp; Insights.
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border bg-card p-3 shadow-sm xl:sticky xl:top-6">
          <div className="flex items-center justify-between px-2 pb-3">
            <span className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">
              Courses
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold">
              {courses.length}
            </span>
          </div>
          <div className="space-y-1">
            {courses.map(course => (
              <button
                type="button"
                key={course.id}
                onClick={() => {
                  setCourseId(course.id);
                  setOpenModuleId(null);
                  setEditingModuleId(null);
                  setEditingLessonId(null);
                  setLessonModuleId(null);
                }}
                className={`w-full rounded-xl px-3 py-3 text-left transition ${course.id === courseId ? "bg-[#70FFE8]/25" : "hover:bg-muted"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold leading-5">
                    {course.title}
                  </span>
                  {course.isCoreAcademy && (
                    <ShieldCheck className="shrink-0 text-primary" size={15} />
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className={`rounded-full px-1.5 py-0.5 font-semibold ${course.status === "published" ? "bg-emerald-100 text-emerald-700" : course.status === "archived" ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-700"}`}
                  >
                    {course.status}
                  </span>
                  <span>
                    {course.completionCount}/{course.enrolmentCount} complete
                  </span>
                </div>
              </button>
            ))}
          </div>
          {!courses.length && (
            <div className="p-3 text-sm text-muted-foreground">
              Create your first course to start building a content-ready
              Academy.
            </div>
          )}
        </aside>

        <main className="min-w-0 space-y-6">
          {!courseId ? (
            <CourseSetup
              draft={courseDraft}
              setDraft={setCourseDraft}
              onSave={saveCourseDraft}
              isSaving={saveCourse.isPending}
            />
          ) : editorLoading ? (
            <div className="h-96 rounded-2xl bg-muted animate-pulse" />
          ) : !editor ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-6 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-800">
                    Course editor unavailable
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-foreground">
                    We could not load this course’s lessons.
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    No Academy content has been changed. Try again; if the
                    problem continues, the technical detail below will help the
                    support team resolve it.
                  </p>
                  {editorError?.message && (
                    <p className="mt-3 rounded-lg border border-amber-200 bg-background/80 px-3 py-2 font-mono text-xs leading-5 text-muted-foreground">
                      {editorError.message}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  onClick={() => void refetchEditor()}
                  disabled={editorRefetching}
                >
                  <RefreshCw
                    className={`mr-2 size-4 ${editorRefetching ? "animate-spin" : ""}`}
                  />
                  {editorRefetching ? "Retrying…" : "Retry"}
                </Button>
              </div>
            </section>
          ) : (
            <>
              <CourseSetup
                draft={courseDraft}
                setDraft={setCourseDraft}
                onSave={saveCourseDraft}
                isSaving={saveCourse.isPending}
                existing
                course={editor.course}
                onStatus={status =>
                  setStatus.mutate({ courseId: editor.course.id, status })
                }
                statusPending={setStatus.isPending}
              />
              <section className="rounded-2xl border border-violet-200 bg-violet-50/35 p-5 shadow-sm">
                <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-800">Academy notifications</p><h2 className="mt-1 text-xl font-bold">Email the right person at the right milestone</h2><p className="mt-1 text-sm text-muted-foreground">Add a support alert or a bespoke recipient for this course. Existing delivery records are retained; switching an alert off only stops future emails.</p></div>
                <div className="mt-4 grid gap-3 md:grid-cols-2"><div><Label>When</Label><select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm" value={alertDraft.eventType} onChange={event => setAlertDraft({ ...alertDraft, eventType: event.target.value as typeof alertDraft.eventType })}><option value="week_released">A weekly section is released</option><option value="module_started">A module is started</option><option value="module_completed">A module is completed</option><option value="action_submitted_for_review">A course Action needs review</option><option value="action_overdue">A course Action becomes overdue</option><option value="course_completed">The course is completed</option><option value="written_assessment_ready">Written assessment is ready to mark</option><option value="three_attempt_lock">A learner reaches the three-attempt support lock</option></select></div><div><Label>Scope</Label><select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm" value={alertDraft.moduleId} onChange={event => setAlertDraft({ ...alertDraft, moduleId: event.target.value })}><option value="">Whole course</option>{editor.modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}</select></div><div><Label>Recipient</Label><select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm" value={alertDraft.recipientType} onChange={event => setAlertDraft({ ...alertDraft, recipientType: event.target.value as "support" | "custom" })}><option value="support">JLT Support</option><option value="custom">Custom recipient</option></select></div>{alertDraft.recipientType === "custom" && <><Input className="mt-6" placeholder="Recipient name (optional)" value={alertDraft.recipientName} onChange={event => setAlertDraft({ ...alertDraft, recipientName: event.target.value })} /><Input placeholder="recipient@example.com" value={alertDraft.recipientEmail} onChange={event => setAlertDraft({ ...alertDraft, recipientEmail: event.target.value })} /></>}</div>
                <div className="mt-3"><Label>Email subject</Label><Input className="mt-1.5" value={alertDraft.subjectTemplate} onChange={event => setAlertDraft({ ...alertDraft, subjectTemplate: event.target.value })} /></div>
                <div className="mt-3"><Label>Email content</Label><RichEmailEditor value={alertDraft.bodyHtmlTemplate} onChange={bodyHtmlTemplate => setAlertDraft({ ...alertDraft, bodyHtmlTemplate })} placeholder="Write the alert email…" /><p className="mt-2 text-xs text-muted-foreground">Insert supported Academy merge fields from the template guidance when needed.</p></div>
                <div className="mt-4 flex justify-end"><Button disabled={saveEmailAlert.isPending || !alertDraft.subjectTemplate.trim() || !alertDraft.bodyHtmlTemplate.trim() || (alertDraft.recipientType === "custom" && !alertDraft.recipientEmail.trim())} onClick={() => saveEmailAlert.mutate({ courseId: editor.course.id, moduleId: alertDraft.moduleId ? Number(alertDraft.moduleId) : null, eventType: alertDraft.eventType, recipientType: alertDraft.recipientType, recipientEmail: alertDraft.recipientType === "custom" ? alertDraft.recipientEmail || null : null, recipientName: alertDraft.recipientType === "custom" ? alertDraft.recipientName || null : null, subjectTemplate: alertDraft.subjectTemplate, bodyHtmlTemplate: alertDraft.bodyHtmlTemplate, isActive: true })}>{saveEmailAlert.isPending ? "Saving…" : "Add email alert"}</Button></div>
                {emailAlerts.length > 0 && <div className="mt-5 divide-y rounded-xl border bg-background/80 px-4">{emailAlerts.map(alert => <div key={alert.id} className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{alert.eventType.replaceAll("_", " ")} · {alert.recipientType === "support" ? "JLT Support" : alert.recipientEmail}</p><p className="text-xs text-muted-foreground">{alert.moduleId ? `Module #${alert.moduleId}` : "Whole course"} · {alert.isActive ? "Active" : "Switched off"}</p></div>{alert.isActive && <Button size="sm" variant="outline" className="text-destructive" onClick={() => archiveEmailAlert.mutate({ id: alert.id })}>Switch off</Button>}</div>)}</div>}
              </section>
              <section className="rounded-2xl border bg-card p-5 shadow-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">
                    Curriculum
                  </p>
                  <h2 className="mt-1 text-xl font-bold">
                    Modules and lessons
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Use the arrows to set the learning order. Nothing appears to
                    agents until the course is published.
                  </p>
                </div>
                <div className="mt-5 rounded-xl border bg-muted/20 p-4">
                  <p className="text-sm font-semibold">Add module</p>
                  <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1.4fr_180px_auto]">
                    <Input
                      placeholder="e.g. Welcome to JLT"
                      value={moduleTitle}
                      onChange={e => setModuleTitle(e.target.value)}
                    />
                    <Input
                      placeholder="Optional summary"
                      value={moduleSummary}
                      onChange={e => setModuleSummary(e.target.value)}
                    />
                    {editor.course.isAcceleratorJourney && (
                      <select
                        aria-label="Accelerator release week"
                        className="h-10 rounded-md border bg-background px-3 text-sm"
                        value={moduleReleaseWeek}
                        onChange={event => setModuleReleaseWeek(Number(event.target.value))}
                      >
                        <option value={0}>Introduction — immediate</option>
                        {Array.from({ length: 8 }, (_, index) => <option key={index + 1} value={index + 1}>Week {index + 1} — Friday</option>)}
                      </select>
                    )}
                    <Button
                      disabled={!moduleTitle.trim() || saveModule.isPending}
                      onClick={() =>
                        saveModule.mutate({
                          courseId: editor.course.id,
                          title: moduleTitle,
                          summary: moduleSummary || null,
                          releaseWeek: editor.course.isAcceleratorJourney ? moduleReleaseWeek : 0,
                        })
                      }
                    >
                      <Plus className="mr-1" size={16} />
                      Add
                    </Button>
                  </div>
                </div>
                <div className="mt-5 space-y-4">
                  {editor.modules.map((module, index) => {
                    const isOpen = openModuleId === module.id;
                    const lessonCountLabel = `${module.lessons.length} lesson${module.lessons.length === 1 ? "" : "s"}`;
                    const videoLessonCount = module.lessons.filter(
                      (lesson: any) => Boolean(lesson.videoUrl?.trim())
                    ).length;
                    return (
                      <section
                        key={module.id}
                        className="overflow-hidden rounded-xl border"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/35 px-4 py-3">
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            aria-expanded={isOpen}
                            aria-controls={`academy-module-${module.id}`}
                            onClick={() =>
                              setOpenModuleId(current =>
                                current === module.id ? null : module.id
                              )
                            }
                          >
                            <ChevronRight
                              className={`shrink-0 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                              size={18}
                            />
                            <div className="min-w-0">
                              <p className="font-semibold">
                                {index + 1}. {module.title}
                              </p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                {editor.course.isAcceleratorJourney && <span className="font-semibold text-violet-700">{module.releaseWeek ? `Week ${module.releaseWeek} · Friday release` : "Introduction · immediate"}</span>}
                                <span>
                                  {module.summary || lessonCountLabel}
                                  {module.summary
                                    ? ` · ${lessonCountLabel}`
                                    : ""}
                                </span>
                                {videoLessonCount > 0 && (
                                  <span className="inline-flex items-center gap-1 font-medium text-violet-700">
                                    <Video size={13} aria-hidden="true" />
                                    {videoLessonCount} video
                                    {videoLessonCount === 1 ? "" : "s"}
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Edit module name or summary"
                              onClick={() => editModule(module)}
                            >
                              <Pencil size={16} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Move module up"
                              disabled={!index}
                              onClick={() => moveModule(module.id, -1)}
                            >
                              <ArrowUp size={16} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Move module down"
                              disabled={index === editor.modules.length - 1}
                              onClick={() => moveModule(module.id, 1)}
                            >
                              <ArrowDown size={16} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              title="Delete module"
                              onClick={() =>
                                window.confirm(
                                  `Delete ${module.title} and all its lessons?`
                                ) &&
                                deleteModule.mutate({ moduleId: module.id })
                              }
                            >
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        </div>
                        {isOpen && (
                          <div
                            id={`academy-module-${module.id}`}
                            className="border-t"
                          >
                            {editingModuleId === module.id && (
                              <div className="border-b bg-muted/15 p-4">
                                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_180px_auto_auto]">
                                  <Input
                                    aria-label="Module name"
                                    value={editingModuleDraft.title}
                                    onChange={event =>
                                      setEditingModuleDraft({
                                        ...editingModuleDraft,
                                        title: event.target.value,
                                      })
                                    }
                                  />
                                  <Input
                                    aria-label="Module summary"
                                    value={editingModuleDraft.summary}
                                    placeholder="Optional summary"
                                    onChange={event =>
                                      setEditingModuleDraft({
                                        ...editingModuleDraft,
                                        summary: event.target.value,
                                      })
                                    }
                                  />
                                  {editor.course.isAcceleratorJourney && <select
                                    aria-label="Module release week"
                                    className="h-10 rounded-md border bg-background px-3 text-sm"
                                    value={editingModuleDraft.releaseWeek}
                                    onChange={event => setEditingModuleDraft({ ...editingModuleDraft, releaseWeek: Number(event.target.value) })}
                                  >
                                    <option value={0}>Introduction — immediate</option>
                                    {Array.from({ length: 8 }, (_, index) => <option key={index + 1} value={index + 1}>Week {index + 1}</option>)}
                                  </select>}
                                  <Button
                                    size="sm"
                                    disabled={
                                      !editingModuleDraft.title.trim() ||
                                      saveModule.isPending
                                    }
                                    onClick={saveModuleEdit}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setEditingModuleId(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                                <p className="mt-2 text-xs text-muted-foreground">
                                  Update the module name or optional summary,
                                  then save.
                                </p>
                              </div>
                            )}
                            <div className="divide-y">
                              {module.lessons.map((lesson, lessonIndex) => (
                                <div
                                  key={lesson.id}
                                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
                                >
                                  <div className="flex min-w-0 flex-1 gap-3">
                                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-xs font-bold shadow-sm">
                                      {lessonIndex + 1}
                                    </span>
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-medium">
                                          {lesson.title}
                                        </p>
                                        {lesson.videoUrl?.trim() && (
                                          <span
                                            className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-800"
                                            title="An approved lesson video has been added"
                                          >
                                            <Video
                                              size={13}
                                              aria-hidden="true"
                                            />
                                            Video
                                          </span>
                                        )}
                                      </div>
                                      <p className="mt-0.5 text-xs text-muted-foreground">
                                        {lesson.estimatedMinutes} min ·{" "}
                                        {lesson.isRequired
                                          ? "Required"
                                          : "Optional"}
                                        {lesson.requiresAcknowledgement
                                          ? " · Acknowledgement"
                                          : ""}
                                        {lesson.requiresAssessment
                                          ? ` · Quiz (${lesson.questions.length})`
                                          : ""}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      disabled={!lessonIndex}
                                      onClick={() =>
                                        moveLesson(module, lesson.id, -1)
                                      }
                                    >
                                      <ArrowUp size={15} />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      disabled={
                                        lessonIndex ===
                                        module.lessons.length - 1
                                      }
                                      onClick={() =>
                                        moveLesson(module, lesson.id, 1)
                                      }
                                    >
                                      <ArrowDown size={15} />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      title="Edit lesson name and content"
                                      onClick={() =>
                                        editLesson(module.id, lesson)
                                      }
                                    >
                                      <Pencil size={15} />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="text-destructive"
                                      onClick={() =>
                                        window.confirm(
                                          `Delete ${lesson.title}?`
                                        ) &&
                                        deleteLesson.mutate({
                                          lessonId: lesson.id,
                                        })
                                      }
                                    >
                                      <Trash2 size={15} />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                              {!module.lessons.length && (
                                <div className="px-4 py-4 text-sm text-muted-foreground">
                                  No lessons added yet.
                                </div>
                              )}
                            </div>
                            <div className="border-t bg-muted/15 px-4 py-3">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => startNewLesson(module.id)}
                              >
                                <Plus className="mr-1" size={15} /> Add lesson
                              </Button>
                            </div>
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              </section>
              {lessonModuleId !== null && (
                <LessonEditor
                  draft={lessonDraft}
                  setDraft={setLessonDraft}
                  courseTitle={editor.course.title}
                  editing={editingLessonId !== null}
                  lessonId={editingLessonId}
                  onCancel={() => {
                    setEditingLessonId(null);
                    setLessonModuleId(null);
                    setLessonDraft(emptyLesson);
                  }}
                  onSave={submitLesson}
                  isSaving={saveLesson.isPending || replaceQuestions.isPending}
                  onUpload={handleAttachment}
                  uploading={uploadAttachment.isPending}
                  onImportQuizCsv={handleQuizCsvImport}
                  importingQuizCsv={importMultipleChoiceQuestions.isPending}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function CourseSetup({
  draft,
  setDraft,
  onSave,
  isSaving,
  existing,
  course,
  onStatus,
  statusPending,
}: {
  draft: typeof emptyCourse;
  setDraft: (draft: typeof emptyCourse) => void;
  onSave: () => void;
  isSaving: boolean;
  existing?: boolean;
  course?: any;
  onStatus?: (status: "draft" | "published" | "archived") => void;
  statusPending?: boolean;
}) {
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">
            {existing ? "Course settings" : "New course"}
          </p>
          <h2 className="mt-1 text-xl font-bold">
            {existing ? "Course information" : "Start with a blank course"}
          </h2>
        </div>
        {existing && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={statusPending || course.status === "draft"}
              onClick={() => onStatus?.("draft")}
            >
              Draft
            </Button>
            <Button
              size="sm"
              disabled={statusPending || course.status === "published"}
              onClick={() => onStatus?.("published")}
            >
              Publish
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={statusPending || course.status === "archived"}
              onClick={() => onStatus?.("archived")}
            >
              <Archive className="mr-1" size={14} /> Archive
            </Button>
          </div>
        )}
      </div>
      <div className="mt-5 grid gap-4">
        <div>
          <Label>Course name</Label>
          <Input
            className="mt-1.5"
            placeholder="e.g. JLT Academy"
            value={draft.title}
            onChange={e => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div>
          <Label>Short description</Label>
          <Textarea
            className="mt-1.5"
            placeholder="Explain the course outcome in clear practical language."
            value={draft.summary}
            onChange={e => setDraft({ ...draft, summary: e.target.value })}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Estimated total minutes</Label>
            <Input
              className="mt-1.5"
              type="number"
              min="0"
              value={draft.estimatedMinutes}
              onChange={e =>
                setDraft({
                  ...draft,
                  estimatedMinutes: Number(e.target.value) || 0,
                })
              }
            />
          </div>
          <label className="mt-6 flex cursor-pointer items-start gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
            <Checkbox
              checked={draft.isCoreAcademy}
              onCheckedChange={checked =>
                setDraft({ ...draft, isCoreAcademy: checked === true })
              }
            />
            <span>
              <span className="font-semibold">
                This is the core JLT Academy pathway
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                When an approved agent completes it, their CRM training stage
                moves to Agent Accelerator.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-sm">
            <Checkbox
              checked={draft.isAcceleratorJourney}
              onCheckedChange={checked =>
                setDraft({ ...draft, isAcceleratorJourney: checked === true })
              }
            />
            <span>
              <span className="font-semibold">Agent Accelerator: eight-week Friday journey</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Introduction modules are immediate. Modules tagged Week 1–8 unlock at 9am UK time on each learner&apos;s own Friday schedule after they enter Accelerator.
              </span>
            </span>
          </label>
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button disabled={!draft.title.trim() || isSaving} onClick={onSave}>
          {isSaving ? "Saving..." : existing ? "Save course" : "Create course"}
        </Button>
      </div>
    </section>
  );
}

function LessonEditor({
  draft,
  setDraft,
  editing,
  lessonId,
  onCancel,
  onSave,
  isSaving,
  onUpload,
  uploading,
  onImportQuizCsv,
  importingQuizCsv,
}: {
  draft: typeof emptyLesson;
  setDraft: (next: typeof emptyLesson) => void;
  courseTitle: string;
  editing: boolean;
  lessonId: number | null;
  onCancel: () => void;
  onSave: () => void;
  isSaving: boolean;
  onUpload: (file: File | undefined) => void;
  uploading: boolean;
  onImportQuizCsv: (file: File | undefined) => void;
  importingQuizCsv: boolean;
}) {
  const [formatSummary, setFormatSummary] = useState<string | null>(null);
  const updateQuestion = (index: number, patch: Partial<DraftQuestion>) =>
    setDraft({
      ...draft,
      questions: draft.questions.map((question, questionIndex) =>
        questionIndex === index ? { ...question, ...patch } : question
      ),
    });
  const smartFormatCurrentContent = () => {
    if (!draft.contentHtml.trim()) return;
    const formatted = plainTextToLessonHtml(
      lessonHtmlToPlainText(draft.contentHtml)
    );
    const headings = (formatted.match(/<h2>/g) ?? []).length;
    const bullets = (formatted.match(/<li>/g) ?? []).length;
    const summary = `Formatted ${headings} heading${headings === 1 ? "" : "s"} and ${bullets} bullet point${bullets === 1 ? "" : "s"}.`;
    setDraft({ ...draft, contentHtml: formatted });
    setFormatSummary(summary);
    toast.success(summary);
  };
  return (
    <section className="rounded-2xl border-2 border-[#70FFE8]/70 bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">
            {editing ? "Edit lesson" : "New lesson"}
          </p>
          <h2 className="mt-1 text-xl font-bold">
            {editing ? draft.title : "Build a lesson"}
          </h2>
        </div>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div className="mt-5 space-y-5">
        <div className="grid gap-4 md:grid-cols-[1fr_150px]">
          <div>
            <Label>Lesson title</Label>
            <Input
              className="mt-1.5"
              value={draft.title}
              placeholder="e.g. How the JLT booking workflow works"
              onChange={e => setDraft({ ...draft, title: e.target.value })}
            />
          </div>
          <div>
            <Label>Estimated minutes</Label>
            <Input
              className="mt-1.5"
              type="number"
              min="1"
              value={draft.estimatedMinutes}
              onChange={e =>
                setDraft({
                  ...draft,
                  estimatedMinutes: Number(e.target.value) || 1,
                })
              }
            />
          </div>
        </div>
        <div>
          <Label>Lesson summary</Label>
          <Input
            className="mt-1.5"
            value={draft.summary}
            placeholder="A short introduction shown before the lesson."
            onChange={e => setDraft({ ...draft, summary: e.target.value })}
          />
        </div>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Label>Lesson content</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Paste directly from your source to keep headings, bold, italics,
                underline, bullets, numbered lists, links and tables. Unsafe or
                email-only styling is cleaned automatically. Video and downloads
                stay separate.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!draft.contentHtml.trim()}
              onClick={smartFormatCurrentContent}
            >
              Smart format pasted text
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Use this once for text already pasted as plain lines; it turns
            recognisable headings and lists into structured lesson content.
          </p>
          {formatSummary && (
            <p
              className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800"
              role="status"
            >
              {formatSummary} The preview below has been updated; save the
              lesson when you are happy with it.
            </p>
          )}
          <RichEmailEditor
            className="mt-2"
            value={draft.contentHtml}
            onChange={contentHtml => {
              setDraft({ ...draft, contentHtml });
              setFormatSummary(null);
            }}
            placeholder="Write the practical guidance for this lesson…"
            preserveClipboardFormatting
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Approved video link</Label>
            <Input
              className="mt-1.5"
              value={draft.videoUrl}
              placeholder="https://www.loom.com/share/..."
              onChange={e => setDraft({ ...draft, videoUrl: e.target.value })}
            />
          </div>
          <div>
            <Label>Downloadable resource</Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                value={draft.attachmentName}
                readOnly
                placeholder="No resource uploaded"
              />
              <label className="inline-flex shrink-0 cursor-pointer items-center rounded-md border px-3 text-sm font-medium hover:bg-muted">
                <Upload className="mr-1" size={15} />
                {uploading ? "Uploading" : "Upload"}
                <input
                  className="hidden"
                  type="file"
                  accept=".pdf,.docx,.xlsx,.txt,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv"
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    onUpload(e.target.files?.[0])
                  }
                />
              </label>
            </div>
            {draft.attachmentUrl && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <a
                  className="inline-flex text-xs font-semibold text-primary hover:underline"
                  href={draft.attachmentUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open uploaded resource
                </a>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 border-destructive/30 text-xs text-destructive hover:bg-destructive/5 hover:text-destructive"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Remove ${draft.attachmentName || "this uploaded resource"} from this lesson?`
                      )
                    )
                      return;
                    setDraft({
                      ...draft,
                      attachmentUrl: "",
                      attachmentKey: "",
                      attachmentName: "",
                    });
                    toast.info(
                      "Resource removed from this lesson draft. Save the lesson to apply the change."
                    );
                  }}
                >
                  <Trash2 className="mr-1" size={13} />
                  Remove resource
                </Button>
              </div>
            )}
          </div>
        </div>
        <section className="rounded-xl border border-violet-200 bg-violet-50/45 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <Label htmlFor="academy-video-transcript">
                Loom transcript for JLT knowledge
              </Label>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                Private to Admin and Super Admin. Paste the Loom transcript
                exactly as provided, including timestamp lines. It is not
                visible to agents and will let the future chatbot direct them to
                precise moments in this video.
              </p>
            </div>
            <span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">
              Private · timestamps preserved
            </span>
          </div>
          <Textarea
            id="academy-video-transcript"
            className="mt-3 min-h-56 font-mono text-xs leading-5"
            value={draft.videoTranscript}
            placeholder={"00:00 Introduction\n00:42 How to find a booking\n…"}
            onChange={event =>
              setDraft({ ...draft, videoTranscript: event.target.value })
            }
          />
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Use the transcript as a faithful searchable reference, not
              agent-facing lesson content.
            </span>
            <span>
              {draft.videoTranscript.length.toLocaleString()} characters
            </span>
          </div>
        </section>
        <div className="grid gap-3 rounded-xl border bg-muted/15 p-4 md:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox
              checked={draft.isRequired}
              onCheckedChange={checked =>
                setDraft({ ...draft, isRequired: checked === true })
              }
            />
            <span>
              <b>Required lesson</b>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Only required lessons count towards completing the course.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox
              checked={draft.requiresAcknowledgement}
              onCheckedChange={checked =>
                setDraft({
                  ...draft,
                  requiresAcknowledgement: checked === true,
                })
              }
            />
            <span>
              <b>Record acknowledgement</b>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                The agent must confirm they have read and understood it.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox
              checked={draft.requiresAssessment}
              onCheckedChange={checked =>
                setDraft({ ...draft, requiresAssessment: checked === true })
              }
            />
            <span>
              <b>Add a knowledge check</b>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                The agent must pass the quiz before completion.
              </span>
            </span>
          </label>
          {draft.requiresAssessment && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
              <Label>Progression standard</Label>
              <p className="mt-1 text-sm font-semibold text-emerald-900">
                100% required
              </p>
              <p className="mt-0.5 text-xs text-emerald-800">
                Every answer must achieve 100% before the learner can continue.
              </p>
            </div>
          )}
        </div>
        {draft.requiresAssessment && (
          <div className="rounded-xl border p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-bold">Knowledge-check questions</h3>
                <p className="text-sm text-muted-foreground">
                  Multiple-choice answers score automatically. Written answers
                  are sent to the staff marking queue with feedback and
                  acknowledgement required.
                </p>
                <p className="mt-1 text-xs font-medium text-muted-foreground">
                  Up to {MAX_ACADEMY_ASSESSMENT_QUESTIONS} questions per knowledge check or final exam. CSV import is recommended for longer exams.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={downloadQuizCsvTemplate}
                >
                  <Download className="mr-1" size={15} /> Download CSV template
                </Button>
                {editing && lessonId ? (
                  <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">
                    <Upload className="mr-1" size={15} />
                    {importingQuizCsv ? "Importing..." : "Import CSV"}
                    <input
                      className="hidden"
                      type="file"
                      accept=".csv,text/csv"
                      disabled={importingQuizCsv}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        onImportQuizCsv(event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Save this lesson first to import a CSV.
                  </span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={draft.questions.length >= MAX_ACADEMY_ASSESSMENT_QUESTIONS}
                  title={draft.questions.length >= MAX_ACADEMY_ASSESSMENT_QUESTIONS ? `A knowledge check can contain up to ${MAX_ACADEMY_ASSESSMENT_QUESTIONS} questions.` : "Add a question"}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      questions: [
                        ...draft.questions,
                        {
                          prompt: "",
                          questionType: "multiple_choice",
                          answerOptions: ["", ""],
                          correctAnswerIndex: 0,
                          maxWords: 250,
                          explanation: "",
                        },
                      ],
                    })
                  }
                >
                  <Plus className="mr-1" size={15} /> Question
                </Button>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Use the template exactly as downloaded. Import adds
              multiple-choice questions to this lesson; it never overwrites
              questions already shown here. {draft.questions.length}/{MAX_ACADEMY_ASSESSMENT_QUESTIONS} questions currently in this knowledge check.
            </p>
            <div className="mt-4 space-y-4">
              {draft.questions.map((question, index) => (
                <div key={index} className="rounded-lg border bg-muted/10 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      Question {index + 1}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          questions: draft.questions.filter(
                            (_, questionIndex) => questionIndex !== index
                          ),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                  <div className="mt-2 grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
                    <div>
                      <Label>Question type</Label>
                      <select
                        aria-label={`Question ${index + 1} type`}
                        className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={question.questionType}
                        onChange={event =>
                          updateQuestion(index, {
                            questionType: event.target
                              .value as DraftQuestion["questionType"],
                          })
                        }
                      >
                        <option value="multiple_choice">Multiple choice</option>
                        <option value="free_text">Written response</option>
                      </select>
                    </div>
                    <div>
                      <Label>Question</Label>
                      {question.questionType === "free_text" ? (
                        <>
                          <AcademyQuestionRichTextEditor
                            className="mt-1.5"
                            label={`Written question ${index + 1}`}
                            value={question.prompt}
                            placeholder="Explain the task clearly, then use headings, bold text, bullet points or numbered steps to make it easy to follow."
                            onChange={prompt =>
                              updateQuestion(index, { prompt })
                            }
                          />
                          <QuestionFormatPreview
                            title="Agent preview"
                            text={question.prompt}
                          />
                        </>
                      ) : (
                        <Input
                          className="mt-1.5"
                          value={question.prompt}
                          placeholder="Ask a clear, single-answer question"
                          onChange={event =>
                            updateQuestion(index, {
                              prompt: event.target.value,
                            })
                          }
                        />
                      )}
                    </div>
                  </div>
                  {question.questionType === "free_text" ? (
                    <div className="mt-3 grid gap-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3 md:grid-cols-[180px_minmax(0,1fr)]">
                      <div>
                        <Label>Maximum words</Label>
                        <Input
                          className="mt-1.5"
                          type="number"
                          min="10"
                          max="2000"
                          value={question.maxWords}
                          onChange={event =>
                            updateQuestion(index, {
                              maxWords: Math.max(
                                10,
                                Math.min(
                                  2000,
                                  Number(event.target.value) || 250
                                )
                              ),
                            })
                          }
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          Agents type directly; paste and drag/drop are
                          disabled.
                        </p>
                      </div>
                      <div>
                        <Label>Private marking guide (optional)</Label>
                        <AcademyQuestionRichTextEditor
                          className="mt-1.5"
                          label={`Private marking guide for question ${index + 1}`}
                          value={question.explanation ?? ""}
                          placeholder="Set out assessment criteria with headings, bold or italic emphasis, bullet points, numbered steps and paragraph breaks. This is never shown to the agent."
                          onChange={explanation =>
                            updateQuestion(index, { explanation })
                          }
                        />
                        <QuestionFormatPreview
                          title="Staff marking-guide preview"
                          text={question.explanation ?? ""}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mt-3 space-y-2">
                        {question.answerOptions.map((option, optionIndex) => (
                          <div
                            key={optionIndex}
                            className="flex items-center gap-2"
                          >
                            <input
                              type="radio"
                              checked={
                                question.correctAnswerIndex === optionIndex
                              }
                              onChange={() =>
                                updateQuestion(index, {
                                  correctAnswerIndex: optionIndex,
                                })
                              }
                              title="Mark as correct answer"
                            />
                            <Input
                              value={option}
                              placeholder={`Answer option ${optionIndex + 1}`}
                              onChange={e =>
                                updateQuestion(index, {
                                  answerOptions: question.answerOptions.map(
                                    (old, i) =>
                                      i === optionIndex ? e.target.value : old
                                  ),
                                })
                              }
                            />
                            {question.answerOptions.length > 2 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  const nextOptions =
                                    question.answerOptions.filter(
                                      (_, i) => i !== optionIndex
                                    );
                                  updateQuestion(index, {
                                    answerOptions: nextOptions,
                                    correctAnswerIndex: Math.min(
                                      question.correctAnswerIndex,
                                      nextOptions.length - 1
                                    ),
                                  });
                                }}
                              >
                                <Trash2 size={14} />
                              </Button>
                            )}
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            updateQuestion(index, {
                              answerOptions: [...question.answerOptions, ""],
                            })
                          }
                        >
                          <Plus className="mr-1" size={14} />
                          Answer option
                        </Button>
                      </div>
                      <Input
                        className="mt-3"
                        value={question.explanation}
                        placeholder="Optional private staff note"
                        onChange={e =>
                          updateQuestion(index, { explanation: e.target.value })
                        }
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t pt-5">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={
              !draft.title.trim() ||
              isSaving ||
              (draft.requiresAssessment &&
                draft.questions.some(
                  question =>
                    !question.prompt.trim() ||
                    (question.questionType === "multiple_choice" &&
                      (question.answerOptions.length < 2 ||
                        question.answerOptions.some(option => !option.trim())))
                ))
            }
            onClick={onSave}
          >
            {isSaving ? "Saving..." : "Save lesson"}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function WrittenAssessmentQueue({
  submissions,
  drafts,
  setDrafts,
  onMark,
  marking,
  onGenerateAiReview,
  aiReviewingAttemptId,
}: any) {
  const draftFor = (submission: any) =>
    drafts[submission.attempt.id] ?? {
      feedback: "",
      responses: Object.fromEntries(
        submission.responses.map((response: any) => [
          response.questionId,
          { score: -1, feedback: "" },
        ])
      ),
    };
  const updateDraft = (
    attemptId: number,
    update: (current: any) => any,
    fallback: any
  ) =>
    setDrafts((current: any) => ({
      ...current,
      [attemptId]: update(current[attemptId] ?? fallback),
    }));
  const useAiReviewAsDraft = (submission: any, fallback: any) => {
    const suggestions = submission.aiReview?.suggestions ?? [];
    if (!suggestions.length) return;
    updateDraft(
      submission.attempt.id,
      (current: any) => ({
        ...current,
        feedback: current.feedback.trim() || `Please review the question-level feedback below. The suggestions have been checked by a member of the JLT Academy team before release.`,
        responses: {
          ...current.responses,
          ...Object.fromEntries(
            suggestions.map((suggestion: any) => [
              suggestion.questionId,
              {
                score: suggestion.suggestedScore,
                feedback: suggestion.suggestedFeedback,
              },
            ])
          ),
        },
      }),
      fallback
    );
  };

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">
            Staff marking queue
          </p>
          <h2 className="mt-1 text-xl font-bold">Written assessment reviews</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Score each written answer, provide constructive feedback, then
            release it to the agent. They must read and acknowledge it before
            progressing.
          </p>
        </div>
        <div className="rounded-full bg-amber-100 px-3 py-1.5 text-sm font-bold text-amber-800">
          {submissions.length} awaiting review
        </div>
      </div>
      {submissions.length ? (
        <div className="mt-5 space-y-5">
          {submissions.map((submission: any) => {
            const draft = draftFor(submission);
            const fallback = draftFor(submission);
            const readyToMark =
              draft.feedback.trim().length >= 3 &&
              submission.responses.every((response: any) => {
                const grade = draft.responses[response.questionId];
                return (
                  grade &&
                  Number.isInteger(grade.score) &&
                  grade.score >= 0 &&
                  grade.score <= 100 &&
                  grade.feedback.trim().length >= 3
                );
              });
            return (
              <article
                key={submission.attempt.id}
                className="rounded-xl border bg-muted/15 p-4"
              >
                <div className="flex flex-col gap-2 border-b pb-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-bold">
                      {submission.agent.name || submission.agent.email}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {submission.course.title} · {submission.lesson.title}
                    </p>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Submitted {formatDate(submission.attempt.takenAt)} · Pass
                    mark {submission.lesson.assessmentPassMark}%
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-violet-950">
                        <Sparkles size={17} />
                        <p className="text-sm font-bold">AI-assisted staff review</p>
                      </div>
                      <p className="mt-1 max-w-3xl text-xs leading-5 text-violet-950/80">
                        This compares the submitted answers with the private marking guide to create editable suggestions. Nothing is sent to the agent, no result changes and no pass/fail decision is made until staff review and use the normal release action below.
                      </p>
                      {submission.aiReview && (
                        <p className="mt-2 text-xs font-medium text-violet-900">
                          Latest internal review generated {formatDate(submission.aiReview.generatedAt)} using {submission.aiReview.model}.
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-violet-300 bg-white text-violet-950 hover:bg-violet-100"
                        disabled={Boolean(aiReviewingAttemptId)}
                        onClick={() => onGenerateAiReview(submission.attempt.id)}
                      >
                        <Sparkles className="mr-1.5" size={15} />
                        {aiReviewingAttemptId === submission.attempt.id
                          ? "Preparing review..."
                          : submission.aiReview
                            ? "Generate fresh AI review"
                            : "Generate AI review"}
                      </Button>
                      {submission.aiReview && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="border-violet-300 bg-white text-violet-950 hover:bg-violet-100"
                          onClick={() => useAiReviewAsDraft(submission, fallback)}
                        >
                          Use suggestions as editable draft
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-4">
                  {submission.responses.map((response: any, index: number) => {
                    const grade = draft.responses[response.questionId] ?? {
                      score: -1,
                      feedback: "",
                    };
                    const aiSuggestion = submission.aiReview?.suggestions?.find(
                      (suggestion: any) => suggestion.questionId === response.questionId
                    );
                    return (
                      <div
                        key={response.questionId}
                        className="rounded-lg border bg-card p-3"
                      >
                        <div>
                          <p className="font-semibold">
                            Written question {index + 1}
                          </p>
                          <AcademyStructuredText
                            text={response.prompt}
                            className="mt-2 text-sm"
                          />
                          {response.explanation && (
                            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[.12em] text-amber-900">
                                Private marking guide
                              </p>
                              <AcademyStructuredText
                                text={response.explanation}
                                className="mt-2 text-sm text-amber-950"
                              />
                            </div>
                          )}
                        </div>
                        <div className="mt-2 rounded-md bg-muted/50 p-3 text-sm leading-6 whitespace-pre-wrap">
                          {response.responseText}
                        </div>
                        {aiSuggestion && (
                          <div className="mt-3 rounded-md border border-violet-200 bg-violet-50/70 p-3 text-sm text-violet-950">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-semibold">
                                  Internal AI suggestion · {aiSuggestion.suggestedScore}% · {aiSuggestion.confidence} confidence
                                </p>
                                <p className="mt-1 text-xs leading-5">
                                  Staff attention: <strong>{aiSuggestion.staffAttention}</strong>
                                  {aiSuggestion.attentionReason ? ` — ${aiSuggestion.attentionReason}` : ""}
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="shrink-0 border-violet-300 bg-white text-violet-950 hover:bg-violet-100"
                                onClick={() =>
                                  updateDraft(
                                    submission.attempt.id,
                                    (current: any) => ({
                                      ...current,
                                      responses: {
                                        ...current.responses,
                                        [response.questionId]: {
                                          score: aiSuggestion.suggestedScore,
                                          feedback: aiSuggestion.suggestedFeedback,
                                        },
                                      },
                                    }),
                                    fallback
                                  )
                                }
                              >
                                Use this suggestion
                              </Button>
                            </div>
                            {aiSuggestion.strengths.length > 0 && (
                              <p className="mt-2 text-xs leading-5"><strong>Identified strengths:</strong> {aiSuggestion.strengths.join("; ")}</p>
                            )}
                            {aiSuggestion.missingOrIncorrect.length > 0 && (
                              <p className="mt-1 text-xs leading-5"><strong>Missing or unclear:</strong> {aiSuggestion.missingOrIncorrect.join("; ")}</p>
                            )}
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6"><strong>Draft feedback:</strong> {aiSuggestion.suggestedFeedback}</p>
                          </div>
                        )}
                        <div className="mt-3 grid gap-3 md:grid-cols-[150px_minmax(0,1fr)]">
                          <div>
                            <Label>Score (%)</Label>
                            <Input
                              className="mt-1.5"
                              aria-label={`Score for written question ${index + 1}`}
                              type="number"
                              min="0"
                              max="100"
                              value={grade.score < 0 ? "" : grade.score}
                              onChange={event =>
                                updateDraft(
                                  submission.attempt.id,
                                  (current: any) => ({
                                    ...current,
                                    responses: {
                                      ...current.responses,
                                      [response.questionId]: {
                                        ...current.responses[
                                          response.questionId
                                        ],
                                        score:
                                          event.target.value === ""
                                            ? -1
                                            : Math.max(
                                                0,
                                                Math.min(
                                                  100,
                                                  Number(event.target.value)
                                                )
                                              ),
                                      },
                                    },
                                  }),
                                  fallback
                                )
                              }
                            />
                          </div>
                          <div>
                            <Label>Feedback for this answer</Label>
                            <Textarea
                              className="mt-1.5"
                              rows={3}
                              value={grade.feedback}
                              placeholder="Explain what was done well and what the agent should improve."
                              onChange={event =>
                                updateDraft(
                                  submission.attempt.id,
                                  (current: any) => ({
                                    ...current,
                                    responses: {
                                      ...current.responses,
                                      [response.questionId]: {
                                        ...current.responses[
                                          response.questionId
                                        ],
                                        feedback: event.target.value,
                                      },
                                    },
                                  }),
                                  fallback
                                )
                              }
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4">
                  <Label>Overall feedback for the agent</Label>
                  <Textarea
                    className="mt-1.5"
                    rows={4}
                    value={draft.feedback}
                    placeholder="Summarise the assessment result and the practical next step."
                    onChange={event =>
                      updateDraft(
                        submission.attempt.id,
                        (current: any) => ({
                          ...current,
                          feedback: event.target.value,
                        }),
                        fallback
                      )
                    }
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    This message is shown to the agent alongside their
                    question-level feedback and must be acknowledged before they
                    continue.
                  </p>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button
                    disabled={!readyToMark || marking}
                    onClick={() =>
                      onMark(
                        submission.attempt.id,
                        draft.feedback,
                        submission.responses.map((response: any) => ({
                          questionId: response.questionId,
                          score: draft.responses[response.questionId].score,
                          feedback:
                            draft.responses[response.questionId].feedback,
                        }))
                      )
                    }
                  >
                    {marking
                      ? "Saving feedback..."
                      : "Save grade and send feedback"}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-dashed bg-muted/15 p-6 text-center text-sm text-muted-foreground">
          No written assessments are waiting for review. Multiple-choice checks
          continue to score automatically.
        </div>
      )}
    </section>
  );
}

export function AssessmentSupportQueue({
  items,
  onReset,
  resetting,
}: {
  items: Array<any>;
  onReset: (item: any) => void;
  resetting: boolean;
}) {
  return (
    <section className="rounded-2xl border border-rose-200 bg-rose-50/35 p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-rose-700">
            Staff support required
          </p>
          <h2 className="mt-1 text-xl font-bold">Three-attempt escalation</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These individual questions have not passed after three attempts.
            Provide coaching first, then reopen only that question; every prior
            attempt remains in the Academy history.
          </p>
        </div>
        <div className="rounded-full bg-rose-100 px-3 py-1.5 text-sm font-bold text-rose-800">
          {items.length} awaiting support
        </div>
      </div>
      {items.length ? (
        <div className="mt-5 space-y-3">
          {items.map(item => (
            <article
              key={`${item.enrollment.id}-${item.question.id}`}
              className="rounded-xl border border-rose-200 bg-card p-4"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="font-bold">
                    {item.agent.name || item.agent.email}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {item.course.title} · {item.lesson.title}
                  </p>
                  <AcademyStructuredText
                    text={item.question.prompt}
                    className="mt-3 text-sm"
                  />
                  {item.question.explanation && (
                    <div className="mt-3 rounded-md border border-rose-200 bg-rose-50/65 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[.12em] text-rose-900">
                        Private marking guide
                      </p>
                      <AcademyStructuredText
                        text={item.question.explanation}
                        className="mt-2 text-sm text-rose-950"
                      />
                    </div>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.attemptCount} attempts used · Latest score{" "}
                    {item.lastScore ?? 0}% ·{" "}
                    {item.question.questionType === "free_text"
                      ? "Written response"
                      : "Multiple choice"}
                  </p>
                </div>
                <Button
                  className="shrink-0"
                  variant="outline"
                  disabled={resetting}
                  onClick={() => onReset(item)}
                >
                  {resetting
                    ? "Reopening..."
                    : "Record support & reopen question"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-dashed border-rose-200 bg-background/70 p-6 text-center text-sm text-muted-foreground">
          No questions have reached the three-attempt support threshold.
        </div>
      )}
    </section>
  );
}

export function LearnerManager({
  course,
  progress,
  onAccess,
  accessNotes,
  setAccessNotes,
  onOverride,
  onAccredit,
  reviewEnrollmentId,
  setReviewEnrollmentId,
}: any) {
  const learnerReview = trpc.academy.admin.learnerReview.useQuery(
    { enrollmentId: reviewEnrollmentId ?? 0 },
    { enabled: !!reviewEnrollmentId }
  );
  const review = learnerReview.data;

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">
            Learners
          </p>
          <h2 className="mt-1 text-xl font-bold">Enrolment and progress</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the visible Academy enrolment panel above to assign agents. Open
            a learner review here to see their current lesson, saved
            acknowledgements, every assessment attempt, written responses and
            staff feedback in one place.
          </p>
        </div>
        <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm font-semibold">
          {progress.length} enrolments
        </div>
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-2 py-3 font-semibold">Agent</th>
              <th className="px-2 py-3 font-semibold">Progress</th>
              <th className="px-2 py-3 font-semibold">Due / status</th>
              <th className="px-2 py-3 font-semibold">Development stage</th>
              <th className="px-2 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {progress.map((row: any) => (
              <tr
                key={row.enrollment.id}
                className={
                  row.enrollment.id === reviewEnrollmentId
                    ? "bg-[#70FFE8]/10"
                    : undefined
                }
              >
                <td className="px-2 py-4">
                  <div className="font-semibold">
                    {row.agent.name || "Unnamed agent"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.agent.email}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      className="h-7 max-w-[190px] text-xs"
                      placeholder="Optional access note"
                      value={accessNotes[row.agent.id] ?? ""}
                      onChange={e =>
                        setAccessNotes({
                          ...accessNotes,
                          [row.agent.id]: e.target.value,
                        })
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => onAccess(row.agent.id, true)}
                    >
                      <LockKeyhole className="mr-1" size={12} />
                      Grant Academy
                    </Button>
                  </div>
                </td>
                <td className="px-2 py-4">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-[#00c9b4]"
                        style={{ width: `${row.completion.percentage}%` }}
                      />
                    </div>
                    <span className="font-semibold">
                      {row.completion.percentage}%
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {row.completion.completedRequiredLessons}/
                    {row.completion.requiredLessons} required
                  </div>
                </td>
                <td className="px-2 py-4">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${row.enrollment.status === "completed" ? "bg-emerald-100 text-emerald-700" : row.enrollment.status === "waived" ? "bg-blue-100 text-blue-700" : row.overdue ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}
                  >
                    {row.enrollment.status.replace("_", " ")}
                  </span>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {row.enrollment.dueDate
                      ? `${row.overdue ? "Overdue" : "Due"} ${formatDate(row.enrollment.dueDate)}`
                      : "No deadline"}
                  </div>
                </td>
                <td className="px-2 py-4">
                  <p className="font-medium">
                    {row.profile?.trainingStage || "Training"}
                  </p>
                  {row.accreditation.eligible ? (
                    <span className="mt-1 inline-flex rounded-full bg-[#70FFE8]/30 px-2 py-0.5 text-xs font-semibold text-[#27302e]">
                      Accreditation available
                    </span>
                  ) : row.accreditation.daysRemaining !== null ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.accreditation.daysRemaining} day
                      {row.accreditation.daysRemaining === 1 ? "" : "s"} until
                      review window
                    </p>
                  ) : null}
                </td>
                <td className="px-2 py-4 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant={
                        row.enrollment.id === reviewEnrollmentId
                          ? "default"
                          : "outline"
                      }
                      className="text-xs"
                      onClick={() => setReviewEnrollmentId(row.enrollment.id)}
                    >
                      <Eye className="mr-1" size={13} />
                      Review
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => onOverride(row.enrollment.id, "complete")}
                    >
                      <CheckCircle2 className="mr-1" size={13} />
                      Complete
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => onOverride(row.enrollment.id, "waive")}
                    >
                      Waive
                    </Button>
                    {["completed", "waived"].includes(
                      row.enrollment.status
                    ) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        onClick={() => onOverride(row.enrollment.id, "reopen")}
                      >
                        Reopen
                      </Button>
                    )}
                    {row.accreditation.eligible &&
                      row.profile?.trainingStage !== "Accredited" && (
                        <Button
                          size="sm"
                          className="text-xs"
                          onClick={() => onAccredit(row.agent.id)}
                        >
                          <Trophy className="mr-1" size={13} />
                          Accredit
                        </Button>
                      )}
                  </div>
                </td>
              </tr>
            ))}
            {!progress.length && (
              <tr>
                <td
                  colSpan={5}
                  className="px-2 py-8 text-center text-sm text-muted-foreground"
                >
                  No agents are enrolled in {course.title} yet. Select an active
                  agent above to assign this course.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {reviewEnrollmentId && (
        <section className="mt-6 rounded-2xl border-2 border-[#70FFE8]/55 bg-muted/10 p-4 md:p-5">
          {learnerReview.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <RefreshCw className="animate-spin" size={16} /> Loading the
              learner’s Academy record…
            </div>
          ) : learnerReview.error || !review ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <p className="font-semibold">
                Learner review could not be loaded
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {learnerReview.error?.message ||
                  "Try opening the learner review again."}
              </p>
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={() => learnerReview.refetch()}
              >
                <RefreshCw className="mr-1" size={14} />
                Retry
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">
                    Learner review
                  </p>
                  <h3 className="mt-1 text-xl font-bold">
                    {review.agent.name || review.agent.email}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {review.course.title} ·{" "}
                    {review.agent.trainingStage || "Training"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-card px-3 py-1.5 text-sm font-semibold shadow-sm">
                    {review.completion.percentage}% complete
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReviewEnrollmentId(null)}
                  >
                    Close review
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border bg-card p-3">
                  <p className="text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">
                    Required lessons
                  </p>
                  <p className="mt-1 text-lg font-bold">
                    {review.completion.completedRequiredLessons} /{" "}
                    {review.completion.requiredLessons}
                  </p>
                </div>
                <div className="rounded-xl border bg-card p-3">
                  <p className="text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">
                    Current required lesson
                  </p>
                  <p className="mt-1 text-sm font-semibold leading-5">
                    {review.currentRequiredLesson?.title ||
                      "All required lessons complete"}
                  </p>
                </div>
                <div className="rounded-xl border bg-card p-3">
                  <p className="text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">
                    Course status
                  </p>
                  <p className="mt-1 text-sm font-semibold capitalize">
                    {review.enrollment.status.replace("_", " ")}
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
                <div>
                  <p className="text-sm font-semibold">
                    Lesson progress and assessment history
                  </p>
                  <div className="mt-3 space-y-4">
                    {review.modules.map((module: any, moduleIndex: number) => (
                      <section
                        key={module.id}
                        className="overflow-hidden rounded-xl border bg-card"
                      >
                        <div className="border-b bg-muted/35 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[.12em] text-primary">
                            Module {moduleIndex + 1}
                          </p>
                          <h4 className="mt-0.5 font-semibold">
                            {module.title}
                          </h4>
                        </div>
                        <div className="divide-y">
                          {module.lessons.map((lesson: any) => (
                            <article key={lesson.id} className="p-4">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <p className="font-semibold">
                                    {lesson.title}
                                  </p>
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    {lesson.isRequired
                                      ? "Required"
                                      : "Optional"}
                                    {lesson.requiresAcknowledgement
                                      ? " · Acknowledgement required"
                                      : ""}
                                    {lesson.requiresAssessment
                                      ? " · Knowledge check"
                                      : ""}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
                                  {lesson.progress?.completedAt ? (
                                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-800">
                                      Completed
                                    </span>
                                  ) : lesson.progress?.startedAt ? (
                                    <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">
                                      In progress
                                    </span>
                                  ) : (
                                    <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                                      Not started
                                    </span>
                                  )}
                                  {lesson.requiresAcknowledgement && (
                                    <span
                                      className={`rounded-full px-2 py-1 ${lesson.progress?.acknowledgedAt ? "bg-sky-100 text-sky-800" : "bg-muted text-muted-foreground"}`}
                                    >
                                      {lesson.progress?.acknowledgedAt
                                        ? "Acknowledged"
                                        : "Not acknowledged"}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                {lesson.progress && (
                                  <>
                                    <span>
                                      Lesson active{" "}
                                      {formatActiveDuration(
                                        lesson.progress.lessonActiveSeconds
                                      )}
                                    </span>
                                    {lesson.requiresAssessment && (
                                      <span>
                                        Knowledge check active{" "}
                                        {formatActiveDuration(
                                          lesson.progress
                                            .assessmentActiveSeconds
                                        )}
                                      </span>
                                    )}
                                  </>
                                )}
                                {lesson.progress?.lastViewedAt && (
                                  <span>
                                    Last viewed{" "}
                                    {formatDateTime(
                                      lesson.progress.lastViewedAt
                                    )}
                                  </span>
                                )}
                                {lesson.progress?.acknowledgedAt && (
                                  <span>
                                    Acknowledged{" "}
                                    {formatDateTime(
                                      lesson.progress.acknowledgedAt
                                    )}
                                  </span>
                                )}
                                {lesson.progress?.completedAt && (
                                  <span>
                                    Completed{" "}
                                    {formatDateTime(
                                      lesson.progress.completedAt
                                    )}
                                  </span>
                                )}
                              </div>
                              {lesson.attempts.length > 0 && (
                                <div className="mt-4 space-y-3">
                                  {lesson.attempts.map(
                                    (attempt: any, attemptIndex: number) => (
                                      <div
                                        key={attempt.id}
                                        className="rounded-lg border bg-muted/15 p-3"
                                      >
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <p className="text-sm font-semibold">
                                            Attempt{" "}
                                            {lesson.attempts.length -
                                              attemptIndex}{" "}
                                            · {formatDateTime(attempt.takenAt)}
                                          </p>
                                          <span
                                            className={`rounded-full px-2 py-1 text-xs font-semibold ${attempt.status === "awaiting_marking" ? "bg-amber-100 text-amber-800" : attempt.passed ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}
                                          >
                                            {attempt.status.replaceAll(
                                              "_",
                                              " "
                                            )}
                                            {attempt.score !== null
                                              ? ` · ${attempt.score}%`
                                              : ""}
                                          </span>
                                        </div>
                                        {attempt.graderFeedback && (
                                          <div className="mt-3 rounded-md border border-blue-200 bg-blue-50/60 p-3 text-sm">
                                            <p className="font-semibold text-blue-950">
                                              Staff feedback
                                            </p>
                                            <p className="mt-1 whitespace-pre-wrap leading-6 text-blue-950">
                                              {attempt.graderFeedback}
                                            </p>
                                            {attempt.feedbackAcknowledgedAt && (
                                              <p className="mt-2 text-xs font-semibold text-blue-800">
                                                Acknowledged by agent{" "}
                                                {formatDateTime(
                                                  attempt.feedbackAcknowledgedAt
                                                )}
                                              </p>
                                            )}
                                          </div>
                                        )}
                                        <div className="mt-3 space-y-2">
                                          {attempt.responses.map(
                                            (
                                              response: any,
                                              responseIndex: number
                                            ) => (
                                              <div
                                                key={response.questionId}
                                                className="rounded-md border bg-background p-3 text-sm"
                                              >
                                                <p className="font-semibold">
                                                  Question {responseIndex + 1}
                                                </p>
                                                <AcademyStructuredText
                                                  text={response.prompt}
                                                  className="mt-2 text-sm"
                                                />
                                                {response.questionType ===
                                                "free_text" ? (
                                                  <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/60 p-2 leading-6">
                                                    {response.responseText ||
                                                      "No written answer saved"}
                                                  </p>
                                                ) : (
                                                  <p className="mt-2 text-muted-foreground">
                                                    Selected:{" "}
                                                    <strong
                                                      className={
                                                        response.selectedAnswer ===
                                                        response.correctAnswer
                                                          ? "text-emerald-700"
                                                          : "text-rose-700"
                                                      }
                                                    >
                                                      {response.selectedAnswer ||
                                                        "No answer"}
                                                    </strong>
                                                    {response.correctAnswer && (
                                                      <>
                                                        {" "}
                                                        · Correct:{" "}
                                                        <strong>
                                                          {
                                                            response.correctAnswer
                                                          }
                                                        </strong>
                                                      </>
                                                    )}
                                                  </p>
                                                )}
                                                <p className="mt-2 text-xs text-muted-foreground">
                                                  Score:{" "}
                                                  {response.score ??
                                                    "Awaiting marking"}
                                                  {response.feedback
                                                    ? ` · Feedback: ${response.feedback}`
                                                    : ""}
                                                </p>
                                              </div>
                                            )
                                          )}
                                        </div>
                                      </div>
                                    )
                                  )}
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
                <aside className="space-y-4">
                  <div className="rounded-xl border bg-card p-4">
                    <p className="text-sm font-semibold">Review guidance</p>
                    <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                      <li>
                        Use the written assessment queue above to grade
                        submissions awaiting marking.
                      </li>
                      <li>
                        Each selected answer and written response remains
                        visible here for audit.
                      </li>
                      <li>
                        Saved acknowledgements show that the learner explicitly
                        confirmed a lesson or feedback.
                      </li>
                    </ul>
                  </div>
                  <div className="rounded-xl border bg-card p-4">
                    <p className="text-sm font-semibold">Academy activity</p>
                    {review.audit.length ? (
                      <div className="mt-3 space-y-3">
                        {review.audit.map((event: any) => (
                          <div
                            key={event.id}
                            className="border-l-2 border-[#70FFE8] pl-3"
                          >
                            <p className="text-sm leading-5">{event.summary}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatDateTime(event.createdAt)}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">
                        No recorded Academy activity yet.
                      </p>
                    )}
                  </div>
                </aside>
              </div>
            </>
          )}
        </section>
      )}
    </section>
  );
}
