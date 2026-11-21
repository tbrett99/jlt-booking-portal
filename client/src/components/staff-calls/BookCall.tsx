import { useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import AgentPicker from "./AgentPicker";
import SlotPicker, { type Slot } from "./SlotPicker";
import {
  control,
  Field,
  localDay,
  panel,
  type Agent,
  type CallInputs,
  type CallOutputs,
  type Host,
} from "./CallUI";
import { OperationStatus, useCallOperation } from "./useCallOperation";
export default function BookCall({
  context,
  hosts,
  initialAgentId,
  initialHostId,
  onBooked,
  close,
}: {
  context: CallOutputs["context"];
  hosts: Host[];
  initialAgentId?: number;
  initialHostId?: number;
  onBooked: (id: number) => void;
  close: () => void;
}) {
  const { user } = useAuth();
  const [hostId, setHostId] = useState(
    initialHostId && hosts.some(host => host.id === initialHostId)
      ? initialHostId
      : !context.canViewTeam
        ? context.actorId
        : 0
  );
  const [reason, setReason] = useState<CallInputs["book"]["reasonKey"] | "">(
    ""
  );
  const [explanation, setExplanation] = useState("");
  const [format, setFormat] =
    useState<CallInputs["book"]["format"]>("one_to_one");
  const [selected, setSelected] = useState<Agent[]>([]);
  const [day, setDay] = useState(() => localDay());
  const [slot, setSlot] = useState<Slot | null>(null);
  const [verified, setVerified] = useState(false);
  const agentIds = useMemo(() => selected.map(agent => agent.id), [selected]);
  const book = trpc.staffCalls.book.useMutation();
  const operation = useCallOperation<CallInputs["book"]>(
    `jlt-call-book:${user?.id ?? context.actorId}`,
    input => book.mutateAsync(input),
    result => onBooked(result.callId)
  );
  const locked = operation.pending || !!operation.frozen;
  const mayVerifyHost = context.canViewTeam || context.provider.connected;
  const valid =
    context.canManage &&
    mayVerifyHost &&
    hosts.some(host => host.id === hostId) &&
    !!reason &&
    (reason !== "other" || explanation.trim().length >= 3) &&
    (format === "one_to_one" ? selected.length === 1 : selected.length >= 2) &&
    !!slot &&
    verified;
  function chooseAgents(agents: Agent[]) {
    setSelected(agents);
    setSlot(null);
    setVerified(false);
  }
  return (
    <section className={panel} aria-label="Book a private call">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Book a private support call</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Select Portal identities, then choose a real provider-confirmed
            slot.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          disabled={operation.pending}
          onClick={close}
        >
          Close booking
        </Button>
      </div>
      <OperationStatus operation={operation} />
      <form
        onSubmit={event => {
          event.preventDefault();
          if (!valid || locked || !slot || !reason) return;
          void operation.run({
            hostUserId: hostId,
            reasonKey: reason,
            ...(reason === "other"
              ? { reasonExplanation: explanation.trim() }
              : {}),
            format,
            startAt: new Date(slot.startAt),
            endAt: new Date(slot.endAt),
            agentIds,
          });
        }}
      >
        <fieldset disabled={locked} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Call host">
              <select
                className={control}
                value={hostId || ""}
                required
                onChange={event => {
                  setHostId(Number(event.target.value));
                  setSlot(null);
                  setVerified(false);
                }}
              >
                <option value="">Select authorised host</option>
                {hosts.map(host => (
                  <option key={host.id} value={host.id}>
                    {host.name || `Host #${host.id}`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Required call reason">
              <select
                className={control}
                required
                value={reason}
                onChange={event =>
                  setReason(event.target.value as typeof reason)
                }
              >
                <option value="">Select a reason</option>
                {context.reasons.map(item => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Call format">
              <select
                className={control}
                value={format}
                onChange={event => {
                  setFormat(event.target.value as typeof format);
                  setSlot(null);
                  setVerified(false);
                }}
              >
                <option value="one_to_one">1:1 · exactly one agent</option>
                <option value="group">
                  Private group · two or more agents
                </option>
              </select>
            </Field>
          </div>
          {reason === "other" && (
            <Field label="Explain Other reason">
              <textarea
                className={control}
                required
                minLength={3}
                maxLength={1000}
                value={explanation}
                onChange={event => setExplanation(event.target.value)}
              />
            </Field>
          )}
          <AgentPicker
            selected={selected}
            onChange={chooseAgents}
            initialAgentId={initialAgentId}
            disabled={locked}
          />
          {format === "one_to_one" && selected.length > 1 && (
            <p role="alert" className="text-sm text-amber-800">
              A 1:1 needs exactly one agent. Remove extra selections or
              deliberately choose a private group.
            </p>
          )}
          <SlotPicker
            hostUserId={hostId}
            format={format}
            agentIds={agentIds}
            day={day}
            onDay={setDay}
            selected={slot}
            onSelect={setSlot}
            onVerified={setVerified}
            enabled={
              mayVerifyHost &&
              !!hostId &&
              (format === "one_to_one"
                ? selected.length === 1
                : selected.length >= 2)
            }
            disabled={locked}
          />
          {!context.provider.connected && (
            <p
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            >
              {context.provider.message}{" "}
              {context.canViewTeam
                ? "Your own host is unconnected; another selected host must independently verify real slots before booking."
                : "Booking remains disabled."}{" "}
              An empty diary does not verify availability.
            </p>
          )}
          <Button type="submit" disabled={!valid || locked}>
            {operation.pending
              ? "Waiting for provider…"
              : "Confirm provider booking"}
          </Button>
        </fieldset>
      </form>
      <p className="text-xs leading-5 text-muted-foreground">
        No placeholder booking or manual time entry. Invitations belong to the
        scheduling provider. Booking does not publish Academy Actions or update
        an agent's membership stage.
      </p>
    </section>
  );
}
