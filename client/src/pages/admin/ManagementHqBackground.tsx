import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

// Local until the shared background contract is available. Retain only this DTO,
// never RPC messages, actor objects, source bindings, cursors, tokens or rows.
type HqBackgroundJobDto = {
  status: "queued" | "running" | "paused" | "completed" | "failed";
  startedAt: string;
  expiresAt: string;
  nextDueAt: string;
  attempts: number;
  consecutiveErrors: number;
  lastErrorCode: string | null;
};
type BackgroundStatus = { enabled: boolean; job: HqBackgroundJobDto | null };
type Actor = {
  id: number;
  role: string;
  isActive: boolean;
  portalStatus: string;
};
type SavedStatus = {
  mode: "live" | "sample" | "disabled";
  liveConfigured: boolean;
  live: {
    configured: boolean;
    configurationCode: string | null;
    syncEnabled: boolean;
    readEnabled: boolean;
    intervalSeconds: number;
    freshnessSeconds: number;
    health: string;
    stageStatus: string;
    hasPublished: boolean;
    lastErrorCode: string | null;
    nextDueAt: string | null;
    progress: {
      kind: "backfill" | "catchup";
      pages: number;
      recordsRead: number;
    } | null;
  } | null;
};
type Snapshot = { background: BackgroundStatus; saved: SavedStatus };
const queryOptions = {
  retry: false,
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
};
const panel = "rounded-xl border border-border bg-card p-4 sm:p-5";
const UNVERIFIED =
  "Background import status could not be verified. Use Refresh progress before another action. No automatic retry is performed.";
const REQUEST_UNVERIFIED =
  "The background request could not be verified. Use Refresh progress before another action. No automatic retry is performed.";
const TRANSIENT_ERRORS = new Set([
  "TIMEOUT",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "TRANSPORT_FAILURE",
  "SOURCE_NOT_READY",
  "SOURCE_OR_STORE_UNAVAILABLE",
]);
const ERROR_CODES = new Set([
  "CONFIG_INVALID",
  "CONFIG_INCOMPLETE",
  "STORE_UNAVAILABLE",
  "INVALID_PERSISTED_STATE",
  "SOURCE_BINDING_CHANGED",
  "LEASE_LOST",
  "VERSION_EXHAUSTED",
  "AUTH_DENIED",
  "INVALID_QUERY",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "TIMEOUT",
  "CLIENT_DISABLED",
  "INVALID_PAYLOAD",
  "PAYLOAD_TOO_LARGE",
  "CONTRACT_VERSION_MISMATCH",
  "INVALID_SEMANTICS",
  "SCOPE_MISMATCH",
  "REDIRECT_REJECTED",
  "TRANSPORT_FAILURE",
  "SOURCE_EXPIRED",
  "SOURCE_NOT_READY",
  "SOURCE_SCOPE_MISMATCH",
  "GENERATION_METADATA_DRIFT",
  "STALE_REVISION",
  "REVISION_CONFLICT",
  "STAGED_CHECKPOINT_MISMATCH",
  "STAGED_MODE_MISMATCH",
  "CHECKPOINT_REQUIRED",
  "PAGE_CAP_EXCEEDED",
  "RECORD_CAP_EXCEEDED",
  "STATE_RECORD_CAP_EXCEEDED",
  "REPLAY_PROOF_CAP_EXCEEDED",
  "STATE_BYTE_CAP_EXCEEDED",
  "STATE_VERSION_OVERFLOW",
  "CAS_CONFLICT",
  "CATALOGUE_MEMBERSHIP_MISMATCH",
  "INVALID_SOURCE_COUNTS",
  "SOURCE_COUNT_MISMATCH",
  "GENERATION_REGRESSION",
  "PAGINATION_INCONSISTENT",
  "ENDPOINT_ENTITY_MISMATCH",
  "CATALOGUE_REVISION_MISMATCH",
  "DUPLICATE_CATALOGUE_ENTRY",
  "CHANGE_UPPER_EXCEEDED",
  "SEQUENCE_CONFLICT",
  "SEQUENCE_REGRESSION",
  "REPLAY_BEFORE_CHECKPOINT",
  "CURSOR_LOOP",
  "INCOMPLETE_GENERATION",
  "SOURCE_OR_STORE_UNAVAILABLE",
]);
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function stamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    return false;
  const parsed = Date.parse(value);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}
