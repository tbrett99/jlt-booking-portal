import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb, getRawDbPool } from "./db";
import { getHqReport, exportHqReportCsv } from "./management-hq-engine";
import type { HqReportOptions } from "../shared/management-hq-report";
import {
  createHqImplementedSampleDirectory,
  runHqImplementedSampleScenario,
} from "./management-hq-implemented-fixtures";
import type { HqImplementedState } from "./management-hq-ingestion";
import {
  createHqSampleStore,
  hqSampleEnabled,
  requireFreshHqSuperAdmin,
  requireHqSampleEnabled,
} from "./management-hq-store";
import {
  createHqLiveConfig,
  type HqLiveConfigurationStatus,
} from "./management-hq-live-config";
import { createHqLiveService } from "./management-hq-live-service";
import {
  captureHqConnectionBinding,
  checkHqConnection,
} from "./management-hq-connection-check";
import {
  captureHqInitialImportBinding,
  importHqInitialBatch,
  finishHqInitialBatch,
} from "./management-hq-initial-import";
import { validateHqInitialPublication } from "./management-hq-initial-validation";
import type { HqInitialValidationResult } from "../shared/management-hq-initial-validation";
import { checkHqFirstPage } from "./management-hq-first-page-check";
import { recoverHqEmptyInitialImport } from "./management-hq-initial-recovery";
import { resumeHqStagedInitialImport } from "./management-hq-staged-resume";
import { repairHqInitialCapacity } from "./management-hq-capacity-repair";
import { hqReadDeadline } from "./management-hq-read-deadline";
import type { createHqBackgroundCoordinator } from "./management-hq-background";
import {
  rawHqBackgroundEnabled as hqBackgroundEnabled,
  hqBackgroundBinding,
} from "./management-hq-background-config";
import {
  getHqLiveReport,
  withHqLiveReportMetadata,
} from "./management-hq-live-report";

type ReportMode = "live" | "sample" | "disabled";
function reportMode(configuration: HqLiveConfigurationStatus): ReportMode {
  // Malformed/requested live flags must never silently fall back to synthetic samples.
  if (
    configuration.syncEnabled ||
    configuration.readEnabled ||
    configuration.configurationCode !== "CONFIG_DISABLED"
  )
    return "live";
  return hqSampleEnabled() ? "sample" : "disabled";
}
function boundary() {
  const config = createHqLiveConfig();
  const configuration = config.status();
  return {
    config,
    configuration,
    mode: reportMode(configuration),
    fingerprint: config.sourceFingerprint(),
  };
}
class HqBoundaryError extends TRPCError {}
const freshAuthority = (
  db: unknown,
  user: Parameters<typeof requireFreshHqSuperAdmin>[1]
) => hqReadDeadline(() => requireFreshHqSuperAdmin(db, user));
function deny(message: string): never {
  throw new HqBoundaryError({ code: "PRECONDITION_FAILED", message });
}
function assertBoundary(original: ReturnType<typeof boundary>) {
  const current = boundary();
  if (
    current.mode !== original.mode ||
    current.fingerprint !== original.fingerprint ||
    JSON.stringify(current.configuration) !==
      JSON.stringify(original.configuration)
  )
    deny(
      "Management HQ configuration changed. Refresh to check current access; values are unavailable, not zero."
    );
}
function safeError(error: unknown): never {
  // Only our fixed authorization/configuration messages are safe. Never forward arbitrary SQL/provider TRPCErrors.
  if (
    error instanceof HqBoundaryError ||
    (error instanceof TRPCError &&
      (error.message === "Active Super Admin access required." ||
        error.message === "Management HQ access could not be verified."))
  )
    throw error;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "Management HQ data or access could not be verified. Values are unavailable, not zero. No partial totals have been returned.",
  });
}
const procedure = protectedProcedure.use(async ({ ctx, next }) => {
  try {
    const db = await getDb();
    await freshAuthority(db, ctx.user);
    return next({ ctx: { ...ctx, hqDb: db! } });
  } catch (error) {
    safeError(error);
  }
});
const range = z
  .object({
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12).optional(),
  })
  .strict();
const reportRange = range.extend({
  detailPage: z.number().int().min(0).max(799).optional(),
});

function initialImportGuard(
  db: unknown,
  user: Parameters<typeof requireFreshHqSuperAdmin>[1],
  start: ReturnType<typeof boundary>
) {
  const assertBinding = captureHqInitialImportBinding();
  let failure: { error: unknown } | null = null;
  return async () => {
    try {
      assertBinding();
      assertBoundary(start);
    } catch (error) {
      failure ??= { error };
    }
    try {
      await freshAuthority(db, user);
    } catch (error) {
      failure ??= { error };
    }
    try {
      assertBinding();
      assertBoundary(start);
    } catch (error) {
      failure ??= { error };
    }
    // Keep the whole action denied after any failed guard, including when the
    // runner/validator catches it and a later authority read happens to recover.
    if (failure) throw failure.error;
  };
}

