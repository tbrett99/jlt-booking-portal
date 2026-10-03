import { renderToString } from "react-dom/server";
import { dehydrate, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { Router } from "wouter";
import { trpc } from "@/lib/trpc";
import ConsumerSiteShell from "./ConsumerSiteShell";
import { prefetchForPath, type HeadMeta, type SsrPrefetch } from "./ssr/prefetch";

export type ConsumerSsrRender = {
  html: string;
  dehydratedState: unknown;
  head: HeadMeta;
};

export async function renderConsumerSite(url: string, prefetch: SsrPrefetch): Promise<ConsumerSsrRender> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  const splitAt = url.indexOf("?");
  const ssrPath = splitAt === -1 ? url : url.slice(0, splitAt);
  const ssrSearch = splitAt === -1 ? "" : url.slice(splitAt + 1);
  const head = await prefetchForPath(url, queryClient, prefetch);
  const trpcClient = trpc.createClient({ links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })] });
  const html = renderToString(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <Router ssrPath={ssrPath} ssrSearch={ssrSearch}>
          <ConsumerSiteShell />
        </Router>
      </QueryClientProvider>
    </trpc.Provider>,
  );
  return { html, dehydratedState: dehydrate(queryClient), head };
}
