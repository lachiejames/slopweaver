/**
 * The seams that let the deadline race and the operator's stop signal be driven deterministically, with no real
 * clock: a connection that sits idle until it is cancelled or closed, a `wait` the test resolves by hand, and a
 * microtask flush.
 */
import type { ListenDeps } from "../../../../../../cli/commands/listen/loop.js";
import type { SocketConnection } from "../../../../../../live/listen/socket.js";

/**
 * A connection that never yields a frame — models a genuinely idle, open Socket Mode connection — and only
 * ends when `cancel` or `close` is called. Exists specifically to prove the fix for the deadline-listener
 * plan's own P3 finding: an already-open, idle connection was previously left with nothing that could ever
 * cancel it once the pre-open listener was gone.
 *
 * @returns the connection, plus every reason it was cancelled or closed with, in order
 */
export function idleConnection(): {
  readonly cancelled: readonly string[];
  readonly closed: readonly string[];
  readonly connection: SocketConnection;
} {
  const cancelled: string[] = [];
  const closed: string[] = [];
  // Every cancel or close reason in arrival order: the FIRST one is why the connection ended.
  const endings: string[] = [];
  let wake: (() => void) | undefined;
  return {
    cancelled,
    closed,
    connection: {
      acknowledge: () => undefined,
      cancel: async ({ why }) => {
        cancelled.push(why);
        endings.push(why);
        wake?.();
      },
      close: async ({ why }) => {
        closed.push(why);
        endings.push(why);
        wake?.();
      },
      discarded: () => 0,
      endedBecause: () => endings[0],
      // A plain async-iterable object rather than a generator: it deliberately never yields a frame, only
      // ever settling `done: true` once cancelled or closed — there is no `yield` to write.
      frames: (): AsyncIterable<string> => ({
        [Symbol.asyncIterator]: () => ({
          next: async (): Promise<IteratorResult<string>> => {
            for (;;) {
              if (endings.length > 0) {
                return { done: true, value: undefined };
              }
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
          },
        }),
      }),
    },
  };
}

/**
 * A `wait` fake that records every call and lets the test resolve or cancel any one of them by index — the
 * seam that lets the deadline race's own timing decisions be driven deterministically, with no real clock.
 *
 * @returns the recorded calls, a resolver addressed by call index, and the `wait` seam itself
 */
export function controllableWait(): {
  readonly calls: ReadonlyArray<{ readonly ms: number; readonly signal: AbortSignal }>;
  readonly resolve: (args: { index: number; outcome: "elapsed" | "cancelled" }) => void;
  readonly wait: ListenDeps["wait"];
} {
  const calls: { ms: number; signal: AbortSignal }[] = [];
  const resolvers: ((outcome: "elapsed" | "cancelled") => void)[] = [];
  const wait: ListenDeps["wait"] = ({ ms, signal }) =>
    new Promise((resolve) => {
      calls.push({ ms, signal });
      resolvers.push(resolve);
      signal.addEventListener("abort", () => {
        resolve("cancelled");
      });
    });
  return {
    calls,
    resolve: ({ index, outcome }) => {
      resolvers[index]!(outcome);
    },
    wait,
  };
}

/** Flush pending microtasks so async work already scheduled (but not yet run) settles before an assertion. */
export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}
