import type { QueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { trpc } from "@/lib/trpc";

export type HeadMeta = {
  title: string;
  description: string;
  canonicalPath: string;
  ogType?: "website" | "article";
  ogImage?: string;
  noindex?: boolean;
  notFound?: boolean;
};

export type SsrPrefetch = {
  siteSettings: () => Promise<any>;
  tags: () => Promise<any>;
  listAgents: (input?: any) => Promise<any>;
  listShowcases: (input?: any) => Promise<any>;
  listPartners: () => Promise<any>;
  getAgent: (input: { slug: string }) => Promise<any>;
  listShowcasesForAgent: (input: { agentSlug: string }) => Promise<any>;
  getShowcase: (input: { agentSlug: string; showcaseSlug: string }) => Promise<any>;
};

const SITE = "The JLT Group";
const DEFAULT_DESCRIPTION = "Meet independent JLT travel experts and discover a more personal way to arrange your next trip.";
const HOLIDAY_FILTERS = { search: undefined, destination: undefined, travelPeriod: undefined, priceBand: undefined, durationBand: undefined };
const AGENT_FILTERS = { search: undefined, tagIds: [] as number[] };

function cleanPath(url: string) {
  let pathname = url.split("?")[0] || "/";
  try { pathname = decodeURI(pathname); } catch { /* preserve malformed path for 404 */ }
  if (pathname.startsWith("/consumer")) pathname = pathname.slice("/consumer".length) || "/";
  return pathname.replace(/\/+$/, "") || "/";
}

function seed(queryClient: QueryClient, key: unknown, data: unknown) {
  queryClient.setQueryData(key as any, data);
}

function staticHead(path: string): HeadMeta | null {
  const pages: Record<string, Pick<HeadMeta, "title" | "description">> = {
    "/why-jlt": { title: `Why book with JLT | ${SITE}`, description: "Discover the value of independent travel expertise from the JLT Group." },
    "/about": { title: `About The JLT Group | ${SITE}`, description: "Find out how The JLT Group supports independent travel experts and their customers." },
    "/your-protection": { title: `Your travel protection | ${SITE}`, description: "A clear introduction to PTS, ATOL, SFI and SAFI protection for JLT travel arrangements." },
    "/atol-protection": { title: `ATOL protection | ${SITE}`, description: "Understand when ATOL protection applies and what your ATOL Certificate confirms." },
    "/how-your-money-is-protected": { title: `How your money is protected | ${SITE}`, description: "Understand the PTS framework and how JLT explains booking-specific protection." },
    "/why-jlt-is-on-my-booking": { title: `Why JLT is on my booking | ${SITE}`, description: "Understand the relationship between your independent travel agent and The JLT Group." },
    "/contact": { title: `Customer contact | ${SITE}`, description: "Customer-routing support for travellers who genuinely cannot identify or reach their JLT travel agent." },
    "/privacy": { title: `Privacy notice | ${SITE}`, description: "How The JLT Group handles public website enquiries and customer-routing requests." },
    "/terms": { title: `Website terms | ${SITE}`, description: "Website terms for The JLT Group consumer website." },
  };
  const page = pages[path];
  return page ? { ...page, canonicalPath: path } : null;
}

function isNotFound(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "NOT_FOUND");
}

