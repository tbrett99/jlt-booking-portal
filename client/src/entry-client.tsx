import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { HydrationBoundary, QueryClient, QueryClientProvider, type DehydratedState } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot, hydrateRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import ConsumerSiteShell from "./ConsumerSiteShell";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 30_000 } },
});

const PUBLIC_PATHS = ["/apply", "/apply/embed", "/apply/form", "/terms", "/unsubscribe", "/enquiry", "/sign-contract", "/membership", "/register", "/join", "/payment", "/pay", "/login", "/reset-password"];
const isConsumerSite = () => ["www.thejltgroup.co.uk", "thejltgroup.co.uk"].includes(window.location.hostname.toLowerCase()) || window.location.pathname.startsWith("/consumer");
const isPublicPath = () => isConsumerSite() || PUBLIC_PATHS.some(path => window.location.pathname === path || window.location.pathname.startsWith(`${path}/`));
const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError) || !isPublicPath() || error.message !== UNAUTHED_ERR_MSG) return;
  window.location.href = getLoginUrl();
};
queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    redirectToLoginIfUnauthorized(event.query.state.error);
    console.error("[API Query Error]", event.query.state.error);
  }
});
queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    redirectToLoginIfUnauthorized(event.mutation.state.error);
    console.error("[API Mutation Error]", event.mutation.state.error);
  }
});

const trpcClient = trpc.createClient({
  links: [httpBatchLink({
    url: "/api/trpc",
    transformer: superjson,
    async fetch(input, init) {
      const response = await globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
        const text = await response.text();
        const message = response.status === 429 || text.toLowerCase().includes("rate") ? "The server is temporarily busy — please wait a moment and try again." : `Server error (${response.status}): ${text.slice(0, 120)}`;
        return new Response(JSON.stringify([{ error: { message, code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: response.status } } }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      return response;
    },
  })],
});

const root = document.getElementById("root")!;
const publicSite = isConsumerSite();
const rawState = (window as any).__RQ_STATE__;
const state = (rawState ? superjson.deserialize(rawState) : undefined) as DehydratedState | undefined;
const tree = <trpc.Provider client={trpcClient} queryClient={queryClient}><QueryClientProvider client={queryClient}><HydrationBoundary state={state}>{publicSite ? <ConsumerSiteShell /> : <App />}</HydrationBoundary></QueryClientProvider></trpc.Provider>;

if (publicSite) hydrateRoot(root, tree);
else createRoot(root).render(tree);
