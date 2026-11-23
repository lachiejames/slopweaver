/*
 * The GitHub rate-limit budget the section prints: the three buckets read and refused, the poller's arithmetic, and
 * a budget that could not be read said out loud rather than printed as a plausible one.
 */
import { describe, expect, it } from "vitest";
import {
  POLL_BUDGET_FRACTION,
  parseRateLimit,
  type RateLimits,
  rateLimitLine,
} from "../../../../../pane/sections/prStatusRateLimit.js";

/** The parsed rate limits, throwing rather than branching when they could not be read. */
function limitsOf({ stdout }: { stdout: string }): RateLimits {
  const parsed = parseRateLimit({ stdout });
  if (typeof parsed === "string") {
    throw new Error(`expected parsed rate limits, got: ${parsed}`);
  }
  return parsed;
}

describe("parseRateLimit and rateLimitLine — the budget printed on the page", () => {
  it("reads the three buckets", () => {
    const parsed = limitsOf({
      stdout: JSON.stringify({
        resources: {
          core: { limit: 5000, remaining: 5000, used: 0 },
          graphql: { limit: 5000, remaining: 4822, used: 178 },
          search: { limit: 30, remaining: 30, used: 0 },
        },
      }),
    });

    expect(parsed.graphql.remaining).toBe(4822);
    expect(parsed.search.limit).toBe(30);
  });

  it("refuses output that is not JSON, with a reason", () => {
    expect(parseRateLimit({ stdout: "not json" })).toContain("not JSON");
  });

  it("refuses a payload missing a bucket rather than defaulting it", () => {
    expect(
      parseRateLimit({ stdout: JSON.stringify({ resources: { core: { limit: 1, remaining: 1, used: 0 } } }) }),
    ).toContain("did not report all of core, graphql and search");
  });

  it("prints the interval, the arithmetic and the 20% budget", () => {
    const line = rateLimitLine({
      limits: {
        known: true,
        value: {
          core: { limit: 5000, remaining: 5000, used: 0 },
          graphql: { limit: 5000, remaining: 4822, used: 178 },
          search: { limit: 30, remaining: 30, used: 0 },
        },
      },
      repoCount: 2,
      ttlMs: 60_000,
    });

    expect(line).toContain("120 call(s)/hour for 2 repo(s)");
    expect(line).toContain("120 of a 1000/hour budget (20% of the 5000 graphql limit)");
    expect(line).toContain("4822 remaining, 178 used this hour");
    expect(line).toContain("search UNTOUCHED at 30/30");
  });

  it("says search was spent by SOMETHING ELSE when it has dropped, rather than owning it", () => {
    const line = rateLimitLine({
      limits: {
        known: true,
        value: {
          core: { limit: 5000, remaining: 5000, used: 0 },
          graphql: { limit: 5000, remaining: 4822, used: 178 },
          search: { limit: 30, remaining: 24, used: 6 },
        },
      },
      repoCount: 2,
      ttlMs: 60_000,
    });

    expect(line).toContain("6 spent this hour by SOMETHING ELSE on this machine, not by this poller");
  });

  it("says the budget is NOT MEASURED rather than printing a plausible one", () => {
    const line = rateLimitLine({
      limits: { known: false, why: "`gh api rate_limit` failed" },
      repoCount: 2,
      ttlMs: 60_000,
    });

    expect(line).toContain("BUDGET NOT MEASURED — `gh api rate_limit` failed");
    expect(line).toContain("Search is never queried by this poller either way");
  });

  it("keeps the 20% share the owner asked for", () => {
    expect(POLL_BUDGET_FRACTION).toBe(0.2);
  });
});
