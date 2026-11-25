import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { Download, RefreshCw } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import type { HqLiveStatusDto } from "../../../../server/management-hq-live-service";
import type { HqConnectionCheckResult } from "@shared/management-hq-connection-check";
import type { HqInitialImportResult } from "@shared/management-hq-initial-import";
import type { HqInitialValidationResult } from "@shared/management-hq-initial-validation";
import type {
  HqBookingDrilldown,
  HqMoneyCoverage,
  HqReport,
  HqReportPerson,
  HqReportTotals,
} from "@shared/management-hq-report";

const PAGE_SIZE = 25;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const VIEWS = [
  "Executive Dashboard",
  "Financial Performance",
  "Agent Activity",
] as const;
type View = (typeof VIEWS)[number];
type Scenario = "initial" | "amended" | "cancelled" | "registered";
type Actor = {
  id: number;
  role: string;
  isActive: boolean;
  portalStatus: string;
};
const queryOptions = {
  retry: false,
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: "always" as const,
};
const panel = "rounded-xl border border-border bg-card p-4 sm:p-5";
const cell = "px-3 py-3 align-top";
const tableClass = "w-full text-left text-sm";

function activeSuperAdmin(user: unknown): user is Actor {
  const actor = user as Actor | null | undefined;
  return (
    !!actor &&
    actor.role === "super_admin" &&
    actor.isActive === true &&
    actor.portalStatus === "active"
  );
}

function isAuthorityError(error: unknown): boolean {
  const value = error as {
    data?: { code?: unknown };
    code?: unknown;
    message?: unknown;
  } | null;
  const code = value?.data?.code ?? value?.code;
  return (
    ["FORBIDDEN", "UNAUTHORIZED", "UNAUTHENTICATED"].includes(code as string) ||
    value?.message === "Management HQ access could not be verified." ||
    value?.message ===
      "Management HQ data or access could not be verified. Values are unavailable, not zero. No partial totals have been returned."
  );
}

const CONNECTION_MESSAGES: Record<HqConnectionCheckResult["outcome"], string> =
  {
    ready:
      "Portal can connect to Orbit. No bookings have been imported or HQ switched on.",
    stale: "Orbit is connected, but its latest reporting data is out of date.",
    not_ready:
      "Orbit’s reporting data is not ready yet. No bookings have been imported.",
    missing_key: "Orbit connection is not configured on the server.",
    invalid_settings:
      "Orbit connection settings are invalid. No bookings have been imported.",
    key_rejected: "Orbit reporting key was rejected.",
    unavailable:
      "Portal could not complete the Orbit connection check. No bookings have been imported.",
  };

/** Outcome-only staff wording: neither source payloads nor arbitrary RPC messages are UI copy. */
function safeConnectionResult(value: unknown): HqConnectionCheckResult {
  const result = value as Partial<HqConnectionCheckResult> | null;
  const outcome =
    typeof result?.outcome === "string" &&
    Object.prototype.hasOwnProperty.call(CONNECTION_MESSAGES, result.outcome)
      ? result.outcome
      : "unavailable";
  const checkedAt =
    typeof result?.checkedAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      result.checkedAt
    ) &&
    Number.isFinite(Date.parse(result.checkedAt))
      ? result.checkedAt
      : new Date().toISOString();
  return {
    outcome,
    message: CONNECTION_MESSAGES[outcome],
    checkedAt,
    generationId: null,
    sourcePublishedAt: null,
    sourceObservationAt: null,
  };
}

type InitialImportView = Pick<
  HqInitialImportResult,
  "status" | "nextDueAt" | "hasPublished" | "progress"
>;
type InitialYear = HqInitialValidationResult["years"][number];
type InitialValidationView = Pick<
  HqInitialValidationResult,
  "status" | "checkedAt" | "sourcePublishedAt" | "isStale" | "years"
>;
const safeCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const safeStamp = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value));
const safeAmount = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === "string" &&
    value.length <= 100 &&
    /^-?\d+(?:\.\d+)?$/.test(value));

function safeInitialImport(value: unknown): InitialImportView {
  const fallback: InitialImportView = {
    status: "needs_attention",
    nextDueAt: null,
    hasPublished: false,
    progress: null,
  };
  if (!value || typeof value !== "object") return fallback;
  const result = value as Record<string, unknown>;
  if (
    ![
      "disabled",
      "notdue",
      "busy",
      "progress",
      "applied",
      "already_complete",
      "needs_attention",
    ].includes(result.status as string) ||
    typeof result.hasPublished !== "boolean" ||
    (result.nextDueAt !== null && !safeStamp(result.nextDueAt))
  )
    return fallback;
  const progress = result.progress as Record<string, unknown> | null;
  if (
    progress !== null &&
    (!progress ||
      !safeCount(progress.pages) ||
      !safeCount(progress.recordsRead))
  )
    return fallback;
  if (
    (result.status === "applied" || result.status === "already_complete") &&
    !result.hasPublished
  )
    return fallback;
  if (result.status === "notdue" && !safeStamp(result.nextDueAt))
    return fallback;
  return {
    status: result.status as InitialImportView["status"],
    nextDueAt: result.nextDueAt as string | null,
    hasPublished: result.hasPublished,
    progress: progress
      ? {
          pages: progress.pages as number,
          recordsRead: progress.recordsRead as number,
        }
      : null,
  };
}

function safeInitialValidation(value: unknown): InitialValidationView | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  if (
    !["awaiting_import", "checks_ready", "needs_attention"].includes(
      result.status as string
    ) ||
    !safeStamp(result.checkedAt) ||
    (result.sourcePublishedAt !== null &&
      !safeStamp(result.sourcePublishedAt)) ||
    ![true, false, null].includes(result.isStale as boolean | null) ||
    result.manualChecksPending !== true ||
    !Array.isArray(result.years) ||
    result.years.length > 101
  )
    return null;
  const years: InitialYear[] = [];
  for (const entry of result.years) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    if (
      !safeCount(row.year) ||
      row.year < 2000 ||
      row.year > 2100 ||
      years.some(item => item.year === row.year) ||
      !safeAmount(row.grossSales) ||
      !safeAmount(row.grossProfit)
    )
      return null;
    const counts = [
      "activeBookings",
      "grossSalesMissing",
      "grossProfitMissing",
      "cancelledBookings",
      "pendingBookings",
      "undatedBookings",
      "unattributedBookings",
    ] as const;
    if (counts.some(key => !safeCount(row[key]))) return null;
    years.push({
      year: row.year,
      grossSales: row.grossSales,
      grossProfit: row.grossProfit,
      activeBookings: row.activeBookings as number,
      grossSalesMissing: row.grossSalesMissing as number,
      grossProfitMissing: row.grossProfitMissing as number,
      cancelledBookings: row.cancelledBookings as number,
      pendingBookings: row.pendingBookings as number,
      undatedBookings: row.undatedBookings as number,
      unattributedBookings: row.unattributedBookings as number,
    });
  }
  // Only the explicit validation summary is retained. No source rows, messages,
  // identities, opaque source identifiers or arbitrary limitations are displayed.
  return {
    status: result.status as InitialValidationView["status"],
    checkedAt: result.checkedAt,
    sourcePublishedAt: result.sourcePublishedAt as string | null,
    isStale: result.isStale as boolean | null,
    years: result.status === "checks_ready" ? years : [],
  };
}

function initialImportMessage(
  result: InitialImportView,
  waiting: boolean
): string {
  if (
    result.hasPublished &&
    ["applied", "already_complete"].includes(result.status)
  )
    return "First import complete. Check the imported figures when you are ready. HQ dashboards remain off.";
  switch (result.status) {
    case "disabled":
      return "Awaiting approved server setup. Import has not been enabled here.";
    case "notdue":
      return waiting
        ? `Wait until ${new Date(result.nextDueAt!).toLocaleString()}, then continue`
        : "Waiting time has ended. Continue when you are ready.";
    case "busy":
      return "An import is already running. Use Refresh to check its status before continuing.";
    case "progress":
      return "One import step completed. Continue the first import with another explicit click.";
    default:
      return "The first import needs attention. Use Refresh to check the current status; no automatic retry is performed.";
  }
}

