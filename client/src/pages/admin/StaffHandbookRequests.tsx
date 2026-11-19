import React, { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
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
const priorities = ["low", "normal", "high"] as const;

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
  const { blocked, deny } = useHandbookAccessGuard(create.error);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("General");
  const [kind, setKind] =
    useState<(typeof KNOWLEDGE_REQUEST_KINDS)[number]>("missing_process");
  const [checkedGuidance, setChecked] = useState("");
  const [impact, setImpact] = useState("");
  const [priority, setPriority] =
    useState<(typeof priorities)[number]>("normal");
  const [articleId, setArticleId] = useState("");
  const [createToken] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const submitting = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const pending = busy || create.isPending;
  if (blocked) return <HandbookAccessDenied />;
  return (
    <section className={panelClass}>
      <h2 className="text-lg font-semibold">Report missing knowledge</h2>
      <p className="text-sm text-muted-foreground">
        Tell the staff team what guidance is missing, unclear or outdated. Your
        reporter update is handled internally, not sent to agents. No customer
        details, payment data or credentials.
      </p>
      <Feedback message={message} error={failed} />
      {savedId ? (
        <Button type="button" onClick={() => onCreated(savedId)}>
          Open saved request #{savedId}
        </Button>
      ) : (
        <form
          noValidate
          onSubmit={async e => {
            e.preventDefault();
            if (pending || submitting.current || savedId) return;
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
              result = await create.mutateAsync({
                createToken,
                title: title.trim(),
                description: description.trim(),
                category,
                kind,
                checkedGuidance: checkedGuidance.trim(),
                impact: impact.trim(),
                priority,
                articleId: articleId ? Number(articleId) : null,
              });
            } catch (error) {
              if (deny(error)) return;
              if (alive.current) {
                setFailed(true);
                setMessage(`${errorText(error)} Your report is retained.`);
                setBusy(false);
                submitting.current = false;
              }
              return;
            }
            if (!alive.current) return;
            setSavedId(result.id);
            setMessage(`Request #${result.id} reported internally.`);
            try {
              await Promise.all([
                utils.staffHandbook.requests.invalidate(undefined, undefined, {
                  throwOnError: true,
                }),
                utils.staffHandbook.overview.invalidate(undefined, undefined, {
                  throwOnError: true,
                }),
              ]);
              if (alive.current) onCreated(result.id);
            } catch (error) {
              if (deny(error)) return;
              if (alive.current) {
                setFailed(true);
                setMessage(
                  `Request #${result.id} was saved, but refresh failed. Open the saved request; do not submit it again.`
                );
              }
            }
            if (alive.current) setBusy(false);
          }}
        >
          <fieldset disabled={pending} className="space-y-3">
            <Field label="What guidance is missing?">
              <input
                required
                maxLength={255}
                aria-invalid={validationAttempted && !title.trim()}
                className={controlClass}
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </Field>
            <Field label="What do staff need to know?">
              <textarea
                required
                maxLength={20000}
                aria-invalid={validationAttempted && !description.trim()}
                rows={3}
                className={controlClass}
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </Field>
            <Field label="Category">
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
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Optional details
              </summary>
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Priority">
                    <select
                      className={controlClass}
                      value={priority}
                      onChange={e =>
                        setPriority(e.target.value as typeof priority)
                      }
                    >
                      {priorities.map(p => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Request kind">
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
                <Field
                  label="Guidance already checked"
                  hint="List what you searched, or explain that no relevant guidance exists."
                >
                  <textarea
                    maxLength={10000}
                    rows={2}
                    className={controlClass}
                    value={checkedGuidance}
                    onChange={e => setChecked(e.target.value)}
                  />
                </Field>
                <Field label="Impact on staff or service">
                  <textarea
                    maxLength={10000}
                    rows={2}
                    className={controlClass}
                    value={impact}
                    onChange={e => setImpact(e.target.value)}
                  />
                </Field>
                <Field label="Related guide ID (optional)">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className={controlClass}
                    value={articleId}
                    onChange={e => setArticleId(e.target.value)}
                  />
                </Field>
              </div>
            </details>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Reporting…" : "Submit knowledge request"}
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
                    onCancel();
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
function RequestPanelContent({
  id,
  categories,
  staff,
  onGuide,
  onClose,
  onReload,
}: {
  id: number;
  categories: string[];
  staff: Staff[];
  onGuide: (id: number) => void;
  onClose: () => void;
  onReload: () => void;
}) {
  const query = trpc.staffHandbook.request.useQuery(
    { id },
    { enabled: id > 0, placeholderData: undefined }
  );
  const { blocked } = useHandbookAccessGuard(query.error);
  const loaded = useRef<{
    id: number;
    detail: {
      request: RequestDto;
      comments: {
        id: number;
        authorId: number;
        body: string;
        createdAt: Date | string;
      }[];
      audit: Audit[];
    };
  } | null>(null);
  const fresh =
    !blocked &&
    !query.isError &&
    !query.isLoading &&
    query.data?.request.id === id
      ? (query.data as NonNullable<typeof loaded.current>["detail"])
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
        <Button size="sm" variant="outline" onClick={onClose}>
          Back to requests
        </Button>
        <QueryState query={query} label="request" />
      </section>
    );
  return (
    <RequestWorkspace
      id={id}
      detail={detail}
      queryFailed={query.isError}
      categories={categories}
      staff={staff}
      onGuide={onGuide}
      onClose={onClose}
      onReload={onReload}
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
  onClose,
  onReload,
}: {
  id: number;
  queryFailed?: boolean;
  detail: {
    request: RequestDto;
    comments: {
      id: number;
      authorId: number;
      body: string;
      createdAt: Date | string;
    }[];
    audit: Audit[];
  };
  categories: string[];
  staff: Staff[];
  onGuide: (id: number) => void;
  onClose: () => void;
  onReload: () => void;
}) {
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
  const [createToken] = useState(() => crypto.randomUUID());
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
  const current = !queryFailed && detail.request.version === version;
  const terminal = form.status === "closed" || form.status === "resolved";
  const assignmentRequired =
    ["assigned", "drafting", "in_review"].includes(form.status) &&
    !form.assigneeId;
  const duplicateInvalid =
    !!form.duplicateOfId &&
    (form.status !== "closed" ||
      !form.closureReason.trim() ||
      form.duplicateOfId === id);
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
    if (pending || !current) return;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const result = await work();
      if (!alive.current) return;
      setVersion(result.version);
      if (savedForm) setBaseline(JSON.stringify(form));
      if (savedComment) setBody("");
      setMessage(success);
    } catch (error) {
      if (deny(error)) return;
      if (alive.current) {
        setFailed(true);
        setMessage(
          `${errorText(error)} Your changes are retained. Reload explicitly if another staff member has changed the request.`
        );
        setBusy(false);
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
          `${success} Refresh failed, but the action was saved. Reload; do not repeat the action.`
        );
      }
    }
    if (alive.current) setBusy(false);
  }
  function patch<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(previous => ({ ...previous, [key]: value }));
  }
  const close = () => {
    if (
      !pending &&
      ((!dirty && !body) ||
        window.confirm("Discard unsaved request edits and comment?"))
    )
      onClose();
  };
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
          Back to requests
        </Button>
        <span className="text-xs text-muted-foreground">
          Request #{id} · Version {version}
        </span>
      </div>
      <h2 className="text-lg font-semibold break-words">
        {detail.request.title}
      </h2>
      <p className="text-xs text-muted-foreground">
        Reported by staff #{detail.request.reporterId} ·{" "}
        {dateLabel(detail.request.createdAt)} ·{" "}
        {KNOWLEDGE_REQUEST_KIND_LABELS[detail.request.kind]}
      </p>
      <p className="whitespace-pre-wrap text-sm">
        {detail.request.description}
      </p>
      <dl className="space-y-2 rounded-md bg-muted/40 p-3 text-sm">
        <div>
          <dt className="font-medium">Guidance checked</dt>
          <dd className="whitespace-pre-wrap">
            {detail.request.checkedGuidance || "Not provided"}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Impact</dt>
          <dd className="whitespace-pre-wrap">
            {detail.request.impact || "Not provided"}
          </dd>
        </div>
      </dl>
      <Feedback message={message} error={failed} />
      {!current && (
        <Feedback
          error
          message="This request changed, or refresh is still pending. Inputs have not been overwritten. Reload before another action."
        />
      )}
      <form
        onSubmit={e => {
          e.preventDefault();
          if (
            pending ||
            !current ||
            assignmentRequired ||
            duplicateInvalid ||
            !form.title.trim() ||
            !form.description.trim() ||
            (terminal && !form.closureReason.trim()) ||
            (form.status === "resolved" && !form.articleId) ||
            form.duplicateOfId === id
          )
            return;
          if (
            terminal &&
            !window.confirm(
              "Save this final request status? The reporter update will be handled internally. Resolving requires a currently published guide; closing requires a reason."
            )
          )
            return;
          void perform(
            () =>
              update.mutateAsync({
                id,
                expectedVersion: version,
                ...form,
                closureReason: form.closureReason.trim() || null,
              }),
            "Request updated internally.",
            true
          );
        }}
      >
        <fieldset disabled={pending} className="space-y-3">
          <legend className="mb-3 text-sm font-semibold">
            Assignment & resolution — explicit save
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Request status">
              <select
                className={controlClass}
                value={form.status}
                onChange={e =>
                  patch("status", e.target.value as KnowledgeRequestStatus)
                }
              >
                {KNOWLEDGE_REQUEST_STATUSES.map(s => (
                  <option key={s} value={s}>
                    {KNOWLEDGE_REQUEST_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Request priority">
              <select
                className={controlClass}
                value={form.priority}
                onChange={e =>
                  patch("priority", e.target.value as typeof form.priority)
                }
              >
                {priorities.map(p => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
            <Field label="Assign to staff">
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
                <option value="">Unassigned</option>
                {staff.map(person => (
                  <option key={person.id} value={person.id}>
                    {person.name || `Staff #${person.id}`}
                  </option>
                ))}
                {form.assigneeId &&
                  !staff.some(p => p.id === form.assigneeId) && (
                    <option value={form.assigneeId}>
                      Staff #{form.assigneeId}
                    </option>
                  )}
              </select>
            </Field>
            <Field
              label="Published guide ID"
              hint="Required for resolution; the server verifies current publication. A draft does not resolve knowledge."
            >
              <input
                className={controlClass}
                type="number"
                min={1}
                step={1}
                required={form.status === "resolved"}
                value={form.articleId ?? ""}
                onChange={e =>
                  patch(
                    "articleId",
                    e.target.value ? Number(e.target.value) : null
                  )
                }
              />
            </Field>
            <Field label="Duplicate of request ID (optional)">
              <input
                className={controlClass}
                type="number"
                min={1}
                step={1}
                value={form.duplicateOfId ?? ""}
                onChange={e =>
                  patch(
                    "duplicateOfId",
                    e.target.value ? Number(e.target.value) : null
                  )
                }
              />
            </Field>
            <Field label="Request category">
              <select
                className={controlClass}
                value={form.category}
                onChange={e => patch("category", e.target.value)}
              >
                {Array.from(new Set([...categories, form.category])).map(c => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label="Closure / resolution reason"
            hint="Required when resolving or closing, including duplicate closures."
          >
            <textarea
              rows={2}
              required={terminal}
              className={controlClass}
              value={form.closureReason}
              onChange={e => patch("closureReason", e.target.value)}
            />
          </Field>
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Edit request wording
            </summary>
            <div className="mt-3 space-y-3">
              <Field label="Edit request title">
                <input
                  required
                  maxLength={255}
                  className={controlClass}
                  value={form.title}
                  onChange={e => patch("title", e.target.value)}
                />
              </Field>
              <Field label="Edit request description">
                <textarea
                  required
                  rows={3}
                  className={controlClass}
                  value={form.description}
                  onChange={e => patch("description", e.target.value)}
                />
              </Field>
            </div>
          </details>
          {assignmentRequired && (
            <Feedback
              error
              message="Assign an active staff member for Assigned, Drafting or In review status."
            />
          )}
          {duplicateInvalid && (
            <Feedback
              error
              message="Duplicate requests must be closed with a reason and cannot refer to themselves."
            />
          )}
          {form.duplicateOfId === id && (
            <Feedback error message="A request cannot duplicate itself." />
          )}
          <Button
            type="submit"
            disabled={
              pending ||
              !current ||
              !dirty ||
              assignmentRequired ||
              duplicateInvalid ||
              (terminal && !form.closureReason.trim()) ||
              (form.status === "resolved" && !form.articleId) ||
              form.duplicateOfId === id
            }
          >
            Save request changes
          </Button>
        </fieldset>
      </form>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={async () => {
            if (
              (dirty || body) &&
              !window.confirm(
                "Reload and discard unsaved request edits and comment?"
              )
            )
              return;
            try {
              await refresh();
              if (alive.current) onReload();
            } catch (error) {
              if (deny(error)) return;
              setFailed(true);
              setMessage(
                `Reload failed. ${errorText(error)} Your edits are retained.`
              );
            }
          }}
        >
          Reload request
        </Button>
        {detail.request.articleId && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (
                (!dirty && !body) ||
                window.confirm(
                  "Discard unsaved request edits and open the linked guide?"
                )
              )
                onGuide(detail.request.articleId!);
            }}
          >
            Open linked guide #{detail.request.articleId}
          </Button>
        )}
        {createdGuideId ? (
          <Button type="button" onClick={() => onGuide(createdGuideId)}>
            Open created draft #{createdGuideId}
          </Button>
        ) : (
          <Button
            type="button"
            disabled={
              pending ||
              dirty ||
              !current ||
              !!detail.request.articleId ||
              detail.request.status === "closed" ||
              detail.request.status === "resolved"
            }
            onClick={async () => {
              if (pending || dirty || !current) return;
              if (
                !window.confirm(
                  "Create a staff-only guide draft from this request? This does not publish or resolve the request."
                )
              )
                return;
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
                  setMessage(errorText(error));
                  setBusy(false);
                }
                return;
              }
              if (!alive.current) return;
              setCreatedGuideId(result.articleId);
              setMessage(
                "Guide draft created. It is not published and the request is not resolved."
              );
              try {
                await refresh();
                if (alive.current) onGuide(result.articleId);
              } catch (error) {
                if (deny(error)) return;
                if (alive.current) {
                  setFailed(true);
                  setMessage(
                    `Guide draft #${result.articleId} was created, but refresh failed. Open the saved draft; do not create it again.`
                  );
                }
              }
              if (alive.current) setBusy(false);
            }}
          >
            Create guide from request
          </Button>
        )}
      </div>
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-semibold">Internal comments</h3>
        <ol className="max-h-64 overflow-y-auto space-y-3 text-sm">
          {detail.comments.length ? (
            detail.comments.map(c => (
              <li key={c.id} className="rounded-md bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">
                  Staff #{c.authorId} · {dateLabel(c.createdAt)}
                </p>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            ))
          ) : (
            <li className="text-muted-foreground">No comments yet.</li>
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
                "Internal comment added.",
                false,
                true
              );
          }}
        >
          <Field label="Add internal comment">
            <textarea
              required
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
          {dirty && (
            <p className="mt-1 text-xs text-muted-foreground">
              Save request edits before commenting or creating a guide.
            </p>
          )}
        </form>
      </section>
      <History audit={detail.audit} />
    </section>
  );
}
