import { useMemo } from "react";
import { useLocation } from "wouter";
import {
  BellRing,
  ClipboardCheck,
  GraduationCap,
  UsersRound,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

type AcademyWorkspace = "courses" | "learners" | "actions" | "notifications";

type AcademyWorkspaceNavProps = {
  active: AcademyWorkspace;
  className?: string;
};

function plural(value: number, singular: string, pluralLabel = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralLabel}`;
}

/**
 * Shared, staff-only Academy navigation. It deliberately surfaces operational
 * work across the three Academy pages so staff do not have to remember where a
 * particular task lives.
 */
export function AcademyWorkspaceNav({ active, className = "" }: AcademyWorkspaceNavProps) {
  const [, navigate] = useLocation();
  const { data: courses = [] } = trpc.academy.admin.courses.useQuery();
  const { data: insights } = trpc.academy.admin.insights.useQuery();
  const { data: actionReviewSummary } = trpc.agentDevelopment.admin.actionReviewSummary.useQuery();

  const counts = useMemo(() => {
    const metrics = insights?.metrics;
    return {
      courses: courses.length,
      publishedCourses: courses.filter((course) => course.status === "published").length,
      learners: Number(metrics?.enrolments.inProgress ?? 0),
      assessmentAttention: Number(metrics?.assessments.awaitingMarking ?? 0) + Number(metrics?.assessments.supportLocks ?? 0),
      feedbackPending: Number(metrics?.assessments.feedbackPending ?? 0),
      actionsAwaitingReview: Number(actionReviewSummary?.awaitingReview ?? 0),
      actionsNeedingRevision: Number(actionReviewSummary?.needsRevision ?? 0),
    };
  }, [actionReviewSummary, courses, insights?.metrics]);

  const workspaces: Array<{
    id: AcademyWorkspace;
    href: string;
    title: string;
    description: string;
    count: number;
    countLabel: string;
    icon: React.ReactNode;
  }> = [
    {
      id: "courses",
      href: "/admin/academy",
      title: "Courses",
      description: "Build, preview and publish learning content.",
      count: counts.courses,
      countLabel: `${plural(counts.publishedCourses, "published course")}`,
      icon: <GraduationCap size={19} />,
    },
    {
      id: "learners",
      href: "/admin/academy/insights",
      title: "Learners & Support",
      description: "Enrol, mark, chase and support learners.",
      count: counts.assessmentAttention,
      countLabel: counts.assessmentAttention
        ? `${plural(counts.assessmentAttention, "item")} need attention`
        : `${plural(counts.learners, "learner")} in progress`,
      icon: <UsersRound size={19} />,
    },
    {
      id: "actions",
      href: "/admin/academy/actions",
      title: "Journey & Actions",
      description: "Set Accelerator releases and accountability work.",
      count: counts.actionsAwaitingReview,
      countLabel: counts.actionsAwaitingReview
        ? `${plural(counts.actionsAwaitingReview, "Action")} to review`
        : counts.actionsNeedingRevision
          ? `${plural(counts.actionsNeedingRevision, "Action")} with agents`
          : "No evidence awaiting review",
      icon: <ClipboardCheck size={19} />,
    },
    {
      id: "notifications",
      href: "/admin/academy#notifications",
      title: "Notifications",
      description: "Set course milestone emails and support alerts.",
      count: counts.feedbackPending,
      countLabel: counts.feedbackPending
        ? `${plural(counts.feedbackPending, "feedback acknowledgement")} pending`
        : "Course-level alert rules",
      icon: <BellRing size={19} />,
    },
  ];

  return (
    <nav
      aria-label="Academy staff workspaces"
      className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-4 ${className}`}
    >
      {workspaces.map((workspace) => {
        const isActive = active === workspace.id;
        return (
          <button
            key={workspace.id}
            type="button"
            onClick={() => navigate(workspace.href)}
            className={`group rounded-2xl border p-4 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              isActive
                ? "border-[#00c9b4] bg-[#70FFE8]/14 ring-1 ring-[#70FFE8]/50"
                : "bg-card hover:border-[#70FFE8]/60 hover:bg-[#70FFE8]/[0.05]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <span className={`rounded-xl p-2 ${isActive ? "bg-[#27302e] text-[#70FFE8]" : "bg-muted text-primary"}`}>
                {workspace.icon}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${workspace.count ? "bg-[#27302e] text-white" : "bg-muted text-muted-foreground"}`}>
                {workspace.count}
              </span>
            </div>
            <p className="mt-4 font-bold leading-5">{workspace.title}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{workspace.description}</p>
            <p className="mt-3 text-xs font-semibold text-primary">{workspace.countLabel}</p>
          </button>
        );
      })}
    </nav>
  );
}
