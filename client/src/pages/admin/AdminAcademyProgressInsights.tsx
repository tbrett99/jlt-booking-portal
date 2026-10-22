import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Eye,
  GraduationCap,
  MailCheck,
  RefreshCw,
  Search,
  ShieldAlert,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AssessmentSupportQueue,
  LearnerManager,
  WrittenAssessmentQueue,
} from "./AdminAcademy";

const formatDate = (value: Date | string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
const formatDateTime = (value: Date | string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "No activity recorded";
const formatDuration = (value: number | null | undefined) => {
  const seconds = Math.max(0, Number(value || 0));
  if (!seconds) return "Not recorded";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${Math.max(1, minutes)}m`;
};

type Tab = "overview" | "learners" | "assessments" | "curriculum";

function MetricCard({
  label,
  value,
  detail,
  tone = "default",
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "default" | "amber" | "rose" | "mint";
  icon: React.ReactNode;
}) {
  const styles =
    tone === "rose"
      ? "border-rose-200 bg-rose-50/70"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50/70"
        : tone === "mint"
          ? "border-[#70FFE8]/60 bg-[#70FFE8]/12"
          : "bg-card";
  return (
    <section className={`rounded-2xl border p-4 shadow-sm ${styles}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.13em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            {detail}
          </p>
        </div>
        <span className="rounded-xl bg-background/80 p-2 text-primary shadow-sm">
          {icon}
        </span>
      </div>
    </section>
  );
}

function TabButton({
  active,
  children,
  onClick,
  count,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${active ? "bg-[#27302e] text-white shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
    >
      {children}
      {count !== undefined && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-xs ${active ? "bg-white/15 text-white" : "bg-muted"}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default function AdminAcademyProgressInsights() {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>("overview");
  const [courseId, setCourseId] = useState<number | null>(null);
  const [learnerSearch, setLearnerSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<
    "all" | "attention" | "overdue" | "inactive" | "marking"
  >("all");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [accessNotes, setAccessNotes] = useState<Record<number, string>>({});
  const [gradingDrafts, setGradingDrafts] = useState<
    Record<
      number,
      {
        feedback: string;
        responses: Record<number, { score: number; feedback: string }>;
      }
    >
  >({});
  const [reviewEnrollmentId, setReviewEnrollmentId] = useState<number | null>(
    null
  );

  const { data: courses = [] } = trpc.academy.admin.courses.useQuery();
  const insights = trpc.academy.admin.insights.useQuery(
    courseId ? { courseId } : undefined
  );
  const { data: progress = [] } = trpc.academy.admin.progress.useQuery(
    courseId ? { courseId } : undefined
  );
  const { data: markingQueue = [] } =
    trpc.academy.admin.markingQueue.useQuery();
  const { data: supportQueue = [] } =
    trpc.academy.admin.supportQueue.useQuery();
  const { data: agents = [] } = trpc.users.listAgents.useQuery();
  const selectedCourse = courses.find(course => course.id === courseId) ?? null;
  const metrics = insights.data?.metrics;

  const invalidate = () => {
    utils.academy.admin.insights.invalidate();
    utils.academy.admin.progress.invalidate();
    utils.academy.admin.markingQueue.invalidate();
    utils.academy.admin.supportQueue.invalidate();
    utils.academy.admin.learnerReview.invalidate();
    utils.academy.admin.courses.invalidate();
  };
  const enroll = trpc.academy.admin.enroll.useMutation({
    onSuccess: result => {
      toast.success(
        result.created ? "Agent enrolled" : "Agent is already enrolled"
      );
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const setAccess = trpc.academy.admin.setAccess.useMutation({
    onSuccess: () => {
      toast.success("Academy access updated");
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const overrideCompletion = trpc.academy.admin.overrideCompletion.useMutation({
    onSuccess: () => {
      toast.success("Completion record updated");
      invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const approveAccreditation =
    trpc.academy.admin.approveAccreditation.useMutation({
      onSuccess: () => {
        toast.success("Agent is now Accredited");
        invalidate();
      },
      onError: error => toast.error(error.message),
    });
  const markWrittenAssessment =
    trpc.academy.admin.markWrittenAssessment.useMutation({
      onSuccess: () => {
        toast.success("Assessment marked and feedback sent to the agent");
        invalidate();
      },
      onError: error => toast.error(error.message),
    });
  const resetQuestionAttempts =
    trpc.academy.admin.resetQuestionAttempts.useMutation({
      onSuccess: () => {
        toast.success("Question reopened after staff support");
        invalidate();
      },
      onError: error => toast.error(error.message),
    });
  const sendDueReminders = trpc.academy.admin.sendDueReminders.useMutation({
    onSuccess: ({ sent }) =>
      toast.success(
        sent
          ? `Sent ${sent} due reminder${sent === 1 ? "" : "s"}`
          : "No due Academy reminders to send"
      ),
    onError: error => toast.error(error.message),
  });

  const learners = useMemo(
    () =>
      (insights.data?.learners ?? []).filter(item => {
        const query = learnerSearch.trim().toLowerCase();
        const matchingQuery =
          !query ||
          `${item.learner.name || ""} ${item.learner.email || ""} ${item.course.title}`
            .toLowerCase()
            .includes(query);
        const needsAttention =
          item.due.overdue ||
          (item.inactiveDays !== null && item.inactiveDays >= 7) ||
          item.assessment.awaitingMarking > 0 ||
          item.assessment.feedbackPending > 0 ||
          item.assessment.supportLocks > 0;
        const matchingRisk =
          riskFilter === "all" ||
          (riskFilter === "attention" && needsAttention) ||
          (riskFilter === "overdue" && item.due.overdue) ||
          (riskFilter === "inactive" &&
            (item.inactiveDays === null || item.inactiveDays >= 7)) ||
          (riskFilter === "marking" &&
            (item.assessment.awaitingMarking > 0 ||
              item.assessment.feedbackPending > 0 ||
              item.assessment.supportLocks > 0));
        return matchingQuery && matchingRisk;
      }),
    [insights.data?.learners, learnerSearch, riskFilter]
  );
  const agentOptions = useMemo(
    () =>
      agents
        .filter(agent => agent.role === "agent")
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [agents]
  );
  const publishedCourses = useMemo(
    () => courses.filter(course => course.status === "published"),
    [courses]
  );

  function override(
    enrollmentId: number,
    action: "complete" | "reopen" | "waive"
  ) {
    const reason = window.prompt(
      action === "reopen"
        ? "Why is this course being reopened?"
        : `Reason for this staff ${action} override:`
    );
    if (reason?.trim())
      overrideCompletion.mutate({ enrollmentId, action, reason });
  }
  function accredit(agentId: number) {
    const reason = window.prompt(
      "Why is this agent ready to become Accredited?"
    );
    if (reason?.trim()) approveAccreditation.mutate({ agentId, reason });
  }
  function resetQuestion(item: any) {
    const reason = window.prompt(
      `What support has been provided to ${item.agent.name || item.agent.email} before reopening this question?`
    );
    if (reason?.trim())
      resetQuestionAttempts.mutate({
        enrollmentId: item.enrollment.id,
        lessonId: item.lesson.id,
        questionId: item.question.id,
        reason,
      });
  }
  function openLearner(item: any) {
    setCourseId(item.course.id);
    setReviewEnrollmentId(item.enrollment.id);
    setTab("learners");
  }

  if (insights.isLoading)
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-48 rounded-3xl bg-muted" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-36 rounded-2xl bg-muted" />
          ))}
        </div>
      </div>
    );
  if (!insights.data || !metrics)
    return (
      <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
        <h1 className="text-xl font-bold">
          Academy Progress &amp; Insights could not be loaded
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No Academy records have been changed. Refresh the page or try again.
        </p>
        <Button
          className="mt-4"
          variant="outline"
          onClick={() => insights.refetch()}
        >
          <RefreshCw className="mr-2" size={16} />
          Retry
        </Button>
      </section>
    );

  const activeCourseLabel = selectedCourse?.title || "All Academy courses";
  const courseMarking = courseId
    ? markingQueue.filter(item => item.course.id === courseId)
    : markingQueue;
  const courseSupport = courseId
    ? supportQueue.filter(item => item.course.id === courseId)
    : supportQueue;
  const curriculumLessons = insights.data.curriculum.lessons.filter(
    item => !courseId || item.courseId === courseId
  );
  const curriculumQuestions = insights.data.curriculum.questions.filter(
    item => !courseId || item.courseId === courseId
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="rounded-3xl border border-[#70FFE8]/45 bg-gradient-to-r from-[#414141] to-[#2d3534] p-6 text-white shadow-sm md:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#70FFE8]">
              <BarChart3 size={18} /> Academy Progress &amp; Insights
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">
              See learning, act early.
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/75">
              A dedicated LMS operations space for enrolment, progress, marking,
              support locks, active study time and curriculum friction. All
              activity timestamps display in local time.
            </p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 p-3 text-sm">
            <p className="font-semibold">Recorded active time</p>
            <p className="mt-1 text-white/75">
              Visible-session pulses only — useful for support, not a timesheet.
            </p>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1">
            <TabButton
              active={tab === "overview"}
              onClick={() => setTab("overview")}
            >
              Overview
            </TabButton>
            <TabButton
              active={tab === "learners"}
              onClick={() => setTab("learners")}
              count={metrics.enrolments.total}
            >
              Learners
            </TabButton>
            <TabButton
              active={tab === "assessments"}
              onClick={() => setTab("assessments")}
              count={
                metrics.assessments.awaitingMarking +
                metrics.assessments.supportLocks
              }
            >
              Assessments &amp; support
            </TabButton>
            <TabButton
              active={tab === "curriculum"}
              onClick={() => setTab("curriculum")}
            >
              Curriculum insights
            </TabButton>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="academy-insights-course" className="sr-only">
              Course filter
            </Label>
            <select
              id="academy-insights-course"
              className="h-10 max-w-[270px] rounded-md border bg-background px-3 text-sm"
              value={courseId ?? ""}
              onChange={event => {
                setCourseId(
                  event.target.value ? Number(event.target.value) : null
                );
                setReviewEnrollmentId(null);
              }}
            >
              <option value="">All Academy courses</option>
              {courses.map(course => (
                <option key={course.id} value={course.id}>
                  {course.title} · {course.status}
                </option>
              ))}
            </select>
            <Button
              size="icon"
              variant="outline"
              title="Refresh Academy insights"
              onClick={() => insights.refetch()}
            >
              <RefreshCw size={16} />
            </Button>
          </div>
        </div>
      </section>

      {tab === "overview" && (
        <div className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Enrolments"
              value={metrics.enrolments.total}
              detail={`${metrics.enrolments.uniqueLearners} unique learner${metrics.enrolments.uniqueLearners === 1 ? "" : "s"} · ${metrics.enrolments.assigned} not started`}
              icon={<UsersRound size={20} />}
            />
            <MetricCard
              label="In progress"
              value={metrics.enrolments.inProgress}
              detail={`${metrics.enrolments.completed} completed · ${metrics.enrolments.waived} waived`}
              tone="mint"
              icon={<BookOpenCheck size={20} />}
            />
            <MetricCard
              label="Overdue"
              value={metrics.due.overdue}
              detail={`${metrics.due.dueSoon} due within ${metrics.due.dueSoonDays} days`}
              tone={metrics.due.overdue ? "rose" : "default"}
              icon={<AlertTriangle size={20} />}
            />
            <MetricCard
              label="7+ days inactive"
              value={metrics.inactivity.inactive7Plus}
              detail={`${metrics.inactivity.inactive14Plus} at 14+ · ${metrics.inactivity.inactive30Plus} at 30+`}
              tone={metrics.inactivity.inactive7Plus ? "amber" : "default"}
              icon={<Activity size={20} />}
            />
            <MetricCard
              label="Awaiting marking"
              value={metrics.assessments.awaitingMarking}
              detail={`${metrics.assessments.feedbackPending} feedback acknowledgement${metrics.assessments.feedbackPending === 1 ? "" : "s"} pending`}
              tone={metrics.assessments.awaitingMarking ? "amber" : "default"}
              icon={<MailCheck size={20} />}
            />
            <MetricCard
              label="Support locks"
              value={metrics.assessments.supportLocks}
              detail="Current questions at the three-attempt threshold"
              tone={metrics.assessments.supportLocks ? "rose" : "default"}
              icon={<ShieldAlert size={20} />}
            />
            <MetricCard
              label="Recorded active time"
              value={formatDuration(metrics.activeTime.totalSeconds)}
              detail={`Average ${formatDuration(metrics.activeTime.averageSecondsPerRecordedLearner)} across ${metrics.activeTime.recordedLearners} active learner${metrics.activeTime.recordedLearners === 1 ? "" : "s"}`}
              icon={<Clock3 size={20} />}
            />
            <MetricCard
              label="No activity recorded"
              value={metrics.inactivity.noRecordedActivity}
              detail="In-progress learners with no visible Academy activity yet"
              icon={<Eye size={20} />}
            />
          </section>
          <section className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
            <article className="rounded-2xl border bg-card p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[.15em] text-muted-foreground">
                Priorities
              </p>
              <h2 className="mt-1 text-xl font-bold">
                Where staff attention is needed
              </h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setTab("learners");
                    setRiskFilter("overdue");
                  }}
                  className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 text-left transition hover:bg-rose-100/70"
                >
                  <p className="font-semibold">Chase overdue learners</p>
                  <p className="mt-1 text-2xl font-bold text-rose-700">
                    {metrics.due.overdue}
                  </p>
                  <p className="mt-1 text-xs text-rose-800">
                    Open filtered learner records
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab("learners");
                    setRiskFilter("inactive");
                  }}
                  className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-left transition hover:bg-amber-100/70"
                >
                  <p className="font-semibold">Re-engage inactive learners</p>
                  <p className="mt-1 text-2xl font-bold text-amber-700">
                    {metrics.inactivity.inactive7Plus}
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    7+ days since visible Academy activity
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setTab("assessments")}
                  className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 text-left transition hover:bg-sky-100/70"
                >
                  <p className="font-semibold">Mark written work</p>
                  <p className="mt-1 text-2xl font-bold text-sky-700">
                    {metrics.assessments.awaitingMarking}
                  </p>
                  <p className="mt-1 text-xs text-sky-800">
                    Each marked response sends feedback to the learner
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setTab("assessments")}
                  className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 text-left transition hover:bg-violet-100/70"
                >
                  <p className="font-semibold">Resolve support locks</p>
                  <p className="mt-1 text-2xl font-bold text-violet-700">
                    {metrics.assessments.supportLocks}
                  </p>
                  <p className="mt-1 text-xs text-violet-800">
                    Provide support, then reopen only the locked question
                  </p>
                </button>
              </div>
            </article>
            <aside className="rounded-2xl border bg-card p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[.15em] text-muted-foreground">
                Quick actions
              </p>
              <h2 className="mt-1 text-xl font-bold">Academy operations</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Apply reminders only to the selected course. Use the Learners
                view to enrol and review individual agents.
              </p>
              <Button
                className="mt-5 w-full"
                variant="outline"
                disabled={!courseId || sendDueReminders.isPending}
                onClick={() =>
                  courseId && sendDueReminders.mutate({ courseId })
                }
              >
                {sendDueReminders.isPending ? "Sending…" : "Send due reminders"}
              </Button>
              {!courseId && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Select an individual course above before sending reminders.
                </p>
              )}
              <Button
                className="mt-3 w-full"
                onClick={() => setTab("learners")}
              >
                Open learner records <ChevronRight className="ml-1" size={16} />
              </Button>
            </aside>
          </section>
        </div>
      )}

      {tab === "learners" && (
        <div className="space-y-6">
          <section className="rounded-2xl border-2 border-[#70FFE8]/70 bg-gradient-to-br from-[#70FFE8]/16 via-card to-card p-5 shadow-sm md:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <UserPlus size={18} /> Academy enrolment
                </div>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">
                  Enrol an agent
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  Choose a published course and an active agent, then set an
                  optional completion date. This creates the learner record used
                  for progress, assessments and staff review.
                </p>
              </div>
              <div className="rounded-xl border border-[#70FFE8]/60 bg-background/80 px-3 py-2 text-sm font-semibold">
                {publishedCourses.length} published course
                {publishedCourses.length === 1 ? "" : "s"} available
              </div>
            </div>
            {publishedCourses.length ? (
              <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(240px,1fr)_minmax(260px,1fr)_180px_auto] lg:items-end">
                <div>
                  <Label htmlFor="academy-enrol-course">1. Course</Label>
                  <select
                    id="academy-enrol-course"
                    className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={courseId ?? ""}
                    onChange={event => {
                      setCourseId(
                        event.target.value ? Number(event.target.value) : null
                      );
                      setReviewEnrollmentId(null);
                    }}
                  >
                    <option value="">Select a published course…</option>
                    {publishedCourses.map(course => (
                      <option key={course.id} value={course.id}>
                        {course.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="academy-enrol-agent">2. Agent</Label>
                  <select
                    id="academy-enrol-agent"
                    className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={selectedAgentId}
                    onChange={event => setSelectedAgentId(event.target.value)}
                  >
                    <option value="">Select an active agent…</option>
                    {agentOptions.map(agent => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name || agent.email} · {agent.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="academy-enrol-due-date">
                    3. Due date{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="academy-enrol-due-date"
                    className="mt-1.5"
                    type="date"
                    value={dueDate}
                    onChange={event => setDueDate(event.target.value)}
                  />
                </div>
                <Button
                  className="h-10"
                  disabled={
                    !selectedCourse || !selectedAgentId || enroll.isPending
                  }
                  onClick={() =>
                    selectedCourse &&
                    selectedAgentId &&
                    enroll.mutate({
                      agentId: Number(selectedAgentId),
                      courseId: selectedCourse.id,
                      dueDate: dueDate ? new Date(`${dueDate}T12:00:00`) : null,
                    })
                  }
                >
                  <UserPlus className="mr-1.5" size={16} />
                  {enroll.isPending ? "Enrolling…" : "Enrol agent"}
                </Button>
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                <p className="font-semibold text-amber-950">
                  No published Academy courses are ready for enrolment.
                </p>
                <p className="mt-1 text-sm leading-6 text-amber-900">
                  Open Academy Manager, publish the finished course, then return
                  here to enrol agents. Draft courses remain private and cannot
                  be assigned.
                </p>
              </div>
            )}
            {selectedCourse && (
              <p className="mt-3 text-xs text-muted-foreground">
                Selected:{" "}
                <span className="font-semibold text-foreground">
                  {selectedCourse.title}
                </span>
                . The due date is a completion target only; it does not prevent
                agents from continuing to learn after that date.
              </p>
            )}
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.15em] text-muted-foreground">
                  Learner records
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  Progress, risk and individual history
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Each learner record opens the full course journey: lessons,
                  acknowledgement, active time, every attempt, written answer
                  and staff feedback.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search
                    className="absolute left-3 top-3 text-muted-foreground"
                    size={15}
                  />
                  <Input
                    className="w-[250px] pl-9"
                    value={learnerSearch}
                    placeholder="Search learner or course"
                    onChange={event => setLearnerSearch(event.target.value)}
                  />
                </div>
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={riskFilter}
                  onChange={event =>
                    setRiskFilter(event.target.value as typeof riskFilter)
                  }
                >
                  <option value="all">All learner records</option>
                  <option value="attention">Needs attention</option>
                  <option value="overdue">Overdue only</option>
                  <option value="inactive">Inactive / no activity</option>
                  <option value="marking">Assessment action</option>
                </select>
              </div>
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-3">Learner</th>
                    <th className="px-2 py-3">Course & progress</th>
                    <th className="px-2 py-3">Current section</th>
                    <th className="px-2 py-3">Activity</th>
                    <th className="px-2 py-3">Risk / assessment</th>
                    <th className="px-2 py-3 text-right">Record</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {learners.map(item => (
                    <tr key={item.enrollment.id}>
                      <td className="px-2 py-4">
                        <p className="font-semibold">
                          {item.learner.name || "Unnamed agent"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.learner.email}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.learner.trainingStage || "Training"}
                        </p>
                      </td>
                      <td className="px-2 py-4">
                        <p className="font-medium">{item.course.title}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-[#00c9b4]"
                              style={{
                                width: `${item.completion.percentage}%`,
                              }}
                            />
                          </div>
                          <span className="font-semibold">
                            {item.completion.percentage}%
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.completion.completedRequiredLessons}/
                          {item.completion.requiredLessons} required
                        </p>
                      </td>
                      <td className="px-2 py-4">
                        <p className="max-w-52 font-medium leading-5">
                          {item.currentRequiredLesson?.title ||
                            "All required lessons complete"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.due.date
                            ? `${item.due.overdue ? "Overdue" : "Due"} ${formatDate(item.due.date)}`
                            : "No deadline"}
                        </p>
                      </td>
                      <td className="px-2 py-4">
                        <p className="font-medium">
                          {formatDuration(item.activeTimeSeconds)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDateTime(item.lastActivityAt)}
                        </p>
                        {item.inactiveDays !== null && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.inactiveDays} day
                            {item.inactiveDays === 1 ? "" : "s"} inactive
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {item.due.overdue && (
                            <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-800">
                              Overdue
                            </span>
                          )}
                          {(item.inactiveDays === null ||
                            item.inactiveDays >= 7) &&
                            item.enrollment.status === "in_progress" && (
                              <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                                Inactive
                              </span>
                            )}
                          {item.assessment.awaitingMarking > 0 && (
                            <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800">
                              {item.assessment.awaitingMarking} to mark
                            </span>
                          )}
                          {item.assessment.feedbackPending > 0 && (
                            <span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">
                              Feedback pending
                            </span>
                          )}
                          {item.assessment.supportLocks > 0 && (
                            <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-800">
                              {item.assessment.supportLocks} lock
                              {item.assessment.supportLocks === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-4 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openLearner(item)}
                        >
                          <Eye className="mr-1" size={14} />
                          Review
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!learners.length && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-2 py-10 text-center text-muted-foreground"
                      >
                        No learner records match this view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          {selectedCourse ? (
            <LearnerManager
              course={selectedCourse}
              progress={progress}
              agents={agentOptions}
              onAccess={(agentId: number, enabled: boolean) =>
                setAccess.mutate({
                  agentId,
                  enabled,
                  note: accessNotes[agentId] || null,
                })
              }
              accessNotes={accessNotes}
              setAccessNotes={setAccessNotes}
              onOverride={override}
              onAccredit={accredit}
              reviewEnrollmentId={reviewEnrollmentId}
              setReviewEnrollmentId={setReviewEnrollmentId}
            />
          ) : (
            <section className="rounded-2xl border border-dashed bg-muted/10 p-6 text-center">
              <h2 className="font-bold">
                Choose a published course above to manage its learners
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The enrolment panel is now always visible. Select its course to
                see course-specific progress, access controls and individual
                reviews below.
              </p>
            </section>
          )}
        </div>
      )}

      {tab === "assessments" && (
        <div className="space-y-6">
          <section className="grid gap-4 md:grid-cols-3">
            <MetricCard
              label="Written marking"
              value={metrics.assessments.awaitingMarking}
              detail="Submissions waiting for staff grading"
              tone={metrics.assessments.awaitingMarking ? "amber" : "default"}
              icon={<MailCheck size={20} />}
            />
            <MetricCard
              label="Feedback acknowledgement"
              value={metrics.assessments.feedbackPending}
              detail="Agents cannot progress until feedback is read"
              tone={metrics.assessments.feedbackPending ? "amber" : "default"}
              icon={<CheckCircle2 size={20} />}
            />
            <MetricCard
              label="Three-attempt locks"
              value={metrics.assessments.supportLocks}
              detail="Support then a specific-question reset is required"
              tone={metrics.assessments.supportLocks ? "rose" : "default"}
              icon={<ShieldAlert size={20} />}
            />
          </section>
          <WrittenAssessmentQueue
            submissions={courseMarking}
            drafts={gradingDrafts}
            setDrafts={setGradingDrafts}
            onMark={(
              attemptId: number,
              feedback: string,
              responses: Array<{
                questionId: number;
                score: number;
                feedback: string;
              }>
            ) =>
              markWrittenAssessment.mutate({ attemptId, feedback, responses })
            }
            marking={markWrittenAssessment.isPending}
          />
          <AssessmentSupportQueue
            items={courseSupport}
            onReset={resetQuestion}
            resetting={resetQuestionAttempts.isPending}
          />
        </div>
      )}

      {tab === "curriculum" && (
        <div className="space-y-6">
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[.15em] text-muted-foreground">
              Current curriculum
            </p>
            <h2 className="mt-1 text-xl font-bold">
              Lesson friction and learning signals
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              Use this to spot lessons that take materially longer than
              expected, generate support locks or have a low completion rate.
              Active time is approximate visible Portal time; it is never used
              to judge an agent in isolation.
            </p>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-3">Module / lesson</th>
                    <th className="px-2 py-3">Reach</th>
                    <th className="px-2 py-3">Completion</th>
                    <th className="px-2 py-3">Recorded time</th>
                    <th className="px-2 py-3">Assessment signals</th>
                    <th className="px-2 py-3">Staff reading</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {curriculumLessons.map(lesson => {
                    const friction =
                      lesson.supportLocks > 0 ||
                      (lesson.completionRate !== null &&
                        lesson.started >= 5 &&
                        lesson.completionRate < 60);
                    return (
                      <tr key={lesson.id}>
                        <td className="px-2 py-4">
                          <p className="font-semibold">{lesson.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {lesson.moduleTitle} · {lesson.estimatedMinutes} min
                            estimated ·{" "}
                            {lesson.isRequired ? "Required" : "Optional"}
                          </p>
                        </td>
                        <td className="px-2 py-4">
                          <p className="font-medium">
                            {lesson.started}/{lesson.enrolled} started
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {lesson.requiresAcknowledgement
                              ? "Acknowledgement"
                              : "No acknowledgement"}
                            {lesson.requiresAssessment
                              ? " · Knowledge check"
                              : ""}
                          </p>
                        </td>
                        <td className="px-2 py-4">
                          <p className="font-semibold">
                            {lesson.completionRate === null
                              ? "—"
                              : `${lesson.completionRate}%`}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {lesson.completed} completed
                          </p>
                        </td>
                        <td className="px-2 py-4">
                          <p className="font-medium">
                            Lesson {formatDuration(lesson.averageActiveSeconds)}
                          </p>
                          {lesson.requiresAssessment && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Check{" "}
                              {formatDuration(lesson.averageAssessmentSeconds)}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-4">
                          <div className="flex flex-wrap gap-1.5">
                            {lesson.awaitingMarking > 0 && (
                              <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                                {lesson.awaitingMarking} to mark
                              </span>
                            )}
                            {lesson.feedbackPending > 0 && (
                              <span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">
                                {lesson.feedbackPending} feedback
                              </span>
                            )}
                            {lesson.supportLocks > 0 && (
                              <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-800">
                                {lesson.supportLocks} locks
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-4">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-semibold ${friction ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`}
                          >
                            {friction ? "Review friction" : "On track"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {!curriculumLessons.length && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-2 py-10 text-center text-muted-foreground"
                      >
                        No lessons in this view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[.15em] text-muted-foreground">
              Knowledge-check signals
            </p>
            <h2 className="mt-1 text-xl font-bold">
              Question-level difficulty
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Difficulty uses each learner’s first scored response in the
              current question cycle. Labels are suppressed until at least five
              learners have a score; written responses remain outside automatic
              scoring until marked.
            </p>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-3">Lesson / question</th>
                    <th className="px-2 py-3">Type</th>
                    <th className="px-2 py-3">First-score sample</th>
                    <th className="px-2 py-3">Correct at first attempt</th>
                    <th className="px-2 py-3">Support</th>
                    <th className="px-2 py-3">Difficulty</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {curriculumQuestions.map(question => (
                    <tr key={question.id}>
                      <td className="px-2 py-4">
                        <p className="font-medium">{question.lessonTitle}</p>
                        <p className="mt-1 line-clamp-2 max-w-xl text-xs text-muted-foreground">
                          {question.prompt.replace(/<[^>]+>/g, "")}
                        </p>
                      </td>
                      <td className="px-2 py-4 capitalize">
                        {question.questionType.replace("_", " ")}
                      </td>
                      <td className="px-2 py-4">
                        {question.scoredLearners} learner
                        {question.scoredLearners === 1 ? "" : "s"}
                      </td>
                      <td className="px-2 py-4">
                        <p className="font-semibold">
                          {question.firstAttemptCorrectRate === null
                            ? "—"
                            : `${question.firstAttemptCorrectRate}%`}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Avg. {question.firstAttemptAverageScore ?? "—"}%
                        </p>
                      </td>
                      <td className="px-2 py-4">
                        <span
                          className={
                            question.supportLocks
                              ? "font-semibold text-rose-700"
                              : "text-muted-foreground"
                          }
                        >
                          {question.supportLocks || "No"} lock
                          {question.supportLocks === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td className="px-2 py-4">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${question.difficulty === "high" ? "bg-rose-100 text-rose-800" : question.difficulty === "medium" ? "bg-amber-100 text-amber-800" : question.difficulty === "low" ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}
                        >
                          {question.difficulty === "insufficient_data"
                            ? "Need 5 scores"
                            : `${question.difficulty} friction`}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!curriculumQuestions.length && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-2 py-10 text-center text-muted-foreground"
                      >
                        No knowledge-check questions in this view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
