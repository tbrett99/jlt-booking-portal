import { z } from "zod";
import { protectedProcedure } from "./_core/trpc";
import { assertSignupLinkAdmin, signupLinkState, searchCompletedSignups, previewSignupLink, confirmSignupLink } from "./recruitment-signup-link-service";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const pair = z.object({ prospectId: id, joinSessionId: id }).strict();
const activeAdmin = protectedProcedure.use(({ ctx, next }) => {
  assertSignupLinkAdmin(ctx.user);
  return next({ ctx });
});

/** Spread these into recruitmentRouter; no router or database mutation at import time. */
export const recruitmentSignupLinkProcedures = {
  signupLinkState: activeAdmin.input(z.object({ prospectId: id }).strict()).query(({ ctx, input }) => signupLinkState(ctx.user, input.prospectId)),
  searchCompletedSignups: activeAdmin.input(z.object({ search: z.string().trim().min(2).max(150), cursor: id.optional() }).strict()).query(({ ctx, input }) => searchCompletedSignups(ctx.user, input)),
  previewSignupLink: activeAdmin.input(pair).query(({ ctx, input }) => previewSignupLink(ctx.user, input)),
  confirmSignupLink: activeAdmin.input(z.object({ prospectId: id, joinSessionId: id, token: z.string().min(20).max(2000), reason: z.string().trim().min(5).max(1000), samePersonConfirmed: z.literal(true) }).strict()).mutation(({ ctx, input }) => confirmSignupLink(ctx.user, input)),
};