/** Group decimal strings without passing money through IEEE-754 or rounding source precision. */
export function formatHqMoney(value: string | null): string {
  if (value === null) return "Missing";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return "Unavailable";
  const whole = match[2]
    .replace(/^0+(?=\d)/, "")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${match[1]}£${whole}.${(match[3] ?? "").padEnd(2, "0")}`;
}

function percent(value: string | null): string {
  if (value === null) return "Missing";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return "Unavailable";
  // Decimal-point shift for display only, not a new margin calculation.
  const decimal = (match[3] ?? "").padEnd(2, "0");
  const whole = `${match[2]}${decimal.slice(0, 2)}`.replace(/^0+(?=\d)/, "");
  const remainder = decimal.slice(2).replace(/0+$/, "");
  return `${match[1]}${whole}${remainder ? `.${remainder}` : ""}%`;
}

function Coverage({ value }: { value: HqMoneyCoverage }) {
  return (
    <div className="space-y-1">
      <strong className="block tabular-nums">
        {value.knownSum === null &&
        value.eligibleCount === 0 &&
        (value.notApplicableCount ?? 0) > 0
          ? "Not applicable"
          : formatHqMoney(value.knownSum)}
      </strong>
      <span className="block text-xs text-muted-foreground">
        {value.coveredCount}/{value.eligibleCount} covered
      </span>
      <span
        className={`block text-xs ${value.missingCount ? "text-amber-600 dark:text-amber-300" : "text-muted-foreground"}`}
      >
        {value.missingCount
          ? `Incomplete · ${value.missingCount} missing`
          : value.eligibleCount
            ? "Covered eligible records"
            : "No eligible records"}
      </span>
      <span className="block text-xs text-muted-foreground">
        {value.actualRecordedCount} actual recorded · {value.estimatedCount}{" "}
        estimated
      </span>
      {!!value.notApplicableCount && (
        <span className="block text-xs text-muted-foreground">
          {value.notApplicableCount} not applicable · not missing
        </span>
      )}
    </div>
  );
}

const MONEY_FIELDS: {
  key: keyof Omit<
    HqReportTotals,
    | "bookingCount"
    | "passengerCount"
    | "unknownPassengerCount"
    | "weightedMargin"
  >;
  label: string;
  note: string;
}[] = [
  {
    key: "grossSales",
    label: "Gross sales",
    note: "Known gross sum; not an assumption for missing files",
  },
  {
    key: "supplierNetCost",
    label: "Supplier net cost",
    note: "Complete source net values only",
  },
  {
    key: "knownSupplierNetSubtotal",
    label: "Known supplier net subtotal",
    note: "Partial source subtotal; not complete supplier net cost",
  },
  {
    key: "grossProfit",
    label: "Gross profit",
    note: "Source gross profit on covered records",
  },
  {
    key: "applicableVat",
    label: "Applicable VAT",
    note: "Source applicability and recorded values",
  },
  {
    key: "ptsFees",
    label: "PTS fees",
    note: "Source values; actual recorded and estimates distinguished",
  },
  {
    key: "actualCardFees",
    label: "Actual card fees",
    note: "Recorded fee evidence only",
  },
  {
    key: "estimatedCardFees",
    label: "Estimated card fees",
    note: "Estimates, not actual cash fees; not added to actual fees",
  },
  {
    key: "baselineAgentCommission",
    label: "Baseline agent commission",
    note: "Orbit baseline; not policy-complete entitlement",
  },
  {
    key: "baselineJltRetainedCommission",
    label: "Baseline JLT retained commission",
    note: "Orbit baseline; separate from policy-complete values",
  },
  {
    key: "completeAgentCommission",
    label: "Policy-complete agent commission",
    note: "Only source records marked policy complete",
  },
  {
    key: "completeJltRetainedCommission",
    label: "Policy-complete JLT retained commission",
    note: "Not inferred from the baseline",
  },
  {
    key: "settledJltIncome",
    label: "Settled JLT income",
    note: "Recorded settlement only; missing is not £0 or expected cash",
  },
];

function Person({ person }: { person: HqReportPerson | null }) {
  return person ? (
    <span>
      {person.name}
      <span className="block text-xs text-muted-foreground">
        #{person.userId}
        {person.uniqueAgentId ? ` · ${person.uniqueAgentId}` : ""}
      </span>
    </span>
  ) : (
    <span className="text-muted-foreground">Unattributed</span>
  );
}

function ProvisionalAttribution({ state }: { state?: string }) {
  if (!state || !/provisional|current_owner/.test(state)) return null;
  return (
    <span className="mt-1 block text-xs font-medium text-amber-600 dark:text-amber-300">
      Provisional current owner · not original seller
    </span>
  );
}

function Pagination({
  page,
  count,
  setPage,
  label,
}: {
  page: number;
  count: number;
  setPage: (page: number) => void;
  label: string;
}) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  return (
    <div
      className="flex flex-wrap items-center justify-end gap-2 text-xs"
      aria-label={`${label} pagination`}
    >
      <span>
        {count} records · Page {page + 1} of {pages} · maximum 25 per page
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={page === 0}
        onClick={() => setPage(page - 1)}
      >
        Previous {label}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={page + 1 >= pages}
        onClick={() => setPage(page + 1)}
      >
        Next {label}
      </Button>
    </div>
  );
}

function LiveConnection({ live }: { live: HqLiveStatusDto }) {
  const stamp = (value: string | null) =>
    safeStamp(value) ? new Date(value).toLocaleString() : "Not yet recorded";
  const attention = live.health === "needs_attention";
  const missing = Array.isArray(live.missingSettings)
    ? (
        [
          "HQ_ORBIT_REPORTING_BASE_URL",
          "HQ_ORBIT_REPORTING_API_KEY",
          "HQ_PORTAL_SYNC_TOKEN",
        ] as const
      ).filter(name => live.missingSettings?.includes(name))
    : [];
  return (
    <section
      className={`${panel} space-y-3`}
      aria-label="Live reporting connection"
    >
      <h2 className="font-semibold">
        Orbit reporting import · production wiring
      </h2>
      <p className="text-sm">
        Live semantic acceptance is not yet verified. Orbit financials remain
        authoritative; missing values are not zero.
      </p>
      {live.payloadIntegrity === "unchecked" && (
        <p className="text-sm">
          Saved import progress only. This does not confirm an import is running
          now or that the reporting data has passed validation.
        </p>
      )}
      {!live.configured ? (
        <p role="status">
          Awaiting connection approval or valid server settings. No verified
          live dataset is available.
        </p>
      ) : attention ? (
        <p role="alert">
          Import stopped and needs protected investigation before recovery. No
          automatic reset is performed.
        </p>
      ) : live.health === "backoff" ? (
        <p role="status">
          Source check delayed. Bounded retry is waiting until{" "}
          {stamp(live.nextDueAt)}.
        </p>
      ) : live.health === "progress" ? (
        <p role="status">
          {live.payloadIntegrity === "unchecked"
            ? "Saved import progress."
            : "Import in progress."}{" "}
          Partial records are not published as report totals.
        </p>
      ) : !live.hasPublished ? (
        <p role="status">
          Awaiting the first complete, verified Orbit import. No dataset yet;
          values are unavailable, not zero.
        </p>
      ) : (
        <p role="status">Last complete Orbit publication is available.</p>
      )}
      {live.configurationCode === "CONFIG_INCOMPLETE" && missing.length > 0 && (
        <p role="alert">
          Portal cannot see a value for: {missing.join(", ")}. Check these exact
          variable names in the Portal service, save and deploy the changes. Do
          not share the values here.
        </p>
      )}
      {!live.syncEnabled && (
        <p className="text-sm">
          Automatic import is disabled. Refresh does not restart it.
        </p>
      )}
      {live.syncEnabled && !live.readEnabled && (
        <p className="text-sm">
          First-import access is enabled on the server. This page never starts
          it automatically.
        </p>
      )}
      {!live.readEnabled && (
        <p className="text-sm">
          Report reading is disabled pending approval. Import monitoring does
          not enable report access.
        </p>
      )}
      {live.progress && (
        <p className="text-sm">
          Partial import:{" "}
          {live.progress.kind === "backfill"
            ? "historical import"
            : "change catch-up"}{" "}
          · {live.progress.pages} pages · {live.progress.recordsRead} records
          read. Incomplete progress is separate from the last-good report.
        </p>
      )}
      {live.hasPublished && live.payloadIntegrity !== "unchecked" && (
        <p className="text-sm">
          Showing only the last-good complete publication; incomplete imports
          and failed checks never replace it.
        </p>
      )}
      {live.hasPublished && live.payloadIntegrity === "unchecked" && (
        <p className="text-sm">
          A saved publication was found. Imported totals checks must still
          validate it; report access remains disabled.
        </p>
      )}
      {live.isStale && (
        <p
          role="alert"
          className="text-sm font-medium text-amber-600 dark:text-amber-300"
        >
          Stale source warning: last-good data may be viewed, but it is not a
          current source check.
        </p>
      )}
      <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt>Last successful check</dt>
          <dd>{stamp(live.lastSuccessfulCheckAt)}</dd>
        </div>
        <div>
          <dt>Portal report publication</dt>
          <dd>{stamp(live.lastPublishedAt)}</dd>
        </div>
        <div>
          <dt>Source publication</dt>
          <dd>{stamp(live.sourcePublishedAt)}</dd>
        </div>
        <div>
          <dt>Source observation</dt>
          <dd>{stamp(live.sourceObservationAt)}</dd>
        </div>
        <div>
          <dt>Source observation age</dt>
          <dd>
            {live.sourceAgeSeconds === null
              ? "Unknown"
              : `${live.sourceAgeSeconds} seconds`}
          </dd>
        </div>
        <div>
          <dt>Portal freshness ceiling</dt>
          <dd>
            {live.freshnessTargetSeconds} seconds · stricter source policy also
            applies
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Refresh rereads Portal status and reports only; it does not contact
        Orbit or write data. No automatic import starts from this page.
      </p>
    </section>
  );
}

/** The parent layout owns navigation/chrome. This page owns only HQ's authority boundary. */
export default function ManagementHq() {
  const auth = useAuth();
  // useAuth supplies the current user. Observe the same auth query with a fresh mount/focus
  // policy too: cached user data alone must not authorize an HQ read or a late download.
  const current = trpc.auth.me.useQuery(undefined, queryOptions);
  const authority = useRef<Actor | null>(null);
  const allowed =
    !auth.loading &&
    !auth.error &&
    activeSuperAdmin(auth.user) &&
    !current.error &&
    !current.isLoading &&
    !current.isFetching &&
    current.isFetchedAfterMount &&
    activeSuperAdmin(current.data) &&
    current.data.id === auth.user.id;
  authority.current = allowed && activeSuperAdmin(auth.user) ? auth.user : null;
  const isCurrent = (id: number) => authority.current?.id === id;

  if (
    auth.loading ||
    current.isLoading ||
    current.isFetching ||
    (!current.isFetchedAfterMount && !current.error)
  ) {
    return (
      <div className="p-6" role="status">
        Checking current Management HQ access…
      </div>
    );
  }
  if (!allowed || !activeSuperAdmin(auth.user)) {
    return (
      <section className="p-6" role="alert">
        <h1 className="text-2xl font-semibold">Management HQ</h1>
        <p className="mt-2">
          Access denied. Current active Super Admin access is required. No
          report data is shown.
        </p>
      </section>
    );
  }
  return (
    <ActorHq key={auth.user.id} actorId={auth.user.id} isCurrent={isCurrent} />
  );
}

function ActorHq({
  actorId,
  isCurrent,
}: {
  actorId: number;
  isCurrent: (id: number) => boolean;
}) {
  const utils = trpc.useUtils();
  const [booted, setBooted] = useState(false);
  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const [month, setMonth] = useState<number | undefined>();
  const [view, setView] = useState<View>(VIEWS[0]);
  const [refreshing, setRefreshing] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionAccessRevoked, setConnectionAccessRevoked] = useState(false);
  const [connectionResult, setConnectionResult] =
    useState<HqConnectionCheckResult | null>(null);
  const [initialBusy, setInitialBusy] = useState<"import" | "check" | null>(
    null
  );
  const [initialResult, setInitialResult] = useState<InitialImportView | null>(
    null
  );
  const [initialCooldownPulse, setInitialCooldownPulse] = useState(0);
  const [initialValidation, setInitialValidation] =
    useState<InitialValidationView | null>(null);
  const [initialCheckFailed, setInitialCheckFailed] = useState(false);
  const alive = useRef(true);
  const lock = useRef(false);
  const epoch = useRef(0);
  const connectionAttempt = useRef(0);
  const connectionFlight = useRef<symbol | null>(null);
  const initialAttempt = useRef(0);
  const initialFlight = useRef<symbol | null>(null);
  const initialRefresh = useRef(false);
  const initialSettings = useRef("");
  const initialResultBoundary = useRef("");
  const initialValidationBoundary = useRef("");
  const boundary = useRef("");
  const identityCheck = useRef(isCurrent);
  identityCheck.current = isCurrent;
  const status = trpc.managementHq.status.useQuery(undefined, {
    ...queryOptions,
    enabled: booted,
  });
  const sample = trpc.managementHq.sample.useMutation();
  const checkConnection = trpc.managementHq.checkConnection.useMutation();
  const importInitialBatch = trpc.managementHq.importInitialBatch.useMutation();
  const validateInitialImport =
    trpc.managementHq.validateInitialImport.useMutation();
  const statusReady =
    booted &&
    status.isFetchedAfterMount &&
    !!status.data &&
    !status.error &&
    !status.isLoading &&
    !status.isFetching;
  const mode =
    status.data?.reportMode ??
    (status.data?.sampleEnabled ? "sample" : "disabled");
  const live = mode === "live" ? status.data?.live : undefined;
  const unsafeLive =
    !!live &&
    (!live.configured ||
      !live.readEnabled ||
      !live.hasPublished ||
      [
        "STORE_UNAVAILABLE",
        "INVALID_PERSISTED_STATE",
        "SOURCE_BINDING_CHANGED",
        "CONFIG_INVALID",
        "CONFIG_INCOMPLETE",
        "SOURCE_OR_STORE_UNAVAILABLE",
      ].includes(live.lastErrorCode ?? ""));
  const showSample =
    statusReady && (mode === "sample" || status.data?.reportMode === undefined);
  const busy =
    !booted ||
    refreshing ||
    replaying ||
    sample.isPending ||
    status.isFetching ||
    status.isLoading ||
    reportBusy ||
    connectionBusy ||
    !!initialBusy;
  const canRead =
    statusReady &&
    (mode === "live"
      ? !!live && !unsafeLive
      : mode === "sample" &&
        status.data?.sampleEnabled &&
        status.data.hasSample) &&
    !actionError &&
    !connectionAccessRevoked &&
    !refreshing &&
    !replaying;
  const permission = useRef(false);
  const authorityError = isAuthorityError(status.error);
  const settingsBoundary = JSON.stringify({
    mode,
    liveConfigured: status.data?.liveConfigured ?? null,
    sampleEnabled: status.data?.sampleEnabled ?? null,
    configured: live?.configured ?? null,
    configurationCode: live?.configurationCode ?? null,
    syncEnabled: live?.syncEnabled ?? null,
    readEnabled: live?.readEnabled ?? null,
    intervalSeconds: live?.intervalSeconds ?? null,
    freshnessSeconds: live?.freshnessSeconds ?? null,
    freshnessTargetSeconds: live?.freshnessTargetSeconds ?? null,
  });
  const latestSettings = useRef(settingsBoundary);
  latestSettings.current = settingsBoundary;
  const initialEnabled =
    statusReady &&
    mode === "live" &&
    live?.configured === true &&
    status.data?.liveConfigured === true &&
    live.syncEnabled === true &&
    live.readEnabled === false &&
    !live.configurationCode &&
    live.lastErrorCode !== "CONFIG_INCOMPLETE" &&
    !authorityError &&
    !connectionAccessRevoked &&
    !actionError;
  const currentBoundary = JSON.stringify({
    authorityError,
    statusError: !!status.error,
    statusReady,
    mode,
    stateVersion: status.data?.stateVersion ?? null,
    liveConfigured: status.data?.liveConfigured ?? null,
    sampleEnabled: status.data?.sampleEnabled ?? null,
    hasSample: status.data?.hasSample ?? null,
    configured: live?.configured ?? null,
    configurationCode: live?.configurationCode ?? null,
    syncEnabled: live?.syncEnabled ?? null,
    readEnabled: live?.readEnabled ?? null,
    intervalSeconds: live?.intervalSeconds ?? null,
    freshnessSeconds: live?.freshnessSeconds ?? null,
    hasPublished: live?.hasPublished ?? null,
    lastErrorCode: live?.lastErrorCode ?? null,
    generationId: live?.generationId ?? null,
    sourcePublishedAt: live?.sourcePublishedAt ?? null,
    sourceObservationAt: live?.sourceObservationAt ?? null,
    isStale: live?.isStale ?? null,
    sourceAgeSeconds: live?.sourceAgeSeconds ?? null,
    lastPublishedAt: live?.lastPublishedAt ?? null,
    route: window.location.href,
  });
  if (boundary.current !== currentBoundary) {
    boundary.current = currentBoundary;
    permission.current = false;
    epoch.current++;
    connectionAttempt.current++;
    if (!initialRefresh.current || initialSettings.current !== settingsBoundary)
      initialAttempt.current++;
  }
  permission.current =
    !authorityError && !!canRead && identityCheck.current(actorId);
  const initialGate = useRef(false);
  initialGate.current = !!initialEnabled;
  const initialStatusError = useRef(false);
  initialStatusError.current =
    !!status.error || authorityError || connectionAccessRevoked;
  useEffect(() => {
    if (!alive.current) return;
    if (authorityError) {
      permission.current = false;
      setConnectionAccessRevoked(true);
      setActionError(
        "Current Management HQ access is no longer available. Use Refresh to retry."
      );
    }
    setConnectionResult(null);
    checkConnection.reset();
    setInitialValidation(null);
    setInitialCheckFailed(false);
    // A settings/source change invalidates pending manual work immediately. A
    // completed import's one explicit status refresh is the sole exception;
    // it may legitimately publish a new status version, never private checks.
    if (
      !initialRefresh.current ||
      initialSettings.current !== settingsBoundary ||
      authorityError ||
      status.error
    ) {
      setInitialResult(null);
      if (initialFlight.current) {
        initialFlight.current = null;
        initialRefresh.current = false;
        lock.current = false;
        setInitialBusy(null);
        importInitialBatch.reset();
        validateInitialImport.reset();
      }
    }
  }, [currentBoundary]);

  useEffect(() => {
    // React may commit the refreshed publication after mutateAsync resolves.
    // Retain only fixed import copy across that single owned refresh commit.
    if (initialRefresh.current && initialResult) {
      initialResultBoundary.current = boundary.current;
      initialRefresh.current = false;
    }
  }, [initialResult]);

  useEffect(() => {
    alive.current = true;
    // There is intentionally no actor field in the server input. A keyed child plus
    // cancellation before enabling a new observer prevents a previous actor's in-flight
    // request/cache from becoming this actor's fresh authority evidence.
    void Promise.all([
      utils.managementHq.status.cancel(),
      utils.managementHq.report.cancel(),
    ])
      .then(() => {
        if (alive.current) setBooted(true);
      })
      .catch(() => {
        if (alive.current)
          setActionError(
            "Unable to start a fresh access check. Use Refresh to retry."
          );
      });
    return () => {
      alive.current = false;
      permission.current = false;
      epoch.current++;
      connectionAttempt.current++;
      checkConnection.reset();
      initialAttempt.current++;
      initialFlight.current = null;
      initialRefresh.current = false;
      importInitialBatch.reset();
      validateInitialImport.reset();
    };
  }, [actorId, utils]);

  async function refresh() {
    if (lock.current || !identityCheck.current(actorId)) return;
    lock.current = true;
    epoch.current++;
    connectionAttempt.current++;
    setConnectionResult(null);
    checkConnection.reset();
    initialAttempt.current++;
    initialRefresh.current = false;
    setInitialResult(null);
    setInitialValidation(null);
    setInitialCheckFailed(false);
    importInitialBatch.reset();
    validateInitialImport.reset();
    permission.current = false;
    setRefreshing(true);
    try {
      await Promise.all([
        utils.managementHq.status.cancel(),
        utils.managementHq.report.cancel(),
      ]);
      const result = await status.refetch({ cancelRefetch: true });
      if (!alive.current || !identityCheck.current(actorId)) return;
      if (result.error || !result.data) throw new Error("Status unavailable");
      setBooted(true);
      setActionError(null);
      setConnectionAccessRevoked(false);
      // Report remounts only after this status read, and always fetches anew.
    } catch {
      if (alive.current && identityCheck.current(actorId))
        setActionError(
          "Unable to refresh Management HQ. Values are unavailable, not zero."
        );
    } finally {
      lock.current = false;
      if (alive.current) setRefreshing(false);
    }
  }

  async function checkOrbitConnection() {
    if (
      lock.current ||
      connectionBusy ||
      connectionAccessRevoked ||
      authorityError ||
      !alive.current ||
      !identityCheck.current(actorId)
    )
      return;
    lock.current = true;
    const flight = Symbol("connection flight");
    connectionFlight.current = flight;
    const attempt = ++connectionAttempt.current;
    const generation = ++epoch.current;
    const route = window.location.href;
    setConnectionResult(null);
    initialAttempt.current++;
    initialRefresh.current = false;
    setInitialResult(null);
    setInitialValidation(null);
    setInitialCheckFailed(false);
    setConnectionBusy(true);
    const stillCurrent = () =>
      alive.current &&
      identityCheck.current(actorId) &&
      !isAuthorityError(status.error) &&
      connectionAttempt.current === attempt &&
      epoch.current === generation &&
      window.location.href === route;
    try {
      const result = await checkConnection.mutateAsync();
      if (stillCurrent()) setConnectionResult(safeConnectionResult(result));
    } catch (error) {
      if (!stillCurrent()) return;
      const code =
        (error as { data?: { code?: unknown }; code?: unknown } | null)?.data
          ?.code ?? (error as { code?: unknown } | null)?.code;
      if (isAuthorityError(error) || code === "PRECONDITION_FAILED") {
        // A failed fresh access/configuration gate is not an ordinary source outage.
        permission.current = false;
        epoch.current++;
        connectionAttempt.current++;
        setConnectionAccessRevoked(true);
        setConnectionResult(null);
        setActionError("Management HQ access could not be verified.");
      } else {
        setConnectionResult(safeConnectionResult(null));
      }
    } finally {
      // Display invalidation does not own the operation lock. Only this flight may
      // settle its busy state; an old actor/attempt cannot unlock a newer flight.
      if (connectionFlight.current === flight) {
        connectionFlight.current = null;
        lock.current = false;
        if (alive.current) setConnectionBusy(false);
      }
    }
  }

  async function runInitialAction(kind: "import" | "check") {
    const published =
      live?.hasPublished === true || initialResult?.hasPublished === true;
    if (
      lock.current ||
      busy ||
      !initialGate.current ||
      !alive.current ||
      !identityCheck.current(actorId) ||
      (kind === "import" ? published : !published)
    )
      return;
    if (
      kind === "import" &&
      initialResult?.status === "notdue" &&
      initialResult.nextDueAt &&
      Date.now() < Date.parse(initialResult.nextDueAt)
    )
      return;
    lock.current = true;
    const flight = Symbol("first import action");
    initialFlight.current = flight;
    const attempt = ++initialAttempt.current;
    const generation = ++epoch.current;
    const route = window.location.href;
    const settings = latestSettings.current;
    initialSettings.current = settings;
    permission.current = false;
    connectionAttempt.current++;
    setConnectionResult(null);
    checkConnection.reset();
    setInitialResult(null);
    setInitialValidation(null);
    setInitialCheckFailed(false);
    setInitialBusy(kind);
    const sameActorAction = () =>
      alive.current &&
      identityCheck.current(actorId) &&
      initialFlight.current === flight &&
      initialAttempt.current === attempt &&
      window.location.href === route &&
      latestSettings.current === settings &&
      !initialStatusError.current;
    const stillCurrent = () =>
      sameActorAction() && epoch.current === generation && initialGate.current;
    let retainedImportResult = false;
    try {
      if (kind === "check") {
        const result = await validateInitialImport.mutateAsync();
        if (!stillCurrent()) return;
        const summary = safeInitialValidation(result);
        initialValidationBoundary.current = boundary.current;
        setInitialValidation(summary);
        setInitialCheckFailed(!summary);
      } else {
        // One click is one bounded server batch. Never loop, poll or retry.
        const result = safeInitialImport(
          await importInitialBatch.mutateAsync()
        );
        if (!stillCurrent()) return;
        initialRefresh.current = true;
        await Promise.all([
          utils.managementHq.status.cancel(),
          utils.managementHq.report.cancel(),
        ]);
        if (!sameActorAction()) return;
        const fresh = await status.refetch({ cancelRefetch: true });
        if (!sameActorAction()) return;
        if (fresh.error || !fresh.data) {
          if (fresh.error) throw fresh.error;
          throw new Error("Status unavailable");
        }
        initialResultBoundary.current = boundary.current;
        retainedImportResult = true;
        setInitialResult(result);
      }
    } catch (error) {
      if (!(initialRefresh.current ? sameActorAction() : stillCurrent()))
        return;
      const code =
        (error as { data?: { code?: unknown }; code?: unknown } | null)?.data
          ?.code ?? (error as { code?: unknown } | null)?.code;
      initialRefresh.current = false;
      if (isAuthorityError(error) || code === "PRECONDITION_FAILED") {
        permission.current = false;
        epoch.current++;
        initialAttempt.current++;
        connectionAttempt.current++;
        setConnectionAccessRevoked(true);
        setConnectionResult(null);
        setInitialResult(null);
        setInitialValidation(null);
        setActionError("Management HQ access could not be verified.");
      } else if (kind === "check") {
        setInitialCheckFailed(true);
      } else {
        initialResultBoundary.current = boundary.current;
        setInitialResult(safeInitialImport(null));
      }
    } finally {
      if (initialFlight.current === flight) {
        if (!retainedImportResult) initialRefresh.current = false;
        initialFlight.current = null;
        lock.current = false;
        if (alive.current) setInitialBusy(null);
      }
    }
  }

  async function replay(scenario: Scenario) {
    if (
      lock.current ||
      busy ||
      !statusReady ||
      actionError ||
      !status.data?.sampleEnabled ||
      mode !== "sample" ||
      !identityCheck.current(actorId)
    )
      return;
    lock.current = true;
    permission.current = false;
    epoch.current++;
    initialAttempt.current++;
    initialRefresh.current = false;
    setInitialResult(null);
    setInitialValidation(null);
    setInitialCheckFailed(false);
    setReplaying(true);
    try {
      await sample.mutateAsync({
        scenario,
        expectedVersion: status.data.stateVersion,
      });
      if (!alive.current || !identityCheck.current(actorId)) return;
      const result = await status.refetch({ cancelRefetch: true });
      if (result.error || !result.data) throw new Error("Status unavailable");
      // No optimistic money/counts or assumed next version; reread the server state.
      if (alive.current && identityCheck.current(actorId)) setActionError(null);
    } catch {
      if (alive.current && identityCheck.current(actorId))
        setActionError(
          "Sample replay failed or access changed. The sample may have changed in another session. Refresh before replaying; values are unavailable, not zero."
        );
    } finally {
      lock.current = false;
      if (alive.current) setReplaying(false);
    }
  }

  function changePeriod(nextYear: number, nextMonth: number | undefined) {
    permission.current = false;
    epoch.current++;
    connectionAttempt.current++;
    setConnectionResult(null);
    checkConnection.reset();
    initialAttempt.current++;
    initialRefresh.current = false;
    setInitialResult(null);
    setInitialValidation(null);
    setInitialCheckFailed(false);
    if (initialFlight.current) {
      initialFlight.current = null;
      lock.current = false;
      setInitialBusy(null);
      importInitialBatch.reset();
      validateInitialImport.reset();
    }
    setYear(nextYear);
    setMonth(nextMonth);
  }

  const visibleInitialResult =
    initialResult &&
    initialEnabled &&
    (initialResultBoundary.current === currentBoundary ||
      (initialRefresh.current && initialSettings.current === settingsBoundary))
      ? initialResult
      : null;
  const visibleValidation =
    initialValidation &&
    initialEnabled &&
    initialValidationBoundary.current === currentBoundary
      ? initialValidation
      : null;
  const initialPublished =
    live?.hasPublished === true || visibleInitialResult?.hasPublished === true;
  const initialWaitDue =
    visibleInitialResult?.status === "notdue" &&
    safeStamp(visibleInitialResult.nextDueAt)
      ? Date.parse(visibleInitialResult.nextDueAt)
      : null;
  const initialWait = initialWaitDue !== null && Date.now() < initialWaitDue;

  useEffect(() => {
    if (!initialWait || initialWaitDue === null) return;
    // Wake only this display at its current due time. No fetch, source request,
    // retry or import is started; the independent click-time/server guards remain.
    const delay = Math.max(
      1,
      Math.min(2147483647, initialWaitDue - Date.now())
    );
    const timer = setTimeout(() => {
      if (alive.current && identityCheck.current(actorId))
        setInitialCooldownPulse(value => value + 1);
    }, delay);
    // A visible-result/authority change cancels this timer. The pulse dependency
    // rearms a clamped or early wake when the actual due time is still ahead.
    return () => clearTimeout(timer);
  }, [initialWait, initialWaitDue, initialCooldownPulse, actorId]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-300">
            Business intelligence · Super Admin
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Management HQ
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Restated booking performance, financial coverage and individual
            attribution activity.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy && booted}
          onClick={() => void refresh()}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </header>
      <section
        className={`${panel} space-y-3`}
        aria-label="Orbit connection check"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Check Orbit connection</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Check the current server connection without changing HQ or
              importing data.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={
              busy || !booted || authorityError || connectionAccessRevoked
            }
            onClick={() => void checkOrbitConnection()}
          >
            {connectionBusy ? "Checking…" : "Check Orbit connection"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          This checks the connection only. It does not import bookings or switch
          HQ on.
        </p>
        {connectionBusy && <p role="status">Checking the Orbit connection…</p>}
        {connectionResult && !connectionBusy && (
          <div
            role={connectionResult.outcome === "ready" ? "status" : "alert"}
            className="space-y-1 text-sm"
          >
            <p>{connectionResult.message}</p>
            <p className="text-xs text-muted-foreground">
              Checked {new Date(connectionResult.checkedAt).toLocaleString()}
            </p>
          </div>
        )}
      </section>
      {statusReady &&
        !actionError &&
        !connectionAccessRevoked &&
        !authorityError &&
        mode !== "sample" && (
          <section
            className={`${panel} space-y-3`}
            aria-label="First Orbit import and checks"
          >
            <h2 className="font-semibold">First Orbit import and checks</h2>
            <p className="text-sm text-muted-foreground">
              Import the first complete reporting dataset in manual steps, then
              check a limited yearly summary. This does not switch on HQ
              dashboards, regular report reading or automatic updates.
            </p>
            {!initialEnabled ? (
              <p role="status">
                Awaiting approved server setup for the first import. Ask the
                authorised administrator to confirm the reporting connection and
                first-import approval, keeping regular HQ reading off. No
                credentials are entered on this page.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {!initialPublished && (
                    <Button
                      disabled={
                        busy ||
                        !!initialWait ||
                        live?.health === "needs_attention" ||
                        visibleInitialResult?.status === "needs_attention" ||
                        visibleInitialResult?.status === "disabled"
                      }
                      onClick={() => void runInitialAction("import")}
                    >
                      {initialBusy === "import"
                        ? "Importing…"
                        : visibleInitialResult ||
                            live?.progress ||
                            live?.health === "progress" ||
                            live?.health === "backoff"
                          ? "Continue first import"
                          : "Import Orbit figures"}
                    </Button>
                  )}
                  {initialPublished && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void runInitialAction("check")}
                    >
                      {initialBusy === "check"
                        ? "Checking imported figures…"
                        : "Check imported figures"}
                    </Button>
                  )}
                </div>
                {initialBusy && (
                  <p role="status">
                    {initialBusy === "import"
                      ? "Running one import step and checking the current Portal status…"
                      : "Checking the imported yearly figures…"}
                  </p>
                )}
                {visibleInitialResult && !initialBusy && (
                  <div
                    role={
                      visibleInitialResult.status === "needs_attention"
                        ? "alert"
                        : "status"
                    }
                    className="space-y-1 text-sm"
                  >
                    <p>
                      {initialImportMessage(visibleInitialResult, initialWait)}
                    </p>
                    {visibleInitialResult.progress && (
                      <p>
                        {visibleInitialResult.progress.pages} pages ·{" "}
                        {visibleInitialResult.progress.recordsRead} records
                        read. Partial progress is not a complete publication.
                      </p>
                    )}
                  </div>
                )}
                {initialPublished &&
                  !initialBusy &&
                  !visibleInitialResult &&
                  !visibleValidation && (
                    <p role="status">
                      A complete import is available for checking. No further
                      first-import action is available.
                    </p>
                  )}
                {initialCheckFailed && !initialBusy && (
                  <p role="alert">
                    Imported figures could not be checked safely. Use Refresh
                    before trying again. No checks have been marked as passed.
                  </p>
                )}
                {visibleValidation && !initialBusy && (
                  <div
                    className="space-y-3"
                    aria-label="Imported figures summary"
                  >
                    <p
                      role={
                        visibleValidation.status === "needs_attention"
                          ? "alert"
                          : "status"
                      }
                    >
                      {visibleValidation.status === "checks_ready"
                        ? "Imported yearly figures are ready for manual review. This is not passed live acceptance."
                        : visibleValidation.status === "awaiting_import"
                          ? "Awaiting a complete import before figures can be checked."
                          : "Imported figures need attention. No checks have been marked as passed."}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Checked{" "}
                      {new Date(visibleValidation.checkedAt).toLocaleString()} ·
                      Source publication{" "}
                      {visibleValidation.sourcePublishedAt
                        ? new Date(
                            visibleValidation.sourcePublishedAt
                          ).toLocaleString()
                        : "not recorded"}
                    </p>
                    {visibleValidation.isStale !== false && (
                      <p
                        role="alert"
                        className="text-sm text-amber-600 dark:text-amber-300"
                      >
                        {visibleValidation.isStale
                          ? "Stale source warning: imported figures are not current."
                          : "Source freshness is unverified."}
                      </p>
                    )}
                    {visibleValidation.status === "checks_ready" && (
                      <div className="overflow-x-auto">
                        <table
                          className={tableClass}
                          aria-label="Imported yearly figures"
                        >
                          <thead>
                            <tr>
                              {[
                                "Year",
                                "Active bookings",
                                "Known gross sales · GBP",
                                "Known gross profit · GBP",
                                "Cancelled",
                                "Pending",
                                "Undated",
                                "Unattributed",
                              ].map(label => (
                                <th key={label} className={cell}>
                                  {label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {visibleValidation.years.map(row => (
                              <tr key={row.year}>
                                <th className={cell}>{row.year}</th>
                                <td className={cell}>{row.activeBookings}</td>
                                <td className={cell}>
                                  {formatHqMoney(row.grossSales)}
                                  <span className="block text-xs text-muted-foreground">
                                    {row.grossSalesMissing} missing · known
                                    source sum only
                                  </span>
                                </td>
                                <td className={cell}>
                                  {formatHqMoney(row.grossProfit)}
                                  <span className="block text-xs text-muted-foreground">
                                    {row.grossProfitMissing} missing · known
                                    source sum only
                                  </span>
                                </td>
                                <td className={cell}>
                                  {row.cancelledBookings}
                                </td>
                                <td className={cell}>{row.pendingBookings}</td>
                                <td className={cell}>{row.undatedBookings}</td>
                                <td className={cell}>
                                  {row.unattributedBookings}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!visibleValidation.years.length && (
                          <p>
                            No dated yearly figures returned. Missing values are
                            not zero.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            <p className="text-sm font-medium text-amber-600 dark:text-amber-300">
              Provisional attribution is not the original seller. Manual
              amendment checks and cancellation financial checks remain pending.
              Live acceptance has not passed.
            </p>
            <p className="text-xs text-muted-foreground">
              Each import click runs one step only. Continue manually when
              permitted. No background import, automatic retry, polling or
              scheduled update is started here. Orbit source GBP figures remain
              authoritative; missing is not £0.
            </p>
          </section>
        )}
      {statusReady && !actionError && live && <LiveConnection live={live} />}
      {showSample && (
        <>
          <section
            className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4"
            aria-label="Sample data warning"
          >
            <h2 className="font-semibold text-emerald-700 dark:text-emerald-200">
              Sample data — not live Orbit
            </h2>
            <p className="mt-1 text-sm">
              Live Orbit is not configured. These isolated scenarios do not
              change live bookings. Refresh rereads HQ status and reports only;
              it does not contact Orbit.
            </p>
          </section>
          <section
            className={`${panel} space-y-3`}
            aria-label="Sample scenarios"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Controlled sample scenarios</h2>
              <span className="text-xs text-muted-foreground">
                {statusReady
                  ? `State version: ${status.data!.stateVersion ?? "not loaded"}`
                  : "Current sample state unavailable"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              A January booking changes from £10,000 to £11,000: the amendment
              restates January, not the observation month. The sample
              cancellation removes that file from headlines but retains its
              cancelled record in the drilldown and export. Later registration
              moves the retained record to February.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={
                  busy ||
                  !statusReady ||
                  !status.data?.sampleEnabled ||
                  !!actionError
                }
                onClick={() => void replay("initial")}
              >
                Load initial sample
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  busy ||
                  !statusReady ||
                  !status.data?.sampleEnabled ||
                  !status.data.hasSample ||
                  !!actionError
                }
                onClick={() => void replay("amended")}
              >
                Replay value amendment
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  busy ||
                  !statusReady ||
                  !status.data?.sampleEnabled ||
                  !status.data.hasSample ||
                  !!actionError
                }
                onClick={() => void replay("cancelled")}
              >
                Replay sample cancellation
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  busy ||
                  !statusReady ||
                  !status.data?.sampleEnabled ||
                  !status.data.hasSample ||
                  !!actionError
                }
                onClick={() => void replay("registered")}
              >
                Replay later registration
              </Button>
            </div>
            {replaying && (
              <p role="status" className="text-sm">
                Replaying sample and rereading current state… Values are
                withheld.
              </p>
            )}
          </section>
        </>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Management HQ views"
        >
          {VIEWS.map(label => (
            <Button
              key={label}
              variant={view === label ? "default" : "outline"}
              aria-pressed={view === label}
              disabled={!!initialBusy}
              onClick={() => {
                if (initialBusy || initialValidation || initialResult)
                  changePeriod(year, month);
                setView(label);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex gap-3" role="group" aria-label="Reporting period">
          <label className="space-y-1 text-xs font-medium">
            <span className="block">Year</span>
            <select
              aria-label="Reporting year"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={year}
              disabled={replaying || connectionBusy || !!initialBusy}
              onChange={event =>
                changePeriod(parseInt(event.target.value, 10), month)
              }
            >
              {Array.from({ length: 101 }, (_, index) => 2000 + index).map(
                value => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                )
              )}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="block">Month</span>
            <select
              aria-label="Reporting month"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={month ?? "all"}
              disabled={replaying || connectionBusy || !!initialBusy}
              onChange={event =>
                changePeriod(
                  year,
                  event.target.value === "all"
                    ? undefined
                    : parseInt(event.target.value, 10)
                )
              }
            >
              <option value="all">All months · annual</option>
              {MONTHS.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {actionError || status.error ? (
        <div className={panel} role="alert">
          {actionError ??
            "Unable to read current HQ status or access. Values are unavailable, not zero. Use Refresh to retry."}
        </div>
      ) : !statusReady || refreshing ? (
        <div className={panel} role="status">
          Reading current HQ status… Report values are withheld.
        </div>
      ) : mode === "live" && (!live || unsafeLive) ? (
        <div
          className={panel}
          role={live?.health === "needs_attention" ? "alert" : "status"}
        >
          Live report is awaiting connection, a complete verified dataset, or
          read approval. Values are unavailable, not zero. No sample values are
          substituted.
        </div>
      ) : !status.data?.sampleEnabled ? (
        mode === "live" && canRead ? (
          renderReport()
        ) : (
          <div className={panel} role="status">
            {status.data?.reportMode === "disabled"
              ? "Management HQ production reporting is disabled pending connection and acceptance. Values are unavailable, not zero."
              : "Sample reporting is disabled. Live Orbit is not configured; values are unavailable."}
          </div>
        )
      ) : mode === "sample" && !status.data.hasSample ? (
        <div className={panel} role="status">
          No sample loaded. Load the initial sample to inspect the isolated
          report. No live values are available.
        </div>
      ) : canRead ? (
        renderReport()
      ) : null}
      <footer className="border-t border-border pt-4 text-sm text-muted-foreground">
        <Link
          href="/super-admin"
          className="font-medium text-emerald-600 underline underline-offset-4 dark:text-emerald-300"
        >
          Open existing operational reports — workload, membership and income
        </Link>
        <p className="mt-2">
          These reports remain separate from HQ booking financial sources. No
          booking, payment or commission actions are available here.
        </p>
      </footer>
    </div>
  );

  function renderReport() {
    return (
      <ReportView
        key={`${actorId}:${mode}:${year}:${month ?? "all"}:${status.data?.stateVersion}`}
        actorId={actorId}
        mode={mode === "live" ? "live" : "sample"}
        stateVersion={status.data?.stateVersion ?? null}
        year={year}
        month={month}
        view={view}
        isCurrent={() => permission.current && identityCheck.current(actorId)}
        epoch={epoch}
        onBusy={setReportBusy}
        onError={() => {
          permission.current = false;
          epoch.current++;
          setActionError(
            "Report or export access failed. Values are unavailable, not zero. Use Refresh to check current access."
          );
        }}
      />
    );
  }
}

function ReportView({
  actorId,
  mode,
  stateVersion,
  year,
  month,
  view,
  isCurrent,
  epoch,
  onBusy,
  onError,
}: {
  actorId: number;
  mode: "live" | "sample";
  stateVersion: number | null;
  year: number;
  month?: number;
  view: View;
  isCurrent: () => boolean;
  epoch: { current: number };
  onBusy: (busy: boolean) => void;
  onError: () => void;
}) {
  const utils = trpc.useUtils();
  const [booted, setBooted] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(0);
  const [agentPage, setAgentPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const mounted = useRef(true);
  const exportSequence = useRef(0);
  const authority = useRef(isCurrent);
  authority.current = isCurrent;
  const input = useMemo(
    () => ({ year, ...(month === undefined ? {} : { month }) }),
    [year, month]
  );
  const report = trpc.managementHq.report.useQuery(input, {
    ...queryOptions,
    enabled: booted,
  });
  const matches =
    report.data?.filters.year === year &&
    report.data.filters.month === (month ?? null) &&
    report.data.sourceMode === mode &&
    (mode !== "live" || report.data.stateVersion === stateVersion);
  const ready =
    booted &&
    report.isFetchedAfterMount &&
    matches &&
    !report.error &&
    !report.isFetching &&
    !report.isLoading &&
    authority.current();
  const readyRef = useRef(false);
  readyRef.current = !!ready;
  const data: HqReport | undefined = ready ? report.data : undefined;
  useEffect(() => {
    mounted.current = true;
    void utils.managementHq.report
      .cancel(input)
      .then(() => {
        if (mounted.current) setBooted(true);
      })
      .catch(() => {
        if (mounted.current) onError();
      });
    return () => {
      mounted.current = false;
      readyRef.current = false;
      exportSequence.current++;
    };
  }, [input, utils]);
  useEffect(() => {
    onBusy(!booted || report.isFetching || report.isLoading);
  }, [booted, report.isFetching, report.isLoading, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);

  async function exportCsv() {
    if (
      !readyRef.current ||
      !authority.current() ||
      exporting ||
      !data?.exportComplete ||
      data.status !== "available"
    )
      return;
    const sequence = ++exportSequence.current;
    const generation = epoch.current;
    const route = window.location.href;
    setExporting(true);
    const stillCurrent = () =>
      mounted.current &&
      readyRef.current &&
      authority.current() &&
      epoch.current === generation &&
      exportSequence.current === sequence &&
      window.location.href === route;
    try {
      // Direct click-only query bypasses the shared query cache and its in-flight
      // deduplication: a new actor must never join an old actor's CSV request.
      const result = await utils.client.managementHq.exportCsv.query(input);
      if (!stillCurrent()) return;
      // LIVE must never download a sample CSV if configuration changes in flight.
      if (
        mode === "live" &&
        !result.filename.startsWith("management-hq-LIVE-")
      ) {
        onError();
        return;
      }
      if (
        mode === "sample" &&
        result.filename.startsWith("management-hq-LIVE-")
      ) {
        onError();
        return;
      }
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      try {
        anchor.href = url;
        anchor.download = result.filename;
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        if (stillCurrent()) anchor.click();
      } finally {
        anchor.remove();
        URL.revokeObjectURL(url);
      }
    } catch {
      if (stillCurrent()) onError();
    } finally {
      if (mounted.current && sequence === exportSequence.current)
        setExporting(false);
    }
  }

  if (!data)
    return (
      <div className={panel} role={report.error ? "alert" : "status"}>
        {report.error
          ? "Unable to load the current report or access. Values are unavailable, not zero. Use Refresh to retry."
          : "Reading current report… Cached values are withheld until the current request succeeds."}
      </div>
    );
  if (data.status !== "available")
    return (
      <div className={panel} role="status">
        {data.unavailableReason ??
          "Report unavailable. No live values are available."}
      </div>
    );
  // Undated exceptions remain reviewable. No source identifiers beyond booking references and
  // the existing portal person IDs are rendered; business/customer/payment/provider IDs are not.
  const files = Array.from(
    new Map(
      [...data.bookings, ...data.undatedExceptions].map(file => [file.id, file])
    ).values()
  );
  const pages = Math.max(1, Math.ceil(files.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const currentAgentPage = Math.min(
    agentPage,
    Math.max(0, Math.ceil(data.agents.length / PAGE_SIZE) - 1)
  );
  const detail = files.find(file => file.id === selected);
  const margin = data.totals.weightedMargin;

  return (
    <div
      className="space-y-5"
      aria-label="Current Management HQ report"
      data-actor={actorId}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {month ? MONTHS[month - 1] : "Annual"} {year} · GBP · Latest restated
          {mode === "live" ? " Orbit publication" : " sample"}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={exporting || !data.exportComplete}
          onClick={() => void exportCsv()}
        >
          <Download className="mr-2 h-4 w-4" />
          {exporting ? "Preparing CSV…" : "Export all filtered records"}
        </Button>
      </div>
      {mode === "live" && data.stale && (
        <p
          role="alert"
          className="text-sm font-medium text-amber-600 dark:text-amber-300"
        >
          Stale source warning: this last-good report exceeds source freshness
          or carries a source stale flag. Missing is not zero.
        </p>
      )}
      {!data.exportComplete && (
        <p role="alert" className="text-sm text-amber-600 dark:text-amber-300">
          Report exceeds the server export bound. Export is unavailable; this is
          not a complete file.
        </p>
      )}
      {view === "Executive Dashboard" && (
        <>
          <section
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            aria-label="Executive KPIs"
          >
            <div className={panel}>
              <h2 className="text-sm text-muted-foreground">Active bookings</h2>
              <strong className="mt-2 block text-3xl tabular-nums">
                {data.totals.bookingCount}
              </strong>
              <p className="mt-2 text-xs text-muted-foreground">
                Headline-eligible records · {data.totals.passengerCount} known
                passengers · {data.totals.unknownPassengerCount} files with
                unknown passengers
              </p>
            </div>
            <div className={panel}>
              <h2 className="mb-2 text-sm text-muted-foreground">
                Known gross sales
              </h2>
              <Coverage value={data.totals.grossSales} />
            </div>
            <div className={panel}>
              <h2 className="text-sm text-muted-foreground">
                Cancelled bookings
              </h2>
              <strong className="mt-2 block text-3xl tabular-nums">
                {data.cohorts.cancelledCount}
              </strong>
              <p className="mt-2 text-xs text-muted-foreground">
                Excluded from active headlines; retained in records
              </p>
            </div>
            <div className={panel}>
              <h2 className="mb-2 text-sm text-muted-foreground">
                Covered gross profit
              </h2>
              <Coverage value={data.totals.grossProfit} />
              <p className="mt-3 text-sm">
                Weighted margin: <strong>{percent(margin.fraction)}</strong>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {margin.coveredCount} covered records · gross{" "}
                {formatHqMoney(margin.coveredGross)} · profit{" "}
                {formatHqMoney(margin.coveredProfit)}. Covered basis only, not
                an average of file margins.
              </p>
            </div>
          </section>
          <section
            className={`${panel} space-y-3`}
            aria-label="Financial coverage"
          >
            <h2 className="font-semibold">
              Financial coverage — known is not complete
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                "actualCardFees",
                "estimatedCardFees",
                "ptsFees",
                "settledJltIncome",
              ].map(key => {
                const field = MONEY_FIELDS.find(field => field.key === key)!;
                return (
                  <div key={key}>
                    <h3 className="mb-2 text-sm font-medium">{field.label}</h3>
                    <Coverage value={data.totals[field.key]} />
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Baseline commissions and policy-complete commissions are separate
              source views. Actual card fees, fee estimates, PTS assumptions and
              settlement evidence are not interchangeable. Missing settlement is
              not zero income.
            </p>
          </section>
        </>
      )}
      {view === "Financial Performance" && (
        <section
          className={`${panel} space-y-3`}
          aria-label="Financial performance"
        >
          <h2 className="font-semibold">Financial Performance</h2>
          <p className="text-sm text-muted-foreground">
            Aggregated source sums with covered / eligible records. Incomplete
            values are partial, not full-file totals. No new commission
            calculations are made here.
          </p>
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">Financial source coverage</caption>
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className={cell}>
                    Source measure
                  </th>
                  <th scope="col" className={cell}>
                    Known sum / coverage
                  </th>
                  <th scope="col" className={cell}>
                    Interpretation
                  </th>
                </tr>
              </thead>
              <tbody>
                {MONEY_FIELDS.map(field => (
                  <tr key={field.key} className="border-b last:border-0">
                    <th scope="row" className={`${cell} font-medium`}>
                      {field.label}
                    </th>
                    <td className={cell}>
                      <Coverage value={data.totals[field.key]} />
                    </td>
                    <td className={`${cell} text-xs text-muted-foreground`}>
                      {field.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm">
            Covered weighted margin: <strong>{percent(margin.fraction)}</strong>{" "}
            · {margin.coveredCount} records · covered gross{" "}
            {formatHqMoney(margin.coveredGross)} · covered profit{" "}
            {formatHqMoney(margin.coveredProfit)}
          </p>
        </section>
      )}
      {view === "Agent Activity" && (
        <section className={`${panel} space-y-3`} aria-label="Agent activity">
          <h2 className="font-semibold">Agent Activity</h2>
          <p className="text-sm text-muted-foreground">
            Current-owner matches use existing numeric / JLT portal IDs and are
            provisional, not evidence of the original seller. Assigned staff and
            processing administrators are separate and are not treated as
            sellers. Unattributed sellers: {data.cohorts.unattributedCount} ·
            unmatched businesses: {data.cohorts.unmatchedBusinessCount}.
          </p>
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">
                Individual attribution activity
              </caption>
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {[
                    "Agent / attribution basis",
                    "Active bookings",
                    "Known gross / coverage",
                    "Gross profit / coverage",
                    "Pending",
                    "Cancelled",
                  ].map(label => (
                    <th scope="col" className={cell} key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.agents
                  .slice(
                    currentAgentPage * PAGE_SIZE,
                    (currentAgentPage + 1) * PAGE_SIZE
                  )
                  .map(row => (
                    <tr
                      key={row.agent.userId}
                      className="border-b last:border-0"
                    >
                      <td className={cell}>
                        <Person person={row.agent} />
                        <ProvisionalAttribution state={row.attributionState} />
                      </td>
                      <td className={cell}>{row.totals.bookingCount}</td>
                      <td className={cell}>
                        <Coverage value={row.totals.grossSales} />
                      </td>
                      <td className={cell}>
                        <Coverage value={row.totals.grossProfit} />
                      </td>
                      <td className={cell}>{row.pendingCount}</td>
                      <td className={cell}>{row.cancelledCount}</td>
                    </tr>
                  ))}
                {!data.agents.length && (
                  <tr>
                    <td colSpan={6} className={cell}>
                      No attributed agents in this current result; unmatched
                      records are not assigned to processors.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            label="agents"
            count={data.agents.length}
            page={currentAgentPage}
            setPage={setAgentPage}
          />
        </section>
      )}
      <section
        className={`${panel} space-y-3`}
        aria-label="Monthly restated totals"
      >
        <h2 className="font-semibold">Monthly restated totals</h2>
        <p className="text-sm text-muted-foreground">
          Later value changes restate the selected management reporting month;
          registration or date corrections can move a record to another month.
          Cancelled records leave active totals, not the retained file history.
        </p>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <caption className="sr-only">Monthly restated performance</caption>
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                {[
                  "Reporting month",
                  "Active",
                  "Known gross / coverage",
                  "Gross profit / coverage",
                  "Pending",
                  "Cancelled",
                  "Exceptions",
                ].map(label => (
                  <th scope="col" className={cell} key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.monthly.map(row => (
                <tr key={row.month} className="border-b last:border-0">
                  <th scope="row" className={`${cell} font-medium`}>
                    {MONTHS[row.month - 1]} {year}
                  </th>
                  <td className={cell}>{row.totals.bookingCount}</td>
                  <td className={cell}>
                    <Coverage value={row.totals.grossSales} />
                  </td>
                  <td className={cell}>
                    <Coverage value={row.totals.grossProfit} />
                  </td>
                  <td className={cell}>{row.pendingCount}</td>
                  <td className={cell}>{row.cancelledCount}</td>
                  <td className={cell}>{row.exceptionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={`${panel} space-y-3`} aria-label="Booking drilldown">
        <h2 className="font-semibold">Booking drilldown</h2>
        <p className="text-sm text-muted-foreground">
          Retained confirmed, pending, cancelled and exception records. Table
          pagination does not limit the server-bounded export of all filtered
          records.
        </p>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <caption className="sr-only">Retained booking records</caption>
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                {[
                  "Booking / revision",
                  "Status / cohort",
                  "Reporting date / source",
                  "Seller",
                  "Current owner",
                  "Assigned staff",
                  "Admin processor",
                  "Source gross",
                  "Source profit",
                  "Source settlement",
                  "Review",
                ].map(label => (
                  <th scope="col" className={cell} key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {files
                .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
                .map(file => (
                  <tr key={file.id} className="border-b last:border-0">
                    <th scope="row" className={`${cell} font-medium`}>
                      {file.bookingRef}
                      <span className="block text-xs text-muted-foreground">
                        Revision {file.revision}
                      </span>
                    </th>
                    <td className={cell}>
                      <span
                        className={
                          file.status === "cancelled"
                            ? "text-amber-600 dark:text-amber-300"
                            : ""
                        }
                      >
                        {file.status}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {file.cohort}
                      </span>
                    </td>
                    <td className={cell}>
                      {file.reportingDate ?? "Undated"}
                      <span className="block text-xs text-muted-foreground">
                        {file.dateSource}
                      </span>
                    </td>
                    <td className={cell}>
                      <Person person={file.seller} />
                      {!file.seller && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {file.currentOwner
                            ? "Original seller unavailable; current owner provisional"
                            : (file.sellerReason ??
                              "No verified selling attribution")}
                        </p>
                      )}
                    </td>
                    <td className={cell}>
                      <Person person={file.currentOwner ?? null} />
                      <ProvisionalAttribution state={file.attributionState} />
                    </td>
                    <td className={cell}>
                      <Person person={file.assignedStaff ?? null} />
                      {file.assignedStaff && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Current assigned staff only · not seller or admin
                          processor
                        </p>
                      )}
                    </td>
                    <td className={cell}>
                      <Person person={file.processor} />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Processing only
                      </p>
                    </td>
                    <td className={`${cell} whitespace-nowrap tabular-nums`}>
                      {formatHqMoney(file.financials.gross)}
                    </td>
                    <td className={`${cell} whitespace-nowrap tabular-nums`}>
                      {formatHqMoney(file.financials.grossProfit)}
                    </td>
                    <td className={`${cell} whitespace-nowrap tabular-nums`}>
                      {formatHqMoney(file.financials.settledJltIncome)}
                    </td>
                    <td className={cell}>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-expanded={selected === file.id}
                        aria-controls="hq-source-detail"
                        onClick={() =>
                          setSelected(selected === file.id ? null : file.id)
                        }
                      >
                        Source values for {file.bookingRef}
                      </Button>
                    </td>
                  </tr>
                ))}
              {!files.length && (
                <tr>
                  <td colSpan={11} className={cell}>
                    No retained records in this successfully loaded period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          label="bookings"
          count={files.length}
          page={currentPage}
          setPage={setPage}
        />
        {detail && (
          <BookingDetail file={detail} onClose={() => setSelected(null)} />
        )}
      </section>
      <section
        className={`${panel} space-y-2`}
        aria-label="Reporting limitations"
      >
        <h2 className="font-semibold">Coverage and exclusions</h2>
        <p className="text-sm text-muted-foreground">
          Pending: {data.cohorts.pendingCount} · exceptions:{" "}
          {data.cohorts.exceptionCount} · undated: {data.cohorts.undatedCount} ·
          unattributed: {data.cohorts.unattributedCount} · unmatched businesses:{" "}
          {data.cohorts.unmatchedBusinessCount} · excluded demos:{" "}
          {data.cohorts.excludedDemoCount} · tombstones:{" "}
          {data.cohorts.tombstoneCount} · unsupported currency:{" "}
          {data.cohorts.unsupportedCurrencyCount}.
        </p>
        {data.limitations.map((note, index) => (
          <p className="text-xs text-muted-foreground" key={index}>
            {note}
          </p>
        ))}
      </section>
    </div>
  );
}

function BookingDetail({
  file,
  onClose,
}: {
  file: HqBookingDrilldown;
  onClose: () => void;
}) {
  const fields: [keyof HqBookingDrilldown["financials"], string][] = [
    ["gross", "Gross booking value"],
    ["supplierNet", "Complete supplier net cost"],
    ["knownSupplierNetSubtotal", "Known supplier net subtotal"],
    ["grossProfit", "Gross profit"],
    ["applicableVat", "Applicable VAT"],
    ["ptsFees", "PTS fees"],
    ["actualCardFees", "Actual card fees"],
    ["estimatedCardFees", "Estimated card fees"],
    ["baselineAgentCommission", "Baseline agent commission"],
    ["baselineJltRetainedCommission", "Baseline JLT retained commission"],
    ["completeAgentCommission", "Policy-complete agent commission"],
    [
      "completeJltRetainedCommission",
      "Policy-complete JLT retained commission",
    ],
    ["settledJltIncome", "Settled JLT income"],
    ["cancellationCharges", "Source cancellation charges"],
    [
      "cancellationRetainedCommission",
      "Source cancellation retained commission",
    ],
  ];
  return (
    <section
      id="hq-source-detail"
      className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4"
      aria-label={`Source detail for ${file.bookingRef}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{file.bookingRef} · sourced values</h3>
        <Button size="sm" variant="outline" onClick={onClose}>
          Close source detail
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {file.status} · reporting date {file.reportingDate ?? "Undated"} ·{" "}
        {file.dateSource} · {file.business.name} ({file.business.mappingStatus})
        · currency {file.currency ?? "Unknown"} ({file.currencyBasis}).
      </p>
      <dl
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Booking attribution"
      >
        <div>
          <dt className="text-xs text-muted-foreground">Seller</dt>
          <dd>
            <Person person={file.seller} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Current owner</dt>
          <dd>
            <Person person={file.currentOwner ?? null} />
            <ProvisionalAttribution state={file.attributionState} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Assigned staff</dt>
          <dd>
            <Person person={file.assignedStaff ?? null} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            Admin processor · processing only
          </dt>
          <dd>
            <Person person={file.processor} />
          </dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        Baseline complete: {file.financials.baselineComplete ? "yes" : "no"} ·
        policy complete: {file.financials.policyComplete ? "yes" : "no"}.
        Incomplete policy values are not inferred from baseline figures.
      </p>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([key, label]) => (
          <div key={key}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-medium tabular-nums">
              {formatHqMoney(file.financials[key] as string | null)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Source margin: {percent(file.financials.grossMargin.fraction)} (
        {file.financials.grossMargin.state};{" "}
        {file.financials.grossMargin.denominator}). PTS basis:{" "}
        {file.financials.ptsFeeBasis}.{" "}
        {file.financials.ptsAssumptions.join(" · ")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["baseline", "policy"] as const).map(key => {
          const source = file.financials[key];
          return (
            <div
              key={key}
              className="rounded-md border border-border p-3 text-xs"
            >
              <h4 className="font-medium">
                {key === "baseline" ? "Baseline" : "Policy-complete"} source ·{" "}
                {source.basis}
              </h4>
              <p className="mt-1">
                Net distributable commission:{" "}
                {formatHqMoney(source.netDistributableCommission)}
              </p>
              <p className="mt-1">
                Includes card fees:{" "}
                {source.cardProcessingFeesIncluded ? "yes" : "no"} · VAT:{" "}
                {source.vatIncluded ? "yes" : "no"} · PTS:{" "}
                {source.ptsIncluded ? "yes" : "no"}
              </p>
              {source.limitations.map((note, index) => (
                <p key={index} className="mt-1 text-muted-foreground">
                  {note}
                </p>
              ))}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Other deductions:{" "}
        {file.financials.otherDeductions === null
          ? "Missing source evidence"
          : file.financials.otherDeductions.length === 0
            ? "None recorded"
            : file.financials.otherDeductions
                .map(
                  item =>
                    `${item.code}: ${item.currency === "GBP" ? formatHqMoney(item.amount) : `${item.amount ?? "Missing"} ${item.currency ?? "unknown currency"}`} (${item.state}; ${item.applicability})`
                )
                .join(" · ")}
      </p>
      {file.qualityIssues.map((issue, index) => (
        <p className="text-xs text-amber-600 dark:text-amber-300" key={index}>
          {issue}
        </p>
      ))}
    </section>
  );
}
