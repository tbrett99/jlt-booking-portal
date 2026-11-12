import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { makeTermsReviewDraft } from "./terms-review-draft";

const reviewProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (
    ctx.user.isActive !== true ||
    (ctx.user.role !== "admin" && ctx.user.role !== "super_admin")
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only administrators can review draft terms.",
    });
  }
  return next({ ctx });
});

export const termsReviewRouter = router({
  draft: reviewProcedure.input(z.undefined()).query(() => {
    try {
      return makeTermsReviewDraft();
    } catch {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "The terms review draft is unavailable. No published terms have been changed.",
      });
    }
  }),
});
