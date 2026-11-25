import type { HqInitialImportResult } from "../../../shared/management-hq-initial-import";

export type HqInitialRunPhase =
  | "idle"
  | "running"
  | "waiting"
  | "completed"
  | "stopped"
  | "error";

export interface HqInitialRunStatus {
  hasPublished: boolean;
  progress: { pages: number; recordsRead: number } | null;
  nextDueAt: string | null;
  health: string;
  /** Fresh adapter-provided source errors are fatal, even if progress exists. */
  sourceError?: string | null;
}

export interface HqInitialRunState {
  phase: HqInitialRunPhase;
  busy: boolean;
  pendingMutation: boolean;
  uncertain: boolean;
  attempt: number;
  progress: { pages: number; recordsRead: number } | null;
  nextDueAt: string | null;
  error: string | null;
  warning: string | null;
}

export interface HqInitialRunClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface HqInitialRunOptions {
  invoke: () => Promise<HqInitialImportResult>;
  freshStatus: () => Promise<HqInitialRunStatus>;
  verifyCurrent: () => boolean;
  onState?: (state: HqInitialRunState) => void;
  clock?: HqInitialRunClock;
  maxRuntimeMs?: number;
  maxBatchAttempts?: number;
  requestDeadlineMs?: number;
  statusDeadlineMs?: number;
}

export const HQ_INITIAL_RUN_ERRORS = {
  notCurrent:
    "Initial import stopped because the current actor or route changed.",
  attention: "Initial import stopped because server attention is required.",
  alreadyPublished: "Initial import is already complete.",
  malformed:
    "Initial import stopped because the server returned an invalid result.",
  server: "Initial import stopped because the server reported an error.",
  busy: "Initial import is busy in another session.",
  timeout:
    "Initial import stopped after a request deadline; outcome is unknown.",
  unknown: "Initial import stopped because the request outcome is unknown.",
  stalled:
    "Initial import stopped because progress did not advance consistently.",
  status:
    "Initial import stopped because current status could not be verified.",
  statusTimeout:
    "Initial import stopped after the current-status request deadline.",
  deadline: "Initial import stopped at its finite runtime deadline.",
  attempts: "Initial import stopped at its finite batch-attempt limit.",
  stopped: "Initial import was stopped.",
} as const;

const PENDING_WARNING =
  "A server mutation may still finish; no further batches will run.";
const DEFAULT_CLOCK: HqInitialRunClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: handle =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const DEFAULT_MAX_RUNTIME = 45 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 1000;
const DEFAULT_REQUEST_DEADLINE = 180 * 1000;
const DEFAULT_STATUS_DEADLINE = 15 * 1000;
const MAX_TIMER = 2_147_483_647;
const HEALTH = [
  "no_data",
  "progress",
  "backoff",
  "needs_attention",
  "ready",
  "stale",
  "disabled",
];

type Progress = HqInitialRunStatus["progress"];
function cloneProgress(progress: Progress): Progress {
  return progress
    ? { pages: progress.pages, recordsRead: progress.recordsRead }
    : null;
}
function validProgress(value: unknown): value is NonNullable<Progress> {
  if (!value || typeof value !== "object") return false;
  const { pages, recordsRead } = value as NonNullable<Progress>;
  return (
    Number.isSafeInteger(pages) &&
    pages >= 0 &&
    pages <= 1000 &&
    Number.isSafeInteger(recordsRead) &&
    recordsRead >= 0 &&
    recordsRead <= 100_000
  );
}
function validDue(value: unknown): value is string | null {
  if (value === null) return true;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  )
    return false;
  const parsed = Date.parse(value);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}
