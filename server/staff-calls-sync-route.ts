import type { Express, Request, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";

export function staffCallSyncAuthorized(
  header: unknown,
  configured: string | undefined
): boolean {
  // Missing/short secrets disable the callback. No shared export/recruitment key.
  if (
    !configured ||
    configured.length < 32 ||
    configured.length > 512 ||
    typeof header !== "string" ||
    header.length > 520 ||
    !header.startsWith("Bearer ")
  )
    return false;
  const supplied = header.slice(7);
  if (supplied.length < 32 || supplied.length > 512) return false;
  return timingSafeEqual(
    createHash("sha256").update(supplied).digest(),
    createHash("sha256").update(configured).digest()
  );
}
export function createStaffCallsSyncHandler(run?: () => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !staffCallSyncAuthorized(
        req.headers.authorization,
        process.env.JLT_STAFF_CAL_SYNC_TOKEN
      )
    ) {
      res.status(401).json({ ok: false, message: "Unauthorized" });
      return;
    }
    try {
      // Fixed bounded scope: ignore request body, caller IDs, headers and limits.
      if (run) await run();
      else {
        const { reconcileStaffCallsBatch } = await import(
          "./staff-calls-service"
        );
        await reconcileStaffCallsBatch({ limit: 25, deadlineMs: 90000 });
      }
      res.json({ ok: true });
    } catch {
      // Do not expose stored notes, calendar identity, provider error bodies or SQL.
      res.status(503).json({
        ok: false,
        message: "Staff-call synchronisation needs attention.",
      });
    }
  };
}
export function registerStaffCallsSyncRoute(app: Express) {
  app.post("/api/scheduled/staff-call-sync", createStaffCallsSyncHandler());
}
