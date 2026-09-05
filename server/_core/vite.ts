import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    // Let Express handle server-side routes — don't serve the React SPA for these paths
    if (url.startsWith("/pay/") || url.startsWith("/api/")) {
      return next();
    }

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function isVersionedBuildAsset(filePath: string): boolean {
  const normalizedPath = filePath.split(path.sep).join("/");
  return normalizedPath.includes("/assets/") || normalizedPath.startsWith("assets/");
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  // Vite filenames inside /assets are content-hashed on every build. Browsers can
  // therefore cache them for a year without serving stale application code after a
  // deployment. Keep index.html and public root files revalidated so they always
  // reference the current build's assets.
  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), {
      maxAge: "1y",
      immutable: true,
    })
  );
  app.use(express.static(distPath, { index: false }));

  // fall through to index.html if the file doesn't exist
  // but let Express handle server-side routes like /pay/:token
  app.use("*", (req, res, next) => {
    if (req.originalUrl.startsWith("/pay/") || req.originalUrl.startsWith("/api/")) {
      return next();
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
