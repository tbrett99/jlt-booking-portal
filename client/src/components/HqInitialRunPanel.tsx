import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  HQ_INITIAL_RUN_ERRORS,
  HqInitialRunController,
  type HqInitialRunState,
  type HqInitialRunStatus,
} from "@/lib/hq-initial-run";
import type { HqInitialImportResult } from "../../../shared/management-hq-initial-import";

const initialState: HqInitialRunState = {
  phase: "idle",
  busy: false,
  pendingMutation: false,
  uncertain: false,
  attempt: 0,
  progress: null,
  nextDueAt: null,
  error: null,
  warning: null,
};
const pendingWarning =
  "A server mutation may still finish; no further batches will run.";
type RunRecord = {
  controller: HqInitialRunController;
  state: HqInitialRunState;
  pending: boolean;
  listeners: Set<(state: HqInitialRunState) => void>;
};
// Actor IDs are the only identity keys. Retain no source rows, amounts, messages,
// storage entries or completed-run history. Detached unresolved mutations alone
// survive unmount: discarding them would allow a duplicate request on remount.
const pendingRuns = new Map<number, RunRecord>();
const active = (state: HqInitialRunState) =>
  state.phase === "running" || state.phase === "waiting";
function collect(actorId: number, record: RunRecord) {
  if (
    !record.listeners.size &&
    !record.pending &&
    !record.controller.hasPendingMutation() &&
    pendingRuns.get(actorId) === record
  ) {
    pendingRuns.delete(actorId);
  }
}
function publish(actorId: number, record: RunRecord, next: HqInitialRunState) {
  record.state = {
    ...next,
    progress: next.progress
      ? { pages: next.progress.pages, recordsRead: next.progress.recordsRead }
      : next.phase === "running" || next.phase === "completed"
        ? record.state.progress
        : null,
    error:
      next.error &&
      Object.values(HQ_INITIAL_RUN_ERRORS).includes(
        next.error as (typeof HQ_INITIAL_RUN_ERRORS)[keyof typeof HQ_INITIAL_RUN_ERRORS]
      )
        ? next.error
        : null,
    warning: next.warning === pendingWarning ? pendingWarning : null,
  };
  record.listeners.forEach(listener => listener(record.state));
  collect(actorId, record);
}
function stopRecord(actorId: number, record: RunRecord | null) {
  if (!record) return;
  record.controller.stop();
  const stopped = record.controller.getState();
  publish(actorId, record, {
    ...stopped,
    pendingMutation: record.pending || record.controller.hasPendingMutation(),
  });
}

