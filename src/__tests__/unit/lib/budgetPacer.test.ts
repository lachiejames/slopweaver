import { describe, expect, it } from "vitest";
import {
  BUDGET_RESERVE_FRACTION,
  type BudgetHeadroom,
  budgetDelayMs,
  createBudgetPacer,
  pacingDelayMs,
} from "../../../lib/budgetPacer.js";

const HOUR = 3_600_000;
const NOW = 1_000_000;

/** One budget, defaulted to Linear's complexity quota with a full window ahead. */
function headroom({ overrides = {} }: { overrides?: Partial<BudgetHeadroom> } = {}): BudgetHeadroom {
  return { lastCost: 2062, limit: 3_000_000, remaining: 3_000_000, resetAtMs: NOW + HOUR, ...overrides };
}

describe("budgetDelayMs", () => {
  it("spreads the usable budget evenly across the window even when it is FULL", () => {
    // Deliberately not zero. Spending evenly is the whole policy: a greedy pacer would run at the request-rate
    // floor until it hit the reserve and then stall until the window reset — a sawtooth whose total time is
    // WORSE and far lumpier than a smooth spread. 2,400,000 usable at 2,062 a request is 1,163 requests, spread
    // over the hour.
    expect(budgetDelayMs({ headroom: headroom(), nowMs: NOW })).toBe(Math.floor(HOUR / Math.floor(2_400_000 / 2062)));
  });

  it("spreads the usable remainder evenly as the budget depletes", () => {
    // 300,000 remaining against a 600,000 reserve ⇒ nothing usable ⇒ wait out the window.
    expect(budgetDelayMs({ headroom: headroom({ overrides: { remaining: 300_000 } }), nowMs: NOW })).toBe(HOUR);
    // 1,000,000 remaining ⇒ 400,000 usable ⇒ 194 requests at 2,062 each.
    expect(budgetDelayMs({ headroom: headroom({ overrides: { remaining: 1_000_000 } }), nowMs: NOW })).toBe(
      Math.floor(HOUR / Math.floor(400_000 / 2062)),
    );
  });

  it("paces a cheap request far more loosely than an expensive one, on the same budget", () => {
    const cheap = budgetDelayMs({ headroom: headroom({ overrides: { lastCost: 10 } }), nowMs: NOW });
    const dear = budgetDelayMs({ headroom: headroom({ overrides: { lastCost: 7212 } }), nowMs: NOW });
    // This is the property a request-per-second rate cannot express: across this connector's lanes the cost per
    // request spans 10 to 7,212 points, so one number is either too slow for the cheap lane or unsafe for the
    // expensive one.
    expect(cheap).toBeLessThan(dear);
  });

  it("stretches as the window shortens, for the same remaining budget", () => {
    const early = budgetDelayMs({ headroom: headroom({ overrides: { remaining: 1_000_000 } }), nowMs: NOW });
    const late = budgetDelayMs({
      headroom: headroom({ overrides: { remaining: 1_000_000, resetAtMs: NOW + HOUR / 4 } }),
      nowMs: NOW,
    });
    // A quarter of the window left for the same budget means a quarter of the spacing — it speeds UP, because
    // the budget is about to reset and unspent headroom is wasted.
    expect(late).toBeLessThan(early);
  });

  it("waits out the window once the reserve is breached, rather than earning a 429", () => {
    expect(budgetDelayMs({ headroom: headroom({ overrides: { remaining: 0 } }), nowMs: NOW })).toBe(HOUR);
  });

  it("returns 0 once the window has already turned over — a stale reading says nothing about the new one", () => {
    expect(budgetDelayMs({ headroom: headroom({ overrides: { remaining: 0, resetAtMs: NOW - 1 } }), nowMs: NOW })).toBe(
      0,
    );
  });

  it("treats a zero cost as 1, so a free response cannot divide by zero", () => {
    // 100,000 usable at a cost of 1 is 100,000 affordable requests — 36ms apart, not an infinity.
    expect(budgetDelayMs({ headroom: headroom({ overrides: { lastCost: 0, remaining: 700_000 } }), nowMs: NOW })).toBe(
      Math.floor(HOUR / 100_000),
    );
  });

  it("honours a custom reserve — a smaller reserve frees more budget and shortens the wait", () => {
    const tight = headroom({ overrides: { remaining: 700_000 } });
    const defaultReserve = budgetDelayMs({ headroom: tight, nowMs: NOW, reserveFraction: 0.2 });
    const noReserve = budgetDelayMs({ headroom: tight, nowMs: NOW, reserveFraction: 0 });
    expect(noReserve).toBeLessThan(defaultReserve);
  });

  it("uses the repo's existing derating as its default reserve", () => {
    // One safety convention, not two: `SAFETY = 0.8` in the rate registry, 0.2 held back here.
    expect(BUDGET_RESERVE_FRACTION).toBe(0.2);
  });
});

describe("pacingDelayMs — the LONGEST wait wins", () => {
  it("takes the scarce budget's answer, not an average of the two", () => {
    const requests: BudgetHeadroom = { lastCost: 1, limit: 2500, remaining: 2400, resetAtMs: NOW + HOUR };
    const complexity = headroom({ overrides: { remaining: 700_000 } });
    const both = pacingDelayMs({ budgets: [requests, complexity], nowMs: NOW });
    // Requests have loads of headroom; complexity has little. A request is allowed only when EVERY budget allows
    // it, so being generous about the plentiful one cannot buy headroom in the scarce one.
    expect(both).toBe(budgetDelayMs({ headroom: complexity, nowMs: NOW }));
    expect(both).toBeGreaterThan(budgetDelayMs({ headroom: requests, nowMs: NOW }));
  });

  it("imposes no wait when nothing has been observed yet", () => {
    expect(pacingDelayMs({ budgets: [], nowMs: NOW })).toBe(0);
  });
});

describe("createBudgetPacer", () => {
  it("does not wait before the first response has been seen", async () => {
    const slept: number[] = [];
    const pacer = createBudgetPacer({ now: () => NOW, sleep: async ({ ms }) => void slept.push(ms) });
    await pacer.waitTurn();
    expect(slept).toEqual([]);
    expect(pacer.lastWaitMs()).toBe(0);
  });

  it("waits once a response reports a depleted budget, and reports how long it waited", async () => {
    const slept: number[] = [];
    const pacer = createBudgetPacer({ now: () => NOW, sleep: async ({ ms }) => void slept.push(ms) });
    pacer.observe({ budgets: [headroom({ overrides: { remaining: 0 } })] });
    await pacer.waitTurn();
    expect(slept).toEqual([HOUR]);
    // Reported, so a run can say whether the budget actually bound rather than leaving it to be inferred.
    expect(pacer.lastWaitMs()).toBe(HOUR);
  });

  it("relaxes once a later response reports the budget replenished", async () => {
    const slept: number[] = [];
    const pacer = createBudgetPacer({ now: () => NOW, sleep: async ({ ms }) => void slept.push(ms) });
    pacer.observe({ budgets: [headroom({ overrides: { remaining: 0 } })] });
    await pacer.waitTurn();
    expect(slept).toEqual([HOUR]);
    pacer.observe({ budgets: [headroom()] });
    await pacer.waitTurn();
    // Self-correcting in BOTH directions: a replenished budget shortens the wait by three orders of magnitude
    // rather than staying stuck at the depleted spacing.
    expect(pacer.lastWaitMs()).toBeLessThan(HOUR / 100);
  });
});