function validResult(value: unknown): value is HqInitialImportResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<HqInitialImportResult>;
  return (
    typeof result.status === "string" &&
    [
      "disabled",
      "notdue",
      "busy",
      "progress",
      "applied",
      "already_complete",
      "needs_attention",
    ].includes(result.status) &&
    typeof result.message === "string" &&
    validDue(result.nextDueAt) &&
    typeof result.hasPublished === "boolean" &&
    (result.progress === null || validProgress(result.progress)) &&
    (result.errorCode === null || typeof result.errorCode === "string") &&
    (!(result.status === "applied" || result.status === "already_complete") ||
      result.hasPublished) &&
    (result.status !== "notdue" || result.nextDueAt !== null) &&
    (result.status !== "progress" || result.progress !== null)
  );
}
function validStatus(value: unknown): value is HqInitialRunStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as HqInitialRunStatus;
  return (
    typeof status.hasPublished === "boolean" &&
    (status.progress === null || validProgress(status.progress)) &&
    validDue(status.nextDueAt) &&
    HEALTH.includes(status.health) &&
    (status.sourceError === undefined ||
      status.sourceError === null ||
      typeof status.sourceError === "string")
  );
}
function doesNotRegress(next: Progress, previous: Progress): boolean {
  if (!previous) return true;
  return (
    !!next &&
    next.pages >= previous.pages &&
    next.recordsRead >= previous.recordsRead
  );
}
function advances(next: Progress, previous: Progress): boolean {
  return (
    !!next &&
    doesNotRegress(next, previous) &&
    (next.pages > (previous?.pages ?? 0) ||
      next.recordsRead > (previous?.recordsRead ?? 0))
  );
}
function limit(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(
      "Initial import limits must be positive safe integers no greater than their defaults."
    );
  }
  return value;
}

