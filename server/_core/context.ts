import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import type { BusinessStaffAuthority } from "../business-staff-access";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /** Set only by server middleware, never from procedure input or session roles. */
  businessStaffAuthority?: BusinessStaffAuthority | null;
};

// Portal statuses that block all access
const BLOCKED_PORTAL_STATUSES = ['cancelled', 'paused', 'suspended'];

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
    // Deactivation is authoritative for every role, including already-issued admin sessions.
    // SDK-verified synthetic cron identities (id -1) are not database accounts.
    // Existing cancelled/paused/suspended restrictions remain unchanged.
    if (user && ((user.id > 0 && user.isActive !== true) || BLOCKED_PORTAL_STATUSES.includes((user as any).portalStatus))) {
      user = null;
    }
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
