/**
 * Pacing against a budget the SERVER reports, rather than a rate we guessed.
 *
 * ## Why a request rate cannot hold this budget
 *
 * `p-throttle` paces REQUESTS, and a request-per-second number is the right shape when every request costs the
 * same. Linear's binding budget is not requests. It enforces **2,500 requests/hour** AND, separately,
 * **3,000,000 complexity points/hour** — and the measured cost per request across this connector's lanes spans
 * three orders of magnitude: 10 points for a comments follow-up, 1,050 for an issues page, 7,212 for a projects
 * page. No fixed request rate can hold a budget whose per-request cost varies 700×. Pick a rate safe for the
 * expensive lane and the cheap lanes crawl; pick one safe on average and a run of expensive pages overruns.
 *
 * Measured for the full Linear crawl: ~940 requests but ~1.5M complexity. Requests use 47% of their hourly
 * budget; complexity uses 50% of a budget nothing was watching. At the previous fixed 0.5 req/s the crawl would
 * have spent complexity slightly FASTER than the derated hourly allowance — safe only by luck.
 *
 * ## What this does instead
 *
 * Linear returns the answer on every response: `x-ratelimit-complexity-limit`, `-remaining` and `-reset` (plus
 * the same three for requests). So there is nothing to model. This spreads the REMAINING budget evenly over the
 * REMAINING window, keeping a reserve — which is self-correcting in both directions. Right after a reset it
 * imposes no delay at all and the request-rate floor governs; as the budget depletes it stretches; if the
 * reserve is breached it waits for the window to turn over rather than earning a 429.
 *
 * It is a PACER, not a retry: there is no failure handling here at all. Transient failures and 429s stay where
 * they belong, in `p-retry` behind {@link ./providerCall.safeProviderCall}, and this composes with the
 * `p-throttle` request floor rather than replacing it. Both budgets are checked and the LONGER wait wins.
 */

/** One budget's state, exactly as a provider reports it. */
export interface BudgetHeadroom {
  /** The budget's ceiling per window. */
  readonly limit: number;
  /** What is left in the current window. */
  readonly remaining: number;
  /** When the window turns over, as epoch milliseconds. */
  readonly resetAtMs: number;
  /** What the LAST request cost against this budget (1 for a request count). */
  readonly lastCost: number;
}

/**
 * The fraction of each budget held back untouched.
 *
 * 0.2 matches the `SAFETY = 0.8` derating the rate registry already applies to every documented quota, so the
 * repo has one safety convention rather than two. It absorbs the gap between what we have observed and what the
 * server has actually counted: our reading is always at least one request stale.
 */
export const BUDGET_RESERVE_FRACTION = 0.2;

/**
 * How long to wait before the next request, so the remaining budget is spread evenly across the rest of the
 * window with the reserve intact. Pure.
 *
 * Returns 0 when there is plenty of headroom — the common case, and the reason this costs nothing when it is
 * not needed. Returns the whole remaining window when the reserve is already breached, which is the honest
 * answer: the budget for this window is spent.
 *
 * @param headroom the budget as the server last reported it
 * @param nowMs the current epoch milliseconds
 * @param reserveFraction the fraction of the limit to hold back (defaults to {@link BUDGET_RESERVE_FRACTION})
 * @returns the milliseconds to wait
 */
export function budgetDelayMs({
  headroom,
  nowMs,
  reserveFraction = BUDGET_RESERVE_FRACTION,
}: {
  headroom: BudgetHeadroom;
  nowMs: number;
  reserveFraction?: number;
}): number {
  const windowMs = headroom.resetAtMs - nowMs;
  if (windowMs <= 0) {
    // The window has already turned over; our `remaining` reading describes a window that no longer exists, so
    // it says nothing about the new one. Proceed and let the next response tell us the truth.
    return 0;
  }
  const usable = headroom.remaining - headroom.limit * reserveFraction;
  const cost = Math.max(1, headroom.lastCost);
  const affordable = Math.floor(usable / cost);
  if (affordable <= 0) {
    return windowMs;
  }
  return Math.min(windowMs, Math.floor(windowMs / affordable));
}

