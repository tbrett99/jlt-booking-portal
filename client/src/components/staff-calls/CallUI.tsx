import type { ReactNode } from "react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { Button } from "@/components/ui/button";

export type CallInputs = inferRouterInputs<AppRouter>["staffCalls"];
export type CallOutputs = inferRouterOutputs<AppRouter>["staffCalls"];
export type CallSummary = CallOutputs["diary"]["items"][number];
export type CallDetailData = CallOutputs["get"];
export type Host = CallOutputs["hosts"][number];
export type Agent = CallOutputs["agents"]["items"][number];
export const control =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary";
export const panel =
  "space-y-4 rounded-xl border bg-card p-5 text-card-foreground";
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Notice({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <section className={panel}>
      <h2 className="font-semibold">{title}</h2>
      {children && (
        <div className="text-sm leading-6 text-muted-foreground">
          {children}
        </div>
      )}
    </section>
  );
}
export function QueryState({
  query,
  children,
  empty = false,
}: {
  query: {
    isLoading: boolean;
    error: { message: string } | null;
    refetch: () => unknown;
  };
  children: ReactNode;
  empty?: boolean;
}) {
  if (query.error)
    return (
      <Notice title="Call records unavailable">
        <p role="alert">
          {query.error.message} Previously loaded data is not shown.
        </p>
        <Button
          className="mt-3"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          Retry records
        </Button>
      </Notice>
    );
  if (query.isLoading)
    return (
      <p role="status" className="py-5 text-sm">
        Loading call records…
      </p>
    );
  if (empty)
    return (
      <Notice title="No matching call records">
        An empty diary does not mean this host is available. Booking requires a
        provider-verified slot.
      </Notice>
    );
  return <>{children}</>;
}
export function MutationError({
  error,
}: {
  error: { message: string } | null | undefined;
}) {
  return error ? (
    <p
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      {error.message} Your draft and original version are retained. Reload the
      record before resolving a version conflict; no success has been assumed.
    </p>
  ) : null;
}
export function localZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "local timezone";
}
export function callTime(value: Date | string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
export function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function localRange(day: string, days = 1) {
  const from = new Date(`${day}T00:00:00`);
  const to = new Date(from);
  to.setDate(to.getDate() + days);
  return { from, to };
}
export function shiftLocalDay(day: string, days: number) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDay(date);
}
export function safeMeetingUrl(value?: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function MeetingLink({ url }: { url?: string | null }) {
  const href = safeMeetingUrl(url);
  return href ? (
    <a
      className="text-sm font-semibold text-emerald-800 underline"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      Open meeting securely
    </a>
  ) : (
    <p className="text-sm text-muted-foreground">
      No verified HTTPS meeting link recorded.
    </p>
  );
}
export function reasonLabel(
  key: string,
  reasons: readonly { key: string; label: string }[]
) {
  return (
    reasons.find(reason => reason.key === key)?.label ??
    key.replaceAll("_", " ")
  );
}
export function CallCard({
  call,
  reasons,
  open,
  showCount = true,
}: {
  call: CallSummary;
  reasons: readonly { key: string; label: string }[];
  open: () => void;
  showCount?: boolean;
}) {
  return (
    <article className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold">
          {reasonLabel(call.reasonKey, reasons)}
        </h3>
        <span className="rounded-full bg-muted px-2 py-1 text-xs">
          {call.status.replaceAll("_", " ")}
        </span>
      </div>
      <p className="mt-2 text-sm">
        {callTime(call.startAt)} – {callTime(call.endAt)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {call.hostName || `Host #${call.hostUserId}`} ·{" "}
        {call.format === "group" ? "Private group" : "1:1"}
        {showCount ? ` · ${call.participantCount} invitations` : ""}
      </p>
      <Button className="mt-4" variant="outline" size="sm" onClick={open}>
        Open call #{call.id}
      </Button>
    </article>
  );
}
