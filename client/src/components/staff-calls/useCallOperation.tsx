import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { callTime, type CallOutputs } from "./CallUI";

type Result = CallOutputs["reconcile"];
type Frozen<T> = { payload: T; result?: Result; error?: string };
type ScopedState<T> = {
  key: string;
  frozen: Frozen<T> | null;
  pending: boolean;
  storageError: string | null;
};
function restore<T>(key: string): Frozen<T> | null {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const parsed = JSON.parse(stored, (field, value) =>
      ["startAt", "endAt"].includes(field) && typeof value === "string"
        ? new Date(value)
        : value
    );
    if (typeof parsed.payload?.requestId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}
/** Retain exact requests before dispatch; never transfer drafts or late results between actor scopes. */
export function useCallOperation<T extends { requestId: string }>(
  key: string,
  mutate: (payload: T) => Promise<Result>,
  onConfirmed?: (result: Result) => void
) {
  const [state, setState] = useState<ScopedState<T>>(() => ({
    key,
    frozen: restore<T>(key),
    pending: false,
    storageError: null,
  }));
  const scope = useRef({ key, busy: false });
  if (scope.current.key !== key) scope.current = { key, busy: false };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setState(current =>
      current.key === key
        ? current
        : { key, frozen: restore<T>(key), pending: false, storageError: null }
    );
  }, [key]);
  const reconcile = trpc.staffCalls.reconcile.useMutation();
  const currentState = state.key === key ? state : null;
  const frozen = currentState?.frozen ?? null;
  const pending = currentState?.pending ?? false;
  const storageError = currentState?.storageError ?? null;
  const isCurrent = (captured: typeof scope.current) =>
    mounted.current && scope.current === captured && captured.key === key;
  function persist(
    captured: typeof scope.current,
    value: Frozen<T>,
    pendingValue: boolean
  ) {
    if (!isCurrent(captured)) return;
    localStorage.setItem(captured.key, JSON.stringify(value));
    setState({
      key: captured.key,
      frozen: value,
      pending: pendingValue,
      storageError: null,
    });
  }
  function complete(
    captured: typeof scope.current,
    current: Frozen<T>,
    result: Result
  ) {
    if (!isCurrent(captured)) return;
    persist(captured, { payload: current.payload, result }, false);
    if (result.state === "succeeded" && isCurrent(captured))
      onConfirmed?.(result);
  }
  async function run(input?: Omit<T, "requestId">) {
    const captured = scope.current;
    if (captured.key !== key || captured.busy || !isCurrent(captured)) return;
    const current =
      restore<T>(captured.key) ??
      currentState?.frozen ??
      (input
        ? { payload: { ...input, requestId: crypto.randomUUID() } as T }
        : null);
    if (!current || current.result?.state === "succeeded") return;
    try {
      persist(captured, current, true);
    } catch {
      if (isCurrent(captured))
        setState({
          key,
          frozen: currentState?.frozen ?? null,
          pending: false,
          storageError:
            "Browser storage is unavailable. No booking request was sent. Enable storage before retrying.",
        });
      return;
    }
    captured.busy = true;
    try {
      complete(captured, current, await mutate(current.payload));
    } catch (error) {
      if (!isCurrent(captured)) return;
      const next = {
        payload: current.payload,
        error: error instanceof Error ? error.message : "Response lost",
      };
      try {
        persist(captured, next, false);
      } catch {
        setState({
          key: captured.key,
          frozen: next,
          pending: false,
          storageError: null,
        });
      }
    } finally {
      captured.busy = false;
      if (isCurrent(captured))
        setState(current =>
          current.key === captured.key
            ? { ...current, pending: false }
            : current
        );
    }
  }
  async function recover() {
    const captured = scope.current;
    if (
      !frozen ||
      captured.key !== key ||
      captured.busy ||
      !isCurrent(captured)
    )
      return;
    const current = frozen;
    captured.busy = true;
    setState(currentState =>
      currentState.key === captured.key
        ? { ...currentState, pending: true }
        : currentState
    );
    try {
      complete(
        captured,
        current,
        await reconcile.mutateAsync({ requestId: current.payload.requestId })
      );
    } catch (error) {
      if (isCurrent(captured))
        setState({
          key: captured.key,
          frozen: {
            ...current,
            error:
              error instanceof Error ? error.message : "Status check failed",
          },
          pending: false,
          storageError: null,
        });
    } finally {
      captured.busy = false;
      if (isCurrent(captured))
        setState(currentState =>
          currentState.key === captured.key
            ? { ...currentState, pending: false }
            : currentState
        );
    }
  }
  function clear() {
    const captured = scope.current;
    if (
      !isCurrent(captured) ||
      captured.busy ||
      pending ||
      (frozen && !["succeeded", "failed"].includes(frozen.result?.state ?? ""))
    )
      return;
    try {
      localStorage.removeItem(captured.key);
      setState({
        key: captured.key,
        frozen: null,
        pending: false,
        storageError: null,
      });
    } catch {
      setState(current =>
        current.key === captured.key
          ? {
              ...current,
              storageError:
                "The resolved request could not be cleared from this browser. Nothing new was booked.",
            }
          : current
      );
    }
  }
  return { frozen, pending, storageError, run, recover, clear };
}
export function OperationStatus<T extends { requestId: string }>({
  operation,
}: {
  operation: ReturnType<typeof useCallOperation<T>>;
}) {
  const { frozen, pending, storageError } = operation;
  if (!frozen && !storageError) return null;
  return (
    <section
      className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
      aria-live="polite"
    >
      {storageError && <p role="alert">{storageError}</p>}
      {frozen && (
        <>
          <h3 className="font-semibold">
            {frozen.result?.state === "succeeded"
              ? "Booking update confirmed"
              : "Check this booking before continuing"}
          </h3>
          <details>
            <summary className="cursor-pointer text-xs">
              Booking reference for support
            </summary>
            <code className="break-all text-xs">
              {frozen.payload.requestId}
            </code>
          </details>
          <p>
            {frozen.result?.message ||
              frozen.error ||
              "Awaiting a definitive calendar result."}
          </p>
          {"startAt" in frozen.payload && (
            <p>Requested time: {callTime(frozen.payload.startAt as Date)}</p>
          )}
          {frozen.result?.state !== "succeeded" && (
            <p>
              Do not create another booking. Check its status first. Retrying
              below uses the same saved request, not a new appointment.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!["succeeded", "failed"].includes(frozen.result?.state ?? "") && (
              <>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => void operation.recover()}
                >
                  Check booking status
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => void operation.run()}
                >
                  Retry this booking request
                </Button>
              </>
            )}
            {["succeeded", "failed"].includes(frozen.result?.state ?? "") && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={operation.clear}
              >
                Continue
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
