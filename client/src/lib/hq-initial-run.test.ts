import { describe, expect, it, vi } from "vitest";
import type { HqInitialImportResult } from "../../../shared/management-hq-initial-import";
import {
  HQ_INITIAL_RUN_ERRORS as ERRORS,
  HqInitialRunController,
  type HqInitialRunClock,
  type HqInitialRunOptions,
  type HqInitialRunState,
  type HqInitialRunStatus,
} from "./hq-initial-run";

const result = (
  patch: Partial<HqInitialImportResult> = {}
): HqInitialImportResult => ({
  status: "progress",
  message: "untrusted server text",
  nextDueAt: null,
  hasPublished: false,
  progress: { pages: 1, recordsRead: 1 },
  errorCode: null,
  ...patch,
});
const status = (
  patch: Partial<HqInitialRunStatus> = {}
): HqInitialRunStatus => ({
  hasPublished: false,
  progress: null,
  nextDueAt: null,
  health: "no_data",
  ...patch,
});
const published = (patch: Partial<HqInitialRunStatus> = {}) =>
  status({
    hasPublished: true,
    health: "ready",
    ...patch,
  });
const iso = (ms: number) => new Date(ms).toISOString();
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
class FakeClock implements HqInitialRunClock {
  nowMs = 0;
  timers = new Map<number, { at: number; cb: () => void }>();
  next = 1;
  now = () => this.nowMs;
  setTimeout = (cb: () => void, delay: number) => {
    const id = this.next++;
    this.timers.set(id, { at: this.nowMs + delay, cb });
    return id;
  };
  clearTimeout = (id: unknown) => {
    this.timers.delete(id as number);
  };
  advance(ms: number) {
    const end = this.nowMs + ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.nowMs = due[1].at;
      this.timers.delete(due[0]);
      due[1].cb();
    }
    this.nowMs = end;
  }
  /** Fire a timer without advancing wall time, simulating early/clamped wakeups. */
  fireEarliest() {
    const due = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) throw new Error("No timer to fire");
    this.timers.delete(due[0]);
    due[1].cb();
  }
}
const flush = async () => {
  for (let i = 0; i < 60; i++)
    await new Promise<void>(resolve => queueMicrotask(resolve));
};
function setup(overrides: Partial<HqInitialRunOptions> = {}) {
  const clock = new FakeClock();
  const invoke = vi.fn(async () => result({ status: "busy" }));
  const freshStatus = vi.fn(async () => status());
  const onState = vi.fn();
  const controller = new HqInitialRunController({
    invoke,
    freshStatus,
    onState,
    verifyCurrent: () => true,
    clock,
    ...overrides,
  });
  return {
    clock,
    controller,
    invoke: (overrides.invoke ?? invoke) as typeof invoke,
    freshStatus: (overrides.freshStatus ?? freshStatus) as typeof freshStatus,
    onState: (overrides.onState ?? onState) as typeof onState,
  };
}
async function expectTerminal(c: HqInitialRunController, error: string) {
  await flush();
  expect(c.getState().phase).toBe("error");
  expect(c.getState().error).toBe(error);
  expect(c.getState().busy).toBe(false);
}

