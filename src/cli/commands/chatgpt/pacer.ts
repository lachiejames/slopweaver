/**
 * The pace every multi-request `chatgpt` web read keeps, so the owner's own ChatGPT account is never rate-limited or
 * flagged by this tool: one request at a time, each starting no sooner than a fixed floor plus a random extra after
 * the one before it.
 *
 * The floor and jitter are a CHOICE, not a measurement: nothing about ChatGPT's limits is recorded, and they were
 * deliberately not probed, because probing a limit is exactly what could flag the account. Three seconds plus up to
 * two is slower than a person scrolling the sidebar. A `429` is never slept through: the caller stops the run.
 *
 * Pure except for the injected clock, sleep and random source.
 */

/** The least time between the starts of two requests. A choice; see the module header. */
const CHATGPT_REQUEST_FLOOR_MS = 3_000;

/** The most extra time added to the floor, drawn fresh before each request. A choice; see the module header. */
const CHATGPT_REQUEST_JITTER_MS = 2_000;

/** The clock, sleep and random source a pacer reads. */
export interface ChatgptPacerDeps {
  readonly nowMs: () => number;
  readonly sleep: (args: { ms: number }) => Promise<void>;
  /** A whole number in `[0, maxExclusive)`. */
  readonly randomInt: (args: { maxExclusive: number }) => number;
}

/** One run's pacer: await {@link ChatgptPacer.beforeRequest} before every request it paces. */
export interface ChatgptPacer {
  readonly beforeRequest: () => Promise<void>;
}

/**
 * A pacer for one run. The first request starts at once; each later one waits until the previous request's start
 * plus the floor plus a jitter drawn for it.
 *
 * @param floorMs the least time between two request starts
 * @param jitterMs the most extra time drawn before each request after the first
 * @param deps the clock, sleep and random source
 * @returns the pacer
 */
export function createChatgptPacer({
  floorMs,
  jitterMs,
  deps,
}: {
  floorMs: number;
  jitterMs: number;
  deps: ChatgptPacerDeps;
}): ChatgptPacer {
  let lastStartMs: number | undefined;
  return {
    beforeRequest: async () => {
      if (lastStartMs !== undefined) {
        const jitter = jitterMs > 0 ? deps.randomInt({ maxExclusive: jitterMs + 1 }) : 0;
        const wait = lastStartMs + floorMs + jitter - deps.nowMs();
        if (wait > 0) {
          await deps.sleep({ ms: wait });
        }
      }
      lastStartMs = deps.nowMs();
    },
  };
}

/**
 * The production pacer: the wall clock, a timer and `Math.random`, at the module's floor and jitter.
 *
 * @returns the pacer
 */
export function productionChatgptPacer(): ChatgptPacer {
  return createChatgptPacer({
    deps: {
      nowMs: () => Date.now(),
      randomInt: ({ maxExclusive }) => Math.floor(Math.random() * maxExclusive),
      sleep: ({ ms }) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }),
    },
    floorMs: CHATGPT_REQUEST_FLOOR_MS,
    jitterMs: CHATGPT_REQUEST_JITTER_MS,
  });
}
