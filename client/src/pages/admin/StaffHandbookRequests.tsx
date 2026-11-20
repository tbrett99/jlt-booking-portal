import React, { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  KNOWLEDGE_REQUEST_KINDS,
  KNOWLEDGE_REQUEST_KIND_LABELS,
  KNOWLEDGE_REQUEST_STATUSES,
  KNOWLEDGE_REQUEST_STATUS_LABELS,
  type KnowledgeRequestStatus,
} from "@shared/staff-handbook";
import {
  controlClass,
  panelClass,
  Field,
  Feedback,
  History,
  QueryState,
  dateLabel,
  errorText,
  type RequestDto,
  type Staff,
  type Audit,
  HandbookAccessBoundary,
  HandbookAccessDenied,
  useHandbookAccessGuard,
} from "./StaffHandbookComponents";
import { HandbookLinkPicker } from "./StaffHandbookLinkPicker";
import { StaffHandbookLinkedItem } from "./StaffHandbookLinkedItem";
import { useHandbookUnsavedWork } from "./useHandbookUnsavedWork";
const priorities = ["low", "normal", "high"] as const;
const priorityLabels = {
  low: "When there is time",
  normal: "Normal",
  high: "Urgent — staff need this soon",
};
function staffName(staff: Staff[], id: number | null) {
  return (
    staff.find(person => person.id === id)?.name ||
    (id ? "JLT staff member" : "Nobody yet")
  );
}
export function ReportKnowledge(
  props: React.ComponentProps<typeof ReportKnowledgeContent>
) {
  return (
    <HandbookAccessBoundary>
      <ReportKnowledgeContent {...props} />
    </HandbookAccessBoundary>
  );
}
function ReportKnowledgeContent({
  categories,
  onCreated,
  onCancel,
}: {
  categories: string[];
  onCreated: (id: number) => void;
  onCancel: () => void;
}) {
  const utils = trpc.useUtils();
  const create = trpc.staffHandbook.createRequest.useMutation();
  const recoveredUpdate =
    trpc.staffHandbook.updateRecoveredRequest.useMutation();
  const { blocked, deny } = useHandbookAccessGuard(
    create.error,
    recoveredUpdate.error
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("General");
  const [kind, setKind] =
    useState<(typeof KNOWLEDGE_REQUEST_KINDS)[number]>("missing_process");
  const [checkedGuidance, setChecked] = useState("");
  const [impact, setImpact] = useState("");
  const [priority, setPriority] =
    useState<(typeof priorities)[number]>("normal");
  const [articleId, setArticleId] = useState<number | null>(null);
  const [optional, setOptional] = useState(false);
  const [createToken] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [saveUncertain, setSaveUncertain] = useState(false);
  const [recovered, setRecovered] = useState<RequestDto | null>(null);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const submitting = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const pending = busy || create.isPending || recoveredUpdate.isPending;
  const withUnsavedWorkBypass = useHandbookUnsavedWork(
    !blocked &&
      !savedId &&
      (pending ||
        !!title ||
        !!description ||
        category !== "General" ||
        kind !== "missing_process" ||
        priority !== "normal" ||
        !!checkedGuidance ||
        !!impact ||
        !!articleId)
  );
  async function recoverSavedReport() {
    if (pending || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const result = await utils.staffHandbook.recoverRequest.fetch(
        { createToken },
        { staleTime: 0 }
      );
      if (!alive.current) return;
      setRecovered(result.request as RequestDto | null);
      setFailed(false);
      setMessage(
        result.request
          ? "An earlier version of your report was saved. Your latest text is still below. Save it to the same report instead of submitting a new one."
          : "No saved report was found. Your text is still below; you can retry submitting it."
      );
    } catch (error) {
      if (deny(error)) return;
      if (alive.current) {
        setFailed(true);
        setMessage(
          `${errorText(error)} Your latest text is retained. Try checking again before submitting.`
        );
      }
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (blocked) return <HandbookAccessDenied />;
  return (
    <section className={panelClass} data-missing-guidance-form>
      <h2 className="text-lg font-semibold">Report missing guidance</h2>
      <p className="text-sm text-muted-foreground">
        What did you need help with? Tell us what is missing or unclear so
        someone can write or improve a guide. You do not need to know the
        answer.
      </p>
      <p className="text-xs text-muted-foreground">
        Staff only. Do not include customer details, payment data or passwords.
      </p>
      <Feedback message={message} error={failed} />
      {saveUncertain && !savedId && (
        <div className="space-y-2 rounded-md border p-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void recoverSavedReport()}
          >
            Check whether my report was saved
          </Button>
          {recovered && (
            <p className="text-sm">
              Saved report: <strong>{recovered.title}</strong>
            </p>
          )}
          {recovered && recovered.status !== "new" && (
            <>
              <p className="text-sm">
                Staff have already updated this report. Open it to add your
                changes as a comment. Your text below has not been saved.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Open the saved report? Your unsaved text here will be discarded. Cancel to keep or copy it first."
                    )
                  )
                    withUnsavedWorkBypass(() => onCreated(recovered.id));
                }}
              >
                View the saved report
              </Button>
            </>
          )}
        </div>
      )}
      {savedId ? (
        <Button
          type="button"
          onClick={() => withUnsavedWorkBypass(() => onCreated(savedId))}
        >
          View your saved report
        </Button>
      ) : (
        <form
          noValidate
          onSubmit={async e => {
            e.preventDefault();
            if (pending || submitting.current || savedId) return;
            if (recovered && recovered.status !== "new") return;
            setValidationAttempted(true);
            if (!title.trim() || !description.trim()) {
              setFailed(true);
              setMessage(
                !title.trim() && !description.trim()
                  ? "Add a title and description before submitting your report."
                  : !title.trim()
                    ? "Add a title explaining what guidance is missing."
                    : "Add a description explaining what staff need to know."
              );
              return;
            }
            submitting.current = true;
            setBusy(true);
            setFailed(false);
            setMessage("");
            let result: { id: number; version: number };
            try {
              const payload = {
                createToken,
                title: title.trim(),
                description: description.trim(),
                category,
                kind,
                checkedGuidance: checkedGuidance.trim(),
                impact: impact.trim(),
                priority,
                articleId,
              };
              result = recovered
                ? await recoveredUpdate.mutateAsync({
                    ...payload,
                    id: recovered.id,
                    expectedVersion: recovered.version,
                  })
                : await create.mutateAsync(payload);
            } catch (error) {
              if (deny(error)) return;
              if (alive.current) {
                setFailed(true);
                setSaveUncertain(true);
                setMessage(`${errorText(error)} Your report is retained.`);
                setBusy(false);
                submitting.current = false;
              }
              return;
            }
            if (!alive.current) return;
            setSavedId(result.id);
            setSaveUncertain(false);
            setMessage(
              "Your report has been saved. The staff team can now follow it up."
            );
            try {
              await Promise.all([
                utils.staffHandbook.requests.invalidate(undefined, undefined, {
                  throwOnError: true,
                }),
                utils.staffHandbook.overview.invalidate(undefined, undefined, {
                  throwOnError: true,
                }),
              ]);
              if (alive.current)
                withUnsavedWorkBypass(() => onCreated(result.id));
            } catch (error) {
              if (deny(error)) return;
              if (alive.current) {
                setFailed(true);
                setMessage(
                  "Your report was saved, but the page could not refresh. View your saved report; do not submit it again."
                );
              }
            }
            if (alive.current) setBusy(false);
          }}
        >
          <fieldset disabled={pending} className="space-y-3">
            <Field
              label="What guidance is missing?"
              hint="Give it a short title, for example: Which documents do we need for a reimbursement?"
            >
              <input
                required
                maxLength={255}
                aria-invalid={validationAttempted && !title.trim()}
                className={controlClass}
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="The question you could not answer"
              />
            </Field>
            <Field
              label="What do staff need to know?"
              hint="Explain where you got stuck or which instructions need improving. A few sentences are enough."
            >
              <textarea
                required
                maxLength={20000}
                aria-invalid={validationAttempted && !description.trim()}
                rows={3}
                className={controlClass}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="For example: I could not find a checklist of the documents we should ask agents for."
              />
            </Field>
            <Field label="Category" hint="Not sure? Leave this as General.">
              <select
                className={controlClass}
                value={category}
                onChange={e => setCategory(e.target.value)}
              >
                {Array.from(new Set([...categories, category])).map(c => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <details
              className="rounded-md border p-3"
              onToggle={e => setOptional(e.currentTarget.open)}
            >
              <summary className="cursor-pointer text-sm font-medium">
                Optional details
              </summary>
              {optional && (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="How urgent is this?">
                      <select
                        className={controlClass}
                        value={priority}
                        onChange={e =>
                          setPriority(e.target.value as typeof priority)
                        }
                      >
                        {priorities.map(p => (
                          <option key={p} value={p}>
                            {priorityLabels[p]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="What needs improving?">
                      <select
                        className={controlClass}
                        value={kind}
                        onChange={e => setKind(e.target.value as typeof kind)}
                      >
                        {KNOWLEDGE_REQUEST_KINDS.map(k => (
                          <option key={k} value={k}>
                            {KNOWLEDGE_REQUEST_KIND_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="Where have you already looked? (optional)">
                    <textarea
                      maxLength={10000}
                      rows={2}
                      className={controlClass}
                      value={checkedGuidance}
                      onChange={e => setChecked(e.target.value)}
                    />
                  </Field>
                  <Field label="How is this affecting staff? (optional)">
                    <textarea
                      maxLength={10000}
                      rows={2}
                      className={controlClass}
                      value={impact}
                      onChange={e => setImpact(e.target.value)}
                    />
                  </Field>
                  <HandbookLinkPicker
                    type="guides"
                    label="Is this about an existing guide? (optional)"
                    value={articleId}
                    onChange={setArticleId}
                    disabled={pending}
                  />
                </div>
              )}
            </details>
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={
                  pending || (!!recovered && recovered.status !== "new")
                }
              >
                {pending
                  ? "Submitting…"
                  : recovered
                    ? "Save changes to my saved report"
                    : "Submit report"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  if (
                    (!title &&
                      !description &&
                      category === "General" &&
                      kind === "missing_process" &&
                      priority === "normal" &&
                      !checkedGuidance &&
                      !impact &&
                      !articleId) ||
                    window.confirm("Discard this unsaved report?")
                  )
                    withUnsavedWorkBypass(onCancel);
                }}
              >
                Cancel report
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
export function RequestPanel(
  props: React.ComponentProps<typeof RequestPanelContent>
) {
  return (
    <HandbookAccessBoundary key={props.id}>
      <RequestPanelContent {...props} />
    </HandbookAccessBoundary>
  );
}
type ReportDetail = {
  request: RequestDto;
  comments: {
    id: number;
    authorId: number;
    body: string;
    createdAt: Date | string;
  }[];
  audit: Audit[];
};
type ReportProps = {
  id: number;
  categories: string[];
  staff: Staff[];
  onGuide: (id: number, edit?: boolean) => void;
  onReport?: (id: number) => void;
  onClose: () => void;
  onReload: () => void;
};
function RequestPanelContent({ id, ...props }: ReportProps) {
  const query = trpc.staffHandbook.request.useQuery(
    { id },
    { enabled: id > 0, placeholderData: undefined }
  );
  const { blocked } = useHandbookAccessGuard(query.error);
  const loaded = useRef<{ id: number; detail: ReportDetail } | null>(null);
  const fresh =
    !blocked &&
    !query.isError &&
    !query.isLoading &&
    query.data?.request.id === id
      ? (query.data as ReportDetail)
      : null;
  useEffect(() => {
    if (blocked) loaded.current = null;
    else if (fresh) loaded.current = { id, detail: fresh };
  }, [blocked, fresh, id]);
  const detail = blocked
    ? null
    : (fresh ?? (loaded.current?.id === id ? loaded.current.detail : null));
  if (blocked) return <HandbookAccessDenied />;
  if (!detail)
    return (
      <section className={panelClass}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={props.onClose}
        >
          Back to reports
        </Button>
        <QueryState query={query} label="report" />
      </section>
    );
  return (
    <RequestWorkspace
      {...props}
      id={id}
      detail={detail}
      queryFailed={query.isError}
    />
  );
}
function RequestWorkspace({
  id,
  detail,
  queryFailed = false,
  categories,
  staff,
  onGuide,
  onReport,
  onClose,
  onReload,
}: ReportProps & { detail: ReportDetail; queryFailed?: boolean }) {
  const utils = trpc.useUtils();
  const update = trpc.staffHandbook.updateRequest.useMutation();
  const guide = trpc.staffHandbook.createGuideFromRequest.useMutation();
  const comment = trpc.staffHandbook.addComment.useMutation();
  const { blocked, deny } = useHandbookAccessGuard(
    update.error,
    guide.error,
    comment.error
  );
  const [form, setForm] = useState(() => ({
    title: detail.request.title,
    description: detail.request.description,
    category: detail.request.category,
    status: detail.request.status,
    priority: detail.request.priority,
    assigneeId: detail.request.assigneeId,
    articleId: detail.request.articleId,
    duplicateOfId: detail.request.duplicateOfId,
    closureReason: detail.request.closureReason ?? "",
  }));
  const [baseline, setBaseline] = useState(() => JSON.stringify(form));
  const [version, setVersion] = useState(detail.request.version);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [createdGuideId, setCreatedGuideId] = useState<number | null>(null);
  const [linking, setLinking] = useState(false);
  const [managing, setManaging] = useState(false);
  const [duplicate, setDuplicate] = useState(!!detail.request.duplicateOfId);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [createToken] = useState(() => crypto.randomUUID());
  const submitting = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const pending =
    busy || update.isPending || guide.isPending || comment.isPending;
  const dirty = JSON.stringify(form) !== baseline;
  const withUnsavedWorkBypass = useHandbookUnsavedWork(
    !blocked && (pending || dirty || !!body)
  );
  const current = !queryFailed && detail.request.version === version;
  const assignmentRequired =
    ["assigned", "drafting", "in_review"].includes(form.status) &&
    !form.assigneeId;
  const duplicateInvalid =
    !!form.duplicateOfId &&
    (form.status !== "closed" ||
      !form.closureReason.trim() ||
      form.duplicateOfId === id);
  const closedReasonMissing =
    form.status === "closed" && !form.closureReason.trim();
  const answerMissing = form.status === "resolved" && !form.articleId;
  const validation =
    !form.title.trim() || !form.description.trim()
      ? "Add a title and description for the report."
      : assignmentRequired
        ? "Choose who is helping with this report before saving this progress."
        : duplicateInvalid
          ? "Choose another report and explain why this report is being closed."
          : closedReasonMissing
            ? "Add a short note explaining why this report is being closed."
            : answerMissing
              ? "Choose a published guide before marking this report answered."
              : duplicate && form.status === "closed" && !form.duplicateOfId
                ? "Choose the other report to follow, or untick the same-question option."
                : "";
  async function refresh() {
    await Promise.all([
      utils.staffHandbook.request.invalidate(undefined, undefined, {
        throwOnError: true,
      }),
      utils.staffHandbook.requests.invalidate(undefined, undefined, {
        throwOnError: true,
      }),
      utils.staffHandbook.overview.invalidate(undefined, undefined, {
        throwOnError: true,
      }),
      utils.staffHandbook.browse.invalidate(undefined, undefined, {
        throwOnError: true,
      }),
      utils.staffHandbook.article.invalidate(undefined, undefined, {
        throwOnError: true,
      }),
    ]);
  }
  async function perform(
    work: () => Promise<{ id: number; version: number }>,
    success: string,
    savedForm = false,
    savedComment = false
  ) {
    if (pending || submitting.current || !current) return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const result = await work();
      if (!alive.current) return;
      setVersion(result.version);
      if (savedForm) {
        setBaseline(JSON.stringify(form));
        setValidationAttempted(false);
      }
      if (savedComment) setBody("");
      setMessage(success);
    } catch (error) {
      if (deny(error)) return;
      if (alive.current) {
        setFailed(true);
        setMessage(
          `${errorText(error)} Your changes are retained. If someone else updated this report, reload it before trying again.`
        );
        setBusy(false);
        submitting.current = false;
      }
      return;
    }
    try {
      await refresh();
    } catch (error) {
      if (deny(error)) return;
      if (alive.current) {
        setFailed(true);
        setMessage(
          `${success} The page could not refresh, but your change was saved. Reload the report; do not repeat the action.`
        );
      }
    }
    submitting.current = false;
    if (alive.current) setBusy(false);
  }
  function patch<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(previous => ({ ...previous, [key]: value }));
  }
  function close() {
    if (
      !pending &&
      ((!dirty && !body) ||
        window.confirm("Discard unsaved report changes and comment?"))
    )
      withUnsavedWorkBypass(onClose);
  }
  async function createGuide() {
    if (
      pending ||
      submitting.current ||
      dirty ||
      !current ||
      detail.request.articleId ||
      ["closed", "resolved"].includes(detail.request.status)
    )
      return;
    if (
      body &&
      !window.confirm("Discard your unsent comment and start writing a guide?")
    )
      return;
    submitting.current = true;
    setBusy(true);
    setFailed(false);
    setMessage("");
    let result: { articleId: number };
    try {
      result = await guide.mutateAsync({
        id,
        expectedVersion: version,
        createToken,
      });
    } catch (error) {
      if (deny(error)) return;
      if (alive.current) {
        setFailed(true);
        setMessage(`${errorText(error)} Your report has not been cleared.`);
        setBusy(false);
        submitting.current = false;
      }
      return;
    }
    if (!alive.current) return;
    setCreatedGuideId(result.articleId);
    setMessage(
      "Your guide draft is ready to write. This report stays open until the guide is published."
    );
    try {
      await refresh();
      if (alive.current)
        withUnsavedWorkBypass(() => onGuide(result.articleId, true));
    } catch (error) {
      if (deny(error)) return;
      if (alive.current) {
        setFailed(true);
        setMessage(
          "The guide draft was created, but the page could not refresh. Open the saved draft; do not create it again."
        );
      }
    }
    submitting.current = false;
    if (alive.current) setBusy(false);
  }
  async function reload() {
    if (
      pending ||
      submitting.current ||
      ((dirty || body) &&
        !window.confirm(
          "Reload and discard unsaved report changes and comment?"
        ))
    )
      return;
    submitting.current = true;
    setBusy(true);
    try {
      await refresh();
      if (alive.current) withUnsavedWorkBypass(onReload);
    } catch (error) {
      if (deny(error)) return;
      if (alive.current) {
        setFailed(true);
        setMessage(
          `Reload failed. ${errorText(error)} Your edits are retained.`
        );
      }
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function openGuide(guideId: number, edit = false) {
    if (
      (!dirty && !body) ||
      window.confirm("Discard unsaved report changes and open the guide?")
    )
      withUnsavedWorkBypass(() => onGuide(guideId, edit));
  }
  if (blocked) return <HandbookAccessDenied />;
  return (
    <section className={panelClass} data-knowledge-request>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={close}
        >
          Back to reports
        </Button>
        <Badge variant="secondary">
          {KNOWLEDGE_REQUEST_STATUS_LABELS[detail.request.status]}
        </Badge>
      </div>
      <header>
        <h2 className="text-lg font-semibold break-words">
          {detail.request.title}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Reported by {staffName(staff, detail.request.reporterId)} ·{" "}
          {dateLabel(detail.request.createdAt)} · {detail.request.category}
        </p>
      </header>
      <p className="whitespace-pre-wrap text-sm">
        {detail.request.description}
      </p>
      {detail.request.assigneeId && (
        <p className="text-xs text-muted-foreground">
          Helping with this: {staffName(staff, detail.request.assigneeId)}
        </p>
      )}
      {(detail.request.checkedGuidance || detail.request.impact) && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            More about this report
          </summary>
          <dl className="mt-3 space-y-3 text-sm">
            {detail.request.checkedGuidance && (
              <div>
                <dt className="font-medium">Where staff have looked</dt>
                <dd className="whitespace-pre-wrap">
                  {detail.request.checkedGuidance}
                </dd>
              </div>
            )}
            {detail.request.impact && (
              <div>
                <dt className="font-medium">How this affects staff</dt>
                <dd className="whitespace-pre-wrap">{detail.request.impact}</dd>
              </div>
            )}
          </dl>
        </details>
      )}
      {detail.request.closureReason && (
        <p className="rounded-md bg-muted/30 p-3 text-sm">
          <span className="font-medium">Why this was closed: </span>
          {detail.request.closureReason}
        </p>
      )}
      {detail.request.duplicateOfId && (
        <StaffHandbookLinkedItem
          type="reports"
          id={detail.request.duplicateOfId}
          disabled={pending || !onReport}
          onOpen={targetId => {
            if (
              (!dirty && !body) ||
              window.confirm(
                "Discard unsaved report changes and open the other report?"
              )
            )
              withUnsavedWorkBypass(() => onReport?.(targetId));
          }}
        />
      )}
      <Feedback message={message} error={failed} />
      {!current && (
        <div className="space-y-2">
          <Feedback
            error
            message="This report has changed or could not refresh. Your edits have been kept. Reload before making another change."
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void reload()}
          >
            Reload report
          </Button>
        </div>
      )}
      <section className="space-y-2 rounded-lg bg-muted/20 p-3">
        <h3 className="text-sm font-semibold">Help answer this question</h3>
        <div className="flex flex-wrap gap-2">
          {createdGuideId ? (
            <Button
              type="button"
              disabled={pending}
              onClick={() => openGuide(createdGuideId, true)}
            >
              Open saved draft
            </Button>
          ) : detail.request.articleId ? (
            <StaffHandbookLinkedItem
              type="guides"
              id={detail.request.articleId}
              publishedOnly={detail.request.status === "resolved"}
              disabled={pending}
              onOpen={targetId => openGuide(targetId)}
            />
          ) : (
            !["closed", "resolved"].includes(detail.request.status) && (
              <Button
                type="button"
                disabled={pending || dirty || !current}
                onClick={() => void createGuide()}
              >
                Write a guide
              </Button>
            )
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setLinking(previous => !previous)}
          >
            {linking ? "Hide guide linking" : "Link an existing guide"}
          </Button>
        </div>
        {detail.request.status === "resolved" ? (
          <p className="text-xs text-muted-foreground">
            This report was answered. The linked guide above is checked for
            current availability.
          </p>
        ) : detail.request.articleId ? (
          <p className="text-xs text-muted-foreground">
            A guide is linked. If it is still a draft, finish writing and
            publish it so staff can use it.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Write a new guide, or link one that already covers this question. A
            new guide starts as a draft.
          </p>
        )}
        {dirty && (
          <p className="text-xs text-muted-foreground">
            Save your report changes before writing a guide or adding a comment.
          </p>
        )}
      </section>
      <form
        noValidate
        onSubmit={e => {
          e.preventDefault();
          if (pending || submitting.current || !current || !dirty) return;
          setValidationAttempted(true);
          if (validation) return;
          if (
            form.status === "closed" &&
            !window.confirm(
              "Close this report with the note shown? It will remain in the report history."
            )
          )
            return;
          void perform(
            () =>
              update.mutateAsync({
                id,
                expectedVersion: version,
                ...form,
                closureReason:
                  form.status === "closed"
                    ? form.closureReason.trim() || null
                    : null,
              }),
            form.status === "resolved"
              ? "Report answered. The published guide is linked."
              : form.status === "closed"
                ? "Report closed. Your note is saved."
                : "Report changes saved.",
            true
          );
        }}
      >
        <fieldset disabled={pending} className="space-y-3">
          {linking && (
            <section className="space-y-3 rounded-lg border p-3">
              <HandbookLinkPicker
                type="guides"
                label={
                  form.status === "resolved"
                    ? "Guide that answers this question"
                    : "Guide to link"
                }
                value={form.articleId}
                onChange={selectedId => patch("articleId", selectedId)}
                disabled={pending}
                publishedOnly={form.status === "resolved"}
              />
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={form.status === "resolved"}
                  onChange={e => {
                    setForm(previous => ({
                      ...previous,
                      status: e.target.checked ? "resolved" : "new",
                      duplicateOfId: null,
                      closureReason: "",
                    }));
                    setDuplicate(false);
                  }}
                />
                Mark this report answered by a published guide
              </label>
              <p className="text-xs text-muted-foreground">
                Only a published guide can answer a report. Linking a draft
                leaves it open.
              </p>
            </section>
          )}
          <details
            className="rounded-md border p-3"
            onToggle={e => setManaging(e.currentTarget.open)}
          >
            <summary className="cursor-pointer text-sm font-medium">
              Update progress or edit this report
            </summary>
            {managing && (
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Progress">
                    <select
                      className={controlClass}
                      value={form.status}
                      onChange={e => {
                        const status = e.target.value as KnowledgeRequestStatus;
                        setForm(previous => ({
                          ...previous,
                          status,
                          duplicateOfId:
                            status === "closed" ? previous.duplicateOfId : null,
                          closureReason:
                            status === "closed" ? previous.closureReason : "",
                        }));
                        if (status !== "closed") setDuplicate(false);
                        if (status === "resolved") setLinking(true);
                      }}
                    >
                      {KNOWLEDGE_REQUEST_STATUSES.map(s => (
                        <option key={s} value={s}>
                          {KNOWLEDGE_REQUEST_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Who's helping?"
                    hint="Optional for a new report. Choose someone when work is underway."
                  >
                    <select
                      className={controlClass}
                      value={form.assigneeId ?? ""}
                      onChange={e =>
                        patch(
                          "assigneeId",
                          e.target.value ? Number(e.target.value) : null
                        )
                      }
                    >
                      <option value="">Nobody yet</option>
                      {staff.map(person => (
                        <option key={person.id} value={person.id}>
                          {person.name || "JLT staff member"}
                        </option>
                      ))}
                      {form.assigneeId &&
                        !staff.some(p => p.id === form.assigneeId) && (
                          <option value={form.assigneeId}>
                            Previously assigned staff member
                          </option>
                        )}
                    </select>
                  </Field>
                  <Field label="How urgent is this?">
                    <select
                      className={controlClass}
                      value={form.priority}
                      onChange={e =>
                        patch(
                          "priority",
                          e.target.value as typeof form.priority
                        )
                      }
                    >
                      {priorities.map(p => (
                        <option key={p} value={p}>
                          {priorityLabels[p]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Category">
                    <select
                      className={controlClass}
                      value={form.category}
                      onChange={e => patch("category", e.target.value)}
                    >
                      {Array.from(new Set([...categories, form.category])).map(
                        c => (
                          <option key={c}>{c}</option>
                        )
                      )}
                    </select>
                  </Field>
                </div>
                <Field label="What guidance is missing?">
                  <input
                    required
                    maxLength={255}
                    className={controlClass}
                    value={form.title}
                    onChange={e => patch("title", e.target.value)}
                  />
                </Field>
                <Field label="What do staff need to know?">
                  <textarea
                    required
                    maxLength={20000}
                    rows={3}
                    className={controlClass}
                    value={form.description}
                    onChange={e => patch("description", e.target.value)}
                  />
                </Field>
              </div>
            )}
          </details>
          {form.status === "closed" && (managing || dirty) && (
            <section className="space-y-3 rounded-md border p-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={duplicate}
                  onChange={e => {
                    setDuplicate(e.target.checked);
                    if (!e.target.checked) patch("duplicateOfId", null);
                  }}
                />
                The same question is already in another report
              </label>
              {duplicate && (
                <HandbookLinkPicker
                  type="reports"
                  label="Report to follow instead"
                  value={form.duplicateOfId}
                  excludeId={id}
                  disabled={pending}
                  onChange={selectedId =>
                    setForm(previous => ({
                      ...previous,
                      duplicateOfId: selectedId,
                      closureReason:
                        previous.closureReason ||
                        (selectedId
                          ? "The same question is being followed up in the linked report."
                          : ""),
                    }))
                  }
                />
              )}
              <Field
                label="Why are you closing this report?"
                hint="For example: already reported, no longer needed, or covered elsewhere."
              >
                <textarea
                  required
                  maxLength={10000}
                  rows={2}
                  className={controlClass}
                  value={form.closureReason}
                  onChange={e => patch("closureReason", e.target.value)}
                />
              </Field>
            </section>
          )}
          {validationAttempted && validation && (
            <Feedback error message={validation} />
          )}
          {dirty && (
            <div className="space-y-2">
              <Button type="submit" disabled={pending || !current}>
                {pending ? "Saving…" : "Save report changes"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Your changes have not been saved yet.
              </p>
            </div>
          )}
        </fieldset>
      </form>
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-semibold">Comments</h3>
        <ol className="max-h-64 space-y-3 overflow-y-auto text-sm">
          {detail.comments.length ? (
            detail.comments.map(c => (
              <li key={c.id} className="rounded-md bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">
                  {staffName(staff, c.authorId)} · {dateLabel(c.createdAt)}
                </p>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            ))
          ) : (
            <li className="text-sm text-muted-foreground">
              No updates yet. Add anything that could help someone write the
              guide.
            </li>
          )}
        </ol>
        <form
          onSubmit={e => {
            e.preventDefault();
            if (!pending && !dirty && current && body.trim())
              void perform(
                () =>
                  comment.mutateAsync({
                    id,
                    expectedVersion: version,
                    body: body.trim(),
                  }),
                "Comment added. Staff only.",
                false,
                true
              );
          }}
        >
          <Field
            label="Add a comment"
            hint="Seen by JLT staff only. Do not include customer details, payment data or passwords."
          >
            <textarea
              required
              maxLength={10000}
              rows={2}
              className={controlClass}
              disabled={pending}
              value={body}
              onChange={e => setBody(e.target.value)}
            />
          </Field>
          <Button
            className="mt-2"
            type="submit"
            size="sm"
            disabled={pending || dirty || !current || !body.trim()}
          >
            Add comment
          </Button>
        </form>
      </section>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          History and refresh
        </summary>
        <div className="mt-3 space-y-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void reload()}
          >
            Reload report
          </Button>
          <History audit={detail.audit} staff={staff} />
        </div>
      </details>
    </section>
  );
}
