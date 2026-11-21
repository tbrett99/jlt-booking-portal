import { useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  callTime,
  control,
  Field,
  localRange,
  localZone,
  type CallInputs,
  type CallOutputs,
} from "./CallUI";
export type Slot = CallOutputs["availability"]["slots"][number];
export default function SlotPicker({
  hostUserId,
  format,
  agentIds,
  day,
  onDay,
  selected,
  onSelect,
  enabled,
  disabled = false,
  onVerified,
}: {
  hostUserId: number;
  format: CallInputs["book"]["format"];
  agentIds: number[];
  day: string;
  onDay: (day: string) => void;
  selected: Slot | null;
  onSelect: (slot: Slot | null) => void;
  enabled: boolean;
  disabled?: boolean;
  onVerified?: (verified: boolean) => void;
}) {
  const input = useMemo(
    () => ({ hostUserId, format, agentIds, ...localRange(day) }),
    [hostUserId, format, agentIds, day]
  );
  const slots = trpc.staffCalls.availability.useQuery(input, {
    enabled: enabled && !!hostUserId && !!agentIds.length && !!day && !disabled,
    retry: false,
    staleTime: 0,
  });
  const validSlots =
    !slots.error && !slots.isFetching && slots.data?.connected
      ? slots.data.slots
      : [];
  const verified =
    enabled &&
    !disabled &&
    !!day &&
    !!selected &&
    validSlots.some(
      slot =>
        +new Date(slot.startAt) === +new Date(selected.startAt) &&
        +new Date(slot.endAt) === +new Date(selected.endAt) &&
        slot.capacity >= agentIds.length
    );
  useEffect(() => {
    onVerified?.(verified);
  }, [verified, onVerified]);
  return (
    <section className="space-y-3">
      <Field label={`Slot date (${localZone()})`}>
        <input
          className={control}
          type="date"
          value={day}
          disabled={disabled}
          onChange={event => {
            onDay(event.target.value);
            onSelect(null);
          }}
        />
      </Field>
      {!enabled ? (
        <p role="status" className="text-sm text-amber-800">
          Availability unconnected or booking choices incomplete. No bookable
          times can be assumed.
        </p>
      ) : slots.error ? (
        <p role="alert" className="text-sm text-red-800">
          Availability could not be verified: {slots.error.message}. No stored
          slots are offered.
        </p>
      ) : slots.isFetching || slots.isLoading ? (
        <p role="status" className="text-sm">
          Verifying real provider slots…
        </p>
      ) : !slots.data?.connected ? (
        <p role="status" className="text-sm text-amber-800">
          {slots.data?.message ||
            "Calendar provider is unconnected. Booking is disabled."}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Provider-verified times for this host and call format. Final
            confirmation is checked again when booking. {slots.data.message}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {validSlots
              .filter(slot => slot.capacity >= agentIds.length)
              .map(slot => {
                const active =
                  !!selected &&
                  +new Date(selected.startAt) === +new Date(slot.startAt) &&
                  +new Date(selected.endAt) === +new Date(slot.endAt);
                return (
                  <Button
                    type="button"
                    key={new Date(slot.startAt).toISOString()}
                    variant={active ? "default" : "outline"}
                    disabled={disabled}
                    aria-pressed={active}
                    className="h-auto whitespace-normal py-3"
                    onClick={() => onSelect(slot)}
                  >
                    {callTime(slot.startAt)} – {callTime(slot.endAt)} · capacity{" "}
                    {slot.capacity}
                  </Button>
                );
              })}
          </div>
          {!validSlots.some(slot => slot.capacity >= agentIds.length) && (
            <p className="text-sm">
              No provider-confirmed slots for these selected attendees and this
              date. This is not a free diary.
            </p>
          )}
        </>
      )}
      {selected &&
        !validSlots.some(
          slot =>
            +new Date(slot.startAt) === +new Date(selected.startAt) &&
            +new Date(slot.endAt) === +new Date(selected.endAt) &&
            slot.capacity >= agentIds.length
        ) && (
          <p role="alert" className="text-sm text-amber-800">
            The selected slot is no longer currently verified. Re-check
            availability before proceeding.
          </p>
        )}
      <Button
        type="button"
        variant="ghost"
        disabled={!enabled || disabled || slots.isFetching}
        onClick={() => {
          onSelect(null);
          void slots.refetch();
        }}
      >
        Re-check availability
      </Button>
    </section>
  );
}