export function HqInitialRunPanel(props: {
  actorId: number;
  boundary: string;
  eligible: boolean;
  published: boolean;
  disabled: boolean;
  invoke: () => Promise<HqInitialImportResult>;
  freshStatus: () => Promise<HqInitialRunStatus>;
  verifyCurrent: () => boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [state, setState] = useState(initialState);
  const controller = useRef<HqInitialRunController | null>(null);
  const recordRef = useRef<RunRecord | null>(null);
  const listenerRef = useRef<((state: HqInitialRunState) => void) | null>(null);
  const alive = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const running = active(state);
  useEffect(() => {
    const actor = props.actorId;
    alive.current = true;
    const listener = (next: HqInitialRunState) => {
      if (!alive.current || latest.current.actorId !== actor) return;
      setState(next);
      latest.current.onBusy(active(next) || next.pendingMutation);
    };
    listenerRef.current = listener;
    const prior = pendingRuns.get(actor);
    if (prior) {
      recordRef.current = prior;
      controller.current = prior.controller;
      prior.listeners.add(listener);
      listener(prior.state);
    } else {
      recordRef.current = null;
      controller.current = null;
      setState(initialState);
      latest.current.onBusy(false);
    }
    return () => {
      const record = recordRef.current;
      // Stop while this observer is still current so historical progress and
      // pending ownership are recorded before dropping its callbacks.
      stopRecord(actor, record);
      alive.current = false;
      record?.listeners.delete(listener);
      if (record) collect(actor, record);
      listenerRef.current = null;
    };
  }, [props.actorId]);
  useEffect(() => {
    stopRecord(props.actorId, recordRef.current);
  }, [props.boundary]);
  useEffect(() => {
    if (!props.eligible) stopRecord(props.actorId, recordRef.current);
  }, [props.eligible]);
  const start = () => {
    if (
      props.disabled ||
      !props.eligible ||
      props.published ||
      !props.verifyCurrent()
    )
      return;
    const prior = pendingRuns.get(props.actorId);
    // Also lock the initial status-read and wait phases, before any mutation is
    // admitted. A same-tick double click must not create a second controller.
    if (
      prior &&
      (prior.pending ||
        prior.controller.hasPendingMutation() ||
        active(prior.state))
    )
      return;
    const actor = props.actorId,
      boundary = props.boundary;
    const record: RunRecord = {
      controller: null!,
      state: initialState,
      pending: false,
      listeners: new Set(),
    };
    const run = new HqInitialRunController({
      invoke: async () => {
        record.pending = true;
        try {
          return await props.invoke();
        } finally {
          // This follows actual underlying settlement, not a stop/deadline race.
          // Controller notifications may be suppressed after actor/unmount
          // invalidation, but a new same-actor observer must still be unlocked.
          record.pending = false;
          publish(actor, record, { ...record.state, pendingMutation: false });
          // The controller releases its own pending bit on the following promise
          // reaction; cleanup after that reaction, without polling or refetching.
          queueMicrotask(() =>
            queueMicrotask(() =>
              publish(actor, record, {
                ...record.state,
                pendingMutation:
                  record.pending || record.controller.hasPendingMutation(),
              })
            )
          );
        }
      },
      freshStatus: props.freshStatus,
      verifyCurrent: () =>
        alive.current &&
        latest.current.actorId === actor &&
        latest.current.boundary === boundary &&
        latest.current.eligible &&
        latest.current.verifyCurrent(),
      onState: next => publish(actor, record, next),
    });
    record.controller = run;
    if (listenerRef.current) record.listeners.add(listenerRef.current);
    recordRef.current?.listeners.delete(listenerRef.current!);
    recordRef.current = record;
    controller.current = run;
    pendingRuns.set(actor, record);
    run.start();
  };
  if (!props.eligible && state.phase === "idle") return null;
  return (
    <section
      className="rounded-xl border border-emerald-500/40 bg-card p-4 sm:p-5 space-y-3"
      aria-label="Finish first Orbit import"
    >
      <h2 className="font-semibold">Finish the first Orbit import</h2>
      <p className="text-sm">
        Start once to continue the saved import in bounded batches. Keep this
        page open. This is a one-off run, not recurring updates; dashboard
        figures stay off until the complete import is checked.
      </p>
      <div className="flex flex-wrap gap-2">
        {!running && state.phase !== "completed" && !props.published && (
          <Button
            disabled={
              props.disabled ||
              !props.eligible ||
              state.pendingMutation ||
              !!controller.current?.hasPendingMutation()
            }
            onClick={start}
          >
            Finish first import
          </Button>
        )}
        {running && (
          <Button variant="outline" onClick={() => controller.current?.stop()}>
            Stop after current batch
          </Button>
        )}
      </div>
      <div
        role={state.phase === "error" ? "alert" : "status"}
        className="text-sm space-y-1"
      >
        {state.phase === "idle" && (
          <p>
            No run starts automatically. Existing saved progress is retained.
          </p>
        )}
        {state.phase === "running" && (
          <p>
            Import running. Processing a bounded batch and verifying saved
            progress…
          </p>
        )}
        {state.phase === "waiting" && (
          <p>
            Waiting until{" "}
            {state.nextDueAt
              ? new Date(state.nextDueAt).toLocaleString()
              : "the server permits the next batch"}
            . This run will continue when permitted.
          </p>
        )}
        {state.phase === "completed" && (
          <p>
            First import complete. Use Check imported figures below; dashboards
            have not been switched on.
          </p>
        )}
        {state.phase === "stopped" && (
          <p>
            Run stopped. A batch already sent may still finish; saved progress
            is retained.
          </p>
        )}
        {state.pendingMutation && !running && (
          <p>
            A previous import request has not finished. Do not start another run
            until it settles; then use Refresh to check saved status.
          </p>
        )}
        {state.error && <p>{state.error}</p>}
        {state.warning && <p>{state.warning}</p>}
        {state.progress && (
          <p>
            {state.progress.pages} pages · {state.progress.recordsRead} records
            read. These are progress counts, not accepted financial totals.
          </p>
        )}
      </div>
    </section>
  );
}
