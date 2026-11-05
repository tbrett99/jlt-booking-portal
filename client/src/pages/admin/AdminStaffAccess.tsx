import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  StaffField,
  StaffMutationError,
  StaffNotice,
  StaffQueryState,
  staffControl,
  staffDate,
} from "@/pages/staff/StaffWorkspace";

const blank = {
  userId: 0,
  staffRole: "instructor" as "instructor" | "agent_engagement",
  enabled: true,
  courseIds: [] as number[],
  reason: "",
};
export default function AdminStaffAccess() {
  const { user } = useAuth();
  const allowed = user?.role === "super_admin";
  const options = trpc.staffAccess.adminOptions.useQuery(undefined, {
    enabled: allowed,
    retry: false,
  });
  const grants = trpc.staffAccess.adminList.useQuery(undefined, {
    enabled: allowed,
    retry: false,
  });
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState(blank);
  const [search, setSearch] = useState("");
  const save = trpc.staffAccess.adminSave.useMutation({
    onSuccess: async () => {
      toast.success(
        "Staff assignment saved. The agent's base role is unchanged."
      );
      setDraft(blank);
      await Promise.all([
        utils.staffAccess.adminList.invalidate(),
        utils.staffAccess.adminOptions.invalidate(),
        utils.staffAccess.mine.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });
  if (!allowed)
    return (
      <StaffNotice title="Super Admin access required">
        Staff assignments are configured only by a Super Admin.
      </StaffNotice>
    );
  const visible = (grants.data ?? []).filter(grant =>
    `${grant.name ?? ""} ${grant.email ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const valid =
    draft.userId > 0 &&
    draft.reason.trim().length >= 5 &&
    (!draft.enabled ||
      draft.staffRole !== "instructor" ||
      draft.courseIds.length > 0);
  const selectedAgentMissing =
    draft.userId > 0 &&
    !options.data?.agents.some(agent => agent.id === draft.userId);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <ShieldCheck size={19} />
          Restricted staff assignments
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Give access to the work, not the whole portal.
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          Instructor and Agent Engagement are additional permissions on an
          existing agent account. They do not change its role or personal
          finance access. Every change requires an audit reason.
        </p>
      </header>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        <strong>First Class is not built yet.</strong> Create the course in
        Academy Manager first, then explicitly select its existing course ID
        here. No assignment is inferred from a course title, and no access is
        granted by opening this page.
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
        <section className="space-y-4">
          <StaffField label="Search assignments">
            <input
              className={staffControl}
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Agent name or email"
            />
          </StaffField>
          <StaffQueryState query={grants} empty={!visible.length}>
            <div className="space-y-3">
              {visible.map(grant => (
                <article
                  key={grant.id}
                  className="rounded-xl border bg-card p-4 text-card-foreground"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">
                        {grant.name || grant.email || `Agent #${grant.userId}`}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {grant.email}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${grant.isActive ? "bg-emerald-50 text-emerald-800" : "bg-muted text-muted-foreground"}`}
                    >
                      {grant.isActive ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-medium">
                    {grant.staffRole === "instructor"
                      ? "Instructor"
                      : "Agent Engagement"}
                  </p>
                  {grant.staffRole === "instructor" && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {grant.courseIds.length
                        ? grant.courseIds
                            .map(
                              id =>
                                `#${id} · ${options.data?.courses.find(course => course.id === id)?.title ?? "Course unavailable"}`
                            )
                            .join(", ")
                        : "No courses assigned"}
                    </p>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Granted {staffDate(grant.grantedAt)}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={save.isPending}
                      onClick={() => {
                        save.reset();
                        setDraft({
                          userId: grant.userId,
                          staffRole: grant.staffRole,
                          enabled: grant.isActive,
                          courseIds: [...grant.courseIds],
                          reason: "",
                        });
                      }}
                    >
                      Edit assignment
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </StaffQueryState>
        </section>
        <section className="rounded-xl border bg-card p-5 text-card-foreground lg:sticky lg:top-5">
          <h2 className="text-lg font-semibold">Configure assignment</h2>
          <StaffQueryState query={options}>
            <form
              className="mt-5 space-y-4"
              onSubmit={event => {
                event.preventDefault();
                if (valid)
                  save.mutate({
                    ...draft,
                    courseIds:
                      draft.staffRole === "instructor" ? draft.courseIds : [],
                    reason: draft.reason.trim(),
                  });
              }}
            >
              <fieldset disabled={save.isPending} className="space-y-4">
                <StaffField label="Existing agent">
                  <select
                    className={staffControl}
                    value={draft.userId || ""}
                    onChange={event =>
                      setDraft({ ...blank, userId: Number(event.target.value) })
                    }
                  >
                    <option value="">Choose an active agent</option>
                    {selectedAgentMissing && (
                      <option value={draft.userId}>
                        Agent #{draft.userId} · unavailable (revoke only)
                      </option>
                    )}
                    {options.data?.agents.map(agent => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name || agent.email} · {agent.email}
                      </option>
                    ))}
                  </select>
                </StaffField>
                <StaffField label="Staff role">
                  <select
                    className={staffControl}
                    value={draft.staffRole}
                    onChange={event =>
                      setDraft(current => ({
                        ...current,
                        staffRole: event.target.value as typeof draft.staffRole,
                        courseIds: [],
                      }))
                    }
                  >
                    <option value="instructor">Instructor</option>
                    <option value="agent_engagement">Agent Engagement</option>
                  </select>
                </StaffField>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={event =>
                      setDraft({ ...draft, enabled: event.target.checked })
                    }
                  />
                  Enable this staff assignment
                </label>
                {draft.staffRole === "instructor" && (
                  <fieldset className="space-y-2">
                    <legend className="mb-2 text-sm font-medium">
                      Assigned existing courses (select all that apply)
                    </legend>
                    <div className="max-h-64 space-y-2 overflow-auto rounded-lg border p-3">
                      {options.data?.courses.length ? (
                        options.data.courses.map(course => (
                          <label
                            key={course.id}
                            className="flex items-start gap-2 text-sm"
                          >
                            <input
                              className="mt-1"
                              type="checkbox"
                              disabled={
                                course.status === "archived" &&
                                !draft.courseIds.includes(course.id)
                              }
                              checked={draft.courseIds.includes(course.id)}
                              onChange={event =>
                                setDraft(current => ({
                                  ...current,
                                  courseIds: event.target.checked
                                    ? [...current.courseIds, course.id]
                                    : current.courseIds.filter(
                                        id => id !== course.id
                                      ),
                                }))
                              }
                            />
                            <span>
                              #{course.id} · {course.title}
                              <small className="block text-muted-foreground">
                                {course.status}
                              </small>
                            </span>
                          </label>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No existing courses are available. Build the course
                          first, then return to assign it.
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      An enabled Instructor assignment requires at least one
                      explicit course ID. No course creation, enrolment or
                      publication permission is included.
                    </p>
                  </fieldset>
                )}
                <StaffField label="Audit reason">
                  <textarea
                    className={staffControl}
                    rows={3}
                    minLength={5}
                    maxLength={1000}
                    required
                    value={draft.reason}
                    onChange={event =>
                      setDraft({ ...draft, reason: event.target.value })
                    }
                    placeholder="Why is this permission being granted, changed or revoked?"
                  />
                </StaffField>
                <StaffMutationError error={save.error} />
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={
                      !valid ||
                      (selectedAgentMissing && draft.enabled) ||
                      save.isPending
                    }
                  >
                    {save.isPending ? "Saving assignment…" : "Save assignment"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setDraft(blank);
                      save.reset();
                    }}
                  >
                    Clear
                  </Button>
                </div>
              </fieldset>
            </form>
          </StaffQueryState>
        </section>
      </div>
    </div>
  );
}
