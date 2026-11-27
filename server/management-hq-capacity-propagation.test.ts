import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createHqImplementedEngine,
  createHqImplementedMemoryStore,
  type HqImplementedStore,
  type HqImplementedSyncState,
} from "./management-hq-ingestion";
import { createHqImplementedSampleReader } from "./management-hq-implemented-fixtures";
import { createHqLiveConfig } from "./management-hq-live-config";
import { createHqLiveService } from "./management-hq-live-service";
import {
  HqLiveError,
  type HqLiveCompletion,
  type HqLiveControl,
  type HqLiveLease,
  type HqLiveStore,
} from "./management-hq-live-store";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DRIZZLE_DATABASE_URL;
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const PRIVATE =
  "SYNTHETIC-CAPACITY-ERROR customer@example.test SELECT private_payload";
const env = () => ({
  HQ_LIVE_SYNC_ENABLED: "true",
  HQ_LIVE_READ_ENABLED: "false",
  HQ_ORBIT_REPORTING_BASE_URL:
    "https://orbit.thejltgroup.co.uk/api/reporting/v1",
  HQ_ORBIT_REPORTING_API_KEY: "SYNTHETIC-REPORTING-KEY-" + "a".repeat(32),
  HQ_PORTAL_SYNC_TOKEN: "SYNTHETIC-PORTAL-TOKEN-" + "b".repeat(32),
});
let staged: HqImplementedSyncState;
let published: HqImplementedSyncState;
let transport: ReturnType<typeof vi.fn>;
beforeAll(async () => {
  const partial = createHqImplementedMemoryStore();
  let methods = 0;
  expect(
    (
      await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        partial,
        { shouldContinue: () => ++methods <= 3 }
      ).sync()
    ).status
  ).toBe("yielded");
  staged = (await partial.readSync())!;
  expect(staged.stage!.recordsRead).toBeGreaterThan(0);
  const full = createHqImplementedMemoryStore();
  expect(
    (
      await createHqImplementedEngine(
        createHqImplementedSampleReader("initial"),
        full
      ).sync()
    ).status
  ).toBe("applied");
  published = (await full.readSync())!;
});
beforeEach(() => {
  transport = vi.fn(() => {
    throw new Error("Actual network forbidden");
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => {
  expect(transport).not.toHaveBeenCalled();
  expect(process.env.DATABASE_URL).toBeUndefined();
  expect(process.env.DRIZZLE_DATABASE_URL).toBeUndefined();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function capacityStore(seed: HqImplementedSyncState) {
  const memory = createHqImplementedMemoryStore(seed);
  const failure = new HqLiveError("STATE_BYTE_CAP_EXCEEDED");
  failure.message = PRIVATE;
  const cas = vi.fn(async () => {
    throw failure;
  });
  const read = vi.fn(() => memory.readSync());
  const store: HqImplementedStore = { readSync: read, compareAndSwapSync: cas };
  return { memory, store, read, cas, failure };
}

describe("real external engine capacity-code propagation, synthetic source only", () => {
  it.each(["saved initial stage", "last-good publication"] as const)(
    "retains CAS capacity code and unchanged %s instead of transient remapping",
    async kind => {
      const before = clone(kind === "saved initial stage" ? staged : published);
      const s = capacityStore(before);
      const reader = createHqImplementedSampleReader(
        kind === "saved initial stage" ? "initial" : "amended"
      );
      const result = await createHqImplementedEngine(reader, s.store).sync();
      expect(result.status).toBe("unavailable");
      expect(result).toMatchObject({
        code: "STATE_BYTE_CAP_EXCEEDED",
        state: before.published,
      });
      expect(result).not.toMatchObject({ code: "SOURCE_OR_STORE_UNAVAILABLE" });
      expect(s.cas).toHaveBeenCalledOnce();
      expect(s.read.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(await s.memory.readSync()).toEqual(before);
      expect(JSON.stringify(result)).not.toContain(PRIVATE);
    }
  );
  it.each([true, false])(
    "real service initialOnly=%s sends durable attention completion, never transient backoff",
    async initialOnly => {
      // Completion persistence below is an explicit in-memory adapter, not actual SQL.
      // The real service and engine must select terminal attention before that adapter.
      const before = clone(staged);
      const s = capacityStore(before);
      const config = createHqLiveConfig(env());
      const lease: HqLiveLease = {
        token: "SYNTHETIC-LEASE",
        fencingNumber: 3,
        sourceFingerprint: config.sourceFingerprint()!,
        hardExpiresAtMs: 97000,
      };
      const control: HqLiveControl = {
        format: "hq-live-control-v1",
        version: 17,
        sourceFingerprint: lease.sourceFingerprint,
        fencingNumber: 3,
        leaseToken: lease.token,
        leaseExpiresAtMs: 32000,
        leaseHardExpiresAtMs: 97000,
        nextDueAtMs: 1000,
        consecutiveFailures: 2,
        lastAttemptAtMs: 2000,
        lastSuccessAtMs: null,
        lastPublishAtMs: null,
        lastErrorCode: null,
        stageStatus: "running",
      };
      const forbidden = vi.fn(async () => {
        throw new Error("Publication/full snapshot reads forbidden");
      });
      const complete = vi.fn(
        async (_lease: HqLiveLease, completion: HqLiveCompletion) => {
          control.stageStatus = completion.status;
          control.lastErrorCode = completion.errorCode ?? null;
          control.nextDueAtMs = 2000 + completion.delaySeconds * 1000;
          control.consecutiveFailures++;
          control.leaseToken = null;
          control.leaseExpiresAtMs = null;
          control.leaseHardExpiresAtMs = null;
        }
      );
      const acquire = vi.fn(async () => ({
        status: "acquired" as const,
        lease,
      }));
      const acquireInitialPublication = vi.fn(async () => ({
        status: "acquired" as const,
        lease,
      }));
      const renew = vi.fn(async () => {});
      const fencedSyncStore = vi.fn(() => s.store);
      const liveStore: HqLiveStore = {
        readSnapshot: forbidden,
        readPublished: forbidden,
        acquire,
        acquireInitialPublication,
        renew,
        fencedSyncStore,
        complete,
      };
      const guard = vi.fn(async () => {});
      const createReader = vi.fn(() =>
        createHqImplementedSampleReader("initial")
      );
      const service = createHqLiveService({
        config,
        createStore: () => liveStore,
        createReader,
        now: () => 2000,
        ...(initialOnly
          ? { onlyInitialPublication: true, initialImportGuard: guard }
          : {}),
      });
      const result = await service.invoke();
      expect(result).toEqual({
        status: "needs_attention",
        errorCode: "STATE_BYTE_CAP_EXCEEDED",
      });
      expect(complete).toHaveBeenCalledOnce();
      expect(complete).toHaveBeenCalledWith(lease, {
        status: "needs_attention",
        delaySeconds: 3600,
        errorCode: "STATE_BYTE_CAP_EXCEEDED",
      });
      expect(
        complete.mock.calls.some(
          ([, completion]) => completion.status === "backoff"
        )
      ).toBe(false);
      expect(control).toMatchObject({
        stageStatus: "needs_attention",
        lastErrorCode: "STATE_BYTE_CAP_EXCEEDED",
        consecutiveFailures: 3,
        leaseToken: null,
        lastSuccessAtMs: null,
        lastPublishAtMs: null,
      });
      expect(await s.memory.readSync()).toEqual(before);
      expect(s.cas).toHaveBeenCalledOnce();
      expect(createReader).toHaveBeenCalledOnce();
      expect(fencedSyncStore).toHaveBeenCalledWith(lease);
      expect(forbidden).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toMatch(
        /SYNTHETIC|customer@|SELECT|private_payload/
      );
      if (initialOnly) {
        expect(acquire).not.toHaveBeenCalled();
        expect(acquireInitialPublication).toHaveBeenCalledOnce();
        expect(guard).toHaveBeenCalled();
      } else {
        expect(acquire).toHaveBeenCalledOnce();
        expect(acquireInitialPublication).not.toHaveBeenCalled();
        expect(guard).not.toHaveBeenCalled();
      }
    }
  );
});
