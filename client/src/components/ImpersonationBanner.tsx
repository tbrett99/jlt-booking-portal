import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";

/**
 * Detects whether the current session is an impersonation session by checking
 * for the presence of the admin backup cookie (set server-side when impersonation
 * starts). Shows a sticky banner with the impersonated user's name and a button
 * to stop impersonating and restore the admin session.
 */
export function ImpersonationBanner() {
  const { user } = useAuth();
  const stopImpersonating = trpc.users.stopImpersonating.useMutation({
    onSuccess: () => {
      toast.success("Returned to your admin account");
      window.location.href = "/users";
    },
    onError: (err) => toast.error(err.message || "Failed to stop impersonation"),
  });

  // Detect impersonation by checking for the backup cookie in document.cookie.
  // The cookie is httpOnly=false on the backup so we can read it client-side.
  // Actually, both cookies are httpOnly — so we rely on the server to tell us.
  // We use a simple heuristic: if the user's role is "agent" but there's a
  // backup cookie present. Since httpOnly cookies aren't readable in JS, we
  // instead expose the impersonation state via the auth.me endpoint by checking
  // if the user is an agent (agents can't normally access admin pages, so if
  // we're on an admin page as an agent, we must be impersonating).
  //
  // A cleaner approach: the server sets a non-httpOnly flag cookie "is_impersonating=1"
  // alongside the httpOnly session cookies. We read that here.
  const isImpersonating = (() => {
    try {
      return document.cookie.split(";").some((c) => c.trim().startsWith("is_impersonating=1"));
    } catch {
      return false;
    }
  })();

  if (!isImpersonating || !user) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-4 px-4 py-2 bg-amber-400 text-amber-950 shadow-md">
      <div className="flex items-center gap-2 font-medium text-sm">
        <ShieldAlert size={16} />
        <span>
          You are viewing the portal as <strong>{user.name ?? user.email}</strong>. Changes made here will affect their account.
        </span>
      </div>
      <button
        onClick={() => stopImpersonating.mutate()}
        disabled={stopImpersonating.isPending}
        className="shrink-0 rounded-md bg-amber-950 text-amber-50 px-3 py-1 text-xs font-semibold hover:bg-amber-900 disabled:opacity-60 transition-colors"
      >
        {stopImpersonating.isPending ? "Restoring…" : "Stop Impersonating"}
      </button>
    </div>
  );
}
