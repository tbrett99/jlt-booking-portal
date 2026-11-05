import { useState } from "react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  StaffField,
  StaffMutationError,
  StaffQueryState,
  localDateInput,
  staffControl,
  staffDate,
  useStaffAuthority,
} from "./StaffWorkspace";

type CaseDetail =
  inferRouterOutputs<AppRouter>["agentDevelopment"]["admin"]["getEngagementCase"];
type CaseStatus = "active" | "waiting" | "monitoring" | "closed";
export default function StaffCheckIns({
  learners,
}: {
  learners: { id: number; name: string | null }[];
}) {
  const access = useStaffAuthority();
  const [status, setStatus] = useState<CaseStatus | "all">("active");
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const cases = trpc.agentDevelopment.admin.engagementCases.useQuery(
    { status },
    { enabled: access.engagement && access.schemaAvailable, retry: false }
  );
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Agent check-ins</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Record contact, outcomes and the next follow-up in the engagement
            workspace only.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>Open check-in</Button>
      </div>
      {creating && (
        <NewCheckIn
          learners={learners}
          close={() => setCreating(false)}
          saved={id => {
            setSelected(id);
            setCreating(false);
            void cases.refetch();
          }}
        />
      )}
      <StaffField label="Check-in status">
        <select
          className={`${staffControl} max-w-xs`}
          value={status}
          onChange={event => {
            setStatus(event.target.value as typeof status);
            setSelected(null);
          }}
        >
          <option value="active">Active</option>
          <option value="waiting">Waiting</option>
          <option value="monitoring">Monitoring</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
      </StaffField>
      <div className="grid items-start gap-5 lg:grid-cols-[310px_minmax(0,1fr)]">
        <StaffQueryState query={cases} empty={!cases.data?.length}>
          <div className="space-y-3">
            {cases.data?.map(row => (
              <button
                key={row.case.id}
                onClick={() => setSelected(row.case.id)}
                className={`block w-full rounded-xl border bg-card p-4 text-left text-card-foreground ${selected === row.case.id ? "border-emerald-500 ring-1 ring-emerald-500" : "hover:border-emerald-300"}`}
              >
                <h3 className="font-semibold">
                  {row.agent.name || `Agent #${row.agent.id}`}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.case.status} · follow-up{" "}
                  {staffDate(row.case.nextFollowUpAt)}
                </p>
                <p className="mt-3 line-clamp-2 text-sm">
                  {row.case.riskReason}
                </p>
              </button>
            ))}
          </div>
        </StaffQueryState>
        {selected && (
          <CheckInDetail
            key={selected}
            caseId={selected}
            refresh={() => void cases.refetch()}
          />
        )}
      </div>
    </section>
  );
}
function NewCheckIn({
  learners,
  close,
  saved,
}: {
  learners: { id: number; name: string | null }[];
  close: () => void;
  saved: (id: number) => void;
}) {
  const access = useStaffAuthority();
  const [agentId, setAgentId] = useState(0);
  const [reason, setReason] = useState("");
  const [next, setNext] = useState("");
  const create = trpc.agentDevelopment.admin.createEngagementCase.useMutation({
    onSuccess: result => {
      toast.success("Check-in opened");
      saved(result.id);
    },
  });
  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground"
      onSubmit={event => {
        event.preventDefault();
        if (access.engagement && agentId && reason.trim().length >= 3)
          create.mutate({
            agentId,
            riskReason: reason,
            nextFollowUpAt: next ? new Date(next) : null,
          });
      }}
    >
      <h3 className="text-lg font-semibold">Open a check-in</h3>
      <fieldset
        disabled={create.isPending || !access.engagement}
        className="space-y-4"
      >
        <StaffField label="Check-in learner">
          <select
            required
            className={staffControl}
            value={agentId || ""}
            onChange={event => setAgentId(Number(event.target.value))}
          >
            <option value="">Choose a current learner</option>
            {learners.map(learner => (
              <option value={learner.id} key={learner.id}>
                {learner.name || `Agent #${learner.id}`}
              </option>
            ))}
          </select>
        </StaffField>
        <StaffField label="Reason for check-in">
          <textarea
            required
            className={staffControl}
            minLength={3}
            maxLength={10000}
            rows={3}
            value={reason}
            onChange={event => setReason(event.target.value)}
          />
        </StaffField>
        <StaffField label="Next follow-up (your local time)">
          <input
            className={staffControl}
            type="datetime-local"
            value={next}
            onChange={event => setNext(event.target.value)}
          />
        </StaffField>
        <p className="text-xs text-muted-foreground">
          If a check-in already exists, open it from the list instead. No
          general CRM note is created.
        </p>
        <StaffMutationError error={create.error} />
        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={!agentId || reason.trim().length < 3 || create.isPending}
          >
            {create.isPending ? "Opening…" : "Open check-in"}
          </Button>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
function CheckInDetail({
  caseId,
  refresh,
}: {
  caseId: number;
  refresh: () => void;
}) {
  const access = useStaffAuthority();
  const detail = trpc.agentDevelopment.admin.getEngagementCase.useQuery(
    { caseId },
    { enabled: access.engagement && caseId > 0, retry: false }
  );
  return (
    <StaffQueryState query={detail}>
      {detail.data && (
        <InteractionForm
          key={detail.data.case.id}
          data={detail.data}
          refresh={() => {
            void detail.refetch();
            refresh();
          }}
        />
      )}
    </StaffQueryState>
  );
}
function InteractionForm({
  data,
  refresh,
}: {
  data: CaseDetail;
  refresh: () => void;
}) {
  const access = useStaffAuthority();
  const [channel, setChannel] = useState<
    "call" | "email" | "whatsapp" | "meeting" | "other"
  >("call");
  const [summary, setSummary] = useState("");
  const [outcome, setOutcome] = useState(data.case.outcome ?? "");
  const [next, setNext] = useState(localDateInput(data.case.nextFollowUpAt));
  const [status, setStatus] = useState<CaseStatus>(data.case.status);
  const log = trpc.agentDevelopment.admin.logEngagementInteraction.useMutation({
    onSuccess: () => {
      toast.success("Check-in recorded");
      setSummary("");
      refresh();
    },
  });
  return (
    <section className="space-y-5 rounded-xl border bg-card p-5 text-card-foreground">
      <header>
        <h3 className="text-lg font-semibold">
          {data.agent.name || `Agent #${data.agent.id}`}
        </h3>
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
          {data.case.riskReason}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Current status: {data.case.status} · last contact{" "}
          {staffDate(data.case.lastContactAt)}
        </p>
      </header>
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          if (access.engagement && summary.trim().length >= 3)
            log.mutate({
              caseId: data.case.id,
              channel,
              summary,
              outcome: outcome.trim() || null,
              status,
              nextFollowUpAt:
                status === "closed" ? null : next ? new Date(next) : null,
            });
        }}
      >
        <h4 className="font-semibold">Log contact and update follow-up</h4>
        <fieldset
          disabled={!access.engagement || log.isPending}
          className="space-y-4"
        >
          <StaffField label="Contact channel">
            <select
              className={staffControl}
              value={channel}
              onChange={event =>
                setChannel(event.target.value as typeof channel)
              }
            >
              <option value="call">Call</option>
              <option value="email">Email (record only)</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="meeting">Meeting</option>
              <option value="other">Other</option>
            </select>
          </StaffField>
          <p className="text-xs text-muted-foreground">
            This records a contact that happened. Selecting email does not send
            an email.
          </p>
          <StaffField label="Contact summary">
            <textarea
              className={staffControl}
              required
              minLength={3}
              maxLength={20000}
              rows={4}
              value={summary}
              onChange={event => setSummary(event.target.value)}
            />
          </StaffField>
          <StaffField label="Outcome">
            <textarea
              className={staffControl}
              maxLength={10000}
              rows={2}
              value={outcome}
              onChange={event => setOutcome(event.target.value)}
            />
          </StaffField>
          <StaffField label="Status after contact">
            <select
              className={staffControl}
              value={status}
              onChange={event => setStatus(event.target.value as CaseStatus)}
            >
              <option value="active">Active</option>
              <option value="waiting">Waiting</option>
              <option value="monitoring">Monitoring</option>
              <option value="closed">Closed</option>
            </select>
          </StaffField>
          {status !== "closed" && (
            <StaffField label="Next follow-up (your local time)">
              <input
                className={staffControl}
                type="datetime-local"
                value={next}
                onChange={event => setNext(event.target.value)}
              />
            </StaffField>
          )}
          <StaffMutationError error={log.error} />
          <Button
            type="submit"
            disabled={summary.trim().length < 3 || log.isPending}
          >
            {log.isPending ? "Recording…" : "Record check-in"}
          </Button>
        </fieldset>
      </form>
      <div className="space-y-3 border-t pt-4">
        <h4 className="font-semibold">Contact history</h4>
        {data.interactions.map(({ interaction, staff }) => (
          <article key={interaction.id} className="rounded-lg bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              {staffDate(interaction.occurredAt)} · {interaction.channel} ·{" "}
              {staff?.name || "Staff"}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
              {interaction.summary}
            </p>
            {interaction.outcome && (
              <p className="mt-2 text-sm">
                <strong>Outcome:</strong> {interaction.outcome}
              </p>
            )}
          </article>
        ))}
        {!data.interactions.length && (
          <p className="text-sm text-muted-foreground">
            No contact logged yet.
          </p>
        )}
      </div>
    </section>
  );
}
