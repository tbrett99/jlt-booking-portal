import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb, getRawDbPool } from "./db";
import { getHqReport, exportHqReportCsv } from "./management-hq-engine";
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
const procedure = protectedProcedure.use(async ({ ctx, next }) => {
  const db = await getDb();
  await requireFreshHqSuperAdmin(db, ctx.user);
  return next({ ctx: { ...ctx, hqDb: db! } });
});
const range = z
  .object({
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12).optional(),
  })
  .strict();
function safeError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "Management HQ sample data could not be verified. No partial totals or live changes have been applied.",
  });
}
export const managementHqRouter = router({
  status: procedure.query(async ({ ctx }) => {
    try {
      const enabled = hqSampleEnabled();
      const stored = enabled
        ? await createHqSampleStore(await getRawDbPool(), ctx.user).read()
        : null;
      await requireFreshHqSuperAdmin(ctx.hqDb, ctx.user);
      return {
        sampleEnabled: enabled,
        liveConfigured: false as const,
        hasSample: !!stored,
        stateVersion: stored?.stateVersion ?? null,
        updatedAt: stored?.updatedAt ?? null,
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
      requireHqSampleEnabled();
      try {
        const state = await runHqImplementedSampleScenario(input.scenario);
        const store = createHqSampleStore<HqImplementedState>(
          await getRawDbPool(),
          ctx.user
        );
        if (!(await store.publish(input.expectedVersion, state)))
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The sample changed in another request. Refresh before trying again.",
          });
        await requireFreshHqSuperAdmin(ctx.hqDb, ctx.user);
        return { stateVersion: (input.expectedVersion ?? 0) + 1 };
      } catch (error) {
        safeError(error);
      }
    }),
  report: procedure.input(range).query(async ({ ctx, input }) => {
    requireHqSampleEnabled();
    try {
      const stored = await createHqSampleStore<HqImplementedState>(
        await getRawDbPool(),
        ctx.user
      ).read();
      if (!stored)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Load the synthetic sample to begin. No live Orbit connection is configured.",
        });
      if (stored.state.wireVersion !== "1.0.0")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Reload the implemented-contract synthetic sample. The previous draft sample is not a live checkpoint.",
        });
      const report = await getHqReport(
        stored.state,
        createHqImplementedSampleDirectory(),
        input
      );
      await requireFreshHqSuperAdmin(ctx.hqDb, ctx.user);
      requireHqSampleEnabled();
      return report;
    } catch (error) {
      safeError(error);
    }
  }),
  exportCsv: procedure.input(range).query(async ({ ctx, input }) => {
    requireHqSampleEnabled();
    try {
      const stored = await createHqSampleStore<HqImplementedState>(
        await getRawDbPool(),
        ctx.user
      ).read();
      if (!stored)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Load the synthetic sample to begin.",
        });
      if (stored.state.wireVersion !== "1.0.0")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Reload the implemented-contract synthetic sample before exporting.",
        });
      const report = await getHqReport(
        stored.state,
        createHqImplementedSampleDirectory(),
        input
      );
      const csv = exportHqReportCsv(report);
      await requireFreshHqSuperAdmin(ctx.hqDb, ctx.user);
      requireHqSampleEnabled();
      return {
        csv,
        filename: `management-hq-SAMPLE-${input.year}${input.month ? `-${String(input.month).padStart(2, "0")}` : ""}.csv`,
      };
    } catch (error) {
      safeError(error);
    }
  }),
});