describe("explicit start and fresh progress reconciliation", () => {
  it("does not autostart, read status, publish callbacks, or schedule timers", () => {
    const { controller, clock, invoke, freshStatus, onState } = setup();
    expect(controller.getState()).toMatchObject({
      phase: "idle",
      pendingMutation: false,
      uncertain: false,
      attempt: 0,
    });
    expect(controller.hasPendingMutation()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(freshStatus).not.toHaveBeenCalled();
    expect(onState).not.toHaveBeenCalled();
    expect(clock.timers.size).toBe(0);
  });

  it("imports two actual pages with matching fresh progress, then publishes exactly once", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(
        result({ progress: { pages: 1, recordsRead: 50 } })
      )
      .mockResolvedValueOnce(
        result({ progress: { pages: 2, recordsRead: 75 } })
      )
      .mockResolvedValueOnce(
        result({ status: "applied", hasPublished: true, progress: null })
      );
    const freshStatus = vi
      .fn()
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(
        status({ health: "progress", progress: { pages: 1, recordsRead: 50 } })
      )
      .mockResolvedValueOnce(
        status({ health: "progress", progress: { pages: 2, recordsRead: 75 } })
      )
      .mockResolvedValueOnce(published());
    const { controller, clock } = setup({ invoke, freshStatus });
    controller.start();
    await flush();
    expect(controller.getState()).toMatchObject({
      phase: "completed",
      attempt: 3,
      error: null,
      pendingMutation: false,
      uncertain: false,
    });
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(freshStatus).toHaveBeenCalledTimes(4);
    expect(clock.timers.size).toBe(0);
    controller.start();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("allows empty catalog pages because the page count still advances", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(result({ progress: { pages: 1, recordsRead: 0 } }))
      .mockResolvedValueOnce(result({ progress: { pages: 2, recordsRead: 0 } }))
      .mockResolvedValueOnce(
        result({ status: "applied", hasPublished: true, progress: null })
      );
    const freshStatus = vi
      .fn()
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(
        status({ health: "progress", progress: { pages: 1, recordsRead: 0 } })
      )
      .mockResolvedValueOnce(
        status({ health: "progress", progress: { pages: 2, recordsRead: 0 } })
      )
      .mockResolvedValueOnce(published({ health: "progress" }));
    const { controller } = setup({ invoke, freshStatus });
    controller.start();
    await flush();
    expect(controller.getState().phase).toBe("completed");
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("owns one RPC at a time despite repeated explicit starts", async () => {
    const flight = deferred<HqInitialImportResult>();
    const invoke = vi.fn(() => flight.promise);
    const freshStatus = vi
      .fn()
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(published());
    const { controller } = setup({ invoke, freshStatus });
    controller.start();
    controller.start();
    await flush();
    controller.start();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(controller.hasPendingMutation()).toBe(true);
    flight.resolve(result({ status: "applied", hasPublished: true }));
    await flush();
    expect(controller.getState().phase).toBe("completed");
    expect(controller.hasPendingMutation()).toBe(false);
  });

  it("accepts progress health for a resumed initial checkpoint", async () => {
    const { controller, invoke } = setup({
      freshStatus: async () =>
        status({ health: "progress", progress: { pages: 5, recordsRead: 0 } }),
    });
    controller.start();
    await expectTerminal(controller, ERRORS.busy);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("requires fresh publication rather than trusting an applied result", async () => {
    const invoke = vi.fn(async () =>
      result({ status: "applied", hasPublished: true })
    );
    const freshStatus = vi
      .fn()
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(
        status({ health: "progress", progress: { pages: 1, recordsRead: 1 } })
      );
    const { controller } = setup({ invoke, freshStatus });
    controller.start();
    await expectTerminal(controller, ERRORS.status);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("denies an already-published initial snapshot without mutation", async () => {
    const { controller, invoke } = setup({
      freshStatus: async () => published(),
    });
    controller.start();
    await expectTerminal(controller, ERRORS.alreadyPublished);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    [
      "mutation stalls",
      { pages: 2, recordsRead: 20 },
      { pages: 2, recordsRead: 20 },
    ],
    [
      "mutation regresses pages",
      { pages: 1, recordsRead: 21 },
      { pages: 3, recordsRead: 21 },
    ],
    [
      "mutation regresses records",
      { pages: 3, recordsRead: 19 },
      { pages: 3, recordsRead: 21 },
    ],
    [
      "fresh status is behind mutation",
      { pages: 3, recordsRead: 21 },
      { pages: 2, recordsRead: 20 },
    ],
    [
      "fresh status regresses pages",
      { pages: 3, recordsRead: 21 },
      { pages: 1, recordsRead: 22 },
    ],
    [
      "fresh status regresses records",
      { pages: 3, recordsRead: 21 },
      { pages: 4, recordsRead: 19 },
    ],
  ])("halts permanently when %s", async (_label, mutation, fresh) => {
    const invoke = vi.fn(async () =>
      result({
        progress: mutation as NonNullable<HqInitialRunStatus["progress"]>,
      })
    );
    const freshStatus = vi
      .fn()
      .mockResolvedValueOnce(
        status({ health: "progress", progress: { pages: 2, recordsRead: 20 } })
      )
      .mockResolvedValueOnce(
        status({
          health: "progress",
          progress: fresh as NonNullable<HqInitialRunStatus["progress"]>,
        })
      );
    const { controller, clock } = setup({ invoke, freshStatus });
    controller.start();
    await expectTerminal(controller, ERRORS.stalled);
    controller.start();
    clock.advance(3_000_000);
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(clock.timers.size).toBe(0);
  });

  it("accepts fresh progress ahead of the mutation without false stall", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result({ status: "busy" }));
    const freshStatus = vi
      .fn()
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(
        status({ health: "progress", progress: { pages: 2, recordsRead: 2 } })
      );
    const { controller } = setup({ invoke, freshStatus });
    controller.start();
    await expectTerminal(controller, ERRORS.busy);
    expect(controller.getState().progress).toEqual({
      pages: 2,
      recordsRead: 2,
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe("pending mutation ownership and terminal deadlines", () => {
  it.each(["resolve", "reject"] as const)(
    "retains ownership after request timeout until underlying %s",
    async settlement => {
      const flight = deferred<HqInitialImportResult>();
      const invoke = vi.fn(() => flight.promise);
      const { controller, clock, freshStatus } = setup({
        invoke,
        requestDeadlineMs: 10,
      });
      controller.start();
      await flush();
      clock.advance(10);
      await expectTerminal(controller, ERRORS.timeout);
      expect(controller.hasPendingMutation()).toBe(true);
      expect(controller.getState()).toMatchObject({
        pendingMutation: true,
        uncertain: true,
        attempt: 1,
      });
      controller.start();
      controller.stop();
      clock.advance(3_000_000);
      await flush();
      expect(controller.hasPendingMutation()).toBe(true);
      expect(invoke).toHaveBeenCalledTimes(1);
      if (settlement === "resolve")
        flight.resolve(result({ status: "applied", hasPublished: true }));
      else flight.reject(new Error("private exception"));
      await flush();
      expect(controller.hasPendingMutation()).toBe(false);
      expect(controller.getState()).toMatchObject({
        phase: "error",
        error: ERRORS.timeout,
        pendingMutation: false,
        uncertain: true,
        progress: null,
      });
      expect(freshStatus).toHaveBeenCalledTimes(1);
      expect(clock.timers.size).toBe(0);
    }
  );

  it("stop during flight keeps ownership and suppresses late result/progress/completion", async () => {
    const flight = deferred<HqInitialImportResult>();
    const invoke = vi.fn(() => flight.promise);
    const { controller, clock, freshStatus, onState } = setup({ invoke });
    controller.start();
    await flush();
    controller.stop();
    expect(controller.getState()).toMatchObject({
      phase: "stopped",
      pendingMutation: true,
      uncertain: true,
    });
    expect(controller.hasPendingMutation()).toBe(true);
    const callbacksAfterStop = onState.mock.calls.length;
    controller.start();
    flight.resolve(
      result({
        status: "applied",
        hasPublished: true,
        progress: { pages: 20, recordsRead: 200 },
      })
    );
    await flush();
    expect(controller.getState()).toMatchObject({
      phase: "stopped",
      pendingMutation: false,
      progress: null,
    });
    expect(onState.mock.calls.length).toBe(callbacksAfterStop + 1); // Safe pending=false settlement only.
    expect(
      onState.mock.calls.slice(callbacksAfterStop).map(([s]) => s.phase)
    ).toEqual(["stopped"]);
    expect(freshStatus).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(clock.timers.size).toBe(0);
  });

  it("runtime expiry interrupts an in-flight mutation and never schedules hidden work", async () => {
    const flight = deferred<HqInitialImportResult>();
    const invoke = vi.fn(() => flight.promise);
    const { controller, clock, freshStatus } = setup({
      invoke,
      maxRuntimeMs: 10,
    });
    controller.start();
    await flush();
    clock.advance(10);
    await expectTerminal(controller, ERRORS.deadline);
    expect(controller.hasPendingMutation()).toBe(true);
    flight.resolve(result());
    await flush();
    expect(controller.getState().phase).toBe("error");
    expect(controller.hasPendingMutation()).toBe(false);
    expect(freshStatus).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(clock.timers.size).toBe(0);
  });

  it("uses a 15-second deadline for initial status and ignores its late result", async () => {
    const read = deferred<HqInitialRunStatus>();
    const freshStatus = vi.fn(() => read.promise);
    const { controller, clock, invoke, onState } = setup({ freshStatus });
    controller.start();
    await flush();
    clock.advance(14_999);
    await flush();
    expect(controller.getState().phase).toBe("running");
    clock.advance(1);
    await expectTerminal(controller, ERRORS.statusTimeout);
    const callbackCount = onState.mock.calls.length;
    read.resolve(status({ progress: { pages: 99, recordsRead: 99 } }));
    await flush();
    expect(onState).toHaveBeenCalledTimes(callbackCount);
    expect(controller.getState()).toMatchObject({
      phase: "error",
      progress: null,
      pendingMutation: false,
      uncertain: false,
    });
    controller.start();
    expect(invoke).not.toHaveBeenCalled();
    expect(freshStatus).toHaveBeenCalledTimes(1);
    expect(clock.timers.size).toBe(0);
  });

  it("deadlines every confirmation read and suppresses late publication", async () => {
    const read = deferred<HqInitialRunStatus>();
    const freshStatus = vi
      .fn()
      .mockResolvedValueOnce(status())
      .mockImplementationOnce(() => read.promise);
    const invoke = vi.fn(async () =>
      result({ status: "applied", hasPublished: true })
    );
    const { controller, clock } = setup({
      freshStatus,
      invoke,
      statusDeadlineMs: 10,
    });
    controller.start();
    await flush();
    clock.advance(10);
    await expectTerminal(controller, ERRORS.statusTimeout);
    read.resolve(published());
    await flush();
    expect(controller.getState().phase).toBe("error");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(freshStatus).toHaveBeenCalledTimes(2);
  });

  it("ignores a late rejected status read after its deadline", async () => {
    const read = deferred<HqInitialRunStatus>();
    const { controller, clock, onState, invoke } = setup({
      freshStatus: () => read.promise,
      statusDeadlineMs: 10,
    });
    controller.start();
    await flush();
    clock.advance(10);
    await expectTerminal(controller, ERRORS.statusTimeout);
    const callbackCount = onState.mock.calls.length;
    read.reject(new Error("private late status failure"));
    await flush();
    expect(controller.getState().error).toBe(ERRORS.statusTimeout);
    expect(onState).toHaveBeenCalledTimes(callbackCount);
    expect(invoke).not.toHaveBeenCalled();
    expect(clock.timers.size).toBe(0);
  });

  it.each(["status", "mutation"] as const)(
    "stops permanently on a rejected %s without leaking exception text",
    async operation => {
      const overrides =
        operation === "status"
          ? {
              freshStatus: vi.fn(async () => {
                throw new Error("private status detail");
              }),
            }
          : {
              invoke: vi.fn(async () => {
                throw new Error("private mutation detail");
              }),
            };
      const { controller, invoke, clock } = setup(overrides);
      controller.start();
      await expectTerminal(
        controller,
        operation === "status" ? ERRORS.status : ERRORS.unknown
      );
      controller.start();
      clock.advance(3_000_000);
      await flush();
      expect(invoke).toHaveBeenCalledTimes(operation === "status" ? 0 : 1);
      expect(JSON.stringify(controller.getState())).not.toContain("private");
      expect(clock.timers.size).toBe(0);
    }
  );
});

describe("actor guards at every async boundary", () => {
  it.each(["status", "mutation"] as const)(
    "handles synchronous actor changes inside %s and its late rejection",
    async operation => {
      let current = true;
      const read = deferred<HqInitialRunStatus>();
      const flight = deferred<HqInitialImportResult>();
      const freshStatus = vi.fn(() => {
        if (operation === "status") {
          current = false;
          return read.promise;
        }
        return Promise.resolve(status());
      });
      const invoke = vi.fn(() => {
        current = false;
        return flight.promise;
      });
      const { controller, onState, clock } = setup({
        freshStatus,
        invoke,
        verifyCurrent: () => current,
      });
      controller.start();
      await flush();
      expect(controller.getState()).toMatchObject({
        phase: "error",
        error: ERRORS.notCurrent,
        progress: null,
      });
      expect(controller.hasPendingMutation()).toBe(operation === "mutation");
      const callbackCount = onState.mock.calls.length;
      if (operation === "status") read.reject(new Error("private late status"));
      else flight.reject(new Error("private late mutation"));
      await flush();
      expect(controller.hasPendingMutation()).toBe(false);
      expect(onState).toHaveBeenCalledTimes(callbackCount);
      expect(invoke).toHaveBeenCalledTimes(operation === "mutation" ? 1 : 0);
      expect(clock.timers.size).toBe(0);
    }
  );

  it("polling a terminal controller after actor change redacts its existing checkpoint", async () => {
    let current = true;
    const { controller, onState } = setup({
      verifyCurrent: () => current,
      freshStatus: async () =>
        status({ health: "progress", progress: { pages: 9, recordsRead: 90 } }),
    });
    controller.start();
    await expectTerminal(controller, ERRORS.busy);
    expect(controller.getState().progress).toEqual({
      pages: 9,
      recordsRead: 90,
    });
    const callbackCount = onState.mock.calls.length;
    current = false;
    expect(controller.getState()).toMatchObject({
      error: ERRORS.notCurrent,
      progress: null,
      nextDueAt: null,
    });
    expect(onState).toHaveBeenCalledTimes(callbackCount);
  });

  it("rejects a noncurrent actor before any status or mutation admission", async () => {
    const { controller, freshStatus, invoke, onState, clock } = setup({
      verifyCurrent: () => false,
    });
    controller.start();
    await expectTerminal(controller, ERRORS.notCurrent);
    expect(freshStatus).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(onState).not.toHaveBeenCalled();
    expect(clock.timers.size).toBe(0);
  });

  it("actor change after initial-status await exposes no late private progress", async () => {
    let current = true;
    const read = deferred<HqInitialRunStatus>();
    const { controller, onState, invoke } = setup({
      verifyCurrent: () => current,
      freshStatus: () => read.promise,
    });
    controller.start();
    await flush();
    const callbackCount = onState.mock.calls.length;
    current = false;
    read.resolve(status({ progress: { pages: 9, recordsRead: 90 } }));
    await flush();
    expect(onState).toHaveBeenCalledTimes(callbackCount);
    expect(controller.getState()).toMatchObject({
      phase: "error",
      error: ERRORS.notCurrent,
      progress: null,
      nextDueAt: null,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("actor change after mutation await suppresses late completion and confirmation reads", async () => {
    let current = true;
    const flight = deferred<HqInitialImportResult>();
    const { controller, onState, freshStatus } = setup({
      verifyCurrent: () => current,
      invoke: () => flight.promise,
    });
    controller.start();
    await flush();
    const callbackCount = onState.mock.calls.length;
    current = false;
    flight.resolve(
      result({
        status: "applied",
        hasPublished: true,
        progress: { pages: 9, recordsRead: 90 },
      })
    );
    await flush();
    expect(onState).toHaveBeenCalledTimes(callbackCount);
    expect(controller.getState()).toMatchObject({
      phase: "error",
      error: ERRORS.notCurrent,
      progress: null,
      pendingMutation: false,
    });
    expect(freshStatus).toHaveBeenCalledTimes(1);
  });

  it("actor change after confirmation await suppresses late completed and private progress", async () => {
    let current = true;
    const read = deferred<HqInitialRunStatus>();
    const freshStatus = vi
      .fn()
      .mockResolvedValueOnce(status())
      .mockImplementationOnce(() => read.promise);
    const invoke = vi.fn(async () =>
      result({ status: "applied", hasPublished: true })
    );
    const { controller, onState } = setup({
      freshStatus,
      invoke,
      verifyCurrent: () => current,
    });
    controller.start();
    await flush();
    const callbackCount = onState.mock.calls.length;
    current = false;
    read.resolve(published({ progress: { pages: 9, recordsRead: 90 } }));
    await flush();
    expect(onState).toHaveBeenCalledTimes(callbackCount);
    expect(controller.getState()).toMatchObject({
      phase: "error",
      error: ERRORS.notCurrent,
      progress: null,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rechecks actor after wait before admitting mutation", async () => {
    let current = true;
    const { controller, clock, invoke, onState } = setup({
      freshStatus: async () => status({ nextDueAt: iso(100) }),
      verifyCurrent: () => current,
    });
    controller.start();
    await flush();
    const callbackCount = onState.mock.calls.length;
    current = false;
    clock.advance(100);
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    expect(onState).toHaveBeenCalledTimes(callbackCount);
    expect(controller.getState().error).toBe(ERRORS.notCurrent);
  });

  it("a callback changing the actor blocks work after that callback", async () => {
    let current = true;
    const onState = vi.fn((state: HqInitialRunState) => {
      if (state.attempt === 1) current = false;
    });
    const { controller, invoke } = setup({
      onState,
      verifyCurrent: () => current,
    });
    controller.start();
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({
      phase: "error",
      error: ERRORS.notCurrent,
      progress: null,
    });
  });

  it("a callback stopping the run prevents the next RPC", async () => {
    let controller!: HqInitialRunController;
    const invoke = vi.fn(async () => result());
    controller = new HqInitialRunController({
      invoke,
      freshStatus: async () => status(),
      verifyCurrent: () => true,
      onState: state => {
        if (state.attempt === 1) controller.stop();
      },
    });
    controller.start();
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    expect(controller.getState().phase).toBe("stopped");
  });

  it("a throwing state callback permanently halts future work", async () => {
    const { controller, invoke, freshStatus, clock } = setup({
      onState: () => {
        throw new Error("private callback detail");
      },
    });
    controller.start();
    await expectTerminal(controller, ERRORS.unknown);
    expect(invoke).not.toHaveBeenCalled();
    expect(freshStatus).not.toHaveBeenCalled();
    expect(clock.timers.size).toBe(0);
  });
});

describe("strict DTO validation and server health", () => {
  const invalidProgress = [
    { pages: -1, recordsRead: 0 },
    { pages: 0, recordsRead: -1 },
    { pages: 0.5, recordsRead: 0 },
    { pages: 0, recordsRead: 0.5 },
    { pages: NaN, recordsRead: 0 },
    { pages: 0, recordsRead: NaN },
    { pages: Infinity, recordsRead: 0 },
    { pages: 1001, recordsRead: 0 },
    { pages: 0, recordsRead: 100_001 },
    { pages: Number.MAX_SAFE_INTEGER + 1, recordsRead: 0 },
  ];
  it.each(invalidProgress)(
    "rejects invalid mutation progress %j",
    async progress => {
      const { controller, invoke } = setup({
        invoke: vi.fn(async () => result({ progress })),
      });
      controller.start();
      await expectTerminal(controller, ERRORS.malformed);
      expect(invoke).toHaveBeenCalledTimes(1);
    }
  );
  it.each(invalidProgress)(
    "rejects invalid fresh progress %j before mutation",
    async progress => {
      const { controller, invoke } = setup({
        freshStatus: async () => status({ progress }),
      });
      controller.start();
      await expectTerminal(controller, ERRORS.status);
      expect(invoke).not.toHaveBeenCalled();
    }
  );
  const invalidDates = [
    "",
    "tomorrow",
    "2026-02-30T12:00:00.000Z",
    "2026-01-01",
    "2026-01-01T12:00:00+00:00",
    "2026-01-01T24:00:00Z",
  ];
  it.each(invalidDates)(
    "rejects malformed/non-UTC mutation due date %j",
    async nextDueAt => {
      const { controller } = setup({
        invoke: async () => result({ nextDueAt }),
      });
      controller.start();
      await expectTerminal(controller, ERRORS.malformed);
    }
  );
  it.each(invalidDates)(
    "rejects malformed/non-UTC status due date %j",
    async nextDueAt => {
      const { controller, invoke } = setup({
        freshStatus: async () => status({ nextDueAt }),
      });
      controller.start();
      await expectTerminal(controller, ERRORS.status);
      expect(invoke).not.toHaveBeenCalled();
    }
  );
  it.each(["applied", "already_complete"] as const)(
    "requires hasPublished on %s",
    async completion => {
      const { controller, freshStatus } = setup({
        invoke: async () => result({ status: completion, hasPublished: false }),
      });
      controller.start();
      await expectTerminal(controller, ERRORS.malformed);
      expect(freshStatus).toHaveBeenCalledTimes(1);
    }
  );
  it("requires a due date on notdue", async () => {
    const { controller } = setup({
      invoke: async () => result({ status: "notdue", nextDueAt: null }),
    });
    controller.start();
    await expectTerminal(controller, ERRORS.malformed);
  });
  it("rejects a null mutation result as malformed", async () => {
    const { controller } = setup({
      invoke: async () => null as unknown as HqInitialImportResult,
    });
    controller.start();
    await expectTerminal(controller, ERRORS.malformed);
  });
  it("requires progress on a progress result", async () => {
    const { controller } = setup({
      invoke: async () => result({ progress: null }),
    });
    controller.start();
    await expectTerminal(controller, ERRORS.malformed);
  });
  it.each(["backoff", "needs_attention", "ready", "stale", "disabled"])(
    "stops initial %s health",
    async health => {
      const { controller, invoke } = setup({
        freshStatus: async () => status({ health }),
      });
      controller.start();
      await expectTerminal(controller, ERRORS.attention);
      expect(invoke).not.toHaveBeenCalled();
    }
  );
  it("rejects invented ok health", async () => {
    const { controller, invoke } = setup({
      freshStatus: async () => status({ health: "ok" }),
    });
    controller.start();
    await expectTerminal(controller, ERRORS.status);
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(["backoff", "disabled", "needs_attention", "stale"])(
    "cannot complete with fresh published %s health",
    async health => {
      const freshStatus = vi
        .fn()
        .mockResolvedValueOnce(status())
        .mockResolvedValueOnce(published({ health }));
      const { controller } = setup({
        freshStatus,
        invoke: async () => result({ status: "applied", hasPublished: true }),
      });
      controller.start();
      await expectTerminal(controller, ERRORS.attention);
    }
  );
  it("fresh backoff stops despite matching nonpublished progress", async () => {
    const freshStatus = vi
      .fn()
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(
        status({ health: "backoff", progress: { pages: 1, recordsRead: 1 } })
      );
    const { controller, invoke } = setup({
      freshStatus,
      invoke: vi.fn(async () => result()),
    });
    controller.start();
    await expectTerminal(controller, ERRORS.attention);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it.each(["initial", "confirmation", "published"] as const)(
    "stops on a %s source error even with progress",
    async stage => {
      const failing = status({
        health: "progress",
        progress: { pages: 1, recordsRead: 1 },
        sourceError: "private upstream failure",
        hasPublished: stage === "published",
      });
      const freshStatus =
        stage === "initial"
          ? vi.fn(async () => failing)
          : vi
              .fn()
              .mockResolvedValueOnce(status())
              .mockResolvedValueOnce(failing);
      const { controller, invoke } = setup({
        freshStatus,
        invoke: vi.fn(async () => result()),
      });
      controller.start();
      await expectTerminal(controller, ERRORS.server);
      expect(invoke).toHaveBeenCalledTimes(stage === "initial" ? 0 : 1);
      expect(JSON.stringify(controller.getState())).not.toContain(
        "private upstream"
      );
    }
  );
  it.each([
    ["busy", ERRORS.busy],
    ["disabled", ERRORS.attention],
    ["needs_attention", ERRORS.attention],
  ] as const)("stops on mutation %s", async (mutationStatus, error) => {
    const invoke = vi.fn(async () => result({ status: mutationStatus }));
    const { controller, freshStatus } = setup({ invoke });
    controller.start();
    await expectTerminal(controller, error);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(freshStatus).toHaveBeenCalledTimes(1);
  });
  it("stops on a mutation source error even when it reports progress", async () => {
    const { controller, freshStatus } = setup({
      invoke: async () => result({ errorCode: "BACKOFF" }),
    });
    controller.start();
    await expectTerminal(controller, ERRORS.server);
    expect(freshStatus).toHaveBeenCalledTimes(1);
  });
  it("accepts inclusive page/record caps on a valid checkpoint", async () => {
    const { controller, invoke } = setup({
      freshStatus: async () =>
        status({
          health: "progress",
          progress: { pages: 1000, recordsRead: 100_000 },
        }),
    });
    controller.start();
    await expectTerminal(controller, ERRORS.busy);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("due admission and finite limits", () => {
  it("never admits the first RPC before a future status due time", async () => {
    const { controller, clock, invoke } = setup({
      freshStatus: async () => status({ nextDueAt: iso(1000) }),
    });
    controller.start();
    await flush();
    expect(controller.getState().phase).toBe("waiting");
    expect(invoke).not.toHaveBeenCalled();
    clock.advance(999);
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    clock.advance(1);
    await expectTerminal(controller, ERRORS.busy);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("recomputes due time after an early timer wake", async () => {
    const { controller, clock, invoke } = setup({
      freshStatus: async () => status({ nextDueAt: iso(1000) }),
    });
    controller.start();
    await flush();
    clock.nowMs = 100;
    clock.fireEarliest();
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    expect(controller.getState().phase).toBe("waiting");
    clock.advance(899);
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    clock.advance(1);
    await expectTerminal(controller, ERRORS.busy);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("recomputes due time after the wall clock moves backwards", async () => {
    const { controller, clock, invoke } = setup({
      freshStatus: async () => status({ nextDueAt: iso(1000) }),
    });
    controller.start();
    await flush();
    clock.nowMs = -5000;
    clock.fireEarliest();
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    clock.advance(5999);
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    clock.advance(1);
    await expectTerminal(controller, ERRORS.busy);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("honors mutation notdue even if fresh due is missing or earlier", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(
        result({ status: "notdue", progress: null, nextDueAt: iso(1000) })
      )
      .mockResolvedValueOnce(result({ status: "busy" }));
    const freshStatus = vi
      .fn()
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status({ nextDueAt: iso(500) }));
    const { controller, clock } = setup({ invoke, freshStatus });
    controller.start();
    await flush();
    expect(controller.getState()).toMatchObject({
      phase: "waiting",
      nextDueAt: iso(1000),
    });
    clock.advance(999);
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
    clock.advance(1);
    await expectTerminal(controller, ERRORS.busy);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("stop during wait cancels admission and all timers", async () => {
    const { controller, clock, invoke, onState } = setup({
      freshStatus: async () => status({ nextDueAt: iso(1000) }),
    });
    controller.start();
    await flush();
    controller.stop();
    const callbacksAfterStop = onState.mock.calls.length;
    clock.advance(3_000_000);
    await flush();
    expect(controller.getState()).toMatchObject({
      phase: "stopped",
      pendingMutation: false,
      uncertain: false,
    });
    expect(onState).toHaveBeenCalledTimes(callbacksAfterStop);
    expect(invoke).not.toHaveBeenCalled();
    expect(clock.timers.size).toBe(0);
  });

  it("stop during a status read ignores its late result", async () => {
    const read = deferred<HqInitialRunStatus>();
    const { controller, clock, invoke, onState } = setup({
      freshStatus: () => read.promise,
    });
    controller.start();
    await flush();
    controller.stop();
    const callbacksAfterStop = onState.mock.calls.length;
    read.resolve(status({ progress: { pages: 9, recordsRead: 9 } }));
    await flush();
    expect(onState).toHaveBeenCalledTimes(callbacksAfterStop);
    expect(controller.getState()).toMatchObject({
      phase: "stopped",
      progress: null,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(clock.timers.size).toBe(0);
  });

  it("a lower runtime cap interrupts waiting permanently", async () => {
    const { controller, clock, invoke } = setup({
      maxRuntimeMs: 100,
      freshStatus: async () => status({ nextDueAt: iso(1000) }),
    });
    controller.start();
    await flush();
    clock.advance(100);
    await expectTerminal(controller, ERRORS.deadline);
    controller.start();
    clock.advance(3_000_000);
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    expect(clock.timers.size).toBe(0);
  });

  it("the default 45-minute cap interrupts arbitrarily distant due times", async () => {
    const { controller, clock, invoke } = setup({
      freshStatus: async () => status({ nextDueAt: iso(4_000_000_000) }),
    });
    controller.start();
    await flush();
    clock.advance(45 * 60 * 1000 - 1);
    await flush();
    expect(controller.getState().phase).toBe("waiting");
    clock.advance(1);
    await expectTerminal(controller, ERRORS.deadline);
    expect(invoke).not.toHaveBeenCalled();
    expect(clock.timers.size).toBe(0);
  });

  it("a backward wall clock cannot postpone the finite runtime timer", async () => {
    const { controller, clock, invoke } = setup({
      maxRuntimeMs: 100,
      freshStatus: async () => status({ nextDueAt: iso(1000) }),
    });
    controller.start();
    await flush();
    const runtime = [...clock.timers.entries()].sort((a, b) => a[0] - b[0])[0];
    clock.nowMs = -10_000;
    clock.timers.delete(runtime[0]);
    runtime[1].cb();
    await expectTerminal(controller, ERRORS.deadline);
    expect(invoke).not.toHaveBeenCalled();
    expect(clock.timers.size).toBe(0);
  });

  it("stops at a lower finite attempt cap without a hidden next RPC", async () => {
    const invoke = vi.fn(async () => result());
    const freshStatus = vi
      .fn()
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(
        status({ health: "progress", progress: { pages: 1, recordsRead: 1 } })
      );
    const { controller, clock } = setup({
      invoke,
      freshStatus,
      maxBatchAttempts: 1,
    });
    controller.start();
    await expectTerminal(controller, ERRORS.attempts);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(clock.timers.size).toBe(0);
  });

  it.each([
    ["maxRuntimeMs", 45 * 60 * 1000 + 1],
    ["maxBatchAttempts", 1001],
    ["requestDeadlineMs", 180_001],
    ["statusDeadlineMs", 15_001],
    ["maxRuntimeMs", 0],
    ["maxBatchAttempts", -1],
    ["requestDeadlineMs", 0.5],
    ["statusDeadlineMs", NaN],
    ["maxRuntimeMs", Infinity],
  ] as const)("rejects invalid constructor %s=%s", (key, value) => {
    expect(() => setup({ [key]: value })).toThrow(RangeError);
  });
});