async function backgroundAction<T>(
  db: unknown,
  user: Parameters<typeof requireFreshHqSuperAdmin>[1],
  work: (
    coordinator: ReturnType<typeof createHqBackgroundCoordinator>
  ) => Promise<T>
): Promise<T> {
  const start = boundary();
  const binding = hqBackgroundBinding();
  const initialGuard = initialImportGuard(db, user, start);
  let failure: unknown = null;
  const guard = async () => {
    try {
      if (hqBackgroundBinding() !== binding)
        deny(
          "Management HQ configuration changed. Refresh to check current access."
        );
    } catch (error) {
      failure ??= error;
    }
    try {
      await initialGuard();
    } catch (error) {
      failure ??= error;
    }
    try {
      if (hqBackgroundBinding() !== binding)
        deny(
          "Management HQ configuration changed. Refresh to check current access."
        );
    } catch (error) {
      failure ??= error;
    }
    if (failure) throw failure;
  };
  await guard();
  let poolRuntime: typeof import("./management-hq-background-pool");
  let runtime: typeof import("./management-hq-background");
  try {
    poolRuntime = await import("./management-hq-background-pool");
    await guard();
    runtime = await import("./management-hq-background");
  } finally {
    await guard();
  }
  let pool: ReturnType<typeof poolRuntime.getHqBackgroundPool>;
  try {
    pool = poolRuntime.getHqBackgroundPool();
  } finally {
    await guard();
  }
  const authorize = async (actorId: number) => {
    await guard();
    try {
      await poolRuntime.requireHqBackgroundActor(pool, actorId);
    } finally {
      await guard();
    }
  };
  const coordinator = runtime.createHqBackgroundCoordinator({
    pool,
    authorize,
  });
  try {
    return await work(coordinator);
  } finally {
    await guard();
  }
}

async function readReport(
  db: unknown,
  user: Parameters<typeof requireFreshHqSuperAdmin>[1],
  input: z.infer<typeof range>,
  options?: HqReportOptions
) {
  const start = boundary();
  if (start.mode === "disabled")
    deny(
      "Management HQ reports are disabled. Values are unavailable, not zero."
    );
  if (start.mode === "live") {
    if (!start.configuration.configured || !start.configuration.readEnabled)
      deny(
        "Management HQ live reporting is awaiting connection or read approval. Values are unavailable, not zero."
      );
    const service = createHqLiveService({ config: start.config });
    const before = await service.getStatus();
    if (!before.hasPublished)
      deny(
        "Management HQ live reporting is awaiting a verified publication. Values are unavailable, not zero."
      );
    const state = await service.readPublished();
    if (!state)
      deny(
        "Management HQ live reporting is awaiting a verified publication. Values are unavailable, not zero."
      );
    const report = await getHqLiveReport(state, db, input, undefined, options);
    const after = await service.getStatus();
    if (after.stateVersion !== before.stateVersion)
      throw new Error("HQ_STATE_CHANGED");
    const result = withHqLiveReportMetadata(report, state, after);
    // Revalidate source binding/settings and current authority after every store/directory read.
    assertBoundary(start);
    await freshAuthority(db, user);
    assertBoundary(start);
    return { report: result, boundary: start };
  }
  requireHqSampleEnabled();
  const stored = await createHqSampleStore<HqImplementedState>(
    await getRawDbPool(),
    user
  ).read();
  if (!stored)
    deny("Load the synthetic sample to begin. No live values are available.");
  if (stored.state.wireVersion !== "1.0.0")
    deny(
      "Reload the implemented-contract synthetic sample. The previous draft sample is not a live checkpoint."
    );
  const report = await getHqReport(
    stored.state,
    createHqImplementedSampleDirectory(),
    input,
    options
  );
  await freshAuthority(db, user);
  assertBoundary(start);
  requireHqSampleEnabled();
  return {
    report: { ...report, sourceMode: "sample" as const },
    boundary: start,
  };
}

