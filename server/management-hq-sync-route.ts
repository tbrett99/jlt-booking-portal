import type { Express, Request, Response } from "express";
import {
  createHqLiveService,
  type HqLiveService,
} from "./management-hq-live-service";
import { safeHqLiveErrorCode } from "./management-hq-live-store";
export const HQ_SYNC_MAX_BODY_BYTES = 1024;
export const HQ_SYNC_PATH = "/api/scheduled/management-hq-sync";

/** Finite external Railway-style token callback only. No timers or schedule creation. */
export function createManagementHqSyncHandler(
  createService: () => HqLiveService = createHqLiveService
) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).json({ ok: false, message: "POST required." });
      return;
    }
    const header = req.headers.authorization;
    const duplicate =
      (req.rawHeaders ?? []).filter(
        (value, index) =>
          index % 2 === 0 && value.toLowerCase() === "authorization"
      ).length > 1;
    let service: HqLiveService;
    try {
      service = createService();
      const configuration = service.configurationStatus();
      if (
        !configuration.syncEnabled ||
        !configuration.configured ||
        duplicate ||
        typeof header !== "string" ||
        header.length > 263 ||
        !/^Bearer [\x21-\x7e]{32,256}$/.test(header) ||
        !service.authorizeTrigger(header.slice(7))
      ) {
        res.status(401).json({ ok: false, message: "Unauthorized" });
        return;
      }
    } catch {
      res.status(401).json({ ok: false, message: "Unauthorized" });
      return;
    }
    const length = req.headers["content-length"];
    if (
      length !== undefined &&
      (typeof length !== "string" ||
        !/^(0|[1-9][0-9]*)$/.test(length) ||
        Number(length) > HQ_SYNC_MAX_BODY_BYTES)
    ) {
      res.status(413).json({ ok: false, message: "Request too large." });
      return;
    }
    try {
      // Mounted before JSON/form parsing. Count raw bytes, never parse caller-supplied IDs,
      // limits, URLs, cursors or keys; even unknown or malformed JSON is inert.
      let bytes = 0;
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > HQ_SYNC_MAX_BODY_BYTES) {
          res.status(413).json({ ok: false, message: "Request too large." });
          return;
        }
      }
      const result = await service.invoke();
      if (result.status === "needs_attention") {
        res.status(503).json({
          ok: false,
          status: "needs_attention",
          errorCode: safeHqLiveErrorCode(result.errorCode),
          message: "Management HQ synchronisation needs attention.",
        });
        return;
      }
      res.status(200).json({ ok: true, status: result.status });
    } catch {
      res.status(503).json({
        ok: false,
        status: "needs_attention",
        errorCode: "SOURCE_OR_STORE_UNAVAILABLE",
        message: "Management HQ synchronisation needs attention.",
      });
    }
  };
}
export function registerManagementHqSyncRoute(app: Express) {
  app.all(HQ_SYNC_PATH, createManagementHqSyncHandler());
}
