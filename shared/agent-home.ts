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
 * The Academy, Knowledge Base and Webinar Library are active agent destinations
 * with distinct learning purposes and navigation routes.
 */
export const AGENT_HOME_TILES: readonly AgentHomeTile[] = [
  {
    key: "academy",
    title: "JLT Academy",
    description: "Open your assigned JLT learning pathway and keep your progress moving.",
    href: "/academy",
    tone: "mint",
  },
  {
    key: "knowledge_base",
    title: "Knowledge Base",
    description: "Find trusted JLT guidance, processes and practical answers.",
    href: "/knowledge-base",
    tone: "lavender",
  },
  {
    key: "webinars",
    title: "Webinar Library",
    description: "Watch recorded business-development calls and practical JLT sessions.",
    href: "/webinars",
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
