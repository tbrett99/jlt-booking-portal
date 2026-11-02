import { describe, expect, it, vi } from "vitest";
// Importing these modules must never initialize a database or contact Resend.
vi.mock("./db", () => ({
  getDb: vi.fn(),
  areNotificationsPaused: vi.fn(async () => false),
}));
vi.mock("./email", () => ({
  sendDirectEmail: vi.fn(),
  sendSupportEmail: vi.fn(),
}));
import {
  createMembershipPaymentService,
  type MembershipPaymentStore,
  type MembershipPaymentTransaction,
  type MembershipAccountSnapshot,
  type RecordMembershipPaymentEventInput,
  type FrozenMembershipEmail,
} from "./membership-payment-service";

type Outbox = NonNullable<
  Awaited<ReturnType<MembershipPaymentTransaction["getOutbox"]>>
>;
type State = MembershipAccountSnapshot & {
  outbox: Outbox[];
  obligations: Record<string, unknown>[];
  legacy: unknown[];
};
const activation = new Date("2026-10-01T00:00:00Z");
function makeState(): State {
  return {
    account: {
      userId: 7,
      failedAttempts: 0,
      outstandingPence: 0,
      outstandingCount: 0,
      runKey: null,
      lastFailedAt: null,
      lastSyncedAt: null,
      lastError: null,
      historyReviewRequired: false,
      updatedAt: activation,
    },
    control: {
      id: 1,
      enabled: true,
      activatedAt: activation,
      feeAmountPence: 2500,
      feePolicyApproved: true,
      feeCollectionMode: "staff_approval",
      lastEventSyncAt: null,
      lastSuccessAt: null,
      lastError: null,
      updatedAt: activation,
    } as State["control"],
    user: {
      id: 7,
      name: "Ava <Agent>",
      email: "login@example.com",
      role: "agent",
      isActive: true,
      portalStatus: "active",
      suspendedAt: null,
      suspensionReason: null,
    } as State["user"],
    profile: {
      userId: 7,
      agentStatus: "active",
      paymentExempt: false,
      suspensionReason: null,
      correspondenceEmailKind: "business",
      businessEmail: "operational@example.com",
      jltEmail: "jlt@example.com",
    } as State["profile"],
    events: [],
    settlements: [],
    fees: [],
    outbox: [],
    obligations: [],
    legacy: [],
  };
}
function harness() {
  let state = makeState();
  let clock = new Date("2026-11-01T12:00:00Z");
  let failCommit = false;
  let pause = false;
  let tokenNumber = 0;
  const health = vi.fn();
  let mutex = Promise.resolve();
  const store: MembershipPaymentStore = {
    async recordEvent(value) {
      const existing = state.events.find(e => e.eventId === value.eventId);
      if (existing) {
        if (existing.userId === null)
          Object.assign(existing, value, { status: "pending" });
        else if (
          existing.userId !== value.userId ||
          existing.paymentId !== value.paymentId ||
          existing.action !== value.action
        )
          throw new Error("Conflicting mapped membership event ID");
        return;
      }
      state.events.push({
        id: state.events.length + 1,
        createdAt: clock,
        processedAt: null,
        lastError: null,
        ...value,
      } as State["events"][number]);
    },
    async transaction(memberId, work) {
      if (memberId === 99) throw new Error("broken account");
      let release!: () => void;
      const previous = mutex;
      mutex = new Promise<void>(resolve => {
        release = resolve;
      });
      await previous;
      const draft = structuredClone(state);
      const tx: MembershipPaymentTransaction = {
        async load() {
          return structuredClone(draft);
        },
        async saveAccount(value) {
          Object.assign(draft.account, value);
        },
        async saveObligation(value) {
          const existing = draft.obligations.find(
            p => p.paymentId === value.paymentId
          );
          if (existing) Object.assign(existing, value);
          else draft.obligations.push({ ...value });
        },
        async getObligation(paymentId) {
          return structuredClone(
            draft.obligations.find(p => p.paymentId === paymentId) ?? null
          ) as Awaited<
            ReturnType<MembershipPaymentTransaction["getObligation"]>
          >;
        },
        async insertFee(value) {
          if (!draft.fees.some(f => f.runKey === value.runKey))
            draft.fees.push({
              id: draft.fees.length + 1,
              createdAt: clock,
              updatedAt: clock,
              paymentId: null,
              approvedById: null,
              settledById: null,
              lastError: null,
              ...value,
            } as State["fees"][number]);
        },
        async insertOutbox(value) {
          if (!draft.outbox.some(o => o.dedupeKey === value.dedupeKey))
            draft.outbox.push({
              id: draft.outbox.length + 1,
              status: "pending",
              attempts: 0,
              firstAttemptAt: null,
              nextAttemptAt: null,
              lockedUntil: null,
              lockToken: null,
              providerMessageId: null,
              recipientEmail: null,
              lastError: null,
              createdAt: clock,
              updatedAt: clock,
              ...value,
            } as Outbox);
        },
        async markProcessed(ids, at) {
          for (const event of draft.events)
            if (ids.includes(event.id))
              Object.assign(event, {
                status: "processed",
                processedAt: at,
                lastError: null,
              });
        },
        async suspend(at) {
          if (
            draft.user?.portalStatus !== "active" ||
            draft.profile?.agentStatus !== "active"
          )
            return false;
          Object.assign(draft.user, {
            portalStatus: "suspended",
            isActive: false,
            suspendedAt: at,
            suspensionReason: "non_payment",
          });
          Object.assign(draft.profile, {
            agentStatus: "suspended",
            suspendedAt: at,
            suspensionReason: "non_payment",
          });
          return true;
        },
        async mirrorLegacy(result, at) {
          draft.legacy.push({ result, at });
        },
        async insertSettlement(value) {
          const row = {
            id: draft.settlements.length + 1,
            createdAt: clock,
            ...value,
          } as State["settlements"][number];
          draft.settlements.push(row);
          return structuredClone(row);
        },
        async getOutbox(id) {
          return structuredClone(draft.outbox.find(o => o.id === id) ?? null);
        },
        async updateOutbox(id, value, expectedToken) {
          const row = draft.outbox.find(o => o.id === id);
          if (
            !row ||
            (expectedToken !== undefined && row.lockToken !== expectedToken)
          )
            return false;
          Object.assign(row, value);
          return true;
        },
      };
      try {
        const result = await work(tx);
        if (failCommit) {
          failCommit = false;
          throw new Error("crash before transaction commit");
        }
        state = draft;
        return result;
      } finally {
        release();
      }
    },
    async pendingUserIds(limit) {
      return Array.from(
        new Set(
          state.events
            .filter(e => ["pending", "failed"].includes(e.status))
            .map(e => e.userId!)
        )
      ).slice(0, limit);
    },
    async outboxCandidates(at, limit) {
      return state.outbox
        .filter(
          o =>
            ["pending", "failed", "sending"].includes(o.status) &&
            (!o.nextAttemptAt || o.nextAttemptAt <= at) &&
            (!o.lockedUntil || o.lockedUntil <= at)
        )
        .slice(0, limit);
    },
    health,
    async accountError(_, error) {
      state.account.lastError = error;
    },
  };
  const sends: (FrozenMembershipEmail & { idempotencyKey: string })[] = [];
  const sendAgent = vi.fn(
    async (mail: FrozenMembershipEmail & { idempotencyKey: string }) => {
      sends.push(structuredClone(mail));
      return { success: true, providerMessageId: `accepted-${sends.length}` };
    }
  );
  const sendSupport = vi.fn(
    async (mail: FrozenMembershipEmail & { idempotencyKey: string }) => {
      sends.push(structuredClone(mail));
      return { success: true, providerMessageId: `support-${sends.length}` };
    }
  );
  const api = createMembershipPaymentService({
    store,
    now: () => clock,
    token: () => `lease-${++tokenNumber}`,
    notificationsPaused: async () => pause,
    sendAgent,
    sendSupport,
  });
  async function record(
    eventId: string,
    offset: number,
    overrides: Partial<RecordMembershipPaymentEventInput> = {}
  ) {
    const input = {
      eventId,
      userId: 7,
      paymentId: "PM-old",
      subscriptionId: "SB-verified",
      action: "failed",
      occurredAt: new Date(activation.getTime() + offset * 60_000),
      amountPence: 8700,
      currency: "GBP",
      source: "webhook",
      rawPayload: "{}",
      ...overrides,
    };
    await api.recordMembershipPaymentEvent(input);
  }
  return {
    api,
    store,
    record,
    sendAgent,
    sendSupport,
    sends,
    health,
    get state() {
      return state;
    },
    tick(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
    crashCommit() {
      failCommit = true;
    },
    paused(value: boolean) {
      pause = value;
    },
  };
}

async function twoFailures(h: ReturnType<typeof harness>) {
  await h.record("EV-1", 1);
  await h.record("EV-2", 2);
  await h.api.processMembershipPaymentAccount(7);
}

describe("durable membership account processing", () => {
  it("receipt/enrichment is durable inbox only; a crash before processing leaves resumable work", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    expect(h.state.account.failedAttempts).toBe(0);
    expect(h.state.events[0].status).toBe("pending");
    expect(h.state.outbox).toHaveLength(0);
    expect(h.sendAgent).not.toHaveBeenCalled();
    const result = await h.api.processPendingMembershipAccounts();
    expect(result.processed).toBe(1);
    expect(h.state.account.failedAttempts).toBe(1);
    expect(h.state.events[0].status).toBe("processed");
    expect(h.state.outbox.map(o => o.kind)).toEqual([
      "failure",
      "failure_support",
    ]);
  });

  it("enriches an unmapped receipt and does not reopen a processed exact replay", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    h.state.events[0].userId = null;
    await h.record("EV-1", 1);
    expect(h.state.events).toHaveLength(1);
    expect(h.state.events[0].userId).toBe(7);
    await h.api.processMembershipPaymentAccount(7);
    await h.record("EV-1", 1);
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.account.failedAttempts).toBe(1);
    expect(h.state.outbox).toHaveLength(2);
    expect(h.state.events[0].status).toBe("processed");
  });

  it("rolls back counters, obligations and intents together before the processed checkpoint", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    h.crashCommit();
    await expect(h.api.processMembershipPaymentAccount(7)).rejects.toThrow(
      "crash"
    );
    expect(h.state.events[0].status).toBe("pending");
    expect(h.state.outbox).toHaveLength(0);
    expect(h.state.obligations).toHaveLength(0);
    expect(h.state.account.failedAttempts).toBe(0);
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.outbox).toHaveLength(2);
    expect(h.state.account.lastError).toBeNull();
  });

  it("counts distinct attempts on one payment, assesses one configured fee and suspends once", async () => {
    const h = harness();
    h.state.control!.feeAmountPence = 3100;
    for (let n = 1; n <= 4; n++) {
      await h.record(`EV-${n}`, n);
      await h.api.processMembershipPaymentAccount(7);
    }
    expect(h.state.account.failedAttempts).toBe(4);
    expect(h.state.account.outstandingCount).toBe(1);
    expect(h.state.account.outstandingPence).toBe(8700);
    expect(h.state.fees).toHaveLength(1);
    expect(h.state.fees[0]).toMatchObject({
      amountPence: 3100,
      status: "assessed",
    });
    expect(h.state.user!.portalStatus).toBe("suspended");
    expect(h.state.outbox.filter(o => o.kind === "failure")).toHaveLength(4);
    expect(
      h.state.outbox.filter(o => o.kind === "failure_support")
    ).toHaveLength(4);
    expect(
      h.state.outbox.filter(o => o.kind === "suspension_support")
    ).toHaveLength(1);
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.fees).toHaveLength(1);
  });

  it.each(["paused", "cancelled", "in_notice", "suspended"] as const)(
    "never overwrites manual %s status",
    async status => {
      const h = harness();
      h.state.user!.portalStatus = status;
      h.state.user!.suspensionReason = "manual";
      h.state.profile!.agentStatus = status;
      h.state.profile!.suspensionReason = "manual";
      for (let n = 1; n <= 3; n++) await h.record(`EV-${n}`, n);
      await h.api.processMembershipPaymentAccount(7);
      expect(h.state.user!.portalStatus).toBe(status);
      expect(h.state.user!.suspensionReason).toBe("manual");
      expect(h.state.outbox.some(o => o.kind === "suspension_support")).toBe(
        false
      );
    }
  );

  it("requires role, nonexemption and both active status records for automatic suspension", async () => {
    for (const variation of [
      "admin",
      "exempt",
      "crmPaused",
      "inactive",
    ] as const) {
      const h = harness();
      if (variation === "admin") h.state.user!.role = "admin";
      if (variation === "exempt") h.state.profile!.paymentExempt = true;
      if (variation === "crmPaused") h.state.profile!.agentStatus = "paused";
      if (variation === "inactive") h.state.user!.isActive = false;
      for (let n = 1; n <= 3; n++) await h.record(`EV-${n}`, n);
      await h.api.processMembershipPaymentAccount(7);
      expect(h.state.user!.portalStatus).toBe("active");
      expect(h.state.outbox.some(o => o.kind === "suspension_support")).toBe(
        false
      );
      if (["admin", "exempt", "inactive"].includes(variation))
        expect(h.state.outbox).toHaveLength(0);
    }
  });

  it("holds unresolved historical failures for review without catch-up mail, assessed fees or suspension", async () => {
    const h = harness();
    for (let n = 1; n <= 4; n++) await h.record(`OLD-${n}`, -10 + n);
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.account.failedAttempts).toBe(4);
    expect(h.state.account.historyReviewRequired).toBe(true);
    expect(h.state.outbox).toHaveLength(0);
    expect(h.state.fees.map(f => f.status)).toEqual(["review"]);
    expect(h.state.user!.portalStatus).toBe("active");
    await h.record("UNRELATED-SUCCESS", 1, {
      paymentId: "PM-next",
      action: "confirmed",
    });
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.user!.portalStatus).toBe("active");
    expect(h.state.account.outstandingCount).toBe(1);
    await h.record("OLD-RECOVERED", 2, { action: "confirmed" });
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.account.historyReviewRequired).toBe(false);
    expect(h.state.account.outstandingCount).toBe(0);
  });

  it("keeps paused future events pending and finishes each effect only on resume", async () => {
    const h = harness();
    h.state.control!.enabled = false;
    await h.record("EV-1", 1);
    await h.record("EV-2", 2);
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.events.map(e => e.status)).toEqual(["pending", "pending"]);
    expect(h.state.fees).toHaveLength(0);
    expect(h.state.outbox).toHaveLength(0);
    h.state.control!.enabled = true;
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.outbox).toHaveLength(4);
    expect(h.state.fees).toHaveLength(1);
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.outbox).toHaveLength(4);
  });

  it("bulk history remains audit-only even when its timestamps are after activation", async () => {
    const h = harness();
    for (let n = 1; n <= 3; n++)
      await h.record(`H-${n}`, n, { source: "backfill" });
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.outbox).toHaveLength(0);
    expect(h.state.user!.portalStatus).toBe("active");
    expect(h.state.fees[0].status).toBe("review");
    expect(h.state.account.historyReviewRequired).toBe(true);
  });

  it("deduplicates fees when an earlier late failure changes the reducer run key", async () => {
    const h = harness();
    await twoFailures(h);
    const key = h.state.fees[0].runKey;
    await h.record("EV-earlier", 0.5);
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.account.failedAttempts).toBe(3);
    expect(h.state.fees).toHaveLength(1);
    expect(h.state.fees[0].runKey).toBe(key);
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.fees).toHaveLength(1);
  });

  it("does not promote a historical review fee when a future retry reaches three", async () => {
    const h = harness();
    await h.record("H-1", -2);
    await h.record("H-2", -1);
    await h.api.processMembershipPaymentAccount(7);
    await h.record("F-3", 1);
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.fees).toHaveLength(1);
    expect(h.state.fees[0].status).toBe("review");
    expect(h.state.user!.portalStatus).toBe("suspended");
    await h.api.processMembershipPaymentOutbox();
    expect(h.sends.every(s => !s.html.includes("fee of"))).toBe(true);
  });

  it("unapproved fee policy creates review only and never claims an assessed fee", async () => {
    const h = harness();
    h.state.control!.feePolicyApproved = false;
    await twoFailures(h);
    expect(h.state.fees).toHaveLength(1);
    expect(h.state.fees[0].status).toBe("review");
    await h.api.processMembershipPaymentOutbox(50);
    expect(
      h.sends.every(
        s => !s.html.includes("fee of") && !s.html.includes("has been assessed")
      )
    ).toBe(true);
    h.state.control!.feePolicyApproved = true;
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.fees[0].status).toBe("review");
  });

  it("assesses one new fee after genuine full recovery starts a separate unresolved run", async () => {
    const h = harness();
    await twoFailures(h);
    await h.record("C-old", 3, { action: "confirmed" });
    await h.record("N-1", 4, { paymentId: "PM-new" });
    await h.record("N-2", 5, { paymentId: "PM-new" });
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.fees).toHaveLength(2);
    expect(h.state.fees[0].runKey).not.toBe(h.state.fees[1].runKey);
  });

  it("a new late failure triggers suspension when complete rebuilt future attempts reach three", async () => {
    const h = harness();
    await twoFailures(h);
    await h.record("EV-late-earlier", 0.5);
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.user!.portalStatus).toBe("suspended");
    expect(
      h.state.outbox.filter(o => o.kind === "suspension_support")
    ).toHaveLength(1);
  });

  it("later month's confirmed/paid_out does not clear older arrears; confirmed yields one receipt", async () => {
    const h = harness();
    await h.record("F-old", 1);
    await h.record("F-next", 2, { paymentId: "PM-next", amountPence: 12700 });
    await h.api.processMembershipPaymentAccount(7);
    await h.record("C-next", 3, {
      paymentId: "PM-next",
      action: "confirmed",
      amountPence: 12700,
    });
    await h.record("P-next", 4, {
      paymentId: "PM-next",
      action: "paid_out",
      amountPence: 12700,
    });
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.account.failedAttempts).toBe(2);
    expect(h.state.account.outstandingPence).toBe(8700);
    expect(h.state.outbox.filter(o => o.kind === "receipt")).toHaveLength(1);
    expect(
      h.state.obligations.find(p => p.paymentId === "PM-old")!.status
    ).toBe("outstanding");
    await h.record("C-old", 5, { action: "confirmed" });
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.account.outstandingCount).toBe(0);
    expect(h.state.account.failedAttempts).toBe(0);
    await h.api.processMembershipPaymentOutbox();
    expect(
      h.sends.filter(s => s.subject.includes("Confirmed"))[0].html
    ).toContain("£127.00");
    expect(
      h.sends.every(
        s => !s.html.includes("VAT") && !s.html.includes("Business Class")
      )
    ).toBe(true);
  });

  it("records immutable full manual settlement and does not fabricate success or reinstate", async () => {
    const h = harness();
    for (let n = 1; n <= 3; n++) await h.record(`EV-${n}`, n);
    await h.api.processMembershipPaymentAccount(7);
    const count = h.state.events.length;
    const result = await h.api.recordManualMembershipSettlement({
      userId: 7,
      paymentId: "PM-old",
      actorId: 11,
      reference: "BANK-123",
      notes: "Full transfer verified",
      settledAt: "2026-10-02T00:00:00Z",
      amountPence: 8700,
    });
    expect(result.account.outstandingCount).toBe(0);
    expect(result.settlement).toMatchObject({
      recordedById: 11,
      reference: "BANK-123",
    });
    expect(result.settlement.notes).toContain("8700 GBP minor units");
    expect(h.state.events).toHaveLength(count);
    expect(h.state.user!.portalStatus).toBe("suspended");
    expect(h.state.obligations[0].status).toBe("settled");
    await expect(
      h.api.recordManualMembershipSettlement({
        userId: 7,
        paymentId: "PM-old",
        actorId: 11,
        reference: "DOUBLE",
        notes: "Duplicate",
        settledAt: "2026-10-02T00:00:00Z",
      })
    ).rejects.toThrow("outstanding");
  });

  it("rejects unknown, partial, future, pre-failure and unaudited manual settlements", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    await h.api.processMembershipPaymentAccount(7);
    const valid = {
      userId: 7,
      paymentId: "PM-old",
      actorId: 11,
      reference: "BANK",
      notes: "Checked",
      settledAt: "2026-10-02T00:00:00Z",
    };
    for (const change of [
      { paymentId: "PM-unknown" },
      { amountPence: 5 },
      { notes: " " },
      { reference: " " },
      { settledAt: "2027-01-01T00:00:00Z" },
      { settledAt: "2026-09-01T00:00:00Z" },
    ]) {
      await expect(
        h.api.recordManualMembershipSettlement({ ...valid, ...change })
      ).rejects.toThrow();
    }
    expect(h.state.settlements).toHaveLength(0);
    expect(h.state.account.outstandingPence).toBe(8700);
  });

  it("only clears the explicitly settled payment, never the other outstanding obligation", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    await h.record("EV-2", 2, { paymentId: "PM-second" });
    await h.api.processMembershipPaymentAccount(7);
    await h.api.recordManualMembershipSettlement({
      userId: 7,
      paymentId: "PM-old",
      actorId: 11,
      reference: "BANK",
      notes: "Whole older payment",
      settledAt: "2026-10-02T00:00:00Z",
    });
    expect(h.state.account.outstandingCount).toBe(1);
    expect(h.state.account.failedAttempts).toBe(2);
  });

  it("does not settle a raw inbox failure before a persisted outstanding obligation exists", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    await expect(
      h.api.recordManualMembershipSettlement({
        userId: 7,
        paymentId: "PM-old",
        actorId: 11,
        reference: "BANK",
        notes: "Needs prior processing",
        settledAt: "2026-10-02T00:00:00Z",
      })
    ).rejects.toThrow("persisted outstanding");
    expect(h.state.settlements).toHaveLength(0);
  });

  it("does not mix currencies or display unknown amounts as zero", async () => {
    const h = harness();
    await h.record("EV-1", 1, { amountPence: null, currency: null });
    await h.api.processMembershipPaymentAccount(7);
    expect(h.state.account.outstandingPence).toBeNull();
    const other = harness();
    await other.record("USD", 1, { currency: "USD" });
    await other.api.processMembershipPaymentAccount(7);
    expect(other.state.account.outstandingPence).toBeNull();
  });

  it("captures failures per user and records unhealthy status without skipping later users", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    h.store.pendingUserIds = async () => [99, 7, 7];
    const result = await h.api.processPendingMembershipAccounts(50);
    expect(result).toMatchObject({ processed: 1, errors: 1 });
    expect(h.health).toHaveBeenCalledWith(
      expect.objectContaining({ lastError: expect.stringContaining("User 99") })
    );
    expect(h.state.account.failedAttempts).toBe(1);
  });
});

