import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import SlotPicker, { type Slot } from "./SlotPicker";
import {
  callTime,
  control,
  Field,
  localDay,
  localRange,
  panel,
  type CallDetailData,
  type CallInputs,
} from "./CallUI";
import { OperationStatus, useCallOperation } from "./useCallOperation";
type CancelPayload = CallInputs["cancel"] | CallInputs["cancelParticipant"];
export default function CallScheduling({
  detail,
  actorId,
  connected,
  refresh,
}: {
  detail: CallDetailData;
  actorId: number;
  connected: boolean;
  refresh: () => void;
}) {
  const { call, participants } = detail;
  const [cancelTarget, setCancelTarget] = useState<"session" | number | null>(
    null
  );
  const [reason, setReason] = useState("");
  const [version, setVersion] = useState(call.version);
  const [rescheduling, setRescheduling] = useState(false);
  const [day, setDay] = useState(() => localDay(new Date(call.startAt)));
  const [slot, setSlot] = useState<Slot | null>(null);
  const [verified, setVerified] = useState(false);
  const [rescheduleConfirm, setRescheduleConfirm] = useState(false);
  const cancel = trpc.staffCalls.cancel.useMutation();
  const cancelParticipant = trpc.staffCalls.cancelParticipant.useMutation();
  const reschedule = trpc.staffCalls.reschedule.useMutation();
  const cancelOperation = useCallOperation<CancelPayload>(
    `jlt-call-cancel:${actorId}:${call.id}`,
    input =>
      "participantId" in input
        ? cancelParticipant.mutateAsync(input)
        : cancel.mutateAsync(input),
    refresh
  );
  const rescheduleOperation = useCallOperation<CallInputs["reschedule"]>(
    `jlt-call-reschedule:${actorId}:${call.id}`,
    input => reschedule.mutateAsync(input),
    refresh
  );
  const active = useMemo(
    () =>
      participants
        .filter(participant => participant.status === "active")
        .map(participant => participant.agentId),
    [participants]
  );
  const hostInput = useMemo(
    () => ({
      hostUserId: call.hostUserId,
      format: call.format,
      agentIds: active,
      ...localRange(day),
    }),
    [call.hostUserId, call.format, active, day]
  );
  const hostCheck = trpc.staffCalls.availability.useQuery(hostInput, {
    enabled: call.status === "booked" && !!active.length && !!day,
    retry: false,
    staleTime: 0,
  });
  const hostConnected =
    !hostCheck.error &&
    !hostCheck.isFetching &&
    hostCheck.data?.connected === true;
  const locked =
    cancelOperation.pending ||
    rescheduleOperation.pending ||
    !!cancelOperation.frozen ||
    !!rescheduleOperation.frozen;
  const changed = version !== call.version;
  const canChange =
    call.status === "booked" && hostConnected && !locked && !changed;
  return (
    <section className={panel}>
      <h3 className="font-semibold">Scheduling controls</h3>
      <OperationStatus operation={cancelOperation} />
      <OperationStatus operation={rescheduleOperation} />
      {changed && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            Scheduling changed from version {version} to {call.version}. Review
            current time/status above. Your cancellation reason is retained; the
            old slot selection is not reusable.
          </p>
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => {
              setVersion(call.version);
              setSlot(null);
              setVerified(false);
              setRescheduleConfirm(false);
            }}
          >
            Adopt reviewed scheduling version
          </Button>
        </div>
      )}
      {!hostConnected && (
        <p className="text-sm text-amber-800">
          The call host's provider connection has not been verified.{" "}
          {hostCheck.error?.message || hostCheck.data?.message} Scheduling
          changes are disabled, not represented as completed.
        </p>
      )}
      <fieldset disabled={!canChange} className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setRescheduling(!rescheduling);
              setCancelTarget(null);
              setSlot(null);
              setRescheduleConfirm(false);
            }}
          >
            Choose a reschedule slot
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setCancelTarget("session");
              setRescheduling(false);
            }}
          >
            Cancel whole session
          </Button>
        </div>
        {call.format === "group" && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">
              Cancel one participant only · other seats stay booked
            </p>
            <div className="flex flex-wrap gap-2">
              {participants
                .filter(participant => participant.status === "active")
                .map(participant => (
                  <Button
                    key={participant.id}
                    variant="outline"
                    onClick={() => {
                      setCancelTarget(participant.id);
                      setRescheduling(false);
                    }}
                  >
                    Cancel invitation for{" "}
                    {participant.name || `Agent #${participant.agentId}`}
                  </Button>
                ))}
            </div>
          </div>
        )}
        {cancelTarget !== null && (
          <section className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
            <h4 className="font-semibold">
              {cancelTarget === "session"
                ? "Confirm cancellation of the entire session?"
                : "Confirm cancellation of just this participant?"}
            </h4>
            <p className="text-sm">
              {cancelTarget === "session"
                ? `All ${active.length} active participant invitations are affected. History and private call records remain.`
                : `Only invitation #${cancelTarget} is affected. Other participants and the shared session are retained.`}
            </p>
            <Field label="Cancellation reason">
              <textarea
                className={control}
                maxLength={1000}
                required
                value={reason}
                onChange={event => setReason(event.target.value)}
              />
            </Field>
            <Button
              variant="destructive"
              disabled={!reason.trim()}
              onClick={() => {
                if (!canChange || !reason.trim()) return;
                void cancelOperation.run({
                  callId: call.id,
                  expectedVersion: version,
                  reason: reason.trim(),
                  ...(cancelTarget === "session"
                    ? {}
                    : { participantId: cancelTarget }),
                });
              }}
            >
              {cancelTarget === "session"
                ? "Confirm whole-session cancellation"
                : "Confirm participant-only cancellation"}
            </Button>
            <Button
              className="ml-2"
              variant="ghost"
              onClick={() => setCancelTarget(null)}
            >
              Keep booking
            </Button>
          </section>
        )}
        {rescheduling && (
          <section className="space-y-4 border-t pt-4">
            <h4 className="font-semibold">Reschedule the session</h4>
            <p className="text-sm">
              Current time: {callTime(call.startAt)} – {callTime(call.endAt)}.
              All active participants are included; retain the previous time in
              history.
            </p>
            <SlotPicker
              hostUserId={call.hostUserId}
              format={call.format}
              agentIds={active}
              day={day}
              onDay={setDay}
              selected={slot}
              onSelect={value => {
                setSlot(value);
                setRescheduleConfirm(false);
              }}
              onVerified={setVerified}
              enabled={canChange && active.length > 0}
            />
            {rescheduleConfirm && slot ? (
              <div className="space-y-2">
                <p className="text-sm">
                  Confirm provider-verified move to {callTime(slot.startAt)} for
                  all active participants?
                </p>
                <Button
                  disabled={!verified}
                  onClick={() => {
                    if (!canChange || !slot || !verified) return;
                    void rescheduleOperation.run({
                      callId: call.id,
                      expectedVersion: version,
                      startAt: new Date(slot.startAt),
                      endAt: new Date(slot.endAt),
                    });
                  }}
                >
                  Confirm provider reschedule
                </Button>
                <Button
                  variant="ghost"
                  className="ml-2"
                  onClick={() => setRescheduleConfirm(false)}
                >
                  Keep existing time
                </Button>
              </div>
            ) : (
              <Button
                disabled={!slot || !verified}
                onClick={() => setRescheduleConfirm(true)}
              >
                Review new time
              </Button>
            )}
          </section>
        )}
      </fieldset>
      {call.status !== "booked" && (
        <p className="text-sm text-muted-foreground">
          Only provider-confirmed booked sessions can be rescheduled or
          cancelled. Pending/recovery calls require reconciliation.
        </p>
      )}
    </section>
  );
}
