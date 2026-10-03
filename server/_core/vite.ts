import express, { type Express, type Request } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { pathToFileURL } from "url";
import { createServer as createViteServer } from "vite";
import superjson from "superjson";
import viteConfig from "../../vite.config";
import { buildConsumerSsrPrefetch } from "./ssrCaller";

type ConsumerRenderResult = {
  html: string;
  dehydratedState: unknown;
  head: {
    title: string;
    description: string;
    canonicalPath: string;
    ogType?: "website" | "article";
    ogImage?: string;
    noindex?: boolean;
    notFound?: boolean;
  };
};
type ConsumerRenderer = {
  renderConsumerSite: (url: string, prefetch: Awaited<ReturnType<typeof buildConsumerSsrPrefetch>>) => Promise<ConsumerRenderResult>;
};

const PUBLIC_HOSTS = new Set(["www.thejltgroup.co.uk", "thejltgroup.co.uk"]);
const SITE_NAME = "The JLT Group";
const DEFAULT_DESCRIPTION = "Meet independent JLT travel experts and discover a more personal way to arrange your next trip.";

function isConsumerRequest(req: Request) {
  return PUBLIC_HOSTS.has(req.hostname.toLowerCase()) || req.path === "/consumer" || req.path.startsWith("/consumer/");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function absoluteUrl(origin: string, value?: string) {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  return `${origin}${value.startsWith("/") ? value : `/${value}`}`;
}

function composeHtml(template: string, result?: ConsumerRenderResult) {
  const head = result?.head ?? { title: `${SITE_NAME} Booking Portal`, description: "Secure portal for JLT Group travel experts.", canonicalPath: "/", noindex: true };
  const canonicalOrigin = process.env.CANONICAL_ORIGIN || "https://www.thejltgroup.co.uk";
  const canonicalUrl = `${canonicalOrigin}${head.canonicalPath === "/" ? "" : head.canonicalPath}`;
  const ogImage = absoluteUrl(canonicalOrigin, head.ogImage);
  const robots = head.notFound || head.noindex ? "noindex,nofollow" : "index,follow";
  const headHtml = [
    `<title>${escapeHtml(head.title)}</title>`,
    `<meta name="description" content="${escapeHtml(head.description)}" />`,
    `<meta name="robots" content="${robots}" />`,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:type" content="${head.ogType ?? "website"}" />`,
    `<meta property="og:title" content="${escapeHtml(head.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(head.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
    ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}" />` : "",
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(head.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(head.description)}" />`,
  ].filter(Boolean).join("\n    ");
  const serialisedState = result ? JSON.stringify(superjson.serialize(result.dehydratedState)).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026") : "null";
  const stateScript = `<script>window.__RQ_STATE__=${serialisedState};</script>`;
  return template
    .replace("<!--app-head-->", () => `${headHtml}\n    ${stateScript}`)
    .replace("<!--app-html-->", () => result?.html ?? "");
}

async function renderConsumer(req: Request, res: express.Response, renderer: ConsumerRenderer, template: string) {
  const prefetch = await buildConsumerSsrPrefetch(req, res);
  const result = await renderer.renderConsumerSite(req.originalUrl, prefetch);
  res.status(result.head.notFound ? 404 : 200)
    .set({ "Content-Type": "text/html", "Cache-Control": "no-cache" })
    .end(composeHtml(template, result));
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = { middlewareMode: true, hmr: { server }, allowedHosts: true as const };
  const vite = await createViteServer({ ...viteConfig, configFile: false, server: serverOptions, appType: "custom" });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    if (url.startsWith("/pay/") || url.startsWith("/api/")) return next();
    try {
      const clientTemplate = path.resolve(import.meta.dirname, "../..", "client", "index.html");
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace('src="/src/entry-client.tsx"', `src="/src/entry-client.tsx?v=${nanoid()}"`);
      template = await vite.transformIndexHtml(url, template);
      if (isConsumerRequest(req)) {
        const mod = await vite.ssrLoadModule("/src/entry-server.tsx") as ConsumerRenderer;
        await renderConsumer(req, res, mod, template);
        return;
      }
      res.status(200).set({ "Content-Type": "text/html", "Cache-Control": "no-cache" }).end(composeHtml(template));
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });
}

export function isVersionedBuildAsset(filePath: string): boolean {
  const normalizedPath = filePath.split(path.sep).join("/");
  return normalizedPath.includes("/assets/") || normalizedPath.startsWith("assets/");
}

export function serveStatic(app: Express) {
  const distPath = process.env.NODE_ENV === "development" ? path.resolve(import.meta.dirname, "../..", "dist", "public") : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) console.error("Could not find the build directory: make sure to build the client first");
  const templatePath = path.join(distPath, "index.html");
  const ssrBundlePath = path.resolve(import.meta.dirname, "server-ssr", "entry-server.js");
  let rendererPromise: Promise<ConsumerRenderer> | null = null;
  const getRenderer = () => rendererPromise ??= import(pathToFileURL(ssrBundlePath).href) as Promise<ConsumerRenderer>;

  app.use("/assets", express.static(path.join(distPath, "assets"), { maxAge: "1y", immutable: true, redirect: false }));
  app.use(express.static(distPath, { index: false, redirect: false }));
  app.use("*", async (req, res, next) => {
    if (req.originalUrl.startsWith("/pay/") || req.originalUrl.startsWith("/api/")) return next();
    if (!isConsumerRequest(req)) {
      res.status(200).set({ "Content-Type": "text/html", "Cache-Control": "no-cache" }).end(composeHtml(await fs.promises.readFile(templatePath, "utf-8")));
      return;
    }
    try {
      const template = await fs.promises.readFile(templatePath, "utf-8");
      await renderConsumer(req, res, await getRenderer(), template);
    } catch (error) {
      console.error("[SSR] render failed", error);
      const template = await fs.promises.readFile(templatePath, "utf-8");
      res.status(200).set({ "Content-Type": "text/html", "Cache-Control": "no-cache" }).end(composeHtml(template));
    }
  });
}
