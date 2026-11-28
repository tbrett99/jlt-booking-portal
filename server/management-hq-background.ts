import { performance } from "node:perf_hooks";
import type { Pool } from "mysql2/promise";
import { createHqLiveConfig } from "./management-hq-live-config";
import {
  hqBackgroundBinding,
  rawHqBackgroundEnabled,
} from "./management-hq-background-config";
export { hqBackgroundBinding } from "./management-hq-background-config";
import {
  createHqLiveService,
  type HqLiveService,
  type HqLiveServiceOptions,
} from "./management-hq-live-service";
import {
  createHqLiveStore,
  HqLiveError,
  safeHqLiveErrorCode,
} from "./management-hq-live-store";
import {
  createHqBackgroundStore,
  type HqBackgroundJob,
  type HqBackgroundStore,
} from "./management-hq-background-store";

export const HQ_BACKGROUND_BATCH_LIMIT = 4;
export const HQ_BACKGROUND_RUN_BUDGET_MS = 8 * 60 * 1000;
const TRANSIENT = new Set([
  "TIMEOUT",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "TRANSPORT_FAILURE",
  "SOURCE_NOT_READY",
  "SOURCE_OR_STORE_UNAVAILABLE",
]);
export type HqBackgroundJobDto = {
  status: HqBackgroundJob["status"];
  startedAt: string;
  expiresAt: string;
  nextDueAt: string;
  attempts: number;
  consecutiveErrors: number;
  lastErrorCode: string | null;
};
export type HqBackgroundStatus = {
  enabled: boolean;
  job: HqBackgroundJobDto | null;
};
export function hqBackgroundEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  try {
    return rawHqBackgroundEnabled(env);
  } catch {
    throw new HqLiveError("CONFIG_INVALID");
  }
}
function dto(job: HqBackgroundJob | null): HqBackgroundJobDto | null {
  return job
    ? {
        status: job.status,
        startedAt: new Date(job.startedAtMs).toISOString(),
        expiresAt: new Date(job.expiresAtMs).toISOString(),
        nextDueAt: new Date(job.nextDueAtMs).toISOString(),
        attempts: job.attempts,
        consecutiveErrors: job.consecutiveErrors,
        lastErrorCode: job.lastErrorCode,
      }
    : null;
}
type Options = {
  pool: Pool;
  env?: NodeJS.ProcessEnv;
  /** Fresh active Super Admin check. Worker resolves only the durable initiating actor. */
  authorize: (actorId: number) => Promise<void>;
  createStore?: () => HqBackgroundStore;
  createService?: (options: HqLiveServiceOptions) => HqLiveService;
  monotonicNow?: () => number;
};
/** A persisted request is not a timer. Railway invokes run() in a separate finite process. */
export function createHqBackgroundCoordinator(options: Options) {
  const env = options.env ?? process.env;
  const config = createHqLiveConfig(env);
  const store =
    options.createStore?.() ?? createHqBackgroundStore(options.pool);
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  function guardFor(
    actorId: number,
    binding: string,
    running?: HqBackgroundJob
  ) {
    let failure: unknown = null;
    const bindingGuard = () => {
      if (failure) throw failure;
      const c = config.status();
      if (
        !hqBackgroundEnabled(env) ||
        hqBackgroundBinding(env) !== binding ||
        !c.configured ||
        !c.syncEnabled ||
        c.readEnabled
      ) {
        failure = new HqLiveError("CONFIG_INVALID");
        throw failure;
      }
    };
    const guard = async () => {
      try {
        bindingGuard();
      } catch (error) {
        failure ??= error;
      }
      try {
        await options.authorize(actorId);
      } catch (error) {
        failure ??= error;
      }
      try {
        bindingGuard();
        if (running) {
          const fresh = await store.read();
          bindingGuard();
          if (
            !fresh.job ||
            fresh.job.status !== "running" ||
            fresh.job.token !== running.token ||
            fresh.job.sourceBinding !== binding ||
            fresh.databaseNowMs >= fresh.job.expiresAtMs ||
            fresh.databaseNowMs >= (fresh.job.leaseUntilMs ?? 0)
          )
            throw new HqLiveError("LEASE_LOST");
        }
      } catch (error) {
        failure ??= error;
      }
      if (failure) throw failure;
    };
    return { guard, bindingGuard };
  }
  function serviceFor(
    actorId: number,
    binding: string,
    running?: HqBackgroundJob
  ) {
    const { guard, bindingGuard } = guardFor(actorId, binding, running);
    let lastAuthority = -Infinity;
    const yieldGuard = async () => {
      bindingGuard();
      if (monotonicNow() - lastAuthority >= 1000) {
        await guard();
        lastAuthority = monotonicNow();
      }
      bindingGuard();
    };
    const service = (options.createService ?? createHqLiveService)({
      config,
      onlyInitialPublication: true,
      initialImportGuard: guard,
      acceleratedInitialImport: true,
      initialImportCpuBindingGuard: bindingGuard,
      createStore: () =>
        createHqLiveStore(options.pool, config, {
          cooperativeGuard: guard,
          cooperativeYieldGuard: yieldGuard,
          validatedInitialReuseScope: binding,
        }),
    });
    return { service, guard };
  }
  async function guarded<T>(
    guard: () => Promise<void>,
    work: () => Promise<T>
  ): Promise<T> {
    await guard();
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: await work() };
    } catch (error) {
      outcome = { ok: false, error };
    }
    await guard();
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }
  return {
    async status(actorId: number): Promise<HqBackgroundStatus> {
      await options.authorize(actorId);
      if (!hqBackgroundEnabled(env)) return { enabled: false, job: null };
      const binding = hqBackgroundBinding(env);
      const { guard } = guardFor(actorId, binding);
      const fresh = await guarded(guard, () => store.read());
      if (fresh.job && fresh.job.sourceBinding !== binding)
        throw new HqLiveError("SOURCE_BINDING_CHANGED");
      // Read-only projection, not a reporting/job mutation or liveness assertion.
      const job =
        fresh.job &&
        ["queued", "running"].includes(fresh.job.status) &&
        fresh.databaseNowMs >= fresh.job.expiresAtMs
          ? {
              ...fresh.job,
              status: "failed" as const,
              lastErrorCode: "SOURCE_EXPIRED" as const,
            }
          : fresh.job?.status === "running" &&
              fresh.databaseNowMs >= (fresh.job.leaseUntilMs ?? 0)
            ? { ...fresh.job, status: "queued" as const }
            : fresh.job;
      return { enabled: true, job: dto(job) };
    },
    async start(actorId: number): Promise<HqBackgroundStatus> {
      const binding = hqBackgroundBinding(env);
      const { service, guard } = serviceFor(actorId, binding);
      const current = await guarded(guard, () => service.getStatus());
      if (
        current.hasPublished ||
        current.health === "needs_attention" ||
        current.stageStatus === "needs_attention" ||
        current.progress?.kind !== "backfill" ||
        current.progress.pages < 1 ||
        current.progress.recordsRead < 1
      )
        throw new HqLiveError("CONFIG_INVALID");
      const job = await guarded(guard, () =>
        store.start(actorId, binding, guard)
      );
      return { enabled: true, job: dto(job) };
    },
    async pause(actorId: number): Promise<HqBackgroundStatus> {
      const binding = hqBackgroundBinding(env);
      const { guard } = guardFor(actorId, binding);
      const before = await guarded(guard, () => store.read());
      if (before.job && before.job.sourceBinding !== binding)
        throw new HqLiveError("SOURCE_BINDING_CHANGED");
      const job = await guarded(guard, () => store.pause(guard));
      return { enabled: true, job: dto(job) };
    },
    /** Server-side manual admission only; no source work or mutation. */
    async assertManualAllowed(actorId: number): Promise<void> {
      if (!hqBackgroundEnabled(env)) return;
      const status = await this.status(actorId);
      if (status.job?.status === "queued" || status.job?.status === "running")
        throw new HqLiveError("LEASE_LOST");
    },
    /** No loop across scheduled invocations; max four original bounded batches then close pool and exit. */
    async run(): Promise<{
      status: "idle" | "queued" | "completed" | "failed" | "paused";
      batches: number;
    }> {
      if (!hqBackgroundEnabled(env)) return { status: "idle", batches: 0 };
      const binding = hqBackgroundBinding(env);
      let batches = 0;
      const started = monotonicNow();
      while (
        batches < HQ_BACKGROUND_BATCH_LIMIT &&
        monotonicNow() - started < HQ_BACKGROUND_RUN_BUDGET_MS
      ) {
        const observed = await store.read();
        if (
          !observed.job ||
          !["queued", "running"].includes(observed.job.status)
        )
          return {
            status:
              observed.job?.status === "completed"
                ? "completed"
                : observed.job?.status === "failed"
                  ? "failed"
                  : observed.job?.status === "paused"
                    ? "paused"
                    : "idle",
            batches,
          };
        if (observed.databaseNowMs >= observed.job.expiresAtMs)
          return { status: "failed", batches };
        const actorId = observed.job.actorId;
        const claimGuard = guardFor(actorId, binding).guard;
        const claim = await guarded(claimGuard, () =>
          store.claim(binding, claimGuard)
        );
        if (claim.kind !== "claimed")
          return {
            status: claim.job?.status === "failed" ? "failed" : "idle",
            batches,
          };
        const job = claim.job;
        const { service, guard } = serviceFor(actorId, binding, job);
        try {
          // Metadata/authority awaits also consume the finite launch budget.
          // Yield this job-only claim instead of starting a late source batch.
          await guard();
          if (monotonicNow() - started >= HQ_BACKGROUND_RUN_BUDGET_MS) {
            await store.settle(
              job.token!,
              { status: "queued", nextDueAtMs: job.nextDueAtMs },
              claimGuard
            );
            return { status: "queued", batches };
          }
          const outcome = await guarded(guard, () => {
            if (monotonicNow() - started >= HQ_BACKGROUND_RUN_BUDGET_MS)
              throw new HqLiveError("TIMEOUT");
            return service.invoke();
          });
          batches++;
          const after = await guarded(guard, () => service.getStatus());
          const code = outcome.errorCode ?? after.lastErrorCode;
          const due = after.nextDueAt ? Date.parse(after.nextDueAt) : 0;
          const completed =
            outcome.status === "applied" ||
            outcome.status === "already_complete";
          const known = [
            "applied",
            "already_complete",
            "needs_attention",
            "disabled",
            "progress",
            "busy",
            "notdue",
          ].includes(outcome.status);
          const terminal =
            !known ||
            outcome.status === "needs_attention" ||
            outcome.status === "disabled" ||
            after.health === "needs_attention" ||
            after.stageStatus === "needs_attention" ||
            (code !== null && code !== undefined && !TRANSIENT.has(code));
          // Completion requires the initial-only strong acquisition/result AND
          // a fresh observation; unchecked metadata alone never grants reporting.
          const settled = await store.settle(
            job.token!,
            {
              status:
                completed && after.hasPublished && !terminal
                  ? "completed"
                  : completed || terminal
                    ? "failed"
                    : "queued",
              nextDueAtMs: Number.isSafeInteger(due) && due >= 0 ? due : 0,
              errorCode:
                completed && !after.hasPublished
                  ? "STORE_UNAVAILABLE"
                  : !known || (terminal && !code)
                    ? "STORE_UNAVAILABLE"
                    : (code ?? null),
            },
            claimGuard
          );
          if (!settled || settled.status !== "queued")
            return {
              status:
                settled?.status === "completed"
                  ? "completed"
                  : settled?.status === "paused"
                    ? "paused"
                    : "failed",
              batches,
            };
          if (code || outcome.status === "busy" || outcome.status === "notdue")
            return { status: "queued", batches };
        } catch (error) {
          // The source/storage guard is permanently denied. Never continue or clear
          // the original import control. A separate authorized job-only settlement
          // may record failure; a pause/restart token mismatch remains untouched.
          const code = safeHqLiveErrorCode((error as HqLiveError)?.code);
          try {
            await store.settle(
              job.token!,
              { status: "failed", errorCode: code },
              claimGuard
            );
          } catch {
            /* fail closed; persisted lease expires */
          }
          return { status: "failed", batches };
        }
      }
      return { status: "queued", batches };
    },
  };
}
