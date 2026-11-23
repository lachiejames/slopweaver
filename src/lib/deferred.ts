/**
 * A promise whose resolution is handed back to the caller, and which settles at most ONCE.
 *
 * Event-driven work — a socket subscription, a poll with a quiet timer — has several places that can decide
 * the work is over: the last frame arrived, the connection closed, the caller hit a limit, the timer fired.
 * Writing those as several `resolve(…)` calls inside a `new Promise` executor is both easy to get wrong (a
 * second resolve is silently ignored, so a bug hides) and flagged by `promise/no-multiple-resolved`.
 *
 * This makes "at most once" a property of the type instead of a `let done = false` each caller re-invents.
 */

/** A promise plus the one-shot settle function for it. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  /**
   * Settle the promise. The FIRST call wins; every later one is a no-op, and {@link Deferred.settled} says
   * which happened.
   */
  readonly settle: (options: { value: T }) => void;
  /** Whether the promise has already settled. */
  readonly settled: () => boolean;
}

/**
 * Create a {@link Deferred}.
 *
 * @returns the promise, its one-shot settle function, and a settled predicate
 */
export function deferred<T>(): Deferred<T> {
  let resolveOnce: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveOnce = resolve;
  });
  let done = false;
  return {
    promise,
    settle: ({ value }) => {
      if (done) {
        return;
      }
      done = true;
      resolveOnce(value);
    },
    settled: () => done,
  };
}
