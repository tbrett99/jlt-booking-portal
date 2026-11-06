import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  buildSupplierAccessOptions,
  cleanSupplierAccessName,
  isValidSupplierAccessName,
  supplierAccessIdentity,
  SUPPLIER_ACCESS_NAME_MAX,
} from "@shared/supplier-access-catalog";
import { toast } from "sonner";

type SupplierLogin = {
  id: number;
  supplierName: string;
  notes?: string | null;
  username?: string | null;
};

type SavedChanges = { added: Map<number, SupplierLogin>; deleted: Set<number> };

// Keep confirmed row IDs until the parent refetch acknowledges them. Applying
// changes by row ID (not supplier name) never hides other duplicate records.
function recordedRows(rows: SupplierLogin[], changes: SavedChanges): SupplierLogin[] {
  const existingIds = new Set(rows.map(row => row.id));
  return [
    ...rows.filter(row => !changes.deleted.has(row.id)),
    ...Array.from(changes.added.values()).filter(row => !existingIds.has(row.id)),
  ];
}

export function CrmSupplierAccess({ userId, supplierLogins, onRefresh }: {
  userId: number;
  supplierLogins: SupplierLogin[];
  onRefresh: () => void;
}) {
  const id = useId();
  const utils = trpc.useUtils();
  const catalog = trpc.crm.agentCrm.getSupplierAccessCatalog.useQuery();
  const addOption = trpc.crm.agentCrm.addSupplierAccessOption.useMutation();
  const addLogin = trpc.crm.agentCrm.addSupplierLogin.useMutation();
  const deleteLogin = trpc.crm.agentCrm.deleteSupplierLogin.useMutation();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [localNames, setLocalNames] = useState<string[]>([]);
  const [addingOption, setAddingOption] = useState(false);
  const optionBusy = useRef(false);
  const accessBusy = useRef(false);
  const [pendingAccess, setPendingAccess] = useState<{ identity: string; checked: boolean } | null>(null);
  const [changes, setChanges] = useState<SavedChanges>(() => ({ added: new Map(), deleted: new Set() }));
  const changesRef = useRef(changes);
  const rowsRef = useRef(supplierLogins);
  rowsRef.current = supplierLogins;

  useEffect(() => {
    const current = changesRef.current;
    const ids = new Set(supplierLogins.map(row => row.id));
    const added = new Map(Array.from(current.added).filter(([rowId]) => !ids.has(rowId)));
    const deleted = new Set(Array.from(current.deleted).filter(rowId => ids.has(rowId)));
    if (added.size !== current.added.size || deleted.size !== current.deleted.size) {
      const next = { added, deleted };
      changesRef.current = next;
      setChanges(next);
    }
  }, [supplierLogins]);

  const logins = recordedRows(supplierLogins, changes);
  const options = buildSupplierAccessOptions(
    [...(catalog.data?.names ?? []), ...localNames],
    logins.map(row => row.supplierName),
  );
  const rowsByIdentity = new Map<string, SupplierLogin[]>();
  for (const row of logins) {
    const identity = supplierAccessIdentity(row.supplierName);
    rowsByIdentity.set(identity, [...(rowsByIdentity.get(identity) ?? []), row]);
  }

  async function addToList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (optionBusy.current) return;
    if (!isValidSupplierAccessName(name)) {
      const message = `Enter a supplier name of 1–${SUPPLIER_ACCESS_NAME_MAX} characters without control characters.`;
      setNameError(message);
      toast.error(message);
      return;
    }
    optionBusy.current = true;
    setAddingOption(true);
    setNameError(null);
    try {
      const result = await addOption.mutateAsync({ name: cleanSupplierAccessName(name) });
      // A catalogue refetch can still be in flight: show the saved option now,
      // but do not change any agent's supplier login records.
      setLocalNames(current => [...current, result.name]);
      setName("");
      if (result.alreadyExists) {
        toast.info(`${result.name} is already in the shared supplier list.`);
      } else {
        toast.success(`${result.name} added to the shared supplier list. No agent access was changed.`);
      }
      void utils.crm.agentCrm.getSupplierAccessCatalog.invalidate().catch(() => {
        toast.error("Supplier saved, but the shared list could not refresh. The new option is shown here; retry loading the list.");
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not add supplier to the list.";
      setNameError(message);
      toast.error(message);
    } finally {
      optionBusy.current = false;
      setAddingOption(false);
    }
  }

  function refreshRecordedAccess() {
    void utils.crm.agentCrm.getMembershipsOverview.invalidate().catch(() => {
      toast.error("Supplier access saved, but the memberships overview could not refresh.");
    });
    try {
      void Promise.resolve(onRefresh()).catch(() => {
        toast.error("Supplier access saved, but the agent details could not refresh.");
      });
    } catch {
      toast.error("Supplier access saved, but the agent details could not refresh.");
    }
  }

  async function toggle(supplier: string, identity: string) {
    // The ref also blocks a second click before React commits the disabled UI.
    if (accessBusy.current) return;
    const matching = recordedRows(rowsRef.current, changesRef.current)
      .filter(row => supplierAccessIdentity(row.supplierName) === identity);
    if (matching.length > 1) return;
    const login = matching[0];
    accessBusy.current = true;
    setPendingAccess({ identity, checked: !login });
    try {
      let addedRow: SupplierLogin | undefined;
      if (login) {
        await deleteLogin.mutateAsync({ id: login.id });
      } else {
        const result = await addLogin.mutateAsync({ userId, supplierName: supplier });
        if (!Number.isSafeInteger(result.id) || result.id <= 0) {
          throw new Error("Supplier access could not be verified. Refresh the agent record before retrying.");
        }
        addedRow = { id: result.id, supplierName: supplier };
      }
      // A parent refresh may acknowledge earlier saves while this request is
      // pending. Apply this save to that latest state, not a pre-request copy.
      const current = changesRef.current;
      const next: SavedChanges = { added: new Map(current.added), deleted: new Set(current.deleted) };
      if (login) {
        next.added.delete(login.id);
        next.deleted.add(login.id);
      } else if (addedRow) {
        next.added.set(addedRow.id, addedRow);
      }
      changesRef.current = next;
      setChanges(next);
      refreshRecordedAccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save supplier access.");
    } finally {
      accessBusy.current = false;
      setPendingAccess(null);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={addToList} noValidate className="space-y-3 rounded-lg border bg-muted/20 p-4" aria-labelledby={`${id}-add-title`}>
        <h3 id={`${id}-add-title`} className="text-sm font-semibold">Add supplier to list</h3>
        <p id={`${id}-add-help`} className="text-sm text-muted-foreground">
          This supplier list is available on all agent records. Adding an option does not automatically grant access or select it for any agent.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-1.5">
            <label htmlFor={`${id}-name`} className="text-sm font-medium">Supplier name</label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={event => { setName(event.target.value); setNameError(null); }}
              maxLength={SUPPLIER_ACCESS_NAME_MAX}
              disabled={addingOption}
              aria-invalid={Boolean(nameError)}
              aria-describedby={`${id}-add-help ${id}-name-limit${nameError ? ` ${id}-name-error` : ""}`}
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={addingOption}>{addingOption ? "Adding supplier…" : "Add supplier to list"}</Button>
        </div>
        <p id={`${id}-name-limit`} className="text-xs text-muted-foreground">Maximum {SUPPLIER_ACCESS_NAME_MAX} characters.</p>
        {nameError && <p id={`${id}-name-error`} role="alert" className="text-sm text-destructive">{nameError}</p>}
      </form>

      {catalog.error ? (
        <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm">
          <p>Shared supplier list could not be loaded. Known options, defaults and this agent’s recorded suppliers remain visible; other shared options may be missing.</p>
          <Button type="button" variant="outline" size="sm" disabled={catalog.isFetching} onClick={() => { void catalog.refetch().catch(() => undefined); }}>
            {catalog.isFetching ? "Retrying…" : "Retry loading shared list"}
          </Button>
        </div>
      ) : catalog.isLoading || !catalog.data ? (
        <p role="status" className="rounded-lg border p-3 text-sm text-muted-foreground">Loading shared supplier list. Default suppliers and this agent’s recorded suppliers are shown while it loads.</p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Record which supplier portals this agent has access to. Changes update CRM records only; they do not create or revoke supplier accounts.
      </p>
      <div role="group" aria-label="Agent supplier access" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map(({ name: supplier, identity }) => {
          const rows = rowsByIdentity.get(identity) ?? [];
          const multiple = rows.length > 1;
          const saving = pendingAccess?.identity === identity;
          const checked = saving ? pendingAccess.checked : rows.length > 0;
          const checkboxId = `${id}-supplier-${encodeURIComponent(identity)}`;
          const detailId = `${checkboxId}-detail`;
          const usernames = identity === supplierAccessIdentity("Aviate") ? rows.filter(row => row.username) : [];
          return (
            <div key={identity} className={`flex items-center justify-between gap-3 rounded-lg border p-3.5 transition-colors ${checked ? "border-primary/40 bg-primary/5" : "border-border bg-muted/20"}`}>
              <div className="flex min-w-0 items-start gap-3">
                <input
                  id={checkboxId}
                  type="checkbox"
                  checked={checked}
                  disabled={pendingAccess !== null || multiple}
                  onChange={() => { void toggle(supplier, identity); }}
                  aria-describedby={multiple || usernames.length > 0 ? detailId : undefined}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed"
                />
                <div className="min-w-0">
                  <label htmlFor={checkboxId} className="cursor-pointer break-words text-sm font-medium">{supplier}</label>
                  {(multiple || usernames.length > 0) && (
                    <div id={detailId} className="mt-0.5 text-xs text-muted-foreground">
                      {multiple && <p>{rows.length} recorded logins — multiple records require staff review.</p>}
                      {usernames.map(row => <p key={row.id}>Aviate username: <span className="break-all font-mono">{row.username}</span></p>)}
                    </div>
                  )}
                </div>
              </div>
              {saving ? <span role="status" className="shrink-0 text-xs text-muted-foreground">Saving…</span> : checked && <Badge variant="secondary" className="shrink-0 text-xs">Access recorded</Badge>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
