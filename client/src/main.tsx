import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Disable refetch-on-window-focus globally.
      // Without this, every time the admin opens a document in a new tab and returns,
      // React Query re-fetches all active queries — including commissionDue.list and
      // bookings lists — which makes recently-actioned items reappear if the mutation
      // cache has already been cleared. Individual queries that genuinely need fresh
      // data on focus can opt back in with refetchOnWindowFocus: true.
      refetchOnWindowFocus: false,
    },
  },
});

// Paths that are intentionally public — never redirect to Manus OAuth from these.
const PUBLIC_PATHS = [
  "/apply",
  "/apply/embed",
  "/apply/form",
  "/terms",
  "/unsubscribe",
  "/enquiry",
  "/sign-contract",
  "/membership",
  "/register",
  "/join",
  "/payment",
  "/pay",
  "/login",
  "/reset-password",
];

const isPublicPath = () => {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname;
  return PUBLIC_PATHS.some(p => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"));
};

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;
  // Never redirect to Manus OAuth from public pages — they don't require login.
  if (isPublicPath()) return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      async fetch(input, init) {
        const response = await globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
        // If the gateway returns plain text (e.g. "Rate exceeded.") instead of JSON,
        // wrap it in a valid tRPC error response so superjson doesn't throw a SyntaxError.
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
          const text = await response.text();
          const isRateLimit = response.status === 429 || text.toLowerCase().includes("rate");
          const message = isRateLimit
            ? "The server is temporarily busy — please wait a moment and try again."
            : `Server error (${response.status}): ${text.slice(0, 120)}`;
          return new Response(
            JSON.stringify([{ error: { message, code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: response.status } } }]),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return response;
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