function errorCode(value: unknown): value is string | null {
  return (
    value === null || (typeof value === "string" && ERROR_CODES.has(value))
  );
}
function safeBackground(value: unknown): BackgroundStatus | null {
  const envelope = record(value);
  if (!envelope || typeof envelope.enabled !== "boolean") return null;
  if (envelope.job === null) return { enabled: envelope.enabled, job: null };
  const job = record(envelope.job);
  if (
    !job ||
    !["queued", "running", "paused", "completed", "failed"].includes(
      job.status as string
    ) ||
    !stamp(job.startedAt) ||
    !stamp(job.expiresAt) ||
    !stamp(job.nextDueAt) ||
    Date.parse(job.expiresAt) !==
      Date.parse(job.startedAt) + 24 * 60 * 60 * 1000 ||
    !count(job.attempts) ||
    job.attempts > 200 ||
    (job.status === "running" && job.attempts < 1) ||
    !count(job.consecutiveErrors) ||
    job.consecutiveErrors > 3 ||
    job.consecutiveErrors > job.attempts ||
    !errorCode(job.lastErrorCode)
  )
    return null;
  return {
    enabled: envelope.enabled,
    job: {
      status: job.status as HqBackgroundJobDto["status"],
      startedAt: job.startedAt,
      expiresAt: job.expiresAt,
      nextDueAt: job.nextDueAt,
      attempts: job.attempts,
      consecutiveErrors: job.consecutiveErrors,
      lastErrorCode: job.lastErrorCode,
    },
  };
}
function safeSaved(value: unknown): SavedStatus | null {
  const result = record(value);
  if (
    !result ||
    !["live", "sample", "disabled"].includes(result.reportMode as string) ||
    typeof result.liveConfigured !== "boolean"
  )
    return null;
  const mode = result.reportMode as SavedStatus["mode"];
  if (mode !== "live")
    return { mode, liveConfigured: result.liveConfigured, live: null };
  const live = record(result.live);
  if (
    !live ||
    typeof live.configured !== "boolean" ||
    typeof live.syncEnabled !== "boolean" ||
    typeof live.readEnabled !== "boolean" ||
    typeof live.hasPublished !== "boolean" ||
    ![null, "CONFIG_DISABLED", "CONFIG_INVALID", "CONFIG_INCOMPLETE"].includes(
      live.configurationCode as null
    ) ||
    !count(live.intervalSeconds) ||
    live.intervalSeconds < 60 ||
    live.intervalSeconds > 3600 ||
    !count(live.freshnessSeconds) ||
    live.freshnessSeconds < 60 ||
    live.freshnessSeconds > 86400 ||
    ![
      "disabled",
      "no_data",
      "ready",
      "stale",
      "progress",
      "backoff",
      "needs_attention",
    ].includes(live.health as string) ||
    ![
      "idle",
      "running",
      "progress",
      "applied",
      "backoff",
      "needs_attention",
    ].includes(live.stageStatus as string) ||
    !errorCode(live.lastErrorCode) ||
    (live.nextDueAt !== null && !stamp(live.nextDueAt))
  )
    return null;
  const progress = record(live.progress);
  if (
    live.progress !== null &&
    (!progress ||
      !["backfill", "catchup"].includes(progress.kind as string) ||
      !count(progress.pages) ||
      !count(progress.recordsRead))
  )
    return null;
  return {
    mode,
    liveConfigured: result.liveConfigured,
    live: {
      configured: live.configured,
      configurationCode: live.configurationCode as string | null,
      syncEnabled: live.syncEnabled,
      readEnabled: live.readEnabled,
      intervalSeconds: live.intervalSeconds,
      freshnessSeconds: live.freshnessSeconds,
      health: live.health as string,
      stageStatus: live.stageStatus as string,
      hasPublished: live.hasPublished,
      lastErrorCode: live.lastErrorCode,
      nextDueAt: live.nextDueAt as string | null,
      progress: progress
        ? {
            kind: progress.kind as "backfill" | "catchup",
            pages: progress.pages as number,
            recordsRead: progress.recordsRead as number,
          }
        : null,
    },
  };
}
function activeSuperAdmin(value: unknown): value is Actor {
  const actor = record(value);
  return (
    !!actor &&
    count(actor.id) &&
    actor.id > 0 &&
    actor.role === "super_admin" &&
    actor.isActive === true &&
    actor.portalStatus === "active"
  );
}
function settings(snapshot: Snapshot | null): string {
  const live = snapshot?.saved.live;
  return JSON.stringify([
    snapshot?.background.enabled,
    snapshot?.saved.mode,
    snapshot?.saved.liveConfigured,
    live?.configured,
    live?.configurationCode,
    live?.syncEnabled,
    live?.readEnabled,
    live?.intervalSeconds,
    live?.freshnessSeconds,
  ]);
}
function startAllowed(snapshot: Snapshot): boolean {
  const live = snapshot.saved.live;
  const active = ["queued", "running"].includes(
    snapshot.background.job?.status ?? ""
  );
  const transientBackoff =
    !!live &&
    live.health === "backoff" &&
    stamp(live.nextDueAt) &&
    live.lastErrorCode !== null &&
    TRANSIENT_ERRORS.has(live.lastErrorCode);
  return (
    snapshot.background.enabled &&
    !active &&
    snapshot.saved.mode === "live" &&
    snapshot.saved.liveConfigured &&
    !!live &&
    live.configured &&
    live.configurationCode === null &&
    live.syncEnabled &&
    !live.readEnabled &&
    !live.hasPublished &&
    live.health !== "needs_attention" &&
    live.stageStatus !== "needs_attention" &&
    live.progress?.kind === "backfill" &&
    live.progress.pages > 0 &&
    live.progress.recordsRead > 0 &&
    (live.lastErrorCode === null || transientBackoff) &&
    (live.health !== "backoff" || transientBackoff)
  );
}