export async function prefetchForPath(url: string, queryClient: QueryClient, prefetch: SsrPrefetch): Promise<HeadMeta> {
  const path = cleanPath(url);
  const staticPage = staticHead(path);
  if (staticPage) return staticPage;

  if (path === "/") {
    const [agents, showcases, settings] = await Promise.all([prefetch.listAgents(), prefetch.listShowcases(), prefetch.siteSettings()]);
    seed(queryClient, getQueryKey(trpc.consumerSite.public.listAgents, undefined, "query"), agents);
    seed(queryClient, getQueryKey(trpc.consumerSite.public.listShowcases, undefined, "query"), showcases);
    seed(queryClient, getQueryKey(trpc.consumerSite.public.siteSettings, undefined, "query"), settings);
    return { title: `${SITE} | Travel, personally arranged`, description: DEFAULT_DESCRIPTION, canonicalPath: "/" };
  }

  if (path === "/find-an-agent") {
    const [tags, agents] = await Promise.all([prefetch.tags(), prefetch.listAgents(AGENT_FILTERS)]);
    seed(queryClient, getQueryKey(trpc.consumerSite.tags.list, undefined, "query"), tags);
    seed(queryClient, getQueryKey(trpc.consumerSite.public.listAgents, AGENT_FILTERS, "query"), agents);
    return { title: `Find a JLT travel expert | ${SITE}`, description: "Find an approved independent JLT travel expert by destination, travel style or town.", canonicalPath: path };
  }

  if (path === "/holiday-ideas") {
    const [filtered, all] = await Promise.all([prefetch.listShowcases(HOLIDAY_FILTERS), prefetch.listShowcases()]);
    seed(queryClient, getQueryKey(trpc.consumerSite.public.listShowcases, HOLIDAY_FILTERS, "query"), filtered);
    seed(queryClient, getQueryKey(trpc.consumerSite.public.listShowcases, undefined, "query"), all);
    return { title: `Holiday ideas | ${SITE}`, description: "Explore public holiday ideas personally curated by active, approved JLT travel experts.", canonicalPath: path };
  }

  if (path === "/partners") {
    const partners = await prefetch.listPartners();
    seed(queryClient, getQueryKey(trpc.consumerSite.public.listPartners, undefined, "query"), partners);
    return { title: `Travel partners | ${SITE}`, description: "Meet the travel partners that help JLT experts shape the right holiday.", canonicalPath: path };
  }

  const showcaseMatch = path.match(/^\/travel-agents\/([^/]+)\/holiday-showcases\/([^/]+)$/);
  if (showcaseMatch) {
    const [, agentSlug, showcaseSlug] = showcaseMatch;
    try {
      const detail = await prefetch.getShowcase({ agentSlug, showcaseSlug });
      seed(queryClient, getQueryKey(trpc.consumerSite.public.getShowcase, { agentSlug, showcaseSlug }, "query"), detail);
      return { title: `${detail.showcase.title} | ${detail.agent.displayName} | JLT`, description: `${detail.showcase.summary} Explore ${detail.showcase.destination} with ${detail.agent.displayName}, an independent JLT travel expert.`.slice(0, 300), canonicalPath: path, ogType: "article", ogImage: detail.showcase.heroImageUrl };
    } catch (error) {
      if (isNotFound(error)) return { title: `Holiday idea not found | ${SITE}`, description: DEFAULT_DESCRIPTION, canonicalPath: path, notFound: true, noindex: true };
      throw error;
    }
  }

  const agentMatch = path.match(/^\/travel-agents\/([^/]+)$/);
  if (agentMatch) {
    const agentSlug = agentMatch[1];
    try {
      const [agent, showcases] = await Promise.all([prefetch.getAgent({ slug: agentSlug }), prefetch.listShowcasesForAgent({ agentSlug })]);
      seed(queryClient, getQueryKey(trpc.consumerSite.public.getAgent, { slug: agentSlug }, "query"), agent);
      seed(queryClient, getQueryKey(trpc.consumerSite.public.listShowcasesForAgent, { agentSlug }, "query"), showcases);
      return { title: `${agent.displayName} | JLT travel expert`, description: `${agent.displayName} is an independent JLT travel expert based in ${agent.listingTown}.`, canonicalPath: path, ogType: "article", ogImage: agent.profilePhotoUrl ?? undefined };
    } catch (error) {
      if (isNotFound(error)) return { title: `Travel expert not found | ${SITE}`, description: DEFAULT_DESCRIPTION, canonicalPath: path, notFound: true, noindex: true };
      throw error;
    }
  }

  return { title: `Page not found | ${SITE}`, description: DEFAULT_DESCRIPTION, canonicalPath: path, notFound: true, noindex: true };
}
