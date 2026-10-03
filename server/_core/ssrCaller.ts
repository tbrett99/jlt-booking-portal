import type { Request, Response } from "express";
import { appRouter } from "../routers";
import { createContext } from "./context";

/** Public-only SSR allowlist. No private Portal data is ever prefetched into HTML. */
export async function buildConsumerSsrPrefetch(req: Request, res: Response) {
  // The Express adapter type includes an internal `info` field which is not
  // consumed by this project's context factory; request/response are the only
  // runtime inputs used for public-procedure SSR.
  const context = await createContext({ req, res } as any);
  const caller = appRouter.createCaller(context);
  return {
    siteSettings: () => caller.consumerSite.public.siteSettings(),
    tags: () => caller.consumerSite.tags.list(),
    listAgents: (input?: any) => caller.consumerSite.public.listAgents(input),
    listShowcases: (input?: any) => caller.consumerSite.public.listShowcases(input),
    listPartners: () => caller.consumerSite.public.listPartners(),
    getAgent: (input: { slug: string }) => caller.consumerSite.public.getAgent(input),
    listShowcasesForAgent: (input: { agentSlug: string }) => caller.consumerSite.public.listShowcasesForAgent(input),
    getShowcase: (input: { agentSlug: string; showcaseSlug: string }) => caller.consumerSite.public.getShowcase(input),
  };
}