/** Explicit start only. Terminal controllers cannot be restarted or release a pending mutation. */
export class HqInitialRunController {
  private readonly clock: HqInitialRunClock;
  private readonly maxRuntimeMs: number;
  private readonly maxBatchAttempts: number;
  private readonly requestDeadlineMs: number;
  private readonly statusDeadlineMs: number;
  private state: HqInitialRunState = {
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
  private stopped = false;
  private runToken = 0;
  private inflight = false;
  private startedAt = 0;
  private waitHandle: unknown = null;
  private runtimeHandle: unknown = null;
  private wakeWait?: () => void;
  private cancelOperation?: () => void;

  constructor(private readonly options: HqInitialRunOptions) {
    this.clock = options.clock ?? DEFAULT_CLOCK;
    this.maxRuntimeMs = limit(options.maxRuntimeMs, DEFAULT_MAX_RUNTIME);
    this.maxBatchAttempts = limit(
      options.maxBatchAttempts,
      DEFAULT_MAX_ATTEMPTS
    );
    this.requestDeadlineMs = limit(
      options.requestDeadlineMs,
      DEFAULT_REQUEST_DEADLINE
    );
    this.statusDeadlineMs = limit(
      options.statusDeadlineMs,
      DEFAULT_STATUS_DEADLINE
    );
  }

  getState(): HqInitialRunState {
    // Do not expose the previous actor's private progress through polling either.
    if (!this.isCurrent())
      this.halt("error", HQ_INITIAL_RUN_ERRORS.notCurrent, false, true);
    return { ...this.state, progress: cloneProgress(this.state.progress) };
  }

  /** The page must also consult the old controller before permitting another instance/action. */
  hasPendingMutation(): boolean {
    return this.inflight;
  }

  start(): void {
    if (this.stopped || this.inflight || this.state.phase !== "idle") return;
    const token = ++this.runToken;
    this.startedAt = this.clock.now();
    if (!this.guard(token)) return;
    this.runtimeHandle = this.clock.setTimeout(() => {
      if (this.guard(token, false))
        this.fail(token, HQ_INITIAL_RUN_ERRORS.deadline);
    }, this.maxRuntimeMs);
    if (!this.patch(token, { phase: "running", busy: true })) return;
    void this.run(token);
  }

  stop(): void {
    if (this.stopped) return;
    this.halt("stopped", HQ_INITIAL_RUN_ERRORS.stopped);
  }

  private isCurrent(): boolean {
    try {
      return this.options.verifyCurrent();
    } catch {
      return false;
    }
  }

  private guard(token: number, checkRuntime = true): boolean {
    if (!this.isCurrent()) {
      this.halt("error", HQ_INITIAL_RUN_ERRORS.notCurrent, false, true);
      return false;
    }
    if (this.stopped || token !== this.runToken) return false;
    if (
      checkRuntime &&
      this.clock.now() - this.startedAt >= this.maxRuntimeMs
    ) {
      this.fail(token, HQ_INITIAL_RUN_ERRORS.deadline);
      return false;
    }
    return true;
  }

  private notify(): void {
    if (!this.isCurrent()) {
      this.halt("error", HQ_INITIAL_RUN_ERRORS.notCurrent, false, true);
      return;
    }
    try {
      this.options.onState?.({
        ...this.state,
        progress: cloneProgress(this.state.progress),
      });
    } catch {
      this.halt("error", HQ_INITIAL_RUN_ERRORS.unknown, false, true);
    }
    if (!this.isCurrent())
      this.halt("error", HQ_INITIAL_RUN_ERRORS.notCurrent, false, true);
  }

  private patch(token: number, change: Partial<HqInitialRunState>): boolean {
    if (!this.guard(token)) return false;
    this.state = {
      ...this.state,
      ...change,
      progress:
        change.progress === undefined
          ? this.state.progress
          : cloneProgress(change.progress),
    };
    this.notify();
    return this.guard(token);
  }

  private clearWork(): void {
    if (this.waitHandle !== null) this.clock.clearTimeout(this.waitHandle);
    if (this.runtimeHandle !== null)
      this.clock.clearTimeout(this.runtimeHandle);
    this.waitHandle = this.runtimeHandle = null;
    const wake = this.wakeWait;
    this.wakeWait = undefined;
    wake?.();
    this.cancelOperation?.();
  }

  private halt(
    phase: "error" | "stopped",
    error: string,
    uncertain = false,
    silent = false
  ): void {
    const actorChanged = error === HQ_INITIAL_RUN_ERRORS.notCurrent;
    if (this.stopped && !actorChanged) return;
    this.stopped = true;
    this.runToken++;
    this.clearWork();
    this.state = {
      ...this.state,
      phase,
      busy: false,
      pendingMutation: this.inflight,
      uncertain: this.state.uncertain || uncertain || this.inflight,
      error,
      warning: this.inflight ? PENDING_WARNING : this.state.warning,
      ...(actorChanged ? { progress: null, nextDueAt: null } : {}),
    };
    if (!silent) this.notify();
  }

  private fail(token: number, error: string, uncertain = false): void {
    if (this.stopped || token !== this.runToken) return;
    if (!this.isCurrent())
      return this.halt("error", HQ_INITIAL_RUN_ERRORS.notCurrent, false, true);
    this.halt("error", error, uncertain);
  }

  private statusUsable(
    token: number,
    status: HqInitialRunStatus,
    completing = false
  ): boolean {
    if (!this.guard(token)) return false;
    if (status.sourceError !== undefined && status.sourceError !== null) {
      this.fail(token, HQ_INITIAL_RUN_ERRORS.server);
      return false;
    }
    const healthy = completing
      ? ["ready", "progress"].includes(status.health)
      : ["no_data", "progress"].includes(status.health);
    if (!healthy) {
      this.fail(token, HQ_INITIAL_RUN_ERRORS.attention);
      return false;
    }
    return true;
  }

  private async run(token: number): Promise<void> {
    try {
      if (!this.guard(token)) return;
      const initial = await this.readStatus(token);
      if (!this.guard(token) || !initial) return;
      if (initial.hasPublished)
        return this.fail(token, HQ_INITIAL_RUN_ERRORS.alreadyPublished);
      if (!this.statusUsable(token, initial)) return;
      let previous = cloneProgress(initial.progress);
      if (
        !this.patch(token, { progress: previous, nextDueAt: initial.nextDueAt })
      )
        return;
      if (!this.guard(token)) return;
      await this.waitUntil(token, initial.nextDueAt);
      if (!this.guard(token)) return;

      while (this.guard(token)) {
        if (this.state.attempt >= this.maxBatchAttempts)
          return this.fail(token, HQ_INITIAL_RUN_ERRORS.attempts);
        const baseline = cloneProgress(previous);
        if (
          !this.patch(token, {
            phase: "running",
            busy: true,
            attempt: this.state.attempt + 1,
          })
        )
          return;
        if (!this.guard(token)) return;
        const outcome = await this.invokeWithDeadline(token);
        if (!this.guard(token) || !outcome) return;
        const result = outcome.value;
        if (!validResult(result))
          return this.fail(token, HQ_INITIAL_RUN_ERRORS.malformed);
        if (result.errorCode !== null)
          return this.fail(token, HQ_INITIAL_RUN_ERRORS.server);
        if (["disabled", "needs_attention"].includes(result.status))
          return this.fail(token, HQ_INITIAL_RUN_ERRORS.attention);
        if (result.status === "busy")
          return this.fail(token, HQ_INITIAL_RUN_ERRORS.busy);
        if (
          (result.progress && !doesNotRegress(result.progress, baseline)) ||
          (result.status === "progress" && !advances(result.progress, baseline))
        ) {
          return this.fail(token, HQ_INITIAL_RUN_ERRORS.stalled);
        }
        if (!this.guard(token)) return;
        const confirmed = await this.readStatus(token);
        if (!this.guard(token) || !confirmed) return;
        if (!this.statusUsable(token, confirmed, confirmed.hasPublished))
          return;
        // Publication may clear the progress checkpoint. Otherwise fresh progress must
        // be at least the pre-batch baseline AND the returned mutation progress.
        if (
          (!confirmed.hasPublished || confirmed.progress !== null) &&
          (!doesNotRegress(confirmed.progress, baseline) ||
            !doesNotRegress(confirmed.progress, result.progress) ||
            (result.status === "progress" &&
              !advances(confirmed.progress, baseline)))
        ) {
          return this.fail(token, HQ_INITIAL_RUN_ERRORS.stalled);
        }
        if (confirmed.hasPublished) return this.complete(token, confirmed);
        if (result.hasPublished)
          return this.fail(token, HQ_INITIAL_RUN_ERRORS.status);
        previous = cloneProgress(confirmed.progress);
        const due = this.laterDue(confirmed.nextDueAt, result.nextDueAt);
        if (!this.patch(token, { progress: previous, nextDueAt: due })) return;
        if (!this.guard(token)) return;
        await this.waitUntil(token, due);
        if (!this.guard(token)) return;
      }
    } catch {
      if (this.guard(token))
        this.fail(token, HQ_INITIAL_RUN_ERRORS.unknown, true);
    }
  }

  private laterDue(a: string | null, b: string | null): string | null {
    if (a === null) return b;
    if (b === null) return a;
    return Date.parse(a) >= Date.parse(b) ? a : b;
  }

  private async raceDeadline<T>(
    token: number,
    underlying: Promise<T>,
    deadlineMs: number,
    timeoutError: string,
    rejectionError: string
  ): Promise<{ value: T } | null> {
    let handle: unknown = null;
    let cancel!: () => void;
    // Attach both handlers even if invoking the operation synchronously changed the
    // actor/stopped the run. A late rejection must not become unhandled.
    const settlement = underlying.then(
      value => ({ value }),
      () => ({ failed: true as const })
    );
    const interruption = new Promise<null>(resolve => {
      cancel = () => resolve(null);
      this.cancelOperation = cancel;
      handle = this.clock.setTimeout(() => {
        if (this.guard(token))
          this.fail(
            token,
            timeoutError,
            timeoutError === HQ_INITIAL_RUN_ERRORS.timeout
          );
        resolve(null);
      }, deadlineMs);
    });
    try {
      if (!this.guard(token)) return null;
      const result = await Promise.race([settlement, interruption]);
      if (!this.guard(token)) return null;
      if (result && "failed" in result) {
        this.fail(
          token,
          rejectionError,
          rejectionError === HQ_INITIAL_RUN_ERRORS.unknown
        );
        return null;
      }
      return result;
    } catch {
      if (this.guard(token))
        this.fail(
          token,
          rejectionError,
          rejectionError === HQ_INITIAL_RUN_ERRORS.unknown
        );
      return null;
    } finally {
      if (handle !== null) this.clock.clearTimeout(handle);
      if (this.cancelOperation === cancel) this.cancelOperation = undefined;
    }
  }

  private async readStatus(token: number): Promise<HqInitialRunStatus | null> {
    if (!this.guard(token)) return null;
    try {
      const outcome = await this.raceDeadline(
        token,
        this.options.freshStatus(),
        this.statusDeadlineMs,
        HQ_INITIAL_RUN_ERRORS.statusTimeout,
        HQ_INITIAL_RUN_ERRORS.status
      );
      if (!this.guard(token) || !outcome) return null;
      if (!validStatus(outcome.value)) {
        this.fail(token, HQ_INITIAL_RUN_ERRORS.status);
        return null;
      }
      return {
        ...outcome.value,
        progress: cloneProgress(outcome.value.progress),
      };
    } catch {
      if (this.guard(token)) this.fail(token, HQ_INITIAL_RUN_ERRORS.status);
      return null;
    }
  }

  private releaseMutation(): void {
    // Only underlying settlement calls this: a race timeout/stop cannot relinquish ownership.
    this.inflight = false;
    this.state = { ...this.state, pendingMutation: false };
    this.notify();
  }

  private async invokeWithDeadline(
    token: number
  ): Promise<{ value: HqInitialImportResult } | null> {
    if (!this.guard(token) || this.inflight) return null;
    this.inflight = true;
    if (!this.patch(token, { pendingMutation: true })) {
      this.releaseMutation(); // No invocation was admitted.
      return null;
    }
    try {
      if (!this.guard(token)) {
        this.releaseMutation();
        return null;
      }
      const underlying = this.options.invoke().then(
        value => {
          this.releaseMutation();
          return value;
        },
        (error: unknown) => {
          this.releaseMutation();
          throw error;
        }
      );
      const outcome = await this.raceDeadline(
        token,
        underlying,
        this.requestDeadlineMs,
        HQ_INITIAL_RUN_ERRORS.timeout,
        HQ_INITIAL_RUN_ERRORS.unknown
      );
      if (!this.guard(token)) return null;
      return outcome;
    } catch {
      this.releaseMutation();
      if (this.guard(token))
        this.fail(token, HQ_INITIAL_RUN_ERRORS.unknown, true);
      return null;
    }
  }

  private async waitUntil(token: number, dueAt: string | null): Promise<void> {
    if (!this.guard(token) || dueAt === null) return;
    const due = Date.parse(dueAt);
    while (this.guard(token) && this.clock.now() < due) {
      if (!this.patch(token, { phase: "waiting", busy: false })) return;
      if (!this.guard(token)) return;
      const remainingRuntime = Math.min(
        this.maxRuntimeMs,
        this.maxRuntimeMs - (this.clock.now() - this.startedAt)
      );
      const delay = Math.max(
        0,
        Math.min(MAX_TIMER, due - this.clock.now(), remainingRuntime)
      );
      await new Promise<void>(resolve => {
        this.wakeWait = resolve;
        this.waitHandle = this.clock.setTimeout(() => {
          this.waitHandle = null;
          this.wakeWait = undefined;
          resolve();
        }, delay);
      });
      if (!this.guard(token)) return;
      // Recompute after every wake: timers can fire early and wall time can go backwards.
    }
  }

  private complete(token: number, status: HqInitialRunStatus): void {
    if (
      !this.guard(token) ||
      !status.hasPublished ||
      !this.statusUsable(token, status, true)
    )
      return;
    this.stopped = true;
    this.runToken++;
    this.clearWork();
    this.state = {
      ...this.state,
      phase: "completed",
      busy: false,
      progress: cloneProgress(status.progress),
      nextDueAt: status.nextDueAt,
    };
    this.notify();
  }
}
