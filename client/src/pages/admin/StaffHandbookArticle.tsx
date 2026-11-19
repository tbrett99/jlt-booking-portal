import React, { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { RichEmailEditor } from "@/components/RichEmailEditor";
import {
  emptyHandbookContent,
  STAFF_HANDBOOK_SENSITIVITIES,
  type HandbookContent,
} from "@shared/staff-handbook";
import {
  controlClass,
  panelClass,
  Field,
  Feedback,
  GuideReading,
  History,
  QueryState,
  dateInput,
  dateLabel,
  errorText,
  sectionLabels,
  safeHandbookHtml,
  type ArticleDetail,
  type Staff,
  type Resource,
  HandbookAccessBoundary,
  HandbookAccessDenied,
  useHandbookAccessGuard,
} from "./StaffHandbookComponents";

const attachmentTypes: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};
function token() {
  return crypto.randomUUID();
}
function cloneContent(content: HandbookContent): HandbookContent {
  return {
    ...content,
    tags: [...content.tags],
    sections: { ...content.sections },
  };
}
// Only fixed outcome text is carried across the parent's new-guide remount;
// private content is never retained outside the access-bound workspace.
const savedFeedback = new Map<string, { version: number; message: string }>();
function AttachmentEditor({
  resources,
  disabled,
  onUpload,
  onRemove,
}: {
  resources: Resource[];
  disabled: boolean;
  onUpload: (file: File) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Private attachments ({resources.length})
      </summary>
      <p className="my-3 text-xs text-muted-foreground">
        Save the draft before uploading. PDF, DOCX, XLSX, TXT, CSV, PNG or JPG
        only. Screenshots are private attachments, never inline remote images.
        Do not upload customer details, payment data, passwords or credentials.
      </p>
      <Field label="Upload private attachment">
        <input
          className={controlClass}
          disabled={disabled}
          type="file"
          accept=".pdf,.docx,.xlsx,.txt,.csv,.png,.jpg,.jpeg"
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onUpload(file);
          }}
        />
      </Field>
      <ul className="mt-3 space-y-2">
        {resources.map(r => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span className="break-all">{r.fileName}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => onRemove(r.id)}
            >
              Remove {r.fileName}
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
function PrivateEditor({
  value,
  onChange,
  label,
  disabled,
  resources,
  onBlocked,
}: {
  value: string;
  onChange: (html: string) => void;
  label: string;
  disabled: boolean;
  resources: Resource[];
  onBlocked: () => void;
}) {
  // restrictedAcademy hides remote-image/CRM/embed tools. Also reject pasted or
  // dropped image HTML before TipTap's Image extension can mount a remote URL.
  const blockImages = (e: React.ClipboardEvent | React.DragEvent) => {
    const transfer = "clipboardData" in e ? e.clipboardData : e.dataTransfer;
    if (
      transfer.files.length ||
      /<(?:img|iframe|video|object|embed|svg)\b/i.test(
        transfer.getData("text/html")
      )
    ) {
      e.preventDefault();
      e.stopPropagation();
      onBlocked();
    }
  };
  return (
    <div onPasteCapture={blockImages} onDropCapture={blockImages}>
      <RichEmailEditor
        internalHandbook
        restrictedAcademy
        preserveClipboardFormatting
        disabled={disabled}
        ariaLabel={label}
        value={safeHandbookHtml(value, resources)}
        onChange={html => onChange(safeHandbookHtml(html, resources))}
        className="[&_.prose]:min-h-[160px] [&_.ProseMirror]:min-h-[140px]"
      />
    </div>
  );
}

export function ArticlePanel(props: ArticlePanelProps) {
  return (
    <HandbookAccessBoundary key={`${props.userId}:${props.id}`}>
      <ArticlePanelContent {...props} />
    </HandbookAccessBoundary>
  );
}
type ArticlePanelProps = {
  id: number | "new";
  userId: number;
  categories: string[];
  staff: Staff[];
  startEditing?: boolean;
  onSaved: (id: number) => void;
  onClose: () => void;
};
function ArticlePanelContent({
  id,
  userId,
  categories,
  staff,
  startEditing = false,
  onSaved,
  onClose,
}: ArticlePanelProps) {
  const query = trpc.staffHandbook.article.useQuery(
    { id: typeof id === "number" ? id : 0 },
    { enabled: typeof id === "number", placeholderData: undefined }
  );
  const { blocked } = useHandbookAccessGuard(query.error);
  const loaded = useRef<{ id: number; detail: ArticleDetail } | null>(null);
  const fresh =
    !blocked &&
    !query.isError &&
    !query.isLoading &&
    query.data?.article.id === id
      ? (query.data as ArticleDetail)
      : null;
  useEffect(() => {
    if (blocked) loaded.current = null;
    else if (fresh && typeof id === "number")
      loaded.current = { id, detail: fresh };
  }, [blocked, fresh, id]);
  const detail = blocked
    ? null
    : (fresh ??
      (typeof id === "number" && loaded.current?.id === id
        ? loaded.current.detail
        : null));
  if (blocked) return <HandbookAccessDenied />;
  if (id === "new")
    return (
      <ArticleWorkspace
        key="new"
        id={id}
        detail={null}
        userId={userId}
        categories={categories}
        staff={staff}
        startEditing
        onSaved={onSaved}
        onClose={onClose}
      />
    );
  if (!detail)
    return (
      <section className={panelClass}>
        <Button size="sm" variant="outline" onClick={onClose}>
          Back to guides
        </Button>
        <QueryState query={query} label="guide" />
      </section>
    );
  return (
    <>
      <Feedback
        error={query.isError}
        message={
          query.isError
            ? "Guide refresh failed. Previously loaded content and your edits are retained; reload before further actions."
            : ""
        }
      />
      <ArticleWorkspace
        key={id}
        id={id}
        detail={detail}
        queryFailed={query.isError}
        userId={userId}
        categories={categories}
        staff={staff}
        startEditing={startEditing}
        onSaved={onSaved}
        onClose={onClose}
      />
    </>
  );
}
function ArticleWorkspace({
  id,
  detail,
  queryFailed = false,
  userId,
  categories,
  staff,
  startEditing,
  onSaved,
  onClose,
}: {
  id: number | "new";
  detail: ArticleDetail | null;
  queryFailed?: boolean;
  userId: number;
  categories: string[];
  staff: Staff[];
  startEditing: boolean;
  onSaved: (id: number) => void;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [content, setContent] = useState<HandbookContent>(() =>
    cloneContent(
      detail?.draft?.content ??
        detail?.published?.content ?? {
          ...emptyHandbookContent(userId),
          format: "article",
        }
    )
  );
  const [baseline, setBaseline] = useState(() => JSON.stringify(content));
  const [version, setVersion] = useState(detail?.article.version ?? 0);
  const [editing, setEditing] = useState(startEditing || !detail?.published);
  const [readingDraft, setReadingDraft] = useState(false);
  const [changeSummary, setChangeSummary] = useState("");
  const [tags, setTags] = useState(content.tags.join(", "));
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [titleError, setTitleError] = useState("");
  const [verificationFailed, setVerificationFailed] = useState(false);
  const [createToken] = useState(token);
  const [savedNewId, setSavedNewId] = useState<number | null>(null);
  const inFlight = useRef(false);
  const savedReceipt = useRef<{
    id: number;
    version: number;
    message: string;
  } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (typeof id !== "number" || !detail) return;
    const key = `${userId}:${id}`;
    const receipt = savedFeedback.get(key);
    if (receipt) {
      savedFeedback.delete(key);
      if (receipt.version === detail.article.version)
        setMessage(receipt.message);
    }
  }, [id, userId, detail]);
  const save = trpc.staffHandbook.saveArticle.useMutation();
  const saveAndPublish = trpc.staffHandbook.saveAndPublishArticle.useMutation();
  const action = trpc.staffHandbook.articleAction.useMutation();
  const upload = trpc.staffHandbook.uploadResource.useMutation();
  const remove = trpc.staffHandbook.removeResource.useMutation();
  const { blocked, deny } = useHandbookAccessGuard(
    save.error,
    saveAndPublish.error,
    action.error,
    upload.error,
    remove.error
  );
  const pending =
    busy ||
    save.isPending ||
    saveAndPublish.isPending ||
    action.isPending ||
    upload.isPending ||
    remove.isPending;
  const dirty = JSON.stringify(content) !== baseline || !!changeSummary.trim();
  const archived = !!detail?.article.archivedAt;
  const current =
    !queryFailed &&
    !verificationFailed &&
    !!detail &&
    detail.article.version === version;
  const draft = detail?.draft;
  const contributor =
    !!draft &&
    (draft.contributorIds.includes(userId) || draft.createdById === userId);
  const needsIndependentReview =
    content.sensitivity !== "operational" ||
    detail?.article.requiresIndependentReview === true ||
    (!!draft && draft.content.sensitivity !== "operational") ||
    (!!detail?.published &&
      detail.published.content.sensitivity !== "operational");
  const needsReview = !!draft && needsIndependentReview;
  const hasBody =
    !!draft &&
    !!(draft.content.format === "article"
      ? safeHandbookHtml(draft.content.contentHtml)
          .replace(/<[^>]*>/g, "")
          .trim()
      : safeHandbookHtml(draft.content.sections.steps)
          .replace(/<[^>]*>/g, "")
          .trim());
  const exactReview =
    !!draft &&
    detail?.article.reviewedRevisionId === draft.id &&
    !!detail.article.reviewedById &&
    !draft.contributorIds.includes(detail.article.reviewedById) &&
    detail.article.reviewedById !== draft.createdById;
  const canAct = typeof id === "number" && !dirty && !pending && current;
  const canApprove =
    canAct &&
    !archived &&
    hasBody &&
    !!draft &&
    !!detail?.article.submittedAt &&
    !contributor &&
    detail?.article.reviewedRevisionId !== draft.id;
  const canPublish =
    canAct &&
    !archived &&
    hasBody &&
    !!draft &&
    draft.id !== detail?.published?.id &&
    (!needsReview || exactReview);
  async function refresh(articleId: number, expectedVersion?: number) {
    // Fetch only the requested guide, without refetching unrelated details.
    // staleTime: 0 forces an authenticated server read, rather than accepting cache.
    const refreshed = await utils.staffHandbook.article.fetch(
      { id: articleId },
      { staleTime: 0 }
    );
    if (
      refreshed.article.id !== articleId ||
      (expectedVersion !== undefined &&
        refreshed.article.version !== expectedVersion)
    )
      throw new Error(
        "The saved guide's exact version could not be verified. Another staff member may have changed it."
      );
    return refreshed;
  }
  async function refreshLists() {
    const results = await Promise.allSettled([
      utils.staffHandbook.browse.invalidate(undefined, undefined, {
        throwOnError: true,
      }),
      utils.staffHandbook.overview.invalidate(undefined, undefined, {
        throwOnError: true,
      }),
      utils.staffHandbook.requests.invalidate(undefined, undefined, {
        throwOnError: true,
      }),
      utils.staffHandbook.request.invalidate(undefined, undefined, {
        throwOnError: true,
      }),
    ]);
    for (const result of results) {
      if (result.status === "rejected" && deny(result.reason))
        throw result.reason;
    }
    return results.every(result => result.status === "fulfilled");
  }
  function openVerifiedSave(receipt: {
    id: number;
    version: number;
    message: string;
  }) {
    savedFeedback.set(`${userId}:${receipt.id}`, {
      version: receipt.version,
      message: receipt.message,
    });
    onSaved(receipt.id);
  }
  async function retrySavedGuide() {
    const receipt = savedReceipt.current;
    if (!receipt || pending || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await refresh(receipt.id, receipt.version);
      if (alive.current) openVerifiedSave(receipt);
    } catch (error) {
      if (deny(error)) return;
      if (alive.current) {
        setFailed(true);
        setMessage(
          `${receipt.message} Refresh failed. ${errorText(error)} Retry Open saved guide; do not create another guide.`
        );
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function mutate(
    work: () => Promise<{ id: number; version: number }>,
    success: string,
    savedContent?: HandbookContent
  ) {
    if (
      pending ||
      inFlight.current ||
      savedNewId ||
      (id === "new" && savedReceipt.current)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    let result: { id: number; version: number };
    try {
      result = await work();
    } catch (error) {
      inFlight.current = false;
      if (deny(error)) return;
      if (alive.current) {
        setMessage(
          `${errorText(error)} Your unsaved edits are retained. If another staff member changed this guide, reload it explicitly before retrying.`
        );
        setFailed(true);
        setBusy(false);
      }
      return;
    }
    if (!alive.current) {
      inFlight.current = false;
      return;
    }
    setVerificationFailed(true);
    setVersion(result.version);
    if (savedContent) {
      setBaseline(JSON.stringify(savedContent));
      setChangeSummary("");
    }
    setMessage(success);
    const receipt = { ...result, message: success };
    if (id === "new") {
      savedReceipt.current = receipt;
      setSavedNewId(result.id);
    }
    let verified = false;
    try {
      await refresh(result.id, result.version);
      if (alive.current) setVerificationFailed(false);
      verified = true;
      const listsFresh = await refreshLists();
      if (alive.current && !listsFresh) {
        receipt.message = `${success} Guide verified; some lists could not refresh. Refresh the guide list when available.`;
        setMessage(receipt.message);
      }
    } catch (error) {
      if (deny(error)) return;
      if (alive.current) {
        setMessage(
          `${success} Refresh failed; the action was saved as guide #${result.id}. ${id === "new" ? "Use Open saved guide to retry." : "Reload the latest guide before further actions."} Do not repeat the action.`
        );
        setFailed(true);
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
    if (alive.current && id === "new" && verified) openVerifiedSave(receipt);
  }
  async function submitGuide(workflow: "draft" | "publish") {
    if (
      pending ||
      inFlight.current ||
      savedNewId ||
      archived ||
      (id !== "new" && !current)
    )
      return;
    if (!content.title.trim()) {
      setTitleError("Enter a title before saving your guide.");
      return;
    }
    setTitleError("");
    if (workflow === "publish") {
      if (needsIndependentReview) return;
      const body =
        content.format === "article"
          ? content.contentHtml
          : content.sections.steps;
      if (
        !safeHandbookHtml(body)
          .replace(/<[^>]*>/g, "")
          .trim()
      ) {
        setFailed(true);
        setMessage(
          "Add content before publishing. You can still save an empty draft."
        );
        return;
      }
    }
    const saved = cloneContent(content);
    const input = {
      ...(id === "new" ? { createToken } : { id, expectedVersion: version }),
      content: saved,
      changeSummary:
        changeSummary.trim() ||
        (id === "new" ? "Guide created" : "Guide updated"),
    };
    await mutate(
      () =>
        workflow === "publish"
          ? saveAndPublish.mutateAsync(input)
          : save.mutateAsync(input),
      workflow === "publish"
        ? "Guide saved and published internally. Staff only; no agent access."
        : "Draft saved. Not published; existing published guidance is unchanged.",
      saved
    );
  }
  function update<K extends keyof HandbookContent>(
    key: K,
    value: HandbookContent[K]
  ) {
    setContent(previous => ({ ...previous, [key]: value }));
  }
  function close() {
    if (
      !pending &&
      !inFlight.current &&
      (!dirty || window.confirm("Discard your unsaved guide edits?"))
    )
      onClose();
  }
  async function doAction(
    actionName: "submit_review" | "approve" | "publish" | "archive" | "restore"
  ) {
    if (!canAct || typeof id !== "number") return;
    if (
      (actionName === "publish" && !canPublish) ||
      (actionName === "approve" && !canApprove)
    )
      return;
    const confirmations = {
      publish:
        "Publish this exact saved revision internally for staff only? Agents will not have access.",
      archive:
        "Archive this guide? It will leave the published handbook; history is retained.",
      restore:
        "Restore this guide from the archive? This is separate from publishing.",
    };
    if (
      actionName in confirmations &&
      !window.confirm(confirmations[actionName as keyof typeof confirmations])
    )
      return;
    await mutate(
      () =>
        action.mutateAsync({
          id,
          expectedVersion: version,
          action: actionName,
        }),
      {
        submit_review: "Saved revision submitted for review.",
        approve: "Exact saved revision approved.",
        publish: "Guide published internally. No agent access.",
        archive: "Guide archived.",
        restore: "Guide restored. Check its publication state before use.",
      }[actionName]
    );
  }
  async function uploadFile(file: File) {
    if (!canAct || archived || typeof id !== "number") return;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const mime = attachmentTypes[extension];
    if (
      !mime ||
      file.size > 10 * 1024 * 1024 ||
      file.size === 0 ||
      (file.type &&
        file.type !== mime &&
        !(extension === "csv" && file.type === "application/vnd.ms-excel"))
    ) {
      setMessage(
        "Choose a non-empty PDF, DOCX, XLSX, TXT, CSV, PNG or JPG, up to 10 MB, with its correct file type."
      );
      setFailed(true);
      return;
    }
    await mutate(async () => {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("The file could not be read."));
        reader.readAsDataURL(file);
      });
      return upload.mutateAsync({
        articleId: id,
        expectedVersion: version,
        fileName: file.name,
        fileBase64: base64,
        mimeType: mime,
      });
    }, "Private attachment saved to a new draft revision. Submit it for review when ready.");
  }
  const displayed = readingDraft
    ? detail?.draft
    : (detail?.published ?? detail?.draft);
  const historic = detail?.revisions.find(r => r.id === historyId);
  const resources = detail?.resources ?? [];
  if (blocked) return <HandbookAccessDenied />;
  return (
    <section className={panelClass} data-handbook-article>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={close}
        >
          Back to guides
        </Button>
        <span className="text-xs text-muted-foreground">
          {id === "new"
            ? "New staff-only draft"
            : `Guide #${id} · Version ${version}`}{" "}
          {archived ? "· Archived" : ""}
        </span>
      </div>
      <Feedback message={message} error={failed} />
      {savedNewId && (
        <Button
          type="button"
          disabled={pending}
          onClick={() => void retrySavedGuide()}
        >
          Open saved guide #{savedNewId}
        </Button>
      )}
      {detail && (detail.article.version !== version || verificationFailed) && (
        <Feedback
          error
          message="This guide changed, or refresh is still pending. Your editor has not been overwritten. Reload the latest guide before further actions."
        />
      )}
      <div className="flex flex-wrap gap-2">
        {!editing && !historic && !needsIndependentReview && (
          <Button
            type="button"
            disabled={pending || archived || !current}
            onClick={() => void submitGuide("publish")}
          >
            Save &amp; publish
          </Button>
        )}
        {detail?.published && (
          <Button
            type="button"
            variant={!editing && !readingDraft ? "default" : "outline"}
            size="sm"
            disabled={pending}
            onClick={() => {
              setEditing(false);
              setReadingDraft(false);
              setHistoryId(null);
            }}
          >
            Read published
          </Button>
        )}
        {detail?.draft && (
          <Button
            type="button"
            variant={!editing && readingDraft ? "default" : "outline"}
            size="sm"
            disabled={pending}
            onClick={() => {
              setEditing(false);
              setReadingDraft(true);
              setHistoryId(null);
            }}
          >
            Preview saved draft
          </Button>
        )}
        {typeof id === "number" && (
          <Button
            type="button"
            size="sm"
            variant={editing ? "default" : "outline"}
            disabled={pending || archived || !!savedNewId}
            onClick={() => {
              setEditing(true);
              setHistoryId(null);
            }}
          >
            Edit draft
          </Button>
        )}
        {typeof id === "number" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={async () => {
              if (
                dirty &&
                !window.confirm(
                  "Reload the latest guide and discard your unsaved edits?"
                )
              )
                return;
              if (inFlight.current) return;
              inFlight.current = true;
              setBusy(true);
              try {
                await refresh(id);
                if (alive.current) onSaved(id);
              } catch (error) {
                if (deny(error)) return;
                if (alive.current) {
                  setFailed(true);
                  setMessage(
                    `Reload failed. ${errorText(error)} Your edits are retained.`
                  );
                }
              } finally {
                inFlight.current = false;
                if (alive.current) setBusy(false);
              }
            }}
          >
            Reload latest
          </Button>
        )}
      </div>
      {detail?.published && (
        <p className="text-xs text-muted-foreground">
          The published revision stays available while the draft is edited.
          Preview and history are read-only; neither publishes changes.
        </p>
      )}
      {!editing && !historic && displayed && (
        <>
          <p className="rounded-md bg-muted/40 p-2 text-xs font-medium">
            {!readingDraft && detail?.published
              ? "Published guidance"
              : "Saved draft — not published"}
          </p>
          <GuideReading revision={displayed} resources={resources} />
        </>
      )}
      {historic && (
        <div data-handbook-history className="space-y-3">
          <h2 className="font-semibold">
            Revision {historic.revisionNumber} — read-only history
          </h2>
          <p className="text-xs">
            {historic.changeSummary} · {dateLabel(historic.createdAt)}
          </p>
          <GuideReading revision={historic} resources={resources} />
        </div>
      )}
      {editing && !historic && (
        <form
          noValidate
          onSubmit={e => {
            e.preventDefault();
            // Enter always saves a draft; publication requires its own button.
            void submitGuide("draft");
          }}
        >
          <fieldset
            disabled={pending || archived || !!savedNewId}
            className="space-y-4"
          >
            <legend className="mb-3 font-semibold">
              {id === "new"
                ? "Create guide draft"
                : "Edit draft — explicit save required"}
            </legend>
            <Field label="Title">
              <input
                maxLength={255}
                className={controlClass}
                value={content.title}
                aria-invalid={!!titleError}
                aria-describedby={
                  titleError ? "handbook-title-error" : undefined
                }
                onChange={e => {
                  update("title", e.target.value);
                  if (e.target.value.trim()) setTitleError("");
                }}
              />
            </Field>
            {titleError && (
              <p
                id="handbook-title-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {titleError}
              </p>
            )}
            <Field label="Category">
              <select
                className={controlClass}
                value={content.category}
                onChange={e => update("category", e.target.value)}
              >
                {Array.from(new Set([...categories, content.category])).map(
                  category => (
                    <option key={category}>{category}</option>
                  )
                )}
              </select>
            </Field>
            <p className="text-xs text-muted-foreground">
              Private staff guidance only. No customer/payment data,
              credentials, remote embeds or inline images. Use private
              attachments for screenshots.
            </p>
            {content.format === "article" ? (
              <div className="space-y-1.5">
                <div className="text-sm font-medium">Content</div>
                <PrivateEditor
                  label="Content"
                  value={content.contentHtml}
                  disabled={pending || archived || !!savedNewId}
                  resources={resources}
                  onChange={html => update("contentHtml", html)}
                  onBlocked={() => {
                    setFailed(true);
                    setMessage(
                      "Inline images and embeds are blocked. Upload a private screenshot attachment after saving the draft."
                    );
                  }}
                />
              </div>
            ) : (
              <div className="space-y-3">
                <h3 className="text-sm font-medium">
                  Content — six-section process
                </h3>
                {Object.entries(sectionLabels).map(([key, label]) => (
                  <details
                    key={key}
                    className="rounded-md border p-3"
                    open={key === "whenToUse"}
                  >
                    <summary className="cursor-pointer text-sm font-medium">
                      {label}
                    </summary>
                    <div className="mt-3">
                      <PrivateEditor
                        label={label}
                        value={
                          content.sections[key as keyof typeof sectionLabels]
                        }
                        disabled={pending || archived || !!savedNewId}
                        resources={resources}
                        onChange={html =>
                          setContent(previous => ({
                            ...previous,
                            sections: { ...previous.sections, [key]: html },
                          }))
                        }
                        onBlocked={() => {
                          setFailed(true);
                          setMessage(
                            "Inline images and embeds are blocked. Upload a private screenshot attachment after saving the draft."
                          );
                        }}
                      />
                    </div>
                  </details>
                ))}
              </div>
            )}
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Advanced options (optional)
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Summary (optional)">
                  <textarea
                    rows={2}
                    className={controlClass}
                    value={content.summary}
                    onChange={e => update("summary", e.target.value)}
                  />
                </Field>
                <Field label="Owner">
                  <select
                    className={controlClass}
                    value={content.ownerId}
                    onChange={e => update("ownerId", Number(e.target.value))}
                  >
                    {staff.map(person => (
                      <option key={person.id} value={person.id}>
                        {person.name || `Staff #${person.id}`}
                      </option>
                    ))}
                    {!staff.some(person => person.id === content.ownerId) && (
                      <option value={content.ownerId}>
                        Staff #{content.ownerId}
                      </option>
                    )}
                  </select>
                </Field>
                <Field label="Tags (comma separated)">
                  <input
                    className={controlClass}
                    value={tags}
                    onChange={e => {
                      setTags(e.target.value);
                      update(
                        "tags",
                        e.target.value
                          .split(",")
                          .map(t => t.trim())
                          .filter(Boolean)
                      );
                    }}
                  />
                </Field>
                <Field label="Sensitivity">
                  <select
                    className={controlClass}
                    value={content.sensitivity}
                    onChange={e =>
                      update(
                        "sensitivity",
                        e.target.value as HandbookContent["sensitivity"]
                      )
                    }
                  >
                    {STAFF_HANDBOOK_SENSITIVITIES.map(value => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Last reviewed date">
                  <input
                    type="date"
                    className={controlClass}
                    value={dateInput(content.reviewedAt)}
                    onChange={e =>
                      update(
                        "reviewedAt",
                        e.target.value
                          ? new Date(`${e.target.value}T00:00:00Z`)
                          : null
                      )
                    }
                  />
                </Field>
                <Field label="Next review date">
                  <input
                    type="date"
                    className={controlClass}
                    value={dateInput(content.nextReviewAt)}
                    onChange={e =>
                      update(
                        "nextReviewAt",
                        e.target.value
                          ? new Date(`${e.target.value}T00:00:00Z`)
                          : null
                      )
                    }
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={content.isPinned}
                    onChange={e => update("isPinned", e.target.checked)}
                  />{" "}
                  Pin in handbook
                </label>
                <Field label="Editor format">
                  <select
                    className={controlClass}
                    value={content.format}
                    onChange={e =>
                      update(
                        "format",
                        e.target.value as HandbookContent["format"]
                      )
                    }
                  >
                    <option value="article">Ordinary rich text article</option>
                    <option value="process">
                      Reusable six-section process
                    </option>
                  </select>
                </Field>
                <Field
                  label="Change note (optional)"
                  hint="Leave blank to record Guide created or Guide updated automatically."
                >
                  <input
                    maxLength={500}
                    className={controlClass}
                    value={changeSummary}
                    onChange={e => setChangeSummary(e.target.value)}
                  />
                </Field>
              </div>
            </details>
            {needsIndependentReview && (
              <p className="text-sm text-amber-700">
                Independent review required. Save your draft, then request a
                second staff reviewer. Changed sensitive guidance cannot be
                published directly.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="outline"
                disabled={pending || archived || (id !== "new" && !current)}
              >
                {pending ? "Saving…" : "Save draft"}
              </Button>
              {!needsIndependentReview && (
                <Button
                  type="button"
                  disabled={pending || archived || (id !== "new" && !current)}
                  onClick={() => void submitGuide("publish")}
                >
                  Save &amp; publish
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                {dirty ? "Unsaved changes" : "No unsaved content changes"}
              </span>
            </div>
          </fieldset>
        </form>
      )}
      {!historic && (
        <>
          <AttachmentEditor
            resources={resources.filter(r => draft?.resourceIds.includes(r.id))}
            disabled={!canAct || archived}
            onUpload={file => void uploadFile(file)}
            onRemove={resourceId => {
              if (
                canAct &&
                typeof id === "number" &&
                window.confirm(
                  "Remove this private attachment from the draft? Published and historical revisions retain their attachment history."
                )
              )
                void mutate(
                  () =>
                    remove.mutateAsync({
                      articleId: id,
                      resourceId,
                      expectedVersion: version,
                    }),
                  "Attachment removed from the draft."
                );
            }}
          />
          {detail && (
            <details
              className="space-y-3 rounded-md border bg-muted/20 p-3"
              open={needsReview}
            >
              <summary className="cursor-pointer text-sm font-medium">
                {needsReview
                  ? "Required independent review"
                  : "More options (review & archive)"}
              </summary>
              <h3 className="text-sm font-semibold">
                Review & internal publication
              </h3>
              <p className="text-xs text-muted-foreground">
                {needsReview
                  ? "Financial, legal and policy guidance, including changes to a previously sensitive publication, requires a second, non-contributing reviewer for the exact saved draft revision. Any edit or attachment change needs a new review."
                  : "Operational guidance can use Save & publish. A second staff review is optional."}
              </p>
              {!hasBody && (
                <p className="text-xs text-amber-700">
                  Publication and review blocked: save an article body or
                  process steps first.
                </p>
              )}
              {contributor && (
                <p className="text-xs text-amber-700">
                  You contributed to this revision and cannot approve it. Ask
                  another eligible staff reviewer.
                </p>
              )}
              {needsReview && !exactReview && (
                <p className="text-xs text-amber-700">
                  Publication blocked: the exact saved revision has not been
                  approved by a non-contributing second reviewer.
                </p>
              )}
              {dirty && (
                <p className="text-xs text-amber-700">
                  Save your changes before submitting, approving, publishing or
                  changing attachments.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    !canAct ||
                    archived ||
                    !draft ||
                    !hasBody ||
                    draft.id === detail?.published?.id ||
                    !!detail?.article.submittedAt
                  }
                  onClick={() => void doAction("submit_review")}
                >
                  {detail.article.submittedAt
                    ? "Review requested"
                    : "Request review"}
                </Button>
                {!contributor && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!canApprove}
                    onClick={() => void doAction("approve")}
                  >
                    Approve exact revision
                    {draft ? ` ${draft.revisionNumber}` : ""}
                  </Button>
                )}
                {needsReview && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canPublish}
                    onClick={() => void doAction("publish")}
                  >
                    Publish internally
                  </Button>
                )}
              </div>
            </details>
          )}
        </>
      )}
      {detail && (
        <>
          {!historic && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                More options (archive & restore)
              </summary>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                disabled={!canAct}
                onClick={() => void doAction(archived ? "restore" : "archive")}
              >
                {archived ? "Restore guide" : "Archive guide"}
              </Button>
            </details>
          )}
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Revision history (read-only)
            </summary>
            <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
              {detail.revisions.map(revision => (
                <Button
                  key={revision.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex h-auto w-full justify-start whitespace-normal text-left"
                  disabled={pending}
                  onClick={() => {
                    setHistoryId(revision.id);
                    setEditing(false);
                  }}
                >
                  Revision {revision.revisionNumber} ·{" "}
                  {dateLabel(revision.createdAt)} · {revision.changeSummary}
                </Button>
              ))}
            </div>
          </details>
          <History audit={detail.audit} />
        </>
      )}
    </section>
  );
}
