import suppliedHttpExamples from "./fixtures/management-hq-implemented-http-examples.json";
import type {
  HqWireBookingPage,
  HqWireBusinessPage,
  HqWireCataloguePage,
  HqWireChangePage,
  HqWireEntity,
  HqWireMemberLink,
  HqWireMetadata,
  HqWirePageQuery,
  HqWireReader,
} from "../shared/management-hq-wire";
import type { HqIdentityDirectory } from "./management-hq-engine";
import type { HqReportPerson } from "../shared/management-hq-report";
import {
  hqCurrentOwnerSourceCandidate,
  hqAssignedStaffSourceCandidate,
} from "./management-hq-projection";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  type HqImplementedState,
} from "./management-hq-ingestion";
import {
  validateHqWireBookingPage,
  validateHqWireBusinessPage,
  validateHqWireCataloguePage,
  validateHqWireChangePage,
  validateHqWireStatus,
  validateHqWireCapabilities,
} from "./management-hq-wire-contract";

export type HqImplementedSampleStage =
  | "initial"
  | "amended"
  | "cancelled"
  | "registered";
const STAGES: HqImplementedSampleStage[] = [
  "initial",
  "amended",
  "cancelled",
  "registered",
];
const SOURCE_KEYS = {
  initial: "beforeAmendment",
  amended: "afterAmendment",
  cancelled: "afterCancellation",
  registered: "afterLaterRegistration",
} as const;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** The JSON file is a byte-for-byte copy of the supplied HTTP examples, not a
 * new fake wire contract. Derived responses below are fixture scaffolding only;
 * they are NOT claimed to be additional supplied/observed Orbit HTTP responses. */
export const HQ_IMPLEMENTED_SAMPLE_PROVENANCE = {
  sourceFile: "Management_HQ_Synthetic_HTTP_Examples.json",
  sourceSha256:
    "eafa38df7c549497146a4893c0b543bd9ae68f962a4859aab6d1268f26c0b235",
  actualSuppliedResponses: [
    "beforeAmendment: BookingPage",
    "afterAmendment: ChangePage (exact seq 2 upsert)",
    "afterCancellation: BookingPage",
    "afterLaterRegistration: BookingPage",
  ],
  derivedFixtureResponses: [
    "Amended BookingPage drops only the supplied seq/operation change envelope fields.",
    "Cancellation/registration ChangePages wrap the supplied full payloads as seq 3/4 upserts; original signed resumeCursor and generation metadata are preserved.",
    "BusinessPage uses tenant 90052 and the supplied coherent member link, revision 1 (unchanged across these booking-only stages). Business name/activity and empty configured rates are fixture-only, not observed business facts.",
    "CataloguePage uses the same pinned generation and exact entity IDs/revisions as the fixture feeds.",
    "Status/capabilities are schema-shaped fixture responses, with metadata copied from the corresponding supplied stage.",
    "A same-checkpoint changes read is a derived empty page, not a supplied response.",
    "Portal owner/staff crosswalks are synthetic test users, not verified live identities or proof of the original seller.",
  ],
  liveReady: false,
} as const;

function sourceBody(stage: HqImplementedSampleStage) {
  if (!STAGES.includes(stage)) throw new Error("Unknown HQ sample stage");
  return copy(suppliedHttpExamples[SOURCE_KEYS[stage]].body);
}

function entityFromSource(stage: HqImplementedSampleStage): HqWireEntity {
  const item = sourceBody(stage).items[0];
  return {
    entityType: "booking",
    entityId: item.entityId,
    revision: item.revision,
    payload: copy(item.payload),
  } as HqWireEntity;
}

function metadataFromSource(stage: HqImplementedSampleStage): HqWireMetadata {
  const body = sourceBody(stage);
  const {
    generationId,
    projectionVersion,
    scope,
    sourceObservationWindow,
    publishedAt,
    expiresAt,
    changeUpper,
    sourceAgeSeconds,
    freshnessTargetSeconds,
    stale,
    consistency,
    counts,
  } = body;
  return copy({
    generationId,
    projectionVersion,
    scope,
    sourceObservationWindow,
    publishedAt,
    expiresAt,
    changeUpper,
    sourceAgeSeconds,
    freshnessTargetSeconds,
    stale,
    consistency,
    counts,
  }) as HqWireMetadata;
}

function bookingPage(stage: HqImplementedSampleStage): HqWireBookingPage {
  const body = sourceBody(stage);
  // Three actual supplied BookingPages enter the real validator unmodified.
  // Only the amended response needs conversion from its actual ChangePage.
  return validateHqWireBookingPage(
    stage === "amended"
      ? { ...body, entityType: "booking", items: [entityFromSource(stage)] }
      : body
  );
}

function businessEntity(): HqWireEntity {
  const initial = bookingPage("initial");
  const identity = copy(initial.items[0].payload.identity) as HqWireMemberLink;
  return {
    entityType: "business",
    entityId: identity.orbitTenantId!,
    revision: 1,
    payload: {
      orbitTenantId: identity.orbitTenantId!,
      isActive: true,
      account: { businessName: "Synthetic HQ business", accountType: "real" },
      identity,
      configuredCardFeeRates: {},
      membershipHistoryAvailable: false,
      portalMembershipJoinDate: null,
    },
  };
}

