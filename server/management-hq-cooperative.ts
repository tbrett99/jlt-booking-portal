import { performance } from "node:perf_hooks";

/** CPU cooperation only: no scheduling, retries, authority or lease ownership.
 * Call at bounded fragments/records. Every call samples the monotonic clock;
 * a real event-loop handoff occurs after 8 ms or 8192 calls, whichever is first.
 * The secondary quota counts callbacks/fragments, not 8192 entire records.
 * Guards run immediately before and after each actual handoff. Once a guard
 * fails this callback never resumes work, even if the guard later recovers.
 * Callers must not mutate a transform's input while it is suspended. */
export function createHqCpuCheckpoint(
  guard?: () => Promise<void>
): () => Promise<void> {
  let started = performance.now();
  let work = 0;
  let failed = false;
  let failure: unknown;
  return async () => {
    if (failed) throw failure;
    const now = performance.now();
    if (++work < 8192 && now - started < 8) return;
    try {
      await guard?.();
      await new Promise<void>(resolve => setImmediate(resolve));
      await guard?.();
      started = performance.now();
      work = 0;
    } catch (error) {
      failed = true;
      failure = error;
      throw error;
    }
  };
}
