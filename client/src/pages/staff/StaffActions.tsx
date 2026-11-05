import { useState } from "react";
import { toast } from "sonner";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  StaffField,
  StaffMutationError,
  StaffNotice,
  StaffQueryState,
  localDateInput,
  safeEvidenceUrl,
  staffControl,
  staffDate,
  useStaffAuthority,
} from "./StaffWorkspace";

type AdminInputs = inferRouterInputs<AppRouter>["agentDevelopment"]["admin"];
type AdminOutputs = inferRouterOutputs<AppRouter>["agentDevelopment"]["admin"];
type Plan = AdminOutputs["actionPlans"][number];
type Review = AdminOutputs["actionReviewQueue"]["items"][number];
type Learner = { id: number; name: string | null };
export default function StaffActions({
  view,
  learners,
}: {
  view: "actions" | "reviews";
  learners: Learner[];
}) {
  const access = useStaffAuthority();
  const allowed = access.engagement && access.schemaAvailable;
  const plans = trpc.agentDevelopment.admin.actionPlans.useQuery(undefined, {
    enabled: allowed && view === "actions",
    retry: false,
  });
  const [editing, setEditing] = useState<Plan | null | undefined>(undefined);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [publishTarget, setPublishTarget] = useState<number | null>(null);
  const publish = trpc.agentDevelopment.admin.publishActionPlan.useMutation({
    onSuccess: result => {
      toast.success(`Action assigned to ${result.created} learners`);
      setPublishTarget(null);
      void plans.refetch();
    },
  });
  if (view === "reviews") return <ActionReviews />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Academy Actions</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a focused action, choose its learners, then explicitly assign
            it.
          </p>
        </div>
        <Button onClick={() => setEditing(null)}>New Action</Button>
      </div>
      {editing !== undefined && (
        <ActionForm
          key={editing?.id ?? "new"}
          plan={editing}
          learners={learners}
          close={() => setEditing(undefined)}
          refresh={() => void plans.refetch()}
        />
      )}
      {publishTarget && (
        <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <h3 className="font-semibold">Assign this Action?</h3>
          <p className="text-sm">
            This makes the saved Action live and creates learner assignments
            with the existing Academy notification workflow. It does not enrol
            anyone in a course.
          </p>
          <StaffMutationError error={publish.error} />
          <div className="flex gap-2">
            <Button
              disabled={publish.isPending}
              onClick={() =>
                publish.mutate({ planId: publishTarget, publishNow: false })
              }
            >
              {publish.isPending ? "Assigning…" : "Confirm assignment"}
            </Button>
            <Button
              variant="outline"
              disabled={publish.isPending}
              onClick={() => {
                setPublishTarget(null);
                publish.reset();
              }}
            >
              Cancel
            </Button>
          </div>
        </section>
      )}
      <StaffQueryState query={plans} empty={!plans.data?.length}>
        <div className="space-y-3">
          {plans.data?.map(plan => (
            <article
              key={plan.id}
              className="rounded-xl border bg-card p-5 text-card-foreground"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{plan.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {plan.status} · {plan.counts.assigned} assigned ·{" "}
                    {plan.counts.completed} completed ·{" "}
                    {plan.counts.awaitingReview} to review
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Due {staffDate(plan.dueAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {plan.status !== "published" &&
                    plan.status !== "archived" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={publish.isPending}
                          onClick={() => setEditing(plan)}
                        >
                          Edit draft
                        </Button>
                        <Button
                          size="sm"
                          disabled={publish.isPending}
                          onClick={() => {
                            publish.reset();
                            setPublishTarget(plan.id);
                          }}
                        >
                          Assign Action
                        </Button>
                      </>
                    )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSelectedPlanId(
                        selectedPlanId === plan.id ? null : plan.id
                      )
                    }
                  >
                    {selectedPlanId === plan.id
                      ? "Hide learners"
                      : "View assignments"}
                  </Button>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm leading-6">
                {plan.instructions}
              </p>
              {selectedPlanId === plan.id && (
                <ActionAssignments planId={plan.id} />
              )}
            </article>
          ))}
        </div>
      </StaffQueryState>
    </div>
  );
}
function ActionForm({
  plan,
  learners,
  close,
  refresh,
}: {
  plan: Plan | null;
  learners: Learner[];
  close: () => void;
  refresh: () => void;
}) {
  const access = useStaffAuthority();
  const [draft, setDraft] = useState({
    title: plan?.title ?? "",
    instructions: plan?.instructions ?? "",
    targetAgentIds: plan?.targetAgentIds ?? ([] as number[]),
    dueAt: localDateInput(plan?.dueAt),
    requiresNote: plan?.requiresNote ?? true,
    requiresUrl: plan?.requiresUrl ?? false,
    requiresUpload: plan?.requiresUpload ?? false,
    staffReviewRequired: plan?.staffReviewRequired ?? true,
  });
  const save = trpc.agentDevelopment.admin.saveActionPlan.useMutation({
    onSuccess: () => {
      toast.success("Action draft saved. Assign it when ready.");
      close();
      refresh();
    },
  });
  const selectedAudience = !plan || plan.audience === "selected_agents";
  const valid =
    draft.title.trim().length >= 3 &&
    draft.instructions.trim().length >= 3 &&
    (!selectedAudience || draft.targetAgentIds.length > 0);
  function saveDraft() {
    if (!valid || !access.engagement) return;
    const payload: AdminInputs["saveActionPlan"] = {
      id: plan?.id,
      title: draft.title,
      instructions: draft.instructions,
      audience: plan?.audience ?? "selected_agents",
      actionType: plan?.actionType ?? "ad_hoc",
      assignmentTrigger: plan?.assignmentTrigger ?? "immediate",
      publishAt: plan?.publishAt ?? null,
      dueAt: draft.dueAt ? new Date(draft.dueAt) : null,
      requiresNote: draft.requiresNote,
      requiresUrl: draft.requiresUrl,
      requiresUpload: draft.requiresUpload,
      targetAgentIds: selectedAudience ? draft.targetAgentIds : [],
      // On an existing draft omit policy fields entirely; backend retains them.
      ...(plan ? {} : { staffReviewRequired: draft.staffReviewRequired }),
    };
    save.mutate(payload);
  }
  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground"
      onSubmit={event => {
        event.preventDefault();
        saveDraft();
      }}
    >
      <h3 className="text-lg font-semibold">
        {plan ? "Edit saved Action draft" : "New selected-learner Action"}
      </h3>
      <fieldset
        disabled={save.isPending || !access.engagement}
        className="space-y-4"
      >
        <StaffField label="Action title">
          <input
            className={staffControl}
            required
            minLength={3}
            maxLength={255}
            value={draft.title}
            onChange={event =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
        </StaffField>
        <StaffField label="Instructions to learners">
          <textarea
            className={staffControl}
            required
            minLength={3}
            maxLength={20000}
            rows={5}
            value={draft.instructions}
            onChange={event =>
              setDraft({ ...draft, instructions: event.target.value })
            }
          />
        </StaffField>
        <StaffField label="Deadline (your local time)">
          <input
            className={staffControl}
            type="datetime-local"
            value={draft.dueAt}
            onChange={event =>
              setDraft({ ...draft, dueAt: event.target.value })
            }
          />
        </StaffField>
        {selectedAudience ? (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">
              Select current learners
            </legend>
            <div className="max-h-60 space-y-2 overflow-auto rounded-lg border p-3">
              {learners.map(learner => (
                <label
                  className="flex items-center gap-2 text-sm"
                  key={learner.id}
                >
                  <input
                    type="checkbox"
                    checked={draft.targetAgentIds.includes(learner.id)}
                    onChange={event =>
                      setDraft(current => ({
                        ...current,
                        targetAgentIds: event.target.checked
                          ? [...current.targetAgentIds, learner.id]
                          : current.targetAgentIds.filter(
                              id => id !== learner.id
                            ),
                      }))
                    }
                  />
                  {learner.name || `Agent #${learner.id}`}
                </label>
              ))}
              {!learners.length && (
                <p className="text-sm text-muted-foreground">
                  No current learners available.
                </p>
              )}
            </div>
          </fieldset>
        ) : (
          <p className="text-sm text-muted-foreground">
            Existing audience: {plan?.audience.replaceAll("_", " ")}. The
            administrator-configured audience and journey coupling are
            preserved.
          </p>
        )}
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["requiresNote", "Require completion note"],
              ["requiresUrl", "Require evidence link"],
              ["requiresUpload", "Require evidence upload"],
            ] as const
          ).map(([key, label]) => (
            <label className="flex items-center gap-2 text-sm" key={key}>
              <input
                type="checkbox"
                checked={draft[key]}
                onChange={event =>
                  setDraft({ ...draft, [key]: event.target.checked })
                }
              />
              {label}
            </label>
          ))}
        </div>
        {!plan && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.staffReviewRequired}
              onChange={event =>
                setDraft({
                  ...draft,
                  staffReviewRequired: event.target.checked,
                })
              }
            />
            Require staff review of submitted evidence
          </label>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          New Actions do not configure Momentum rewards. Existing reward and
          review rules remain unchanged; completion can award already-configured
          points through the server's validated path.
        </p>
        <StaffMutationError error={save.error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={!valid || save.isPending}>
            {save.isPending ? "Saving draft…" : "Save Action draft"}
          </Button>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
function ActionAssignments({ planId }: { planId: number }) {
  const access = useStaffAuthority();
  const assignments = trpc.agentDevelopment.admin.actionAssignments.useQuery(
    { planId },
    { enabled: access.engagement && planId > 0, retry: false }
  );
  return (
    <div className="mt-4 border-t pt-4">
      <StaffQueryState query={assignments} empty={!assignments.data?.length}>
        <div className="space-y-2">
          {assignments.data?.map(({ assignment, agent }) => (
            <div
              className="flex flex-wrap justify-between gap-2 text-sm"
              key={assignment.id}
            >
              <span>{agent.name || `Agent #${agent.id}`}</span>
              <span className="text-muted-foreground">
                {assignment.status.replaceAll("_", " ")} · due{" "}
                {staffDate(assignment.dueAt)}
              </span>
            </div>
          ))}
        </div>
      </StaffQueryState>
    </div>
  );
}
function ActionReviews() {
  const access = useStaffAuthority();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [due, setDue] = useState<"all" | "overdue" | "due_soon">("all");
  const [cursor, setCursor] = useState<{
    submittedAt: Date;
    id: number;
  } | null>(null);
  const [history, setHistory] = useState<{ submittedAt: Date; id: number }[]>(
    []
  );
  const queue = trpc.agentDevelopment.admin.actionReviewQueue.useQuery(
    { query, due, cursor, limit: 25 },
    { enabled: access.engagement && access.schemaAvailable, retry: false }
  );
  const rows = (queue.data?.items ?? []).filter(
    row => row.agent.id !== user?.id
  );
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Action review inbox</h2>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px]">
        <StaffField label="Search learner or Action">
          <input
            className={staffControl}
            maxLength={160}
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setCursor(null);
              setHistory([]);
            }}
          />
        </StaffField>
        <StaffField label="Deadline filter">
          <select
            className={staffControl}
            value={due}
            onChange={event => {
              setDue(event.target.value as typeof due);
              setCursor(null);
              setHistory([]);
            }}
          >
            <option value="all">All deadlines</option>
            <option value="overdue">Overdue</option>
            <option value="due_soon">Due in 7 days</option>
          </select>
        </StaffField>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        Review genuine submitted evidence. Approvals are recorded only after the
        server confirms them; request changes with clear feedback. You cannot
        review your own submission.
      </p>
      <StaffQueryState query={queue} empty={!rows.length}>
        <div className="space-y-4">
          {rows.map(row => (
            <ReviewAction
              key={row.assignment.id}
              row={row}
              refresh={() => void queue.refetch()}
            />
          ))}
        </div>
      </StaffQueryState>
      <div className="flex gap-2">
        {cursor && (
          <Button
            variant="outline"
            disabled={queue.isFetching}
            onClick={() => {
              const previous = [...history];
              setCursor(previous.pop() ?? null);
              setHistory(previous);
            }}
          >
            Previous page
          </Button>
        )}
        {queue.data?.nextCursor && (
          <Button
            variant="outline"
            disabled={queue.isFetching}
            onClick={() => {
              if (cursor) setHistory(current => [...current, cursor]);
              setCursor(queue.data!.nextCursor);
            }}
          >
            Next page
          </Button>
        )}
      </div>
    </section>
  );
}
function ReviewAction({ row, refresh }: { row: Review; refresh: () => void }) {
  const access = useStaffAuthority();
  const [feedback, setFeedback] = useState("");
  const [confirm, setConfirm] = useState<"completed" | "needs_revision" | null>(
    null
  );
  const [saved, setSaved] = useState(false);
  const review = trpc.agentDevelopment.admin.reviewAction.useMutation({
    onSuccess: () => {
      setSaved(true);
      toast.success("Action review recorded");
      refresh();
    },
  });
  const url = safeEvidenceUrl(row.assignment.evidenceUrl);
  const file = safeEvidenceUrl(row.assignment.evidenceFileUrl);
  if (saved)
    return (
      <StaffNotice title="Action review recorded">
        The server has saved the decision and notified the learner.
      </StaffNotice>
    );
  return (
    <article className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground">
      <header>
        <h3 className="text-lg font-semibold">{row.plan.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {row.agent.name || `Agent #${row.agent.id}`} · submitted{" "}
          {staffDate(row.assignment.submittedAt)}
        </p>
      </header>
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Action instructions
        </summary>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
          {row.plan.instructions}
        </p>
      </details>
      <div className="whitespace-pre-wrap rounded-lg border bg-muted/20 p-4 text-sm leading-6">
        {row.assignment.completionNote || "No completion note provided."}
      </div>
      <div className="flex flex-wrap gap-3">
        {url && (
          <a
            className="text-sm font-semibold text-emerald-800 underline"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open evidence link
          </a>
        )}
        {file && (
          <a
            className="text-sm font-semibold text-emerald-800 underline"
            href={file}
            target="_blank"
            rel="noopener noreferrer"
          >
            {row.assignment.evidenceFileName || "Open uploaded evidence"}
          </a>
        )}
      </div>
      <fieldset
        disabled={!access.engagement || review.isPending}
        className="space-y-3"
      >
        <StaffField label="Action feedback to learner">
          <textarea
            className={staffControl}
            maxLength={10000}
            rows={4}
            value={feedback}
            onChange={event => setFeedback(event.target.value)}
            placeholder="Explain the decision. Required when requesting changes."
          />
        </StaffField>
        <StaffMutationError error={review.error} />
        {confirm ? (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <p className="text-sm">
              {confirm === "completed"
                ? "Confirm approval? This completes the Action and may award preconfigured points."
                : "Confirm return to learner with this feedback?"}
            </p>
            <div className="flex gap-2">
              <Button
                disabled={
                  review.isPending ||
                  (confirm === "needs_revision" && !feedback.trim())
                }
                onClick={() =>
                  review.mutate({
                    assignmentId: row.assignment.id,
                    outcome: confirm,
                    feedback: feedback.trim() || null,
                  })
                }
              >
                {review.isPending ? "Recording decision…" : "Confirm decision"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button onClick={() => setConfirm("completed")}>
              Approve Action
            </Button>
            <Button
              variant="outline"
              disabled={!feedback.trim()}
              onClick={() => setConfirm("needs_revision")}
            >
              Request changes
            </Button>
          </div>
        )}
      </fieldset>
    </article>
  );
}