function fixtureQueryError(expired = false): never {
  throw Object.assign(new Error("Invalid offline HQ fixture traversal"), {
    code: expired ? "RESTART_REQUIRED" : "INVALID_QUERY",
    status: expired ? 410 : 400,
  });
}
function validateLimit(limit?: number) {
  if (
    limit !== undefined &&
    (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
  )
    fixtureQueryError();
}
function validateQuery(
  query: HqWirePageQuery | undefined,
  generationId: number
) {
  if (!query) return;
  validateLimit(query.limit);
  // These one-page supplied fixtures contain no traversal tokens. Do not invent,
  // decode, construct or treat a checkpoint token as a backfill page token.
  if (query.cursor !== undefined) fixtureQueryError();
  if (query.generationId !== undefined && query.generationId !== generationId)
    fixtureQueryError(true);
}

/** Pure, deterministic, isolated reader. No network, DB, environment, timers,
 * credentials or operational imports. Every body uses the actual wire validators. */
export function createHqImplementedSampleReader(
  stage: HqImplementedSampleStage
): HqWireReader {
  const metadata = metadataFromSource(stage);
  const body = sourceBody(stage);
  const business = businessEntity();
  const pageFields = {
    ...metadata,
    nextCursor: body.nextCursor,
    resumeCursor: body.resumeCursor,
    complete: body.complete,
    checkpointInstructions: body.checkpointInstructions,
  };
  return {
    async status() {
      return validateHqWireStatus({ ...copy(metadata), ready: true });
    },
    async capabilities() {
      return validateHqWireCapabilities({
        apiVersion: "1.0.0",
        endpoints: [
          "/bookings",
          "/business-mappings",
          "/catalogue",
          "/changes",
          "/status",
          "/capabilities",
        ],
        quotes: false,
        sourceWrites: false,
        providerCalls: false,
      });
    },
    async bookings(query) {
      validateQuery(query, metadata.generationId);
      return bookingPage(stage);
    },
    async businessMappings(query): Promise<HqWireBusinessPage> {
      validateQuery(query, metadata.generationId);
      return validateHqWireBusinessPage({
        ...copy(pageFields),
        entityType: "business",
        items: [copy(business)],
      });
    },
    async catalogue(entityType, query): Promise<HqWireCataloguePage> {
      validateQuery(query, metadata.generationId);
      if (entityType !== "booking" && entityType !== "business")
        fixtureQueryError();
      const entity =
        entityType === "booking" ? entityFromSource(stage) : business;
      return validateHqWireCataloguePage({
        ...copy(pageFields),
        entityType,
        items: [
          {
            entityType: entity.entityType,
            entityId: entity.entityId,
            revision: entity.revision,
          },
        ],
      });
    },
    async changes(cursor, limit): Promise<HqWireChangePage> {
      validateLimit(limit);
      // Compare known opaque strings only. Never inspect token internals.
      const from = STAGES.findIndex(
        candidate => sourceBody(candidate).resumeCursor === cursor
      );
      const to = STAGES.indexOf(stage);
      if (from < 0 || from > to) fixtureQueryError(true);
      // The supplied actual amendment response MUST remain byte-for-byte in
      // meaning: its original seq 2, payload, generation and checkpoint enter AJV.
      if (stage === "amended" && from === 0)
        return validateHqWireChangePage(sourceBody("amended"));
      const items = STAGES.slice(from + 1, to + 1).map(candidate => {
        const entity = entityFromSource(candidate);
        return {
          ...entity,
          seq: sourceBody(candidate).changeUpper,
          operation: "upsert" as const,
        };
      });
      if (limit !== undefined && items.length > limit) fixtureQueryError();
      return validateHqWireChangePage({
        ...copy(pageFields),
        entityType: "mixed",
        items,
      });
    },
  };
}

/** Replays initial backfill then each actual supplied stage through the real
 * ingestion engine, publishing only fully applied states. Engine versions are
 * local CAS versions; source generation keys and signed checkpoints stay opaque. */
export async function runHqImplementedSampleScenario(
  scenario: HqImplementedSampleStage
): Promise<HqImplementedState> {
  if (!STAGES.includes(scenario)) throw new Error("Unknown HQ sample scenario");
  const store = createHqImplementedMemoryStore();
  let state: HqImplementedState | null = null;
  for (const stage of STAGES.slice(0, STAGES.indexOf(scenario) + 1)) {
    const engine = createHqImplementedEngine(
      createHqImplementedSampleReader(stage),
      store
    );
    const result =
      stage === "initial" ? await engine.backfill() : await engine.catchup();
    if (result.status !== "applied")
      throw new Error(
        `Offline HQ sample ingestion unavailable: ${result.code}`
      );
    state = result.state;
  }
  return state!;
}

const sampleOwner: HqReportPerson = {
  userId: 101,
  uniqueAgentId: "SYN-MEMBER-1",
  name: "Synthetic Current Owner",
  role: "agent",
};
const sampleStaff: HqReportPerson = {
  userId: 102,
  uniqueAgentId: "SYN-STAFF-1",
  name: "Synthetic Assigned Staff",
  role: "staff",
};

/** Synthetic Portal crosswalk only. It does not promote source candidates to
 * historically verified selling attribution, and resolve() intentionally cannot
 * manufacture a legacy original seller or a processing administrator. */
export function createHqImplementedSampleDirectory(): HqIdentityDirectory & {
  resolveCurrentOwner(link: HqWireMemberLink): Promise<HqReportPerson | null>;
  resolveAssignedStaff(link: HqWireMemberLink): Promise<HqReportPerson | null>;
} {
  return {
    async resolve() {
      return null;
    },
    async resolveCurrentOwner(link) {
      const candidate = hqCurrentOwnerSourceCandidate(link);
      return candidate?.jltAgentId === "SYN-MEMBER-1" &&
        candidate.jltOpenId === "synthetic-owner-open-id"
        ? copy(sampleOwner)
        : null;
    },
    async resolveAssignedStaff(link) {
      const candidate = hqAssignedStaffSourceCandidate(link);
      return candidate?.jltAgentId === "SYN-STAFF-1" &&
        candidate.jltOpenId === "synthetic-staff-open-id"
        ? copy(sampleStaff)
        : null;
    },
  };
}
