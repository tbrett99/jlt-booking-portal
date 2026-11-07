import { z } from "zod";
import { AGREEMENT_SOURCES } from "../shared/my-agreements";
import { protectedProcedure, router } from "./_core/trpc";
import {
  myAgreementDetail,
  myAgreementSummaries,
} from "./my-agreements-service";

export const myAgreementsRouter = router({
  mine: protectedProcedure
    .input(z.undefined())
    .query(({ ctx }) => myAgreementSummaries(ctx.user.id)),
  detail: protectedProcedure
    .input(
      z
        .object({
          source: z.enum(AGREEMENT_SOURCES),
          id: z.number().int().positive(),
        })
        .strict()
    )
    .query(({ ctx, input }) =>
      myAgreementDetail(ctx.user.id, input.source, input.id)
    ),
});