// Only unresolved operation tokens survive unmount; mounted subscribers receive
// lock state, not the old actor's settings, results or mutation callbacks.
const pendingOperations = new Map<number, symbol>();
const pendingListeners = new Map<number, Set<(pending: boolean) => void>>();
function notifyPending(actorId: number) {
  pendingListeners
    .get(actorId)
    ?.forEach(listener => listener(pendingOperations.has(actorId)));
}
function usePending(actorId: number) {
  const [pending, setPending] = useState(() => pendingOperations.has(actorId));
  useEffect(() => {
    const listeners = pendingListeners.get(actorId) ?? new Set();
    pendingListeners.set(actorId, listeners);
    listeners.add(setPending);
    setPending(pendingOperations.has(actorId));
    return () => {
      listeners.delete(setPending);
      if (!listeners.size) pendingListeners.delete(actorId);
    };
  }, [actorId]);
  return pending;
}

/** PortalLayout owns the surrounding navigation, just as on ManagementHq. */
export default function ManagementHqBackground() {
  const auth = useAuth();
  if (auth.loading)
    return (
      <div className="p-6" role="status">
        Checking current Management HQ access…
      </div>
    );
  if (auth.error || !activeSuperAdmin(auth.user)) return <AccessDenied />;
  // A different actor/activity/role gets a new fresh auth observer, not cached
  // isFetchedAfterMount state inherited from a previous identity.
  const actor = auth.user;
  return (
    <FreshAuthority
      key={`${actor.id}:${actor.role}:${actor.isActive}:${actor.portalStatus}`}
      actor={actor}
    />
  );
}
function AccessDenied() {
  return (
    <section className="p-6" role="alert">
      <h1 className="text-2xl font-semibold">Background initial import</h1>
      <p className="mt-2">
        Access denied. Current active Super Admin access is required. No import
        progress is shown.
      </p>
    </section>
  );
}
function FreshAuthority({ actor }: { actor: Actor }) {
  const current = trpc.auth.me.useQuery(undefined, queryOptions);
  const authority = useRef<number | null>(null);
  const allowed =
    !current.error &&
    !current.isLoading &&
    !current.isFetching &&
    current.isFetchedAfterMount &&
    activeSuperAdmin(current.data) &&
    current.data.id === actor.id;
  authority.current = allowed ? actor.id : null;
  if (current.error) return <AccessDenied />;
  if (current.isLoading || current.isFetching || !current.isFetchedAfterMount)
    return (
      <div className="p-6" role="status">
        Checking current Management HQ access…
      </div>
    );
  if (!allowed) return <AccessDenied />;
  return (
    <ActorBackground
      actorId={actor.id}
      isCurrent={() => authority.current === actor.id}
    />
  );
}
function ActorBackground({
  actorId,
  isCurrent,
}: {
  actorId: number;
  isCurrent: () => boolean;
}) {
  const [route] = useLocation();
  const background = trpc.managementHq.backgroundInitialImportStatus.useQuery(
    undefined,
    queryOptions
  );
  const saved = trpc.managementHq.status.useQuery(undefined, queryOptions);
  const start = trpc.managementHq.startBackgroundInitialImport.useMutation();
  const pause = trpc.managementHq.pauseBackgroundInitialImport.useMutation();
  const pending = usePending(actorId);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const alive = useRef(false);
  const needsRefresh = useRef(pendingOperations.has(actorId));
  const initialized = useRef(false);
  const identity = useRef(isCurrent);
  identity.current = isCurrent;
  const flight = useRef<{
    token: symbol;
    settings: string;
    route: string;
    invalidated: boolean;
    readingOnly: boolean;
  } | null>(null);
  const currentBackground = safeBackground(background.data);
  const currentSaved = safeSaved(saved.data);
  const parsed =
    currentBackground && currentSaved
      ? { background: currentBackground, saved: currentSaved }
      : null;
  const boundary = settings(parsed);
  const latestBoundary = useRef(boundary);
  latestBoundary.current = boundary;
  const ready =
    background.isFetchedAfterMount &&
    saved.isFetchedAfterMount &&
    !background.isLoading &&
    !saved.isLoading &&
    !background.isFetching &&
    !saved.isFetching;
  const queryError = !!background.error || !!saved.error;
  if (queryError || (ready && !parsed)) needsRefresh.current = true;
  if (
    flight.current &&
    (window.location.href !== flight.current.route ||
      (!flight.current.readingOnly &&
        (queryError ||
          (ready && !parsed) ||
          boundary !== flight.current.settings)))
  ) {
    flight.current.invalidated = true;
    needsRefresh.current = true;
  }
  const queryBoundary = useRef(boundary);
  if (queryBoundary.current !== boundary) {
    if (initialized.current && !flight.current) needsRefresh.current = true;
    queryBoundary.current = boundary;
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (flight.current) flight.current.invalidated = true;
    };
  }, []);
  useEffect(() => {
    if (
      !initialized.current &&
      ready &&
      parsed &&
      !queryError &&
      !needsRefresh.current
    ) {
      initialized.current = true;
      setSnapshot(parsed);
    }
  }, [ready, boundary, queryError]);
  const visible =
    route === "/admin/management-hq/background" &&
    ready &&
    !queryError &&
    !needsRefresh.current &&
    !busy &&
    snapshot &&
    settings(snapshot) === boundary &&
    JSON.stringify(snapshot) === JSON.stringify(parsed)
      ? snapshot
      : null;
  const locked =
    busy ||
    pending ||
    background.isFetching ||
    saved.isFetching ||
    background.isLoading ||
    saved.isLoading;
  const eligibleStart = !!visible && startAllowed(visible);
  const eligiblePause =
    !!visible &&
    visible.background.enabled &&
    ["queued", "running"].includes(visible.background.job?.status ?? "");
  const current = (owned: NonNullable<typeof flight.current>) =>
    alive.current &&
    identity.current() &&
    flight.current === owned &&
    !owned.invalidated &&
    (owned.readingOnly || latestBoundary.current === owned.settings) &&
    window.location.href === owned.route;
  const acquire = (readingOnly = false) => {
    if (
      !alive.current ||
      !identity.current() ||
      pendingOperations.has(actorId) ||
      locked ||
      route !== "/admin/management-hq/background"
    )
      return null;
    const owned = {
      token: Symbol("background-import"),
      settings: boundary,
      route: window.location.href,
      invalidated: false,
      readingOnly,
    };
    pendingOperations.set(actorId, owned.token);
    flight.current = owned;
    setBusy(true);
    setNotice(null);
    notifyPending(actorId);
    return owned;
  };
  const release = (owned: NonNullable<typeof flight.current>) => {
    if (pendingOperations.get(actorId) === owned.token) {
      pendingOperations.delete(actorId);
      notifyPending(actorId);
    }
    if (alive.current && flight.current === owned) {
      flight.current = null;
      setBusy(false);
    }
  };
  const freshBoth = async (
    owned: NonNullable<typeof flight.current>
  ): Promise<Snapshot | null> => {
    // Exactly one fresh read of each Portal status. Wait for both underlying
    // promises, even if one rejects; never release single-flight prematurely.
    const results = await Promise.allSettled([
      background.refetch({ cancelRefetch: false }),
      saved.refetch({ cancelRefetch: false }),
    ]);
    if (!current(owned)) return null;
    const [bg, hq] = results;
    if (
      bg.status !== "fulfilled" ||
      hq.status !== "fulfilled" ||
      bg.value.error ||
      hq.value.error
    )
      return null;
    const nextBackground = safeBackground(bg.value.data),
      nextSaved = safeSaved(hq.value.data);
    const next =
      nextBackground && nextSaved
        ? { background: nextBackground, saved: nextSaved }
        : null;
    return next && (owned.readingOnly || settings(next) === owned.settings)
      ? next
      : null;
  };
  const refresh = async () => {
    const owned = acquire(true);
    if (!owned) return;
    try {
      const next = await freshBoth(owned);
      if (!current(owned)) return;
      if (!next) {
        needsRefresh.current = true;
        setSnapshot(null);
        setNotice(UNVERIFIED);
        return;
      }
      needsRefresh.current = false;
      initialized.current = true;
      setSnapshot(next);
    } finally {
      release(owned);
    }
  };
  const mutate = async (kind: "start" | "pause") => {
    if (!(kind === "start" ? eligibleStart : eligiblePause)) return;
    const owned = acquire();
    if (!owned) return;
    let confirmed = false;
    try {
      try {
        // No inputs, client batch loop, timeout race, import source calls or
        // mutation callbacks. Settlement means the actual request settled.
        const result = await (kind === "start" ? start : pause).mutateAsync();
        confirmed = safeBackground(result) !== null;
      } catch {
        confirmed = false;
      }
      // Closing/revoking/changing this observer does not cancel a server job.
      // Do not call this old observer's refetch or UI callbacks after unmount.
      if (!current(owned)) return;
      const next = await freshBoth(owned);
      if (!current(owned)) return;
      if (!confirmed || !next) {
        needsRefresh.current = true;
        setSnapshot(null);
        setNotice(REQUEST_UNVERIFIED);
        return;
      }
      needsRefresh.current = false;
      initialized.current = true;
      setSnapshot(next);
    } finally {
      release(owned);
    }
  };
  const job = visible?.background.job;
  const live = visible?.saved.live;
  return (
    <div
      className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6"
      data-actor={actorId}
    >
      <header className="space-y-3">
        <Link
          href="/admin/management-hq"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Management HQ
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Background initial import
        </h1>
        <p className="text-sm text-muted-foreground">
          Continue the saved first import without keeping this page open.
        </p>
      </header>
      <section
        className={`${panel} space-y-4`}
        aria-label="Background import controls"
      >
        <p className="text-sm">
          You can close this page once the background request is confirmed. The
          Railway worker continues the saved initial import; regular updates and
          dashboard reading remain off.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={locked || !eligibleStart}
            onClick={() => void mutate("start")}
          >
            Run import in background
          </Button>
          <Button
            variant="outline"
            disabled={locked || !eligiblePause}
            onClick={() => void mutate("pause")}
          >
            Pause background import
          </Button>
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => void refresh()}
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Refresh progress
          </Button>
        </div>
        {locked ? (
          <p role="status" className="text-sm">
            {pending || busy
              ? "A background request or status check is still pending. Closing this page does not cancel a saved Railway job. Refresh progress when you return before another action."
              : "Checking saved import progress…"}
          </p>
        ) : !visible ? (
          <p role="alert" className="text-sm">
            {notice ?? UNVERIFIED}
          </p>
        ) : (
          <div
            role={job?.status === "failed" ? "alert" : "status"}
            className="space-y-2 text-sm"
          >
            {!visible.background.enabled && (
              <p>
                Background import is not enabled yet. The Railway worker setup
                is required.
              </p>
            )}
            {!job && (
              <p>
                No background import request is saved. No import starts
                automatically.
              </p>
            )}
            {job?.status === "queued" && <p>Queued for the Railway worker</p>}
            {job?.status === "running" && (
              <p>
                Railway worker claimed the background import. This saved status
                does not prove the worker is still active; use Refresh progress
                to check again.
              </p>
            )}
            {job?.status === "paused" && (
              <p>
                Background import is paused. Saved progress is retained. Use
                Refresh progress and check Management HQ before continuing
                manually.
              </p>
            )}
            {job?.status === "failed" && (
              <p>
                Background import stopped and needs attention. Use Refresh
                progress and return to Management HQ for manual checks. No
                automatic restart or reset is performed.
              </p>
            )}
            {job?.status === "completed" && (
              <p>
                {live?.hasPublished
                  ? "First import completed. Return to Management HQ to check imported figures; dashboards remain off."
                  : "Completion could not be verified against saved import progress. Use Refresh progress and check Management HQ; dashboards remain off."}
              </p>
            )}
            {visible.background.enabled &&
              !eligibleStart &&
              !eligiblePause &&
              !live?.hasPublished &&
              job?.status !== "failed" &&
              job?.status !== "completed" && (
                <p>
                  Starting requires configured first-import access: sync on,
                  report reading off, no published import and no import needing
                  attention.
                </p>
              )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Refresh progress only reads saved Portal status. It does not contact
          Orbit, run import batches, enable dashboards or change filters. There
          is no automatic polling or retry on this page.
        </p>
      </section>
      {visible && (
        <section
          className={`${panel} space-y-3`}
          aria-label="Saved initial import progress"
        >
          <h2 className="font-semibold">Saved initial import progress</h2>
          {live?.progress ? (
            <p className="text-sm">
              Saved{" "}
              {live.progress.kind === "backfill"
                ? "historical import"
                : "change catch-up"}
              : {live.progress.pages} pages · {live.progress.recordsRead}{" "}
              records read. Partial records are not published figures.
            </p>
          ) : (
            <p className="text-sm">
              {live?.hasPublished
                ? "A saved publication is available for manual checks in Management HQ."
                : "No partial import progress is recorded. Values are unavailable, not zero."}
            </p>
          )}
          {live?.health === "backoff" && (
            <p className="text-sm">
              The server is waiting until{" "}
              {live.nextDueAt
                ? new Date(live.nextDueAt).toLocaleString()
                : "its next saved due time"}
              . A background request continues the same saved import and
              respects this wait.
            </p>
          )}
          {job && (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Requested</dt>
                <dd>{new Date(job.startedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Expires</dt>
                <dd>{new Date(job.expiresAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Next worker due time</dt>
                <dd>{new Date(job.nextDueAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Worker attempts</dt>
                <dd>
                  {job.attempts} · {job.consecutiveErrors} consecutive errors
                </dd>
              </div>
            </dl>
          )}
          <p className="text-xs text-muted-foreground">
            A saved job expires after 24 hours and stops after 3 consecutive
            errors. Queued status confirms a saved request, not that the Railway
            worker is active. Pausing does not discard saved import progress; an
            already-running server batch may still finish.
          </p>
        </section>
      )}
    </div>
  );
}
