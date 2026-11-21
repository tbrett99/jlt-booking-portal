import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  callTime,
  control,
  Field,
  MutationError,
  panel,
  type CallDetailData,
  type CallInputs,
} from "./CallUI";
type Participant = CallDetailData["participants"][number];
export default function ParticipantRecord({
  participant,
  callId,
  ended,
  staffMode,
  refresh,
  showBriefing,
}: {
  participant: Participant;
  callId: number;
  ended: boolean;
  staffMode: boolean;
  refresh: () => void;
  showBriefing: () => void;
}) {
  const [version, setVersion] = useState(participant.version);
  const [attendance, setAttendance] = useState<
    CallInputs["saveNotes"]["attendance"] | ""
  >(participant.attendance === "awaiting" ? "" : participant.attendance);
  const [outcome, setOutcome] = useState<
    CallInputs["saveNotes"]["outcome"] | ""
  >(participant.outcome ?? "");
  const [notes, setNotes] = useState(participant.privateNotes ?? "");
  const [recap, setRecap] = useState(participant.sharedSummary ?? "");
  const [shareConfirm, setShareConfirm] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    instructions: "",
    dueAt: "",
  });
  const [planId, setPlanId] = useState<number | null>(null);
  const [saved, setSaved] = useState("");
  const [sharedAt, setSharedAt] = useState(participant.sharedAt);
  const notesMutation = trpc.staffCalls.saveNotes.useMutation();
  const share = trpc.staffCalls.shareRecap.useMutation();
  const followUp = trpc.staffCalls.draftFollowUp.useMutation();
  const pending =
    notesMutation.isPending || share.isPending || followUp.isPending;
  const changedElsewhere = participant.version !== version;
  const matchedOutcome =
    attendance === "attended"
      ? outcome === "completed" || outcome === "follow_up_required"
      : attendance === "notheld"
        ? outcome === "not_held"
        : !!attendance && outcome === "no_contact";
  const hasSavedRecord =
    ended &&
    participant.attendance !== "awaiting" &&
    !!participant.privateNotes?.trim();
  async function saveNotes() {
    if (
      !ended ||
      !attendance ||
      !outcome ||
      !notes.trim() ||
      !matchedOutcome ||
      pending ||
      changedElsewhere
    )
      return;
    try {
      const result = await notesMutation.mutateAsync({
        callId,
        participantId: participant.id,
        expectedVersion: version,
        attendance,
        outcome,
        privateNotes: notes.trim(),
      });
      setVersion(result.version);
      setSaved("Private record saved. Nothing was shared.");
      refresh();
    } catch {
      setSaved("");
    }
  }
  function reloadVersion() {
    // Keep authored drafts, but explicitly adopt the newest server version only after review.
    setVersion(participant.version);
    notesMutation.reset();
    share.reset();
    followUp.reset();
    setSaved("");
  }
  return (
    <article className={panel}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {participant.name || `Agent #${participant.agentId}`} · #
            {participant.agentId}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Invitation {participant.status} · participant #{participant.id} ·
            record version {version}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={showBriefing}>
          View permitted briefing
        </Button>
      </header>
      <p className="text-xs text-muted-foreground">
        Manual attendance is never inferred from time elapsed or a meeting link
        being opened.
      </p>
      {changedElsewhere && (
        <section className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            The server now has version {participant.version}. Your draft is
            unchanged; review the new saved record before adopting its version.
          </p>
          <details>
            <summary>Review current server record</summary>
            <p className="whitespace-pre-wrap">
              Attendance: {participant.attendance}; outcome:{" "}
              {participant.outcome || "unrecorded"}. Private notes:{" "}
              {participant.privateNotes || "none"}. Shared recap:{" "}
              {participant.sharedAt ? participant.sharedSummary : "not shared"}.
            </p>
          </details>
          <Button variant="outline" onClick={reloadVersion}>
            Keep draft and adopt reviewed version
          </Button>
        </section>
      )}
      <fieldset disabled={pending || changedElsewhere} className="space-y-4">
        <section className="space-y-3 rounded-lg border p-4">
          <h4 className="font-semibold">Internal record · private</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`Attendance for agent #${participant.agentId}`}>
              <select
                className={control}
                value={attendance}
                onChange={event => {
                  setAttendance(event.target.value as typeof attendance);
                  setOutcome("");
                  setSaved("");
                }}
              >
                <option value="">Select manual attendance</option>
                <option value="attended">Attended</option>
                <option value="no_show">Did not attend / no-show</option>
                <option value="excused">Excused</option>
                <option value="notheld">Call not held</option>
              </select>
            </Field>
            <Field label={`Outcome for agent #${participant.agentId}`}>
              <select
                className={control}
                value={outcome}
                onChange={event => {
                  setOutcome(event.target.value as typeof outcome);
                  setSaved("");
                }}
              >
                <option value="">Select outcome</option>
                {attendance === "attended" ? (
                  <>
                    <option value="completed">Completed</option>
                    <option value="follow_up_required">
                      Follow-up required
                    </option>
                  </>
                ) : attendance === "notheld" ? (
                  <option value="not_held">Not held</option>
                ) : (
                  <option value="no_contact">No contact</option>
                )}
              </select>
            </Field>
          </div>
          <Field
            label={`Required private internal notes for agent #${participant.agentId}`}
          >
            <textarea
              className={control}
              required
              maxLength={20000}
              rows={3}
              value={notes}
              onChange={event => {
                setNotes(event.target.value);
                setSaved("");
              }}
            />
          </Field>
          {!ended && (
            <p className="text-sm text-amber-800">
              Outcomes can only be saved after the scheduled session has ended.
            </p>
          )}
          <MutationError error={notesMutation.error} />
          <Button
            disabled={
              !ended ||
              !notes.trim() ||
              !matchedOutcome ||
              !attendance ||
              !outcome
            }
            onClick={() => void saveNotes()}
          >
            Save private call record
          </Button>
        </section>
        <section className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
          <h4 className="font-semibold">Shared recap · this agent only</h4>
          <p className="text-xs leading-5 text-muted-foreground">
            This is a separate field. Saving private notes does not copy them
            here, share them, publish an Action or send email.
          </p>
          <Field label={`Shared recap for agent #${participant.agentId}`}>
            <textarea
              className={control}
              maxLength={10000}
              rows={3}
              value={recap}
              onChange={event => {
                setRecap(event.target.value);
                setShareConfirm(false);
              }}
            />
          </Field>
          <p className="text-xs">
            {sharedAt
              ? `Last explicitly shared ${callTime(sharedAt)}`
              : "Not yet explicitly shared."}
          </p>
          <MutationError error={share.error} />
          {!hasSavedRecord && (
            <p className="text-xs text-amber-800">
              Save manual attendance and required internal notes after the
              session ends before sharing or creating follow-up.
            </p>
          )}
          {shareConfirm ? (
            <div className="space-y-2">
              <p className="text-sm">
                Make only this recap visible to agent #{participant.agentId}?
                Private notes remain private.
              </p>
              <Button
                disabled={!recap.trim() || !hasSavedRecord}
                onClick={async () => {
                  if (
                    !hasSavedRecord ||
                    pending ||
                    changedElsewhere ||
                    !recap.trim()
                  )
                    return;
                  try {
                    const result = await share.mutateAsync({
                      callId,
                      participantId: participant.id,
                      expectedVersion: version,
                      sharedSummary: recap.trim(),
                    });
                    setVersion(result.version);
                    setSharedAt(result.sharedAt);
                    setShareConfirm(false);
                    setSaved("Recap explicitly shared with this agent.");
                    refresh();
                  } catch {
                    setSaved("");
                  }
                }}
              >
                Confirm share with this agent
              </Button>
              <Button
                className="ml-2"
                variant="ghost"
                onClick={() => setShareConfirm(false)}
              >
                Keep recap private
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              disabled={!recap.trim() || !hasSavedRecord}
              onClick={() => setShareConfirm(true)}
            >
              Share recap explicitly
            </Button>
          )}
        </section>
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-semibold">
            Academy next steps · create a draft separately
          </summary>
          <div className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Optional and linked to this participant's call. Draft creation
              does not assign work, publish or complete a lesson.
            </p>
            <Field label={`Action title for agent #${participant.agentId}`}>
              <input
                className={control}
                maxLength={255}
                value={draft.title}
                onChange={event =>
                  setDraft({ ...draft, title: event.target.value })
                }
              />
            </Field>
            <Field
              label={`Action instructions for agent #${participant.agentId}`}
            >
              <textarea
                className={control}
                maxLength={20000}
                value={draft.instructions}
                onChange={event =>
                  setDraft({ ...draft, instructions: event.target.value })
                }
              />
            </Field>
            <Field label="Action deadline (your local time)">
              <input
                className={control}
                type="datetime-local"
                value={draft.dueAt}
                onChange={event =>
                  setDraft({ ...draft, dueAt: event.target.value })
                }
              />
            </Field>
            <MutationError error={followUp.error} />
            <Button
              variant="outline"
              disabled={
                !hasSavedRecord ||
                draft.title.trim().length < 3 ||
                draft.instructions.trim().length < 3 ||
                !!planId
              }
              onClick={async () => {
                if (
                  !hasSavedRecord ||
                  pending ||
                  changedElsewhere ||
                  draft.title.trim().length < 3 ||
                  draft.instructions.trim().length < 3 ||
                  planId
                )
                  return;
                try {
                  const result = await followUp.mutateAsync({
                    callId,
                    participantId: participant.id,
                    expectedVersion: version,
                    title: draft.title.trim(),
                    instructions: draft.instructions.trim(),
                    dueAt: draft.dueAt ? new Date(draft.dueAt) : null,
                    requiresNote: true,
                    requiresUrl: false,
                    requiresUpload: false,
                    staffReviewRequired: true,
                  });
                  setPlanId(result.planId);
                  setSaved("Academy draft created; not assigned.");
                  refresh();
                } catch {
                  setSaved("");
                }
              }}
            >
              Create separate Academy Action draft
            </Button>
            {planId && (
              <p className="text-sm">
                Draft #{planId} created.{" "}
                <Link
                  className="font-semibold underline"
                  href={
                    staffMode ? "/staff/engagement" : "/admin/academy/actions"
                  }
                >
                  Review and explicitly assign using Academy Actions →
                </Link>
              </p>
            )}
          </div>
        </details>
      </fieldset>
      {saved && (
        <p role="status" className="text-sm font-medium text-emerald-800">
          {saved}
        </p>
      )}
    </article>
  );
}