/**
 * The wait before the next request, across EVERY budget in play — the longest wins. Pure.
 *
 * Taking the maximum rather than combining them is the only correct reduction: the budgets are independent
 * ceilings, so a request is allowed only when every one of them allows it, and being generous about the
 * plentiful budget cannot buy headroom in the scarce one.
 *
 * @param budgets each budget's reported state (an empty list ⇒ no wait, nothing observed yet)
 * @param nowMs the current epoch milliseconds
 * @param reserveFraction the fraction of each limit to hold back
 * @returns the milliseconds to wait
 */
export function pacingDelayMs({
  budgets,
  nowMs,
  reserveFraction = BUDGET_RESERVE_FRACTION,
}: {
  budgets: readonly BudgetHeadroom[];
  nowMs: number;
  reserveFraction?: number;
}): number {
  return budgets.reduce(
    (longest, headroom) => Math.max(longest, budgetDelayMs({ headroom, nowMs, reserveFraction })),
    0,
  );
}

/**
 * A pacer: ask it to wait before each request, tell it what the response reported.
 *
 * Deliberately NOT a wrapper around the call. Keeping it to two verbs means the caller decides where in its own
 * nesting the wait belongs — which matters, because it has to sit inside the shared-failure door and outside
 * the raw call, and a wrapper would have made that ordering invisible.
 */
export interface BudgetPacer {
  /** Wait as long as the observed budgets require. Resolves immediately when there is headroom. */
  readonly waitTurn: () => Promise<void>;
  /** Record what a response reported. Absent budgets are simply not tracked. */
  readonly observe: (args: { budgets: readonly BudgetHeadroom[] }) => void;
  /** The last wait imposed, in milliseconds — so a run can report whether the budget actually bound. */
  readonly lastWaitMs: () => number;
}

/**
 * Build a pacer over an injected clock + sleep, so its behaviour is testable without real time.
 *
 * @param now the clock (defaults to `Date.now`)
 * @param sleep the delay primitive (defaults to a single timer)
 * @param reserveFraction the fraction of each budget to hold back
 * @returns the pacer
 */
export function createBudgetPacer({
  now = () => Date.now(),
  sleep = defaultSleep,
  reserveFraction = BUDGET_RESERVE_FRACTION,
}: {
  now?: () => number;
  sleep?: (args: { ms: number }) => Promise<void>;
  reserveFraction?: number;
} = {}): BudgetPacer {
  let budgets: readonly BudgetHeadroom[] = [];
  let lastWaitMs = 0;
  return {
    lastWaitMs: () => lastWaitMs,
    observe: ({ budgets: reported }) => {
      budgets = reported;
    },
    waitTurn: async () => {
      const ms = pacingDelayMs({ budgets, nowMs: now(), reserveFraction });
      lastWaitMs = ms;
      if (ms > 0) {
        await sleep({ ms });
      }
    },
  };
}

/**
 * The default delay: one timer, deliberately REFERENCED.
 *
 * `.unref()` here was a real defect and it is worth recording, because it failed in the most expensive possible
 * way. An unreferenced timer does not hold Node's event loop open, so when the pacer was the only thing pending
 * the process simply EXITED — mid-crawl, with **exit code 0**, after one page of a 24,000-issue rebuild, having
 * printed no error and no summary. Reported success, work not done: the exact defect class this repo cares most
 * about, introduced by copying a watchdog's idiom into a load-bearing wait.
 *
 * A stall watchdog SHOULD be unreferenced — it must never be the reason a process lingers. A pacer is the
 * opposite: the wait IS the work, and the process must stay alive for it.
 */
async function defaultSleep({ ms }: { ms: number }): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
