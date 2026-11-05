import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  StaffField,
  StaffNotice,
  StaffQueryState,
  staffControl,
  staffDate,
  useStaffAuthority,
} from "./StaffWorkspace";
import StaffActions from "./StaffActions";
import StaffCheckIns from "./StaffCheckIns";

export default function StaffEngagement() {
  const access = useStaffAuthority();
  const allowed = access.engagement && access.schemaAvailable;
  const [tab, setTab] = useState<
    "actions" | "reviews" | "activity" | "checkins"
  >("actions");
  const learners = trpc.agentDevelopment.admin.staffLearners.useQuery(
    undefined,
    { enabled: allowed, retry: false }
  );
  if (!allowed) return <StaffNotice title="Engagement assignment required" />;
  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <ClipboardCheck size={18} />
          Agent Engagement
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Keep the next action clear.
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          Manage Academy Actions, review evidence, follow learning activity and
          record check-ins. This is not the CRM or a finance/reporting
          workspace.
        </p>
      </header>
      <nav
        aria-label="Engagement tasks"
        className="flex flex-wrap gap-2 border-b pb-3"
      >
        {(
          [
            ["actions", "Academy Actions"],
            ["reviews", "Action review"],
            ["activity", "People & activity"],
            ["checkins", "Check-ins"],
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
      <StaffQueryState query={learners}>
        {tab === "actions" || tab === "reviews" ? (
          <StaffActions key={tab} view={tab} learners={learners.data ?? []} />
        ) : tab === "checkins" ? (
          <StaffCheckIns learners={learners.data ?? []} />
        ) : (
          <StaffActivity learners={learners.data ?? []} />
        )}
      </StaffQueryState>
    </div>
  );
}
function StaffActivity({
  learners,
}: {
  learners: { id: number; name: string | null }[];
}) {
  const access = useStaffAuthority();
  const [agentId, setAgentId] = useState<number | null>(null);
  const activity = trpc.agentDevelopment.admin.staffActivity.useQuery(
    { agentId: agentId ?? 0 },
    {
      enabled:
        access.engagement &&
        !!agentId &&
        learners.some(learner => learner.id === agentId),
      retry: false,
    }
  );
  return (
    <section className="space-y-5">
      <StaffField label="Learner activity">
        <select
          className={`${staffControl} max-w-xl`}
          value={agentId ?? ""}
          onChange={event =>
            setAgentId(event.target.value ? Number(event.target.value) : null)
          }
        >
          <option value="">Choose a current learner</option>
          {learners.map(learner => (
            <option key={learner.id} value={learner.id}>
              {learner.name || `Agent #${learner.id}`}
            </option>
          ))}
        </select>
      </StaffField>
      {!agentId ? (
        <StaffNotice title="Choose a learner">
          Activity is limited to Academy learning, Actions and engagement
          check-ins. No customer, booking, finance or private profile data is
          loaded.
        </StaffNotice>
      ) : (
        <StaffQueryState query={activity}>
          {activity.data && (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-xs text-muted-foreground">
                    Last portal sign-in
                  </p>
                  <p className="mt-2 text-sm font-semibold">
                    {staffDate(activity.data.agent?.lastSignedIn)}
                  </p>
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-xs text-muted-foreground">
                    Latest Academy activity
                  </p>
                  <p className="mt-2 text-sm font-semibold">
                    {staffDate(activity.data.activity.lastActivityAt)}
                  </p>
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-xs text-muted-foreground">
                    Completed lessons
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {activity.data.activity.completedLessons}
                  </p>
                </div>
              </div>
              <section className="rounded-xl border bg-card p-5">
                <h2 className="text-lg font-semibold">Learning activity</h2>
                <div className="mt-4 divide-y">
                  {activity.data.enrollments.length ? (
                    activity.data.enrollments.map(enrollment => (
                      <div
                        key={enrollment.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                      >
                        <span className="font-medium">
                          {enrollment.courseTitle}
                        </span>
                        <span className="text-muted-foreground">
                          {enrollment.status.replaceAll("_", " ")} · due{" "}
                          {staffDate(enrollment.dueDate)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="py-3 text-sm text-muted-foreground">
                      No Academy enrolments recorded.
                    </p>
                  )}
                </div>
              </section>
              <section className="rounded-xl border bg-card p-5">
                <h2 className="text-lg font-semibold">
                  Recent Academy Actions
                </h2>
                <div className="mt-4 divide-y">
                  {activity.data.actions.length ? (
                    activity.data.actions.map(action => (
                      <div
                        key={action.id}
                        className="flex flex-wrap justify-between gap-3 py-3 text-sm"
                      >
                        <span>{action.title}</span>
                        <span className="text-muted-foreground">
                          {action.status.replaceAll("_", " ")} · due{" "}
                          {staffDate(action.dueAt)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="py-3 text-sm text-muted-foreground">
                      No recent Actions recorded.
                    </p>
                  )}
                </div>
              </section>
              <section className="rounded-xl border bg-card p-5">
                <h2 className="text-lg font-semibold">Check-in activity</h2>
                <div className="mt-4 divide-y">
                  {activity.data.checkIns.map(checkIn => (
                    <div key={checkIn.id} className="py-3 text-sm">
                      {checkIn.status} · last contact{" "}
                      {staffDate(checkIn.lastContactAt)} · follow-up{" "}
                      {staffDate(checkIn.nextFollowUpAt)}
                    </div>
                  ))}
                  {!activity.data.checkIns.length && (
                    <p className="text-sm text-muted-foreground">
                      No check-ins recorded.
                    </p>
                  )}
                </div>
              </section>
            </div>
          )}
        </StaffQueryState>
      )}
    </section>
  );
}
