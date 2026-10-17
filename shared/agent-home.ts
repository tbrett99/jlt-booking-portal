export type AgentHomeTileKey =
  | "academy"
  | "knowledge_base"
  | "webinars"
  | "suppliers"
  | "bookings"
  | "commissions"
  | "community"
  | "pricing";

export type AgentHomeTileTone = "mint" | "peach" | "lavender" | "sky";

export type AgentHomeTile = {
  key: AgentHomeTileKey;
  title: string;
  description: string;
  href?: string;
  tone: AgentHomeTileTone;
  comingSoon?: boolean;
};

/**
 * The agent homepage is intentionally a service hub rather than a booking list.
 * Academy and Knowledge Base stay visible but non-navigable until their agent
 * experience is formally launched.
 */
export const AGENT_HOME_TILES: readonly AgentHomeTile[] = [
  {
    key: "academy",
    title: "JLT Academy",
    description: "Your guided learning hub is on its way.",
    tone: "mint",
    comingSoon: true,
  },
  {
    key: "knowledge_base",
    title: "Knowledge Base",
    description: "Find trusted JLT answers in one place — coming soon.",
    tone: "lavender",
    comingSoon: true,
  },
  {
    key: "webinars",
    title: "Webinars & Events",
    description: "See live sessions, events and dates for your diary.",
    href: "/events",
    tone: "sky",
  },
  {
    key: "suppliers",
    title: "Supplier Directory",
    description: "Browse preferred partners, contacts and resources.",
    href: "/suppliers",
    tone: "lavender",
  },
  {
    key: "bookings",
    title: "Bookings & Requests",
    description: "Find a file, request an amendment, cancellation or flight.",
    href: "/my-bookings",
    tone: "peach",
  },
  {
    key: "commissions",
    title: "Commissions & Earnings",
    description: "Claim, track and understand your commission.",
    href: "/commissions",
    tone: "mint",
  },
  {
    key: "community",
    title: "Community & Wins",
    description: "Business updates, agent stories, competitions and more.",
    href: "/community",
    tone: "lavender",
  },
  {
    key: "pricing",
    title: "Pricing & Fees",
    description: "Use the package pricing calculator and fee guides.",
    href: "/pricing-calculator",
    tone: "peach",
  },
] as const;

export function countAgentBookingActions(counts: {
  bookingQueries: number;
  ptsActions: number;
  missingDocuments: number;
  flightQueries: number;
  topUps: number;
}) {
  return counts.bookingQueries + counts.ptsActions + counts.missingDocuments + counts.flightQueries + counts.topUps;
}
