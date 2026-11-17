import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
// Business employees never inherit the independent-agent or JLT-staff APIs.
// The registry is rechecked per request; revoked links remain restrictive.
const businessStaffBoundary = t.middleware(async opts => {
  if (opts.ctx.user?.role === "agent") {
    const { assertBusinessStaffRouteAllowed } = await import("../business-staff-access");
    await assertBusinessStaffRouteAllowed(opts.ctx.user, opts.path);
  }
  return opts.next();
});
export const publicProcedure = t.procedure.use(businessStaffBoundary);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser).use(businessStaffBoundary);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || (ctx.user.role !== 'admin' && ctx.user.role !== 'super_admin')) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
).use(businessStaffBoundary);
