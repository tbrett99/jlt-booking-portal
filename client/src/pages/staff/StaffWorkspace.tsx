import { lazy, Suspense, createContext, useContext } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import {
  ArrowLeft,
  BookOpen,
  ClipboardCheck,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import NotFound from "@/pages/NotFound";

const Instructor = lazy(() => import("./StaffInstructor"));
const Engagement = lazy(() => import("./StaffEngagement"));
export type StaffAuthority = {
  instructor: boolean;
  engagement: boolean;
  courseIds: number[];
  schemaAvailable: boolean;
};
const denied: StaffAuthority = {
  instructor: false,
  engagement: false,
  courseIds: [],
  schemaAvailable: false,
};
const Authority = createContext<StaffAuthority>(denied);
export function useStaffAuthority() {
  return useContext(Authority);
}

// A capability lookup is not an admin-view switch and never changes users.role.
export function useStaffAccess() {
  const { user } = useAuth();
  const eligible =
    user?.role === "agent" &&
    user.portalStatus === "active" &&
    user.isActive &&
    !user.mustChangePassword;
  const query = trpc.staffAccess.mine.useQuery(undefined, {
    enabled: !!eligible,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const access =
    eligible && !query.error && query.data?.schemaAvailable
      ? query.data
      : denied;
  return { ...query, access, eligible: !!eligible };
}

export function StaffNotice({
  title,
  children,
  retry,
}: {
  title: string;
  children?: React.ReactNode;
  retry?: () => void;
}) {
  return (
    <section className="rounded-xl border bg-card p-6 text-card-foreground">
      <h2 className="font-semibold">{title}</h2>
      {children && (
        <div className="mt-2 text-sm leading-6 text-muted-foreground">
          {children}
        </div>
      )}
      {retry && (
        <Button className="mt-4" variant="outline" onClick={retry}>
          Try again
        </Button>
      )}
    </section>
  );
}
export function StaffQueryState({
  query,
  empty,
  children,
}: {
  query: {
    isLoading: boolean;
    error: { message: string } | null;
    refetch: () => unknown;
  };
  empty?: boolean;
  children: React.ReactNode;
}) {
  if (query.isLoading)
    return (
      <p
        role="status"
        className="flex items-center gap-2 py-6 text-sm text-muted-foreground"
      >
        <Loader2 className="animate-spin" size={16} />
        Loading workspace records…
      </p>
    );
  if (query.error)
    return (
      <StaffNotice
        title="Records could not be loaded"
        retry={() => void query.refetch()}
      >
        {query.error.message}
      </StaffNotice>
    );
  if (empty)
    return (
      <StaffNotice title="No records to show">
        There are no matching records in your permitted workspace.
      </StaffNotice>
    );
  return <>{children}</>;
}
export function StaffMutationError({
  error,
}: {
  error?: { message: string } | null;
}) {
  return error ? (
    <p
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      {error.message} Your draft is retained. Refresh the record if access or
      its status has changed before trying again.
    </p>
  ) : null;
}
export function StaffField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}
export const staffControl =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary";
export function staffDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}
export function localDateInput(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
export function safeEvidenceUrl(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
// Never link raw storage keys or construct document tokens on the client.
export function safeAssessmentDownload(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    if (
      url.origin !== window.location.origin &&
      url.origin !== "https://portal.thejltgroup.co.uk"
    )
      return undefined;
    return url.pathname.startsWith("/api/academy/assessment-document/")
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function StaffLanding() {
  const access = useStaffAuthority();
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald-700">
          Your assigned responsibilities
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Staff workspace
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          A focused space for the work you have been assigned. Your personal
          bookings, finance and learning remain in My Agent Portal.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {access.instructor && (
          <Link
            href="/staff/instructor"
            className="rounded-xl border bg-card p-6 text-card-foreground transition-colors hover:border-emerald-400"
          >
            <BookOpen className="text-emerald-700" size={24} />
            <h2 className="mt-4 text-lg font-semibold">Instructor</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Edit your {access.courseIds.length} explicitly assigned{" "}
              {access.courseIds.length === 1 ? "course" : "courses"} and review
              written or document assessments.
            </p>
            <p className="mt-5 text-sm font-semibold text-emerald-700">
              Open instructor workspace →
            </p>
          </Link>
        )}
        {access.engagement && (
          <Link
            href="/staff/engagement"
            className="rounded-xl border bg-card p-6 text-card-foreground transition-colors hover:border-emerald-400"
          >
            <ClipboardCheck className="text-emerald-700" size={24} />
            <h2 className="mt-4 text-lg font-semibold">Agent Engagement</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Create and review Academy Actions, follow agent activity and
              record focused check-ins.
            </p>
            <p className="mt-5 text-sm font-semibold text-emerald-700">
              Open engagement workspace →
            </p>
          </Link>
        )}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Permissions are checked again for every server request. This workspace
        does not provide general administration, CRM, finance or reporting
        access.
      </p>
    </div>
  );
}

export default function StaffWorkspace() {
  const query = useStaffAccess();
  const [location] = useLocation();
  const { access } = query;
  const hasAccess = access.instructor || access.engagement;
  const deniedRoute =
    (location === "/staff/instructor" && !access.instructor) ||
    (location === "/staff/engagement" && !access.engagement);
  return (
    <Authority.Provider value={access}>
      <div className="min-h-screen bg-slate-50 text-slate-900 md:grid md:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="border-b bg-white px-5 py-6 md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="text-emerald-700" size={22} />
            JLT Staff
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Assigned work · same agent account
          </p>
          <nav
            aria-label="Staff workspace navigation"
            className="mt-6 flex flex-wrap gap-2 md:flex-col"
          >
            <Link
              href="/staff"
              className={`rounded-lg px-3 py-2 text-sm ${location === "/staff" ? "bg-emerald-50 font-semibold text-emerald-800" : "hover:bg-slate-50"}`}
            >
              Workspace home
            </Link>
            {access.instructor && (
              <Link
                href="/staff/instructor"
                className={`rounded-lg px-3 py-2 text-sm ${location === "/staff/instructor" ? "bg-emerald-50 font-semibold text-emerald-800" : "hover:bg-slate-50"}`}
              >
                Instructor
              </Link>
            )}
            {access.engagement && (
              <Link
                href="/staff/engagement"
                className={`rounded-lg px-3 py-2 text-sm ${location === "/staff/engagement" ? "bg-emerald-50 font-semibold text-emerald-800" : "hover:bg-slate-50"}`}
              >
                Agent Engagement
              </Link>
            )}
          </nav>
          <Link
            href="/dashboard"
            className="mt-6 flex items-center gap-2 border-t pt-5 text-sm font-semibold text-emerald-800"
          >
            <ArrowLeft size={16} />
            My Agent Portal
          </Link>
        </aside>
        <main data-portal-route-content className="min-w-0 p-5 md:p-8">
          <div className="mx-auto max-w-6xl">
            <Suspense fallback={<p role="status">Loading workspace…</p>}>
              {query.eligible && query.isLoading ? (
                <StaffNotice title="Checking your staff access…" />
              ) : query.error ? (
                <StaffNotice
                  title="Staff access could not be checked"
                  retry={() => void query.refetch()}
                >
                  {query.error.message} Your personal portal is still available.
                </StaffNotice>
              ) : !hasAccess ? (
                <StaffNotice title="Staff workspace unavailable">
                  You do not currently have an active staff assignment. Your
                  personal portal is unchanged. Contact a Super Admin if an
                  assignment is expected.
                </StaffNotice>
              ) : deniedRoute ? (
                <StaffNotice title="This workspace is not assigned to you">
                  Choose one of your permitted workspaces from the navigation.
                </StaffNotice>
              ) : (
                <Switch>
                  <Route path="/staff" component={StaffLanding} />
                  {access.instructor && (
                    <Route path="/staff/instructor" component={Instructor} />
                  )}
                  {access.engagement && (
                    <Route path="/staff/engagement" component={Engagement} />
                  )}
                  <Route component={NotFound} />
                </Switch>
              )}
            </Suspense>
          </div>
        </main>
      </div>
    </Authority.Provider>
  );
}
