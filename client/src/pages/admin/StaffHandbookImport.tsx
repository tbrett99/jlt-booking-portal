import React, { useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  HANDBOOK_IMPORT_MAX_BYTES,
  HANDBOOK_IMPORT_MAX_ROWS,
  handbookImportTemplate,
  type HandbookImportPreview,
  type HandbookImportReceipt,
} from "@shared/staff-handbook-import";
import {
  serializeHandbookCsv,
  handbookGuideUrl,
} from "@shared/staff-handbook-csv";
import {
  controlClass,
  panelClass,
  Field,
  Feedback,
  GuideReading,
  HandbookAccessDenied,
  errorText,
  isHandbookAuthorityError,
  isHandbookMutationKey,
  staffHandbookQueryKey,
  useHandbookAccessGuard,
} from "./StaffHandbookComponents";
import { useHandbookUnsavedWork } from "./useHandbookUnsavedWork";
import { downloadHandbookCsv } from "./StaffHandbookExport";

type Props = {
  userId: number;
  onClose: () => void;
  onGuide: (id: number) => void;
};
const statusLabels = {
  ready: "Ready",
  already_imported: "Already imported",
  invalid: "Invalid",
  conflict: "Conflict",
  created: "Draft created",
  not_selected: "Not selected",
  failed: "Failed",
};
function canonicalGuideUrl(id: number | null) {
  return id !== null && Number.isSafeInteger(id) && id > 0 && id <= 2147483647
    ? handbookGuideUrl(id)
    : null;
}
export function StaffHandbookImport({ userId, onClose, onGuide }: Props) {
  const cache = useQueryClient();
  const utils = trpc.useUtils();
  const previewMutation = trpc.staffHandbook.previewImport.useMutation();
  const commitMutation = trpc.staffHandbook.commitImport.useMutation();
  const { blocked, deny } = useHandbookAccessGuard(
    previewMutation.error,
    commitMutation.error
  );
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<HandbookImportPreview | null>(null);
  const [receipt, setReceipt] = useState<HandbookImportReceipt | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState<"read" | "preview" | "commit" | null>(
    null
  );
  const [message, setMessage] = useState("");
  const [refreshMessage, setRefreshMessage] = useState("");
  const sequence = useRef(0);
  const alive = useRef(true);
  const revoked = useRef(false);
  const lock = useRef<{ sequence: number; kind: "preview" | "commit" } | null>(
    null
  );
  const reading = useRef(false);
  const privateCsv = useRef("");
  const unfinished = Boolean(
    pending || (csv && (!receipt || receipt.errorCount > 0))
  );
  const bypass = useHandbookUnsavedWork(!blocked && unfinished);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current += 1;
      privateCsv.current = "";
      lock.current = null;
      // Mutation variables contain the file. Do not retain them in the cache after this panel exits.
      for (const mutation of cache.getMutationCache().getAll()) {
        const key = mutation.options.mutationKey;
        if (
          isHandbookMutationKey(key) &&
          Array.isArray(key?.[0]) &&
          ["previewImport", "commitImport"].includes(String(key[0][1]))
        )
          cache.getMutationCache().remove(mutation);
      }
    };
  }, [cache]);
  function authorized() {
    return (
      !revoked.current &&
      !cache
        .getQueryCache()
        .findAll({ queryKey: staffHandbookQueryKey })
        .some(q => isHandbookAuthorityError(q.state.error)) &&
      !cache
        .getMutationCache()
        .getAll()
        .some(
          m =>
            isHandbookMutationKey(m.options.mutationKey) &&
            isHandbookAuthorityError(m.state.error)
        )
    );
  }
  function current(token: number) {
    return alive.current && sequence.current === token && authorized();
  }
  function clearPrivate() {
    revoked.current = true;
    sequence.current += 1;
    privateCsv.current = "";
    lock.current = null;
    setCsv("");
    setFileName("");
    setPreview(null);
    setReceipt(null);
    setSelected([]);
    setAcknowledged(false);
    setMessage("");
    setRefreshMessage("");
    setPending(null);
  }
  function handleError(error: unknown, token: number, commit = false) {
    if (!alive.current) return;
    if (isHandbookAuthorityError(error)) {
      clearPrivate();
      deny(error);
      return;
    }
    if (current(token))
      setMessage(
        commit
          ? `${errorText(error)} The response may have been lost. Keep this same file and selection and retry safely; already imported references will be skipped.`
          : errorText(error)
      );
  }
  async function readFile(file: File | undefined) {
    if (lock.current?.kind === "commit" || blocked || !authorized()) return;
    const token = ++sequence.current;
    lock.current = null;
    privateCsv.current = "";
    reading.current = Boolean(file);
    setCsv("");
    setFileName(file?.name ?? "");
    setPreview(null);
    setReceipt(null);
    setSelected([]);
    setAcknowledged(false);
    setMessage("");
    setRefreshMessage("");
    setPending(file ? "read" : null);
    if (!file) return;
    try {
      if (file.size > HANDBOOK_IMPORT_MAX_BYTES)
        throw new Error("Choose a CSV file no larger than 5 MiB.");
      const bytes = await file.arrayBuffer();
      if (!current(token)) return;
      if (bytes.byteLength > HANDBOOK_IMPORT_MAX_BYTES)
        throw new Error("Choose a CSV file no larger than 5 MiB.");
      // A replacement character silently changes external references. Reject malformed UTF-8 instead.
      const text = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
      if (!current(token)) return;
      privateCsv.current = text;
      setCsv(text);
      if (!text) setMessage("This file is empty. Choose a UTF-8 CSV file.");
    } catch (error) {
      if (current(token))
        setMessage(
          error instanceof TypeError
            ? "The file is not valid UTF-8. Save it as UTF-8 CSV and choose it again."
            : errorText(error)
        );
    } finally {
      if (current(token)) {
        reading.current = false;
        setPending(null);
      }
    }
  }
  async function previewFile() {
    if (
      lock.current ||
      reading.current ||
      pending ||
      !privateCsv.current ||
      blocked ||
      !authorized()
    )
      return;
    const token = sequence.current;
    lock.current = { sequence: token, kind: "preview" };
    setPending("preview");
    setMessage("");
    setRefreshMessage("");
    try {
      const result = await previewMutation.mutateAsync({
        csv: privateCsv.current,
      });
      if (!current(token)) return;
      setReceipt(null);
      setAcknowledged(false);
      setPreview(result);
      setSelected(
        result.rows
          .filter(row => row.status === "ready")
          .map(row => row.rowNumber)
      );
    } catch (error) {
      handleError(error, token);
    } finally {
      if (lock.current?.sequence === token) lock.current = null;
      if (current(token)) setPending(null);
    }
  }
  const hasWarnings =
    preview?.rows.some(
      row => selected.includes(row.rowNumber) && row.warnings.length > 0
    ) ?? false;
  async function commitSelected() {
    if (
      lock.current ||
      reading.current ||
      pending ||
      !privateCsv.current ||
      blocked ||
      !authorized() ||
      !preview ||
      !selected.length ||
      (hasWarnings && !acknowledged)
    )
      return;
    const token = sequence.current;
    lock.current = { sequence: token, kind: "commit" };
    setPending("commit");
    setMessage("");
    setRefreshMessage("");
    try {
      const result = await commitMutation.mutateAsync({
        csv: privateCsv.current,
        previewHash: preview.previewHash,
        rows: [...selected],
      });
      if (!current(token)) return;
      // The save is already successful. A recoverable list-refresh error cannot undo its receipt.
      setReceipt(result);
      try {
        await utils.staffHandbook.invalidate(undefined, undefined, {
          throwOnError: true,
        });
      } catch (error) {
        if (isHandbookAuthorityError(error)) {
          handleError(error, token);
          return;
        }
        if (current(token))
          setRefreshMessage(
            "Import completed, but the guide list could not refresh. Your receipt is retained; return to guides and retry the list."
          );
      }
    } catch (error) {
      handleError(error, token, true);
    } finally {
      if (lock.current?.sequence === token) lock.current = null;
      if (current(token)) setPending(null);
    }
  }
  function leave(work: () => void) {
    if (
      unfinished &&
      !window.confirm(
        "Discard this import file and preview? An action still in progress may finish on the server."
      )
    )
      return;
    bypass(work);
  }
  function downloadReceipt() {
    if (!receipt || blocked || !authorized()) return;
    const output = serializeHandbookCsv(
      [
        "row_number",
        "external_reference",
        "title",
        "outcome",
        "guide_id",
        "guide_url",
        "message",
      ],
      receipt.rows.map(row => {
        const path = canonicalGuideUrl(row.articleId);
        return [
          row.rowNumber,
          row.externalReference,
          row.title,
          row.outcome,
          path ? row.articleId : "",
          path ? window.location.origin + path : "",
          row.message,
        ];
      })
    );
    downloadHandbookCsv(output, "staff-handbook-import-results.csv");
  }
  if (blocked) return <HandbookAccessDenied />;
  return (
    <section
      className={panelClass}
      data-handbook-import
      aria-label="Import guides"
    >
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="font-semibold">Import guides</h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => leave(onClose)}
        >
          Back to guides
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Import creates drafts only — never published guides. Review and publish
        them using the usual handbook workflow. Changed content for an existing
        external reference is not supported; edit the existing guide instead.
        Add attachments manually after importing.
      </p>
      <p className="text-xs text-muted-foreground">
        UTF-8 CSV · up to 5 MiB · up to {HANDBOOK_IMPORT_MAX_ROWS} data rows.
        Template examples are placeholders, not approved JLT guidance.
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending === "commit"}
        onClick={() => {
          if (authorized())
            downloadHandbookCsv(
              handbookImportTemplate(),
              "staff-handbook-import-template.csv"
            );
        }}
      >
        Download CSV template
      </Button>
      <Field label="CSV file">
        <input
          type="file"
          className={controlClass}
          accept=".csv,text/csv"
          disabled={pending === "commit"}
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void readFile(file);
          }}
        />
      </Field>
      {fileName && (
        <p className="text-sm break-all">Selected file: {fileName}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={Boolean(pending) || !csv}
          onClick={() => void previewFile()}
        >
          {pending === "read"
            ? "Reading file…"
            : pending === "preview"
              ? "Previewing…"
              : "Preview"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => leave(onClose)}
        >
          Cancel import
        </Button>
      </div>
      <Feedback error message={message} />
      {preview && (
        <div className="space-y-3" data-import-preview>
          <Feedback
            message={
              receipt
                ? "Original reviewed preview. The import has run; see Import results below. Retry this same file safely if needed; existing references will be skipped."
                : `${preview.readyCount} ready · ${preview.skippedCount} already imported · ${preview.errorCount} errors. Nothing is saved until you choose Import selected drafts.`
            }
          />
          <ul
            className="max-h-[32rem] overflow-y-auto space-y-3"
            aria-label="Import preview rows"
          >
            {preview.rows.map(row => (
              <li
                key={row.rowNumber}
                className="rounded-lg border p-3 space-y-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      aria-label={`Select row ${row.rowNumber}`}
                      disabled={row.status !== "ready" || Boolean(pending)}
                      checked={selected.includes(row.rowNumber)}
                      onChange={event => {
                        setSelected(previous =>
                          event.target.checked
                            ? [...previous, row.rowNumber]
                            : previous.filter(n => n !== row.rowNumber)
                        );
                        setAcknowledged(false);
                      }}
                    />
                    <span>
                      Row {row.rowNumber} · {row.title || "Untitled"}
                      <span className="block text-xs text-muted-foreground break-all">
                        {row.externalReference}
                      </span>
                    </span>
                  </label>
                  <Badge variant="secondary">{statusLabels[row.status]}</Badge>
                </div>
                {row.errors.map((text, i) => (
                  <p className="text-sm text-destructive" key={`error-${i}`}>
                    Error: {text}
                  </p>
                ))}
                {row.warnings.map((text, i) => (
                  <p className="text-sm text-amber-700" key={`warning-${i}`}>
                    Warning: {text}
                  </p>
                ))}
                {canonicalGuideUrl(row.articleId) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={Boolean(pending)}
                    onClick={() => leave(() => onGuide(row.articleId!))}
                  >
                    Open existing guide
                  </Button>
                )}
                {row.content && (
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">
                      Sanitised content · row {row.rowNumber}
                    </summary>
                    <div className="mt-3">
                      <GuideReading
                        resources={[]}
                        revision={{
                          id: row.rowNumber,
                          articleId: 0,
                          revisionNumber: 1,
                          content: row.content,
                          resourceIds: [],
                          contributorIds: [],
                          createdById: userId,
                          changeSummary: "Import preview",
                          createdAt: new Date(0),
                        }}
                      />
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {hasWarnings && (
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                aria-label="Acknowledge selected row warnings"
                checked={acknowledged}
                disabled={Boolean(pending)}
                onChange={event => setAcknowledged(event.target.checked)}
              />
              I have reviewed the warnings for the selected rows.
            </label>
          )}
          <p className="text-xs text-muted-foreground">
            {selected.length} draft{selected.length === 1 ? "" : "s"} selected.
            Invalid, conflicting and already imported rows are not selected.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={
              Boolean(pending) ||
              !selected.length ||
              (hasWarnings && !acknowledged)
            }
            onClick={() => void commitSelected()}
          >
            {pending === "commit"
              ? "Importing drafts…"
              : "Import selected drafts"}
          </Button>
        </div>
      )}
      {receipt && (
        <div className="space-y-3" data-import-receipt>
          <h3 className="font-semibold">Import results</h3>
          <Feedback
            message={`${receipt.createdCount} drafts created · ${receipt.skippedCount} skipped · ${receipt.errorCount} errors. No guides were published.`}
          />
          <Feedback message={refreshMessage} />
          <ul
            className="max-h-[32rem] overflow-y-auto space-y-2 text-sm"
            aria-label="Import result rows"
          >
            {receipt.rows.map(row => (
              <li key={row.rowNumber} className="rounded-md border p-3">
                <p>
                  Row {row.rowNumber} · {row.title} ·{" "}
                  {statusLabels[row.outcome]}
                </p>
                <p className="text-xs break-all">{row.externalReference}</p>
                <p>{row.message}</p>
                {canonicalGuideUrl(row.articleId) && (
                  <a
                    className="text-primary underline"
                    href={canonicalGuideUrl(row.articleId)!}
                    onClick={event => {
                      if (
                        event.button !== 0 ||
                        event.ctrlKey ||
                        event.metaKey ||
                        event.shiftKey ||
                        event.altKey
                      )
                        return;
                      // The unsaved-work hook already confirmed this native anchor in capture.
                      event.preventDefault();
                      bypass(() => onGuide(row.articleId!));
                    }}
                  >
                    Open guide
                  </a>
                )}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={downloadReceipt}
          >
            Download import results (CSV)
          </Button>
        </div>
      )}
    </section>
  );
}
