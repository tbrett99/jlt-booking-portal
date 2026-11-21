// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ reconcile: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    staffCalls: {
      reconcile: { useMutation: () => ({ mutateAsync: f.reconcile }) },
    },
  },
}));
import { useCallOperation } from "../client/src/components/staff-calls/useCallOperation";
type Payload = {
  requestId: string;
  hostUserId: number;
  reasonExplanation: string;
  agentIds: number[];
};
let root: Root,
  container: HTMLDivElement,
  operation: ReturnType<typeof useCallOperation<Payload>>;
const result = (requestId: string) => ({
  requestId,
  state: "succeeded" as const,
  status: "booked" as const,
  callId: 41,
  message: null,
});
function Probe({
  scope,
  mutate,
  confirmed,
}: {
  scope: string;
  mutate: (p: Payload) => Promise<any>;
  confirmed?: (v: any) => void;
}) {
  operation = useCallOperation<Payload>(scope, mutate, confirmed);
  return null;
}
async function render(scope: string, mutate: any, confirmed?: any) {
  await act(async () =>
    root.render(React.createElement(Probe, { scope, mutate, confirmed }))
  );
}
const input = {
  hostUserId: 7,
  reasonExplanation: "Synthetic private reason for original actor",
  agentIds: [12],
};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  (globalThis as any).React = React;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
describe("Actor-bound durable booking operation hook", () => {
  it("does not transfer a frozen request to the next actor or send it with their mutation", async () => {
    const first = vi.fn(async () => {
        throw new Error("Lost before receipt");
      }),
      next = vi.fn();
    await render("jlt-call-book:7", first);
    await act(async () => operation.run(input));
    const saved = operation.frozen!.payload;
    await render("jlt-call-book:20", next);
    expect(operation.frozen).toBeNull();
    await act(async () => operation.run());
    expect(next).not.toHaveBeenCalled();
    expect(localStorage.getItem("jlt-call-book:20")).toBeNull();
    expect(
      JSON.parse(localStorage.getItem("jlt-call-book:7")!).payload
    ).toEqual(saved);
  });
  it("returns to the original actor's exact request without minting a new ID", async () => {
    const first = vi.fn(async (_payload: Payload) => {
        throw new Error("Lost response");
      }),
      next = vi.fn();
    await render("jlt-call-book:7", first);
    await act(async () => operation.run(input));
    const id = operation.frozen!.payload.requestId;
    await render("jlt-call-book:20", next);
    await render("jlt-call-book:7", first);
    expect(operation.frozen!.payload.requestId).toBe(id);
    await act(async () => operation.run());
    expect(first.mock.calls.at(-1)?.[0]).toEqual({ ...input, requestId: id });
  });
  it("discards late success and callbacks after a scope transition", async () => {
    const waiting = deferred<any>(),
      done = vi.fn(),
      nextDone = vi.fn();
    let pending!: Promise<void>;
    const first = vi.fn(() => waiting.promise),
      next = vi.fn();
    await render("jlt-call-book:7", first, done);
    await act(async () => {
      pending = operation.run(input);
    });
    const original = localStorage.getItem("jlt-call-book:7");
    await render("jlt-call-book:20", next, nextDone);
    await act(async () => {
      waiting.resolve(result("first"));
      await pending;
    });
    expect(done).not.toHaveBeenCalled();
    expect(nextDone).not.toHaveBeenCalled();
    expect(operation.frozen).toBeNull();
    expect(operation.pending).toBe(false);
    expect(localStorage.getItem("jlt-call-book:7")).toBe(original);
    expect(localStorage.getItem("jlt-call-book:20")).toBeNull();
  });
  it("discards late rejection after a scope transition", async () => {
    const waiting = deferred<any>();
    let pending!: Promise<void>;
    await render("jlt-call-book:7", () => waiting.promise);
    await act(async () => {
      pending = operation.run(input);
    });
    await render("jlt-call-book:20", vi.fn());
    await act(async () => {
      waiting.reject(new Error("Private old account error"));
      await pending;
    });
    expect(operation.frozen).toBeNull();
    expect(operation.storageError).toBeNull();
    expect(localStorage.getItem("jlt-call-book:20")).toBeNull();
  });
  it("refuses callbacks captured by a previously rendered account", async () => {
    const mutate = vi.fn();
    await render("jlt-call-book:7", mutate);
    const stale = operation;
    await render("jlt-call-book:20", vi.fn());
    await act(async () => stale.run(input));
    expect(mutate).not.toHaveBeenCalled();
    expect(localStorage.getItem("jlt-call-book:7")).toBeNull();
  });
  it("blocks rapid duplicate writes synchronously and recovers only the same UUID", async () => {
    const waiting = deferred<any>(),
      mutate = vi.fn(() => waiting.promise);
    let pending!: Promise<void>;
    await render("jlt-call-book:7", mutate);
    await act(async () => {
      pending = operation.run(input);
      void operation.run(input);
    });
    expect(mutate).toHaveBeenCalledOnce();
    const id = operation.frozen!.payload.requestId;
    await act(async () => {
      waiting.reject(new Error("Unknown response"));
      await pending;
    });
    f.reconcile.mockResolvedValue(result(id));
    await act(async () => operation.recover());
    expect(f.reconcile).toHaveBeenCalledWith({ requestId: id });
    await act(async () => operation.clear());
    expect(operation.frozen).toBeNull();
    expect(localStorage.getItem("jlt-call-book:7")).toBeNull();
  });
  it("does not clear unresolved requests or call the provider when storage fails", async () => {
    const mutate = vi.fn(async () => {
      throw new Error("Uncertain");
    });
    await render("jlt-call-book:7", mutate);
    await act(async () => operation.run(input));
    const saved = localStorage.getItem("jlt-call-book:7");
    await act(async () => operation.clear());
    expect(localStorage.getItem("jlt-call-book:7")).toBe(saved);
    await render("jlt-call-book:20", mutate);
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage denied");
    });
    await act(async () => operation.run(input));
    expect(mutate).toHaveBeenCalledOnce();
    expect(operation.storageError).toContain("No booking request was sent");
  });
  it("ignores late success after unmount while retaining the original request for recovery", async () => {
    const waiting = deferred<any>(),
      done = vi.fn();
    let pending!: Promise<void>;
    await render("jlt-call-book:7", () => waiting.promise, done);
    await act(async () => {
      pending = operation.run(input);
    });
    const saved = localStorage.getItem("jlt-call-book:7");
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      waiting.resolve(result("late"));
      await pending;
    });
    expect(done).not.toHaveBeenCalled();
    expect(localStorage.getItem("jlt-call-book:7")).toBe(saved);
  });
});