describe("leased membership notification outbox", () => {
  it("initial recovery remains email-free before and after first activation, including historic confirmations", async () => {
    const h = harness();
    h.state.control!.enabled = false;
    h.state.control!.activatedAt = null;
    for (let n = 1; n <= 3; n++) await h.record(`HISTORY-${n}`, -10 + n, { source: "reconciliation" });
    await h.record("HISTORY-CONFIRMED", -5, { action: "confirmed", source: "reconciliation" });
    await h.api.processMembershipPaymentAccount(7);
    await h.api.processMembershipPaymentOutbox();
    expect(h.state.outbox).toHaveLength(0);
    expect(h.state.events.every(e => e.status === "processed")).toBe(true);
    h.state.control!.enabled = true;
    h.state.control!.activatedAt = new Date("2026-11-01T11:00:00Z");
    await h.api.processMembershipPaymentAccount(7);
    await h.api.processMembershipPaymentOutbox();
    expect(h.sendAgent).not.toHaveBeenCalled();
    expect(h.sendSupport).not.toHaveBeenCalled();
    expect(h.state.outbox).toHaveLength(0);
    expect(h.state.user!.portalStatus).toBe("active");
  });

  it.each(["pre_activation", "bulk_history", "excluded"] as const)(
    "holds an accidentally seeded %s email intent even when automation is enabled",
    async kind => {
      const h = harness();
      await h.record("SEED-FAILURE", 1);
      await h.api.processMembershipPaymentAccount(7);
      if (kind === "pre_activation") h.state.control!.activatedAt = new Date("2026-11-01T11:00:00Z");
      if (kind === "bulk_history") h.state.events[0].source = "backfill";
      if (kind === "excluded") h.state.events[0].status = "ignored";
      await h.api.processMembershipPaymentOutbox();
      expect(h.sendAgent).not.toHaveBeenCalled();
      expect(h.sendSupport).not.toHaveBeenCalled();
      expect(h.state.outbox.every(o => o.status === "review" && o.firstAttemptAt === null)).toBe(true);
    }
  );

  it("renders every failure's frozen count using current suspension, not stale first/second threats", async () => {
    const h = harness();
    for (let n = 1; n <= 4; n++) await h.record(`EV-${n}`, n);
    await h.api.processMembershipPaymentAccount(7);
    await h.api.processMembershipPaymentOutbox(50);
    const notices = h.sends.filter(
      s => s.toEmail === "operational@example.com"
    );
    expect(notices).toHaveLength(4);
    expect(notices[0].html).toContain("<strong>1</strong>");
    expect(notices[3].html).toContain("<strong>4</strong>");
    expect(notices.every(s => s.html.includes("currently suspended"))).toBe(
      true
    );
    expect(
      notices.every(s => !s.html.includes("will be retried automatically"))
    ).toBe(true);
    expect(notices[0].html).not.toContain("administration fee");
    expect(notices[1].html).toContain("£25.00");
    expect(
      h.sends.filter(s => s.toEmail === "support@thejltgroup.co.uk")
    ).toHaveLength(5);
    expect(
      h.state.outbox.every(o => o.providerMessageId && o.status === "accepted")
    ).toBe(true);
  });

  it("retries send failures with the same payload, operational recipient and idempotency key", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    await h.api.processMembershipPaymentAccount(7);
    h.sendAgent.mockImplementationOnce(async mail => {
      h.sends.push(structuredClone(mail));
      return { success: false, error: "network timeout" };
    });
    await h.api.processMembershipPaymentOutbox(1);
    const first = h.sends[0];
    expect(h.state.outbox[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      providerMessageId: null,
    });
    expect(h.state.outbox[0].firstAttemptAt).not.toBeNull();
    expect(first.auditUserId).toBe(7);
    expect(first.html).toContain("<!DOCTYPE html>");
    h.state.profile!.businessEmail = "changed@example.com";
    h.state.user!.portalStatus = "suspended";
    await h.api.processMembershipPaymentOutbox(1);
    expect(h.sendAgent).toHaveBeenCalledTimes(1);
    h.tick(60_000);
    await h.api.processMembershipPaymentOutbox(1);
    expect(h.sendAgent.mock.calls[1][0]).toEqual(first);
    expect(h.state.outbox[0].status).toBe("accepted");
    await h.api.processMembershipPaymentOutbox(1);
    expect(h.sendAgent).toHaveBeenCalledTimes(2);
  });

  it("does not equate a success boolean without accepted provider ID to sent", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    await h.api.processMembershipPaymentAccount(7);
    h.sendAgent.mockResolvedValueOnce({ success: true, providerMessageId: "" });
    expect(await h.api.processMembershipPaymentOutbox(1)).toMatchObject({
      accepted: 0,
      failed: 1,
    });
    expect(h.state.outbox[0].status).toBe("failed");
  });

  it("does not send or mark success while notifications or automation are paused", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    await h.api.processMembershipPaymentAccount(7);
    h.paused(true);
    await h.api.processMembershipPaymentOutbox(1);
    expect(h.sendAgent).not.toHaveBeenCalled();
    expect(h.state.outbox[0].status).toBe("pending");
    h.paused(false);
    h.state.control!.enabled = false;
    await h.api.processMembershipPaymentOutbox(1);
    expect(h.sendAgent).not.toHaveBeenCalled();
    expect(h.state.outbox[0].firstAttemptAt).toBeNull();
  });

  it("does not send before another lease expires and safely reclaims it with a fresh token", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    await h.api.processMembershipPaymentAccount(7);
    const row = h.state.outbox[0];
    row.status = "sending";
    row.lockToken = "stale-worker";
    row.lockedUntil = new Date("2026-11-01T12:05:00Z");
    await h.api.processMembershipPaymentOutbox(1);
    expect(h.sendAgent).not.toHaveBeenCalled();
    h.tick(5 * 60_000);
    await h.api.processMembershipPaymentOutbox(1);
    expect(h.sendAgent).toHaveBeenCalledTimes(1);
    expect(h.state.outbox[0].status).toBe("accepted");
    expect(h.state.outbox[0].lockToken).toBeNull();
  });

  it("concurrent workers acquire a compare-and-set lease and send the same intent only once", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    await h.api.processMembershipPaymentAccount(7);
    let resolve!: (value: {
      success: boolean;
      providerMessageId: string;
    }) => void;
    const pendingSend = new Promise<{
      success: boolean;
      providerMessageId: string;
    }>(r => {
      resolve = r;
    });
    h.sendAgent.mockImplementationOnce(async () => pendingSend);
    const first = h.api.processMembershipPaymentOutbox(1);
    await vi.waitFor(() => expect(h.sendAgent).toHaveBeenCalledTimes(1));
    await h.api.processMembershipPaymentOutbox(1);
    expect(h.sendAgent).toHaveBeenCalledTimes(1);
    resolve({ success: true, providerMessageId: "accepted-one" });
    await first;
    expect(h.state.outbox[0].providerMessageId).toBe("accepted-one");
  });

  it("a crash after provider acceptance resumes within dedupe retention with frozen email", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    await h.api.processMembershipPaymentAccount(7);
    h.sendAgent.mockImplementationOnce(async mail => {
      h.sends.push(structuredClone(mail));
      h.crashCommit();
      return { success: true, providerMessageId: "provider-accepted" };
    });
    await expect(h.api.processMembershipPaymentOutbox(1)).rejects.toThrow(
      "crash"
    );
    expect(h.state.outbox[0].status).toBe("sending");
    expect(h.state.outbox[0].providerMessageId).toBeNull();
    h.state.profile!.businessEmail = "new@example.com";
    h.tick(5 * 60_000);
    await h.api.processMembershipPaymentOutbox(1);
    expect(h.sends[1]).toEqual(h.sends[0]);
    expect(h.state.outbox[0].status).toBe("accepted");
  });

  it("a crash beyond provider dedupe retention becomes ambiguous manual review, never a duplicate send", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    await h.api.processMembershipPaymentAccount(7);
    h.sendAgent.mockImplementationOnce(async () => {
      h.crashCommit();
      return { success: true, providerMessageId: "accepted" };
    });
    await expect(h.api.processMembershipPaymentOutbox(1)).rejects.toThrow(
      "crash"
    );
    h.tick(24 * 60 * 60_000);
    expect(await h.api.processMembershipPaymentOutbox(1)).toMatchObject({
      ambiguous: 1,
      accepted: 0,
    });
    expect(h.sendAgent).toHaveBeenCalledTimes(1);
    expect(h.state.outbox[0].status).toBe("ambiguous");
  });

  it("holds newly departed/exempt recipient notices and retains corporate support intent", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    await h.api.processMembershipPaymentAccount(7);
    h.state.profile!.paymentExempt = true;
    await h.api.processMembershipPaymentOutbox(50);
    expect(h.sendAgent).not.toHaveBeenCalled();
    expect(h.sendSupport).toHaveBeenCalledTimes(1);
    expect(h.state.outbox[0].status).toBe("review");
    expect(h.state.outbox[1].status).toBe("accepted");
  });

  it("positive rejection evidence allows retry after retention without acceptance ambiguity", async () => {
    const h = harness();
    await h.record("EV-1", 1);
    await h.api.processMembershipPaymentAccount(7);
    h.sendAgent.mockImplementationOnce(async () => ({
      success: false,
      providerMessageId: "",
      error: "Provider explicitly rejected",
      definitivelyRejected: true,
    }));
    await h.api.processMembershipPaymentOutbox(1);
    expect(h.state.outbox[0].firstAttemptAt).toBeNull();
    h.tick(25 * 60 * 60_000);
    await h.api.processMembershipPaymentOutbox(1);
    expect(h.state.outbox[0].status).toBe("accepted");
  });

  it("rejects invalid timestamps, currencies and negative amounts before durable recording", async () => {
    const h = harness();
    await expect(
      h.record("X", 1, { occurredAt: "not a date" })
    ).rejects.toThrow();
    await expect(
      h.record("X", 1, { currency: "BAD-CURRENCY" })
    ).rejects.toThrow();
    await expect(h.record("X", 1, { amountPence: -1 })).rejects.toThrow();
    await expect(
      h.record("X", 1, { resource_type: "mandates" })
    ).rejects.toThrow();
    expect(h.state.events).toHaveLength(0);
  });
});