export const managementHqRouter = router({
  backgroundInitialImportStatus: procedure
    .input(z.void())
    .query(async ({ ctx }) => {
      try {
        if (!hqBackgroundEnabled()) {
          await freshAuthority(ctx.hqDb, ctx.user);
          if (hqBackgroundEnabled())
            deny(
              "Management HQ configuration changed. Refresh to check current access."
            );
          return { enabled: false, job: null };
        }
        return await backgroundAction(ctx.hqDb, ctx.user, c =>
          c.status(ctx.user.id)
        );
      } catch (error) {
        safeError(error);
      }
    }),
  startBackgroundInitialImport: procedure
    .input(z.void())
    .mutation(async ({ ctx }) => {
      try {
        return await backgroundAction(ctx.hqDb, ctx.user, c =>
          c.start(ctx.user.id)
        );
      } catch (error) {
        safeError(error);
      }
    }),
  pauseBackgroundInitialImport: procedure
    .input(z.void())
    .mutation(async ({ ctx }) => {
      try {
        return await backgroundAction(ctx.hqDb, ctx.user, c =>
          c.pause(ctx.user.id)
        );
      } catch (error) {
        safeError(error);
      }
    }),
  repairInitialImportCapacity: procedure
    .input(z.void())
    .mutation(async ({ ctx }) => {
      try {
        const start = boundary();
        const guard = initialImportGuard(ctx.hqDb, ctx.user, start);
        const result = await repairHqInitialCapacity({
          config: start.config,
          guard,
        });
        await guard();
        return result;
      } catch (error) {
        safeError(error);
      }
    }),
  finishInitialImportBatch: procedure
    .input(z.void())
    .mutation(async ({ ctx }) => {
      try {
        const start = boundary();
        const guard = initialImportGuard(ctx.hqDb, ctx.user, start);
        if (hqBackgroundEnabled())
          await backgroundAction(ctx.hqDb, ctx.user, c =>
            c.assertManualAllowed(ctx.user.id)
          );
        const result = await finishHqInitialBatch({
          config: start.config,
          guard,
        });
        await guard();
        return result;
      } catch (error) {
        safeError(error);
      }
    }),
  resumeInitialImport: procedure.input(z.void()).mutation(async ({ ctx }) => {
    try {
      const start = boundary();
      const guard = initialImportGuard(ctx.hqDb, ctx.user, start);
      const result = await resumeHqStagedInitialImport({
        config: start.config,
        guard,
      });
      await guard();
      return result;
    } catch (error) {
      safeError(error);
    }
  }),
  recoverInitialImport: procedure.input(z.void()).mutation(async ({ ctx }) => {
    try {
      const start = boundary();
      const guard = initialImportGuard(ctx.hqDb, ctx.user, start);
      const result = await recoverHqEmptyInitialImport({
        config: start.config,
        guard,
      });
      await guard();
      return result;
    } catch (error) {
      safeError(error);
    }
  }),
  importInitialBatch: procedure.input(z.void()).mutation(async ({ ctx }) => {
    try {
      const start = boundary();
      const guard = initialImportGuard(ctx.hqDb, ctx.user, start);
      if (hqBackgroundEnabled())
        await backgroundAction(ctx.hqDb, ctx.user, c =>
          c.assertManualAllowed(ctx.user.id)
        );
      const result = await importHqInitialBatch({
        config: start.config,
        guard,
      });
      await guard();
      return result;
    } catch (error) {
      safeError(error);
    }
  }),
  validateInitialImport: procedure.input(z.void()).mutation(async ({ ctx }) => {
    try {
      const start = boundary();
      const guard = initialImportGuard(ctx.hqDb, ctx.user, start);
      await guard();
      if (
        !start.configuration.configured ||
        !start.configuration.syncEnabled ||
        start.configuration.readEnabled
      )
        deny(
          "Initial publication checks require valid sync-on/read-off settings. Dashboards and automatic updates remain off."
        );
      const service = createHqLiveService({
        config: start.config,
        onlyInitialPublication: true,
        initialImportGuard: guard,
      });
      // Guard rejected awaits as well: provider/SQL failure is not permission to
      // release a stale result to a revoked actor or changed source binding.
      const read = async <T>(work: () => Promise<T>): Promise<T> => {
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
      };
      const validationStatus = () =>
        service.getValidationStatus?.() ?? service.getStatus();
      const before = await read(validationStatus);
      let result: HqInitialValidationResult;
      if (!before.hasPublished) {
        result = {
          status:
            before.health === "needs_attention"
              ? "needs_attention"
              : "awaiting_import",
          message:
            "A complete initial reporting publication is required. Partial staging is unavailable; manual checks remain pending.",
          generationId: null,
          checkedAt: new Date().toISOString(),
          sourcePublishedAt: null,
          isStale: null,
          years: [],
          manualChecksPending: true,
          limitations: [
            "Normal reports, read access and recurring updates are not enabled or accepted by these checks.",
          ],
        };
      } else {
        const state = await read(() => service.readValidationSnapshot());
        if (!state)
          deny(
            "A complete initial reporting publication could not be verified. No partial checks have been returned."
          );
        result = await read(() =>
          validateHqInitialPublication(state!, ctx.hqDb, before, guard)
        );
      }
      const after = await read(validationStatus);
      if (
        after.stateVersion !== before.stateVersion ||
        after.generationId !== before.generationId ||
        after.hasPublished !== before.hasPublished ||
        (result.status === "checks_ready" &&
          (after.health !== "ready" ||
            after.isStale !== false ||
            after.stageStatus !== before.stageStatus ||
            after.progress !== null ||
            after.lastErrorCode !== null ||
            after.recoveryGuidance !== null))
      )
        deny(
          "The reporting publication changed or could not be verified during initial checks. No partial checks have been returned."
        );
      await guard();
      return result;
    } catch (error) {
      safeError(error);
    }
  }),
  checkFirstBookingPage: procedure.input(z.void()).mutation(async ({ ctx }) => {
    try {
      const start = boundary();
      const guard = initialImportGuard(ctx.hqDb, ctx.user, start);
      const result = await checkHqFirstPage({ guard });
      await guard();
      return result;
    } catch (error) {
      safeError(error);
    }
  }),
  checkConnection: procedure.input(z.void()).mutation(async ({ ctx }) => {
    try {
      const start = boundary();
      const assertSourceBinding = captureHqConnectionBinding();
      const result = await checkHqConnection({
        beforeRequest: async () => {
          await freshAuthority(ctx.hqDb, ctx.user);
          assertBoundary(start);
        },
      });
      assertSourceBinding();
      await freshAuthority(ctx.hqDb, ctx.user);
      assertSourceBinding();
      assertBoundary(start);
      return result;
    } catch (error) {
      safeError(error);
    }
  }),
  status: procedure.query(async ({ ctx }) => {
    try {
      const start = boundary();
      const live = await createHqLiveService({
        config: start.config,
      }).getStatus();
      const stored =
        start.mode === "sample"
          ? await createHqSampleStore(await getRawDbPool(), ctx.user).read()
          : null;
      await freshAuthority(ctx.hqDb, ctx.user);
      assertBoundary(start);
      return {
        sampleEnabled: start.mode === "sample",
        liveConfigured: start.configuration.configured,
        hasSample: !!stored,
        stateVersion:
          start.mode === "live"
            ? live.stateVersion
            : (stored?.stateVersion ?? null),
        updatedAt:
          start.mode === "live"
            ? live.lastPublishedAt
            : (stored?.updatedAt ?? null),
        reportMode: start.mode,
        live,
      };
    } catch (error) {
      safeError(error);
    }
  }),
  sample: procedure
    .input(
      z
        .object({
          scenario: z.enum(["initial", "amended", "cancelled", "registered"]),
          expectedVersion: z.number().int().positive().nullable(),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const start = boundary();
        if (start.mode !== "sample")
          deny(
            "Sample scenarios are unavailable while live reporting is selected or reporting is disabled."
          );
        requireHqSampleEnabled();
        const state = await runHqImplementedSampleScenario(input.scenario);
        assertBoundary(start);
        const store = createHqSampleStore<HqImplementedState>(
          await getRawDbPool(),
          ctx.user
        );
        if (!(await store.publish(input.expectedVersion, state)))
          throw new HqBoundaryError({
            code: "CONFLICT",
            message:
              "The sample changed in another request. Refresh before trying again.",
          });
        await freshAuthority(ctx.hqDb, ctx.user);
        assertBoundary(start);
        return { stateVersion: (input.expectedVersion ?? 0) + 1 };
      } catch (error) {
        safeError(error);
      }
    }),
  report: procedure.input(reportRange).query(async ({ ctx, input }) => {
    try {
      const { detailPage, ...filters } = input;
      return (
        await readReport(ctx.hqDb, ctx.user, filters, {
          details: { kind: "page", page: detailPage ?? 0 },
        })
      ).report;
    } catch (error) {
      safeError(error);
    }
  }),
  exportCsv: procedure.input(range).query(async ({ ctx, input }) => {
    try {
      const result = await readReport(ctx.hqDb, ctx.user, input);
      const csv = exportHqReportCsv(result.report);
      // CSV generation is bounded but still sits inside the final authority/configuration gate.
      await freshAuthority(ctx.hqDb, ctx.user);
      assertBoundary(result.boundary);
      return {
        csv,
        filename: `management-hq-${result.boundary.mode === "live" ? "LIVE" : "SAMPLE"}-${input.year}${input.month ? `-${String(input.month).padStart(2, "0")}` : ""}.csv`,
      };
    } catch (error) {
      safeError(error);
    }
  }),
});
